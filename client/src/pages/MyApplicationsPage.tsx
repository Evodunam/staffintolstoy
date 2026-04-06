import { useState } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { useProfile } from "@/hooks/use-profiles";
import { Button } from "@/components/ui/button";
import { Navigation } from "@/components/Navigation";
import { useTranslation } from "react-i18next";
import { ArrowLeft, Briefcase, CheckCircle, Clock, XCircle, Loader2, ExternalLink } from "lucide-react";
import { formatDistanceToNow, format } from "date-fns";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { Application, Job } from "@shared/schema";

export type ApplicationWithDetails = Application & {
  job: Job;
  teamMember?: { id: number; firstName: string | null; lastName: string | null; avatarUrl: string | null; hourlyRate: number | null } | null;
  company?: { id: number; companyName: string | null; phone: string | null; avatarUrl: string | null; companyLogo: string | null; firstName: string | null; lastName: string | null } | null;
};

const STATUS_FILTER = ["all", "pending", "accepted", "rejected"] as const;

export default function MyApplicationsPage() {
  const [, setLocation] = useLocation();
  const { user } = useAuth();
  const { data: profile } = useProfile(user?.id);
  const { t } = useTranslation("translation", { keyPrefix: "myApplications" });
  const [statusFilter, setStatusFilter] = useState<typeof STATUS_FILTER[number]>("all");

  const { data: applications = [], isLoading } = useQuery<ApplicationWithDetails[]>({
    queryKey: ["/api/applications/worker", profile?.id],
    enabled: !!profile?.id,
    queryFn: async () => {
      const res = await fetch(`/api/applications/worker/${profile!.id}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch applications");
      return res.json();
    },
  });

  const filtered =
    statusFilter === "all"
      ? applications
      : applications.filter((a) => a.status === statusFilter);

  const pendingCount = applications.filter((a) => a.status === "pending").length;
  const acceptedCount = applications.filter((a) => a.status === "accepted").length;
  const rejectedCount = applications.filter((a) => a.status === "rejected").length;

  const openJob = (jobId: number) => {
    setLocation(`/jobs/${jobId}`);
  };

  return (
    <div className="min-h-screen bg-background">
      <Navigation />
      <main className="container max-w-2xl mx-auto px-4 py-6 pb-24">
        <div className="flex items-center justify-between gap-4 mb-4">
          <Button variant="ghost" size="sm" onClick={() => setLocation("/dashboard")} className="gap-1" data-testid="applications-back">
            <ArrowLeft className="w-4 h-4" /> {t("back")}
          </Button>
          <h1 className="text-xl font-semibold">{t("title")}</h1>
        </div>
        <p className="text-sm text-muted-foreground mb-4">{t("subtitle")}</p>

        {isLoading ? (
          <div className="py-12 flex items-center justify-center gap-2 text-muted-foreground" data-testid="applications-loading">
            <Loader2 className="w-5 h-5 animate-spin" /> {t("loading")}
          </div>
        ) : (
          <>
            <Tabs value={statusFilter} onValueChange={(v) => setStatusFilter(v as typeof STATUS_FILTER[number])} className="mb-4">
              <TabsList className="grid w-full grid-cols-4">
                <TabsTrigger value="all" className="gap-1 text-xs sm:text-sm">
                  {t("filterAll")}
                  <span className="text-muted-foreground">({applications.length})</span>
                </TabsTrigger>
                <TabsTrigger value="pending" className="gap-1 text-xs sm:text-sm">
                  {t("filterPending")}
                  {pendingCount > 0 && <span className="text-amber-600 dark:text-amber-400">({pendingCount})</span>}
                </TabsTrigger>
                <TabsTrigger value="accepted" className="gap-1 text-xs sm:text-sm">
                  {t("filterAccepted")}
                  {acceptedCount > 0 && <span className="text-green-600 dark:text-green-400">({acceptedCount})</span>}
                </TabsTrigger>
                <TabsTrigger value="rejected" className="gap-1 text-xs sm:text-sm">
                  {t("filterRejected")}
                  {rejectedCount > 0 && <span className="text-muted-foreground">({rejectedCount})</span>}
                </TabsTrigger>
              </TabsList>
              <TabsContent value={statusFilter} className="mt-4">
                {filtered.length === 0 ? (
                  <div className="py-12 text-center text-muted-foreground" data-testid="applications-empty">
                    <Briefcase className="w-12 h-12 mx-auto mb-3 opacity-50" />
                    <p>{statusFilter === "all" ? t("empty") : t("emptyFiltered")}</p>
                    <Button variant="link" className="mt-2" onClick={() => setLocation("/dashboard/find")}>
                      {t("browseJobs")}
                    </Button>
                  </div>
                ) : (
                  <ScrollArea className="h-[calc(100vh-320px)] pr-2">
                    <div className="space-y-2">
                      {filtered.map((app) => (
                        <div
                          key={app.id}
                          className="rounded-lg border border-border bg-card p-4 hover:bg-muted/30 transition-colors cursor-pointer"
                          onClick={() => openJob(app.jobId)}
                          data-testid={`application-${app.id}`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0 flex-1">
                              <p className="font-medium truncate">{app.job?.title ?? "Job"}</p>
                              {app.company?.companyName && (
                                <p className="text-sm text-muted-foreground truncate">{app.company.companyName}</p>
                              )}
                              <p className="text-xs text-muted-foreground mt-1">
                                {t("appliedAt")} {formatDistanceToNow(new Date(app.createdAt), { addSuffix: true })}
                                {" · "}
                                {format(new Date(app.createdAt), "MMM d, yyyy")}
                              </p>
                            </div>
                            <div className="flex items-center gap-2 flex-shrink-0">
                              {app.status === "pending" && (
                                <Badge variant="secondary" className="gap-1 bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
                                  <Clock className="w-3 h-3" /> {t("statusPending")}
                                </Badge>
                              )}
                              {app.status === "accepted" && (
                                <Badge variant="secondary" className="gap-1 bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300">
                                  <CheckCircle className="w-3 h-3" /> {t("statusAccepted")}
                                </Badge>
                              )}
                              {app.status === "rejected" && (
                                <Badge variant="secondary" className="gap-1 bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300">
                                  <XCircle className="w-3 h-3" /> {t("statusRejected")}
                                </Badge>
                              )}
                              <ExternalLink className="w-4 h-4 text-muted-foreground" />
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                )}
              </TabsContent>
            </Tabs>
          </>
        )}
      </main>
    </div>
  );
}
