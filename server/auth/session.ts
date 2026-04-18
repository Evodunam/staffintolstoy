import session from "express-session";
import connectPg from "connect-pg-simple";

/** Session duration: 10 years (stay logged in; no auto logout). In seconds for expires_at. */
export const SESSION_TTL_SECONDS = 10 * 365 * 24 * 60 * 60;

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
    cookie: {
      httpOnly: true,
      secure: cookieSecure,
      maxAge: sessionTtl,
      sameSite: "lax",
      ...(cookieDomain ? { domain: cookieDomain } : {}),
    },
  });
}
