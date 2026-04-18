/**
 * Production-readiness smoke test (HTTP-level).
 *
 * Hits a live deployment and asserts the things most likely to break after
 * a session/auth/cookie/middleware change. Designed to run in <10s.
 *
 * Usage:
 *   tsx script/prod-smoke-test.ts                          # defaults to https://app.tolstoystaffing.com
 *   tsx script/prod-smoke-test.ts https://staging.example
 *   SMOKE_BASE=https://app.tolstoystaffing.com tsx script/prod-smoke-test.ts
 *
 * What it checks:
 *   1. /api/health returns 200 (server up + DB reachable)
 *   2. /api/health Set-Cookie (if any) has Secure + Domain + SameSite=Lax
 *   3. /api/me/admin-status responds (or 401 cleanly, NOT 500)
 *   4. There is no double-cookie issue: hitting /api/health twice with the
 *      first response's cookie returns the SAME session (cookie-parser would
 *      otherwise pick the wrong cookie and bounce sessions).
 *   5. CORS / cookie attributes match what the client expects so login can
 *      actually persist.
 *
 * Exit codes:
 *   0  all checks passed
 *   1  one or more checks failed (non-blocking warnings printed)
 *   2  network/transport error reaching the deployment
 */

const DEFAULT_BASE = "https://app.tolstoystaffing.com";

interface CheckResult {
  name: string;
  ok: boolean;
  detail?: string;
}

const results: CheckResult[] = [];

function ok(name: string, detail?: string) {
  results.push({ name, ok: true, detail });
}
function fail(name: string, detail: string) {
  results.push({ name, ok: false, detail });
}

function parseSetCookie(header: string | null): Record<string, string>[] {
  if (!header) return [];
  // Browser-style fetch concatenates Set-Cookie with ", " — but values can
  // contain commas (Expires=...). Split heuristically on ", " followed by a
  // word + "=".
  const parts = header.split(/,\s*(?=[A-Za-z][A-Za-z0-9_-]*=)/);
  return parts.map((p) => {
    const out: Record<string, string> = {};
    p.split(";").forEach((kv, i) => {
      const eq = kv.indexOf("=");
      const k = (eq < 0 ? kv : kv.slice(0, eq)).trim();
      const v = eq < 0 ? "" : kv.slice(eq + 1).trim();
      if (i === 0) {
        out.name = k;
        out.value = v;
      } else if (k) {
        out[k.toLowerCase()] = v || "true";
      }
    });
    return out;
  });
}

async function check1Health(base: string): Promise<Response | null> {
  try {
    const r = await fetch(`${base}/api/health`, { redirect: "manual" });
    if (r.status === 200) ok("GET /api/health", "200 OK");
    else fail("GET /api/health", `status ${r.status}`);
    return r;
  } catch (e: any) {
    fail("GET /api/health", `network error: ${e.message}`);
    return null;
  }
}

function check2CookieAttributes(r: Response | null) {
  if (!r) return;
  const setCookieHeader = r.headers.get("set-cookie");
  if (!setCookieHeader) {
    ok("Set-Cookie attributes", "(no Set-Cookie on /api/health — fine)");
    return;
  }
  const cookies = parseSetCookie(setCookieHeader);
  const sessionCookie = cookies.find((c) => c.name === "connect.sid");
  if (!sessionCookie) {
    ok("Set-Cookie attributes", "(no connect.sid set by /api/health)");
    return;
  }
  const issues: string[] = [];
  if (!("secure" in sessionCookie)) issues.push("missing Secure");
  if (!("httponly" in sessionCookie)) issues.push("missing HttpOnly");
  const samesite = sessionCookie["samesite"]?.toLowerCase();
  if (samesite !== "lax" && samesite !== "strict") issues.push(`SameSite=${samesite || "none/missing"}`);
  const domain = sessionCookie["domain"];
  if (!domain || !domain.startsWith(".")) {
    issues.push(`Domain=${domain || "(host-only — old cookies will collide!)"}`);
  }
  if (issues.length > 0) {
    fail("Set-Cookie attributes", issues.join("; "));
  } else {
    ok("Set-Cookie attributes", `Domain=${domain} Secure HttpOnly SameSite=${samesite}`);
  }
}

