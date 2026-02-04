import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Profile, Job, AdminStrike, BillingAction, AdminActivityLog, WorkerStatus, CompanyStatus } from "@shared/schema";

export interface WorkerWithAdmin extends Profile {
  adminStatus?: WorkerStatus;
  strikes: AdminStrike[];
}

export interface CompanyWithAdmin extends Profile {
  adminStatus?: CompanyStatus;
}

export interface JobWithCompany extends Job {
  companyName: string | null;
}

export function useAdminCheck() {
  return useQuery<{ isAdmin: boolean; email?: string }>({
    queryKey: ["/api/admin/check"],
    staleTime: 1000 * 60 * 5,
  });
}

export function useAdminWorkers() {
  return useQuery<WorkerWithAdmin[]>({
    queryKey: ["/api/admin/workers"],
  });
}

export function useAdminCompanies() {
  return useQuery<CompanyWithAdmin[]>({
    queryKey: ["/api/admin/companies"],
  });
}

export function useAdminJobs() {
  return useQuery<JobWithCompany[]>({
    queryKey: ["/api/admin/jobs"],
  });
}

export function useAdminStrikes() {
  return useQuery<(AdminStrike & { worker: Profile })[]>({
    queryKey: ["/api/admin/strikes"],
  });
}

export function useAdminBilling() {
  return useQuery<BillingAction[]>({
    queryKey: ["/api/admin/billing"],
  });
}

export function useAdminActivityLog(limit: number = 100) {
  return useQuery<AdminActivityLog[]>({
    queryKey: ["/api/admin/activity", limit],
    queryFn: async () => {
      const res = await fetch(`/api/admin/activity?limit=${limit}`, { credentials: "include" });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
  });
}

export function useIssueStrike() {
  return useMutation({
    mutationFn: async ({ workerId, reason, severity, notes }: { 
      workerId: number; 
      reason: string; 
      severity?: string; 
      notes?: string;
    }) => {
      const res = await apiRequest("POST", `/api/admin/workers/${workerId}/strike`, { reason, severity, notes });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/workers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/strikes"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/activity"] });
    },
  });
}

export function useResolveStrike() {
  return useMutation({
    mutationFn: async ({ strikeId, notes }: { strikeId: number; notes?: string }) => {
      const res = await apiRequest("PATCH", `/api/admin/strikes/${strikeId}/resolve`, { notes });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/workers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/strikes"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/activity"] });
    },
  });
}

export function useUpdateWorkerStatus() {
  return useMutation({
    mutationFn: async ({ workerId, status, reason, suspendedUntil }: { 
      workerId: number; 
      status: string; 
      reason?: string;
      suspendedUntil?: string;
    }) => {
      const res = await apiRequest("PATCH", `/api/admin/workers/${workerId}/status`, { status, reason, suspendedUntil });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/workers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/activity"] });
    },
  });
}

export function useUpdateCompanyStatus() {
  return useMutation({
    mutationFn: async ({ companyId, status, reason, suspendedUntil }: { 
      companyId: number; 
      status: string; 
      reason?: string;
      suspendedUntil?: string;
    }) => {
      const res = await apiRequest("PATCH", `/api/admin/companies/${companyId}/status`, { status, reason, suspendedUntil });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/companies"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/activity"] });
    },
  });
}

export function useUpdateCompanySettings() {
  return useMutation({
    mutationFn: async ({ companyId, autoReplenishThreshold }: { 
      companyId: number; 
      autoReplenishThreshold: number;
    }) => {
      const res = await apiRequest("PATCH", `/api/admin/companies/${companyId}/settings`, { autoReplenishThreshold });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/companies"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/activity"] });
    },
  });
}

export function useUpdateJobStatus() {
  return useMutation({
    mutationFn: async ({ jobId, status, reason }: { 
      jobId: number; 
      status: string; 
      reason?: string;
    }) => {
      const res = await apiRequest("PATCH", `/api/admin/jobs/${jobId}/status`, { status, reason });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/jobs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/activity"] });
    },
  });
}

