import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { format } from "date-fns";
import {
  ArrowLeft,
  DollarSign,
  Building2,
  MapPin,
  Phone,
  Mail,
  Send,
  Loader2,
  Users,
  Landmark,
  Info,
  Link2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Label } from "@/components/ui/label";
import { useState, useMemo, type MouseEvent } from "react";
import { normalizeAvatarUrl, cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, fetchJsonOrFallback } from "@/lib/queryClient";
import type { Timesheet, Profile, Job } from "@shared/schema";
import { useTranslation } from "react-i18next";
import { useProfile } from "@/hooks/use-profiles";
import { useAuth } from "@/hooks/use-auth";
import { displayJobTitle, getDisplayJobTitle } from "@/lib/job-display";
import { useTimesheetApprovalInvoice } from "@/contexts/TimesheetApprovalInvoiceContext";

type TimesheetWithDetails = Timesheet & { company: Profile; job: Job; worker?: Profile };

/** Sanitize raw job title embedded in server-built payout descriptions (e.g. held W-9 / bank setup). */
function formatPayoutListDescription(description: string | null | undefined): string {
  if (description == null || !String(description).trim()) return "–";
  const d = String(description);
  const heldW9 = "Held pending W-9 upload - ";
  const heldBank = "Held pending bank account setup - ";
  if (d.startsWith(heldW9)) return heldW9 + displayJobTitle(d.slice(heldW9.length), null);
  if (d.startsWith(heldBank)) return heldBank + displayJobTitle(d.slice(heldBank.length), null);
  return d;
}

/** Payout record (deposit to worker's linked Mercury/bank account) from GET /api/worker/payouts */
interface WorkerPayoutRow {
  id: number;
  workerId: number;
  jobId: number | null;
  timesheetId: number | null;
  amount: number;
  status: string;
  mercuryPaymentId: string | null;
  mercuryPaymentStatus: string | null;
  description: string | null;
  hoursWorked: string | null;
  hourlyRate: number | null;
  isInstantPayout: boolean | null;
  instantPayoutFee: number | null;
  originalAmount: number | null;
  processedAt: string | null;
  completedAt: string | null;
  errorMessage: string | null;
  createdAt: string;
}

