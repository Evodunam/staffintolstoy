import { type Express } from "express";
import { createServer as createViteServer, createLogger } from "vite";
import { type Server } from "http";
import viteConfig from "../vite.config";
import fs from "fs";
import path from "path";
import { nanoid } from "nanoid";

const viteLogger = createLogger();

const SUPPRESSED_WARN_PATTERNS = [
  'WebSocket',
  'HMR',
  'failed to connect',
  'PostCSS plugin did not pass',
  'from option to postcss.parse',
  'postcss.parse',
  'deoptimised',
  'exceeds the max of 500KB',
];

function shouldSuppressWarn(msg: unknown): boolean {
  const s = typeof msg === 'string' ? msg : String(msg ?? '');
  return SUPPRESSED_WARN_PATTERNS.some((p) => s.includes(p));
}

/** Patch console.warn so PostCSS "from option" (and similar) warnings are suppressed. */
function patchConsoleWarn(): () => void {
  const original = console.warn;
  console.warn = (...args: unknown[]) => {
    const msg = args[0] != null ? String(args[0]) : '';
    if (shouldSuppressWarn(msg)) return;
    original.apply(console, args);
  };
  return () => {
    console.warn = original;
  };
}

export async function setupVite(server: Server, app: Express) {
  // Suppress PostCSS "from option" etc. at process level (Vite may use different logger in pipeline)
  patchConsoleWarn();

  // Use the same port as the main server (defaults to 5000)
  const port = parseInt(process.env.PORT || "5000", 10);
  
  const serverOptions = {
    middlewareMode: true,
    hmr: { 
      server,
      path: "/vite-hmr",
      port: port,
      clientPort: port,
      // Don't specify host - let it use the request hostname (works with subdomains)
      // Disable HMR if it's causing refresh loops
      ...(process.env.DISABLE_HMR === 'true' ? { client: { overlay: false, reconnect: false } } : {}),
    },
    // Allow localhost hosts
    allowedHosts: [
      "localhost",
      "127.0.0.1",
      /^localhost(:\d+)?$/, // localhost with optional port
    ],
  };

  const vite = await createViteServer({
    ...viteConfig,
    configFile: false,
    server: serverOptions as import("vite").InlineConfig["server"],
    customLogger: {
      ...viteLogger,
      error: (msg, options) => {
        // Only log actual errors, not HMR connection warnings
        if (!msg.includes('WebSocket') && !msg.includes('HMR')) {
          viteLogger.error(msg, options);
          process.exit(1);
        }
      },
      warn: (msg, options) => {
        if (shouldSuppressWarn(msg)) return;
        viteLogger.warn(msg, options);
      },
      warnOnce: (msg, options) => {
        // PostCSS "from option" and similar warnings use warnOnce
        if (shouldSuppressWarn(msg)) return;
        viteLogger.warnOnce(msg, options);
      },
    },
    appType: "custom",
  });

  // Only use Vite middleware for non-API routes
  app.use((req, res, next) => {
    if (req.path.startsWith("/api/")) {
      return next(); // Skip Vite middleware for API routes
    }
    vite.middlewares(req, res, next);
  });

  app.use("*", async (req, res, next) => {
    const url = req.originalUrl;

    // Skip API routes - they should be handled by registerRoutes
    if (url.startsWith("/api/")) {
      return next();
    }

    try {
      const clientTemplate = path.resolve(
        import.meta.dirname,
        "..",
        "client",
        "index.html",
      );

      // always reload the index.html file from disk incase it changes
      let template = await fs.promises.readFile(clientTemplate, "utf-8");
      template = template.replace(
        `src="/src/main.tsx"`,
        `src="/src/main.tsx?v=${nanoid()}"`,
      );
      const page = await vite.transformIndexHtml(url, template);
      res.status(200).set({ "Content-Type": "text/html" }).end(page);
    } catch (e) {
      vite.ssrFixStacktrace(e as Error);
      next(e);
    }
  });
}
