import { useEffect } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { useProfile } from "@/hooks/use-profiles";
import { isWorkerOnboardingComplete } from "@/lib/worker-onboarding";
import { fetchAffiliateMe } from "@/lib/queryClient";

/**
 * When a worker has incomplete onboarding, redirect them to the full worker onboarding
 * page (/worker-onboarding) instead of showing a modal. All data is pre-filled from their
 * account there; they complete only missing items (face photo, bank, address, agreement,
 * name, email/password) and every save persists to their profile so this redirect
 * does not recur once complete.
 */
export function WorkerOnboardingRequiredModal() {
  const [path, setLocation] = useLocation();
  const { user, isAuthenticated, isLoading: authLoading } = useAuth();
  const { data: profile, isLoading: profileLoading } = useProfile(user?.id);
  const { data: affiliate } = useQuery({
    queryKey: ["/api/affiliates/me"],
    queryFn: fetchAffiliateMe,
    retry: false,
    enabled: isAuthenticated && !!user?.id,
  });

  const isWorkerOnboardingPath =
    path === "/worker-onboarding" || path.startsWith("/worker-onboarding");
  const isAffiliatePath =
    path === "/affiliate-onboarding" ||
    path.startsWith("/affiliate-onboarding") ||
    path === "/affiliate-dashboard";
  const isCompanyPath =
    path === "/company-onboarding" ||
    path.startsWith("/company-onboarding") ||
    path === "/company-dashboard";

  const isAffiliate = affiliate != null && typeof affiliate === "object";
  const isCompany = profile?.role === "company";

  const userType =
    user && "userType" in user
      ? (user as { userType?: string }).userType
      : (user as { user_type?: string } | null)?.user_type;
  const isWorker =
    profile != null ? profile.role === "worker" : userType === "worker";
  // Only consider "needs onboarding" when we have a worker profile that is actually incomplete.
  // Do not redirect when profile is null (still loading or failed to load), to avoid sending
  // users who already completed onboarding to /worker-onboarding (e.g. after 401 or profile fetch error).
  const needsOnboarding =
    profile != null &&
    profile.role === "worker" &&
    !isWorkerOnboardingComplete(profile);

  const shouldRedirect =
    isAuthenticated &&
    !authLoading &&
    !profileLoading &&
    isWorker &&
    needsOnboarding &&
    !isWorkerOnboardingPath &&
    !isAffiliatePath &&
    !isAffiliate &&
    !isCompanyPath &&
    !isCompany;

  useEffect(() => {
    if (shouldRedirect) {
      setLocation("/worker-onboarding");
    }
  }, [shouldRedirect, setLocation]);

  return null;
}
