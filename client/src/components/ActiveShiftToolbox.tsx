import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Coffee, Pause, ShieldAlert, Loader2 } from "lucide-react";
import { ReportIncidentDialog } from "./ReportIncidentDialog";

/**
 * Floating tool-belt for the currently-clocked-in worker. Surfaces:
 *   1. Real-time break-compliance status (calls /api/timesheets/:id/break-status)
 *      — prompts at the 4h / 5h marks per CA §512 / WA / OR / etc.
 *   2. "Log meal break" / "Log rest break" / "I waived my meal break" actions
 *   3. "Report incident" (opens ReportIncidentDialog with shift context prefilled)
 *
 * Render this inside the worker's TodayPage / WorkerDashboard whenever there's
 * an active timesheet (clocked in, no clock-out time yet).
 */
interface ActiveShiftToolboxProps {
  timesheetId: number;
  jobId?: number | null;
  className?: string;
}

interface BreakStatus {
  hoursWorked: number;
  rules: { mealBreakRequiredAfterHours: number; mealBreakMinMinutes: number; restBreakMinutesPer: { perHours: number; minutes: number } | null };
  mealBreakRequired: boolean;
  mealBreakShortMinutes: number;
  restBreakShortCount: number;
  mealBreakPenaltyCents: number;
  restBreakPenaltyCents: number;
}

export function ActiveShiftToolbox({ timesheetId, jobId, className }: ActiveShiftToolboxProps) {
  const { toast } = useToast();
  const [submitting, setSubmitting] = useState(false);

  const { data: status, refetch } = useQuery<BreakStatus>({
    queryKey: ["/api/timesheets", timesheetId, "break-status"],
    queryFn: async () => {
      const res = await fetch(`/api/timesheets/${timesheetId}/break-status`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    refetchInterval: 5 * 60_000, // recheck every 5min during a shift
  });

  // Best-effort browser notification when a meal break becomes due.
  const [notified, setNotified] = useState(false);
  useEffect(() => {
    if (!status) return;
    if (notified) return;
    if (status.mealBreakRequired && status.mealBreakShortMinutes > 0) {
      setNotified(true);
      if ("Notification" in window && Notification.permission === "granted") {
        new Notification("Meal break required", {
          body: `You've worked ${status.hoursWorked.toFixed(1)}h — take a ${status.rules.mealBreakMinMinutes}-min unpaid meal break now.`,
          icon: "/favicon.png",
        });
      }
    }
  }, [status, notified]);

  const log = async (kind: "meal" | "rest", durationMinutes?: number) => {
    try {
      setSubmitting(true);
      await apiRequest("POST", `/api/timesheets/${timesheetId}/log-break`, { kind, durationMinutes });
      toast({ title: kind === "meal" ? "Meal break logged" : "Rest break logged" });
      refetch();
    } catch (err: any) {
      toast({ title: "Could not log break", description: err.message ?? "", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  const waiveMeal = async () => {
    try {
      setSubmitting(true);
      await apiRequest("POST", `/api/timesheets/${timesheetId}/log-break`, { waiveMeal: true });
      toast({ title: "Meal break waived for this shift" });
      refetch();
    } catch (err: any) {
      toast({ title: "Could not record waiver", description: err.message ?? "", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className={className}>
      {status?.mealBreakRequired && status.mealBreakShortMinutes > 0 && (
        <Alert className="mb-3 border-amber-300 bg-amber-50 dark:bg-amber-950/30">
          <Pause className="h-4 w-4 text-amber-700" />
          <AlertTitle>Take your meal break</AlertTitle>
          <AlertDescription className="text-xs">
            You've worked {status.hoursWorked.toFixed(1)}h. Your state requires an unpaid {status.rules.mealBreakMinMinutes}-minute meal break by hour {status.rules.mealBreakRequiredAfterHours}.
            Missing it adds {(status.mealBreakPenaltyCents / 100).toFixed(2)}/hr penalty pay automatically — but it's still better to take the break.
          </AlertDescription>
        </Alert>
      )}

      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={() => log("meal", 30)} disabled={submitting} className="gap-1">
          {submitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Coffee className="w-3.5 h-3.5" />}
          Log 30-min meal break
        </Button>
        <Button size="sm" variant="outline" onClick={() => log("rest")} disabled={submitting} className="gap-1">
          <Pause className="w-3.5 h-3.5" /> Log 10-min rest break
        </Button>
        {status?.hoursWorked != null && status.hoursWorked <= 6 && (
          <Button size="sm" variant="ghost" onClick={waiveMeal} disabled={submitting} className="gap-1 text-xs text-muted-foreground">
            Waive meal break (≤6h shift)
          </Button>
        )}
        <ReportIncidentDialog
          jobId={jobId ?? null}
          timesheetId={timesheetId}
          trigger={
            <Button size="sm" variant="outline" className="gap-1">
              <ShieldAlert className="w-3.5 h-3.5" /> Report incident
            </Button>
          }
        />
      </div>
    </div>
  );
}
