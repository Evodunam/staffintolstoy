import { useQuery, useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { api, buildUrl } from "@shared/routes";
import { type InsertProfile, type Profile } from "@shared/schema";
import { useToast } from "@/hooks/use-toast";

/** Session-backed profile (same source as req.profile). userId in key avoids cross-account stale cache. */
export const PROFILE_ME_QUERY_KEY_PREFIX = "/api/profiles/me";

export function profileMeQueryKey(userId: string | undefined) {
  return [PROFILE_ME_QUERY_KEY_PREFIX, userId] as const;
}

export function invalidateSessionProfileQueries(queryClient: QueryClient) {
  queryClient.invalidateQueries({ queryKey: [PROFILE_ME_QUERY_KEY_PREFIX] });
  queryClient.invalidateQueries({ queryKey: [api.profiles.get.path] });
}

export function useProfile(userId?: string) {
  const enabled = !!userId;

  return useQuery({
    queryKey: profileMeQueryKey(userId),
    queryFn: async () => {
      if (!userId) return null;
      const res = await fetch(`${PROFILE_ME_QUERY_KEY_PREFIX}`, { credentials: "include" });
      if (res.status === 401) return null;
      if (!res.ok) throw new Error("Failed to fetch profile");
      const data = await res.json();
      // Server returns 200 with null when user has no profile yet (e.g. onboarding)
      return api.profiles.get.responses[200].parse(data);
    },
    enabled,
    retry: false,
    staleTime: 60_000,
    gcTime: 5 * 60 * 1000,
    refetchOnWindowFocus: true,
    refetchOnMount: true,
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
        invalidateSessionProfileQueries(queryClient);
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
        let message = "Failed to update profile";
        try {
          const text = await res.text();
          try {
            const error = JSON.parse(text);
            message = error?.message || message;
          } catch {
            if (text && text.length < 500 && !text.trimStart().startsWith("<")) message = text;
            else message = res.statusText || message;
          }
        } catch {
          message = res.statusText || message;
        }
        throw new Error(message);
      }
      return api.profiles.update.responses[200].parse(await res.json());
    },
    onSuccess: (_data, variables) => {
      setTimeout(() => {
        if (!variables.skipToast) {
          toast({ title: "Updated", description: "Profile updated successfully." });
        }
        invalidateSessionProfileQueries(queryClient);
      }, 0);
    },
    onError: (error: Error, variables: UpdateProfileVariables) => {
      if (!variables.skipToast) {
        toast({ title: "Error", description: error.message, variant: "destructive" });
      }
    }
  });
}
