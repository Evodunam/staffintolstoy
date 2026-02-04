import { useMemo, useRef, useState } from "react";
import { ChevronLeft, Calendar, Clock, AlertTriangle, CheckCircle2, Loader2, Users, User, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Drawer, DrawerContent, DrawerTitle, DrawerDescription } from "@/components/ui/drawer";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useIsMobile } from "@/hooks/use-mobile";
import { useScrollHeaderContainer } from "@/hooks/use-scroll-header-container";
import { useQuery } from "@tanstack/react-query";
import { format, addHours, isSameDay } from "date-fns";
import type { Job, Profile } from "@shared/schema";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

interface ApplicationWithJob {
  id: number;
  status: string;
  job: Job;
}

interface TeamMemberBasic {
  id: number;
  firstName: string;
  lastName: string;
  avatarUrl: string | null;
  hourlyRate: number | null;
  email?: string | null;
  phone?: string | null;
  role?: "admin" | "employee";
  skillsets?: string[];
}

interface CalendarConflictPopupProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  job: Job;
  profile?: Profile | null;
  activeTeamMembers?: TeamMemberBasic[];
  onApply?: (teamMemberId: number | "self") => void;
}

export function CalendarConflictPopup({
  open,
  onOpenChange,
  job,
  profile,
  activeTeamMembers = [],
  onApply,
}: CalendarConflictPopupProps) {
  const isMobile = useIsMobile();
  const { t } = useTranslation();
  const { t: tCommon } = useTranslation("common");
  const [selectedTeamMember, setSelectedTeamMember] = useState<number | "self" | null>(null);

  const jobStart = useMemo(() => {
    if (!job.startDate) return null;
    return new Date(job.startDate);
  }, [job.startDate]);

  const jobEnd = useMemo(() => {
    if (!jobStart) return null;
    if (job.endDate) return new Date(job.endDate);
    if (job.estimatedHours) return addHours(jobStart, job.estimatedHours);
    return addHours(jobStart, 8);
  }, [jobStart, job.endDate, job.estimatedHours]);

  // Fetch user's own accepted applications
  const { data: acceptedApplications = [], isLoading } = useQuery<ApplicationWithJob[]>({
    queryKey: ["/api/applications/worker", profile?.id],
    queryFn: async () => {
      if (!profile?.id) return [];
      const res = await fetch(`/api/applications/worker/${profile.id}`);
      if (!res.ok) return [];
      const apps = await res.json();
      return apps.filter((app: ApplicationWithJob) => app.status === "accepted");
    },
    enabled: !!profile?.id && open,
  });

  // Fetch all applications for the business operator (includes team member applications)
  const { data: allApplications = [] } = useQuery<ApplicationWithJob[]>({
    queryKey: ["/api/applications/worker", profile?.id, "all"],
    queryFn: async () => {
      if (!profile?.id) return [];
      const res = await fetch(`/api/applications/worker/${profile.id}`);
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!profile?.id && activeTeamMembers.length > 0 && open,
  });

  // Group applications by team member
  const teammateApplications = useMemo(() => {
    const results: Record<number, ApplicationWithJob[]> = {};
    const acceptedApps = allApplications.filter((app: any) => app.status === "accepted");
    
    activeTeamMembers.forEach(member => {
      // Filter applications for this team member
      // Applications have teamMember object with id field
      results[member.id] = acceptedApps.filter((app: any) => 
        app.teamMember?.id === member.id
      );
    });
    
    return results;
  }, [allApplications, activeTeamMembers]);

  const scheduledJobs = useMemo(() => {
    if (!jobStart) return [];
    return acceptedApplications
      .filter(app => app.job.startDate && isSameDay(new Date(app.job.startDate), jobStart))
      .map(app => {
        const start = new Date(app.job.startDate!);
        const end = app.job.endDate 
          ? new Date(app.job.endDate)
          : addHours(start, app.job.estimatedHours || 8);
        return {
          id: app.job.id,
          title: app.job.title,
          start,
          end,
        };
      });
  }, [acceptedApplications, jobStart]);

  // Check availability for each teammate
  const teammateAvailability = useMemo(() => {
    if (!jobStart || !jobEnd) return [];
    
    return activeTeamMembers.map(member => {
      const memberApps = teammateApplications[member.id] || [];
      const memberScheduledJobs = memberApps
        .filter(app => app.job.startDate && isSameDay(new Date(app.job.startDate), jobStart))
        .map(app => {
          const start = new Date(app.job.startDate!);
          const end = app.job.endDate 
            ? new Date(app.job.endDate)
            : addHours(start, app.job.estimatedHours || 8);
          return { start, end };
        });
      
      const hasConflict = memberScheduledJobs.some(event => 
        event.start < jobEnd && event.end > jobStart
      );
      
      return {
        member,
        isAvailable: !hasConflict,
        conflicts: memberScheduledJobs.filter(event => 
          event.start < jobEnd && event.end > jobStart
        ).length,
      };
    });
  }, [activeTeamMembers, teammateApplications, jobStart, jobEnd]);

  const conflicts = useMemo(() => {
    if (!jobStart || !jobEnd) return [];
    
    return scheduledJobs.filter(event => {
      const overlaps = (
        (event.start < jobEnd && event.end > jobStart)
      );
      return overlaps;
    });
  }, [scheduledJobs, jobStart, jobEnd]);

  const hasConflicts = conflicts.length > 0;

  const formatTime = (date: Date) => {
    return format(date, "h:mm a");
  };

  const formatDateHeader = (date: Date | null) => {
    if (!date) return t("calendar.noDateSet");
    return format(date, "EEEE, MMMM d, yyyy");
  };

  const content = (
    <div className="space-y-4 p-4">
      <div className="text-center p-4 rounded-xl bg-muted/50">
        <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">{t("calendar.jobScheduledFor")}</p>
        <p className="font-semibold text-lg">{formatDateHeader(jobStart)}</p>
        {jobStart && jobEnd && (
          <p className="text-sm text-muted-foreground mt-1">
            {formatTime(jobStart)} - {formatTime(jobEnd)}
            {job.estimatedHours && <span className="ml-2">({t("calendar.hours", { count: job.estimatedHours })})</span>}
          </p>
        )}
      </div>

      <div className={`p-4 rounded-xl ${hasConflicts ? 'bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800' : 'bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800'}`}>
        <div className="flex items-center gap-3">
          {hasConflicts ? (
            <>
              <div className="w-10 h-10 rounded-full bg-amber-500/20 flex items-center justify-center">
                <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400" />
              </div>
              <div>
                <p className="font-medium text-amber-800 dark:text-amber-200">{t("calendar.schedulingConflict")}</p>
                <p className="text-sm text-amber-600 dark:text-amber-400">{t("calendar.jobsOverlap", { count: conflicts.length })}</p>
              </div>
            </>
          ) : (
            <>
              <div className="w-10 h-10 rounded-full bg-green-500/20 flex items-center justify-center">
                <CheckCircle2 className="w-5 h-5 text-green-600 dark:text-green-400" />
              </div>
              <div>
                <p className="font-medium text-green-800 dark:text-green-200">{t("calendar.noConflicts")}</p>
                <p className="text-sm text-green-600 dark:text-green-400">{t("calendar.jobFitsSchedule")}</p>
              </div>
            </>
          )}
        </div>
      </div>

      {jobStart && (
        <div className="space-y-3">
          <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">{t("calendar.yourDay")}</h3>
          
          {isLoading ? (
            <div className="flex items-center justify-center py-6">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : scheduledJobs.length === 0 ? (
            <div className="text-center py-6 text-muted-foreground">
              <Calendar className="w-8 h-8 mx-auto mb-2 opacity-50" />
              <p className="text-sm">{t("calendar.noOtherJobsScheduled")}</p>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="relative border-l-2 border-primary/30 ml-3 pl-4 py-2">
                <div className="absolute -left-1.5 top-2 w-3 h-3 rounded-full bg-primary border-2 border-background" />
                <p className="text-xs text-muted-foreground mb-1">{t("calendar.thisJob")}</p>
                <div className="bg-primary/10 border border-primary/30 rounded-lg p-3">
                  <p className="font-medium text-sm">{job.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatTime(jobStart)} - {jobEnd ? formatTime(jobEnd) : tCommon("tbd")}
                  </p>
                </div>
              </div>

              {scheduledJobs.map((event) => {
                const isConflict = conflicts.some(c => c.id === event.id);
                return (
                  <div key={event.id} className={`relative border-l-2 ml-3 pl-4 py-2 ${isConflict ? 'border-amber-500' : 'border-muted'}`}>
                    <div className={`absolute -left-1.5 top-2 w-3 h-3 rounded-full border-2 border-background ${isConflict ? 'bg-amber-500' : 'bg-muted-foreground/30'}`} />
                    <div className={`rounded-lg p-3 ${isConflict ? 'bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800' : 'bg-muted/50'}`}>
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="font-medium text-sm">{event.title}</p>
                          <p className="text-xs text-muted-foreground">
                            {formatTime(event.start)} - {formatTime(event.end)}
                          </p>
                        </div>
                        <Badge variant="secondary" className="text-xs shrink-0">
                          {t("job.accepted")}
                        </Badge>
                      </div>
                      {isConflict && (
                        <p className="text-xs text-amber-600 dark:text-amber-400 mt-2">
                          {t("calendar.overlapsWithThisJob")}
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Team Members Availability Section - Only show if user has team members */}
      {activeTeamMembers.length > 0 && jobStart && (
        <div className="space-y-3">
          <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide flex items-center gap-2">
            <Users className="w-4 h-4" />
            {t("calendar.teamAvailability") || "Team Availability"}
          </h3>
          
          {isLoading ? (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="space-y-2">
              {/* Show self availability */}
              <div className={`rounded-lg p-3 border ${
                hasConflicts 
                  ? 'bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800' 
                  : 'bg-green-50 dark:bg-green-950/30 border-green-200 dark:border-green-800'
              }`}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Avatar className="w-10 h-10">
                      <AvatarImage src={profile?.avatarUrl || undefined} />
                      <AvatarFallback>
                        {profile?.firstName?.[0]}{profile?.lastName?.[0]}
                      </AvatarFallback>
                    </Avatar>
                    <div>
                      <p className="font-medium text-sm">
                        {profile?.firstName} {profile?.lastName} {t("calendar.yourself") || "(You)"}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {hasConflicts 
                          ? t("calendar.hasConflicts", { count: conflicts.length }) || `${conflicts.length} conflict(s)`
                          : t("calendar.available") || "Available"}
                      </p>
                    </div>
                  </div>
                  {!hasConflicts && onApply && (
                    <Button
                      size="sm"
                      onClick={() => {
                        setSelectedTeamMember("self");
                        if (onApply) {
                          onApply("self");
                          onOpenChange(false);
                        }
                      }}
                      data-testid="button-apply-self"
                    >
                      {t("calendar.apply") || "Apply"}
                    </Button>
                  )}
                </div>
              </div>

              {/* Show teammates availability */}
              {teammateAvailability.map(({ member, isAvailable, conflicts: conflictCount }) => (
                <div 
                  key={member.id} 
                  className={`rounded-lg p-3 border ${
                    isAvailable
                      ? 'bg-green-50 dark:bg-green-950/30 border-green-200 dark:border-green-800'
                      : 'bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <Avatar className="w-10 h-10">
                        <AvatarImage src={member.avatarUrl || undefined} />
                        <AvatarFallback>
                          {member.firstName[0]}{member.lastName[0]}
                        </AvatarFallback>
                      </Avatar>
                      <div>
                        <p className="font-medium text-sm">
                          {member.firstName} {member.lastName}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {isAvailable 
                            ? t("calendar.available") || "Available"
                            : t("calendar.hasConflicts", { count: conflictCount }) || `${conflictCount} conflict(s)`}
                        </p>
                        {member.hourlyRate && (
                          <p className="text-xs text-muted-foreground">
                            ${member.hourlyRate}/hr
                          </p>
                        )}
                      </div>
                    </div>
                    {isAvailable && onApply && (
                      <Button
                        size="sm"
                        onClick={() => {
                          setSelectedTeamMember(member.id);
                          if (onApply) {
                            onApply(member.id);
                            onOpenChange(false);
                          }
                        }}
                        data-testid={`button-apply-teammate-${member.id}`}
                      >
                        {t("calendar.apply") || "Apply"}
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <Button
        className="w-full"
        onClick={() => onOpenChange(false)}
        data-testid="button-close-calendar"
      >
        {tCommon("gotIt")}
      </Button>
    </div>
  );

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const isScrolled = useScrollHeaderContainer(scrollContainerRef);

  // Get available teammates (including self)
  const availableTeamMembers = useMemo(() => {
    const members: Array<{ id: number | "self"; firstName: string; lastName: string; avatarUrl: string | null; isAvailable: boolean }> = [];
    
    // Add self
    if (profile) {
      const selfAvailable = !hasConflicts;
      members.push({
        id: "self",
        firstName: profile.firstName || "",
        lastName: profile.lastName || "",
        avatarUrl: profile.avatarUrl,
        isAvailable: selfAvailable,
      });
    }
    
    // Add available teammates
    teammateAvailability.forEach(({ member, isAvailable }) => {
      if (isAvailable) {
        members.push({
          id: member.id,
          firstName: member.firstName,
          lastName: member.lastName,
          avatarUrl: member.avatarUrl,
          isAvailable: true,
        });
      }
    });
    
    return members;
  }, [profile, teammateAvailability, hasConflicts]);

  // Header: Back | Title | avatars | X (gold-standard)
  const headerContent = (
    <div className="flex flex-shrink-0 items-center gap-2 px-4 sm:px-6 py-3 border-b bg-background">
      <button
        type="button"
        onClick={() => onOpenChange(false)}
        className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors flex-shrink-0"
        data-testid="button-close-calendar-desktop"
        aria-label={tCommon("back")}
      >
        <ChevronLeft className="w-5 h-5" />
        <span className="font-medium">{tCommon("back")}</span>
      </button>
      <span className="text-muted-foreground flex-shrink-0">/</span>
      <Calendar className="w-4 h-4 text-muted-foreground flex-shrink-0" />
      <span className="font-medium flex-1 min-w-0 truncate">{t("calendar.title")}</span>
      {availableTeamMembers.length > 0 && (
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {availableTeamMembers.map((member) => (
            <button
              key={member.id}
              onClick={() => {
                if (onApply && member.isAvailable) {
                  onApply(member.id);
                  onOpenChange(false);
                }
              }}
              className="relative group"
              disabled={!member.isAvailable}
              data-testid={`teammate-avatar-${member.id}`}
            >
              <Avatar className={cn(
                "w-8 h-8 border-2 transition-all cursor-pointer",
                member.isAvailable
                  ? "border-primary hover:border-primary/80 hover:ring-2 hover:ring-primary/20"
                  : "border-muted opacity-50 cursor-not-allowed"
              )}>
                <AvatarImage src={member.avatarUrl || undefined} />
                <AvatarFallback className="text-xs">
                  {member.firstName[0]}{member.lastName[0]}
                </AvatarFallback>
              </Avatar>
              {member.isAvailable && (
                <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-green-500 border-2 border-background rounded-full" />
              )}
              <div className="absolute inset-0 rounded-full bg-black/0 group-hover:bg-black/5 transition-colors" />
            </button>
          ))}
        </div>
      )}
      <button
        type="button"
        onClick={() => onOpenChange(false)}
        className="flex items-center justify-center rounded-full bg-muted hover:bg-muted/80 w-9 h-9 flex-shrink-0"
        aria-label="Close"
      >
        <X className="w-5 h-5 text-muted-foreground" />
      </button>
    </div>
  );

  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={onOpenChange}>
        <DrawerContent className="max-h-[85vh] rounded-t-[28px] flex flex-col overflow-hidden [&>div:first-child]:hidden">
          <DrawerTitle className="sr-only">{t("calendar.title")}</DrawerTitle>
          <DrawerDescription className="sr-only">{t("calendar.description")}</DrawerDescription>
          <div className={cn(
            "w-12 rounded-full bg-muted mx-auto transition-all duration-200 flex-shrink-0",
            isScrolled ? "h-1 mt-2 mb-1 w-10" : "h-1.5 mt-2 mb-1"
          )} />
          <div className={cn(
            "flex items-center gap-2 px-4 sm:px-6 border-b bg-background transition-all duration-200 flex-shrink-0",
            isScrolled ? "py-2" : "py-3"
          )}>
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors flex-shrink-0"
              data-testid="button-close-calendar-mobile"
              aria-label={tCommon("back")}
            >
              <ChevronLeft className="w-5 h-5" />
              <span className="font-medium">{tCommon("back")}</span>
            </button>
            <span className="text-muted-foreground flex-shrink-0">/</span>
            <span className={cn("font-medium flex-1 min-w-0 truncate transition-all duration-200", isScrolled ? "text-sm" : "text-base")}>
              {t("calendar.title")}
            </span>
            {availableTeamMembers.length > 0 && (
              <div className="flex items-center gap-1.5 flex-shrink-0">
                {availableTeamMembers.map((member) => (
                  <button
                    key={member.id}
                    type="button"
                    onClick={() => {
                      if (onApply && member.isAvailable) {
                        onApply(member.id);
                        onOpenChange(false);
                      }
                    }}
                    className="relative group"
                    disabled={!member.isAvailable}
                    data-testid={`teammate-avatar-mobile-${member.id}`}
                  >
                    <Avatar className={cn(
                      "w-7 h-7 border-2 transition-all",
                      member.isAvailable
                        ? "border-primary hover:border-primary/80 hover:ring-2 hover:ring-primary/20"
                        : "border-muted opacity-50 cursor-not-allowed"
                    )}>
                      <AvatarImage src={member.avatarUrl || undefined} />
                      <AvatarFallback className="text-[10px]">
                        {member.firstName[0]}{member.lastName[0]}
                      </AvatarFallback>
                    </Avatar>
                    {member.isAvailable && (
                      <div className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 bg-green-500 border-2 border-background rounded-full" />
                    )}
                  </button>
                ))}
              </div>
            )}
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="flex items-center justify-center rounded-full bg-muted hover:bg-muted/80 w-9 h-9 flex-shrink-0"
              aria-label="Close"
            >
              <X className="w-5 h-5 text-muted-foreground" />
            </button>
          </div>
          <div
            ref={scrollContainerRef}
            className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden scrollbar-pill-on-scroll px-4 sm:px-6 py-4"
          >
            {content}
          </div>
        </DrawerContent>
      </Drawer>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent hideCloseButton className="max-w-md max-h-[85vh] p-0 rounded-2xl shadow-2xl border-0 overflow-hidden flex flex-col">
        <DialogTitle className="sr-only">{t("calendar.title")}</DialogTitle>
        <DialogDescription className="sr-only">{t("calendar.description")}</DialogDescription>
        {headerContent}
        <div ref={scrollContainerRef} className="flex-1 min-h-0 min-w-0 overflow-y-auto overflow-x-hidden scrollbar-pill-on-scroll px-4 sm:px-6 py-4">
          {content}
        </div>
      </DialogContent>
    </Dialog>
  );
}
