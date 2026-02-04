import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, buildUrl } from "@shared/routes";
import { type InsertApplication } from "@shared/schema";
import { useToast } from "@/hooks/use-toast";

export function useJobApplications(jobId: number) {
  return useQuery({
    queryKey: [api.applications.listByJob.path, jobId],
    queryFn: async () => {
      const url = buildUrl(api.applications.listByJob.path, { jobId });
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch applications");
      return api.applications.listByJob.responses[200].parse(await res.json());
    },
    enabled: !!jobId,
  });
}

export function useCreateApplication() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (data: { jobId: number; message?: string }) => {
      const res = await fetch(api.applications.create.path, {
        method: api.applications.create.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
        credentials: "include",
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || "Failed to submit application");
      }
      return api.applications.create.responses[201].parse(await res.json());
    },
    onSuccess: (_, variables) => {
      toast({ title: "Application Sent", description: "The company has been notified." });
      queryClient.invalidateQueries({ queryKey: [api.applications.listByJob.path, variables.jobId] });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    }
  });
}

export function useUpdateApplicationStatus() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ id, status, jobId }: { id: number; status: 'pending' | 'accepted' | 'rejected'; jobId: number }) => {
      const url = buildUrl(api.applications.updateStatus.path, { id });
      const res = await fetch(url, {
        method: api.applications.updateStatus.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
        credentials: "include",
      });

      if (!res.ok) throw new Error("Failed to update status");
      return api.applications.updateStatus.responses[200].parse(await res.json());
    },
    onSuccess: (data, variables) => {
      toast({ title: "Status Updated", description: `Application ${data.status}` });
      queryClient.invalidateQueries({ queryKey: [api.applications.listByJob.path, variables.jobId] });
    },
  });
}
