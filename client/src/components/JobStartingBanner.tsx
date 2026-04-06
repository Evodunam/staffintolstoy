import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { differenceInMinutes, isToday, format, parseISO } from "date-fns";
import { AlertCircle, Clock, Navigation, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState, useMemo } from "react";
import type { Profile, Job, Application, Timesheet } from "@shared/schema";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/hooks/use-auth";
import { useProfile } from "@/hooks/use-profiles";

interface JobAssignment {
  application: Application & { 
    job: Job;
    teamMember?: { id: number; firstName: string; lastName: string } | null;
  };
  activeTimesheet?: Timesheet | null;
}

export function JobStartingBanner() {
  const [, setLocation] = useLocation();
  const [dismissed, setDismissed] = useState<Set<number>>(new Set());
  const { t } = useTranslation();
  const { user } = useAuth();
  const { data: profile } = useProfile(user?.id);

  const { data: assignments = [] } = useQuery<JobAssignment[]>({
    queryKey: ["/api/today/assignments"],
    queryFn: async () => {
      const res = await fetch("/api/today/assignments", { credentials: "include" });
      if (res.status === 401) return [];
      if (!res.ok) throw new Error("Failed to fetch assignments");
      return res.json();
    },
    enabled: !!profile && profile.role === "worker",
    refetchInterval: 60000,
  });

  const upcomingJobs = useMemo(() => {
    if (!assignments.length) return [];
    
    const now = new Date();
    
    return assignments.filter(a => {
      const job = a.application.job;
      
      if (dismissed.has(job.id)) return false;
      
      if (a.activeTimesheet && !a.activeTimesheet.clockOutTime) return false;
      
      if (!job.startDate) return false;
      
      const startDate = new Date(job.startDate);
      if (!isToday(startDate)) return false;
      
      if (job.scheduledTime) {
        const [hours, minutes] = job.scheduledTime.split(":").map(Number);
        startDate.setHours(hours, minutes, 0, 0);
      }
      
      const minutesUntilStart = differenceInMinutes(startDate, now);
      
      return minutesUntilStart >= -60 && minutesUntilStart <= 60;
    }).sort((a, b) => {
      const dateA = new Date(a.application.job.startDate!);
      const dateB = new Date(b.application.job.startDate!);
      return dateA.getTime() - dateB.getTime();
    });
  }, [assignments, dismissed]);

  if (!upcomingJobs.length || !profile || profile.role !== "worker") {
    return null;
  }

  const nextJob = upcomingJobs[0];
  const job = nextJob.application.job;
  const startDate = new Date(job.startDate!);
  if (job.scheduledTime) {
    const [hours, minutes] = job.scheduledTime.split(":").map(Number);
    startDate.setHours(hours, minutes, 0, 0);
  }
  
  const minutesUntilStart = differenceInMinutes(startDate, new Date());
  const timeText = minutesUntilStart > 0 
    ? t("banners.startsIn", { count: minutesUntilStart })
    : minutesUntilStart === 0 
    ? t("banners.startingNow")
    : t("banners.startedAgo", { count: Math.abs(minutesUntilStart) });

  const handleDismiss = () => {
    setDismissed(prev => {
      const newSet = new Set(prev);
      newSet.add(job.id);
      return newSet;
    });
  };

  const handleClockIn = () => {
    setLocation("/dashboard/today");
  };

  return (
    <div className="bg-orange-500 text-white px-4 py-3" data-testid="job-starting-banner">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center flex-shrink-0">
            <AlertCircle className="w-4 h-4" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-sm truncate">
              {job.title}
              {nextJob.application.teamMember && (
                <span className="font-normal ml-1">
                  ({nextJob.application.teamMember.firstName})
                </span>
              )}
            </p>
            <p className="text-xs text-white/80 flex items-center gap-1">
              <Clock className="w-3 h-3" />
              {timeText}
            </p>
          </div>
        </div>
        
        <div className="flex items-center gap-2 flex-shrink-0">
          <Button
            size="sm"
            variant="secondary"
            className="bg-white text-orange-600 hover:bg-white/90"
            onClick={handleClockIn}
            data-testid="button-banner-clock-in"
          >
            {t("worker.clockIn")}
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="text-white hover:bg-white/20 h-8 w-8"
            onClick={handleDismiss}
            data-testid="button-dismiss-banner"
          >
            <X className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
