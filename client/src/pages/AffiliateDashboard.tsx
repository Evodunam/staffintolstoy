import React, { useState, useMemo } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useLocation, Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest, fetchAffiliateMe } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Kanban,
  KanbanBoard,
  KanbanColumn,
  KanbanColumnContent,
  KanbanItem,
  KanbanItemHandle,
  KanbanOverlay,
} from "@/components/ui/kanban";
import {
  Link2,
  Copy,
  Users,
  Building2,
  BarChart3,
  ExternalLink,
  Loader2,
  Share2,
  DollarSign,
  Home,
  TrendingUp,
  Menu,
  CreditCard,
  User,
  Shield,
  ChevronRight,
  ArrowLeft,
  Plus,
  X,
  Upload,
  FileText,
  Check,
  MoreVertical,
  Edit,
  Landmark,
  Phone,
  Mail,
  LogOut,
} from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { DialogFooter } from "@/components/ui/dialog";
import { ResponsiveDialog } from "@/components/ui/responsive-dialog";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { GooglePlacesAutocomplete } from "@/components/GooglePlacesAutocomplete";
import { AnimatedNavigationTabs } from "@/components/ui/animated-navigation-tabs";

type AffiliateTab = "home" | "sales" | "analytics" | "menu";

const KANBAN_STAGES = ["lead", "contacted", "closed_won", "closed_lost"] as const;
type LeadStage = (typeof KANBAN_STAGES)[number];
// Stages that can be set manually (closed_won is only set when lead creates an account)
const MOVABLE_STAGES: LeadStage[] = ["lead", "contacted", "closed_lost"];

