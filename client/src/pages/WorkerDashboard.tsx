import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { usePersistentFilter } from "@/hooks/use-persistent-filter";
import { useAuth } from "@/hooks/use-auth";
import { useProfile } from "@/hooks/use-profiles";
import { useAdminCheck } from "@/hooks/use-admin";
import { useFindWorkInfinite, useDismissJob, useUndismissJob, FIND_WORK_TIMEOUT_MESSAGE } from "@/hooks/use-jobs";
import { useLocation, useSearch, useRoute } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { showClientDevTools } from "@/lib/is-local-dev-host";
import { Button } from "@/components/ui/button";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Skeleton, SkeletonCard } from "@/components/ui/skeleton";
import { 
  Sheet, 
  SheetContent, 
  SheetHeader, 
  SheetTitle, 
  SheetDescription 
} from "@/components/ui/sheet";
import { Drawer, DrawerContent, DrawerTitle, DrawerDescription } from "@/components/ui/drawer";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AnimatedNavigationTabs } from "@/components/ui/animated-navigation-tabs";
import { useToast } from "@/hooks/use-toast";
import { format, parseISO, startOfMonth, endOfMonth, eachDayOfInterval, isSameDay, isSameMonth, addMonths, subMonths, addHours, isToday, isThisWeek, isThisMonth, formatDistanceToNow } from "date-fns";
import type { Job, Application, Profile, WorkerTeamMember, Timesheet } from "@shared/schema";

// Extended application type with job and team member info
interface ApplicationWithDetails extends Application {
  job?: Job;
  teamMember?: WorkerTeamMember | null;
  isAiDispatched?: boolean;
}
import {
  Search, Briefcase, Calendar as CalendarIcon, Menu, MapPin, Clock, DollarSign,
  Send, ChevronRight, ChevronLeft, ChevronDown, ChevronUp, User, Settings, Bell, CreditCard, Users,
  FileText, Shield, LogOut, X, Building2, Check, XCircle, CheckCircle, Loader2, ExternalLink, Globe,
  Wrench, Navigation, ArrowLeft, Download, MessageSquare, Play, Square, Filter, UserCircle, Star, Sparkles,
  LayoutGrid, List, Table2, Settings as Gear, AlertTriangle
} from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { ResponsiveDialog } from "@/components/ui/responsive-dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { MobilePopup, cleanupOverlays } from "@/components/ui/mobile-popup";
import { NumberFlowComponent } from "@/components/ui/number-flow";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Slider } from "@/components/ui/slider";
import { RateSlider } from "@/components/RateSlider";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { JobsMap, MiniJobMap } from "@/components/JobsMap";
import { WorkerCalendar, type WorkerCalendarRef } from "@/components/WorkerCalendar";
import { useLocationTracking } from "@/hooks/use-location-tracking";
import { useOfflineWorker } from "@/hooks/use-offline-worker";
import { EnhancedJobDialog, JobContent } from "@/components/EnhancedJobDialog";
import { RequiredOnboardingModal } from "@/components/RequiredOnboardingModal";
import { OnboardingChecklist } from "@/components/OnboardingChecklist";
import { GooglePlacesAutocomplete } from "@/components/GooglePlacesAutocomplete";
import { useIsMobile } from "@/hooks/use-mobile";
import { useScrollHeader } from "@/hooks/use-scroll-header";
import { LanguageSelector } from "@/components/LanguageSelector";
import { useTranslation } from "react-i18next";
import { SUPPORTED_LANGUAGES, changeLanguage, LanguageCode } from "@/lib/i18n";
import { INDUSTRY_CATEGORIES, getAllRoles } from "@shared/industries";
import { useTimesheetApprovalInvoice } from "@/contexts/TimesheetApprovalInvoiceContext";
import { tryOpenTimesheetApprovalInvoiceFromNotification } from "@/lib/worker-timesheet-notification";
import { NotificationBanner } from "@/components/NotificationBanner";
import { JobStartingBanner } from "@/components/JobStartingBanner";
import { W9RequirementBanner } from "@/components/W9RequirementBanner";
import { NotificationSettingsContent } from "@/pages/worker/NotificationSettings";
import { PayoutSettingsContent } from "@/pages/worker/PayoutSettings";
import { PaymentHistoryContent } from "@/pages/worker/PaymentHistory";
import { TermsContent } from "@/pages/worker/TermsOfService";
import { PrivacyContent } from "@/pages/worker/PrivacyPolicy";
import { LegalDocumentsContent } from "@/pages/worker/LegalDocuments";
import { ProfileSettingsContent } from "@/pages/worker/ProfileSettings";
import { BusinessOperatorContent } from "@/pages/worker/BusinessOperator";
import { ReviewsContent } from "@/pages/worker/ReviewsPage";
import { AccountDocumentsContent } from "@/pages/worker/AccountDocumentsPage";
import { cn, normalizeAvatarUrl, getTimeSlots, getValidEndTimeSlots, getEarliestEndTime, formatTime12h, stripPhonesAndEmails } from "@/lib/utils";
import { isWorkerOnboardingComplete, getWorkerOnboardingMissing } from "@/lib/worker-onboarding";
import { jobRequiresLiteOrElite as jobRequiresLiteOrEliteLib, checkSkillMatch as checkSkillMatchLib } from "@/lib/ai-dispatch-criteria";
import { parseJobLatLng, isPlausibleLatLng } from "@/lib/geo";
import { buildJobGeocodeQuery, stripLeadingStreetNumber } from "@shared/jobGeocode";
import { getDisplayJobTitle } from "@/lib/job-display";

type DashboardTab = "find" | "jobs" | "calendar" | "menu" | "today" | "chats";

// Extended job type with distance calculation
interface JobWithDistance extends Job {
  distance?: number;
  company?: Profile;
}

// Calculate distance between two coordinates (Haversine formula)
function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 3959; // Earth's radius in miles
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

// Single source of truth for skills: @shared/industries (INDUSTRY_CATEGORIES / getAllRoles).
// Worker/teammate skillsets, Find Work filter, AI Dispatch matching, and "Only Team Matches" all use these role ids.
const allSkillCategories = getAllRoles();

type QuickSettingsView = "main" | "location" | "rate" | "skillset";

// Urgency formatting for jobs
function formatUrgency(startDate: Date): { label: string; color: string } {
  const now = new Date();
  const days = Math.floor((startDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  
  if (days < 0 || days === 0) {
    return { label: "Today", color: "bg-red-500" };
  }
  if (days === 1) {
    return { label: "Tomorrow", color: "bg-orange-500" };
  }
  if (days <= 3) {
    return { label: `${days} days`, color: "bg-yellow-500" };
  }
  if (days <= 7) {
    return { label: "This week", color: "bg-blue-500" };
  }
  return { label: format(startDate, "MMM d"), color: "bg-gray-500" };
}

function formatRate(cents: number): string {
  return `$${(cents / 100).toFixed(0)}`;
}

function calculatePayout(hourlyRateDollars: number, estimatedHours?: number): string {
  const hours = estimatedHours || 8;
  const payout = hourlyRateDollars * hours;
  return `$${Math.round(payout).toLocaleString()}`;
}

/** Converts stored rate (cents or dollars) to dollars for display. Values > 100 are cents. */
function rateToDollars(v: number | null | undefined): number {
  if (v == null) return 30;
  return v > 100 ? v / 100 : v;
}

/** Returns worker hourly rate in dollars. Profile/job may be in cents (>100) or dollars. */
function getWorkerHourlyRate(profileRate: number | null | undefined, jobRate: number): number {
  if (profileRate != null && profileRate > 0) {
    return profileRate > 100 ? profileRate / 100 : profileRate;
  }
  return jobRate > 100 ? jobRate / 100 : jobRate;
}

/** Total est. payout for all slots — same formula as mobile find list + map $ pills. */
function formatFindWorkTotalEstPayout(
  profileRate: number | null | undefined,
  job: Pick<Job, "hourlyRate" | "estimatedHours" | "maxWorkersNeeded">
): string {
  const slots = job.maxWorkersNeeded ?? 1;
  const rate = getWorkerHourlyRate(profileRate, job.hourlyRate ?? 0);
  const hours = job.estimatedHours || 8;
  return `$${Math.round(slots * rate * hours).toLocaleString()}`;
}

function formatJobLocation(job: Job): string {
  const parts = [];
  if (job.city) parts.push(job.city);
  if (job.state) parts.push(job.state);
  if (job.zipCode) parts.push(job.zipCode);
  return parts.join(", ") || job.location || "Location TBD";
}

// Estimate drive time based on distance (rough estimate: avg 30mph in city traffic)
function estimateDriveTime(distanceMiles: number): string {
  if (distanceMiles < 1) return "< 5 min";
  const minutes = Math.round(distanceMiles * 2); // ~30mph avg
  if (minutes < 60) return `~${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remainingMins = minutes % 60;
  if (remainingMins === 0) return `~${hours} hr`;
  return `~${hours} hr ${remainingMins} min`;
}

// Format schedule days array to readable format (e.g., ["monday", "tuesday", "wednesday"] -> "Mon-Wed")
function formatScheduleDays(days: string[] | null | undefined): string {
  if (!days || days.length === 0) return "";
  
  const dayOrder = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  const dayAbbrev: Record<string, string> = {
    sunday: "Sun", monday: "Mon", tuesday: "Tue", wednesday: "Wed",
    thursday: "Thu", friday: "Fri", saturday: "Sat"
  };
  
  // Normalize to lowercase for sort/lookup; sort by weekday order
  const sorted = [...days]
    .map((d) => (d || "").trim().toLowerCase())
    .filter(Boolean)
    .sort((a, b) => dayOrder.indexOf(a) - dayOrder.indexOf(b));
  
  if (sorted.length === 0) return "";
  if (sorted.length === 1) {
    return dayAbbrev[sorted[0]] || sorted[0];
  }
  
  // Check if all days are consecutive
  let isConsecutive = true;
  for (let i = 1; i < sorted.length; i++) {
    const prevIdx = dayOrder.indexOf(sorted[i - 1]);
    const currIdx = dayOrder.indexOf(sorted[i]);
    if (currIdx !== prevIdx + 1) {
      isConsecutive = false;
      break;
    }
  }
  
  if (isConsecutive && sorted.length > 2) {
    return `${dayAbbrev[sorted[0]]}-${dayAbbrev[sorted[sorted.length - 1]]}`;
  }
  
  // Return comma-separated list for non-consecutive days
  return sorted.map(d => dayAbbrev[d] || d).join(", ");
}

function countScheduledDaysInRange(start: Date, end: Date, scheduleDays: string[]): number {
  const wanted = new Set(scheduleDays.map((d) => d.toLowerCase().trim()).filter(Boolean));
  if (wanted.size === 0) return 0;
  const dayKey = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  const cur = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const finish = new Date(end.getFullYear(), end.getMonth(), end.getDate());
  let count = 0;
  while (cur <= finish) {
    if (wanted.has(dayKey[cur.getDay()])) count++;
    cur.setDate(cur.getDate() + 1);
  }
  return count;
}

function getPendingTimelineDetails(job: Job): { title: string; subtitle: string | null; scheduledDaysCount: number | null } {
  if (!job.startDate) return { title: "On Demand", subtitle: null, scheduledDaysCount: null };

  const startDate = parseISO(String(job.startDate));
  const recurringDays = job.scheduleDays || (job as { recurringDays?: string[] }).recurringDays;
  const startTimeStr = startTimeOnly(formatTimeString(job.scheduledTime));
  const endTimeStr = endTimeOnly(formatTimeString(job.endTime));
  const timeRange =
    startTimeStr && endTimeStr && startTimeStr !== endTimeStr
      ? `${startTimeStr} - ${endTimeStr}`
      : (startTimeStr || endTimeStr || "");

  if (job.jobType === "recurring" && recurringDays && recurringDays.length > 0) {
    const daysStr = formatScheduleDays(recurringDays);
    const title = timeRange ? `${daysStr} · ${timeRange}` : daysStr;
    const startLabel = format(startDate, "MMM d, yyyy");

    let periodEnd: Date | null = null;
    if (job.endDate) {
      const e = parseISO(String(job.endDate));
      if (!Number.isNaN(e.getTime())) periodEnd = e;
    } else if ((job as any).recurringWeeks && Number((job as any).recurringWeeks) > 0) {
      const e = new Date(startDate);
      e.setDate(e.getDate() + Number((job as any).recurringWeeks) * 7);
      periodEnd = e;
    } else if ((job as any).recurringMonths && Number((job as any).recurringMonths) > 0) {
      periodEnd = addMonths(startDate, Number((job as any).recurringMonths));
    }

    const scheduledDaysCount = periodEnd
      ? countScheduledDaysInRange(startDate, periodEnd, recurringDays)
      : ((job as any).recurringWeeks && Number((job as any).recurringWeeks) > 0
          ? Number((job as any).recurringWeeks) * recurringDays.length
          : null);

    const periodText = periodEnd ? `${startLabel} - ${format(periodEnd, "MMM d, yyyy")}` : `Starts ${startLabel}`;
    const subtitle = scheduledDaysCount != null ? `${periodText} · ${scheduledDaysCount} days scheduled` : periodText;
    return { title, subtitle, scheduledDaysCount };
  }

  const relative = getRelativeDayLabel(startDate);
  const dateStr = format(startDate, "MMM d");
  const datePart = relative ? `${dateStr} (${relative})` : dateStr;
  return {
    title: timeRange ? `${datePart} · ${timeRange}` : datePart,
    subtitle: job.endDate ? `${format(startDate, "MMM d, yyyy")} - ${format(parseISO(String(job.endDate)), "MMM d, yyyy")}` : null,
    scheduledDaysCount: null,
  };
}

// Embedded Chats Content Component for dashboard integration
function EmbeddedChatsContent({ profile, isMobile }: { profile: Profile | null | undefined; isMobile: boolean }) {
  const [selectedJobId, setSelectedJobId] = useState<number | null>(null);
  const [messageInput, setMessageInput] = useState("");
  const [participantPopupOpen, setParticipantPopupOpen] = useState(false);
  const [selectedParticipant, setSelectedParticipant] = useState<Profile | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();

  interface ChatJob {
    job: Job;
    participants: Profile[];
    unreadCount: number;
  }

  interface MessageWithSender {
    id: number;
    jobId: number;
    senderId: number;
    content: string;
    createdAt: Date;
    sender?: Profile;
  }

  const { data: chatJobs, isLoading: jobsLoading } = useQuery<ChatJob[]>({
    queryKey: ['/api/chats/jobs'],
    enabled: !!profile,
    staleTime: 30_000,
    gcTime: 5 * 60_000,
  });
  const totalUnreadChats = (chatJobs ?? []).reduce((sum, cj) => sum + (cj.unreadCount || 0), 0);

  const { data: messages, isLoading: messagesLoading, refetch: refetchMessages } = useQuery<MessageWithSender[]>({
    queryKey: ['/api/jobs', selectedJobId, 'messages'],
    enabled: !!selectedJobId,
  });

  const sendMessageMutation = useMutation({
    mutationFn: async (content: string) => {
      const res = await fetch(`/api/jobs/${selectedJobId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Failed to send message');
      return res.json();
    },
    onMutate: async (content: string) => {
      setMessageInput("");
      if (!selectedJobId || !profile) return {};
      await queryClient.cancelQueries({ queryKey: ['/api/jobs', selectedJobId, 'messages'] });
      const previous = queryClient.getQueryData<MessageWithSender[]>(['/api/jobs', selectedJobId, 'messages']);
      const optimisticMessage: MessageWithSender = {
        id: -Date.now(),
        jobId: selectedJobId,
        senderId: profile.id,
        content,
        createdAt: new Date(),
        sender: profile,
      };
      queryClient.setQueryData<MessageWithSender[]>(
        ['/api/jobs', selectedJobId, 'messages'],
        (old) => [...(old || []), optimisticMessage]
      );
      return { previous };
    },
    onError: (_err, _content, context) => {
      if (context?.previous != null) {
        queryClient.setQueryData(['/api/jobs', selectedJobId, 'messages'], context.previous);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/jobs', selectedJobId, 'messages'] });
      queryClient.invalidateQueries({ queryKey: ['/api/chats/jobs'] });
    },
  });

  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages]);

  useEffect(() => {
    if (selectedJobId) {
      const interval = setInterval(() => {
        refetchMessages();
      }, 5000);
      return () => clearInterval(interval);
    }
  }, [selectedJobId, refetchMessages]);

  const selectedJob = chatJobs?.find(cj => cj.job.id === selectedJobId);

  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = messageInput.trim();
    if (!trimmed || sendMessageMutation.isPending) return;
    const content = stripPhonesAndEmails(trimmed);
    if (content) {
      sendMessageMutation.mutate(content);
    } else {
      setMessageInput("");
    }
  };

  const handleAvatarClick = (participant: Profile) => {
    setSelectedParticipant(participant);
    setParticipantPopupOpen(true);
  };

  if (jobsLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 animate-spin" />
      </div>
    );
  }

  if (!chatJobs || chatJobs.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <MessageSquare className="w-12 h-12 text-muted-foreground mb-4" />
        <h3 className="font-semibold text-lg mb-2">{t("noActiveChats")}</h3>
        <p className="text-muted-foreground">
          {t("chatsWillAppearHere")}
        </p>
      </div>
    );
  }

  // Show job list
  if (!selectedJobId) {
    return (
      <div className="space-y-3">
        <h2 className="text-lg font-semibold mb-4">Job Messages</h2>
        {chatJobs.map((chatJob) => (
          <Card 
            key={chatJob.job.id} 
            className="cursor-pointer hover-elevate"
            onClick={() => setSelectedJobId(chatJob.job.id)}
            data-testid={`chat-job-${chatJob.job.id}`}
          >
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                  <Briefcase className="w-5 h-5 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="font-medium truncate">{chatJob.job.title}</h3>
                  <p className="text-sm text-muted-foreground truncate">
                    {chatJob.participants.length} participant{chatJob.participants.length !== 1 ? 's' : ''}
                  </p>
                </div>
                {chatJob.unreadCount > 0 && (
                  <Badge variant="default">{chatJob.unreadCount}</Badge>
                )}
                <ChevronRight className="w-5 h-5 text-muted-foreground" />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  // Show chat messages
  return (
    <div className="flex flex-col h-[calc(100vh-200px)]">
      {/* Chat Header */}
      <div className="flex items-center gap-3 pb-4 border-b mb-4">
        <Button variant="ghost" size="icon" onClick={() => setSelectedJobId(null)} data-testid="back-to-chats">
          <ArrowLeft className="w-5 h-5" />
        </Button>
        <div className="flex-1">
          <h2 className="font-semibold">{selectedJob?.job.title}</h2>
          <p className="text-sm text-muted-foreground">
            {selectedJob?.participants.length} participant{selectedJob?.participants.length !== 1 ? 's' : ''}
          </p>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto space-y-4 pb-4">
        {messagesLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-6 h-6 animate-spin" />
          </div>
        ) : messages && messages.length > 0 ? (
          messages.map((message) => {
            const isOwnMessage = message.senderId === profile?.id;
            return (
              <div
                key={message.id}
                className={`flex gap-2 ${isOwnMessage ? 'justify-end' : 'justify-start'}`}
              >
                {!isOwnMessage && (
                  <Avatar 
                    className="w-8 h-8 cursor-pointer" 
                    onClick={() => message.sender && handleAvatarClick(message.sender)}
                  >
                    <AvatarImage src={message.sender?.avatarUrl || undefined} />
                    <AvatarFallback className="text-xs">
                      {message.sender?.firstName?.[0]}{message.sender?.lastName?.[0]}
                    </AvatarFallback>
                  </Avatar>
                )}
                <div className={`max-w-[70%] ${isOwnMessage ? 'order-first' : ''}`}>
                  {!isOwnMessage && (
                    <p className="text-xs text-muted-foreground mb-1">
                      {message.sender?.firstName} {message.sender?.lastName}
                    </p>
                  )}
                  <div className={`rounded-lg px-3 py-2 ${
                    isOwnMessage 
                      ? 'bg-primary text-primary-foreground' 
                      : 'bg-muted'
                  }`}>
                    <p className="text-sm">{message.content}</p>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {format(new Date(message.createdAt), 'h:mm a')}
                  </p>
                </div>
              </div>
            );
          })
        ) : (
          <p className="text-center text-muted-foreground py-8">{t("noMessagesYet")}</p>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Message Input */}
      <form onSubmit={handleSendMessage} className="flex gap-2 pt-4 border-t">
        <Input
          value={messageInput}
          onChange={(e) => setMessageInput(e.target.value)}
          placeholder="Type a message..."
          className="flex-1"
          data-testid="chat-message-input"
        />
        <Button type="submit" disabled={!messageInput.trim() || sendMessageMutation.isPending} data-testid="send-message-btn">
          <Send className="w-4 h-4" />
        </Button>
      </form>

      {/* Participant Dialog */}
      <ResponsiveDialog
        open={participantPopupOpen}
        onOpenChange={setParticipantPopupOpen}
        title="Participant Info"
        description="View information about this chat participant"
      >
        {selectedParticipant && (
            <div className="flex items-center gap-4">
              <Avatar className="w-16 h-16">
                <AvatarImage src={selectedParticipant.avatarUrl || undefined} />
                <AvatarFallback>{selectedParticipant.firstName?.[0]}{selectedParticipant.lastName?.[0]}</AvatarFallback>
              </Avatar>
              <div>
                <h3 className="font-semibold">{selectedParticipant.firstName} {selectedParticipant.lastName}</h3>
                <p className="text-sm text-muted-foreground capitalize">{selectedParticipant.role}</p>
              </div>
            </div>
          )}
      </ResponsiveDialog>
    </div>
  );
}

// Reviews Tab Component
function ReviewsTabContent({ 
  profile, 
  isEmployee, 
  isMobile 
}: { 
  profile: Profile | null | undefined; 
  isEmployee: boolean;
  isMobile: boolean;
}) {
  const { toast } = useToast();
  const [syncingGoogleReviews, setSyncingGoogleReviews] = useState(false);
  const [googleBusinessPlaceId, setGoogleBusinessPlaceId] = useState("");
  
  // Fetch reviews for the current user (worker or business operator)
  const { data: reviewsData, isLoading: reviewsLoading, refetch: refetchReviews } = useQuery({
    queryKey: ["/api/reviews", profile?.id],
    queryFn: async () => {
      if (!profile?.id) return null;
      const response = await fetch(`/api/reviews?revieweeId=${profile.id}`, {
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to fetch reviews");
      return response.json();
    },
    enabled: !!profile?.id,
  });

  const reviews = reviewsData?.reviews || [];
  const averageRating = reviewsData?.averageRating || 0;
  const totalReviews = reviewsData?.totalReviews || 0;

  // Sync Google Business Reviews
  const handleSyncGoogleReviews = async () => {
    if (!googleBusinessPlaceId.trim()) {
      toast({
        title: "Place ID Required",
        description: "Please enter your Google Business Place ID",
        variant: "destructive",
      });
      return;
    }

    setSyncingGoogleReviews(true);
    try {
      const response = await fetch("/api/reviews/sync-google", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          placeId: googleBusinessPlaceId.trim(),
        }),
      });

      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.message || "Failed to sync Google reviews");
      }

      toast({
        title: "Reviews Synced",
        description: `Successfully synced ${data.syncedCount || 0} Google reviews`,
      });

      // Refresh reviews
      refetchReviews();
      setGoogleBusinessPlaceId("");
    } catch (error: any) {
      console.error("Error syncing Google reviews:", error);
      toast({
        title: "Sync Failed",
        description: error.message || "Failed to sync Google reviews. Please check your Place ID and try again.",
        variant: "destructive",
      });
    } finally {
      setSyncingGoogleReviews(false);
    }
  };

  return (
    <div className="space-y-6 p-4 md:p-6">
      {/* Header with Rating Summary */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold mb-2">Reviews</h1>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1">
              {[1, 2, 3, 4, 5].map((star) => (
                <Star
                  key={star}
                  className={`w-5 h-5 ${
                    star <= Math.round(averageRating)
                      ? "fill-yellow-400 text-yellow-400"
                      : "text-muted-foreground"
                  }`}
                />
              ))}
            </div>
            <span className="text-lg font-semibold">{averageRating.toFixed(1)}</span>
            <span className="text-muted-foreground">({totalReviews} {totalReviews === 1 ? "review" : "reviews"})</span>
          </div>
        </div>

        {/* Google Reviews Sync */}
        {!isEmployee && (
          <Card className="p-4">
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Globe className="w-4 h-4" />
                <Label className="text-sm font-medium">Sync Google Business Reviews</Label>
              </div>
              <div className="flex gap-2">
                <Input
                  placeholder="Google Business Place ID"
                  value={googleBusinessPlaceId}
                  onChange={(e) => setGoogleBusinessPlaceId(e.target.value)}
                  className="flex-1"
                  disabled={syncingGoogleReviews}
                />
                <Button
                  onClick={handleSyncGoogleReviews}
                  disabled={syncingGoogleReviews || !googleBusinessPlaceId.trim()}
                  size="sm"
                >
                  {syncingGoogleReviews ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Syncing...
                    </>
                  ) : (
                    <>
                      <Globe className="w-4 h-4 mr-2" />
                      Sync
                    </>
                  )}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Find your Place ID in your Google Business Profile settings
              </p>
            </div>
          </Card>
        )}
      </div>

      {/* Reviews List */}
      {reviewsLoading ? (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <SkeletonCard key={i} className="h-32" />
          ))}
        </div>
      ) : reviews.length === 0 ? (
        <Card className="p-8 text-center">
          <Star className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
          <h3 className="font-semibold mb-2">No reviews yet</h3>
          <p className="text-sm text-muted-foreground">
            {isEmployee 
              ? "Your reviews from completed jobs will appear here"
              : "Reviews from completed jobs and synced Google reviews will appear here"}
          </p>
        </Card>
      ) : (
        <div className="space-y-4">
          {reviews.map((review: any) => (
            <Card key={review.id} className="p-4">
              <div className="flex items-start gap-4">
                {/* Reviewer Avatar */}
                <Avatar className="w-10 h-10">
                  <AvatarImage 
                    src={review.isGoogleReview 
                      ? review.googleReviewerPhotoUrl || undefined
                      : review.reviewer?.avatarUrl || undefined
                    } 
                  />
                  <AvatarFallback>
                    {review.isGoogleReview
                      ? review.googleReviewerName?.[0] || "G"
                      : review.reviewer?.firstName?.[0] || "U"
                    }
                  </AvatarFallback>
                </Avatar>

                <div className="flex-1 space-y-2">
                  {/* Header */}
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="font-semibold">
                          {review.isGoogleReview
                            ? review.googleReviewerName || "Google Reviewer"
                            : `${review.reviewer?.firstName || ""} ${review.reviewer?.lastName || ""}`.trim() || "Anonymous"
                          }
                        </p>
                        {review.isGoogleReview && (
                          <Badge variant="outline" className="text-xs">
                            <Globe className="w-3 h-3 mr-1" />
                            Google
                          </Badge>
                        )}
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {format(new Date(review.isGoogleReview ? review.googleReviewDate : review.createdAt), "MMM d, yyyy")}
                      </p>
                    </div>
                    <div className="flex items-center gap-1">
                      {[1, 2, 3, 4, 5].map((star) => (
                        <Star
                          key={star}
                          className={`w-4 h-4 ${
                            star <= review.rating
                              ? "fill-yellow-400 text-yellow-400"
                              : "text-muted-foreground"
                          }`}
                        />
                      ))}
                    </div>
                  </div>

                  {/* Job Info (if not Google review) */}
                  {!review.isGoogleReview && review.job && (
                    <div className="text-sm text-muted-foreground">
                      <p className="font-medium text-foreground">{review.job.title}</p>
                      <p>{review.job.city}, {review.job.state}</p>
                    </div>
                  )}

                  {/* Detailed Ratings */}
                  {(review.qualityRating || review.punctualityRating || review.communicationRating || review.effortRating) && (
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                      {review.qualityRating && (
                        <div>
                          <span className="text-muted-foreground">Quality:</span>{" "}
                          <span className="font-medium">{review.qualityRating}/5</span>
                        </div>
                      )}
                      {review.punctualityRating && (
                        <div>
                          <span className="text-muted-foreground">Punctuality:</span>{" "}
                          <span className="font-medium">{review.punctualityRating}/5</span>
                        </div>
                      )}
                      {review.communicationRating && (
                        <div>
                          <span className="text-muted-foreground">Communication:</span>{" "}
                          <span className="font-medium">{review.communicationRating}/5</span>
                        </div>
                      )}
                      {review.effortRating && (
                        <div>
                          <span className="text-muted-foreground">Effort:</span>{" "}
                          <span className="font-medium">{review.effortRating}/5</span>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Comment */}
                  {review.comment && (
                    <p className="text-sm">{review.comment}</p>
                  )}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function EmbeddedTodayContent({ profile, isMobile }: { profile: Profile | null | undefined; isMobile: boolean }) {
  const { toast } = useToast();
  const [timeFrame, setTimeFrame] = useState<"today" | "week" | "month">("today");
  const [clockingJobId, setClockingJobId] = useState<number | null>(null);

  const { data: assignments = [], isLoading } = useQuery<Array<{
    application: Application & { 
      job: Job;
      teamMember?: { id: number; firstName: string; lastName: string; avatarUrl?: string | null } | null;
    };
    activeTimesheet?: Timesheet | null;
  }>>({
    queryKey: ["/api/today/assignments"],
    queryFn: async () => {
      const res = await fetch("/api/today/assignments", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch assignments");
      return res.json();
    },
    enabled: !!profile,
  });

  const { data: activeTimesheet } = useQuery<Timesheet | null>({
    queryKey: ["/api/timesheets/active", profile?.id],
    queryFn: async () => {
      if (!profile?.id) return null;
      try {
        const res = await fetch(`/api/timesheets/active/${profile.id}`, { credentials: "include" });
        if (res.status === 404) return null;
        if (!res.ok) throw new Error("Failed to fetch active timesheet");
        return res.json();
      } catch {
        return null;
      }
    },
    enabled: !!profile?.id,
    refetchInterval: 60000, // Reduced from 30s to 60s - less frequent polling
    staleTime: 30000, // Consider data fresh for 30 seconds
    refetchOnWindowFocus: false, // Don't refetch on window focus
  });

  const filteredAssignments = useMemo(() => {
    if (!assignments.length) return [];
    
    return assignments.filter(a => {
      const job = a.application.job;
      if (!job.startDate) return timeFrame === "today";
      
      const startDate = new Date(job.startDate);
      switch (timeFrame) {
        case "today":
          return isToday(startDate);
        case "week":
          return isThisWeek(startDate, { weekStartsOn: 0 });
        case "month":
          return isThisMonth(startDate);
        default:
          return true;
      }
    }).sort((a, b) => {
      const dateA = a.application.job.startDate ? new Date(a.application.job.startDate) : new Date();
      const dateB = b.application.job.startDate ? new Date(b.application.job.startDate) : new Date();
      return dateA.getTime() - dateB.getTime();
    });
  }, [assignments, timeFrame]);

  const clockInMutation = useMutation({
    mutationFn: async ({ jobId, workerId }: { jobId: number; workerId: number }) => {
      const res = await fetch("/api/timesheets/clock-in", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ jobId, workerId }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || "Failed to clock in");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/today/assignments"] });
      queryClient.invalidateQueries({ queryKey: ["/api/timesheets/active"] });
      queryClient.invalidateQueries({ queryKey: ["/api/timesheets"] });
      queryClient.invalidateQueries({ queryKey: ["/api/timesheets/worker"] });
      queryClient.invalidateQueries({ queryKey: ["/api/worker/clock-in-prompt-jobs"] });
      toast({ title: "Clocked In", description: "You've successfully clocked in." });
      setClockingJobId(null);
    },
    onError: (err: any) => {
      toast({ title: "Clock In Failed", description: err.message, variant: "destructive" });
      setClockingJobId(null);
    },
  });

  const clockOutMutation = useMutation({
    mutationFn: async ({ timesheetId }: { timesheetId: number }) => {
      const res = await fetch("/api/timesheets/clock-out", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ timesheetId }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || "Failed to clock out");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/today/assignments"] });
      queryClient.invalidateQueries({ queryKey: ["/api/timesheets/active"] });
      queryClient.invalidateQueries({ queryKey: ["/api/timesheets"] });
      queryClient.invalidateQueries({ queryKey: ["/api/timesheets/worker"] });
      queryClient.invalidateQueries({ queryKey: ["/api/worker/clock-in-prompt-jobs"] });
      toast({ title: "Clocked Out", description: "You've successfully clocked out." });
    },
    onError: (err: any) => {
      toast({ title: "Clock Out Failed", description: err.message, variant: "destructive" });
    },
  });

  const handleClockIn = (jobId: number, workerId: number) => {
    setClockingJobId(jobId);
    clockInMutation.mutate({ jobId, workerId });
  };

  const handleClockOut = (timesheetId: number) => {
    clockOutMutation.mutate({ timesheetId });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 animate-spin" />
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4 overflow-y-auto h-full">
      <Tabs value={timeFrame} onValueChange={(v) => setTimeFrame(v as "today" | "week" | "month")}>
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="today" data-testid="tab-today">Today</TabsTrigger>
          <TabsTrigger value="week" data-testid="tab-week">This Week</TabsTrigger>
          <TabsTrigger value="month" data-testid="tab-month">This Month</TabsTrigger>
        </TabsList>
      </Tabs>

      {filteredAssignments.length === 0 ? (
        <Card className="p-8 text-center">
          <CalendarIcon className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
          <h3 className="font-semibold mb-2">No scheduled work {timeFrame === "today" ? "today" : timeFrame === "week" ? "this week" : "this month"}</h3>
          <p className="text-sm text-muted-foreground">Your accepted jobs will appear here when they're scheduled.</p>
        </Card>
      ) : (
        <div className="space-y-3">
          {filteredAssignments.map((assignment) => {
            const job = assignment.application.job;
            const isActive = activeTimesheet?.jobId === job.id;
            const teamMember = assignment.application.teamMember;

            return (
              <Card key={assignment.application.id} className={`p-4 ${isActive ? "ring-2 ring-green-500" : ""}`} data-testid={`today-job-${job.id}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      {isActive && (
                        <Badge className="bg-green-500 text-white text-xs">Clocked In</Badge>
                      )}
                      {teamMember && (
                        <Badge variant="outline" className="text-xs gap-1">
                          <User className="w-3 h-3" />
                          {teamMember.firstName}
                        </Badge>
                      )}
                    </div>
                    <h3 className="font-semibold line-clamp-1">{job.title}</h3>
                    <p className="text-sm text-muted-foreground line-clamp-1">{job.location || `${job.city}, ${job.state}`}</p>
                    {job.startDate && (
                      <p className="text-xs text-muted-foreground mt-1">
                        {format(new Date(job.startDate), "MMM d, h:mm a")}
                      </p>
                    )}
                  </div>
                  <div className="flex flex-col gap-2">
                    {isActive && activeTimesheet ? (
                      <Button 
                        size="sm" 
                        variant="destructive"
                        onClick={() => handleClockOut(activeTimesheet.id)}
                        disabled={clockOutMutation.isPending}
                        data-testid={`clock-out-${job.id}`}
                      >
                        {clockOutMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Square className="w-4 h-4 mr-1" />}
                        Clock Out
                      </Button>
                    ) : !activeTimesheet && (
                      <Button 
                        size="sm"
                        onClick={() => handleClockIn(job.id, teamMember?.id || profile?.id || 0)}
                        disabled={clockingJobId === job.id || clockInMutation.isPending}
                        data-testid={`clock-in-${job.id}`}
                      >
                        {clockingJobId === job.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4 mr-1" />}
                        Clock In
                      </Button>
                    )}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Format a single 24h time (HH:MM or HH:MM:SS) to 12h (e.g. "17:00" -> "5:00pm", "08:00" -> "8:00am")
// Format time from 24h to 12h with " AM" / " PM" (e.g. "17:00" -> "5:00 PM")
function formatTimeString(time: string | null | undefined): string {
  if (!time) return "";
  const t = time.trim();
  if (!t) return "";
  if (t.toLowerCase().includes("am") || t.toLowerCase().includes("pm")) return t;
  if (t.includes(" - ")) {
    const [start, end] = t.split(" - ").map((s) => s.trim());
    const start12 = start ? formatTime12h(start) : "";
    const end12 = end ? formatTime12h(end) : "";
    if (start12 && end12) return `${start12} - ${end12}`;
    if (start12) return start12;
    if (end12) return end12;
    return t;
  }
  return formatTime12h(t);
}

// For "Start X - Y" display: use only start part or only end part to avoid duplicating when a field holds a range
function startTimeOnly(s: string): string {
  if (!s || !s.includes(" - ")) return s;
  return s.split(" - ").map((x) => x.trim())[0] || s;
}
function endTimeOnly(s: string): string {
  if (!s || !s.includes(" - ")) return s;
  const parts = s.split(" - ").map((x) => x.trim());
  return parts[parts.length - 1] || s;
}

// Relative date label for display: "today", "tomorrow", "in N days", or "" if in the past
function getRelativeDayLabel(startDate: Date): string {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const jobDay = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
  const diffDays = Math.floor((jobDay.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays < 0) return "";
  if (diffDays === 0) return "today";
  if (diffDays === 1) return "tomorrow";
  return `in ${diffDays} days`;
}

/** Hours from a timesheet row (API may return strings). */
function parseTimesheetHours(ts: Timesheet): number {
  const raw = ts.adjustedHours ?? ts.totalHours;
  const n = typeof raw === "string" ? parseFloat(raw) : Number(raw);
  return Number.isFinite(n) ? n : 0;
}

function centsForTimesheet(ts: Timesheet): number {
  const pay = ts.totalPay;
  if (pay != null && pay > 0) return pay;
  return Math.round(parseTimesheetHours(ts) * (ts.hourlyRate ?? 0));
}

type AcceptedJobTimesheetRollup = {
  total: number;
  pendingReview: number;
  pendingReviewCents: number;
  approvedUnpaid: number;
  approvedUnpaidCents: number;
  paid: number;
  paidCents: number;
  activeShift: number;
  rejectedOrDisputed: number;
};

function rollupAcceptedJobTimesheets(timesheets: readonly Timesheet[]): AcceptedJobTimesheetRollup {
  const r: AcceptedJobTimesheetRollup = {
    total: timesheets.length,
    pendingReview: 0,
    pendingReviewCents: 0,
    approvedUnpaid: 0,
    approvedUnpaidCents: 0,
    paid: 0,
    paidCents: 0,
    activeShift: 0,
    rejectedOrDisputed: 0,
  };
  for (const ts of timesheets) {
    const cents = centsForTimesheet(ts);
    if (ts.paymentStatus === "completed") {
      r.paid++;
      r.paidCents += ts.totalPay != null && ts.totalPay > 0 ? ts.totalPay : cents;
      continue;
    }
    if (ts.status === "rejected" || ts.status === "disputed") {
      r.rejectedOrDisputed++;
      continue;
    }
    if (ts.status === "approved") {
      r.approvedUnpaid++;
      r.approvedUnpaidCents += ts.totalPay != null && ts.totalPay > 0 ? ts.totalPay : cents;
      continue;
    }
    if (ts.status === "pending" && ts.clockOutTime && ts.submittedAt) {
      r.pendingReview++;
      r.pendingReviewCents += cents;
      continue;
    }
    if (ts.status === "pending" && !ts.clockOutTime) {
      r.activeShift++;
    }
  }
  return r;
}

export default function WorkerDashboard() {
  const { openTimesheetApprovalInvoice } = useTimesheetApprovalInvoice();
  const [onboardingComplete, setOnboardingComplete] = useState(false);
  const { t, i18n } = useTranslation("workerDashboard");
  const { t: tMenu } = useTranslation("translation");
  const { t: tEnhanced } = useTranslation("enhancedJobDialog");
  const { t: tToday } = useTranslation("today");
  const searchParams = useSearch();
  const [locationPath, setLocation] = useLocation();
  
  // Get initial tab from URL path (e.g., /dashboard/jobs -> "jobs")
  const getInitialTab = (): DashboardTab => {
    const pathSegments = locationPath.split('/').filter(Boolean);
    if (pathSegments.length >= 2 && pathSegments[0] === 'dashboard') {
      const section = pathSegments[1];
      if (section === "menu" || section === "jobs" || section === "calendar" || section === "find" || section === "today" || section === "chats") {
        return section;
      }
    }
    return "find"; // Default, will be overridden for employees after profile loads
  };
  
  const [activeTab, setActiveTabState] = useState<DashboardTab>(getInitialTab);
  
  // Sync activeTab with URL when locationPath changes (browser back/forward, external navigation)
  useEffect(() => {
    const urlTab = getInitialTab();
    if (urlTab !== activeTab) {
      setActiveTabState(urlTab);
    }
  }, [locationPath]);

  // Sync menuSelection when path is /dashboard/menu/bank (so /dashboard/menu/bank opens bank tab)
  const isMenuBankPath = locationPath === "/dashboard/menu/bank";
  useEffect(() => {
    if (isMenuBankPath) {
      setMenuSelection("bank");
    }
  }, [isMenuBankPath]);
  
  // Custom setActiveTab that navigates to the new URL (only if different)
  const setActiveTab = (tab: DashboardTab) => {
    if (activeTab === tab) return; // Prevent re-navigation if already on this tab
    setActiveTabState(tab);
    // Navigate to the new URL path
    setLocation(`/dashboard/${tab}`);
  };
  const [selectedJob, setSelectedJob] = useState<JobWithDistance | null>(null);
  /** When opening a pending calendar event, pass application so dialog shows Pending Review, withdraw, masked address, no chat/clock in. */
  const [selectedCalendarApplication, setSelectedCalendarApplication] = useState<{ id: number; status: "pending" | "accepted" | "rejected"; proposedRate?: number | null; teamMember?: { id: number; firstName: string | null; lastName: string | null; avatarUrl: string | null; hourlyRate: number | null } | null } | null>(null);
  const [calendarOpenApplyAtStep3, setCalendarOpenApplyAtStep3] = useState(false);
  const [calendarMonth, setCalendarMonth] = useState(new Date());
  const [selectedCalendarJob, setSelectedCalendarJob] = useState<Job | null>(null);
  const [calendarDeepLinkJobId, setCalendarDeepLinkJobId] = useState<number | null>(null);
  
  // Quick settings dialog states (single breadcrumbed popup)
  const [quickSettingsOpen, setQuickSettingsOpen] = useState(false);
  const [quickSettingsView, setQuickSettingsView] = useState<QuickSettingsView>("main");
  const [quickSettingsSubView, setQuickSettingsSubView] = useState<"list" | "edit">("list");
  const [quickSettingsSelectedPerson, setQuickSettingsSelectedPerson] = useState<"self" | number | null>(null);
  const [quickSettingsFilter, setQuickSettingsFilter] = useState<"all" | "self" | number>("all");
  const [quickSettingsRatePercentLower, setQuickSettingsRatePercentLower] = useState<number>(5);
  const [skillsetDialogOpen, setSkillsetDialogOpen] = useState(false);
  const [rateDialogOpen, setRateDialogOpen] = useState(false);
  
  // Settings form states
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [teammateSkillsets, setTeammateSkillsets] = useState<Record<number, string[]>>({}); // Track teammate skillset edits
  const [expandedIndustries, setExpandedIndustries] = useState<string[]>([]);
  const [hourlyRate, setHourlyRate] = useState<number>(30);
  const [locationAddress, setLocationAddress] = useState("");
  const [locationCity, setLocationCity] = useState("");
  const [locationState, setLocationState] = useState("");
  const [locationZip, setLocationZip] = useState("");
  const [locationLatitude, setLocationLatitude] = useState<string>("");
  const [locationLongitude, setLocationLongitude] = useState<string>("");
  /** Dedicated value for the address input so typing is not overwritten by city/state/zip concatenation. */
  const [locationInputValue, setLocationInputValue] = useState("");
  const [isGettingLocation, setIsGettingLocation] = useState(false);
  
  // Find Work tab states
  const [mapPopupOpen, setMapPopupOpen] = useState(false);
  const [selectedFindJob, setSelectedFindJob] = useState<Job | null>(null);
  const [bottomSheetPosition, setBottomSheetPosition] = useState<"collapsed" | "peek" | "full">("peek");
  const [isDragging, setIsDragging] = useState(false);
  const [dragStartY, setDragStartY] = useState(0);
  const [dragCurrentY, setDragCurrentY] = useState(0);
  const [jobToDismiss, setJobToDismiss] = useState<Job | null>(null);
  const calendarRef = useRef<WorkerCalendarRef>(null);
  const calendarHeaderSlotRef = useRef<HTMLDivElement | null>(null);
  const [calendarHeaderSlotReady, setCalendarHeaderSlotReady] = useState(false);
  const [dismissReason, setDismissReason] = useState("");
  
  // Find Work filters - persisted to localStorage (default 50mi, editable 1–50 in filters)
  const DEFAULT_MAX_DISTANCE_MILES = 50;
  const MAX_DISTANCE_MILES_CAP = 50; // UI and logic cap; stored values are clamped to 1–50
  const [findWorkFilters, setFindWorkFilters] = usePersistentFilter<{
    jobType: string[];
    skills: string[];
    showOnlyMatching: boolean;
    maxDistanceMiles: number;
  }>("worker_dashboard_findwork_filters_v2", { jobType: [], skills: [], showOnlyMatching: false, maxDistanceMiles: DEFAULT_MAX_DISTANCE_MILES });

  const clampedMaxDistanceMiles = Math.min(MAX_DISTANCE_MILES_CAP, Math.max(1, findWorkFilters.maxDistanceMiles ?? DEFAULT_MAX_DISTANCE_MILES));
  const [filtersDropdownOpen, setFiltersDropdownOpen] = useState(false);
  const [showDevFilterDialog, setShowDevFilterDialog] = useState(false);
  const [advancedDistanceOpen, setAdvancedDistanceOpen] = useState(false);
  const [devLocationFilterOff, setDevLocationFilterOff] = useState(() =>
    typeof localStorage !== "undefined" && showClientDevTools() && localStorage.getItem("findWorkDevNoLocationFilter") === "1"
  );

  // Geocoded points from account addresses when lat/lng missing (profile + teammates); key = "profile" | "member-{id}"
  const [geocodedAddressCache, setGeocodedAddressCache] = useState<Record<string, { lat: number; lng: number }>>({});
  const [jobPinGeocodeCache, setJobPinGeocodeCache] = useState<Record<number, { lat: number; lng: number }>>({});
  const [jobPinGeocodeUnavailable, setJobPinGeocodeUnavailable] = useState(false);
  const [mapsGeocoderReady, setMapsGeocoderReady] = useState(
    typeof window !== "undefined" && !!window.google?.maps?.Geocoder
  );
  /** In-flight only — permanent "requested" set blocked retries after a failed geocode. */
  const jobPinGeocodeInFlightRef = useRef<Set<number>>(new Set());
  const jobPinGeocodeDisabledRef = useRef(false);
  
  // Jobs tab worker filter - filter applications by worker
  const [jobsWorkerFilter, setJobsWorkerFilter] = usePersistentFilter<string>("worker_dashboard_jobs_filter", "all");
  const [applyJob, setApplyJob] = useState<Job | null>(null);
  const [applyStage, setApplyStage] = useState<1 | 2>(1);
  const [showCancellationPolicyApply, setShowCancellationPolicyApply] = useState(false);
  const [applicationMessage, setApplicationMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selectedTeamMemberId, setSelectedTeamMemberId] = useState<string>("self");
  const [selectedApplicants, setSelectedApplicants] = useState<Set<number | "self">>(new Set(["self"]));
  const [useSmartRateDashboard, setUseSmartRateDashboard] = useState(false);
  
  // AI Dispatch settings
  const [showAiDispatchDialog, setShowAiDispatchDialog] = useState(false);
  const [aiDispatchEnabled, setAiDispatchEnabled] = usePersistentFilter<boolean>("ai_dispatch_enabled", false);
  const [aiDispatchTeammatesArray, setAiDispatchTeammatesArray] = usePersistentFilter<Array<number | "self">>("ai_dispatch_teammates", ["self"]);
  const aiDispatchTeammates = useMemo(() => new Set(aiDispatchTeammatesArray), [aiDispatchTeammatesArray]);
  
  // Smart Apply Rate setting (default ON)
  const [smartApplyRateEnabled, setSmartApplyRateEnabled] = usePersistentFilter<boolean>("smart_apply_rate_enabled", true);
  const setAiDispatchTeammates = useCallback((value: Set<number | "self"> | ((prev: Set<number | "self">) => Set<number | "self">)) => {
    if (typeof value === "function") {
      setAiDispatchTeammatesArray((prev) => Array.from(value(new Set(prev))));
    } else {
      setAiDispatchTeammatesArray(Array.from(value));
    }
  }, [setAiDispatchTeammatesArray]);
  const [aiDispatchMaxDistance, setAiDispatchMaxDistance] = usePersistentFilter<number>("ai_dispatch_max_distance", 15);
  
  // New AI Dispatch settings
  const [aiDispatchSkillsOnly, setAiDispatchSkillsOnly] = usePersistentFilter<boolean>("ai_dispatch_skills_only", true);
  const [aiDispatchTimeWindowEnabled, setAiDispatchTimeWindowEnabled] = usePersistentFilter<boolean>("ai_dispatch_time_window_enabled", false);
  const [aiDispatchStartTime, setAiDispatchStartTime] = usePersistentFilter<string>("ai_dispatch_start_time", "09:00");
  const [aiDispatchEndTime, setAiDispatchEndTime] = usePersistentFilter<string>("ai_dispatch_end_time", "17:00");
  const [aiDispatchMessage, setAiDispatchMessage] = usePersistentFilter<string>("ai_dispatch_message", "");
  const [aiDispatchRateAdjustments, setAiDispatchRateAdjustments] = usePersistentFilter<boolean>("ai_dispatch_rate_adjustments", true);
  
  // Teammate settings dialog
  const [teammateSettingsOpen, setTeammateSettingsOpen] = useState(false);
  const [selectedTeammateForSettings, setSelectedTeammateForSettings] = useState<WorkerTeamMember | null>(null);
  const [teammateEditAddress, setTeammateEditAddress] = useState("");
  const [teammateEditCity, setTeammateEditCity] = useState("");
  const [teammateEditState, setTeammateEditState] = useState("");
  const [teammateEditZipCode, setTeammateEditZipCode] = useState("");
  const [teammateEditLatitude, setTeammateEditLatitude] = useState("");
  const [teammateEditLongitude, setTeammateEditLongitude] = useState("");
  const [teammateEditHourlyRate, setTeammateEditHourlyRate] = useState<number>(0);
  
  // View mode for job list
  const [viewMode, setViewMode] = usePersistentFilter<"map" | "list" | "table" | "card">("job_view_mode", "card");
  
  // Rate adjustment popup (breadcrumb from apply popup)
  const [rateAdjustMember, setRateAdjustMember] = useState<{ type: "self" | "member"; memberId?: number } | null>(null);
  const [tempAdjustedRate, setTempAdjustedRate] = useState<number>(30);
  const [applyJobReturnTo, setApplyJobReturnTo] = useState<Job | null>(null);
  
  // Suggested rate for smart analytics
  const [suggestedApplicationRate, setSuggestedApplicationRate] = useState<number | null>(null);
  
  // Invite a Buddy dialog
  const [inviteBuddyOpen, setInviteBuddyOpen] = useState(false);
  
  // Notifications popup (full screen on mobile)
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  
  // Language selector popup
  const [languagePopupOpen, setLanguagePopupOpen] = useState(false);

  // Desktop menu: selected item for right-panel detail view (no navigate / no dialogs)
  type MenuSelection = "profile" | "skillset" | "rate" | "notifications" | "bank" | "payment-history" | "language" | "invite" | "business-operator" | "reviews" | "account-documents" | "terms" | "privacy" | "legal";
  const [menuSelection, setMenuSelection] = useState<MenuSelection>("profile");
  
  // Skillset panel: "self" or teammate id; controls whose skillsets are shown/edited
  const [skillsetPanelPerson, setSkillsetPanelPerson] = useState<"self" | number>("self");
  const [ratePanelPerson, setRatePanelPerson] = useState<"self" | number | null>(null);
  const [rateAccordionOpen, setRateAccordionOpen] = useState<number | "self" | null>(null);
  const [rateEditingValues, setRateEditingValues] = useState<Record<string | number, number>>({});

  // Jobs tab - selected application for details sheet
  const [selectedJobApp, setSelectedJobApp] = useState<ApplicationWithDetails | null>(null);
  const [directionsDialogOpen, setDirectionsDialogOpen] = useState(false);
  const [directionsJob, setDirectionsJob] = useState<Job | null>(null);
  
  const { user, isLoading: authLoading, logout } = useAuth();
  const { data: profile, isLoading: profileLoading } = useProfile(user?.id);

  // Referrals data (moved to top level to fix React Hooks violation)
  // MUST be AFTER profile declaration to avoid TDZ error
  const { data: referrals = [], isLoading: referralsLoading } = useQuery<Array<{
    id: number;
    referredUserId: number;
    referredEmail: string;
    referredName: string;
    status: "pending" | "accepted" | "completed";
    acceptedAt: Date | null;
    firstJobCompletedAt: Date | null;
    bonusPaid: boolean;
    createdAt: Date;
  }>>({
    queryKey: ["/api/referrals", profile?.id],
    enabled: !!profile?.id && menuSelection === "invite",
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/referrals/${profile?.id}`);
      return res.json();
    },
  });
  const isMobile = useIsMobile();
  const isScrolled = useScrollHeader();
  const { data: adminCheck } = useAdminCheck();
  const isAdmin = adminCheck?.isAdmin ?? false;
  const isAdminView = searchParams.includes("adminView=true") && isAdmin;
  const { toast, dismiss: dismissToast } = useToast();
  
  // Chat jobs query for unread count badge
  interface ChatJob {
    job: Job;
    participants: Profile[];
    unreadCount: number;
  }
  const { data: chatJobs } = useQuery<ChatJob[]>({
    queryKey: ['/api/chats/jobs'],
    enabled: !!profile && profile.role === "worker",
    staleTime: 30_000,
    gcTime: 5 * 60_000,
  });
  const totalUnreadChats = (chatJobs ?? []).reduce((sum, cj) => sum + (cj.unreadCount || 0), 0);
  
  // Check if worker has completed required onboarding (name, email, phone, face photo, ≥1 skill-set, rate, bank account)
  const hasRequiredFields = useMemo(() => {
    if (!profile || profile.role !== "worker") return true; // Only check for workers
    if (onboardingComplete) return true; // Skip check if onboarding was just completed
    return isWorkerOnboardingComplete(profile);
  }, [profile, onboardingComplete]);
  
  // Check if user is an employee (has a teamId - meaning they belong to someone else's team)
  // Also check impersonation - if impersonating as employee, treat as employee
  // Must be computed after profile is loaded
  const isEmployee = useMemo(() => {
    // If impersonating as employee, treat as employee
    if (user?.impersonation?.isEmployee) {
      return true;
    }
    return profile?.teamId !== null && profile?.teamId !== undefined;
  }, [profile?.teamId, user?.impersonation?.isEmployee]);
  
  // Get display avatar - use impersonated team member's avatar when impersonating. Uses normalizeAvatarUrl so data: URLs (base64) are left as-is and never requested from the server (avoids 431).
  const displayAvatarUrl = useMemo(() => {
    const avatarUrl = user?.impersonation?.isEmployee && user?.impersonation?.teamMember?.avatarUrl
      ? user.impersonation.teamMember.avatarUrl
      : profile?.avatarUrl;
    return normalizeAvatarUrl(avatarUrl ?? undefined) ?? undefined;
  }, [user?.impersonation, profile?.avatarUrl]);
  
  // Get display name - use impersonated team member's name when impersonating
  const displayName = useMemo(() => {
    if (user?.impersonation?.isEmployee && user?.impersonation?.teamMember) {
      return {
        firstName: user.impersonation.teamMember.firstName,
        lastName: user.impersonation.teamMember.lastName,
      };
    }
    return {
      firstName: profile?.firstName,
      lastName: profile?.lastName,
    };
  }, [user?.impersonation, profile?.firstName, profile?.lastName]);
  
  const {
    clockIn,
    clockOut,
    activeTimesheet,
    isClockingIn,
    isClockingOut,
  } = useLocationTracking();
  
  const [clockInError, setClockInError] = useState<string | null>(null);

  // Redirect if not authenticated or not a worker (unless admin viewing)
  useEffect(() => {
    if (!authLoading && !user) {
      setLocation("/");
    }
  }, [authLoading, user, setLocation]);

  useEffect(() => {
    if (profile && profile.role !== "worker" && !isAdminView) {
      setLocation("/company-dashboard");
    }
  }, [profile, setLocation, isAdminView]);

  // Workers with incomplete onboarding are not redirected; the global WorkerOnboardingRequiredModal and combined banners handle onboarding as step 1.

  // Redirect employees away from restricted pages (Find, Jobs, Menu)
  useEffect(() => {
    if (isEmployee && (activeTab === "find" || activeTab === "jobs" || activeTab === "menu")) {
      setLocation("/dashboard/today");
    }
  }, [isEmployee, activeTab, setLocation]);

  // hasSmartRedirectedRef is declared here so it's stable; the effect that uses it lives near the `applications` declaration (after line 1808).
  const hasSmartRedirectedRef = useRef(false);

  // Open apply modal from job alert email link: ?job=ID&apply=1&teammates=1,2,3
  const appliedFromUrlRef = useRef(false);
  useEffect(() => {
    if (!profile || profile.role !== "worker" || appliedFromUrlRef.current) return;
    const params = new URLSearchParams(typeof searchParams === "string" ? searchParams.replace(/^\?/, "") : "");
    const jobId = params.get("job");
    const apply = params.get("apply");
    const teammatesParam = params.get("teammates");
    if (!jobId || apply !== "1") return;
    appliedFromUrlRef.current = true;
    (async () => {
      try {
        const res = await apiRequest("GET", `/api/jobs/${jobId}`);
        const job = await res.json();
        if (job?.id) {
          setApplyJob(job);
          if (teammatesParam) {
            const ids = teammatesParam.split(",").map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n));
            setSelectedApplicants(new Set(["self", ...ids] as (number | "self")[]));
          }
          setLocation("/dashboard/find");
        }
      } catch {
        appliedFromUrlRef.current = false;
      }
    })();
  }, [searchParams, profile?.id, profile?.role, setLocation]);

  // When apply dialog opens, default "use smart rate" from global Smart Apply Rate setting (applies to self + all teammates)
  useEffect(() => {
    if (applyJob) {
      setUseSmartRateDashboard(smartApplyRateEnabled);
    }
  }, [applyJob?.id, smartApplyRateEnabled]);

  // Mouse drag events for bottom sheet
  useEffect(() => {
    if (!isDragging) return;
    
    const handleMouseMove = (e: MouseEvent) => {
      setDragCurrentY(e.clientY);
    };
    
    const handleMouseUp = () => {
      const screenHeight = window.innerHeight;
      const currentPosition = dragCurrentY;
      
      if (currentPosition < screenHeight * 0.25) {
        setBottomSheetPosition("full");
      } else if (currentPosition < screenHeight * 0.6) {
        setBottomSheetPosition("peek");
      } else {
        setBottomSheetPosition("collapsed");
      }
      setIsDragging(false);
    };
    
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, dragCurrentY]);

  // Fetch available jobs
  const { data: allJobs = [], isLoading: jobsLoading } = useQuery<JobWithDistance[]>({
    queryKey: ["/api/jobs"],
    enabled: !!profile,
  });

  // Business Operator: Fetch team and members (needed for reference points and effectiveMaxMilesForApi before useFindWork)
  interface TeamMember {
    id: number;
    teamId: number;
    firstName: string;
    lastName: string;
    avatarUrl: string | null;
    hourlyRate: number;
    skillsets: string[];
    role: string;
    status: string;
  }
  interface WorkerTeam {
    id: number;
    name: string;
    ownerId: number;
  }
  const { data: workerTeam } = useQuery<WorkerTeam | null>({
    queryKey: ["/api/worker-team"],
    enabled: !!profile,
  });
  const ownerProfileId = workerTeam?.ownerId != null && profile?.id !== workerTeam?.ownerId ? String(workerTeam.ownerId) : undefined;
  const { data: ownerProfile } = useProfile(ownerProfileId);
  const operatorAvatarUrl = profile?.id === workerTeam?.ownerId
    ? (profile?.avatarUrl ?? undefined)
    : (ownerProfile?.avatarUrl ?? profile?.avatarUrl ?? undefined);
  const { data: teamMembersData } = useQuery<WorkerTeamMember[] | null>({
    queryKey: ["/api/worker-team", workerTeam?.id, "members"],
    enabled: !!workerTeam?.id,
    queryFn: async () => {
      if (!workerTeam?.id) return [];
      const res = await apiRequest("GET", `/api/worker-team/${workerTeam.id}/members`);
      const json = await res.json();
      return Array.isArray(json) ? json : [];
    },
  });
  const teamMembers = teamMembersData ?? [];
  const activeTeamMembers = teamMembers.filter(m => m.status === "active");
  const pendingTeamMembers = teamMembers.filter(m => m.status === "pending");

  const isTeamOwnerForWorkerTimesheets = !!workerTeam && profile?.id === workerTeam.ownerId;
  const { data: workerTimesheetsForJobs = [] } = useQuery<Timesheet[]>({
    queryKey: ["/api/timesheets/worker", isTeamOwnerForWorkerTimesheets ? "team" : "mine", "dashboard-jobs"],
    queryFn: async () => {
      const url = isTeamOwnerForWorkerTimesheets ? "/api/timesheets/worker?team=1" : "/api/timesheets/worker";
      const res = await apiRequest("GET", url);
      return res.json();
    },
    enabled: !!profile?.id && profile?.role === "worker",
    staleTime: 30_000,
  });

  const timesheetsByJobId = useMemo(() => {
    const m = new Map<number, Timesheet[]>();
    for (const ts of workerTimesheetsForJobs) {
      const jid = ts.jobId;
      if (jid == null) continue;
      if (!m.has(jid)) m.set(jid, []);
      m.get(jid)!.push(ts);
    }
    return m;
  }, [workerTimesheetsForJobs]);

  // When skillset popup is open and user selects a teammate tab, seed editing state from teammate's saved skillsets (mobile + desktop)
  useEffect(() => {
    if (!skillsetDialogOpen || skillsetPanelPerson === "self") return;
    const teammateId = typeof skillsetPanelPerson === "number" ? skillsetPanelPerson : null;
    if (teammateId == null || teammateSkillsets[teammateId] != null) return;
    const teammate = activeTeamMembers.find((m) => m.id === teammateId);
    if (teammate?.skillsets?.length) {
      setTeammateSkillsets((prev) => ({ ...prev, [teammateId]: teammate.skillsets || [] }));
    }
  }, [skillsetDialogOpen, skillsetPanelPerson, activeTeamMembers, teammateSkillsets]);

  const allTeamMembersForApply = teamMembers.map(m => ({
    id: m.id,
    firstName: m.firstName,
    lastName: m.lastName,
    avatarUrl: m.avatarUrl,
    hourlyRate: m.hourlyRate,
    email: (m as any).email || null,
    phone: (m as any).phone || null,
    role: m.role as "admin" | "employee",
    skillsets: m.skillsets || [],
    status: m.status as "active" | "pending" | "inactive",
    inviteToken: (m as any).inviteToken || null,
    address: (m as any).address || null,
    latitude: (m as any).latitude ?? null,
    longitude: (m as any).longitude ?? null,
  }));

  const workerLocation = useMemo(() => {
    if (profile?.latitude && profile?.longitude) {
      return { lat: parseFloat(profile.latitude), lng: parseFloat(profile.longitude) };
    }
    return undefined;
  }, [profile]);

  const referenceEntries = useMemo(() => {
    const entries: Array<{ key: string; label: string; lat: number; lng: number }> = [];
    if (profile?.latitude != null && profile?.longitude != null) {
      const lat = parseFloat(String(profile.latitude));
      const lng = parseFloat(String(profile.longitude));
      if (Number.isFinite(lat) && Number.isFinite(lng)) entries.push({ key: "self", label: "You", lat, lng });
    } else if (geocodedAddressCache["profile"]) {
      const p = geocodedAddressCache["profile"];
      entries.push({ key: "self", label: "You", lat: p.lat, lng: p.lng });
    }
    activeTeamMembers.forEach((m) => {
      const hasAddress = !!(m.address?.trim() || m.city?.trim() || m.state?.trim() || m.zipCode?.trim());
      if (!hasAddress) return;
      const key = `member-${m.id}`;
      const label = `${m.firstName} ${m.lastName}`.trim() || `Teammate ${m.id}`;
      if (m.latitude != null && m.longitude != null) {
        const lat = parseFloat(String(m.latitude));
        const lng = parseFloat(String(m.longitude));
        if (Number.isFinite(lat) && Number.isFinite(lng)) entries.push({ key, label, lat, lng });
      } else if (geocodedAddressCache[key]) {
        const p = geocodedAddressCache[key];
        entries.push({ key, label, lat: p.lat, lng: p.lng });
      }
    });
    return entries;
  }, [profile?.latitude, profile?.longitude, activeTeamMembers, geocodedAddressCache]);

  const referenceLocations = useMemo(() => referenceEntries.map((e) => ({ lat: e.lat, lng: e.lng })), [referenceEntries]);

  // Teammate pins for map: use DB lat/lng when present, otherwise geocoded cache (from entered address) so avatar pins and radius show
  const teammateLocationsForMap = useMemo(
    () =>
      activeTeamMembers
        .map((tm) => {
          const lat =
            tm.latitude != null ? parseFloat(String(tm.latitude)) : geocodedAddressCache[`member-${tm.id}`]?.lat;
          const lng =
            tm.longitude != null ? parseFloat(String(tm.longitude)) : geocodedAddressCache[`member-${tm.id}`]?.lng;
          return {
            id: tm.id,
            lat: lat ?? 0,
            lng: lng ?? 0,
            name: `${tm.firstName} ${tm.lastName}`,
            avatarUrl: tm.avatarUrl || undefined,
            type: "teammate" as const,
          };
        })
        .filter((tm) => tm.lat !== 0 && tm.lng !== 0),
    [activeTeamMembers, geocodedAddressCache]
  );

  const RADIUS_STORAGE_KEY = "worker_dashboard_radius_by_key";
  const [radiusByReferenceKey, setRadiusByReferenceKey] = useState<Record<string, number>>(() => {
    try {
      const s = localStorage.getItem(RADIUS_STORAGE_KEY);
      return s ? JSON.parse(s) : {};
    } catch {
      return {};
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(RADIUS_STORAGE_KEY, JSON.stringify(radiusByReferenceKey));
    } catch {
      // ignore
    }
  }, [radiusByReferenceKey]);

  const getRadiusForRefIndex = useCallback(
    (i: number) => {
      const key = referenceEntries[i]?.key;
      if (key && radiusByReferenceKey[key] != null) return Math.min(50, Math.max(1, radiusByReferenceKey[key]));
      return clampedMaxDistanceMiles;
    },
    [referenceEntries, radiusByReferenceKey, clampedMaxDistanceMiles]
  );

  const effectiveMaxMilesForApi = useMemo(() => {
    if (referenceEntries.length === 0) return clampedMaxDistanceMiles;
    const perRef = referenceEntries.map((e) =>
      e.key && radiusByReferenceKey[e.key] != null ? Math.min(50, Math.max(1, radiusByReferenceKey[e.key])) : clampedMaxDistanceMiles
    );
    return Math.max(clampedMaxDistanceMiles, ...perRef);
  }, [referenceEntries, radiusByReferenceKey, clampedMaxDistanceMiles]);

  // Stable object for find-work query key (useFindWorkInfinite hashes primitives; avoids redundant refetches).
  const findWorkApiFilters = useMemo(
    () => ({
      maxDistanceMiles: effectiveMaxMilesForApi,
      ...(showClientDevTools() && devLocationFilterOff ? { skipLocationFilter: true as const } : {}),
    }),
    [effectiveMaxMilesForApi, devLocationFilterOff]
  );

  // Fetch find work jobs (paginated): first page loads fast, "Load more" fetches next page.
  const {
    findWorkJobs,
    isLoading: findWorkLoading,
    isFetching: findWorkFetching,
    isError: findWorkIsError,
    error: findWorkQueryError,
    refetch: refetchFindWork,
    fetchNextPage: fetchNextFindWorkPage,
    hasNextPage: hasNextFindWorkPage,
    isFetchingNextPage: isFetchingNextFindWorkPage,
  } = useFindWorkInfinite(findWorkApiFilters, { enabled: !!profile && profile.role === "worker" });

  // While profile is loading, find-work query is disabled (TanStack: isLoading stays false) — treat as loading so we don't show an empty list/map with no in-flight fetch.
  const findWorkFeedLoading =
    (!!user?.id && profileLoading) ||
    (!!profile && profile.role === "worker" && findWorkLoading);

  const findWorkTimedOut =
    findWorkIsError &&
    findWorkQueryError instanceof Error &&
    findWorkQueryError.message === FIND_WORK_TIMEOUT_MESSAGE;

  // Dismiss job mutation
  const dismissJobMutation = useDismissJob();
  const undismissJobMutation = useUndismissJob();

  // Business operator reminder is shown in the combined global banners (multi-step pop-up when multiple banners apply)

  // Rate section computed values - must be after profile and activeTeamMembers are defined
  // DB stores in cents; values > 100 are cents, <= 100 are dollars (legacy)
  const allRateWorkers = useMemo(() => [
    { id: "self" as const, name: "You", rate: rateToDollars(profile?.hourlyRate), avatar: profile?.avatarUrl },
    ...activeTeamMembers.map((m) => ({
      id: m.id,
      name: `${m.firstName} ${m.lastName}`,
      rate: rateToDollars(m.hourlyRate),
      avatar: m.avatarUrl,
    })),
  ], [profile?.hourlyRate, profile?.avatarUrl, activeTeamMembers]);

  const getEditRate = useCallback((id: string | number) => {
    return rateEditingValues[id] ?? allRateWorkers.find((w) => w.id === id)?.rate ?? 30;
  }, [rateEditingValues, allRateWorkers]);

  const saveWorkerRate = useCallback(async (id: string | number) => {
    const newRate = getEditRate(id);
    if (id === "self") {
      try {
        const rateCents = Math.round(newRate * 100);
        await apiRequest("PUT", `/api/profiles/${profile?.id}`, { hourlyRate: rateCents });
        queryClient.invalidateQueries({ queryKey: ["/api/profiles", user?.id] });
        setRateAccordionOpen(null);
        toast({ title: "Rate updated", description: `Your rate is now $${newRate}/hr` });
      } catch {
        toast({ title: "Failed to save", description: "Could not update your rate", variant: "destructive" });
      }
    } else {
      try {
        const rateCents = Math.round(newRate * 100);
        await apiRequest("PUT", `/api/worker-team-members/${id}`, { hourlyRate: rateCents });
        queryClient.invalidateQueries({ queryKey: ["/api/worker-team-members"] });
        setRateAccordionOpen(null);
        const worker = allRateWorkers.find((w) => w.id === id);
        toast({ title: "Rate updated", description: `${worker?.name}'s rate is now $${newRate}/hr` });
      } catch {
        toast({ title: "Failed to save", description: "Could not update teammate rate", variant: "destructive" });
      }
    }
  }, [getEditRate, profile?.id, user?.id, allRateWorkers, toast]);

  // Same skill-match logic as AI Dispatch (lib); worker/teammate skillsets are role ids from @shared/industries
  const getSkillMatch = useCallback(
    (personSkills: string[] | null | undefined, job: Job): boolean =>
      checkSkillMatchLib(personSkills, job),
    []
  );
  
  // Get team members who can do a specific job
  const getMatchingTeamMembers = useCallback((job: Job) => {
    const matches: Array<{ id: number | 'self'; name: string; avatarUrl?: string | null; isAdmin?: boolean }> = [];
    
    // Check if admin (self) matches
    if (getSkillMatch(profile?.skillsets as string[] | null, job)) {
      matches.push({ id: 'self', name: 'You', avatarUrl: profile?.avatarUrl, isAdmin: true });
    }
    
    // Check team members
    activeTeamMembers.forEach(member => {
      if (getSkillMatch(member.skillsets as string[] | null, job)) {
        matches.push({ 
          id: member.id, 
          name: `${member.firstName} ${member.lastName}`, 
          avatarUrl: member.avatarUrl 
        });
      }
    });
    
    return matches;
  }, [profile?.skillsets, profile?.avatarUrl, activeTeamMembers, getSkillMatch]);
  
  // `/api/jobs/find-work` already filters by worker + teammate reference points and maxDistanceMiles.
  // Do not re-filter by distance or map bounds on the client — that caused a flash (full list → empty) when map idle / geocode hydrated.
  const findWorkJobsFromApi = findWorkJobs ?? [];

  // Sort and filter find work jobs (optional Find tab filters only: job type, skills, showOnlyMatching)
  const sortedFindWorkJobs = useMemo(() => {
    let jobs = [...findWorkJobsFromApi];
    if (!(showClientDevTools() && devLocationFilterOff)) {
      if (findWorkFilters.jobType.length > 0) {
        jobs = jobs.filter(job => {
          const jobType = job.isOnDemand ? 'on_demand' : job.jobType || 'one_time';
          return findWorkFilters.jobType.includes(jobType);
        });
      }
      if (findWorkFilters.skills.length > 0) {
        jobs = jobs.filter(job => {
          const jobSkills = [job.trade, job.serviceCategory, ...(job.requiredSkills || [])].filter(Boolean).map(s => s!.toLowerCase());
          return findWorkFilters.skills.some(filterSkill =>
            jobSkills.some(js => js.includes(filterSkill.toLowerCase()) || filterSkill.toLowerCase().includes(js))
          );
        });
      }
      if (findWorkFilters.showOnlyMatching) {
        jobs = jobs.filter(job => getMatchingTeamMembers(job).length > 0);
      }
    }
    return jobs.sort((a, b) => {
      const dateA = new Date(a.startDate).getTime();
      const dateB = new Date(b.startDate).getTime();
      return dateA - dateB;
    });
  }, [findWorkJobsFromApi, findWorkFilters, getMatchingTeamMembers, devLocationFilterOff]);

  // Jobs geocode relies on Maps JS Geocoder; mark ready when the loader has attached google.maps.
  useEffect(() => {
    if (mapsGeocoderReady) return;
    if (typeof window === "undefined") return;
    if (window.google?.maps?.Geocoder) {
      setMapsGeocoderReady(true);
      return;
    }
    const timer = window.setInterval(() => {
      if (window.google?.maps?.Geocoder) {
        setMapsGeocoderReady(true);
        window.clearInterval(timer);
      }
    }, 500);
    return () => window.clearInterval(timer);
  }, [mapsGeocoderReady]);

  // Jobs without plausible lat/lng still appear in the list; geocode client-side so map markers render.
  useEffect(() => {
    if (jobPinGeocodeDisabledRef.current) return;

    const disableGeocoding = () => {
      if (jobPinGeocodeDisabledRef.current) return;
      jobPinGeocodeDisabledRef.current = true;
      setJobPinGeocodeUnavailable(true);
      toast({
        title: "Geocoding API not enabled",
        description: "Showing approximate map pins near your area until Google Geocoding API is enabled for this key/project.",
        variant: "destructive",
      });
    };

    const apiKey = import.meta.env.VITE_GOOGLE_API_KEY;
    const mapsGeocoder = mapsGeocoderReady ? new window.google.maps.Geocoder() : null;
    if ((!apiKey && !mapsGeocoder) || sortedFindWorkJobs.length === 0) return;

    const geocodeViaMapsJs = async (query: string): Promise<{ lat: number; lng: number } | null> => {
      if (!mapsGeocoder) return null;
      return await new Promise((resolve) => {
        mapsGeocoder.geocode({ address: query, region: "us" }, (results, status) => {
          if (status === "REQUEST_DENIED" || status === "OVER_DAILY_LIMIT") {
            disableGeocoding();
            resolve(null);
            return;
          }
          if (status === "OK" && results?.[0]?.geometry?.location) {
            const loc = results[0].geometry.location;
            const lat = typeof loc.lat === "function" ? loc.lat() : (loc as any).lat;
            const lng = typeof loc.lng === "function" ? loc.lng() : (loc as any).lng;
            if (isPlausibleLatLng(lat, lng)) {
              resolve({ lat, lng });
              return;
            }
          }
          resolve(null);
        });
      });
    };

    const geocodeViaHttp = async (query: string): Promise<{ lat: number; lng: number } | null> => {
      if (!apiKey) return null;
      try {
        const res = await fetch(
          `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(query)}&key=${apiKey}&region=us`
        );
        const data = await res.json();
        if (
          data?.status === "REQUEST_DENIED" &&
          String(data?.error_message || "").toLowerCase().includes("referer restrictions")
        ) {
          return null;
        }
        if (data?.status === "OVER_DAILY_LIMIT") {
          return null;
        }
        const loc = data.results?.[0]?.geometry?.location;
        if (loc != null && isPlausibleLatLng(loc.lat, loc.lng)) {
          return { lat: loc.lat, lng: loc.lng };
        }
      } catch {
        // Ignore and allow next fallback query attempt.
      }
      return null;
    };

    for (const job of sortedFindWorkJobs) {
      if (parseJobLatLng(job)) continue;
      if (jobPinGeocodeCache[job.id]) continue;
      if (jobPinGeocodeInFlightRef.current.has(job.id)) continue;
      if (jobPinGeocodeDisabledRef.current) break;

      const primary = buildJobGeocodeQuery(job);
      const locFallback = (job.location || "").trim();
      const queries = [primary, locFallback].filter((q): q is string => !!q && q.trim().length > 0);
      const uniqueQueries = [...new Set(queries)];
      if (uniqueQueries.length === 0) continue;

      jobPinGeocodeInFlightRef.current.add(job.id);

      void (async () => {
        try {
          for (const q of uniqueQueries) {
            if (jobPinGeocodeDisabledRef.current) return;
            const byMapsJs = await geocodeViaMapsJs(q);
            if (byMapsJs) {
              setJobPinGeocodeCache((prev) => ({ ...prev, [job.id]: byMapsJs }));
              return;
            }

            const byHttp = await geocodeViaHttp(q);
            if (byHttp) {
              setJobPinGeocodeCache((prev) => ({ ...prev, [job.id]: byHttp }));
              return;
            }
          }
        } finally {
          jobPinGeocodeInFlightRef.current.delete(job.id);
        }
      })();
    }
  }, [sortedFindWorkJobs, mapsGeocoderReady]);

  // Calendar available jobs: same feed as find-work API — no job type/skills/team-match filters.
  const calendarAvailableJobs = useMemo(() => {
    return [...findWorkJobsFromApi].sort((a, b) => {
      const dateA = new Date(a.startDate).getTime();
      const dateB = new Date(b.startDate).getTime();
      return dateA - dateB;
    });
  }, [findWorkJobsFromApi]);
  
  // Find Work skills filter: same global list as dashboard (INDUSTRY_CATEGORIES), plus any skills only seen in jobs
  const allJobSkills = useMemo(() => {
    const fromIndustries = getAllRoles().map((r) => r.id);
    if (!findWorkJobs || findWorkJobs.length === 0) return fromIndustries.sort();
    const fromJobs = new Set<string>();
    findWorkJobs.forEach((job) => {
      if (job.trade) fromJobs.add(job.trade);
      if (job.serviceCategory) fromJobs.add(job.serviceCategory);
      (job.requiredSkills || []).forEach((s) => fromJobs.add(s));
    });
    return Array.from(new Set([...fromIndustries, ...fromJobs])).sort();
  }, [findWorkJobs]);

  // Job types present in posted jobs (dynamic)
  const allJobTypes = useMemo(() => {
    if (!findWorkJobs) return [];
    const types = new Set<string>();
    findWorkJobs.forEach(job => {
      const t = job.isOnDemand ? 'on_demand' : (job.jobType || 'one_time');
      types.add(t);
    });
    return Array.from(types).sort((a, b) => {
      const order = ['on_demand', 'one_time', 'recurring'];
      return order.indexOf(a) - order.indexOf(b);
    });
  }, [findWorkJobs]);
  
  // Count active filters
  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (findWorkFilters.jobType.length > 0) count += findWorkFilters.jobType.length;
    if (findWorkFilters.skills.length > 0) count += findWorkFilters.skills.length;
    if (findWorkFilters.showOnlyMatching) count += 1;
    const maxMi = clampedMaxDistanceMiles;
    if (maxMi !== DEFAULT_MAX_DISTANCE_MILES && referenceLocations.length > 0) count += 1;
    return count;
  }, [findWorkFilters, referenceLocations, clampedMaxDistanceMiles]);

  // Offline: cache accepted applications, queue clock in/out, sync when back online
  const {
    isOnline,
    cachedAcceptedApplications,
    cacheAcceptedApplications,
    pendingClockEvents,
    addPendingClockIn,
    addPendingClockOut,
    syncPending,
    isSyncing,
    lastPendingClockInLocalId,
    hasPendingClockedIn,
    pendingClockedInJobId,
    pendingClockInTime,
    refreshPending,
  } = useOfflineWorker(profile?.id);

  // Fetch worker's applications (includes team member info); skip when offline and use cache
  const { data: applicationsData, isLoading: applicationsLoading } = useQuery<ApplicationWithDetails[] | null>({
    queryKey: ["/api/applications/worker", profile?.id],
    staleTime: 30_000,
    queryFn: async () => {
      const res = await fetch(`/api/applications/worker/${profile?.id}`);
      if (!res.ok) return [];
      const json = await res.json();
      return Array.isArray(json) ? json : [];
    },
    enabled: !!profile?.id && isOnline,
  });
  const applications = applicationsData ?? [];

  // Deep-link calendar job popup: /dashboard/calendar?jobId=123 opens the accepted-event calendar sheet.
  useEffect(() => {
    const raw = typeof searchParams === "string" ? searchParams.replace(/^\?/, "") : "";
    const params = new URLSearchParams(raw);
    const jobIdParam = params.get("jobId");
    if (activeTab !== "calendar" || !jobIdParam) return;

    const parsedJobId = Number(jobIdParam);
    if (!Number.isFinite(parsedJobId)) return;
    setCalendarDeepLinkJobId(parsedJobId);

    // Remove deep-link params after handing off so close won't re-open.
    params.delete("jobId");
    params.delete("conflict");
    const nextQuery = params.toString();
    const nextUrl = nextQuery ? `/dashboard/calendar?${nextQuery}` : "/dashboard/calendar";
    if (nextUrl !== locationPath) {
      setLocation(nextUrl);
    }
  }, [activeTab, searchParams, locationPath, setLocation]);

  // Smart landing: post-login hits bare `/dashboard` → send workers with accepted work to Today.
  // Must NOT run on `/dashboard/find` (explicit Find from footer nav) or we'd bounce off Find immediately.
  useEffect(() => {
    if (hasSmartRedirectedRef.current) return;
    if (!profile || profile.role !== "worker" || isEmployee) return;
    if (locationPath !== "/dashboard") return;
    if (!applicationsData) return;
    const hasAccepted = applications.some((app: { status: string }) => app.status === "accepted");
    hasSmartRedirectedRef.current = true;
    if (hasAccepted) setLocation("/dashboard/today");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applicationsData, profile?.role, isEmployee, locationPath]);

  // When online and applications load, cache accepted for offline calendar
  useEffect(() => {
    if (isOnline && applications?.length) {
      cacheAcceptedApplications(applications);
    }
  }, [isOnline, applications, cacheAcceptedApplications]);

  // When coming back online, sync pending clock in/out (same as Today page)
  const wasOfflineRef = useRef(false);
  useEffect(() => {
    if (!isOnline) {
      wasOfflineRef.current = true;
      return;
    }
    if (!wasOfflineRef.current || !profile?.id || isSyncing || pendingClockEvents.length === 0) {
      wasOfflineRef.current = false;
      return;
    }
    wasOfflineRef.current = false;
    syncPending().then(({ synced, errors }) => {
      if (synced > 0) {
        toast({ title: tToday("timesheetSynced"), description: tToday("timesheetSyncedDescription") });
        queryClient.invalidateQueries({ queryKey: ["/api/applications/worker", profile?.id] });
        queryClient.invalidateQueries({ queryKey: ["/api/timesheets/active"] });
      }
      errors.forEach((msg) => toast({ title: tToday("error"), description: msg, variant: "destructive" }));
    });
  }, [isOnline, pendingClockEvents.length, profile?.id, isSyncing, syncPending, tToday, toast, queryClient]);

  // Fetch direct job inquiries (job requests sent directly to this worker)
  interface DirectInquiryWithCompany {
    id: number;
    companyId: number;
    workerId: number;
    title: string;
    description: string;
    location: string;
    locationName: string | null;
    address: string | null;
    city: string | null;
    state: string | null;
    zipCode: string | null;
    latitude: string | null;
    longitude: string | null;
    requiredSkills: string[] | null;
    hourlyRate: number;
    startDate: string;
    endDate: string | null;
    scheduledTime: string | null;
    estimatedHours: number | null;
    jobType: string | null;
    images: string[] | null;
    videos: string[] | null;
    budgetCents: number | null;
    maxWorkersNeeded: number | null;
    status: string;
    fallbackToPublic: boolean | null;
    expiresAt: string | null;
    convertedJobId: number | null;
    workerMessage: string | null;
    respondedAt: string | null;
    createdAt: string;
    company: Profile;
  }
  
  const { data: directInquiries = [], isLoading: inquiriesLoading } = useQuery<DirectInquiryWithCompany[]>({
    queryKey: ["/api/direct-inquiries/worker"],
    enabled: !!profile?.id,
  });
  
  const pendingInquiries = directInquiries.filter(i => i.status === "pending");
  
  // Fetch notifications for the worker
  const { data: notifications = [] } = useQuery<any[]>({
    queryKey: ["/api/notifications", profile?.id],
    enabled: !!profile?.id,
  });
  
  // Respond to direct inquiry mutation
  const respondToInquiryMutation = useMutation({
    mutationFn: async ({ inquiryId, status, message }: { inquiryId: number; status: 'accepted' | 'declined'; message?: string }) => {
      return apiRequest("POST", `/api/direct-inquiries/${inquiryId}/respond`, { status, message });
    },
    onSuccess: (data, variables) => {
      if (variables.status === 'accepted') {
        toast({ title: "Job Accepted!", description: "The job has been added to your schedule." });
      } else {
        toast({ title: "Request Declined", description: "The company has been notified." });
      }
      queryClient.invalidateQueries({ queryKey: ["/api/direct-inquiries/worker"] });
      queryClient.invalidateQueries({ queryKey: ["/api/applications/worker", profile?.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/jobs"] });
    },
    onError: () => {
      toast({ title: "Error", description: "Could not respond to request. Please try again.", variant: "destructive" });
    },
  });

  // Job pins for map view: use radius-filtered jobs (sortedFindWorkJobs) so map only shows jobs within admin/worker radius.
  // Payout = workersNeeded × (rate × hours) so pill matches panel when panel shows combined payout for all slots.
  const jobPins = useMemo(() => {
    if (!sortedFindWorkJobs?.length) return [];
    const fallbackCenter = referenceLocations[0] ?? workerLocation;

    const getApproximateFallbackCoords = (jobId: number): { lat: number; lng: number } | null => {
      if (!jobPinGeocodeUnavailable || !fallbackCenter) return null;
      // Deterministic tiny offset around worker/reference center so jobs remain visible when Geocoding API is disabled.
      const angleDeg = ((jobId * 137.508) % 360 + 360) % 360;
      const angleRad = (angleDeg * Math.PI) / 180;
      const ring = (Math.abs(jobId) % 6) + 1;
      const radiusMiles = 0.18 * ring;
      const dLat = radiusMiles / 69;
      const dLng = radiusMiles / (69 * Math.max(0.3, Math.cos((fallbackCenter.lat * Math.PI) / 180)));
      return {
        lat: fallbackCenter.lat + dLat * Math.sin(angleRad),
        lng: fallbackCenter.lng + dLng * Math.cos(angleRad),
      };
    };

    return sortedFindWorkJobs
      .map((job) => {
        let coords = parseJobLatLng(job);
        if (!coords) {
          const c = jobPinGeocodeCache[job.id];
          if (c && isPlausibleLatLng(c.lat, c.lng)) coords = c;
        }
        if (!coords) {
          coords = getApproximateFallbackCoords(job.id);
        }
        if (!coords) return null;
        const application = applications.find((app) => app.jobId === job.id);
        const status =
          application?.status === "pending"
            ? ("pending" as const)
            : application?.status === "accepted"
              ? ("confirmed" as const)
              : ("open" as const);
        const payout = formatFindWorkTotalEstPayout(profile?.hourlyRate, job);
        const urgency = formatUrgency(new Date(job.startDate));
        return {
          id: job.id,
          lat: coords.lat,
          lng: coords.lng,
          title: job.title,
          trade: job.trade,
          hourlyRate: job.hourlyRate,
          city: job.city ?? undefined,
          state: job.state ?? undefined,
          status,
          payout,
          urgencyColor: urgency.color,
        };
      })
      .filter((p): p is NonNullable<typeof p> => p != null);
  }, [sortedFindWorkJobs, applications, profile, jobPinGeocodeCache, jobPinGeocodeUnavailable, referenceLocations, workerLocation]);

  // Apply for job mutation
  const applyMutation = useMutation({
    mutationFn: async (jobId: number) => {
      return apiRequest("POST", "/api/applications", { jobId, workerId: profile?.id });
    },
    onSuccess: () => {
      toast({ title: "Request sent!", description: "The company will review your application." });
      queryClient.invalidateQueries({ queryKey: ["/api/applications/worker", profile?.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/jobs/find-work"] });
    },
    onError: () => {
      toast({ title: "Error", description: "Could not send request. Please try again.", variant: "destructive" });
    },
  });

  // Remove application mutation (withdraw)
  const removeApplicationMutation = useMutation({
    mutationFn: async (applicationId: number) => {
      return apiRequest("DELETE", `/api/applications/${applicationId}`);
    },
    onSuccess: () => {
      toast({ title: "Application Withdrawn", description: "Your application has been removed." });
      queryClient.invalidateQueries({ queryKey: ["/api/applications/worker", profile?.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/jobs/find-work"] });
    },
  });

  // Update application team member mutation (for business operators) - rate stays unchanged
  const updateApplicationTeamMemberMutation = useMutation({
    mutationFn: async ({ applicationId, teamMemberId }: { applicationId: number; teamMemberId: number | null }) => {
      return apiRequest("PATCH", `/api/applications/${applicationId}/team-member`, { teamMemberId });
    },
    onSuccess: () => {
      toast({ title: "Updated", description: "Team member has been updated." });
      queryClient.invalidateQueries({ queryKey: ["/api/applications/worker", profile?.id] });
      setSelectedJobApp(null);
    },
    onError: () => {
      toast({ title: "Error", description: "Could not update team member.", variant: "destructive" });
    },
  });

  // Dev only: accept application(s) as if company approved (for testing)
  const devAcceptApplicationsMutation = useMutation({
    mutationFn: async (applicationIds: number[]) => {
      await Promise.all(
        applicationIds.map((id) => apiRequest("PATCH", `/api/applications/${id}/status`, { status: "accepted" }))
      );
    },
    onSuccess: (_, applicationIds) => {
      toast({ title: "Dev: Accepted", description: `${applicationIds.length} application(s) marked accepted.` });
      queryClient.invalidateQueries({ queryKey: ["/api/applications/worker", profile?.id] });
    },
    onError: (err: any) => {
      toast({ title: "Dev accept failed", description: err?.message || "Could not accept.", variant: "destructive" });
    },
  });

  // Update profile mutation for settings
  const updateProfileMutation = useMutation({
    mutationFn: async (data: Partial<Profile> & { id?: number }) => {
      const targetId = data.id || profile?.id;
      const { id: _, ...updateData } = data;
      return apiRequest("PUT", `/api/profiles/${targetId}`, updateData);
    },
    onSuccess: async (_data, variables) => {
      // Invalidate and refetch to ensure fresh data
      await queryClient.invalidateQueries({ queryKey: ["/api/profiles", user?.id] });
      await queryClient.refetchQueries({ queryKey: ["/api/profiles", user?.id] });
      // Geocode backfill only saves lat/lng — find-work already uses server-side address geocode; skipping invalidation avoids list/map flash.
      const v = variables as Record<string, unknown> | undefined;
      const keys = v ? Object.keys(v).filter((k) => k !== "id") : [];
      const onlyGeocodeSync =
        keys.length > 0 && keys.every((k) => k === "latitude" || k === "longitude");
      if (!onlyGeocodeSync) {
        queryClient.invalidateQueries({ queryKey: ["/api/jobs/find-work"] });
      }
      queryClient.invalidateQueries({ queryKey: ["/api/jobs"] });
    },
    onError: (error: any) => {
      console.error("Failed to update profile:", error);
      const errorMessage = error?.message || "Failed to save changes";
      let userMessage = "Could not save changes.";
      
      // Provide specific error messages for common issues
      if (errorMessage.includes("connect to server") || errorMessage.includes("Connection refused")) {
        userMessage = "Unable to connect to server. Please check if the server is running and try again.";
      } else if (errorMessage.includes("401") || errorMessage.includes("Unauthorized")) {
        userMessage = "You are not authorized to update your profile. Please sign in and try again.";
      } else if (errorMessage.includes("403") || errorMessage.includes("Forbidden")) {
        userMessage = "You don't have permission to update this profile. Please contact support if you believe this is an error.";
      } else if (errorMessage.includes("404") || errorMessage.includes("Not Found")) {
        userMessage = "Profile not found. Please refresh the page and try again.";
      } else if (errorMessage.includes("400") || errorMessage.includes("Bad Request")) {
        userMessage = "Invalid data provided. Please check your input and try again.";
      } else if (errorMessage) {
        userMessage = errorMessage;
      }
      
      toast({ 
        title: "Error Saving Changes", 
        description: userMessage,
        variant: "destructive" 
      });
    },
  });

  // Sync form states with profile data
  useEffect(() => {
    if (profile) {
      setSelectedCategories(profile.serviceCategories || []);
      setHourlyRate(rateToDollars(profile.hourlyRate));
      setLocationAddress(profile.address || "");
      setLocationCity(profile.city || "");
      setLocationState(profile.state || "");
      setLocationZip(profile.zipCode || "");
      setLocationLatitude(profile.latitude ?? "");
      setLocationLongitude(profile.longitude ?? "");
      const parts = [profile.address, profile.city, profile.state, profile.zipCode].filter(Boolean);
      setLocationInputValue(parts.length ? parts.join(", ") : "");
    }
  }, [profile]);

  // One-time backfill: geocode profile address when lat/lng missing or junk (0,0) so Find Work radius isn’t wrong
  const hasGeocodeBackfillRun = useRef(false);
  useEffect(() => {
    const lat = profile?.latitude != null ? parseFloat(String(profile.latitude)) : NaN;
    const lng = profile?.longitude != null ? parseFloat(String(profile.longitude)) : NaN;
    const hasPlausibleSavedCoords =
      Number.isFinite(lat) &&
      Number.isFinite(lng) &&
      !(Math.abs(lat) < 1e-5 && Math.abs(lng) < 1e-5) &&
      lat >= -90 &&
      lat <= 90 &&
      lng >= -180 &&
      lng <= 180;
    if (
      hasGeocodeBackfillRun.current ||
      !profile ||
      profile.role !== "worker" ||
      hasPlausibleSavedCoords ||
      !import.meta.env.VITE_GOOGLE_API_KEY
    ) return;
    const parts = [profile.address, profile.city, profile.state, profile.zipCode].filter(Boolean);
    if (parts.length === 0) return;
    hasGeocodeBackfillRun.current = true;
    const addressQuery = parts.join(", ");
    fetch(
      `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(addressQuery)}&key=${import.meta.env.VITE_GOOGLE_API_KEY}`
    )
      .then((res) => res.json())
      .then((data) => {
        if (data.results?.[0]?.geometry?.location) {
          const { lat, lng } = data.results[0].geometry.location;
          updateProfileMutation.mutate({
            latitude: String(lat),
            longitude: String(lng),
          });
        }
      })
      .catch(() => {});
  }, [profile]);

  // Re-run geocode when any teammate address string changes
  const teammateAddressKey = useMemo(
    () =>
      activeTeamMembers
        .map((m) => `${m.id}:${m.address ?? ""},${m.city ?? ""},${m.state ?? ""},${m.zipCode ?? ""}`)
        .join(";"),
    [activeTeamMembers]
  );

  // Use account-record addresses when lat/lng missing: geocode profile + teammates and cache for referenceLocations.
  // For teammates, use the entered address directly (no ipapi); re-geocode when address changes.
  const geocodeRequestedRef = useRef<Set<string>>(new Set());
  const lastGeocodeQueryRef = useRef<Record<string, string>>({});
  useEffect(() => {
    const apiKey = import.meta.env.VITE_GOOGLE_API_KEY;
    if (!apiKey) return;

    const geocode = (addressQuery: string): Promise<{ lat: number; lng: number } | null> =>
      fetch(
        `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(addressQuery)}&key=${apiKey}`
      )
        .then((res) => res.json())
        .then((data) => {
          const loc = data.results?.[0]?.geometry?.location;
          return loc ? { lat: loc.lat, lng: loc.lng } : null;
        })
        .catch(() => null);

    const toUpdate: Array<{ key: string; query: string }> = [];

    if (profile?.role === "worker") {
      const hasCoords = profile.latitude && profile.longitude;
      if (!hasCoords) {
        const parts = [profile.address, profile.city, profile.state, profile.zipCode].filter(Boolean);
        const query = parts.join(", ");
        if (parts.length > 0) {
          if (lastGeocodeQueryRef.current["profile"] !== query) {
            lastGeocodeQueryRef.current["profile"] = query;
            geocodeRequestedRef.current.delete("profile");
          }
          if (!geocodeRequestedRef.current.has("profile")) {
            geocodeRequestedRef.current.add("profile");
            toUpdate.push({ key: "profile", query });
          }
        }
      }
    }

    activeTeamMembers.forEach((m) => {
      const hasCoords = m.latitude != null && m.longitude != null;
      if (hasCoords) return;
      const parts = [m.address, m.city, m.state, m.zipCode].filter(Boolean);
      const key = `member-${m.id}`;
      const query = parts.join(", ");
      if (parts.length > 0) {
        if (lastGeocodeQueryRef.current[key] !== query) {
          lastGeocodeQueryRef.current[key] = query;
          geocodeRequestedRef.current.delete(key);
        }
        if (!geocodeRequestedRef.current.has(key)) {
          geocodeRequestedRef.current.add(key);
          toUpdate.push({ key, query });
        }
      }
    });

    toUpdate.forEach(({ key, query }) => {
      geocode(query).then((point) => {
        if (point) setGeocodedAddressCache((prev) => ({ ...prev, [key]: point }));
      });
    });
  }, [
    profile?.role,
    profile?.latitude,
    profile?.longitude,
    profile?.address,
    profile?.city,
    profile?.state,
    profile?.zipCode,
    activeTeamMembers,
    teammateAddressKey,
  ]);

  // Toggle skill category with Lite/Elite mutual exclusivity
  const toggleCategory = (category: string, teammateId?: number) => {
    if (teammateId) {
      // Toggle for teammate
      setTeammateSkillsets((prev) => {
        const current = prev[teammateId] || [];
        let updated: string[];
        
        if (current.includes(category)) {
          updated = current.filter((c) => c !== category);
        } else {
          // Handle Lite/Elite mutual exclusivity
          const baseName = category.replace(" Lite", "").replace(" Elite", "");
          const isLite = category.includes("Lite");
          const isElite = category.includes("Elite");
          
          if (isLite || isElite) {
            const oppositeId = isLite ? `${baseName} Elite` : `${baseName} Lite`;
            updated = [...current.filter((c) => c !== oppositeId), category];
          } else {
            updated = [...current, category];
          }
        }
        
        return { ...prev, [teammateId]: updated };
      });
    } else {
      // Toggle for self
      setSelectedCategories((prev) => {
        if (prev.includes(category)) {
          return prev.filter((c) => c !== category);
        }
        
        // Handle Lite/Elite mutual exclusivity
        const baseName = category.replace(" Lite", "").replace(" Elite", "");
        const isLite = category.includes("Lite");
        const isElite = category.includes("Elite");
        
        if (isLite || isElite) {
          const oppositeId = isLite ? `${baseName} Elite` : `${baseName} Lite`;
          return [...prev.filter((c) => c !== oppositeId), category];
        }
        
        return [...prev, category];
      });
    }
  };

  // Toggle industry expansion
  const toggleIndustryExpansion = (industryId: string) => {
    setExpandedIndustries((prev) =>
      prev.includes(industryId)
        ? prev.filter((id) => id !== industryId)
        : [...prev, industryId]
    );
  };

  // Get count of selected roles in an industry
  const getSelectedCountForIndustry = (industryId: string) => {
    const industry = INDUSTRY_CATEGORIES.find((cat) => cat.id === industryId);
    if (!industry) return 0;
    return industry.roles.filter((role) => selectedCategories.includes(role.id)).length;
  };

  // Save skillset
  const saveSkillset = (teammateId?: number) => {
    if (teammateId) {
      // Save teammate's skillsets
      const teammate = activeTeamMembers.find((m) => m.id === teammateId);
      if (!teammate) return;
      
      const skillsToSave = teammateSkillsets[teammateId] || teammate.skillsets || [];
      
      updateProfileMutation.mutate({ 
        id: teammateId,
        serviceCategories: skillsToSave 
      }, {
        onSuccess: () => {
          toast({ 
            title: "Skills updated!", 
            description: `${teammate.firstName}'s skills have been saved.` 
          });
          // Clear the editing state for this teammate
          setTeammateSkillsets((prev) => {
            const newState = { ...prev };
            delete newState[teammateId];
            return newState;
          });
          // Refresh team members data
          queryClient.invalidateQueries({ queryKey: ["/api/team-members"] });
          setSkillsetDialogOpen(false);
          setQuickSettingsSubView("list");
          setQuickSettingsSelectedPerson(null);
        },
        onError: (error: any) => {
          console.error("Failed to save teammate skillset:", error);
          toast({
            title: "Error saving skills",
            description: "Failed to update teammate skills. Please try again.",
            variant: "destructive"
          });
        }
      });
    } else {
      // Save own skillsets
      updateProfileMutation.mutate({ serviceCategories: selectedCategories }, {
        onSuccess: () => {
          toast({ title: "Skills updated!", description: "Your skills have been saved." });
          setSkillsetDialogOpen(false);
          setQuickSettingsSubView("list");
          setQuickSettingsSelectedPerson(null);
        },
        onError: (error: any) => {
          console.error("Failed to save skillset:", error);
        }
      });
    }
  };

  // Save rate
  const saveRate = () => {
    updateProfileMutation.mutate({ hourlyRate }, {
      onSuccess: () => {
        toast({ title: "Rate updated!", description: `Your hourly rate is now $${hourlyRate}/hr.` });
        setRateDialogOpen(false);
        setQuickSettingsSubView("list");
        setQuickSettingsSelectedPerson(null);
      },
      onError: (error: any) => {
        // Error is already handled by mutation's onError, but we can add specific handling here if needed
        console.error("Failed to save rate:", error);
      }
    });
  };

  // Save location (use lat/lng from Google suggest dropdown when set; else geocode for distance filtering)
  const saveLocation = async () => {
    const basePayload: Record<string, unknown> = {
      address: locationAddress,
      city: locationCity,
      state: locationState,
      zipCode: locationZip,
    };
    if (locationLatitude?.trim() && locationLongitude?.trim()) {
      basePayload.latitude = locationLatitude.trim();
      basePayload.longitude = locationLongitude.trim();
      updateProfileMutation.mutate(basePayload as any, {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: ["/api/jobs/find-work"] });
          toast({ title: "Location updated!", description: "Your location has been saved. Find Work will filter jobs by distance." });
          setQuickSettingsSubView("list");
          setQuickSettingsSelectedPerson(null);
        },
        onError: (error: any) => console.error("Failed to save location:", error),
      });
      return;
    }
    const parts = [locationAddress, locationCity, locationState, locationZip].filter(Boolean);
    const addressQuery = parts.join(", ");
    const apiKey = import.meta.env.VITE_GOOGLE_API_KEY;

    if (addressQuery && apiKey) {
      try {
        const res = await fetch(
          `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(addressQuery)}&key=${apiKey}`
        );
        const data = await res.json();
        if (data.results?.[0]?.geometry?.location) {
          const { lat, lng } = data.results[0].geometry.location;
          updateProfileMutation.mutate({
            ...basePayload,
            latitude: String(lat),
            longitude: String(lng),
          }, {
            onSuccess: () => {
              queryClient.invalidateQueries({ queryKey: ["/api/jobs/find-work"] });
              toast({ title: "Location updated!", description: "Your location has been saved. Find Work will filter jobs by distance." });
              setQuickSettingsSubView("list");
              setQuickSettingsSelectedPerson(null);
            },
            onError: (error: any) => {
              console.error("Failed to save location:", error);
            }
          });
          return;
        }
      } catch (e) {
        console.warn("Geocode failed, saving address only:", e);
      }
    }

    updateProfileMutation.mutate(basePayload as any, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ["/api/jobs/find-work"] });
        toast({ title: "Location updated!", description: "Address saved. Use “Use my location” or add city/state/zip and save again for distance filtering." });
        setQuickSettingsSubView("list");
        setQuickSettingsSelectedPerson(null);
      },
      onError: (error: any) => {
        console.error("Failed to save location:", error);
      }
    });
  };

  // Get current location using browser API
  const getCurrentLocation = () => {
    if (!navigator.geolocation) {
      toast({ title: "Error", description: "Geolocation is not supported by your browser.", variant: "destructive" });
      return;
    }

    setIsGettingLocation(true);
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        try {
          // Use reverse geocoding to get address from coordinates
          const { latitude, longitude } = position.coords;
          const response = await fetch(
            `https://maps.googleapis.com/maps/api/geocode/json?latlng=${latitude},${longitude}&key=${import.meta.env.VITE_GOOGLE_API_KEY}`
          );
          const data = await response.json();
          
          if (data.results && data.results.length > 0) {
            const result = data.results[0];
            const components = result.address_components;
            
            let streetNumber = "";
            let streetName = "";
            let city = "";
            let state = "";
            let zip = "";
            
            for (const component of components) {
              if (component.types.includes("street_number")) {
                streetNumber = component.long_name;
              } else if (component.types.includes("route")) {
                streetName = component.long_name;
              } else if (component.types.includes("locality")) {
                city = component.long_name;
              } else if (component.types.includes("administrative_area_level_1")) {
                state = component.short_name;
              } else if (component.types.includes("postal_code")) {
                zip = component.long_name;
              }
            }
            
            const addr = `${streetNumber} ${streetName}`.trim();
            setLocationAddress(addr);
            setLocationCity(city);
            setLocationState(state);
            setLocationZip(zip);
            setLocationInputValue([addr, city, state, zip].filter(Boolean).join(", "));

            // Also update the profile with lat/lng
            updateProfileMutation.mutate({
              address: addr,
              city,
              state,
              zipCode: zip,
              latitude: latitude.toString(),
              longitude: longitude.toString(),
            }, {
              onSuccess: () => {
                toast({ title: "Location updated!", description: "Your location has been detected and saved." });
              },
              onError: (error: any) => {
                // Error is already handled by mutation's onError
                console.error("Failed to save detected location:", error);
              }
            });
          }
        } catch (error) {
          toast({ title: "Error", description: "Could not get address from location.", variant: "destructive" });
        }
        setIsGettingLocation(false);
      },
      (error) => {
        setIsGettingLocation(false);
        toast({ title: "Error", description: "Could not get your location. Please enter it manually.", variant: "destructive" });
      }
    );
  };

  // Open quick settings dialog (breadcrumbed: main → list → edit)
  const openQuickSettings = (view: QuickSettingsView = "main") => {
    setQuickSettingsView(view);
    setQuickSettingsSubView("list");
    setQuickSettingsSelectedPerson(null);
    setQuickSettingsFilter("all");
    setQuickSettingsOpen(true);
  };

  const quickSettingsBack = () => {
    if (quickSettingsSubView === "edit") {
      setQuickSettingsSubView("list");
      setQuickSettingsSelectedPerson(null);
    } else if (quickSettingsView !== "main") {
      setQuickSettingsView("main");
      setQuickSettingsSubView("list");
      setQuickSettingsSelectedPerson(null);
      setQuickSettingsFilter("all");
    }
  };

  const quickSettingsClose = () => {
    setQuickSettingsOpen(false);
    setQuickSettingsView("main");
    setQuickSettingsSubView("list");
    setQuickSettingsSelectedPerson(null);
    setQuickSettingsFilter("all");
    setTeammateSettingsOpen(false);
    setSelectedTeammateForSettings(null);
    cleanupOverlays();
  };

  // Find Work: Handle dismiss job
  const dismissUndoToastIdRef = useRef<string | null>(null);
  const handleDismissJob = (job: Job) => {
    if (!profile?.id) return;
    const workerId = profile.id;
    const jobId = job.id;
    dismissJobMutation.mutate(
      { workerId, jobId, reason: dismissReason || "not_interested" },
      {
        onSuccess: () => {
          const { id: toastId } = toast({
            title: "Job hidden",
            description: "This job won't appear in your feed anymore.",
            action: (
              <button
                type="button"
                className="shrink-0 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-muted transition-colors"
                onClick={(e) => {
                  e.stopPropagation();
                  if (dismissUndoToastIdRef.current) dismissToast(dismissUndoToastIdRef.current);
                  undismissJobMutation.mutate({ workerId, jobId });
                }}
              >
                Undo
              </button>
            ),
            duration: 6000,
          });
          dismissUndoToastIdRef.current = toastId;
          setJobToDismiss(null);
          setDismissReason("");
        },
      }
    );
  };


  // Calculate smart rate suggestion for dashboard apply - intelligent based on job requirements
  const smartRateSuggestionDashboard = useMemo(() => {
    if (!applyJob) return 20;
    const userRate = profile?.hourlyRate || 30;
    const selectedWorkerCount = selectedApplicants.size || 1;
    
    // Base rate factors
    const jobRate = applyJob.hourlyRate ? applyJob.hourlyRate / 100 : null;
    
    // Trade premium multipliers (higher-paying trades)
    const tradePremiums: Record<string, number> = {
      "Electrical": 1.15,
      "Plumbing": 1.12,
      "HVAC": 1.10,
      "Carpentry": 1.08,
      "Concrete": 1.05,
      "Drywall": 1.03,
      "Painting": 1.02,
      "General Labor": 1.0,
      "Demolition": 1.0,
      "Cleaning": 0.95,
    };
    
    // Skill level multipliers
    const skillLevelMultipliers: Record<string, number> = {
      "elite": 1.12,
      "lite": 1.05,
      "any": 1.0,
    };
    
    // Calculate base competitive rate
    let baseRate: number;
    
    // Use budget if available (most accurate)
    if (applyJob.budgetCents) {
      const totalBudget = applyJob.budgetCents / 100;
      const hoursPerWorker = applyJob.estimatedHours || 8;
      const budgetRate = totalBudget / (hoursPerWorker * selectedWorkerCount);
      // Budget rate minus small buffer for competitiveness
      baseRate = budgetRate * 0.92;
    } else if (jobRate) {
      // Use job rate with competitive discount
      baseRate = jobRate * 0.88;
    } else {
      // Fallback to user rate
      baseRate = userRate * 0.85;
    }
    
    // Apply trade premium
    const trade = applyJob.trade || "General Labor";
    const tradeMultiplier = tradePremiums[trade] || 1.0;
    baseRate *= tradeMultiplier;
    
    // Apply skill level premium
    const skillLevel = applyJob.skillLevel || "any";
    const skillMultiplier = skillLevelMultipliers[skillLevel] || 1.0;
    baseRate *= skillMultiplier;
    
    // Apply service category premium (if it contains "Elite" or "Lite")
    if (applyJob.serviceCategory) {
      if (applyJob.serviceCategory.includes("Elite")) {
        baseRate *= 1.10;
      } else if (applyJob.serviceCategory.includes("Lite")) {
        baseRate *= 1.04;
      }
    }
    
    // Required skills complexity (more skills = slightly higher rate)
    const requiredSkillsCount = applyJob.requiredSkills?.length || 0;
    if (requiredSkillsCount > 0) {
      const skillsMultiplier = 1 + (Math.min(requiredSkillsCount, 5) * 0.01); // Max 5% boost
      baseRate *= skillsMultiplier;
    }
    
    // Ensure minimum $15 and maximum $25.99
    let finalRate = Math.max(15, Math.min(baseRate, 25.99));
    
    // Round to 2 decimal places
    finalRate = Math.round(finalRate * 100) / 100;
    
    // If user's rate is lower, don't suggest above it (unless job clearly pays more)
    if (finalRate > userRate && jobRate && jobRate <= userRate) {
      finalRate = Math.min(finalRate, userRate * 0.98);
    }
    
    return finalRate;
  }, [applyJob, profile?.hourlyRate, selectedApplicants.size]);

  // Calculate selected rate for display
  const getSelectedRateDashboard = useMemo(() => {
    if (!applyJob || selectedApplicants.size === 0) return null;
    
    if (useSmartRateDashboard || suggestedApplicationRate) {
      return useSmartRateDashboard ? smartRateSuggestionDashboard : suggestedApplicationRate;
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
  }, [selectedApplicants, useSmartRateDashboard, suggestedApplicationRate, smartRateSuggestionDashboard, profile?.hourlyRate, activeTeamMembers, applyJob]);

  // Calculate combined payout
  const combinedPayoutDashboard = useMemo(() => {
    if (!applyJob) return 0;
    const hours = applyJob.estimatedHours || 8;
    let totalPayout = 0;
    
    selectedApplicants.forEach(id => {
      const rate = useSmartRateDashboard || suggestedApplicationRate 
        ? (useSmartRateDashboard ? smartRateSuggestionDashboard : suggestedApplicationRate!)
        : (id === "self" 
          ? (profile?.hourlyRate || 30) 
          : (activeTeamMembers.find(m => m.id === id)?.hourlyRate || 30));
      totalPayout += rate * hours;
    });
    
    return totalPayout;
  }, [selectedApplicants, profile?.hourlyRate, activeTeamMembers, applyJob?.estimatedHours, useSmartRateDashboard, suggestedApplicationRate, smartRateSuggestionDashboard]);

  // Fetch company profile for stage 2
  const { data: companyProfileDashboard } = useQuery<Profile | null>({
    queryKey: ["/api/profiles", applyJob?.companyId],
    queryFn: async () => {
      if (!applyJob?.companyId) return null;
      const res = await fetch(`/api/profiles/${applyJob.companyId}`);
      if (!res.ok) return null;
      return res.json();
    },
    enabled: !!applyJob?.companyId && !!applyJob,
  });

  // Find Work: Handle apply for job
  const handleApplyForJob = async () => {
    if (!applyJob || !profile?.id) return;

    setIsSubmitting(true);
    try {
      const sanitizedMessage = sanitizeMessage(applicationMessage);
      const workersNeeded = applyJob.maxWorkersNeeded ?? 1;
      const useMultiSelect = workersNeeded > 1 && activeTeamMembers.length > 0 && profile?.isBusinessOperator;
      
      if (useMultiSelect) {
        // Multi-worker application
        // Filter out pending members - only active members can be assigned to jobs
        const applicants = Array.from(selectedApplicants).filter(id => {
          if (id === "self") return true;
          const member = allTeamMembersForApply.find(m => m.id === id);
          return member && (member.status === "active" || !member.status);
        });
        
        for (const applicantId of applicants) {
          const applicationData: {
            jobId: number;
            workerId: number;
            message?: string;
            teamMemberId?: number;
            proposedRate?: number;
          } = { 
            jobId: applyJob.id, 
            workerId: profile.id,
            message: sanitizedMessage || undefined
          };
          
          if (applicantId !== "self") {
            const teamMember = activeTeamMembers.find(m => m.id === applicantId);
            if (teamMember) {
              applicationData.teamMemberId = teamMember.id;
              // Use smart rate if enabled, then suggested rate, otherwise use team member's rate
              applicationData.proposedRate = useSmartRateDashboard 
                ? smartRateSuggestionDashboard 
                : (suggestedApplicationRate || teamMember.hourlyRate);
            }
          } else {
            // Use smart rate if enabled, then suggested rate, otherwise use profile rate
            applicationData.proposedRate = useSmartRateDashboard 
              ? smartRateSuggestionDashboard 
              : (suggestedApplicationRate || profile.hourlyRate || undefined);
          }
          
          await apiRequest("POST", "/api/applications", applicationData);
        }
        
        toast({ 
          title: applicants.length > 1 ? "Applications sent!" : "Application sent!", 
          description: applicants.length > 1 
            ? `Applied ${applicants.length} workers for ${applyJob.title}`
            : "The company will review your application." 
        });
      } else {
        // Single worker application (legacy flow)
        const applicationData: {
          jobId: number;
          workerId: number;
          message?: string;
          teamMemberId?: number;
          proposedRate?: number;
        } = { 
          jobId: applyJob.id, 
          workerId: profile.id,
          message: sanitizedMessage || undefined
        };
        
        // If applying for a team member, include their ID and their rate
        if (selectedTeamMemberId !== "self") {
          const teamMember = activeTeamMembers.find(m => m.id === parseInt(selectedTeamMemberId));
          if (teamMember) {
            applicationData.teamMemberId = teamMember.id;
            // Use smart rate if enabled, then suggested rate, otherwise use team member's rate
            applicationData.proposedRate = useSmartRateDashboard 
              ? smartRateSuggestionDashboard 
              : (suggestedApplicationRate || teamMember.hourlyRate);
          }
        } else {
          // Use smart rate if enabled, then suggested rate, otherwise use profile rate
          applicationData.proposedRate = useSmartRateDashboard 
            ? smartRateSuggestionDashboard 
            : (suggestedApplicationRate || profile.hourlyRate || undefined);
        }
        
        await apiRequest("POST", "/api/applications", applicationData);
        toast({ title: "Application sent!", description: "The company will review your application." });
      }
      setApplyJob(null);
      setApplyStage(1);
      setApplicationMessage("");
      setSelectedTeamMemberId("self");
      setSelectedApplicants(new Set(["self"]));
      setSuggestedApplicationRate(null);
      setUseSmartRateDashboard(false);
      queryClient.invalidateQueries({ queryKey: ["/api/jobs/find-work"] });
      queryClient.invalidateQueries({ queryKey: ["/api/applications/worker", profile.id] });
    } catch (error) {
      const msg = error instanceof Error ? error.message : "";
      const alreadyApplied = /already applied|duplicate|unique/i.test(msg);
      toast({
        title: "Error",
        description: alreadyApplied ? "You have already applied to this job." : (msg || "Could not send application. Please try again."),
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

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

  // Helper function to sanitize message (block SMS, phone, emails, websites)
  const sanitizeMessage = useCallback((message: string): string => {
    if (!message) return "";
    
    // Remove phone numbers (various formats)
    let sanitized = message.replace(/\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/g, '[Phone number removed]');
    sanitized = sanitized.replace(/\b\(\d{3}\)\s?\d{3}[-.]?\d{4}\b/g, '[Phone number removed]');
    sanitized = sanitized.replace(/\b\d{10}\b/g, '[Phone number removed]');
    
    // Remove email addresses
    sanitized = sanitized.replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, '[Email removed]');
    
    // Remove URLs/websites
    sanitized = sanitized.replace(/https?:\/\/[^\s]+/g, '[Website removed]');
    sanitized = sanitized.replace(/\bwww\.[^\s]+/g, '[Website removed]');
    sanitized = sanitized.replace(/\b[A-Za-z0-9-]+\.[A-Za-z]{2,}\b/g, (match) => {
      // Only remove if it looks like a domain (not common words)
      const commonWords = ['com', 'org', 'net', 'edu', 'gov', 'io', 'co', 'uk', 'ca', 'au'];
      if (commonWords.some(ext => match.toLowerCase().endsWith('.' + ext))) {
        return '[Website removed]';
      }
      return match;
    });
    
    return sanitized.trim();
  }, []);

  // Use tested lib: Lite/Elite jobs always require skill match; general labor allowed for all.
  const jobRequiresLiteOrElite = useCallback((job: Job) => jobRequiresLiteOrEliteLib(job), []);
  const checkSkillMatch = useCallback((personSkills: string[] | null | undefined, job: Job) => checkSkillMatchLib(personSkills, job), []);

  // Helper function to check if job fits in schedule (no conflicts)
  const checkScheduleFit = useCallback(async (job: Job, workerId: number | "self"): Promise<boolean> => {
    try {
      // Get worker's applications to check for schedule conflicts
      const workerIdToCheck = workerId === "self" ? profile?.id : workerId;
      if (!workerIdToCheck) return false;
      
      const res = await fetch(`/api/applications/worker/${workerIdToCheck}`, { credentials: "include" });
      if (!res.ok) return false;
      const raw = await res.json();
      const applications = Array.isArray(raw) ? raw : [];
      
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
    if (workerId !== "self") {
      const member = allTeamMembersForApply.find(m => m.id === workerId);
      if (member?.status === "pending") return false;
    }
    // Skill rules: general labor jobs are allowed for all; Lite/Elite jobs (Electrical, Plumbing, HVAC, Carpentry) always require a match.
    const requiresLiteOrElite = jobRequiresLiteOrElite(job);
    if (requiresLiteOrElite) {
      let personSkills: string[] | null | undefined;
      if (workerId === "self") {
        personSkills = profile?.skillsets as string[] | null | undefined;
      } else {
        const member = allTeamMembersForApply.find(m => m.id === workerId);
        personSkills = member?.skillsets as string[] | null | undefined;
      }
      if (!checkSkillMatch(personSkills, job)) return false;
    }
    // When "Apply only to skill-set matches" is on, general labor is still allowed for all (no extra check).
    
    // Distance: 15mi from each worker's own location (admin address/lat-lng or teammate start address/lat-lng)
    const member = workerId === "self" ? null : allTeamMembersForApply.find(m => m.id === workerId);
    const workerLat = workerId === "self"
      ? (profile?.latitude ? parseFloat(profile.latitude) : null)
      : (member?.latitude ? parseFloat(member.latitude) : null);
    const workerLng = workerId === "self"
      ? (profile?.longitude ? parseFloat(profile.longitude) : null)
      : (member?.longitude ? parseFloat(member.longitude) : null);

    if (!workerLat || !workerLng || !job.latitude || !job.longitude) {
      return false;
    }

    const distance = calculateDistanceMiles(workerLat, workerLng, parseFloat(job.latitude), parseFloat(job.longitude));
    const maxMiles = Math.min(30, Math.max(1, aiDispatchMaxDistance));
    if (distance > maxMiles) {
      return false;
    }
    
    // Check time window if enabled
    if (aiDispatchTimeWindowEnabled && job.startDate) {
      const jobStartDate = new Date(job.startDate);
      const jobHour = jobStartDate.getHours();
      const jobMinutes = jobStartDate.getMinutes();
      const jobTimeMinutes = jobHour * 60 + jobMinutes;
      
      const [startHour, startMin] = aiDispatchStartTime.split(':').map(Number);
      const [endHour, endMin] = aiDispatchEndTime.split(':').map(Number);
      const startTimeMinutes = startHour * 60 + startMin;
      const endTimeMinutes = endHour * 60 + endMin;
      
      // Check if job time is within window
      if (jobTimeMinutes < startTimeMinutes || jobTimeMinutes > endTimeMinutes) {
        return false;
      }
    }
    
    // Check schedule fit (open schedules and availability)
    const scheduleFits = await checkScheduleFit(job, workerId);
    if (!scheduleFits) {
      return false;
    }
    
    return true;
  }, [profile, allTeamMembersForApply, aiDispatchTimeWindowEnabled, aiDispatchStartTime, aiDispatchEndTime, aiDispatchMaxDistance, jobRequiresLiteOrElite, checkSkillMatch, calculateDistanceMiles, checkScheduleFit]);

  const aiDispatchPrevEnabled = useRef(false);
  // Auto-apply effect - runs immediately when toggled ON, then debounced when jobs change
  useEffect(() => {
    if (!aiDispatchEnabled || !sortedFindWorkJobs || !profile || aiDispatchTeammates.size === 0) {
      aiDispatchPrevEnabled.current = false;
      return;
    }
    
    const autoApplyToMatchingJobs = async () => {
      for (const job of sortedFindWorkJobs) {
        // Skip if already applied
        const alreadyApplied = applications.some(app => app.jobId === job.id);
        if (alreadyApplied) continue;
        
        // Check each selected teammate (admin + teammates); skip pending; assign the first worker whose radius contains the job
        for (const workerId of Array.from(aiDispatchTeammates)) {
          if (workerId !== "self") {
            const member = allTeamMembersForApply.find(m => m.id === workerId);
            if (member?.status === "pending") continue;
          }
          const matches = await jobMatchesAiDispatchCriteria(job, workerId);
          if (matches) {
            try {
              const member = workerId === "self" ? null : allTeamMembersForApply.find(m => m.id === workerId);
              const applicants = workerId === "self"
                ? [{ id: "self" as const, name: `${profile.firstName} ${profile.lastName}` }]
                : (member ? [{ id: workerId, name: `${member.firstName} ${member.lastName}` }] : []);
              
              if (applicants.length === 0) continue;
              
              let proposedRate: number | undefined = undefined;
              if (aiDispatchRateAdjustments && job.hourlyRate) {
                const jobRate = job.hourlyRate;
                const workerRate = workerId === "self"
                  ? (profile?.hourlyRate || 30)
                  : (member?.hourlyRate ?? 30);
                
                // Use competitive rate: job rate if it's higher, otherwise worker rate with small discount
                proposedRate = Math.max(workerRate * 0.95, Math.min(jobRate, workerRate));
              }
              
              // Sanitize message
              const sanitizedMessage = aiDispatchMessage ? sanitizeMessage(aiDispatchMessage) : null;
              
              const res = await fetch("/api/applications", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  jobId: job.id,
                  message: sanitizedMessage,
                  applicants,
                  teamMemberId: workerId === "self" ? null : workerId,
                  proposedRate: proposedRate ? Math.round(proposedRate * 100) : undefined,
                  isAiDispatched: true,
                }),
                credentials: "include",
              });
              
              if (res.ok) {
                toast({
                  title: "Auto-applied to job",
                  description: `Applied to "${job.title}" for ${applicants[0].name}`,
                });
                queryClient.invalidateQueries({ queryKey: ["/api/applications/worker", profile.id] });
                break; // One application per job (unique constraint); move to next job
              }
            } catch (error) {
              console.error("Error auto-applying to job:", error);
            }
          }
        }
      }
    };
    
    const justEnabled = !aiDispatchPrevEnabled.current;
    aiDispatchPrevEnabled.current = true;
    if (justEnabled) void autoApplyToMatchingJobs();
    const timeoutId = setTimeout(autoApplyToMatchingJobs, 2000);
    return () => clearTimeout(timeoutId);
  }, [sortedFindWorkJobs, aiDispatchEnabled, aiDispatchTeammates, profile, applications, jobMatchesAiDispatchCriteria, allTeamMembersForApply, toast, queryClient, aiDispatchMessage, aiDispatchRateAdjustments, sanitizeMessage]);

  // Filter jobs by distance and skills
  const filteredJobs = useMemo(() => {
    return allJobs.filter((job) => {
      if (!profile) return false;
      
      // Filter by distance (100 miles)
      if (profile.latitude && profile.longitude && job.latitude && job.longitude) {
        const distance = calculateDistance(
          parseFloat(profile.latitude),
          parseFloat(profile.longitude),
          parseFloat(job.latitude as string),
          parseFloat(job.longitude as string)
        );
        if (distance > 100) return false;
        (job as JobWithDistance).distance = Math.round(distance);
      }
      
      // Filter by skills
      if (job.serviceCategory && profile.serviceCategories) {
        const workerCategories = profile.serviceCategories;
        const jobCategory = job.serviceCategory;
        
        // Check if worker has the required skill
        if (job.skillLevel === "elite") {
          // Must have elite version of the skill
          if (!workerCategories.includes(`${jobCategory} Elite`)) return false;
        } else if (job.skillLevel === "lite") {
          // Lite OR Elite both qualify
          if (!workerCategories.includes(`${jobCategory} Lite`) && 
              !workerCategories.includes(`${jobCategory} Elite`)) return false;
        }
      }
      
      // Only show open jobs
      if (job.status !== "open") return false;
      
      // Don't show jobs already applied to
      const alreadyApplied = applications.some(app => app.jobId === job.id);
      if (alreadyApplied) return false;
      
      return true;
    }).sort((a, b) => (a.distance || 0) - (b.distance || 0));
  }, [allJobs, profile, applications]);

  // Group applications by status, sorted by job start date (undated jobs at end)
  const sortApplicationsByDate = useCallback((apps: ApplicationWithDetails[]) => {
    return [...apps].sort((a, b) => {
      const jobA = allJobs.find(j => j.id === a.jobId);
      const jobB = allJobs.find(j => j.id === b.jobId);
      const FAR_FUTURE = new Date("2099-12-31").getTime();
      const dateA = jobA?.startDate ? new Date(jobA.startDate).getTime() : FAR_FUTURE;
      const dateB = jobB?.startDate ? new Date(jobB.startDate).getTime() : FAR_FUTURE;
      return dateA - dateB;
    });
  }, [allJobs]);
  
  const pendingApplications = useMemo(() => sortApplicationsByDate(applications.filter(app => app.status === "pending")), [applications, sortApplicationsByDate]);
  const acceptedApplications = useMemo(() => sortApplicationsByDate(applications.filter(app => app.status === "accepted")), [applications, sortApplicationsByDate]);
  const rejectedApplications = useMemo(() => applications.filter(app => app.status === "rejected"), [applications]);

  // Calendar: when offline use cached accepted applications only
  const calendarApplications = useMemo(() => {
    if (isOnline) return applications;
    const cached = (cachedAcceptedApplications ?? []) as ApplicationWithDetails[];
    return cached.filter((a: ApplicationWithDetails) => a.status === "accepted");
  }, [isOnline, applications, cachedAcceptedApplications]);
  
  // Group applications by jobId for overlapping avatar display
  const groupApplicationsByJob = useCallback((apps: ApplicationWithDetails[]) => {
    const grouped = new Map<number, ApplicationWithDetails[]>();
    apps.forEach(app => {
      const existing = grouped.get(app.jobId) || [];
      grouped.set(app.jobId, [...existing, app]);
    });
    return Array.from(grouped.entries()).map(([jobId, apps]) => ({
      jobId,
      applications: apps,
      primaryApp: apps[0], // Use first app as primary for card rendering
    }));
  }, []);
  
  // Filter applications based on worker filter
  const filterApplicationsByWorker = useCallback((apps: ApplicationWithDetails[]) => {
    if (jobsWorkerFilter === "all") return apps;
    if (jobsWorkerFilter === "self") {
      return apps.filter(app => !app.teamMemberId);
    }
    const memberId = parseInt(jobsWorkerFilter, 10);
    return apps.filter(app => app.teamMemberId === memberId);
  }, [jobsWorkerFilter]);
  
  const filteredPendingApplications = useMemo(() => filterApplicationsByWorker(pendingApplications), [pendingApplications, filterApplicationsByWorker]);
  const filteredAcceptedApplications = useMemo(() => filterApplicationsByWorker(acceptedApplications), [acceptedApplications, filterApplicationsByWorker]);
  const filteredRejectedApplications = useMemo(() => filterApplicationsByWorker(rejectedApplications), [rejectedApplications, filterApplicationsByWorker]);
  
  const groupedPendingApplications = useMemo(() => groupApplicationsByJob(filteredPendingApplications), [filteredPendingApplications, groupApplicationsByJob]);
  const groupedAcceptedApplications = useMemo(() => groupApplicationsByJob(filteredAcceptedApplications), [filteredAcceptedApplications, groupApplicationsByJob]);
  
  // Get job time type label (One-Day, Recurring, On-Demand) — used for badges on pending and accepted cards
  const getJobCategoryLabel = (job: Job): { label: string; color: string } => {
    if (job.jobType === "recurring") {
      return { label: "Recurring", color: "bg-purple-500" };
    }
    if (job.jobType === "on_demand" || job.isOnDemand) {
      return { label: "On-Demand", color: "bg-orange-500" };
    }
    return { label: "One-Day", color: "bg-blue-500" };
  };

  const parseTimeToHours = (timeValue: string): number | null => {
    const s = (timeValue || "").trim();
    if (!s) return null;
    const ampm = s.match(/(\d+):?(\d*)?\s*(AM|PM)/i);
    if (ampm) {
      let h = parseInt(ampm[1], 10);
      const m = parseInt(ampm[2] || "0", 10);
      if (Number.isNaN(h) || Number.isNaN(m)) return null;
      if (ampm[3].toUpperCase() === "PM" && h !== 12) h += 12;
      if (ampm[3].toUpperCase() === "AM" && h === 12) h = 0;
      return h + m / 60;
    }
    const parts = s.split(":");
    if (parts.length >= 1) {
      const hh = parseInt((parts[0] || "").replace(/\D/g, ""), 10);
      const mm = parseInt((parts[1] || "").replace(/\D/g, ""), 10) || 0;
      if (!Number.isNaN(hh) && !Number.isNaN(mm)) return hh + mm / 60;
    }
    return null;
  };

  const getDailyScheduledHours = (job: Job): number | null => {
    if (!job.scheduledTime || !job.endTime) return null;
    const startStr = startTimeOnly(formatTimeString(job.scheduledTime));
    const endStr = endTimeOnly(formatTimeString(job.endTime));
    const startH = parseTimeToHours(startStr);
    const endH = parseTimeToHours(endStr);
    if (startH == null || endH == null || endH <= startH) return null;
    const hours = endH - startH;
    if (hours <= 0 || hours > 24) return null;
    return hours;
  };

  const getBillableHoursForPayout = (job: Job): number => {
    // estimatedHours is the canonical total hours for payout when provided.
    if (typeof job.estimatedHours === "number" && job.estimatedHours > 0) {
      return job.estimatedHours;
    }

    if (job.jobType === "recurring" && job.startDate) {
      const recurringDays = job.scheduleDays || (job as { recurringDays?: string[] }).recurringDays;
      const dailyHours = getDailyScheduledHours(job);
      if (dailyHours != null && recurringDays && recurringDays.length > 0) {
        const startDate = parseISO(String(job.startDate));
        let periodEnd: Date | null = null;
        if (job.endDate) {
          const e = parseISO(String(job.endDate));
          if (!Number.isNaN(e.getTime())) periodEnd = e;
        } else if ((job as any).recurringWeeks && Number((job as any).recurringWeeks) > 0) {
          const e = new Date(startDate);
          e.setDate(e.getDate() + Number((job as any).recurringWeeks) * 7);
          periodEnd = e;
        } else if ((job as any).recurringMonths && Number((job as any).recurringMonths) > 0) {
          periodEnd = addMonths(startDate, Number((job as any).recurringMonths));
        }

        const scheduledDaysCount = periodEnd
          ? countScheduledDaysInRange(startDate, periodEnd, recurringDays)
          : ((job as any).recurringWeeks && Number((job as any).recurringWeeks) > 0
              ? Number((job as any).recurringWeeks) * recurringDays.length
              : null);

        if (scheduledDaysCount != null && scheduledDaysCount > 0) {
          return Math.round(scheduledDaysCount * dailyHours * 100) / 100;
        }
      }
    }
    return 8;
  };

  // Hours to show on job cards. On-demand: avoid showing recurring-style totals (e.g. 126h); use time-window hours per day when available.
  const getDisplayHours = (job: Job): number | null => {
    const isOnDemand = job.jobType === "on_demand" || job.isOnDemand;
    if (isOnDemand && job.scheduledTime && job.endTime) {
      const startPart = job.scheduledTime.includes(" - ") ? job.scheduledTime.split(" - ").map((x) => x.trim())[0] : job.scheduledTime;
      const startH = parseTimeToHours(startPart);
      const endH = parseTimeToHours(job.endTime);
      if (startH != null && endH != null && endH > startH) {
        const hoursPerDay = Math.round(endH - startH);
        if (hoursPerDay > 0 && hoursPerDay <= 24) return hoursPerDay;
      }
    }
    if (isOnDemand && (job.estimatedHours == null || job.estimatedHours > 24)) return null;
    return job.estimatedHours ?? null;
  };

  // Calculate estimated payout based on worker/team member rate and hours
  const getEstimatedPayout = (job: Job, application?: ApplicationWithDetails): string => {
    const hours = job.estimatedHours || 8;
    let rate = job.hourlyRate > 100 ? job.hourlyRate / 100 : job.hourlyRate;
    if (application?.teamMember?.hourlyRate != null) {
      rate = rateToDollars(application.teamMember.hourlyRate);
    } else if (application?.proposedRate != null) {
      rate = application.proposedRate > 100 ? application.proposedRate / 100 : application.proposedRate;
    } else if (profile?.hourlyRate != null) {
      rate = rateToDollars(profile.hourlyRate);
    }
    
    const payout = rate * hours;
    return `$${payout.toLocaleString()}`;
  };
  
  // Open directions in chosen app
  const openDirections = (job: Job, app: "google" | "waze" | "apple") => {
    const address = encodeURIComponent(`${job.address || ""}, ${job.city || ""}, ${job.state || ""} ${job.zipCode || ""}`);
    const lat = job.latitude;
    const lng = job.longitude;
    
    let url = "";
    switch (app) {
      case "google":
        url = lat && lng 
          ? `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}` 
          : `https://www.google.com/maps/dir/?api=1&destination=${address}`;
        break;
      case "waze":
        url = lat && lng 
          ? `https://waze.com/ul?ll=${lat},${lng}&navigate=yes` 
          : `https://waze.com/ul?q=${address}&navigate=yes`;
        break;
      case "apple":
        url = lat && lng 
          ? `http://maps.apple.com/?daddr=${lat},${lng}&dirflg=d` 
          : `http://maps.apple.com/?daddr=${address}&dirflg=d`;
        break;
    }
    
    window.open(url, "_blank");
    setDirectionsDialogOpen(false);
    setDirectionsJob(null);
  };

  // Get scheduled jobs for calendar
  const scheduledJobs = acceptedApplications.map(app => 
    allJobs.find(job => job.id === app.jobId)
  ).filter(Boolean) as Job[];

  // Calendar helpers
  const monthStart = startOfMonth(calendarMonth);
  const monthEnd = endOfMonth(calendarMonth);
  const daysInMonth = eachDayOfInterval({ start: monthStart, end: monthEnd });

  const getJobsForDate = (date: Date) => {
    return scheduledJobs.filter(job => 
      job.startDate && isSameDay(parseISO(job.startDate.toString()), date)
    );
  };

  const handleApply = (jobId: number) => {
    applyMutation.mutate(jobId);
  };

  const handleLogout = async () => {
    await logout();
    setLocation("/");
  };

  if (authLoading || profileLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin" />
      </div>
    );
  }

  // Workers with incomplete onboarding never see the dashboard — redirect runs in useEffect
  const workerNeedsOnboarding = profile?.role === "worker" && !isWorkerOnboardingComplete(profile) && !isAdminView;
  if (workerNeedsOnboarding) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="min-h-screen h-dvh md:h-auto bg-background flex flex-col overflow-hidden md:overflow-visible">
      {/* Admin View Banner */}
      {isAdminView && (
        <div className="bg-red-600 text-white px-4 py-2 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Shield className="w-4 h-4" />
            <span className="text-sm font-medium">Admin View Mode - You are viewing the Worker Dashboard as an administrator</span>
          </div>
          <Button 
            variant="outline" 
            size="sm" 
            className="text-white border-white hover:bg-white hover:text-red-600"
            onClick={() => setLocation("/company-dashboard")}
          >
            Exit Admin View
          </Button>
        </div>
      )}
      {/* Mobile Header - Simplified header for non-Today tabs */}
      {activeTab !== "today" && (
        <header className={`md:hidden sticky top-0 z-50 bg-background border-b border-border transition-all duration-300 ease-in-out ${
          isScrolled ? 'py-1.5' : 'py-3'
        }`}>
          <div className={`flex items-center justify-between px-4 transition-all duration-300 ease-in-out ${
            isScrolled ? 'scale-95' : 'scale-100'
          }`}>
            {activeTab === "calendar" ? (
              <div
                ref={(el) => {
                  (calendarHeaderSlotRef as React.MutableRefObject<HTMLDivElement | null>).current = el;
                  setCalendarHeaderSlotReady(!!el);
                }}
                className="flex items-center gap-2 min-w-0 flex-1"
              />
            ) : (
              <h1 className={`font-semibold transition-all duration-300 ease-in-out ${
                isScrolled ? 'text-base' : 'text-lg'
              }`}>
                {activeTab === "find" && tMenu("nav.find")}
                {activeTab === "jobs" && t("myJobs")}
                {activeTab === "menu" && tMenu("nav.menu")}
              </h1>
            )}
            <div className="flex items-center gap-2">
              {/* Notifications Button */}
              <Button 
                variant="ghost" 
                size="icon" 
                className="relative h-8 w-8 rounded-full bg-muted/50 border border-border"
                onClick={() => setNotificationsOpen(true)}
                data-testid="notifications-button-mobile"
              >
                <Bell className="w-4 h-4" />
                {notifications && notifications.filter((n: any) => !n.isRead).length > 0 && (
                  <span 
                    className="absolute -top-1 -right-1 w-4 h-4 bg-destructive text-destructive-foreground text-xs rounded-full flex items-center justify-center"
                    data-testid="notifications-unread-count-mobile"
                  >
                    {notifications.filter((n: any) => !n.isRead).length > 9 ? "9+" : notifications.filter((n: any) => !n.isRead).length}
                  </span>
                )}
              </Button>
              <Avatar 
                className="w-8 h-8 cursor-pointer"
                onClick={() => setActiveTab("menu")}
                data-testid="mobile-header-avatar"
              >
                <AvatarImage src={displayAvatarUrl || undefined} />
                <AvatarFallback className="text-sm">{displayName.firstName?.[0]}{displayName.lastName?.[0]}</AvatarFallback>
              </Avatar>
            </div>
          </div>
        </header>
      )}
      {/* Global Header - Always shown on desktop, shown on mobile for Today tab */}
      <header className={`${activeTab === "today" ? "flex" : "hidden md:flex"} flex-col sticky top-0 z-50 bg-background border-b border-border transition-all duration-300 ease-in-out ${
        isMobile && isScrolled ? 'py-1.5' : ''
      }`}>
        <div className={`px-4 flex items-center justify-between transition-all duration-300 ease-in-out ${
          isMobile && isScrolled ? 'py-1.5 scale-95' : 'py-3 scale-100'
        }`}>
          <div className="flex items-center gap-6">
            <span 
              className={`font-bold cursor-pointer hover:text-primary transition-all duration-300 ease-in-out ${
                isMobile && isScrolled ? 'text-lg' : 'text-xl'
              }`}
              onClick={() => setLocation("/dashboard/today")}
              data-testid="logo-link"
            >
              {t("nav.brandName")}
            </span>
            <nav className="overflow-x-auto scrollbar-hide">
              <AnimatedNavigationTabs
                aria-label="Worker dashboard navigation"
                items={[
                  ...(!isEmployee ? [
                    { id: "find", label: "Find", onClick: () => setActiveTab("find") },
                    { id: "jobs", label: t("nav.jobs"), onClick: () => setActiveTab("jobs") },
                  ] : []),
                  { id: "today", label: t("nav.today"), onClick: () => setLocation("/dashboard/today") },
                  { id: "calendar", label: t("nav.calendar"), onClick: () => setActiveTab("calendar") },
                  { id: "chats", label: t("nav.messages"), onClick: () => setLocation("/dashboard/chats"), badge: totalUnreadChats > 0 ? (totalUnreadChats > 9 ? "9+" : String(totalUnreadChats)) : undefined },
                ]}
                value={activeTab}
                onValueChange={(id) => {
                  if (id === "today") setLocation("/dashboard/today");
                  else if (id === "chats") setLocation("/dashboard/chats");
                  else setActiveTab(id as DashboardTab);
                }}
              />
            </nav>
          </div>
          <div className="flex items-center gap-3">
            {/* Notifications - Full page on mobile, Popover on desktop */}
            {isMobile ? (
              <Button 
                variant="ghost" 
                size="icon" 
                className="relative"
                onClick={() => setNotificationsOpen(true)}
                data-testid="notifications-button"
              >
                <Bell className="w-5 h-5" />
                {notifications && notifications.filter((n: any) => !n.isRead).length > 0 && (
                  <span 
                    className="absolute -top-1 -right-1 w-5 h-5 bg-destructive text-destructive-foreground text-xs rounded-full flex items-center justify-center"
                    data-testid="notifications-unread-count"
                  >
                    {notifications.filter((n: any) => !n.isRead).length > 9 ? "9+" : notifications.filter((n: any) => !n.isRead).length}
                  </span>
                )}
              </Button>
            ) : (
              <Popover>
                <PopoverTrigger asChild>
                  <Button 
                    variant="ghost" 
                    size="icon" 
                    className="relative h-8 w-8 rounded-full bg-muted/50 border border-border"
                    data-testid="notifications-button"
                  >
                    <Bell className="w-4 h-4" />
                    {notifications && notifications.filter((n: any) => !n.isRead).length > 0 && (
                      <span 
                        className="absolute -top-1 -right-1 w-4 h-4 bg-destructive text-destructive-foreground text-xs rounded-full flex items-center justify-center"
                        data-testid="notifications-unread-count"
                      >
                        {notifications.filter((n: any) => !n.isRead).length > 9 ? "9+" : notifications.filter((n: any) => !n.isRead).length}
                      </span>
                    )}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-80 p-0" align="end">
                  <div className="p-3 border-b border-border flex items-center justify-between">
                    <h3 className="font-semibold">Notifications</h3>
                    {notifications && notifications.filter((n: any) => !n.isRead).length > 0 && (
                      <Button 
                        variant="ghost" 
                        size="sm" 
                        className="text-xs"
                        onClick={async () => {
                          try {
                            await apiRequest("PATCH", "/api/notifications/read-all", { profileId: profile?.id });
                            queryClient.invalidateQueries({ queryKey: ['/api/notifications', profile?.id] });
                          } catch (err) {
                            console.error("Failed to mark all as read:", err);
                          }
                        }}
                        data-testid="mark-all-read-button"
                      >
                        Mark all read
                      </Button>
                    )}
                  </div>
                  <ScrollArea className="max-h-[400px]" data-testid="notifications-list">
                    {!notifications || notifications.length === 0 ? (
                      <div className="p-4 text-center text-muted-foreground" data-testid="notifications-empty">
                        <Bell className="w-8 h-8 mx-auto mb-2 opacity-50" />
                        <p className="text-sm">{t("noNotificationsYet")}</p>
                      </div>
                    ) : (
                      <div className="divide-y divide-border">
                        {notifications.slice(0, 20).map((notif: any) => (
                          <div 
                            key={notif.id}
                            className={`p-3 cursor-pointer hover:bg-muted/50 transition-colors ${!notif.isRead ? "bg-primary/5" : ""}`}
                            onClick={async () => {
                              if (!notif.isRead) {
                                try {
                                  await apiRequest("PATCH", `/api/notifications/${notif.id}/read`, {});
                                  queryClient.invalidateQueries({ queryKey: ['/api/notifications', profile?.id] });
                                } catch (err) {
                                  console.error("Failed to mark as read:", err);
                                }
                              }
                              
                              // Use deep linking based on notification type and data
                              const data = notif.data || {};
                              if (tryOpenTimesheetApprovalInvoiceFromNotification(notif, openTimesheetApprovalInvoice)) {
                                return;
                              }
                              if (notif.url) {
                                setLocation(notif.url);
                                return;
                              }
                              
                              // Deep link routing
                              if (notif.type === "new_job_in_territory" || notif.type === "new_job_posted") {
                                setLocation(data.jobId ? `/jobs/${data.jobId}` : "/dashboard/find");
                              } else if (notif.type === "application_approved" || notif.type === "job_application_accepted") {
                                setLocation(data.jobId ? `/dashboard/jobs?jobId=${data.jobId}&tab=active` : "/dashboard/jobs");
                              } else if (notif.type === "application_rejected" || notif.type === "job_application_rejected") {
                                setLocation(data.jobId ? `/dashboard/jobs?jobId=${data.jobId}&tab=history` : "/dashboard/jobs");
                              } else if (notif.type === "job_offer_received") {
                                setLocation(data.jobId ? `/dashboard/jobs?jobId=${data.jobId}&tab=offers` : "/dashboard/jobs");
                              } else if (notif.type === "timesheet_approved" || notif.type === "payment_received") {
                                setLocation(data.timesheetId ? `/dashboard/settings/payouts?timesheetId=${data.timesheetId}` : "/dashboard/settings/payouts");
                              } else if (notif.type === "timesheet_edited" || notif.type === "timesheet_reported") {
                                setLocation(data.timesheetId ? `/dashboard/jobs?timesheetId=${data.timesheetId}` : "/dashboard/jobs");
                              } else if (notif.type === "strike_issued") {
                                setLocation(data.timesheetId ? `/dashboard/strikes?timesheetId=${data.timesheetId}` : "/dashboard/strikes");
                              } else if (notif.type === "new_message") {
                                setLocation(data.jobId ? `/accepted-job/${data.jobId}` : "/dashboard/chats");
                              } else if (notif.type === "job_reminder" || notif.type === "job_start_reminder") {
                                setLocation(data.jobId ? `/dashboard/calendar?jobId=${data.jobId}` : "/dashboard/calendar");
                              } else if (notif.type === "calendar_conflict") {
                                setLocation(data.jobId ? `/dashboard/calendar?jobId=${data.jobId}&conflict=true` : "/dashboard/calendar");
                              } else {
                                setLocation("/dashboard/today");
                              }
                            }}
                            data-testid={`notification-item-${notif.id}`}
                          >
                            <div className="flex items-start gap-3">
                              <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
                                notif.type === "application_accepted" ? "bg-green-100 dark:bg-green-900/30" :
                                notif.type === "application_rejected" ? "bg-red-100 dark:bg-red-900/30" :
                                notif.type === "payment_received" ? "bg-emerald-100 dark:bg-emerald-900/30" :
                                notif.type === "new_message" ? "bg-blue-100 dark:bg-blue-900/30" :
                                "bg-muted"
                              }`}>
                                {notif.type === "application_accepted" && <CheckCircle className="w-4 h-4 text-green-600" />}
                                {notif.type === "application_rejected" && <XCircle className="w-4 h-4 text-red-600" />}
                                {notif.type === "payment_received" && <DollarSign className="w-4 h-4 text-emerald-600" />}
                                {notif.type === "timesheet_approved" && <CheckCircle className="w-4 h-4 text-green-600" />}
                                {notif.type === "new_message" && <MessageSquare className="w-4 h-4 text-blue-600" />}
                                {notif.type === "new_job" && <Briefcase className="w-4 h-4 text-primary" />}
                                {notif.type === "job_reminder" && <Clock className="w-4 h-4 text-amber-600" />}
                                {!["application_accepted", "application_rejected", "payment_received", "timesheet_approved", "new_message", "new_job", "job_reminder"].includes(notif.type) && <Bell className="w-4 h-4 text-muted-foreground" />}
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className={`text-sm ${!notif.isRead ? "font-medium" : ""}`}>{notif.title}</p>
                                {notif.message && (
                                  <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">{notif.message}</p>
                                )}
                                <p className="text-xs text-muted-foreground mt-1">
                                  {formatDistanceToNow(new Date(notif.createdAt), { addSuffix: true })}
                                </p>
                              </div>
                              {!notif.isRead && (
                                <div className="w-2 h-2 bg-primary rounded-full flex-shrink-0 mt-2" />
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </ScrollArea>
                  {notifications && notifications.length > 0 && (
                    <div className="p-2 border-t border-border">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="w-full text-muted-foreground"
                        onClick={() => setLocation("/dashboard/notifications")}
                      >
                        View all
                      </Button>
                    </div>
                  )}
                </PopoverContent>
              </Popover>
            )}
            <Avatar 
              className="w-9 h-9 cursor-pointer hover:ring-2 hover:ring-primary/50 transition-all"
              onClick={() => setLocation("/dashboard/menu")}
              data-testid="header-avatar"
            >
              <AvatarImage src={displayAvatarUrl || undefined} />
              <AvatarFallback>{displayName.firstName?.[0]}{displayName.lastName?.[0]}</AvatarFallback>
            </Avatar>
          </div>
        </div>
        {/* Banners: hidden on mobile; only when logged in (user + profile) on desktop */}
        {!isMobile && user && profile && (
          <>
            <NotificationBanner profileId={profile.id} />
            {profile.role === "worker" && <W9RequirementBanner profileId={profile.id} />}
            <JobStartingBanner />
          </>
        )}
      </header>
      {/* Main Content - Calendar is full-width on desktop, other pages have padding */}
      <main className={`flex-1 min-h-0 overflow-auto ${isMobile ? "pb-[72px]" : ""} ${activeTab === "calendar" ? "w-full" : "container mx-auto px-0 py-[10px]"}`}>
        <ErrorBoundary section={`${activeTab} tab`}>
        {/* Offline banner shown on all tabs so workers always know they're on cached data */}
        {!isOnline && activeTab !== "calendar" && (
          <div className="flex items-center justify-center gap-2 py-2 px-4 bg-amber-600 dark:bg-amber-800 text-white text-xs font-medium" role="status" aria-live="polite">
            <span className="w-1.5 h-1.5 rounded-full bg-white/70 animate-pulse" />
            Offline — showing cached data
          </div>
        )}
        {/* Onboarding checklist - shown when incomplete */}
        {profile && profile.role === "worker" && !hasRequiredFields && activeTab !== "calendar" && (
          <div className="px-4 mb-4">
            <OnboardingChecklist profile={profile} />
          </div>
        )}
        {/* Find Tab - Zillow-style on Mobile, List on Desktop */}
        {activeTab === "find" && isMobile && (
          <div className="fixed inset-0 bottom-14 top-[56px] flex flex-col" {...(mapPopupOpen ? { inert: "" as any, "aria-hidden": true } : {})}>
            {/* Map Background */}
            <div className="absolute inset-0 z-0">
              <JobsMap
                jobs={jobPins}
                workerLocation={workerLocation}
                workerAvatar={profile?.avatarUrl || undefined}
                workerName={`${profile?.firstName || 'You'} ${profile?.lastName || ''}`}
                teammates={teammateLocationsForMap}
                referenceRadiusMiles={referenceLocations.length > 0 ? clampedMaxDistanceMiles : undefined}
                referenceRadiusMilesArray={referenceEntries.length > 0 ? referenceEntries.map((_, i) => getRadiusForRefIndex(i)) : undefined}
                referencePoints={referenceLocations.length > 0 ? referenceLocations : undefined}
                showPersonMarkers={true}
                showPricePills={true}
                onJobSelect={(jobId) => {
                  const job = sortedFindWorkJobs.find(j => j.id === jobId);
                  if (job) setSelectedFindJob(job);
                }}
                selectedJobId={selectedFindJob?.id}
                height="100%"
              />
            </div>
            
            {/* Top Controls */}
            <div className="absolute top-3 left-3 right-3 z-10 flex items-center justify-between gap-2">
              <Badge 
                variant="outline" 
                className="gap-1 cursor-pointer bg-background/90 backdrop-blur-sm shadow-md"
                onClick={() => openQuickSettings("main")}
                data-testid="location-badge-mobile"
              >
                <MapPin className="w-3 h-3" />
                {profile?.city || "Set location"}
              </Badge>
              <div className="flex items-center gap-2">
                <Popover open={filtersDropdownOpen} onOpenChange={setFiltersDropdownOpen}>
                  <PopoverTrigger asChild>
                    <button
                      className="flex items-center gap-1 px-2 py-1 rounded-full bg-background/90 backdrop-blur-sm shadow-md border text-sm"
                      data-testid="filters-dropdown-trigger-mobile"
                    >
                      <Filter className="w-3 h-3" />
                      {activeFilterCount > 0 && (
                        <span className="text-xs font-medium">{activeFilterCount}</span>
                      )}
                    </button>
                  </PopoverTrigger>
                  <PopoverContent className="w-72 p-3" align="end">
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <h4 className="font-semibold text-sm">Filters</h4>
                        {activeFilterCount > 0 && (
                          <Button 
                            variant="ghost" 
                            size="sm" 
                            className="h-6 text-xs px-2"
                            onClick={() => setFindWorkFilters({ jobType: [], skills: [], showOnlyMatching: false, maxDistanceMiles: DEFAULT_MAX_DISTANCE_MILES })}
                          >
                            Clear
                          </Button>
                        )}
                      </div>
                      
                      {/* Job Type Filter - dynamic */}
                      {allJobTypes.length > 0 && (
                        <div className="space-y-1.5">
                          <Label className="text-xs font-medium">Job Type</Label>
                          <div className="flex flex-wrap gap-1.5">
                            {allJobTypes.map(type => {
                              const config = { one_time: 'One-Day', on_demand: 'On Demand', recurring: 'Recurring' } as const;
                              const label = config[type as keyof typeof config] ?? type;
                              return (
                                <Badge
                                  key={type}
                                  variant={findWorkFilters.jobType.includes(type) ? "default" : "outline"}
                                  className="cursor-pointer text-xs"
                                  onClick={() => {
                                    setFindWorkFilters(prev => ({
                                      ...prev,
                                      jobType: prev.jobType.includes(type)
                                        ? prev.jobType.filter(t => t !== type)
                                        : [...prev.jobType, type]
                                    }));
                                  }}
                                  data-testid={`mobile-filter-jobtype-${type}`}
                                >
                                  {label}
                                </Badge>
                              );
                            })}
                          </div>
                        </div>
                      )}
                      
                      {/* Skills Filter - dynamic */}
                      {allJobSkills.length > 0 && (
                        <div className="space-y-1.5">
                          <Label className="text-xs font-medium">Skills</Label>
                          <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto">
                            {allJobSkills.map(skill => (
                              <Badge
                                key={skill}
                                variant={findWorkFilters.skills.includes(skill) ? "default" : "outline"}
                                className="cursor-pointer text-[10px]"
                                onClick={() => {
                                  setFindWorkFilters(prev => ({
                                    ...prev,
                                    skills: prev.skills.includes(skill)
                                      ? prev.skills.filter(s => s !== skill)
                                      : [...prev.skills, skill]
                                  }));
                                }}
                                data-testid={`mobile-filter-skill-${skill}`}
                              >
                                {skill}
                              </Badge>
                            ))}
                          </div>
                        </div>
                      )}
                      
                      {/* Distance (miles) Filter - from admin + teammates locations */}
                      <div className="space-y-2">
                        <Label className="text-xs font-medium">Within distance</Label>
                        {referenceLocations.length > 0 ? (
                          <>
                            <div className="flex items-center gap-2">
                              <Slider
                                value={[clampedMaxDistanceMiles]}
                                onValueChange={([v]) => setFindWorkFilters(prev => ({ ...prev, maxDistanceMiles: v }))}
                                min={1}
                                max={50}
                                step={1}
                                className="flex-1"
                                data-testid="mobile-filter-miles-slider"
                              />
                              <span className="text-xs font-medium tabular-nums w-9">{clampedMaxDistanceMiles} mi</span>
                            </div>
                            <p className="text-[10px] text-muted-foreground">
                              From you and your team&apos;s locations
                            </p>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-xs text-muted-foreground h-8 px-2 w-full justify-start"
                              onClick={() => setAdvancedDistanceOpen(true)}
                              data-testid="mobile-advanced-distance-btn"
                            >
                              Advanced
                            </Button>
                          </>
                        ) : (
                          <p className="text-[10px] text-muted-foreground">Set your or a teammate&apos;s location to filter by distance</p>
                        )}
                      </div>
                      
                      {/* Team Match Filter */}
                      <div className="flex items-center justify-between">
                        <Label className="text-xs font-medium">Only Team Matches</Label>
                        <button
                          onClick={() => setFindWorkFilters(prev => ({ ...prev, showOnlyMatching: !prev.showOnlyMatching }))}
                          className={`w-9 h-5 rounded-full transition-colors ${findWorkFilters.showOnlyMatching ? 'bg-primary' : 'bg-muted'}`}
                          data-testid="mobile-filter-team-match-toggle"
                        >
                          <div className={`w-3.5 h-3.5 rounded-full bg-white shadow-sm transition-transform mx-0.5 ${findWorkFilters.showOnlyMatching ? 'translate-x-4' : ''}`} />
                        </button>
                      </div>
                    </div>
                  </PopoverContent>
                </Popover>
                <Badge className="bg-background/90 backdrop-blur-sm text-foreground shadow-md">
                  {sortedFindWorkJobs.length} jobs
                </Badge>
              </div>
            </div>
            
            {/* Bottom Sheet - 3 positions: collapsed, peek, full */}
            <div 
              className={`absolute left-0 right-0 bg-background shadow-2xl border-t transition-all ease-out ${
                isDragging ? "duration-0" : "duration-300"
              } ${
                bottomSheetPosition === "full" ? "z-[100]" : "z-10"
              } ${
                bottomSheetPosition === "collapsed" 
                  ? "bottom-0 h-[60px] rounded-t-3xl" 
                  : bottomSheetPosition === "peek" 
                    ? "bottom-0 h-[240px] rounded-t-3xl" 
                    : "bottom-0 top-0 h-full rounded-t-none"
              }`}
              style={isDragging ? { 
                height: `calc(100% - ${Math.max(0, Math.min(window.innerHeight - 60, dragCurrentY))}px)`,
                borderTopLeftRadius: dragCurrentY < 60 ? 0 : undefined,
                borderTopRightRadius: dragCurrentY < 60 ? 0 : undefined,
              } : bottomSheetPosition === "full" ? {
                top: 0,
                height: '100%'
              } : undefined}
            >
              {/* Drag Handle */}
              <div 
                className="flex justify-center py-3 cursor-grab active:cursor-grabbing touch-none"
                onTouchStart={(e) => {
                  setIsDragging(true);
                  setDragStartY(e.touches[0].clientY);
                  setDragCurrentY(e.touches[0].clientY);
                }}
                onTouchMove={(e) => {
                  if (isDragging) {
                    setDragCurrentY(e.touches[0].clientY);
                  }
                }}
                onTouchEnd={() => {
                  if (isDragging) {
                    const deltaY = dragCurrentY - dragStartY;
                    const screenHeight = window.innerHeight;
                    const currentPosition = dragCurrentY;
                    
                    if (currentPosition < screenHeight * 0.25) {
                      setBottomSheetPosition("full");
                    } else if (currentPosition < screenHeight * 0.6) {
                      setBottomSheetPosition("peek");
                    } else {
                      setBottomSheetPosition("collapsed");
                    }
                    setIsDragging(false);
                  }
                }}
                onMouseDown={(e) => {
                  setIsDragging(true);
                  setDragStartY(e.clientY);
                  setDragCurrentY(e.clientY);
                }}
              >
                <div className="w-12 h-1.5 bg-muted-foreground/40 rounded-full" />
              </div>
              
              {/* Sheet Header */}
              <div className="px-4 pb-2 flex items-center justify-between border-b border-border/50">
                <h2 className="font-semibold text-sm">
                  {sortedFindWorkJobs.length} jobs nearby
                </h2>
                {bottomSheetPosition === "full" && (
                  <Button 
                    variant="ghost" 
                    size="icon"
                    className="w-7 h-7"
                    onClick={() => setBottomSheetPosition("peek")}
                  >
                    <ChevronDown className="w-4 h-4" />
                  </Button>
                )}
              </div>
              
              {/* Job List */}
              <div className={`overflow-y-auto px-4 ${
                bottomSheetPosition === "collapsed" 
                  ? "h-0 overflow-hidden pt-2" 
                  : bottomSheetPosition === "peek"
                    ? "h-[160px] pt-2"
                    : "h-[calc(100%-80px)] pt-[calc(0.5rem+80px)]"
              }`}
              style={bottomSheetPosition === "full" ? { 
                scrollPaddingTop: '80px'
              } : {}}
              >
                {!findWorkFeedLoading && findWorkFetching && (
                  <div className="flex items-center justify-center gap-1.5 py-2 text-xs text-muted-foreground">
                    <Loader2 className="w-3 h-3 animate-spin" />
                    Refreshing…
                  </div>
                )}
                {findWorkLoading ? (
                  <div className="flex justify-center py-4">
                    <Loader2 className="w-5 h-5 animate-spin" />
                  </div>
                ) : findWorkTimedOut ? (
                  <div className="py-4 text-center space-y-3 px-2">
                    <p className="text-sm font-medium text-amber-800 dark:text-amber-200">{t("findWorkTimeoutTitle")}</p>
                    <p className="text-xs text-muted-foreground">{t("findWorkTimeoutDescription")}</p>
                    <Button size="sm" variant="outline" onClick={() => refetchFindWork()}>
                      {t("findWorkRetry")}
                    </Button>
                  </div>
                ) : sortedFindWorkJobs.length === 0 ? (
                  <div className="py-8 text-center flex flex-col items-center gap-3 px-4">
                    {referenceLocations.length === 0 ? (
                      <>
                        <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center">
                          <MapPin className="w-6 h-6 text-muted-foreground" />
                        </div>
                        <div>
                          <p className="text-sm font-medium">Set your location</p>
                          <p className="text-xs text-muted-foreground mt-0.5">We need your location to show jobs near you.</p>
                        </div>
                        <Button variant="default" size="sm" onClick={() => openQuickSettings("location")}>Set location</Button>
                      </>
                    ) : activeFilterCount > 0 ? (
                      <>
                        <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center">
                          <Filter className="w-6 h-6 text-muted-foreground" />
                        </div>
                        <div>
                          <p className="text-sm font-medium">{t("findWorkNoJobsMatchFilters")}</p>
                          <p className="text-xs text-muted-foreground mt-0.5">{t("findWorkTryBroaderFilters")}</p>
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setFindWorkFilters({ ...findWorkFilters, jobType: [], skills: [], showOnlyMatching: false, maxDistanceMiles: findWorkFilters.maxDistanceMiles ?? DEFAULT_MAX_DISTANCE_MILES })}
                          data-testid="find-work-clear-filters-mobile"
                        >
                          {t("findWorkClearFilters")}
                        </Button>
                      </>
                    ) : (
                      <>
                        <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center">
                          <Briefcase className="w-6 h-6 text-muted-foreground" />
                        </div>
                        <div>
                          <p className="text-sm font-medium">No jobs available right now</p>
                          <p className="text-xs text-muted-foreground mt-0.5">Check back soon — new jobs are posted regularly.</p>
                        </div>
                        <Button variant="outline" size="sm" onClick={() => refetchFindWork()}>
                          Refresh
                        </Button>
                      </>
                    )}
                  </div>
                ) : (
                  <div className="space-y-2 pb-4">
                    {sortedFindWorkJobs.map((job) => {
                      const urgency = formatUrgency(new Date(job.startDate));
                      const isSelected = selectedFindJob?.id === job.id;
                      const timeType = job.jobType === "recurring" ? "Recurring" : job.jobType === "on_demand" || job.isOnDemand ? "On Demand" : "One-Day";
                      const dateTimeDisplay = (() => {
                        const startDate = new Date(job.startDate);
                        const jobDate = format(startDate, "MMM d");
                        const relative = getRelativeDayLabel(startDate);
                        const datePart = relative ? `${jobDate} (${relative})` : jobDate;

                        // Handle recurring jobs with schedule days
                        if (job.jobType === "recurring" && job.scheduleDays && job.scheduleDays.length > 0) {
                          const daysStr = formatScheduleDays(job.scheduleDays);
                          const startTime = formatTimeString(job.scheduledTime);
                          const endTimeStr = formatTimeString(job.endTime);
                          const relPart = relative ? ` (${relative})` : "";
                          if (startTime && endTimeStr) {
                            return `${daysStr}${relPart} Start ${startTime} - ${endTimeStr}`;
                          }
                          return `${daysStr}${relPart}`;
                        }

                        // Handle one-time jobs with separate start/end time fields
                        if (job.scheduledTime && job.endTime) {
                          const startTime = formatTimeString(job.scheduledTime);
                          const endTimeStr = formatTimeString(job.endTime);
                          return `${datePart} Start ${startTime} - ${endTimeStr}`;
                        }

                        // Handle legacy one-time jobs with startDate/endDate timestamps
                        if (job.startDate && job.endDate && job.jobType !== "recurring") {
                          const start = format(new Date(job.startDate), "h:mma").toLowerCase();
                          const end = format(new Date(job.endDate), "h:mma").toLowerCase();
                          return `${datePart} Start ${start} - ${end}`;
                        }

                        if (job.scheduledTime) {
                          return `${datePart} Start ${formatTimeString(job.scheduledTime)}`;
                        }
                        return datePart;
                      })();
                      const shortAddress = (() => {
                        const raw =
                          ((job as { streetAddress?: string | null }).streetAddress || job.address || "").trim();
                        const street = raw ? stripLeadingStreetNumber(raw) : "";
                        const city = job.city || "";
                        const zip = job.zipCode || "";
                        if (street && city && zip) return `${street}, ${city} ${zip}`;
                        if (city && zip) return `${city} ${zip}`;
                        return job.location || "";
                      })();
                      const matchingMembers = getMatchingTeamMembers(job);
                      return (
                        <div
                          key={job.id}
                          className={`bg-card rounded-xl border p-3 cursor-pointer transition-all active:scale-[0.98] ${
                            isSelected ? "ring-2 ring-primary border-primary" : "border-border/60"
                          }`}
                          onClick={() => setSelectedFindJob(job)}
                          data-testid={`mobile-job-card-${job.id}`}
                        >
                          <div className="flex items-start gap-3">
                            <div className={`px-2 py-1.5 rounded-lg ${urgency.color} text-white text-xs font-bold min-w-[50px] text-center`}>
                              {formatFindWorkTotalEstPayout(profile?.hourlyRate, job)}
                            </div>
                            <div className="flex-1 min-w-0">
                              <h3 className="font-medium text-sm line-clamp-1 mb-1">{job.title}</h3>
                              <div className="flex items-center gap-1.5 flex-wrap mb-1">
                                <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-5 bg-secondary/50 border-0">
                                  {timeType}
                                </Badge>
                                <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-5 bg-secondary/50 border-0">
                                  {dateTimeDisplay}
                                </Badge>
                              </div>
                              <p className="text-xs text-muted-foreground line-clamp-1 mb-1">
                                {shortAddress}
                              </p>
                              {/* Team skill match indicator - only when at least one member matches */}
                              {matchingMembers.length > 0 && (
                                <div className="flex items-center gap-1">
                                  <div className="flex -space-x-1">
                                    {matchingMembers.slice(0, 3).map((member) => (
                                      <Avatar key={member.id} className="w-4 h-4 border border-background">
                                        <AvatarImage src={member.avatarUrl || undefined} />
                                        <AvatarFallback className="text-[6px] bg-primary/10">
                                          {member.isAdmin ? 'Y' : member.name.charAt(0)}
                                        </AvatarFallback>
                                      </Avatar>
                                    ))}
                                  </div>
                                  <span className="text-[9px] text-muted-foreground">
                                    {matchingMembers.length === 1 ? matchingMembers[0].name : `${matchingMembers.length} can do`}
                                  </span>
                                </div>
                              )}
                            </div>
                            <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0 mt-1" />
                          </div>
                        </div>
                      );
                    })}
                    {hasNextFindWorkPage && (
                      <div className="flex justify-center py-3">
                        <Button variant="outline" size="sm" onClick={() => fetchNextFindWorkPage()} disabled={isFetchingNextFindWorkPage} className="gap-2" data-testid="find-work-load-more-mobile">
                          {isFetchingNextFindWorkPage ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                          {t("findWorkLoadMore")}
                        </Button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
            
            {/* Enhanced Job Details Dialog for Mobile */}
            <EnhancedJobDialog
              open={!!selectedFindJob}
              onOpenChange={(open) => !open && setSelectedFindJob(null)}
              job={selectedFindJob}
              profile={profile}
              activeTeamMembers={allTeamMembersForApply}
              workerLocation={workerLocation}
              territoryRadiusMiles={clampedMaxDistanceMiles}
              onOpenApply={(job) => {
                setSelectedFindJob(null);
                setApplyJob(job);
              }}
              onDismiss={(job) => {
                setJobToDismiss(job);
                setSelectedFindJob(null);
              }}
            />
          </div>
        )}
        
        {/* Find Tab - Desktop Layout */}
        {activeTab === "find" && !isMobile && (
          <div id="find-work-container" data-cursor-stable-container="find-work" className="space-y-4">
            {/* Header with filters */}
            <div id="find-work-header" className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-4">
              <div>
                <h1 className="text-2xl font-bold">Find Work</h1>
                <p className="text-muted-foreground">{sortedFindWorkJobs.length} available jobs{activeFilterCount > 0 ? ` (${activeFilterCount} filter${activeFilterCount > 1 ? 's' : ''} active)` : ''}</p>
              </div>
              <div className="flex items-center gap-2">
                <Badge 
                  variant="outline" 
                  className="gap-1 cursor-pointer hover-elevate"
                  onClick={() => openQuickSettings("main")}
                  data-testid="location-badge"
                >
                  <MapPin className="w-3 h-3" />
                  {profile?.city || "Set location"}, {profile?.state || ""}
                </Badge>
              </div>
            </div>

            {findWorkTimedOut && (
              <Alert variant="default" className="border-amber-500/50 bg-amber-50/80 dark:bg-amber-950/30">
                <AlertTriangle className="h-4 w-4 text-amber-600" />
                <AlertTitle>{t("findWorkTimeoutTitle")}</AlertTitle>
                <AlertDescription className="flex flex-col sm:flex-row sm:items-center gap-2 sm:justify-between">
                  <span>{t("findWorkTimeoutDescription")}</span>
                  <Button type="button" size="sm" variant="outline" onClick={() => refetchFindWork()}>
                    {t("findWorkRetry")}
                  </Button>
                </AlertDescription>
              </Alert>
            )}

            {/* View Toggle and Filters */}
            <div id="find-work-filters-container" className="flex items-center justify-between gap-2 flex-wrap" data-cursor-stable-container="filters">
              <div className="flex items-center gap-2 flex-wrap">
                {/* AI Dispatch Button - Left End */}
                <Button
                  id="ai-dispatch-button"
                  data-cursor-stable-id="ai-dispatch-btn"
                  variant={aiDispatchEnabled ? "default" : "outline"}
                  size="sm"
                  className="gap-1"
                  onClick={() => setShowAiDispatchDialog(true)}
                  title="AI Dispatch Settings"
                >
                  <Sparkles className={`w-4 h-4 ${aiDispatchEnabled ? "text-white" : "text-primary"}`} />
                  <span className="text-xs font-semibold">AI Dispatch</span>
                  {aiDispatchEnabled && (
                    <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse ml-1" title="AI Dispatch is active" />
                  )}
                </Button>
                {/* Dev: turn off location filter to see all jobs */}
                {showClientDevTools() && (
                  <Button
                    variant={devLocationFilterOff ? "default" : "outline"}
                    size="sm"
                    className="gap-1"
                    onClick={() => {
                      const next = !devLocationFilterOff;
                      setDevLocationFilterOff(next);
                      try { localStorage.setItem("findWorkDevNoLocationFilter", next ? "1" : "0"); } catch { /* ignore */ }
                    }}
                    title="Dev: show all jobs without location/radius filter"
                    data-testid="dev-location-filter-toggle"
                  >
                    <MapPin className="w-3 h-3" />
                    <span className="text-xs">Location filter {devLocationFilterOff ? "OFF" : "on"}</span>
                  </Button>
                )}
                
                {/* Filters Dropdown */}
                <Popover open={filtersDropdownOpen} onOpenChange={setFiltersDropdownOpen}>
                <PopoverTrigger asChild>
                  <Button 
                    id="filters-dropdown-trigger"
                    data-cursor-stable-id="filters-dropdown"
                    variant="outline" 
                    size="sm" 
                    className="gap-1"
                    data-testid="filters-dropdown-trigger"
                  >
                    <Filter className="w-4 h-4" />
                    Filters
                    {activeFilterCount > 0 && (
                      <Badge variant="secondary" className="ml-1 px-1.5 py-0 text-[10px] h-4">
                        {activeFilterCount}
                      </Badge>
                    )}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-80 p-4" align="start">
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <h4 className="font-semibold">Filter Jobs</h4>
                      {activeFilterCount > 0 && (
                        <Button 
                          variant="ghost" 
                          size="sm" 
                          className="h-7 text-xs"
                          onClick={() => setFindWorkFilters({ jobType: [], skills: [], showOnlyMatching: false, maxDistanceMiles: DEFAULT_MAX_DISTANCE_MILES })}
                          data-testid="clear-all-filters"
                        >
                          Clear All
                        </Button>
                      )}
                    </div>
                    
                    {/* Job Type Filter - dynamic to posted jobs */}
                    {allJobTypes.length > 0 && (
                      <div className="space-y-2">
                        <Label className="text-sm font-medium">Job Type</Label>
                        <div className="flex flex-wrap gap-2">
                          {allJobTypes.map(type => {
                            const config = { one_time: 'One-Day', on_demand: 'On Demand', recurring: 'Recurring' } as const;
                            const label = config[type as keyof typeof config] ?? type;
                            return (
                              <Badge
                                key={type}
                                variant={findWorkFilters.jobType.includes(type) ? "default" : "outline"}
                                className="cursor-pointer"
                                onClick={() => {
                                  setFindWorkFilters(prev => ({
                                    ...prev,
                                    jobType: prev.jobType.includes(type)
                                      ? prev.jobType.filter(t => t !== type)
                                      : [...prev.jobType, type]
                                  }));
                                }}
                                data-testid={`filter-jobtype-${type}`}
                              >
                                {label}
                              </Badge>
                            );
                          })}
                        </div>
                      </div>
                    )}
                    
                    {/* Skills Filter - dynamic to posted jobs */}
                    {allJobSkills.length > 0 && (
                      <div className="space-y-2">
                        <Label className="text-sm font-medium">Skills</Label>
                        <div className="flex flex-wrap gap-2 max-h-32 overflow-y-auto">
                          {allJobSkills.map(skill => (
                            <Badge
                              key={skill}
                              variant={findWorkFilters.skills.includes(skill) ? "default" : "outline"}
                              className="cursor-pointer text-xs"
                              onClick={() => {
                                setFindWorkFilters(prev => ({
                                  ...prev,
                                  skills: prev.skills.includes(skill)
                                    ? prev.skills.filter(s => s !== skill)
                                    : [...prev.skills, skill]
                                }));
                              }}
                              data-testid={`filter-skill-${skill}`}
                            >
                              {skill}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    )}
                    
                    {/* Distance (miles) Filter - from admin + teammates locations (1–50 mi) */}
                    <div className="space-y-2">
                      <Label className="text-sm font-medium">Within distance</Label>
                      {referenceLocations.length > 0 ? (
                        <>
                          <div className="flex items-center gap-2">
                            <Slider
                              value={[clampedMaxDistanceMiles]}
                              onValueChange={([v]) => setFindWorkFilters(prev => ({ ...prev, maxDistanceMiles: v }))}
                              min={1}
                              max={50}
                              step={1}
                              className="flex-1"
                              data-testid="filter-miles-slider"
                            />
                            <span className="text-sm font-medium tabular-nums w-10">
                              {clampedMaxDistanceMiles} mi
                            </span>
                          </div>
                          <p className="text-xs text-muted-foreground">
                            From you and your team&apos;s locations
                          </p>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-xs text-muted-foreground h-8 px-2"
                            onClick={() => setAdvancedDistanceOpen(true)}
                            data-testid="advanced-distance-btn"
                          >
                            Advanced
                          </Button>
                        </>
                      ) : (
                        <p className="text-xs text-muted-foreground">Set your or a teammate&apos;s location to filter by distance</p>
                      )}
                    </div>
                    
                    {/* Team Match Filter */}
                    <div className="flex items-center justify-between">
                      <div>
                        <Label className="text-sm font-medium">Only Team Matches</Label>
                        <p className="text-xs text-muted-foreground">Show jobs you or your team can do</p>
                      </div>
                      <button
                        onClick={() => setFindWorkFilters(prev => ({ ...prev, showOnlyMatching: !prev.showOnlyMatching }))}
                        className={`w-10 h-6 rounded-full transition-colors ${findWorkFilters.showOnlyMatching ? 'bg-primary' : 'bg-muted'}`}
                        data-testid="filter-team-match-toggle"
                      >
                        <div className={`w-4 h-4 rounded-full bg-white shadow-sm transition-transform mx-1 ${findWorkFilters.showOnlyMatching ? 'translate-x-4' : ''}`} />
                      </button>
                    </div>
                  </div>
                </PopoverContent>
              </Popover>
              
              {/* Active filter tags */}
              {activeFilterCount > 0 && (
                <div className="flex items-center gap-1 flex-wrap">
                  {findWorkFilters.jobType.map(type => (
                    <Badge 
                      key={type} 
                      variant="secondary" 
                      className="gap-1 cursor-pointer"
                      onClick={() => setFindWorkFilters(prev => ({ ...prev, jobType: prev.jobType.filter(t => t !== type) }))}
                    >
                      {type === 'one_time' ? 'One-Day' : type === 'on_demand' ? 'On Demand' : 'Recurring'}
                      <X className="w-3 h-3" />
                    </Badge>
                  ))}
                  {findWorkFilters.skills.map(skill => (
                    <Badge 
                      key={skill} 
                      variant="secondary" 
                      className="gap-1 cursor-pointer"
                      onClick={() => setFindWorkFilters(prev => ({ ...prev, skills: prev.skills.filter(s => s !== skill) }))}
                    >
                      {skill}
                      <X className="w-3 h-3" />
                    </Badge>
                  ))}
                  {referenceLocations.length > 0 && clampedMaxDistanceMiles !== DEFAULT_MAX_DISTANCE_MILES && (
                    <Badge 
                      variant="secondary" 
                      className="gap-1 cursor-pointer"
                      onClick={() => setFindWorkFilters(prev => ({ ...prev, maxDistanceMiles: DEFAULT_MAX_DISTANCE_MILES }))}
                    >
                      Within {clampedMaxDistanceMiles} mi
                      <X className="w-3 h-3" />
                    </Badge>
                  )}
                  {findWorkFilters.showOnlyMatching && (
                    <Badge 
                      variant="secondary" 
                      className="gap-1 cursor-pointer"
                      onClick={() => setFindWorkFilters(prev => ({ ...prev, showOnlyMatching: false }))}
                    >
                      Team Matches
                      <X className="w-3 h-3" />
                    </Badge>
                  )}
                </div>
              )}
              </div>

              {/* Advanced distance: per-team-member radius */}
              <Dialog open={advancedDistanceOpen} onOpenChange={setAdvancedDistanceOpen}>
                <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto" data-testid="advanced-distance-dialog">
                  <DialogHeader>
                    <DialogTitle>Distance by team member</DialogTitle>
                    <DialogDescription>
                      Set how far (in miles) to show jobs from each person&apos;s location. Jobs appear if they fall within any member&apos;s radius.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4 py-2">
                    {referenceEntries.map((entry, i) => (
                      <div key={entry.key} className="space-y-2">
                        <div className="flex items-center justify-between">
                          <Label className="text-sm font-medium">{entry.label}</Label>
                          <span className="text-sm tabular-nums text-muted-foreground w-10 text-right">
                            {(entry.key && radiusByReferenceKey[entry.key] != null
                              ? Math.min(50, Math.max(1, radiusByReferenceKey[entry.key]))
                              : clampedMaxDistanceMiles
                            )} mi
                          </span>
                        </div>
                        <Slider
                          value={[entry.key && radiusByReferenceKey[entry.key] != null ? Math.min(50, Math.max(1, radiusByReferenceKey[entry.key])) : clampedMaxDistanceMiles]}
                          onValueChange={([v]) => setRadiusByReferenceKey((prev) => ({ ...prev, [entry.key]: v }))}
                          min={1}
                          max={50}
                          step={1}
                          className="w-full"
                          data-testid={`advanced-radius-${entry.key}`}
                        />
                      </div>
                    ))}
                  </div>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setAdvancedDistanceOpen(false)}>
                      Done
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>

              {/* Dev: Location & filter debug */}
              {showClientDevTools() && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground text-xs gap-1"
                  onClick={() => setShowDevFilterDialog(true)}
                  title="View admin/worker addresses and distance filter logic"
                >
                  Dev: Location & Filter
                </Button>
              )}
              
              {/* View Selector Dropdown - Right End */}
              <Select value={viewMode} onValueChange={(value: "map" | "list" | "table" | "card") => setViewMode(value)}>
                <SelectTrigger id="view-mode-selector" data-cursor-stable-id="view-mode-select" className="w-[140px] gap-2">
                  <div className="flex items-center gap-2">
                    {viewMode === "map" && <MapPin className="w-4 h-4" />}
                    {viewMode === "list" && <List className="w-4 h-4" />}
                    {viewMode === "table" && <Table2 className="w-4 h-4" />}
                    {viewMode === "card" && <LayoutGrid className="w-4 h-4" />}
                    <SelectValue>
                      {viewMode === "map" ? "Map" : viewMode === "list" ? "List" : viewMode === "table" ? "Table" : "Card"}
                    </SelectValue>
                  </div>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="card">
                    <div className="flex items-center gap-2">
                      <LayoutGrid className="w-4 h-4" />
                      <span>Card View</span>
                    </div>
                  </SelectItem>
                  <SelectItem value="list">
                    <div className="flex items-center gap-2">
                      <List className="w-4 h-4" />
                      <span>List View</span>
                    </div>
                  </SelectItem>
                  <SelectItem value="table">
                    <div className="flex items-center gap-2">
                      <Table2 className="w-4 h-4" />
                      <span>Table View</span>
                    </div>
                  </SelectItem>
                  <SelectItem value="map">
                    <div className="flex items-center gap-2">
                      <MapPin className="w-4 h-4" />
                      <span>Map View</span>
                    </div>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Dev: Location & filter debug dialog */}
            <Dialog open={showDevFilterDialog} onOpenChange={setShowDevFilterDialog}>
              <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto" hideCloseButton={false}>
                <DialogHeader>
                  <DialogTitle>Find Work: Location & Filter (Dev)</DialogTitle>
                  <DialogDescription>Addresses and distance filtering logic used for job list.</DialogDescription>
                </DialogHeader>
                <div className="space-y-4 text-sm">
                  {/* Dev location toggle state and API request */}
                  <div className="rounded-md bg-amber-500/10 border border-amber-500/30 p-3">
                    <h4 className="font-medium mb-2">Dev: Location filter</h4>
                    <div className="font-mono text-xs space-y-1">
                      <div>Location filter: <strong>{devLocationFilterOff ? "OFF" : "ON"}</strong></div>
                      <div>API request sent: maxDistanceMiles={effectiveMaxMilesForApi}{showClientDevTools() && devLocationFilterOff ? ", skipLocationFilter=1" : ""}</div>
                      <p className="text-muted-foreground pt-1">
                        When OFF: server uses getJobs(undefined) and skips distance; client skips distance + job type + skills + showOnlyMatching.
                      </p>
                    </div>
                  </div>

                  {/* All hidden rules: server-side */}
                  <div>
                    <h4 className="font-medium mb-2">Server-side rules (find-work endpoint)</h4>
                    <p className="text-muted-foreground text-xs mb-1">Jobs excluded by the API before response:</p>
                    <ul className="list-disc list-inside text-muted-foreground space-y-0.5 text-xs">
                      <li>Dismissed by you (not interested)</li>
                      <li>Already applied to by you</li>
                      <li>Fully staffed (workersHired ≥ maxWorkersNeeded)</li>
                      <li>Status !== &quot;open&quot;</li>
                      <li>Expired: non–on-demand jobs with start date &gt; 3 days ago (on-demand never expire)</li>
                      <li>When location filter ON: job outside maxDistanceMiles of every reference point (admin + teammates with address)</li>
                      <li>Initial list: getJobs(undefined when skipLocationFilter=1, else trade/location if provided) → only open status at DB</li>
                    </ul>
                  </div>

                  {/* All hidden rules: client-side */}
                  <div>
                    <h4 className="font-medium mb-2">Client-side rules (this page)</h4>
                    <p className="text-muted-foreground text-xs mb-1">Applied after receiving API jobs:</p>
                    <ul className="list-disc list-inside text-muted-foreground space-y-0.5 text-xs">
                      {showClientDevTools() && devLocationFilterOff ? (
                        <>
                          <li className="text-green-600 dark:text-green-400">Distance: skipped (dev location OFF)</li>
                          <li className="text-green-600 dark:text-green-400">Job type filter: skipped</li>
                          <li className="text-green-600 dark:text-green-400">Skills filter: skipped</li>
                          <li className="text-green-600 dark:text-green-400">Show only matching: skipped</li>
                        </>
                      ) : (
                        <>
                          <li>Distance: job within radius of any reference (per-member or global {clampedMaxDistanceMiles} mi). If no reference locations → 0 jobs.</li>
                          <li>Job type: {findWorkFilters.jobType.length > 0 ? `only [${findWorkFilters.jobType.join(", ")}]` : "not applied"}</li>
                          <li>Skills: {findWorkFilters.skills.length > 0 ? `match any of [${findWorkFilters.skills.slice(0, 5).join(", ")}${findWorkFilters.skills.length > 5 ? "…" : ""}]` : "not applied"}</li>
                          <li>Show only matching: {findWorkFilters.showOnlyMatching ? "only jobs matching your/team skills" : "off"}</li>
                        </>
                      )}
                    </ul>
                  </div>

                  <div>
                    <h4 className="font-medium mb-2">Admin (you)</h4>
                    <div className="rounded-md bg-muted/50 p-3 font-mono text-xs space-y-1">
                      <div>address: {profile?.address ?? "—"}</div>
                      <div>city: {profile?.city ?? "—"}, state: {profile?.state ?? "—"}, zip: {profile?.zipCode ?? "—"}</div>
                      <div>latitude: {profile?.latitude ?? "—"}, longitude: {profile?.longitude ?? "—"}</div>
                      <div className="pt-1 text-muted-foreground">
                        {profile?.latitude != null && profile?.longitude != null
                          ? "✓ Included in reference locations (from DB)"
                          : geocodedAddressCache["profile"]
                            ? "✓ Included in reference locations (geocoded cache)"
                            : "✗ Not in reference locations (no coords)"}
                      </div>
                    </div>
                  </div>
                  <div>
                    <h4 className="font-medium mb-2">Teammates ({activeTeamMembers.length})</h4>
                    <div className="space-y-2">
                      {activeTeamMembers.length === 0 ? (
                        <p className="text-muted-foreground">None</p>
                      ) : (
                        activeTeamMembers.map((m) => {
                          const hasAddress = !!(m.address?.trim() || m.city?.trim() || m.state?.trim() || m.zipCode?.trim());
                          const hasCoords = m.latitude != null && m.longitude != null;
                          const lat = hasCoords ? parseFloat(String(m.latitude)) : NaN;
                          const lng = hasCoords ? parseFloat(String(m.longitude)) : NaN;
                          const validCoords = Number.isFinite(lat) && Number.isFinite(lng);
                          const fromCache = !validCoords && geocodedAddressCache[`member-${m.id}`];
                          const included = validCoords || fromCache;
                          return (
                            <div key={m.id} className="rounded-md bg-muted/50 p-2 font-mono text-xs space-y-0.5">
                              <div className="font-medium text-foreground">{m.firstName} {m.lastName}</div>
                              <div>address: {m.address ?? "—"}</div>
                              <div>city: {m.city ?? "—"}, state: {m.state ?? "—"}, zip: {m.zipCode ?? "—"}</div>
                              <div>latitude: {m.latitude ?? "—"}, longitude: {m.longitude ?? "—"}</div>
                              <div className="text-muted-foreground">
                                {!hasAddress ? "✗ No address — excluded from filtering" : included ? "✓ Included in reference locations" : "✗ Not in reference locations (no coords or cache)"}
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                  <div>
                    <h4 className="font-medium mb-2">Reference locations ({referenceLocations.length})</h4>
                    <p className="text-muted-foreground text-xs mb-1">Points used for distance filter when location ON. Teammates with no address are excluded.</p>
                    {referenceLocations.length === 0 ? (
                      <p className="text-muted-foreground">None — when location ON, no jobs are shown until at least one location is set.</p>
                    ) : (
                      <ul className="list-disc list-inside font-mono text-xs space-y-0.5">
                        {referenceLocations.map((ref, i) => (
                          <li key={i}>({ref.lat.toFixed(5)}, {ref.lng.toFixed(5)})</li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <div>
                    <h4 className="font-medium mb-2">Distance (when location ON)</h4>
                    <ul className="list-disc list-inside text-muted-foreground space-y-0.5 text-xs">
                      <li>Max distance: {clampedMaxDistanceMiles} mi (slider 1–50)</li>
                      <li>Job is shown if within max distance of any reference location.</li>
                      <li>Jobs without lat/lng are included when distance filter runs.</li>
                    </ul>
                  </div>
                  <div className="pt-2 border-t">
                    <h4 className="font-medium mb-2">Counts</h4>
                    <div className="font-mono text-xs space-y-0.5">
                      <div>Jobs returned by API: <strong>{findWorkJobs?.length ?? 0}</strong></div>
                      <div>After client filters: <strong>{sortedFindWorkJobs.length}</strong></div>
                      <p className="text-muted-foreground pt-1">If API count is low with Location filter OFF, ensure the server is running with NODE_ENV=development so skipLocationFilter=1 is honored; otherwise the server still applies distance filtering.</p>
                    </div>
                  </div>
                  <div className="rounded-md bg-muted/50 p-2 text-xs text-muted-foreground">
                    <p className="font-medium text-foreground mb-0.5">Why only 2 jobs?</p>
                    <p>Server excludes: dismissed by you, already applied, fully staffed, not open, expired (&gt;3 days for non–on-demand). With Location filter OFF (dev), server also skips distance and uses getJobs(undefined). If you still see 2, either only 2 jobs in DB pass those rules, or the server is not in development mode.</p>
                  </div>
                </div>
              </DialogContent>
            </Dialog>

            {/* Content Area */}
            {findWorkLoading ? (
              <div className="space-y-4 py-4">
                {[1, 2, 3].map((i) => (
                  <SkeletonCard key={i} showImage={false} />
                ))}
              </div>
            ) : findWorkTimedOut ? (
              <Card>
                <CardContent className="py-12 text-center space-y-4">
                  <AlertTriangle className="w-12 h-12 mx-auto text-amber-600" />
                  <h3 className="font-semibold">{t("findWorkTimeoutTitle")}</h3>
                  <p className="text-sm text-muted-foreground max-w-md mx-auto">{t("findWorkTimeoutDescription")}</p>
                  <Button variant="default" onClick={() => refetchFindWork()}>
                    {t("findWorkRetry")}
                  </Button>
                </CardContent>
              </Card>
            ) : sortedFindWorkJobs.length === 0 ? (
              <Card>
                <CardContent className="py-12 text-center">
                  {referenceLocations.length === 0 ? (
                    <>
                      <MapPin className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
                      <h3 className="font-semibold mb-2">Set your location to see jobs nearby</h3>
                      <p className="text-sm text-muted-foreground mb-4">
                        Add your address in Quick Settings so we can show jobs within your chosen distance (e.g. 50 miles).
                      </p>
                      <Button variant="outline" onClick={() => openQuickSettings("location")}>
                        Set location
                      </Button>
                    </>
                  ) : activeFilterCount > 0 ? (
                    <>
                      <Filter className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
                      <h3 className="font-semibold mb-2">{t("findWorkNoJobsMatchFilters")}</h3>
                      <p className="text-sm text-muted-foreground mb-4">
                        {t("findWorkTryBroaderFilters")}
                      </p>
                      <Button
                        variant="outline"
                        onClick={() => setFindWorkFilters({ ...findWorkFilters, jobType: [], skills: [], showOnlyMatching: false, maxDistanceMiles: findWorkFilters.maxDistanceMiles ?? DEFAULT_MAX_DISTANCE_MILES })}
                        data-testid="find-work-clear-filters"
                      >
                        {t("findWorkClearFilters")}
                      </Button>
                    </>
                  ) : (
                    <>
                      <Search className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
                      <h3 className="font-semibold mb-2">{t("noJobsAvailableRightNow")}</h3>
                      <p className="text-sm text-muted-foreground mb-4">
                        {t("checkBackSoonNewJobsPostedDaily")}
                      </p>
                      <Button variant="outline" onClick={() => openQuickSettings("skillset")}>
                        {t("updateYourSkills")}
                      </Button>
                    </>
                  )}
                </CardContent>
              </Card>
            ) : viewMode === "map" ? (
              /* Map View - Inline */
              <div className="h-[calc(100vh-300px)] min-h-[600px] rounded-lg border border-border overflow-hidden flex">
                {/* Map */}
                <div className="relative flex-1">
                  <JobsMap
                    jobs={jobPins}
                    workerLocation={workerLocation}
                    workerAvatar={profile?.avatarUrl || undefined}
                    workerName={`${profile?.firstName || 'You'} ${profile?.lastName || ''}`}
                    teammates={teammateLocationsForMap}
                    referenceRadiusMiles={referenceLocations.length > 0 ? clampedMaxDistanceMiles : undefined}
                    referenceRadiusMilesArray={referenceEntries.length > 0 ? referenceEntries.map((_, i) => getRadiusForRefIndex(i)) : undefined}
                    referencePoints={referenceLocations.length > 0 ? referenceLocations : undefined}
                    showPersonMarkers={true}
                    showPricePills={true}
                    onJobSelect={(jobId) => {
                      const job = sortedFindWorkJobs.find(j => j.id === jobId);
                      if (job) setSelectedFindJob(job);
                    }}
                    selectedJobId={selectedFindJob?.id}
                    height="100%"
                  />
                  <div className="absolute top-3 left-3 z-10 flex flex-col gap-2">
                    <Badge className="bg-background/90 backdrop-blur-sm text-foreground shadow-md">
                      {sortedFindWorkJobs.length} jobs nearby
                    </Badge>
                    {activeTeamMembers.length > 0 && (
                      <Badge variant="outline" className="bg-background/90 backdrop-blur-sm shadow-md">
                        <Users className="w-3 h-3 mr-1" />
                        {activeTeamMembers.length + 1} team members
                      </Badge>
                    )}
                  </div>
                </div>
                
                {/* Job Details Panel */}
                {selectedFindJob && (
                  <div className="w-[420px] flex-shrink-0 bg-background border-l flex flex-col overflow-hidden">
                    <JobContent
                      job={selectedFindJob}
                      profile={profile}
                      activeTeamMembers={allTeamMembersForApply}
                      workerLocation={workerLocation}
                      territoryRadiusMiles={clampedMaxDistanceMiles}
                      onOpenApply={(job) => {
                        setSelectedFindJob(null);
                        setApplyJob(job);
                      }}
                      onDismiss={(job) => {
                        setJobToDismiss(job);
                        setSelectedFindJob(null);
                      }}
                      onClose={() => setSelectedFindJob(null)}
                      isMobile={false}
                      inlineApplyMode={true}
                      onApplySuccess={() => setSelectedFindJob(null)}
                    />
                  </div>
                )}
              </div>
            ) : viewMode === "card" ? (
              /* Card View - 3-4 Column Grid */
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 items-stretch" data-cursor-stable-container="job-list">
                {sortedFindWorkJobs.map((job, index) => {
                  const urgency = formatUrgency(new Date(job.startDate));
                  return (
                    <div
                      key={job.id}
                      id={`job-card-${job.id}`}
                      data-job-id={job.id}
                      data-cursor-stable-id={`job-${job.id}`}
                      className="group flex h-full flex-col bg-card rounded-2xl border border-border/60 shadow-sm hover:shadow-lg hover:border-border transition-all duration-300 ease-out cursor-pointer overflow-hidden active:scale-[0.98]"
                      onClick={() => {
                        setSelectedFindJob(job);
                      }}
                      data-testid={`job-card-${job.id}`}
                      style={{ 
                        animationDelay: `${index * 50}ms`,
                        animation: 'fadeInUp 0.4s ease-out forwards'
                      }}
                    >
                      {/* Card header: first 2 rows (badges, title, payout) */}
                      <header className="flex-shrink-0 px-4 pt-4 pb-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1 flex-wrap">
                              <Badge className={`${urgency.color} text-white text-[10px] px-2 py-0.5 font-medium`}>
                                {urgency.label}
                              </Badge>
                              <Popover>
                                <PopoverTrigger asChild>
                                  <button 
                                    id={`job-type-badge-${job.id}`}
                                    data-job-id={job.id}
                                    onClick={(e) => e.stopPropagation()}
                                    className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full font-medium bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800 cursor-pointer hover:bg-blue-100 dark:hover:bg-blue-900/50 transition-colors"
                                    data-testid={`job-type-badge-${job.id}`}
                                  >
                                    <CalendarIcon className="w-3 h-3" />
                                    {job.jobType === "recurring" ? "Recurring" : job.jobType === "on_demand" || job.isOnDemand ? "On Demand" : "One-Day"}
                                  </button>
                                </PopoverTrigger>
                                <PopoverContent className="w-72 p-3" align="start" onClick={(e) => e.stopPropagation()}>
                                  <div className="space-y-3">
                                    <div className="flex items-start gap-2">
                                      <div className="w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-900/50 flex items-center justify-center flex-shrink-0 mt-0.5">
                                        <CalendarIcon className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                                      </div>
                                      <div>
                                        <p className="font-semibold text-sm">
                                          {job.jobType === "recurring" ? "Recurring Job" : job.jobType === "on_demand" || job.isOnDemand ? "On Demand Job" : "One-Day Job"}
                                        </p>
                                        <p className="text-xs text-muted-foreground leading-relaxed">
                                          {job.jobType === "recurring" 
                                            ? "Repeating schedule with set hours" 
                                            : job.jobType === "on_demand" || job.isOnDemand 
                                              ? "Show up at the scheduled time and continue working until the job is complete" 
                                              : "Single day assignment with fixed start and end times"}
                                        </p>
                                      </div>
                                    </div>
                                    <div className="pt-2 border-t border-border/50">
                                      <p className="text-xs text-muted-foreground mb-1">
                                        {(job.jobType === "on_demand" || job.isOnDemand) ? "Start Time" : "Schedule"}
                                      </p>
                                      <p className="font-medium text-sm">
                                        {(() => {
                                          if (!job.startDate) return "TBD";
                                          const startDate = new Date(job.startDate);
                                          const now = new Date();
                                          const diffTime = startDate.getTime() - now.getTime();
                                          const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                                          const daysAwayText = diffDays === 0 ? "Today" : diffDays === 1 ? "Tomorrow" : `${diffDays} days away`;
                                          
                                          const formatScheduledTime = (time: string) => {
                                            const [hours, minutes] = time.split(':').map(Number);
                                            const period = hours >= 12 ? 'pm' : 'am';
                                            const displayHours = hours % 12 || 12;
                                            return minutes === 0 ? `${displayHours}${period}` : `${displayHours}:${minutes.toString().padStart(2, '0')}${period}`;
                                          };
                                          
                                          if (job.jobType === "recurring" && job.scheduleDays && job.scheduleDays.length > 0) {
                                            const daysStr = formatScheduleDays(job.scheduleDays);
                                            const startTime = job.scheduledTime ? formatScheduledTime(job.scheduledTime) : "";
                                            const endTimeStr = job.endTime ? formatScheduledTime(job.endTime) : "";
                                            const timeRange = startTime && endTimeStr ? ` ${startTime} - ${endTimeStr}` : startTime ? ` ${startTime}` : "";
                                            return `${daysStr}${timeRange} (${daysAwayText})`;
                                          }
                                          if (job.jobType === "on_demand" || job.isOnDemand) {
                                            const timeStr = job.scheduledTime 
                                              ? formatScheduledTime(job.scheduledTime)
                                              : format(startDate, "h:mma").toLowerCase();
                                            return `${timeStr} on ${format(startDate, "MMM d")} (${daysAwayText})`;
                                          }
                                          if (job.endDate) {
                                            const startTime = format(startDate, "h:mma").toLowerCase();
                                            const endTime = format(new Date(job.endDate), "h:mma").toLowerCase();
                                            return `${format(startDate, "MMM d")} - ${startTime} to ${endTime} (${daysAwayText})`;
                                          }
                                          const timeStr = job.scheduledTime ? ` at ${formatScheduledTime(job.scheduledTime)}` : "";
                                          return `${format(startDate, "MMM d, yyyy")}${timeStr} (${daysAwayText})`;
                                        })()}
                                      </p>
                                      {job.estimatedHours && (
                                        <p className="text-xs text-muted-foreground mt-1">
                                          Estimated: {job.estimatedHours} hours
                                        </p>
                                      )}
                                    </div>
                                  </div>
                                </PopoverContent>
                              </Popover>
                              {job.maxWorkersNeeded && job.maxWorkersNeeded > 1 && (
                                <Badge variant="outline" className="text-[10px] px-2 py-0.5 bg-purple-50 dark:bg-purple-950/50 text-purple-700 dark:text-purple-300 border-purple-200 dark:border-purple-800">
                                  <Users className="w-3 h-3 mr-1" />
                                  {job.maxWorkersNeeded} needed
                                </Badge>
                              )}
                              {(() => {
                                const imgs = job.images?.length ?? 0;
                                const vids = job.videos?.length ?? 0;
                                const n = imgs + vids;
                                if (n === 0) return null;
                                const parts = [];
                                if (imgs) parts.push(`${imgs} photo${imgs > 1 ? "s" : ""}`);
                                if (vids) parts.push(`${vids} video${vids > 1 ? "s" : ""}`);
                                return (
                                  <Badge variant="outline" className="text-[10px] px-2 py-0.5 bg-muted/50 text-muted-foreground border-0">
                                    {parts.join(", ")}
                                  </Badge>
                                );
                              })()}
                            </div>
                            <h3 className="font-semibold text-base leading-tight line-clamp-2 group-hover:text-primary transition-colors duration-200">
                              {job.title}
                            </h3>
                          </div>
                          
                          <div className="flex-shrink-0 text-right">
                            <div className="bg-green-50 dark:bg-green-950/40 rounded-full px-4 py-1.5 border border-green-200/50 dark:border-green-800/50 inline-flex flex-col items-center">
                              <p className="font-bold text-base text-green-600 dark:text-green-400 leading-none">
                                {formatFindWorkTotalEstPayout(profile?.hourlyRate, job)}
                              </p>
                              <p className="text-[10px] text-green-600/70 dark:text-green-400/70 mt-0.5">
                                {t("estPayout")}
                              </p>
                            </div>
                          </div>
                        </div>
                      </header>
                      
                      {/* Middle section with details */}
                      <div className="min-h-0 flex-1 px-4 pb-3">
                        <div className="flex items-center gap-3 text-sm text-muted-foreground mb-3">
                          <span className="flex items-center gap-1.5">
                            <div className="w-5 h-5 rounded-full bg-secondary/80 flex items-center justify-center">
                              <MapPin className="w-3 h-3" />
                            </div>
                            <span className="truncate max-w-[140px]">{formatJobLocation(job)}</span>
                          </span>
                          <span className="flex items-center gap-1.5">
                            <div className="w-5 h-5 rounded-full bg-secondary/80 flex items-center justify-center">
                              <Clock className="w-3 h-3" />
                            </div>
                            {job.estimatedHours ? `${job.estimatedHours}h` : "TBD"}
                          </span>
                        </div>
                        
                        {job.description && (
                          <p className="text-sm text-muted-foreground line-clamp-2 mb-3 leading-relaxed">
                            {job.description}
                          </p>
                        )}
                        
                        {/* Skills tags - deduplicated */}
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {(() => {
                            const allSkills = [job.trade, ...(job.requiredSkills || [])];
                            const uniqueSkills = [...new Set(allSkills.filter(Boolean))];
                            const displaySkills = uniqueSkills.slice(0, 3);
                            const remainingCount = uniqueSkills.length - 3;
                            return (
                              <>
                                {displaySkills.map(skill => (
                                  <Badge key={skill} variant="outline" className="text-xs bg-secondary/50 border-0 rounded-full px-2.5">
                                    {skill}
                                  </Badge>
                                ))}
                                {remainingCount > 0 && (
                                  <Badge variant="outline" className="text-xs bg-secondary/50 border-0 rounded-full px-2.5">
                                    +{remainingCount}
                                  </Badge>
                                )}
                              </>
                            );
                          })()}
                        </div>
                      </div>
                      
                      {/* Bottom action bar */}
                      <div className="flex flex-shrink-0 items-center justify-between gap-2 border-t border-border/40 bg-secondary/30 px-4 py-3">
                        <Button
                          id={`dismiss-job-btn-${job.id}`}
                          data-job-id={job.id}
                          variant="ghost"
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            setJobToDismiss(job);
                          }}
                          className="text-muted-foreground hover:text-foreground rounded-full px-4 h-9"
                          data-testid={`dismiss-job-${job.id}`}
                        >
                          <X className="w-4 h-4 mr-1.5" />
                          Skip
                        </Button>
                        <Button 
                          id={`apply-job-btn-${job.id}`}
                          data-job-id={job.id}
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            setApplyJob(job);
                          }}
                          className="rounded-full px-5 h-9 shadow-sm"
                          data-testid={`apply-job-${job.id}`}
                        >
                          Apply Now
                          <ChevronRight className="w-4 h-4 ml-1" />
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : viewMode === "list" ? (
              /* List View - Vertical List (Current Default) */
              <div className="space-y-4" data-cursor-stable-container="job-list">
                {sortedFindWorkJobs.map((job, index) => {
                  const urgency = formatUrgency(new Date(job.startDate));
                  return (
                    <div
                      key={job.id}
                      id={`job-card-${job.id}`}
                      data-job-id={job.id}
                      data-cursor-stable-id={`job-${job.id}`}
                      className="group bg-card rounded-2xl border border-border/60 shadow-sm hover:shadow-lg hover:border-border transition-all duration-300 ease-out cursor-pointer overflow-hidden active:scale-[0.98]"
                      onClick={() => {
                        setSelectedFindJob(job);
                      }}
                      data-testid={`job-card-${job.id}`}
                      style={{ 
                        animationDelay: `${index * 50}ms`,
                        animation: 'fadeInUp 0.4s ease-out forwards'
                      }}
                    >
                      {/* Card header: first 2 rows (badges, title, payout) */}
                      <header className="px-4 pt-4 pb-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1 flex-wrap">
                              <Badge className={`${urgency.color} text-white text-[10px] px-2 py-0.5 font-medium`}>
                                {urgency.label}
                              </Badge>
                              <Popover>
                                <PopoverTrigger asChild>
                                  <button 
                                    id={`job-type-badge-${job.id}`}
                                    data-job-id={job.id}
                                    onClick={(e) => e.stopPropagation()}
                                    className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full font-medium bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800 cursor-pointer hover:bg-blue-100 dark:hover:bg-blue-900/50 transition-colors"
                                    data-testid={`job-type-badge-${job.id}`}
                                  >
                                    <CalendarIcon className="w-3 h-3" />
                                    {job.jobType === "recurring" ? "Recurring" : job.jobType === "on_demand" || job.isOnDemand ? "On Demand" : "One-Day"}
                                  </button>
                                </PopoverTrigger>
                                <PopoverContent className="w-72 p-3" align="start" onClick={(e) => e.stopPropagation()}>
                                  <div className="space-y-3">
                                    <div className="flex items-start gap-2">
                                      <div className="w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-900/50 flex items-center justify-center flex-shrink-0 mt-0.5">
                                        <CalendarIcon className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                                      </div>
                                      <div>
                                        <p className="font-semibold text-sm">
                                          {job.jobType === "recurring" ? "Recurring Job" : job.jobType === "on_demand" || job.isOnDemand ? "On Demand Job" : "One-Day Job"}
                                        </p>
                                        <p className="text-xs text-muted-foreground leading-relaxed">
                                          {job.jobType === "recurring" 
                                            ? "Repeating schedule with set hours" 
                                            : job.jobType === "on_demand" || job.isOnDemand 
                                              ? "Show up at the scheduled time and continue working until the job is complete" 
                                              : "Single day assignment with fixed start and end times"}
                                        </p>
                                      </div>
                                    </div>
                                    <div className="pt-2 border-t border-border/50">
                                      <p className="text-xs text-muted-foreground mb-1">
                                        {(job.jobType === "on_demand" || job.isOnDemand) ? "Start Time" : "Schedule"}
                                      </p>
                                      <p className="font-medium text-sm">
                                        {(() => {
                                          if (!job.startDate) return "TBD";
                                          const startDate = new Date(job.startDate);
                                          const now = new Date();
                                          const diffTime = startDate.getTime() - now.getTime();
                                          const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                                          const daysAwayText = diffDays === 0 ? "Today" : diffDays === 1 ? "Tomorrow" : `${diffDays} days away`;
                                          
                                          const formatScheduledTime = (time: string) => {
                                            const [hours, minutes] = time.split(':').map(Number);
                                            const period = hours >= 12 ? 'pm' : 'am';
                                            const displayHours = hours % 12 || 12;
                                            return minutes === 0 ? `${displayHours}${period}` : `${displayHours}:${minutes.toString().padStart(2, '0')}${period}`;
                                          };
                                          
                                          if (job.jobType === "recurring" && job.scheduleDays && job.scheduleDays.length > 0) {
                                            const daysStr = formatScheduleDays(job.scheduleDays);
                                            const startTime = job.scheduledTime ? formatScheduledTime(job.scheduledTime) : "";
                                            const endTimeStr = job.endTime ? formatScheduledTime(job.endTime) : "";
                                            const timeRange = startTime && endTimeStr ? ` ${startTime} - ${endTimeStr}` : startTime ? ` ${startTime}` : "";
                                            return `${daysStr}${timeRange} (${daysAwayText})`;
                                          }
                                          if (job.jobType === "on_demand" || job.isOnDemand) {
                                            const timeStr = job.scheduledTime 
                                              ? formatScheduledTime(job.scheduledTime)
                                              : format(startDate, "h:mma").toLowerCase();
                                            return `${timeStr} on ${format(startDate, "MMM d")} (${daysAwayText})`;
                                          }
                                          if (job.endDate) {
                                            const startTime = format(startDate, "h:mma").toLowerCase();
                                            const endTime = format(new Date(job.endDate), "h:mma").toLowerCase();
                                            return `${format(startDate, "MMM d")} - ${startTime} to ${endTime} (${daysAwayText})`;
                                          }
                                          const timeStr = job.scheduledTime ? ` at ${formatScheduledTime(job.scheduledTime)}` : "";
                                          return `${format(startDate, "MMM d, yyyy")}${timeStr} (${daysAwayText})`;
                                        })()}
                                      </p>
                                      {job.estimatedHours && (
                                        <p className="text-xs text-muted-foreground mt-1">
                                          Estimated: {job.estimatedHours} hours
                                        </p>
                                      )}
                                    </div>
                                  </div>
                                </PopoverContent>
                              </Popover>
                              {job.maxWorkersNeeded && job.maxWorkersNeeded > 1 && (
                                <Badge variant="outline" className="text-[10px] px-2 py-0.5 bg-purple-50 dark:bg-purple-950/50 text-purple-700 dark:text-purple-300 border-purple-200 dark:border-purple-800">
                                  <Users className="w-3 h-3 mr-1" />
                                  {job.maxWorkersNeeded} needed
                                </Badge>
                              )}
                              {(() => {
                                const imgs = job.images?.length ?? 0;
                                const vids = job.videos?.length ?? 0;
                                const n = imgs + vids;
                                if (n === 0) return null;
                                const parts = [];
                                if (imgs) parts.push(`${imgs} photo${imgs > 1 ? "s" : ""}`);
                                if (vids) parts.push(`${vids} video${vids > 1 ? "s" : ""}`);
                                return (
                                  <Badge variant="outline" className="text-[10px] px-2 py-0.5 bg-muted/50 text-muted-foreground border-0">
                                    {parts.join(", ")}
                                  </Badge>
                                );
                              })()}
                            </div>
                            <h3 className="font-semibold text-base leading-tight line-clamp-2 group-hover:text-primary transition-colors duration-200">
                              {job.title}
                            </h3>
                          </div>
                          
                          <div className="flex-shrink-0 text-right">
                            <div className="bg-green-50 dark:bg-green-950/40 rounded-full px-4 py-1.5 border border-green-200/50 dark:border-green-800/50 inline-flex flex-col items-center">
                              <p className="font-bold text-base text-green-600 dark:text-green-400 leading-none">
                                {formatFindWorkTotalEstPayout(profile?.hourlyRate, job)}
                              </p>
                              <p className="text-[10px] text-green-600/70 dark:text-green-400/70 mt-0.5">
                                {t("estPayout")}
                              </p>
                            </div>
                          </div>
                        </div>
                      </header>
                      
                      {/* Middle section with details */}
                      <div className="min-h-0 flex-1 px-4 pb-3">
                        <div className="flex items-center gap-3 text-sm text-muted-foreground mb-3">
                          <span className="flex items-center gap-1.5">
                            <div className="w-5 h-5 rounded-full bg-secondary/80 flex items-center justify-center">
                              <MapPin className="w-3 h-3" />
                            </div>
                            <span className="truncate max-w-[140px]">{formatJobLocation(job)}</span>
                          </span>
                          <span className="flex items-center gap-1.5">
                            <div className="w-5 h-5 rounded-full bg-secondary/80 flex items-center justify-center">
                              <Clock className="w-3 h-3" />
                            </div>
                            {job.estimatedHours ? `${job.estimatedHours}h` : "TBD"}
                          </span>
                        </div>
                        
                        {job.description && (
                          <p className="text-sm text-muted-foreground line-clamp-2 mb-3 leading-relaxed">
                            {job.description}
                          </p>
                        )}
                        
                        {/* Skills tags - deduplicated */}
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {(() => {
                            const allSkills = [job.trade, ...(job.requiredSkills || [])];
                            const uniqueSkills = [...new Set(allSkills.filter(Boolean))];
                            const displaySkills = uniqueSkills.slice(0, 3);
                            const remainingCount = uniqueSkills.length - 3;
                            return (
                              <>
                                {displaySkills.map(skill => (
                                  <Badge key={skill} variant="outline" className="text-xs bg-secondary/50 border-0 rounded-full px-2.5">
                                    {skill}
                                  </Badge>
                                ))}
                                {remainingCount > 0 && (
                                  <Badge variant="outline" className="text-xs bg-secondary/50 border-0 rounded-full px-2.5">
                                    +{remainingCount}
                                  </Badge>
                                )}
                              </>
                            );
                          })()}
                        </div>
                      </div>
                      
                      {/* Bottom action bar */}
                      <div className="flex flex-shrink-0 items-center justify-between gap-2 border-t border-border/40 bg-secondary/30 px-4 py-3">
                        <Button
                          id={`dismiss-job-btn-${job.id}`}
                          data-job-id={job.id}
                          variant="ghost"
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            setJobToDismiss(job);
                          }}
                          className="text-muted-foreground hover:text-foreground rounded-full px-4 h-9"
                          data-testid={`dismiss-job-${job.id}`}
                        >
                          <X className="w-4 h-4 mr-1.5" />
                          Skip
                        </Button>
                        <Button 
                          id={`apply-job-btn-${job.id}`}
                          data-job-id={job.id}
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            setApplyJob(job);
                          }}
                          className="rounded-full px-5 h-9 shadow-sm"
                          data-testid={`apply-job-${job.id}`}
                        >
                          Apply Now
                          <ChevronRight className="w-4 h-4 ml-1" />
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : viewMode === "table" ? (
              /* Table View - Clean Table Layout */
              <div className="rounded-lg border border-border overflow-hidden" data-cursor-stable-container="job-list">
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-muted/50">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">Job</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">Location</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">Schedule</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">Hours</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">Payout</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">Skills</th>
                        <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {sortedFindWorkJobs.map((job, index) => {
                        const urgency = formatUrgency(new Date(job.startDate));
                        const allSkills = [job.trade, ...(job.requiredSkills || [])];
                        const uniqueSkills = [...new Set(allSkills.filter(Boolean))];
                        return (
                          <tr
                            key={job.id}
                            id={`job-row-${job.id}`}
                            data-job-id={job.id}
                            className="hover:bg-muted/30 cursor-pointer transition-colors"
                            onClick={() => setSelectedFindJob(job)}
                          >
                            <td className="px-4 py-4">
                              <div className="flex items-start gap-3">
                                {/* Thumbnail - Gallery or Map */}
                                <div className="relative flex-shrink-0 w-20 h-20 rounded-lg overflow-hidden bg-muted">
                                  {job.images && job.images.length > 0 ? (
                                    <>
                                      {/* Gallery Image Thumbnail */}
                                      <img 
                                        src={job.images[0]} 
                                        alt={job.title}
                                        className="w-full h-full object-cover"
                                      />
                                      {/* Image Count Badge */}
                                      {job.images.length > 1 && (
                                        <div className="absolute bottom-1 right-1 bg-black/70 text-white text-[10px] font-semibold px-1.5 py-0.5 rounded">
                                          +{job.images.length - 1}
                                        </div>
                                      )}
                                    </>
                                  ) : (job as any).mapThumbnailUrl ? (
                                    /* Reused static map thumbnail (generated once on job create) */
                                    <img src={(job as any).mapThumbnailUrl} alt="Job location" className="w-full h-full object-cover" />
                                  ) : (
                                    /* Map Thumbnail fallback */
                                    <div className="w-full h-full">
                                      {job.latitude && job.longitude && (
                                        <MiniJobMap
                                          job={{
                                            id: job.id,
                                            lat: parseFloat(job.latitude),
                                            lng: parseFloat(job.longitude),
                                            title: job.title,
                                            trade: job.trade,
                                            hourlyRate: job.hourlyRate,
                                            city: job.city || undefined,
                                            state: job.state || undefined,
                                          }}
                                          height="80px"
                                          className="rounded-lg"
                                          showApproximateRadius={true}
                                        />
                                      )}
                                    </div>
                                  )}
                                </div>
                                
                                {/* Job Info */}
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2 mb-1">
                                    <Badge className={`${urgency.color} text-white text-[10px] px-2 py-0.5 font-medium`}>
                                      {urgency.label}
                                    </Badge>
                                    <Badge variant="outline" className="text-[10px] px-2 py-0.5">
                                      {job.jobType === "recurring" ? "Recurring" : job.jobType === "on_demand" || job.isOnDemand ? "On Demand" : "One-Day"}
                                    </Badge>
                                  </div>
                                  <h3 className="font-semibold text-sm leading-tight">{getDisplayJobTitle(job)}</h3>
                                  {job.description && (
                                    <p className="text-xs text-muted-foreground line-clamp-1 mt-1">{job.description}</p>
                                  )}
                                </div>
                              </div>
                            </td>
                            <td className="px-4 py-4">
                              <div className="flex items-center gap-1.5 text-sm">
                                <MapPin className="w-3 h-3 text-muted-foreground" />
                                <span className="text-sm">{formatJobLocation(job)}</span>
                              </div>
                            </td>
                            <td className="px-4 py-4">
                              <div className="text-sm">
                                {job.startDate ? (
                                  <span>{format(new Date(job.startDate), "MMM d, h:mma")}</span>
                                ) : (
                                  <span className="text-muted-foreground">TBD</span>
                                )}
                              </div>
                            </td>
                            <td className="px-4 py-4">
                              <div className="flex items-center gap-1.5 text-sm">
                                <Clock className="w-3 h-3 text-muted-foreground" />
                                <span>{job.estimatedHours ? `${job.estimatedHours}h` : "TBD"}</span>
                              </div>
                            </td>
                            <td className="px-4 py-4">
                              <div className="font-semibold text-green-600 dark:text-green-400 px-6">
                                {formatFindWorkTotalEstPayout(profile?.hourlyRate, job)}
                              </div>
                            </td>
                            <td className="px-4 py-4">
                              <div className="flex flex-wrap gap-1">
                                {uniqueSkills.slice(0, 2).map(skill => (
                                  <Badge key={skill} variant="outline" className="text-xs">
                                    {skill}
                                  </Badge>
                                ))}
                                {uniqueSkills.length > 2 && (
                                  <Badge variant="outline" className="text-xs">
                                    +{uniqueSkills.length - 2}
                                  </Badge>
                                )}
                              </div>
                            </td>
                            <td className="px-4 py-4">
                              <div className="flex items-center justify-end gap-2">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setJobToDismiss(job);
                                  }}
                                  className="h-8"
                                >
                                  <X className="w-4 h-4" />
                                </Button>
                                <Button 
                                  size="sm"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setApplyJob(job);
                                  }}
                                  className="h-8"
                                >
                                  Apply
                                </Button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : null}
            {viewMode !== "map" && hasNextFindWorkPage && (
              <div className="flex justify-center py-4">
                <Button variant="outline" size="sm" onClick={() => fetchNextFindWorkPage()} disabled={isFetchingNextFindWorkPage} className="gap-2" data-testid="find-work-load-more">
                  {isFetchingNextFindWorkPage ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                  {t("findWorkLoadMore")}
                </Button>
              </div>
            )}

            {/* Enhanced Job Details Dialog - Centered on desktop, bottom sheet on mobile */}
            <EnhancedJobDialog
              open={!!selectedFindJob && viewMode !== "map"}
              onOpenChange={(open) => !open && setSelectedFindJob(null)}
              job={selectedFindJob}
              profile={profile}
              activeTeamMembers={allTeamMembersForApply}
              workerLocation={workerLocation}
              territoryRadiusMiles={clampedMaxDistanceMiles}
              onOpenApply={(job) => {
                setSelectedFindJob(null);
                setApplyJob(job);
              }}
              onDismiss={(job) => {
                setJobToDismiss(job);
                setSelectedFindJob(null);
              }}
            />
          </div>
        )}

        {/* Jobs Tab - Airbnb Style */}
        {activeTab === "jobs" && (
          <div className="space-y-6 px-3 md:px-0">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-2">
              <div>
                <h1 className="text-2xl font-bold">{t("myJobs")}</h1>
                <p className="text-muted-foreground">{t("trackApplicationsAndWork")}</p>
              </div>
            </div>
            {/* Skeleton loading while applications fetch */}
            {applicationsLoading && (
              <div className="space-y-4">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="bg-card rounded-2xl border border-border/60 shadow-sm p-4 space-y-3">
                    <div className="flex items-start gap-3">
                      <Skeleton className="h-12 w-12 rounded-xl flex-shrink-0" />
                      <div className="space-y-2 flex-1">
                        <Skeleton className="h-4 w-1/2" />
                        <Skeleton className="h-3 w-1/3" />
                      </div>
                      <Skeleton className="h-6 w-16 rounded-full" />
                    </div>
                    <div className="flex gap-2">
                      <Skeleton className="h-3 w-20" />
                      <Skeleton className="h-3 w-20" />
                    </div>
                  </div>
                ))}
              </div>
            )}
            
            {/* Direct Job Inquiries Section */}
            {pendingInquiries.length > 0 && (
              <div className="space-y-4">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                    <Send className="w-4 h-4 text-primary" />
                  </div>
                  <div>
                    <h2 className="font-semibold">Direct Job Requests</h2>
                    <p className="text-sm text-muted-foreground">Companies want to hire you directly</p>
                  </div>
                  <Badge className="ml-auto">{pendingInquiries.length}</Badge>
                </div>
                
                {pendingInquiries.map((inquiry) => {
                  const startDate = parseISO(inquiry.startDate);
                  const expiresAt = inquiry.expiresAt ? parseISO(inquiry.expiresAt) : null;
                  const hoursRemaining = expiresAt ? Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / (1000 * 60 * 60))) : 24;
                  const payout = (inquiry.hourlyRate * (inquiry.estimatedHours || 8)) / 100;
                  const company = inquiry.company;
                  
                  return (
                    <Card key={inquiry.id} className="border-primary/20 bg-primary/5" data-testid={`card-inquiry-${inquiry.id}`}>
                      <CardContent className="p-4">
                        <div className="flex items-start gap-3">
                          <Avatar className="w-12 h-12 border-2 border-primary/20">
                            <AvatarImage src={company?.avatarUrl || company?.companyLogo || undefined} />
                            <AvatarFallback className="bg-primary/10 text-primary font-semibold">
                              {company?.companyName?.[0] || company?.firstName?.[0] || "C"}
                            </AvatarFallback>
                          </Avatar>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-start justify-between gap-2">
                              <div>
                                <h3 className="font-semibold truncate">{inquiry.title}</h3>
                                <p className="text-sm text-muted-foreground">{company?.companyName || `${company?.firstName || ''} ${company?.lastName || ''}`.trim() || 'Company'}</p>
                              </div>
                              <Badge variant="outline" className="flex-shrink-0 text-amber-600 border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800">
                                {hoursRemaining}h left
                              </Badge>
                            </div>
                            
                            <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                              <span className="flex items-center gap-1">
                                <MapPin className="w-3.5 h-3.5" />
                                {inquiry.city}, {inquiry.state}
                              </span>
                              <span className="flex items-center gap-1">
                                <CalendarIcon className="w-3.5 h-3.5" />
                                {format(startDate, "MMM d")}
                                {inquiry.scheduledTime && ` at ${inquiry.scheduledTime}`}
                              </span>
                              <span className="flex items-center gap-1 font-medium text-primary">
                                <DollarSign className="w-3.5 h-3.5" />
                                ${payout.toLocaleString()} est.
                              </span>
                            </div>
                            
                            <p className="mt-2 text-sm text-muted-foreground line-clamp-2">{inquiry.description}</p>
                            
                            <div className="mt-4 flex gap-2">
                              <Button 
                                size="sm" 
                                onClick={() => respondToInquiryMutation.mutate({ inquiryId: inquiry.id, status: 'accepted' })}
                                disabled={respondToInquiryMutation.isPending}
                                className="flex-1"
                                data-testid={`button-accept-inquiry-${inquiry.id}`}
                              >
                                {respondToInquiryMutation.isPending ? (
                                  <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                                ) : (
                                  <Check className="w-4 h-4 mr-1" />
                                )}
                                Accept Job
                              </Button>
                              <Button 
                                size="sm" 
                                variant="outline"
                                onClick={() => respondToInquiryMutation.mutate({ inquiryId: inquiry.id, status: 'declined' })}
                                disabled={respondToInquiryMutation.isPending}
                                className="flex-1"
                                data-testid={`button-decline-inquiry-${inquiry.id}`}
                              >
                                <XCircle className="w-4 h-4 mr-1" />
                                Decline
                              </Button>
                            </div>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
            
            {!applicationsLoading && <Tabs defaultValue="pending" className="w-full">
              <TabsList className="w-max max-w-full md:grid md:w-full md:grid-cols-3">
                <TabsTrigger value="pending" className="gap-2 rounded-lg data-[state=active]:shadow-sm">
                  Pending Applications
                  {pendingApplications.length > 0 && (
                    <Badge variant="secondary" className="ml-1 h-5 min-w-5 px-1.5">{pendingApplications.length}</Badge>
                  )}
                </TabsTrigger>
                <TabsTrigger value="accepted" className="gap-2 rounded-lg data-[state=active]:shadow-sm">
                  {t("accepted")}
                  {acceptedApplications.length > 0 && (
                    <Badge variant="secondary" className="ml-1 h-5 min-w-5 px-1.5">{acceptedApplications.length}</Badge>
                  )}
                </TabsTrigger>
                <TabsTrigger value="rejected" className="rounded-lg data-[state=active]:shadow-sm">{t("notSelected")}</TabsTrigger>
              </TabsList>

              <TabsContent value="pending" id="jobs-pending-tab" data-cursor-stable-container="jobs-pending" className="mt-6 space-y-4">
                {/* Info Card - Airbnb style */}
                <div className="bg-gradient-to-r from-yellow-50 to-amber-50 dark:from-yellow-950/30 dark:to-amber-950/30 rounded-2xl p-4 shadow-sm border border-yellow-100 dark:border-yellow-900/50">
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-full bg-yellow-100 dark:bg-yellow-900/50 flex items-center justify-center flex-shrink-0">
                      <Clock className="w-5 h-5 text-yellow-600 dark:text-yellow-400" />
                    </div>
                    <div>
                      <p className="font-semibold text-yellow-800 dark:text-yellow-200">{t("awaitingResponse")}</p>
                      <p className="text-sm text-yellow-700/80 dark:text-yellow-300/70 mt-0.5">{t("applicationsBeingReviewed")}</p>
                    </div>
                  </div>
                </div>
                {groupedPendingApplications.length === 0 ? (
                  <div className="bg-card rounded-2xl border border-border/60 shadow-sm p-12 text-center">
                    <div className="w-16 h-16 rounded-full bg-secondary/80 flex items-center justify-center mx-auto mb-4">
                      <Clock className="w-8 h-8 text-muted-foreground" />
                    </div>
                    <p className="text-muted-foreground font-medium">{t("noPendingApplications")}</p>
                    <p className="text-sm text-muted-foreground/70 mt-1">{t("applyToJobsToSeeThem")}</p>
                    <Button variant="outline" size="sm" className="mt-3" onClick={() => setActiveTab("find")}>
                      Find jobs
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-4" data-cursor-stable-container="pending-jobs-list">
                    {groupedPendingApplications.map(({ jobId, applications: jobApps, primaryApp }, index) => {
                      const job = allJobs.find(j => j.id === jobId);
                      if (!job) return null;
                      const categoryInfo = getJobCategoryLabel(job);
                      // Calculate combined payout for all workers
                      const combinedPayout = jobApps.reduce((total, app) => {
                        const hours = job.estimatedHours ?? 8;
                        // Always use proposedRate first (the rate at time of application), not current team member rate
                        const rate = rateToDollars(app.proposedRate ?? app.teamMember?.hourlyRate ?? profile?.hourlyRate ?? 30);
                        return total + (rate * hours);
                      }, 0);
                      const timeline = getPendingTimelineDetails(job);
                      // For pending status, only show street, city, zip (not full address)
                      const pendingLocationDisplay = (() => {
                        const parts = [];
                        if (job.address) parts.push(job.address);
                        if (job.city) parts.push(job.city);
                        if (job.zipCode) parts.push(job.zipCode);
                        return parts.length > 0 ? parts.join(", ") : job.location;
                      })();
                      
                      return (
                        <div
                          key={jobId}
                          id={`job-card-pending-${jobId}`}
                          data-job-id={jobId}
                          data-cursor-stable-id={`pending-job-${jobId}`}
                          className="group bg-card rounded-xl border border-border/60 shadow-sm hover:shadow-md hover:border-border transition-all duration-200 ease-out cursor-pointer overflow-hidden active:scale-[0.99] animate-fadeInUp"
                          onClick={() => setSelectedJobApp(primaryApp)}
                          data-testid={`job-card-pending-${jobId}`}
                          style={{ animationDelay: `${index * 50}ms` }}
                        >
                          <div className="px-3 pt-3 pb-2.5">
                            <div className="flex items-start justify-between gap-3">
                              <div className="flex items-start gap-3 flex-1 min-w-0">
                                {/* Overlapping avatars for multiple workers */}
                                <div className="flex flex-wrap gap-1.5 flex-shrink-0 max-w-[120px]">
                                  {jobApps.map((app, i) => {
                                    const member = app.teamMember;
                                    const hasTeamMemberId = !!app.teamMemberId;
                                    const isAdminApplication = !hasTeamMemberId;
                                    const avatarSrc = isAdminApplication ? profile?.avatarUrl : (member?.avatarUrl || undefined);
                                    const initials = isAdminApplication 
                                      ? `${profile?.firstName?.[0] || ''}${profile?.lastName?.[0] || ''}`
                                      : (member ? `${member.firstName?.[0] || ''}${member.lastName?.[0] || ''}` : 'TM');
                                    const displayName = isAdminApplication 
                                      ? `${profile?.firstName} ${profile?.lastName}`
                                      : (member ? `${member.firstName} ${member.lastName}` : 'Team Member');
                                    return (
                                      <Avatar 
                                        key={app.id} 
                                        className="w-8 h-8 border border-card ring-1 ring-yellow-200/50"
                                        style={{ zIndex: 200 - i }}
                                        title={displayName}
                                      >
                                        <AvatarImage src={avatarSrc || undefined} />
                                        <AvatarFallback className="text-[10px] bg-yellow-50 text-yellow-700">
                                          {initials}
                                        </AvatarFallback>
                                      </Avatar>
                                    );
                                  })}
                                </div>
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-1.5 mb-1 flex-wrap">
                                    <Badge variant="outline" className="text-[10px] px-2 py-0.5 bg-yellow-50 dark:bg-yellow-950/50 text-yellow-700 dark:text-yellow-300 border-yellow-200 dark:border-yellow-800">
                                      <Clock className="w-3 h-3 mr-1" /> {t("pending")}
                                    </Badge>
                                    {primaryApp?.isAiDispatched && (
                                      <Badge variant="outline" className="text-[10px] px-2 py-0.5 bg-purple-100 dark:bg-purple-900/50 text-purple-700 dark:text-purple-300 border-purple-200 dark:border-purple-800">
                                        <Sparkles className="w-3 h-3 mr-1" /> AI Dispatched
                                      </Badge>
                                    )}
                                    <Badge variant="outline" className="text-[10px] px-2 py-0.5 bg-purple-50 dark:bg-purple-950/50 text-purple-700 dark:text-purple-300 border-purple-200 dark:border-purple-800">
                                      <Users className="w-3 h-3 mr-1" /> {jobApps.length} {jobApps.length === 1 ? "worker" : "workers"}
                                    </Badge>
                                    {jobApps.length === 1 && jobApps[0].teamMember && (
                                      <span className="text-xs font-medium text-primary">
                                        For: {jobApps[0].teamMember.firstName} {jobApps[0].teamMember.lastName}
                                      </span>
                                    )}
                                  </div>
                                  <h3 className="font-semibold text-sm leading-tight line-clamp-2 group-hover:text-primary transition-colors duration-200">
                                    {getDisplayJobTitle(job)}
                                  </h3>
                                </div>
                              </div>
                              
                              <div className="flex-shrink-0 text-right flex flex-col items-end gap-2">
                                <div className="bg-green-50 dark:bg-green-950/40 rounded-lg px-2.5 py-1.5 border border-green-200/50 dark:border-green-800/50">
                                  <p className="font-bold text-base text-green-600 dark:text-green-400 leading-none">
                                    ${combinedPayout.toLocaleString()}
                                  </p>
                                  <p className="text-[10px] text-green-600/70 dark:text-green-400/70 mt-0.5">
                                    {jobApps.length > 1 ? t("combinedPayout") : t("estPayout")}
                                  </p>
                                </div>
                                {showClientDevTools() && (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="text-xs h-8 border-amber-300 text-amber-700 hover:bg-amber-50 dark:border-amber-700 dark:text-amber-400 dark:hover:bg-amber-950/50"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      devAcceptApplicationsMutation.mutate(jobApps.map((a) => a.id));
                                    }}
                                    disabled={devAcceptApplicationsMutation.isPending}
                                    data-testid="dev-accept-pending-job"
                                  >
                                    {devAcceptApplicationsMutation.isPending ? (
                                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                    ) : (
                                      <Check className="w-3.5 h-3.5 mr-1" />
                                    )}
                                    Dev: Accept as company
                                  </Button>
                                )}
                              </div>
                            </div>
                          </div>
                          
                          <div className="px-3 pb-2.5">
                            <p className="text-sm font-medium text-foreground mb-1 flex items-center gap-1.5">
                              <CalendarIcon className="w-4 h-4 text-muted-foreground" />
                              {timeline.title}
                            </p>
                            {timeline.subtitle && (
                              <p className="text-xs text-muted-foreground mb-1.5 pl-5">{timeline.subtitle}</p>
                            )}
                            <div className="flex items-center gap-2 text-sm text-muted-foreground flex-wrap">
                              <span className="flex items-center gap-1.5">
                                <div className="w-5 h-5 rounded-full bg-secondary/80 flex items-center justify-center">
                                  <MapPin className="w-3 h-3" />
                                </div>
                                <span className="truncate max-w-[140px]">{pendingLocationDisplay}</span>
                              </span>
                              {(job.estimatedHours || timeline.scheduledDaysCount != null) && (
                                <span className="flex items-center gap-1">
                                  <Clock className="w-3 h-3" />
                                  {job.estimatedHours ?? 8}h total{timeline.scheduledDaysCount != null ? ` / ${timeline.scheduledDaysCount} days` : ""}
                                </span>
                              )}
                              <Badge className={`text-[10px] px-2 py-0.5 font-medium text-white ${categoryInfo.color}`}>
                                {categoryInfo.label}
                              </Badge>
                            </div>
                          </div>
                          
                          <div className="px-3 py-2 bg-secondary/30 border-t border-border/40 flex items-center justify-end">
                            <ChevronRight className="w-5 h-5 text-muted-foreground group-hover:text-primary transition-colors" />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </TabsContent>

              <TabsContent value="accepted" id="jobs-accepted-tab" data-cursor-stable-container="jobs-accepted" className="mt-6 space-y-4">
                {/* Info Card - Airbnb style */}
                <div className="bg-gradient-to-r from-green-50 to-emerald-50 dark:from-green-950/30 dark:to-emerald-950/30 rounded-2xl p-4 shadow-sm border border-green-100 dark:border-green-900/50">
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-full bg-green-100 dark:bg-green-900/50 flex items-center justify-center flex-shrink-0">
                      <Check className="w-5 h-5 text-green-600 dark:text-green-400" />
                    </div>
                    <div>
                      <p className="font-semibold text-green-800 dark:text-green-200">{t("confirmedJobs")}</p>
                      <p className="text-sm text-green-700/80 dark:text-green-300/70 mt-0.5">{t("confirmedJobsDescription")}</p>
                    </div>
                  </div>
                </div>
                {groupedAcceptedApplications.length === 0 ? (
                  <div className="bg-card rounded-2xl border border-border/60 shadow-sm p-12 text-center">
                    <div className="w-16 h-16 rounded-full bg-secondary/80 flex items-center justify-center mx-auto mb-4">
                      <Check className="w-8 h-8 text-muted-foreground" />
                    </div>
                    <p className="text-muted-foreground font-medium">{t("noAcceptedJobsYet")}</p>
                    <p className="text-sm text-muted-foreground/70 mt-1">{t("whenCompaniesAcceptApplications")}</p>
                    <Button variant="outline" size="sm" className="mt-3" onClick={() => setActiveTab("find")}>
                      Browse jobs
                    </Button>
                  </div>
                ) : (
                  <div className="overflow-hidden min-w-0" data-cursor-stable-container="accepted-jobs-list">
                    {/* Table-style header — same grid as rows so columns align (hidden on xs to avoid horizontal scroll) */}
                    <div className="hidden md:grid gap-3 px-4 py-2 text-xs font-medium text-muted-foreground border-b border-border/60 min-w-0" style={{ gridTemplateColumns: "minmax(0, 1fr) minmax(90px, 130px) minmax(0, 90px) 48px 64px 80px" }}>
                      <span>{t("job") || "Job"}</span>
                      <span>{t("dateTime") || "Date & time"}</span>
                      <span>{t("location") || "Location"}</span>
                      <span>{t("hours") || "Hours"}</span>
                      <span>{t("estPayout") || "Payout"}</span>
                      <span className="text-right" />
                    </div>
                    <div className="space-y-3">
                    {groupedAcceptedApplications.map(({ jobId, applications: jobApps, primaryApp }, index) => {
                      const job = allJobs.find(j => j.id === jobId);
                      if (!job) return null;
                      const categoryInfo = getJobCategoryLabel(job);
                      const jobTsList = timesheetsByJobId.get(jobId) ?? [];
                      const tsRollup = rollupAcceptedJobTimesheets(jobTsList);
                      // Calculate combined payout for all workers using proposedRate (locked at application time)
                      const combinedPayout = jobApps.reduce((total, app) => {
                        const hours = getBillableHoursForPayout(job);
                        // proposedRate is the rate locked at application time - use it first for accuracy
                        const rate = rateToDollars(app.proposedRate ?? app.teamMember?.hourlyRate ?? profile?.hourlyRate ?? 30);
                        return total + (rate * hours);
                      }, 0);
                      const dateTimeDisplay = (() => {
                        if (!job.startDate) return "On Demand";
                        const startDate = parseISO(job.startDate.toString());
                        const relative = getRelativeDayLabel(startDate);
                        const dateStr = format(startDate, "MMM d");
                        const datePart = relative ? `${dateStr} (${relative})` : dateStr;

                        // Handle recurring jobs with schedule days — show days of week (e.g. Mon, Wed, Fri) and time range once
                        const recurringDays = job.scheduleDays || (job as { recurringDays?: string[] }).recurringDays;
                        if (job.jobType === "recurring" && recurringDays && recurringDays.length > 0) {
                          const daysStr = formatScheduleDays(recurringDays);
                          const startTimeStr = startTimeOnly(formatTimeString(job.scheduledTime));
                          const endTimeStr = endTimeOnly(formatTimeString(job.endTime));
                          const relPart = relative ? ` (${relative})` : "";
                          if (startTimeStr && endTimeStr && startTimeStr !== endTimeStr) {
                            return `${daysStr}${relPart} Start ${startTimeStr} - ${endTimeStr}`;
                          }
                          if (startTimeStr) return `${daysStr}${relPart} Start ${startTimeStr}`;
                          return `${daysStr}${relPart}`;
                        }

                        // Handle one-time jobs with separate start/end time fields (avoid duplicate end time)
                        if (job.scheduledTime || job.endTime) {
                          const startTimeStr = startTimeOnly(formatTimeString(job.scheduledTime));
                          const endTimeStr = endTimeOnly(formatTimeString(job.endTime));
                          if (startTimeStr && endTimeStr && startTimeStr !== endTimeStr) {
                            return `${datePart} Start ${startTimeStr} - ${endTimeStr}`;
                          }
                          if (startTimeStr) return `${datePart} Start ${startTimeStr}`;
                          if (endTimeStr) return `${datePart} End ${endTimeStr}`;
                        }

                        // Format times for legacy jobs (startDate/endDate timestamps)
                        const startTime = format(startDate, "h:mma").toLowerCase();
                        const endTime = job.endDate && job.jobType !== "recurring"
                          ? format(parseISO(job.endDate.toString()), "h:mma").toLowerCase()
                          : null;
                        if (endTime && endTime !== startTime) {
                          return `${datePart} Start ${startTime} - ${endTime}`;
                        }
                        return `${datePart} Start ${startTime}`;
                      })();
                      return (
                        <div
                          key={jobId}
                          id={`job-card-accepted-${jobId}`}
                          data-job-id={jobId}
                          data-cursor-stable-id={`accepted-job-${jobId}`}
                          className="group bg-card rounded-xl border-2 border-green-200 dark:border-green-900 shadow-sm hover:shadow-md transition-all duration-200 cursor-pointer overflow-hidden active:scale-[0.99] animate-fadeInUp"
                          onClick={() => setSelectedJobApp(primaryApp)}
                          data-testid={`job-card-accepted-${jobId}`}
                          style={{ animationDelay: `${index * 50}ms` }}
                        >
                          <div className="grid gap-2 md:gap-3 px-4 py-3 items-center w-full min-w-0 grid-cols-1 md:grid-cols-[minmax(0,1fr)_minmax(90px,130px)_minmax(0,90px)_48px_64px_80px]">
                            {/* Job column */}
                            <div className="min-w-0 flex items-center gap-3">
                              <div className="flex -space-x-2.5 flex-shrink-0">
                                {jobApps.slice(0, 3).map((app, i) => {
                                  const member = app.teamMember;
                                  const hasTeamMemberId = !!app.teamMemberId;
                                  const isAdminApplication = !hasTeamMemberId;
                                  const avatarSrc = isAdminApplication ? profile?.avatarUrl : (member?.avatarUrl || undefined);
                                  const initials = isAdminApplication 
                                    ? `${profile?.firstName?.[0] || ''}${profile?.lastName?.[0] || ''}`
                                    : (member ? `${member.firstName?.[0] || ''}${member.lastName?.[0] || ''}` : 'TM');
                                  return (
                                    <Avatar 
                                      key={app.id} 
                                      className="w-8 h-8 border-2 border-card ring-1 ring-green-300/50"
                                      style={{ zIndex: 3 - i }}
                                      title={isAdminApplication ? `${profile?.firstName} ${profile?.lastName}` : (member ? `${member.firstName} ${member.lastName}` : 'Team Member')}
                                    >
                                      <AvatarImage src={avatarSrc || undefined} />
                                      <AvatarFallback className="text-[10px] bg-green-100 text-green-700">
                                        {initials}
                                      </AvatarFallback>
                                    </Avatar>
                                  );
                                })}
                                {jobApps.length > 3 && (
                                  <div className="w-8 h-8 rounded-full bg-green-100 dark:bg-green-900/50 border-2 border-card flex items-center justify-center text-[10px] font-medium text-green-700 dark:text-green-300">
                                    +{jobApps.length - 3}
                                  </div>
                                )}
                              </div>
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-1.5 flex-wrap mb-0.5">
                                  <Badge className="text-[10px] px-1.5 py-0 bg-green-100 dark:bg-green-900/50 text-green-700 dark:text-green-300 border-0">
                                    <Check className="w-2.5 h-2.5 mr-0.5" /> {t("accepted")}
                                  </Badge>
                                  <Badge variant="outline" className="text-[10px] px-1.5 py-0 bg-purple-50 dark:bg-purple-950/50 text-purple-700 dark:text-purple-300 border-purple-200 dark:border-purple-800">
                                    {jobApps.length} {jobApps.length === 1 ? "worker" : "workers"}
                                  </Badge>
                                  {jobApps.length === 1 && jobApps[0].teamMember && (
                                    <span className="text-xs text-green-600 dark:text-green-400 truncate">
                                      For: {jobApps[0].teamMember.firstName} {jobApps[0].teamMember.lastName}
                                    </span>
                                  )}
                                </div>
                                <h3 className="font-semibold text-sm leading-tight truncate group-hover:text-primary transition-colors">
                                  {getDisplayJobTitle(job)}
                                </h3>
                              </div>
                            </div>
                            {/* Date & time */}
                            <p className="text-xs text-muted-foreground truncate" title={dateTimeDisplay}>
                              {dateTimeDisplay}
                            </p>
                            {/* Location */}
                            <p className="text-xs text-muted-foreground truncate min-w-0" title={job.location || undefined}>
                              {job.location}
                            </p>
                            {/* Hours + category */}
                            <div className="flex flex-col gap-0.5">
                              {getDisplayHours(job) != null && (
                                <span className="text-xs font-medium tabular-nums">{getDisplayHours(job)}h</span>
                              )}
                              <Badge className={`text-[9px] px-1.5 py-0 w-fit font-medium text-white ${categoryInfo.color}`}>
                                {categoryInfo.label}
                              </Badge>
                            </div>
                            {/* Payout */}
                            <div
                              className="inline-flex items-center rounded-full px-2 py-0.5 border border-green-300/60 dark:border-green-700/60 bg-green-50 dark:bg-green-950/40 text-xs font-semibold text-green-700 dark:text-green-300 w-fit leading-none"
                              title={jobApps.length > 1 ? t("combinedPayout") : t("estPayout")}
                            >
                              ${combinedPayout.toLocaleString()}
                            </div>
                            {/* Action */}
                            <div className="flex justify-end">
                              <Button size="sm" variant="ghost" className="h-7 px-2 text-green-700 dark:text-green-300 hover:bg-green-100 dark:hover:bg-green-900/50 text-xs">
                                {t("viewDetails")}
                                <ChevronRight className="w-3.5 h-3.5 ml-0.5" />
                              </Button>
                            </div>
                          </div>

                          {/* Timesheets & actual earnings (per job) */}
                          <div
                            className="border-t border-green-200/60 dark:border-green-800/50 bg-gradient-to-b from-green-50/90 to-green-50/40 dark:from-green-950/35 dark:to-green-950/10 px-4 py-3 space-y-2.5"
                            onClick={(e) => e.stopPropagation()}
                            data-testid={`accepted-job-timesheets-${jobId}`}
                          >
                            <div className="flex items-center justify-between gap-2 flex-wrap">
                              <p className="text-[10px] font-semibold uppercase tracking-wider text-green-800/80 dark:text-green-300/90">
                                Timesheets & pay
                              </p>
                              {tsRollup.total > 0 && (
                                <span className="text-[10px] text-muted-foreground tabular-nums">
                                  {tsRollup.total} shift{tsRollup.total === 1 ? "" : "s"} logged
                                </span>
                              )}
                            </div>
                            {tsRollup.total === 0 ? (
                              <p className="text-xs text-green-800/70 dark:text-green-200/70 leading-snug">
                                No timesheets yet. When you work this job, clock in from the job card — submitted shifts and payouts will show here.
                              </p>
                            ) : (
                              <>
                                <div className="flex flex-wrap gap-2">
                                  {tsRollup.activeShift > 0 && (
                                    <Badge variant="outline" className="text-[10px] px-2 py-0.5 font-medium border-purple-300/60 bg-purple-50/80 dark:bg-purple-950/40 text-purple-800 dark:text-purple-200">
                                      <Clock className="w-3 h-3 mr-1" />
                                      {tsRollup.activeShift} in progress
                                    </Badge>
                                  )}
                                  {tsRollup.pendingReview > 0 && (
                                    <Badge variant="outline" className="text-[10px] px-2 py-0.5 font-medium border-amber-300/70 bg-amber-50/90 dark:bg-amber-950/35 text-amber-900 dark:text-amber-200">
                                      {tsRollup.pendingReview} pending approval
                                      <span className="ml-1 tabular-nums opacity-90">
                                        ~${(tsRollup.pendingReviewCents / 100).toFixed(2)}
                                      </span>
                                    </Badge>
                                  )}
                                  {tsRollup.approvedUnpaid > 0 && (
                                    <Badge variant="outline" className="text-[10px] px-2 py-0.5 font-medium border-blue-300/60 bg-blue-50/90 dark:bg-blue-950/35 text-blue-900 dark:text-blue-200">
                                      {tsRollup.approvedUnpaid} approved
                                      <span className="ml-1 tabular-nums">
                                        ${(tsRollup.approvedUnpaidCents / 100).toFixed(2)}
                                      </span>
                                    </Badge>
                                  )}
                                  {tsRollup.paid > 0 && (
                                    <Badge variant="outline" className="text-[10px] px-2 py-0.5 font-medium border-green-400/70 bg-green-100/90 dark:bg-green-900/45 text-green-900 dark:text-green-100">
                                      <DollarSign className="w-3 h-3 mr-0.5 inline" />
                                      {tsRollup.paid} paid
                                      <span className="ml-1 tabular-nums font-semibold">
                                        ${(tsRollup.paidCents / 100).toFixed(2)}
                                      </span>
                                    </Badge>
                                  )}
                                </div>
                                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-[11px] leading-tight">
                                  <div className="rounded-lg bg-background/70 dark:bg-background/20 border border-border/50 px-2.5 py-1.5">
                                    <p className="text-muted-foreground font-medium">Paid to you</p>
                                    <p className="text-sm font-bold tabular-nums text-green-700 dark:text-green-400">
                                      ${(tsRollup.paidCents / 100).toFixed(2)}
                                    </p>
                                  </div>
                                  <div className="rounded-lg bg-background/70 dark:bg-background/20 border border-border/50 px-2.5 py-1.5">
                                    <p className="text-muted-foreground font-medium">Awaiting company</p>
                                    <p className="text-sm font-semibold tabular-nums text-amber-800 dark:text-amber-200">
                                      ~${(tsRollup.pendingReviewCents / 100).toFixed(2)}
                                    </p>
                                  </div>
                                  <div className="rounded-lg bg-background/70 dark:bg-background/20 border border-border/50 px-2.5 py-1.5">
                                    <p className="text-muted-foreground font-medium">Approved (payout)</p>
                                    <p className="text-sm font-semibold tabular-nums text-blue-800 dark:text-blue-200">
                                      ${(tsRollup.approvedUnpaidCents / 100).toFixed(2)}
                                    </p>
                                  </div>
                                </div>
                                {tsRollup.rejectedOrDisputed > 0 && (
                                  <p className="text-[10px] text-destructive/90">
                                    {tsRollup.rejectedOrDisputed} shift{tsRollup.rejectedOrDisputed === 1 ? "" : "s"} need attention (rejected or disputed).
                                  </p>
                                )}
                              </>
                            )}
                          </div>
                        </div>
                      );
                    })}
                    </div>
                    
                    {/* Estimated Total Payout Summary */}
                    {(() => {
                      // Calculate total estimated payout across all accepted jobs
                      const totalEstimatedPayout = groupedAcceptedApplications.reduce((grandTotal, { jobId, applications: jobApps }) => {
                        const job = allJobs.find(j => j.id === jobId);
                        if (!job) return grandTotal;
                        
                        // Sum payout for all workers on this job
                        const jobPayout = jobApps.reduce((total, app) => {
                          const hours = getBillableHoursForPayout(job);
                          // proposedRate is locked at application time - most accurate
                          const rate = rateToDollars(app.proposedRate ?? app.teamMember?.hourlyRate ?? profile?.hourlyRate ?? 30);
                          return total + (rate * hours);
                        }, 0);
                        
                        return grandTotal + jobPayout;
                      }, 0);
                      
                      const totalHours = groupedAcceptedApplications.reduce((total, { jobId, applications: jobApps }) => {
                        const job = allJobs.find(j => j.id === jobId);
                        if (!job) return total;
                        return total + (getBillableHoursForPayout(job) * jobApps.length);
                      }, 0);
                      
                      const totalWorkerAssignments = groupedAcceptedApplications.reduce((total, { applications }) => total + applications.length, 0);

                      const acceptedJobIdSet = new Set(groupedAcceptedApplications.map((g) => g.jobId));
                      let paidFromAcceptedCents = 0;
                      let pendingReviewAcceptedCents = 0;
                      let approvedUnpaidAcceptedCents = 0;
                      for (const ts of workerTimesheetsForJobs) {
                        if (!acceptedJobIdSet.has(ts.jobId)) continue;
                        const cents = centsForTimesheet(ts);
                        if (ts.paymentStatus === "completed") {
                          paidFromAcceptedCents += ts.totalPay != null && ts.totalPay > 0 ? ts.totalPay : cents;
                          continue;
                        }
                        if (ts.status === "approved") {
                          approvedUnpaidAcceptedCents += ts.totalPay != null && ts.totalPay > 0 ? ts.totalPay : cents;
                          continue;
                        }
                        if (ts.status === "pending" && ts.clockOutTime && ts.submittedAt) {
                          pendingReviewAcceptedCents += cents;
                        }
                      }
                      
                      return (
                        <div className="mt-6 bg-gradient-to-r from-green-100 to-emerald-100 dark:from-green-900/40 dark:to-emerald-900/40 rounded-2xl p-5 border border-green-200 dark:border-green-800" data-testid="accepted-jobs-summary">
                          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                            <div>
                              <p className="text-sm font-medium text-green-700 dark:text-green-300 mb-1">
                                {t("jobsConfirmed", { count: groupedAcceptedApplications.length })}
                                {totalWorkerAssignments > groupedAcceptedApplications.length && (
                                  <span className="text-green-600/70 dark:text-green-400/70"> {t("totalAssignments", { count: totalWorkerAssignments })}</span>
                                )}
                              </p>
                              <p className="text-xs text-green-600/70 dark:text-green-400/60">
                                ~{totalHours} estimated hours total (if every shift runs full scheduled time)
                              </p>
                            </div>
                            <div className="text-left sm:text-right space-y-1">
                              <p className="text-2xl font-bold text-green-700 dark:text-green-300 tabular-nums">
                                ${totalEstimatedPayout.toLocaleString()}
                              </p>
                              <p className="text-xs text-green-600/70 dark:text-green-400/60">
                                Est. total if all shifts pay full schedule
                              </p>
                            </div>
                          </div>
                          <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-3 pt-4 border-t border-green-200/70 dark:border-green-800/60">
                            <div className="rounded-xl bg-background/60 dark:bg-background/15 px-3 py-2.5 border border-green-200/50 dark:border-green-800/40">
                              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Paid (completed)</p>
                              <p className="text-lg font-bold tabular-nums text-green-800 dark:text-green-300">
                                ${(paidFromAcceptedCents / 100).toFixed(2)}
                              </p>
                            </div>
                            <div className="rounded-xl bg-background/60 dark:bg-background/15 px-3 py-2.5 border border-amber-200/50 dark:border-amber-900/40">
                              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Awaiting approval</p>
                              <p className="text-lg font-bold tabular-nums text-amber-900 dark:text-amber-200">
                                ~${(pendingReviewAcceptedCents / 100).toFixed(2)}
                              </p>
                            </div>
                            <div className="rounded-xl bg-background/60 dark:bg-background/15 px-3 py-2.5 border border-blue-200/50 dark:border-blue-900/40">
                              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Approved, paying out</p>
                              <p className="text-lg font-bold tabular-nums text-blue-900 dark:text-blue-200">
                                ${(approvedUnpaidAcceptedCents / 100).toFixed(2)}
                              </p>
                            </div>
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                )}
              </TabsContent>

              <TabsContent value="rejected" className="mt-6 space-y-4">
                {/* Info Card - Airbnb style */}
                <div className="bg-gradient-to-r from-gray-50 to-slate-50 dark:from-gray-950/30 dark:to-slate-950/30 rounded-2xl p-4 shadow-sm border border-gray-100 dark:border-gray-900/50">
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-full bg-gray-100 dark:bg-gray-900/50 flex items-center justify-center flex-shrink-0">
                      <XCircle className="w-5 h-5 text-gray-500 dark:text-gray-400" />
                    </div>
                    <div>
                      <p className="font-semibold text-gray-700 dark:text-gray-300">{t("notSelected")}</p>
                      <p className="text-sm text-gray-600/80 dark:text-gray-400/70 mt-0.5">{t("applicationsNotSelected")}</p>
                    </div>
                  </div>
                </div>
                {filteredRejectedApplications.length === 0 ? (
                  <div className="bg-card rounded-2xl border border-border/60 shadow-sm p-12 text-center">
                    <div className="w-16 h-16 rounded-full bg-secondary/80 flex items-center justify-center mx-auto mb-4">
                      <XCircle className="w-8 h-8 text-muted-foreground" />
                    </div>
                    <p className="text-muted-foreground font-medium">{t("noRejectedApplications")}</p>
                    <p className="text-sm text-muted-foreground/70 mt-1">{t("thatsGreatNews")}</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {filteredRejectedApplications.map((app, index) => {
                      const job = allJobs.find(j => j.id === app.jobId);
                      if (!job) return null;
                      const teamMember = (app as ApplicationWithDetails).teamMember;
                      return (
                        <div
                          key={app.id}
                          className="group bg-card rounded-2xl border border-border/60 shadow-sm hover:shadow-md transition-all duration-300 ease-out cursor-pointer overflow-hidden opacity-75 hover:opacity-100 active:scale-[0.98]"
                          onClick={() => setSelectedJobApp(app)}
                          data-testid={`job-card-rejected-${app.id}`}
                          style={{ 
                            animationDelay: `${index * 50}ms`,
                            animation: 'fadeInUp 0.4s ease-out forwards'
                          }}
                        >
                          <div className="px-4 py-4">
                            <div className="flex items-start justify-between gap-3">
                              <div className="flex items-start gap-3 flex-1 min-w-0">
                                <Avatar className="w-10 h-10 border opacity-70 flex-shrink-0">
                                  <AvatarImage src={normalizeAvatarUrl(teamMember?.avatarUrl || operatorAvatarUrl) ?? undefined} />
                                  <AvatarFallback className="text-xs">
                                    {teamMember ? `${teamMember.firstName?.[0]}${teamMember.lastName?.[0]}` : `${profile?.firstName?.[0]}${profile?.lastName?.[0]}`}
                                  </AvatarFallback>
                                </Avatar>
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                                    <Badge variant="outline" className="text-[10px] px-2 py-0.5 bg-gray-100 dark:bg-gray-900/50 text-gray-600 dark:text-gray-400 border-gray-200 dark:border-gray-800">
                                      <XCircle className="w-3 h-3 mr-1" /> {t("notSelected")}
                                    </Badge>
                                    {teamMember && (
                                      <span className="text-xs text-muted-foreground">
                                        {t("for")}: {teamMember.firstName} {teamMember.lastName}
                                      </span>
                                    )}
                                  </div>
                                  <h3 className="font-semibold text-base leading-tight line-clamp-2">
                                    {job.title}
                                  </h3>
                                  <p className="text-sm text-muted-foreground mt-1 line-clamp-1">{job.location}</p>
                                </div>
                              </div>
                              <ChevronRight className="w-5 h-5 text-muted-foreground flex-shrink-0" />
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </TabsContent>
            </Tabs>}
          </div>
        )}

        {/* Calendar Tab */}
        {activeTab === "calendar" && (
          <div className="h-full min-h-0 flex flex-col flex-1">
            {!isOnline && (
              <div
                className="w-full flex-shrink-0 bg-amber-600 dark:bg-amber-800 text-white py-2 px-4 text-center text-sm"
                role="status"
                aria-live="polite"
              >
                {tToday("offlineBanner")}
              </div>
            )}
            <div className="flex-1 min-h-0">
            <WorkerCalendar
              ref={calendarRef}
              calendarHeaderSlotRef={calendarHeaderSlotRef}
              calendarHeaderSlotReady={calendarHeaderSlotReady}
              applications={calendarApplications}
              availableJobs={calendarAvailableJobs}
              workerHourlyRate={profile?.hourlyRate || 25}
              profile={profile}
              activeTeamMembers={activeTeamMembers}
              onApplyToJob={(job) => {
                setApplyJob(job);
              }}
              onViewJob={(job, application) => {
                setSelectedJob(job);
                setSelectedCalendarApplication(application ?? null);
              }}
              onApplyToJobAtStep3={(job) => {
                setSelectedJob(job);
                setCalendarOpenApplyAtStep3(true);
              }}
              onWithdrawApplication={(applicationId) => {
                removeApplicationMutation.mutate(applicationId);
              }}
              onUpdateTeamMember={(applicationId, teamMemberId) => {
                updateApplicationTeamMemberMutation.mutate({ applicationId, teamMemberId });
              }}
              onGetDirections={(job) => {
                setDirectionsJob(job);
                setDirectionsDialogOpen(true);
              }}
              isWithdrawing={removeApplicationMutation.isPending}
              clockInStatus={{
                isClockedIn: !!activeTimesheet || (!isOnline && hasPendingClockedIn),
                activeTimesheet: activeTimesheet || (!isOnline && hasPendingClockedIn && pendingClockedInJobId != null && pendingClockInTime
                  ? { id: -1, jobId: pendingClockedInJobId, clockInTime: pendingClockInTime, clockOutTime: null } as Timesheet
                  : null),
                activeJobId: activeTimesheet?.jobId ?? (isOnline ? null : (pendingClockedInJobId ?? null)),
              }}
              clockInError={clockInError}
              isClockingIn={isClockingIn}
              isClockingOut={isClockingOut}
              onClockIn={async (jobId, workerId) => {
                setClockInError(null);
                if (!isOnline && profile?.id) {
                  // Try to get GPS for up to 4s so we can store location when available; then queue clock-in (with or without location).
                  const result = await new Promise<{ success: true }>((resolve) => {
                    let resolved = false;
                    const finish = (lat: number | null, lng: number | null) => {
                      if (resolved) return;
                      resolved = true;
                      addPendingClockIn({
                        jobId,
                        workerId,
                        latitude: lat,
                        longitude: lng,
                      });
                      refreshPending();
                      toast({
                        title: tToday("clockedInOffline"),
                        description: lat != null && lng != null ? tToday("clockedInOfflineDescription") : (tToday("clockedInOfflineNoLocation") || "Location will be required when you're back online to approve this timesheet."),
                      });
                      resolve({ success: true });
                    };
                    const timeoutId = window.setTimeout(() => finish(null, null), 4000);
                    if (navigator.geolocation) {
                      navigator.geolocation.getCurrentPosition(
                        (pos) => {
                          window.clearTimeout(timeoutId);
                          finish(pos.coords.latitude, pos.coords.longitude);
                        },
                        () => {
                          window.clearTimeout(timeoutId);
                          finish(null, null);
                        },
                        { enableHighAccuracy: true, timeout: 5000, maximumAge: 0 }
                      );
                    } else {
                      window.clearTimeout(timeoutId);
                      finish(null, null);
                    }
                  });
                  return result;
                }
                const result = await clockIn(jobId);
                if (!result.success) {
                  if (result.code === "OUTSIDE_GEOFENCE") {
                    setClockInError(`You're ${result.distanceMiles} miles away. Clock in requires being within 2 miles of the job site.`);
                  } else if (result.code === "TOO_EARLY") {
                    setClockInError(result.error || "Too early to clock in");
                  } else {
                    setClockInError(result.error || "Failed to clock in");
                  }
                }
                return result;
              }}
              onClockOut={async (timesheetId) => {
                setClockInError(null);
                if (!isOnline && lastPendingClockInLocalId) {
                  addPendingClockOut(lastPendingClockInLocalId);
                  refreshPending();
                  toast({ title: tToday("clockedOutOffline"), description: tToday("clockedOutOfflineDescription") });
                  return { success: true };
                }
                const result = await clockOut(timesheetId);
                if (!result.success) {
                  setClockInError(result.error || "Failed to clock out");
                }
                return result;
              }}
              isEmployee={isEmployee}
              impersonatedTeamMemberId={user?.impersonation?.teamMemberId || null}
              referencePoints={referenceLocations.length > 0 ? referenceLocations : undefined}
              referenceRadiusMiles={referenceLocations.length > 0 ? clampedMaxDistanceMiles : undefined}
              referenceRadiusMilesArray={referenceEntries.length > 0 ? referenceEntries.map((_, i) => getRadiusForRefIndex(i)) : undefined}
              workerTeamId={workerTeam?.id ?? null}
              calendarDeepLinkJobId={calendarDeepLinkJobId}
              onCalendarDeepLinkHandled={() => setCalendarDeepLinkJobId(null)}
            />
            </div>
          </div>
        )}


        {/* Menu Tab — Account settings: desktop = sidebar + detail, mobile = grouped list */}
        {activeTab === "menu" && (
          <div className={isMobile ? "space-y-0" : "flex min-h-0 flex-1 -mx-4 md:-mx-6"}>
            {isMobile ? (
              <>
                <div className="flex items-center gap-3 px-1 pb-4">
                  <button
                    type="button"
                    onClick={() => setLocation("/dashboard/find")}
                    className="w-9 h-9 flex items-center justify-center rounded-full bg-muted hover:bg-muted/80 text-foreground"
                    aria-label="Back"
                  >
                    <ArrowLeft className="w-5 h-5" />
                  </button>
                  <h1 className="text-xl font-bold">{tMenu("accountSettings.title")}</h1>
                </div>
                {/* Profile completeness banner */}
                {(() => {
                  const { missing } = getWorkerOnboardingMissing(profile);
                  if (missing.length === 0) return null;
                  const total = 7; // name, email, phone, facePhoto, skills, rate, bank
                  const done = total - missing.length;
                  const pct = Math.round((done / total) * 100);
                  const labelMap: Record<string, string> = {
                    name: "Full name", email: "Email", phone: "Phone number",
                    facePhoto: "Profile photo", skills: "Skills", rate: "Hourly rate", bank: "Payout account",
                  };
                  return (
                    <div className="mb-3 rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 p-4">
                      <div className="flex items-center justify-between mb-1.5">
                        <p className="text-sm font-semibold text-amber-900 dark:text-amber-300">Profile {pct}% complete</p>
                        <span className="text-xs text-amber-700 dark:text-amber-400">{done}/{total}</span>
                      </div>
                      <div className="h-2 rounded-full bg-amber-200 dark:bg-amber-800 overflow-hidden mb-3">
                        <div className="h-full rounded-full bg-amber-500 transition-all duration-500" style={{ width: `${pct}%` }} />
                      </div>
                      <p className="text-xs text-amber-800 dark:text-amber-400 mb-2">
                        Still needed: {missing.map((m) => labelMap[m] ?? m).join(", ")}
                      </p>
                      <button
                        type="button"
                        onClick={() => setLocation("/worker-onboarding")}
                        className="text-xs font-medium text-amber-700 dark:text-amber-300 underline underline-offset-2 hover:no-underline"
                      >
                        Complete your profile →
                      </button>
                    </div>
                  );
                })()}
                <div className="space-y-1">
                  {/* Group 1: Personal & core */}
                  <button onClick={() => setLocation("/dashboard/settings/profile")} className="w-full flex items-center gap-3 py-3 px-2 rounded-lg hover:bg-muted/50 transition-colors text-left" data-testid="menu-profile">
                    <User className="w-5 h-5 text-muted-foreground flex-shrink-0" />
                    <span className="font-medium flex-1">{tMenu("menu.profile")}</span>
                    <ChevronRight className="w-5 h-5 text-muted-foreground flex-shrink-0" />
                  </button>
                  <button onClick={() => { setSkillsetPanelPerson("self"); setSkillsetDialogOpen(true); }} className="w-full flex items-center gap-3 py-3 px-2 rounded-lg hover:bg-muted/50 transition-colors text-left" data-testid="menu-skillset">
                    <Wrench className="w-5 h-5 text-muted-foreground flex-shrink-0" />
                    <span className="font-medium flex-1">{tMenu("menu.skillset")}</span>
                    <ChevronRight className="w-5 h-5 text-muted-foreground flex-shrink-0" />
                  </button>
                  <button onClick={() => setRateDialogOpen(true)} className="w-full flex items-center gap-3 py-3 px-2 rounded-lg hover:bg-muted/50 transition-colors text-left" data-testid="menu-rate">
                    <DollarSign className="w-5 h-5 text-muted-foreground flex-shrink-0" />
                    <span className="font-medium flex-1">{tMenu("menu.rate")}</span>
                    <ChevronRight className="w-5 h-5 text-muted-foreground flex-shrink-0" />
                  </button>
                  <button onClick={() => setLocation("/dashboard/settings/notifications")} className="w-full flex items-center gap-3 py-3 px-2 rounded-lg hover:bg-muted/50 transition-colors text-left" data-testid="menu-notifications">
                    <Bell className="w-5 h-5 text-muted-foreground flex-shrink-0" />
                    <span className="font-medium flex-1">{tMenu("menu.notifications")}</span>
                    <ChevronRight className="w-5 h-5 text-muted-foreground flex-shrink-0" />
                  </button>
                  <button onClick={() => setLocation("/dashboard/settings/payouts")} className="w-full flex items-center gap-3 py-3 px-2 rounded-lg hover:bg-muted/50 transition-colors text-left" data-testid="menu-bank-account">
                    <CreditCard className="w-5 h-5 text-muted-foreground flex-shrink-0" />
                    <span className="font-medium flex-1">{tMenu("menu.bankAccount")}</span>
                    <ChevronRight className="w-5 h-5 text-muted-foreground flex-shrink-0" />
                  </button>
                  <button onClick={() => setLocation("/dashboard/payment-history")} className="w-full flex items-center gap-3 py-3 px-2 rounded-lg hover:bg-muted/50 transition-colors text-left" data-testid="menu-payment-history">
                    <DollarSign className="w-5 h-5 text-muted-foreground flex-shrink-0" />
                    <span className="font-medium flex-1">{tMenu("menu.paymentHistory")}</span>
                    <ChevronRight className="w-5 h-5 text-muted-foreground flex-shrink-0" />
                  </button>
                  <button onClick={() => setLanguagePopupOpen(true)} className="w-full flex items-center gap-3 py-3 px-2 rounded-lg hover:bg-muted/50 transition-colors text-left" data-testid="menu-language">
                    <Globe className="w-5 h-5 text-muted-foreground flex-shrink-0" />
                    <span className="font-medium flex-1">{tMenu("menu.language")}</span>
                    <ChevronRight className="w-5 h-5 text-muted-foreground flex-shrink-0" />
                  </button>
                  <button
                    onClick={() => {
                      setInviteBuddyOpen(true);
                      setActiveTab("today");
                    }}
                    className="w-full flex items-center gap-3 py-3 px-2 rounded-lg hover:bg-muted/50 transition-colors text-left"
                    data-testid="menu-invite"
                  >
                    <Users className="w-5 h-5 text-muted-foreground flex-shrink-0" />
                    <span className="font-medium flex-1">{tMenu("menu.inviteBuddy")}</span>
                    <ChevronRight className="w-5 h-5 text-muted-foreground flex-shrink-0" />
                  </button>
                </div>
                <div className="border-t border-border my-5" />
                <div className="space-y-1">
                  {/* Group 2: Business & more */}
                  <button onClick={() => setLocation("/dashboard/business-operator")} className="w-full flex items-center gap-3 py-3 px-2 rounded-lg hover:bg-muted/50 transition-colors text-left" data-testid="menu-business-operator">
                    <Briefcase className="w-5 h-5 text-muted-foreground flex-shrink-0" />
                    <span className="font-medium flex-1">{tMenu("menu.businessOperator")}</span>
                    <ChevronRight className="w-5 h-5 text-muted-foreground flex-shrink-0" />
                  </button>
                  <button onClick={() => setLocation("/dashboard/reviews")} className="w-full flex items-center gap-3 py-3 px-2 rounded-lg hover:bg-muted/50 transition-colors text-left" data-testid="menu-reviews">
                    <Star className="w-5 h-5 text-muted-foreground flex-shrink-0" />
                    <span className="font-medium flex-1">Reviews</span>
                    <ChevronRight className="w-5 h-5 text-muted-foreground flex-shrink-0" />
                  </button>
                  <button onClick={() => setLocation("/dashboard/account-documents")} className="w-full flex items-center gap-3 py-3 px-2 rounded-lg hover:bg-muted/50 transition-colors text-left" data-testid="menu-account-documents">
                    <Shield className={`w-5 h-5 flex-shrink-0 ${(profile?.strikeCount || 0) > 0 ? "text-red-600 dark:text-red-400" : "text-muted-foreground"}`} />
                    <span className="font-medium flex-1">{tMenu("menu.accountStatus")}</span>
                    {(profile?.strikeCount || 0) > 0 && <Badge variant="destructive" className="text-xs">{profile?.strikeCount}/3</Badge>}
                    <ChevronRight className="w-5 h-5 text-muted-foreground flex-shrink-0" />
                  </button>
                </div>
                <div className="border-t border-border my-5" />
                <div className="space-y-1">
                  {/* Group 3: Legal */}
                  <button onClick={() => setLocation("/dashboard/settings/terms")} className="w-full flex items-center gap-3 py-3 px-2 rounded-lg hover:bg-muted/50 transition-colors text-left" data-testid="menu-terms">
                    <FileText className="w-5 h-5 text-muted-foreground flex-shrink-0" />
                    <span className="font-medium flex-1">{tMenu("menu.terms")}</span>
                    <ChevronRight className="w-5 h-5 text-muted-foreground flex-shrink-0" />
                  </button>
                  <button onClick={() => setLocation("/dashboard/settings/privacy")} className="w-full flex items-center gap-3 py-3 px-2 rounded-lg hover:bg-muted/50 transition-colors text-left" data-testid="menu-privacy">
                    <Shield className="w-5 h-5 text-muted-foreground flex-shrink-0" />
                    <span className="font-medium flex-1">{tMenu("menu.privacy")}</span>
                    <ChevronRight className="w-5 h-5 text-muted-foreground flex-shrink-0" />
                  </button>
                  <button onClick={() => setLocation("/dashboard/settings/legal")} className="w-full flex items-center gap-3 py-3 px-2 rounded-lg hover:bg-muted/50 transition-colors text-left" data-testid="menu-legal">
                    <FileText className="w-5 h-5 text-muted-foreground flex-shrink-0" />
                    <span className="font-medium flex-1">{tMenu("menu.legal")}</span>
                    <ChevronRight className="w-5 h-5 text-muted-foreground flex-shrink-0" />
                  </button>
                </div>
                <div className="border-t border-border my-5" />
                <button onClick={handleLogout} className="w-full flex items-center gap-3 py-3 px-2 rounded-lg hover:bg-destructive/10 transition-colors text-left text-destructive" data-testid="menu-logout">
                  <LogOut className="w-5 h-5 flex-shrink-0" />
                  <span className="font-medium flex-1">{tMenu("menu.logout")}</span>
                </button>
              </>
            ) : (
              <>
                <aside className="w-72 flex-shrink-0 border-r border-border bg-muted/20 py-6 px-4">
                  <h2 className="text-xl font-bold mb-6">{tMenu("accountSettings.title")}</h2>
                  <nav className="space-y-1">
                    {(["profile", "skillset", "rate", "notifications", "bank", "payment-history", "language", "invite"] as const).map((key) => {
                      const label = key === "profile" ? tMenu("menu.profile") : key === "skillset" ? tMenu("menu.skillset") : key === "rate" ? tMenu("menu.rate") : key === "notifications" ? tMenu("menu.notifications") : key === "bank" ? tMenu("menu.bankAccount") : key === "payment-history" ? tMenu("menu.paymentHistory") : key === "language" ? tMenu("menu.language") : tMenu("menu.inviteBuddy");
                      const Icon = key === "profile" ? User : key === "skillset" ? Wrench : key === "rate" ? DollarSign : key === "notifications" ? Bell : key === "bank" || key === "payment-history" ? CreditCard : key === "language" ? Globe : Users;
                      const onClick = key === "bank" ? () => { setMenuSelection("bank"); setLocation("/dashboard/menu/bank"); } : () => setMenuSelection(key);
                      return (
                        <button key={key} onClick={onClick} className={`w-full flex items-center gap-3 py-3 px-3 rounded-lg transition-colors text-left ${menuSelection === key ? "bg-muted font-medium" : "hover:bg-muted/50"}`} data-testid={`menu-${key === "bank" ? "bank-account" : key === "payment-history" ? "payment-history" : key === "invite" ? "invite" : key}`}>
                          <Icon className="w-5 h-5 text-muted-foreground flex-shrink-0" />
                          <span>{label}</span>
                        </button>
                      );
                    })}
                  </nav>
                  <div className="border-t border-border my-5" />
                  <nav className="space-y-1">
                    {(["business-operator", "reviews", "account-documents"] as const).map((key) => {
                      const label = key === "business-operator" ? tMenu("menu.businessOperator") : key === "reviews" ? "Reviews" : tMenu("menu.accountStatus");
                      const Icon = key === "business-operator" ? Briefcase : key === "reviews" ? Star : Shield;
                      const isSelected = menuSelection === key;
                      return (
                        <button key={key} onClick={() => setMenuSelection(key)} className={`w-full flex items-center gap-3 py-3 px-3 rounded-lg transition-colors text-left ${isSelected ? "bg-muted font-medium" : "hover:bg-muted/50"}`} data-testid={key === "business-operator" ? "menu-business-operator" : key === "reviews" ? "menu-reviews" : "menu-account-documents"}>
                          <Icon className={`w-5 h-5 flex-shrink-0 ${key === "account-documents" && (profile?.strikeCount || 0) > 0 ? "text-red-600 dark:text-red-400" : "text-muted-foreground"}`} />
                          <span>{label}</span>
                          {key === "account-documents" && (profile?.strikeCount || 0) > 0 && <Badge variant="destructive" className="text-xs ml-auto">{profile?.strikeCount}/3</Badge>}
                        </button>
                      );
                    })}
                  </nav>
                  <div className="border-t border-border my-5" />
                  <nav className="space-y-1">
                    {(["terms", "privacy", "legal"] as const).map((key) => {
                      const label = key === "terms" ? tMenu("menu.terms") : key === "privacy" ? tMenu("menu.privacy") : tMenu("menu.legal");
                      const Icon = key === "privacy" ? Shield : FileText;
                      return (
                        <button key={key} onClick={() => setMenuSelection(key)} className={`w-full flex items-center gap-3 py-3 px-3 rounded-lg transition-colors text-left ${menuSelection === key ? "bg-muted font-medium" : "hover:bg-muted/50"}`} data-testid={`menu-${key}`}>
                          <Icon className="w-5 h-5 text-muted-foreground flex-shrink-0" />
                          <span>{label}</span>
                        </button>
                      );
                    })}
                  </nav>
                  {/* Skillset summary + Save – in left panel when Skillset tab is active */}
                  {menuSelection === "skillset" && (() => {
                    const isSelf = skillsetPanelPerson === "self";
                    const teammate = !isSelf ? activeTeamMembers.find((m) => m.id === skillsetPanelPerson) : null;
                    const teammateId = teammate?.id;
                    const displayCategories = isSelf
                      ? selectedCategories
                      : (teammateId && teammateSkillsets[teammateId])
                        ? teammateSkillsets[teammateId]
                        : (teammate?.skillsets ?? []);
                    const getCount = (industryId: string) => {
                      const ind = INDUSTRY_CATEGORIES.find((c) => c.id === industryId);
                      return ind ? ind.roles.filter((r) => displayCategories.includes(r.id)).length : 0;
                    };
                    const selectedIndustries = INDUSTRY_CATEGORIES.filter((ind) => getCount(ind.id) > 0);
                    const totalSelectedSkills = displayCategories.length;
                    return (
                      <div className="mt-5 pt-5 border-t border-border space-y-3">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-2">
                          <div className="flex items-start gap-2 min-w-0">
                            <Wrench className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
                            <div className="min-w-0 flex-1">
                              <h3 className="text-sm font-semibold leading-tight">
                                {totalSelectedSkills} {totalSelectedSkills === 1 ? "Skill" : "Skills"} Selected
                                {teammate && <span className="text-muted-foreground font-normal"> • {teammate.firstName} {teammate.lastName}</span>}
                              </h3>
                              <p className="text-xs text-muted-foreground truncate mt-0.5">
                                {selectedIndustries.length > 0
                                  ? selectedIndustries.map((ind) => `${ind.label} (${getCount(ind.id)})`).join(", ")
                                  : "No skills selected yet"}
                              </p>
                            </div>
                          </div>
                          <Button
                            onClick={() => saveSkillset(teammateId)}
                            disabled={updateProfileMutation.isPending || totalSelectedSkills === 0}
                            size="sm"
                            className="w-full sm:w-auto flex-shrink-0"
                            data-testid="save-skillsets-button"
                          >
                            {updateProfileMutation.isPending ? (
                              <>
                                <Loader2 className="w-4 h-4 animate-spin mr-2" />
                                Saving...
                              </>
                            ) : (
                              <>
                                <Check className="w-4 h-4 mr-2" />
                                Save Skills
                              </>
                            )}
                          </Button>
                        </div>
                        {totalSelectedSkills > 0 && selectedIndustries.length > 0 && (
                          <div className="flex flex-wrap gap-1.5">
                            {selectedIndustries.map((industry) => {
                              const Icon = industry.icon;
                              const count = getCount(industry.id);
                              return (
                                <Badge key={industry.id} variant="secondary" className="flex items-center gap-1 text-xs">
                                  <Icon className="w-3 h-3" />
                                  {industry.label}
                                  <span className="opacity-70">×{count}</span>
                                </Badge>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })()}
                  <div className="border-t border-border my-5" />
                  <button onClick={handleLogout} className="w-full flex items-center gap-3 py-3 px-3 rounded-lg hover:bg-destructive/10 transition-colors text-left text-destructive" data-testid="menu-logout">
                    <LogOut className="w-5 h-5 flex-shrink-0" />
                    <span className="font-medium">{tMenu("menu.logout")}</span>
                  </button>
                </aside>
                <div className="flex-1 min-w-0 overflow-y-auto py-8 px-8 bg-muted/30">
                  <div className="mb-8">
                    <h2 className="text-2xl font-bold tracking-tight">
                      {menuSelection === "profile" && tMenu("accountSettings.personalInfo")}
                      {menuSelection === "skillset" && tMenu("menu.skillset")}
                      {menuSelection === "rate" && tMenu("menu.rate")}
                      {menuSelection === "notifications" && tMenu("menu.notifications")}
                      {menuSelection === "bank" && tMenu("menu.bankAccount")}
                      {menuSelection === "payment-history" && tMenu("menu.paymentHistory")}
                      {menuSelection === "language" && tMenu("menu.language")}
                      {menuSelection === "invite" && tMenu("menu.inviteBuddy")}
                      {menuSelection === "business-operator" && tMenu("menu.businessOperator")}
                      {menuSelection === "reviews" && "Reviews"}
                      {menuSelection === "account-documents" && tMenu("menu.accountStatus")}
                      {menuSelection === "terms" && tMenu("menu.terms")}
                      {menuSelection === "privacy" && tMenu("menu.privacy")}
                      {menuSelection === "legal" && tMenu("menu.legal")}
                    </h2>
                  </div>
                  <div className="space-y-6">
                    {menuSelection === "profile" && (
                      <div className="pt-2 pb-4">
                        <ProfileSettingsContent embedded />
                      </div>
                    )}
                    {menuSelection === "skillset" && (() => {
                      const isSelf = skillsetPanelPerson === "self";
                      const teammate = !isSelf ? activeTeamMembers.find((m) => m.id === skillsetPanelPerson) : null;
                      const teammateId = teammate?.id;
                      
                      // Get display categories - for teammates, use editing state if exists, otherwise use their saved skillsets
                      const displayCategories = isSelf 
                        ? selectedCategories 
                        : (teammateId && teammateSkillsets[teammateId]) 
                          ? teammateSkillsets[teammateId]
                          : (teammate?.skillsets ?? []);
                      
                      const getCount = (industryId: string) => {
                        const ind = INDUSTRY_CATEGORIES.find((c) => c.id === industryId);
                        return ind ? ind.roles.filter((r) => displayCategories.includes(r.id)).length : 0;
                      };
                      
                      // Calculate summary of selected skillsets
                      const selectedIndustries = INDUSTRY_CATEGORIES.filter((ind) => getCount(ind.id) > 0);
                      const totalSelectedSkills = displayCategories.length;
                      
                      // Initialize teammate editing state if not already set
                      if (teammateId && !teammateSkillsets[teammateId] && teammate?.skillsets) {
                        setTeammateSkillsets((prev) => ({
                          ...prev,
                          [teammateId]: teammate.skillsets || []
                        }));
                      }
                      
                      return (
                        <div className="relative">
                          <div className="pt-2 pb-4">
                            {/* Tab-style selector for all screen sizes (slider-style) */}
                            <Tabs value={isSelf ? "self" : String(skillsetPanelPerson)} onValueChange={(v) => setSkillsetPanelPerson(v === "self" ? "self" : parseInt(v, 10))}>
                              <TabsList withScrollControls className="mb-4">
                                <TabsTrigger value="self" className="flex-shrink-0" data-testid="skillset-panel-tab-self">
                                  <div className="flex items-center gap-2">
                                    <Avatar className="w-5 h-5">
                                      <AvatarImage src={normalizeAvatarUrl(profile?.avatarUrl) ?? undefined} />
                                      <AvatarFallback className="text-[10px]">{profile?.firstName?.[0]}{profile?.lastName?.[0]}</AvatarFallback>
                                    </Avatar>
                                    <span className="text-sm font-medium truncate">You</span>
                                  </div>
                                </TabsTrigger>
                                {activeTeamMembers.map((m) => (
                                  <TabsTrigger key={m.id} value={String(m.id)} className="flex-shrink-0" data-testid={`skillset-panel-tab-${m.id}`}>
                                    <div className="flex items-center gap-2">
                                      <Avatar className="w-5 h-5">
                                        <AvatarImage src={normalizeAvatarUrl(m.avatarUrl) ?? undefined} />
                                        <AvatarFallback className="text-[10px]">{m.firstName?.[0]}{m.lastName?.[0]}</AvatarFallback>
                                      </Avatar>
                                      <span className="text-sm font-medium truncate">{isMobile ? m.firstName : `${m.firstName} ${m.lastName}`}</span>
                                    </div>
                                  </TabsTrigger>
                                ))}
                              </TabsList>
                            </Tabs>
                            <div className="space-y-3">
                              {INDUSTRY_CATEGORIES.map((industry) => {
                                const Icon = industry.icon;
                                const selectedCount = getCount(industry.id);
                                const isExpanded = expandedIndustries.includes(industry.id);
                                return (
                                  <div key={industry.id} className="border rounded-lg overflow-hidden">
                                    <button type="button" onClick={() => toggleIndustryExpansion(industry.id)} className="w-full flex items-center justify-between p-3 hover:bg-muted/50 transition-colors text-left" data-testid={`menu-industry-toggle-${industry.id}`}>
                                      <div className="flex items-center gap-3">
                                        <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                                          <Icon className="w-4 h-4 text-primary" />
                                        </div>
                                        <span className="font-medium">{industry.label}</span>
                                        {selectedCount > 0 && <Badge variant="default" className="text-xs">{selectedCount} selected</Badge>}
                                      </div>
                                      {isExpanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
                                    </button>
                                    {isExpanded && (
                                      <div className="border-t bg-muted/20 p-2 space-y-1">
                                        {industry.roles.map((role) => {
                                          const checked = displayCategories.includes(role.id);
                                          const handleToggle = () => {
                                            if (isSelf) {
                                              toggleCategory(role.id);
                                            } else if (teammateId) {
                                              toggleCategory(role.id, teammateId);
                                            }
                                          };
                                          return (
                                            <div
                                              key={role.id}
                                              className={`flex items-start space-x-3 p-2 rounded-md transition-colors ${checked ? "bg-primary/10" : "hover:bg-muted/50"} cursor-pointer`}
                                              onClick={handleToggle}
                                            >
                                              <Checkbox id={`panel-skill-${role.id}`} checked={checked} onCheckedChange={handleToggle} className="mt-0.5" />
                                              <Label htmlFor={`panel-skill-${role.id}`} className="flex-1 cursor-pointer">
                                                <span className="font-medium text-sm flex items-center gap-2">{role.label}{role.isElite && <Badge variant="secondary" className="text-xs">Certified</Badge>}</span>
                                                <span className="text-xs text-muted-foreground block mt-0.5">{role.desc}</span>
                                              </Label>
                                            </div>
                                          );
                                        })}
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        </div>
                      );
                    })()}
                    {menuSelection === "rate" && (
                      <div className="relative flex flex-col gap-4">
                        <div className="bg-background rounded-xl p-6 shadow-sm border border-border space-y-4">
                          <div className="space-y-2">
                            {allRateWorkers.map((worker) => {
                              const isOpen = rateAccordionOpen === worker.id;
                              const avatarSrc = worker.avatar ? (worker.avatar.startsWith("/") ? worker.avatar : `/${worker.avatar}`) : undefined;
                              const initials = worker.id === "self" ? `${profile?.firstName?.[0]}${profile?.lastName?.[0]}` : worker.name.split(" ").map((n) => n[0]).join("");
                              return (
                                <div key={worker.id} className="border rounded-lg overflow-hidden">
                                  <button
                                    type="button"
                                    onClick={() => setRateAccordionOpen(isOpen ? null : worker.id)}
                                    className="w-full flex items-center justify-between p-3 hover:bg-muted/50 transition-colors text-left"
                                    data-testid={`rate-row-${worker.id}`}
                                  >
                                    <div className="flex items-center gap-3">
                                      <Avatar className="w-8 h-8">
                                        <AvatarImage src={avatarSrc} />
                                        <AvatarFallback className="text-xs">{initials}</AvatarFallback>
                                      </Avatar>
                                      <span className="font-medium">{worker.name}</span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                      <span className="text-lg font-semibold text-primary">${worker.rate}/hr</span>
                                      {isOpen ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
                                    </div>
                                  </button>
                                  {isOpen && (
                                    <div className="border-t bg-muted/20 p-4 space-y-4">
                                      <div>
                                        <Label htmlFor={`rate-slider-${worker.id}`} className="text-sm font-medium mb-2 block">Hourly Rate: ${getEditRate(worker.id)}/hr</Label>
                                        <RateSlider
                                          id={`rate-slider-${worker.id}`}
                                          value={getEditRate(worker.id)}
                                          onValueChange={(rate) => setRateEditingValues({ ...rateEditingValues, [worker.id]: rate })}
                                          className="w-full"
                                          data-testid={`rate-slider-${worker.id}`}
                                        />
                                        <div className="flex justify-between mt-2 text-xs text-muted-foreground"><span>$1/hr</span><span>$200/hr</span></div>
                                      </div>
                                      <div className="bg-muted/50 p-3 rounded-lg">
                                        <p className="text-xs text-muted-foreground">Applications already sent will not be affected.</p>
                                      </div>
                                      <div className="flex gap-2">
                                        <Button variant="outline" className="flex-1" onClick={() => setRateAccordionOpen(null)}>Cancel</Button>
                                        <Button className="flex-1" onClick={() => saveWorkerRate(worker.id)} disabled={updateProfileMutation.isPending}>
                                          {updateProfileMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4 mr-2" />}
                                          Save
                                        </Button>
                                      </div>
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>

                        {/* Smart Apply Rate - responsive to rate container */}
                        <div className="sticky bottom-0 border-t border-border bg-background rounded-xl shadow-sm p-4 md:p-6">
                          <div className="w-full">
                            <div className="flex items-center justify-between gap-4">
                              <div className="flex items-center gap-3">
                                <Sparkles className="w-5 h-5 text-primary" />
                                <div className="flex-1">
                                  <h3 className="text-sm font-semibold">Smart Apply Rate</h3>
                                  <p className="text-xs text-muted-foreground">
                                    {smartApplyRateEnabled 
                                      ? "AI will optimize rates for all future job applications"
                                      : "Using manually set rates for job applications"}
                                  </p>
                                </div>
                              </div>
                              <Switch
                                checked={smartApplyRateEnabled}
                                onCheckedChange={setSmartApplyRateEnabled}
                                className="data-[state=checked]:bg-green-600"
                                data-testid="smart-apply-rate-toggle"
                              />
                            </div>
                            {smartApplyRateEnabled && (
                              <div className="mt-3 pt-3 border-t border-border">
                                <p className="text-xs text-muted-foreground leading-relaxed">
                                  <strong className="text-foreground">How it works:</strong> When applying for jobs, the AI analyzes job requirements, market rates, and your team's skills to suggest optimal rates that maximize your chances of getting hired while maintaining fair compensation.
                                </p>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    )}
                    {menuSelection === "language" && (
                      <div className="bg-background rounded-xl p-6 shadow-sm border border-border space-y-2">
                        {SUPPORTED_LANGUAGES.map((lang) => {
                          const currentLang = (i18n.language?.split("-")[0] || "en") as LanguageCode;
                          const isSelected = lang.code === currentLang;
                          return (
                            <button key={lang.code} onClick={async () => { await changeLanguage(lang.code, profile?.id); window.location.reload(); }} className={`w-full flex items-center gap-3 p-4 rounded-xl transition-colors text-left border-2 ${isSelected ? "bg-primary/10 border-primary" : "hover:bg-muted/50 border-transparent"}`} data-testid={`select-language-${lang.code}`}>
                              <span className="text-2xl">{lang.flag}</span>
                              <div className="flex-1 text-left">
                                <p className={`font-medium ${isSelected ? "text-primary" : ""}`}>{lang.nativeName}</p>
                                <p className="text-sm text-muted-foreground">{lang.name}</p>
                              </div>
                              {isSelected && <Check className="w-5 h-5 text-primary" />}
                            </button>
                          );
                        })}
                      </div>
                    )}
                    {menuSelection === "invite" && (() => {
                      // Compute derived data from referrals
                      const pendingReferrals = referrals.filter(r => r.status === "pending");
                      const acceptedReferrals = referrals.filter(r => r.status === "accepted");
                      const completedReferrals = referrals.filter(r => r.status === "completed");
                      const totalEarned = completedReferrals.filter(r => r.bonusPaid).length * 100;

                      return (
                        <div className="space-y-6">
                          {/* Bonus Banner */}
                          <div className="bg-background rounded-xl p-6 shadow-sm border border-border space-y-6">
                            <div className="bg-gradient-to-br from-green-500/10 to-emerald-500/10 rounded-lg p-6 text-center border border-green-500/20">
                              <div className="text-5xl font-bold mb-2 text-green-600">$100</div>
                              <p className="text-sm text-muted-foreground">Bonus for each friend who signs up and completes their first job</p>
                              {totalEarned > 0 && (
                                <div className="mt-4 pt-4 border-t border-green-500/20">
                                  <p className="text-lg font-semibold text-green-600">You've earned ${totalEarned}!</p>
                                  <p className="text-xs text-muted-foreground mt-1">{completedReferrals.filter(r => r.bonusPaid).length} referrals completed</p>
                                </div>
                              )}
                            </div>
                            
                            <div className="space-y-3">
                              <Label>Your referral link</Label>
                              <div className="flex gap-2">
                                <Input value={`${typeof window !== "undefined" ? window.location.origin : ""}/find-work?ref=${user?.id || "guest"}`} readOnly className="flex-1 text-sm" data-testid="referral-link" />
                                <Button variant="outline" onClick={() => { const l = `${typeof window !== "undefined" ? window.location.origin : ""}/find-work?ref=${user?.id || "guest"}`; navigator.clipboard.writeText(l); toast({ title: "Link copied!", description: "Share it with your friends to earn $100!" }); }} data-testid="copy-referral-link">Copy</Button>
                              </div>
                            </div>
                            
                            <Button className="w-full" onClick={async () => { const link = `${typeof window !== "undefined" ? window.location.origin : ""}/find-work?ref=${user?.id || "guest"}`; if (navigator.share) { try { await navigator.share({ title: "Join me on Tolstoy Staffing!", text: "I'm finding great construction work on Tolstoy Staffing. Join up and when you make your first $100, we BOTH get a $100 bonus!", url: link }); toast({ title: "Shared successfully!" }); } catch { navigator.clipboard.writeText(link); toast({ title: "Link copied!", description: "Share it with your friends to earn $100!" }); } } else { navigator.clipboard.writeText(link); toast({ title: "Link copied!", description: "Share it with your friends to earn $100!" }); } }} data-testid="share-referral">
                              <Send className="w-4 h-4 mr-2" /> Share with Friends
                            </Button>
                            
                            <div className="bg-muted/50 rounded-lg p-4">
                              <p className="text-sm font-medium mb-2">How it works:</p>
                              <ol className="text-sm text-muted-foreground space-y-1.5">
                                <li className="flex items-start gap-2">
                                  <span className="font-semibold text-primary">1.</span>
                                  <span>Share your link with friends</span>
                                </li>
                                <li className="flex items-start gap-2">
                                  <span className="font-semibold text-primary">2.</span>
                                  <span>They sign up and complete their first job</span>
                                </li>
                                <li className="flex items-start gap-2">
                                  <span className="font-semibold text-primary">3.</span>
                                  <span>You both get $100 when they earn their first $100!</span>
                                </li>
                              </ol>
                            </div>
                          </div>

                          {/* Referrals Table */}
                          <div className="bg-background rounded-xl shadow-sm border border-border overflow-hidden">
                            <div className="p-6 border-b border-border">
                              <h3 className="text-lg font-semibold">Your Referrals ({referrals.length})</h3>
                              <p className="text-sm text-muted-foreground mt-1">
                                Track your referral status and bonus eligibility
                              </p>
                            </div>

                            {referralsLoading ? (
                              <div className="p-6 flex justify-center">
                                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                              </div>
                            ) : referrals.length === 0 ? (
                              <div className="p-8 text-center">
                                <Users className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
                                <h3 className="font-semibold mb-2">No referrals yet</h3>
                                <p className="text-sm text-muted-foreground">Share your link above to start earning bonuses!</p>
                              </div>
                            ) : (
                              <div className="overflow-x-auto">
                                <table className="w-full">
                                  <thead className="bg-muted/50 border-b border-border">
                                    <tr>
                                      <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Friend</th>
                                      <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Status</th>
                                      <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">First Project</th>
                                      <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Bonus</th>
                                      <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Date Sent</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-border">
                                    {referrals.map((referral) => (
                                      <tr key={referral.id} className="hover:bg-muted/30 transition-colors">
                                        <td className="px-6 py-4">
                                          <div className="flex items-center gap-3">
                                            <Avatar className="w-8 h-8">
                                              <AvatarFallback className="text-xs">
                                                {referral.referredName?.split(" ").map(n => n[0]).join("") || "?"}
                                              </AvatarFallback>
                                            </Avatar>
                                            <div>
                                              <p className="font-medium text-sm">{referral.referredName || "Unknown"}</p>
                                              <p className="text-xs text-muted-foreground">{referral.referredEmail}</p>
                                            </div>
                                          </div>
                                        </td>
                                        <td className="px-6 py-4">
                                          {referral.status === "accepted" ? (
                                            <Badge className="bg-green-500/10 text-green-700 border-green-500/20 hover:bg-green-500/20">
                                              <CheckCircle className="w-3 h-3 mr-1" />
                                              Accepted
                                            </Badge>
                                          ) : referral.status === "completed" ? (
                                            <Badge className="bg-emerald-500/10 text-emerald-700 border-emerald-500/20 hover:bg-emerald-500/20">
                                              <CheckCircle className="w-3 h-3 mr-1" />
                                              Active
                                            </Badge>
                                          ) : (
                                            <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-300">
                                              <Clock className="w-3 h-3 mr-1" />
                                              Pending
                                            </Badge>
                                          )}
                                        </td>
                                        <td className="px-6 py-4">
                                          {referral.firstJobCompletedAt ? (
                                            <div className="flex items-center gap-2">
                                              <CheckCircle className="w-4 h-4 text-green-600" />
                                              <span className="text-sm text-green-600 font-medium">Completed</span>
                                            </div>
                                          ) : referral.status === "accepted" ? (
                                            <div className="flex items-center gap-2">
                                              <Clock className="w-4 h-4 text-amber-600" />
                                              <span className="text-sm text-muted-foreground">In progress</span>
                                            </div>
                                          ) : (
                                            <span className="text-sm text-muted-foreground">—</span>
                                          )}
                                        </td>
                                        <td className="px-6 py-4">
                                          {referral.bonusPaid ? (
                                            <Badge className="bg-green-500 text-white">
                                              <DollarSign className="w-3 h-3 mr-1" />
                                              $100 Paid
                                            </Badge>
                                          ) : referral.firstJobCompletedAt ? (
                                            <Badge className="bg-emerald-500/10 text-emerald-700 border-emerald-500/20">
                                              <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                                              Processing
                                            </Badge>
                                          ) : (
                                            <span className="text-sm text-muted-foreground">Pending</span>
                                          )}
                                        </td>
                                        <td className="px-6 py-4">
                                          <span className="text-sm text-muted-foreground">
                                            {format(new Date(referral.createdAt), "MMM d, yyyy")}
                                          </span>
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })()}
                    {menuSelection === "notifications" && (
                      <div className="pt-2 pb-4">
                        <NotificationSettingsContent embedded />
                      </div>
                    )}
                    {menuSelection === "bank" && (
                      <div className="pt-2 pb-4">
                        <PayoutSettingsContent embedded openBankDialogOnMount={isMenuBankPath && (typeof searchParams === "string" && searchParams.includes("openBank=1"))} />
                      </div>
                    )}
                    {menuSelection === "payment-history" && (
                      <div className="pt-2 pb-4">
                        <PaymentHistoryContent embedded />
                      </div>
                    )}
                    {menuSelection === "terms" && (
                      <div className="bg-background rounded-xl p-6 shadow-sm border border-border">
                        <TermsContent embedded />
                      </div>
                    )}
                    {menuSelection === "privacy" && (
                      <div className="bg-background rounded-xl p-6 shadow-sm border border-border">
                        <PrivacyContent embedded />
                      </div>
                    )}
                    {menuSelection === "legal" && (
                      <div className="bg-background rounded-xl p-6 shadow-sm border border-border">
                        <LegalDocumentsContent embedded />
                      </div>
                    )}
                    {menuSelection === "business-operator" && (
                      <div className="bg-background rounded-xl p-6 shadow-sm border border-border">
                        <BusinessOperatorContent embedded />
                      </div>
                    )}
                    {menuSelection === "reviews" && (
                      <div className="bg-background rounded-xl p-6 shadow-sm border border-border">
                        <ReviewsContent embedded />
                      </div>
                    )}
                    {menuSelection === "account-documents" && (
                      <div className="bg-background rounded-xl p-6 shadow-sm border border-border">
                        <AccountDocumentsContent embedded />
                      </div>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
        )}
        </ErrorBoundary>

      </main>
      {/* Mobile Bottom Navigation - fixed to viewport footer */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-background border-t border-border h-14">
        <div className="flex items-center justify-around h-full pt-[5px] pb-[5px]">
          {/* Order: Today, Find, Jobs, Calendar, Chats */}
          <button
            onClick={() => setLocation("/dashboard/today")}
            className={`flex flex-col items-center justify-center gap-0.5 px-3 h-full transition-colors ${
              activeTab === "today" ? "text-primary" : "text-muted-foreground"
            }`}
            data-testid="mobile-nav-today"
          >
            <Clock className="w-5 h-5" />
            <span className="text-[11px] font-medium">{tMenu("nav.today")}</span>
          </button>
          {/* Find and Jobs tabs - hidden for employees */}
          {!isEmployee && (
            <>
              <button
                onClick={() => setActiveTab("find")}
                className={`flex flex-col items-center justify-center gap-0.5 px-3 h-full transition-colors ${
                  activeTab === "find" ? "text-primary" : "text-muted-foreground"
                }`}
                data-testid="mobile-nav-find"
              >
                <Search className="w-5 h-5" />
                <span className="text-[11px] font-medium">{tMenu("nav.find")}</span>
              </button>
              <button
                onClick={() => setActiveTab("jobs")}
                className={`flex flex-col items-center justify-center gap-0.5 px-3 h-full transition-colors relative ${
                  activeTab === "jobs" ? "text-primary" : "text-muted-foreground"
                }`}
                data-testid="mobile-nav-jobs"
              >
                <Briefcase className="w-5 h-5" />
                <span className="text-[11px] font-medium">{tMenu("nav.jobs")}</span>
                {pendingApplications.length > 0 && (
                  <span className="absolute top-2 right-1 w-2 h-2 bg-primary rounded-full" />
                )}
              </button>
            </>
          )}
          <button
            onClick={() => setActiveTab("calendar")}
            className={`flex flex-col items-center justify-center gap-0.5 px-3 h-full transition-colors ${
              activeTab === "calendar" ? "text-primary" : "text-muted-foreground"
            }`}
            data-testid="mobile-nav-calendar"
          >
            <CalendarIcon className="w-5 h-5" />
            <span className="text-[11px] font-medium">{tMenu("nav.calendar")}</span>
          </button>
          <button
            onClick={() => setLocation("/dashboard/chats")}
            className={`flex flex-col items-center justify-center gap-0.5 px-3 h-full transition-colors ${
              activeTab === "chats" ? "text-primary" : "text-muted-foreground"
            }`}
            data-testid="mobile-nav-chats"
          >
            <div className="relative">
              <MessageSquare className="w-5 h-5" />
              {totalUnreadChats > 0 && (
                <span className="absolute -top-1.5 -right-1.5 min-w-[16px] h-4 px-0.5 bg-blue-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center leading-none">
                  {totalUnreadChats > 9 ? "9+" : totalUnreadChats}
                </span>
              )}
            </div>
            <span className="text-[11px] font-medium">{tMenu("nav.messages")}</span>
          </button>
        </div>
      </nav>
      {/* Full-Page Map Popup - Dialog on desktop, Drawer on mobile */}
      {!isMobile ? (
        <Dialog open={mapPopupOpen} onOpenChange={(open) => {
          if (!open) setSelectedFindJob(null);
          setMapPopupOpen(open);
        }}>
          <DialogContent hideCloseButton className="max-w-[95vw] w-[1200px] h-[85vh] p-0 overflow-hidden rounded-2xl shadow-2xl border-0">
            <DialogTitle className="sr-only">Map View</DialogTitle>
            <DialogDescription className="sr-only">View jobs and team members on the map</DialogDescription>
            <div className="flex flex-col h-full">
              {/* Unified header: Title | X */}
              <div className="flex items-center justify-between px-4 sm:px-6 py-3 border-b bg-background flex-shrink-0">
                <h2 className="font-semibold text-lg">Map View</h2>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedFindJob(null);
                    setMapPopupOpen(false);
                  }}
                  className="flex items-center justify-center rounded-full bg-muted hover:bg-muted/80 transition-all duration-200 flex-shrink-0 w-9 h-9"
                  aria-label="Close"
                >
                  <X className="w-5 h-5 text-muted-foreground" />
                </button>
              </div>
              
              {/* Map and Content */}
              <div className="flex-1 flex overflow-hidden">
                {/* Map */}
                <div className="relative flex-1">
                  <JobsMap
                    jobs={jobPins}
                    workerLocation={workerLocation}
                    workerAvatar={profile?.avatarUrl || undefined}
                    workerName={`${profile?.firstName || 'You'} ${profile?.lastName || ''}`}
                    teammates={teammateLocationsForMap}
                    referenceRadiusMiles={referenceLocations.length > 0 ? clampedMaxDistanceMiles : undefined}
                    referenceRadiusMilesArray={referenceEntries.length > 0 ? referenceEntries.map((_, i) => getRadiusForRefIndex(i)) : undefined}
                    referencePoints={referenceLocations.length > 0 ? referenceLocations : undefined}
                    showPersonMarkers={true}
                    showPricePills={true}
                    onJobSelect={(jobId) => {
                      const job = sortedFindWorkJobs.find(j => j.id === jobId);
                      if (job) setSelectedFindJob(job);
                    }}
                    selectedJobId={selectedFindJob?.id}
                    height="100%"
                  />
                  
                  {/* Job Count & Team Legend */}
                  <div className="absolute top-3 left-3 z-10 flex flex-col gap-2">
                    <Badge className="bg-background/90 backdrop-blur-sm text-foreground shadow-md">
                      {sortedFindWorkJobs.length} jobs nearby
                    </Badge>
                    {activeTeamMembers.length > 0 && (
                      <Badge variant="outline" className="bg-background/90 backdrop-blur-sm shadow-md">
                        <Users className="w-3 h-3 mr-1" />
                        {activeTeamMembers.length + 1} team members
                      </Badge>
                    )}
                  </div>
                </div>
                
                {/* Job Details Panel - Uses same JobContent as popup for 1:1 match */}
                <div className="w-[420px] flex-shrink-0 bg-background border-l flex flex-col overflow-hidden">
                  {selectedFindJob ? (
                    <JobContent
                      job={selectedFindJob}
                      profile={profile}
                      activeTeamMembers={activeTeamMembers}
                      workerLocation={workerLocation}
                      onOpenApply={(job) => {
                        setSelectedFindJob(null);
                        setMapPopupOpen(false);
                        setApplyJob(job);
                      }}
                      onDismiss={(job) => {
                        setSelectedFindJob(null);
                        setJobToDismiss(job);
                      }}
                      onClose={() => setSelectedFindJob(null)}
                      isMobile={false}
                      inlineApplyMode={true}
                      onApplySuccess={() => setSelectedFindJob(null)}
                    />
                  ) : (
                    <div className="flex-1 flex flex-col items-center justify-center text-center p-6">
                      <div className="w-16 h-16 rounded-full bg-secondary/50 flex items-center justify-center mb-4">
                        <MapPin className="w-8 h-8 text-muted-foreground" />
                      </div>
                      <h3 className="font-medium mb-2">Select a Job</h3>
                      <p className="text-sm text-muted-foreground">
                        Click on a pin to see job details and drive times
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      ) : (
        <Drawer open={mapPopupOpen} onOpenChange={(open) => {
          if (!open) setSelectedFindJob(null);
          setMapPopupOpen(open);
        }}>
          <DrawerContent className="h-[100dvh] max-h-[100dvh] rounded-t-none">
            <DrawerTitle className="sr-only">Map View</DrawerTitle>
            <DrawerDescription className="sr-only">View jobs and team members on the map</DrawerDescription>
            <div className="flex flex-col h-full">
              {/* Unified header: Title | X */}
              <div className="flex items-center justify-between px-4 sm:px-6 py-3 border-b bg-background sticky top-0 z-10 flex-shrink-0">
                <h2 className="font-semibold text-lg">Map View</h2>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedFindJob(null);
                    setMapPopupOpen(false);
                  }}
                  className="flex items-center justify-center rounded-full bg-muted hover:bg-muted/80 transition-all duration-200 flex-shrink-0 w-9 h-9"
                  aria-label="Close"
                  data-testid="close-map-popup"
                >
                  <X className="w-5 h-5 text-muted-foreground" />
                </button>
              </div>
              
              {/* Map and Content */}
              <div className="flex-1 flex flex-col overflow-hidden">
                {/* Map */}
                <div className={`relative flex-1 ${selectedFindJob ? 'hidden' : 'block'}`}>
                  <JobsMap
                    jobs={jobPins}
                    workerLocation={workerLocation}
                    workerAvatar={profile?.avatarUrl || undefined}
                    workerName={`${profile?.firstName || 'You'} ${profile?.lastName || ''}`}
                    teammates={teammateLocationsForMap}
                    referenceRadiusMiles={referenceLocations.length > 0 ? clampedMaxDistanceMiles : undefined}
                    referenceRadiusMilesArray={referenceEntries.length > 0 ? referenceEntries.map((_, i) => getRadiusForRefIndex(i)) : undefined}
                    referencePoints={referenceLocations.length > 0 ? referenceLocations : undefined}
                    showPersonMarkers={true}
                    showPricePills={true}
                    onJobSelect={(jobId) => {
                      const job = sortedFindWorkJobs.find(j => j.id === jobId);
                      if (job) setSelectedFindJob(job);
                    }}
                    selectedJobId={selectedFindJob?.id}
                    height="100%"
                  />
                  
                  {/* Job Count & Team Legend */}
                  <div className="absolute top-3 left-3 z-10 flex flex-col gap-2">
                    <Badge className="bg-background/90 backdrop-blur-sm text-foreground shadow-md">
                      {sortedFindWorkJobs.length} jobs nearby
                    </Badge>
                    {activeTeamMembers.length > 0 && (
                      <Badge variant="outline" className="bg-background/90 backdrop-blur-sm shadow-md">
                        <Users className="w-3 h-3 mr-1" />
                        {activeTeamMembers.length + 1} team members
                      </Badge>
                    )}
                  </div>
                </div>
                
                {/* Job Details Panel - Same JobContent as desktop for 1:1 sync */}
                <div className={`w-full flex-shrink-0 bg-background flex flex-col overflow-hidden min-h-0 ${selectedFindJob ? 'flex-1' : 'hidden'}`}>
                  {selectedFindJob && (
                    <JobContent
                      job={selectedFindJob}
                      profile={profile}
                      activeTeamMembers={allTeamMembersForApply}
                      workerLocation={workerLocation}
                      onOpenApply={(job) => {
                        setSelectedFindJob(null);
                        setApplyJob(job);
                        setMapPopupOpen(false);
                      }}
                      onDismiss={(job) => {
                        setJobToDismiss(job);
                        setSelectedFindJob(null);
                        setMapPopupOpen(false);
                      }}
                      onClose={() => setSelectedFindJob(null)}
                      isMobile={true}
                      inlineApplyMode={true}
                      onApplySuccess={() => {
                        setSelectedFindJob(null);
                        setMapPopupOpen(false);
                      }}
                    />
                  )}
                </div>
              </div>
            </div>
          </DrawerContent>
        </Drawer>
      )}
      {/* Calendar "View Job" — same 1:1 synced popup as Find Work (EnhancedJobDialog). Pending events pass application for Pending Review, withdraw, masked address, no chat/clock in. */}
      <EnhancedJobDialog
        open={!!selectedJob}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedJob(null);
            setSelectedCalendarApplication(null);
            setCalendarOpenApplyAtStep3(false);
          }
        }}
        job={selectedJob}
        profile={profile}
        application={selectedCalendarApplication ?? undefined}
        onWithdraw={(applicationId) => {
          removeApplicationMutation.mutate(applicationId);
          setSelectedJob(null);
          setSelectedCalendarApplication(null);
        }}
        isWithdrawing={removeApplicationMutation.isPending}
        activeTeamMembers={allTeamMembersForApply}
        workerLocation={workerLocation}
        territoryRadiusMiles={clampedMaxDistanceMiles}
        initialApplyStage={calendarOpenApplyAtStep3 ? 3 : undefined}
        onOpenApply={(job) => {
          setApplyJob(job);
          setSelectedJob(null);
          setSelectedCalendarApplication(null);
          setCalendarOpenApplyAtStep3(false);
        }}
        onDismiss={() => {
          setSelectedJob(null);
          setSelectedCalendarApplication(null);
          setCalendarOpenApplyAtStep3(false);
        }}
      />
      {/* Calendar Job Details Sheet */}
      <MobilePopup
        open={!!selectedCalendarJob}
        onOpenChange={() => setSelectedCalendarJob(null)}
        title={selectedCalendarJob?.title || "Job Details"}
        description={t("confirmedJob")}
        primaryAction={{
          label: "Close",
          onClick: () => setSelectedCalendarJob(null)
        }}
      >
        {selectedCalendarJob && (
          <div className="space-y-6">
            <Badge className="bg-green-100 text-green-700 border-green-200">
              <Check className="w-3 h-3 mr-1" /> {t("confirmed")}
            </Badge>

            <div>
              <h3 className="font-semibold mb-2">When</h3>
              <div className="flex items-center gap-2 text-muted-foreground">
                <CalendarIcon className="w-4 h-4" />
                {selectedCalendarJob.startDate && format(parseISO(selectedCalendarJob.startDate.toString()), "EEEE, MMMM d 'at' h:mm a")}
              </div>
            </div>

            <div>
              <h3 className="font-semibold mb-2">Location</h3>
              <div className="flex items-start gap-2 text-muted-foreground">
                <MapPin className="w-4 h-4 mt-0.5" />
                <div>
                  <p>{selectedCalendarJob.address || selectedCalendarJob.location}</p>
                  {selectedCalendarJob.city && (
                    <p>{selectedCalendarJob.city}, {selectedCalendarJob.state} {selectedCalendarJob.zipCode}</p>
                  )}
                </div>
              </div>
            </div>

            <div>
              <h3 className="font-semibold mb-2">Pay</h3>
              <p className="text-2xl font-bold">${selectedCalendarJob.hourlyRate / 100}/hr</p>
              {selectedCalendarJob.estimatedHours && (
                <p className="text-sm text-muted-foreground">
                  Est. {selectedCalendarJob.estimatedHours} hours = ${(selectedCalendarJob.hourlyRate / 100) * selectedCalendarJob.estimatedHours}
                </p>
              )}
            </div>

            <div>
              <h3 className="font-semibold mb-2">Notes</h3>
              <p className="text-muted-foreground">{selectedCalendarJob.description}</p>
            </div>
          </div>
        )}
      </MobilePopup>
      {/* Quick Settings - Only mount when open so closing unmounts and removes overlay (no blocking layer left) */}
      {quickSettingsOpen ? (() => {
        const showBack = quickSettingsView !== "main" || quickSettingsSubView === "edit";
        const title = quickSettingsView === "main"
          ? "Quick Settings"
          : quickSettingsSubView === "edit"
            ? `Edit ${quickSettingsView === "location" ? "location" : quickSettingsView === "rate" ? "rate" : "skillset"}`
            : quickSettingsView === "location"
              ? "Location"
              : quickSettingsView === "rate"
                ? "Rate"
                : "Skillset";
        const header = (
          <div className="flex-shrink-0 flex items-center justify-between gap-2 px-4 py-3 border-b bg-background">
            <div className="flex items-center gap-2 min-w-0">
              {showBack && (
                <button type="button" onClick={quickSettingsBack} className="flex-shrink-0 flex items-center justify-center w-9 h-9 rounded-full bg-muted hover:bg-muted/80" aria-label="Back">
                  <ArrowLeft className="w-5 h-5" />
                </button>
              )}
              <h2 className="font-semibold truncate">{title}</h2>
            </div>
            <button type="button" onClick={quickSettingsClose} className="flex-shrink-0 flex items-center justify-center w-9 h-9 rounded-full bg-muted hover:bg-muted/80" aria-label="Close">
              <X className="w-5 h-5" />
            </button>
          </div>
        );
        const mainMenu = (
          <div className="space-y-2 px-4 py-4">
            <button
              onClick={() => { setQuickSettingsView("location"); setQuickSettingsSubView("list"); }}
              className="w-full flex items-center gap-4 p-4 rounded-xl hover:bg-secondary/50 transition-colors text-left"
              data-testid="quick-settings-location"
            >
              <div className="w-10 h-10 rounded-full bg-secondary flex items-center justify-center">
                <MapPin className="w-5 h-5" />
              </div>
              <div className="flex-1">
                <p className="font-medium">Location</p>
                <p className="text-sm text-muted-foreground">{profile?.city}, {profile?.state}</p>
              </div>
              <ChevronRight className="w-5 h-5 text-muted-foreground" />
            </button>
            <button
              onClick={() => { setQuickSettingsView("rate"); setQuickSettingsSubView("list"); }}
              className="w-full flex items-center gap-4 p-4 rounded-xl hover:bg-secondary/50 transition-colors text-left"
              data-testid="quick-settings-rate"
            >
              <div className="w-10 h-10 rounded-full bg-secondary flex items-center justify-center">
                <DollarSign className="w-5 h-5" />
              </div>
              <div className="flex-1">
                <p className="font-medium">Rate</p>
                <p className="text-sm text-muted-foreground">${rateToDollars(profile?.hourlyRate)}/hr</p>
              </div>
              <ChevronRight className="w-5 h-5 text-muted-foreground" />
            </button>
            <button
              onClick={() => { setQuickSettingsView("skillset"); setQuickSettingsSubView("list"); }}
              className="w-full flex items-center gap-4 p-4 rounded-xl hover:bg-secondary/50 transition-colors text-left"
              data-testid="quick-settings-skillset"
            >
              <div className="w-10 h-10 rounded-full bg-secondary flex items-center justify-center">
                <Wrench className="w-5 h-5" />
              </div>
              <div className="flex-1">
                <p className="font-medium">Skillset</p>
                <p className="text-sm text-muted-foreground">
                  {selectedCategories.length > 0 ? `${selectedCategories.length} skills selected` : "No skills selected"}
                </p>
              </div>
              <ChevronRight className="w-5 h-5 text-muted-foreground" />
            </button>
          </div>
        );
        const body = quickSettingsView === "main"
          ? mainMenu
          : quickSettingsSubView === "edit"
            ? (quickSettingsView === "location" ? (
                <div className="px-4 py-4 space-y-4">
                  <Button variant="outline" className="w-full gap-2" onClick={getCurrentLocation} disabled={isGettingLocation} data-testid="use-current-location">
                    {isGettingLocation ? <Loader2 className="w-4 h-4 animate-spin" /> : <Navigation className="w-4 h-4" />}
                    {isGettingLocation ? "Getting location..." : "Use Current Location"}
                  </Button>
                  <div className="relative"><div className="absolute inset-0 flex items-center"><span className="w-full border-t" /></div><div className="relative flex justify-center text-xs uppercase"><span className="bg-background px-2 text-muted-foreground">Or enter address</span></div></div>
                  <div className="space-y-3">
                    <Label htmlFor="qs-address">Address</Label>
                    <GooglePlacesAutocomplete
                      id="qs-address"
                      value={locationInputValue}
                      onChange={(address, components) => {
                        setLocationInputValue(address || "");
                        const hasPlaceSelection = (components.city ?? components.latitude != null) || (components.state ?? components.zipCode);
                        if (hasPlaceSelection) {
                          setLocationAddress(address || "");
                          setLocationCity(components.city ?? locationCity);
                          setLocationState(components.state ?? locationState);
                          setLocationZip(components.zipCode ?? locationZip);
                          if (components.latitude != null && components.longitude != null) {
                            setLocationLatitude(String(components.latitude));
                            setLocationLongitude(String(components.longitude));
                          }
                        } else {
                          setLocationAddress(address || "");
                          setLocationCity("");
                          setLocationState("");
                          setLocationZip("");
                          setLocationLatitude("");
                          setLocationLongitude("");
                        }
                      }}
                      placeholder="Search for your address..."
                      className="mt-1.5"
                    />
                    {(locationCity || locationState || locationZip) && (
                      <p className="text-xs text-muted-foreground">
                        {[locationCity, locationState, locationZip].filter(Boolean).join(", ")}
                        {locationLatitude && locationLongitude ? " · lat/lng saved" : ""}
                      </p>
                    )}
                  </div>
                </div>
              ) : quickSettingsView === "rate" ? (
                <div className="px-4 py-4 space-y-6">
                  <div className="text-center">
                    <p className="text-4xl font-bold text-primary">${hourlyRate}/hr</p>
                    <p className="text-sm text-muted-foreground mt-1">Your hourly rate</p>
                  </div>
                  <div className="px-2">
                    <RateSlider value={hourlyRate} onValueChange={setHourlyRate} className="w-full" />
                    <div className="flex justify-between mt-2 text-xs text-muted-foreground"><span>$1/hr</span><span>$200/hr</span></div>
                  </div>
                </div>
              ) : (
                <div className="px-4 py-4 space-y-3">
                  {INDUSTRY_CATEGORIES.map((industry) => {
                    const Icon = industry.icon;
                    const selectedCount = getSelectedCountForIndustry(industry.id);
                    const isExpanded = expandedIndustries.includes(industry.id);
                    return (
                      <div key={industry.id} className="border rounded-lg overflow-hidden">
                        <button type="button" onClick={() => toggleIndustryExpansion(industry.id)} className="w-full flex items-center justify-between p-3 hover:bg-muted/50 transition-colors text-left">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center"><Icon className="w-4 h-4 text-primary" /></div>
                            <span className="font-medium">{industry.label}</span>
                            {selectedCount > 0 && <Badge variant="default" className="text-xs">{selectedCount} selected</Badge>}
                          </div>
                          {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                        </button>
                        {isExpanded && (
                          <div className="border-t bg-muted/20 p-2 space-y-1">
                            {industry.roles.map((role) => (
                              <div key={role.id} className={cn("flex items-start space-x-3 p-2 rounded-md cursor-pointer", selectedCategories.includes(role.id) ? "bg-primary/10" : "hover:bg-muted/50")} onClick={() => toggleCategory(role.id)}>
                                <Checkbox id={`qs-skill-${role.id}`} checked={selectedCategories.includes(role.id)} onCheckedChange={() => toggleCategory(role.id)} className="mt-0.5" />
                                <Label htmlFor={`qs-skill-${role.id}`} className="flex-1 cursor-pointer">
                                  <span className="font-medium text-sm flex items-center gap-2">{role.label}{role.isElite && <Badge variant="secondary" className="text-xs">Certified</Badge>}</span>
                                  <span className="text-xs text-muted-foreground block mt-0.5">{role.desc}</span>
                                </Label>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ))
            : (() => {
                const filtered: { id: "self" | number; name: string; avatarUrl?: string | null; loc?: string; rate?: number; skillsCount?: number; hasGeo?: boolean }[] = [];
                if (quickSettingsFilter === "all" || quickSettingsFilter === "self") {
                  filtered.push({
                    id: "self",
                    name: "You",
                    avatarUrl: profile?.avatarUrl ?? null,
                    loc: [profile?.city, profile?.state].filter(Boolean).join(", ") || "—",
                    rate: profile?.hourlyRate ?? 30,
                    skillsCount: selectedCategories.length,
                    hasGeo: !!(profile && (profile as any).latitude != null && (profile as any).longitude != null),
                  });
                }
                if (quickSettingsFilter === "all") {
                  activeTeamMembers.forEach((m) => {
                    const lat = (m as { latitude?: string | null }).latitude;
                    const lng = (m as { longitude?: string | null }).longitude;
                    filtered.push({
                      id: m.id,
                      name: `${m.firstName ?? ""} ${m.lastName ?? ""}`.trim() || "Teammate",
                      avatarUrl: m.avatarUrl ?? null,
                      loc: [m.city, m.state].filter(Boolean).join(", ") || "—",
                      rate: m.hourlyRate ?? 30,
                      skillsCount: ((m as { skillsets?: string[] }).skillsets ?? []).length,
                      hasGeo: !!(lat != null && lng != null),
                    });
                  });
                } else if (typeof quickSettingsFilter === "number") {
                  const m = activeTeamMembers.find((x) => x.id === quickSettingsFilter);
                  if (m) {
                    const lat = (m as { latitude?: string | null }).latitude;
                    const lng = (m as { longitude?: string | null }).longitude;
                    filtered.push({
                      id: m.id,
                      name: `${m.firstName ?? ""} ${m.lastName ?? ""}`.trim() || "Teammate",
                      avatarUrl: m.avatarUrl ?? null,
                      loc: [m.city, m.state].filter(Boolean).join(", ") || "—",
                      rate: m.hourlyRate ?? 30,
                      skillsCount: ((m as { skillsets?: string[] }).skillsets ?? []).length,
                      hasGeo: !!(lat != null && lng != null),
                    });
                  }
                }
                return (
                  <div className="px-4 py-4 space-y-4">
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-muted-foreground">Filter</span>
                      {isMobile ? (
                        <div className="flex gap-2 overflow-x-auto flex-1 min-w-0">
                          <button
                            type="button"
                            onClick={() => setQuickSettingsFilter("all")}
                            className={cn("flex-shrink-0 flex flex-col items-center gap-0.5 p-1.5 rounded-lg", quickSettingsFilter === "all" ? "ring-2 ring-primary bg-primary/10" : "hover:bg-muted/50")}
                          >
                            <Users className="w-6 h-6" />
                            <span className="text-xs">All</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => setQuickSettingsFilter("self")}
                            className={cn("flex-shrink-0 flex flex-col items-center gap-0.5 p-1.5 rounded-lg", quickSettingsFilter === "self" ? "ring-2 ring-primary bg-primary/10" : "hover:bg-muted/50")}
                          >
                            <Avatar className="w-6 h-6">
                              <AvatarImage src={normalizeAvatarUrl(profile?.avatarUrl) ?? undefined} />
                              <AvatarFallback className="text-[10px]">{profile?.firstName?.[0]}{profile?.lastName?.[0]}</AvatarFallback>
                            </Avatar>
                            <span className="text-xs">You</span>
                          </button>
                          {activeTeamMembers.map((m) => (
                            <button
                              key={m.id}
                              type="button"
                              onClick={() => setQuickSettingsFilter(m.id)}
                              className={cn("flex-shrink-0 flex flex-col items-center gap-0.5 p-1.5 rounded-lg", quickSettingsFilter === m.id ? "ring-2 ring-primary bg-primary/10" : "hover:bg-muted/50")}
                            >
                              <Avatar className="w-6 h-6">
                                <AvatarImage src={normalizeAvatarUrl(m.avatarUrl) ?? undefined} />
                                <AvatarFallback className="text-[10px]">{m.firstName?.[0]}{m.lastName?.[0]}</AvatarFallback>
                              </Avatar>
                              <span className="text-xs truncate max-w-[48px]">{m.firstName} {m.lastName}</span>
                            </button>
                          ))}
                        </div>
                      ) : (
                        <Select value={quickSettingsFilter === "all" ? "all" : quickSettingsFilter === "self" ? "self" : String(quickSettingsFilter)} onValueChange={(v) => setQuickSettingsFilter(v === "all" ? "all" : v === "self" ? "self" : parseInt(v, 10))}>
                          <SelectTrigger className="w-[180px]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all"><div className="flex items-center gap-2"><Users className="w-4 h-4" /><span>All</span></div></SelectItem>
                            <SelectItem value="self">
                              <div className="flex items-center gap-2">
                                <Avatar className="w-5 h-5"><AvatarImage src={normalizeAvatarUrl(profile?.avatarUrl) ?? undefined} /><AvatarFallback className="text-[10px]">{profile?.firstName?.[0]}{profile?.lastName?.[0]}</AvatarFallback></Avatar>
                                <span>You</span>
                              </div>
                            </SelectItem>
                            {activeTeamMembers.map((m) => (
                              <SelectItem key={m.id} value={String(m.id)}>
                                <div className="flex items-center gap-2">
                                  <Avatar className="w-5 h-5"><AvatarImage src={normalizeAvatarUrl(m.avatarUrl) ?? undefined} /><AvatarFallback className="text-[10px]">{m.firstName?.[0]}{m.lastName?.[0]}</AvatarFallback></Avatar>
                                  <span>{m.firstName} {m.lastName}</span>
                                </div>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                    </div>
                    {quickSettingsView === "rate" && (
                      <div className="flex flex-wrap items-center gap-2">
                        <Button variant="outline" size="sm" onClick={() => toast({ title: "Suggest", description: "Suggested rates would apply percentage points lower than current." })}>
                          Suggest
                        </Button>
                        <div className="flex items-center gap-2">
                          <span className="text-sm text-muted-foreground">Apply</span>
                          <Input type="number" min={1} max={20} value={quickSettingsRatePercentLower} onChange={(e) => setQuickSettingsRatePercentLower(Number(e.target.value) || 5)} className="w-14 h-8 text-center" />
                          <span className="text-sm text-muted-foreground">% lower</span>
                        </div>
                        <Button size="sm" onClick={() => toast({ title: "Apply all", description: `Would apply ${quickSettingsRatePercentLower}% lower to all teammates.` })}>
                          Apply all
                        </Button>
                      </div>
                    )}
                    <div className="space-y-2">
                      {filtered.map((p) => (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => { setQuickSettingsSelectedPerson(p.id); setQuickSettingsSubView("edit"); }}
                          className="w-full flex items-center gap-3 p-3 rounded-xl border border-border hover:bg-muted/50 text-left"
                        >
                          <Avatar className="w-10 h-10 flex-shrink-0">
                            <AvatarImage src={normalizeAvatarUrl(p.avatarUrl) ?? undefined} />
                            <AvatarFallback className="text-sm">{p.name.slice(0, 2)}</AvatarFallback>
                          </Avatar>
                          <div className="flex-1 min-w-0">
                            <p className="font-medium truncate">{p.name}</p>
                            {quickSettingsView === "location" && (
                              <p className="text-sm text-muted-foreground flex items-center gap-1">
                                <MapPin className="w-3.5 h-3.5" />
                                {p.loc}
                                {p.hasGeo && <span className="text-xs text-primary">(map)</span>}
                              </p>
                            )}
                            {quickSettingsView === "rate" && <p className="text-sm text-muted-foreground">${p.rate ?? 0}/hr</p>}
                            {quickSettingsView === "skillset" && <p className="text-sm text-muted-foreground">{p.skillsCount ?? 0} skills</p>}
                          </div>
                          <ChevronRight className="w-5 h-5 text-muted-foreground flex-shrink-0" />
                        </button>
                      ))}
                    </div>
                    </div>
                  );
                })();
        const footer = quickSettingsSubView === "edit" && (
          <div className="flex-shrink-0 p-4 border-t bg-background flex gap-2">
            <Button variant="outline" className="flex-1" onClick={quickSettingsBack}>Back</Button>
            {quickSettingsView === "location" && (
              <Button className="flex-1" onClick={saveLocation} disabled={updateProfileMutation.isPending}>
                {updateProfileMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Check className="w-4 h-4 mr-2" />}
                Save Location
              </Button>
            )}
            {quickSettingsView === "rate" && (
              <Button className="flex-1" onClick={saveRate} disabled={updateProfileMutation.isPending}>
                {updateProfileMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Check className="w-4 h-4 mr-2" />}
                Save Rate
              </Button>
            )}
            {quickSettingsView === "skillset" && (
              <Button className="flex-1" onClick={saveSkillset} disabled={updateProfileMutation.isPending}>
                {updateProfileMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Check className="w-4 h-4 mr-2" />}
                Save Skills
              </Button>
            )}
          </div>
        );
        return isMobile ? (
          <Drawer open={true} onOpenChange={(o) => !o && quickSettingsClose()}>
            <DrawerContent className="h-[90dvh] max-h-[90dvh] rounded-t-[28px]">
              <DrawerTitle className="sr-only">Quick Settings</DrawerTitle>
              <DrawerDescription className="sr-only">Update location, rate, or skillset</DrawerDescription>
              {header}
              <ScrollArea className="flex-1 min-h-0">{body}</ScrollArea>
              {footer}
            </DrawerContent>
          </Drawer>
        ) : (
          <Dialog open={true} onOpenChange={(o) => !o && quickSettingsClose()}>
            <DialogContent hideCloseButton className="max-w-md p-0 rounded-2xl overflow-hidden shadow-2xl border-0 max-h-[90vh] flex flex-col">
              <DialogTitle className="sr-only">Quick Settings</DialogTitle>
              <DialogDescription className="sr-only">Update location, rate, or skillset</DialogDescription>
              {header}
              <ScrollArea className="flex-1 min-h-0">{body}</ScrollArea>
              {footer}
            </DialogContent>
          </Dialog>
        );
      })() : null}
      {/* Standalone Skillset Dialog (from menu) - 1:1 with desktop: tabs You + teammates, then industry list for selected person */}
      <MobilePopup
        open={skillsetDialogOpen}
        onOpenChange={setSkillsetDialogOpen}
        title="Update Skillset"
        description="Select the skills that match your experience"
        primaryAction={{
          label: updateProfileMutation.isPending ? "Saving..." : "Save Skills",
          onClick: () => saveSkillset(skillsetPanelPerson === "self" ? undefined : skillsetPanelPerson),
          disabled: updateProfileMutation.isPending,
          icon: updateProfileMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Check className="w-4 h-4 mr-2" />
        }}
        secondaryAction={{
          label: "Cancel",
          onClick: () => setSkillsetDialogOpen(false)
        }}
      >
        <div className="space-y-3">
          <Tabs value={skillsetPanelPerson === "self" ? "self" : String(skillsetPanelPerson)} onValueChange={(v) => setSkillsetPanelPerson(v === "self" ? "self" : parseInt(v, 10))}>
            <TabsList withScrollControls className="mb-4">
              <TabsTrigger value="self" className="flex-shrink-0" data-testid="skillset-panel-tab-self">
                <div className="flex items-center gap-2">
                  <Avatar className="w-5 h-5">
                    <AvatarImage src={normalizeAvatarUrl(profile?.avatarUrl) ?? undefined} />
                    <AvatarFallback className="text-[10px]">{profile?.firstName?.[0]}{profile?.lastName?.[0]}</AvatarFallback>
                  </Avatar>
                  <span className="text-sm font-medium truncate">You</span>
                </div>
              </TabsTrigger>
              {activeTeamMembers.map((m) => (
                <TabsTrigger key={m.id} value={String(m.id)} className="flex-shrink-0" data-testid={`skillset-panel-tab-${m.id}`}>
                  <div className="flex items-center gap-2">
                    <Avatar className="w-5 h-5">
                      <AvatarImage src={normalizeAvatarUrl(m.avatarUrl) ?? undefined} />
                      <AvatarFallback className="text-[10px]">{m.firstName?.[0]}{m.lastName?.[0]}</AvatarFallback>
                    </Avatar>
                    <span className="text-sm font-medium truncate">{isMobile ? m.firstName : `${m.firstName} ${m.lastName}`}</span>
                  </div>
                </TabsTrigger>
              ))}
            </TabsList>
            {(() => {
              const isSelf = skillsetPanelPerson === "self";
              const teammate = !isSelf ? activeTeamMembers.find((m) => m.id === skillsetPanelPerson) : null;
              const teammateId = teammate?.id;
              const displayCategories = isSelf
                ? selectedCategories
                : (teammateId && teammateSkillsets[teammateId])
                  ? teammateSkillsets[teammateId]
                  : (teammate?.skillsets ?? []);
              const getCount = (industryId: string) => {
                const ind = INDUSTRY_CATEGORIES.find((c) => c.id === industryId);
                return ind ? ind.roles.filter((r) => displayCategories.includes(r.id)).length : 0;
              };
              return (
                <div className="space-y-3">
                  {INDUSTRY_CATEGORIES.map((industry) => {
                    const Icon = industry.icon;
                    const selectedCount = getCount(industry.id);
                    const isExpanded = expandedIndustries.includes(industry.id);
                    return (
                      <div key={industry.id} className="border rounded-lg overflow-hidden">
                        <button
                          type="button"
                          onClick={() => toggleIndustryExpansion(industry.id)}
                          className="w-full flex items-center justify-between p-3 hover:bg-muted/50 transition-colors text-left"
                          data-testid={`menu-industry-toggle-${industry.id}`}
                        >
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                              <Icon className="w-4 h-4 text-primary" />
                            </div>
                            <span className="font-medium">{industry.label}</span>
                            {selectedCount > 0 && <Badge variant="default" className="text-xs">{selectedCount} selected</Badge>}
                          </div>
                          {isExpanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
                        </button>
                        {isExpanded && (
                          <div className="border-t bg-muted/20 p-2 space-y-1">
                            {industry.roles.map((role) => {
                              const checked = displayCategories.includes(role.id);
                              const handleToggle = () => {
                                if (isSelf) toggleCategory(role.id);
                                else if (teammateId) toggleCategory(role.id, teammateId);
                              };
                              return (
                                <div
                                  key={role.id}
                                  className={`flex items-start space-x-3 p-2 rounded-md transition-colors ${checked ? "bg-primary/10" : "hover:bg-muted/50"} cursor-pointer`}
                                  onClick={handleToggle}
                                >
                                  <Checkbox id={`panel-skill-mobile-${role.id}`} checked={checked} onCheckedChange={handleToggle} className="mt-0.5" />
                                  <Label htmlFor={`panel-skill-mobile-${role.id}`} className="flex-1 cursor-pointer">
                                    <span className="font-medium text-sm flex items-center gap-2">{role.label}{role.isElite && <Badge variant="secondary" className="text-xs">Certified</Badge>}</span>
                                    <span className="text-xs text-muted-foreground block mt-0.5">{role.desc}</span>
                                  </Label>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })()}
          </Tabs>
        </div>
      </MobilePopup>
      {/* Standalone Rate Dialog (from menu) - 1:1 with desktop: all workers accordion + Smart Apply Rate */}
      <MobilePopup
        open={rateDialogOpen}
        onOpenChange={setRateDialogOpen}
        title="Update Rate"
        description="Set hourly rates for you and your team"
        secondaryAction={{
          label: "Done",
          onClick: () => setRateDialogOpen(false)
        }}
      >
        <div className="space-y-4">
          <div className="space-y-2">
            {allRateWorkers.map((worker) => {
              const isOpen = rateAccordionOpen === worker.id;
              const avatarSrc = worker.avatar ? (worker.avatar.startsWith("/") ? worker.avatar : `/${worker.avatar}`) : undefined;
              const initials = worker.id === "self" ? `${profile?.firstName?.[0]}${profile?.lastName?.[0]}` : worker.name.split(" ").map((n) => n[0]).join("");
              return (
                <div key={worker.id} className="border rounded-lg overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setRateAccordionOpen(isOpen ? null : worker.id)}
                    className="w-full flex items-center justify-between p-3 hover:bg-muted/50 transition-colors text-left"
                    data-testid={`rate-row-${worker.id}`}
                  >
                    <div className="flex items-center gap-3">
                      <Avatar className="w-8 h-8">
                        <AvatarImage src={avatarSrc} />
                        <AvatarFallback className="text-xs">{initials}</AvatarFallback>
                      </Avatar>
                      <span className="font-medium">{worker.name}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-lg font-semibold text-primary">${worker.rate}/hr</span>
                      {isOpen ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
                    </div>
                  </button>
                  {isOpen && (
                    <div className="border-t bg-muted/20 p-4 space-y-4">
                      <div>
                        <Label htmlFor={`rate-slider-mobile-${worker.id}`} className="text-sm font-medium mb-2 block">Hourly Rate: ${getEditRate(worker.id)}/hr</Label>
                        <RateSlider
                          id={`rate-slider-mobile-${worker.id}`}
                          value={getEditRate(worker.id)}
                          onValueChange={(rate) => setRateEditingValues({ ...rateEditingValues, [worker.id]: rate })}
                          className="w-full"
                          data-testid={`rate-slider-${worker.id}`}
                        />
                        <div className="flex justify-between mt-2 text-xs text-muted-foreground"><span>$1/hr</span><span>$200/hr</span></div>
                      </div>
                      <div className="bg-muted/50 p-3 rounded-lg">
                        <p className="text-xs text-muted-foreground">Applications already sent will not be affected.</p>
                      </div>
                      <div className="flex gap-2">
                        <Button variant="outline" className="flex-1" onClick={() => setRateAccordionOpen(null)}>Cancel</Button>
                        <Button className="flex-1" onClick={() => saveWorkerRate(worker.id)} disabled={updateProfileMutation.isPending}>
                          {updateProfileMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4 mr-2" />}
                          Save
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          {/* Smart Apply Rate - same as desktop */}
          <div className="border-t border-border pt-4">
            <div className="w-full">
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <Sparkles className="w-5 h-5 text-primary" />
                  <div className="flex-1">
                    <h3 className="text-sm font-semibold">Smart Apply Rate</h3>
                    <p className="text-xs text-muted-foreground">
                      {smartApplyRateEnabled
                        ? "AI will optimize rates for all future job applications"
                        : "Using manually set rates for job applications"}
                    </p>
                  </div>
                </div>
                <Switch
                  checked={smartApplyRateEnabled}
                  onCheckedChange={setSmartApplyRateEnabled}
                  className="data-[state=checked]:bg-green-600"
                  data-testid="smart-apply-rate-toggle"
                />
              </div>
              {smartApplyRateEnabled && (
                <div className="mt-3 pt-3 border-t border-border">
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    <strong className="text-foreground">How it works:</strong> When applying for jobs, the AI analyzes job requirements, market rates, and your team&apos;s skills to suggest optimal rates that maximize your chances of getting hired while maintaining fair compensation.
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      </MobilePopup>
      {/* Apply for Job Dialog - Airbnb Style */}
      <MobilePopup
        open={!!applyJob}
        onOpenChange={(open) => { 
          if (!open) { 
            setShowCancellationPolicyApply(false);
            if (!applyJobReturnTo) {
              setSuggestedApplicationRate(null);
              setApplyStage(1);
            }
            setApplyJob(null); 
            setSelectedTeamMemberId("self"); 
            setSelectedApplicants(new Set(["self"]));
            setUseSmartRateDashboard(false);
            setApplicationMessage("");
          } 
        }}
        title={`Apply for ${applyJob?.title || "Job"}`}
        footer={
          <div className="flex-shrink-0 p-4 border-t bg-background">
            <div className="flex flex-row items-end justify-between gap-4">
              <div className="flex flex-col min-w-0">
                <p className="text-xl font-bold tracking-tight">${Math.round(combinedPayoutDashboard).toLocaleString()}</p>
                <p className="text-sm text-muted-foreground">
                  {applyJob?.estimatedHours ?? 8} hrs
                  {applyJob?.startDate && (
                    <> · {format(new Date(applyJob.startDate), "MMM d")}
                      {applyJob?.endDate
                        ? ` – ${format(new Date(applyJob.endDate), "MMM d")}`
                        : (applyJob?.estimatedHours ?? 8) > 0
                          ? ` – ${format(addHours(new Date(applyJob.startDate), applyJob.estimatedHours ?? 8), "MMM d")}`
                          : ""}
                    </>
                  )}
                </p>
                <button
                  type="button"
                  onClick={() => setShowCancellationPolicyApply(true)}
                  className="text-xs text-muted-foreground hover:text-foreground underline text-left mt-0.5"
                >
                  $0 today · Free cancellation
                </button>
              </div>
              <Button
                className="h-12 min-w-[140px] text-base font-semibold rounded-xl shadow-lg bg-gradient-to-r from-[#00A86B] to-[#008A57] hover:from-[#008A57] hover:to-[#006B44] text-white border-0"
                onClick={handleApplyForJob}
                disabled={isSubmitting || selectedApplicants.size === 0}
                data-testid="dashboard-apply-reserve"
              >
                {isSubmitting ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : (
                  <>Apply · ${Math.round(combinedPayoutDashboard).toLocaleString()}</>
                )}
              </Button>
            </div>
          </div>
        }
      >
        <div className="space-y-5">
            {/* Header with Estimated Payout */}
            <div className="text-center pb-4 border-b">
              <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Estimated Payout</p>
              <p className="text-3xl font-bold text-green-600 dark:text-green-400">
                $<NumberFlowComponent value={combinedPayoutDashboard} trend={false} />
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                {selectedApplicants.size} {selectedApplicants.size === 1 ? "worker" : "workers"} × {applyJob?.estimatedHours || 8} hours
              </p>
            </div>

            {/* Multi-Worker Selection for Business Operators with Team Members */}
            {applyJob && activeTeamMembers.length > 0 ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label className="text-sm font-medium">
                    {(applyJob.maxWorkersNeeded ?? 1) > 1 
                      ? `Select your team (${selectedApplicants.size}/${applyJob.maxWorkersNeeded})`
                      : "Who's working this job?"
                    }
                  </Label>
                  {(applyJob.maxWorkersNeeded ?? 1) > 1 && (
                    <Badge variant="outline" className="text-xs bg-purple-50 dark:bg-purple-950/50 text-purple-700 dark:text-purple-300 border-purple-200 dark:border-purple-800">
                      <Users className="w-3 h-3 mr-1" />
                      Needs {applyJob.maxWorkersNeeded} workers
                    </Badge>
                  )}
                </div>
                
                {/* Team selection - fully expanded */}
                <div className="space-y-2">
                  {/* Self option */}
                  <button
                    type="button"
                    onClick={() => {
                      const maxWorkers = applyJob?.maxWorkersNeeded ?? 1;
                      setSelectedApplicants(prev => {
                        const next = new Set(prev);
                        if (next.has("self")) {
                          if (next.size > 1) next.delete("self");
                        } else if (next.size < maxWorkers) {
                          next.add("self");
                        } else if (maxWorkers === 1) {
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
                    data-testid="select-self"
                  >
                    <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors flex-shrink-0 ${
                      selectedApplicants.has("self") ? "border-primary bg-primary" : "border-muted-foreground"
                    }`}>
                      {selectedApplicants.has("self") && <Check className="w-3 h-3 text-primary-foreground" />}
                    </div>
                    <Avatar className="w-10 h-10 border-2 border-primary/20 flex-shrink-0">
                      <AvatarImage src={profile?.avatarUrl ? (profile.avatarUrl.startsWith('http') || profile.avatarUrl.startsWith('/') ? profile.avatarUrl : `/objects/avatar/${profile.avatarUrl}`) : undefined} />
                      <AvatarFallback className="text-xs">{profile?.firstName?.[0]}{profile?.lastName?.[0]}</AvatarFallback>
                    </Avatar>
                    <div className="flex-1 text-left min-w-0">
                      <p className="font-medium">{t("myself")}</p>
                      <p className="text-xs text-muted-foreground">${rateToDollars(profile?.hourlyRate)}/hr</p>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="flex-shrink-0"
                      onClick={(e) => {
                        e.stopPropagation();
                        setTempAdjustedRate(rateToDollars(profile?.hourlyRate));
                        setRateAdjustMember({ type: "self" });
                        setApplyJobReturnTo(applyJob);
                        setApplyJob(null);
                      }}
                      data-testid="adjust-rate-self"
                    >
                      <Settings className="w-4 h-4 text-muted-foreground" />
                    </Button>
                  </button>
                  
                  {/* Active Team members - Selectable */}
                  {activeTeamMembers.filter(m => m.status === "active" || !m.status).map((member) => (
                    <button
                      key={member.id}
                      type="button"
                      onClick={() => {
                        const maxWorkers = applyJob?.maxWorkersNeeded ?? 1;
                        setSelectedApplicants(prev => {
                          const next = new Set(prev);
                          if (next.has(member.id)) {
                            if (next.size > 1) next.delete(member.id);
                          } else if (next.size < maxWorkers) {
                            next.add(member.id);
                          } else if (maxWorkers === 1) {
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
                      data-testid={`select-member-${member.id}`}
                    >
                      <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors flex-shrink-0 ${
                        selectedApplicants.has(member.id) ? "border-primary bg-primary" : "border-muted-foreground"
                      }`}>
                        {selectedApplicants.has(member.id) && <Check className="w-3 h-3 text-primary-foreground" />}
                      </div>
                      <Avatar className="w-10 h-10 border-2 border-secondary flex-shrink-0">
                        <AvatarImage src={member.avatarUrl ? (member.avatarUrl.startsWith('http') || member.avatarUrl.startsWith('/') ? member.avatarUrl : `/objects/avatar/${member.avatarUrl}`) : undefined} />
                        <AvatarFallback className="text-xs">{member.firstName?.[0]}{member.lastName?.[0]}</AvatarFallback>
                      </Avatar>
                      <div className="flex-1 text-left min-w-0">
                        <p className="font-medium">{member.firstName} {member.lastName}</p>
                        <p className="text-xs text-muted-foreground">${rateToDollars(member.hourlyRate)}/hr</p>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="flex-shrink-0"
                        onClick={(e) => {
                          e.stopPropagation();
                          setTempAdjustedRate(rateToDollars(member.hourlyRate));
                          setRateAdjustMember({ type: "member", memberId: member.id });
                          setApplyJobReturnTo(applyJob);
                          setApplyJob(null);
                        }}
                        data-testid={`adjust-rate-member-${member.id}`}
                      >
                        <Settings className="w-4 h-4 text-muted-foreground" />
                      </Button>
                    </button>
                  ))}

                  {/* Pending Team members - Not selectable, but clickable to show onboarding URL */}
                  {pendingTeamMembers.length > 0 && (
                    <div className="space-y-2 pt-2 border-t">
                      <Label className="text-xs text-muted-foreground font-medium">
                        {t("pendingInvitations") || "Pending Invitations"}
                      </Label>
                      {pendingTeamMembers.map((member) => {
                        const onboardingUrl = (member as any).inviteToken && member.role && member.hourlyRate
                          ? `${window.location.origin}/team/join/${(member as any).inviteToken}`
                          : null;
                        
                        return (
                          <button
                            key={member.id}
                            type="button"
                            onClick={async () => {
                              if (onboardingUrl) {
                                try {
                                  if (navigator.share) {
                                    await navigator.share({
                                      title: `Join ${member.firstName}'s team`,
                                      text: "You've been invited to join as a team member",
                                      url: onboardingUrl,
                                    });
                                  } else {
                                    await navigator.clipboard.writeText(onboardingUrl);
                                    toast({
                                      title: "Link Copied",
                                      description: "Onboarding link copied to clipboard",
                                    });
                                  }
                                } catch (err: any) {
                                  if (err.name !== 'AbortError') {
                                    try {
                                      await navigator.clipboard.writeText(onboardingUrl);
                                      toast({
                                        title: "Link Copied",
                                        description: "Onboarding link copied to clipboard",
                                      });
                                    } catch (copyErr) {
                                      console.error("Failed to copy link:", copyErr);
                                    }
                                  }
                                }
                              }
                            }}
                            className="w-full flex items-center gap-3 p-3 rounded-xl border-2 border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-950/20 hover:bg-amber-100/50 dark:hover:bg-amber-950/30 transition-all cursor-pointer"
                            data-testid={`select-pending-member-${member.id}`}
                          >
                            <div className="w-5 h-5 rounded-full border-2 border-amber-400 dark:border-amber-600 flex items-center justify-center flex-shrink-0">
                              <Clock className="w-3 h-3 text-amber-600 dark:text-amber-400" />
                            </div>
                            <Avatar className="w-10 h-10 border-2 border-amber-200 dark:border-amber-800 flex-shrink-0 opacity-75">
                              <AvatarImage src={member.avatarUrl ? (member.avatarUrl.startsWith('http') || member.avatarUrl.startsWith('/') ? member.avatarUrl : `/objects/avatar/${member.avatarUrl}`) : undefined} />
                              <AvatarFallback className="text-xs">{member.firstName?.[0]}{member.lastName?.[0]}</AvatarFallback>
                            </Avatar>
                            <div className="flex-1 text-left min-w-0">
                              <div className="flex items-center gap-2">
                                <p className="font-medium text-amber-900 dark:text-amber-100">{member.firstName} {member.lastName}</p>
                                <Badge variant="outline" className="text-xs bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 border-amber-300 dark:border-amber-700">
                                  {t("pending") || "Pending"}
                                </Badge>
                              </div>
                              <p className="text-xs text-amber-700 dark:text-amber-300 mt-0.5">
                                {onboardingUrl 
                                  ? "Click to copy onboarding link"
                                  : "Complete setup to share link"}
                              </p>
                            </div>
                            {onboardingUrl && (
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="flex-shrink-0"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  navigator.clipboard.writeText(onboardingUrl);
                                  toast({
                                    title: "Link Copied",
                                    description: "Onboarding link copied to clipboard",
                                  });
                                }}
                                data-testid={`copy-link-pending-${member.id}`}
                              >
                                <MessageSquare className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                              </Button>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
                
                <p className="text-xs text-muted-foreground px-1">
                  Payments for team members go to your account
                </p>
              </div>
            ) : null}

            {/* Company + optional message (single-stage Reserve-style) */}
            <div className="flex flex-col items-center gap-2 pb-4 border-b">
              {companyProfileDashboard ? (
                <>
                  {companyProfileDashboard.companyLogo ? (
                    <Avatar className="w-12 h-12">
                      <AvatarImage src={companyProfileDashboard.companyLogo} />
                      <AvatarFallback>{companyProfileDashboard.companyName?.[0] || "C"}</AvatarFallback>
                    </Avatar>
                  ) : (
                    <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center">
                      <span className="font-semibold text-muted-foreground">{companyProfileDashboard.companyName?.[0] || "C"}</span>
                    </div>
                  )}
                  <p className="font-medium">{companyProfileDashboard.companyName || "Company"}</p>
                  {applyJob?.locationName && (
                    <p className="text-xs text-muted-foreground">Location: {applyJob.locationName}</p>
                  )}
                </>
              ) : null}
            </div>
            <div className="pb-4">
              <Label htmlFor="apply-message" className="text-sm font-medium">Message to Company (Optional)</Label>
              <Textarea
                id="apply-message"
                placeholder="Introduce yourself or mention relevant experience..."
                value={applicationMessage}
                onChange={(e) => setApplicationMessage(e.target.value)}
                className="mt-2 resize-none"
                rows={3}
                data-testid="apply-message"
              />
              <p className="text-xs text-muted-foreground mt-1">Contact information will be automatically removed</p>
            </div>
          </div>
      </MobilePopup>
      {/* Cancellation policy (strike) popup – from Apply footer "Free cancellation" */}
      <MobilePopup
        open={showCancellationPolicyApply}
        onOpenChange={setShowCancellationPolicyApply}
        title={tEnhanced("strikePolicyTitle") || "Cancellation policy"}
        primaryAction={{
          label: "Got it",
          onClick: () => setShowCancellationPolicyApply(false),
        }}
      >
        <p className="text-muted-foreground text-sm">
          {tEnhanced("strikePolicyBody") || "If the company accepts your offer and you do not show up or work that day, your account will receive a strike."}
        </p>
      </MobilePopup>
      {/* Rate Adjustment Popup (Breadcrumb from Apply) */}
      <MobilePopup
        open={!!rateAdjustMember}
        onOpenChange={(open) => {
          if (!open) {
            // Breadcrumb: reopen the apply popup
            if (applyJobReturnTo) {
              setApplyJob(applyJobReturnTo);
              setApplyJobReturnTo(null);
            }
            setRateAdjustMember(null);
          }
        }}
        title={rateAdjustMember?.type === "self" ? "Adjust Your Rate" : "Adjust Team Member Rate"}
        description="This will update the hourly rate for future applications"
        primaryAction={{
          label: "Save Rate",
          onClick: async () => {
            try {
              if (rateAdjustMember?.type === "self" && profile?.id) {
                await apiRequest("PATCH", `/api/profiles/${profile.id}`, {
                  hourlyRate: tempAdjustedRate
                });
                queryClient.invalidateQueries({ queryKey: ["/api/profiles", profile.userId] });
                toast({ title: "Rate updated", description: `Your rate is now $${tempAdjustedRate}/hr` });
              } else if (rateAdjustMember?.type === "member" && rateAdjustMember.memberId) {
                await apiRequest("PATCH", `/api/worker-team-members/${rateAdjustMember.memberId}`, {
                  hourlyRate: tempAdjustedRate
                });
                queryClient.invalidateQueries({ queryKey: ["/api/worker-team", profile?.id] });
                const member = activeTeamMembers.find(m => m.id === rateAdjustMember.memberId);
                toast({ 
                  title: "Rate updated", 
                  description: `${member?.firstName}'s rate is now $${tempAdjustedRate}/hr` 
                });
              }
              // Close and return to apply popup
              if (applyJobReturnTo) {
                setApplyJob(applyJobReturnTo);
                setApplyJobReturnTo(null);
              }
              setRateAdjustMember(null);
            } catch (error) {
              toast({ title: "Error", description: "Could not update rate. Please try again.", variant: "destructive" });
            }
          },
          testId: "save-rate-adjustment"
        }}
        secondaryAction={{
          label: "Cancel",
          onClick: () => {
            // Breadcrumb: reopen the apply popup without saving
            if (applyJobReturnTo) {
              setApplyJob(applyJobReturnTo);
              setApplyJobReturnTo(null);
            }
            setRateAdjustMember(null);
          },
          testId: "cancel-rate-adjustment"
        }}
      >
        <div className="space-y-6">
          {/* Current member info */}
          <div className="flex items-center gap-3 p-3 bg-secondary/40 rounded-xl">
            <Avatar className="w-12 h-12 border-2 border-primary/20">
              {rateAdjustMember?.type === "self" ? (
                <>
                  <AvatarImage src={profile?.avatarUrl || undefined} />
                  <AvatarFallback className="text-sm">{profile?.firstName?.[0]}{profile?.lastName?.[0]}</AvatarFallback>
                </>
              ) : (
                (() => {
                  const member = activeTeamMembers.find(m => m.id === rateAdjustMember?.memberId);
                  return (
                    <>
                      <AvatarImage src={member?.avatarUrl || undefined} />
                      <AvatarFallback className="text-sm">{member?.firstName?.[0]}{member?.lastName?.[0]}</AvatarFallback>
                    </>
                  );
                })()
              )}
            </Avatar>
            <div>
              <p className="font-medium">
                {rateAdjustMember?.type === "self" 
                  ? t("myself")
                  : (() => {
                      const member = activeTeamMembers.find(m => m.id === rateAdjustMember?.memberId);
                      return `${member?.firstName} ${member?.lastName}`;
                    })()
                }
              </p>
              <p className="text-sm text-muted-foreground">
                Current rate: ${rateAdjustMember?.type === "self" 
                  ? profile?.hourlyRate 
                  : activeTeamMembers.find(m => m.id === rateAdjustMember?.memberId)?.hourlyRate
                }/hr
              </p>
            </div>
          </div>
          
          {/* Rate slider */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <Label className="text-base font-medium">Hourly Rate</Label>
              <span className="text-2xl font-bold text-primary">${tempAdjustedRate}/hr</span>
            </div>
            
            <RateSlider
              value={tempAdjustedRate}
              onValueChange={setTempAdjustedRate}
              className="w-full"
              data-testid="rate-adjust-slider"
            />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>$1/hr</span>
              <span>$200/hr</span>
            </div>
          </div>
          
          <div className="bg-amber-50 dark:bg-amber-950/30 p-3 rounded-lg border border-amber-200 dark:border-amber-800">
            <p className="text-xs text-amber-800 dark:text-amber-200">
              This changes the permanent rate for {rateAdjustMember?.type === "self" ? "your profile" : "this team member"}. 
              Existing applications will keep their original rates.
            </p>
          </div>
        </div>
      </MobilePopup>
      {/* Dismiss Job Dialog - Airbnb Style */}
      <MobilePopup
        open={!!jobToDismiss}
        onOpenChange={(open) => !open && setJobToDismiss(null)}
        title="Hide this job?"
        description="This job won't appear in your feed anymore"
        primaryAction={{
          label: dismissJobMutation.isPending ? "Hiding..." : "Hide Job",
          onClick: () => jobToDismiss && handleDismissJob(jobToDismiss),
          disabled: dismissJobMutation.isPending,
          variant: "destructive",
          testId: "confirm-dismiss"
        }}
        secondaryAction={{
          label: "Keep It",
          onClick: () => setJobToDismiss(null),
          testId: "cancel-dismiss"
        }}
      >
        <div className="space-y-4">
          {/* Job Preview Card */}
          <div className="bg-secondary/40 rounded-2xl p-4 border border-border/40">
            <h4 className="font-semibold text-base mb-1">{jobToDismiss?.title}</h4>
            <p className="text-sm text-muted-foreground flex items-center gap-1">
              <MapPin className="w-3 h-3" />
              {jobToDismiss && formatJobLocation(jobToDismiss)}
            </p>
          </div>
          
          {/* Reason Selection */}
          <div className="space-y-2">
            <Label className="text-sm font-medium">Help us improve (optional)</Label>
            <Select modal={false} value={dismissReason} onValueChange={setDismissReason}>
              <SelectTrigger className="h-12 rounded-xl" data-testid="dismiss-reason">
                <SelectValue placeholder="Why are you hiding this?" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="not_interested">Not interested in this type</SelectItem>
                <SelectItem value="too_far">Location is too far</SelectItem>
                <SelectItem value="low_pay">Pay doesn't match my rate</SelectItem>
                <SelectItem value="wrong_skills">Doesn't match my skills</SelectItem>
                <SelectItem value="bad_timing">Schedule doesn't work</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </MobilePopup>
      {/* Notifications Full Page Popup (Mobile) */}
      <MobilePopup
        open={notificationsOpen}
        onOpenChange={setNotificationsOpen}
        title="Notifications"
        headerContent={
          notifications && notifications.filter((n: any) => !n.isRead).length > 0 ? (
            <Button 
              variant="ghost" 
              size="sm" 
              className="text-xs"
              onClick={async () => {
                try {
                  await apiRequest("PATCH", "/api/notifications/read-all", { profileId: profile?.id });
                  queryClient.invalidateQueries({ queryKey: ['/api/notifications', profile?.id] });
                } catch (err) {
                  console.error("Failed to mark all as read:", err);
                }
              }}
              data-testid="mobile-mark-all-read-button"
            >
              Mark all as read
            </Button>
          ) : undefined
        }
      >
        {!notifications || notifications.length === 0 ? (
          <div className="py-12 text-center text-muted-foreground" data-testid="mobile-notifications-empty">
            <Bell className="w-12 h-12 mx-auto mb-3 opacity-50" />
            <p className="text-base">No notifications yet</p>
            <p className="text-sm mt-1">You'll see updates about your jobs here</p>
          </div>
        ) : (
          <div className="divide-y divide-border -mx-4">
            {notifications.map((notif: any) => (
              <div 
                key={notif.id}
                className={`p-4 cursor-pointer active:bg-muted/50 transition-colors ${!notif.isRead ? "bg-primary/5" : ""}`}
                onClick={async () => {
                  if (!notif.isRead) {
                    try {
                      await apiRequest("PATCH", `/api/notifications/${notif.id}/read`, {});
                      queryClient.invalidateQueries({ queryKey: ['/api/notifications', profile?.id] });
                    } catch (err) {
                      console.error("Failed to mark as read:", err);
                    }
                  }
                  setNotificationsOpen(false);
                  const data = notif.data || {};
                  if (tryOpenTimesheetApprovalInvoiceFromNotification(notif, openTimesheetApprovalInvoice)) {
                    return;
                  }
                  if (notif.url) {
                    setLocation(notif.url);
                    return;
                  }
                  if (notif.type === "new_job_in_territory" || notif.type === "new_job_posted") {
                    setLocation(data.jobId ? `/jobs/${data.jobId}` : "/dashboard/find");
                  } else if (notif.type === "application_approved" || notif.type === "job_application_accepted") {
                    setLocation(data.jobId ? `/dashboard/jobs?jobId=${data.jobId}&tab=active` : "/dashboard/jobs");
                  } else if (notif.type === "application_rejected" || notif.type === "job_application_rejected") {
                    setLocation(data.jobId ? `/dashboard/jobs?jobId=${data.jobId}&tab=history` : "/dashboard/jobs");
                  } else if (notif.type === "job_offer_received") {
                    setLocation(data.jobId ? `/dashboard/jobs?jobId=${data.jobId}&tab=offers` : "/dashboard/jobs");
                  } else if (notif.type === "timesheet_approved" || notif.type === "payment_received") {
                    setLocation(data.timesheetId ? `/dashboard/settings/payouts?timesheetId=${data.timesheetId}` : "/dashboard/settings/payouts");
                  } else if (notif.type === "timesheet_edited" || notif.type === "timesheet_reported") {
                    setLocation(data.timesheetId ? `/dashboard/jobs?timesheetId=${data.timesheetId}` : "/dashboard/jobs");
                  } else if (notif.type === "strike_issued") {
                    setLocation(data.timesheetId ? `/dashboard/strikes?timesheetId=${data.timesheetId}` : "/dashboard/strikes");
                  } else if (notif.type === "new_message") {
                    setLocation(data.jobId ? `/accepted-job/${data.jobId}` : "/dashboard/chats");
                  } else if (notif.type === "job_reminder" || notif.type === "job_start_reminder") {
                    setLocation(data.jobId ? `/dashboard/calendar?jobId=${data.jobId}` : "/dashboard/calendar");
                  } else if (notif.type === "calendar_conflict") {
                    setLocation(data.jobId ? `/dashboard/calendar?jobId=${data.jobId}&conflict=true` : "/dashboard/calendar");
                  } else {
                    setLocation("/dashboard/today");
                  }
                }}
                data-testid={`mobile-notification-item-${notif.id}`}
              >
                <div className="flex items-start gap-3">
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${
                    notif.type === "application_accepted" ? "bg-green-100 dark:bg-green-900/30" :
                    notif.type === "application_rejected" ? "bg-red-100 dark:bg-red-900/30" :
                    notif.type === "payment_received" ? "bg-emerald-100 dark:bg-emerald-900/30" :
                    notif.type === "new_message" ? "bg-blue-100 dark:bg-blue-900/30" :
                    "bg-muted"
                  }`}>
                    {notif.type === "application_accepted" && <CheckCircle className="w-5 h-5 text-green-600" />}
                    {notif.type === "application_rejected" && <XCircle className="w-5 h-5 text-red-600" />}
                    {notif.type === "payment_received" && <DollarSign className="w-5 h-5 text-emerald-600" />}
                    {notif.type === "timesheet_approved" && <CheckCircle className="w-5 h-5 text-green-600" />}
                    {notif.type === "new_message" && <MessageSquare className="w-5 h-5 text-blue-600" />}
                    {notif.type === "new_job" && <Briefcase className="w-5 h-5 text-primary" />}
                    {notif.type === "job_reminder" && <Clock className="w-5 h-5 text-amber-600" />}
                    {!["application_accepted", "application_rejected", "payment_received", "timesheet_approved", "new_message", "new_job", "job_reminder"].includes(notif.type) && <Bell className="w-5 h-5 text-muted-foreground" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={`text-base ${!notif.isRead ? "font-medium" : ""}`}>{notif.title}</p>
                    {notif.message && (
                      <p className="text-sm text-muted-foreground line-clamp-2 mt-1">{notif.message}</p>
                    )}
                    <p className="text-sm text-muted-foreground mt-2">
                      {formatDistanceToNow(new Date(notif.createdAt), { addSuffix: true })}
                    </p>
                  </div>
                  {!notif.isRead && (
                    <div className="w-2.5 h-2.5 bg-primary rounded-full flex-shrink-0 mt-2" />
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </MobilePopup>
      
      {/* AI Dispatch Settings Dialog */}
      <Dialog open={showAiDispatchDialog} onOpenChange={setShowAiDispatchDialog}>
        <DialogContent hideCloseButton className="max-w-3xl max-h-[85vh] flex flex-col overflow-hidden p-0 rounded-2xl shadow-2xl border-0">
          <DialogTitle className="sr-only">AI Dispatch Settings</DialogTitle>
          <DialogDescription className="sr-only">Automatically apply to jobs that match your criteria</DialogDescription>
          {/* Unified header: Title | X */}
          <div className="flex-shrink-0 border-b bg-background px-4 sm:px-6 py-3">
            <div className="flex items-center gap-2">
              <div className="flex-1 min-w-0 pr-2">
                <h2 className="font-semibold text-lg truncate flex items-center gap-2">
                  <Sparkles className="w-5 h-5 flex-shrink-0" />
                  AI Dispatch Settings
                </h2>
                <p className="text-sm text-muted-foreground mt-0.5">
                  Automatically apply to jobs that match your criteria. Applications will be sent when jobs meet all requirements.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowAiDispatchDialog(false)}
                className="flex items-center justify-center rounded-full bg-muted hover:bg-muted/80 transition-all duration-200 flex-shrink-0 w-9 h-9"
                aria-label="Close"
              >
                <X className="w-5 h-5 text-muted-foreground" />
              </button>
            </div>
          </div>
          
          <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden scrollbar-pill-on-scroll px-4 sm:px-6 py-4">
          <div className="space-y-6">
                {/* Teammate Selection */}
                <div className="space-y-3 p-4 border rounded-lg">
                  <div className="flex items-center justify-between mb-2">
                    <Label className="text-base font-semibold">Apply For</Label>
                    <Badge variant="outline" className="text-xs">
                      {Array.from(aiDispatchTeammates).filter((id) => id === "self" || allTeamMembersForApply.find((m) => m.id === id)?.status !== "pending").length}{" "}
                      {Array.from(aiDispatchTeammates).filter((id) => id === "self" || allTeamMembersForApply.find((m) => m.id === id)?.status !== "pending").length === 1 ? "teammate" : "teammates"} selected
                    </Badge>
                  </div>
                  <p className="text-sm text-muted-foreground mb-3">
                    Select which teammates should automatically apply to matching jobs. AI will only apply for teammates with open schedules and availability in their calendar.
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
                    {allTeamMembersForApply.map((member) => {
                      const isPending = member.status === "pending";
                      return (
                      <div key={member.id} className={`flex items-center gap-3 p-2 rounded ${isPending ? "opacity-70" : "hover:bg-muted/50"}`}>
                        <Checkbox
                          id={`ai-dispatch-member-${member.id}`}
                          checked={!isPending && aiDispatchTeammates.has(member.id)}
                          disabled={isPending}
                          onCheckedChange={(checked) => {
                            if (isPending) return;
                            const newSet = new Set(aiDispatchTeammates);
                            if (checked) {
                              newSet.add(member.id);
                            } else {
                              newSet.delete(member.id);
                            }
                            setAiDispatchTeammates(newSet);
                          }}
                        />
                        <Label htmlFor={`ai-dispatch-member-${member.id}`} className={`flex items-center gap-2 flex-1 ${isPending ? "cursor-not-allowed" : "cursor-pointer"}`}>
                          <Avatar className="w-6 h-6">
                            <AvatarImage src={member.avatarUrl || undefined} />
                            <AvatarFallback className="text-xs">
                              {member.firstName[0]}{member.lastName[0]}
                            </AvatarFallback>
                          </Avatar>
                          <span className="font-medium">
                            {member.firstName} {member.lastName}
                          </span>
                          {isPending && (
                            <Badge variant="secondary" className="text-xs">Pending</Badge>
                          )}
                        </Label>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedTeammateForSettings(member);
                            const m = member as any;
                            setTeammateEditAddress(m.address || "");
                            setTeammateEditCity(m.city || "");
                            setTeammateEditState(m.state || "");
                            setTeammateEditZipCode(m.zipCode || "");
                            setTeammateEditLatitude(m.latitude ?? "");
                            setTeammateEditLongitude(m.longitude ?? "");
                            const rate = member.hourlyRate != null ? rateToDollars(member.hourlyRate) : 20;
                            setTeammateEditHourlyRate(Math.min(200, Math.max(1, rate)));
                            setTeammateSettingsOpen(true);
                          }}
                          title="Edit teammate settings"
                        >
                          <Gear className="w-4 h-4" />
                        </Button>
                      </div>
                    ); })}
                    
                    {allTeamMembersForApply.length === 0 && (
                      <p className="text-sm text-muted-foreground italic">
                        No active team members. Add team members in your dashboard to enable auto-applying for them.
                      </p>
                    )}
                  </div>
                </div>
                
                {/* AI Dispatch Prompt (Auto-Apply Message) - surfaced first so it's visible */}
                <div className="space-y-3 p-4 border rounded-lg border-primary/20 bg-primary/5">
                  <div>
                    <Label htmlFor="ai-dispatch-message" className="text-base font-semibold">AI Dispatch Prompt (Auto-Apply Message)</Label>
                    <p className="text-sm text-muted-foreground mt-1 mb-2">
                      Pre-set message sent with auto-applications. Phone numbers, emails, and websites will be automatically removed.
                    </p>
                    <Textarea
                      id="ai-dispatch-message"
                      value={aiDispatchMessage}
                      onChange={(e) => setAiDispatchMessage(e.target.value)}
                      placeholder="Enter your default application message..."
                      className="min-h-[100px]"
                      maxLength={500}
                    />
                    <p className="text-xs text-muted-foreground mt-1">
                      {aiDispatchMessage.length}/500 characters
                    </p>
                    {aiDispatchMessage && (
                      <div className="mt-2 p-2 bg-amber-50 dark:bg-amber-950/20 rounded border border-amber-200 dark:border-amber-800">
                        <p className="text-xs text-amber-800 dark:text-amber-200 flex items-start gap-1">
                          <AlertTriangle className="w-3 h-3 mt-0.5 flex-shrink-0" />
                          <span>Phone numbers, emails, and websites will be automatically removed from this message when sent.</span>
                        </p>
                      </div>
                    )}
                  </div>
                </div>
                
                {/* Maximum Distance - 1–30 mi */}
                <div className="space-y-3 p-4 border rounded-lg bg-blue-50/50 dark:bg-blue-950/20">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                    <div>
                      <Label className="text-base font-semibold">Maximum Distance</Label>
                      <p className="text-sm text-muted-foreground mt-1">
                        AI dispatch only applies to jobs within {Math.min(30, Math.max(1, aiDispatchMaxDistance))} miles of each teammate's start address
                      </p>
                    </div>
                    <div className="flex items-center gap-3 flex-shrink-0">
                      <Slider
                        value={[Math.min(30, Math.max(1, aiDispatchMaxDistance))]}
                        onValueChange={(v) => setAiDispatchMaxDistance(Math.min(30, Math.max(1, v[0] ?? 15)))}
                        min={1}
                        max={30}
                        step={1}
                        className="w-28 sm:w-36"
                      />
                      <span className="text-xl font-bold text-primary tabular-nums w-10">
                        {Math.min(30, Math.max(1, aiDispatchMaxDistance))} mi
                      </span>
                    </div>
                  </div>
                  <div className="mt-2 p-2 bg-background rounded border border-blue-200 dark:border-blue-800">
                    <p className="text-xs text-muted-foreground">
                      <MapPin className="w-3 h-3 inline mr-1" />
                      Each teammate's start address can be edited using the gear icon next to their name
                    </p>
                  </div>
                </div>
                
                {/* Skill-set: general labor allowed for all; Lite/Elite always require a match */}
                <div className="flex items-center justify-between p-4 border rounded-lg">
                  <div className="flex-1">
                    <Label htmlFor="ai-dispatch-skills-only" className="text-base font-semibold cursor-pointer">
                      Apply Only to Skill-set Matches
                    </Label>
                    <p className="text-sm text-muted-foreground mt-1">
                      General labor jobs (e.g. Laborer, Painting, Drywall, Concrete) are allowed for all. Jobs that require Electrical, Plumbing, HVAC, or Carpentry Lite/Elite always require a skill match and will not auto-apply unless the worker has that skill.
                    </p>
                  </div>
                  <Switch
                    id="ai-dispatch-skills-only"
                    checked={aiDispatchSkillsOnly}
                    onCheckedChange={setAiDispatchSkillsOnly}
                  />
                </div>
                
                {/* Time Window */}
                <div className="space-y-3 p-4 border rounded-lg">
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <Label htmlFor="ai-dispatch-time-window" className="text-base font-semibold cursor-pointer">
                        Time Window (Optional)
                      </Label>
                      <p className="text-sm text-muted-foreground mt-1">
                        Only auto-apply to jobs within a specific time range
                      </p>
                    </div>
                    <Switch
                      id="ai-dispatch-time-window"
                      checked={aiDispatchTimeWindowEnabled}
                      onCheckedChange={setAiDispatchTimeWindowEnabled}
                    />
                  </div>
                  {aiDispatchTimeWindowEnabled && (
                    <div className="flex items-center gap-3 mt-3">
                      <div className="flex-1">
                        <Label className="text-sm">Start Time</Label>
                        <Select
                          value={aiDispatchStartTime || "09:00"}
                          onValueChange={(v) => {
                            const validEnds = getValidEndTimeSlots(v);
                            const earliest = getEarliestEndTime(v);
                            setAiDispatchStartTime(v);
                            if (!aiDispatchEndTime || !validEnds.includes(aiDispatchEndTime)) {
                              setAiDispatchEndTime(earliest);
                            }
                          }}
                        >
                          <SelectTrigger className="mt-1"><SelectValue placeholder="Start" /></SelectTrigger>
                          <SelectContent>
                            {getTimeSlots().map((slot) => (
                              <SelectItem key={slot} value={slot}>{formatTime12h(slot)}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="flex-1">
                        <Label className="text-sm">End Time</Label>
                        <Select
                          value={aiDispatchEndTime || getEarliestEndTime(aiDispatchStartTime || "09:00")}
                          onValueChange={setAiDispatchEndTime}
                        >
                          <SelectTrigger className="mt-1"><SelectValue placeholder="End" /></SelectTrigger>
                          <SelectContent>
                            {getValidEndTimeSlots(aiDispatchStartTime || "09:00").map((slot) => (
                              <SelectItem key={slot} value={slot}>{formatTime12h(slot)}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  )}
                </div>
                
                {/* AI Rate Adjustments */}
                <div className="flex items-center justify-between p-4 border rounded-lg">
                  <div className="flex-1">
                    <Label htmlFor="ai-dispatch-rate-adjustments" className="text-base font-semibold cursor-pointer">
                      Enable AI Rate Adjustments
                    </Label>
                    <p className="text-sm text-muted-foreground mt-1">
                      Automatically adjust hourly rates to be competitive with other submissions
                    </p>
                  </div>
                  <Switch
                    id="ai-dispatch-rate-adjustments"
                    checked={aiDispatchRateAdjustments}
                    onCheckedChange={setAiDispatchRateAdjustments}
                  />
                </div>
                
                {/* Requirements Info */}
                <div className="p-4 bg-muted/50 rounded-lg space-y-2">
                  <Label className="text-base font-semibold">Auto-Apply Requirements</Label>
                  <div className="space-y-1.5 text-sm">
                    <div className="flex items-start gap-2">
                      <CheckCircle className="w-4 h-4 text-green-500 mt-0.5 flex-shrink-0" />
                      <span><strong>Distance:</strong> Job must be within {Math.min(30, Math.max(1, aiDispatchMaxDistance))} miles of teammate's start address</span>
                    </div>
                    <div className="flex items-start gap-2">
                      <CheckCircle className="w-4 h-4 text-green-500 mt-0.5 flex-shrink-0" />
                      <span><strong>Skill-set:</strong> General labor jobs allowed for all; Lite/Elite jobs (Electrical, Plumbing, HVAC, Carpentry) require a matching skill</span>
                    </div>
                    <div className="flex items-start gap-2">
                      <CheckCircle className="w-4 h-4 text-green-500 mt-0.5 flex-shrink-0" />
                      <span><strong>Schedule Availability:</strong> Teammate must have open schedule with no conflicts in their calendar</span>
                    </div>
                    {aiDispatchTimeWindowEnabled && (
                      <div className="flex items-start gap-2">
                        <CheckCircle className="w-4 h-4 text-green-500 mt-0.5 flex-shrink-0" />
                        <span><strong>Time Window:</strong> Job must be between {aiDispatchStartTime} and {aiDispatchEndTime}</span>
                      </div>
                    )}
                  </div>
                </div>
          </div>
          </div>
          {/* Sticky footer: Enable AI Dispatch toggle (job-details style) */}
          <div className="flex-shrink-0 border-t bg-background shadow-[0_-2px_12px_rgba(0,0,0,0.06)] px-4 sm:px-6 py-4">
            <div className="flex items-center justify-between gap-4">
              <div className="flex-1 min-w-0">
                <Label htmlFor="ai-dispatch-enabled" className="text-base font-semibold cursor-pointer">
                  Enable AI Dispatch
                </Label>
                <p className="text-sm text-muted-foreground mt-0.5">
                  Automatically apply to matching jobs as they become available
                </p>
              </div>
              <Switch
                id="ai-dispatch-enabled"
                checked={aiDispatchEnabled}
                onCheckedChange={setAiDispatchEnabled}
                className="data-[state=unchecked]:bg-muted-foreground/30 data-[state=checked]:bg-primary"
              />
            </div>
          </div>
        </DialogContent>
      </Dialog>
      
      {/* Teammate Settings – breadcrumb popup on top of AI Dispatch (elevated). Only mount when open so closing unmounts and removes overlay (no blocking layer left behind). */}
      {teammateSettingsOpen && (
      <MobilePopup
        open={true}
        onOpenChange={(open) => {
          if (!open) {
            setTeammateSettingsOpen(false);
            setSelectedTeammateForSettings(null);
          }
        }}
        title="Edit Teammate"
        description={selectedTeammateForSettings ? `${selectedTeammateForSettings.firstName} ${selectedTeammateForSettings.lastName}` : undefined}
        elevated
        showBackButton
        onBack={() => {
          setTeammateSettingsOpen(false);
          setSelectedTeammateForSettings(null);
        }}
        backLabel="AI Dispatch"
        primaryAction={{
          label: "Save Changes",
          disabled: !teammateEditAddress?.trim(),
          onClick: async () => {
            if (!selectedTeammateForSettings) return;
            const effectiveRate = Number.isFinite(teammateEditHourlyRate) ? Math.min(200, Math.max(1, teammateEditHourlyRate)) : 20;
            try {
              const res = await fetch(`/api/worker-team/members/${selectedTeammateForSettings.id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  address: teammateEditAddress?.trim() || undefined,
                  city: teammateEditCity?.trim() || undefined,
                  state: teammateEditState?.trim() || undefined,
                  zipCode: teammateEditZipCode?.trim() || undefined,
                  ...(teammateEditLatitude?.trim() && teammateEditLongitude?.trim()
                    ? { latitude: teammateEditLatitude.trim(), longitude: teammateEditLongitude.trim() }
                    : {}),
                  hourlyRate: effectiveRate,
                }),
                credentials: "include",
              });
              if (res.ok) {
                toast({
                  title: "Settings updated",
                  description: `Updated settings for ${selectedTeammateForSettings.firstName} ${selectedTeammateForSettings.lastName}`,
                });
                queryClient.invalidateQueries({ queryKey: ["/api/worker-team", workerTeam?.id, "members"] });
                setTeammateSettingsOpen(false);
                setSelectedTeammateForSettings(null);
              } else {
                throw new Error("Failed to update settings");
              }
            } catch (error) {
              toast({
                title: "Error",
                description: "Could not update teammate settings. Please try again.",
                variant: "destructive",
              });
            }
          },
        }}
        secondaryAction={{
          label: "Cancel",
          onClick: () => {
            setTeammateSettingsOpen(false);
            setSelectedTeammateForSettings(null);
          },
        }}
      >
        {selectedTeammateForSettings && (
          <div className="space-y-4">
            <div className="flex items-center gap-3 pb-2 border-b border-border/60">
              <Avatar className="h-12 w-12 shrink-0">
                <AvatarImage src={selectedTeammateForSettings.avatarUrl ?? undefined} alt="" />
                <AvatarFallback className="text-sm">
                  {[selectedTeammateForSettings.firstName, selectedTeammateForSettings.lastName].map((n) => n?.charAt(0)).filter(Boolean).join("") || "?"}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <p className="font-medium truncate">
                  {selectedTeammateForSettings.firstName} {selectedTeammateForSettings.lastName}
                </p>
                {(selectedTeammateForSettings as { email?: string }).email && (
                  <p className="text-sm text-muted-foreground truncate">{(selectedTeammateForSettings as { email?: string }).email}</p>
                )}
              </div>
            </div>
            <div className="space-y-2">
              <GooglePlacesAutocomplete
                id="teammate-address"
                label="Worker address *"
                value={[teammateEditAddress, teammateEditCity, teammateEditState, teammateEditZipCode].filter(Boolean).join(", ") || teammateEditAddress}
                onChange={(address, components) => {
                  setTeammateEditAddress(address || "");
                  setTeammateEditCity(components.city ?? teammateEditCity);
                  setTeammateEditState(components.state ?? teammateEditState);
                  setTeammateEditZipCode(components.zipCode ?? teammateEditZipCode);
                  if (components.latitude != null && components.longitude != null) {
                    setTeammateEditLatitude(String(components.latitude));
                    setTeammateEditLongitude(String(components.longitude));
                  }
                }}
                placeholder="Search for this worker's address (select from dropdown)"
                className="space-y-1.5"
              />
              <p className="text-xs text-muted-foreground">
                Required. Used to match jobs to you and your teammates by proximity. Select from the dropdown to save city, state, zip and location.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="teammate-hourly-rate">Hourly Rate ($) *</Label>
              <Input
                id="teammate-hourly-rate"
                type="number"
                min={1}
                max={200}
                step={1}
                value={teammateEditHourlyRate}
                onChange={(e) => {
                  const raw = parseFloat(e.target.value);
                  const clamped = Number.isFinite(raw) ? Math.min(200, Math.max(1, raw)) : 20;
                  setTeammateEditHourlyRate(clamped);
                }}
                placeholder="20"
              />
              <p className="text-xs text-muted-foreground">
                Set the hourly rate that this team member will receive (min $1, max $200). Default $20.
              </p>
            </div>
          </div>
        )}
      </MobilePopup>
      )}
      
      {/* Invite a Buddy Dialog */}
      <MobilePopup
        open={inviteBuddyOpen}
        onOpenChange={setInviteBuddyOpen}
        title="Invite a Buddy"
        description="Share your referral link and earn $100 when your friend signs up and earns their first $100!"
      >
        <div className="space-y-6">
          <div className="bg-primary/10 rounded-lg p-4 text-center">
            <div className="text-4xl mb-2">$100</div>
            <p className="text-sm text-muted-foreground">Bonus for each friend who signs up and earns</p>
          </div>
          <div className="space-y-3">
            <Label>Your referral link</Label>
            <div className="flex gap-2">
              <Input 
                value={`${window.location.origin}/find-work?ref=${user?.id || 'guest'}`}
                readOnly
                className="flex-1 text-sm"
                data-testid="referral-link"
              />
              <Button 
                variant="outline"
                onClick={() => {
                  navigator.clipboard.writeText(`${window.location.origin}/find-work?ref=${user?.id || 'guest'}`);
                  toast({ title: "Link copied!", description: "Share it with your friends to earn $100!" });
                }}
                data-testid="copy-referral-link"
              >
                Copy
              </Button>
            </div>
          </div>
          <Button 
            className="w-full"
            onClick={async () => {
              const link = `${window.location.origin}/find-work?ref=${user?.id || 'guest'}`;
              if (navigator.share) {
                try {
                  await navigator.share({
                    title: "Join me on Tolstoy Staffing!",
                    text: "I'm finding great construction work on Tolstoy Staffing. Join up and when you make your first $100, we BOTH get a $100 bonus!",
                    url: link,
                  });
                  toast({ title: "Shared successfully!" });
                } catch {
                  navigator.clipboard.writeText(link);
                  toast({ title: "Link copied!", description: "Share it with your friends to earn $100!" });
                }
              } else {
                navigator.clipboard.writeText(link);
                toast({ title: "Link copied!", description: "Share it with your friends to earn $100!" });
              }
            }}
            data-testid="share-referral"
          >
            <Send className="w-4 h-4 mr-2" />
            Share with Friends
          </Button>
          <div className="text-center text-sm text-muted-foreground">
            <p>How it works:</p>
            <ol className="text-left mt-2 space-y-1">
              <li>1. Share your link with friends</li>
              <li>2. They sign up and complete their first job</li>
              <li>3. You both get $100 when they earn $100!</li>
            </ol>
          </div>
        </div>
      </MobilePopup>
      {/* Job Application Details Dialog (Jobs Tab) */}
      <EnhancedJobDialog
        open={!!selectedJobApp}
        onOpenChange={(open) => !open && setSelectedJobApp(null)}
        job={selectedJobApp ? allJobs.find(j => j.id === selectedJobApp.jobId) || null : null}
        profile={profile}
        operatorAvatarUrl={operatorAvatarUrl}
        activeTeamMembers={activeTeamMembers}
        territoryRadiusMiles={clampedMaxDistanceMiles}
        application={selectedJobApp ? {
          id: selectedJobApp.id,
          status: selectedJobApp.status as "pending" | "accepted" | "rejected",
          teamMember: selectedJobApp.teamMember,
          proposedRate: selectedJobApp.proposedRate,
        } : undefined}
        groupedApplications={selectedJobApp ? (() => {
          const jobApps = applications.filter(app => app.jobId === selectedJobApp.jobId);
          return {
            applications: jobApps.map(app => ({
              id: app.id,
              status: app.status as "pending" | "accepted" | "rejected",
              teamMember: (app as ApplicationWithDetails).teamMember,
              proposedRate: app.proposedRate,
            })),
            minWorkerCount: jobApps.length,
          };
        })() : undefined}
        onWithdraw={(applicationId) => {
          removeApplicationMutation.mutate(applicationId);
          setSelectedJobApp(null);
        }}
        onWithdrawAll={(applicationIds) => {
          applicationIds.forEach(id => removeApplicationMutation.mutate(id));
          setSelectedJobApp(null);
        }}
        onGetDirections={(job) => {
          setDirectionsJob(job);
          setDirectionsDialogOpen(true);
        }}
        onAssignTeamMember={(applicationId, teamMemberId) => {
          updateApplicationTeamMemberMutation.mutate({
            applicationId,
            teamMemberId,
          });
        }}
        isWithdrawing={removeApplicationMutation.isPending}
      />
      {/* elevated: stack above parent job/application dialogs (z-[201] base) */}
      <MobilePopup
        elevated
        open={directionsDialogOpen}
        onOpenChange={setDirectionsDialogOpen}
        title="Get Directions"
        description="Choose your preferred navigation app"
        maxWidth="sm"
      >
        <div className="grid gap-3">
          <Button
            variant="outline"
            className="w-full justify-start gap-3 h-14"
            onClick={() => directionsJob && openDirections(directionsJob, "google")}
            data-testid="button-directions-google"
          >
            <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center">
              <MapPin className="w-4 h-4 text-blue-600" />
            </div>
            <span>Google Maps</span>
          </Button>
          <Button
            variant="outline"
            className="w-full justify-start gap-3 h-14"
            onClick={() => directionsJob && openDirections(directionsJob, "waze")}
            data-testid="button-directions-waze"
          >
            <div className="w-8 h-8 rounded-full bg-cyan-100 flex items-center justify-center">
              <Navigation className="w-4 h-4 text-cyan-600" />
            </div>
            <span>Waze</span>
          </Button>
          <Button
            variant="outline"
            className="w-full justify-start gap-3 h-14"
            onClick={() => directionsJob && openDirections(directionsJob, "apple")}
            data-testid="button-directions-apple"
          >
            <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center">
              <MapPin className="w-4 h-4 text-gray-600" />
            </div>
            <span>Apple Maps</span>
          </Button>
        </div>
      </MobilePopup>
      
      {/* Language Selector Popup */}
      <MobilePopup
        open={languagePopupOpen}
        onOpenChange={setLanguagePopupOpen}
        title={tMenu("menu.language")}
        description={tMenu("settings.selectLanguage")}
      >
        <div className="space-y-2">
          {SUPPORTED_LANGUAGES.map((lang) => {
            const currentLang = (i18n.language?.split('-')[0] || 'en') as LanguageCode;
            const isSelected = lang.code === currentLang;
            
            return (
              <button
                key={lang.code}
                onClick={async () => {
                  await changeLanguage(lang.code, profile?.id);
                  setLanguagePopupOpen(false);
                  window.location.reload();
                }}
                className={`w-full flex items-center gap-3 p-4 rounded-xl transition-colors text-left ${
                  isSelected 
                    ? "bg-primary/10 border-2 border-primary" 
                    : "hover:bg-secondary/50 border-2 border-transparent"
                }`}
                data-testid={`select-language-${lang.code}`}
              >
                <span className="text-2xl">{lang.flag}</span>
                <div className="flex-1">
                  <p className={`font-medium ${isSelected ? "text-primary" : ""}`}>
                    {lang.nativeName}
                  </p>
                  <p className="text-sm text-muted-foreground">{lang.name}</p>
                </div>
                {isSelected && (
                  <Check className="w-5 h-5 text-primary" />
                )}
              </button>
            );
          })}
        </div>
      </MobilePopup>
      
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
      
      {/* Incomplete Onboarding Modal - Shows when main onboarding flow is incomplete */}
      {profile && profile.role === "worker" && profile.onboardingStatus !== "complete" && (
        <Dialog open={true}>
          <DialogContent hideCloseButton className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-amber-500" />
                Complete Your Onboarding
              </DialogTitle>
              <DialogDescription>
                Please complete your onboarding to continue using the platform. Your progress has been saved.
              </DialogDescription>
            </DialogHeader>
            <div className="py-4">
              <p className="text-sm text-muted-foreground mb-4">
                You need to finish setting up your profile to access all features. Don't worry - we've saved your progress!
              </p>
            </div>
            <DialogFooter>
              <Button 
                onClick={() => setLocation("/worker-onboarding")}
                className="w-full"
              >
                Continue Onboarding
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
