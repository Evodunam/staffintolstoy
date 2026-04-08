// Load env before any other server code (so db.ts sees DATABASE_URL)
import "./env-loader";

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

// Ensure NODE_ENV is set correctly for development
if (!isProduction && !process.env.NODE_ENV) {
  process.env.NODE_ENV = "development";
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
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";
import { startJobReminderScheduler } from "./job-reminder-scheduler";
import { startAutoReplenishmentScheduler } from "./auto-replenishment-scheduler";
import { startGeolocationWakeupScheduler } from "./schedulers/geolocationWakeup";
import { startAutoClockOutFromPingsScheduler } from "./schedulers/autoClockOutFromPings";
import { startInvoiceReminderScheduler } from "./invoice-reminder-scheduler";
import { startAffiliateEmailScheduler } from "./services/affiliate-email-scheduler";
import { startAutoApprovalScheduler } from "./auto-approval-scheduler";
import { startChatDigestScheduler } from "./chat-digest-scheduler";
import { startPaymentFailureReminderScheduler } from "./payment-failure-reminder-scheduler";

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

// Security headers
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("X-XSS-Protection", "1; mode=block");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  next();
});

// Set proper Permissions-Policy header to avoid browser warnings
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

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

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

(async () => {
  // Load secrets from GCP in production before starting the server
  await loadSecretsFromGCP();
  
  await registerRoutes(httpServer, app);

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
        startJobReminderScheduler();
        startAutoReplenishmentScheduler();
        startGeolocationWakeupScheduler();
        startAutoClockOutFromPingsScheduler();
        startInvoiceReminderScheduler();
        startAffiliateEmailScheduler();
        startAutoApprovalScheduler();
        startChatDigestScheduler();
        startPaymentFailureReminderScheduler();
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
