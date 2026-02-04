import { useEffect } from "react";
import { useParams, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { AcceptedJobPopup } from "@/components/AcceptedJobPopup";
import type { Job, Profile } from "@shared/schema";
import { useTranslation } from "react-i18next";

export default function AcceptedJobPage() {
  const { t } = useTranslation("acceptedJob");
  const { id } = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const jobId = parseInt(id || "0", 10);

  const { data: profile, isLoading: profileLoading } = useQuery<Profile>({
    queryKey: ["/api/profile"],
  });

  const { data: job, isLoading: jobLoading, error: jobError } = useQuery<Job>({
    queryKey: ["/api/jobs", jobId],
    enabled: !!jobId && !!profile,
  });

  const { data: applications = [] } = useQuery<any[]>({
    queryKey: ["/api/jobs", jobId, "applications"],
    enabled: !!jobId && !!profile && profile.role === "company",
  });

  const { data: company } = useQuery<Profile>({
    queryKey: ["/api/profiles", job?.companyId],
    enabled: !!job && profile?.role === "worker",
  });

  const { data: workerApplications = [] } = useQuery<any[]>({
    queryKey: ["/api/my-applications"],
    enabled: !!profile && profile.role === "worker",
  });

  const handleClose = (open: boolean) => {
    if (!open) {
      if (profile?.role === "worker") {
        setLocation("/worker-dashboard");
      } else {
        setLocation("/company-dashboard");
      }
    }
  };

  if (profileLoading || jobLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!profile) {
    setLocation("/");
    return null;
  }

  if (jobError || !job) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-4">
        <h1 className="text-xl font-semibold">{t("jobNotFound")}</h1>
        <p className="text-muted-foreground">
          {t("jobMayHaveBeenRemoved")}
        </p>
      </div>
    );
  }

  const otherParty = profile.role === "worker" 
    ? company 
    : applications.find((app: any) => app.status === "accepted" || app.status === "approved")?.worker;

  return (
    <AcceptedJobPopup
      open={true}
      onOpenChange={handleClose}
      job={job}
      currentUser={profile}
      otherParty={otherParty}
    />
  );
}
