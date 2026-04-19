import { promises as dns } from "dns";

/**
 * Email-deliverability DNS audit. Resolves SPF/DKIM/DMARC/MX/CAA records for a
 * domain and reports passes / soft-warnings / hard failures with actionable
 * remediation strings.
 *
 * Used by:
 *   - Admin "Email deliverability" panel to spot-check our own sender domain
 *     (e.g. tolstoystaffing.com).
 *   - Companies that want to send branded transactional email through our
 *     platform — they paste their sending domain, we tell them what to fix.
 *
 * No external API calls; uses Node's built-in DNS resolver. Each check is
 * wrapped in try/catch so a NODATA on one record never short-circuits another.
 */

export interface CheckResult {
  ok: boolean;
  level: "pass" | "warn" | "fail";
  found: string[];
  message: string;
  remediation?: string;
}

export interface DnsHealthReport {
  domain: string;
  checkedAt: string;
  spf: CheckResult;
  dkim: { resend: CheckResult; google: CheckResult; selectorFound: string | null };
  dmarc: CheckResult;
  mx: CheckResult;
  caa: CheckResult;
  summary: {
    overall: "pass" | "warn" | "fail";
    passes: number;
    warns: number;
    fails: number;
  };
}

const DKIM_SELECTORS_TO_TRY = [
  "resend",   // Resend default
  "google",   // Workspace
  "selector1", // Microsoft 365 first
  "selector2",
  "k1",        // Mailchimp/Mandrill default
  "default",
];

export async function auditDomain(domain: string): Promise<DnsHealthReport> {
  const safeDomain = String(domain || "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  if (!safeDomain || !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(safeDomain)) {
    throw new Error("Invalid domain");
  }

  const [spf, dkim, dmarc, mx, caa] = await Promise.all([
    checkSpf(safeDomain),
    checkDkim(safeDomain),
    checkDmarc(safeDomain),
    checkMx(safeDomain),
    checkCaa(safeDomain),
  ]);

  const all = [spf, dkim.resend, dkim.google, dmarc, mx, caa];
  const fails = all.filter((c) => c.level === "fail").length;
  const warns = all.filter((c) => c.level === "warn").length;
  const passes = all.filter((c) => c.level === "pass").length;
  const overall: "pass" | "warn" | "fail" = fails > 0 ? "fail" : warns > 0 ? "warn" : "pass";

  return {
    domain: safeDomain,
    checkedAt: new Date().toISOString(),
    spf, dkim, dmarc, mx, caa,
    summary: { overall, passes, warns, fails },
  };
}

async function resolveTxtSafe(name: string): Promise<string[]> {
  try {
    const records = await dns.resolveTxt(name);
    return records.map((arr) => arr.join(""));
  } catch {
    return [];
  }
}

async function checkSpf(domain: string): Promise<CheckResult> {
  const txt = await resolveTxtSafe(domain);
  const spfRecords = txt.filter((r) => r.toLowerCase().startsWith("v=spf1"));
  if (spfRecords.length === 0) {
    return {
      ok: false, level: "fail", found: [],
      message: "No SPF record found.",
      remediation: `Add a TXT record at ${domain}: "v=spf1 include:_spf.resend.com ~all" (replace include with your provider).`,
    };
  }
  if (spfRecords.length > 1) {
    return {
      ok: false, level: "fail", found: spfRecords,
      message: "Multiple SPF records — all but one will be ignored, breaking authentication.",
      remediation: "Merge into a single TXT record. RFC 7208 allows only one v=spf1.",
    };
  }
  const spf = spfRecords[0];
  // Count DNS lookups (include/redirect/a/mx/ptr/exists). Hard limit is 10 per RFC.
  const lookupTokens = (spf.match(/(include:|redirect=|a:|mx:|ptr:|exists:|a\s|mx\s|ptr\s|exists\s|^a$|^mx$|^ptr$)/gi) ?? []).length;
  if (lookupTokens > 10) {
    return {
      ok: false, level: "fail", found: spfRecords,
      message: `SPF has ${lookupTokens} mechanisms requiring DNS lookups (max 10 per RFC 7208 §4.6.4). Mail will softfail.`,
      remediation: "Flatten SPF (resolve includes once, hardcode IPs) or remove unused providers.",
    };
  }
  if (/[~?+]all\b/i.test(spf) && !/-all\b/i.test(spf)) {
    if (/\?all\b/i.test(spf)) {
      return {
        ok: false, level: "warn", found: spfRecords,
        message: "SPF ends in ?all (neutral) — receivers won't reject spoofed mail.",
        remediation: "Use ~all (softfail) at minimum, or -all (fail) once you're confident in your sending sources.",
      };
    }
    return { ok: true, level: "pass", found: spfRecords, message: "SPF present with softfail policy." };
  }
  if (/-all\b/i.test(spf)) {
    return { ok: true, level: "pass", found: spfRecords, message: "SPF present with strict fail policy." };
  }
  return {
    ok: false, level: "warn", found: spfRecords,
    message: "SPF record present but missing ~all/-all qualifier.",
    remediation: "Append ~all (softfail) so unauthorized senders are flagged.",
  };
}

