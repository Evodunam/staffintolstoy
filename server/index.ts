// Load env before any other server code (so db.ts sees DATABASE_URL)
import "./env-loader";

// Sentry must be required as early as possible so it can hook the runtime
// before any other module wraps async/error-handling primitives.
import { initSentry, Sentry } from "./observability/sentry";
initSentry();

// Suppress PostCSS "from option" warning (harmless; printed by plugins during Vite transform)
const _stderrWrite = process.stderr.write.bind(process.stderr);
process.stderr.write = (chunk: any, enc?: any, cb?: any) => {
  const s = typeof chunk === "string" ? chunk : String(chunk ?? "");
  if (s.includes("PostCSS plugin") && s.includes("from option")) return (typeof cb === "function" ? cb() : true) as boolean;
  return _stderrWrite(chunk, enc, cb);
};

// Quiet boot: set DEBUG_ENV=1 to see env/parse logs
const verboseEnv = process.env.DEBUG_ENV === "1" || process.env.DEBUG_ENV === "true";

// Load environment variables explicitly (env-loader already ran; this re-applies for override + IDRIVE parsing)
import { config } from "dotenv";
import { resolve } from "path";
import { existsSync, readFileSync } from "fs";

// Function to load secrets from Google Cloud Secrets Manager in production
async function loadSecretsFromGCP(): Promise<void> {
  if (process.env.NODE_ENV === "production") {
    try {
      const { secretsManager } = await import("./services/secretsManager");
      await secretsManager.loadAllSecrets();
      console.log("[Secrets Manager] ✅ Production secrets loaded from Google Cloud");
    } catch (error: any) {
      console.error("[Secrets Manager] ❌ Failed to load secrets from GCP:", error.message);
      console.warn("[Secrets Manager] ⚠️  Falling back to environment variables");
    }
  }
}

// Determine which env file to load
// Default to development if NODE_ENV is not explicitly set to "production"
const isProduction = process.env.NODE_ENV === "production";
const envFile = isProduction ? ".env.production" : ".env.development";

// Ensure NODE_ENV is set correctly for development (use env alias: esbuild define only rewrites `process.env.NODE_ENV` literals)
const _env = process.env;
if (!isProduction && !_env.NODE_ENV) {
  _env.NODE_ENV = "development";
}

const envFilePath = resolve(process.cwd(), envFile);
const envFallbackPath = resolve(process.cwd(), ".env");

if (verboseEnv) {
  console.log("Checking env files:", {
    envFile,
    envFilePath,
    envFileExists: existsSync(envFilePath),
    envFallbackExists: existsSync(envFallbackPath),
    cwd: process.cwd(),
  });
}

// Load the environment file with override to ensure variables are set
// Use override: true to override any existing env vars (in case dotenv-cli set empty values)
const result1 = config({ path: envFilePath, override: true });
// Also try .env as fallback
const result2 = config({ path: envFallbackPath, override: true });

