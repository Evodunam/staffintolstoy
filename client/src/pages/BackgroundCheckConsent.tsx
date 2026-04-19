import { useEffect, useState } from "react";
import { useRoute } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Loader2, ScanFace, FileText, ShieldCheck, ExternalLink, CheckCircle2, AlertTriangle,
} from "lucide-react";

/**
 * Public, unauthenticated FCRA background-check consent page. Reached via
 * tokenized email link `/background-check-consent/:token`. Token IS the auth.
 *
 * The flow renders three documents in order:
 *   1. Disclosure (standalone, no other terms — FCRA §604(b)(2)(A))
 *   2. Authorization (separate from the disclosure)
 *   3. Summary of Rights link (CFPB-published PDF)
 *
 * The worker must check "I've reviewed the Summary of Rights" + type their
 * legal name to sign. On accept, server creates the canonical
 * background_check_consents row + draft background_check_orders row.
 *
 * The page returns a "create account first" error if the email isn't tied
 * to a worker profile yet — FCRA paper trail requires a real person on file.
 */

interface RequestDetails {
  companyDisplay: string;
  vendor: string;
  packageCode: string | null;
  expiresAt: string;
  disclosureVersion: string;
  disclosureText: string;
  authorizationText: string;
  summaryOfRightsUrl: string;
}

type State = "loading" | "ready" | "signed" | "declined" | "expired" | "cancelled" | "already_signed" | "no_account" | "error";

