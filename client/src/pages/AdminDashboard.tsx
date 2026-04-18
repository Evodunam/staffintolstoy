import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { 
  useAdminCheck, 
  useAdminWorkers, 
  useAdminCompanies, 
  useAdminJobs, 
  useAdminStrikes,
  useAdminBilling,
  useAdminActivityLog,
  useAdminPlatformConfig,
  useUpdatePlatformConfig,
  useIssueStrike,
  useResolveStrike,
  useUpdateWorkerStatus,
  useUpdateCompanyStatus,
  useUpdateCompanySettings,
  useUpdateJobStatus,
  useCreateBillingAction,
  useAdminExport,
  useAdminCreateAccount,
  useAdminStripePayments,
  useAdminRefund,
  useAdminChats,
  useAdminChatMessages,
  useAdminSendSupportMessage,
  useAdminMassPush,
  useAdminInviteInfo,
  useAdminImport,
  useAdminImpersonate,
  type WorkerWithAdmin,
  type CompanyWithAdmin,
  type JobWithCompany,
  type ImportRow,
  type AdminStripePaymentRow
} from "@/hooks/use-admin";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { 
  Users, Building, Briefcase, DollarSign, Activity, Shield, AlertTriangle, 
  Ban, Eye, MoreVertical, Plus, Search, ArrowLeft, Check, X, Clock,
  TrendingUp, TrendingDown, RefreshCw, Phone, Mail, MapPin, Star, Settings,
  Download, Upload, MessageSquare, UserPlus, RotateCcw, Send, Bell, UserCircle
} from "lucide-react";
import { 
  DropdownMenu, 
  DropdownMenuContent, 
  DropdownMenuItem, 
  DropdownMenuSeparator, 
  DropdownMenuTrigger 
} from "@/components/ui/dropdown-menu";
import { format } from "date-fns";
import { queryClient } from "@/lib/queryClient";
import type { Profile, AdminStrike, BillingAction, AdminActivityLog } from "@shared/schema";