// Always manually parse IDRIVE_E2 variables from file to ensure they're loaded
// This works around dotenv-cli issues where variables might not be parsed correctly
if (existsSync(envFilePath)) {
  try {
    const fileContent = readFileSync(envFilePath, 'utf-8');
    const lines = fileContent.split('\n');
    let parsedCount = 0;
    const parsedVars: string[] = [];
    let idriveLinesFound = 0;
    
    if (verboseEnv) {
      console.log(`[Manual Parse] Reading file: ${envFilePath}`);
      console.log(`[Manual Parse] Total lines in file: ${lines.length}`);
    }
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();
      if (trimmed.includes('IDRIVE_E2')) idriveLinesFound++;
      
      // Skip empty lines and comments
      if (!trimmed || trimmed.startsWith('#')) continue;
      
      // Split on first '=' to handle values that contain '='
      const equalIndex = trimmed.indexOf('=');
      if (equalIndex === -1) continue;
      
      const key = trimmed.substring(0, equalIndex).trim();
      const value = trimmed.substring(equalIndex + 1).trim();
      
      // Parse all IDRIVE_E2 variables and override any existing values
      if (key && key.startsWith('IDRIVE_E2_')) {
        // Remove quotes if present
        const cleanValue = value.replace(/^["']|["']$/g, '');
        if (cleanValue) {
          // Force set the environment variable
          process.env[key] = cleanValue;
          parsedVars.push(key);
          parsedCount++;
          if (verboseEnv) console.log(`[Manual Parse] ✅ Set ${key} = ${cleanValue.substring(0, 10)}...`);
        } else {
          if (verboseEnv) console.log(`[Manual Parse] ⚠️  Skipped ${key} (empty value after cleaning)`);
        }
      }
    }
    
    if (verboseEnv) {
      console.log(`[Manual Parse] Lines containing 'IDRIVE_E2': ${idriveLinesFound}`);
      if (parsedCount > 0) {
        console.log(`✅ Manually parsed ${parsedCount} IDRIVE_E2 variables from file:`, parsedVars.join(', '));
      } else if (idriveLinesFound > 0) {
        console.log(`⚠️  Manual parsing found 0 IDRIVE_E2 variables (${idriveLinesFound} lines contained 'IDRIVE_E2')`);
      }
    }
  } catch (error) {
    console.error("❌ Error manually parsing env file:", error);
  }
} else if (verboseEnv) {
  console.log(`⚠️  Env file does not exist: ${envFilePath}`);
}

if (!isProduction && (!process.env.IDRIVE_E2_ACCESS_KEY_ID || !process.env.IDRIVE_E2_SECRET_ACCESS_KEY)) {
  console.warn("⚠️  Object storage (IDrive E2) not configured. Add IDRIVE_E2_ACCESS_KEY_ID and IDRIVE_E2_SECRET_ACCESS_KEY to .env.development for uploads.");
}

if (verboseEnv) {
  console.log("Environment variable loading:", {
    envFile,
    loadedFromEnvFile: !result1.error,
    loadedFromFallback: !result2.error,
    envFileError: result1.error?.message,
    envFallbackError: result2.error?.message,
    hasAccessKey: !!process.env.IDRIVE_E2_ACCESS_KEY_ID,
    hasSecretKey: !!process.env.IDRIVE_E2_SECRET_ACCESS_KEY,
    endpoint: process.env.IDRIVE_E2_ENDPOINT,
    region: process.env.IDRIVE_E2_REGION,
    accessKeyPreview: process.env.IDRIVE_E2_ACCESS_KEY_ID?.substring(0, 5) || "missing",
    accessKeyValue: process.env.IDRIVE_E2_ACCESS_KEY_ID ? `${process.env.IDRIVE_E2_ACCESS_KEY_ID.substring(0, 10)}...` : "NOT SET",
    secretKeyValue: process.env.IDRIVE_E2_SECRET_ACCESS_KEY ? `${process.env.IDRIVE_E2_SECRET_ACCESS_KEY.substring(0, 10)}...` : "NOT SET",
  });
}

import express, { type Request, Response, NextFunction } from "express";
import compression from "compression";
import rateLimit from "express-rate-limit";
import { createServer } from "http";

const app = express();
const httpServer = createServer(app);

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

app.use(
  express.json({
    limit: '10mb',
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false, limit: '10mb' }));

// Compress responses (gzip) — reduces payload size and improves load times; no frontend change
app.use(compression());

// Rate limit auth endpoints to prevent brute force
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 50, // 50 requests per window per IP
  message: { message: "Too many attempts, please try again later" },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use("/api/auth", authLimiter);
app.use("/api/login", authLimiter);

// Security headers + Content-Security-Policy.
//
// CSP is intentionally permissive on script-src/img-src to keep Stripe, Google
// Maps, Firebase Cloud Messaging, and Resend trackers working without
// rebuilding nonce infra. The strict pieces — frame-ancestors, base-uri,
// form-action, object-src — block the common XSS / clickjacking attack
// surface. Tighten further in a follow-up by switching to a nonce-based CSP
// once Vite SSR/streaming HTML support lands.
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("X-XSS-Protection", "1; mode=block");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin-allow-popups"); // Stripe redirect popups need allow-popups
  res.setHeader("Cross-Origin-Resource-Policy", "same-site");

  // HSTS: 1 year + subdomains + preload-eligible. Only emit in production over HTTPS.
  if (process.env.NODE_ENV === "production") {
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains; preload");
  }

  // CSP — start in report-only mode so we observe violations before enforcing.
  // Flip to "Content-Security-Policy" header (without "-Report-Only" suffix)
  // after a 1-week monitoring window confirms no false positives.
  const csp = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://js.stripe.com https://*.stripe.com https://*.googleapis.com https://maps.gstatic.com https://www.google.com https://www.gstatic.com https://*.firebaseio.com https://*.firebasedatabase.app",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' data: https://fonts.gstatic.com",
    "img-src 'self' data: blob: https: https://*.googleusercontent.com https://*.gstatic.com",
    "media-src 'self' blob: https:",
    // Include https://*.tolstoystaffing.com so API calls to app.* work when the
    // HTML document is served from apex/www (connect-src 'self' is document origin only).
    "connect-src 'self' https://*.tolstoystaffing.com https://api.stripe.com https://r.stripe.com https://*.googleapis.com https://maps.googleapis.com https://*.firebaseio.com https://*.firebasedatabase.app https://*.cloudfunctions.net https://api.resend.com https://api.openai.com https://ipapi.co wss://*.tolstoystaffing.com",
    "frame-src 'self' https://js.stripe.com https://hooks.stripe.com https://*.stripe.com",
    "frame-ancestors 'self'",
    "base-uri 'self'",
    "form-action 'self' https://api.stripe.com",
    "object-src 'none'",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    // Omit upgrade-insecure-requests in *report-only* CSP — Chromium logs that it
    // is ignored here; re-add when switching to enforcing Content-Security-Policy.
  ].join("; ");
  res.setHeader("Content-Security-Policy-Report-Only", csp);

  next();
});

