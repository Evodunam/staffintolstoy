import { useState } from "react";
import { useLocation } from "wouter";
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { useProfile } from "@/hooks/use-profiles";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Bell, ArrowLeft, CheckCircle, XCircle, DollarSign, MessageSquare, Briefcase, Clock, Loader2 } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { Navigation } from "@/components/Navigation";
import { useTranslation } from "react-i18next";
import { useTimesheetApprovalInvoice } from "@/contexts/TimesheetApprovalInvoiceContext";
import { tryOpenTimesheetApprovalInvoiceFromNotification } from "@/lib/worker-timesheet-notification";

const PAGE_SIZE = 20;

const TYPE_FILTER_OPTIONS: { value: string; labelKey: string }[] = [
  { value: "", labelKey: "filterAll" },
  { value: "application_approved,application_rejected,job_offer_received,job_application_accepted,job_application_rejected", labelKey: "filterApplications" },
  { value: "payment_received,timesheet_approved,timesheet_auto_approved", labelKey: "filterPayments" },
  { value: "new_job_in_territory,new_job_posted,new_job", labelKey: "filterJobs" },
  { value: "new_message", labelKey: "filterMessages" },
];

export default function NotificationsCenter() {
  const [, setLocation] = useLocation();
  const { openTimesheetApprovalInvoice } = useTimesheetApprovalInvoice();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { data: profile } = useProfile(user?.id);
  const { t } = useTranslation("translation", { keyPrefix: "notificationsCenter" });
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [typeFilter, setTypeFilter] = useState<string>("");

  const isCompany = profile?.role === "company";
  const homePath = isCompany ? "/company-dashboard" : "/dashboard";

  const typeFilterParam = typeFilter || undefined;

  const {
    data,
    isLoading: isLoadingNotifications,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: ["/api/notifications", profile?.id, "paginated", unreadOnly, typeFilterParam],
    enabled: !!profile?.id,
    initialPageParam: 0,
    getNextPageParam: (lastPage: any[], _allPages, lastOffset) =>
      lastPage.length === PAGE_SIZE ? lastOffset + PAGE_SIZE : undefined,
    queryFn: async ({ pageParam }) => {
      const u = new URL(`/api/notifications/${profile!.id}`, window.location.origin);
      u.searchParams.set("limit", String(PAGE_SIZE));
      u.searchParams.set("offset", String(pageParam));
      if (unreadOnly) u.searchParams.set("unreadOnly", "1");
      if (typeFilterParam) u.searchParams.set("type", typeFilterParam);
      const res = await fetch(u.pathname + u.search, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch notifications");
      return res.json();
    },
  });

  const notifications = data?.pages.flat() ?? [];
  const unreadCount = notifications.filter((n: any) => !n.isRead).length;

  const markAsReadMutation = useMutation({
    mutationFn: (id: number) => apiRequest("PATCH", `/api/notifications/${id}/read`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/notifications", profile?.id] });
    },
  });

  const markAllAsReadMutation = useMutation({
    mutationFn: () => apiRequest("PATCH", "/api/notifications/read-all", { profileId: profile?.id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/notifications", profile?.id] });
    },
  });

  const markAsRead = (id: number) => markAsReadMutation.mutate(id);
  const markAllAsRead = () => markAllAsReadMutation.mutate();

  const handleNotificationClick = (notif: { id: number; isRead?: boolean; url?: string; type?: string; data?: Record<string, unknown> }) => {
    if (!notif.isRead) markAsRead(notif.id);
    if (!isCompany && tryOpenTimesheetApprovalInvoiceFromNotification(notif, openTimesheetApprovalInvoice)) {
      return;
    }
    if (notif.url) {
      setLocation(notif.url);
      return;
    }
    const data = (notif.data || {}) as Record<string, unknown>;
    if (isCompany) {
      if (data.jobId) setLocation(`/company-dashboard/jobs?jobId=${data.jobId}`);
      else if (data.timesheetId) setLocation("/company-dashboard/timesheets");
      else if (notif.type === "new_message" && data.jobId) setLocation(`/company-dashboard/chats/${data.jobId}`);
      else setLocation(homePath);
      return;
    }
    if (notif.type === "new_job_in_territory" || notif.type === "new_job_posted") {
      setLocation(data.jobId ? `/jobs/${Number(data.jobId)}` : "/dashboard/find");
    } else if (notif.type === "application_approved" || notif.type === "job_application_accepted") {
      setLocation(data.jobId ? `/dashboard/jobs?jobId=${data.jobId}&tab=active` : "/dashboard/jobs");
    } else if (notif.type === "application_rejected" || notif.type === "job_application_rejected") {
      setLocation(data.jobId ? `/dashboard/jobs?jobId=${data.jobId}&tab=history` : "/dashboard/jobs");
    } else if (notif.type === "timesheet_approved" || notif.type === "payment_received") {
      setLocation(data.timesheetId ? `/dashboard/settings/payouts?timesheetId=${data.timesheetId}` : "/dashboard/settings/payouts");
    } else if (notif.type === "new_message") {
      setLocation(data.jobId ? `/dashboard/chats/${data.jobId}` : "/dashboard/chats");
    } else if (notif.type === "job_reminder" || notif.type === "job_start_reminder") {
      setLocation(data.jobId ? `/dashboard/calendar?jobId=${data.jobId}` : "/dashboard/calendar");
    } else {
      setLocation(homePath);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      {!isCompany && <Navigation />}
      <main className={`container max-w-2xl mx-auto px-4 py-6 pb-24 ${isCompany ? "pt-4" : ""}`}>
        <div className="flex items-center justify-between gap-4 mb-4">
          <Button variant="ghost" size="sm" onClick={() => setLocation(homePath)} className="gap-1">
            <ArrowLeft className="w-4 h-4" /> {t("back")}
          </Button>
          <h1 className="text-xl font-semibold">{t("title")}</h1>
          {unreadCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => markAllAsRead()}
              disabled={markAllAsReadMutation.isPending}
              data-testid="mark-all-read-button"
            >
              {t("markAllRead")}
            </Button>
          )}
        </div>
        <div className="flex items-center justify-between gap-3 mb-4 rounded-lg border border-border px-3 py-2">
          <Label htmlFor="notifications-unread-only" className="text-sm font-normal cursor-pointer flex-1">
            {t("unreadOnly")}
          </Label>
          <Switch
            id="notifications-unread-only"
            checked={unreadOnly}
            onCheckedChange={setUnreadOnly}
            data-testid="notifications-unread-only"
          />
        </div>
        <div className="flex items-center gap-2 mb-4">
          <Label className="text-sm text-muted-foreground whitespace-nowrap">{t("filterByType")}</Label>
          <Select value={typeFilter || "all"} onValueChange={(v) => setTypeFilter(v === "all" ? "" : v)} data-testid="notifications-type-filter">
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder={t("filterAll")} />
            </SelectTrigger>
            <SelectContent>
              {TYPE_FILTER_OPTIONS.map((opt) => (
                <SelectItem key={opt.value || "all"} value={opt.value || "all"}>
                  {t(opt.labelKey)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {isLoadingNotifications ? (
          <div className="py-12 text-center text-muted-foreground">{t("loading")}</div>
        ) : !notifications || notifications.length === 0 ? (
          <div className="py-12 text-center text-muted-foreground" data-testid="notifications-empty">
            <Bell className="w-12 h-12 mx-auto mb-3 opacity-50" />
            <p>{unreadOnly ? t("emptyUnread") : t("empty")}</p>
          </div>
        ) : (
          <ScrollArea className="h-[calc(100vh-180px)]">
            <div className="divide-y divide-border pr-2">
              {notifications.map((notif: any) => (
                <div
                  key={notif.id}
                  className={`py-3 px-2 cursor-pointer hover:bg-muted/50 transition-colors rounded-lg ${!notif.isRead ? "bg-primary/5" : ""}`}
                  onClick={() => handleNotificationClick(notif)}
                  data-testid={`notification-item-${notif.id}`}
                >
                  <div className="flex items-start gap-3">
                    <div className={`w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 ${
                      notif.type === "application_accepted" ? "bg-green-100 dark:bg-green-900/30" :
                      notif.type === "application_rejected" ? "bg-red-100 dark:bg-red-900/30" :
                      notif.type === "payment_received" || notif.type === "timesheet_approved" ? "bg-emerald-100 dark:bg-emerald-900/30" :
                      notif.type === "new_message" ? "bg-blue-100 dark:bg-blue-900/30" :
                      notif.type === "new_job" || notif.type === "new_job_posted" ? "bg-primary/10" :
                      "bg-muted"
                    }`}>
                      {notif.type === "application_accepted" && <CheckCircle className="w-4 h-4 text-green-600" />}
                      {notif.type === "application_rejected" && <XCircle className="w-4 h-4 text-red-600" />}
                      {(notif.type === "payment_received" || notif.type === "timesheet_approved") && <DollarSign className="w-4 h-4 text-emerald-600" />}
                      {notif.type === "new_message" && <MessageSquare className="w-4 h-4 text-blue-600" />}
                      {(notif.type === "new_job" || notif.type === "new_job_posted") && <Briefcase className="w-4 h-4 text-primary" />}
                      {notif.type === "job_reminder" && <Clock className="w-4 h-4 text-amber-600" />}
                      {!["application_accepted", "application_rejected", "payment_received", "timesheet_approved", "new_message", "new_job", "new_job_posted", "job_reminder"].includes(notif.type) && <Bell className="w-4 h-4 text-muted-foreground" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm ${!notif.isRead ? "font-medium" : ""}`}>{notif.title}</p>
                      <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">{notif.body}</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        {formatDistanceToNow(new Date(notif.createdAt), { addSuffix: true })}
                      </p>
                    </div>
                    {!notif.isRead && (
                      <div className="w-2 h-2 bg-primary rounded-full flex-shrink-0 mt-2" />
                    )}
                  </div>
                </div>
              ))}
            </div>
            {hasNextPage && (
              <div className="py-4 flex justify-center">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => fetchNextPage()}
                  disabled={isFetchingNextPage}
                  className="gap-1"
                >
                  {isFetchingNextPage ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                  {t("loadMore")}
                </Button>
              </div>
            )}
          </ScrollArea>
        )}
      </main>
    </div>
  );
}
