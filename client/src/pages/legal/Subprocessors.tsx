import { useState, useEffect } from "react";
import { Link } from "wouter";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { CheckCircle2, MailCheck, Loader2 } from "lucide-react";

interface Subprocessor {
  name: string;
  purpose: string;
  dataTypes: string;
  location: string;
  url: string;
}

// Reviewed and updated quarterly. Material changes (adding a new subprocessor or
// expanding scope of data shared) trigger a 30-day notice to enterprise customers
// per most MSAs. Keep the changelog at the bottom of this file accurate.
const SUBPROCESSORS: Subprocessor[] = [
  { name: "Stripe, Inc.", purpose: "Payment processing, identity verification, card-on-file storage", dataTypes: "Name, billing address, payment card data, identity-verification results", location: "United States", url: "https://stripe.com/legal/privacy-center" },
  { name: "Mercury (Choice Financial Group)", purpose: "ACH disbursements to workers, escrow holding accounts", dataTypes: "Worker name, address, bank routing/account number (tokenized), payment amounts", location: "United States", url: "https://mercury.com/legal/privacy-policy" },
  { name: "Resend, Inc.", purpose: "Transactional email delivery", dataTypes: "Recipient email address, message content, delivery metadata", location: "United States", url: "https://resend.com/legal/privacy-policy" },
  { name: "Google Cloud Platform", purpose: "Application hosting (Secret Manager), Maps & Geocoding APIs, Translate API, Firebase Cloud Messaging", dataTypes: "Server logs, geocoded addresses, push-notification tokens, secrets", location: "United States", url: "https://cloud.google.com/terms/data-processing-addendum" },
  { name: "DigitalOcean, LLC", purpose: "Application hosting (App Platform)", dataTypes: "All application data (data-at-rest)", location: "United States", url: "https://www.digitalocean.com/legal/privacy-policy" },
  { name: "Neon, Inc.", purpose: "Managed Postgres database (primary data store)", dataTypes: "All operational data: profiles, jobs, timesheets, messages, transactions", location: "United States (AWS)", url: "https://neon.tech/privacy-policy" },
  { name: "IDrive Inc. (IDrive E2)", purpose: "S3-compatible object storage for uploaded media (job photos, ID documents, certificates of insurance)", dataTypes: "User-uploaded files including photos and PDFs", location: "United States", url: "https://www.idrive.com/idrive/privacy-policy" },
  { name: "OpenAI, L.L.C.", purpose: "AI-assisted job-scope estimation, EEOC linting, content moderation", dataTypes: "Job descriptions and titles (no PII intentionally sent)", location: "United States", url: "https://openai.com/policies/privacy-policy" },
  { name: "Apple Inc. (APNS)", purpose: "iOS push notification delivery", dataTypes: "Device push tokens, notification payloads", location: "United States", url: "https://www.apple.com/legal/privacy/" },
  { name: "Sentry (Functional Software, Inc.)", purpose: "Application error monitoring", dataTypes: "Stack traces, request metadata (PII redacted before send)", location: "United States", url: "https://sentry.io/legal/privacy/" },
  { name: "ipapi.co", purpose: "IP-based coarse geolocation fallback", dataTypes: "IP address only (no account data)", location: "United States", url: "https://ipapi.co/privacy/" },
];

