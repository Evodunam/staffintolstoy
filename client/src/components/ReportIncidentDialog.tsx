import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { ShieldAlert } from "lucide-react";

interface Props {
  /** Optional job context (auto-attaches to the report). */
  jobId?: number | null;
  /** Optional active timesheet. */
  timesheetId?: number | null;
  /** Trigger element override; defaults to a discreet button. */
  trigger?: React.ReactNode;
}

const INJURY_TYPES = [
  ["other", "Other"],
  ["cut", "Cut / laceration"],
  ["burn", "Burn"],
  ["fracture", "Fracture / break"],
  ["sprain", "Sprain / strain"],
  ["fall", "Fall"],
  ["struck_by", "Struck by object"],
  ["caught_in", "Caught in / between"],
  ["electrical", "Electrical shock"],
  ["chemical", "Chemical exposure"],
  ["heat_illness", "Heat illness"],
  ["cold_illness", "Cold illness"],
] as const;

const SEVERITIES = [
  ["near_miss", "Near miss (no injury)"],
  ["first_aid", "First aid only"],
  ["medical_treatment", "Medical treatment beyond first aid"],
  ["restricted_duty", "Restricted duty"],
  ["days_away", "Days away from work"],
  ["fatality", "Fatality"],
] as const;

/**
 * In-app worker/company incident reporting dialog.
 * Prefills jobId + timesheetId if the user is currently clocked in.
 * Posts to /api/safety-incidents which auto-flags OSHA-recordable severities.
 */
export function ReportIncidentDialog({ jobId, timesheetId, trigger }: Props) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [description, setDescription] = useState("");
  const [injuryType, setInjuryType] = useState("other");
  const [severity, setSeverity] = useState("first_aid");
  const [locationDescription, setLocationDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (description.trim().length < 20) {
      toast({ title: "Describe what happened (≥20 chars)", variant: "destructive" });
      return;
    }
    try {
      setSubmitting(true);
      // Capture geolocation if available (best-effort).
      const coords = await new Promise<{ latitude?: number; longitude?: number }>((resolve) => {
        if (!navigator.geolocation) return resolve({});
        navigator.geolocation.getCurrentPosition(
          (pos) => resolve({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }),
          () => resolve({}),
          { timeout: 4000, maximumAge: 60_000 },
        );
      });
      const res = await apiRequest("POST", "/api/safety-incidents", {
        jobId, timesheetId, description: description.trim(),
        injuryType, severity, locationDescription: locationDescription.trim() || undefined,
        occurredAt: new Date().toISOString(),
        latitude: coords.latitude, longitude: coords.longitude,
      });
      const data = await res.json();
      toast({
        title: "Incident reported",
        description: data?.oshaRecordable
          ? "Marked as OSHA-recordable. Our safety team will follow up."
          : "Thanks. Our team will review it.",
      });
      setOpen(false);
      setDescription(""); setInjuryType("other"); setSeverity("first_aid"); setLocationDescription("");
    } catch (err: any) {
      toast({ title: "Could not file incident", description: err.message ?? "", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button variant="outline" size="sm" className="gap-1">
            <ShieldAlert className="w-3.5 h-3.5" /> Report incident
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Report a safety incident</DialogTitle>
          <DialogDescription>Use this for injuries, near-misses, or unsafe conditions on the worksite.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label htmlFor="inc-desc">What happened?</Label>
            <Textarea id="inc-desc" rows={4} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Describe the incident, where on the body, what activity you were doing." />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs">Type</Label>
              <Select value={injuryType} onValueChange={setInjuryType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{INJURY_TYPES.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Severity</Label>
              <Select value={severity} onValueChange={setSeverity}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{SEVERITIES.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label htmlFor="inc-loc" className="text-xs">Location detail (optional)</Label>
            <Input id="inc-loc" value={locationDescription} onChange={(e) => setLocationDescription(e.target.value)} placeholder="e.g. 2nd floor, near scaffolding" />
          </div>
          <p className="text-xs text-muted-foreground">
            If this is a life-threatening emergency, call 911 first. This form notifies our safety team and the company; it is NOT a substitute for emergency services.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={submitting}>Cancel</Button>
          <Button onClick={submit} disabled={submitting || description.trim().length < 20}>
            {submitting ? "Filing…" : "File report"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