// Permissions-Policy — keep minimal. If DevTools still shows "Unrecognized feature:
// browsing-topics" etc., that text is coming from another layer (often Cloudflare
// Transform Rules / Workers merging a second header), not from this list.
app.use((req, res, next) => {
  // Only include well-supported features that browsers recognize
  // Removed experimental Privacy Sandbox features that cause "unrecognized feature" warnings
  const permissionsPolicy = [
    // Allow well-supported features
    'geolocation=(self)',
    'camera=(self)',
    'microphone=(self)',
    // Note: 'notifications' and 'payment' are not valid Permissions-Policy features
    // Browser notifications are controlled via user permission prompts, not Permissions-Policy
    // Payment API permissions are handled separately by the browser
  ].join(', ');
  
  // Set Permissions-Policy header with only recognized features
  // This prevents browser warnings about unrecognized features
  res.setHeader('Permissions-Policy', permissionsPolicy);
  next();
});

// Apex → app subdomain redirect for app/auth routes.
// Marketing pages (/, /about, /jobs, etc.) and static assets stay on apex.
// Everything else (login, dashboards, chats, onboarding, /api/*) lives on app.*.
const APP_ONLY_PATH_PREFIXES = [
  "/login",
  "/reset-password",
  "/dashboard",
  "/company-dashboard",
  "/post-job",
  "/accepted-job",
  "/chats",
  "/onboarding",
  "/worker-onboarding",
  "/company-onboarding",
  "/affiliate-onboarding",
  "/affiliate-dashboard",
  "/admin",
  "/company/join",
  "/team/join",
  "/team/onboard",
  "/api/", // all API calls go to app.* so cookies + CORS stay coherent
];
const APEX_HOSTS = new Set(["tolstoystaffing.com", "www.tolstoystaffing.com"]);
const APP_HOST = "app.tolstoystaffing.com";
// Endpoints that MUST resolve on either host (no redirect).
//   - webhooks: 308 would drop the signed POST body
//   - public health/status: external monitors and uptime checkers hit apex
//   - one-click unsubscribe: must be reachable from any email-rendering MUA
const APEX_REDIRECT_EXEMPT_PREFIXES = [
  "/api/webhooks/",
  "/api/health",
  "/api/status",
  "/api/email/unsubscribe",
];

