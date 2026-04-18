import express, { type Express, type Request, type Response, type NextFunction } from "express";
import fs from "fs";
import path from "path";

export function serveStatic(app: Express) {
  const distPath = path.resolve(__dirname, "public");
  if (!fs.existsSync(distPath)) {
    throw new Error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`,
    );
  }

  // Some browsers still request /favicon.ico by default.
  // Serve the existing SVG favicon to avoid noisy failed favicon requests.
  app.get("/favicon.ico", (_req, res) => {
    res.sendFile(path.resolve(distPath, "favicon.svg"));
  });

  // Hashed build assets (Vite emits them under /assets with a content hash in
  // the filename) can be cached forever. Everything else gets a short cache
  // so a re-deploy is picked up quickly.
  app.use(
    express.static(distPath, {
      index: false, // index.html served explicitly below so we control its headers
      setHeaders: (res, filePath) => {
        if (/\\assets\\|\/assets\//.test(filePath)) {
          res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        } else if (filePath.endsWith("index.html")) {
          // Never cache the HTML shell — it pins the JS/CSS bundle hashes.
          res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
        } else {
          res.setHeader("Cache-Control", "public, max-age=300");
        }
      },
    }),
  );

  // SPA fallback. Critical: do NOT fall through to index.html for asset
  // requests, API calls, or anything that looks like a real file — otherwise
  // a missing /assets/index-XYZ.js gets served as text/html and the browser
  // rejects it with a strict-MIME error (blank screen).
  app.use("*", (req: Request, res: Response, next: NextFunction) => {
    const url = req.originalUrl.split("?")[0];

    // Let API/socket/auth routes 404 normally if they fell through.
    if (
      url.startsWith("/api/") ||
      url.startsWith("/socket.io") ||
      url.startsWith("/ws")
    ) {
      return next();
    }

    // If the request looks like a static file (has an extension), don't
    // pretend it exists — return a real 404. Browsers will then surface a
    // useful network error instead of a misleading MIME failure.
    if (/\.[a-zA-Z0-9]+$/.test(url)) {
      return res.status(404).type("text/plain").send("Not found");
    }

    // Real SPA route — send the HTML shell with no-cache so re-deploys are
    // picked up on the next navigation.
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    res.sendFile(path.resolve(distPath, "index.html"));
  });
}