export default function AdminDashboard() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { data: adminCheck, isLoading: checkingAdmin } = useAdminCheck();
  
  const [activeTab, setActiveTab] = useState("workers");
  const [searchQuery, setSearchQuery] = useState("");
  
  const [showStrikeDialog, setShowStrikeDialog] = useState(false);
  const [selectedWorker, setSelectedWorker] = useState<WorkerWithAdmin | null>(null);
  const [strikeReason, setStrikeReason] = useState("");
  const [strikeSeverity, setStrikeSeverity] = useState("minor");
  const [strikeNotes, setStrikeNotes] = useState("");
  
  const [showStatusDialog, setShowStatusDialog] = useState(false);
  const [statusEntity, setStatusEntity] = useState<{ type: "worker" | "company"; entity: WorkerWithAdmin | CompanyWithAdmin } | null>(null);
  const [newStatus, setNewStatus] = useState("active");
  const [statusReason, setStatusReason] = useState("");
  
  const [showBillingDialog, setShowBillingDialog] = useState(false);
  const [billingEntity, setBillingEntity] = useState<{ type: "company" | "worker"; entity: Profile } | null>(null);
  const [billingActionType, setBillingActionType] = useState("credit");
  const [billingAmount, setBillingAmount] = useState("");
  const [billingReason, setBillingReason] = useState("");
  
  const [showJobActionDialog, setShowJobActionDialog] = useState(false);
  const [selectedJob, setSelectedJob] = useState<JobWithCompany | null>(null);
  const [jobAction, setJobAction] = useState("cancelled");
  const [jobActionReason, setJobActionReason] = useState("");
  
  const [showSettingsDialog, setShowSettingsDialog] = useState(false);
  const [settingsCompany, setSettingsCompany] = useState<CompanyWithAdmin | null>(null);
  const [autoReplenishThreshold, setAutoReplenishThreshold] = useState("");
  const [chatsSelectedJobId, setChatsSelectedJobId] = useState<number | null>(null);
  const [activityLogLimit, setActivityLogLimit] = useState(100);
  const [importEntity, setImportEntity] = useState<"workers" | "companies">("workers");
  const [importRows, setImportRows] = useState<ImportRow[]>([]);
  
  const { data: workers = [], isLoading: loadingWorkers } = useAdminWorkers();
  const { data: companies = [], isLoading: loadingCompanies } = useAdminCompanies();
  const { data: jobs = [], isLoading: loadingJobs } = useAdminJobs();
  const { data: strikes = [], isLoading: loadingStrikes } = useAdminStrikes();
  const { data: billingActions = [], isLoading: loadingBilling } = useAdminBilling();
  const { data: activityLog = [], isLoading: loadingActivity } = useAdminActivityLog(activityLogLimit);
  const { data: platformConfig, isLoading: loadingPlatformConfig } = useAdminPlatformConfig();
  const updatePlatformConfig = useUpdatePlatformConfig();
  
  const [platformFeeDollars, setPlatformFeeDollars] = useState("");
  const [affiliatePercent, setAffiliatePercent] = useState("");
  
  useEffect(() => {
    if (platformConfig) {
      setPlatformFeeDollars((platformConfig.platformFeePerHourCents / 100).toFixed(2));
      setAffiliatePercent(String(platformConfig.affiliateCommissionPercent));
    }
  }, [platformConfig]);
  
  const issueStrike = useIssueStrike();
  const resolveStrike = useResolveStrike();
  const updateWorkerStatus = useUpdateWorkerStatus();
  const updateCompanyStatus = useUpdateCompanyStatus();
  const updateCompanySettings = useUpdateCompanySettings();
  const updateJobStatus = useUpdateJobStatus();
  const createBillingAction = useCreateBillingAction();
  const adminExport = useAdminExport();
  const adminCreateAccount = useAdminCreateAccount();
  const { data: stripePayments = [], isLoading: loadingStripePayments } = useAdminStripePayments();
  const adminRefund = useAdminRefund();
  const { data: adminChats = [], isLoading: loadingAdminChats } = useAdminChats();
  const { data: chatMessages = [], isLoading: loadingChatMessages } = useAdminChatMessages(chatsSelectedJobId);
  const adminSendSupportMessage = useAdminSendSupportMessage();
  const adminMassPush = useAdminMassPush();
  const { data: adminInviteInfo } = useAdminInviteInfo();
  const adminImport = useAdminImport();
  const adminImpersonate = useAdminImpersonate();

  const [createAccountEmail, setCreateAccountEmail] = useState("");
  const [createAccountPassword, setCreateAccountPassword] = useState("");
  const [createAccountFirstName, setCreateAccountFirstName] = useState("");
  const [createAccountLastName, setCreateAccountLastName] = useState("");
  const [createAccountType, setCreateAccountType] = useState<"worker" | "company">("company");
  const [createAccountCompanyName, setCreateAccountCompanyName] = useState("");
  const [refundPaymentIntentId, setRefundPaymentIntentId] = useState("");
  const [refundAmountCents, setRefundAmountCents] = useState("");
  const [refundReason, setRefundReason] = useState("");
  const [supportMessageContent, setSupportMessageContent] = useState("");
  const [pushTarget, setPushTarget] = useState<"workers" | "companies" | "all">("all");
  const [pushTitle, setPushTitle] = useState("");
  const [pushBody, setPushBody] = useState("");
  const [pushUrl, setPushUrl] = useState("");
  const [resolveStrikeId, setResolveStrikeId] = useState<number | null>(null);
  const [resolveStrikeNotes, setResolveStrikeNotes] = useState("");
  const [showResolveStrikeDialog, setShowResolveStrikeDialog] = useState(false);
  const [jobStatusFilter, setJobStatusFilter] = useState<string>("");
  const [strikesActiveOnly, setStrikesActiveOnly] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  
  if (checkingAdmin) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <RefreshCw className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }
  
  if (!adminCheck?.isAdmin) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-4">
        <Shield className="w-16 h-16 text-destructive" />
        <h1 className="text-2xl font-bold">Access Denied</h1>
        <p className="text-muted-foreground">You don't have permission to access this page.</p>
        <Button onClick={() => navigate("/")}>Go Home</Button>
      </div>
    );
  }
  
  const filteredWorkers = workers.filter(w => 
    `${w.firstName} ${w.lastName} ${w.email}`.toLowerCase().includes(searchQuery.toLowerCase())
  );
  
  const filteredCompanies = companies.filter(c => 
    `${c.companyName} ${c.email}`.toLowerCase().includes(searchQuery.toLowerCase())
  );
  
  const filteredJobs = jobs.filter(j => 
    `${j.title} ${j.companyName} ${j.location}`.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const filteredStrikes = strikes.filter(s => {
    const w = (s as { worker?: Profile }).worker;
    const name = w ? `${w.firstName ?? ""} ${w.lastName ?? ""} ${w.email ?? ""}`.trim() : "";
    return name.toLowerCase().includes(searchQuery.toLowerCase());
  });

  const filteredActivity = activityLog.filter(log =>
    `${log.action} ${log.entityType} ${log.entityId ?? ""} ${log.adminEmail}`.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const filteredBilling = billingActions.filter(a =>
    `${a.reason} ${a.entityType} ${a.entityId} ${a.actionType} ${a.performedBy ?? ""}`.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const jobsByStatus = jobStatusFilter ? filteredJobs.filter(j => j.status === jobStatusFilter) : filteredJobs;
  const strikesToShow = strikesActiveOnly ? filteredStrikes.filter(s => s.isActive) : filteredStrikes;

  const handleRefreshAll = async () => {
    setIsRefreshing(true);
    try {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["/api/admin/workers"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/admin/companies"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/admin/jobs"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/admin/strikes"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/admin/billing"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/admin/activity"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/admin/platform-config"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/admin/chats"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/admin/invite-info"] }),
      ]);
      toast({ title: "Data refreshed" });
    } finally {
      setIsRefreshing(false);
    }
  };
  
  const handleIssueStrike = async () => {
    if (!selectedWorker || !strikeReason) return;
    try {
      await issueStrike.mutateAsync({
        workerId: selectedWorker.id,
        reason: strikeReason,
        severity: strikeSeverity,
        notes: strikeNotes || undefined,
      });
      toast({ title: "Strike issued successfully" });
      setShowStrikeDialog(false);
      setStrikeReason("");
      setStrikeSeverity("minor");
      setStrikeNotes("");
      setSelectedWorker(null);
    } catch (err: any) {
      toast({ title: "Failed to issue strike", description: err.message, variant: "destructive" });
    }
  };
  
  const handleUpdateStatus = async () => {
    if (!statusEntity || !statusReason) return;
    try {
      if (statusEntity.type === "worker") {
        await updateWorkerStatus.mutateAsync({
          workerId: statusEntity.entity.id,
          status: newStatus,
          reason: statusReason,
        });
      } else {
        await updateCompanyStatus.mutateAsync({
          companyId: statusEntity.entity.id,
          status: newStatus,
          reason: statusReason,
        });
      }
      toast({ title: "Status updated successfully" });
      setShowStatusDialog(false);
      setStatusReason("");
      setNewStatus("active");
      setStatusEntity(null);
    } catch (err: any) {
      toast({ title: "Failed to update status", description: err.message, variant: "destructive" });
    }
  };
  
  const handleBillingAction = async () => {
    if (!billingEntity || !billingAmount || !billingReason) return;
    try {
      await createBillingAction.mutateAsync({
        entityType: billingEntity.type,
        entityId: billingEntity.entity.id,
        actionType: billingActionType,
        amountCents: Math.round(parseFloat(billingAmount) * 100),
        reason: billingReason,
      });
      toast({ title: "Billing action recorded" });
      setShowBillingDialog(false);
      setBillingAmount("");
      setBillingReason("");
      setBillingActionType("credit");
      setBillingEntity(null);
    } catch (err: any) {
      toast({ title: "Failed to create billing action", description: err.message, variant: "destructive" });
    }
  };
  
  const handleJobAction = async () => {
    if (!selectedJob || !jobActionReason) return;
    try {
      await updateJobStatus.mutateAsync({
        jobId: selectedJob.id,
        status: jobAction,
        reason: jobActionReason,
      });
      toast({ title: "Job status updated" });
      setShowJobActionDialog(false);
      setJobActionReason("");
      setJobAction("cancelled");
      setSelectedJob(null);
    } catch (err: any) {
      toast({ title: "Failed to update job", description: err.message, variant: "destructive" });
    }
  };
  
  const handleUpdateSettings = async () => {
    if (!settingsCompany || !autoReplenishThreshold) return;
    try {
      const thresholdCents = Math.round(parseFloat(autoReplenishThreshold) * 100);
      if (thresholdCents < 50000) {
        toast({ title: "Minimum threshold is $500", variant: "destructive" });
        return;
      }
      await updateCompanySettings.mutateAsync({
        companyId: settingsCompany.id,
        autoReplenishThreshold: thresholdCents,
      });
      toast({ title: "Company settings updated" });
      setShowSettingsDialog(false);
      setAutoReplenishThreshold("");
      setSettingsCompany(null);
    } catch (err: any) {
      toast({ title: "Failed to update settings", description: err.message, variant: "destructive" });
    }
  };
  
  const getStatusBadge = (status?: string) => {
    if (!status || status === "active") return <Badge variant="secondary" className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400">Active</Badge>;
    if (status === "suspended") return <Badge variant="secondary" className="bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400">Suspended</Badge>;
    if (status === "banned") return <Badge variant="destructive">Banned</Badge>;
    if (status === "under_review") return <Badge variant="secondary" className="bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400">Under Review</Badge>;
    return <Badge variant="secondary">{status}</Badge>;
  };
  
  const getJobStatusBadge = (status: string) => {
    if (status === "open") return <Badge variant="secondary" className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400">Open</Badge>;
    if (status === "in_progress") return <Badge variant="secondary" className="bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400">In Progress</Badge>;
    if (status === "completed") return <Badge variant="secondary">Completed</Badge>;
    if (status === "cancelled") return <Badge variant="destructive">Cancelled</Badge>;
    return <Badge variant="secondary">{status}</Badge>;
  };
  
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border sticky top-0 bg-background z-10 shadow-sm">
        <div className="container mx-auto max-w-full px-4 py-3 sm:px-6 sm:py-4">
          <div className="flex flex-wrap items-center justify-between gap-2 sm:gap-4">
            <div className="flex items-center gap-2 sm:gap-4 min-w-0">
              <Button variant="ghost" size="icon" className="shrink-0 h-10 w-10 sm:h-9 sm:w-9" onClick={() => navigate("/")} aria-label="Go home">
                <ArrowLeft className="h-5 w-5 sm:h-4 sm:w-4" />
              </Button>
              <div className="flex items-center gap-2 min-w-0">
                <Shield className="h-6 w-6 sm:h-5 sm:w-5 text-primary shrink-0" />
                <h1 className="text-lg font-bold truncate sm:text-xl">Admin Dashboard</h1>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Button variant="outline" size="sm" className="h-9 px-2 sm:px-3" onClick={() => navigate("/admin/compliance")} data-testid="button-admin-compliance">
                <Shield className="h-4 w-4 sm:mr-2" />
                <span className="hidden sm:inline">Compliance</span>
              </Button>
              <Button variant="outline" size="sm" className="h-9 px-2 sm:px-3" onClick={() => navigate("/dashboard")} data-testid="button-admin-worker-view">
                <Users className="h-4 w-4 sm:mr-2" />
                <span className="hidden sm:inline">Worker View</span>
              </Button>
              <Button variant="outline" size="sm" className="h-9 px-2 sm:px-3" onClick={() => navigate("/company-dashboard")} data-testid="button-admin-company-view">
                <Building className="h-4 w-4 sm:mr-2" />
                <span className="hidden sm:inline">Company View</span>
              </Button>
            </div>
          </div>
        </div>
      </header>
      
      <main className="container mx-auto max-w-full px-4 py-4 sm:px-6 sm:py-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 sm:gap-4 mb-4 sm:mb-6">
          <Card>
            <CardContent className="pt-4 sm:pt-6">
              <div className="flex items-center gap-3 sm:gap-4">
                <div className="p-2.5 sm:p-3 bg-blue-100 dark:bg-blue-900/30 rounded-lg shrink-0">
                  <Users className="h-5 w-5 sm:h-6 sm:w-6 text-blue-600 dark:text-blue-400" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm text-muted-foreground">Total Workers</p>
                  <p className="text-xl sm:text-2xl font-bold text-foreground">{workers.length}</p>
                  {workers.some(w => (w as Profile).createdAt) && (
                    <p className="text-xs text-muted-foreground">
                      {workers.filter(w => (w as Profile).createdAt && (Date.now() - new Date((w as Profile).createdAt!).getTime() < 7 * 24 * 60 * 60 * 1000)).length} new (7d)
                    </p>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 sm:pt-6">
              <div className="flex items-center gap-3 sm:gap-4">
                <div className="p-2.5 sm:p-3 bg-green-100 dark:bg-green-900/30 rounded-lg shrink-0">
                  <Building className="h-5 w-5 sm:h-6 sm:w-6 text-green-600 dark:text-green-400" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm text-muted-foreground">Total Companies</p>
                  <p className="text-xl sm:text-2xl font-bold text-foreground">{companies.length}</p>
                  {companies.some(c => (c as Profile).createdAt) && (
                    <p className="text-xs text-muted-foreground">
                      {companies.filter(c => (c as Profile).createdAt && (Date.now() - new Date((c as Profile).createdAt!).getTime() < 7 * 24 * 60 * 60 * 1000)).length} new (7d)
                    </p>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 sm:pt-6">
              <div className="flex items-center gap-3 sm:gap-4">
                <div className="p-2.5 sm:p-3 bg-purple-100 dark:bg-purple-900/30 rounded-lg shrink-0">
                  <Briefcase className="h-5 w-5 sm:h-6 sm:w-6 text-purple-600 dark:text-purple-400" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm text-muted-foreground">Total Jobs</p>
                  <p className="text-xl sm:text-2xl font-bold text-foreground">{jobs.length}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 sm:pt-6">
              <div className="flex items-center gap-3 sm:gap-4">
                <div className="p-2.5 sm:p-3 bg-amber-100 dark:bg-amber-900/30 rounded-lg shrink-0">
                  <Briefcase className="h-5 w-5 sm:h-6 sm:w-6 text-amber-600 dark:text-amber-400" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm text-muted-foreground">Open Jobs</p>
                  <p className="text-xl sm:text-2xl font-bold text-foreground">{jobs.filter(j => j.status === "open").length}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 sm:pt-6">
              <div className="flex items-center gap-3 sm:gap-4">
                <div className="p-2.5 sm:p-3 bg-red-100 dark:bg-red-900/30 rounded-lg shrink-0">
                  <AlertTriangle className="h-5 w-5 sm:h-6 sm:w-6 text-red-600 dark:text-red-400" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm text-muted-foreground">Active Strikes</p>
                  <p className="text-xl sm:text-2xl font-bold text-foreground">{strikes.filter(s => s.isActive).length}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
        
        <div className="flex flex-wrap items-center gap-3 sm:gap-4 mb-4 sm:mb-6">
          <div className="relative w-full max-w-md min-w-0 flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            <Input 
              placeholder="Search..." 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10 h-10 sm:h-9"
              data-testid="input-admin-search"
            />
          </div>
          <Button variant="outline" size="sm" className="shrink-0 h-10 sm:h-9" onClick={handleRefreshAll} disabled={isRefreshing} aria-label="Refresh all data">
            <RefreshCw className={`h-4 w-4 sm:mr-2 ${isRefreshing ? "animate-spin" : ""}`} />
            <span className="hidden sm:inline">{isRefreshing ? "Refreshing..." : "Refresh data"}</span>
          </Button>
        </div>
        
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full min-w-0">
          <TabsList className="mb-4 w-full overflow-x-auto flex-nowrap justify-start border border-border rounded-lg bg-muted/30 p-1.5 h-auto min-h-11">
            <TabsTrigger value="workers" className="flex items-center gap-2">
              <Users className="w-4 h-4" /> Workers
            </TabsTrigger>
            <TabsTrigger value="companies" className="flex items-center gap-2">
              <Building className="w-4 h-4" /> Companies
            </TabsTrigger>
            <TabsTrigger value="jobs" className="flex items-center gap-2">
              <Briefcase className="w-4 h-4" /> Jobs
            </TabsTrigger>
            <TabsTrigger value="billing" className="flex items-center gap-2">
              <DollarSign className="w-4 h-4" /> Billing
            </TabsTrigger>
            <TabsTrigger value="activity" className="flex items-center gap-2">
              <Activity className="w-4 h-4" /> Activity Log
            </TabsTrigger>
            <TabsTrigger value="strikes" className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4" /> Strikes
            </TabsTrigger>
            <TabsTrigger value="platform" className="flex items-center gap-2">
              <Settings className="w-4 h-4" /> Platform
            </TabsTrigger>
            <TabsTrigger value="export" className="flex items-center gap-2">
              <Download className="w-4 h-4" /> Export
            </TabsTrigger>
            <TabsTrigger value="import" className="flex items-center gap-2">
              <Upload className="w-4 h-4" /> Import
            </TabsTrigger>
            <TabsTrigger value="create" className="flex items-center gap-2">
              <UserPlus className="w-4 h-4" /> Create Account
            </TabsTrigger>
            <TabsTrigger value="refunds" className="flex items-center gap-2">
              <RotateCcw className="w-4 h-4" /> Refunds
            </TabsTrigger>
            <TabsTrigger value="chats" className="flex items-center gap-2">
              <MessageSquare className="w-4 h-4" /> Messages
            </TabsTrigger>
            <TabsTrigger value="push" className="flex items-center gap-2">
              <Bell className="w-4 h-4" /> Push
            </TabsTrigger>
            <TabsTrigger value="admins" className="flex items-center gap-2">
              <Shield className="w-4 h-4" /> Admin Users
            </TabsTrigger>
          </TabsList>
          
          <TabsContent value="strikes">
            <Card>
              <CardHeader>
                <CardTitle>Worker strikes</CardTitle>
                <CardDescription>View and resolve strikes. Active: {strikes.filter(s => s.isActive).length}. Search filters by worker name or email.</CardDescription>
                <div className="flex flex-wrap items-center gap-2 pt-2">
                  <Label className="text-sm text-muted-foreground">Show:</Label>
                  <Select value={strikesActiveOnly ? "active" : "all"} onValueChange={(v) => setStrikesActiveOnly(v === "active")}>
                    <SelectTrigger className="w-[140px] h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All strikes</SelectItem>
                      <SelectItem value="active">Active only</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </CardHeader>
              <CardContent>
                {loadingStrikes ? (
                  <div className="flex justify-center py-8"><RefreshCw className="w-6 h-6 animate-spin text-muted-foreground" /></div>
                ) : (
                  <div className="space-y-4">
                    {strikesToShow.map((strike) => (
                      <div key={strike.id} className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between sm:p-4 border border-border rounded-lg bg-card">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="font-medium text-foreground truncate">
                              {(strike as { worker?: Profile }).worker
                                ? `${(strike as { worker: Profile }).worker.firstName} ${(strike as { worker: Profile }).worker.lastName}`.trim() || `Worker #${strike.workerId}`
                                : `Worker #${strike.workerId}`}
                            </p>
                            {strike.isActive ? (
                              <Badge variant="destructive">Active</Badge>
                            ) : (
                              <Badge variant="secondary">Resolved</Badge>
                            )}
                            <Badge variant="outline">{strike.severity ?? "minor"}</Badge>
                          </div>
                          <p className="text-sm text-muted-foreground mt-1">{strike.reason}</p>
                          {strike.notes && <p className="text-xs text-muted-foreground mt-1">Notes: {strike.notes}</p>}
                          <p className="text-xs text-muted-foreground mt-1">
                            Issued by {strike.issuedBy} · {strike.createdAt ? format(new Date(strike.createdAt), "MMM d, yyyy HH:mm") : "N/A"}
                            {strike.resolvedAt && ` · Resolved ${format(new Date(strike.resolvedAt), "MMM d")}`}
                          </p>
                        </div>
                        {strike.isActive && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="shrink-0 w-full sm:w-auto min-h-10"
                            onClick={() => {
                              setResolveStrikeId(strike.id);
                              setResolveStrikeNotes("");
                              setShowResolveStrikeDialog(true);
                            }}
                          >
                            Resolve
                          </Button>
                        )}
                      </div>
                    ))}
                    {strikesToShow.length === 0 && (
                      <p className="text-center text-muted-foreground py-8">
                        {strikes.length === 0 ? "No strikes recorded" : strikesActiveOnly ? "No active strikes match search" : "No strikes match search"}
                      </p>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="platform">
            <Card>
              <CardHeader>
                <CardTitle>Platform fee &amp; affiliate commission</CardTitle>
                <CardDescription>
                  Platform fee is charged on top of worker rate per hour (company pays worker rate + this fee). Affiliates earn a percentage of that fee when referred workers/companies have timesheets approved.
                </CardDescription>
                {platformConfig?.updatedAt && (
                  <p className="text-xs text-muted-foreground pt-1">Last updated: {format(new Date(platformConfig.updatedAt), "MMM d, yyyy HH:mm")}</p>
                )}
              </CardHeader>
              <CardContent className="space-y-6">
                {loadingPlatformConfig ? (
                  <div className="flex justify-center py-8"><RefreshCw className="w-6 h-6 animate-spin" /></div>
                ) : (
                  <>
                    <div className="grid gap-4 sm:grid-cols-2 max-w-md">
                      <div className="space-y-2">
                        <Label htmlFor="platform-fee">Platform fee per hour ($)</Label>
                        <Input
                          id="platform-fee"
                          type="number"
                          min="0"
                          step="0.01"
                          value={platformFeeDollars}
                          onChange={(e) => setPlatformFeeDollars(e.target.value)}
                          placeholder="e.g. 13"
                        />
                        <p className="text-xs text-muted-foreground">Charged on top of worker rate; e.g. $13/hr → company pays worker_rate + $13 per hour.</p>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="affiliate-percent">Affiliate commission (%)</Label>
                        <Input
                          id="affiliate-percent"
                          type="number"
                          min="0"
                          max="100"
                          value={affiliatePercent}
                          onChange={(e) => setAffiliatePercent(e.target.value)}
                          placeholder="e.g. 20"
                        />
                        <p className="text-xs text-muted-foreground">Percent of platform fee paid to referring affiliate when timesheet is approved (e.g. 20% of $13/hr).</p>
                      </div>
                    </div>
                    <Button
                      onClick={async () => {
                        const feeCents = Math.round(parseFloat(platformFeeDollars || "0") * 100);
                        const percent = parseInt(affiliatePercent || "0", 10);
                        if (feeCents < 0 || percent < 0 || percent > 100) {
                          toast({ title: "Invalid values", variant: "destructive" });
                          return;
                        }
                        try {
                          await updatePlatformConfig.mutateAsync({ platformFeePerHourCents: feeCents, affiliateCommissionPercent: percent });
                          toast({ title: "Platform config updated" });
                        } catch (err: any) {
                          toast({ title: err?.message ?? "Failed to update", variant: "destructive" });
                        }
                      }}
                      disabled={updatePlatformConfig.isPending}
                    >
                      {updatePlatformConfig.isPending ? "Saving..." : "Save"}
                    </Button>
                  </>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="export">
            <Card>
              <CardHeader>
                <CardTitle>Export data</CardTitle>
                <CardDescription>Download workers, companies, jobs, strikes, activity, or billing as CSV.</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-2">
                {(["workers", "companies", "jobs", "strikes", "activity", "billing"] as const).map((entity) => (
                  <Button
                    key={entity}
                    variant="outline"
                    onClick={() => adminExport.mutateAsync({ entity })}
                    disabled={adminExport.isPending}
                  >
                    <Download className="w-4 h-4 mr-2" />
                    Export {entity}
                  </Button>
                ))}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="import">
            <Card>
              <CardHeader>
                <CardTitle>Bulk import</CardTitle>
                <CardDescription>
                  Upload a CSV with columns: email, firstName, lastName, password (optional; min 8 chars; if omitted a random password is generated), and for companies: companyName. First row can be a header row.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex flex-wrap items-center gap-4">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      const headers = importEntity === "companies"
                        ? "email,firstName,lastName,password,companyName"
                        : "email,firstName,lastName,password";
                      const example = importEntity === "companies"
                        ? "contact@company.com,Jane,Smith,OptionalPassword8,Acme Inc"
                        : "worker@example.com,Jane,Smith,OptionalPassword8";
                      const csv = `${headers}\n${example}`;
                      const blob = new Blob([csv], { type: "text/csv" });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement("a");
                      a.href = url;
                      a.download = `import-${importEntity}-template.csv`;
                      a.click();
                      URL.revokeObjectURL(url);
                    }}
                  >
                    <Download className="w-4 h-4 mr-2" />
                    Download template
                  </Button>
                  <Label className="sr-only">CSV file</Label>
                  <Input
                    type="file"
                    accept=".csv"
                    className="max-w-xs"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      const reader = new FileReader();
                      reader.onload = () => {
                        const text = String(reader.result ?? "");
                        const lines = text.split(/\r?\n/).filter(Boolean);
                        if (lines.length === 0) {
                          setImportRows([]);
                          return;
                        }
                        const parseCell = (s: string) => s.replace(/^"|"$/g, "").trim();
                        const headerLine = lines[0].split(",").map(parseCell);
                        const headerLower = headerLine.map((h) => h.toLowerCase().replace(/\s/g, ""));
                        const col = (key: string) => headerLower.findIndex((h) => h === key.toLowerCase().replace(/\s/g, ""));
                        const hasHeader = headerLower.some((h) => h === "email") || (headerLine[0] && !headerLine[0].includes("@"));
                        const emailCol = hasHeader ? (col("email") >= 0 ? col("email") : 0) : 0;
                        const firstCol = hasHeader ? (col("firstname") >= 0 ? col("firstname") : -1) : 1;
                        const lastCol = hasHeader ? (col("lastname") >= 0 ? col("lastname") : -1) : 2;
                        const passCol = hasHeader ? col("password") : 3;
                        const companyCol = hasHeader ? (col("companyname") >= 0 ? col("companyname") : -1) : 4;
                        const dataStart = hasHeader ? 1 : 0;
                        const rows: ImportRow[] = [];
                        for (let i = dataStart; i < lines.length; i++) {
                          const cells = lines[i].split(",").map(parseCell);
                          const email = (emailCol >= 0 && cells[emailCol]) ? cells[emailCol] : (cells[0] || "").trim();
                          if (!email) continue;
                          rows.push({
                            email,
                            firstName: firstCol >= 0 && cells[firstCol] ? cells[firstCol] : undefined,
                            lastName: lastCol >= 0 && cells[lastCol] ? cells[lastCol] : undefined,
                            password: passCol >= 0 && cells[passCol] && cells[passCol].length >= 8 ? cells[passCol] : undefined,
                            companyName: companyCol >= 0 && cells[companyCol] ? cells[companyCol] : undefined,
                          });
                        }
                        setImportRows(rows);
                      };
                      reader.readAsText(file);
                      e.target.value = "";
                    }}
                  />
                  <Select value={importEntity} onValueChange={(v: "workers" | "companies") => setImportEntity(v)}>
                    <SelectTrigger className="w-[180px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="workers">Workers</SelectItem>
                      <SelectItem value="companies">Companies</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button
                    disabled={importRows.length === 0 || adminImport.isPending}
                    onClick={async () => {
                      try {
                        const result = await adminImport.mutateAsync({ entity: importEntity, rows: importRows });
                        toast({
                          title: "Import complete",
                          description: `Created: ${result.created}, Failed: ${result.failed}${result.errors?.length ? `. Row errors: ${result.errors.slice(0, 5).map((e) => `#${e.index + 1} ${e.message}`).join("; ")}` : ""}`,
                          variant: result.failed > 0 ? "default" : "default",
                        });
                        if (result.created > 0) setImportRows([]);
                      } catch (err: any) {
                        toast({ title: err?.message ?? "Import failed", variant: "destructive" });
                      }
                    }}
                  >
                    <Upload className="w-4 h-4 mr-2" />
                    Import {importRows.length} row{importRows.length !== 1 ? "s" : ""}
                  </Button>
                </div>
                {importRows.length > 0 && (
                  <div className="w-full overflow-x-auto -mx-4 sm:mx-0 px-4 sm:px-0 rounded-lg border border-border">
                    <ScrollArea className="h-[240px] w-full min-w-0">
                    <table className="w-full min-w-[400px] text-sm text-foreground">
                      <thead>
                        <tr className="border-b bg-muted/50">
                          <th className="text-left p-2">email</th>
                          <th className="text-left p-2">firstName</th>
                          <th className="text-left p-2">lastName</th>
                          {importEntity === "companies" && <th className="text-left p-2">companyName</th>}
                        </tr>
                      </thead>
                      <tbody>
                        {importRows.slice(0, 50).map((row, i) => (
                          <tr key={i} className="border-b">
                            <td className="p-2">{row.email}</td>
                            <td className="p-2">{row.firstName ?? "—"}</td>
                            <td className="p-2">{row.lastName ?? "—"}</td>
                            {importEntity === "companies" && <td className="p-2">{row.companyName ?? "—"}</td>}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {importRows.length > 50 && <p className="p-2 text-muted-foreground text-xs">Showing first 50 of {importRows.length} rows.</p>}
                  </ScrollArea>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="create">
            <Card>
              <CardHeader>
                <CardTitle>Create account</CardTitle>
                <CardDescription>Create a new worker or company account.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4 max-w-md">
                <div className="grid gap-2 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Type</Label>
                    <Select value={createAccountType} onValueChange={(v: "worker" | "company") => setCreateAccountType(v)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="worker">Worker</SelectItem>
                        <SelectItem value="company">Company</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  {createAccountType === "company" && (
                    <div className="space-y-2">
                      <Label>Company name</Label>
                      <Input value={createAccountCompanyName} onChange={(e) => setCreateAccountCompanyName(e.target.value)} placeholder="Acme Inc" />
                    </div>
                  )}
                </div>
                <div className="space-y-2">
                  <Label>Email</Label>
                  <Input type="email" value={createAccountEmail} onChange={(e) => setCreateAccountEmail(e.target.value)} placeholder="user@example.com" />
                </div>
                <div className="space-y-2">
                  <Label>Password</Label>
                  <Input type="password" value={createAccountPassword} onChange={(e) => setCreateAccountPassword(e.target.value)} placeholder="Min 8 characters" />
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label>First name</Label>
                    <Input value={createAccountFirstName} onChange={(e) => setCreateAccountFirstName(e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label>Last name</Label>
                    <Input value={createAccountLastName} onChange={(e) => setCreateAccountLastName(e.target.value)} />
                  </div>
                </div>
                <Button
                  onClick={async () => {
                    if (!createAccountEmail || !createAccountPassword) {
                      toast({ title: "Email and password required", variant: "destructive" });
                      return;
                    }
                    try {
                      await adminCreateAccount.mutateAsync({
                        email: createAccountEmail,
                        password: createAccountPassword,
                        firstName: createAccountFirstName || undefined,
                        lastName: createAccountLastName || undefined,
                        userType: createAccountType,
                        companyName: createAccountType === "company" ? createAccountCompanyName || undefined : undefined,
                      });
                      toast({ title: "Account created" });
                      setCreateAccountEmail(""); setCreateAccountPassword(""); setCreateAccountFirstName(""); setCreateAccountLastName(""); setCreateAccountCompanyName("");
                    } catch (err: any) {
                      toast({ title: err?.message ?? "Failed", variant: "destructive" });
                    }
                  }}
                  disabled={adminCreateAccount.isPending}
                >
                  <UserPlus className="w-4 h-4 mr-2" /> Create
                </Button>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="refunds">
            <div className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle>Recent Stripe payments</CardTitle>
                  <CardDescription>Company transactions with a Stripe Payment Intent. Click Refund to pre-fill the form below.</CardDescription>
                </CardHeader>
                <CardContent>
                  {loadingStripePayments ? (
                    <div className="flex justify-center py-6"><RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" /></div>
                  ) : stripePayments.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No Stripe payments found in company transactions.</p>
                  ) : (
                    <ScrollArea className="h-[min(280px,50vh)] w-full rounded-lg border border-border">
                      <div className="p-2 space-y-1">
                        {stripePayments.map((row: AdminStripePaymentRow) => (
                          <div
                            key={row.id}
                            className="flex flex-wrap items-center justify-between gap-2 p-3 rounded-lg border border-border bg-card hover:bg-muted/30"
                          >
                            <div className="min-w-0">
                              <p className="font-medium truncate">{row.companyName ?? `Profile #${row.profileId}`}</p>
                              <p className="text-sm text-muted-foreground truncate">{row.stripePaymentIntentId ?? "—"}</p>
                              <p className="text-xs text-muted-foreground">
                                ${(Number(row.amount) / 100).toFixed(2)} · {row.type} · {row.createdAt ? format(new Date(row.createdAt), "MMM d, yyyy HH:mm") : "—"}
                              </p>
                            </div>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                if (row.stripePaymentIntentId) {
                                  setRefundPaymentIntentId(row.stripePaymentIntentId);
                                  setRefundAmountCents("");
                                }
                              }}
                              disabled={!row.stripePaymentIntentId}
                            >
                              <RotateCcw className="w-4 h-4 mr-1" /> Refund
                            </Button>
                          </div>
                        ))}
                      </div>
                    </ScrollArea>
                  )}
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle>Stripe refund</CardTitle>
                  <CardDescription>Refund a Stripe payment by Payment Intent ID. Leave amount blank for full refund.</CardDescription>
                  <p className="text-xs text-muted-foreground mt-1">
                    Find Payment Intent IDs in{" "}
                    <a href="https://dashboard.stripe.com/payments" target="_blank" rel="noopener noreferrer" className="underline">Stripe Dashboard → Payments</a>.
                  </p>
                </CardHeader>
                <CardContent className="space-y-4 max-w-md">
                  <div className="space-y-2">
                    <Label>Payment Intent ID</Label>
                    <Input value={refundPaymentIntentId} onChange={(e) => setRefundPaymentIntentId(e.target.value)} placeholder="pi_xxx" />
                  </div>
                  <div className="space-y-2">
                    <Label>Amount (cents, optional)</Label>
                    <Input type="number" value={refundAmountCents} onChange={(e) => setRefundAmountCents(e.target.value)} placeholder="Leave blank for full" />
                  </div>
                  <div className="space-y-2">
                    <Label>Reason</Label>
                    <Input value={refundReason} onChange={(e) => setRefundReason(e.target.value)} placeholder="requested_by_customer" />
                  </div>
                  <Button
                    onClick={async () => {
                      if (!refundPaymentIntentId) {
                        toast({ title: "Payment Intent ID required", variant: "destructive" });
                        return;
                      }
                      try {
                        await adminRefund.mutateAsync({
                          paymentIntentId: refundPaymentIntentId,
                          amountCents: refundAmountCents ? parseInt(refundAmountCents, 10) : undefined,
                          reason: refundReason || undefined,
                        });
                        toast({ title: "Refund initiated" });
                        setRefundPaymentIntentId(""); setRefundAmountCents(""); setRefundReason("");
                      } catch (err: any) {
                        toast({ title: err?.message ?? "Refund failed", variant: "destructive" });
                      }
                    }}
                    disabled={adminRefund.isPending}
                  >
                    <RotateCcw className="w-4 h-4 mr-2" /> Refund
                  </Button>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="chats">
            <Card>
              <CardHeader>
                <CardTitle>All messages (support view)</CardTitle>
                <CardDescription>View job conversations and send messages as Support.</CardDescription>
              </CardHeader>
              <CardContent className="flex gap-4 flex-col md:flex-row min-w-0">
                <div className="flex-1 min-w-0 min-h-[200px] md:min-h-[400px]">
                  {loadingAdminChats ? (
                    <div className="flex justify-center py-8"><RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" /></div>
                  ) : (
                    <ScrollArea className="h-[min(400px,50vh)] md:h-[400px] w-full rounded-lg border border-border">
                      <div className="space-y-1 p-1">
                        {adminChats.map((job) => (
                          <button
                            key={job.id}
                            type="button"
                            onClick={() => setChatsSelectedJobId(job.id)}
                            className={`w-full text-left p-3 rounded-lg border border-border text-foreground hover:bg-muted/50 transition-colors ${chatsSelectedJobId === job.id ? "bg-primary/10 border-primary" : "bg-card"}`}
                          >
                            <span className="font-medium truncate block">#{job.id} {job.title}</span>
                            <span className="text-muted-foreground text-sm block truncate">{job.companyName ?? "—"}</span>
                          </button>
                        ))}
                      </div>
                    </ScrollArea>
                  )}
                </div>
                {chatsSelectedJobId && (
                  <div className="flex-1 min-w-0 min-h-[280px] border border-border rounded-lg flex flex-col bg-card">
                    <div className="p-3 border-b border-border flex items-center justify-between shrink-0">
                      <span className="font-medium text-foreground truncate">Job #{chatsSelectedJobId}</span>
                      <Button variant="ghost" size="sm" className="h-9 w-9 shrink-0" onClick={() => setChatsSelectedJobId(null)} aria-label="Close"><X className="h-4 w-4" /></Button>
                    </div>
                    <ScrollArea className="flex-1 p-4 min-h-[200px] h-[min(320px,45vh)] md:h-[320px]">
                      {loadingChatMessages ? (
                        <div className="flex justify-center py-4"><RefreshCw className="w-5 h-5 animate-spin" /></div>
                      ) : (
                        <div className="space-y-2">
                          {(chatMessages as { id: number; content: string; createdAt: string; sender: { firstName?: string; lastName?: string; companyName?: string } }[]).map((msg) => {
                            const isSupport = typeof msg.content === "string" && msg.content.startsWith("[Support] ");
                            const displayContent = isSupport ? msg.content.slice(10) : msg.content;
                            const senderLabel = isSupport ? "Support" : (msg.sender?.firstName ?? msg.sender?.companyName ?? "User");
                            return (
                              <div key={msg.id} className="text-sm">
                                <span className="font-medium text-muted-foreground">{senderLabel}:</span>{" "}
                                {displayContent}
                                <span className="text-xs text-muted-foreground ml-2">{format(new Date(msg.createdAt), "MMM d, HH:mm")}</span>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </ScrollArea>
                    <div className="p-3 border-t border-border flex gap-2 shrink-0">
                      <Input
                        value={supportMessageContent}
                        onChange={(e) => setSupportMessageContent(e.target.value)}
                        placeholder="Reply as Support..."
                        className="min-h-10 flex-1 min-w-0"
                        onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && (e.preventDefault(), adminSendSupportMessage.mutateAsync({ jobId: chatsSelectedJobId, content: supportMessageContent }).then(() => setSupportMessageContent("")).catch(() => {}))}
                      />
                      <Button
                        size="sm"
                        className="h-10 shrink-0"
                        onClick={async () => {
                          if (!supportMessageContent.trim()) return;
                          try {
                            await adminSendSupportMessage.mutateAsync({ jobId: chatsSelectedJobId, content: supportMessageContent.trim() });
                            setSupportMessageContent("");
                            toast({ title: "Message sent" });
                          } catch (err: any) {
                            toast({ title: err?.message ?? "Failed", variant: "destructive" });
                          }
                        }}
                        disabled={adminSendSupportMessage.isPending || !supportMessageContent.trim()}
                      >
                        <Send className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="push">
            <Card>
              <CardHeader>
                <CardTitle>Mass push notification</CardTitle>
                <CardDescription>Send a push notification to workers, companies, or everyone. Recipients must have the app and push enabled.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4 max-w-md">
                <div className="space-y-2">
                  <Label>Target</Label>
                  <Select value={pushTarget} onValueChange={(v: "workers" | "companies" | "all") => setPushTarget(v)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="workers">Workers only ({workers.length})</SelectItem>
                      <SelectItem value="companies">Companies only ({companies.length})</SelectItem>
                      <SelectItem value="all">Everyone ({workers.length + companies.length})</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Estimated reach: {pushTarget === "workers" ? workers.length : pushTarget === "companies" ? companies.length : workers.length + companies.length} account{pushTarget === "all" && workers.length + companies.length !== 1 ? "s" : ""}. Actual delivery depends on installed app and push tokens.
                  </p>
                </div>
                <div className="space-y-2">
                  <Label>Title</Label>
                  <Input value={pushTitle} onChange={(e) => setPushTitle(e.target.value)} placeholder="Notification title" />
                </div>
                <div className="space-y-2">
                  <Label>Body</Label>
                  <Textarea value={pushBody} onChange={(e) => setPushBody(e.target.value)} placeholder="Message body" rows={3} />
                </div>
                <div className="space-y-2">
                  <Label>URL (optional)</Label>
                  <Input value={pushUrl} onChange={(e) => setPushUrl(e.target.value)} placeholder="/dashboard" />
                </div>
                <Button
                  onClick={async () => {
                    if (!pushTitle || !pushBody) {
                      toast({ title: "Title and body required", variant: "destructive" });
                      return;
                    }
                    try {
                      const result = await adminMassPush.mutateAsync({ target: pushTarget, title: pushTitle, body: pushBody, url: pushUrl || undefined });
                      toast({ title: `Sent: ${result.sent}, Failed: ${result.failed}` });
                      setPushTitle(""); setPushBody(""); setPushUrl("");
                    } catch (err: any) {
                      toast({ title: err?.message ?? "Failed", variant: "destructive" });
                    }
                  }}
                  disabled={adminMassPush.isPending}
                >
                  <Bell className="w-4 h-4 mr-2" /> Send push
                </Button>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="admins">
            <Card>
              <CardHeader>
                <CardTitle>Admin users</CardTitle>
                <CardDescription>Who can access the admin dashboard.</CardDescription>
              </CardHeader>
              <CardContent>
                {adminInviteInfo ? (
                  <div className="space-y-2">
                    <p className="text-sm text-muted-foreground">{adminInviteInfo.message}</p>
                    <p className="text-sm font-medium">Current admin emails:</p>
                    <ul className="list-disc list-inside text-sm">
                      {adminInviteInfo.currentEmails.map((e) => (
                        <li key={e}>{e}</li>
                      ))}
                    </ul>
                    <p className="text-xs text-muted-foreground mt-2">Restart the server after changing ADMIN_EMAILS for changes to take effect.</p>
                  </div>
                ) : (
                  <div className="flex justify-center py-4"><RefreshCw className="w-6 h-6 animate-spin" /></div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
          
          <TabsContent value="workers">
            <Card>
              <CardHeader>
                <CardTitle>All Workers</CardTitle>
                <CardDescription>Manage all registered workers</CardDescription>
              </CardHeader>
              <CardContent>
                {loadingWorkers ? (
                  <div className="flex justify-center py-8">
                    <RefreshCw className="w-6 h-6 animate-spin" />
                  </div>
                ) : (
                  <div className="space-y-3 sm:space-y-4">
                    {filteredWorkers.map((worker) => (
                      <div key={worker.id} className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between sm:p-4 border border-border rounded-lg bg-card">
                        <div className="flex items-start gap-3 sm:gap-4 min-w-0">
                          <Avatar className="h-10 w-10 sm:h-9 sm:w-9 shrink-0">
                            <AvatarImage src={worker.avatarUrl || undefined} />
                            <AvatarFallback className="text-sm">{worker.firstName?.[0]}{worker.lastName?.[0]}</AvatarFallback>
                          </Avatar>
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="font-medium text-foreground truncate">{worker.firstName} {worker.lastName}</p>
                              {getStatusBadge(worker.adminStatus?.status ?? undefined)}
                              {(worker.strikeCount ?? 0) > 0 && (
                                <Badge variant="destructive" className="text-xs shrink-0">
                                  {worker.strikeCount} Strike{(worker.strikeCount ?? 0) > 1 ? "s" : ""}
                                </Badge>
                              )}
                            </div>
                            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground mt-1">
                              <span className="flex items-center gap-1 truncate min-w-0"><Mail className="h-3.5 w-3.5 shrink-0" />{worker.email}</span>
                              {worker.phone && <span className="flex items-center gap-1"><Phone className="h-3.5 w-3.5 shrink-0" />{worker.phone}</span>}
                            </div>
                            {worker.city && <span className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5"><MapPin className="h-3 w-3 shrink-0" />{worker.city}, {worker.state}</span>}
                          </div>
                        </div>
                        <div className="flex items-center justify-between gap-2 sm:justify-end sm:shrink-0 border-t border-border pt-3 sm:border-0 sm:pt-0">
                          <div className="text-left sm:text-right">
                            <p className="text-sm font-medium text-foreground">{worker.completedJobs || 0} jobs</p>
                            {worker.averageRating && (
                              <p className="text-xs text-muted-foreground flex items-center gap-1 sm:justify-end">
                                <Star className="h-3 w-3 fill-amber-500 text-amber-500 shrink-0" />
                                {parseFloat(worker.averageRating).toFixed(1)}
                              </p>
                            )}
                          </div>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-10 w-10 shrink-0 sm:h-9 sm:w-9" data-testid={`button-worker-actions-${worker.id}`} aria-label="Actions">
                                <MoreVertical className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem
                                onClick={async () => {
                                  try {
                                    const r = await adminImpersonate.mutateAsync(worker.id);
                                    toast({ title: "Viewing as user" });
                                    navigate(r.role === "worker" ? "/dashboard" : "/company-dashboard");
                                  } catch (err: any) {
                                    toast({ title: err?.message ?? "Failed", variant: "destructive" });
                                  }
                                }}
                                disabled={adminImpersonate.isPending}
                              >
                                <UserCircle className="w-4 h-4 mr-2" /> View as user
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => {
                                setSelectedWorker(worker);
                                setShowStrikeDialog(true);
                              }}>
                                <AlertTriangle className="w-4 h-4 mr-2" /> Issue Strike
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => {
                                setStatusEntity({ type: "worker", entity: worker });
                                setNewStatus(worker.adminStatus?.status || "active");
                                setShowStatusDialog(true);
                              }}>
                                <Shield className="w-4 h-4 mr-2" /> Change Status
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem onClick={() => {
                                setBillingEntity({ type: "worker", entity: worker });
                                setShowBillingDialog(true);
                              }}>
                                <DollarSign className="w-4 h-4 mr-2" /> Billing Action
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </div>
                    ))}
                    {filteredWorkers.length === 0 && (
                      <p className="text-center text-muted-foreground py-8">No workers found</p>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
          
          <TabsContent value="companies">
            <Card>
              <CardHeader>
                <CardTitle>All Companies</CardTitle>
                <CardDescription>Manage all registered companies</CardDescription>
              </CardHeader>
              <CardContent>
                {loadingCompanies ? (
                  <div className="flex justify-center py-8">
                    <RefreshCw className="w-6 h-6 animate-spin" />
                  </div>
                ) : (
                  <div className="space-y-3 sm:space-y-4">
                    {filteredCompanies.map((company) => (
                      <div key={company.id} className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between sm:p-4 border border-border rounded-lg bg-card">
                        <div className="flex items-start gap-3 sm:gap-4 min-w-0">
                          <Avatar className="h-10 w-10 sm:h-9 sm:w-9 shrink-0">
                            <AvatarImage src={company.companyLogo || undefined} />
                            <AvatarFallback className="text-sm">{company.companyName?.[0] || "C"}</AvatarFallback>
                          </Avatar>
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="font-medium text-foreground truncate">{company.companyName || "Unnamed Company"}</p>
                              {getStatusBadge(company.adminStatus?.status ?? undefined)}
                            </div>
                            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground mt-1">
                              <span className="flex items-center gap-1 truncate min-w-0"><Mail className="h-3.5 w-3.5 shrink-0" />{company.email}</span>
                              {company.phone && <span className="flex items-center gap-1"><Phone className="h-3.5 w-3.5 shrink-0" />{company.phone}</span>}
                            </div>
                            {company.city && <span className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5"><MapPin className="h-3 w-3 shrink-0" />{company.city}, {company.state}</span>}
                          </div>
                        </div>
                        <div className="flex items-center justify-between gap-2 sm:justify-end sm:shrink-0 border-t border-border pt-3 sm:border-0 sm:pt-0">
                          <div className="text-left sm:text-right">
                            <p className="text-sm font-medium text-foreground">
                              Balance: ${((company.depositAmount || 0) / 100).toLocaleString()}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              Joined {company.createdAt ? format(new Date(company.createdAt), 'MMM d, yyyy') : 'N/A'}
                            </p>
                          </div>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-10 w-10 shrink-0 sm:h-9 sm:w-9" data-testid={`button-company-actions-${company.id}`} aria-label="Actions">
                                <MoreVertical className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem
                                onClick={async () => {
                                  try {
                                    const r = await adminImpersonate.mutateAsync(company.id);
                                    toast({ title: "Viewing as user" });
                                    navigate(r.role === "worker" ? "/dashboard" : "/company-dashboard");
                                  } catch (err: any) {
                                    toast({ title: err?.message ?? "Failed", variant: "destructive" });
                                  }
                                }}
                                disabled={adminImpersonate.isPending}
                              >
                                <UserCircle className="w-4 h-4 mr-2" /> View as user
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => {
                                setStatusEntity({ type: "company", entity: company });
                                setNewStatus(company.adminStatus?.status || "active");
                                setShowStatusDialog(true);
                              }}>
                                <Shield className="w-4 h-4 mr-2" /> Change Status
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem onClick={() => {
                                setBillingEntity({ type: "company", entity: company });
                                setShowBillingDialog(true);
                              }}>
                                <DollarSign className="w-4 h-4 mr-2" /> Billing Action
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem onClick={() => {
                                setSettingsCompany(company);
                                setAutoReplenishThreshold(((company.autoReplenishThreshold || 200000) / 100).toString());
                                setShowSettingsDialog(true);
                              }} data-testid={`button-company-settings-${company.id}`}>
                                <Settings className="w-4 h-4 mr-2" /> Balance Settings
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </div>
                    ))}
                    {filteredCompanies.length === 0 && (
                      <p className="text-center text-muted-foreground py-8">No companies found</p>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
          
          <TabsContent value="jobs">
            <Card>
              <CardHeader>
                <CardTitle>All Jobs</CardTitle>
                <CardDescription>Manage all posted jobs. Search and filter by status.</CardDescription>
                <div className="flex flex-wrap items-center gap-2 pt-2">
                  <Label className="text-sm text-muted-foreground">Status:</Label>
                  <Select value={jobStatusFilter || "all"} onValueChange={(v) => setJobStatusFilter(v === "all" ? "" : v)}>
                    <SelectTrigger className="w-[160px] h-9">
                      <SelectValue placeholder="All statuses" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All statuses</SelectItem>
                      <SelectItem value="open">Open</SelectItem>
                      <SelectItem value="in_progress">In progress</SelectItem>
                      <SelectItem value="completed">Completed</SelectItem>
                      <SelectItem value="cancelled">Cancelled</SelectItem>
                    </SelectContent>
                  </Select>
                  {jobStatusFilter && (
                    <span className="text-xs text-muted-foreground">({jobsByStatus.length} shown)</span>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                {loadingJobs ? (
                  <div className="flex justify-center py-8">
                    <RefreshCw className="w-6 h-6 animate-spin text-muted-foreground" />
                  </div>
                ) : (
                  <div className="space-y-3 sm:space-y-4">
                    {jobsByStatus.map((job) => (
                      <div key={job.id} className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between sm:p-4 border border-border rounded-lg bg-card">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2 mb-1">
                            <p className="font-medium text-foreground truncate">{job.title}</p>
                            {getJobStatusBadge(job.status)}
                          </div>
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
                            <span className="flex items-center gap-1 truncate min-w-0"><Building className="h-3.5 w-3.5 shrink-0" />{job.companyName}</span>
                            <span className="flex items-center gap-1 truncate min-w-0"><MapPin className="h-3.5 w-3.5 shrink-0" />{job.location}</span>
                          </div>
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground mt-1">
                            <span>${(job.hourlyRate / 100).toFixed(0)}/hr</span>
                            <span>{job.workersHired || 0}/{job.maxWorkersNeeded || 1} workers</span>
                            <span>{job.startDate ? format(new Date(job.startDate), 'MMM d, yyyy') : 'N/A'}</span>
                          </div>
                        </div>
                        <div className="flex justify-end border-t border-border pt-3 sm:border-0 sm:pt-0 sm:shrink-0">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-10 w-10 sm:h-9 sm:w-9 shrink-0" data-testid={`button-job-actions-${job.id}`} aria-label="Actions">
                                <MoreVertical className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              onClick={async () => {
                                try {
                                  await adminImpersonate.mutateAsync(job.companyId);
                                  toast({ title: "Viewing as company" });
                                  navigate("/company-dashboard");
                                } catch (err: any) {
                                  toast({ title: err?.message ?? "Failed", variant: "destructive" });
                                }
                              }}
                              disabled={adminImpersonate.isPending}
                            >
                              <UserCircle className="w-4 h-4 mr-2" /> View as company
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => {
                              setSelectedJob(job);
                              setJobAction("cancelled");
                              setShowJobActionDialog(true);
                            }}>
                              <X className="w-4 h-4 mr-2" /> Cancel Job
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => {
                              setSelectedJob(job);
                              setJobAction("completed");
                              setShowJobActionDialog(true);
                            }}>
                              <Check className="w-4 h-4 mr-2" /> Mark Completed
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                        </div>
                      </div>
                    ))}
                    {jobsByStatus.length === 0 && (
                      <p className="text-center text-muted-foreground py-8">
                        {filteredJobs.length === 0 ? "No jobs found" : jobStatusFilter ? `No ${jobStatusFilter.replace("_", " ")} jobs` : "No jobs found"}
                      </p>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
          
          <TabsContent value="billing">
            <Card>
              <CardHeader>
                <CardTitle>Billing Actions</CardTitle>
                <CardDescription>View all billing adjustments and actions. Search filters by reason, entity, action type, or performer.</CardDescription>
              </CardHeader>
              <CardContent>
                {loadingBilling ? (
                  <div className="flex justify-center py-8">
                    <RefreshCw className="w-6 h-6 animate-spin" />
                  </div>
                ) : (
                  <div className="space-y-3 sm:space-y-4">
                    {filteredBilling.map((action) => (
                      <div key={action.id} className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between sm:p-4 border border-border rounded-lg bg-card">
                        <div className="flex items-start gap-3 sm:gap-4 min-w-0">
                          <div className={`p-2 rounded-lg shrink-0 ${action.actionType === 'credit' || action.actionType === 'refund' ? 'bg-green-100 dark:bg-green-900/30' : 'bg-red-100 dark:bg-red-900/30'}`}>
                            {action.actionType === 'credit' || action.actionType === 'refund' ? (
                              <TrendingUp className="h-5 w-5 text-green-600 dark:text-green-400" />
                            ) : (
                              <TrendingDown className="h-5 w-5 text-red-600 dark:text-red-400" />
                            )}
                          </div>
                          <div className="min-w-0">
                            <p className="font-medium text-foreground">{action.reason}</p>
                            <p className="text-sm text-muted-foreground">
                              {action.entityType} #{action.entityId} - {action.actionType}
                            </p>
                          </div>
                        </div>
                        <div className="text-left sm:text-right border-t border-border pt-3 sm:border-0 sm:pt-0 shrink-0">
                          <p className={`font-medium ${action.actionType === 'credit' || action.actionType === 'refund' ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                            {action.actionType === 'credit' || action.actionType === 'refund' ? '+' : '-'}${(action.amountCents / 100).toFixed(2)}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {action.createdAt ? format(new Date(action.createdAt), 'MMM d, yyyy h:mm a') : 'N/A'}
                          </p>
                        </div>
                      </div>
                    ))}
                    {filteredBilling.length === 0 && (
                      <p className="text-center text-muted-foreground py-8">{billingActions.length === 0 ? "No billing actions recorded" : "No billing actions match search"}</p>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
          
          <TabsContent value="activity">
            <Card>
              <CardHeader>
                <CardTitle>Activity Log</CardTitle>
                <CardDescription>Recent admin actions and changes. Search filters by action, entity, or admin email.</CardDescription>
                <div className="flex flex-wrap items-center gap-2 pt-2">
                  <Label className="text-sm text-muted-foreground">Show last:</Label>
                  <Select value={String(activityLogLimit)} onValueChange={(v) => setActivityLogLimit(Number(v))}>
                    <SelectTrigger className="w-[120px] h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="50">50 entries</SelectItem>
                      <SelectItem value="100">100 entries</SelectItem>
                      <SelectItem value="250">250 entries</SelectItem>
                      <SelectItem value="500">500 entries</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </CardHeader>
              <CardContent>
                {loadingActivity ? (
                  <div className="flex justify-center py-8">
                    <RefreshCw className="w-6 h-6 animate-spin" />
                  </div>
                ) : (
                  <div className="space-y-4">
                    {filteredActivity.map((log) => (
                      <div key={log.id} className="flex items-start gap-3 sm:gap-4 p-3 sm:p-4 border border-border rounded-lg bg-card">
                        <div className="p-2 bg-muted rounded-lg shrink-0">
                          <Activity className="h-4 w-4 text-muted-foreground" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="font-medium text-foreground">{log.action.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}</p>
                          <p className="text-sm text-muted-foreground">
                            {log.entityType} {log.entityId ? `#${log.entityId}` : ''}
                          </p>
                          <p className="text-xs text-muted-foreground mt-1">
                            By {log.adminEmail} - {log.createdAt ? format(new Date(log.createdAt), 'MMM d, yyyy h:mm a') : 'N/A'}
                          </p>
                        </div>
                      </div>
                    ))}
                    {filteredActivity.length === 0 && (
                      <p className="text-center text-muted-foreground py-8">{activityLog.length === 0 ? "No activity recorded" : "No activity matches search"}</p>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </main>
      
      <Dialog open={showStrikeDialog} onOpenChange={setShowStrikeDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Issue Strike</DialogTitle>
            <DialogDescription>
              Issue a strike to {selectedWorker?.firstName} {selectedWorker?.lastName}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Reason</Label>
              <Input 
                value={strikeReason}
                onChange={(e) => setStrikeReason(e.target.value)}
                placeholder="Reason for strike"
                data-testid="input-strike-reason"
              />
            </div>
            <div>
              <Label>Severity</Label>
              <Select value={strikeSeverity} onValueChange={setStrikeSeverity}>
                <SelectTrigger data-testid="select-strike-severity">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="warning">Warning</SelectItem>
                  <SelectItem value="minor">Minor</SelectItem>
                  <SelectItem value="major">Major</SelectItem>
                  <SelectItem value="critical">Critical</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Notes (optional)</Label>
              <Textarea 
                value={strikeNotes}
                onChange={(e) => setStrikeNotes(e.target.value)}
                placeholder="Additional notes..."
                data-testid="input-strike-notes"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowStrikeDialog(false)}>Cancel</Button>
            <Button 
              onClick={handleIssueStrike} 
              disabled={!strikeReason || issueStrike.isPending}
              data-testid="button-confirm-strike"
            >
              {issueStrike.isPending ? <RefreshCw className="w-4 h-4 animate-spin mr-2" /> : null}
              Issue Strike
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      
      <Dialog open={showStatusDialog} onOpenChange={setShowStatusDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Change Status</DialogTitle>
            <DialogDescription>
              Update status for {statusEntity?.type === "worker" 
                ? `${(statusEntity.entity as WorkerWithAdmin).firstName} ${(statusEntity.entity as WorkerWithAdmin).lastName}`
                : (statusEntity?.entity as CompanyWithAdmin)?.companyName}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Status</Label>
              <Select value={newStatus} onValueChange={setNewStatus}>
                <SelectTrigger data-testid="select-entity-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="suspended">Suspended</SelectItem>
                  <SelectItem value="banned">Banned</SelectItem>
                  <SelectItem value="under_review">Under Review</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Reason</Label>
              <Textarea 
                value={statusReason}
                onChange={(e) => setStatusReason(e.target.value)}
                placeholder="Reason for status change..."
                data-testid="input-status-reason"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowStatusDialog(false)}>Cancel</Button>
            <Button 
              onClick={handleUpdateStatus} 
              disabled={!statusReason || updateWorkerStatus.isPending || updateCompanyStatus.isPending}
              data-testid="button-confirm-status"
            >
              Update Status
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      
      <Dialog open={showBillingDialog} onOpenChange={setShowBillingDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Billing Action</DialogTitle>
            <DialogDescription>
              Create a billing adjustment for {billingEntity?.type === "company" 
                ? (billingEntity.entity as Profile).companyName 
                : `${(billingEntity?.entity as Profile)?.firstName} ${(billingEntity?.entity as Profile)?.lastName}`}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Action Type</Label>
              <Select value={billingActionType} onValueChange={setBillingActionType}>
                <SelectTrigger data-testid="select-billing-action">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="credit">Credit (Add)</SelectItem>
                  <SelectItem value="debit">Debit (Remove)</SelectItem>
                  <SelectItem value="refund">Refund</SelectItem>
                  <SelectItem value="adjustment">Adjustment</SelectItem>
                  <SelectItem value="waive">Waive</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Amount ($)</Label>
              <Input 
                type="number"
                step="0.01"
                value={billingAmount}
                onChange={(e) => setBillingAmount(e.target.value)}
                placeholder="0.00"
                data-testid="input-billing-amount"
              />
            </div>
            <div>
              <Label>Reason</Label>
              <Textarea 
                value={billingReason}
                onChange={(e) => setBillingReason(e.target.value)}
                placeholder="Reason for billing action..."
                data-testid="input-billing-reason"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowBillingDialog(false)}>Cancel</Button>
            <Button 
              onClick={handleBillingAction} 
              disabled={!billingAmount || !billingReason || createBillingAction.isPending}
              data-testid="button-confirm-billing"
            >
              Apply Action
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      
      <Dialog open={showJobActionDialog} onOpenChange={setShowJobActionDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Job Action</DialogTitle>
            <DialogDescription>
              {jobAction === "cancelled" ? "Cancel" : "Complete"} job: {selectedJob?.title}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Reason</Label>
              <Textarea 
                value={jobActionReason}
                onChange={(e) => setJobActionReason(e.target.value)}
                placeholder="Reason for this action..."
                data-testid="input-job-action-reason"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowJobActionDialog(false)}>Cancel</Button>
            <Button 
              onClick={handleJobAction} 
              disabled={!jobActionReason || updateJobStatus.isPending}
              variant={jobAction === "cancelled" ? "destructive" : "default"}
              data-testid="button-confirm-job-action"
            >
              {jobAction === "cancelled" ? "Cancel Job" : "Complete Job"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      
      <Dialog open={showResolveStrikeDialog} onOpenChange={setShowResolveStrikeDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Resolve strike</DialogTitle>
            <DialogDescription>Mark this strike as resolved. Optional notes will be stored.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Notes (optional)</Label>
              <Textarea
                value={resolveStrikeNotes}
                onChange={(e) => setResolveStrikeNotes(e.target.value)}
                placeholder="Resolution notes..."
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowResolveStrikeDialog(false); setResolveStrikeId(null); }}>Cancel</Button>
            <Button
              onClick={async () => {
                if (resolveStrikeId == null) return;
                try {
                  await resolveStrike.mutateAsync({ strikeId: resolveStrikeId, notes: resolveStrikeNotes || undefined });
                  toast({ title: "Strike resolved" });
                  setShowResolveStrikeDialog(false);
                  setResolveStrikeId(null);
                  setResolveStrikeNotes("");
                } catch (err: any) {
                  toast({ title: err?.message ?? "Failed to resolve", variant: "destructive" });
                }
              }}
              disabled={resolveStrike.isPending || resolveStrikeId == null}
            >
              {resolveStrike.isPending ? <RefreshCw className="w-4 h-4 animate-spin mr-2" /> : null}
              Resolve strike
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showSettingsDialog} onOpenChange={setShowSettingsDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Balance Settings</DialogTitle>
            <DialogDescription>
              Configure auto-replenishment for {settingsCompany?.companyName || "company"}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Auto-Replenish Target ($)</Label>
              <p className="text-xs text-muted-foreground mb-2">
                When the balance drops to 50% of this amount, auto-replenishment will restore it to this target.
              </p>
              <Input 
                type="number"
                step="100"
                min="500"
                value={autoReplenishThreshold}
                onChange={(e) => setAutoReplenishThreshold(e.target.value)}
                placeholder="2000"
                data-testid="input-auto-replenish-threshold"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Minimum $500. Default is $2,000. Current trigger: ${(parseFloat(autoReplenishThreshold || "2000") / 2).toLocaleString()}
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowSettingsDialog(false)}>Cancel</Button>
            <Button 
              onClick={handleUpdateSettings} 
              disabled={!autoReplenishThreshold || updateCompanySettings.isPending}
              data-testid="button-confirm-settings"
            >
              Save Settings
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
