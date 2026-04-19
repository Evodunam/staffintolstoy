import { useEffect, useState } from "react";
import { useRoute } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Loader2, Shield, CheckCircle2, AlertTriangle, FlaskConical } from "lucide-react";

/**
 * Public, unauthenticated drug-screen consent page. Reached via tokenized
 * email link `/drug-screen-consent/:token`. The token IS the auth — no
 * login required.
 *
 * Renders the disclosure text returned by the server (state-aware), then
 * collects a typed legal-name signature. On submit we either accept (creates
 * the order at the vendor) or decline (cancels the request). Both outcomes
 * are recorded with timestamp + IP server-side.
 */

interface ConsentRequest {
  panel: string;
  workplaceState: string | null;
  companyDisplay: string;
  expiresAt: string;
  disclosure: string[];
}

export default function DrugScreenConsent() {
  const [, params] = useRoute("/drug-screen-consent/:token");
  const token = params?.token || "";

  const [state, setState] = useState<"loading" | "ready" | "signed" | "declined" | "expired" | "cancelled" | "already_signed" | "error">("loading");
  const [errorMsg, setErrorMsg] = useState("");
  const [request, setRequest] = useState<ConsentRequest | null>(null);
  const [signatureName, setSignatureName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [resultOrderId, setResultOrderId] = useState<number | null>(null);
  const [schedulingUrl, setSchedulingUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!token) { setState("error"); setErrorMsg("Missing token"); return; }
    (async () => {
      try {
        const res = await fetch(`/api/drug-screens/consent/${token}`);
        const data = await res.json();
        if (res.status === 410) { setState(data.state === "expired" ? "expired" : "cancelled"); return; }
        if (res.status === 409) { setState("already_signed"); return; }
        if (!res.ok) { setState("error"); setErrorMsg(data.message || `HTTP ${res.status}`); return; }
        setRequest(data);
        setState("ready");
      } catch (e: any) {
        setState("error"); setErrorMsg(e?.message || "Network error");
      }
    })();
  }, [token]);

  const submit = async (accept: boolean) => {
    if (accept && (!signatureName.trim() || signatureName.trim().length < 3)) {
      setErrorMsg("Type your full legal name to sign."); return;
    }
    setSubmitting(true); setErrorMsg("");
    try {
      const res = await fetch(`/api/drug-screens/consent/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(accept ? { accept: true, signatureName: signatureName.trim() } : { accept: false }),
      });
      const data = await res.json();
      if (!res.ok) { setErrorMsg(data?.message || `HTTP ${res.status}`); return; }
      if (accept) {
        setState("signed");
        setResultOrderId(data.orderId);
        setSchedulingUrl(data.schedulingUrl);
      } else {
        setState("declined");
      }
    } catch (e: any) {
      setErrorMsg(e?.message || "Submit failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-background py-10 px-4">
      <div className="max-w-2xl mx-auto">
        <div className="flex items-center gap-2 mb-6">
          <FlaskConical className="w-6 h-6 text-primary" />
          <h1 className="text-xl font-semibold">Drug screen consent</h1>
        </div>

        {state === "loading" && <Loader2 className="w-6 h-6 animate-spin" />}

        {state === "expired" && (
          <Alert variant="destructive">
            <AlertTitle>Link expired</AlertTitle>
            <AlertDescription>This consent link has expired. Contact the company that requested it to resend.</AlertDescription>
          </Alert>
        )}

        {state === "cancelled" && (
          <Alert>
            <AlertTitle>Cancelled</AlertTitle>
            <AlertDescription>The company has cancelled this drug screen request. No action needed.</AlertDescription>
          </Alert>
        )}

        {state === "already_signed" && (
          <Alert>
            <CheckCircle2 className="h-4 w-4" />
            <AlertTitle>Already signed</AlertTitle>
            <AlertDescription>You've already submitted consent for this request. Check your email for the scheduling link.</AlertDescription>
          </Alert>
        )}

        {state === "error" && (
          <Alert variant="destructive">
            <AlertTitle>Something went wrong</AlertTitle>
            <AlertDescription>{errorMsg || "Please try again or contact support."}</AlertDescription>
          </Alert>
        )}

        {state === "signed" && (
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><CheckCircle2 className="w-5 h-5 text-green-600" /> Consent recorded</CardTitle></CardHeader>
            <CardContent className="space-y-3 text-sm">
              <p>Thanks for signing. We've created order <strong>#{resultOrderId}</strong> with the testing lab.</p>
              {schedulingUrl ? (
                <>
                  <p>Schedule your collection appointment now:</p>
                  <Button asChild><a href={schedulingUrl} target="_blank" rel="noopener noreferrer">Schedule appointment</a></Button>
                </>
              ) : (
                <p>The lab will email you scheduling instructions within 1 business day.</p>
              )}
            </CardContent>
          </Card>
        )}

        {state === "declined" && (
          <Card>
            <CardHeader><CardTitle>Declined</CardTitle></CardHeader>
            <CardContent className="text-sm">
              <p>You've declined this drug screen request. The company has been notified. No further action needed.</p>
            </CardContent>
          </Card>
        )}

        {state === "ready" && request && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{request.companyDisplay}</CardTitle>
              <p className="text-xs text-muted-foreground">
                Test panel: <strong>{request.panel.replace(/_/g, " ")}</strong>
                {request.workplaceState && <> · Workplace: <strong>{request.workplaceState}</strong></>}
                <> · Expires {new Date(request.expiresAt).toLocaleDateString()}</>
              </p>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Disclosure */}
              <section>
                <h3 className="text-sm font-semibold flex items-center gap-2 mb-2"><Shield className="w-4 h-4" /> Disclosure</h3>
                <ul className="text-sm space-y-2 list-disc ml-5">
                  {request.disclosure.map((line, i) => <li key={i}>{line}</li>)}
                </ul>
              </section>

              <div className="border-t border-border pt-4">
                <Label htmlFor="sig">Type your full legal name to sign</Label>
                <Input
                  id="sig"
                  value={signatureName}
                  onChange={(e) => setSignatureName(e.target.value)}
                  placeholder="e.g. Jane M. Doe"
                  disabled={submitting}
                  className="mt-1 font-serif text-lg italic"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Your signature is recorded with the timestamp and IP address shown above.
                </p>
              </div>

              {errorMsg && (
                <Alert variant="destructive">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertDescription>{errorMsg}</AlertDescription>
                </Alert>
              )}

              <div className="flex gap-2 pt-2">
                <Button onClick={() => submit(true)} disabled={submitting || !signatureName.trim()} className="gap-1">
                  {submitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  Sign &amp; consent
                </Button>
                <Button variant="outline" onClick={() => submit(false)} disabled={submitting}>
                  Decline
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
