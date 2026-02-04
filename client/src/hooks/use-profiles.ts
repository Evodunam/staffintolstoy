import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, buildUrl } from "@shared/routes";
import { type InsertProfile, type Profile } from "@shared/schema";
import { useToast } from "@/hooks/use-toast";

export function useProfile(userId?: string) {
  // If no userId is provided, we rely on the auth context user ID (usually handled by redirecting if no profile)
  // But strictly for the API contract, we need a userId path param.
  // In a real app, we might check `useAuth` hook first.
  const enabled = !!userId;
  
  return useQuery({
    queryKey: [api.profiles.get.path, userId],
    queryFn: async () => {
      if (!userId) return null;
      const url = buildUrl(api.profiles.get.path, { userId });
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch profile");
      const data = await res.json();
      // Server returns 200 with null when user has no profile yet (e.g. onboarding)
      return api.profiles.get.responses[200].parse(data);
    },
    enabled,
    retry: false,
    staleTime: 2 * 60 * 1000, // Cache for 2 minutes
    gcTime: 5 * 60 * 1000, // Keep in cache for 5 minutes
    refetchOnWindowFocus: false, // Don't refetch on window focus
  });
}

type CreateProfileVariables = InsertProfile & { skipToast?: boolean };

export function useCreateProfile() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (data: CreateProfileVariables) => {
      const { skipToast: _, ...payload } = data;
      const res = await fetch(api.profiles.create.path, {
        method: api.profiles.create.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        credentials: "include",
      });
      
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || "Failed to create profile");
      }
      return api.profiles.create.responses[201].parse(await res.json());
    },
    onSuccess: (_data, variables) => {
      setTimeout(() => {
        if (!variables.skipToast) {
          toast({ title: "Welcome!", description: "Profile created successfully." });
        }
        queryClient.invalidateQueries({ queryKey: [api.profiles.get.path] });
        queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      }, 0);
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    }
  });
}

type UpdateProfileVariables = { id: number; data: Partial<InsertProfile>; skipToast?: boolean };

export function useUpdateProfile() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ id, data, skipToast: _ }: UpdateProfileVariables) => {
      const url = buildUrl(api.profiles.update.path, { id });
      const res = await fetch(url, {
        method: api.profiles.update.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
        credentials: "include",
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || "Failed to update profile");
      }
      return api.profiles.update.responses[200].parse(await res.json());
    },
    onSuccess: (_data, variables) => {
      setTimeout(() => {
        if (!variables.skipToast) {
          toast({ title: "Updated", description: "Profile updated successfully." });
        }
        queryClient.invalidateQueries({ queryKey: [api.profiles.get.path] });
      }, 0);
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    }
  });
}
