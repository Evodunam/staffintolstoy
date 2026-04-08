import { useState, useMemo, useEffect, useCallback } from "react";
import { usePersistentFilter } from "@/hooks/use-persistent-filter";
import { Navigation } from "@/components/Navigation";
import { useFindWork, useDismissJob } from "@/hooks/use-jobs";
import { useAuth } from "@/hooks/use-auth";
import { useProfile } from "@/hooks/use-profiles";
import { Loader2, Search, MapPin, List, Map as MapIcon, Clock, DollarSign, Building2, X, ChevronRight, AlertCircle, CheckCircle, Users, Send, ChevronLeft, Sparkles, Settings } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { MobilePopup } from "@/components/ui/mobile-popup";
import { NumberFlowComponent } from "@/components/ui/number-flow";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Slider } from "@/components/ui/slider";
import { trades, type Job, type Profile } from "@shared/schema";
import { JobsMap, MiniJobMap } from "@/components/JobsMap";
import { format, formatDistanceToNow, isToday, isTomorrow, differenceInDays } from "date-fns";
import { RequiredOnboardingModal } from "@/components/RequiredOnboardingModal";
import { useTranslation } from "react-i18next";
import { LayeredAvatars } from "@/components/LayeredAvatars";
import { apiRequest } from "@/lib/queryClient";
import { parseJobLatLng } from "@/lib/geo";
import { workerFacingJobHourlyCents } from "@shared/platformPayPolicy";

function workerDisplayHourlyCents(billableCents: number): number {
  const wf = workerFacingJobHourlyCents(billableCents);
  return wf > 0 ? wf : billableCents;
}

function formatUrgency(startDate: Date, t: (key: string, options?: any) => string): { label: string; color: string } {
  const now = new Date();
  const days = differenceInDays(startDate, now);
  
  if (days < 0 || isToday(startDate)) {
    return { label: t("today"), color: "bg-red-500" };
  }
  if (isTomorrow(startDate)) {
    return { label: t("tomorrow"), color: "bg-orange-500" };
  }
  if (days <= 3) {
    return { label: t("days", { count: days }), color: "bg-yellow-500" };
  }
  if (days <= 7) {
    return { label: t("thisWeek"), color: "bg-blue-500" };
  }
  return { label: format(startDate, "MMM d"), color: "bg-gray-500" };
}

function formatRate(cents: number): string {
  return `$${(workerDisplayHourlyCents(cents) / 100).toFixed(0)}`;
}

function calculatePayout(billableHourlyCents: number, estimatedHours?: number): string {
  const hours = estimatedHours || 8;
  const c = workerDisplayHourlyCents(billableHourlyCents);
  const payout = (c / 100) * hours;
  return `$${payout.toFixed(0)}`;
}

function formatLocation(job: Job, t: (key: string) => string): string {
  const parts = [];
  if (job.city) parts.push(job.city);
  if (job.state) parts.push(job.state);
  if (job.zipCode) parts.push(job.zipCode);
  return parts.join(", ") || job.location || t("locationTBD");
}

interface JobCardProps {
  job: Job;
  onSelect: (job: Job) => void;
  onDismiss: (job: Job) => void;
  isCompact?: boolean;
}

function JobListCard({ job, onSelect, onDismiss, isCompact }: JobCardProps) {
  const { t } = useTranslation("findWork");
  const startDate = new Date(job.startDate);
  const urgency = formatUrgency(startDate, t);
  
  return (
    <Card 
      className="hover-elevate cursor-pointer transition-all group"
      onClick={() => onSelect(job)}
      data-testid={`job-card-${job.id}`}
    >
      <CardContent className="p-4">
        <div className="flex gap-4">
          {!isCompact && (job.mapThumbnailUrl || (job.latitude && job.longitude)) && (
            <div className="w-32 flex-shrink-0 hidden md:block rounded-lg overflow-hidden bg-muted">
              {job.mapThumbnailUrl ? (
                <img src={job.mapThumbnailUrl} alt="Job location" className="w-full h-full object-cover min-h-[80px]" />
              ) : (
                <MiniJobMap
                  job={{
                    id: job.id,
                    lat: parseFloat(job.latitude!),
                    lng: parseFloat(job.longitude!),
                    title: job.title
                  }}
                />
              )}
            </div>
          )}
          
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2 mb-2">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="font-semibold text-base truncate">{job.title}</h3>
                  <Badge className={`${urgency.color} text-white text-xs`}>
                    {urgency.label}
                  </Badge>
                </div>
                <p className="text-sm text-muted-foreground flex items-center gap-1 mt-1">
                  <Building2 className="w-3 h-3" />
                  <span className="truncate">{job.trade}</span>
                </p>
              </div>
              
              <div className="text-right flex-shrink-0">
                <p className="font-bold text-lg text-green-600 dark:text-green-400">
                  {formatRate(job.hourlyRate)}/hr
                </p>
                <p className="text-xs text-muted-foreground">
                  {t("est")} {calculatePayout(job.hourlyRate, job.estimatedHours || undefined)}
                </p>
              </div>
            </div>
            
            <div className="flex items-center gap-4 text-sm text-muted-foreground mb-2">
              <span className="flex items-center gap-1">
                <MapPin className="w-3 h-3" />
                {formatLocation(job, t)}
              </span>
              <span className="flex items-center gap-1">
                <Clock className="w-3 h-3" />
                {job.estimatedHours ? `${job.estimatedHours}h` : "TBD"}
              </span>
            </div>
            
            {job.description && (
              <p className="text-sm text-muted-foreground line-clamp-2 mb-3">
                {job.description}
              </p>
            )}
            
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {job.requiredSkills?.slice(0, 2).map(skill => (
                  <Badge key={skill} variant="secondary" className="text-xs">
                    {skill}
                  </Badge>
                ))}
                {(job.requiredSkills?.length || 0) > 2 && (
                  <Badge variant="secondary" className="text-xs">
                    +{(job.requiredSkills?.length || 0) - 2}
                  </Badge>
                )}
              </div>
              
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDismiss(job);
                  }}
                  className="text-muted-foreground hover:text-foreground"
                  data-testid={`dismiss-job-${job.id}`}
                >
                  <X className="w-4 h-4 mr-1" />
                  {t("notInterested")}
                </Button>
                <Button size="sm" data-testid={`apply-job-${job.id}`}>
                  {t("apply")}
                  <ChevronRight className="w-4 h-4 ml-1" />
                </Button>
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

