# WAF / DDoS / edge-security hardening

This is a setup guide for putting **Cloudflare** in front of the DigitalOcean App
Platform deployment. End state:

- **DDoS absorption** at Cloudflare's edge (not your origin)
- **Bot management** to block scrapers hitting `/jobs` and credential stuffers
  hitting `/api/auth/login-email`
- **Rate limiting** that goes well beyond what `express-rate-limit` can do
  alone (per-region, per-bot-class, exponential backoff)
- **WAF managed rules** (OWASP Top 10, Cloudflare Managed Ruleset) blocking
  SQLi/XSS/LFI before requests hit Express
- **Geo and ASN blocks** for known abuse networks
- **Custom rules** for our specific endpoints

The entire setup costs **$0 on Cloudflare's Free plan**, with managed-rules
upgrades available on Pro ($25/mo) and bot-management add-on on Business.

---

## 1. DNS — point through Cloudflare (proxied)

You currently host DNS on **DigitalOcean** (the apex `tolstoystaffing.com` and
the `app.tolstoystaffing.com` ALIAS are managed there). To use Cloudflare's WAF
you need Cloudflare to be authoritative.

1. Sign up at <https://cloudflare.com> → Add `tolstoystaffing.com`.
2. Cloudflare imports your existing records. Verify they all came over —
   especially:
   - `tolstoystaffing.com` apex (A or ALIAS pointing at DO App Platform)
   - `www` CNAME → apex
   - `app` CNAME → DigitalOcean App Platform target (e.g. `<app>.ondigitalocean.app`)
   - `admin` CNAME (admin.estimatrix.io) — note this is a separate zone if
     using estimatrix.io; configure it in its own Cloudflare site
3. Cloudflare gives you 2 nameservers (e.g. `kim.ns.cloudflare.com` +
   `walt.ns.cloudflare.com`).
4. **At your domain registrar** (whoever holds the registration; check
   `whois tolstoystaffing.com`), change nameservers from the DO ones
   (`ns1.digitalocean.com` etc) to the Cloudflare pair. Propagation: 1–24 hours.
5. In Cloudflare DNS panel, set the proxy status (orange-cloud) to **ON** for:
   - `tolstoystaffing.com` (apex)
   - `www`
   - `app`

Records that should stay **DNS-only** (gray-cloud):

