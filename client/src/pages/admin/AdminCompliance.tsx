import { useDeferredValue, useState } from "react";
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
import { ArrowLeft, AlertTriangle, ShieldAlert, Gavel, MapPin, Loader2, Megaphone, Plus, Edit2, Trash2, Eye, EyeOff, Globe, Zap, RefreshCw, CheckCircle2, XCircle, Mail, Send, Ban, Scale, ScanFace, ExternalLink, RotateCw, FlaskConical, Clock } from "lucide-react";

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
            <TabsTrigger value="releasenotes"><Megaphone className="w-3.5 h-3.5 mr-1" /> Release Notes</TabsTrigger>
            <TabsTrigger value="dns"><Globe className="w-3.5 h-3.5 mr-1" /> Email DNS</TabsTrigger>
            <TabsTrigger value="slo"><Zap className="w-3.5 h-3.5 mr-1" /> Endpoint SLOs</TabsTrigger>
            <TabsTrigger value="subprocessor"><Mail className="w-3.5 h-3.5 mr-1" /> Subprocessor Notice</TabsTrigger>
            <TabsTrigger value="ofac"><Scale className="w-3.5 h-3.5 mr-1" /> OFAC Screening</TabsTrigger>
            <TabsTrigger value="bgchecks"><ScanFace className="w-3.5 h-3.5 mr-1" /> Background Checks</TabsTrigger>
            <TabsTrigger value="drugscreens"><FlaskConical className="w-3.5 h-3.5 mr-1" /> Drug Screens</TabsTrigger>
            <TabsTrigger value="schedulers"><Clock className="w-3.5 h-3.5 mr-1" /> Schedulers</TabsTrigger>
          </TabsList>
          <TabsContent value="disputes" className="mt-4"><DisputesTab /></TabsContent>
          <TabsContent value="incidents" className="mt-4"><IncidentsTab /></TabsContent>
          <TabsContent value="appeals" className="mt-4"><AppealsTab /></TabsContent>
          <TabsContent value="releasenotes" className="mt-4"><ReleaseNotesTab /></TabsContent>
          <TabsContent value="dns" className="mt-4"><DnsHealthTab /></TabsContent>
          <TabsContent value="slo" className="mt-4"><SloMetricsTab /></TabsContent>
          <TabsContent value="subprocessor" className="mt-4"><SubprocessorNotifyTab /></TabsContent>
          <TabsContent value="ofac" className="mt-4"><OfacScreeningTab /></TabsContent>
          <TabsContent value="bgchecks" className="mt-4"><BackgroundChecksAdminTab /></TabsContent>
          <TabsContent value="drugscreens" className="mt-4"><DrugScreensAdminTab /></TabsContent>
          <TabsContent value="schedulers" className="mt-4"><SchedulersTab /></TabsContent>
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
// In-product release notes (admin editor + drafts list).
// ---------------------------------------------------------------------------
interface ReleaseNoteRow {
  id: number;
  title: string;
  bodyHtml: string;
  audience: "all" | "company" | "worker" | "admin";
  publishedAt: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

function ReleaseNotesTab() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery<{ notes: ReleaseNoteRow[] }>({
    queryKey: ["/api/admin/release-notes"],
    queryFn: async () => {
      const res = await fetch("/api/admin/release-notes", { credentials: "include" });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });
  const [editing, setEditing] = useState<ReleaseNoteRow | null>(null);
  const [creating, setCreating] = useState(false);

  const remove = async (id: number) => {
    if (!confirm("Delete this note? Permanent.")) return;
    await apiRequest("DELETE", `/api/admin/release-notes/${id}`, undefined);
    qc.invalidateQueries({ queryKey: ["/api/admin/release-notes"] });
    qc.invalidateQueries({ queryKey: ["/api/release-notes"] });
    toast({ title: "Deleted" });
  };
  const togglePublish = async (n: ReleaseNoteRow) => {
    await apiRequest("PATCH", `/api/admin/release-notes/${n.id}`, n.publishedAt ? { unpublish: true } : { publish: true });
    qc.invalidateQueries({ queryKey: ["/api/admin/release-notes"] });
    qc.invalidateQueries({ queryKey: ["/api/release-notes"] });
    toast({ title: n.publishedAt ? "Unpublished" : "Published" });
  };

  if (isLoading) return <Loader2 className="w-5 h-5 animate-spin" />;

  return (
    <>
      <div className="flex justify-between items-center mb-3">
        <p className="text-sm text-muted-foreground">Drafts and published changelog entries surfaced via the bell icon to all eligible users.</p>
        <Button size="sm" onClick={() => setCreating(true)} className="gap-1"><Plus className="w-3.5 h-3.5" /> New entry</Button>
      </div>

      {(!data?.notes || data.notes.length === 0) ? (
        <Empty title="No release notes yet." />
      ) : (
        <div className="space-y-2">
          {data.notes.map((n) => (
            <Card key={n.id}>
              <CardContent className="p-3 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-2">
                    <span className="font-medium">{n.title}</span>
                    <Badge variant={n.publishedAt ? "default" : "outline"}>{n.publishedAt ? "Published" : "Draft"}</Badge>
                    <Badge variant="secondary">{n.audience}</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {n.publishedAt ? `Published ${new Date(n.publishedAt).toLocaleDateString()}` : "Draft"} · {n.createdBy}
                  </p>
                </div>
                <Button size="sm" variant="outline" onClick={() => togglePublish(n)} className="gap-1">
                  {n.publishedAt ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  {n.publishedAt ? "Unpublish" : "Publish"}
                </Button>
                <Button size="sm" variant="outline" onClick={() => setEditing(n)} className="gap-1"><Edit2 className="w-3.5 h-3.5" /> Edit</Button>
                <Button size="sm" variant="ghost" onClick={() => remove(n.id)} className="text-destructive"><Trash2 className="w-3.5 h-3.5" /></Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <ReleaseNoteEditor
        open={creating || !!editing}
        existing={editing}
        onClose={() => { setCreating(false); setEditing(null); }}
        onSaved={() => {
          qc.invalidateQueries({ queryKey: ["/api/admin/release-notes"] });
          qc.invalidateQueries({ queryKey: ["/api/release-notes"] });
        }}
      />
    </>
  );
}

function ReleaseNoteEditor({
  open, existing, onClose, onSaved,
}: { open: boolean; existing: ReleaseNoteRow | null; onClose: () => void; onSaved: () => void }) {
  const { toast } = useToast();
  const [title, setTitle] = useState(existing?.title ?? "");
  const [bodyHtml, setBodyHtml] = useState(existing?.bodyHtml ?? "<p>What changed:</p>\n<ul>\n  <li></li>\n</ul>");
  const [audience, setAudience] = useState<"all" | "company" | "worker" | "admin">(existing?.audience ?? "all");
  const [submitting, setSubmitting] = useState(false);

  if (open && existing && existing.id !== undefined && title === "" && existing.title) {
    setTitle(existing.title); setBodyHtml(existing.bodyHtml); setAudience(existing.audience);
  }

  const save = async (publish: boolean) => {
    if (!title.trim() || !bodyHtml.trim()) { toast({ title: "Title and body required", variant: "destructive" }); return; }
    try {
      setSubmitting(true);
      if (existing) {
        await apiRequest("PATCH", `/api/admin/release-notes/${existing.id}`, { title, bodyHtml, audience, ...(publish ? { publish: true } : {}) });
      } else {
        await apiRequest("POST", "/api/admin/release-notes", { title, bodyHtml, audience, publish });
      }
      toast({ title: publish ? "Published" : "Saved as draft" });
      onSaved(); onClose();
      setTitle(""); setBodyHtml("<p>What changed:</p>\n<ul>\n  <li></li>\n</ul>"); setAudience("all");
    } catch (err: any) {
      toast({ title: "Failed", description: err.message ?? "", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{existing ? "Edit release note" : "New release note"}</DialogTitle>
          <DialogDescription>HTML allowed. Will appear in the bell-icon drawer for all eligible users.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label htmlFor="rn-title">Title</Label>
            <Input id="rn-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. New: per-state wage compliance" />
          </div>
          <div>
            <Label htmlFor="rn-aud">Audience</Label>
            <Select value={audience} onValueChange={(v: any) => setAudience(v)}>
              <SelectTrigger id="rn-aud"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Everyone</SelectItem>
                <SelectItem value="company">Companies only</SelectItem>
                <SelectItem value="worker">Workers only</SelectItem>
                <SelectItem value="admin">Admins only</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="rn-body">Body (HTML)</Label>
            <Textarea id="rn-body" rows={10} value={bodyHtml} onChange={(e) => setBodyHtml(e.target.value)} className="font-mono text-xs" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground mb-1">Preview</p>
            <div className="border rounded p-3 bg-white text-black text-sm prose prose-sm max-w-none" dangerouslySetInnerHTML={{ __html: bodyHtml }} />
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => save(false)} disabled={submitting}>Save as draft</Button>
          <Button onClick={() => save(true)} disabled={submitting}>{submitting ? "…" : (existing?.publishedAt ? "Update" : "Publish")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Email-deliverability DNS audit (SPF/DKIM/DMARC/MX/CAA).
// ---------------------------------------------------------------------------
interface DnsCheck { ok: boolean; level: "pass" | "warn" | "fail"; found: string[]; message: string; remediation?: string }
interface DnsHealth {
  domain: string;
  checkedAt: string;
  spf: DnsCheck;
  dkim: { resend: DnsCheck; google: DnsCheck; selectorFound: string | null };
  dmarc: DnsCheck;
  mx: DnsCheck;
  caa: DnsCheck;
  summary: { overall: "pass" | "warn" | "fail"; passes: number; warns: number; fails: number };
}

function DnsHealthTab() {
  const [domain, setDomain] = useState("tolstoystaffing.com");
  const [report, setReport] = useState<DnsHealth | null>(null);
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const audit = async () => {
    if (!domain.trim()) return;
    try {
      setLoading(true);
      const res = await fetch(`/api/admin/dns-health?domain=${encodeURIComponent(domain.trim())}`, { credentials: "include" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast({ title: "Audit failed", description: err.message ?? `HTTP ${res.status}`, variant: "destructive" });
        return;
      }
      setReport(await res.json());
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4 max-w-3xl">
      <div className="flex gap-2">
        <Input value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="example.com" />
        <Button onClick={audit} disabled={loading} className="gap-1">
          {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />} Audit
        </Button>
      </div>

      {report && (
        <div className="space-y-3">
          <div className={`rounded-lg border p-3 text-sm ${report.summary.overall === "pass" ? "bg-green-50 border-green-300 dark:bg-green-950/30" : report.summary.overall === "warn" ? "bg-amber-50 border-amber-300 dark:bg-amber-950/30" : "bg-red-50 border-red-300 dark:bg-red-950/30"}`}>
            <p className="font-medium">{report.domain} — {report.summary.overall.toUpperCase()}</p>
            <p className="text-xs text-muted-foreground">
              {report.summary.passes} passing · {report.summary.warns} warnings · {report.summary.fails} failures · checked {new Date(report.checkedAt).toLocaleTimeString()}
            </p>
          </div>

          <DnsRow label="SPF" check={report.spf} />
          <DnsRow label="DKIM (resend selector)" check={report.dkim.resend} />
          <DnsRow label="DKIM (google selector)" check={report.dkim.google} />
          <DnsRow label="DMARC" check={report.dmarc} />
          <DnsRow label="MX" check={report.mx} />
          <DnsRow label="CAA" check={report.caa} />
        </div>
      )}
    </div>
  );
}

function DnsRow({ label, check }: { label: string; check: DnsCheck }) {
  const Icon = check.level === "pass" ? CheckCircle2 : check.level === "warn" ? AlertTriangle : XCircle;
  const color = check.level === "pass" ? "text-green-600" : check.level === "warn" ? "text-amber-600" : "text-red-600";
  return (
    <Card>
      <CardContent className="p-3">
        <div className="flex items-start gap-2">
          <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${color}`} />
          <div className="flex-1 min-w-0">
            <p className="font-medium text-sm">{label} <span className={`text-xs ${color} ml-1`}>({check.level})</span></p>
            <p className="text-xs text-muted-foreground mt-0.5">{check.message}</p>
            {check.found.length > 0 && (
              <ul className="text-[11px] font-mono mt-1 space-y-0.5 max-h-24 overflow-y-auto">
                {check.found.map((f, i) => <li key={i} className="break-all bg-muted/50 px-1.5 py-0.5 rounded">{f}</li>)}
              </ul>
            )}
            {check.remediation && check.level !== "pass" && (
              <p className="text-xs mt-1.5 text-amber-700 dark:text-amber-300"><strong>Fix:</strong> {check.remediation}</p>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Per-endpoint SLO/RED dashboard.
// ---------------------------------------------------------------------------
interface EndpointSnapshot {
  method: string;
  route: string;
  count: number;
  errors4xx: number;
  errors5xx: number;
  errorRatePct: number;
  meanMs: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  lastRequestAt: number;
  sparkP95?: number[];
  sparkCount?: number[];
  sparkMinuteEpoch?: number[];
}

function SloMetricsTab() {
  const { data, isLoading, refetch } = useQuery<{ generatedAt: string; endpoints: EndpointSnapshot[] }>({
    queryKey: ["/api/admin/metrics/endpoints"],
    queryFn: async () => {
      const res = await fetch("/api/admin/metrics/endpoints", { credentials: "include" });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    refetchInterval: 15_000,
  });
  const [filter, setFilter] = useState("");

  if (isLoading) return <Loader2 className="w-5 h-5 animate-spin" />;
  if (!data) return null;

  const filtered = data.endpoints.filter((e) =>
    !filter || e.route.toLowerCase().includes(filter.toLowerCase()) || e.method.toLowerCase().includes(filter.toLowerCase()),
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter route…" className="max-w-sm" />
        <Button variant="outline" size="sm" onClick={() => refetch()} className="gap-1"><RefreshCw className="w-3.5 h-3.5" /> Refresh</Button>
        <span className="text-xs text-muted-foreground ml-auto">
          {data.endpoints.length} endpoints · ring buffer (last 1024 reqs/endpoint) · server uptime since restart
        </span>
      </div>

      <div className="rounded-lg border border-border overflow-hidden">
        <table className="w-full text-xs">
          <thead className="bg-muted/40">
            <tr className="text-left">
              <th className="px-2 py-1.5">Method</th>
              <th className="px-2 py-1.5">Route</th>
              <th className="px-2 py-1.5 text-right">Reqs</th>
              <th className="px-2 py-1.5 text-right">Err %</th>
              <th className="px-2 py-1.5 text-right">5xx</th>
              <th className="px-2 py-1.5 text-right">p50 (ms)</th>
              <th className="px-2 py-1.5 text-right">p95 (ms)</th>
              <th className="px-2 py-1.5 text-right">p99 (ms)</th>
              <th className="px-2 py-1.5 text-center">p95 last 1h</th>
              <th className="px-2 py-1.5 text-center">Triage</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((e) => {
              const errorBadge = e.errors5xx > 0 ? "text-red-600" : e.errorRatePct > 5 ? "text-amber-600" : "text-muted-foreground";
              const p95Badge = e.p95Ms > 1000 ? "text-red-600 font-medium" : e.p95Ms > 500 ? "text-amber-600" : "";
              const interesting = e.errors5xx > 0 || e.errorRatePct > 5 || e.p95Ms > 1000;
              return (
                <tr key={`${e.method} ${e.route}`} className="border-t border-border hover:bg-muted/20">
                  <td className="px-2 py-1.5 font-mono">{e.method}</td>
                  <td className="px-2 py-1.5 font-mono break-all">{e.route}</td>
                  <td className="px-2 py-1.5 text-right">{e.count}</td>
                  <td className={`px-2 py-1.5 text-right ${errorBadge}`}>{e.errorRatePct.toFixed(1)}%</td>
                  <td className="px-2 py-1.5 text-right text-red-600">{e.errors5xx || ""}</td>
                  <td className="px-2 py-1.5 text-right">{e.p50Ms.toFixed(0)}</td>
                  <td className={`px-2 py-1.5 text-right ${p95Badge}`}>{e.p95Ms.toFixed(0)}</td>
                  <td className="px-2 py-1.5 text-right">{e.p99Ms.toFixed(0)}</td>
                  <td className="px-2 py-1.5 text-center">
                    <Sparkline values={e.sparkP95 ?? []} counts={e.sparkCount ?? []} minuteEpochs={e.sparkMinuteEpoch ?? []} />
                  </td>
                  <td className="px-2 py-1.5 text-center">
                    {interesting && <SentryLink route={e.route} method={e.method} />}
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr><td colSpan={10} className="px-2 py-4 text-center text-muted-foreground">No endpoints match.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-muted-foreground">
        Latency thresholds: <span className="text-amber-600">amber ≥ 500ms</span>, <span className="text-red-600">red ≥ 1000ms p95</span>.
        Triage column links to Sentry only when <code>VITE_SENTRY_ORG_SLUG</code> is configured at build time.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Subprocessor change-notice blast.
// ---------------------------------------------------------------------------
function SubprocessorNotifyTab() {
  const { toast } = useToast();
  const [subject, setSubject] = useState("Heads-up: Tolstoy Staffing is adding a new subprocessor");
  const [body, setBody] = useState(
    `<p>Hi,</p>
<p>This is a heads-up that Tolstoy Staffing intends to add the following subprocessor on or after <strong>[DATE 30 days from today]</strong>:</p>
<ul>
  <li><strong>[Subprocessor name]</strong> — [purpose, data shared, location]</li>
</ul>
<p>If you have an objection, reply to this email or contact <a href="mailto:legal@tolstoystaffing.com">legal@tolstoystaffing.com</a> within the notice period.</p>
<p>Our up-to-date subprocessor list is at <a href="https://app.tolstoystaffing.com/legal/subprocessors">app.tolstoystaffing.com/legal/subprocessors</a>.</p>
<p>Thanks,<br/>Tolstoy Staffing Security &amp; Privacy</p>`,
  );
  const [submitting, setSubmitting] = useState(false);
  const [lastResult, setLastResult] = useState<{ totalSubscribers: number; sent: number; failed: number } | null>(null);

  const send = async () => {
    if (subject.trim().length < 5) { toast({ title: "Subject too short (≥5 chars)", variant: "destructive" }); return; }
    if (body.trim().length < 50) { toast({ title: "Body too short (≥50 chars)", variant: "destructive" }); return; }
    if (!confirm("Send this notice to all confirmed subscribers? This cannot be undone.")) return;
    try {
      setSubmitting(true);
      const res = await apiRequest("POST", "/api/admin/subprocessors/notify", { subject, html: body });
      const data = await res.json();
      setLastResult(data);
      toast({ title: "Sent", description: `${data.sent}/${data.totalSubscribers} delivered, ${data.failed} failed.` });
    } catch (err: any) {
      toast({ title: "Failed", description: err.message ?? "", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-4 max-w-3xl">
      <div className="rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/30 p-3 text-xs">
        <p className="font-medium text-amber-900 dark:text-amber-200">Read before sending</p>
        <ul className="mt-1 ml-4 list-disc text-amber-900/80 dark:text-amber-200/80 space-y-0.5">
          <li>Most enterprise DPAs require <strong>30 days advance notice</strong> before a new subprocessor processes customer data. Date in your message accordingly.</li>
          <li>An RFC 8058 unsubscribe link is automatically appended; don't include one in your body.</li>
          <li>Update the public subprocessor list at <code>client/src/pages/legal/Subprocessors.tsx</code> on the same day this goes out.</li>
        </ul>
      </div>

      <div>
        <Label htmlFor="subj">Subject</Label>
        <Input id="subj" value={subject} onChange={(e) => setSubject(e.target.value)} />
      </div>
      <div>
        <Label htmlFor="body">HTML body</Label>
        <Textarea id="body" rows={14} value={body} onChange={(e) => setBody(e.target.value)} className="font-mono text-xs" />
      </div>

      <div className="rounded-lg border border-border p-3">
        <p className="text-xs text-muted-foreground mb-2">Preview (your body inside email frame)</p>
        <div className="border rounded bg-white text-black p-4 max-h-[300px] overflow-auto text-sm" dangerouslySetInnerHTML={{ __html: body }} />
      </div>

      <Button onClick={send} disabled={submitting} className="gap-1">
        {submitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
        {submitting ? "Sending…" : "Send to all subscribers"}
      </Button>

      {lastResult && (
        <div className="text-xs text-muted-foreground">
          Last send: {lastResult.sent}/{lastResult.totalSubscribers} delivered, {lastResult.failed} failed.
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// OFAC pre-payout sanctions screening dashboard.
// ---------------------------------------------------------------------------
interface ScreeningEvent {
  id: number;
  adminEmail: string;
  action: string; // "ofac_screen_cleared" | "ofac_screen_review" | "ofac_screen_blocked" | "ofac_payee_cleared"
  entityType: string;
  entityId: number | null;
  details: any;
  createdAt: string;
}

function OfacScreeningTab() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [adhocName, setAdhocName] = useState("");
  const [adhocResult, setAdhocResult] = useState<any | null>(null);
  const [adhocLoading, setAdhocLoading] = useState(false);

  const { data: events, isLoading } = useQuery<ScreeningEvent[]>({
    queryKey: ["/api/admin/payout-screening/events"],
    queryFn: async () => {
      const res = await fetch("/api/admin/payout-screening/events", { credentials: "include" });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    refetchInterval: 30_000,
  });

  const refreshList = async () => {
    try {
      const res = await apiRequest("POST", "/api/admin/ofac/refresh", {});
      const data = await res.json();
      toast({ title: "SDN list refreshed", description: data.message ?? "Cache reloaded." });
    } catch (err: any) {
      toast({ title: "Refresh failed", description: err.message ?? "", variant: "destructive" });
    }
  };

  const adhocScreen = async () => {
    if (!adhocName.trim()) return;
    setAdhocLoading(true); setAdhocResult(null);
    try {
      const res = await apiRequest("POST", "/api/admin/ofac/screen", { fullName: adhocName.trim() });
      setAdhocResult(await res.json());
    } catch (err: any) {
      toast({ title: "Screen failed", description: err.message ?? "", variant: "destructive" });
    } finally {
      setAdhocLoading(false);
    }
  };

  const clearPayee = async (workerProfileId: number) => {
    const notes = prompt("Reason for manual clearance (logged):");
    if (!notes) return;
    try {
      await apiRequest("POST", "/api/admin/payout-screening/clear", { workerProfileId, notes });
      toast({ title: "Payee cleared for 7 days" });
      qc.invalidateQueries({ queryKey: ["/api/admin/payout-screening/events"] });
    } catch (err: any) {
      toast({ title: "Clear failed", description: err.message ?? "", variant: "destructive" });
    }
  };

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="rounded-lg border border-border p-3 bg-muted/20">
        <p className="text-sm font-medium mb-1">Pre-payout OFAC SDN screening</p>
        <p className="text-xs text-muted-foreground">
          Every Mercury payout is screened against the U.S. Treasury OFAC SDN list. Results cached 24h per payee.
          Blocked / review payees can't be paid until manually cleared. Cache is in-memory; restarts force re-screen.
        </p>
      </div>

      {/* Ad-hoc screen */}
      <section>
        <header className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold flex items-center gap-2"><Scale className="w-4 h-4" /> Ad-hoc screen</h3>
          <Button variant="outline" size="sm" onClick={refreshList} className="gap-1">
            <RefreshCw className="w-3.5 h-3.5" /> Refresh SDN list
          </Button>
        </header>
        <div className="flex gap-2">
          <Input
            value={adhocName}
            onChange={(e) => setAdhocName(e.target.value)}
            placeholder="Full legal name to screen"
            onKeyDown={(e) => e.key === "Enter" && adhocScreen()}
          />
          <Button onClick={adhocScreen} disabled={adhocLoading || !adhocName.trim()} className="gap-1">
            {adhocLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Scale className="w-3.5 h-3.5" />} Screen
          </Button>
        </div>
        {adhocResult && (
          <Card className="mt-3"><CardContent className="p-3">
            <div className="flex items-center gap-2 mb-2">
              <StatusIcon status={adhocResult.status} />
              <span className="font-medium uppercase text-sm">{adhocResult.status}</span>
              <span className="text-xs text-muted-foreground">{adhocResult.matches?.length ?? 0} match(es)</span>
            </div>
            {adhocResult.matches?.length > 0 ? (
              <ul className="text-xs space-y-1">
                {adhocResult.matches.map((m: any) => (
                  <li key={m.uid} className="font-mono">
                    [{m.uid}] {m.name} <span className="text-muted-foreground">({m.programs}) score={m.score.toFixed(2)}</span>
                  </li>
                ))}
              </ul>
            ) : <p className="text-xs text-muted-foreground">No matches.</p>}
          </CardContent></Card>
        )}
      </section>

      {/* Events list */}
      <section>
        <h3 className="text-sm font-semibold mb-2">Recent screening events</h3>
        {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : !events || events.length === 0 ? (
          <Empty title="No screening events yet." />
        ) : (
          <div className="space-y-1">
            {events.map((e) => {
              const status = e.action.replace("ofac_screen_", "").replace("ofac_payee_", "");
              return (
                <Card key={e.id}><CardContent className="p-2.5 flex items-center gap-2 text-sm">
                  <StatusIcon status={status} />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs">
                      <span className="font-mono">{e.action}</span>
                      {e.entityId && <> · profile #{e.entityId}</>}
                      <> · {e.details?.reason || e.details?.notes || ""}</>
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {e.adminEmail} · {new Date(e.createdAt).toLocaleString()}
                    </p>
                  </div>
                  {(status === "review" || status === "blocked") && e.entityId && (
                    <Button variant="outline" size="sm" onClick={() => clearPayee(e.entityId!)} className="gap-1">
                      <CheckCircle2 className="w-3.5 h-3.5" /> Clear (7d)
                    </Button>
                  )}
                </CardContent></Card>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

function StatusIcon({ status }: { status: string }) {
  if (status === "cleared") return <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0" />;
  if (status === "review") return <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />;
  if (status === "blocked") return <Ban className="w-4 h-4 text-red-600 shrink-0" />;
  return <ShieldAlert className="w-4 h-4 text-muted-foreground shrink-0" />;
}

// ---------------------------------------------------------------------------
// Admin background-check orders dashboard. Lets admin triage stuck draft
// orders (CHECKR_API_KEY missing? worker missing fields?) by re-running the
// placement, and surfaces all the FCRA adverse-action timestamps for audit.
// ---------------------------------------------------------------------------
interface BgOrderRow {
  order: {
    id: number;
    workerId: number;
    consentId: number;
    vendor: string;
    vendorReference: string | null;
    packageCode: string | null;
    status: string;
    result: string | null;
    reportUrl: string | null;
    orderedAt: string | null;
    completedAt: string | null;
    adverseActionStartedAt: string | null;
    adverseActionPreNoticeSentAt: string | null;
    adverseActionFinalNoticeSentAt: string | null;
    adverseActionReason: string | null;
    createdAt: string;
  };
  worker: { firstName: string | null; lastName: string | null; email: string | null } | null;
}

function BackgroundChecksAdminTab() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [resultFilter, setResultFilter] = useState<string>("");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [bulkSubmitting, setBulkSubmitting] = useState(false);

  const { data, isLoading } = useQuery<BgOrderRow[]>({
    queryKey: ["/api/admin/background-checks", statusFilter, resultFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (statusFilter) params.set("status", statusFilter);
      if (resultFilter) params.set("result", resultFilter);
      const res = await fetch(`/api/admin/background-checks?${params}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    refetchInterval: 30_000,
  });

  // Eligible-for-bulk-retry rows: draft Checkr orders only.
  const retryableIds = (data ?? [])
    .filter((row) => row.order.status === "draft" && row.order.vendor === "checkr")
    .map((row) => row.order.id);

  const toggleSelect = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const selectAllRetryable = () => setSelected(new Set(retryableIds));
  const clearSelection = () => setSelected(new Set());

  const bulkRetry = async () => {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    if (!confirm(`Retry placement for ${ids.length} draft order${ids.length === 1 ? "" : "s"}?`)) return;
    try {
      setBulkSubmitting(true);
      const res = await apiRequest("POST", "/api/admin/background-checks/bulk-place", { ids });
      const data = await res.json();
      toast({
        title: "Bulk retry complete",
        description: `${data.succeeded} succeeded · ${data.failed} failed · ${data.skipped} already placed`,
        variant: data.failed > 0 ? "destructive" : "default",
      });
      clearSelection();
      qc.invalidateQueries({ queryKey: ["/api/admin/background-checks"] });
    } catch (e: any) {
      toast({ title: "Bulk retry failed", description: e.message ?? "", variant: "destructive" });
    } finally {
      setBulkSubmitting(false);
    }
  };

  const retryPlacement = async (orderId: number) => {
    try {
      const res = await apiRequest("POST", `/api/admin/background-checks/${orderId}/place`, {});
      const data = await res.json();
      if (data.success) {
        toast({ title: "Placement succeeded", description: data.invitationUrl ? "Worker invited at vendor." : `Candidate ${data.candidateId}` });
      } else {
        toast({ title: "Placement failed", description: data.error || "Unknown error", variant: "destructive" });
      }
      qc.invalidateQueries({ queryKey: ["/api/admin/background-checks"] });
    } catch (e: any) {
      toast({ title: "Placement failed", description: e.message ?? "", variant: "destructive" });
    }
  };

  const triggerAdverseAction = async () => {
    try {
      const res = await apiRequest("POST", "/api/admin/adverse-action/run", {});
      const data = await res.json();
      toast({
        title: "Adverse action pass complete",
        description: `Pre-adverse: ${data.preAdverseSent} · Final-adverse: ${data.finalAdverseSent} · Errors: ${data.errors}`,
      });
      qc.invalidateQueries({ queryKey: ["/api/admin/background-checks"] });
    } catch (e: any) {
      toast({ title: "Failed", description: e.message ?? "", variant: "destructive" });
    }
  };

  return (
    <div className="space-y-4 max-w-5xl">
      <div className="rounded-lg border border-border p-3 bg-muted/20">
        <p className="text-sm font-medium mb-1 flex items-center gap-2"><ScanFace className="w-4 h-4" /> Background check orders</p>
        <p className="text-xs text-muted-foreground">
          FCRA-compliant Checkr (or other vendor) orders. Draft orders haven't been placed at the vendor yet — usually
          because of missing worker info or a transient API failure. Retry button calls <code>placeOrderWithCheckr()</code>.
          Adverse action emails fire automatically every hour for <strong>consider</strong>/<strong>fail</strong> results.
        </p>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex gap-1">
          {["", "draft", "ordered", "pending", "complete", "suspended"].map((s) => (
            <Button
              key={s || "all"}
              variant={statusFilter === s ? "default" : "outline"}
              size="sm"
              onClick={() => setStatusFilter(s)}
            >
              {s || "All"}
            </Button>
          ))}
        </div>
        <div className="flex gap-1 ml-2">
          {["", "clear", "consider", "fail"].map((r) => (
            <Button
              key={r || "all-results"}
              variant={resultFilter === r ? "default" : "outline"}
              size="sm"
              onClick={() => setResultFilter(r)}
            >
              {r || "Any result"}
            </Button>
          ))}
        </div>
        <Button variant="outline" size="sm" onClick={triggerAdverseAction} className="ml-auto gap-1">
          <Send className="w-3.5 h-3.5" /> Run adverse-action pass
        </Button>
      </div>

      {/* Bulk action toolbar — appears when ≥1 retryable draft selected */}
      {retryableIds.length > 0 && (
        <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/30 p-2 text-sm">
          <span className="text-xs text-muted-foreground">
            {selected.size > 0
              ? <><strong>{selected.size}</strong> selected of {retryableIds.length} retryable draft{retryableIds.length === 1 ? "" : "s"}</>
              : <>{retryableIds.length} retryable draft{retryableIds.length === 1 ? "" : "s"} below</>}
          </span>
          <div className="ml-auto flex gap-1">
            {selected.size === 0 ? (
              <Button variant="outline" size="sm" onClick={selectAllRetryable}>Select all draft</Button>
            ) : (
              <>
                <Button variant="outline" size="sm" onClick={clearSelection}>Clear</Button>
                <Button size="sm" onClick={bulkRetry} disabled={bulkSubmitting} className="gap-1">
                  {bulkSubmitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  Retry {selected.size} placement{selected.size === 1 ? "" : "s"}
                </Button>
              </>
            )}
          </div>
        </div>
      )}

      {isLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : !data || data.length === 0 ? (
        <Empty title="No background check orders match." />
      ) : (
        <div className="space-y-2">
          {data.map((row) => (
            <BgOrderCard
              key={row.order.id}
              row={row}
              selected={selected.has(row.order.id)}
              onToggleSelect={
                row.order.status === "draft" && row.order.vendor === "checkr"
                  ? () => toggleSelect(row.order.id)
                  : undefined
              }
              onRetry={() => retryPlacement(row.order.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function BgOrderCard({ row, selected, onToggleSelect, onRetry }: {
  row: BgOrderRow;
  selected: boolean;
  onToggleSelect?: () => void;
  onRetry: () => void;
}) {
  const o = row.order;
  const workerName = row.worker
    ? [row.worker.firstName, row.worker.lastName].filter(Boolean).join(" ").trim() || row.worker.email || `Worker #${o.workerId}`
    : `Worker #${o.workerId}`;

  return (
    <Card className={selected ? "ring-2 ring-primary" : undefined}>
      <CardContent className="p-3 space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          {onToggleSelect && (
            <input
              type="checkbox"
              checked={selected}
              onChange={onToggleSelect}
              className="cursor-pointer"
              aria-label={`Select order ${o.id} for bulk retry`}
            />
          )}
          <ScanFace className="w-4 h-4 text-muted-foreground" />
          <span className="font-medium text-sm">{workerName}</span>
          <Badge variant="outline">{o.vendor}</Badge>
          {o.packageCode && <Badge variant="outline">{o.packageCode}</Badge>}
          <BgStatusBadge status={o.status} result={o.result} />
          {o.adverseActionFinalNoticeSentAt
            ? <Badge variant="destructive" className="ml-1">Final adverse sent</Badge>
            : o.adverseActionPreNoticeSentAt
              ? <Badge variant="outline" className="text-amber-600 border-amber-600 ml-1">Pre-adverse sent</Badge>
              : null}
          <span className="ml-auto text-xs text-muted-foreground">Order #{o.id}</span>
        </div>

        <p className="text-xs text-muted-foreground">
          {row.worker?.email && <>{row.worker.email} · </>}
          Created {new Date(o.createdAt).toLocaleString()}
          {o.orderedAt && ` · Ordered ${new Date(o.orderedAt).toLocaleDateString()}`}
          {o.completedAt && ` · Completed ${new Date(o.completedAt).toLocaleDateString()}`}
        </p>

        {o.vendorReference && (
          <p className="text-xs font-mono text-muted-foreground">vendor_ref: {o.vendorReference}</p>
        )}

        {o.adverseActionReason && o.status === "draft" && (
          <div className="rounded bg-red-50 dark:bg-red-950/30 border border-red-300 p-2 text-xs">
            <p className="font-medium text-red-900 dark:text-red-200">Last placement error</p>
            <p className="text-red-900/80 dark:text-red-200/80 font-mono">{o.adverseActionReason}</p>
          </div>
        )}

        {o.adverseActionPreNoticeSentAt && (
          <div className="rounded bg-amber-50 dark:bg-amber-950/30 border border-amber-300 p-2 text-xs">
            <p className="font-medium text-amber-900 dark:text-amber-200">FCRA timeline</p>
            <p className="text-amber-900/80 dark:text-amber-200/80">
              Pre-adverse sent {new Date(o.adverseActionPreNoticeSentAt).toLocaleDateString()}.
              {" "}
              {o.adverseActionFinalNoticeSentAt
                ? <>Final adverse sent {new Date(o.adverseActionFinalNoticeSentAt).toLocaleDateString()}.</>
                : <>Final-adverse will fire automatically 5 business days later.</>}
            </p>
          </div>
        )}

        <div className="flex gap-2">
          {o.status === "draft" && o.vendor === "checkr" && (
            <Button variant="outline" size="sm" onClick={onRetry} className="gap-1">
              <RotateCw className="w-3.5 h-3.5" /> Retry placement
            </Button>
          )}
          {o.reportUrl && (
            <Button variant="ghost" size="sm" asChild className="gap-1 text-primary hover:underline">
              <a href={o.reportUrl} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="w-3.5 h-3.5" /> {o.reportUrl.includes("invitations") ? "Worker invitation" : "Vendor dashboard"}
              </a>
            </Button>
          )}
        </div>
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
  if (status === "ordered") return <Badge variant="secondary">Ordered</Badge>;
  if (status === "suspended") return <Badge variant="outline" className="text-amber-600 border-amber-600">Suspended</Badge>;
  if (status === "draft") return <Badge variant="outline">Draft</Badge>;
  return <Badge variant="outline">{status}</Badge>;
}

// ---------------------------------------------------------------------------
// Admin drug-screen orders dashboard. Mirror of the bg-checks tab — surfaces
// every order across the platform with status filter + worker contact info.
// Admin doesn't directly act on drug screens (vendor handles collection +
// MRO review), but this is the visibility surface for compliance audits and
// support escalations from companies/workers.
// ---------------------------------------------------------------------------
interface DrugOrderRow {
  order: {
    id: number;
    workerId: number;
    orderedByCompanyId: number | null;
    vendor: string;
    vendorRef: string | null;
    panel: string;
    workplaceState: string | null;
    status: string;
    consentGivenAt: string;
    consentSignatureName: string;
    consentIpAddress: string | null;
    schedulingUrl: string | null;
    collectedAt: string | null;
    completedAt: string | null;
    expiresAt: string | null;
    resultSummary: string | null;
    positiveAnalytes: string[] | null;
    adverseActionPreNoticeSentAt: string | null;
    adverseActionFinalNoticeSentAt: string | null;
    createdAt: string;
  };
  worker: { firstName: string | null; lastName: string | null; email: string | null } | null;
}

function DrugScreensAdminTab() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [bulkSubmitting, setBulkSubmitting] = useState(false);

  const { data, isLoading } = useQuery<DrugOrderRow[]>({
    queryKey: ["/api/admin/drug-screens", statusFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (statusFilter) params.set("status", statusFilter);
      const res = await fetch(`/api/admin/drug-screens?${params}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    refetchInterval: 30_000,
  });

  // Eligible-for-bulk-cancel rows: pending or in_progress only.
  const cancellableIds = (data ?? [])
    .filter((row) => row.order.status === "pending" || row.order.status === "in_progress")
    .map((row) => row.order.id);

  const toggleSelect = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const selectAllCancellable = () => setSelected(new Set(cancellableIds));
  const clearSelection = () => setSelected(new Set());

  const bulkCancel = async () => {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    if (!confirm(`Cancel ${ids.length} pending drug screen order${ids.length === 1 ? "" : "s"}? This cannot be undone — workers will need a fresh consent request to re-order.`)) return;
    try {
      setBulkSubmitting(true);
      const res = await apiRequest("POST", "/api/admin/drug-screens/bulk-cancel", { ids });
      const data = await res.json();
      toast({
        title: "Bulk cancel complete",
        description: `${data.cancelled} cancelled · ${data.skipped} skipped · ${data.failed} failed`,
        variant: data.failed > 0 ? "destructive" : "default",
      });
      clearSelection();
      qc.invalidateQueries({ queryKey: ["/api/admin/drug-screens"] });
    } catch (e: any) {
      toast({ title: "Bulk cancel failed", description: e.message ?? "", variant: "destructive" });
    } finally {
      setBulkSubmitting(false);
    }
  };

  return (
    <div className="space-y-4 max-w-5xl">
      <div className="rounded-lg border border-border p-3 bg-muted/20">
        <p className="text-sm font-medium mb-1 flex items-center gap-2"><FlaskConical className="w-4 h-4" /> Drug screen orders</p>
        <p className="text-xs text-muted-foreground">
          Vendor-agnostic drug screens placed via the worker self-attest flow or company-initiated consent flow.
          THC is auto-stripped in restricted states (CA, NY, NJ, WA, RI, MN, DC). Positive results that lead to
          an adverse hire decision must be MRO-reviewed; if the company decides not to hire, run the FCRA pre-adverse
          flow manually (no automated scheduler for drug screens — adverse action workflows for drug results are
          state-specific and vendor-mediated).
        </p>
      </div>

      <div className="flex items-center gap-1 flex-wrap">
        {["", "pending", "in_progress", "completed_negative", "completed_positive", "completed_mro_negative", "expired", "cancelled"].map((s) => (
          <Button
            key={s || "all"}
            variant={statusFilter === s ? "default" : "outline"}
            size="sm"
            onClick={() => setStatusFilter(s)}
          >
            {s ? s.replace(/_/g, " ") : "All"}
          </Button>
        ))}
      </div>

      {/* Bulk action toolbar — only when ≥1 cancellable row in current filter */}
      {cancellableIds.length > 0 && (
        <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/30 p-2 text-sm">
          <span className="text-xs text-muted-foreground">
            {selected.size > 0
              ? <><strong>{selected.size}</strong> selected of {cancellableIds.length} cancellable order{cancellableIds.length === 1 ? "" : "s"}</>
              : <>{cancellableIds.length} pending/in-progress order{cancellableIds.length === 1 ? "" : "s"} below</>}
          </span>
          <div className="ml-auto flex gap-1">
            {selected.size === 0 ? (
              <Button variant="outline" size="sm" onClick={selectAllCancellable}>Select all pending</Button>
            ) : (
              <>
                <Button variant="outline" size="sm" onClick={clearSelection}>Clear</Button>
                <Button size="sm" variant="destructive" onClick={bulkCancel} disabled={bulkSubmitting} className="gap-1">
                  {bulkSubmitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  Cancel {selected.size} order{selected.size === 1 ? "" : "s"}
                </Button>
              </>
            )}
          </div>
        </div>
      )}

      {isLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : !data || data.length === 0 ? (
        <Empty title="No drug screen orders match." />
      ) : (
        <div className="space-y-2">
          {data.map((row) => (
            <DrugOrderCard
              key={row.order.id}
              row={row}
              selected={selected.has(row.order.id)}
              onToggleSelect={
                (row.order.status === "pending" || row.order.status === "in_progress")
                  ? () => toggleSelect(row.order.id)
                  : undefined
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}

function DrugOrderCard({ row, selected, onToggleSelect }: {
  row: DrugOrderRow;
  selected: boolean;
  onToggleSelect?: () => void;
}) {
  const o = row.order;
  const workerName = row.worker
    ? [row.worker.firstName, row.worker.lastName].filter(Boolean).join(" ").trim() || row.worker.email || `Worker #${o.workerId}`
    : `Worker #${o.workerId}`;

  return (
    <Card className={selected ? "ring-2 ring-primary" : undefined}>
      <CardContent className="p-3 space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          {onToggleSelect && (
            <input
              type="checkbox"
              checked={selected}
              onChange={onToggleSelect}
              className="cursor-pointer"
              aria-label={`Select drug screen order ${o.id} for bulk cancel`}
            />
          )}
          <FlaskConical className="w-4 h-4 text-muted-foreground" />
          <span className="font-medium text-sm">{workerName}</span>
          <Badge variant="outline">{o.vendor}</Badge>
          <Badge variant="outline">{o.panel.replace(/_/g, " ")}</Badge>
          {o.workplaceState && <Badge variant="outline">{o.workplaceState}</Badge>}
          <DrugAdminStatusBadge status={o.status} />
          {o.adverseActionFinalNoticeSentAt
            ? <Badge variant="destructive" className="ml-1">Final adverse sent</Badge>
            : o.adverseActionPreNoticeSentAt
              ? <Badge variant="outline" className="text-amber-600 border-amber-600 ml-1">Pre-adverse sent</Badge>
              : null}
          <span className="ml-auto text-xs text-muted-foreground">Order #{o.id}</span>
        </div>

        <p className="text-xs text-muted-foreground">
          {row.worker?.email && <>{row.worker.email} · </>}
          Consented {new Date(o.consentGivenAt).toLocaleString()} as <em>{o.consentSignatureName}</em>
          {o.consentIpAddress && ` from ${o.consentIpAddress}`}
        </p>

        <p className="text-xs text-muted-foreground">
          Created {new Date(o.createdAt).toLocaleDateString()}
          {o.collectedAt && ` · Collected ${new Date(o.collectedAt).toLocaleDateString()}`}
          {o.completedAt && ` · Completed ${new Date(o.completedAt).toLocaleDateString()}`}
          {!o.completedAt && o.expiresAt && ` · Expires ${new Date(o.expiresAt).toLocaleDateString()}`}
          {o.orderedByCompanyId && ` · Requested by company #${o.orderedByCompanyId}`}
          {!o.orderedByCompanyId && ` · Worker self-attest`}
        </p>

        {o.vendorRef && (
          <p className="text-xs font-mono text-muted-foreground">vendor_ref: {o.vendorRef}</p>
        )}

        {o.resultSummary && (
          <div className={`rounded p-2 text-xs ${o.status === "completed_positive" ? "bg-red-50 dark:bg-red-950/30 border border-red-300" : "bg-green-50 dark:bg-green-950/30 border border-green-300"}`}>
            <p className="font-medium">Result: {o.resultSummary}</p>
            {Array.isArray(o.positiveAnalytes) && o.positiveAnalytes.length > 0 && (
              <p className="text-xs mt-1">Positive analytes: {o.positiveAnalytes.join(", ")}</p>
            )}
          </div>
        )}

        <div className="flex gap-2">
          {o.schedulingUrl && (
            <Button variant="ghost" size="sm" asChild className="gap-1 text-primary hover:underline">
              <a href={o.schedulingUrl} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="w-3.5 h-3.5" /> Worker scheduling link
              </a>
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function DrugAdminStatusBadge({ status }: { status: string }) {
  if (status === "completed_negative" || status === "completed_mro_negative") return <Badge className="bg-green-600">Negative</Badge>;
  if (status === "completed_positive") return <Badge variant="destructive">Positive</Badge>;
  if (status === "in_progress") return <Badge variant="secondary">In progress</Badge>;
  if (status === "expired") return <Badge variant="outline" className="text-amber-600 border-amber-600">Expired</Badge>;
  if (status === "cancelled") return <Badge variant="outline">Cancelled</Badge>;
  return <Badge variant="outline">Pending</Badge>;
}

// ---------------------------------------------------------------------------
// Scheduler health dashboard. Shows the recurring background jobs (data
// retention, adverse action, outbound webhooks, meal-break reminder) — when
// they last ran, success/failure rate, last error, cumulative work done.
// Critical for compliance audits ("did the FCRA adverse-action scheduler
// actually fire after each consider/fail result?").
// ---------------------------------------------------------------------------
interface SchedulerHealth {
  name: string;
  intervalMs: number;
  registeredAt: number;
  runCount: number;
  errorCount: number;
  errorRatePct: number;
  lastTick: { startedAt: number; durationMs: number; ok: boolean; error?: string; stats?: Record<string, number> } | null;
  durationHistory: number[];
  successHistory: boolean[];
  tickStartedAt?: number[];
  cumulativeStats: Record<string, number>;
  healthy: boolean;
  staleSinceMs: number | null;
}

interface SchedulerDbRow {
  schedulerName: string;
  startedAt: string;
  durationMs: number;
  ok: boolean;
  error: string | null;
}

function SchedulersTab() {
  const [schedulerFilter, setSchedulerFilter] = useState("");
  const deferredSchedulerFilter = useDeferredValue(schedulerFilter.trim());
  const { data, isLoading, refetch } = useQuery<{ generatedAt: string; schedulers: SchedulerHealth[]; dbRecent?: SchedulerDbRow[]; schedulerFilter?: string | null }>({
    queryKey: ["/api/admin/schedulers/status", deferredSchedulerFilter],
    queryFn: async () => {
      const q = deferredSchedulerFilter ? `?scheduler=${encodeURIComponent(deferredSchedulerFilter)}` : "";
      const res = await fetch(`/api/admin/schedulers/status${q}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    refetchInterval: 15_000,
  });

  if (isLoading) return <Loader2 className="w-5 h-5 animate-spin" />;
  if (!data) return null;

  return (
    <div className="space-y-4 max-w-4xl">
      <div className="rounded-lg border border-border p-3 bg-muted/20">
        <p className="text-sm font-medium mb-1 flex items-center gap-2"><Clock className="w-4 h-4" /> Scheduler health</p>
        <p className="text-xs text-muted-foreground">
          In-process counters reset on deploy. Each tick is written to <code className="text-[10px]">scheduler_runs</code> (after migration) and failures are tagged{" "}
          <code className="text-[10px]">scheduler_name</code> in Sentry.
          A scheduler is <strong>healthy</strong> iff its last tick succeeded AND the gap since last tick is &lt; 1.5×
          its configured interval.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2 justify-between">
        <Input
          value={schedulerFilter}
          onChange={(e) => setSchedulerFilter(e.target.value)}
          placeholder="Filter by name (e.g. adverse, webhook)…"
          className="max-w-xs text-sm"
        />
        <Button variant="outline" size="sm" onClick={() => refetch()} className="gap-1">
          <RefreshCw className="w-3.5 h-3.5" /> Refresh
        </Button>
      </div>
      {data.schedulerFilter && (
        <p className="text-[11px] text-muted-foreground">Server filter: <span className="font-mono">{data.schedulerFilter}</span></p>
      )}

      {data.schedulers.length === 0 ? (
        <Empty title="No schedulers registered yet (server may have just restarted)." />
      ) : (
        <div className="space-y-2">
          {data.schedulers.map((s) => <SchedulerCard key={s.name} s={s} />)}
        </div>
      )}

      {data.dbRecent && data.dbRecent.length > 0 && (
        <div className="rounded-lg border border-border p-3 space-y-2 max-h-56 overflow-y-auto">
          <p className="text-xs font-medium">Recent DB ticks (newest first, max 400)</p>
          <table className="w-full text-[10px]">
            <thead>
              <tr className="text-left text-muted-foreground border-b border-border">
                <th className="py-1 pr-2">Scheduler</th>
                <th className="py-1 pr-2">Started</th>
                <th className="py-1 pr-2 text-right">ms</th>
                <th className="py-1 pr-2">OK</th>
                <th className="py-1">Error</th>
              </tr>
            </thead>
            <tbody>
              {data.dbRecent.map((r, i) => (
                <tr key={`${r.schedulerName}-${r.startedAt}-${i}`} className="border-t border-border/60">
                  <td className="py-0.5 pr-2 font-mono">{r.schedulerName}</td>
                  <td className="py-0.5 pr-2 whitespace-nowrap">{new Date(r.startedAt).toLocaleString()}</td>
                  <td className="py-0.5 pr-2 text-right">{r.durationMs}</td>
                  <td className="py-0.5 pr-2">{r.ok ? "✓" : <span className="text-red-600">✗</span>}</td>
                  <td className="py-0.5 font-mono text-red-700/90 dark:text-red-300/90 max-w-[200px] truncate" title={r.error ?? undefined}>
                    {!r.ok && r.error ? r.error : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function SchedulerCard({ s }: { s: SchedulerHealth }) {
  const intervalLabel = s.intervalMs === 0
    ? "manual"
    : s.intervalMs >= 3600_000
      ? `${(s.intervalMs / 3600_000).toFixed(1)}h`
      : s.intervalMs >= 60_000
        ? `${Math.round(s.intervalMs / 60_000)}min`
        : `${Math.round(s.intervalMs / 1000)}s`;

  const sinceLast = s.lastTick ? Date.now() - s.lastTick.startedAt : null;
  const sinceLastLabel = sinceLast == null
    ? "never"
    : sinceLast < 60_000
      ? `${Math.round(sinceLast / 1000)}s ago`
      : sinceLast < 3600_000
        ? `${Math.round(sinceLast / 60_000)}min ago`
        : `${(sinceLast / 3600_000).toFixed(1)}h ago`;

  const maxDuration = Math.max(1, ...s.durationHistory);

  return (
    <Card className={s.healthy ? "" : "ring-2 ring-amber-500"}>
      <CardContent className="p-3 space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          {s.healthy
            ? <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0" />
            : <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />}
          <span className="font-medium text-sm font-mono">{s.name}</span>
          <Badge variant="outline">every {intervalLabel}</Badge>
          {s.healthy
            ? <Badge className="bg-green-600">Healthy</Badge>
            : s.staleSinceMs
              ? <Badge variant="outline" className="text-amber-600 border-amber-600">Stale ({Math.round(s.staleSinceMs / 60_000)}min)</Badge>
              : <Badge variant="destructive">Last tick failed</Badge>}
          {s.errorRatePct > 10 && <Badge variant="destructive">{s.errorRatePct.toFixed(0)}% error rate</Badge>}
          {!s.healthy && !s.lastTick?.error && (
            <SentryLink query={`is:unresolved scheduler_name:${s.name}`} title="Sentry: this scheduler" className="inline-flex shrink-0" />
          )}
          <span className="ml-auto text-xs text-muted-foreground">{s.runCount} runs · {s.errorCount} errors</span>
        </div>

        <p className="text-xs text-muted-foreground">
          Last ran <strong>{sinceLastLabel}</strong>
          {s.lastTick && <> · {s.lastTick.durationMs}ms · {s.lastTick.ok ? "ok" : "FAILED"}</>}
        </p>

        {s.lastTick?.stats && Object.keys(s.lastTick.stats).length > 0 && (
          <p className="text-xs">
            <span className="text-muted-foreground">Last tick:</span>{" "}
            {Object.entries(s.lastTick.stats).map(([k, v]) => (
              <span key={k} className="font-mono mr-2">{k}={v}</span>
            ))}
          </p>
        )}
        {Object.keys(s.cumulativeStats).length > 0 && (
          <p className="text-xs">
            <span className="text-muted-foreground">Cumulative (last {s.durationHistory.length} ticks):</span>{" "}
            {Object.entries(s.cumulativeStats).map(([k, v]) => (
              <span key={k} className="font-mono mr-2">{k}={v}</span>
            ))}
          </p>
        )}

        {s.lastTick?.error && (
          <div className="rounded bg-red-50 dark:bg-red-950/30 border border-red-300 p-2 text-xs">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-medium text-red-900 dark:text-red-200">Last error</p>
                <p className="font-mono text-red-900/80 dark:text-red-200/80 break-all">{s.lastTick.error}</p>
              </div>
              <SentryLink query={`is:unresolved scheduler_name:${s.name}`} title="Sentry: this scheduler" className="shrink-0" />
            </div>
          </div>
        )}

        {s.durationHistory.length > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-muted-foreground w-32 shrink-0">Last {s.durationHistory.length} ticks (ms)</span>
            <SchedulerSparkline
              durations={s.durationHistory}
              successes={s.successHistory}
              startedAt={s.tickStartedAt ?? []}
              max={maxDuration}
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function SchedulerSparkline({
  durations, successes, startedAt, max,
}: { durations: number[]; successes: boolean[]; startedAt: number[]; max: number }) {
  const W = 200;
  const H = 24;
  const barW = W / Math.max(1, durations.length);
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Last ${durations.length} ticks, max ${max}ms`}>
      <title>Last {durations.length} ticks · max {max}ms — hover bars for time + duration</title>
      {durations.map((d, i) => {
        const h = Math.max(1, (d / max) * H);
        const ok = successes[i];
        const fill = !ok ? "fill-red-500" : d > 5000 ? "fill-amber-500" : "fill-emerald-500";
        const t = startedAt[i];
        const when = t ? new Date(t).toLocaleString() : `tick ${i + 1}`;
        return (
          <g key={i}>
            <title>{`${when} · ${d}ms · ${ok ? "ok" : "FAILED"}`}</title>
            <rect x={i * barW} y={H - h} width={Math.max(1, barW - 0.5)} height={h} className={fill} />
          </g>
        );
      })}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Inline SVG sparkline of per-minute p95 latency for the last hour.
// Renders 60 bars; height = relative to the row's max p95 (so a flat row
// stays flat instead of looking dramatic). Empty minutes (no traffic) show
// as dim ticks. Width is fixed so columns line up across rows.
function formatSparkMinute(minuteEpoch: number): string {
  if (!minuteEpoch) return "";
  return new Date(minuteEpoch * 60_000).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function Sparkline({ values, counts, minuteEpochs }: { values: number[]; counts: number[]; minuteEpochs?: number[] }) {
  if (!values.length) return <span className="text-[10px] text-muted-foreground">—</span>;

  const max = Math.max(1, ...values);
  const W = 120;
  const H = 24;
  const barW = W / values.length;
  const bars = values.map((v, i) => {
    const hadTraffic = (counts[i] ?? 0) > 0;
    const me = minuteEpochs?.[i] ?? 0;
    const slotLabel = me ? formatSparkMinute(me) : `slot ${i + 1}/60`;
    if (!hadTraffic) {
      return (
        <g key={i}>
          <title>{`${slotLabel}: no traffic`}</title>
          <rect x={i * barW} y={H - 1} width={Math.max(1, barW - 0.5)} height={1} fill="currentColor" opacity={0.2} />
        </g>
      );
    }
    const h = Math.max(1, (v / max) * H);
    const color = v > 1000 ? "fill-red-500" : v > 500 ? "fill-amber-500" : "fill-emerald-500";
    return (
      <g key={i}>
        <title>{`${slotLabel}: p95 ${v.toFixed(0)}ms · ${counts[i] ?? 0} reqs`}</title>
        <rect x={i * barW} y={H - h} width={Math.max(1, barW - 0.5)} height={h} className={color} />
      </g>
    );
  });

  return (
    <svg
      width={W}
      height={H}
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={`Last 60 minutes of p95 latency, max ${max.toFixed(0)}ms`}
    >
      <title>p95 last 60 min · max {max.toFixed(0)}ms — hover bars for minute + count</title>
      {bars}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Sentry deep-link for SLO dashboard rows. Renders only when the build has
// VITE_SENTRY_ORG_SLUG and (optionally) VITE_SENTRY_PROJECT_SLUG configured.
// Falls back to org-level issue search if project slug is missing.
function SentryLink({
  route, method, query: customQuery, title, className,
}: { route?: string; method?: string; query?: string; title?: string; className?: string }) {
  const orgSlug = (import.meta as any).env?.VITE_SENTRY_ORG_SLUG as string | undefined;
  const projectSlug = (import.meta as any).env?.VITE_SENTRY_PROJECT_SLUG as string | undefined;
  if (!orgSlug) return null;
  const raw =
    customQuery
    ?? (route && method ? `url:"*${route}*" http.method:${method} is:unresolved` : null);
  if (!raw) return null;
  const query = encodeURIComponent(raw);
  const url = projectSlug
    ? `https://${orgSlug}.sentry.io/issues/?project=${projectSlug}&query=${query}`
    : `https://${orgSlug}.sentry.io/issues/?query=${query}`;
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className={className ?? "inline-flex items-center gap-1 text-primary hover:underline text-xs"}
      title={title ?? "Open in Sentry"}
    >
      <ExternalLink className="w-3 h-3" />
    </a>
  );
}

// ---------------------------------------------------------------------------
function Empty({ title }: { title: string }) {
  return (
    <Card><CardContent className="p-8 text-center text-sm text-muted-foreground">{title}</CardContent></Card>
  );
}
