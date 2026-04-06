"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { apiRequest } from "@/lib/queryClient";
import { api } from "@shared/routes";
import { ResponsiveDialog } from "@/components/ui/responsive-dialog";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Loader2, FileText, CheckCircle2, Landmark } from "lucide-react";
import { cn, normalizeAvatarUrl } from "@/lib/utils";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { getDisplayJobTitle } from "@/lib/job-display";
import { describeWorkerPayoutTiming, type PayoutPreview } from "@/lib/payout-timing";
import { useAuth } from "@/hooks/use-auth";
import { useProfile } from "@/hooks/use-profiles";

type JobPreviewPayload = {
  id: number;
  title?: string | null;
  trade?: string | null;
  company?: {
    companyName?: string | null;
    firstName?: string | null;
    lastName?: string | null;
  } | null;
};

type WorkerPreviewPayload = {
  id: number;
  firstName?: string | null;
  lastName?: string | null;
  avatarUrl?: string | null;
};

type TimesheetRow = {
  id: number;
  jobId: number;
  jobPreview?: JobPreviewPayload | null;
  status?: string | null;
  clockInTime?: string | null;
  clockOutTime?: string | null;
  totalHours?: string | number | null;
  adjustedHours?: string | number | null;
  hourlyRate: number;
  totalPay?: number | null;
  approvedAt?: string | null;
  companyNotes?: string | null;
  workerNotes?: string | null;
  paymentStatus?: string | null;
  paidAt?: string | null;
  timesheetType?: string | null;
  workerPreview?: WorkerPreviewPayload | null;
  businessOperatorPreview?: WorkerPreviewPayload | null;
  payoutPreview?: PayoutPreview | null;
};

type JobWithCompany = {
  id: number;
  title?: string | null;
  trade?: string | null;
  company?: {
    companyName?: string | null;
    firstName?: string | null;
    lastName?: string | null;
  } | null;
};

function parseHours(ts: TimesheetRow): number {
  const raw = ts.adjustedHours ?? ts.totalHours;
  const n = typeof raw === "string" ? parseFloat(raw) : Number(raw);
  return Number.isFinite(n) ? n : 0;
}

function companyLabel(job: JobWithCompany | undefined): string {
  const c = job?.company;
  if (!c) return "Company";
  if (c.companyName?.trim()) return c.companyName.trim();
  const name = [c.firstName, c.lastName].filter(Boolean).join(" ").trim();
  return name || "Company";
}

function workerDisplayName(w: WorkerPreviewPayload | null | undefined): string {
  if (!w) return "Worker";
  const name = [w.firstName, w.lastName].filter(Boolean).join(" ").trim();
  return name || "Worker";
}

