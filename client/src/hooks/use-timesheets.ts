import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import type { Timesheet, Profile, Job } from "@shared/schema";

export type TimesheetWithDetails = Timesheet & {
  worker: Profile;
  job: Job;
  autoApprovalAt?: Date | string | null;
  autoApprovalMsRemaining?: number;
  willAutoApprove?: boolean;
};

export function useCompanyTimesheets(companyId: number | undefined, status?: string) {
  return useQuery<TimesheetWithDetails[]>({
    queryKey: ["/api/timesheets/company", companyId, status],
    queryFn: async () => {
      if (!companyId) return [];
      const url = status 
        ? `/api/timesheets/company/${companyId}?status=${status}`
        : `/api/timesheets/company/${companyId}`;
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch timesheets");
      return res.json();
    },
    enabled: !!companyId,
  });
}

export type TimesheetApprovalResponse = Timesheet & {
  payoutStatus?: 'escrow' | 'processing' | 'completed' | 'failed';
  escrowInfo?: {
    workerBankMissing: boolean;
    workerName: string;
    amount: number;
    message: string;
  };
};

export function useApproveTimesheet() {
  const queryClient = useQueryClient();
  
  return useMutation<TimesheetApprovalResponse, Error, { id: number; adjustedHours?: number; companyNotes?: string }>({
    mutationFn: async ({ id, adjustedHours, companyNotes }) => {
      const response = await apiRequest("PUT", `/api/timesheets/${id}/approve`, { adjustedHours, companyNotes });
      return response.json();
    },
    onMutate: async ({ id }) => {
      await queryClient.cancelQueries({ queryKey: ["/api/timesheets/company"] });
      const previous = queryClient.getQueriesData<TimesheetWithDetails[]>({ queryKey: ["/api/timesheets/company"] });
      queryClient.setQueriesData<TimesheetWithDetails[]>(
        { queryKey: ["/api/timesheets/company"] },
        (old) => old?.map((t) => t.id === id ? { ...t, status: "approved" as const } : t) ?? old
      );
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        context.previous.forEach(([queryKey, data]) => {
          queryClient.setQueryData(queryKey, data);
        });
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/timesheets/company"] });
    },
  });
}

export function useRejectTimesheet() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async ({ id, rejectionReason }: { id: number; rejectionReason: string }) => {
      return apiRequest("PUT", `/api/timesheets/${id}/reject`, { rejectionReason });
    },
    onMutate: async ({ id }) => {
      await queryClient.cancelQueries({ queryKey: ["/api/timesheets/company"] });
      const previous = queryClient.getQueriesData<TimesheetWithDetails[]>({ queryKey: ["/api/timesheets/company"] });
      queryClient.setQueriesData<TimesheetWithDetails[]>(
        { queryKey: ["/api/timesheets/company"] },
        (old) => old?.map((t) => t.id === id ? { ...t, status: "rejected" as const } : t) ?? old
      );
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        context.previous.forEach(([queryKey, data]) => {
          queryClient.setQueryData(queryKey, data);
        });
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/timesheets/company"] });
    },
  });
}

export type BulkApprovalResponse = {
  success: boolean;
  approved: number;
  failed: number;
  escrowCount: number;
  results: { id: number; success: boolean; error?: string; escrowInfo?: { workerName: string; amount: number } }[];
};

export function useBulkApproveTimesheets() {
  const queryClient = useQueryClient();
  
  return useMutation<BulkApprovalResponse, Error, { timesheetIds: number[] }>({
    mutationFn: async ({ timesheetIds }) => {
      // Only approve real timesheets (positive IDs). Sample/placeholder timesheets use negative IDs and don't exist in the API.
      const realIds = timesheetIds.filter((id) => id > 0);
      if (realIds.length === 0) {
        return { success: true, approved: 0, failed: 0, escrowCount: 0, results: [] };
      }

      const results: BulkApprovalResponse['results'] = [];
      let escrowCount = 0;

      for (const id of realIds) {
        try {
          const response = await apiRequest("PUT", `/api/timesheets/${id}/approve`, {});
          const data = await response.json() as TimesheetApprovalResponse;
          
          if (data.payoutStatus === 'escrow' && data.escrowInfo) {
            escrowCount++;
            results.push({
              id,
              success: true,
              escrowInfo: {
                workerName: data.escrowInfo.workerName,
                amount: data.escrowInfo.amount
              }
            });
          } else {
            results.push({ id, success: true });
          }
        } catch (err: any) {
          results.push({ id, success: false, error: err?.message || 'Unknown error' });
        }
      }
      
      const approved = results.filter(r => r.success).length;
      return {
        success: approved > 0,
        approved,
        failed: realIds.length - approved,
        escrowCount,
        results
      };
    },
    onMutate: async ({ timesheetIds }) => {
      const realIds = timesheetIds.filter((id) => id > 0);
      await queryClient.cancelQueries({ queryKey: ["/api/timesheets/company"] });
      const previous = queryClient.getQueriesData<TimesheetWithDetails[]>({ queryKey: ["/api/timesheets/company"] });
      const idSet = new Set(realIds);
      queryClient.setQueriesData<TimesheetWithDetails[]>(
        { queryKey: ["/api/timesheets/company"] },
        (old) => old?.map((t) => idSet.has(t.id) ? { ...t, status: "approved" as const } : t) ?? old
      );
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        context.previous.forEach(([queryKey, data]) => {
          queryClient.setQueryData(queryKey, data);
        });
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/timesheets/company"] });
    },
  });
}
