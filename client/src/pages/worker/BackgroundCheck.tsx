import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import {
  ArrowLeft, ScanFace, FileText, ShieldCheck, CheckCircle2, Loader2, ExternalLink, AlertTriangle,
} from "lucide-react";

/**
 * Worker-facing background check page. Mounted at /account/background-check.
 *
 * Three states:
 *   1. No consent on file → show full disclosure → authorization → signature box.
 *      On submit, POST /api/background-check/consent.
 *   2. Consent on file but disclosure version has bumped → show "re-consent required"
 *      banner + the same flow with the new disclosure text.
 *   3. Consent current → show signed-on date + history of orders.
 *
 * The disclosure + authorization texts come from the server so both the
 * worker UI and the legal record-of-disclosure stay in sync.
 */

interface DisclosureResponse {
  version: string;
  disclosureText: string;
  authorizationText: string;
  summaryOfRightsUrl: string;
  note: string;
}

interface ConsentStatus {
  hasConsent: boolean;
  currentVersion: string;
  isCurrent: boolean;
  signedAt: string | null;
  signedVersion: string | null;
  signatureName: string | null;
}

interface BackgroundCheckOrder {
  id: number;
  vendor: string;
  packageCode: string | null;
  status: string;
  result: string | null;
  reportUrl: string | null;
  orderedAt: string | null;
  completedAt: string | null;
  adverseActionPreNoticeSentAt: string | null;
  adverseActionFinalNoticeSentAt: string | null;
  createdAt: string;
}