export default function AffiliateDashboard() {
  const { user, isAuthenticated, isLoading: authLoading, logout } = useAuth();
  const [locationPath, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [copiedLink, setCopiedLink] = useState<"worker" | "company" | string | null>(null);
  const [createLeadOpen, setCreateLeadOpen] = useState(false);
  const [leadDetailLeadId, setLeadDetailLeadId] = useState<number | null>(null);
  const [salesViewType, setSalesViewType] = useState<"kanban" | "list">("kanban");
  const [menuSelection, setMenuSelection] = useState<"payout" | "details" | "status" | "sales" | "payments" | "type">("payout");
  const [showPayoutDialog, setShowPayoutDialog] = useState(false);
  const [showSalesDialog, setShowSalesDialog] = useState(false);
  const [showPaymentHistoryDialog, setShowPaymentHistoryDialog] = useState(false);
  const [editingDetailsField, setEditingDetailsField] = useState<string | null>(null);
  const [detailsFormData, setDetailsFormData] = useState({
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    address: "",
    experienceBlurb: "",
  });
  const isMobile = useIsMobile();

  const { data: affiliate, isLoading: affiliateLoading } = useQuery({
    queryKey: ["/api/affiliates/me"],
    queryFn: fetchAffiliateMe,
    retry: false,
    enabled: isAuthenticated && !!user?.id,
  });

  const { data: links } = useQuery({
    queryKey: ["/api/affiliates/me/links"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/affiliates/me/links");
      return res.json();
    },
    enabled: !!affiliate,
  });

  const { data: referralsData } = useQuery({
    queryKey: ["/api/affiliates/me/referrals"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/affiliates/me/referrals");
      return res.json();
    },
    enabled: !!affiliate,
  });
  const referrals = Array.isArray(referralsData) ? referralsData : [];

  const { data: paymentHistoryData } = useQuery({
    queryKey: ["/api/affiliates/me/payment-history"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/affiliates/me/payment-history");
      return res.json();
    },
    enabled: !!affiliate,
  });
  const paymentHistory = Array.isArray(paymentHistoryData) ? paymentHistoryData : [];

  const { data: leadsData } = useQuery({
    queryKey: ["/api/affiliates/me/leads"],
    queryFn: async () => {
      try {
        const res = await apiRequest("GET", "/api/affiliates/me/leads");
        return res.json();
      } catch (e: any) {
        if (e?.status === 404) return [];
        throw e;
      }
    },
    enabled: !!affiliate && !!(affiliate as any)?.salesTrackerEnabled,
  });
  const leads: any[] = Array.isArray(leadsData) ? leadsData : [];

  const updateAffiliateMutation = useMutation({
    mutationFn: async (body: { salesTrackerEnabled?: boolean; type?: "sales" | "url" }) => {
      const res = await apiRequest("PATCH", "/api/affiliates/me", body);
      return res.json();
    },
    onMutate: async (body) => {
      if (body.salesTrackerEnabled === undefined && body.type === undefined) return undefined;
      await queryClient.cancelQueries({ queryKey: ["/api/affiliates/me"] });
      const prev = queryClient.getQueryData(["/api/affiliates/me"]);
      queryClient.setQueryData(["/api/affiliates/me"], (old: any) => {
        if (!old) return old;
        const next = { ...old };
        if (body.salesTrackerEnabled !== undefined) next.salesTrackerEnabled = body.salesTrackerEnabled;
        if (body.type !== undefined) next.type = body.type;
        return next;
      });
      return { prev };
    },
    onSuccess: (data: any) => {
      if (data && typeof data === "object") queryClient.setQueryData(["/api/affiliates/me"], data);
      queryClient.invalidateQueries({ queryKey: ["/api/affiliates/me"] });
      toast({ title: "Sales tracker updated" });
      if (data?.salesTrackerEnabled) setLocation("/affiliate-dashboard/sales");
    },
    onError: (e: any, _vars, ctx: any) => {
      if (ctx?.prev) queryClient.setQueryData(["/api/affiliates/me"], ctx.prev);
      toast({ title: e?.message ?? "Failed to update", variant: "destructive" });
    },
  });

  const createLeadMutation = useMutation({
    mutationFn: async (body: { name: string; email: string; phone: string; businessName: string; accountType: "worker" | "company" }) => {
      const res = await apiRequest("POST", "/api/affiliates/me/leads", body);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/affiliates/me/leads"] });
      setCreateLeadOpen(false);
      toast({ title: "Lead created" });
    },
    onError: (e: any) => toast({ title: e?.message || "Failed to create lead", variant: "destructive" }),
  });

  const connectPayoutMutation = useMutation({
    mutationFn: async (body: { routingNumber: string; accountNumber: string; accountType: string; bankName: string; address: string; city: string; state: string; zipCode: string; email?: string }) => {
      const res = await apiRequest("POST", "/api/mt/affiliate/payout-account", body);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/affiliates/me"] });
      setShowPayoutDialog(false);
      toast({ title: "Payout account connected" });
    },
    onError: (e: any) => toast({ title: e?.message ?? "Failed to connect payout account", variant: "destructive" }),
  });

  const seedSampleMutation = useMutation({
    mutationFn: async (affiliateCode: string) => {
      const res = await apiRequest("POST", "/api/dev/seed-affiliate-sample", { code: affiliateCode });
      return res.json();
    },
    onSuccess: (data: { success?: boolean; created?: { leads: number; referrals: number; commissions: number }; message?: string }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/affiliates/me"] });
      queryClient.invalidateQueries({ queryKey: ["/api/affiliates/me/referrals"] });
      queryClient.invalidateQueries({ queryKey: ["/api/affiliates/me/leads"] });
      const c = data?.created;
      const msg = c
        ? `Seeded: ${c.leads} closed_won leads, ${c.referrals} referrals, ${c.commissions} commission(s). Check Analytics and Sales.`
        : (data?.message ?? "Sample data seeded.");
      toast({ title: msg });
    },
    onError: (e: any) => toast({ title: e?.message ?? "Seed failed", variant: "destructive" }),
  });

  const w9UploadMutation = useMutation({
    mutationFn: async (body: { w9DocumentUrl: string }) => {
      const res = await apiRequest("POST", "/api/affiliates/me/w9", body);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/affiliates/me"] });
      toast({ title: "W-9 uploaded to Mercury for tax purposes" });
    },
    onError: (e: any) => toast({ title: e?.message ?? "Failed to upload W-9", variant: "destructive" }),
  });

  const updateLeadStageMutation = useMutation({
    mutationFn: async ({ id, stage }: { id: number; stage: LeadStage }) => {
      const res = await apiRequest("PATCH", `/api/affiliates/me/leads/${id}`, { stage });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/affiliates/me/leads"] });
    },
    onError: (e: any) => toast({ title: e?.message || "Failed to update stage", variant: "destructive" }),
  });

  const updateLeadMutation = useMutation({
    mutationFn: async ({ id, ...updates }: { id: number; accountType?: "worker" | "company"; stage?: LeadStage }) => {
      const res = await apiRequest("PATCH", `/api/affiliates/me/leads/${id}`, updates);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/affiliates/me/leads"] });
    },
    onError: (e: any) => toast({ title: e?.message || "Failed to update lead", variant: "destructive" }),
  });

  const addActivityMutation = useMutation({
    mutationFn: async ({ leadId, body }: { leadId: number; body: string }) => {
      const res = await apiRequest("POST", `/api/affiliates/me/leads/${leadId}/activities`, { body });
      return res.json();
    },
    onSuccess: (_data, { leadId }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/affiliates/me/leads", leadId, "activities"] });
    },
    onError: (e: any) => toast({ title: e?.message || "Failed to add activity", variant: "destructive" }),
  });

  const importLeadsMutation = useMutation({
    mutationFn: async (leads: { name?: string; email: string; phone?: string; businessName?: string; accountType?: "worker" | "company" }[]) => {
      const res = await apiRequest("POST", "/api/affiliates/me/leads/import", { leads });
      return res.json();
    },
    onSuccess: (data: { created: number; skipped: number; skippedDetails?: { row: number; email: string | null; reason: string }[] }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/affiliates/me/leads"] });
      setCreateLeadOpen(false);
      const msg = data.created > 0
        ? `Imported ${data.created} lead(s)${data.skipped > 0 ? `; ${data.skipped} skipped (existing account or missing email)` : ""}`
        : data.skipped > 0
          ? `No leads created. ${data.skipped} row(s) skipped (existing account or missing email).`
          : "No rows to import.";
      toast({ title: msg });
    },
    onError: (e: any) => toast({ title: e?.message || "Failed to import leads", variant: "destructive" }),
  });

  const updateAffiliateDetailsMutation = useMutation({
    mutationFn: async (body: { firstName?: string; lastName?: string; email?: string; phone?: string; address?: string; experienceBlurb?: string }) => {
      const res = await apiRequest("PATCH", "/api/affiliates/me", body);
      return res.json();
    },
    onSuccess: (data: any) => {
      if (data && typeof data === "object") queryClient.setQueryData(["/api/affiliates/me"], data);
      queryClient.invalidateQueries({ queryKey: ["/api/affiliates/me"] });
      setEditingDetailsField(null);
      toast({ title: "Account details updated" });
    },
    onError: (e: any) => toast({ title: e?.message ?? "Failed to update", variant: "destructive" }),
  });

  const saveDetailsField = (field: keyof typeof detailsFormData) => {
    const value = detailsFormData[field];
    updateAffiliateDetailsMutation.mutate({ [field]: value }, { onSuccess: () => setEditingDetailsField(null) });
  };

  const copyLink = (which: "worker" | "company" | string, url: string) => {
    navigator.clipboard.writeText(url);
    setCopiedLink(which);
    toast({ title: "Link copied to clipboard" });
    setTimeout(() => setCopiedLink(null), 2000);
  };

  const getActiveTab = (): AffiliateTab => {
    if (locationPath === "/affiliate-dashboard/analytics") return "analytics";
    if (locationPath === "/affiliate-dashboard/sales") return "sales";
    if (locationPath === "/affiliate-dashboard/menu") return "menu";
    return "home";
  };
  const activeTab = getActiveTab();
  const setActiveTab = (tab: AffiliateTab) => {
    if (tab === "home") setLocation("/affiliate-dashboard");
    else setLocation(`/affiliate-dashboard/${tab}`);
  };

  React.useEffect(() => {
    if (affiliate && typeof affiliate === "object") {
      const a = affiliate as any;
      setDetailsFormData({
        firstName: a.firstName ?? "",
        lastName: a.lastName ?? "",
        email: a.email ?? "",
        phone: a.phone ?? "",
        address: a.address ?? "",
        experienceBlurb: a.experienceBlurb ?? "",
      });
    }
  }, [affiliate]);

  React.useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      setLocation("/login");
      return;
    }
    if (!affiliateLoading && isAuthenticated && !affiliate) {
      setLocation("/affiliate-onboarding");
      return;
    }
  }, [authLoading, isAuthenticated, affiliateLoading, affiliate, setLocation]);

  if (authLoading || (isAuthenticated && affiliateLoading && !affiliate)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const salesTrackerEnabled = !!(affiliate as any)?.salesTrackerEnabled;
  const accountType = (affiliate as any)?.type === "sales" ? "Sales" : "URL-based";
  const code = (links as any)?.code ?? (affiliate as any)?.code ?? "";
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const isLocalhost = typeof window !== "undefined" && (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1");
  // Unique referral URLs: worker/company onboarding with ref=affiliate code so signups are attributed to this affiliate
  const workerLink = (links as any)?.workerLink ?? (code && origin ? `${origin}/worker-onboarding?ref=${encodeURIComponent(code)}` : "");
  const companyLink = (links as any)?.companyLink ?? (code && origin ? `${origin}/company-onboarding?ref=${encodeURIComponent(code)}` : "");
  const workerCount = referrals.filter((r: any) => r.role === "worker").length;
  const companyCount = referrals.filter((r: any) => r.role === "company").length;

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header: title always; nav tabs only on desktop (mobile uses footer) */}
      <header className="sticky top-0 z-50 bg-background border-b border-border">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
          <span
            className="font-bold text-xl text-foreground cursor-pointer hover:text-primary transition-colors"
            onClick={() => setActiveTab("home")}
          >
            Affiliate Dashboard
          </span>
          <nav className="hidden md:block overflow-x-auto scrollbar-hide">
            <AnimatedNavigationTabs
              items={[
                { id: "home", label: "Home", onClick: () => setActiveTab("home") },
                ...(salesTrackerEnabled ? [{ id: "sales", label: "Sales", onClick: () => setActiveTab("sales") }] : []),
                { id: "analytics", label: "Analytics", onClick: () => setActiveTab("analytics") },
                { id: "menu", label: "Menu", onClick: () => setActiveTab("menu") },
              ]}
              value={activeTab}
              onValueChange={(id) => setActiveTab(id as AffiliateTab)}
            />
          </nav>
        </div>
      </header>

      <main className={`flex-1 max-w-5xl w-full mx-auto px-4 py-6 space-y-6 ${isMobile ? "pb-24" : ""}`}>
        {/* Banner: payments queued until bank + W-9 set up */}
        {(!(affiliate as any)?.mercuryRecipientId || !(affiliate as any)?.w9UploadedAt) && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/40 px-4 py-3 flex flex-wrap items-center gap-2">
            <Shield className="w-5 h-5 text-amber-600 dark:text-amber-500 shrink-0" />
            <p className="text-sm text-amber-800 dark:text-amber-200">
              Payments cannot be sent to your account until you set up your <strong>bank account</strong> and <strong>W-9</strong>. Pending commissions will remain in queue until both are complete.
            </p>
            <Button
              variant="outline"
              size="sm"
              className="border-amber-300 dark:border-amber-700 text-amber-800 dark:text-amber-200 shrink-0"
              onClick={() => setShowPayoutDialog(true)}
            >
              Set up payout
            </Button>
          </div>
        )}
        {/* Home tab */}
        {activeTab === "home" && (
          <>
            <section>
              <h1 className="text-2xl font-bold text-foreground mb-1">
                Hi, {(affiliate as any)?.firstName || "Affiliate"}
              </h1>
              <p className="text-muted-foreground">
                Share your unique links. You earn 20% of net profit from company jobs and 20% of worker job amounts for the first year.
              </p>
            </section>

            <Card className="border border-border bg-card">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-foreground">
                  <Share2 className="w-5 h-5 text-primary" />
                  Your referral links
                </CardTitle>
                <p className="text-sm text-muted-foreground font-normal">
                  Use these links so signups are tied to your account. Your code: <strong>{code}</strong>
                </p>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label className="text-sm font-medium text-foreground">For service professionals (workers)</Label>
                  <div className="flex gap-2">
                    <Input readOnly value={workerLink} className="font-mono text-sm bg-muted" />
                    <Button
                      size="icon"
                      variant="outline"
                      className="shrink-0"
                      onClick={() => copyLink("worker", workerLink)}
                    >
                      {copiedLink === "worker" ? <CheckIcon className="w-4 h-4 text-green-600" /> : <Copy className="w-4 h-4" />}
                    </Button>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label className="text-sm font-medium text-foreground">For companies</Label>
                  <div className="flex gap-2">
                    <Input readOnly value={companyLink} className="font-mono text-sm bg-muted" />
                    <Button
                      size="icon"
                      variant="outline"
                      className="shrink-0"
                      onClick={() => copyLink("company", companyLink)}
                    >
                      {copiedLink === "company" ? <CheckIcon className="w-4 h-4 text-green-600" /> : <Copy className="w-4 h-4" />}
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="border border-border bg-card">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-foreground">
                  <TrendingUp className="w-5 h-5 text-primary" />
                  Summary
                </CardTitle>
                <p className="text-sm text-muted-foreground font-normal">
                  People who signed up using your links
                </p>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-4">
                  <div className="flex items-center gap-2 px-4 py-2 rounded-lg bg-muted">
                    <Users className="w-5 h-5 text-primary" />
                    <span className="font-semibold text-foreground">{workerCount}</span>
                    <span className="text-sm text-muted-foreground">Workers</span>
                  </div>
                  <div className="flex items-center gap-2 px-4 py-2 rounded-lg bg-muted">
                    <Building2 className="w-5 h-5 text-primary" />
                    <span className="font-semibold text-foreground">{companyCount}</span>
                    <span className="text-sm text-muted-foreground">Companies</span>
                  </div>
                </div>
              </CardContent>
            </Card>

            {isLocalhost && (
              <Card className="border-dashed border-amber-500/50 bg-amber-500/5">
                <CardHeader>
                  <CardTitle className="text-base text-amber-700 dark:text-amber-400">Dev: Seed sample data</CardTitle>
                  <p className="text-sm text-muted-foreground font-normal">
                    Add closed_won leads, referral profiles (Analytics), and one approved-timesheet commission (payout testing). Uses your current referral code: <strong>{code || "—"}</strong>
                  </p>
                </CardHeader>
                <CardContent>
                  <Button
                    variant="outline"
                    size="sm"
                    className="border-amber-500/50 text-amber-700 dark:text-amber-400 hover:bg-amber-500/10"
                    disabled={!code || seedSampleMutation.isPending}
                    onClick={() => seedSampleMutation.mutate(code)}
                  >
                    {seedSampleMutation.isPending ? "Seeding..." : "Seed sample data"}
                  </Button>
                </CardContent>
              </Card>
            )}

          </>
        )}

        {/* Sales tab - only when salesTrackerEnabled */}
        {activeTab === "sales" && salesTrackerEnabled && (
          <>
            <section className="flex items-center justify-between gap-4 flex-wrap">
              <div>
                <h1 className="text-2xl font-bold text-foreground mb-1">Sales</h1>
                <p className="text-muted-foreground">
                  {salesViewType === "kanban" ? "Kanban: leads without TS accounts. Each lead has a unique redeem URL that prepopulates onboarding." : "Leads list. Switch to Kanban for board view."}
                </p>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <div className="flex rounded-lg border border-border bg-muted/30 p-0.5">
                  <button
                    type="button"
                    onClick={() => setSalesViewType("list")}
                    className={cn("px-3 py-1.5 text-sm font-medium rounded-md transition-colors", salesViewType === "list" ? "bg-background text-foreground shadow" : "text-muted-foreground hover:text-foreground")}
                  >
                    List
                  </button>
                  <button
                    type="button"
                    onClick={() => setSalesViewType("kanban")}
                    className={cn("px-3 py-1.5 text-sm font-medium rounded-md transition-colors", salesViewType === "kanban" ? "bg-background text-foreground shadow" : "text-muted-foreground hover:text-foreground")}
                  >
                    Kanban
                  </button>
                </div>
                <Button onClick={() => setCreateLeadOpen(true)} className="gap-2">
                  <Plus className="w-4 h-4" />
                  Create lead
                </Button>
              </div>
            </section>

            {salesViewType === "list" ? (
              <div className="rounded-lg border border-border overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Email</TableHead>
                      <TableHead>Phone</TableHead>
                      <TableHead>Business</TableHead>
                      <TableHead>Stage</TableHead>
                      <TableHead className="w-[120px]">Redeem link</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(leads as any[]).map((lead: any) => (
                      <TableRow key={lead.id} className="cursor-pointer hover:bg-muted/50" onClick={() => setLeadDetailLeadId(lead.id)}>
                        <TableCell className="font-medium">{lead.name ?? "—"}</TableCell>
                        <TableCell>
                          {lead.email ? (
                            <a href={`mailto:${lead.email}`} className="text-primary hover:underline" onClick={(e) => e.stopPropagation()}>
                              {lead.email}
                            </a>
                          ) : (
                            "—"
                          )}
                        </TableCell>
                        <TableCell>
                          {lead.phone ? (
                            <a href={`tel:${lead.phone.replace(/\D/g, "")}`} className="text-primary hover:underline" onClick={(e) => e.stopPropagation()}>
                              {lead.phone}
                            </a>
                          ) : (
                            "—"
                          )}
                        </TableCell>
                        <TableCell>{lead.businessName ?? "—"}</TableCell>
                        <TableCell onClick={(e) => e.stopPropagation()}>
                          {lead.stage === "closed_won" ? (
                            <span className="text-sm font-medium text-muted-foreground">Closed Won</span>
                          ) : (
                            <Select
                              value={lead.stage}
                              onValueChange={(s) => updateLeadStageMutation.mutate({ id: lead.id, stage: s as LeadStage })}
                            >
                              <SelectTrigger className="h-8 w-[130px]">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {MOVABLE_STAGES.map((s) => (
                                  <SelectItem key={s} value={s}>
                                    {s === "closed_lost" ? "Closed Lost" : s}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          )}
                        </TableCell>
                        <TableCell onClick={(e) => e.stopPropagation()}>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 gap-1"
                            onClick={() => {
                              const redeemPath = lead.accountType === "company" ? "/company-onboarding" : "/worker-onboarding";
                              const redeemUrl = `${origin}${redeemPath}?ref=${encodeURIComponent(code)}&lead=${encodeURIComponent(lead.token)}`;
                              copyLink(lead.token, redeemUrl);
                            }}
                          >
                            {copiedLink === lead.token ? <Check className="w-3.5 h-3.5 text-green-600" /> : <Link2 className="w-3.5 h-3.5" />}
                            Copy
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <LeadsKanbanView
                leads={leads}
                code={code}
                origin={origin}
                copiedLink={copiedLink}
                copyLink={copyLink}
                onMoveStage={(id, stage) => updateLeadStageMutation.mutate({ id, stage })}
                onCardClick={(id) => setLeadDetailLeadId(id)}
                updateLeadStageMutation={updateLeadStageMutation}
                movableStages={MOVABLE_STAGES}
                onCopyToast={(msg) => toast({ title: msg })}
              />
            )}

            <CreateLeadDialog
              open={createLeadOpen}
              onOpenChange={setCreateLeadOpen}
              onSubmit={(body) => createLeadMutation.mutate(body)}
              onImport={(leads) => importLeadsMutation.mutate(leads)}
              isPending={createLeadMutation.isPending}
              isImportPending={importLeadsMutation.isPending}
            />
            <LeadDetailDialog
              leadId={leadDetailLeadId}
              lead={leads.find((l: any) => l.id === leadDetailLeadId)}
              code={code}
              origin={origin}
              onClose={() => setLeadDetailLeadId(null)}
              onMoveStage={(stage) => leadDetailLeadId != null && updateLeadStageMutation.mutate({ id: leadDetailLeadId, stage })}
              onUpdateAccountType={(accountType) => leadDetailLeadId != null && updateLeadMutation.mutate({ id: leadDetailLeadId, accountType })}
              addActivityMutation={addActivityMutation}
              movableStages={MOVABLE_STAGES}
              updateLeadMutation={updateLeadMutation}
            />
          </>
        )}

        {/* Menu tab — Account settings: styled 1:1 like worker dashboard menu */}
        {activeTab === "menu" && (
          <div className={isMobile ? "space-y-0" : "flex min-h-0 flex-1 -mx-4 md:-mx-6"}>
            {isMobile ? (
              <>
                <div className="flex items-center gap-3 px-1 pb-4">
                  <button
                    type="button"
                    onClick={() => setActiveTab("home")}
                    className="w-9 h-9 flex items-center justify-center rounded-full bg-muted hover:bg-muted/80 text-foreground"
                    aria-label="Back"
                  >
                    <ArrowLeft className="w-5 h-5" />
                  </button>
                  <h1 className="text-xl font-bold">Account settings</h1>
                </div>
                <div className="space-y-1">
                  <button type="button" onClick={() => setShowPayoutDialog(true)} className="w-full flex items-center gap-3 py-3 px-2 rounded-lg hover:bg-muted/50 transition-colors text-left" data-testid="menu-payout">
                    <CreditCard className="w-5 h-5 text-muted-foreground flex-shrink-0" />
                    <span className="font-medium flex-1">Payout method</span>
                    <ChevronRight className="w-5 h-5 text-muted-foreground flex-shrink-0" />
                  </button>
                  <button type="button" className="w-full flex items-center gap-3 py-3 px-2 rounded-lg hover:bg-muted/50 transition-colors text-left" data-testid="menu-account-details">
                    <User className="w-5 h-5 text-muted-foreground flex-shrink-0" />
                    <span className="font-medium flex-1">Account details</span>
                    <ChevronRight className="w-5 h-5 text-muted-foreground flex-shrink-0" />
                  </button>
                  <button type="button" className="w-full flex items-center gap-3 py-3 px-2 rounded-lg hover:bg-muted/50 transition-colors text-left" data-testid="menu-account-status">
                    <Shield className="w-5 h-5 text-muted-foreground flex-shrink-0" />
                    <span className="font-medium flex-1">Account status</span>
                    <ChevronRight className="w-5 h-5 text-muted-foreground flex-shrink-0" />
                  </button>
                  <button type="button" onClick={() => setShowSalesDialog(true)} className="w-full flex items-center gap-3 py-3 px-2 rounded-lg hover:bg-muted/50 transition-colors text-left" data-testid="menu-sales-tracker">
                    <TrendingUp className="w-5 h-5 text-muted-foreground flex-shrink-0" />
                    <span className="font-medium flex-1">Sales tracker</span>
                    <ChevronRight className="w-5 h-5 text-muted-foreground flex-shrink-0" />
                  </button>
                  <button type="button" onClick={() => setShowPaymentHistoryDialog(true)} className="w-full flex items-center gap-3 py-3 px-2 rounded-lg hover:bg-muted/50 transition-colors text-left" data-testid="menu-payment-history">
                    <DollarSign className="w-5 h-5 text-muted-foreground flex-shrink-0" />
                    <span className="font-medium flex-1">Payment history</span>
                    <ChevronRight className="w-5 h-5 text-muted-foreground flex-shrink-0" />
                  </button>
                </div>
                <div className="border-t border-border my-5" />
                <div className="w-full flex items-center gap-3 py-3 px-2 rounded-lg bg-muted/30">
                  <DollarSign className="w-5 h-5 text-muted-foreground flex-shrink-0" />
                  <span className="font-medium flex-1">Account type</span>
                  <span className="text-sm font-medium text-foreground">{accountType}</span>
                </div>
                <button type="button" onClick={() => logout()} className="w-full flex items-center gap-3 py-3 px-2 rounded-lg hover:bg-destructive/10 transition-colors text-left text-destructive mt-5" data-testid="menu-logout">
                  <LogOut className="w-5 h-5 flex-shrink-0" />
                  <span className="font-medium flex-1">Log out</span>
                </button>
                <AffiliatePayoutDialog open={showPayoutDialog} onOpenChange={setShowPayoutDialog} affiliate={affiliate} connectPayoutMutation={connectPayoutMutation} w9UploadMutation={w9UploadMutation} />
                <ResponsiveDialog open={showSalesDialog} onOpenChange={setShowSalesDialog} title="Sales tracker" contentClassName="sm:max-w-sm">
                  <p className="text-sm text-muted-foreground">Enable to get a Sales tab with a kanban-style manager: create leads with unique redeem URLs.</p>
                  <div className="flex items-center justify-between gap-4 pt-2">
                    <span className="text-sm font-medium">Sales tracker enabled</span>
                    <Button
                      variant={salesTrackerEnabled ? "default" : "outline"}
                      size="sm"
                      onClick={() => { updateAffiliateMutation.mutate({ salesTrackerEnabled: !salesTrackerEnabled, type: !salesTrackerEnabled ? "sales" : "url" }); setShowSalesDialog(false); }}
                      disabled={updateAffiliateMutation.isPending}
                    >
                      {salesTrackerEnabled ? "On" : "Off"}
                    </Button>
                  </div>
                </ResponsiveDialog>
                <ResponsiveDialog open={showPaymentHistoryDialog} onOpenChange={setShowPaymentHistoryDialog} title="Payment history" contentClassName="sm:max-w-2xl">
                  <PaymentHistoryTable paymentHistory={paymentHistory} />
                </ResponsiveDialog>
              </>
            ) : (
              <>
                <aside className="w-72 flex-shrink-0 border-r border-border bg-muted/20 py-6 px-4">
                  <h2 className="text-xl font-bold mb-6">Account settings</h2>
                  <nav className="space-y-1">
                    <button type="button" onClick={() => setMenuSelection("payout")} className={`w-full flex items-center gap-3 py-3 px-3 rounded-lg transition-colors text-left ${menuSelection === "payout" ? "bg-muted font-medium" : "hover:bg-muted/50"}`} data-testid="menu-payout">
                      <CreditCard className="w-5 h-5 text-muted-foreground flex-shrink-0" />
                      <span>Payout method</span>
                    </button>
                    <button type="button" onClick={() => setMenuSelection("details")} className={`w-full flex items-center gap-3 py-3 px-3 rounded-lg transition-colors text-left ${menuSelection === "details" ? "bg-muted font-medium" : "hover:bg-muted/50"}`} data-testid="menu-account-details">
                      <User className="w-5 h-5 text-muted-foreground flex-shrink-0" />
                      <span>Account details</span>
                    </button>
                    <button type="button" onClick={() => setMenuSelection("status")} className={`w-full flex items-center gap-3 py-3 px-3 rounded-lg transition-colors text-left ${menuSelection === "status" ? "bg-muted font-medium" : "hover:bg-muted/50"}`} data-testid="menu-account-status">
                      <Shield className="w-5 h-5 text-muted-foreground flex-shrink-0" />
                      <span>Account status</span>
                    </button>
                    <button type="button" onClick={() => setMenuSelection("sales")} className={`w-full flex items-center gap-3 py-3 px-3 rounded-lg transition-colors text-left ${menuSelection === "sales" ? "bg-muted font-medium" : "hover:bg-muted/50"}`} data-testid="menu-sales-tracker">
                      <TrendingUp className="w-5 h-5 text-muted-foreground flex-shrink-0" />
                      <span>Sales tracker</span>
                    </button>
                    <button type="button" onClick={() => setMenuSelection("payments")} className={`w-full flex items-center gap-3 py-3 px-3 rounded-lg transition-colors text-left ${menuSelection === "payments" ? "bg-muted font-medium" : "hover:bg-muted/50"}`} data-testid="menu-payment-history">
                      <DollarSign className="w-5 h-5 text-muted-foreground flex-shrink-0" />
                      <span>Payment history</span>
                    </button>
                  </nav>
                  <div className="border-t border-border my-5" />
                  <div className="w-full flex items-center gap-3 py-3 px-3 rounded-lg bg-muted/30">
                    <DollarSign className="w-5 h-5 text-muted-foreground flex-shrink-0" />
                    <span className="font-medium flex-1">Account type</span>
                    <span className="text-sm font-medium text-foreground">{accountType}</span>
                  </div>
                  <button type="button" onClick={() => logout()} className="w-full flex items-center gap-3 py-3 px-3 rounded-lg hover:bg-destructive/10 transition-colors text-left text-destructive mt-5" data-testid="menu-logout">
                    <LogOut className="w-5 h-5 flex-shrink-0" />
                    <span className="font-medium flex-1">Log out</span>
                  </button>
                </aside>
                <div className="flex-1 min-w-0 overflow-y-auto py-8 px-8 bg-muted/30">
                  <div className="mb-8">
                    <h2 className="text-2xl font-bold tracking-tight">
                      {menuSelection === "payout" && "Payout method"}
                      {menuSelection === "details" && "Account details"}
                      {menuSelection === "status" && "Account status"}
                      {menuSelection === "sales" && "Sales tracker"}
                      {menuSelection === "payments" && "Payment history"}
                    </h2>
                  </div>
                  <div className="space-y-6">
                    {menuSelection === "payout" && (
                      <AffiliatePayoutContent affiliate={affiliate} connectPayoutMutation={connectPayoutMutation} w9UploadMutation={w9UploadMutation} />
                    )}
                    {menuSelection === "details" && (
                      <div className="pt-2 pb-4">
                        <div className="bg-background rounded-2xl shadow-sm border border-border overflow-hidden">
                          <div className="p-6 border-b border-border">
                            <h3 className="text-lg font-semibold">Personal information</h3>
                            <p className="text-sm text-muted-foreground mt-1">Details you entered when signing up as an affiliate. Tap Edit to change.</p>
                          </div>
                          <div className="divide-y divide-border">
                            <div className="p-4 hover:bg-muted/50 transition-colors">
                              {editingDetailsField === "firstName" ? (
                                <div className="space-y-3">
                                  <Label htmlFor="aff-firstName" className="text-sm font-medium">First name</Label>
                                  <Input
                                    id="aff-firstName"
                                    value={detailsFormData.firstName}
                                    onChange={(e) => setDetailsFormData({ ...detailsFormData, firstName: e.target.value })}
                                    autoFocus
                                  />
                                  <div className="flex gap-2">
                                    <Button size="sm" onClick={() => saveDetailsField("firstName")} disabled={updateAffiliateDetailsMutation.isPending}>
                                      {updateAffiliateDetailsMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Check className="w-4 h-4 mr-1" /> Save</>}
                                    </Button>
                                    <Button size="sm" variant="outline" onClick={() => setEditingDetailsField(null)}>Cancel</Button>
                                  </div>
                                </div>
                              ) : (
                                <div className="flex items-center justify-between">
                                  <div>
                                    <p className="text-sm font-medium text-muted-foreground">First name</p>
                                    <p className="text-base font-medium mt-0.5">{detailsFormData.firstName || "—"}</p>
                                  </div>
                                  <Button variant="ghost" size="sm" onClick={() => setEditingDetailsField("firstName")}>{detailsFormData.firstName ? "Edit" : "Add"}</Button>
                                </div>
                              )}
                            </div>
                            <div className="p-4 hover:bg-muted/50 transition-colors">
                              {editingDetailsField === "lastName" ? (
                                <div className="space-y-3">
                                  <Label htmlFor="aff-lastName" className="text-sm font-medium">Last name</Label>
                                  <Input
                                    id="aff-lastName"
                                    value={detailsFormData.lastName}
                                    onChange={(e) => setDetailsFormData({ ...detailsFormData, lastName: e.target.value })}
                                    autoFocus
                                  />
                                  <div className="flex gap-2">
                                    <Button size="sm" onClick={() => saveDetailsField("lastName")} disabled={updateAffiliateDetailsMutation.isPending}>
                                      {updateAffiliateDetailsMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Check className="w-4 h-4 mr-1" /> Save</>}
                                    </Button>
                                    <Button size="sm" variant="outline" onClick={() => setEditingDetailsField(null)}>Cancel</Button>
                                  </div>
                                </div>
                              ) : (
                                <div className="flex items-center justify-between">
                                  <div>
                                    <p className="text-sm font-medium text-muted-foreground">Last name</p>
                                    <p className="text-base font-medium mt-0.5">{detailsFormData.lastName || "—"}</p>
                                  </div>
                                  <Button variant="ghost" size="sm" onClick={() => setEditingDetailsField("lastName")}>{detailsFormData.lastName ? "Edit" : "Add"}</Button>
                                </div>
                              )}
                            </div>
                            <div className="p-4 hover:bg-muted/50 transition-colors">
                              {editingDetailsField === "email" ? (
                                <div className="space-y-3">
                                  <Label htmlFor="aff-email" className="text-sm font-medium">Email</Label>
                                  <Input
                                    id="aff-email"
                                    type="email"
                                    value={detailsFormData.email}
                                    onChange={(e) => setDetailsFormData({ ...detailsFormData, email: e.target.value })}
                                    autoFocus
                                  />
                                  <div className="flex gap-2">
                                    <Button size="sm" onClick={() => saveDetailsField("email")} disabled={updateAffiliateDetailsMutation.isPending}>
                                      {updateAffiliateDetailsMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Check className="w-4 h-4 mr-1" /> Save</>}
                                    </Button>
                                    <Button size="sm" variant="outline" onClick={() => setEditingDetailsField(null)}>Cancel</Button>
                                  </div>
                                </div>
                              ) : (
                                <div className="flex items-center justify-between">
                                  <div>
                                    <p className="text-sm font-medium text-muted-foreground">Email</p>
                                    <p className="text-base font-medium mt-0.5">
                                      {detailsFormData.email ? (
                                        <a href={`mailto:${detailsFormData.email}`} className="text-primary hover:underline">{detailsFormData.email}</a>
                                      ) : (
                                        "—"
                                      )}
                                    </p>
                                  </div>
                                  <Button variant="ghost" size="sm" onClick={() => setEditingDetailsField("email")}>{detailsFormData.email ? "Edit" : "Add"}</Button>
                                </div>
                              )}
                            </div>
                            <div className="p-4 hover:bg-muted/50 transition-colors">
                              {editingDetailsField === "phone" ? (
                                <div className="space-y-3">
                                  <Label htmlFor="aff-phone" className="text-sm font-medium">Phone</Label>
                                  <Input
                                    id="aff-phone"
                                    type="tel"
                                    value={detailsFormData.phone}
                                    onChange={(e) => setDetailsFormData({ ...detailsFormData, phone: e.target.value })}
                                    autoFocus
                                  />
                                  <div className="flex gap-2">
                                    <Button size="sm" onClick={() => saveDetailsField("phone")} disabled={updateAffiliateDetailsMutation.isPending}>
                                      {updateAffiliateDetailsMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Check className="w-4 h-4 mr-1" /> Save</>}
                                    </Button>
                                    <Button size="sm" variant="outline" onClick={() => setEditingDetailsField(null)}>Cancel</Button>
                                  </div>
                                </div>
                              ) : (
                                <div className="flex items-center justify-between">
                                  <div>
                                    <p className="text-sm font-medium text-muted-foreground">Phone</p>
                                    <p className="text-base font-medium mt-0.5">
                                      {detailsFormData.phone ? (
                                        <a href={`tel:${detailsFormData.phone.replace(/\D/g, "")}`} className="text-primary hover:underline">{detailsFormData.phone}</a>
                                      ) : (
                                        "—"
                                      )}
                                    </p>
                                  </div>
                                  <Button variant="ghost" size="sm" onClick={() => setEditingDetailsField("phone")}>{detailsFormData.phone ? "Edit" : "Add"}</Button>
                                </div>
                              )}
                            </div>
                            <div className="p-4 hover:bg-muted/50 transition-colors">
                              {editingDetailsField === "address" ? (
                                <div className="space-y-3">
                                  <Label htmlFor="aff-address" className="text-sm font-medium">Address</Label>
                                  <Input
                                    id="aff-address"
                                    value={detailsFormData.address}
                                    onChange={(e) => setDetailsFormData({ ...detailsFormData, address: e.target.value })}
                                    autoFocus
                                  />
                                  <div className="flex gap-2">
                                    <Button size="sm" onClick={() => saveDetailsField("address")} disabled={updateAffiliateDetailsMutation.isPending}>
                                      {updateAffiliateDetailsMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Check className="w-4 h-4 mr-1" /> Save</>}
                                    </Button>
                                    <Button size="sm" variant="outline" onClick={() => setEditingDetailsField(null)}>Cancel</Button>
                                  </div>
                                </div>
                              ) : (
                                <div className="flex items-center justify-between">
                                  <div>
                                    <p className="text-sm font-medium text-muted-foreground">Address</p>
                                    <p className="text-base font-medium mt-0.5">{detailsFormData.address || "—"}</p>
                                  </div>
                                  <Button variant="ghost" size="sm" onClick={() => setEditingDetailsField("address")}>{detailsFormData.address ? "Edit" : "Add"}</Button>
                                </div>
                              )}
                            </div>
                            <div className="p-4 hover:bg-muted/50 transition-colors">
                              {editingDetailsField === "experienceBlurb" ? (
                                <div className="space-y-3">
                                  <Label htmlFor="aff-experienceBlurb" className="text-sm font-medium">Experience / background</Label>
                                  <textarea
                                    id="aff-experienceBlurb"
                                    className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                                    value={detailsFormData.experienceBlurb}
                                    onChange={(e) => setDetailsFormData({ ...detailsFormData, experienceBlurb: e.target.value })}
                                    autoFocus
                                  />
                                  <div className="flex gap-2">
                                    <Button size="sm" onClick={() => saveDetailsField("experienceBlurb")} disabled={updateAffiliateDetailsMutation.isPending}>
                                      {updateAffiliateDetailsMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Check className="w-4 h-4 mr-1" /> Save</>}
                                    </Button>
                                    <Button size="sm" variant="outline" onClick={() => setEditingDetailsField(null)}>Cancel</Button>
                                  </div>
                                </div>
                              ) : (
                                <div className="flex items-center justify-between">
                                  <div>
                                    <p className="text-sm font-medium text-muted-foreground">Experience / background</p>
                                    <p className="text-base font-medium mt-0.5 whitespace-pre-wrap">{detailsFormData.experienceBlurb || "—"}</p>
                                  </div>
                                  <Button variant="ghost" size="sm" onClick={() => setEditingDetailsField("experienceBlurb")}>{detailsFormData.experienceBlurb ? "Edit" : "Add"}</Button>
                                </div>
                              )}
                            </div>
                            <div className="p-4">
                              <p className="text-sm font-medium text-muted-foreground">Account type</p>
                              <p className="text-base font-medium mt-0.5">{accountType}</p>
                            </div>
                            <div className="p-4">
                              <p className="text-sm font-medium text-muted-foreground">Referral code</p>
                              <p className="text-base font-medium mt-0.5 font-mono">{(affiliate as any)?.code || "—"}</p>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                    {menuSelection === "status" && (
                      <p className="text-muted-foreground">{(affiliate as any)?.onboardingComplete ? "Complete" : "Incomplete"}</p>
                    )}
                    {menuSelection === "sales" && (
                      <div className="space-y-4">
                        <p className="text-muted-foreground">Enable to get a Sales tab with a kanban-style manager: create leads with unique redeem URLs for worker or company onboarding.</p>
                        <div className="flex items-center justify-between gap-4 max-w-sm">
                          <span className="text-sm font-medium">Sales tracker enabled</span>
                          <Button
                            variant={salesTrackerEnabled ? "default" : "outline"}
                            size="sm"
                            onClick={() => updateAffiliateMutation.mutate({ salesTrackerEnabled: !salesTrackerEnabled, type: !salesTrackerEnabled ? "sales" : "url" })}
                            disabled={updateAffiliateMutation.isPending}
                          >
                            {salesTrackerEnabled ? "On" : "Off"}
                          </Button>
                        </div>
                      </div>
                    )}
                    {menuSelection === "payments" && (
                      <div className="space-y-4">
                        <p className="text-sm text-muted-foreground">All commissions from referred accounts (20% of platform fee per approved timesheet). Scheduled payments stay pending until your bank and W-9 are set up.</p>
                        <PaymentHistoryTable paymentHistory={paymentHistory} />
                      </div>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {/* Analytics tab - single container: accounts created from referral */}
        {activeTab === "analytics" && (
          <>
            <section>
              <h1 className="text-2xl font-bold text-foreground mb-1">Analytics</h1>
              <p className="text-muted-foreground">
                Performance and accounts created from your referral links.
              </p>
            </section>

            {referrals.length > 0 && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <Card className="border border-border bg-card">
                  <CardContent className="pt-4 pb-4">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Total accounts</p>
                    <p className="text-2xl font-bold text-foreground mt-0.5">{referrals.length}</p>
                  </CardContent>
                </Card>
                <Card className="border border-border bg-card">
                  <CardContent className="pt-4 pb-4">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Active</p>
                    <p className="text-2xl font-bold text-foreground mt-0.5">
                      {referrals.filter((r: any) => r.contractSigned || r.onboardingStatus === "complete").length}
                    </p>
                  </CardContent>
                </Card>
                <Card className="border border-border bg-card">
                  <CardContent className="pt-4 pb-4">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Total sales volume</p>
                    <p className="text-2xl font-bold text-foreground mt-0.5">
                      ${(referrals.reduce((sum: number, r: any) => sum + (typeof r.salesVolumeCents === "number" ? r.salesVolumeCents : 0), 0) / 100).toFixed(2)}
                    </p>
                  </CardContent>
                </Card>
                <Card className="border border-border bg-card">
                  <CardContent className="pt-4 pb-4">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Your payout</p>
                    <p className="text-2xl font-bold text-primary mt-0.5">
                      ${(referrals.reduce((sum: number, r: any) => sum + (typeof r.payoutCents === "number" ? r.payoutCents : 0), 0) / 100).toFixed(2)}
                    </p>
                  </CardContent>
                </Card>
              </div>
            )}

            <Card className="border border-border bg-card">
              <CardHeader>
                <CardTitle className="text-foreground">Accounts created from your referral</CardTitle>
                <p className="text-sm text-muted-foreground font-normal">
                  Everyone who signed up using your links. Active accounts generate sales volume and your 20% commission (payout) once timesheets are approved.
                </p>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Email</TableHead>
                      <TableHead>Role</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Sales volume</TableHead>
                      <TableHead>Payout</TableHead>
                      <TableHead>Joined</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {referrals.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                          No accounts created yet. Share your referral links (Home tab) to get started.
                        </TableCell>
                      </TableRow>
                    ) : (
                      referrals.map((r: any) => (
                        <TableRow key={r.id}>
                          <TableCell className="font-medium">
                            {r.role === "company" ? r.companyName : [r.firstName, r.lastName].filter(Boolean).join(" ") || "—"}
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {r.email ? (
                              <a href={`mailto:${r.email}`} className="text-primary hover:underline">
                                {r.email}
                              </a>
                            ) : (
                              "—"
                            )}
                          </TableCell>
                          <TableCell>
                            <span className={cn(
                              "text-xs font-medium px-2 py-1 rounded-full",
                              r.role === "company" ? "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300" : "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300"
                            )}>
                              {r.role === "company" ? "Company" : "Worker"}
                            </span>
                          </TableCell>
                          <TableCell>
                            {r.contractSigned || r.onboardingStatus === "complete" ? (
                              <span className="text-xs font-medium text-green-600 dark:text-green-400">Active</span>
                            ) : (
                              <span className="text-xs text-muted-foreground">Pending</span>
                            )}
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {typeof r.salesVolumeCents === "number" ? `$${((r.salesVolumeCents ?? 0) / 100).toFixed(2)}` : "—"}
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {typeof r.payoutCents === "number" ? `$${((r.payoutCents ?? 0) / 100).toFixed(2)}` : "—"}
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {r.createdAt ? format(new Date(r.createdAt), "MMM d, yyyy") : "—"}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </>
        )}
      </main>

      {/* Mobile footer nav (like worker/company dashboards) */}
      {isMobile && (
        <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-background border-t border-border z-50 h-14" aria-label="Affiliate dashboard navigation">
          <div className="flex items-center justify-around h-full">
            <button
              type="button"
              onClick={() => setActiveTab("home")}
              className={`flex flex-col items-center justify-center gap-0.5 px-2 min-w-0 flex-1 h-full transition-colors ${activeTab === "home" ? "text-primary" : "text-muted-foreground"}`}
              data-testid="mobile-nav-home"
            >
              <Home className="w-5 h-5 shrink-0" />
              <span className="text-[11px] font-medium truncate">Home</span>
            </button>
            {salesTrackerEnabled && (
              <button
                type="button"
                onClick={() => setActiveTab("sales")}
                className={`flex flex-col items-center justify-center gap-0.5 px-2 min-w-0 flex-1 h-full transition-colors ${activeTab === "sales" ? "text-primary" : "text-muted-foreground"}`}
                data-testid="mobile-nav-sales"
              >
                <DollarSign className="w-5 h-5 shrink-0" />
                <span className="text-[11px] font-medium truncate">Sales</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => setActiveTab("analytics")}
              className={`flex flex-col items-center justify-center gap-0.5 px-2 min-w-0 flex-1 h-full transition-colors ${activeTab === "analytics" ? "text-primary" : "text-muted-foreground"}`}
              data-testid="mobile-nav-analytics"
            >
              <BarChart3 className="w-5 h-5 shrink-0" />
              <span className="text-[11px] font-medium truncate">Analytics</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("menu")}
              className={`flex flex-col items-center justify-center gap-0.5 px-2 min-w-0 flex-1 h-full transition-colors ${activeTab === "menu" ? "text-primary" : "text-muted-foreground"}`}
              data-testid="mobile-nav-menu"
            >
              <Menu className="w-5 h-5 shrink-0" />
              <span className="text-[11px] font-medium truncate">Menu</span>
            </button>
          </div>
        </nav>
      )}
    </div>
  );
}

const KANBAN_COLUMN_IDS = ["lead", "contacted", "closed_won", "closed_lost"] as const;

function LeadCardCopyButton({ value, label, onCopy }: { value: string; label: string; onCopy: () => void }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        navigator.clipboard.writeText(value);
        onCopy();
      }}
      className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground truncate min-w-0"
      title={`Copy ${label}`}
    >
      <span className="truncate">{value}</span>
      <Copy className="w-3 h-3 shrink-0" />
    </button>
  );
}

function LeadsKanbanView({
  leads,
  code,
  origin,
  copiedLink,
  copyLink,
  onMoveStage,
  onCardClick,
  updateLeadStageMutation,
  movableStages,
  onCopyToast,
}: {
  leads: any[];
  code: string;
  origin: string;
  copiedLink: string | null;
  copyLink: (id: string, url: string) => void;
  onMoveStage: (id: number, stage: LeadStage) => void;
  onCardClick: (id: number) => void;
  updateLeadStageMutation: ReturnType<typeof useMutation>;
  movableStages: LeadStage[];
  onCopyToast: (message: string) => void;
}) {
  const columns = useMemo(() => {
    const cols: Record<string, any[]> = { lead: [], contacted: [], closed_won: [], closed_lost: [] };
    leads.forEach((l) => {
      if (l.stage && cols[l.stage]) cols[l.stage].push(l);
    });
    return cols;
  }, [leads]);

  const handleMove = (event: { activeContainer: string; overContainer: string; activeIndex: number }) => {
    if (event.overContainer === "closed_won" || event.activeContainer === "closed_won") return;
    const lead = columns[event.activeContainer]?.[event.activeIndex];
    if (!lead) return;
    updateLeadStageMutation.mutate({ id: lead.id, stage: event.overContainer as LeadStage });
  };

  return (
    <Kanban
      value={columns}
      onValueChange={() => {}}
      getItemValue={(item) => String(item.id)}
      onMove={(e) => handleMove({ activeContainer: e.activeContainer, overContainer: e.overContainer, activeIndex: e.activeIndex })}
      className="overflow-x-auto pb-2"
    >
      <KanbanBoard className="gap-8">
        {KANBAN_COLUMN_IDS.map((stage) => (
          <KanbanColumn key={stage} value={stage} disabled={stage === "closed_won"}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-foreground capitalize">
                {stage === "closed_won" ? "Closed Won" : stage === "closed_lost" ? "Closed Lost" : stage}
              </h3>
              <Badge variant="secondary" className="text-xs">{columns[stage].length}</Badge>
            </div>
            <KanbanColumnContent value={stage}>
              {columns[stage].map((lead: any) => (
                <KanbanItem key={lead.id} value={String(lead.id)} disabled={lead.stage === "closed_won"}>
                  <KanbanItemHandle asChild>
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => onCardClick(lead.id)}
                      onKeyDown={(e) => e.key === "Enter" && onCardClick(lead.id)}
                      className="rounded-md border border-border bg-card p-3 shadow-sm cursor-grab active:cursor-grabbing text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <div className="flex flex-col gap-2.5">
                        <div className="flex items-center justify-between gap-2">
                          <span className="line-clamp-1 font-medium text-sm">{lead.name || "—"}</span>
                          <Badge
                            variant="outline"
                            className={cn(
                              "pointer-events-none shrink-0 text-[11px] capitalize",
                              lead.accountType === "company" ? "border-blue-200 text-blue-700 dark:border-blue-800 dark:text-blue-300" : "border-green-200 text-green-700 dark:border-green-800 dark:text-green-300"
                            )}
                          >
                            {lead.accountType === "company" ? "Company" : "Worker"}
                          </Badge>
                        </div>
                        {(lead.email || lead.phone) && (
                          <div className="flex flex-col gap-1">
                            {lead.email && (
                              <LeadCardCopyButton
                                value={lead.email}
                                label="email"
                                onCopy={() => onCopyToast("Email copied")}
                              />
                            )}
                            {lead.phone && (
                              <LeadCardCopyButton
                                value={lead.phone}
                                label="phone"
                                onCopy={() => onCopyToast("Phone copied")}
                              />
                            )}
                          </div>
                        )}
                        <div className="text-muted-foreground text-xs">
                          {lead.createdAt ? format(new Date(lead.createdAt), "MMM d, yyyy") : "—"}
                        </div>
                      </div>
                    </div>
                  </KanbanItemHandle>
                </KanbanItem>
              ))}
            </KanbanColumnContent>
          </KanbanColumn>
        ))}
      </KanbanBoard>
      <KanbanOverlay>
        {({ value }) => {
          const lead = leads.find((l: any) => String(l.id) === value);
          if (!lead) return <div className="rounded-md bg-muted/60 size-full min-h-[80px]" />;
          return (
            <div className="rounded-md border border-border bg-card p-3 shadow-sm">
              <div className="flex flex-col gap-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="line-clamp-1 font-medium text-sm">{lead.name || "—"}</span>
                  <Badge variant="outline" className={cn("shrink-0 text-[11px] capitalize", lead.accountType === "company" ? "border-blue-200 text-blue-700" : "border-green-200 text-green-700")}>
                    {lead.accountType === "company" ? "Company" : "Worker"}
                  </Badge>
                </div>
                {(lead.email || lead.phone) && (
                  <div className="flex flex-col gap-1">
                    {lead.email && (
                      <span className="text-xs text-muted-foreground truncate">{lead.email}</span>
                    )}
                    {lead.phone && (
                      <span className="text-xs text-muted-foreground truncate">{lead.phone}</span>
                    )}
                  </div>
                )}
                <div className="text-muted-foreground text-xs">
                  {lead.createdAt ? format(new Date(lead.createdAt), "MMM d, yyyy") : "—"}
                </div>
              </div>
            </div>
          );
        }}
      </KanbanOverlay>
    </Kanban>
  );
}

function LeadDetailDialog({
  leadId,
  lead,
  code,
  origin,
  onClose,
  onMoveStage,
  onUpdateAccountType,
  addActivityMutation,
  movableStages,
  updateLeadMutation,
}: {
  leadId: number | null;
  lead: any;
  code: string;
  origin: string;
  onClose: () => void;
  onMoveStage: (stage: LeadStage) => void;
  onUpdateAccountType: (accountType: "worker" | "company") => void;
  addActivityMutation: ReturnType<typeof useMutation>;
  movableStages: LeadStage[];
  updateLeadMutation: ReturnType<typeof useMutation>;
}) {
  const { toast } = useToast();
  const [activityBody, setActivityBody] = useState("");
  const { data: activities = [], isLoading: activitiesLoading } = useQuery({
    queryKey: ["/api/affiliates/me/leads", leadId, "activities"],
    queryFn: async () => {
      if (leadId == null) return [];
      const res = await apiRequest("GET", `/api/affiliates/me/leads/${leadId}/activities`);
      return res.json();
    },
    enabled: leadId != null,
  });
  const open = leadId != null && lead != null;
  const redeemUrl = lead
    ? `${origin}${lead.accountType === "company" ? "/company-onboarding" : "/worker-onboarding"}?ref=${encodeURIComponent(code)}&lead=${encodeURIComponent(lead.token)}`
    : "";
  const handleAddActivity = (e: React.FormEvent) => {
    e.preventDefault();
    if (!leadId || !activityBody.trim()) return;
    addActivityMutation.mutate({ leadId, body: activityBody.trim() }, { onSuccess: () => setActivityBody("") });
  };
  return (
    <ResponsiveDialog open={open} onOpenChange={(o) => !o && onClose()} title="Lead details" contentClassName="sm:max-w-lg max-h-[90vh]">
      {lead && (
        <div className="space-y-4">
            <div className="grid gap-2 text-sm">
              <p><span className="font-medium text-muted-foreground">Name</span> {lead.name ?? "—"}</p>
              <p><span className="font-medium text-muted-foreground">Email</span> {lead.email ?? "—"}</p>
              <p><span className="font-medium text-muted-foreground">Phone</span> {lead.phone ?? "—"}</p>
              <p><span className="font-medium text-muted-foreground">Business</span> {lead.businessName ?? "—"}</p>
              {(lead.email || lead.phone) && (
                <div className="flex gap-2 pt-2">
                  {lead.email && (
                    <Button variant="outline" size="sm" asChild>
                      <a href={`mailto:${lead.email}`}>
                        <Mail className="w-4 h-4 mr-1.5" />
                        Email
                      </a>
                    </Button>
                  )}
                  {lead.phone && (
                    <Button variant="outline" size="sm" asChild>
                      <a href={`tel:${lead.phone.replace(/\D/g, "")}`}>
                        <Phone className="w-4 h-4 mr-1.5" />
                        Call
                      </a>
                    </Button>
                  )}
                </div>
              )}
              <div className="space-y-1.5">
                <span className="font-medium text-muted-foreground text-sm">Account type</span>
                <div className="relative flex w-full rounded-full border border-border bg-muted/50 p-1">
                  <div
                    className="absolute top-1 bottom-1 w-[calc(50%-6px)] rounded-full bg-background shadow-sm border border-border transition-all duration-200 ease-out"
                    style={{
                      left: lead.accountType === "company" ? "calc(50% + 2px)" : "4px",
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => lead.accountType !== "worker" && onUpdateAccountType("worker")}
                    disabled={updateLeadMutation.isPending}
                    className={cn(
                      "relative z-10 flex-1 py-2 text-sm font-medium rounded-full transition-colors",
                      lead.accountType === "worker" ? "text-foreground" : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    Worker
                  </button>
                  <button
                    type="button"
                    onClick={() => lead.accountType !== "company" && onUpdateAccountType("company")}
                    disabled={updateLeadMutation.isPending}
                    className={cn(
                      "relative z-10 flex-1 py-2 text-sm font-medium rounded-full transition-colors",
                      lead.accountType === "company" ? "text-foreground" : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    Company
                  </button>
                </div>
                <p className="text-xs text-muted-foreground">Redeem URL updates to match (worker vs company onboarding).</p>
              </div>
              <p>
                <span className="font-medium text-muted-foreground">Stage</span>{" "}
                {lead.stage === "closed_won" ? (
                  "Closed Won (set when they create an account)"
                ) : (
                  <Select
                    value={lead.stage}
                    onValueChange={(v) => onMoveStage(v as LeadStage)}
                  >
                    <SelectTrigger className="h-8 w-[140px] inline-flex">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {movableStages.map((s) => (
                        <SelectItem key={s} value={s}>
                          {s === "closed_lost" ? "Closed Lost" : s}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </p>
              <div className="space-y-1.5">
                <span className="font-medium text-muted-foreground text-sm">Redeem URL</span>
                <p className="text-xs text-muted-foreground">Share this link so the lead can sign up with their info pre-filled.</p>
                <div className="flex gap-2">
                  <Input readOnly value={redeemUrl} className="font-mono text-xs flex-1 min-w-0" />
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="shrink-0 h-9 w-9"
                    onClick={() => {
                      navigator.clipboard.writeText(redeemUrl);
                      toast({ title: "Link copied to clipboard" });
                    }}
                  >
                    <Copy className="w-4 h-4" />
                  </Button>
                </div>
                <a href={redeemUrl} target="_blank" rel="noreferrer" className="text-xs text-primary underline hover:no-underline">Open link in new tab</a>
              </div>
            </div>
            <div className="border-t border-border pt-4">
              <h4 className="font-semibold text-foreground mb-2">Activity</h4>
              <form onSubmit={handleAddActivity} className="flex gap-2 mb-3">
                <Input
                  value={activityBody}
                  onChange={(e) => setActivityBody(e.target.value)}
                  placeholder="Add a note or activity..."
                  className="flex-1"
                />
                <Button type="submit" disabled={!activityBody.trim() || addActivityMutation.isPending}>
                  {addActivityMutation.isPending ? "Adding..." : "Add"}
                </Button>
              </form>
              {activitiesLoading ? (
                <p className="text-sm text-muted-foreground">Loading...</p>
              ) : activities.length === 0 ? (
                <p className="text-sm text-muted-foreground">No activity yet.</p>
              ) : (
                <ul className="space-y-2 max-h-[200px] overflow-y-auto">
                  {activities.map((a: { body: string; createdAt?: string }, i: number) => (
                    <li key={a.createdAt ?? i} className="text-sm rounded-md bg-muted/50 p-2">
                      <p className="text-foreground">{a.body}</p>
                      <p className="text-xs text-muted-foreground mt-1">{a.createdAt ? format(new Date(a.createdAt), "MMM d, yyyy h:mm a") : ""}</p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
    </ResponsiveDialog>
  );
}

function parseCsvToLeads(csv: string): { name?: string; email: string; phone?: string; businessName?: string; accountType?: "worker" | "company" }[] {
  const lines = csv.trim().split(/\r?\n/).filter((l) => l.trim());
  if (lines.length === 0) return [];
  const parseRow = (line: string): string[] =>
    line.split(/[\t,]/).map((c) => c.trim().replace(/^"|"$/g, ""));
  const first = parseRow(lines[0]);
  const hasHeader =
    /^(name|email|phone|businessname|fullname|company|accounttype|type)$/i.test((first[0] ?? "").replace(/\s+/g, "")) ||
    (/^(name|email|phone)/i.test((first[0] ?? "").trim()) && first.length >= 2);
  const headerMap: Record<string, number> = {};
  if (hasHeader && first.length) {
    first.forEach((h, idx) => {
      const key = h.toLowerCase().replace(/\s+/g, "");
      if (key === "name" || key === "fullname") headerMap.name = idx;
      else if (key === "email") headerMap.email = idx;
      else if (key === "phone") headerMap.phone = idx;
      else if (key === "businessname" || key === "company") headerMap.businessName = idx;
      else if (key === "accounttype" || key === "type") headerMap.accountType = idx;
    });
  }
  const start = hasHeader ? 1 : 0;
  const results: { name?: string; email: string; phone?: string; businessName?: string; accountType?: "worker" | "company" }[] = [];
  for (let i = start; i < lines.length; i++) {
    const cells = parseRow(lines[i]);
    const get = (k: keyof typeof headerMap) => (headerMap[k] != null ? cells[headerMap[k]] : undefined);
    const emailVal = hasHeader ? (get("email") ?? cells[1] ?? cells[0]) : (cells[1] ?? cells[0]);
    const emailStr = (emailVal ?? "").trim();
    if (!emailStr) continue;
    const nameVal = hasHeader ? (get("name") ?? cells[0]) : cells[0];
    const phoneVal = hasHeader ? get("phone") : cells[2];
    const businessVal = hasHeader ? get("businessName") : cells[3];
    const accountTypeRaw = (hasHeader ? get("accountType") : cells[4]) ?? "";
    const accountType: "worker" | "company" = /company/i.test(accountTypeRaw) ? "company" : "worker";
    results.push({
      name: (nameVal ?? "").trim() || undefined,
      email: emailStr,
      phone: (phoneVal ?? "").trim() || undefined,
      businessName: (businessVal ?? "").trim() || undefined,
      accountType,
    });
  }
  return results;
}

function CreateLeadDialog({
  open,
  onOpenChange,
  onSubmit,
  onImport,
  isPending,
  isImportPending,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (body: { name: string; email: string; phone: string; businessName: string; accountType: "worker" | "company" }) => void;
  onImport: (leads: { name?: string; email: string; phone?: string; businessName?: string; accountType?: "worker" | "company" }[]) => void;
  isPending: boolean;
  isImportPending: boolean;
}) {
  const [mode, setMode] = useState<"create" | "import">("create");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [accountType, setAccountType] = useState<"worker" | "company">("worker");
  const [importCsv, setImportCsv] = useState("");
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({ name, email, phone, businessName, accountType });
    setName("");
    setEmail("");
    setPhone("");
    setBusinessName("");
    setAccountType("worker");
  };
  const handleImport = () => {
    const leads = parseCsvToLeads(importCsv);
    if (leads.length === 0) return;
    onImport(leads);
    setImportCsv("");
  };
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setImportCsv(String(reader.result ?? ""));
    reader.readAsText(file);
    e.target.value = "";
  };
  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange} title="Create lead" contentClassName="sm:max-w-md">
      <div className="flex rounded-lg border border-border bg-muted/30 p-0.5 mb-4">
          <button type="button" onClick={() => setMode("create")} className={cn("flex-1 px-3 py-1.5 text-sm font-medium rounded-md transition-colors", mode === "create" ? "bg-background text-foreground shadow" : "text-muted-foreground hover:text-foreground")}>Create</button>
          <button type="button" onClick={() => setMode("import")} className={cn("flex-1 px-3 py-1.5 text-sm font-medium rounded-md transition-colors", mode === "import" ? "bg-background text-foreground shadow" : "text-muted-foreground hover:text-foreground")}>Import</button>
        </div>
        {mode === "create" ? (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="lead-name">Name</Label>
              <Input id="lead-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="lead-email">Email</Label>
              <Input id="lead-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="email@example.com" required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="lead-phone">Phone</Label>
              <Input id="lead-phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="lead-business">Business name</Label>
              <Input id="lead-business" value={businessName} onChange={(e) => setBusinessName(e.target.value)} placeholder="Company or business name" />
            </div>
            <div className="space-y-2">
              <Label>Account type</Label>
              <div className="flex items-center gap-4">
                <span className="text-sm text-muted-foreground">Worker</span>
                <Switch checked={accountType === "company"} onCheckedChange={(checked) => setAccountType(checked ? "company" : "worker")} />
                <span className="text-sm text-muted-foreground">Company</span>
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button type="submit" disabled={isPending}>{isPending ? "Creating..." : "Create lead"}</Button>
            </DialogFooter>
          </form>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>CSV paste or upload (columns: name, email, phone, businessName; header row optional)</Label>
              <textarea
                value={importCsv}
                onChange={(e) => setImportCsv(e.target.value)}
                placeholder={"name,email,phone,businessName\nJane,jane@example.com,555-1234,Acme"}
                className="flex min-h-[120px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                rows={5}
              />
              <div className="flex items-center gap-2">
                <Button type="button" variant="outline" size="sm" className="gap-1" asChild>
                  <label>
                    <Upload className="w-4 h-4" />
                    Upload CSV
                    <input type="file" accept=".csv,.txt" className="sr-only" onChange={handleFileChange} />
                  </label>
                </Button>
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button type="button" onClick={handleImport} disabled={!importCsv.trim() || isImportPending}>
                {isImportPending ? "Importing..." : "Import leads"}
              </Button>
            </DialogFooter>
          </div>
        )}
    </ResponsiveDialog>
  );
}

function PaymentHistoryTable({ paymentHistory }: { paymentHistory: any[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Date</TableHead>
          <TableHead>Amount</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Reference</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {paymentHistory.length === 0 ? (
          <TableRow>
            <TableCell colSpan={4} className="text-center text-muted-foreground py-8">
              No payments yet. Commissions appear here when referred companies or workers have timesheets approved.
            </TableCell>
          </TableRow>
        ) : (
          paymentHistory.map((p: any) => (
            <TableRow key={p.id}>
              <TableCell className="text-muted-foreground">
                {p.createdAt ? format(new Date(p.createdAt), "MMM d, yyyy") : "—"}
              </TableCell>
              <TableCell className="font-medium">${((p.amountCents ?? 0) / 100).toFixed(2)}</TableCell>
              <TableCell>
                <span className={cn(
                  "text-xs font-medium px-2 py-1 rounded-full",
                  p.status === "paid" ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300" : "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300"
                )}>
                  {p.status === "paid" ? "Paid" : "Pending"}
                </span>
              </TableCell>
              <TableCell className="text-muted-foreground">
                {p.jobTitle ? `Timesheet #${p.timesheetId} · ${p.jobTitle}` : `Timesheet #${p.timesheetId}`}
              </TableCell>
            </TableRow>
          ))
        )}
      </TableBody>
    </Table>
  );
}

function AffiliatePayoutContent({
  affiliate,
  connectPayoutMutation,
  w9UploadMutation,
}: {
  affiliate: any;
  connectPayoutMutation: ReturnType<typeof useMutation>;
  w9UploadMutation: ReturnType<typeof useMutation>;
}) {
  const [routingNumber, setRoutingNumber] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [confirmAccountNumber, setConfirmAccountNumber] = useState("");
  const [accountType, setAccountType] = useState<"checking" | "savings">("checking");
  const [bankName, setBankName] = useState("");
  const [address, setAddress] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [zipCode, setZipCode] = useState("");
  const [email, setEmail] = useState((affiliate as any)?.email ?? "");
  const [isEditingPayout, setIsEditingPayout] = useState(false);

  const hasPayout = !!(affiliate as any)?.mercuryRecipientId;
  const hasW9 = !!(affiliate as any)?.w9UploadedAt;
  const showPayoutForm = !hasPayout || isEditingPayout;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const routing = routingNumber.replace(/\D/g, "");
    const account = accountNumber.replace(/\D/g, "");
    if (routing.length !== 9 || account.length < 4 || account.length > 17) return;
    if (account !== confirmAccountNumber.replace(/\D/g, "")) return;
    connectPayoutMutation.mutate({
      routingNumber: routing,
      accountNumber: account,
      accountType,
      bankName,
      address,
      city,
      state,
      zipCode,
      email: email.trim() || undefined,
    });
  };

  const handleW9File = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const base64 = ev.target?.result as string;
      if (base64) w9UploadMutation.mutate({ w9DocumentUrl: base64 });
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  return (
    <div className="space-y-6 w-full min-w-0 max-w-full md:max-w-md">
      <p className="text-muted-foreground text-sm">Commission payouts will be sent to your linked bank account (Mercury). You earn 20% of the platform fee when referred workers or companies have timesheets approved.</p>

      {hasPayout && !showPayoutForm && (
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-3 min-w-0">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted">
                <Landmark className="h-5 w-5 text-muted-foreground" />
              </div>
              <div className="min-w-0">
                <p className="font-medium text-foreground">Bank account connected</p>
                <p className="text-sm text-muted-foreground">Payout account linked for affiliate commissions</p>
              </div>
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="shrink-0 h-8 w-8" aria-label="Payout options">
                  <MoreVertical className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => setIsEditingPayout(true)}>
                  <Edit className="h-4 w-4 mr-2" /> Edit bank details
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      )}

      {showPayoutForm && (
        <form onSubmit={handleSubmit} className="space-y-4">
          {hasPayout && <p className="text-sm font-medium text-foreground">Edit your payout details below.</p>}
          {!hasPayout && <p className="text-muted-foreground text-sm">This is where you'll receive your affiliate payments.</p>}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="aff-payout-routing">Routing number</Label>
              <Input id="aff-payout-routing" value={routingNumber} onChange={(e) => setRoutingNumber(e.target.value.replace(/\D/g, "").slice(0, 9))} placeholder="9 digits" maxLength={9} />
              {typeof window !== "undefined" && (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") && (
                <p className="text-xs text-muted-foreground">Dev: use <strong>123456789</strong> to test without Mercury. Real sandbox: <strong>021000021</strong> (Chase).</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="aff-payout-account">Account number</Label>
              <Input id="aff-payout-account" type="password" value={accountNumber} onChange={(e) => setAccountNumber(e.target.value.replace(/\D/g, "").slice(0, 17))} placeholder="4–17 digits" />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="aff-payout-confirm">Confirm account number</Label>
            <Input id="aff-payout-confirm" type="password" value={confirmAccountNumber} onChange={(e) => setConfirmAccountNumber(e.target.value)} placeholder="Re-enter account number" />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="aff-payout-type">Account type</Label>
              <Select value={accountType} onValueChange={(v) => setAccountType(v as "checking" | "savings")}>
                <SelectTrigger id="aff-payout-type"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="checking">Checking</SelectItem>
                  <SelectItem value="savings">Savings</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="aff-payout-bank">Bank name</Label>
              <Input id="aff-payout-bank" value={bankName} onChange={(e) => setBankName(e.target.value)} placeholder="e.g. Chase" />
            </div>
          </div>
          <div className="space-y-2">
            <GooglePlacesAutocomplete
              id="aff-payout-address"
              label="Address"
              value={address}
              onChange={(addr, components) => {
                setAddress(addr || "");
                if (components.city != null) setCity(components.city || "");
                if (components.state != null) setState(components.state || "");
                if (components.zipCode != null) setZipCode(components.zipCode || "");
              }}
              placeholder="Start typing your address..."
              required
            />
            <p className="text-xs text-muted-foreground">Select your full address from the suggestions so we can verify your location.</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="aff-payout-email">Email (for payout notifications)</Label>
            <Input id="aff-payout-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="email@example.com" />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={connectPayoutMutation.isPending}>
              {connectPayoutMutation.isPending ? (hasPayout ? "Saving…" : "Connecting…") : hasPayout ? "Save changes" : "Connect payout account"}
            </Button>
            {hasPayout && (
              <Button type="button" variant="outline" onClick={() => setIsEditingPayout(false)} disabled={connectPayoutMutation.isPending}>
                Cancel
              </Button>
            )}
          </div>
        </form>
      )}

      <div className="border-t border-border pt-6 space-y-4">
        <h3 className="font-medium text-foreground">W-9 for tax purposes</h3>
        <p className="text-sm text-muted-foreground">Upload your W-9 to update your record on file. We use it for tax documentation and IRS reporting for affiliate commissions. Bank details must be entered first before you can upload a W-9.</p>
        {!hasPayout && (
          <p className="text-xs text-amber-600 dark:text-amber-400">Connect your payout bank account above before uploading a W-9.</p>
        )}
        {hasW9 && (
          <p className="text-sm font-medium text-foreground flex items-center gap-2">
            <FileText className="w-4 h-4 text-green-600" />
            W-9 on file
          </p>
        )}
        <div className="flex items-center gap-2">
          <input
            id="aff-w9-upload"
            type="file"
            accept=".pdf,image/*"
            className="hidden"
            onChange={handleW9File}
            disabled={w9UploadMutation.isPending || !hasPayout}
          />
          <Button
            type="button"
            variant="outline"
            disabled={w9UploadMutation.isPending || !hasPayout}
            onClick={() => document.getElementById("aff-w9-upload")?.click()}
          >
            {w9UploadMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Upload className="w-4 h-4 mr-2" />}
            {w9UploadMutation.isPending ? "Uploading…" : hasW9 ? "Replace W-9" : "Upload W-9"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function AffiliatePayoutDialog({
  open,
  onOpenChange,
  affiliate,
  connectPayoutMutation,
  w9UploadMutation,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  affiliate: any;
  connectPayoutMutation: ReturnType<typeof useMutation>;
  w9UploadMutation: ReturnType<typeof useMutation>;
}) {
  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange} title="Payout method" contentClassName="sm:max-w-lg">
      <AffiliatePayoutContent affiliate={affiliate} connectPayoutMutation={connectPayoutMutation} w9UploadMutation={w9UploadMutation} />
    </ResponsiveDialog>
  );
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}