// Trust the upstream proxy so X-Forwarded-Host / X-Forwarded-Proto are honored.
// Set HERE (before the apex redirect middleware) rather than inside
// registerRoutes() because the apex redirect runs first; without trust proxy
// active, we'd read the DigitalOcean App Platform internal Host header
// (something like `appplat-...internal`) instead of the user-facing
// `tolstoystaffing.com` and the redirect would silently never fire.
// `1` means trust the FIRST proxy in the chain (Cloudflare → DO → us).
app.set("trust proxy", 1);

app.use((req, res, next) => {
  if (process.env.NODE_ENV !== "production") return next();
  // Prefer X-Forwarded-Host (Cloudflare/DO send the real public host here);
  // fall back to req.hostname (trust-proxy aware) and finally to the raw
  // Host header. .split(":")[0] strips any port.
  const xfh = String(req.headers["x-forwarded-host"] || "").split(",")[0].trim();
  const host = (xfh || req.hostname || String(req.headers.host || ""))
    .toLowerCase()
    .split(":")[0];
  if (!APEX_HOSTS.has(host)) return next();
  const path = req.path;
  if (APEX_REDIRECT_EXEMPT_PREFIXES.some((p) => path === p || path.startsWith(p))) return next();
  const isAppPath = APP_ONLY_PATH_PREFIXES.some(
    (p) => path === p || path.startsWith(p === "/api/" ? p : `${p}/`) || path === p,
  );
  if (!isAppPath) return next();
  const target = `https://${APP_HOST}${req.originalUrl}`;
  return res.redirect(308, target);
});

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

// === Ghost-cookie clearer (TEMPORARY — remove after ~7 days, around 2026-04-25) ===
//
// Background: we recently switched the session cookie from host-only on
// app.tolstoystaffing.com to `Domain=.tolstoystaffing.com`. Browsers do NOT
// delete the old host-only cookie when a new Domain-scoped one with the same
// name is set (RFC 6265 §5.3). The browser then sends BOTH on every request
// in undefined order, and express-session reads whichever happens to come
// first. Result: random session bouncing → 401s on every action.
//
// This middleware emits a Set-Cookie that explicitly deletes the legacy
// host-only `connect.sid` (Max-Age=0, no Domain attribute, exact path match).
// Runs only on document-ish navigations (not /api, not assets) so we don't
// pile this header onto every XHR. After ~7 days everyone's old cookie is
// gone and we can delete this block.
const APP_LIKE_HOSTS = new Set([
  "app.tolstoystaffing.com",
  "tolstoystaffing.com",
  "www.tolstoystaffing.com",
]);
app.use((req, res, next) => {
  if (process.env.NODE_ENV !== "production") return next();
  const host = String(req.headers.host || "").toLowerCase().split(":")[0];
  if (!APP_LIKE_HOSTS.has(host)) return next();
  const p = req.path;
  const isNavigation =
    p === "/" ||
    (!p.startsWith("/api/") &&
      !p.startsWith("/assets/") &&
      !p.includes("." /* extension-bearing requests = static asset */));
  if (!isNavigation) return next();
  // Clear the legacy host-only cookie (no Domain attribute → matches host-only).
  // The new Domain-scoped cookie (`.tolstoystaffing.com`) is unaffected
  // because cookies are keyed by (name, path, domain).
  res.append(
    "Set-Cookie",
    "connect.sid=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax",
  );
  next();
});

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      log(logLine);
    }
  });

  next();
});

// Keep process alive on background-job promise failures; log and continue serving requests.
process.on("unhandledRejection", (reason) => {
  console.error("[Process] Unhandled promise rejection:", reason);
  Sentry.captureException(reason);
});

process.on("uncaughtException", (error) => {
  console.error("[Process] Uncaught exception:", error);
  Sentry.captureException(error);
});