/** Embeddable payment history content for menu right panel or standalone page. */
export function PaymentHistoryContent({ embedded = false }: { embedded?: boolean }) {
  const { t } = useTranslation("paymentHistory");
  const [, setLocation] = useLocation();
  const { openTimesheetApprovalInvoice } = useTimesheetApprovalInvoice();
  const { toast } = useToast();
  const { user } = useAuth();
  const { data: profile } = useProfile(user?.id);
  // Main view: "payments" = actual Mercury deposits to account (default); "by-job" = timesheet/job breakdown
  const [contentView, setContentView] = useState<"payments" | "by-job">("payments");
  const [selectedTab, setSelectedTab] = useState<string>("self");
  const viewAsTeam = selectedTab !== "self";
  const filterWorkerId: number | "all" =
    selectedTab === "self" ? (profile?.id ?? "all") : selectedTab === "all" ? "all" : Number(selectedTab);
  // "project" = group by job (default), "worker" = group by worker, "flat" = no grouping (only for by-job view)
  const [groupBy, setGroupBy] = useState<"project" | "worker" | "flat">("project");
  const groupByWorker = groupBy === "worker";

  const { data: workerTeam } = useQuery<{ id: number; name: string; ownerId: number } | null>({
    queryKey: ["/api/worker-team"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/worker-team");
      const data = await res.json();
      return data ?? null;
    },
    enabled: !!user && !!profile?.id && profile?.role === "worker",
  });

  const isTeamOwner = !!workerTeam && workerTeam.ownerId === profile?.id;
  const showTeamToggle = isTeamOwner;

  const { data: timesheets, isLoading } = useQuery<TimesheetWithDetails[]>({
    queryKey: ["/api/timesheets/worker", isTeamOwner ? "team" : "mine"],
    queryFn: async () => {
      const url = isTeamOwner ? "/api/timesheets/worker?team=1" : "/api/timesheets/worker";
      const res = await apiRequest("GET", url);
      return res.json();
    },
    enabled: !!profile?.id && profile?.role === "worker",
  });

  const { data: recipientPayouts, isLoading: payoutsLoading } = useQuery<WorkerPayoutRow[]>({
    queryKey: ["/api/worker/payouts"],
    queryFn: () => fetchJsonOrFallback<WorkerPayoutRow[]>("/api/worker/payouts", []),
    enabled: !!profile?.id && profile?.role === "worker" && !viewAsTeam,
  });

  const sendReminderMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/timesheets/send-payment-reminder");
      return res.json();
    },
    onSuccess: (data) => {
      if (data.sent > 0) {
        toast({
          title: t("reminderSent"),
          description: data.message,
        });
      } else {
        toast({
          title: t("noRemindersSent"),
          description: t("noUnpaidInvoicesFound"),
          variant: "default",
        });
      }
    },
    onError: () => {
      toast({
        title: t("failedToSendReminder"),
        description: t("pleaseTryAgainLater"),
        variant: "destructive",
      });
    },
  });

  const getPaymentStatus = (timesheet: Timesheet): { label: string; color: string; showContact: boolean } => {
    if (timesheet.status === "rejected") {
      return { label: t("rejected"), color: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400", showContact: false };
    }
    if (timesheet.status === "disputed") {
      return { label: t("disputed"), color: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400", showContact: true };
    }
    const paySt = timesheet.paymentStatus as string | null | undefined;
    if (paySt === "completed") {
      return { label: t("paid"), color: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400", showContact: false };
    }
    if (paySt === "processing") {
      return { label: t("transferring"), color: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400", showContact: false };
    }
    if (timesheet.status === "approved" && paySt !== "completed") {
      return { label: t("submitted"), color: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400", showContact: false };
    }
    if (timesheet.status === "pending" && timesheet.clockOutTime && timesheet.submittedAt) {
      return { label: t("pendingApproval"), color: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400", showContact: false };
    }
    if (timesheet.status === "pending" && timesheet.clockOutTime && timesheet.totalHours && !timesheet.submittedAt) {
      return { label: t("open"), color: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300", showContact: true };
    }
    return { label: t("inProgress"), color: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400", showContact: false };
  };

  const formatHours = (hours: string | null | undefined): string => {
    if (!hours) return "–";
    return parseFloat(hours).toFixed(2);
  };

  const formatPay = (cents: number | null | undefined): string => {
    if (cents == null) return "–";
    return `$${(cents / 100).toFixed(2)}`;
  };

  const formatRate = (centsPerHour: number | null | undefined): string => {
    if (centsPerHour == null) return "–";
    return `$${(centsPerHour / 100).toFixed(2)}/hr`;
  };

  const getPayoutStatusLabel = (status: string): string => {
    const map: Record<string, string> = {
      completed: t("paid"),
      processing: t("transferring"),
      sent: t("transferring"),
      pending: t("pending"),
      pending_w9: t("pending"),
      pending_bank_setup: t("pending"),
      failed: "Failed",
      returned: "Returned",
    };
    return map[status] ?? status;
  };

  const workerLabel = (ts: TimesheetWithDetails): string => {
    if (ts.worker) {
      return [ts.worker.firstName, ts.worker.lastName].filter(Boolean).join(" ") || ts.worker.email || `#${ts.workerId}`;
    }
    return [profile?.firstName, profile?.lastName].filter(Boolean).join(" ") || profile?.email || "–";
  };

  const filteredTimesheets = useMemo(() => {
    if (!timesheets) return [];
    if (filterWorkerId === "all") return timesheets;
    return timesheets.filter((ts) => ts.workerId === filterWorkerId);
  }, [timesheets, filterWorkerId]);

  const workerIds = useMemo(() => {
    if (!timesheets) return [];
    const ids = new Set(timesheets.map((ts) => ts.workerId));
    return Array.from(ids);
  }, [timesheets]);

  // Team members only (exclude current user – they use "You" tab, avoid duplicate)
  const workerOptions = useMemo(() => {
    const list: { id: number; label: string; avatarUrl?: string | null }[] = [];
    timesheets?.forEach((ts) => {
      if (ts.workerId === profile?.id) return;
      if (list.some((w) => w.id === ts.workerId)) return;
      const w = ts.worker as Profile | undefined;
      list.push({
        id: ts.workerId,
        label: workerLabel(ts),
        avatarUrl: w?.avatarUrl ?? undefined,
      });
    });
    return list.sort((a, b) => a.label.localeCompare(b.label));
  }, [timesheets, profile]);

  const totalEarnings = useMemo(
    () => filteredTimesheets.reduce((sum, t) => sum + (t.totalPay ?? 0), 0),
    [filteredTimesheets]
  );
  const totalHoursWorked = useMemo(
    () => filteredTimesheets.reduce((sum, t) => sum + (t.totalHours ? parseFloat(t.totalHours) : 0), 0),
    [filteredTimesheets]
  );
  const paidAmount = useMemo(() => {
    if (!viewAsTeam && recipientPayouts && recipientPayouts.length >= 0) {
      return recipientPayouts
        .filter((p) => p.status === "completed")
        .reduce((sum, p) => sum + (p.amount ?? 0), 0);
    }
    return filteredTimesheets
      .filter((t) => t.paymentStatus === "completed")
      .reduce((sum, t) => sum + (t.totalPay ?? 0), 0);
  }, [filteredTimesheets, viewAsTeam, recipientPayouts]);
  const pendingAmount = totalEarnings - paidAmount;

  // Actual Mercury deposits to this recipient (for "Payments to your account" view)
  const totalReceived = useMemo(
    () => (recipientPayouts ?? []).filter((p) => p.status === "completed").reduce((sum, p) => sum + (p.amount ?? 0), 0),
    [recipientPayouts]
  );
  const paymentsCount = (recipientPayouts ?? []).filter((p) => p.status === "completed").length;

  const hasOpenTimesheets = filteredTimesheets.some((t) => getPaymentStatus(t).showContact);

  const rowsByProject = useMemo(() => {
    if (groupBy !== "project") return null;
    const map = new Map<number, TimesheetWithDetails[]>();
    filteredTimesheets.forEach((ts) => {
      const jobId = ts.jobId ?? 0;
      if (!map.has(jobId)) map.set(jobId, []);
      map.get(jobId)!.push(ts);
    });
    return map;
  }, [filteredTimesheets, groupBy]);

  const rowsByWorker = useMemo(() => {
    if (groupBy !== "worker" || !viewAsTeam || !isTeamOwner) return null;
    const map = new Map<number, TimesheetWithDetails[]>();
    filteredTimesheets.forEach((ts) => {
      const id = ts.workerId;
      if (!map.has(id)) map.set(id, []);
      map.get(id)!.push(ts);
    });
    return map;
  }, [filteredTimesheets, groupBy, viewAsTeam, isTeamOwner]);

  // Map timesheetId -> payout for "Transfer date" column (when payout completed)
  const payoutByTimesheetId = useMemo(() => {
    const m = new Map<number, WorkerPayoutRow>();
    recipientPayouts?.forEach((p) => {
      if (p.timesheetId != null) m.set(p.timesheetId, p);
    });
    return m;
  }, [recipientPayouts]);

  const main = (
    <div className={embedded ? "space-y-6" : "container mx-auto px-4 py-6 pb-20 space-y-6"}>
      {/* View toggle: Payments to your account (actual Mercury deposits) | By job (timesheet breakdown) */}
      <Tabs value={contentView} onValueChange={(v) => setContentView(v as "payments" | "by-job")}>
        <TabsList className="grid w-full max-w-md grid-cols-2">
          <TabsTrigger value="payments" data-testid="payment-history-view-payments">
            <Landmark className="w-4 h-4 mr-2" />
            {t("depositsToYourAccount")}
          </TabsTrigger>
          <TabsTrigger value="by-job" data-testid="payment-history-view-by-job">
            <DollarSign className="w-4 h-4 mr-2" />
            {t("byJob")}
          </TabsTrigger>
        </TabsList>
      </Tabs>

      <Alert className="border-primary/20 bg-muted/30">
        <Info className="h-4 w-4" />
        <AlertTitle>{t("payWhenTitle")}</AlertTitle>
        <AlertDescription className="text-sm space-y-2">
          <p>{t("payWhenStandard")}</p>
          <p>{t("payWhenInstant")}</p>
          <p>{t("payWhenW9")}</p>
          <Button
            type="button"
            variant="ghost"
            className="h-auto p-0 text-primary underline hover:bg-transparent"
            onClick={() => setLocation("/dashboard/settings/payouts")}
          >
            {t("payWhenPayoutLink")}
          </Button>
        </AlertDescription>
      </Alert>

      {/* Summary cards: for "payments" = received/count; for "by-job" = earnings/paid/pending/hours */}
      {contentView === "payments" ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-4">
              <p className="text-xs text-muted-foreground">{t("totalReceived")}</p>
              <p className="text-2xl font-bold text-green-600 dark:text-green-400">{formatPay(totalReceived)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <p className="text-xs text-muted-foreground">{t("paymentsCount")}</p>
              <p className="text-2xl font-bold" data-testid="text-payments-count">{paymentsCount}</p>
            </CardContent>
          </Card>
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-4">
              <p className="text-xs text-muted-foreground">{t("totalEarnings")}</p>
              <p className="text-2xl font-bold text-green-600 dark:text-green-400" data-testid="text-total-earnings">{formatPay(totalEarnings)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <p className="text-xs text-muted-foreground">{t("paid")}</p>
              <p className="text-2xl font-bold" data-testid="text-paid-amount">{formatPay(paidAmount)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <p className="text-xs text-muted-foreground">{t("pending")}</p>
              <p className="text-2xl font-bold text-amber-600 dark:text-amber-400" data-testid="text-pending-amount">{formatPay(pendingAmount)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <p className="text-xs text-muted-foreground">{t("totalHours")}</p>
              <p className="text-2xl font-bold" data-testid="text-total-hours">{totalHoursWorked.toFixed(1)}</p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Worker filter tabs (by-job only; business operator) */}
      {contentView === "by-job" && showTeamToggle && (
        <div className="space-y-4">
          <Tabs value={selectedTab} onValueChange={setSelectedTab}>
            <TabsList withScrollControls className="mb-4">
              <TabsTrigger value="all" className="flex-shrink-0 gap-2 rounded-lg data-[state=active]:shadow-sm">
                <Users className="w-5 h-5 text-muted-foreground" />
                <span className="text-sm font-medium truncate">{t("allWorkers")}</span>
              </TabsTrigger>
              <TabsTrigger value="self" className="flex-shrink-0 gap-2 rounded-lg data-[state=active]:shadow-sm" data-testid="payment-history-tab-self">
                <Avatar className="w-6 h-6">
                  <AvatarImage src={normalizeAvatarUrl(profile?.avatarUrl) ?? undefined} />
                  <AvatarFallback className="text-[10px]">
                    {profile?.firstName?.[0]}
                    {profile?.lastName?.[0]}
                  </AvatarFallback>
                </Avatar>
                <span className="text-sm font-medium truncate">{t("you")}</span>
              </TabsTrigger>
              {workerOptions.map((w) => (
                <TabsTrigger key={w.id} value={String(w.id)} className="flex-shrink-0 gap-2 rounded-lg data-[state=active]:shadow-sm" data-testid={`payment-history-tab-${w.id}`}>
                  <Avatar className="w-6 h-6">
                    <AvatarImage src={normalizeAvatarUrl(w.avatarUrl) ?? undefined} />
                    <AvatarFallback className="text-[10px]">
                      {w.label
                        .split(/\s+/)
                        .map((n) => n[0])
                        .join("")
                        .slice(0, 2)
                        .toUpperCase() || "?"}
                    </AvatarFallback>
                  </Avatar>
                  <span className="text-sm font-medium truncate">{w.label}</span>
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          {(showTeamToggle || filteredTimesheets.length > 0) && contentView === "by-job" && (
            <div className="flex items-center gap-2 flex-wrap">
              <Label className="text-sm">{t("groupBy")}</Label>
              <div className="flex gap-1">
                <Button
                  type="button"
                  variant={groupBy === "project" ? "secondary" : "ghost"}
                  size="sm"
                  onClick={() => setGroupBy("project")}
                >
                  {t("groupByProject")}
                </Button>
                {isTeamOwner && viewAsTeam && (
                  <Button
                    type="button"
                    variant={groupBy === "worker" ? "secondary" : "ghost"}
                    size="sm"
                    onClick={() => setGroupBy("worker")}
                  >
                    {t("groupByWorker")}
                  </Button>
                )}
                <Button
                  type="button"
                  variant={groupBy === "flat" ? "secondary" : "ghost"}
                  size="sm"
                  onClick={() => setGroupBy("flat")}
                >
                  {t("flat")}
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {contentView === "by-job" && hasOpenTimesheets && (
        <Card className="bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800">
          <CardContent className="pt-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="font-medium text-amber-800 dark:text-amber-200">{t("unpaidTimesheets")}</p>
                <p className="text-sm text-amber-700 dark:text-amber-300">{t("sendReminderToCompanies")}</p>
              </div>
              <Button
                onClick={() => sendReminderMutation.mutate()}
                disabled={sendReminderMutation.isPending}
                className="bg-amber-600 hover:bg-amber-700 text-white"
                data-testid="button-send-reminder"
              >
                {sendReminderMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Send className="w-4 h-4 mr-2" />}
                {t("sendReminder")}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Payments to your account: actual Mercury deposits only, card format */}
      {contentView === "payments" && (
        <>
          {payoutsLoading ? (
            <Card>
              <CardContent className="py-8">
                <Skeleton className="h-8 w-full mb-4" />
                <Skeleton className="h-48 w-full" />
              </CardContent>
            </Card>
          ) : !recipientPayouts?.length ? (
            <Card>
              <CardContent className="py-12 text-center">
                <Landmark className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
                <h3 className="font-medium mb-2">{t("noDepositsYet")}</h3>
                <p className="text-sm text-muted-foreground">{t("depositsToYourAccountDescription")}</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {recipientPayouts.map((p) => {
                const tsId = p.timesheetId != null ? Number(p.timesheetId) : NaN;
                const canOpenInvoice = Number.isFinite(tsId) && tsId > 0;
                const canOpenJob = (p.jobId != null && p.jobId > 0) || canOpenInvoice;
                const goToJob = (e: MouseEvent<HTMLButtonElement>) => {
                  e.stopPropagation();
                  if (p.jobId != null && p.jobId > 0) {
                    setLocation(`/dashboard/jobs?jobId=${p.jobId}&tab=active`);
                  } else if (canOpenInvoice) {
                    setLocation(`/dashboard/jobs?timesheetId=${tsId}`);
                  }
                };
                return (
                  <Card
                    key={p.id}
                    role={canOpenInvoice ? "button" : undefined}
                    tabIndex={canOpenInvoice ? 0 : undefined}
                    className={cn(
                      "rounded-xl border bg-card shadow-sm hover:shadow-md transition-shadow",
                      canOpenInvoice && "cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    )}
                    onClick={() => {
                      if (canOpenInvoice) openTimesheetApprovalInvoice(tsId);
                    }}
                    onKeyDown={(e) => {
                      if (!canOpenInvoice) return;
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        openTimesheetApprovalInvoice(tsId);
                      }
                    }}
                  >
                    <CardContent className="py-4 px-4 sm:pt-[21px] sm:pb-[21px]">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0 space-y-1 flex-1">
                          <p className="font-medium">{formatPayoutListDescription(p.description)}</p>
                          <p className="text-sm text-muted-foreground">
                            {p.completedAt ? format(new Date(p.completedAt), "MMM d, yyyy") : format(new Date(p.createdAt), "MMM d, yyyy")}
                            {p.mercuryPaymentId && (
                              <span className="ml-2 font-mono text-xs">
                                {(p.mercuryPaymentId as string).length > 14
                                  ? (p.mercuryPaymentId as string).slice(0, 12) + "…"
                                  : p.mercuryPaymentId}
                              </span>
                            )}
                          </p>
                        </div>
                        <div className="flex items-center gap-1 flex-shrink-0">
                          {canOpenJob && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-9 w-9 shrink-0 text-muted-foreground hover:text-foreground"
                              aria-label={t("openRelatedJob")}
                              title={t("openRelatedJob")}
                              onClick={goToJob}
                            >
                              <Link2 className="h-4 w-4" />
                            </Button>
                          )}
                          <span className="text-lg font-bold text-green-600 dark:text-green-400 tabular-nums">
                            {formatPay(p.amount)}
                          </span>
                          <Badge
                            variant="secondary"
                            className={
                              p.status === "completed"
                                ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                                : p.status === "processing"
                                  ? "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400"
                                  : "bg-muted"
                            }
                          >
                            {getPayoutStatusLabel(p.status)}
                          </Badge>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* By job: timesheet breakdown in card format */}
      {contentView === "by-job" && (isLoading ? (
        <Card>
          <CardContent className="py-8">
            <Skeleton className="h-8 w-full mb-4" />
            <Skeleton className="h-64 w-full" />
          </CardContent>
        </Card>
      ) : filteredTimesheets.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <DollarSign className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="font-medium mb-2">{t("noPaymentHistory")}</h3>
            <p className="text-sm text-muted-foreground">{t("completedTimesheetsWillAppear")}</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {rowsByProject
            ? Array.from(rowsByProject.entries()).map(([jobId, rows]) => {
                const jobTitle = rows[0]?.job ? getDisplayJobTitle(rows[0].job) : "–";
                const companyName = rows[0]?.company ? (rows[0].company.companyName || [rows[0].company.firstName, rows[0].company.lastName].filter(Boolean).join(" ") || "–") : "–";
                const subTotal = rows.reduce((s, t) => s + (t.totalPay ?? 0), 0);
                const subHours = rows.reduce((s, t) => s + (t.totalHours ? parseFloat(t.totalHours) : 0), 0);
                return (
                  <Card key={jobId} className="rounded-xl border bg-card shadow-sm overflow-hidden">
                    <CardContent className="p-0">
                      <div className="px-4 py-3 bg-muted/50 border-b font-medium text-sm">
                        {jobTitle} · {companyName} · {formatPay(subTotal)} · {subHours.toFixed(1)} hrs
                      </div>
                      <div className="divide-y">
                        {rows.map((ts) => {
                          const payout = payoutByTimesheetId.get(ts.id);
                          const w = ts.worker as Profile | undefined;
                          const jobIdNum = ts.jobId != null ? Number(ts.jobId) : NaN;
                          const canJobLink = Number.isFinite(jobIdNum) && jobIdNum > 0;
                          return (
                            <div
                              key={ts.id}
                              role="button"
                              tabIndex={0}
                              className="px-4 py-3 flex flex-wrap items-center justify-between gap-2 cursor-pointer hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                              onClick={() => openTimesheetApprovalInvoice(ts.id)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter" || e.key === " ") {
                                  e.preventDefault();
                                  openTimesheetApprovalInvoice(ts.id);
                                }
                              }}
                            >
                              <div className="flex items-center gap-2 min-w-0">
                                <Avatar className="h-8 w-8 flex-shrink-0">
                                  <AvatarImage src={normalizeAvatarUrl(w?.avatarUrl ?? profile?.avatarUrl) ?? undefined} />
                                  <AvatarFallback className="text-xs">{workerLabel(ts).split(/\s+/).map((n) => n[0]).join("").slice(0, 2).toUpperCase() || "?"}</AvatarFallback>
                                </Avatar>
                                <div>
                                  <p className="font-medium truncate">{workerLabel(ts)}</p>
                                  <p className="text-xs text-muted-foreground">
                                    {format(new Date(ts.clockInTime), "MMM d")} · {formatHours(ts.totalHours)} hrs
                                    {payout?.completedAt && ` · ${t("paid")} ${format(new Date(payout.completedAt), "MMM d")}`}
                                  </p>
                                </div>
                              </div>
                              <div className="flex items-center gap-1 sm:gap-2">
                                {canJobLink && (
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    className="h-9 w-9 shrink-0 text-muted-foreground hover:text-foreground"
                                    aria-label={t("openRelatedJob")}
                                    title={t("openRelatedJob")}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setLocation(`/dashboard/jobs?jobId=${jobIdNum}&tab=active`);
                                    }}
                                  >
                                    <Link2 className="h-4 w-4" />
                                  </Button>
                                )}
                                <span className="font-medium">{formatPay(ts.totalPay)}</span>
                                <Badge className={cn(getPaymentStatus(ts).color, "text-[10px]")} variant="secondary">{getPaymentStatus(ts).label}</Badge>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </CardContent>
                  </Card>
                );
              })
            : rowsByWorker
              ? Array.from(rowsByWorker.entries()).map(([workerId, rows]) => {
                  const subTotal = rows.reduce((s, t) => s + (t.totalPay ?? 0), 0);
                  const subHours = rows.reduce((s, t) => s + (t.totalHours ? parseFloat(t.totalHours) : 0), 0);
                  const workerName = rows[0] ? workerLabel(rows[0]) : `#${workerId}`;
                  const w = rows[0]?.worker as Profile | undefined;
                  return (
                    <Card key={workerId} className="rounded-xl border bg-card shadow-sm overflow-hidden">
                      <CardContent className="p-0">
                        <div className="px-4 py-3 bg-muted/50 border-b font-medium text-sm flex items-center gap-2">
                          <Avatar className="h-6 w-6">
                            <AvatarImage src={normalizeAvatarUrl(w?.avatarUrl) ?? undefined} />
                            <AvatarFallback className="text-[10px]">{workerName.split(/\s+/).map((n) => n[0]).join("").slice(0, 2).toUpperCase() || "?"}</AvatarFallback>
                          </Avatar>
                          {workerName} · {formatPay(subTotal)} · {subHours.toFixed(1)} hrs
                        </div>
                        <div className="divide-y">
                          {rows.map((ts) => {
                            const payout = payoutByTimesheetId.get(ts.id);
                            const jobIdNum = ts.jobId != null ? Number(ts.jobId) : NaN;
                            const canJobLink = Number.isFinite(jobIdNum) && jobIdNum > 0;
                            return (
                              <div
                                key={ts.id}
                                role="button"
                                tabIndex={0}
                                className="px-4 py-3 flex flex-wrap items-center justify-between gap-2 cursor-pointer hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                                onClick={() => openTimesheetApprovalInvoice(ts.id)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter" || e.key === " ") {
                                    e.preventDefault();
                                    openTimesheetApprovalInvoice(ts.id);
                                  }
                                }}
                              >
                                <p className="font-medium truncate min-w-0 flex-1">
                                  {ts.job ? getDisplayJobTitle(ts.job) : "–"}
                                </p>
                                <div className="flex items-center gap-1 sm:gap-2 flex-shrink-0">
                                  {canJobLink && (
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="icon"
                                      className="h-9 w-9 shrink-0 text-muted-foreground hover:text-foreground"
                                      aria-label={t("openRelatedJob")}
                                      title={t("openRelatedJob")}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setLocation(`/dashboard/jobs?jobId=${jobIdNum}&tab=active`);
                                      }}
                                    >
                                      <Link2 className="h-4 w-4" />
                                    </Button>
                                  )}
                                  <span className="font-medium">{formatPay(ts.totalPay)}</span>
                                  <Badge className={cn(getPaymentStatus(ts).color, "text-[10px]")} variant="secondary">{getPaymentStatus(ts).label}</Badge>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </CardContent>
                    </Card>
                  );
                })
              : filteredTimesheets.map((ts) => {
                  const payout = payoutByTimesheetId.get(ts.id);
                  const jobIdNum = ts.jobId != null ? Number(ts.jobId) : NaN;
                  const canJobLink = Number.isFinite(jobIdNum) && jobIdNum > 0;
                  return (
                    <Card
                      key={ts.id}
                      role="button"
                      tabIndex={0}
                      className="rounded-xl border bg-card shadow-sm hover:shadow-md transition-shadow cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      onClick={() => openTimesheetApprovalInvoice(ts.id)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          openTimesheetApprovalInvoice(ts.id);
                        }
                      }}
                    >
                      <CardContent className="py-4 px-4">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="font-medium truncate">
                              {ts.job ? getDisplayJobTitle(ts.job) : "–"}
                            </p>
                            <p className="text-sm text-muted-foreground truncate">
                              {ts.company?.companyName || [ts.company?.firstName, ts.company?.lastName].filter(Boolean).join(" ") || "–"}
                            </p>
                            <p className="text-xs text-muted-foreground mt-1">
                              {format(new Date(ts.clockInTime), "MMM d, yyyy")} · {formatHours(ts.totalHours)} hrs
                              {payout?.completedAt && ` · ${t("transferDate")}: ${format(new Date(payout.completedAt), "MMM d")}`}
                            </p>
                          </div>
                          <div className="flex items-center gap-1 sm:gap-2 flex-shrink-0">
                            {canJobLink && (
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="h-9 w-9 shrink-0 text-muted-foreground hover:text-foreground"
                                aria-label={t("openRelatedJob")}
                                title={t("openRelatedJob")}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setLocation(`/dashboard/jobs?jobId=${jobIdNum}&tab=active`);
                                }}
                              >
                                <Link2 className="h-4 w-4" />
                              </Button>
                            )}
                            <span className="font-bold text-green-600 dark:text-green-400">{formatPay(ts.totalPay)}</span>
                            <Badge className={cn(getPaymentStatus(ts).color)} variant="secondary">{getPaymentStatus(ts).label}</Badge>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
        </div>
      ))}

    </div>
  );

  if (embedded) return <div className="pt-2 pb-4">{main}</div>;

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-50 bg-background border-b">
        <div className="container mx-auto px-4 py-3 flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => setLocation("/dashboard/menu")} data-testid="button-back">
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <h1 className="font-semibold text-lg">{t("title")}</h1>
        </div>
      </header>
      <main>{main}</main>
    </div>
  );
}

export default function PaymentHistory() {
  return <PaymentHistoryContent />;
}
