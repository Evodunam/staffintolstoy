import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { ArrowLeft, FlaskConical, Loader2, Plus, Shield } from "lucide-react";

/**
 * Worker-facing drug screen status page. Mounted at /dashboard/settings/drug-screens.
 * Lists every drug screen ordered for the worker with status, panel, scheduling
 * URL, and result summary. Also lets the worker self-attest a screen — useful
 * when applying for jobs that require a recent drug screen on file before the
 * company orders one.
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

export default function WorkerDrugScreens() {
  const [, setLocation] = useLocation();
  const [showOrder, setShowOrder] = useState(false);
  const qc = useQueryClient();
  const { data, isLoading } = useQuery<DrugScreenOrder[]>({
    queryKey: ["/api/worker/drug-screens"],
    queryFn: async () => {
      const res = await fetch("/api/worker/drug-screens", { credentials: "include" });
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
            <h1 className="text-lg font-semibold flex items-center gap-2"><FlaskConical className="w-5 h-5" /> Drug screens</h1>
            <p className="text-xs text-muted-foreground">Vendor-agnostic with worker consent capture.</p>
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-6 space-y-4">
        <div className="flex justify-between items-center">
          <h2 className="text-sm font-semibold">Your drug screens</h2>
          <Button size="sm" onClick={() => setShowOrder(true)} className="gap-1">
            <Plus className="w-3.5 h-3.5" /> Order one for myself
          </Button>
        </div>

        {isLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : !data || data.length === 0 ? (
          <Card><CardContent className="p-8 text-center text-sm text-muted-foreground">
            No drug screens on file. When a company requests one, you'll get an email with a consent link — or you can order one yourself above to have it on file when applying.
          </CardContent></Card>
        ) : (
          <div className="space-y-2">
            {data.map((o) => (
              <Card key={o.id}>
                <CardContent className="p-3 flex items-center gap-3">
                  <FlaskConical className="w-4 h-4 text-muted-foreground" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2 flex-wrap">
                      <span className="font-medium text-sm">{o.panel.replace(/_/g, " ")}</span>
                      <DrugStatusBadge status={o.status} />
                      {o.workplaceState && <Badge variant="outline">{o.workplaceState}</Badge>}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Consented {new Date(o.consentGivenAt).toLocaleDateString()}
                      {o.completedAt && ` · Completed ${new Date(o.completedAt).toLocaleDateString()}`}
                      {o.resultSummary && ` · Result: ${o.resultSummary}`}
                    </p>
                  </div>
                  {o.schedulingUrl && (
                    <Button variant="outline" size="sm" asChild>
                      <a href={o.schedulingUrl} target="_blank" rel="noopener noreferrer">Schedule</a>
                    </Button>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        <SelfAttestDialog open={showOrder} onClose={() => setShowOrder(false)} onCreated={() => qc.invalidateQueries({ queryKey: ["/api/worker/drug-screens"] })} />
      </main>
    </div>
  );
}

function SelfAttestDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const { toast } = useToast();
  const [panel, setPanel] = useState<"5_panel" | "5_panel_no_thc" | "10_panel">("5_panel");
  const [workplaceState, setWorkplaceState] = useState("");
  const [signatureName, setSignatureName] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [schedulingUrl, setSchedulingUrl] = useState<string | null>(null);

  const submit = async () => {
    if (!signatureName.trim() || signatureName.trim().length < 3) {
      toast({ title: "Type your full legal name to sign", variant: "destructive" }); return;
    }
    if (!acknowledged) {
      toast({ title: "You must acknowledge the consent terms", variant: "destructive" }); return;
    }
    try {
      setSubmitting(true);
      const res = await apiRequest("POST", "/api/worker/drug-screens", {
        panel,
        workplaceState: workplaceState || undefined,
        signatureName: signatureName.trim(),
      });
      const data = await res.json();
      setSchedulingUrl(data.schedulingUrl ?? null);
      onCreated();
      toast({ title: "Order placed", description: data.schedulingUrl ? "Use the scheduling link to book a collection." : "Lab will email scheduling instructions shortly." });
    } catch (e: any) {
      toast({ title: "Failed", description: e.message ?? "", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  const reset = () => {
    setPanel("5_panel"); setWorkplaceState(""); setSignatureName(""); setAcknowledged(false); setSchedulingUrl(null);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { onClose(); reset(); } }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Order a drug screen for yourself</DialogTitle>
          <DialogDescription>You'll get a scheduling link or email from the lab. We'll keep the result on file for companies you apply to.</DialogDescription>
        </DialogHeader>

        {!schedulingUrl ? (
          <>
            <div className="space-y-3">
              <div>
                <Label htmlFor="ds-panel">Panel</Label>
                <Select value={panel} onValueChange={(v: any) => setPanel(v)}>
                  <SelectTrigger id="ds-panel"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="5_panel">5-panel (standard)</SelectItem>
                    <SelectItem value="5_panel_no_thc">5-panel without THC</SelectItem>
                    <SelectItem value="10_panel">10-panel (extended)</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground mt-1">
                  THC is auto-stripped in CA, NY, NJ, WA, RI, MN, DC unless DOT-regulated work.
                </p>
              </div>
              <div>
                <Label htmlFor="ds-state">Workplace state (2-letter, optional)</Label>
                <Input id="ds-state" maxLength={2} value={workplaceState} onChange={(e) => setWorkplaceState(e.target.value.toUpperCase())} placeholder="e.g. CA" />
              </div>

              <div className="rounded-lg border border-border p-3 bg-muted/20 space-y-2">
                <p className="text-sm font-medium flex items-center gap-2"><Shield className="w-4 h-4" /> Your consent</p>
                <p className="text-xs text-muted-foreground">
                  By signing, you authorize the testing laboratory to collect a specimen, perform analysis, and report
                  the results to Tolstoy Staffing for sharing with companies you apply to. You can revoke this by emailing{" "}
                  <a href="mailto:support@tolstoystaffing.com" className="underline">support@tolstoystaffing.com</a>.
                </p>
                <label className="flex items-start gap-2 text-xs cursor-pointer">
                  <input type="checkbox" className="mt-0.5" checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)} />
                  <span>I understand and consent to the terms above.</span>
                </label>
              </div>

              <div>
                <Label htmlFor="ds-sig">Type your full legal name to sign</Label>
                <Input
                  id="ds-sig"
                  value={signatureName}
                  onChange={(e) => setSignatureName(e.target.value)}
                  placeholder="e.g. Jane M. Doe"
                  className="mt-1 font-serif text-lg italic"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Recorded with timestamp + IP as the consent record.
                </p>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={onClose}>Cancel</Button>
              <Button onClick={submit} disabled={submitting || !signatureName.trim() || !acknowledged}>
                {submitting && <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" />}
                Sign &amp; order
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <div className="rounded-lg border border-green-300 bg-green-50 dark:bg-green-950/30 p-3 text-sm">
              <p className="font-medium text-green-900 dark:text-green-200 mb-2">Order placed</p>
              <p className="text-green-900/80 dark:text-green-200/80 mb-3">
                Schedule your collection appointment now:
              </p>
              <Button asChild>
                <a href={schedulingUrl} target="_blank" rel="noopener noreferrer">Schedule appointment</a>
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

function DrugStatusBadge({ status }: { status: string }) {
  if (status.startsWith("completed_negative") || status === "completed_mro_negative") return <Badge className="bg-green-600">Negative</Badge>;
  if (status === "completed_positive") return <Badge variant="destructive">Positive</Badge>;
  if (status === "in_progress") return <Badge variant="secondary">In progress</Badge>;
  if (status === "expired") return <Badge variant="outline" className="text-amber-600 border-amber-600">Expired</Badge>;
  if (status === "cancelled") return <Badge variant="outline">Cancelled</Badge>;
  return <Badge variant="outline">Pending</Badge>;
}