(async () => {
  // Load secrets from GCP in production before starting the server
  await loadSecretsFromGCP();

  // Import DB-dependent modules after secrets are loaded.
  // This prevents startup crashes when DATABASE_URL only exists in GSM.
  const [
    { registerRoutes },
    { registerSeoRoutes },
    { serveStatic },
    { startJobReminderScheduler },
    { startAutoReplenishmentScheduler },
    { startGeolocationWakeupScheduler },
    { startAutoClockOutFromPingsScheduler },
    { startInvoiceReminderScheduler },
    { startAffiliateEmailScheduler },
    { startAutoApprovalScheduler },
    { startChatDigestScheduler },
    { startPaymentFailureReminderScheduler },
  ] = await Promise.all([
    import("./routes"),
    import("./seo"),
    import("./static"),
    import("./job-reminder-scheduler"),
    import("./auto-replenishment-scheduler"),
    import("./schedulers/geolocationWakeup"),
    import("./schedulers/autoClockOutFromPings"),
    import("./invoice-reminder-scheduler"),
    import("./services/affiliate-email-scheduler"),
    import("./auto-approval-scheduler"),
    import("./chat-digest-scheduler"),
    import("./payment-failure-reminder-scheduler"),
  ]);

  registerSeoRoutes(app);
  await registerRoutes(httpServer, app);

  Sentry.setupExpressErrorHandler(app);

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";
    if (res.headersSent) return;
    res.status(status).json({ message });
    // Do not rethrow - it can crash the Node process and cause ERR_CONNECTION_RESET for the client
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || "5000", 10);
  
  // Windows doesn't support reusePort, so we conditionally use it
  // Use 127.0.0.1 explicitly on Windows to avoid IPv6 binding issues
  const listenOptions: any = {
    port,
    host: process.platform === 'win32' ? '127.0.0.1' : '0.0.0.0',
  };
  
  // Only use reusePort on Unix-like systems (not Windows)
  if (process.platform !== 'win32') {
    listenOptions.reusePort = true;
  }
  
  httpServer.listen(
    listenOptions,
    () => {
      log(`serving on port ${port}`);
      // Defer scheduler startup so "serving" appears first; reduces boot noise and perceived delay
      setTimeout(() => {
        const schedulerStarts: Array<{ name: string; start: () => unknown }> = [
          { name: "JobReminder", start: startJobReminderScheduler },
          { name: "AutoReplenish", start: startAutoReplenishmentScheduler },
          { name: "GeolocationWakeup", start: startGeolocationWakeupScheduler },
          { name: "AutoClockOutFromPings", start: startAutoClockOutFromPingsScheduler },
          { name: "InvoiceReminder", start: startInvoiceReminderScheduler },
          { name: "AffiliateEmail", start: startAffiliateEmailScheduler },
          { name: "AutoApproval", start: startAutoApprovalScheduler },
          { name: "ChatDigest", start: startChatDigestScheduler },
          { name: "PaymentFailureEmail", start: startPaymentFailureReminderScheduler },
        ];

        for (const scheduler of schedulerStarts) {
          try {
            const maybePromise = scheduler.start();
            if (maybePromise && typeof (maybePromise as Promise<unknown>).catch === "function") {
              (maybePromise as Promise<unknown>).catch((err) => {
                console.error(`[${scheduler.name}] Failed to start:`, err);
              });
            }
          } catch (err) {
            console.error(`[${scheduler.name}] Failed to start:`, err);
          }
        }
      }, 1500);
    },
  ).on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      log(`❌ Port ${port} is already in use. Please stop the process using this port or use a different port.`, "error");
      log(`💡 To find and kill the process:`, "info");
      if (process.platform === 'win32') {
        log(`   netstat -ano | findstr :${port}`, "info");
        log(`   taskkill /F /PID <PID>`, "info");
      } else {
        log(`   lsof -ti:${port} | xargs kill -9`, "info");
      }
      process.exit(1);
    } else {
      log(`❌ Server error: ${err.message}`, "error");
      throw err;
    }
  });
})();
