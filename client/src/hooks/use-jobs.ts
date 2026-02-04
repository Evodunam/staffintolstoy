import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, buildUrl } from "@shared/routes";
import { type InsertJob, type Job } from "@shared/schema";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { useProfile } from "@/hooks/use-profiles";

export function useJobs(filters?: { trade?: string; location?: string }) {
  return useQuery({
    queryKey: [api.jobs.list.path, filters],
    queryFn: async () => {
      // Build query string
      const params = new URLSearchParams();
      if (filters?.trade) params.append("trade", filters.trade);
      if (filters?.location) params.append("location", filters.location);
      
      const url = `${api.jobs.list.path}?${params.toString()}`;
      
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch jobs");
      return api.jobs.list.responses[200].parse(await res.json());
    },
  });
}

export function useJob(id: number) {
  return useQuery({
    queryKey: [api.jobs.get.path, id],
    queryFn: async () => {
      const url = buildUrl(api.jobs.get.path, { id });
      const res = await fetch(url, { credentials: "include" });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error("Failed to fetch job");
      return api.jobs.get.responses[200].parse(await res.json());
    },
    enabled: !!id,
  });
}

export function useCreateJob() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (data: Omit<InsertJob, "companyId">) => {
      const res = await fetch(api.jobs.create.path, {
        method: api.jobs.create.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
        credentials: "include",
      });
      
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || "Failed to create job");
      }
      return api.jobs.create.responses[201].parse(await res.json());
    },
    onSuccess: () => {
      toast({ title: "Success", description: "Job posted successfully." });
      queryClient.invalidateQueries({ queryKey: [api.jobs.list.path] });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    }
  });
}

export function useUpdateJobStatus() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ id, status }: { id: number; status: 'open' | 'in_progress' | 'completed' | 'cancelled' }) => {
      const url = buildUrl(api.jobs.updateStatus.path, { id });
      const res = await fetch(url, {
        method: api.jobs.updateStatus.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
        credentials: "include",
      });

      if (!res.ok) throw new Error("Failed to update status");
      return api.jobs.updateStatus.responses[200].parse(await res.json());
    },
    onSuccess: (data) => {
      toast({ title: "Status Updated", description: `Job is now ${data.status}` });
      queryClient.invalidateQueries({ queryKey: [api.jobs.list.path] });
      queryClient.invalidateQueries({ queryKey: [api.jobs.get.path, data.id] });
    },
  });
}

// Hook for worker find-work endpoint (filters out fully staffed and dismissed jobs).
// Pass enabled: !!profile && profile.role === 'worker' to avoid 403 when user has no profile yet.
export function useFindWork(
  filters?: { trade?: string; location?: string },
  options?: { enabled?: boolean }
) {
  const enabled = options?.enabled !== false;
  return useQuery<Job[]>({
    queryKey: ["/api/jobs/find-work", filters],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filters?.trade) params.append("trade", filters.trade);
      if (filters?.location) params.append("location", filters.location);
      
      const url = `/api/jobs/find-work?${params.toString()}`;
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) {
        if (res.status === 401 || res.status === 403) {
          return [];
        }
        throw new Error("Failed to fetch jobs");
      }
      return res.json();
    },
    enabled,
  });
}

// Hook for dismissing jobs (not interested)
export function useDismissJob() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ workerId, jobId, reason }: { workerId: number; jobId: number; reason?: string }) => {
      const res = await fetch(`/api/workers/${workerId}/dismiss-job/${jobId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
        credentials: "include",
      });

      if (!res.ok) throw new Error("Failed to dismiss job");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Job dismissed", description: "This job won't show up in your feed anymore." });
      queryClient.invalidateQueries({ queryKey: ["/api/jobs/find-work"] });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    }
  });
}

// Hook for undoing a dismissed job
export function useUndismissJob() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ workerId, jobId }: { workerId: number; jobId: number }) => {
      const res = await fetch(`/api/workers/${workerId}/dismiss-job/${jobId}`, {
        method: "DELETE",
        credentials: "include",
      });

      if (!res.ok) throw new Error("Failed to restore job");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Job restored", description: "This job will appear in your feed again." });
      queryClient.invalidateQueries({ queryKey: ["/api/jobs/find-work"] });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    }
  });
}

// Company jobs interface matching API response
export interface CompanyJobApplication {
  id: number;
  workerId: number;
  message: string | null;
  proposedRate: number | null;
  status: string;
  createdAt: Date | null;
  worker: {
    id: number;
    firstName: string | null;
    lastName: string | null;
    avatarUrl: string | null;
    phone: string | null;
    hourlyRate: number | null;
    averageRating: string | null;
    completedJobs: number | null;
    trades: string[] | null;
    serviceCategories: string[] | null;
    bio: string | null;
  };
}

export interface CompanyJobTimesheet {
  id: number;
  workerId: number;
  totalHours: string | null;
  hourlyRate: number;
  status: string | null;
  clockInTime: string; // ISO string from API
  clockOutTime?: string | null; // ISO string from API
}

export interface CompanyJob extends Job {
  applications: CompanyJobApplication[];
  timesheets: CompanyJobTimesheet[];
}

// Hook to fetch company jobs with applications and timesheets
// Only runs when user is a company — prevents 403 when worker views company routes
export function useCompanyJobs() {
  const { user, isAuthenticated } = useAuth();
  const { data: profile } = useProfile(user?.id);
  const isCompany = profile?.role === "company";
  return useQuery<CompanyJob[]>({
    queryKey: ["/api/company/jobs"],
    enabled: !!isAuthenticated && !!profile && isCompany,
    queryFn: async () => {
      const res = await fetch("/api/company/jobs", { credentials: "include" });
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({ message: "Failed to fetch company jobs" }));
        const errorMessage = errorData.message || `Failed to fetch company jobs (${res.status})`;
        const error = new Error(errorMessage) as any;
        error.status = res.status;
        error.data = errorData;
        throw error;
      }
      return res.json();
    },
    retry: (failureCount, error: any) => {
      // Don't retry on 403 (Forbidden) or 401 (Unauthorized) errors
      if (error?.status === 403 || error?.status === 401 || 
          error?.message?.includes("403") || error?.message?.includes("401") || 
          error?.message?.includes("Forbidden") || error?.message?.includes("Unauthorized") ||
          error?.message?.includes("Profile not found") || error?.message?.includes("Only companies")) {
        return false;
      }
      return failureCount < 3;
    },
  });
}
