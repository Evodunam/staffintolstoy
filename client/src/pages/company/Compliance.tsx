import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import {
  ArrowLeft, FileDown, Shield, FlaskConical, Webhook, Loader2, AlertTriangle, Plus, Trash2,
  Mail, Copy, Check, ScanFace, Scale, CheckCircle2, XCircle, Ban, RefreshCw,
} from "lucide-react";

/**
 * Company-facing Compliance hub. Mounted at /company/compliance. Surfaces:
 *   - OSHA 300 / 300A printable downloads (29 CFR §1904)
 *   - Drug screen orders status (vendor-agnostic)
 *   - Webhook configuration shortcut
 *
 * Each section is intentionally self-contained — the company can complete a
 * compliance task without leaving the page.
 */

interface DrugScreenOrder {
  id: number;
  panel: string;
  status: string;
  consentGivenAt: string;
  collectedAt: string | null;
  completedAt: string | null;
  resultSummary: string | null;
  schedulingUrl: string | null;
  workplaceState: string | null;
  vendorRef: string | null;
  createdAt: string;
}

interface ConsentRequest {
  id: number;
  workerEmail: string;
  panel: string;
  workplaceState: string | null;
  expiresAt: string;
  consentedAt: string | null;
  cancelledAt: string | null;
  cancelledBy: string | null;
  resultingOrderId: number | null;
  createdAt: string;
}

export default function CompanyCompliance() {
  const [, setLocation] = useLocation();
  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-40 bg-background border-b border-border">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => setLocation("/company-dashboard")}>
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div>
            <h1 className="text-lg font-semibold flex items-center gap-2"><Shield className="w-5 h-5" /> Compliance</h1>
            <p className="text-xs text-muted-foreground">OSHA recordkeeping, drug screening, integrations.</p>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-6">
        <Tabs defaultValue="osha">
          <TabsList>
            <TabsTrigger value="osha">OSHA</TabsTrigger>
            <TabsTrigger value="drug-screens">Drug screens</TabsTrigger>
            <TabsTrigger value="background-checks">Background checks</TabsTrigger>
            <TabsTrigger value="ofac">OFAC screen</TabsTrigger>
            <TabsTrigger value="integrations">Integrations</TabsTrigger>
          </TabsList>
          <TabsContent value="osha" className="mt-4"><OshaTab /></TabsContent>
          <TabsContent value="drug-screens" className="mt-4"><DrugScreensTab /></TabsContent>
          <TabsContent value="background-checks" className="mt-4"><BackgroundChecksTab /></TabsContent>
          <TabsContent value="ofac" className="mt-4"><OfacScreenTab /></TabsContent>
          <TabsContent value="integrations" className="mt-4"><IntegrationsTab /></TabsContent>
        </Tabs>
      </main>
    </div>
  );
}

