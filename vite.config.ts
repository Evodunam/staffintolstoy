import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

const gitCommitSha =
  process.env.VITE_GIT_COMMIT_SHA ||
  process.env.GIT_COMMIT_SHA ||
  process.env.GITHUB_SHA ||
  process.env.SOURCE_VERSION ||
  "";

export default defineConfig({
  plugins: [
    react(),
  ],
  esbuild: {
    logOverride: { "this-is-undefined-in-esm": "silent" },
    target: "es2020",
  },
  define: {
    "import.meta.env.VITE_GIT_COMMIT_SHA": JSON.stringify(gitCommitSha),
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@assets": path.resolve(import.meta.dirname, "attached_assets"),
      "react": path.resolve(import.meta.dirname, "node_modules/react"),
      "react-dom": path.resolve(import.meta.dirname, "node_modules/react-dom"),
      "@capacitor/core": path.resolve(import.meta.dirname, "client", "src", "lib", "capacitor-stub.ts"),
      "@capacitor/geolocation": path.resolve(import.meta.dirname, "client", "src", "lib", "geolocation-stub.ts"),
    },
    dedupe: ["react", "react-dom"],
  },
  root: path.resolve(import.meta.dirname, "client"),
  cacheDir: path.resolve(import.meta.dirname, "node_modules", ".vite"),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
    commonjsOptions: {
      include: [/node_modules/],
      transformMixedEsModules: true,
    },
  },
  server: {
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
    hmr: {
      protocol: "ws",
      // Port will be set by server/vite.ts based on PORT env var (defaults to 5000)
      // This config is overridden in middleware mode, but keeping for reference
      port: parseInt(process.env.PORT || "5000", 10),
      clientPort: parseInt(process.env.PORT || "5000", 10),
      path: "/vite-hmr",
      overlay: false,
    },
  },
  logLevel: "warn",
  clearScreen: false,
  optimizeDeps: {
    include: ["react", "react-dom"],
    exclude: ["@capacitor/core", "@capacitor/geolocation"],
    force: false,
  },
});