export function useCreateBillingAction() {
  return useMutation({
    mutationFn: async (data: { 
      entityType: string;
      entityId: number;
      actionType: string;
      amountCents: number;
      reason: string;
      notes?: string;
    }) => {
      const res = await apiRequest("POST", "/api/admin/billing/adjustment", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/billing"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/companies"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/activity"] });
    },
  });
}

export interface PlatformConfigAdmin {
  platformFeePerHourCents: number;
  affiliateCommissionPercent: number;
  updatedAt?: string;
}

export function useAdminPlatformConfig() {
  return useQuery<PlatformConfigAdmin>({
    queryKey: ["/api/admin/platform-config"],
  });
}

export function useUpdatePlatformConfig() {
  return useMutation({
    mutationFn: async (data: { platformFeePerHourCents?: number; affiliateCommissionPercent?: number }) => {
      const res = await apiRequest("PATCH", "/api/admin/platform-config", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/platform-config"] });
    },
  });
}

// --- Super Admin: Export, Create Account, Refund, Chats, Push ---

export function useAdminExport() {
  return useMutation({
    mutationFn: async ({ entity, format }: { entity: "workers" | "companies" | "jobs" | "strikes" | "activity" | "billing"; format?: "csv" }) => {
      const res = await fetch(`/api/admin/export?entity=${entity}&format=${format || "csv"}`, { credentials: "include" });
      if (!res.ok) throw new Error(await res.text());
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${entity}-${Date.now()}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    },
  });
}

export function useAdminCreateAccount() {
  return useMutation({
    mutationFn: async (data: { email: string; password: string; firstName?: string; lastName?: string; userType: "worker" | "company"; companyName?: string }) => {
      const res = await apiRequest("POST", "/api/admin/accounts", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/workers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/companies"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/activity"] });
    },
  });
}

/** Admin list of recent company transactions that have a Stripe Payment Intent (for refunds tab). */
export interface AdminStripePaymentRow {
  id: number;
  profileId: number;
  type: string;
  amount: number;
  description: string | null;
  jobId: number | null;
  stripePaymentIntentId: string | null;
  createdAt: string;
  companyName: string | null;
}

export function useAdminStripePayments() {
  return useQuery<AdminStripePaymentRow[]>({
    queryKey: ["/api/admin/stripe-payments"],
  });
}

export function useAdminRefund() {
  return useMutation({
    mutationFn: async (data: { paymentIntentId: string; amountCents?: number; reason?: string }) => {
      const res = await apiRequest("POST", "/api/admin/refund", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/activity"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/stripe-payments"] });
    },
  });
}

export function useAdminChats() {
  return useQuery<JobWithCompany[]>({
    queryKey: ["/api/admin/chats"],
  });
}

export function useAdminChatMessages(jobId: number | null) {
  return useQuery({
    queryKey: ["/api/admin/chats", jobId, "messages"],
    enabled: !!jobId,
  });
}

export function useAdminSendSupportMessage() {
  return useMutation({
    mutationFn: async ({ jobId, content }: { jobId: number; content: string }) => {
      const res = await apiRequest("POST", `/api/admin/chats/${jobId}/messages`, { content });
      return res.json();
    },
    onSuccess: (_, { jobId }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/chats", jobId, "messages"] });
    },
  });
}

export function useAdminMassPush() {
  return useMutation({
    mutationFn: async (data: { target: "workers" | "companies" | "all"; title: string; body: string; url?: string }) => {
      const res = await apiRequest("POST", "/api/admin/push", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/activity"] });
    },
  });
}

export function useAdminInviteInfo() {
  return useQuery<{ message: string; currentEmails: string[] }>({
    queryKey: ["/api/admin/invite-info"],
  });
}

export function useAdminImpersonate() {
  return useMutation({
    mutationFn: async (profileId: number) => {
      const res = await apiRequest("POST", `/api/admin/impersonate/${profileId}`);
      return res.json() as Promise<{ success: boolean; role: string; profileId: number }>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
    },
  });
}

export function useAdminStopImpersonate() {
  return useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/admin/stop-impersonate");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
    },
  });
}

export interface ImportRow {
  email: string;
  firstName?: string;
  lastName?: string;
  password?: string;
  companyName?: string;
}

export function useAdminImport() {
  return useMutation({
    mutationFn: async (data: { entity: "workers" | "companies"; rows: ImportRow[] }) => {
      const res = await apiRequest("POST", "/api/admin/import", data);
      return res.json() as Promise<{ created: number; failed: number; errors: { index: number; message: string }[] }>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/workers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/companies"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/activity"] });
    },
  });
}