// ---------------------------------------------------------------------------
// OSHA Form 300 / 300A downloads.
// ---------------------------------------------------------------------------
function OshaTab() {
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(currentYear - 1);
  const [naicsCode, setNaicsCode] = useState("");
  const [totalHoursWorked, setTotalHoursWorked] = useState("");
  const [averageEmployees, setAverageEmployees] = useState("");

  const open300 = () => {
    window.open(`/api/company/osha/300?year=${year}`, "_blank", "noopener");
  };
  const open300A = () => {
    const params = new URLSearchParams({ year: String(year) });
    if (naicsCode) params.set("naicsCode", naicsCode);
    if (totalHoursWorked) params.set("totalHoursWorked", totalHoursWorked);
    if (averageEmployees) params.set("averageEmployees", averageEmployees);
    window.open(`/api/company/osha/300a?${params.toString()}`, "_blank", "noopener");
  };

  return (
    <div className="space-y-4 max-w-3xl">
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">OSHA Form 300 — Log of Injuries & Illnesses</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Per-incident log required by 29 CFR §1904.7. Aggregates every <strong>safety incident</strong> reported
            against your jobs in the selected year. Print and retain for 5 years.
          </p>
          <div className="flex items-end gap-2">
            <div>
              <Label htmlFor="year-300">Year</Label>
              <Input id="year-300" type="number" value={year} onChange={(e) => setYear(parseInt(e.target.value) || currentYear)} className="w-32" />
            </div>
            <Button onClick={open300} className="gap-1"><FileDown className="w-3.5 h-3.5" /> Download Form 300 (HTML)</Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">OSHA Form 300A — Annual Summary</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Required by 29 CFR §1904.32. <strong>Must be posted in a visible workplace location</strong> from
            February 1 to April 30 of the year following the year covered. Executive certification required.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="naics">NAICS code (optional)</Label>
              <Input id="naics" value={naicsCode} onChange={(e) => setNaicsCode(e.target.value)} placeholder="e.g. 561320" />
            </div>
            <div>
              <Label htmlFor="hours">Total hours worked (optional)</Label>
              <Input id="hours" type="number" value={totalHoursWorked} onChange={(e) => setTotalHoursWorked(e.target.value)} placeholder="e.g. 24500" />
            </div>
            <div>
              <Label htmlFor="emps">Avg # employees (optional)</Label>
              <Input id="emps" type="number" value={averageEmployees} onChange={(e) => setAverageEmployees(e.target.value)} placeholder="e.g. 12" />
            </div>
            <div>
              <Label htmlFor="year-300a">Year</Label>
              <Input id="year-300a" type="number" value={year} onChange={(e) => setYear(parseInt(e.target.value) || currentYear)} />
            </div>
          </div>
          <Button onClick={open300A} className="gap-1"><FileDown className="w-3.5 h-3.5" /> Download Form 300A (HTML)</Button>
        </CardContent>
      </Card>

      <div className="rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/30 p-3 text-xs">
        <div className="flex gap-2 items-start">
          <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
          <div>
            <p className="font-medium text-amber-900 dark:text-amber-200">Reporting requirements still apply</p>
            <p className="text-amber-900/80 dark:text-amber-200/80 mt-1">
              These forms satisfy <strong>recordkeeping</strong>. Establishments in covered industries with 250+ employees
              must also <strong>electronically submit</strong> Form 300A to OSHA via the <a href="https://www.osha.gov/injuryreporting/ita" target="_blank" rel="noopener noreferrer" className="underline">ITA portal</a> by March 2 each year.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Drug screen requests + orders.
// ---------------------------------------------------------------------------
function DrugScreensTab() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [showRequest, setShowRequest] = useState(false);

  const { data: requests, isLoading: loadingReqs } = useQuery<ConsentRequest[]>({
    queryKey: ["/api/company/drug-screens/requests"],
    queryFn: async () => {
      const res = await fetch("/api/company/drug-screens/requests", { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
  });

  const cancelRequest = async (id: number) => {
    if (!confirm("Cancel this consent request? The worker's link will stop working.")) return;
    try {
      await apiRequest("DELETE", `/api/company/drug-screens/requests/${id}`, undefined);
      toast({ title: "Cancelled" });
      qc.invalidateQueries({ queryKey: ["/api/company/drug-screens/requests"] });
    } catch (e: any) {
      toast({ title: "Failed", description: e.message ?? "", variant: "destructive" });
    }
  };

  return (
    <div className="space-y-4 max-w-3xl">
      <div className="rounded-lg border border-border p-3 bg-muted/20">
        <p className="text-sm font-medium mb-1 flex items-center gap-2"><FlaskConical className="w-4 h-4" /> Drug screening</p>
        <p className="text-xs text-muted-foreground">
          Vendor-agnostic drug screen integration with worker consent capture. THC panels are auto-disabled in
          restricted states (CA, NY, NJ, WA, RI, MN, DC) unless the role qualifies for a DOT exemption.
        </p>
      </div>

      <div className="flex justify-between items-center">
        <h3 className="text-sm font-semibold">Consent requests &amp; orders</h3>
        <Button size="sm" onClick={() => setShowRequest(true)} className="gap-1">
          <Plus className="w-3.5 h-3.5" /> Request consent
        </Button>
      </div>

      {loadingReqs ? <Loader2 className="w-5 h-5 animate-spin" /> : !requests || requests.length === 0 ? (
        <Card><CardContent className="p-8 text-center text-sm text-muted-foreground">No requests yet. Click <strong>Request consent</strong> to start.</CardContent></Card>
      ) : (
        <div className="space-y-2">
          {requests.map((r) => <ConsentRequestRow key={r.id} request={r} onCancel={() => cancelRequest(r.id)} />)}
        </div>
      )}

      <RequestConsentDialog open={showRequest} onClose={() => setShowRequest(false)} onCreated={() => qc.invalidateQueries({ queryKey: ["/api/company/drug-screens/requests"] })} />
    </div>
  );
}

function ConsentRequestRow({ request, onCancel }: { request: ConsentRequest; onCancel: () => void }) {
  const expired = !request.consentedAt && !request.cancelledAt && new Date(request.expiresAt) < new Date();
  let stateLabel = "Awaiting consent";
  let badgeVariant: "default" | "secondary" | "outline" | "destructive" = "secondary";
  if (request.consentedAt) { stateLabel = "Consented"; badgeVariant = "default"; }
  else if (request.cancelledAt) { stateLabel = "Cancelled"; badgeVariant = "outline"; }
  else if (expired) { stateLabel = "Expired"; badgeVariant = "outline"; }

  return (
    <Card>
      <CardContent className="p-3 flex items-center gap-3">
        <Mail className="w-4 h-4 text-muted-foreground shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="font-medium text-sm font-mono">{request.workerEmail}</span>
            <Badge variant={badgeVariant}>{stateLabel}</Badge>
            <Badge variant="outline">{request.panel.replace(/_/g, " ")}</Badge>
            {request.workplaceState && <Badge variant="outline">{request.workplaceState}</Badge>}
          </div>
          <p className="text-xs text-muted-foreground">
            Sent {new Date(request.createdAt).toLocaleDateString()}
            {request.consentedAt && ` · Consented ${new Date(request.consentedAt).toLocaleDateString()}`}
            {request.resultingOrderId && ` · Order #${request.resultingOrderId}`}
            {!request.consentedAt && !request.cancelledAt && ` · Expires ${new Date(request.expiresAt).toLocaleDateString()}`}
          </p>
        </div>
        {!request.consentedAt && !request.cancelledAt && !expired && (
          <Button variant="ghost" size="sm" onClick={onCancel} className="text-destructive">
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

function RequestConsentDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const { toast } = useToast();
  const [workerEmail, setWorkerEmail] = useState("");
  const [panel, setPanel] = useState<"5_panel" | "5_panel_no_thc" | "10_panel" | "dot_panel">("5_panel");
  const [workplaceState, setWorkplaceState] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [createdUrl, setCreatedUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const submit = async () => {
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(workerEmail)) {
      toast({ title: "Invalid email", variant: "destructive" }); return;
    }
    try {
      setSubmitting(true);
      const res = await apiRequest("POST", "/api/company/drug-screens/request", {
        workerEmail, panel, workplaceState: workplaceState || undefined,
      });
      const data = await res.json();
      setCreatedUrl(data.consentUrl);
      onCreated();
      toast({ title: "Consent invitation sent", description: `Email sent to ${workerEmail}.` });
    } catch (e: any) {
      toast({ title: "Failed", description: e.message ?? "", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  const reset = () => {
    setWorkerEmail(""); setPanel("5_panel"); setWorkplaceState(""); setCreatedUrl(null); setCopied(false);
  };

  const copy = async () => {
    if (!createdUrl) return;
    try { await navigator.clipboard.writeText(createdUrl); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* */ }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { onClose(); reset(); } }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Request drug screen consent</DialogTitle>
          <DialogDescription>The worker receives an email with a tokenized consent link. The order is only placed after they sign.</DialogDescription>
        </DialogHeader>

        {!createdUrl ? (
          <>
            <div className="space-y-3">
              <div>
                <Label htmlFor="dsr-email">Worker email</Label>
                <Input id="dsr-email" type="email" value={workerEmail} onChange={(e) => setWorkerEmail(e.target.value)} placeholder="worker@example.com" />
              </div>
              <div>
                <Label htmlFor="dsr-panel">Panel</Label>
                <Select value={panel} onValueChange={(v: any) => setPanel(v)}>
                  <SelectTrigger id="dsr-panel"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="5_panel">5-panel (standard)</SelectItem>
                    <SelectItem value="5_panel_no_thc">5-panel without THC</SelectItem>
                    <SelectItem value="10_panel">10-panel (extended)</SelectItem>
                    <SelectItem value="dot_panel">DOT panel (49 CFR §40)</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground mt-1">
                  THC is auto-stripped in CA, NY, NJ, WA, RI, MN, DC unless DOT-regulated.
                </p>
              </div>
              <div>
                <Label htmlFor="dsr-state">Workplace state (2-letter, optional)</Label>
                <Input id="dsr-state" maxLength={2} value={workplaceState} onChange={(e) => setWorkplaceState(e.target.value.toUpperCase())} placeholder="e.g. CA" />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={onClose}>Cancel</Button>
              <Button onClick={submit} disabled={submitting}>{submitting ? "Sending…" : "Send invitation"}</Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <Alert>
              <Check className="h-4 w-4" />
              <AlertTitle>Sent</AlertTitle>
              <AlertDescription>Email is on its way. You can also share this link directly:</AlertDescription>
            </Alert>
            <div className="flex gap-2 mt-3">
              <Input readOnly value={createdUrl} className="font-mono text-xs" />
              <Button variant="outline" size="icon" onClick={copy} title="Copy">
                {copied ? <Check className="w-4 h-4 text-green-600" /> : <Copy className="w-4 h-4" />}
              </Button>
            </div>
            <DialogFooter className="mt-4">
              <Button onClick={() => { onClose(); reset(); }}>Done</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

// Alert components used above — re-import locally to avoid pulling all of them at top.
function Alert({ children, variant }: { children: React.ReactNode; variant?: "default" | "destructive" }) {
  return <div className={`rounded-lg border p-3 ${variant === "destructive" ? "border-destructive bg-destructive/10" : "border-border bg-muted/30"}`}>{children}</div>;
}
function AlertTitle({ children }: { children: React.ReactNode }) { return <p className="font-medium text-sm">{children}</p>; }
function AlertDescription({ children }: { children: React.ReactNode }) { return <p className="text-xs text-muted-foreground">{children}</p>; }

function DrugStatusBadge({ status }: { status: string }) {
  if (status.startsWith("completed_negative") || status === "completed_mro_negative") return <Badge variant="default" className="bg-green-600">Negative</Badge>;
  if (status === "completed_positive") return <Badge variant="destructive">Positive</Badge>;
  if (status === "in_progress") return <Badge variant="secondary">In progress</Badge>;
  if (status === "expired") return <Badge variant="outline" className="text-amber-600 border-amber-600">Expired</Badge>;
  if (status === "cancelled") return <Badge variant="outline">Cancelled</Badge>;
  return <Badge variant="outline">Pending</Badge>;
}

// ---------------------------------------------------------------------------
// Background check requests (FCRA-compliant company-initiated flow).
// ---------------------------------------------------------------------------
interface BgConsentRequest {
  id: number;
  workerEmail: string;
  vendor: string;
  packageCode: string | null;
  expiresAt: string;
  consentedAt: string | null;
  cancelledAt: string | null;
  cancelledBy: string | null;
  resultingOrderId: number | null;
  createdAt: string;
}

function BackgroundChecksTab() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [showRequest, setShowRequest] = useState(false);

  const { data: requests, isLoading } = useQuery<BgConsentRequest[]>({
    queryKey: ["/api/company/background-checks/requests"],
    queryFn: async () => {
      const res = await fetch("/api/company/background-checks/requests", { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
  });

  const cancel = async (id: number) => {
    if (!confirm("Cancel this consent request? The worker's link will stop working.")) return;
    try {
      await apiRequest("DELETE", `/api/company/background-checks/requests/${id}`, undefined);
      toast({ title: "Cancelled" });
      qc.invalidateQueries({ queryKey: ["/api/company/background-checks/requests"] });
    } catch (e: any) {
      toast({ title: "Failed", description: e.message ?? "", variant: "destructive" });
    }
  };

  return (
    <div className="space-y-4 max-w-3xl">
      <div className="rounded-lg border border-border p-3 bg-muted/20">
        <p className="text-sm font-medium mb-1 flex items-center gap-2"><ScanFace className="w-4 h-4" /> Background checks</p>
        <p className="text-xs text-muted-foreground">
          FCRA-compliant background check via Checkr (or your configured vendor). Worker must sign the standalone
          disclosure + separate authorization + acknowledge the CFPB Summary of Rights before the order is placed.
          On <strong>consider</strong> or <strong>fail</strong> results, our scheduler automatically sends the
          pre-adverse + final-adverse notices per FCRA §615.
        </p>
      </div>

      <div className="flex justify-between items-center">
        <h3 className="text-sm font-semibold">Consent requests &amp; orders</h3>
        <Button size="sm" onClick={() => setShowRequest(true)} className="gap-1">
          <Plus className="w-3.5 h-3.5" /> Request consent
        </Button>
      </div>

      {isLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : !requests || requests.length === 0 ? (
        <Card><CardContent className="p-8 text-center text-sm text-muted-foreground">No requests yet. Click <strong>Request consent</strong> to start.</CardContent></Card>
      ) : (
        <div className="space-y-2">
          {requests.map((r) => <BgRequestRow key={r.id} request={r} onCancel={() => cancel(r.id)} />)}
        </div>
      )}

      <BgRequestDialog open={showRequest} onClose={() => setShowRequest(false)} onCreated={() => qc.invalidateQueries({ queryKey: ["/api/company/background-checks/requests"] })} />
    </div>
  );
}

function BgRequestRow({ request, onCancel }: { request: BgConsentRequest; onCancel: () => void }) {
  const expired = !request.consentedAt && !request.cancelledAt && new Date(request.expiresAt) < new Date();
  let label = "Awaiting consent";
  let variant: "default" | "secondary" | "outline" = "secondary";
  if (request.consentedAt) { label = "Signed · order placed"; variant = "default"; }
  else if (request.cancelledAt) { label = "Cancelled"; variant = "outline"; }
  else if (expired) { label = "Expired"; variant = "outline"; }

  return (
    <Card>
      <CardContent className="p-3 flex items-center gap-3">
        <Mail className="w-4 h-4 text-muted-foreground shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="font-medium text-sm font-mono">{request.workerEmail}</span>
            <Badge variant={variant}>{label}</Badge>
            <Badge variant="outline">{request.vendor}</Badge>
            {request.packageCode && <Badge variant="outline">{request.packageCode}</Badge>}
          </div>
          <p className="text-xs text-muted-foreground">
            Sent {new Date(request.createdAt).toLocaleDateString()}
            {request.consentedAt && ` · Signed ${new Date(request.consentedAt).toLocaleDateString()}`}
            {request.resultingOrderId && ` · Order #${request.resultingOrderId}`}
            {!request.consentedAt && !request.cancelledAt && ` · Expires ${new Date(request.expiresAt).toLocaleDateString()}`}
          </p>
        </div>
        {!request.consentedAt && !request.cancelledAt && !expired && (
          <Button variant="ghost" size="sm" onClick={onCancel} className="text-destructive">
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

function BgRequestDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const { toast } = useToast();
  const [workerEmail, setWorkerEmail] = useState("");
  const [vendor, setVendor] = useState("checkr");
  const [packageCode, setPackageCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [createdUrl, setCreatedUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const submit = async () => {
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(workerEmail)) { toast({ title: "Invalid email", variant: "destructive" }); return; }
    try {
      setSubmitting(true);
      const res = await apiRequest("POST", "/api/company/background-checks/request", {
        workerEmail, vendor, packageCode: packageCode || undefined,
      });
      const data = await res.json();
      setCreatedUrl(data.consentUrl);
      onCreated();
      toast({ title: "Consent invitation sent", description: `Email sent to ${workerEmail}.` });
    } catch (e: any) {
      toast({ title: "Failed", description: e.message ?? "", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  const reset = () => { setWorkerEmail(""); setVendor("checkr"); setPackageCode(""); setCreatedUrl(null); setCopied(false); };
  const copy = async () => {
    if (!createdUrl) return;
    try { await navigator.clipboard.writeText(createdUrl); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* */ }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { onClose(); reset(); } }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Request background check consent</DialogTitle>
          <DialogDescription>Worker receives an FCRA disclosure + authorization + Summary of Rights. Order is placed only after they sign.</DialogDescription>
        </DialogHeader>

        {!createdUrl ? (
          <>
            <div className="space-y-3">
              <div>
                <Label htmlFor="bcr-email">Worker email</Label>
                <Input id="bcr-email" type="email" value={workerEmail} onChange={(e) => setWorkerEmail(e.target.value)} placeholder="worker@example.com" />
                <p className="text-xs text-muted-foreground mt-1">Worker must already have a Tolstoy Staffing account to sign.</p>
              </div>
              <div>
                <Label htmlFor="bcr-vendor">Vendor</Label>
                <Select value={vendor} onValueChange={(v) => setVendor(v)}>
                  <SelectTrigger id="bcr-vendor"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="checkr">Checkr</SelectItem>
                    <SelectItem value="goodhire">GoodHire</SelectItem>
                    <SelectItem value="sterling">Sterling</SelectItem>
                    <SelectItem value="manual">Manual / Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="bcr-pkg">Package code (optional)</Label>
                <Input id="bcr-pkg" value={packageCode} onChange={(e) => setPackageCode(e.target.value)} placeholder="e.g. tasker_standard" />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={onClose}>Cancel</Button>
              <Button onClick={submit} disabled={submitting}>{submitting ? "Sending…" : "Send invitation"}</Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <Alert>
              <AlertTitle>Sent</AlertTitle>
              <AlertDescription>Email is on its way. You can also share this link directly:</AlertDescription>
            </Alert>
            <div className="flex gap-2 mt-3">
              <Input readOnly value={createdUrl} className="font-mono text-xs" />
              <Button variant="outline" size="icon" onClick={copy} title="Copy">
                {copied ? <Check className="w-4 h-4 text-green-600" /> : <Copy className="w-4 h-4" />}
              </Button>
            </div>
            <DialogFooter className="mt-4">
              <Button onClick={() => { onClose(); reset(); }}>Done</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// OFAC SDN screening — company self-serve due diligence on payees.
// ---------------------------------------------------------------------------
interface OfacResult {
  status: "cleared" | "review" | "blocked";
  matches: { uid: string; name: string; programs: string; score: number }[];
  checkedAt: string;
}

function OfacScreenTab() {
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [country, setCountry] = useState("");
  const [history, setHistory] = useState<Array<{ name: string; result: OfacResult }>>([]);
  const [submitting, setSubmitting] = useState(false);

  const screen = async () => {
    if (!name.trim() || name.trim().length < 2) {
      toast({ title: "Enter a full legal name", variant: "destructive" }); return;
    }
    try {
      setSubmitting(true);
      const res = await apiRequest("POST", "/api/company/ofac/screen", {
        fullName: name.trim(),
        country: country.trim() || undefined,
      });
      const result: OfacResult = await res.json();
      setHistory((h) => [{ name: name.trim(), result }, ...h].slice(0, 20));
      if (result.status === "blocked") {
        toast({ title: "BLOCKED — exact SDN match", description: "Do not pay. Consult counsel.", variant: "destructive" });
      } else if (result.status === "review") {
        toast({ title: "Review required", description: `${result.matches.length} fuzzy match(es). Verify ID before paying.` });
      } else {
        toast({ title: "Cleared", description: "No OFAC SDN match." });
      }
    } catch (e: any) {
      toast({ title: "Screen failed", description: e.message ?? "", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  const clear = () => { setHistory([]); };

  return (
    <div className="space-y-4 max-w-3xl">
      <div className="rounded-lg border border-border p-3 bg-muted/20">
        <p className="text-sm font-medium mb-1 flex items-center gap-2"><Scale className="w-4 h-4" /> OFAC SDN screening</p>
        <p className="text-xs text-muted-foreground">
          Screen vendors, contractors, or payees against the U.S. Treasury Office of Foreign Assets Control
          (OFAC) Specially Designated Nationals list before sending payment. Required by 31 CFR §501 — paying a
          designated person is a federal violation. Workers you hire through Tolstoy are screened automatically
          before payouts; this tab covers <strong>off-platform</strong> payees you handle yourself.
          Limited to 30 screens/min per company.
        </p>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Screen a payee</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <Label htmlFor="ofac-name">Full legal name (or business name)</Label>
            <Input
              id="ofac-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Acme LLC, or Jane M. Doe"
              onKeyDown={(e) => e.key === "Enter" && screen()}
            />
          </div>
          <div>
            <Label htmlFor="ofac-country">Country (ISO-2, optional)</Label>
            <Input
              id="ofac-country"
              maxLength={2}
              value={country}
              onChange={(e) => setCountry(e.target.value.toUpperCase())}
              placeholder="e.g. US"
              className="max-w-[120px]"
            />
          </div>
          <Button onClick={screen} disabled={submitting || !name.trim()} className="gap-1">
            {submitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Scale className="w-3.5 h-3.5" />}
            Screen
          </Button>
        </CardContent>
      </Card>

      {history.length > 0 && (
        <section>
          <header className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold">This session ({history.length})</h3>
            <Button variant="ghost" size="sm" onClick={clear} className="gap-1">
              <RefreshCw className="w-3.5 h-3.5" /> Clear
            </Button>
          </header>
          <div className="space-y-2">
            {history.map((h, i) => <OfacResultCard key={i} name={h.name} result={h.result} />)}
          </div>
        </section>
      )}
    </div>
  );
}

function OfacResultCard({ name, result }: { name: string; result: OfacResult }) {
  const Icon = result.status === "cleared" ? CheckCircle2 : result.status === "review" ? AlertTriangle : Ban;
  const color = result.status === "cleared" ? "text-green-600" : result.status === "review" ? "text-amber-600" : "text-red-600";
  return (
    <Card>
      <CardContent className="p-3">
        <div className="flex items-start gap-2">
          <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${color}`} />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium">
              {name} <span className={`text-xs ${color} ml-1 uppercase`}>· {result.status}</span>
            </p>
            <p className="text-xs text-muted-foreground">
              {result.matches.length === 0 ? "No matches found." : `${result.matches.length} match(es) — review carefully:`}
              <span className="ml-2 text-[10px]">checked {new Date(result.checkedAt).toLocaleTimeString()}</span>
            </p>
            {result.matches.length > 0 && (
              <ul className="text-[11px] font-mono mt-1 space-y-0.5 max-h-32 overflow-y-auto">
                {result.matches.map((m) => (
                  <li key={m.uid} className="bg-muted/50 px-1.5 py-0.5 rounded break-all">
                    [{m.uid}] {m.name} <span className="text-muted-foreground">({m.programs}) score={m.score.toFixed(2)}</span>
                  </li>
                ))}
              </ul>
            )}
            {result.status === "blocked" && (
              <p className="text-xs mt-2 text-red-700 dark:text-red-300">
                <strong>Do not pay.</strong> An exact SDN match likely triggers an OFAC reporting obligation. Consult counsel before any further action.
              </p>
            )}
            {result.status === "review" && (
              <p className="text-xs mt-2 text-amber-700 dark:text-amber-300">
                Verify the payee's identity (government ID, DOB) against the matched entries above. If it's clearly not them, you may proceed but document your basis for clearing.
              </p>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Integrations shortcut.
// ---------------------------------------------------------------------------
function IntegrationsTab() {
  const [, setLocation] = useLocation();
  return (
    <div className="space-y-3 max-w-3xl">
      <Card>
        <CardContent className="p-4 flex items-center gap-3">
          <Webhook className="w-5 h-5 text-muted-foreground" />
          <div className="flex-1">
            <p className="font-medium">Outbound webhooks</p>
            <p className="text-xs text-muted-foreground">Real-time event delivery to your systems with HMAC signing + retry queue.</p>
          </div>
          <Button onClick={() => setLocation("/company/webhooks")}>Configure →</Button>
        </CardContent>
      </Card>
    </div>
  );
}