export default function BackgroundCheckConsent() {
  const [, params] = useRoute("/background-check-consent/:token");
  const token = params?.token || "";

  const [state, setState] = useState<State>("loading");
  const [errorMsg, setErrorMsg] = useState("");
  const [request, setRequest] = useState<RequestDetails | null>(null);
  const [signatureName, setSignatureName] = useState("");
  const [acknowledgedRights, setAcknowledgedRights] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [resultOrderId, setResultOrderId] = useState<number | null>(null);
  const [invitationUrl, setInvitationUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!token) { setState("error"); setErrorMsg("Missing token"); return; }
    (async () => {
      try {
        const res = await fetch(`/api/background-check/request/${token}`);
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
    if (accept) {
      if (!signatureName.trim() || signatureName.trim().length < 3) {
        setErrorMsg("Type your full legal name to sign."); return;
      }
      if (!acknowledgedRights) {
        setErrorMsg("You must acknowledge the Summary of Rights."); return;
      }
    }
    setSubmitting(true); setErrorMsg("");
    try {
      const res = await fetch(`/api/background-check/request/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(accept
          ? { accept: true, signatureName: signatureName.trim(), acknowledgedRights: true }
          : { accept: false }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data?.code === "NO_WORKER_ACCOUNT") { setState("no_account"); return; }
        setErrorMsg(data?.message || `HTTP ${res.status}`); return;
      }
      if (accept) {
        setState("signed");
        setResultOrderId(data.orderId);
        setInvitationUrl(data.invitationUrl ?? null);
      } else { setState("declined"); }
    } catch (e: any) {
      setErrorMsg(e?.message || "Submit failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-background py-10 px-4">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center gap-2 mb-6">
          <ScanFace className="w-6 h-6 text-primary" />
          <h1 className="text-xl font-semibold">Background check consent</h1>
        </div>

        {state === "loading" && <Loader2 className="w-6 h-6 animate-spin" />}

        {state === "expired" && (
          <FlashCard variant="destructive" title="Link expired">
            This consent link has expired. Contact the company that requested it to resend.
          </FlashCard>
        )}

        {state === "cancelled" && (
          <FlashCard title="Cancelled">
            The company has cancelled this background check request. No action needed.
          </FlashCard>
        )}

        {state === "already_signed" && (
          <FlashCard title="Already signed" icon={<CheckCircle2 className="w-5 h-5 text-green-600" />}>
            You've already signed for this request. The company has been notified.
          </FlashCard>
        )}

        {state === "no_account" && (
          <FlashCard variant="warning" title="Create your worker account first" icon={<AlertTriangle className="w-5 h-5 text-amber-600" />}>
            We don't have a worker account on file for this email. Sign up at <a href="https://app.tolstoystaffing.com/login" className="underline">app.tolstoystaffing.com/login</a> using the same email, then re-open this consent link.
          </FlashCard>
        )}

        {state === "error" && (
          <FlashCard variant="destructive" title="Something went wrong">
            {errorMsg || "Please try again or contact support."}
          </FlashCard>
        )}

        {state === "signed" && (
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><CheckCircle2 className="w-5 h-5 text-green-600" /> Consent recorded</CardTitle></CardHeader>
            <CardContent className="text-sm space-y-3">
              <p>Thanks for signing. We've created order <strong>#{resultOrderId}</strong>.</p>
              {invitationUrl ? (
                <>
                  <p>One more step — Checkr needs your SSN, DOB, and address to run the report. <strong>We don't see this info; their hosted form collects it directly.</strong></p>
                  <Button asChild className="gap-1">
                    <a href={invitationUrl} target="_blank" rel="noopener noreferrer">
                      <ExternalLink className="w-3.5 h-3.5" /> Complete Checkr form
                    </a>
                  </Button>
                  <p className="text-xs text-muted-foreground">You can also access this link any time from Account Settings → Background check.</p>
                </>
              ) : (
                <p className="text-xs text-muted-foreground">The vendor will email you if any verification steps need your input. You can monitor status under Account Settings → Background check.</p>
              )}
            </CardContent>
          </Card>
        )}

        {state === "declined" && (
          <Card>
            <CardHeader><CardTitle>Declined</CardTitle></CardHeader>
            <CardContent className="text-sm">
              <p>You've declined this background check request. The company has been notified. No further action needed.</p>
            </CardContent>
          </Card>
        )}

        {state === "ready" && request && (
          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">{request.companyDisplay}</CardTitle>
                <p className="text-xs text-muted-foreground">
                  Vendor: <strong>{request.vendor}</strong>
                  {request.packageCode && <> · Package: <strong>{request.packageCode}</strong></>}
                  <> · Expires {new Date(request.expiresAt).toLocaleDateString()}</>
                </p>
              </CardHeader>
            </Card>

            {/* Disclosure */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2"><FileText className="w-5 h-5" /> Disclosure (v{request.disclosureVersion})</CardTitle>
                <p className="text-xs text-muted-foreground">Standalone document required by FCRA §604(b)(2)(A).</p>
              </CardHeader>
              <CardContent>
                <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed bg-muted/20 p-3 rounded border">
{request.disclosureText}
                </pre>
              </CardContent>
            </Card>

            {/* Authorization */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2"><ShieldCheck className="w-5 h-5" /> Authorization</CardTitle>
                <p className="text-xs text-muted-foreground">Separate document from the disclosure above.</p>
              </CardHeader>
              <CardContent>
                <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed bg-muted/20 p-3 rounded border">
{request.authorizationText}
                </pre>
              </CardContent>
            </Card>

            {/* Sign */}
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base">Sign &amp; consent</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <div className="rounded-lg border border-border p-3 bg-muted/20">
                  <p className="text-sm font-medium mb-1">Required: read your FCRA rights</p>
                  <p className="text-xs text-muted-foreground mb-2">
                    Open the CFPB-published Summary of Your Rights Under the Fair Credit Reporting Act before signing.
                  </p>
                  <Button variant="outline" size="sm" asChild className="gap-1">
                    <a href={request.summaryOfRightsUrl} target="_blank" rel="noopener noreferrer">
                      <ExternalLink className="w-3.5 h-3.5" /> Open Summary of Rights (PDF)
                    </a>
                  </Button>
                </div>

                <label className="flex items-start gap-2 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={acknowledgedRights}
                    onChange={(e) => setAcknowledgedRights(e.target.checked)}
                  />
                  <span>I've reviewed the Summary of Your Rights Under the Fair Credit Reporting Act.</span>
                </label>

                <div>
                  <Label htmlFor="bcc-sig">Type your full legal name to sign</Label>
                  <Input
                    id="bcc-sig"
                    value={signatureName}
                    onChange={(e) => setSignatureName(e.target.value)}
                    placeholder="e.g. Jane M. Doe"
                    disabled={submitting}
                    className="mt-1 font-serif text-lg italic"
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    Your signature is recorded with the timestamp and IP address as part of the FCRA consent record.
                  </p>
                </div>

                {errorMsg && (
                  <FlashCard variant="destructive" title="Error">{errorMsg}</FlashCard>
                )}

                <div className="flex gap-2 pt-2">
                  <Button
                    onClick={() => submit(true)}
                    disabled={submitting || !signatureName.trim() || !acknowledgedRights}
                    className="gap-1"
                  >
                    {submitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                    Sign &amp; consent
                  </Button>
                  <Button variant="outline" onClick={() => submit(false)} disabled={submitting}>
                    Decline
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}

function FlashCard({
  title, children, variant, icon,
}: { title: string; children: React.ReactNode; variant?: "default" | "destructive" | "warning"; icon?: React.ReactNode }) {
  const cls = variant === "destructive"
    ? "border-destructive bg-destructive/10"
    : variant === "warning"
      ? "border-amber-300 bg-amber-50 dark:bg-amber-950/30"
      : "border-border bg-muted/30";
  return (
    <div className={`rounded-lg border p-4 ${cls}`}>
      <div className="flex items-start gap-2">
        {icon}
        <div>
          <p className="font-medium mb-1">{title}</p>
          <div className="text-sm">{children}</div>
        </div>
      </div>
    </div>
  );
}