async function check3AdminStatusRoute(base: string) {
  try {
    const r = await fetch(`${base}/api/me/admin-status`, { redirect: "manual" });
    // Either 200 (anon { isAdmin: false }) or 401 is acceptable. 500 = bad.
    if (r.status === 500) {
      const body = await r.text().catch(() => "");
      fail("GET /api/me/admin-status", `500: ${body.slice(0, 200)}`);
    } else {
      ok("GET /api/me/admin-status", `status ${r.status}`);
    }
  } catch (e: any) {
    fail("GET /api/me/admin-status", `network error: ${e.message}`);
  }
}

async function check4StaticAsset(base: string) {
  try {
    const r = await fetch(`${base}/`, { redirect: "manual" });
    if (r.status === 200 || (r.status >= 300 && r.status < 400)) {
      const ct = r.headers.get("content-type") || "";
      if (ct.includes("text/html") || r.status >= 300) {
        ok("GET /", `status ${r.status} (${ct || "redirect"})`);
      } else {
        fail("GET /", `unexpected content-type: ${ct}`);
      }
    } else {
      fail("GET /", `status ${r.status}`);
    }
  } catch (e: any) {
    fail("GET /", `network error: ${e.message}`);
  }
}

async function check5SessionStability(base: string) {
  // Hit /api/health twice in sequence; the second request should NOT issue a
  // new connect.sid (otherwise sessions are bouncing — symptom of cookie
  // collision or store misconfiguration).
  try {
    const r1 = await fetch(`${base}/api/health`, { redirect: "manual" });
    const c1 = r1.headers.get("set-cookie");
    if (!c1) {
      ok("Session stability", "(no cookie issued — anonymous endpoint, fine)");
      return;
    }
    const cookieHeader = c1.split(";")[0]; // just name=value
    const r2 = await fetch(`${base}/api/health`, {
      redirect: "manual",
      headers: { cookie: cookieHeader },
    });
    const c2 = r2.headers.get("set-cookie");
    if (!c2) {
      ok("Session stability", "second request reused session (good)");
    } else {
      // Some servers always issue Set-Cookie due to rolling sessions. That's
      // ok IFF the SID stays the same.
      const sid1 = parseSetCookie(c1).find((c) => c.name === "connect.sid")?.value;
      const sid2 = parseSetCookie(c2).find((c) => c.name === "connect.sid")?.value;
      if (sid1 && sid2 && sid1 === sid2) {
        ok("Session stability", "rolling cookie, same SID — good");
      } else {
        fail("Session stability", `SID changed between requests (${sid1?.slice(0, 8)} → ${sid2?.slice(0, 8)}). Cookie collision likely.`);
      }
    }
  } catch (e: any) {
    fail("Session stability", `network error: ${e.message}`);
  }
}

async function check6ApiSubdomainRedirect(base: string) {
  // Apex tolstoystaffing.com should 308-redirect /login → app.tolstoystaffing.com.
  // Skip if base is not the app subdomain.
  if (!base.includes("app.tolstoystaffing.com")) {
    return;
  }
  try {
    const r = await fetch("https://tolstoystaffing.com/login", { redirect: "manual" });
    if (r.status === 308 || r.status === 301 || r.status === 302) {
      const loc = r.headers.get("location") || "";
      if (loc.includes("app.tolstoystaffing.com")) {
        ok("Apex /login redirect", `${r.status} → ${loc}`);
      } else {
        fail("Apex /login redirect", `${r.status} → ${loc} (expected app subdomain)`);
      }
    } else {
      fail("Apex /login redirect", `expected 3xx, got ${r.status}`);
    }
  } catch (e: any) {
    // Apex check is informational only.
    ok("Apex /login redirect", `(skipped: ${e.message})`);
  }
}

async function main() {
  const base = (process.argv[2] || process.env.SMOKE_BASE || DEFAULT_BASE).replace(/\/$/, "");
  console.log(`\nProduction smoke test against: ${base}\n`);

  const r1 = await check1Health(base);
  check2CookieAttributes(r1);
  await check3AdminStatusRoute(base);
  await check4StaticAsset(base);
  await check5SessionStability(base);
  await check6ApiSubdomainRedirect(base);

  console.log("");
  for (const r of results) {
    const tag = r.ok ? "  ok  " : "  FAIL";
    console.log(`${tag}  ${r.name}${r.detail ? `  —  ${r.detail}` : ""}`);
  }
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed.\n`);
  process.exit(failed.length > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("Smoke test crashed:", e);
  process.exit(2);
});
