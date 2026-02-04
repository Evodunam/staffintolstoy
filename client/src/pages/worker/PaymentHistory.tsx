import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { format } from "date-fns";
import { ArrowLeft, DollarSign, Clock, Building2, MapPin, Phone, Mail, ChevronDown, ChevronUp, Send, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import type { Timesheet, Profile, Job } from "@shared/schema";
import { useTranslation } from "react-i18next";

type TimesheetWithDetails = Timesheet & { company: Profile; job: Job };

/** Embeddable payment history content for menu right panel or standalone page. */
export function PaymentHistoryContent({ embedded = false }: { embedded?: boolean }) {
  const { t } = useTranslation("paymentHistory");
  const [, setLocation] = useLocation();
  const [expandedProjects, setExpandedProjects] = useState<Set<number>>(new Set());
  const { toast } = useToast();

  const { data: timesheets, isLoading } = useQuery<TimesheetWithDetails[]>({
    queryKey: ["/api/timesheets/worker"],
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

  const toggleProject = (jobId: number) => {
    setExpandedProjects(prev => {
      const next = new Set(prev);
      if (next.has(jobId)) {
        next.delete(jobId);
      } else {
        next.add(jobId);
      }
      return next;
    });
  };

  const getPaymentStatus = (timesheet: Timesheet): { label: string; color: string; showContact: boolean } => {
    // Payment status mapping per scratchpad:
    // - "completed" = Paid
    // - "processing" = Transferring  
    // - "approved" = Submitted (awaiting payment)
    // - "pending" = Pending Approval (timesheet submitted, awaiting company approval)
    // - "open" = unpaid but timesheet calculated (clocked out, hours calculated, but not yet approved)
    
    // Handle disputed/rejected first (special cases)
    if (timesheet.status === "rejected") {
      return { label: t("rejected"), color: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400", showContact: false };
    }
    if (timesheet.status === "disputed") {
      return { label: t("disputed"), color: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400", showContact: true };
    }
    
    // Payment completed
    if (timesheet.paymentStatus === "completed") {
      return { label: t("paid"), color: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400", showContact: false };
    }
    
    // Payment in progress
    if (timesheet.paymentStatus === "processing") {
      return { label: t("transferring"), color: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400", showContact: false };
    }
    
    // Approved but not yet paid - Submitted status
    if (timesheet.status === "approved" && timesheet.paymentStatus !== "completed") {
      return { label: t("submitted"), color: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400", showContact: false };
    }
    
    // Pending approval - work completed, timesheet submitted, awaiting company approval
    if (timesheet.status === "pending" && timesheet.clockOutTime && timesheet.submittedAt) {
      return { label: t("pendingApproval"), color: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400", showContact: false };
    }
    
    // Open - clocked out with hours calculated but not yet submitted for approval
    // This is the state where company contact should be shown
    if (timesheet.status === "pending" && timesheet.clockOutTime && timesheet.totalHours && !timesheet.submittedAt) {
      return { label: t("open"), color: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300", showContact: true };
    }
    
    // Default - still in progress (clocked in but not out yet)
    return { label: t("inProgress"), color: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400", showContact: false };
  };

  const formatHours = (hours: string | null | undefined): string => {
    if (!hours) return "-";
    const h = parseFloat(hours);
    return h.toFixed(2);
  };

  const formatPay = (cents: number | null | undefined): string => {
    if (!cents) return "-";
    return `$${(cents / 100).toFixed(2)}`;
  };

  const groupedTimesheets = timesheets?.reduce((acc, ts) => {
    const jobId = ts.jobId;
    if (!acc[jobId]) {
      acc[jobId] = {
        job: ts.job,
        company: ts.company,
        timesheets: [],
        totalHours: 0,
        totalPay: 0,
      };
    }
    acc[jobId].timesheets.push(ts);
    if (ts.totalHours) {
      acc[jobId].totalHours += parseFloat(ts.totalHours);
    }
    if (ts.totalPay) {
      acc[jobId].totalPay += ts.totalPay;
    }
    return acc;
  }, {} as Record<number, { job: Job; company: Profile; timesheets: TimesheetWithDetails[]; totalHours: number; totalPay: number }>);

  const projects = groupedTimesheets ? Object.values(groupedTimesheets).sort((a, b) => {
    const aLatest = Math.max(...a.timesheets.map(t => new Date(t.createdAt || 0).getTime()));
    const bLatest = Math.max(...b.timesheets.map(t => new Date(t.createdAt || 0).getTime()));
    return bLatest - aLatest;
  }) : [];

  const totalEarnings = projects.reduce((sum, p) => sum + p.totalPay, 0);
  const totalHoursWorked = projects.reduce((sum, p) => sum + p.totalHours, 0);
  const paidAmount = timesheets?.filter(t => t.paymentStatus === "completed").reduce((sum, t) => sum + (t.totalPay || 0), 0) || 0;
  const pendingAmount = totalEarnings - paidAmount;
  
  const hasOpenTimesheets = timesheets?.some(t => {
    const status = getPaymentStatus(t);
    return status.showContact;
  }) || false;

  const main = (
    <div className={embedded ? "space-y-6" : "container mx-auto px-4 py-6 pb-20 space-y-6"}>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-4">
              <p className="text-xs text-muted-foreground">{t("totalEarnings")}</p>
              <p className="text-2xl font-bold text-green-600 dark:text-green-400" data-testid="text-total-earnings">
                {formatPay(totalEarnings)}
              </p>
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
              <p className="text-2xl font-bold text-amber-600 dark:text-amber-400" data-testid="text-pending-amount">
                {formatPay(pendingAmount)}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <p className="text-xs text-muted-foreground">{t("totalHours")}</p>
              <p className="text-2xl font-bold" data-testid="text-total-hours">{totalHoursWorked.toFixed(1)}</p>
            </CardContent>
          </Card>
        </div>

        {hasOpenTimesheets && (
          <Card className="bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800">
            <CardContent className="pt-4">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="font-medium text-amber-800 dark:text-amber-200">{t("unpaidTimesheets")}</p>
                  <p className="text-sm text-amber-700 dark:text-amber-300">
                    {t("sendReminderToCompanies")}
                  </p>
                </div>
                <Button
                  onClick={() => sendReminderMutation.mutate()}
                  disabled={sendReminderMutation.isPending}
                  className="bg-amber-600 hover:bg-amber-700 text-white"
                  data-testid="button-send-reminder"
                >
                  {sendReminderMutation.isPending ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <Send className="w-4 h-4 mr-2" />
                  )}
                  {t("sendReminder")}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {isLoading ? (
          <div className="space-y-4">
            {[1, 2, 3].map((i) => (
              <Card key={i}>
                <CardHeader>
                  <Skeleton className="h-6 w-48" />
                </CardHeader>
                <CardContent>
                  <Skeleton className="h-32 w-full" />
                </CardContent>
              </Card>
            ))}
          </div>
        ) : projects.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <DollarSign className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
              <h3 className="font-medium mb-2">{t("noPaymentHistory")}</h3>
              <p className="text-sm text-muted-foreground">
                {t("completedTimesheetsWillAppear")}
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {projects.map((project) => {
              const isExpanded = expandedProjects.has(project.job.id);
              const projectHasOpenTimesheets = project.timesheets.some(t => getPaymentStatus(t).showContact);
              
              return (
                <Card key={project.job.id} data-testid={`card-project-${project.job.id}`}>
                  <Collapsible open={isExpanded} onOpenChange={() => toggleProject(project.job.id)}>
                    <CollapsibleTrigger asChild>
                      <CardHeader className="cursor-pointer hover-elevate" data-testid={`button-expand-project-${project.job.id}`}>
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex-1 min-w-0">
                            <CardTitle className="text-base truncate" data-testid={`text-project-title-${project.job.id}`}>{project.job.title}</CardTitle>
                            <div className="flex items-center gap-2 text-sm text-muted-foreground mt-1">
                              <Building2 className="w-3.5 h-3.5 flex-shrink-0" />
                              <span className="truncate" data-testid={`text-company-name-${project.job.id}`}>{project.company.companyName || `${project.company.firstName} ${project.company.lastName}`}</span>
                            </div>
                            <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
                              <MapPin className="w-3 h-3 flex-shrink-0" />
                              <span className="truncate">{project.job.city}, {project.job.state}</span>
                            </div>
                          </div>
                          <div className="text-right flex-shrink-0">
                            <p className="font-semibold text-green-600 dark:text-green-400" data-testid={`text-project-total-${project.job.id}`}>{formatPay(project.totalPay)}</p>
                            <p className="text-xs text-muted-foreground" data-testid={`text-project-hours-${project.job.id}`}>{project.totalHours.toFixed(1)} {t("hours")}</p>
                            <div className="flex items-center justify-end mt-1">
                              {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                            </div>
                          </div>
                        </div>
                      </CardHeader>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <CardContent className="pt-0 space-y-4">
                        {projectHasOpenTimesheets && (
                          <div className="bg-secondary/50 rounded-lg p-3 space-y-2" data-testid={`contact-info-${project.job.id}`}>
                            <p className="text-xs font-medium text-muted-foreground">{t("companyContact")}</p>
                            <div className="flex flex-wrap gap-3 text-sm">
                              {project.company.email && (
                                <a href={`mailto:${project.company.email}`} className="flex items-center gap-1.5 text-primary hover:underline" data-testid={`link-email-${project.job.id}`}>
                                  <Mail className="w-3.5 h-3.5" />
                                  {project.company.email}
                                </a>
                              )}
                              {project.company.phone && (
                                <a href={`tel:${project.company.phone}`} className="flex items-center gap-1.5 text-primary hover:underline" data-testid={`link-phone-${project.job.id}`}>
                                  <Phone className="w-3.5 h-3.5" />
                                  {project.company.phone}
                                </a>
                              )}
                            </div>
                          </div>
                        )}
                        
                        {/* Mobile List View */}
                        <div className="md:hidden space-y-2 -mx-6 px-6">
                          {project.timesheets.map((ts) => {
                            const status = getPaymentStatus(ts);
                            return (
                              <Card key={ts.id} className="border-border" data-testid={`row-timesheet-${ts.id}`}>
                                <CardContent className="p-3">
                                  <div className="flex items-start justify-between gap-3 mb-2">
                                    <div className="flex-1 min-w-0">
                                      <p className="font-medium text-sm" data-testid={`text-date-${ts.id}`}>
                                        {format(new Date(ts.clockInTime), "MMM d, yyyy")}
                                      </p>
                                      <p className="text-xs text-muted-foreground" data-testid={`text-time-${ts.id}`}>
                                        {format(new Date(ts.clockInTime), "h:mm a")}
                                        {ts.clockOutTime && (
                                          <> - {format(new Date(ts.clockOutTime), "h:mm a")}</>
                                        )}
                                      </p>
                                    </div>
                                    <Badge className={status.color} variant="secondary" data-testid={`text-status-${ts.id}`}>
                                      {status.label}
                                    </Badge>
                                  </div>
                                  <div className="flex items-center justify-between pt-2 border-t">
                                    <div>
                                      <p className="text-xs text-muted-foreground">{t("hours")}</p>
                                      <p className="font-medium text-sm" data-testid={`text-hours-${ts.id}`}>{formatHours(ts.totalHours)}</p>
                                    </div>
                                    <div className="text-right">
                                      <p className="text-xs text-muted-foreground">{t("amount")}</p>
                                      <p className="font-medium text-sm" data-testid={`text-amount-${ts.id}`}>{formatPay(ts.totalPay)}</p>
                                    </div>
                                  </div>
                                </CardContent>
                              </Card>
                            );
                          })}
                        </div>

                        {/* Desktop Table View */}
                        <div className="hidden md:block overflow-x-auto -mx-6 px-6">
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>{t("date")}</TableHead>
                                <TableHead>{t("time")}</TableHead>
                                <TableHead className="text-right">{t("hours")}</TableHead>
                                <TableHead className="text-right">{t("amount")}</TableHead>
                                <TableHead className="text-right">{t("status")}</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {project.timesheets.map((ts) => {
                                const status = getPaymentStatus(ts);
                                return (
                                  <TableRow key={ts.id} data-testid={`row-timesheet-${ts.id}`}>
                                    <TableCell className="font-medium whitespace-nowrap" data-testid={`text-date-${ts.id}`}>
                                      {format(new Date(ts.clockInTime), "MMM d, yyyy")}
                                    </TableCell>
                                    <TableCell className="whitespace-nowrap text-muted-foreground" data-testid={`text-time-${ts.id}`}>
                                      {format(new Date(ts.clockInTime), "h:mm a")}
                                      {ts.clockOutTime && (
                                        <> - {format(new Date(ts.clockOutTime), "h:mm a")}</>
                                      )}
                                    </TableCell>
                                    <TableCell className="text-right" data-testid={`text-hours-${ts.id}`}>{formatHours(ts.totalHours)}</TableCell>
                                    <TableCell className="text-right font-medium" data-testid={`text-amount-${ts.id}`}>{formatPay(ts.totalPay)}</TableCell>
                                    <TableCell className="text-right" data-testid={`text-status-${ts.id}`}>
                                      <Badge className={status.color} variant="secondary">
                                        {status.label}
                                      </Badge>
                                    </TableCell>
                                  </TableRow>
                                );
                              })}
                            </TableBody>
                          </Table>
                        </div>
                      </CardContent>
                    </CollapsibleContent>
                  </Collapsible>
                </Card>
              );
            })}
          </div>
        )}
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