export default function WorkerBackgroundCheck() {
  const [, setLocation] = useLocation();

  const { data: status, isLoading: statusLoading } = useQuery<ConsentStatus>({
    queryKey: ["/api/background-check/consent/status"],
    queryFn: async () => {
      const res = await fetch("/api/background-check/consent/status", { credentials: "include" });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  const { data: disclosure } = useQuery<DisclosureResponse>({
    queryKey: ["/api/background-check/disclosure"],
    queryFn: async () => {
      const res = await fetch("/api/background-check/disclosure", { credentials: "include" });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  const { data: orders } = useQuery<BackgroundCheckOrder[]>({
    queryKey: ["/api/worker/background-checks"],
    queryFn: async () => {
      const res = await fetch("/api/worker/background-checks", { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
  });

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-40 bg-background border-b border-border">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => setLocation("/dashboard/settings/account")}>
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div>
            <h1 className="text-lg font-semibold flex items-center gap-2"><ScanFace className="w-5 h-5" /> Background check</h1>
            <p className="text-xs text-muted-foreground">FCRA disclosure, authorization, and order history.</p>
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-6 space-y-4">
        {statusLoading || !status ? <Loader2 className="w-5 h-5 animate-spin" /> : (
          <>
            {/* Consent status */}
            <ConsentSection status={status} disclosure={disclosure} />

            {/* Order history */}
            <OrdersSection orders={orders ?? []} />
          </>
        )}
      </main>
    </div>
  );
}

function ConsentSection({ status, disclosure }: { status: ConsentStatus; disclosure: DisclosureResponse | undefined }) {
  if (status.hasConsent && status.isCurrent) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2 text-green-700 dark:text-green-400">
            <CheckCircle2 className="w-5 h-5" /> Consent on file
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p>
            You signed the FCRA disclosure as <strong>{status.signatureName}</strong> on{" "}
            <strong>{status.signedAt ? new Date(status.signedAt).toLocaleDateString() : "—"}</strong>{" "}
            (version {status.signedVersion}).
          </p>
          <p className="text-xs text-muted-foreground">
            Companies you apply to may now order a background check on you. To revoke, email{" "}
            <a href="mailto:support@tolstoystaffing.com" className="underline">support@tolstoystaffing.com</a>.
          </p>
        </CardContent>
      </Card>
    );
  }

  if (status.hasConsent && !status.isCurrent) {
    return (
      <>
        <div className="rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/30 p-3 text-sm flex gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
          <div>
            <p className="font-medium text-amber-900 dark:text-amber-200">Re-consent required</p>
            <p className="text-xs text-amber-900/80 dark:text-amber-200/80">
              You signed version <strong>{status.signedVersion}</strong> on{" "}
              {status.signedAt && new Date(status.signedAt).toLocaleDateString()}. The disclosure has been updated to{" "}
              <strong>{status.currentVersion}</strong>. Re-sign below to keep your background-check eligibility.
            </p>
          </div>
        </div>
        {disclosure && <DisclosureForm disclosure={disclosure} />}
      </>
    );
  }

  return disclosure ? <DisclosureForm disclosure={disclosure} /> : <Loader2 className="w-5 h-5 animate-spin" />;
}

function DisclosureForm({ disclosure }: { disclosure: DisclosureResponse }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [signatureName, setSignatureName] = useState("");
  const [acknowledgedRights, setAcknowledgedRights] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (!signatureName.trim() || signatureName.trim().length < 3) {
      toast({ title: "Type your full legal name", variant: "destructive" }); return;
    }
    if (!acknowledgedRights) {
      toast({ title: "You must acknowledge the Summary of Rights", variant: "destructive" }); return;
    }
    try {
      setSubmitting(true);
      await apiRequest("POST", "/api/background-check/consent", { signatureName: signatureName.trim() });
      toast({ title: "Consent recorded", description: "Companies can now order a background check." });
      qc.invalidateQueries({ queryKey: ["/api/background-check/consent/status"] });
      qc.invalidateQueries({ queryKey: ["/api/worker/background-checks"] });
    } catch (e: any) {
      toast({ title: "Failed", description: e.message ?? "", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      {/* Disclosure (standalone document per FCRA §604(b)(2)(A)) */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2"><FileText className="w-5 h-5" /> Disclosure</CardTitle>
          <p className="text-xs text-muted-foreground">Version {disclosure.version}. Standalone document required by FCRA §604(b)(2)(A).</p>
        </CardHeader>
        <CardContent>
          <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed bg-muted/20 p-3 rounded border">
{disclosure.disclosureText}
          </pre>
        </CardContent>
      </Card>

      {/* Authorization (separate document per FCRA) */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2"><ShieldCheck className="w-5 h-5" /> Authorization</CardTitle>
          <p className="text-xs text-muted-foreground">Separate document. Sign below to authorize.</p>
        </CardHeader>
        <CardContent>
          <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed bg-muted/20 p-3 rounded border">
{disclosure.authorizationText}
          </pre>
        </CardContent>
      </Card>

      {/* Summary of Rights link + signature */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Sign &amp; consent</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="rounded-lg border border-border p-3 bg-muted/20">
            <p className="text-sm font-medium mb-1">Required: read your FCRA rights</p>
            <p className="text-xs text-muted-foreground mb-2">
              The Consumer Financial Protection Bureau publishes a "Summary of Your Rights Under the Fair Credit Reporting Act"
              that you must have access to before signing.
            </p>
            <Button variant="outline" size="sm" asChild className="gap-1">
              <a href={disclosure.summaryOfRightsUrl} target="_blank" rel="noopener noreferrer">
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
            <Label htmlFor="bg-sig">Type your full legal name to sign</Label>
            <Input
              id="bg-sig"
              value={signatureName}
              onChange={(e) => setSignatureName(e.target.value)}
              placeholder="e.g. Jane M. Doe"
              className="mt-1 font-serif text-lg italic"
            />
            <p className="text-xs text-muted-foreground mt-1">
              Your signature is recorded with the timestamp and IP address as part of the FCRA consent record.
            </p>
          </div>

          <Button onClick={submit} disabled={submitting || !signatureName.trim() || !acknowledgedRights} className="gap-1">
            {submitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            Sign &amp; consent
          </Button>
        </CardContent>
      </Card>
    </>
  );
}

function OrdersSection({ orders }: { orders: BackgroundCheckOrder[] }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Order history</CardTitle>
        <p className="text-xs text-muted-foreground">Background checks ordered by companies you've worked with.</p>
      </CardHeader>
      <CardContent className="space-y-2">
        {orders.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">No background checks ordered yet.</p>
        ) : orders.map((o) => (
          <div key={o.id} className="border border-border rounded-lg p-3">
            <div className="flex items-baseline gap-2 flex-wrap mb-1">
              <span className="font-medium text-sm">{o.vendor}</span>
              {o.packageCode && <Badge variant="outline">{o.packageCode}</Badge>}
              <BgStatusBadge status={o.status} result={o.result} />
            </div>
            <p className="text-xs text-muted-foreground">
              Ordered {o.orderedAt ? new Date(o.orderedAt).toLocaleDateString() : new Date(o.createdAt).toLocaleDateString()}
              {o.completedAt && ` · Completed ${new Date(o.completedAt).toLocaleDateString()}`}
            </p>
            {/* Action-required: Checkr invitation pending — worker needs to complete the vendor's hosted form */}
            {o.status === "ordered" && o.reportUrl && o.reportUrl.includes("invitations") && (
              <div className="mt-2 rounded bg-blue-50 dark:bg-blue-950/30 border border-blue-300 p-2 text-xs">
                <p className="font-medium text-blue-900 dark:text-blue-200">Action required</p>
                <p className="text-blue-900/80 dark:text-blue-200/80 mb-2">
                  Checkr needs additional info from you (SSN, DOB, address) to run the report. Their hosted form
                  collects this directly — we don't see it.
                </p>
                <Button size="sm" asChild>
                  <a href={o.reportUrl} target="_blank" rel="noopener noreferrer" className="gap-1">
                    <ExternalLink className="w-3 h-3" /> Complete Checkr form
                  </a>
                </Button>
              </div>
            )}
            {o.adverseActionPreNoticeSentAt && (
              <div className="mt-2 rounded bg-amber-50 dark:bg-amber-950/30 border border-amber-300 p-2 text-xs">
                <p className="font-medium text-amber-900 dark:text-amber-200">FCRA pre-adverse action notice sent</p>
                <p className="text-amber-900/80 dark:text-amber-200/80">
                  {new Date(o.adverseActionPreNoticeSentAt).toLocaleDateString()}. You have 5 business days to dispute the report
                  with the consumer reporting agency before a final adverse action.
                </p>
              </div>
            )}
            {o.reportUrl && o.status !== "ordered" && (
              <Button variant="ghost" size="sm" asChild className="px-0 h-auto mt-1 text-primary hover:underline">
                <a href={o.reportUrl} target="_blank" rel="noopener noreferrer" className="gap-1">
                  <ExternalLink className="w-3 h-3" /> View report at vendor
                </a>
              </Button>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function BgStatusBadge({ status, result }: { status: string; result: string | null }) {
  if (result === "clear") return <Badge className="bg-green-600">Clear</Badge>;
  if (result === "consider") return <Badge variant="destructive">Consider</Badge>;
  if (result === "fail") return <Badge variant="destructive">Failed</Badge>;
  if (status === "complete") return <Badge>Complete</Badge>;
  if (status === "pending") return <Badge variant="secondary">Pending</Badge>;
  if (status === "suspended") return <Badge variant="outline" className="text-amber-600 border-amber-600">Suspended</Badge>;
  return <Badge variant="outline">{status}</Badge>;
}