function workerInitials(w: WorkerPreviewPayload | null | undefined): string {
  const parts = [w?.firstName, w?.lastName].filter(Boolean) as string[];
  if (parts.length === 0) return "?";
  return parts
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function payoutPollingActive(ts: TimesheetRow | undefined): boolean {
  if (!ts || ts.status !== "approved") return false;
  const ps = (ts.paymentStatus || "").toLowerCase();
  if (ps === "completed" || ps === "failed") return false;
  const p = ts.payoutPreview;
  if (!p) return ps === "pending" || ps === "processing";
  const st = (p.status || "").toLowerCase();
  if (st === "completed" || st === "failed") return false;
  return true;
}

export function TimesheetApprovalInvoiceDialog({
  timesheetId,
  open,
  onOpenChange,
}: {
  timesheetId: number | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const enabled = open && timesheetId != null && timesheetId > 0;
  const { user } = useAuth();
  const { data: viewer } = useProfile(user?.id);

  const { data: timesheet, isLoading: tsLoading, isError: tsError } = useQuery<TimesheetRow>({
    queryKey: ["/api/timesheets", timesheetId],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/timesheets/${timesheetId}`);
      if (!res.ok) throw new Error("Failed to load timesheet");
      return res.json();
    },
    enabled,
    refetchInterval: (q) => (payoutPollingActive(q.state.data) ? 5000 : false),
  });

  const needsJobFetch = enabled && !!timesheet?.jobId && !timesheet?.jobPreview;

  const { data: job, isLoading: jobLoading } = useQuery<JobWithCompany>({
    queryKey: [api.jobs.get.path.replace(":id", String(timesheet?.jobId ?? 0))],
    queryFn: async () => {
      const res = await apiRequest("GET", api.jobs.get.path.replace(":id", String(timesheet!.jobId)));
      if (!res.ok) throw new Error("Failed to load job");
      return res.json();
    },
    enabled: needsJobFetch,
  });

  const jobEffective = useMemo((): JobWithCompany | undefined => {
    const jp = timesheet?.jobPreview;
    if (jp?.id != null) {
      return {
        id: jp.id,
        title: jp.title,
        trade: jp.trade,
        company: jp.company ?? undefined,
      };
    }
    return job;
  }, [timesheet?.jobPreview, job]);

  const loading = tsLoading || (needsJobFetch && jobLoading);
  const hours = timesheet ? parseHours(timesheet) : 0;
  const rateDollars = timesheet ? timesheet.hourlyRate / 100 : 0;
  const payCents = timesheet?.totalPay ?? Math.round(hours * (timesheet?.hourlyRate ?? 0));
  const isApproved = timesheet?.status === "approved";
  const isMaterial = timesheet?.timesheetType === "material_invoice";
  const isCompanyViewer = viewer?.role === "company";

  const payoutCopy = useMemo(() => {
    if (!timesheet) return null;
    return describeWorkerPayoutTiming({
      timesheetStatus: timesheet.status,
      timesheetPaymentStatus: timesheet.paymentStatus,
      paidAt: timesheet.paidAt,
      payout: timesheet.payoutPreview ?? null,
    });
  }, [timesheet]);

  const payoutTechLine = payoutCopy?.mercuryLine ?? payoutCopy?.statusLine;

  const payoutLinkLine = useMemo(() => {
    if (!timesheet) return null;
    const parts = [
      `Timesheet #${timesheet.id}`,
      `Job #${timesheet.jobId}`,
      timesheet.payoutPreview?.mercuryPaymentId
        ? `Mercury payment ${timesheet.payoutPreview.mercuryPaymentId}`
        : null,
    ].filter(Boolean);
    return parts.join(" · ");
  }, [timesheet]);

  const footer = (
    <div className="flex justify-end w-full py-1">
      <Button className="min-w-[100px]" onClick={() => onOpenChange(false)} data-testid="timesheet-invoice-close">
        Close
      </Button>
    </div>
  );

  const totalLabel = isCompanyViewer ? "Worker earnings" : "Total to you";

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={onOpenChange}
      title={
        <span className="flex items-center gap-2">
          <FileText className="w-5 h-5 shrink-0 text-muted-foreground" />
          {isApproved ? "Payment invoice" : "Timesheet details"}
        </span>
      }
      description={
        isApproved
          ? isCompanyViewer
            ? "Labor invoice summary, worker on site, and Mercury payout status for this timesheet."
            : "Summary of this shift, who performed the work, and your payout status."
          : "Review this timesheet on file."
      }
      footer={footer}
      contentClassName="max-w-lg"
    >
      <div className="space-y-4">
        {loading && (
          <div className="flex justify-center py-12 text-muted-foreground gap-2">
            <Loader2 className="w-5 h-5 animate-spin" />
            <span>Loading…</span>
          </div>
        )}
        {tsError && !loading && (
          <p className="text-sm text-destructive text-center py-6">Could not load this timesheet.</p>
        )}
        {!loading && !tsError && timesheet && (
          <>
            <div
              className={cn(
                "rounded-xl border bg-card text-card-foreground shadow-md overflow-hidden relative isolate",
                isApproved && "ring-1 ring-green-600/25 dark:ring-green-500/25"
              )}
            >
              {/* Pattern only — no text nodes (avoids polluting scroll snapshot / a11y tree) */}
              <div
                className="pointer-events-none absolute inset-0 z-0 overflow-hidden rounded-xl select-none"
                aria-hidden
                style={{
                  backgroundImage: `repeating-linear-gradient(-32deg, transparent, transparent 14px, hsl(var(--border) / 0.14) 14px, hsl(var(--border) / 0.14) 15px)`,
                }}
              />
              <div className="relative z-10">
                <div className="bg-gradient-to-b from-muted/80 to-muted/40 px-4 py-3 border-b flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">Invoice</p>
                    <p className="text-lg font-bold tracking-tight mt-0.5">#{String(timesheet.id).padStart(6, "0")}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">Timesheet approval & earnings</p>
                  </div>
                  <div className="flex flex-col items-center gap-1 shrink-0 text-center max-w-[140px] sm:max-w-[180px]">
                    <Avatar className="h-12 w-12 border-2 border-background shadow-sm">
                      <AvatarImage src={normalizeAvatarUrl(timesheet.workerPreview?.avatarUrl) ?? undefined} alt="" />
                      <AvatarFallback className="text-sm">{workerInitials(timesheet.workerPreview)}</AvatarFallback>
                    </Avatar>
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground leading-tight">
                      Performed by
                    </p>
                    <p className="text-xs font-semibold leading-snug line-clamp-2">
                      {workerDisplayName(timesheet.workerPreview)}
                    </p>
                  </div>
                  {isApproved && (
                    <div className="flex items-center gap-1 text-green-700 dark:text-green-400 text-xs font-medium shrink-0 self-start">
                      <CheckCircle2 className="w-4 h-4" />
                      Approved
                    </div>
                  )}
                </div>
                <div className="px-4 py-3 space-y-1 text-sm">
                  <div className="flex justify-between gap-2">
                    <span className="text-muted-foreground">Client</span>
                    <span className="font-medium text-right">{companyLabel(jobEffective)}</span>
                  </div>
                  <div className="flex justify-between gap-2">
                    <span className="text-muted-foreground">Job</span>
                    <span className="font-medium text-right">
                      {jobEffective ? getDisplayJobTitle(jobEffective) : `Job #${timesheet.jobId}`}
                    </span>
                  </div>
                  {jobEffective?.trade && (
                    <div className="flex justify-between gap-2">
                      <span className="text-muted-foreground">Trade</span>
                      <span className="text-right">{jobEffective.trade}</span>
                    </div>
                  )}
                  {timesheet.businessOperatorPreview && (
                    <div className="flex justify-between gap-2 items-start">
                      <span className="text-muted-foreground shrink-0">Business operator</span>
                      <span className="flex items-center gap-2 min-w-0 justify-end text-right">
                        <Avatar className="h-8 w-8 border border-border shrink-0">
                          <AvatarImage
                            src={normalizeAvatarUrl(timesheet.businessOperatorPreview.avatarUrl) ?? undefined}
                            alt=""
                          />
                          <AvatarFallback className="text-[10px]">
                            {workerInitials(timesheet.businessOperatorPreview)}
                          </AvatarFallback>
                        </Avatar>
                        <span className="font-medium truncate">
                          {workerDisplayName(timesheet.businessOperatorPreview)}
                        </span>
                      </span>
                    </div>
                  )}
                  {timesheet.approvedAt && (
                    <div className="flex justify-between gap-2">
                      <span className="text-muted-foreground">Approved</span>
                      <span className="text-right tabular-nums">
                        {format(new Date(timesheet.approvedAt), "MMM d, yyyy · h:mm a")}
                      </span>
                    </div>
                  )}
                </div>
                <Separator />
                <div className="px-4 py-3 space-y-2 text-sm">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Line items</p>
                  {!isMaterial ? (
                    <>
                      <div className="flex justify-between gap-2">
                        <span className="text-muted-foreground">
                          Labor · {hours.toFixed(2)}h × ${rateDollars.toFixed(2)}/hr
                        </span>
                        <span className="tabular-nums font-medium">${(payCents / 100).toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between gap-2 text-xs text-muted-foreground">
                        <span>Worked</span>
                        <span className="tabular-nums">
                          {timesheet.clockInTime
                            ? format(new Date(timesheet.clockInTime), "MMM d, h:mm a")
                            : "—"}
                          {" → "}
                          {timesheet.clockOutTime
                            ? format(new Date(timesheet.clockOutTime), "MMM d, h:mm a")
                            : "—"}
                        </span>
                      </div>
                    </>
                  ) : (
                    <div className="flex justify-between gap-2">
                      <span className="text-muted-foreground">Materials / invoice</span>
                      <span className="tabular-nums font-medium">${(payCents / 100).toFixed(2)}</span>
                    </div>
                  )}
                </div>
                <div className="h-px w-full border-t border-dashed border-border/80 bg-transparent" />
                <div className="px-4 py-3 flex justify-between items-center bg-muted/40">
                  <span className="font-semibold">{totalLabel}</span>
                  <span className="text-xl font-bold tabular-nums tracking-tight">${(payCents / 100).toFixed(2)}</span>
                </div>
                {payoutCopy && (
                  <div className="px-4 py-3 text-xs border-t bg-muted/15 space-y-1.5">
                    <div className="flex items-center gap-2 text-muted-foreground font-semibold uppercase tracking-wide">
                      <Landmark className="w-3.5 h-3.5" />
                      {payoutCopy.title}
                    </div>
                    {payoutPollingActive(timesheet) && (
                      <p className="text-[10px] text-muted-foreground flex items-center gap-1.5">
                        <span className="inline-flex h-1.5 w-1.5 rounded-full bg-primary animate-pulse shrink-0" />
                        Refreshing Mercury status…
                      </p>
                    )}
                    {payoutLinkLine && (
                      <p className="font-mono text-[10px] text-muted-foreground break-words">{payoutLinkLine}</p>
                    )}
                    <p className="text-foreground/90 leading-relaxed">{payoutCopy.body}</p>
                    {payoutCopy.mercuryExpectation && (
                      <p className="text-muted-foreground leading-relaxed border-l-2 border-primary/25 pl-2">
                        {payoutCopy.mercuryExpectation}
                      </p>
                    )}
                    {payoutTechLine && (
                      <p className="font-mono text-[10px] text-muted-foreground break-words">{payoutTechLine}</p>
                    )}
                  </div>
                )}
              </div>
            </div>
            {timesheet.companyNotes?.trim() && (
              <div className="rounded-lg border bg-muted/20 px-3 py-2 text-xs">
                <p className="font-medium text-muted-foreground mb-1">Note from company</p>
                <p className="text-foreground whitespace-pre-wrap">{timesheet.companyNotes.trim()}</p>
              </div>
            )}
          </>
        )}
      </div>
    </ResponsiveDialog>
  );
}