async function checkDkim(domain: string): Promise<DnsHealthReport["dkim"]> {
  // Try selectors in parallel; report which (if any) we found.
  const results = await Promise.all(DKIM_SELECTORS_TO_TRY.map(async (sel) => {
    const txt = await resolveTxtSafe(`${sel}._domainkey.${domain}`);
    return { selector: sel, txt };
  }));
  const found = results.filter((r) => r.txt.some((t) => t.toLowerCase().includes("v=dkim1") || t.toLowerCase().startsWith("k=") || t.toLowerCase().includes("p=")));
  const selectorFound = found[0]?.selector ?? null;

  const resendCheck: CheckResult = (() => {
    const r = results.find((r) => r.selector === "resend");
    if (r && r.txt.length > 0) return { ok: true, level: "pass", found: r.txt, message: "Resend DKIM (resend._domainkey) found." };
    return {
      ok: false, level: "warn", found: [],
      message: "No Resend DKIM record at resend._domainkey.",
      remediation: "If you send via Resend: add the CNAME records shown in the Resend dashboard for your domain.",
    };
  })();

  const googleCheck: CheckResult = (() => {
    const r = results.find((r) => r.selector === "google");
    if (r && r.txt.length > 0) return { ok: true, level: "pass", found: r.txt, message: "Google Workspace DKIM (google._domainkey) found." };
    return { ok: false, level: "warn", found: [], message: "No Google Workspace DKIM (google._domainkey)." };
  })();

  return { resend: resendCheck, google: googleCheck, selectorFound };
}

async function checkDmarc(domain: string): Promise<CheckResult> {
  const txt = await resolveTxtSafe(`_dmarc.${domain}`);
  const dmarc = txt.find((r) => r.toLowerCase().startsWith("v=dmarc1"));
  if (!dmarc) {
    return {
      ok: false, level: "fail", found: [],
      message: "No DMARC record at _dmarc.<domain>.",
      remediation: `Add a TXT at _dmarc.${domain}: "v=DMARC1; p=none; rua=mailto:dmarc@${domain}; pct=100; aspf=r; adkim=r;"  (start with p=none for monitoring, ramp to quarantine then reject).`,
    };
  }
  const policyMatch = dmarc.match(/p=(none|quarantine|reject)/i);
  const policy = policyMatch?.[1]?.toLowerCase();
  if (policy === "none") {
    return {
      ok: true, level: "warn", found: [dmarc],
      message: "DMARC monitoring (p=none) — reports collected but no enforcement.",
      remediation: "Once your DMARC reports look clean for 2-4 weeks, move to p=quarantine then p=reject.",
    };
  }
  if (policy === "quarantine" || policy === "reject") {
    return { ok: true, level: "pass", found: [dmarc], message: `DMARC enforced (p=${policy}).` };
  }
  return { ok: false, level: "warn", found: [dmarc], message: "DMARC present but missing/invalid p= tag." };
}

async function checkMx(domain: string): Promise<CheckResult> {
  try {
    const records = await dns.resolveMx(domain);
    if (records.length === 0) {
      return {
        ok: false, level: "fail", found: [],
        message: "No MX records — domain cannot receive email (DMARC reports, replies, etc).",
        remediation: "Add MX records pointing to your inbound mail provider (Workspace: aspmx.l.google.com, etc).",
      };
    }
    const sorted = records.sort((a, b) => a.priority - b.priority);
    return {
      ok: true, level: "pass",
      found: sorted.map((r) => `${r.priority} ${r.exchange}`),
      message: `${records.length} MX record${records.length === 1 ? "" : "s"} found.`,
    };
  } catch (err) {
    return {
      ok: false, level: "fail", found: [],
      message: `MX lookup failed: ${(err as Error).message}`,
      remediation: "Verify the domain exists and DNS is configured.",
    };
  }
}

async function checkCaa(domain: string): Promise<CheckResult> {
  try {
    const records = await (dns as any).resolveCaa?.(domain) ?? [];
    if (!records || records.length === 0) {
      return {
        ok: true, level: "warn", found: [],
        message: "No CAA records — any CA can issue certs for this domain.",
        remediation: "Optionally pin to your CA(s), e.g. \"0 issue \\\"letsencrypt.org\\\"\" and \"0 iodef \\\"mailto:security@yourdomain.com\\\"\" for incident reports.",
      };
    }
    const flat: string[] = records.map((r: any) => `${r.critical ?? 0} ${Object.entries(r).filter(([k]) => k !== "critical").map(([k, v]) => `${k}=${v}`).join(" ")}`);
    return { ok: true, level: "pass", found: flat, message: `${records.length} CAA record${records.length === 1 ? "" : "s"} configured.` };
  } catch {
    return {
      ok: true, level: "warn", found: [],
      message: "CAA records not present.",
      remediation: "Optionally restrict cert issuance to specific CAs.",
    };
  }
}