interface JobDetailsPanelProps {
  job: Job | null;
  onClose: () => void;
  onApply: (job: Job) => void;
  onDismiss: (job: Job) => void;
}

function JobDetailsPanel({ job, onClose, onApply, onDismiss, application }: JobDetailsPanelProps & { application?: any }) {
  const { t } = useTranslation("findWork");
  if (!job) return null;
  
  const startDate = new Date(job.startDate);
  const urgency = formatUrgency(startDate, t);
  const hasApplication = !!application;
  
  return (
    <div className="h-full overflow-auto bg-background border-l">
      <div className="p-4 border-b sticky top-0 bg-background z-10">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-lg truncate">{job.title}</h2>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="w-4 h-4" />
          </Button>
        </div>
      </div>
      
      <div className="p-4 space-y-4">
        <div className="flex items-center gap-2">
          <Badge className={`${urgency.color} text-white`}>{urgency.label}</Badge>
          <Badge variant="outline">{job.trade}</Badge>
        </div>
        
        <div className="grid grid-cols-2 gap-4">
          <div className="bg-green-50 dark:bg-green-950/30 rounded-lg p-3">
            <p className="text-xs text-muted-foreground">{t("hourlyRate")}</p>
            <p className="text-xl font-bold text-green-600 dark:text-green-400">
              {formatRate(job.hourlyRate)}/hr
            </p>
          </div>
          <div className="bg-blue-50 dark:bg-blue-950/30 rounded-lg p-3">
            <p className="text-xs text-muted-foreground">{t("estPayout")}</p>
            <p className="text-xl font-bold text-blue-600 dark:text-blue-400">
              {calculatePayout(job.hourlyRate, job.estimatedHours || undefined)}
            </p>
          </div>
        </div>
        
        <div>
          <h3 className="font-medium mb-2">{t("location")}</h3>
          <p className="text-muted-foreground flex items-center gap-1">
            <MapPin className="w-4 h-4" />
            {formatLocation(job, t)}
          </p>
          {(job.mapThumbnailUrl || (job.latitude && job.longitude)) && (
            <div className="mt-2 rounded-lg overflow-hidden">
              {job.mapThumbnailUrl ? (
                <img src={job.mapThumbnailUrl} alt="Job location" className="w-full max-h-[200px] object-cover rounded-lg" />
              ) : (
                <MiniJobMap
                  job={{
                    id: job.id,
                    lat: parseFloat(job.latitude!),
                    lng: parseFloat(job.longitude!),
                    title: job.title
                  }}
                  className="rounded-lg"
                />
              )}
            </div>
          )}
        </div>
        
        <div>
          <h3 className="font-medium mb-2">{t("schedule")}</h3>
          <div className="text-muted-foreground space-y-1">
            <p className="flex items-center gap-1">
              <Clock className="w-4 h-4" />
              {format(startDate, "EEEE, MMMM d, yyyy")}
            </p>
            {job.scheduledTime && (
              <p className="ml-5">{job.scheduledTime}</p>
            )}
            {job.estimatedHours && (
              <p className="ml-5">{t("estimatedHours", { hours: job.estimatedHours })}</p>
            )}
          </div>
        </div>
        
        {job.description && (
          <div>
            <h3 className="font-medium mb-2">{t("description")}</h3>
            <p className="text-muted-foreground whitespace-pre-wrap">{job.description}</p>
          </div>
        )}
        
        {job.requiredSkills && job.requiredSkills.length > 0 && (
          <div>
            <h3 className="font-medium mb-2">{t("requiredSkills")}</h3>
            <div className="flex flex-wrap gap-2">
              {job.requiredSkills.map(skill => (
                <Badge key={skill} variant="secondary">{skill}</Badge>
              ))}
            </div>
          </div>
        )}
        
        <div className="pt-4 border-t space-y-2">
          {hasApplication ? (
            <div className="space-y-3">
              <div className="bg-blue-50 dark:bg-blue-950/30 rounded-lg p-3 border border-blue-200 dark:border-blue-800">
                <div className="flex items-center gap-2 mb-2">
                  <CheckCircle className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                  <h4 className="font-semibold text-sm">{t("applicationSubmitted")}</h4>
                </div>
                <p className="text-xs text-muted-foreground mb-2">
                  {t("status")}: <Badge variant={application.status === "accepted" ? "default" : application.status === "rejected" ? "destructive" : "secondary"} className="ml-1">
                    {application.status === "accepted" ? t("accepted") : application.status === "rejected" ? t("rejected") : t("pending")}
                  </Badge>
                </p>
                {application.message && (
                  <div className="mt-2">
                    <p className="text-xs font-medium text-muted-foreground mb-1">{t("yourMessage")}:</p>
                    <p className="text-xs text-muted-foreground bg-white dark:bg-background p-2 rounded border whitespace-pre-wrap break-words">
                      {application.message}
                    </p>
                  </div>
                )}
                {application.proposedRate && (
                  <p className="text-xs text-muted-foreground mt-2">
                    {t("proposedRate")}: <span className="font-medium">${(application.proposedRate / 100).toFixed(0)}/hr</span>
                  </p>
                )}
              </div>
              {application.status === "pending" && (
                <p className="text-xs text-center text-muted-foreground">
                  {t("companyWillReview")}
                </p>
              )}
            </div>
          ) : (
            <>
              <Button className="w-full" size="lg" onClick={() => onApply(job)} data-testid="apply-job-button">
                {t("applyForThisJob")}
              </Button>
              <Button 
                variant="ghost" 
                className="w-full text-muted-foreground" 
                onClick={() => onDismiss(job)}
                data-testid="dismiss-job-button"
              >
                <X className="w-4 h-4 mr-2" />
                {t("notInterested")}
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default function FindWorkPage() {
  const { t } = useTranslation("findWork");
  const { user } = useAuth();
  const { data: profile } = useProfile(user?.id);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [onboardingComplete, setOnboardingComplete] = useState(false);
  
  // Check if worker has completed required onboarding
  const hasRequiredFields = useMemo(() => {
    if (!profile || profile.role !== "worker") return true; // Only check for workers
    if (onboardingComplete) return true; // Skip check if onboarding was just completed
    
    const hasLocation = !!(profile.address && profile.city && profile.state && profile.zipCode);
    const hasAvatar = !!profile.avatarUrl;
    
    return hasLocation && hasAvatar; // Payout check happens in modal
  }, [profile, onboardingComplete]);
  const [tradeFilter, setTradeFilter] = usePersistentFilter<string>("findwork_trade_filter", "");
  const [locationFilter, setLocationFilter] = usePersistentFilter<string>("findwork_location_filter", "");
  const [viewMode, setViewMode] = usePersistentFilter<"list" | "map">("findwork_view_mode", "list");
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);
  const [jobToDismiss, setJobToDismiss] = useState<Job | null>(null);
  const [dismissReason, setDismissReason] = useState("");
  const [applyJob, setApplyJob] = useState<Job | null>(null);
  const [applicationMessage, setApplicationMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [applyStage, setApplyStage] = useState<1 | 2>(1);
  const [selectedApplicants, setSelectedApplicants] = useState<Set<number | "self">>(() => new Set<number | "self">(["self"]));
  const [useSmartRate, setUseSmartRate] = useState(false);
  const [smartApplyRateEnabled] = usePersistentFilter<boolean>("smart_apply_rate_enabled", true);

  // When apply flow opens, default "use smart rate" from global setting (applies to self + all teammates)
  useEffect(() => {
    if (applyJob) {
      setUseSmartRate(smartApplyRateEnabled);
    }
  }, [applyJob?.id, smartApplyRateEnabled]);

  // AI Dispatch settings
  const [showAiDispatchDialog, setShowAiDispatchDialog] = useState(false);
  const [aiDispatchEnabled, setAiDispatchEnabled] = usePersistentFilter<boolean>("ai_dispatch_enabled", false);
  const [aiDispatchTeammatesArray, setAiDispatchTeammatesArray] = usePersistentFilter<Array<number | "self">>("ai_dispatch_teammates", ["self"]);
  const aiDispatchTeammates = useMemo(() => new Set(aiDispatchTeammatesArray), [aiDispatchTeammatesArray]);
  const setAiDispatchTeammates = useCallback((value: Set<number | "self"> | ((prev: Set<number | "self">) => Set<number | "self">)) => {
    if (typeof value === "function") {
      setAiDispatchTeammatesArray((prev) => Array.from(value(new Set(prev))));
    } else {
      setAiDispatchTeammatesArray(Array.from(value));
    }
  }, [setAiDispatchTeammatesArray]);
  const [aiDispatchMaxDistance, setAiDispatchMaxDistance] = usePersistentFilter<number>("ai_dispatch_max_distance", 10);
  
  // Fetch team members
  interface WorkerTeamMember {
    id: number;
    firstName: string;
    lastName: string;
    avatarUrl: string | null;
    hourlyRate: number | null;
    status: string;
    skillsets?: string[] | null;
    latitude?: string | null;
    longitude?: string | null;
  }
  
  const { data: workerTeam } = useQuery<{ id: number; name: string } | null>({
    queryKey: ["/api/worker-team"],
    enabled: !!profile,
  });
  
  const { data: teamMembers = [] } = useQuery<WorkerTeamMember[]>({
    queryKey: ["/api/worker-team", workerTeam?.id, "members"],
    enabled: !!workerTeam?.id,
    queryFn: async () => {
      if (!workerTeam?.id) return [];
      const res = await apiRequest("GET", `/api/worker-team/${workerTeam.id}/members`);
      return res.json();
    },
  });
  
  const activeTeamMembers = teamMembers.filter(m => m.status === "active");
  
  const { data: jobs, isLoading } = useFindWork(
    {
      trade: tradeFilter === "all" ? undefined : tradeFilter,
      location: locationFilter,
    },
    { enabled: !!profile && profile.role === "worker" }
  );
  
  // Fetch worker's applications to check which jobs they've applied to
  const { data: workerApplications } = useQuery({
    queryKey: ["/api/applications/worker", profile?.id],
    queryFn: async () => {
      if (!profile?.id) return [];
      const res = await fetch(`/api/applications/worker/${profile.id}`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!profile?.id,
  });
  
  // Create a map of jobId -> application for quick lookup
  const applicationsByJobId = useMemo(() => {
    if (!workerApplications) return new Map();
    const map = new Map();
    workerApplications.forEach((app: any) => {
      map.set(app.jobId, app);
    });
    return map;
  }, [workerApplications]);
  
  const dismissJobMutation = useDismissJob();
  
  const workerLocation = useMemo(() => {
    if (profile?.latitude && profile?.longitude) {
      return { lat: parseFloat(profile.latitude), lng: parseFloat(profile.longitude) };
    }
    return undefined;
  }, [profile]);
  
  // Helper function to calculate distance in miles
  const calculateDistanceMiles = useCallback((lat1: number, lon1: number, lat2: number, lon2: number): number => {
    const R = 3959; // Earth's radius in miles
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
  }, []);
  
  // Helper function to check if skills match
  const checkSkillMatch = useCallback((personSkills: string[] | null | undefined, job: Job): boolean => {
    if (!personSkills || personSkills.length === 0) return false;
    const jobTrade = (job.trade || '').toLowerCase();
    const jobCategory = (job.serviceCategory || '').toLowerCase();
    const jobSkills = (job.requiredSkills || []).map(s => s.toLowerCase());
    
    return personSkills.some(skill => {
      const skillLower = skill.toLowerCase();
      return jobTrade.includes(skillLower) || 
             skillLower.includes(jobTrade) ||
             jobCategory.includes(skillLower) ||
             skillLower.includes(jobCategory) ||
             jobSkills.some(js => js.includes(skillLower) || skillLower.includes(js));
    });
  }, []);
  
  // Helper function to check if job fits in schedule (no conflicts)
  const checkScheduleFit = useCallback(async (job: Job, workerId: number | "self"): Promise<boolean> => {
    try {
      // Get worker's applications to check for schedule conflicts
      const workerIdToCheck = workerId === "self" ? profile?.id : workerId;
      if (!workerIdToCheck) return false;
      
      const res = await fetch(`/api/applications/worker/${workerIdToCheck}`, { credentials: "include" });
      if (!res.ok) return false;
      const applications = await res.json();
      
      const jobStart = new Date(job.startDate);
      const jobEnd = job.endDate ? new Date(job.endDate) : new Date(jobStart.getTime() + (job.estimatedHours || 8) * 60 * 60 * 1000);
      
      // Check for conflicts with accepted/pending applications
      return !applications.some((app: any) => {
        if (app.status === "rejected" || app.status === "withdrawn") return false;
        if (!app.job) return false;
        
        const appStart = new Date(app.job.startDate);
        const appEnd = app.job.endDate ? new Date(app.job.endDate) : new Date(appStart.getTime() + (app.job.estimatedHours || 8) * 60 * 60 * 1000);
        
        // Check if time ranges overlap
        return (jobStart < appEnd && jobEnd > appStart);
      });
    } catch (error) {
      console.error("Error checking schedule fit:", error);
      return false;
    }
  }, [profile?.id]);
  
  // Helper function to check if job matches AI Dispatch criteria
  const jobMatchesAiDispatchCriteria = useCallback(async (job: Job, workerId: number | "self"): Promise<boolean> => {
    // Check skill match
    let personSkills: string[] | null | undefined;
    if (workerId === "self") {
      personSkills = profile?.skillsets as string[] | null | undefined;
    } else {
      const member = activeTeamMembers.find(m => m.id === workerId);
      personSkills = member?.skillsets as string[] | null | undefined;
    }
    
    if (!checkSkillMatch(personSkills, job)) {
      return false;
    }
    
    // Check distance
    const workerLat = workerId === "self" 
      ? (profile?.latitude ? parseFloat(profile.latitude) : null)
      : (activeTeamMembers.find(m => m.id === workerId)?.latitude ? parseFloat(activeTeamMembers.find(m => m.id === workerId)!.latitude!) : null);
    const workerLng = workerId === "self"
      ? (profile?.longitude ? parseFloat(profile.longitude) : null)
      : (activeTeamMembers.find(m => m.id === workerId)?.longitude ? parseFloat(activeTeamMembers.find(m => m.id === workerId)!.longitude!) : null);
    
    if (!workerLat || !workerLng || !job.latitude || !job.longitude) {
      return false;
    }
    
    const distance = calculateDistanceMiles(workerLat, workerLng, parseFloat(job.latitude), parseFloat(job.longitude));
    if (distance > aiDispatchMaxDistance) {
      return false;
    }
    
    // Check schedule fit
    const scheduleFits = await checkScheduleFit(job, workerId);
    if (!scheduleFits) {
      return false;
    }
    
    return true;
  }, [profile, activeTeamMembers, aiDispatchMaxDistance, checkSkillMatch, calculateDistanceMiles, checkScheduleFit]);
  
  // Auto-apply effect - watches for new jobs and applies when they match criteria
  useEffect(() => {
    if (!aiDispatchEnabled || !jobs || !profile || aiDispatchTeammates.size === 0) return;
    
    const autoApplyToMatchingJobs = async () => {
      for (const job of jobs) {
        // Skip if already applied
        if (applicationsByJobId.has(job.id)) continue;
        
        // Check each selected teammate
        for (const workerId of aiDispatchTeammates) {
          const matches = await jobMatchesAiDispatchCriteria(job, workerId);
          if (matches) {
            try {
              // Auto-apply
              const applicants = workerId === "self" 
                ? [{ id: "self" as const, name: `${profile.firstName} ${profile.lastName}` }]
                : (() => {
                    const member = activeTeamMembers.find(m => m.id === workerId);
                    return member ? [{ id: workerId, name: `${member.firstName} ${member.lastName}` }] : [];
                  })();
              
              if (applicants.length === 0) continue;
              
              const res = await fetch("/api/applications", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  jobId: job.id,
                  message: null, // Auto-apply with no message
                  applicants,
                }),
                credentials: "include",
              });
              
              if (res.ok) {
                toast({
                  title: "Auto-applied to job",
                  description: `Applied to "${job.title}" for ${applicants[0].name}`,
                });
                // Refresh applications
                queryClient.invalidateQueries({ queryKey: ["/api/applications/worker", profile.id] });
              }
            } catch (error) {
              console.error("Error auto-applying to job:", error);
            }
          }
        }
      }
    };
    
    // Debounce to avoid too many checks
    const timeoutId = setTimeout(autoApplyToMatchingJobs, 2000);
    return () => clearTimeout(timeoutId);
  }, [jobs, aiDispatchEnabled, aiDispatchTeammates, profile, applicationsByJobId, jobMatchesAiDispatchCriteria, activeTeamMembers, toast, queryClient]);
  
  const jobPins = useMemo(() => {
    if (!jobs) return [];
    return jobs
      .map((job) => {
        const coords = parseJobLatLng(job);
        if (!coords) return null;
        const application = applicationsByJobId.get(job.id);
        const urgency = formatUrgency(new Date(job.startDate), t);
        return {
          id: job.id,
          lat: coords.lat,
          lng: coords.lng,
          title: job.title,
          trade: job.trade,
          hourlyRate: job.hourlyRate,
          city: job.city || undefined,
          state: job.state || undefined,
          status: application ? (application.status === "accepted" ? "confirmed" : "pending") : "open",
          application: application || null,
          urgencyColor: urgency.color,
          payout: job.hourlyRate ? calculatePayout(job.hourlyRate, job.estimatedHours ?? undefined) : undefined,
        };
      })
      .filter((p): p is NonNullable<typeof p> => p != null);
  }, [jobs, applicationsByJobId, t]);
  
  const handleDismiss = (job: Job) => {
    setJobToDismiss(job);
  };
  
  const confirmDismiss = () => {
    if (jobToDismiss && profile) {
      dismissJobMutation.mutate({
        workerId: profile.id,
        jobId: jobToDismiss.id,
        reason: dismissReason || undefined,
      });
      setJobToDismiss(null);
      setDismissReason("");
      if (selectedJob?.id === jobToDismiss.id) {
        setSelectedJob(null);
      }
    }
  };
  
  const handleApply = (job: Job) => {
    setApplyJob(job);
    setApplyStage(1);
    setApplicationMessage("");
    setSelectedApplicants(new Set<number | "self">(["self"]));
    setUseSmartRate(false);
  };
  
  // Calculate smart rate suggestion
  const smartRateSuggestion = useMemo(() => {
    if (!applyJob?.hourlyRate) return 20;
    const wf = workerFacingJobHourlyCents(applyJob.hourlyRate);
    const jobRateDollars = wf > 0 ? wf / 100 : applyJob.hourlyRate / 100;
    const suggested = Math.min(jobRateDollars * 0.95, 24.99);
    return Math.max(suggested, 15);
  }, [applyJob?.hourlyRate]);
  
  // Calculate combined payout
  const combinedPayout = useMemo(() => {
    if (!applyJob) return 0;
    const hours = applyJob.estimatedHours || 8;
    let totalPayout = 0;
    
    selectedApplicants.forEach(id => {
      if (id === "self") {
        const rate = useSmartRate ? smartRateSuggestion : (profile?.hourlyRate || 30);
        totalPayout += rate * hours;
      } else {
        const member = activeTeamMembers.find(m => m.id === id);
        const rate = useSmartRate ? smartRateSuggestion : (member?.hourlyRate || 30);
        totalPayout += rate * hours;
      }
    });
    
    return totalPayout;
  }, [selectedApplicants, profile?.hourlyRate, activeTeamMembers, applyJob?.estimatedHours, useSmartRate, smartRateSuggestion]);
  
  // Calculate selected rate for display
  const getSelectedRate = useMemo(() => {
    if (selectedApplicants.size === 0) return null;
    
    if (useSmartRate) {
      return smartRateSuggestion;
    }
    
    let totalRate = 0;
    let count = 0;
    
    selectedApplicants.forEach(id => {
      if (id === "self") {
        totalRate += profile?.hourlyRate || 30;
        count++;
      } else {
        const member = activeTeamMembers.find(m => m.id === id);
        totalRate += member?.hourlyRate || 30;
        count++;
      }
    });
    
    return count > 0 ? totalRate / count : null;
  }, [selectedApplicants, useSmartRate, smartRateSuggestion, profile?.hourlyRate, activeTeamMembers]);
  
  const getSelectedNames = () => {
    const names: string[] = [];
    if (selectedApplicants.has("self")) {
      names.push("Myself");
    }
    selectedApplicants.forEach(id => {
      if (id !== "self") {
        const member = activeTeamMembers.find(m => m.id === id);
        if (member) {
          names.push(`${member.firstName} ${member.lastName}`);
        }
      }
    });
    return names;
  };
  
  const workersNeeded = applyJob?.maxWorkersNeeded ?? 1;
  
  // Fetch company profile for stage 2
  const { data: companyProfile } = useQuery<Profile | null>({
    queryKey: ["/api/profiles", applyJob?.companyId],
    queryFn: async () => {
      if (!applyJob?.companyId) return null;
      const res = await fetch(`/api/profiles/${applyJob.companyId}`);
      if (!res.ok) return null;
      return res.json();
    },
    enabled: !!applyJob?.companyId && applyStage === 2,
  });
  
  const submitApplication = async () => {
    if (!applyJob) return;
    
    setIsSubmitting(true);
    try {
      const applicants = Array.from(selectedApplicants).map(id => {
        if (id === "self") {
          return { id: "self" as const, name: `${profile?.firstName} ${profile?.lastName}` };
        }
        const member = activeTeamMembers.find(m => m.id === id);
        return { id, name: member ? `${member.firstName} ${member.lastName}` : "Team Member" };
      });
      
      const submitRate = getSelectedRate;
      const res = await fetch("/api/applications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobId: applyJob.id,
          message: applicationMessage || null,
          selectedApplicants: applicants,
          useSmartRate: useSmartRate,
          ...(submitRate != null && submitRate > 0 ? { proposedRate: Math.round(submitRate * 100) } : {}),
        }),
        credentials: "include",
      });
      
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || "Failed to apply");
      }
      
      toast({
        title: t("applicationSubmitted"),
        description: selectedApplicants.size > 1 
          ? `${selectedApplicants.size} applications submitted successfully`
          : t("applicationSentToCompany", { jobTitle: applyJob.title }),
      });
      
      queryClient.invalidateQueries({ queryKey: ["/api/jobs/find-work"] });
      queryClient.invalidateQueries({ queryKey: ["/api/applications/worker", profile?.id] });
      
      setApplyJob(null);
      setApplicationMessage("");
      setApplyStage(1);
      setSelectedApplicants(new Set<number | "self">(["self"]));
      setUseSmartRate(false);
    } catch (error: any) {
      toast({
        title: t("applicationFailed"),
        description: error.message || t("failedToSubmitApplication"),
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };
  
  const handleJobSelectFromMap = (jobId: number) => {
    const job = jobs?.find(j => j.id === jobId);
    if (job) {
      setSelectedJob(job);
    }
  };
  
  // Set up WebSocket listener for real-time application updates
  useEffect(() => {
    if (!user || !profile) return;
    
    // Connect to WebSocket for real-time updates
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}`;
    const ws = new WebSocket(`${wsUrl}/ws`);
    
    ws.onopen = () => {
      console.log('WebSocket connected for job applications');
      // Subscribe to updates for this worker
      ws.send(JSON.stringify({ type: 'subscribe', userId: user.id }));
    };
    
    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        
        // Handle application updates
        if (data.type === 'application_update' || data.type === 'new_application') {
          // Invalidate queries to refetch applications
          queryClient.invalidateQueries({ queryKey: ["/api/applications/worker", profile.id] });
          queryClient.invalidateQueries({ queryKey: ["/api/jobs/find-work"] });
          
          // If the updated job is currently selected, update it
          if (data.jobId && selectedJob?.id === data.jobId) {
            queryClient.invalidateQueries({ queryKey: ["/api/applications/worker", profile.id] });
          }
        }
      } catch (error) {
        console.error('Error parsing WebSocket message:', error);
      }
    };
    
    ws.onerror = (error) => {
      console.error('WebSocket error:', error);
    };
    
    ws.onclose = () => {
      console.log('WebSocket disconnected');
    };
    
    return () => {
      ws.close();
    };
  }, [user, profile, queryClient, selectedJob]);
  
  if (!user) {
    return (
      <div className="min-h-screen bg-background">
        <Navigation />
        <div className="flex items-center justify-center py-20">
          <div className="text-center">
            <AlertCircle className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
            <h2 className="text-xl font-semibold mb-2">{t("signInToFindWork")}</h2>
            <p className="text-muted-foreground">{t("pleaseSignInToViewJobs")}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Navigation />
      
      <div className="bg-secondary/30 py-6 border-b border-border">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between mb-4">
            <h1 className="text-2xl font-bold font-display">{t("title")}</h1>
            <div className="flex items-center gap-1 bg-muted rounded-lg p-1">
              <Button
                variant={viewMode === "list" ? "default" : "ghost"}
                size="sm"
                onClick={() => setViewMode("list")}
                data-testid="view-list-button"
              >
                <List className="w-4 h-4 mr-1" />
                {t("list")}
              </Button>
              <Button
                variant={viewMode === "map" ? "default" : "ghost"}
                size="sm"
                onClick={() => setViewMode("map")}
                data-testid="view-map-button"
              >
                <MapIcon className="w-4 h-4 mr-1" />
                {t("map")}
              </Button>
            </div>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input 
                placeholder={t("searchLocation")} 
                className="pl-10 h-10 bg-background"
                value={locationFilter}
                onChange={(e) => setLocationFilter(e.target.value)}
                data-testid="location-filter"
              />
            </div>
            
            <Select value={tradeFilter} onValueChange={setTradeFilter}>
              <SelectTrigger className="h-10 bg-background" data-testid="trade-filter">
                <SelectValue placeholder={t("allTrades")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("allTrades")}</SelectItem>
                {trades.map(trade => (
                  <SelectItem key={trade} value={trade}>{trade}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            
            <div className="text-sm text-muted-foreground flex items-center">
              {t("jobsAvailable", { count: jobs?.length || 0 })}
            </div>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-hidden">
        {isLoading ? (
          <div className="flex justify-center py-20">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
          </div>
        ) : jobs?.length === 0 ? (
          <div className="text-center py-20">
            <h3 className="text-xl font-bold mb-2">{t("noJobsFound")}</h3>
            <p className="text-muted-foreground">{t("tryAdjustingFilters")}</p>
          </div>
        ) : viewMode === "list" ? (
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
            <div className="space-y-4">
              {jobs?.map(job => (
                <JobListCard
                  key={job.id}
                  job={job}
                  onSelect={setSelectedJob}
                  onDismiss={handleDismiss}
                />
              ))}
            </div>
          </div>
        ) : (
          <div className="h-full flex" style={{ minHeight: "calc(100vh - 200px)" }}>
            {/* AI Dispatch Button - Left of Map */}
            <div className="w-20 flex-shrink-0 border-r bg-background/95 backdrop-blur-sm flex flex-col items-center pt-4 gap-2 shadow-sm">
              <Button
                variant={aiDispatchEnabled ? "default" : "outline"}
                size="sm"
                className="w-14 h-14 flex flex-col items-center justify-center gap-1 hover:scale-105 transition-transform"
                onClick={() => setShowAiDispatchDialog(true)}
                title="AI Dispatch Settings"
              >
                <Sparkles className={`w-5 h-5 ${aiDispatchEnabled ? "text-white" : "text-primary"}`} />
                <span className="text-[10px] font-semibold leading-tight">AI</span>
                <span className="text-[9px] font-medium leading-tight opacity-80">Dispatch</span>
              </Button>
              {aiDispatchEnabled && (
                <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" title="AI Dispatch is active" />
              )}
            </div>
            
            <div className="flex-1 h-full flex flex-col min-h-0 px-[14px]">
              <JobsMap
                jobs={jobPins}
                workerLocation={workerLocation}
                selectedJobId={selectedJob?.id}
                onJobSelect={handleJobSelectFromMap}
                showPricePills
                height="100%"
                className="h-full min-h-0"
              />
            </div>
            {selectedJob && (
              <div className="w-96 flex-shrink-0 hidden lg:block">
                <JobDetailsPanel
                  job={selectedJob}
                  onClose={() => setSelectedJob(null)}
                  onApply={handleApply}
                  onDismiss={handleDismiss}
                  application={applicationsByJobId.get(selectedJob.id)}
                />
              </div>
            )}
          </div>
        )}
      </div>
      
      <MobilePopup
        open={!!selectedJob && viewMode === "list"}
        onOpenChange={(open) => !open && setSelectedJob(null)}
        title={selectedJob?.title || t("jobDetails")}
        description={selectedJob ? `${selectedJob.trade} - ${formatLocation(selectedJob, t)}` : ""}
        maxWidth="lg"
      >
        {selectedJob && (
          <JobDetailsPanel
            job={selectedJob}
            onClose={() => setSelectedJob(null)}
            onApply={handleApply}
            onDismiss={handleDismiss}
            application={applicationsByJobId.get(selectedJob.id)}
          />
        )}
      </MobilePopup>
      
      <MobilePopup
        open={!!jobToDismiss}
        onOpenChange={(open) => !open && setJobToDismiss(null)}
        title={t("notInterested")}
        description={t("jobWontShowInFeed")}
        primaryAction={{
          label: dismissJobMutation.isPending ? t("dismissing") : t("dismissJob"),
          onClick: confirmDismiss,
          disabled: dismissJobMutation.isPending,
          testId: "confirm-dismiss"
        }}
        secondaryAction={{
          label: tCommon("cancel"),
          onClick: () => setJobToDismiss(null),
          testId: "cancel-dismiss"
        }}
      >
        <Textarea
          placeholder={t("whyNotInterested")}
          value={dismissReason}
          onChange={(e) => setDismissReason(e.target.value)}
          data-testid="dismiss-reason"
        />
      </MobilePopup>
      
      <MobilePopup
        open={!!applyJob}
        onOpenChange={(open) => {
          if (!open) {
            setApplyJob(null);
            setApplyStage(1);
            setApplicationMessage("");
            setSelectedApplicants(new Set<number | "self">(["self"]));
            setUseSmartRate(false);
          }
        }}
        title={applyStage === 1 ? (t("applyForJob", { jobTitle: applyJob?.title || t("job") }) || "Apply for Job") : (t("sendMessage") || "Send Message")}
        description={applyStage === 1 ? "" : t("sendMessageAboutFit")}
        primaryAction={applyStage === 1 ? undefined : {
          label: isSubmitting ? t("submitting") : t("submitApplication"),
          onClick: submitApplication,
          disabled: isSubmitting || selectedApplicants.size === 0,
          testId: "submit-application"
        }}
        secondaryAction={applyStage === 1 ? {
          label: tCommon("cancel"),
          onClick: () => {
            setApplyJob(null);
            setApplyStage(1);
          },
          testId: "cancel-application"
        } : {
          label: tCommon("back"),
          onClick: () => setApplyStage(1),
          testId: "back-to-stage-1"
        }}
      >
        {applyStage === 1 ? (
          <div className="space-y-4">
            {/* Header with Estimated Payout */}
            <div className="text-center pb-4 border-b">
              <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">{t("estimatedPayout") || "Estimated Payout"}</p>
              <p className="text-3xl font-bold text-green-600 dark:text-green-400">
                $<NumberFlowComponent value={combinedPayout} trend={false} />
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                {selectedApplicants.size} {selectedApplicants.size === 1 ? "worker" : "workers"} × {applyJob?.estimatedHours || 8} hours
              </p>
            </div>

            {/* Teammates List */}
            {activeTeamMembers.length > 0 && (
              <div className="space-y-2">
                <h4 className="font-semibold text-sm flex items-center gap-2">
                  <Users className="w-4 h-4" />
                  {t("selectWorkers") || "Select Workers"} ({selectedApplicants.size}/{workersNeeded})
                </h4>
                <div className="space-y-2">
                  {/* Self option */}
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedApplicants(prev => {
                        const next = new Set(prev);
                        if (next.has("self")) {
                          if (next.size > 1) next.delete("self");
                        } else if (next.size < workersNeeded) {
                          next.add("self");
                        } else if (workersNeeded === 1) {
                          next.clear();
                          next.add("self");
                        }
                        return next;
                      });
                    }}
                    className={`w-full flex items-center gap-3 p-3 rounded-xl border-2 transition-all ${
                      selectedApplicants.has("self") 
                        ? "border-primary bg-primary/5" 
                        : "border-border hover:border-primary/50"
                    }`}
                  >
                    <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors ${
                      selectedApplicants.has("self") ? "border-primary bg-primary" : "border-muted-foreground"
                    }`}>
                      {selectedApplicants.has("self") && <Check className="w-3 h-3 text-primary-foreground" />}
                    </div>
                    <Avatar className="w-10 h-10 border-2 border-primary/20">
                      <AvatarImage src={profile?.avatarUrl || undefined} />
                      <AvatarFallback className="text-xs">{profile?.firstName?.[0]}{profile?.lastName?.[0]}</AvatarFallback>
                    </Avatar>
                    <div className="flex-1 text-left">
                      <p className="font-medium">{t("myself") || "Myself"}</p>
                      <p className="text-xs text-muted-foreground">${profile?.hourlyRate || 30}/hr</p>
                    </div>
                  </button>
                  
                  {/* Team members */}
                  {activeTeamMembers.map((member) => (
                    <button
                      key={member.id}
                      type="button"
                      onClick={() => {
                        setSelectedApplicants(prev => {
                          const next = new Set(prev);
                          if (next.has(member.id)) {
                            if (next.size > 1) next.delete(member.id);
                          } else if (next.size < workersNeeded) {
                            next.add(member.id);
                          } else if (workersNeeded === 1) {
                            next.clear();
                            next.add(member.id);
                          }
                          return next;
                        });
                      }}
                      className={`w-full flex items-center gap-3 p-3 rounded-xl border-2 transition-all ${
                        selectedApplicants.has(member.id) 
                          ? "border-primary bg-primary/5" 
                          : "border-border hover:border-primary/50"
                      }`}
                    >
                      <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors ${
                        selectedApplicants.has(member.id) ? "border-primary bg-primary" : "border-muted-foreground"
                      }`}>
                        {selectedApplicants.has(member.id) && <Check className="w-3 h-3 text-primary-foreground" />}
                      </div>
                      <Avatar className="w-10 h-10 border-2 border-secondary">
                        <AvatarImage src={member.avatarUrl || undefined} />
                        <AvatarFallback className="text-xs">{member.firstName?.[0]}{member.lastName?.[0]}</AvatarFallback>
                      </Avatar>
                      <div className="flex-1 text-left">
                        <p className="font-medium">{member.firstName} {member.lastName}</p>
                        <p className="text-xs text-muted-foreground">${member.hourlyRate || 30}/hr</p>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Footer with Smart Rate and Send Application buttons */}
            <div className="pt-4 border-t space-y-2">
              <div className="flex flex-row gap-2">
                {/* Left Button: Send Application (light color) */}
                <Button
                  variant="outline"
                  className="h-12 text-base font-medium rounded-xl flex-1"
                  onClick={() => setApplyStage(2)}
                  disabled={selectedApplicants.size === 0}
                  data-testid="apply-sheet-send-application"
                >
                  <div className="flex flex-col items-center justify-center flex-1">
                    <span className="text-sm">{t("sendApplication") || "Send Application"}</span>
                    {getSelectedRate && (
                      <span className="text-xs text-muted-foreground font-normal mt-0.5">
                        ${getSelectedRate.toFixed(2)}/hr
                      </span>
                    )}
                  </div>
                </Button>
                
                {/* Right Button: Smart Rate Apply */}
                <Button
                  className={`h-12 text-base font-semibold rounded-xl shadow-lg ${
                    useSmartRate 
                      ? 'bg-green-600 hover:bg-green-700 dark:bg-green-500 dark:hover:bg-green-600' 
                      : 'bg-primary hover:bg-primary/90'
                  }`}
                  onClick={() => {
                    setUseSmartRate(true);
                    setApplyStage(2);
                  }}
                  disabled={selectedApplicants.size === 0}
                  data-testid="apply-sheet-smart-rate"
                  style={{ minWidth: '160px' }}
                >
                  <div className="flex flex-col items-center justify-center">
                    <span className="text-sm">{t("smartRate") || "Smart Rate"}</span>
                    <span className="text-xs font-normal opacity-90">
                      {t("apply") || "Apply"} ${smartRateSuggestion.toFixed(2)}/hr
                    </span>
                  </div>
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Company Logo/Name - Centered */}
            <div className="flex flex-col items-center justify-center gap-3 pb-6 border-b">
              {companyProfile?.companyLogo ? (
                <Avatar className="w-16 h-16">
                  <AvatarImage src={companyProfile.companyLogo} />
                  <AvatarFallback className="text-xl">
                    {companyProfile.companyName?.[0] || "C"}
                  </AvatarFallback>
                </Avatar>
              ) : (
                <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center">
                  <span className="text-2xl font-semibold text-muted-foreground">
                    {companyProfile?.companyName?.[0] || "C"}
                  </span>
                </div>
              )}
              <div className="text-center">
                <p className="font-semibold text-xl">
                  {companyProfile?.companyName || t("company") || "Company"}
                </p>
                {applyJob?.locationName && (
                  <p className="text-sm text-muted-foreground mt-1">
                    {t("locationRepresentative") || "Location Representative"}: {applyJob.locationName}
                  </p>
                )}
              </div>
            </div>

            {/* Optional Note */}
            <div>
              <Label htmlFor="apply-message" className="text-sm font-medium">{t("messageToCompanyOptional") || "Message to Company (Optional)"}</Label>
              <Textarea
                id="apply-message"
                placeholder={t("introduceYourselfOrMentionExperience") || "Introduce yourself or mention relevant experience..."}
                value={applicationMessage}
                onChange={(e) => setApplicationMessage(e.target.value)}
                className="mt-2 resize-none"
                rows={4}
                data-testid="apply-message-input"
              />
              <p className="text-xs text-muted-foreground mt-1">
                {t("contactInfoWillBeRemoved") || "Contact information will be automatically removed"}
              </p>
            </div>
          </div>
        )}
      </MobilePopup>
      
      {/* AI Dispatch Settings Dialog */}
      <Dialog open={showAiDispatchDialog} onOpenChange={setShowAiDispatchDialog}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="w-5 h-5" />
              AI Dispatch Settings
            </DialogTitle>
            <DialogDescription>
              Automatically apply to jobs that match your criteria. Applications will be sent when jobs meet all requirements.
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-6 py-4">
            {/* Enable/Disable Toggle */}
            <div className="flex items-center justify-between p-4 border rounded-lg">
              <div className="flex-1">
                <Label htmlFor="ai-dispatch-enabled" className="text-base font-semibold cursor-pointer">
                  Enable AI Dispatch
                </Label>
                <p className="text-sm text-muted-foreground mt-1">
                  Automatically apply to matching jobs as they become available
                </p>
              </div>
              <Switch
                id="ai-dispatch-enabled"
                checked={aiDispatchEnabled}
                onCheckedChange={setAiDispatchEnabled}
              />
            </div>
            
            {aiDispatchEnabled && (
              <>
                {/* Teammate Selection */}
                <div className="space-y-3 p-4 border rounded-lg">
                  <Label className="text-base font-semibold">Apply For</Label>
                  <p className="text-sm text-muted-foreground">
                    Select which teammates should automatically apply to matching jobs
                  </p>
                  <div className="space-y-2 mt-3">
                    {/* Self option */}
                    <div className="flex items-center gap-3 p-2 rounded hover:bg-muted/50">
                      <Checkbox
                        id="ai-dispatch-self"
                        checked={aiDispatchTeammates.has("self")}
                        onCheckedChange={(checked) => {
                          const newSet = new Set(aiDispatchTeammates);
                          if (checked) {
                            newSet.add("self");
                          } else {
                            newSet.delete("self");
                          }
                          setAiDispatchTeammates(newSet);
                        }}
                      />
                      <Label htmlFor="ai-dispatch-self" className="flex items-center gap-2 flex-1 cursor-pointer">
                        <Avatar className="w-6 h-6">
                          <AvatarImage src={profile?.avatarUrl || undefined} />
                          <AvatarFallback className="text-xs">
                            {profile?.firstName?.[0]}{profile?.lastName?.[0]}
                          </AvatarFallback>
                        </Avatar>
                        <span className="font-medium">Myself</span>
                        {profile?.firstName && profile?.lastName && (
                          <span className="text-sm text-muted-foreground">
                            ({profile.firstName} {profile.lastName})
                          </span>
                        )}
                      </Label>
                    </div>
                    
                    {/* Team members */}
                    {activeTeamMembers.map((member) => (
                      <div key={member.id} className="flex items-center gap-3 p-2 rounded hover:bg-muted/50">
                        <Checkbox
                          id={`ai-dispatch-member-${member.id}`}
                          checked={aiDispatchTeammates.has(member.id)}
                          onCheckedChange={(checked) => {
                            const newSet = new Set(aiDispatchTeammates);
                            if (checked) {
                              newSet.add(member.id);
                            } else {
                              newSet.delete(member.id);
                            }
                            setAiDispatchTeammates(newSet);
                          }}
                        />
                        <Label htmlFor={`ai-dispatch-member-${member.id}`} className="flex items-center gap-2 flex-1 cursor-pointer">
                          <Avatar className="w-6 h-6">
                            <AvatarImage src={member.avatarUrl || undefined} />
                            <AvatarFallback className="text-xs">
                              {member.firstName[0]}{member.lastName[0]}
                            </AvatarFallback>
                          </Avatar>
                          <span className="font-medium">
                            {member.firstName} {member.lastName}
                          </span>
                        </Label>
                      </div>
                    ))}
                    
                    {activeTeamMembers.length === 0 && (
                      <p className="text-sm text-muted-foreground italic">
                        No active team members. Add team members in your dashboard to enable auto-applying for them.
                      </p>
                    )}
                  </div>
                </div>
                
                {/* Distance Threshold */}
                <div className="space-y-3 p-4 border rounded-lg">
                  <div className="flex items-center justify-between">
                    <div>
                      <Label className="text-base font-semibold">Maximum Distance</Label>
                      <p className="text-sm text-muted-foreground mt-1">
                        Only apply to jobs within {aiDispatchMaxDistance} miles of worker location
                      </p>
                    </div>
                    <div className="text-2xl font-bold text-primary">
                      {aiDispatchMaxDistance} mi
                    </div>
                  </div>
                  <Slider
                    value={[aiDispatchMaxDistance]}
                    onValueChange={(value) => setAiDispatchMaxDistance(value[0])}
                    min={1}
                    max={50}
                    step={1}
                    className="mt-4"
                  />
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>1 mi</span>
                    <span>25 mi</span>
                    <span>50 mi</span>
                  </div>
                </div>
                
                {/* Requirements Info */}
                <div className="p-4 bg-muted/50 rounded-lg space-y-2">
                  <Label className="text-base font-semibold">Auto-Apply Requirements</Label>
                  <div className="space-y-1.5 text-sm">
                    <div className="flex items-start gap-2">
                      <CheckCircle className="w-4 h-4 text-green-500 mt-0.5 flex-shrink-0" />
                      <span><strong>Skill-set Match:</strong> Worker must have matching skills for the job trade/category</span>
                    </div>
                    <div className="flex items-start gap-2">
                      <CheckCircle className="w-4 h-4 text-green-500 mt-0.5 flex-shrink-0" />
                      <span><strong>Distance:</strong> Job must be within {aiDispatchMaxDistance} miles of worker's current or address location</span>
                    </div>
                    <div className="flex items-start gap-2">
                      <CheckCircle className="w-4 h-4 text-green-500 mt-0.5 flex-shrink-0" />
                      <span><strong>Schedule Fit:</strong> Job must fit within worker's current schedule (no conflicts)</span>
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>
      
      {/* Required Onboarding Modal - Blocks app usage until complete */}
      {profile && profile.role === "worker" && !hasRequiredFields && (
        <RequiredOnboardingModal
          profile={profile}
          onComplete={() => {
            setOnboardingComplete(true);
            queryClient.invalidateQueries({ queryKey: ["/api/profiles", user?.id] });
            queryClient.invalidateQueries({ queryKey: ["/api/payout-accounts"] });
          }}
        />
      )}
    </div>
  );
}
