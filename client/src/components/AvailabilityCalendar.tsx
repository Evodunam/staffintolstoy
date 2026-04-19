import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, Calendar as CalendarIcon, Plane, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { DAY_NAMES, formatMinute, validateWindows, type WeeklyWindow } from "@shared/workerAvailability";

interface Window { id?: number; dayOfWeek: number; startMinute: number; endMinute: number }
interface Blackout { id: number; startsAt: string; endsAt: string; reason: string | null }

const TIME_OPTIONS = Array.from({ length: 96 }, (_, i) => {
  const m = i * 15;
  return { value: m, label: formatMinute(m) };
}).concat([{ value: 1440, label: "24:00" }]);

/**
 * Worker-facing availability editor. Two sections:
 *   - Recurring weekly windows (e.g. "Mon 9am-5pm").
 *   - Blackouts (PTO, vacation, sick) that override weekly windows.
 *
 * Posts the full canonical window list on every save (idempotent replace).
 * Empty list is meaningful — it means "no preference, always available", so we
 * surface that explicitly to avoid silently hiding workers from matching.
 */
export function AvailabilityCalendar() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery<{ windows: Window[]; blackouts: Blackout[] }>({
    queryKey: ["/api/worker/availability"],
    queryFn: async () => {
      const res = await fetch("/api/worker/availability", { credentials: "include" });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  const [draftWindows, setDraftWindows] = useState<Window[] | null>(null);
  const [savingWindows, setSavingWindows] = useState(false);
  const [showAddBlackout, setShowAddBlackout] = useState(false);

  if (isLoading) return <Loader2 className="w-5 h-5 animate-spin" />;
  if (!data) return null;

  const windows = draftWindows ?? data.windows;

  const addWindow = () => {
    const next = [...windows, { dayOfWeek: 1, startMinute: 9 * 60, endMinute: 17 * 60 }];
    setDraftWindows(next);
  };
  const removeWindow = (idx: number) => {
    const next = windows.filter((_, i) => i !== idx);
    setDraftWindows(next);
  };
  const updateWindow = (idx: number, patch: Partial<Window>) => {
    const next = windows.map((w, i) => (i === idx ? { ...w, ...patch } : w));
    setDraftWindows(next);
  };

  const saveWindows = async () => {
    const payload = windows.map((w) => ({ dayOfWeek: w.dayOfWeek, startMinute: w.startMinute, endMinute: w.endMinute }));
    const err = validateWindows(payload as WeeklyWindow[]);
    if (err) { toast({ title: "Fix errors first", description: err, variant: "destructive" }); return; }
    try {
      setSavingWindows(true);
      await apiRequest("PUT", "/api/worker/availability/windows", { windows: payload });
      toast({ title: "Availability saved" });
      setDraftWindows(null);
      qc.invalidateQueries({ queryKey: ["/api/worker/availability"] });
    } catch (e: any) {
      toast({ title: "Save failed", description: e.message ?? "", variant: "destructive" });
    } finally {
      setSavingWindows(false);
    }
  };

  const removeBlackout = async (id: number) => {
    if (!confirm("Remove this time off?")) return;
    await apiRequest("DELETE", `/api/worker/availability/blackouts/${id}`, undefined);
    qc.invalidateQueries({ queryKey: ["/api/worker/availability"] });
  };

  const dirty = draftWindows !== null && JSON.stringify(draftWindows) !== JSON.stringify(data.windows);

  return (
    <div className="space-y-6">
      <section>
        <header className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold flex items-center gap-2"><CalendarIcon className="w-4 h-4" /> Weekly availability</h3>
          <Button size="sm" variant="outline" onClick={addWindow} className="gap-1"><Plus className="w-3.5 h-3.5" /> Add window</Button>
        </header>

        {windows.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No windows configured — you'll be matched for any shift, day or night. Add windows to limit when companies can offer you work.
          </p>
        ) : (
          <div className="space-y-2">
            {windows.map((w, i) => (
              <Card key={i}>
                <CardContent className="p-3 flex items-center gap-2 flex-wrap">
                  <Select value={String(w.dayOfWeek)} onValueChange={(v) => updateWindow(i, { dayOfWeek: parseInt(v, 10) })}>
                    <SelectTrigger className="w-[130px]"><SelectValue /></SelectTrigger>
                    <SelectContent>{DAY_NAMES.map((d: string, di: number) => <SelectItem key={di} value={String(di)}>{d}</SelectItem>)}</SelectContent>
                  </Select>
                  <Select value={String(w.startMinute)} onValueChange={(v) => updateWindow(i, { startMinute: parseInt(v, 10) })}>
                    <SelectTrigger className="w-[100px]"><SelectValue /></SelectTrigger>
                    <SelectContent className="max-h-60">{TIME_OPTIONS.filter((t) => t.value < 1440).map((t) => <SelectItem key={t.value} value={String(t.value)}>{t.label}</SelectItem>)}</SelectContent>
                  </Select>
                  <span className="text-xs text-muted-foreground">to</span>
                  <Select value={String(w.endMinute)} onValueChange={(v) => updateWindow(i, { endMinute: parseInt(v, 10) })}>
                    <SelectTrigger className="w-[100px]"><SelectValue /></SelectTrigger>
                    <SelectContent className="max-h-60">{TIME_OPTIONS.map((t) => <SelectItem key={t.value} value={String(t.value)}>{t.label}</SelectItem>)}</SelectContent>
                  </Select>
                  <Button variant="ghost" size="sm" onClick={() => removeWindow(i)} className="text-destructive ml-auto"><Trash2 className="w-3.5 h-3.5" /></Button>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {dirty && (
          <div className="mt-3 flex gap-2">
            <Button size="sm" onClick={saveWindows} disabled={savingWindows}>{savingWindows ? "Saving…" : "Save changes"}</Button>
            <Button size="sm" variant="outline" onClick={() => setDraftWindows(null)}>Cancel</Button>
          </div>
        )}
      </section>

      <section>
        <header className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold flex items-center gap-2"><Plane className="w-4 h-4" /> Time off</h3>
          <Button size="sm" variant="outline" onClick={() => setShowAddBlackout(true)} className="gap-1"><Plus className="w-3.5 h-3.5" /> Add time off</Button>
        </header>

        {data.blackouts.length === 0 ? (
          <p className="text-xs text-muted-foreground">No upcoming time off scheduled.</p>
        ) : (
          <div className="space-y-2">
            {data.blackouts.map((b) => {
              const start = new Date(b.startsAt);
              const end = new Date(b.endsAt);
              const isPast = end < new Date();
              return (
                <Card key={b.id}>
                  <CardContent className="p-3 flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline gap-2">
                        <span className="font-medium text-sm">
                          {start.toLocaleDateString()} → {end.toLocaleDateString()}
                        </span>
                        {isPast && <Badge variant="secondary">Past</Badge>}
                      </div>
                      <p className="text-xs text-muted-foreground">{b.reason || "No reason given"}</p>
                    </div>
                    <Button variant="ghost" size="sm" onClick={() => removeBlackout(b.id)} className="text-destructive">
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}

        <AddBlackoutDialog open={showAddBlackout} onClose={() => setShowAddBlackout(false)} onAdded={() => qc.invalidateQueries({ queryKey: ["/api/worker/availability"] })} />
      </section>
    </div>
  );
}

function AddBlackoutDialog({ open, onClose, onAdded }: { open: boolean; onClose: () => void; onAdded: () => void }) {
  const { toast } = useToast();
  const today = new Date().toISOString().slice(0, 10);
  const [start, setStart] = useState(today);
  const [end, setEnd] = useState(today);
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    const startsAt = new Date(`${start}T00:00:00`);
    const endsAt = new Date(`${end}T23:59:59`);
    if (endsAt <= startsAt) { toast({ title: "End must be after start", variant: "destructive" }); return; }
    try {
      setSubmitting(true);
      await apiRequest("POST", "/api/worker/availability/blackouts", { startsAt, endsAt, reason });
      toast({ title: "Time off added" });
      onAdded(); onClose();
      setReason("");
    } catch (e: any) {
      toast({ title: "Failed", description: e.message ?? "", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>Add time off</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <Label htmlFor="bo-start">Start date</Label>
            <Input id="bo-start" type="date" value={start} onChange={(e) => setStart(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="bo-end">End date</Label>
            <Input id="bo-end" type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="bo-reason">Reason (optional)</Label>
            <Input id="bo-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Vacation, surgery, etc." />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={submitting}>{submitting ? "…" : "Add"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