export default function Subprocessors() {
  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-4xl mx-auto px-4 py-12">
        <Link href="/legal" className="text-sm text-primary hover:underline">← Back to Legal</Link>
        <h1 className="text-3xl font-bold mt-3 mb-2">Subprocessors</h1>
        <p className="text-sm text-muted-foreground mb-6">Last updated: {new Date().toLocaleDateString("en-US", { dateStyle: "long" })}</p>

        <p className="mb-6 text-sm leading-relaxed">
          Tolstoy Staffing engages the third-party service providers ("subprocessors") listed
          below to process personal data in connection with delivering the platform. Each
          subprocessor is bound by a written contract that includes appropriate data-protection
          obligations consistent with our{" "}
          <Link href="/privacy" className="text-primary underline">Privacy Policy</Link> and our
          customer Data Processing Addendum.
        </p>

        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40">
              <tr>
                <th className="text-left p-3 font-semibold">Subprocessor</th>
                <th className="text-left p-3 font-semibold">Purpose</th>
                <th className="text-left p-3 font-semibold">Data shared</th>
                <th className="text-left p-3 font-semibold">Location</th>
              </tr>
            </thead>
            <tbody>
              {SUBPROCESSORS.map((s) => (
                <tr key={s.name} className="border-t border-border align-top">
                  <td className="p-3">
                    <a href={s.url} target="_blank" rel="noopener noreferrer" className="font-medium text-primary hover:underline">
                      {s.name}
                    </a>
                  </td>
                  <td className="p-3">{s.purpose}</td>
                  <td className="p-3 text-muted-foreground">{s.dataTypes}</td>
                  <td className="p-3 text-muted-foreground">{s.location}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <h2 className="text-xl font-semibold mt-10 mb-3">Subprocessor change notifications</h2>
        <p className="text-sm leading-relaxed mb-4">
          We will provide at least 30 days' notice before adding a new subprocessor that
          will process customer personal data. Customers may object during the notice
          period; if we can't resolve the objection, you may terminate the affected
          services for cause.
        </p>
        <SubscribeForm />
        <p className="text-xs text-muted-foreground mt-2">
          Or email <a className="text-primary underline" href="mailto:legal@tolstoystaffing.com">legal@tolstoystaffing.com</a> for enterprise DPA-style notice.
        </p>

        <h2 className="text-xl font-semibold mt-10 mb-3">Changelog</h2>
        <ul className="text-sm space-y-1 text-muted-foreground">
          <li>{new Date().toLocaleDateString("en-US", { dateStyle: "long" })} — Initial publication.</li>
        </ul>
      </div>
    </div>
  );
}

/**
 * Double opt-in subscribe form. Shows a "check your inbox" confirmation
 * after submit; if the user already confirmed, says so and short-circuits.
 * Reads ?subscribed=1 from the URL on mount to show a one-time success
 * banner after click-through confirmation.
 */
function SubscribeForm() {
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [state, setState] = useState<"idle" | "pending" | "already" | "confirmed" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      if (params.get("subscribed") === "1") {
        setState("confirmed");
        // Strip the param so a refresh doesn't re-show the banner.
        window.history.replaceState({}, "", window.location.pathname);
      }
    }
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg("");
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { setErrorMsg("Invalid email"); return; }
    setSubmitting(true);
    try {
      const res = await fetch("/api/subprocessors/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, source: "subprocessor_page" }),
      });
      const data = await res.json();
      if (!res.ok) { setState("error"); setErrorMsg(data?.message || "Failed"); return; }
      setState(data.alreadyConfirmed ? "already" : "pending");
      setEmail("");
    } catch (err: any) {
      setState("error"); setErrorMsg(err?.message || "Network error");
    } finally {
      setSubmitting(false);
    }
  };

  if (state === "confirmed") {
    return (
      <div className="rounded-lg border border-green-300 bg-green-50 dark:bg-green-950/30 p-3 flex items-center gap-2 text-sm">
        <CheckCircle2 className="w-4 h-4 text-green-600" />
        Subscription confirmed. We'll email you 30 days before any subprocessor change.
      </div>
    );
  }
  if (state === "pending") {
    return (
      <div className="rounded-lg border border-blue-300 bg-blue-50 dark:bg-blue-950/30 p-3 flex items-center gap-2 text-sm">
        <MailCheck className="w-4 h-4 text-blue-600" />
        Check your inbox — click the confirmation link to finish subscribing.
      </div>
    );
  }
  if (state === "already") {
    return <p className="text-sm text-muted-foreground">You're already subscribed.</p>;
  }

  return (
    <form onSubmit={submit} className="flex gap-2 max-w-md">
      <Input
        type="email"
        placeholder="you@company.com"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        required
        disabled={submitting}
      />
      <Button type="submit" disabled={submitting} className="gap-1">
        {submitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
        Subscribe
      </Button>
      {errorMsg && <span className="text-xs text-destructive self-center">{errorMsg}</span>}
    </form>
  );
}
