import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

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
