import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { ArrowLeft, AlertTriangle, ShieldAlert, Gavel, MapPin, Loader2 } from "lucide-react";

type DisputeRow = {
  timesheet: any;
  worker: any;
  company: any;
  job: any;
  pings: any[];
};
type Incident = {
  id: number; jobId: number | null; workerProfileId: number | null; companyProfileId: number | null;
  occurredAt: string; description: string; injuryType: string; severity: string;
  oshaRecordable: boolean; oshaReported: boolean; oshaCaseNumber: string | null;
  status: string; createdAt: string; locationDescription: string | null;
};
type Strike = {
  id: number; workerId: number; reason: string; severity: string; isActive: boolean;
  appealStatus: string; appealText: string | null; appealSubmittedAt: string | null; createdAt: string;
};

export default function AdminCompliance() {
  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-40 bg-background border-b border-border">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center gap-3">
          <Link href="/admin"><Button variant="ghost" size="icon"><ArrowLeft className="w-5 h-5" /></Button></Link>
          <div>
            <h1 className="text-lg font-semibold">Compliance &amp; Safety</h1>
            <p className="text-xs text-muted-foreground">Disputes · Safety incidents · Strike appeals</p>
          </div>
        </div>
      </header>
      <main className="max-w-6xl mx-auto px-4 py-6">
        <Tabs defaultValue="disputes">
          <TabsList>
            <TabsTrigger value="disputes"><Gavel className="w-3.5 h-3.5 mr-1" /> Disputes</TabsTrigger>
            <TabsTrigger value="incidents"><ShieldAlert className="w-3.5 h-3.5 mr-1" /> Safety</TabsTrigger>
            <TabsTrigger value="appeals"><AlertTriangle className="w-3.5 h-3.5 mr-1" /> Strike Appeals</TabsTrigger>
          </TabsList>
          <TabsContent value="disputes" className="mt-4"><DisputesTab /></TabsContent>
          <TabsContent value="incidents" className="mt-4"><IncidentsTab /></TabsContent>
          <TabsContent value="appeals" className="mt-4"><AppealsTab /></TabsContent>
        </Tabs>
      </main>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Disputes
// ---------------------------------------------------------------------------
function DisputesTab() {
  const { data, isLoading } = useQuery<DisputeRow[]>({
    queryKey: ["/api/admin/disputes"],
    queryFn: async () => {
      const res = await fetch("/api/admin/disputes", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load disputes");
      return res.json();
    },
  });
  const [active, setActive] = useState<DisputeRow | null>(null);

  if (isLoading) return <Loader2 className="w-5 h-5 animate-spin" />;
  if (!data || data.length === 0) return <Empty title="No disputed timesheets" />;

  return (
    <>
      <div className="space-y-3">
        {data.map((d) => (
          <Card key={d.timesheet.id} className="cursor-pointer hover:bg-muted/30" onClick={() => setActive(d)}>
            <CardContent className="p-4 flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <Badge variant="destructive">Disputed</Badge>
                  <Badge variant="outline">#{d.timesheet.id}</Badge>
                  <span className="text-xs text-muted-foreground">{new Date(d.timesheet.createdAt).toLocaleString()}</span>
                </div>
                <p className="text-sm font-medium">{d.job?.title ?? "—"}</p>
                <p className="text-xs text-muted-foreground">
                  {d.worker?.firstName} {d.worker?.lastName} ↔ {d.company?.companyName ?? `${d.company?.firstName} ${d.company?.lastName}`}
                </p>
                {d.timesheet.locationAdjustmentReason && (
                  <p className="text-xs text-amber-700 mt-1 line-clamp-2">⚠ {d.timesheet.locationAdjustmentReason}</p>
                )}
              </div>
              <div className="text-right shrink-0">
                <div className="text-sm font-semibold">{d.timesheet.totalHours}h</div>
                <div className="text-xs text-muted-foreground">${(d.timesheet.totalPay / 100).toFixed(2)}</div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
      {active && <DisputeResolveDialog row={active} onClose={() => setActive(null)} />}
    </>
  );
}

function DisputeResolveDialog({ row, onClose }: { row: DisputeRow; onClose: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [action, setAction] = useState<"approve_full" | "approve_partial" | "reject">("approve_full");
  const [adjustedHours, setAdjustedHours] = useState<string>(String(row.timesheet.totalHours ?? ""));
  const [reasoning, setReasoning] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (reasoning.trim().length < 30) {
      toast({ title: "Reasoning required (≥30 characters)", variant: "destructive" });
      return;
    }
    try {
      setSubmitting(true);
      await apiRequest("PATCH", `/api/admin/disputes/${row.timesheet.id}/resolve`, {
        action,
        adjustedHours: action === "approve_partial" ? parseFloat(adjustedHours) : undefined,
        reasoning,
      });
      toast({ title: "Resolved" });
      qc.invalidateQueries({ queryKey: ["/api/admin/disputes"] });
      onClose();
    } catch (err: any) {
      toast({ title: "Failed", description: err.message ?? "", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Mediate timesheet #{row.timesheet.id}</DialogTitle>
          <DialogDescription>{row.job?.title} · {row.worker?.firstName} {row.worker?.lastName}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3 max-h-[60vh] overflow-y-auto">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Worker notes</CardTitle></CardHeader>
            <CardContent className="text-sm py-2">{row.timesheet.workerNotes || <span className="text-muted-foreground">None</span>}</CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Company notes</CardTitle></CardHeader>
            <CardContent className="text-sm py-2">{row.timesheet.companyNotes || <span className="text-muted-foreground">None</span>}</CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-1"><MapPin className="w-3.5 h-3.5" /> Location pings ({row.pings.length})</CardTitle></CardHeader>
            <CardContent className="text-xs py-2 max-h-40 overflow-y-auto font-mono">
              {row.pings.slice(0, 20).map((p) => (
                <div key={p.id} className="flex justify-between">
                  <span>{new Date(p.createdAt).toLocaleTimeString()}</span>
                  <span>{p.distanceFromJob ?? "—"}m {p.withinGeofence ? "✓" : "✗"}</span>
                </div>
              ))}
              {row.pings.length === 0 && <span className="text-muted-foreground">No pings</span>}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-3 pt-2 border-t">
          <div>
            <Label>Action</Label>
            <Select value={action} onValueChange={(v: any) => setAction(v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="approve_full">Approve as submitted ({row.timesheet.totalHours}h)</SelectItem>
                <SelectItem value="approve_partial">Approve with adjusted hours</SelectItem>
                <SelectItem value="reject">Reject timesheet</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {action === "approve_partial" && (
            <div>
              <Label htmlFor="adj-hours">Adjusted hours</Label>
              <Input id="adj-hours" type="number" step="0.25" value={adjustedHours} onChange={(e) => setAdjustedHours(e.target.value)} />
            </div>
          )}
          <div>
            <Label htmlFor="reasoning">Reasoning (audit log) <span className="text-xs text-muted-foreground">(min 30 chars)</span></Label>
            <Textarea id="reasoning" rows={3} value={reasoning} onChange={(e) => setReasoning(e.target.value)} placeholder="Why this decision? Cite evidence." />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={submitting}>Cancel</Button>
          <Button onClick={submit} disabled={submitting || reasoning.trim().length < 30}>
            {submitting ? "Resolving…" : "Resolve"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Safety incidents
// ---------------------------------------------------------------------------
function IncidentsTab() {
  const { data, isLoading } = useQuery<Incident[]>({
    queryKey: ["/api/safety-incidents"],
    queryFn: async () => {
      const res = await fetch("/api/safety-incidents", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load incidents");
      return res.json();
    },
  });
  const [active, setActive] = useState<Incident | null>(null);
  if (isLoading) return <Loader2 className="w-5 h-5 animate-spin" />;
  if (!data || data.length === 0) return <Empty title="No incidents reported" />;

  return (
    <>
      <div className="space-y-3">
        {data.map((i) => (
          <Card key={i.id} className="cursor-pointer hover:bg-muted/30" onClick={() => setActive(i)}>
            <CardContent className="p-4 flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <Badge variant={i.severity === "fatality" || i.severity === "days_away" ? "destructive" : "secondary"}>{i.severity.replace("_", " ")}</Badge>
                  <Badge variant="outline">{i.injuryType.replace("_", " ")}</Badge>
                  {i.oshaRecordable && <Badge variant="destructive">OSHA recordable</Badge>}
                  {i.oshaReported && <Badge variant="default">Reported · {i.oshaCaseNumber ?? "no#"}</Badge>}
                  <Badge variant="outline">{i.status}</Badge>
                </div>
                <p className="text-sm font-medium line-clamp-2">{i.description}</p>
                <p className="text-xs text-muted-foreground mt-1">{new Date(i.occurredAt).toLocaleString()} · {i.locationDescription || "—"}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
      {active && <IncidentDialog incident={active} onClose={() => setActive(null)} />}
    </>
  );
}

function IncidentDialog({ incident, onClose }: { incident: Incident; onClose: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [status, setStatus] = useState(incident.status);
  const [resolvedNotes, setResolvedNotes] = useState("");
  const [oshaCaseNumber, setOshaCaseNumber] = useState(incident.oshaCaseNumber ?? "");
  const [oshaReported, setOshaReported] = useState(incident.oshaReported);
  const [submitting, setSubmitting] = useState(false);

  const save = async () => {
    try {
      setSubmitting(true);
      await apiRequest("PATCH", `/api/admin/safety-incidents/${incident.id}`, {
        status, resolvedNotes: resolvedNotes || undefined, oshaReported, oshaCaseNumber: oshaCaseNumber || undefined,
      });
      toast({ title: "Updated" });
      qc.invalidateQueries({ queryKey: ["/api/safety-incidents"] });
      onClose();
    } catch (err: any) {
      toast({ title: "Failed", description: err.message ?? "", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Incident #{incident.id}</DialogTitle>
          <DialogDescription>{new Date(incident.occurredAt).toLocaleString()} · {incident.injuryType} · {incident.severity}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-xs">Description</Label>
            <p className="text-sm border rounded p-2 bg-muted/30">{incident.description}</p>
          </div>
          <div>
            <Label htmlFor="status">Status</Label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="new">New</SelectItem>
                <SelectItem value="investigating">Investigating</SelectItem>
                <SelectItem value="closed">Closed</SelectItem>
                <SelectItem value="disputed">Disputed</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {incident.oshaRecordable && (
            <div className="rounded border-amber-300 bg-amber-50 dark:bg-amber-950/30 p-3 space-y-2">
              <p className="text-xs font-medium">OSHA recordable per 29 CFR §1904.7</p>
              <div className="flex items-center gap-2">
                <input id="osha-rep" type="checkbox" checked={oshaReported} onChange={(e) => setOshaReported(e.target.checked)} />
                <Label htmlFor="osha-rep" className="text-xs">Reported to OSHA</Label>
              </div>
              <div>
                <Label htmlFor="osha-num" className="text-xs">OSHA case number</Label>
                <Input id="osha-num" value={oshaCaseNumber} onChange={(e) => setOshaCaseNumber(e.target.value)} placeholder="e.g. 1234567.0" />
              </div>
            </div>
          )}
          <div>
            <Label htmlFor="resolved">Resolution notes</Label>
            <Textarea id="resolved" rows={3} value={resolvedNotes} onChange={(e) => setResolvedNotes(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={submitting}>Cancel</Button>
          <Button onClick={save} disabled={submitting}>{submitting ? "Saving…" : "Save"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Strike appeals
// ---------------------------------------------------------------------------
function AppealsTab() {
  // Reuse admin strikes endpoint and filter client-side; lighter than a new endpoint.
  const { data, isLoading } = useQuery<Strike[]>({
    queryKey: ["/api/admin/strikes", { appeal: "submitted" }],
    queryFn: async () => {
      const res = await fetch("/api/admin/strikes", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load strikes");
      const all: Strike[] = await res.json();
      return all.filter((s) => s.appealStatus === "submitted");
    },
  });
  const [active, setActive] = useState<Strike | null>(null);
  if (isLoading) return <Loader2 className="w-5 h-5 animate-spin" />;
  if (!data || data.length === 0) return <Empty title="No appeals waiting for decision" />;

  return (
    <>
      <div className="space-y-3">
        {data.map((s) => (
          <Card key={s.id} className="cursor-pointer hover:bg-muted/30" onClick={() => setActive(s)}>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-1">
                <Badge variant="destructive">Strike #{s.id}</Badge>
                <Badge variant="outline">{s.severity}</Badge>
                <Badge>Appeal pending</Badge>
              </div>
              <p className="text-sm font-medium">{s.reason}</p>
              <p className="text-xs text-muted-foreground mt-1">Submitted {s.appealSubmittedAt ? new Date(s.appealSubmittedAt).toLocaleDateString() : "—"}</p>
              <p className="text-xs italic mt-2 line-clamp-3">"{s.appealText}"</p>
            </CardContent>
          </Card>
        ))}
      </div>
      {active && <AppealDialog strike={active} onClose={() => setActive(null)} />}
    </>
  );
}

function AppealDialog({ strike, onClose }: { strike: Strike; onClose: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [decision, setDecision] = useState<"upheld" | "overturned">("upheld");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    try {
      setSubmitting(true);
      await apiRequest("PATCH", `/api/admin/strikes/${strike.id}/appeal`, { decision, notes });
      toast({ title: `Appeal ${decision}` });
      qc.invalidateQueries({ queryKey: ["/api/admin/strikes"] });
      onClose();
    } catch (err: any) {
      toast({ title: "Failed", description: err.message ?? "", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Appeal — Strike #{strike.id}</DialogTitle>
          <DialogDescription>{strike.reason}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-xs">Worker's appeal</Label>
            <p className="text-sm border rounded p-3 bg-muted/30 italic">"{strike.appealText}"</p>
          </div>
          <div>
            <Label>Decision</Label>
            <Select value={decision} onValueChange={(v: any) => setDecision(v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="upheld">Uphold strike</SelectItem>
                <SelectItem value="overturned">Overturn strike (resolves it)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="notes">Decision notes</Label>
            <Textarea id="notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={submitting}>Cancel</Button>
          <Button onClick={submit} disabled={submitting}>{submitting ? "Saving…" : "Decide"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
function Empty({ title }: { title: string }) {
  return (
    <Card><CardContent className="p-8 text-center text-sm text-muted-foreground">{title}</CardContent></Card>
  );
}
