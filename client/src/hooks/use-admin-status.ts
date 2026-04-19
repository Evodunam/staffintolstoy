import { useQuery } from "@tanstack/react-query";

/**
 * Returns the caller's admin status — whether they're an admin, a super-admin,
 * MFA enrollment state, and (when applicable) days remaining in the MFA
 * grace period before enforcement kicks in.
 *
 * Backed by GET /api/me/admin-status. Cached for 60s; stays in sync via
 * react-query refetch on window focus.
 */
export interface AdminStatus {
  isAdmin: boolean;
  isSuperAdmin: boolean;
  mfaEnrolled: boolean;
  mfaRequired: boolean;
  mfaGraceDaysLeft: number | null;
}

export function useAdminStatus() {
  return useQuery<AdminStatus>({
    queryKey: ["/api/me/admin-status"],
    queryFn: async () => {
      const res = await fetch("/api/me/admin-status", { credentials: "include" });
      if (!res.ok) {
        // Caller is unauthenticated or endpoint isn't deployed yet — return a
        // safe "not admin" default so consumers don't have to null-check.
        return {
          isAdmin: false, isSuperAdmin: false, mfaEnrolled: false,
          mfaRequired: false, mfaGraceDaysLeft: null,
        } as AdminStatus;
      }
      return res.json();
    },
    staleTime: 60_000,
  });
}