- MX records pointing to your email provider (Resend doesn't accept proxied)
- TXT records (SPF, DKIM, DMARC, domain verification) — verify with
  `/api/admin/dns-health?domain=tolstoystaffing.com` in the admin console
- Any `_acme-challenge` records
- DigitalOcean App Platform's internal verification CNAME (if present)

After this is live, DigitalOcean's certificate becomes the **origin**
certificate; Cloudflare presents its own edge cert to clients. You should
then move to **Full (strict)** SSL mode in Cloudflare → SSL/TLS → Overview.

## 2. Always-on settings to flip immediately

Cloudflare → Security:

- **Security level**: `Medium` (start). Move to `High` only after a week of
  monitoring shows no false positives blocking legit users.
- **Bot Fight Mode**: ON. Catches the dumb scrapers for free.
- **Browser Integrity Check**: ON.
- **Challenge Passage**: 30 minutes (default).

Cloudflare → SSL/TLS:

- **Mode**: Full (strict)
- **Edge Certificate**: Always Use HTTPS = ON; Min TLS Version = 1.2;
  Opportunistic Encryption = ON; Automatic HTTPS Rewrites = ON.
- **HSTS**: enabled with `max-age=31536000`, includeSubdomains, preload.
  *(We already send this header from Express, but Cloudflare emitting it
  edge-side prevents it from being stripped if the origin ever returns 5xx.)*

Cloudflare → Network:

- **HTTP/3 (with QUIC)**: ON
- **WebSockets**: ON (we use them at `/ws`)
- **gRPC**: leave OFF unless you start using it
- **Pseudo IPv4**: OFF

## 3. WAF rules — Managed Rulesets (Free) + custom

Cloudflare → Security → WAF → Managed rules:

- **Cloudflare Managed Ruleset**: Deploy with default action *Block*. Covers
  CVEs, OWASP Top 10 categories, and Cloudflare's continuously-updated rules.
- **OWASP Core Ruleset**: Deploy at sensitivity *Medium*. False positives can
  be tuned by adding skip rules for specific paths.

### Custom rules (Free plan allows up to 5)

Order matters — first-match wins.

#### Rule 1: Block the most-attacked endpoints from abuse-only ASNs

```text
(http.request.uri.path in {"/api/auth/login-email" "/api/auth/login/email-otp/verify" "/api/auth/mfa/login-verify" "/api/login"}) and (ip.geoip.asnum in {14618 16509 14061 16276 24940})
Action: Managed Challenge
```

ASNs above are the major cloud providers (AWS 14618, AWS 16509, DO 14061,
Hetzner 16276, Linode/Akamai 24940). Legitimate workers don't sign in
from server-side IPs. All four endpoints exist in `server/routes.ts`.

#### Rule 2: Aggressive challenge for /api/auth/* from outside US/CA

```text
(starts_with(http.request.uri.path, "/api/auth/")) and (not ip.geoip.country in {"US" "CA"})
Action: Managed Challenge
```

#### Rule 3: Rate-limit `/api/jobs` listing scraping

```text
(http.request.uri.path eq "/api/jobs") and (cf.threat_score > 10)
Action: Block
```

#### Rule 4: Drop requests with no user-agent header

```text
not exists http.user_agent or http.user_agent eq ""
Action: Block
```

Caveat: some legit JSON-only API consumers send no user-agent. Add allowlist
exceptions for partner integrations as they come online.

#### Rule 5: Allowlist webhook source IPs

```text
(starts_with(http.request.uri.path, "/api/webhooks/")) and (not ip.src in $allowed_webhook_ips)
Action: Block
```

Active webhook endpoints (verify in `server/routes.ts`):

- `/api/webhooks/checkr` — see <https://docs.checkr.com/reference/webhooks> (no static IPs published; rely on signature verification and skip this WAF rule for `/api/webhooks/checkr` if needed)
- `/api/webhooks/stripe-identity` — see <https://stripe.com/docs/ips#webhook-notifications>
- `/api/webhooks/stripe-payment-method` — same Stripe IP list

Create the IP list `allowed_webhook_ips` from the Stripe URL above. Note
that Mercury, Resend, and Checkr don't publish static IP ranges — those
webhook handlers MUST rely on HMAC signature verification (which they do).
Adjust the rule path to exclude provider routes that lack static IPs.

## 4. Rate limiting (separate from express-rate-limit)

Cloudflare → Security → WAF → Rate limiting rules. Free plan = 1 rule.

```text
Name: API auth burst
Match: (starts_with(http.request.uri.path, "/api/auth/")) or (http.request.uri.path eq "/api/login")
Characteristics: IP, plus URI path
Period: 10 seconds
Threshold: 20 requests
Action: Block 1 hour
```

For more rules upgrade to Pro/Biz, but the in-app `express-rate-limit` covers
the rest at the application layer.

## 5. Block list / allow list

Cloudflare → Security → WAF → Tools:

- **Allow list**: your office IP, your homepage CI runner IP
- **Block list**: any IP that has historically attacked you (check
  Cloudflare's Security Events panel after a week)

## 6. Origin protection (after Cloudflare is in front)

The DigitalOcean origin should reject any request that didn't come through
Cloudflare. Do this by:

1. Pulling the Cloudflare IPv4 + IPv6 ranges from
   <https://www.cloudflare.com/ips-v4> and <https://www.cloudflare.com/ips-v6>
2. In DigitalOcean App Platform → your app → Settings → Networking →
   add a **trusted-source** filter accepting only Cloudflare's ranges
   (DO calls this an "IP allowlist" depending on their UI version).
3. Optionally, set a shared secret header at Cloudflare (Transform Rules →
   Modify Request Header → set `X-CF-Origin-Auth: <random-secret>`) and
   reject any request lacking it on the origin via Express middleware.

This eliminates the bypass-Cloudflare-by-hitting-the-origin-IP attack.

## 7. Monitoring

After the cutover, monitor:

- Cloudflare → Analytics → Security → look for top blocked rules + top
  source ASNs/countries.
- Sentry (already wired in `server/observability/sentry.ts`) for application
  4xx/5xx that survived the WAF.
- `/api/status` (already wired at `server/routes.ts:747`) for origin liveness.
- `/api/admin/metrics/endpoints` (admin SLO dashboard) for in-process
  per-route p50/p95/p99 + error rate. Cross-reference Cloudflare's edge
  metrics here when investigating an outage.
- `/api/admin/dns-health?domain=tolstoystaffing.com` for SPF/DKIM/DMARC/MX/CAA
  drift detection — re-run after any DNS change in Cloudflare.

## 8. Subscriber-friendly status page

Once Cloudflare is live, Cloudflare also offers a free hosted status page
under their Pages product. Or wire BetterStack/Statuspage.io to ping
`/api/status` every 60s.

## Cost summary

| Tier     | Monthly | What you gain                                                                                |
| -------- | ------- | -------------------------------------------------------------------------------------------- |
| Free     | $0      | DDoS absorption, Bot Fight Mode, 5 custom WAF rules, 1 rate-limit rule, basic managed rules  |
| Pro      | $25     | Image polish, full managed ruleset, 20 custom rules, 5 rate-limit rules, mobile redirects    |
| Business | $250    | Bot management ML, 100 custom rules, custom certs, prioritized support                       |

Free is enough until you hit ~1M req/day or start seeing sophisticated bot abuse.

## Order-of-operations

1. Add domain to Cloudflare; verify all DNS records imported correctly.
2. Switch nameservers at registrar.
3. Wait for DNS to propagate (verify with `nslookup tolstoystaffing.com 8.8.8.8`).
4. Flip on the always-on settings (section 2).
5. Deploy the 5 custom WAF rules in section 3.
6. Add the rate-limiting rule in section 4.
7. **Wait one week**, watch Security Events, tune false positives.
8. Lock origin to Cloudflare-only IPs (section 6).
