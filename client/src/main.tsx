import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

// Sentry must initialize before any other module so it can hook React + fetch.
import { initClientSentry } from "./lib/sentry";
initClientSentry();

// In dev only: log axe-core accessibility violations to the console after mount.
// Catches missing alt text, low-contrast pairs, missing form labels, ARIA misuse, etc.
// Production gets the same audit by running `npm run build && npx @axe-core/cli` in CI.
if (import.meta.env.DEV) {
  import("@axe-core/react").then((axe) => {
    import("react").then(async (React) => {
      const ReactDOM = await import("react-dom");
      axe.default(React.default, ReactDOM.default, 1000);
    });
  });
}

// Ensure Stripe load params (e.g. advancedFraudSignals: false) run before any Stripe script loads
import "./lib/stripe";

// Suppress noisy r.stripe.com CORS/fetch errors from Stripe's script (we cannot fix CORS on Stripe's server)
window.addEventListener("unhandledrejection", (event) => {
  const msg = event?.reason?.message ?? "";
  if (typeof msg === "string" && msg.includes("r.stripe.com")) {
    event.preventDefault();
    event.stopPropagation();
  }
});

createRoot(document.getElementById("root")!).render(<App />);
