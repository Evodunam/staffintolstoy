import session from "express-session";
import connectPg from "connect-pg-simple";

/**
 * Session duration: 30 days rolling. Sliding window — every request that hits
 * an authenticated route refreshes the cookie expiry (see saveUninitialized=false
 * + resave=false + cookie.maxAge). Old "10 year never expire" sessions
 * have been retired because:
 *   1. Stolen-device attack window was effectively infinite.
 *   2. SOC 2 CC6 controls expect bounded session lifetimes with re-auth.
 *   3. Step-up re-auth (server/auth/stepUp.ts) handles sensitive actions
 *      separately, so a 30-day idle window doesn't hurt UX for everyday flows.
 */
export const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;

export function getSession() {
  const sessionTtl = SESSION_TTL_SECONDS * 1000; // same duration in ms for cookie and store
  const isProduction = process.env.NODE_ENV === "production";
  // Behind cloud/load balancer proxies, secure cookies can be silently dropped unless proxy mode is enabled.
  // Keep this aligned with app.set("trust proxy", 1) in routes bootstrap.
  const cookieSecure: boolean | "auto" = isProduction ? "auto" : false;
  // Share the session cookie across apex + app.* (e.g. tolstoystaffing.com and
  // app.tolstoystaffing.com) by setting a leading-dot Domain. Required because
  // client/src/lib/subdomain-utils.ts intentionally bounces between hosts
  // (login on main domain, app on subdomain) — without this the session is
  // host-only and users get a redirect ping-pong.
  const cookieDomain = process.env.SESSION_COOKIE_DOMAIN
    || (isProduction ? ".tolstoystaffing.com" : undefined);
  const pgStore = connectPg(session);
  const sessionStore = new pgStore({
    conString: process.env.DATABASE_URL,
    createTableIfMissing: false,
    ttl: sessionTtl,
    tableName: "sessions",
  });
  return session({
    secret: process.env.SESSION_SECRET!,
    store: sessionStore,
    proxy: isProduction,
    resave: false,
    saveUninitialized: false,
    rolling: true, // sliding window — refresh expiry on every authenticated request
    cookie: {
      httpOnly: true,
      secure: cookieSecure,
      maxAge: sessionTtl,
      sameSite: "lax",
      ...(cookieDomain ? { domain: cookieDomain } : {}),
    },
  });
}
