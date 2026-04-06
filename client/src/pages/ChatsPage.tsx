import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation, useRoute } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { useProfile } from "@/hooks/use-profiles";
import { useIsMobile, useIsDesktop, useIsSmallMobile } from "@/hooks/use-mobile";
import { useScrollHeader } from "@/hooks/use-scroll-header";
import { useApproveTimesheet, useRejectTimesheet } from "@/hooks/use-timesheets";
import { apiRequest } from "@/lib/queryClient";
import { cn, normalizeAvatarUrl, stripPhonesAndEmails } from "@/lib/utils";
import { getDisplayJobTitle } from "@/lib/job-display";
import { format, formatDistanceToNow, isSameDay } from "date-fns";
import type { Job, Profile, JobMessage } from "@shared/schema";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";

async function postMessage(
  url: string,
  payload: { content: string; attachmentUrls?: string[]; mentionedProfileIds?: number[]; metadata?: Record<string, unknown> }
) {
  const res = await apiRequest('POST', url, payload);
  return res.json();
}

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { ResponsiveDialog } from "@/components/ui/responsive-dialog";
import { MobilePopup } from "@/components/ui/mobile-popup";
import { Separator } from "@/components/ui/separator";
import { TeammateSettingsDialog } from "@/components/TeammateSettingsDialog";
import { Loader2, ArrowLeft, Send, MessageSquare, Phone, MapPin, User, Users, Briefcase, Search, Clock, Calendar, FileText, PanelRightOpen, Bell, CheckCircle, XCircle, DollarSign, LogIn, LogOut, ExternalLink, Menu, Settings, AlertCircle, X, ChevronLeft, ChevronRight, Video, Mic, MicOff, VideoOff, Settings2, LayoutGrid, MoreVertical, UserX } from "lucide-react";
import { JobDetailsPanel } from "@/components/JobDetailsPanel";
import { MarkCompleteReviewDialog } from "@/components/MarkCompleteReviewDialog";
import { ChatMessageInput } from "@/components/ChatMessageInput";
import { CallingDialog } from "@/components/CallingDialog";
import { Navigation } from "@/components/Navigation";
import { useTimesheetApprovalInvoice } from "@/contexts/TimesheetApprovalInvoiceContext";
import { tryOpenTimesheetApprovalInvoiceFromNotification } from "@/lib/worker-timesheet-notification";
import { AnimatedNavigationTabs } from "@/components/ui/animated-navigation-tabs";
import { useTranslation } from "react-i18next";

/** Format call elapsed seconds as "0m", "53m", or "20h 53m" (readable hours/min). */
function formatCallElapsed(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

/** Format with seconds too: "21h 4m 30s", "4m 30s", "45s". */
function formatCallElapsedWithSeconds(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const parts: string[] = [];
  if (h > 0) parts.push(`${h}h`);
  if (m > 0 || h > 0) parts.push(`${m}m`);
  parts.push(`${s}s`);
  return parts.join(" ");
}

interface ChatJob {
  job: Job;
  participants: Profile[];
  unreadCount: number;
}

interface MessageWithSender extends JobMessage {
  sender?: Profile;
}

function getJobLocationSummary(job: Job): { primary: string; secondary: string | null } {
  const locationName = (job.locationName || "").trim();
  const primaryCandidate = locationName && !/^e2e\b/i.test(locationName)
    ? locationName
    : (job.address || job.location || locationName || "").trim();
  const secondary = [job.city, job.state].filter(Boolean).join(", ").trim() || null;
  return { primary: primaryCandidate || "—", secondary };
}

/** Street + city when possible; else fall back to location summary / job.location. */
function getJobStreetCityLine(job: Job): string {
  const street = (job.address || "").trim();
  const city = (job.city || "").trim();
  if (street && city) return `${street}, ${city}`;
  if (street) return street;
  if (city) return city;
  const { primary, secondary } = getJobLocationSummary(job);
  const combined = [primary, secondary].filter(Boolean).join(", ");
  if (combined && combined !== "—") return combined;
  return (job.location || "").trim() || "—";
}

function participantListInitials(p: Profile): string {
  const first = (p.firstName || "").trim();
  const last = (p.lastName || "").trim();
  const company = (p.companyName || "").trim();
  if (first && last) return `${first[0]!}${last[0]!}`.toUpperCase();
  if (first.length >= 2) return first.slice(0, 2).toUpperCase();
  if (company.length >= 2) return company.slice(0, 2).toUpperCase();
  if (company.length === 1) return `${company[0]!.toUpperCase()}·`;
  if (first.length === 1) return `${first[0]!.toUpperCase()}·`;
  return "?";
}

function jobConversationFallbackInitials(job: Job): string {
  const title = getDisplayJobTitle(job);
  const words = title.split(/\s+/).filter(Boolean);
  if (words.length >= 2 && words[0]![0] && words[1]![0]) {
    return `${words[0]![0]}${words[1]![0]}`.toUpperCase();
  }
  const trade = (job.trade || "GL").replace(/[^a-zA-Z]/g, "");
  if (trade.length >= 2) return trade.slice(0, 2).toUpperCase();
  return "JB";
}

function ChatJobListRow({
  job,
  participants,
  unreadCount,
  isUnread,
  isSelected,
  onSelect,
  noParticipantsLabel,
  density = "compact",
}: {
  job: Job;
  participants: Profile[];
  unreadCount: number;
  isUnread: boolean;
  isSelected: boolean;
  onSelect: () => void;
  noParticipantsLabel: string;
  density?: "comfortable" | "compact";
}) {
  const maxAvatars = density === "comfortable" ? 3 : 2;
  const avatarClass = density === "comfortable" ? "w-10 h-10" : "w-9 h-9";
  const addressLine = getJobStreetCityLine(job);
  const participantNames = participants
    .map((p) => p.firstName || p.companyName)
    .filter(Boolean)
    .join(", ");

  return (
    <button
      type="button"
      className={cn(
        "w-full flex items-start gap-3 p-4 text-left transition-colors",
        "hover:bg-muted/50 dark:hover:bg-muted/25",
        isSelected && "bg-accent",
        !isSelected &&
          isUnread &&
          "bg-background dark:bg-zinc-950 shadow-[inset_3px_0_0_0_hsl(var(--primary))]",
        !isSelected && !isUnread && "bg-muted/45 dark:bg-muted/25"
      )}
      onClick={onSelect}
      data-testid={`chat-job-${job.id}`}
      data-state-unread={isUnread ? "true" : "false"}
    >
      <div className="flex -space-x-2 flex-shrink-0">
        {participants.slice(0, maxAvatars).map((p) => (
          <Avatar key={p.id} className={cn(avatarClass, "border-2 border-background")}>
            <AvatarImage src={normalizeAvatarUrl(p.avatarUrl) || undefined} />
            <AvatarFallback className="text-[10px] font-semibold tracking-tight">
              {participantListInitials(p)}
            </AvatarFallback>
          </Avatar>
        ))}
        {participants.length === 0 && (
          <Avatar className={cn(avatarClass, "border-2 border-background")}>
            <AvatarFallback className="text-[10px] font-semibold tracking-tight">
              {jobConversationFallbackInitials(job)}
            </AvatarFallback>
          </Avatar>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <h3
            className={cn(
              "text-sm truncate",
              isUnread ? "font-semibold text-foreground" : "font-medium text-muted-foreground"
            )}
          >
            {getDisplayJobTitle(job)}
          </h3>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            {isUnread && (
              <span
                className="h-2 w-2 rounded-full bg-primary"
                data-testid={`chat-job-unread-dot-${job.id}`}
              />
            )}
            {unreadCount > 0 && (
              <Badge className="bg-primary text-primary-foreground text-xs min-w-[20px] h-5 flex items-center justify-center px-1">
                {unreadCount}
              </Badge>
            )}
          </div>
        </div>
        <p
          className={cn(
            "text-xs mt-0.5 flex items-start gap-1 min-w-0",
            isUnread ? "text-foreground/80" : "text-muted-foreground"
          )}
        >
          <MapPin className="w-3 h-3 flex-shrink-0 mt-0.5 opacity-70" aria-hidden />
          <span className="truncate">{addressLine}</span>
        </p>
        <p
          className={cn(
            "text-xs mt-0.5 truncate",
            isUnread ? "text-foreground/70" : "text-muted-foreground/85"
          )}
        >
          {participantNames || noParticipantsLabel}
        </p>
      </div>
    </button>
  );
}

// Component for timesheet approval actions in chat (matches timesheets page)
function TimesheetApprovalActions({ timesheetId, onActionComplete }: { timesheetId: number; onActionComplete: () => void }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false);
  const [rejectionReason, setRejectionReason] = useState("");
  
  const { data: timesheet, isLoading } = useQuery<any>({
    queryKey: ['/api/timesheets', timesheetId],
    queryFn: async () => {
      const res = await apiRequest('GET', `/api/timesheets/${timesheetId}`);
      if (!res.ok) throw new Error('Failed to fetch timesheet');
      return res.json();
    },
    enabled: !!timesheetId,
  });

  const approveTimesheet = useApproveTimesheet();
  const rejectTimesheet = useRejectTimesheet();

  const handleApprove = () => {
    approveTimesheet.mutate(
      { id: timesheetId },
      {
        onSuccess: (data) => {
          queryClient.invalidateQueries({ queryKey: ['/api/timesheets', timesheetId] });
          queryClient.invalidateQueries({ queryKey: ['/api/timesheets'] });
          toast({
            title: "Timesheet Approved",
            description: data.escrowInfo 
              ? `Payment for ${data.escrowInfo.workerName} is held in escrow until bank info is added.`
              : "The timesheet has been approved and payment is processing.",
          });
          onActionComplete();
        },
        onError: () => {
          toast({ title: "Error", description: "Failed to approve timesheet.", variant: "destructive" });
        }
      }
    );
  };

  const handleReject = () => {
    if (!rejectionReason.trim()) {
      toast({ title: "Reason Required", description: "Please provide a reason for rejection.", variant: "destructive" });
      return;
    }
    rejectTimesheet.mutate(
      { id: timesheetId, rejectionReason: rejectionReason.trim() },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: ['/api/timesheets', timesheetId] });
          queryClient.invalidateQueries({ queryKey: ['/api/timesheets'] });
          toast({ title: "Timesheet Rejected", description: "The timesheet has been rejected." });
          setRejectDialogOpen(false);
          setRejectionReason("");
          onActionComplete();
        },
        onError: () => {
          toast({ title: "Error", description: "Failed to reject timesheet.", variant: "destructive" });
        }
      }
    );
  };

  if (isLoading) {
    return <Loader2 className="w-4 h-4 animate-spin" data-testid={`loader-timesheet-${timesheetId}`} />;
  }

  if (!timesheet) {
    return (
      <span className="text-xs text-muted-foreground" data-testid={`text-timesheet-not-found-${timesheetId}`}>
        {t("timesheetNotFound")}
      </span>
    );
  }

  // Already approved or rejected
  if (timesheet.status === 'approved') {
    return (
      <Badge variant="default" className="text-xs">
        <CheckCircle className="w-3 h-3 mr-1" />
        Approved
      </Badge>
    );
  }

  if (timesheet.status === 'rejected') {
    return (
      <Badge variant="destructive" className="text-xs">
        <XCircle className="w-3 h-3 mr-1" />
        Rejected
      </Badge>
    );
  }

  // Pending - show approval buttons
  return (
    <>
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant="default"
          onClick={handleApprove}
          disabled={approveTimesheet.isPending || rejectTimesheet.isPending}
          data-testid={`button-approve-timesheet-${timesheetId}`}
        >
          {approveTimesheet.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle className="w-3 h-3 mr-1" />}
          Approve
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => setRejectDialogOpen(true)}
          disabled={approveTimesheet.isPending || rejectTimesheet.isPending}
          data-testid={`button-reject-timesheet-${timesheetId}`}
        >
          <XCircle className="w-3 h-3 mr-1" />
          Reject
        </Button>
      </div>
      
      <ResponsiveDialog
        open={rejectDialogOpen}
        onOpenChange={setRejectDialogOpen}
        title={t("timesheet.reject")}
        contentClassName="max-w-sm"
        footer={
          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={() => setRejectDialogOpen(false)}>
              {tCommon("cancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={handleReject}
              disabled={rejectTimesheet.isPending || !rejectionReason.trim()}
              data-testid="button-confirm-reject"
            >
              {rejectTimesheet.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              {t("timesheet.reject")}
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
            <div className="space-y-2">
              <Label>{t("timesheet.reasonForRejection")}</Label>
              <Textarea
                placeholder={t("timesheet.rejectionReasonPlaceholder")}
                value={rejectionReason}
                onChange={(e) => setRejectionReason(e.target.value)}
                data-testid="input-rejection-reason"
              />
            </div>
          </div>
      </ResponsiveDialog>
    </>
  );
}

export interface ChatsPageProps {
  /** When true, page is embedded in dashboard; no own header/footer, use dashboard header */
  embedInDashboard?: boolean;
}

export default function ChatsPage({ embedInDashboard }: ChatsPageProps = {}) {
  const [location, setLocation] = useLocation();
  const { user, isLoading: authLoading, logout, isLoggingOut } = useAuth();
  const { data: profile, isLoading: profileLoading } = useProfile(user?.id);
  const isMobile = useIsMobile();
  const isDesktop = useIsDesktop();
  const isSmallMobile = useIsSmallMobile();
  const isScrolled = useScrollHeader();
  const queryClient = useQueryClient();
  const { t } = useTranslation("chat");
  const { t: tNav } = useTranslation("translation");
  const { t: tCompany } = useTranslation(); // default namespace for company footer (matches CompanyDashboard)
  const { t: tCommon } = useTranslation("common");
  const { t: tToday } = useTranslation("today");
  const { t: tNotifications } = useTranslation("notifications");
  const { t: tEmpty } = useTranslation("empty");
  const { toast } = useToast();
  const { openTimesheetApprovalInvoice } = useTimesheetApprovalInvoice();
  
  // Get display avatar - use impersonated team member's avatar when impersonating
  const displayAvatarUrl = useMemo(() => {
    const raw = user?.impersonation?.isEmployee && user?.impersonation?.teamMember?.avatarUrl
      ? user.impersonation.teamMember.avatarUrl
      : profile?.avatarUrl;
    return normalizeAvatarUrl(raw);
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
  
  // Check if user is an employee (part of another business operator's team)
  const isEmployee = Boolean(profile?.teamId) || Boolean(user?.impersonation?.isEmployee);
  
  // Check for job ID in URL (supports /dashboard/chats/:jobId, /company-dashboard/chats/:jobId, /chats/:jobId)
  const [, paramsWorker] = useRoute("/dashboard/chats/:jobId?");
  const [, paramsCompany] = useRoute("/company-dashboard/chats/:jobId?");
  const [, paramsChats] = useRoute("/chats/:jobId?");
  const urlJobId = paramsWorker?.jobId || paramsCompany?.jobId || paramsChats?.jobId;
  
  const chatsBasePath = (location || "").startsWith("/company-dashboard/chats")
    ? "/company-dashboard/chats"
    : (location || "").startsWith("/dashboard/chats")
      ? "/dashboard/chats"
      : "/chats";
  
  const [viewedJobIds, setViewedJobIds] = useState<Set<number>>(new Set());
  const [selectedJobId, setSelectedJobIdState] = useState<number | null>(urlJobId ? parseInt(urlJobId) : null);
  const setSelectedJobId = (id: number | null) => {
    if (id !== null) {
      setViewedJobIds((prev) => {
        if (prev.has(id)) return prev;
        const next = new Set(prev);
        next.add(id);
        return next;
      });
    }
    setSelectedJobIdState(id);
    setLocation(id ? `${chatsBasePath}/${id}` : chatsBasePath);
  };
  const [participantPopupOpen, setParticipantPopupOpen] = useState(false);
  const [selectedParticipant, setSelectedParticipant] = useState<Profile | null>(null);
  const [showJobDetails, setShowJobDetails] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [showTeammateSettings, setShowTeammateSettings] = useState(false);
  const [mapPopupOpen, setMapPopupOpen] = useState(false);
  const [mapLocation, setMapLocation] = useState<{ 
    clockIn: { lat: number; lng: number }; 
    clockOut: { lat: number; lng: number }; 
    workerName: string; 
    clockInTime: string;
    clockOutTime: string;
    totalHours: number;
  } | null>(null);
  const [imagePreview, setImagePreview] = useState<{ urls: string[]; index: number } | null>(null);
  const [markCompleteJobId, setMarkCompleteJobId] = useState<number | null>(null);
  const [markCompleteJobTitle, setMarkCompleteJobTitle] = useState("");
  const [callInviteOpen, setCallInviteOpen] = useState(false);
  const [callInviteRoomUrl, setCallInviteRoomUrl] = useState<string | null>(null);
  const [callingDialogOpen, setCallingDialogOpen] = useState(false);
  const [callingRoomUrl, setCallingRoomUrl] = useState<string | null>(null);
  const [callStarterProfileId, setCallStarterProfileId] = useState<number | null>(null);
  const [locallyEndedRoomUrls, setLocallyEndedRoomUrls] = useState<Set<string>>(new Set());
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const activeCallContextRef = useRef<{ jobId: number; roomUrl: string } | null>(null);

  const { data: chatJobs, isLoading: jobsLoading } = useQuery<ChatJob[]>({
    queryKey: ['/api/chats/jobs'],
    enabled: !!user && !!profile,
  });

  // Notifications for worker dashboard header
  const { data: allNotifications } = useQuery<any[]>({
    queryKey: ['/api/notifications', profile?.id],
    enabled: !!profile && profile.role === 'worker',
  });

  // Filter notifications for team members - only show notifications for this specific team member
  // The API already filters by profileId, but we ensure it's correct for team members
  const notifications = useMemo(() => {
    if (!allNotifications) return [];
    // For employees, ensure notifications belong to their profile
    // The server already filters by profileId, so this is mainly a safety check
    if (isEmployee) {
      return allNotifications.filter((notif: any) => notif.profileId === profile?.id);
    }
    return allNotifications;
  }, [allNotifications, isEmployee, profile?.id]);
  
  // Filter chat jobs for employees - they only see jobs they're assigned to
  // Admins (business operators without teamId) see all jobs
  // Jobs with today's date or past dates always show (unless complete/done)
  const filteredChatJobs = useMemo(() => {
    if (!chatJobs) return [];
    
    // If not an employee, show all jobs (but still filter out completed jobs for past dates)
    if (!isEmployee) return chatJobs;
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    // For employees, filter to only jobs where they are a participant
    // But always show jobs from today or past dates (unless cancelled)
    return chatJobs.filter(({ job, participants }) => {
      // Check if job is cancelled - hide these
      if (job.status === 'cancelled') {
        return false;
      }
      
      // Check if job date is today or in the past
      const jobDate = new Date(job.startDate);
      jobDate.setHours(0, 0, 0, 0);
      const isTodayOrPast = jobDate <= today;
      
      // For today/past jobs, always show if employee is a participant
      // For future jobs, still require participant check
      const isParticipant = participants.some(p => p.id === profile?.id);
      
      if (isTodayOrPast) {
        return isParticipant;
      }
      
      return isParticipant;
    });
  }, [chatJobs, isEmployee, profile?.id]);

  const [chatSearch, setChatSearch] = useState("");
  const searchedChatJobs = useMemo(() => {
    const q = chatSearch.trim().toLowerCase();
    if (!q) return filteredChatJobs;
    return filteredChatJobs.filter(({ job, participants }) => {
      if (job.title?.toLowerCase().includes(q)) return true;
      if (job.locationName?.toLowerCase().includes(q)) return true;
      if (job.city?.toLowerCase().includes(q)) return true;
      if ((job as any).companyName?.toLowerCase().includes(q)) return true;
      if (participants.some(p =>
        `${p.firstName ?? ""} ${p.lastName ?? ""}`.toLowerCase().includes(q) ||
        p.companyName?.toLowerCase().includes(q)
      )) return true;
      return false;
    });
  }, [filteredChatJobs, chatSearch]);
  
  // Sync selectedJobId from URL (handles direct navigation, browser back, deep links)
  useEffect(() => {
    if (!urlJobId) {
      setSelectedJobIdState(null);
      return;
    }
    const jobIdNum = parseInt(urlJobId);
    if (filteredChatJobs?.some(cj => cj.job.id === jobIdNum)) {
      setSelectedJobIdState(jobIdNum);
    }
  }, [urlJobId, filteredChatJobs]);

  // Fetch full job by ID when a conversation is selected so Job Details panel shows real job data (same as JobContent)
  const { data: selectedJobDetails } = useQuery<Job & { company?: Profile; locationRepresentativeName?: string }>({
    queryKey: ['/api/jobs', selectedJobId],
    enabled: !!selectedJobId,
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/jobs/${selectedJobId}`);
      if (!res.ok) throw new Error("Failed to fetch job");
      return res.json();
    },
  });

  const { data: messages, isLoading: messagesLoading, refetch: refetchMessages } = useQuery<MessageWithSender[]>({
    queryKey: ['/api/jobs', selectedJobId, 'messages'],
    enabled: !!selectedJobId,
    refetchInterval: (query) => {
      const msgs = query.state.data;
      if (!msgs?.length) return false;
      const hasActiveVideoCall = msgs.some((m) => {
        const meta = m.metadata as { type?: string; roomUrl?: string; callStatus?: string } | undefined;
        if (meta?.type === "video_call" && meta?.roomUrl && meta?.callStatus !== "ended") return true;
        if (typeof m.content === "string" && /Join the video call:\s*.+/.test(m.content)) {
          return (meta?.callStatus !== "ended");
        }
        return false;
      });
      return hasActiveVideoCall ? 2000 : false;
    },
  });

  // Flat list of all chat attachment URLs for gallery navigation
  const allChatMediaUrls = useMemo(() => {
    if (!messages) return [];
    const urls: string[] = [];
    for (const msg of messages) {
      const attachments = (msg.metadata as { attachments?: string[] })?.attachments;
      if (Array.isArray(attachments)) {
        for (const url of attachments) {
          urls.push(url.startsWith("http") || url.startsWith("/") ? url : `/objects/chats/${url}`);
        }
      }
    }
    return urls;
  }, [messages]);

  const sendMessageMutation = useMutation({
    mutationFn: async (payload: { content: string; attachmentUrls?: string[]; mentionedProfileIds?: number[]; metadata?: Record<string, unknown> }) => {
      return postMessage(`/api/jobs/${selectedJobId}/messages`, payload);
    },
    onMutate: async (payload: { content: string; attachmentUrls?: string[]; metadata?: Record<string, unknown> }) => {
      if (!selectedJobId || !profile) return {};
      await queryClient.cancelQueries({ queryKey: ['/api/jobs', selectedJobId, 'messages'] });
      const previous = queryClient.getQueryData<MessageWithSender[]>(['/api/jobs', selectedJobId, 'messages']);
      const meta: Record<string, unknown> = payload.attachmentUrls?.length ? { attachments: payload.attachmentUrls } : {};
      if (payload.metadata) Object.assign(meta, payload.metadata);
      const optimisticMessage: MessageWithSender = {
        id: -Date.now(),
        jobId: selectedJobId,
        senderId: profile.id,
        content: payload.content,
        messageType: 'text',
        timesheetId: null,
        metadata: Object.keys(meta).length > 0 ? meta : null,
        visibleToCompanyOnly: false,
        isRead: false,
        readAt: null,
        createdAt: new Date().toISOString(),
        sender: profile as Profile,
      };
      queryClient.setQueryData<MessageWithSender[]>(
        ['/api/jobs', selectedJobId, 'messages'],
        (old) => [...(old || []), optimisticMessage]
      );
      return { previous };
    },
    onError: (err, _content, context) => {
      if (context?.previous != null) {
        queryClient.setQueryData(['/api/jobs', selectedJobId, 'messages'], context.previous);
      }
      toast({
        title: "Failed to send message",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/jobs', selectedJobId, 'messages'] });
      queryClient.invalidateQueries({ queryKey: ['/api/chats/jobs'] });
    },
  });

  const respondStartNowRequestMutation = useMutation({
    mutationFn: async ({ jobId, messageId, action }: { jobId: number; messageId: number; action: "accept" | "decline" }) => {
      const res = await apiRequest("POST", `/api/jobs/${jobId}/start-now-request/${messageId}/respond`, { action });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { message?: string }).message || "Failed to respond");
      }
      return res.json();
    },
    onSuccess: (_data, { jobId }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/jobs", jobId, "messages"] });
      queryClient.invalidateQueries({ queryKey: ["/api/chats/jobs"] });
      refetchMessages();
    },
    onError: (err) => {
      toast({ title: "Error", description: err instanceof Error ? err.message : "Could not update.", variant: "destructive" });
    },
  });

  useEffect(() => {
    if (selectedJobId) {
      const interval = setInterval(() => {
        refetchMessages();
      }, 5000);
      return () => clearInterval(interval);
    }
  }, [selectedJobId, refetchMessages]);

  useEffect(() => {
    if (!imagePreview) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setImagePreview(null);
      } else if (e.key === "ArrowLeft") {
        setImagePreview((p) => p && p.index > 0 ? { ...p, index: p.index - 1 } : p);
      } else if (e.key === "ArrowRight") {
        setImagePreview((p) => p && p.index < p.urls.length - 1 ? { ...p, index: p.index + 1 } : p);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [imagePreview]);

  if (authLoading || !profile) {
    return (
      <div className="h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin" />
      </div>
    );
  }

  const selectedJob = filteredChatJobs?.find(cj => cj.job.id === selectedJobId);
  const showMobileFooter = !selectedJobId;
  // Use full job from API when available so Job Details panel matches job application/JobContent data
  const jobForDetailsPanel: Job | null =
    selectedJobId && selectedJobDetails && selectedJobDetails.id === selectedJobId
      ? (selectedJobDetails as Job)
      : selectedJob?.job ?? null;

  const handleSendMessage = (payload: { content: string; attachmentUrls?: string[]; mentionedProfileIds?: number[] }) => {
    if (sendMessageMutation.isPending) return;
    let content = payload.content.trim();
    content = stripPhonesAndEmails(content);
    if (!content && !payload.attachmentUrls?.length) return;
    sendMessageMutation.mutate({
      content: content || " ",
      attachmentUrls: payload.attachmentUrls,
      mentionedProfileIds: payload.mentionedProfileIds,
    });
  };

  const PEERCALLS_BASE_URL = (() => {
    const url = import.meta.env?.VITE_PEERCALLS_URL;
    if (url && String(url).trim()) return String(url).replace(/\/$/, "");
    if (import.meta.env?.DEV) return "http://localhost:3000";
    return "";
  })();

  const callInviteMutation = useMutation({
    mutationFn: async ({ jobId, roomUrl, targetProfileIds }: { jobId: number; roomUrl: string; targetProfileIds?: number[] }) => {
      const payload = targetProfileIds?.length ? { roomUrl, targetProfileIds } : { roomUrl };
      const res = await apiRequest("POST", `/api/jobs/${jobId}/call-invite`, payload);
      const responseText = await res.text().catch(() => res.statusText);
      if (res.status === 409) {
        return { alreadyInProgress: true, roomUrl };
      }
      if (!res.ok) {
        let message = responseText;
        try {
          const j = JSON.parse(responseText) as { message?: string };
          if (j?.message) message = j.message;
        } catch {}
        throw new Error(message);
      }
      return responseText ? JSON.parse(responseText) : {};
    },
    onSuccess: (data, { roomUrl }) => {
      setCallInviteOpen(false);
      setCallInviteRoomUrl(null);
      setCallingRoomUrl(roomUrl);
      setCallStarterProfileId(profile?.id ?? null);
      if (selectedJobId) activeCallContextRef.current = { jobId: selectedJobId, roomUrl };
      setCallingDialogOpen(true);
      if ((data as { alreadyInProgress?: boolean })?.alreadyInProgress) {
        toast({ title: "Call in progress", description: "Joining the existing call." });
        return;
      }
      sendMessageMutation.mutate({
        content: `Join the video call: ${roomUrl}`,
        attachmentUrls: undefined,
        mentionedProfileIds: undefined,
        metadata: { type: "video_call", roomUrl },
      });
    },
    onError: (err) => {
      toast({
        title: "Invite failed",
        description: err instanceof Error ? err.message : "Could not send email and push invites.",
        variant: "destructive",
      });
    },
  });

  const handleStartCallForParticipant = useCallback((targetProfileId: number) => {
    if (!selectedJobId || !PEERCALLS_BASE_URL) return;
    setShowJobDetails(false);
    const roomSlug = `job-${selectedJobId}`;
    const roomUrl = `${PEERCALLS_BASE_URL}/${roomSlug}`;
    callInviteMutation.mutate({ jobId: selectedJobId, roomUrl, targetProfileIds: [targetProfileId] });
  }, [selectedJobId]);

  const handleAvatarClick = (participant: Profile) => {
    setSelectedParticipant(participant);
    setParticipantPopupOpen(true);
  };

  const handleBackToJobs = () => {
    setSelectedJobId(null);
  };

  const goBack = () => {
    if (profile?.role === 'company') {
      setLocation('/company-dashboard');
    } else {
      setLocation('/dashboard');
    }
  };

  const JobsList = () => (
    <div className="flex flex-col h-full">
      {!embedInDashboard && (
        <header className={`flex items-center justify-between transition-all duration-300 ease-in-out border-b border-border ${
          isMobile
            ? `sticky top-0 z-40 px-4 sm:px-0 py-3 mb-4 bg-background/95 backdrop-blur-md shadow-sm ${isScrolled ? 'py-2' : 'py-3'}`
            : 'pb-6 mb-6'
        }`}>
          <div className="min-w-0 flex-1">
            <h1 className={`font-bold transition-all duration-300 ${isMobile ? (isScrolled ? 'text-base' : 'text-lg') : 'text-2xl'}`}>{tNav("nav.messages")}</h1>
          </div>
        {/* Avatar and Notifications for workers */}
        {profile?.role === 'worker' && (
          <div className="flex items-center gap-2 flex-shrink-0">
            {/* Notifications - Full page on mobile, Popover on desktop */}
            {isMobile ? (
              <Button 
                variant="ghost" 
                size="icon" 
                className="relative"
                onClick={() => setNotificationsOpen(true)}
                data-testid="chats-notifications-button"
              >
                <Bell className="w-5 h-5" />
                {notifications && notifications.filter((n: any) => !n.isRead).length > 0 && (
                  <span 
                    className="absolute -top-1 -right-1 w-5 h-5 bg-destructive text-destructive-foreground text-xs rounded-full flex items-center justify-center"
                    data-testid="chats-notifications-unread-count"
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
                    className="relative"
                    data-testid="chats-notifications-button"
                  >
                    <Bell className="w-5 h-5" />
                    {notifications && notifications.filter((n: any) => !n.isRead).length > 0 && (
                      <span 
                        className="absolute -top-1 -right-1 w-5 h-5 bg-destructive text-destructive-foreground text-xs rounded-full flex items-center justify-center"
                        data-testid="chats-notifications-unread-count"
                      >
                        {notifications.filter((n: any) => !n.isRead).length > 9 ? "9+" : notifications.filter((n: any) => !n.isRead).length}
                      </span>
                    )}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-80 p-0" align="end">
                  <div className="p-3 border-b border-border flex items-center justify-between">
                    <h3 className="font-semibold">{tNotifications("title")}</h3>
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
                        data-testid="chats-mark-all-read-button"
                      >
                        {tNotifications("markAllRead")}
                      </Button>
                    )}
                  </div>
                  <ScrollArea className="max-h-[400px]" data-testid="chats-notifications-list">
                    {!notifications || notifications.length === 0 ? (
                      <div className="p-4 text-center text-muted-foreground" data-testid="chats-notifications-empty">
                        <Bell className="w-8 h-8 mx-auto mb-2 opacity-50" />
                        <p className="text-sm">{tEmpty("noNotifications")}</p>
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
                              if (notif.type === "new_message") {
                                // Already on chats page
                              } else {
                                setLocation("/dashboard/today");
                              }
                            }}
                            data-testid={`chats-notification-item-${notif.id}`}
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
                </PopoverContent>
              </Popover>
            )}
            <Avatar 
              className="w-9 h-9 cursor-pointer hover:ring-2 hover:ring-primary/50 transition-all"
              onClick={() => setLocation("/dashboard/menu")}
              data-testid="chats-header-avatar"
            >
              <AvatarImage src={displayAvatarUrl || undefined} />
              <AvatarFallback>{displayName.firstName?.[0]}{displayName.lastName?.[0]}</AvatarFallback>
            </Avatar>
          </div>
        )}
      </header>
      )}
      
      {filteredChatJobs.length > 4 && (
        <div className="px-3 py-2 border-b border-border bg-background">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
            <input
              type="search"
              value={chatSearch}
              onChange={(e) => setChatSearch(e.target.value)}
              placeholder="Search conversations…"
              className="w-full h-8 pl-7 pr-3 text-sm rounded-lg border border-input bg-muted/40 placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
        </div>
      )}
      <div className="flex-1 overflow-y-auto">
        {jobsLoading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin" />
          </div>
        ) : !filteredChatJobs || filteredChatJobs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
            <MessageSquare className="w-12 h-12 text-muted-foreground mb-4" />
            <h3 className="font-semibold mb-2">{t("noActiveChats")}</h3>
            <p className="text-sm text-muted-foreground">
              {profile?.role === 'company' 
                ? t("chatsAppearInProgress")
                : t("chatsAppearAccepted")}
            </p>
          </div>
        ) : searchedChatJobs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
            <Search className="w-10 h-10 text-muted-foreground mb-3" />
            <p className="text-sm text-muted-foreground">No conversations match &ldquo;{chatSearch}&rdquo;</p>
            <button type="button" onClick={() => setChatSearch("")} className="mt-2 text-xs text-primary underline">Clear search</button>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {searchedChatJobs.map(({ job, participants, unreadCount }) => {
              const isSelected = selectedJobId === job.id;
              const isUnread = unreadCount > 0 && !viewedJobIds.has(job.id);
              return (
                <ChatJobListRow
                  key={job.id}
                  job={job}
                  participants={participants}
                  unreadCount={unreadCount}
                  isUnread={isUnread}
                  isSelected={isSelected}
                  onSelect={() => setSelectedJobId(job.id)}
                  noParticipantsLabel={t("noParticipants")}
                  density="comfortable"
                />
              );
            })}
          </div>
        )}
      </div>
    </div>
  );

  const MobileNotificationsPopup = () => {
    if (!isMobile || profile?.role !== "worker") return null;

    return (
      <MobilePopup
        open={notificationsOpen}
        onOpenChange={setNotificationsOpen}
        title={tNotifications("title")}
        headerContent={
          notifications && notifications.filter((n: any) => !n.isRead).length > 0 ? (
            <Button
              variant="ghost"
              size="sm"
              className="text-xs"
              onClick={async () => {
                try {
                  await apiRequest("PATCH", "/api/notifications/read-all", { profileId: profile?.id });
                  queryClient.invalidateQueries({ queryKey: ["/api/notifications", profile?.id] });
                } catch (err) {
                  console.error("Failed to mark all as read:", err);
                }
              }}
              data-testid="chats-mobile-mark-all-read-button"
            >
              {tNotifications("markAllRead")}
            </Button>
          ) : undefined
        }
      >
        {!notifications || notifications.length === 0 ? (
          <div className="py-12 text-center text-muted-foreground" data-testid="chats-mobile-notifications-empty">
            <Bell className="w-12 h-12 mx-auto mb-3 opacity-50" />
            <p className="text-base">{tEmpty("noNotifications")}</p>
            <p className="text-sm mt-1">{tNotifications("youllSeeUpdates")}</p>
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
                      queryClient.invalidateQueries({ queryKey: ["/api/notifications", profile?.id] });
                    } catch (err) {
                      console.error("Failed to mark as read:", err);
                    }
                  }
                  setNotificationsOpen(false);
                  if (notif.type === "new_message") {
                    // Already on chats page
                  } else {
                    setLocation("/dashboard/today");
                  }
                }}
                data-testid={`chats-mobile-notification-item-${notif.id}`}
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
    );
  };

  const ChatSection = () => {
    const chatScrollRef = useRef<HTMLDivElement>(null);
    const chatBodyScrollRef = useRef<HTMLDivElement>(null);
    const lastScrolledForJobIdRef = useRef<number | null>(null);
    const [chatHeaderScrolled, setChatHeaderScrolled] = useState(false);
    const handleChatScroll = () => {
      const mobileTop = chatScrollRef.current?.scrollTop ?? 0;
      const desktopTop = chatBodyScrollRef.current?.scrollTop ?? 0;
      setChatHeaderScrolled(mobileTop > 16 || desktopTop > 16);
    };

    // Reset header to full height when switching chats (mobile shrink state)
    useEffect(() => {
      setChatHeaderScrolled(false);
    }, [selectedJobId]);

    // Start at bottom only on entrance (desktop only). On mobile: no auto-scroll.
    useEffect(() => {
      if (isMobile) return;
      if (!selectedJobId || !messages?.length) return;
      if (lastScrolledForJobIdRef.current === selectedJobId) return;
      lastScrolledForJobIdRef.current = selectedJobId;
      const scrollToBottom = () => {
        if (chatBodyScrollRef.current) {
          chatBodyScrollRef.current.scrollTop = chatBodyScrollRef.current.scrollHeight;
        }
        if (chatScrollRef.current) {
          chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
        }
        messagesEndRef.current?.scrollIntoView({ behavior: "auto" });
      };
      const id = requestAnimationFrame(() => {
        requestAnimationFrame(scrollToBottom);
      });
      return () => cancelAnimationFrame(id);
    }, [isMobile, selectedJobId, messages?.length]);
    const job = selectedJob?.job;
    const participantsLabel = selectedJob?.participants.map(p => p.firstName || p.companyName).filter(Boolean).join(", ") || t("noParticipants");
    const startDate = job?.startDate ? new Date(job.startDate) : null;
    const endDate = job?.endDate ? new Date(job.endDate) : null;
    const dateRangeLabel = startDate
      ? (endDate && !isSameDay(startDate, endDate)
          ? `${format(startDate, "MMM d")}–${format(endDate, "d, yyyy")}`
          : format(startDate, "MMM d, yyyy"))
      : null;
    const dateAndJobLine = [dateRangeLabel, job?.title].filter(Boolean).join(" • ") || job?.title || "—";

    // Only the most recent video call message can show a join button (one joinable at a time)
    const latestJoinableVideoCallMsgId = useMemo(() => {
      if (!messages?.length) return null;
      const videoCallMsgs = messages.filter((m) => {
        const meta = m.metadata as { type?: string; roomUrl?: string; callStatus?: string } | undefined;
        const isByMeta = meta?.type === "video_call" && meta?.roomUrl;
        const match = !isByMeta && typeof m.content === "string" && m.content.trim().match(/^Join the video call:\s*(.+)$/);
        return isByMeta || !!match;
      });
      if (videoCallMsgs.length === 0) return null;
      const sorted = [...videoCallMsgs].sort(
        (a, b) => new Date(b.createdAt!).getTime() - new Date(a.createdAt!).getTime()
      );
      const latest = sorted[0];
      const latestMeta = latest?.metadata as { callStatus?: string } | undefined;
      return latestMeta?.callStatus === "ended" ? null : (latest?.id ?? null);
    }, [messages]);

    // Elapsed time for active (joinable) call when we're not in it — for "In call" display
    const activeCallMsg = useMemo(() => messages?.find((m) => m.id === latestJoinableVideoCallMsgId) ?? null, [messages, latestJoinableVideoCallMsgId]);
    const [activeCallElapsedSeconds, setActiveCallElapsedSeconds] = useState(0);
    useEffect(() => {
      if (!activeCallMsg || callingDialogOpen) {
        setActiveCallElapsedSeconds(0);
        return;
      }
      const startMs = new Date(activeCallMsg.createdAt!).getTime();
      const tick = () => setActiveCallElapsedSeconds(Math.max(0, Math.floor((Date.now() - startMs) / 1000)));
      tick();
      const interval = setInterval(tick, 1000);
      return () => clearInterval(interval);
    }, [activeCallMsg?.id, activeCallMsg?.createdAt, callingDialogOpen]);
    const activeCallElapsedFormatted = useMemo(
      () => formatCallElapsedWithSeconds(activeCallElapsedSeconds),
      [activeCallElapsedSeconds]
    );

    const chatHeader = (
      <div className={cn("grid gap-3 items-stretch w-full", isMobile ? "grid-cols-[auto_1fr_auto]" : "grid-cols-[1fr_auto]")}>
        {/* Col 1: Back button (mobile only) — merged 3 rows */}
        {isMobile && (
          <div className="flex items-center shrink-0">
            <Button variant="ghost" size="icon" onClick={handleBackToJobs} data-testid="button-back-jobs">
              <ArrowLeft className="w-5 h-5" />
            </Button>
          </div>
        )}
        {/* Col 2: Row 1 = avatars, Row 2 = participant names (title), Row 3 = date • job/location — center aligned */}
        <div className="min-w-0 flex flex-col justify-center items-center gap-0.5 py-0.5 text-center">
          <div className="flex items-center justify-center -space-x-2">
            {selectedJob?.participants.slice(0, 3).map((p) => (
              <Avatar
                key={p.id}
                className={cn("border-2 border-background cursor-pointer hover:ring-2 hover:ring-primary/50 transition-all", chatHeaderScrolled ? "w-7 h-7" : "w-8 h-8")}
                onClick={() => handleAvatarClick(p)}
                data-testid={`avatar-participant-${p.id}`}
              >
                <AvatarImage src={normalizeAvatarUrl(p.avatarUrl) || undefined} />
                <AvatarFallback>{p.firstName?.[0]}{p.lastName?.[0]}</AvatarFallback>
              </Avatar>
            ))}
          </div>
          <h2 className={cn("flex font-semibold truncate w-full justify-center", chatHeaderScrolled && "text-sm transition-[font-size] duration-200")}>
            {participantsLabel}
          </h2>
          <p className={cn("text-muted-foreground truncate text-xs w-full text-center", chatHeaderScrolled && "!text-[11px] transition-[font-size] duration-200")}>
            {dateAndJobLine}
          </p>
        </div>
        {/* Col 3: Details button */}
        <div className="flex items-center shrink-0">
          <Button
            variant={showJobDetails ? "secondary" : "ghost"}
            size="sm"
            className="rounded-full"
            onClick={() => setShowJobDetails(!showJobDetails)}
            data-testid="button-toggle-job-details"
            title="Details"
          >
            Details
          </Button>
        </div>
      </div>
    );
    const chatBodyContent = (
        messagesLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="w-6 h-6 animate-spin" />
          </div>
        ) : !messages || messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <MessageSquare className="w-10 h-10 text-muted-foreground mb-3" />
            <p className="text-sm text-muted-foreground">{t("noMessagesYet")}</p>
          </div>
        ) : (
          <>
            {messages.map((msg) => {
              const isMe = msg.senderId === profile?.id;
              const isSystemMessage = msg.messageType === 'clock_in' || msg.messageType === 'clock_out';
              const metadata = msg.metadata as any;
              
              // Render system messages (clock in/out) styled like worker messages
              if (isSystemMessage) {
                const isClockIn = msg.messageType === 'clock_in';
                const workerName = `${msg.sender?.firstName || ''} ${msg.sender?.lastName || ''}`.trim();
                
                // Only show map button for clock-out with both locations
                const hasBothLocations = !isClockIn && 
                  metadata?.latitude && metadata?.longitude && 
                  metadata?.clockInLatitude && metadata?.clockInLongitude;
                
                return (
                  <div
                    key={msg.id}
                    className="flex items-end gap-2 justify-start"
                    data-testid={`system-message-${msg.id}`}
                  >
                    <Avatar 
                      className="w-7 h-7 cursor-pointer hover:ring-2 hover:ring-primary/50 transition-all"
                      onClick={() => msg.sender && handleAvatarClick(msg.sender)}
                    >
                      <AvatarImage src={normalizeAvatarUrl(msg.sender?.avatarUrl) || undefined} />
                      <AvatarFallback className="text-xs">
                        {msg.sender?.firstName?.[0]}{msg.sender?.lastName?.[0]}
                      </AvatarFallback>
                    </Avatar>
                    <div className="max-w-[75%] rounded-2xl px-4 py-2 bg-secondary rounded-bl-sm">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <Badge variant={isClockIn ? "default" : "secondary"}>
                          {isClockIn ? (
                            <><LogIn className="w-3 h-3 mr-1" /> {t("worker.clockIn")}</>
                          ) : (
                            <><LogOut className="w-3 h-3 mr-1" /> {t("worker.clockOut")}</>
                          )}
                        </Badge>
                          {metadata?.isAutomatic && (
                            <Badge variant="outline">{tCommon("auto")}</Badge>
                          )}
                      </div>
                      {!isClockIn && metadata?.totalHours && (
                        <p className="text-sm font-medium">
                          {t("timesheet.hoursWorked", { hours: parseFloat(metadata.totalHours).toFixed(1) })}
                        </p>
                      )}
                      {/* Location thumbnails and approval for clock-out messages */}
                      {!isClockIn && hasBothLocations && (
                        <div className="mt-2 space-y-2">
                          <div 
                            className="grid grid-cols-2 gap-2 cursor-pointer"
                            onClick={() => {
                              setMapLocation({
                                clockIn: { lat: parseFloat(metadata.clockInLatitude), lng: parseFloat(metadata.clockInLongitude) },
                                clockOut: { lat: parseFloat(metadata.latitude), lng: parseFloat(metadata.longitude) },
                                workerName,
                                clockInTime: t("worker.clockIn"),
                                clockOutTime: format(new Date(msg.createdAt!), "MMM d, h:mm a"),
                                totalHours: parseFloat(metadata.totalHours) || 0
                              });
                              setMapPopupOpen(true);
                            }}
                            data-testid={`button-map-${msg.id}`}
                          >
                            <div className="rounded-lg overflow-hidden border border-green-200 dark:border-green-800">
                              <div className="bg-green-50 dark:bg-green-900/30 px-2 py-0.5 flex items-center gap-1">
                                <LogIn className="w-3 h-3 text-green-600 dark:text-green-400" />
                                <span className="text-[10px] font-medium text-green-700 dark:text-green-300">{t("timesheet.clockIn")}</span>
                              </div>
                              <img 
                                src={`https://maps.googleapis.com/maps/api/staticmap?center=${metadata.clockInLatitude},${metadata.clockInLongitude}&zoom=15&size=120x80&markers=color:green%7C${metadata.clockInLatitude},${metadata.clockInLongitude}&key=${import.meta.env.VITE_GOOGLE_API_KEY}`}
                                alt="Clock in location"
                                className="w-full h-12 object-cover"
                              />
                            </div>
                            <div className="rounded-lg overflow-hidden border border-orange-200 dark:border-orange-800">
                              <div className="bg-orange-50 dark:bg-orange-900/30 px-2 py-0.5 flex items-center gap-1">
                                <LogOut className="w-3 h-3 text-orange-600 dark:text-orange-400" />
                                <span className="text-[10px] font-medium text-orange-700 dark:text-orange-300">{t("timesheet.clockOut")}</span>
                              </div>
                              <img 
                                src={`https://maps.googleapis.com/maps/api/staticmap?center=${metadata.latitude},${metadata.longitude}&zoom=15&size=120x80&markers=color:orange%7C${metadata.latitude},${metadata.longitude}&key=${import.meta.env.VITE_GOOGLE_API_KEY}`}
                                alt="Clock out location"
                                className="w-full h-12 object-cover"
                              />
                            </div>
                          </div>
                          {profile?.role === 'company' && metadata?.timesheetId && (
                            <TimesheetApprovalActions
                              timesheetId={metadata.timesheetId}
                              onActionComplete={() => refetchMessages()}
                            />
                          )}
                        </div>
                      )}
                      {/* Approval for clock-out messages without location data */}
                      {!isClockIn && !hasBothLocations && profile?.role === 'company' && metadata?.timesheetId && (
                        <div className="mt-2 pt-2 border-t border-border">
                          <TimesheetApprovalActions
                            timesheetId={metadata.timesheetId}
                            onActionComplete={() => refetchMessages()}
                          />
                        </div>
                      )}
                      <p className="text-[10px] mt-1 text-muted-foreground">
                        {format(new Date(msg.createdAt!), "h:mm a")}
                      </p>
                    </div>
                  </div>
                );
              }

              // "Start job now" request from worker: show content + Accept/Decline for company when pending
              const startNowMeta = metadata?.type === "start_job_now_request" ? (metadata as { type: string; status?: string }) : null;
              if (startNowMeta) {
                const isPending = startNowMeta.status !== "accepted" && startNowMeta.status !== "declined";
                const isCompany = profile?.role === "company";
                // Worker-side: show yellow + pending indicator only when pending AND job start date is not today (if start is today, no need to show pending)
                const isJobStartToday = startDate ? isSameDay(startDate, new Date()) : false;
                const showWorkerPending = isMe && isPending && !isJobStartToday;
                return (
                  <div
                    key={msg.id}
                    className={`flex items-end gap-2 ${isMe ? "justify-end" : "justify-start"}`}
                    data-testid={`message-start-now-request-${msg.id}`}
                  >
                    {!isMe && (
                      <Avatar className="w-7 h-7 cursor-pointer hover:ring-2 hover:ring-primary/50" onClick={() => msg.sender && handleAvatarClick(msg.sender)}>
                        <AvatarImage src={normalizeAvatarUrl(msg.sender?.avatarUrl) || undefined} />
                        <AvatarFallback className="text-xs">{msg.sender?.firstName?.[0]}{msg.sender?.lastName?.[0]}</AvatarFallback>
                      </Avatar>
                    )}
                    <div className={cn(
                      "max-w-[75%] rounded-2xl px-4 py-2",
                      showWorkerPending
                        ? "bg-amber-400 text-amber-950 rounded-br-sm dark:bg-amber-500 dark:text-amber-950"
                        : isMe
                          ? "bg-primary text-primary-foreground rounded-br-sm"
                          : "bg-secondary rounded-bl-sm"
                    )}>
                      <p className="text-sm">{msg.content}</p>
                      {showWorkerPending && (
                        <p className="text-xs font-medium mt-1 flex items-center gap-1.5 opacity-90">
                          <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-700 dark:bg-amber-900 animate-pulse" aria-hidden />
                          {t("pendingCompanyResponse")}
                        </p>
                      )}
                      {isCompany && isPending && selectedJobId && (
                        <div className="flex gap-2 mt-2">
                          <Button
                            size="sm"
                            variant="default"
                            className="text-xs"
                            disabled={respondStartNowRequestMutation.isPending}
                            onClick={() => respondStartNowRequestMutation.mutate({ jobId: selectedJobId, messageId: msg.id, action: "accept" })}
                          >
                            {t("acceptStartToday")}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="text-xs"
                            disabled={respondStartNowRequestMutation.isPending}
                            onClick={() => respondStartNowRequestMutation.mutate({ jobId: selectedJobId, messageId: msg.id, action: "decline" })}
                          >
                            {t("declineKeepSchedule")}
                          </Button>
                        </div>
                      )}
                      {startNowMeta.status === "accepted" && <p className="text-xs text-muted-foreground mt-1">{t("startDateUpdatedToToday")}</p>}
                      {startNowMeta.status === "declined" && <p className="text-xs text-muted-foreground mt-1">{t("jobTimeRemainsScheduled")}</p>}
                      <p className={cn("text-[10px] mt-1 opacity-80", showWorkerPending ? "text-amber-800 dark:text-amber-200" : "text-muted-foreground")}>
                        {format(new Date(msg.createdAt!), "h:mm a")}
                      </p>
                    </div>
                  </div>
                );
              }
              
              // Video call messages: render as button + dynamic status (call ended / in call)
              const meta = msg.metadata as { type?: string; roomUrl?: string; callStatus?: string; endedAt?: string; participants?: { profileId: number; name?: string; avatarUrl?: string }[] } | undefined;
              const isVideoCallByMeta = meta?.type === "video_call" && meta?.roomUrl;
              const videoCallMatch = !isVideoCallByMeta && typeof msg.content === "string" && msg.content.trim().match(/^Join the video call:\s*(.+)$/);
              const videoCallRoomUrl = isVideoCallByMeta ? meta.roomUrl! : (videoCallMatch ? videoCallMatch[1].trim() : null);
              const isVideoCallMessage = !!videoCallRoomUrl;
              const callEnded = isVideoCallMessage && (meta?.callStatus === "ended" || (!!videoCallRoomUrl && locallyEndedRoomUrls.has(normalizeRoomUrl(videoCallRoomUrl))));

              if (isVideoCallMessage) {
                const isInCall = callingDialogOpen;
                const isThisCallActive = isInCall && videoCallRoomUrl === callingRoomUrl;
                const isJoinable = msg.id === latestJoinableVideoCallMsgId;
                const showAsEnded = callEnded || !isJoinable;
                const endedAtMs = meta?.endedAt ? new Date(meta.endedAt).getTime() : (callEnded ? Date.now() : 0);
                const endedCallDurationSeconds = showAsEnded && msg.createdAt && endedAtMs
                  ? Math.max(0, Math.floor((endedAtMs - new Date(msg.createdAt).getTime()) / 1000))
                  : 0;
                const endedCallDurationFormatted = formatCallElapsedWithSeconds(endedCallDurationSeconds);
                return (
                  <div
                    key={msg.id}
                    className={`flex items-end gap-2 ${isMe ? "justify-end" : "justify-start"}`}
                    data-testid={`message-video-call-${msg.id}`}
                  >
                    {!isMe && (
                      <Avatar
                        className="w-7 h-7 cursor-pointer hover:ring-2 hover:ring-primary/50 transition-all"
                        onClick={() => msg.sender && handleAvatarClick(msg.sender)}
                      >
                        <AvatarImage src={normalizeAvatarUrl(msg.sender?.avatarUrl) || undefined} />
                        <AvatarFallback className="text-xs">
                          {msg.sender?.firstName?.[0]}{msg.sender?.lastName?.[0]}
                        </AvatarFallback>
                      </Avatar>
                    )}
                    <div className={cn(
                      "max-w-[75%] rounded-2xl px-4 py-3",
                      isMe
                        ? "bg-primary text-primary-foreground rounded-br-sm"
                        : "bg-secondary rounded-bl-sm",
                      isVideoCallMessage && !showAsEnded && "border-2 border-orange-400/60 shadow-[inset_0_0_0_1px_rgba(251,146,60,0.12)]",
                      isThisCallActive && "bg-red-50 dark:bg-red-950/40 text-foreground border-red-300/60 dark:border-red-800/60"
                    )}>
                      <div className="flex flex-col gap-2">
                        {showAsEnded ? (
                          <div className="flex flex-col gap-2">
                            <p className="text-sm font-medium opacity-90">{t("callEnded")}</p>
                            {((meta?.participants?.length ?? 0) > 0 || (selectedJob?.participants?.length ?? 0) > 0) ? (
                              <div className="flex items-center gap-2 flex-wrap">
                                <div className="flex -space-x-2">
                                  {(meta?.participants?.length ?? 0) > 0
                                    ? (meta!.participants! as { profileId?: number; name?: string; avatarUrl?: string }[]).map((p) => {
                                        const prof = selectedJob?.participants?.find((x) => x.id === p.profileId) ?? { firstName: p.name?.split(" ")[0], lastName: p.name?.split(" ").slice(1).join(" "), avatarUrl: p.avatarUrl, companyName: p.name };
                                        return (
                                          <Avatar key={p.profileId ?? p.name} className="w-6 h-6 border-2 border-background">
                                            <AvatarImage src={normalizeAvatarUrl(prof.avatarUrl || p.avatarUrl) || undefined} />
                                            <AvatarFallback className="text-[10px]">{prof.firstName?.[0]}{prof.lastName?.[0]}{!prof.firstName && !prof.lastName ? (prof.companyName ?? p.name)?.[0] : ""}</AvatarFallback>
                                          </Avatar>
                                        );
                                      })
                                    : (selectedJob?.participants ?? []).map((p) => (
                                        <Avatar key={p.id} className="w-6 h-6 border-2 border-background">
                                          <AvatarImage src={normalizeAvatarUrl(p.avatarUrl) || undefined} />
                                          <AvatarFallback className="text-[10px]">{p.firstName?.[0]}{p.lastName?.[0]}{!p.firstName && !p.lastName ? p.companyName?.[0] : ""}</AvatarFallback>
                                        </Avatar>
                                      ))}
                                </div>
                                <span className="text-xs font-medium tabular-nums opacity-90">{endedCallDurationFormatted}</span>
                              </div>
                            ) : (
                              <span className="text-xs font-medium tabular-nums opacity-90">{endedCallDurationFormatted}</span>
                            )}
                          </div>
                        ) : isInCall && !isThisCallActive ? (
                          <p className="text-sm font-medium opacity-80">{t("callInProgress")}</p>
                        ) : isThisCallActive ? (
                          <div className="flex flex-col gap-2">
                            <div className="flex items-center gap-2 flex-wrap">
                              <div className="flex -space-x-2">
                                {profile && (
                                  <Avatar className="w-8 h-8 border-2 border-background">
                                    <AvatarImage src={normalizeAvatarUrl(displayAvatarUrl) || undefined} />
                                    <AvatarFallback className="text-xs">{displayName.firstName?.[0]}{displayName.lastName?.[0]}</AvatarFallback>
                                  </Avatar>
                                )}
                                {(selectedJob?.participants?.filter((p) => p.id !== profile?.id) ?? []).slice(0, 4).map((p) => (
                                  <Avatar key={p.id} className="w-8 h-8 border-2 border-background">
                                    <AvatarImage src={normalizeAvatarUrl(p.avatarUrl) || undefined} />
                                    <AvatarFallback className="text-xs">{p.firstName?.[0]}{p.lastName?.[0]}{!p.firstName && !p.lastName ? p.companyName?.[0] : ""}</AvatarFallback>
                                  </Avatar>
                                ))}
                              </div>
                              <span className="text-sm font-medium tabular-nums">{callElapsedFormatted}</span>
                            </div>
                            <p className="text-sm font-medium">{t("youAreInCall")}</p>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => {
                              if (videoCallRoomUrl && selectedJobId) {
                                setCallingRoomUrl(videoCallRoomUrl);
                                setCallStarterProfileId(msg.sender?.id ?? null);
                                activeCallContextRef.current = { jobId: selectedJobId, roomUrl: videoCallRoomUrl };
                                setCallingDialogOpen(true);
                              }
                            }}
                            className={cn(
                              "inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                              isMe
                                ? "bg-primary-foreground/20 text-primary-foreground hover:bg-primary-foreground/30 px-3 py-2"
                                : "bg-primary text-primary-foreground hover:bg-primary/90 px-3 py-2"
                            )}
                            data-testid={`join-video-call-${msg.id}`}
                          >
                            <Video className="w-4 h-4 shrink-0" />
                            {t("joinVideoCall")}
                          </button>
                        )}
                        {!showAsEnded && !(isInCall && !isThisCallActive) && !isThisCallActive && (
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-xs opacity-80">{t("callLinkActive")}:</span>
                            {isJoinable && msg.id === latestJoinableVideoCallMsgId && (
                              <span className="text-xs font-medium tabular-nums opacity-90">{activeCallElapsedFormatted}</span>
                            )}
                          </div>
                        )}
                      </div>
                      <p className={cn(
                        "text-[10px] mt-2",
                        isThisCallActive ? "text-muted-foreground" : isMe ? "text-primary-foreground/70" : "text-muted-foreground"
                      )}>
                        {format(new Date(msg.createdAt!), "h:mm a")}
                      </p>
                    </div>
                    {isMe && (
                      <Avatar className="w-7 h-7">
                        <AvatarImage src={displayAvatarUrl || undefined} />
                        <AvatarFallback className="text-xs">
                          {displayName.firstName?.[0]}{displayName.lastName?.[0]}
                        </AvatarFallback>
                      </Avatar>
                    )}
                  </div>
                );
              }

              // Regular text messages
              return (
                <div
                  key={msg.id}
                  className={`flex items-end gap-2 ${isMe ? "justify-end" : "justify-start"}`}
                  data-testid={`message-${msg.id}`}
                >
                  {!isMe && (
                    <Avatar 
                      className="w-7 h-7 cursor-pointer hover:ring-2 hover:ring-primary/50 transition-all"
                      onClick={() => msg.sender && handleAvatarClick(msg.sender)}
                    >
                      <AvatarImage src={normalizeAvatarUrl(msg.sender?.avatarUrl) || undefined} />
                      <AvatarFallback className="text-xs">
                        {msg.sender?.firstName?.[0]}{msg.sender?.lastName?.[0]}
                      </AvatarFallback>
                    </Avatar>
                  )}
                  <div className={`max-w-[75%] rounded-2xl px-4 py-2 ${
                    isMe 
                      ? "bg-primary text-primary-foreground rounded-br-sm" 
                      : "bg-secondary rounded-bl-sm"
                  }`}>
                    {(msg.metadata as any)?.attachments?.length > 0 && (
                      <div className="flex flex-wrap gap-2 mb-2">
                        {((msg.metadata as any).attachments as string[]).map((url: string, i: number) => {
                          const imgSrc = url.startsWith("http") || url.startsWith("/") ? url : `/objects/chats/${url}`;
                          const idx = allChatMediaUrls.indexOf(imgSrc);
                          return (
                            <button
                              key={i}
                              type="button"
                              onClick={() => setImagePreview({ urls: allChatMediaUrls, index: idx >= 0 ? idx : 0 })}
                              className="block cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-lg overflow-hidden"
                            >
                              <img
                                src={imgSrc}
                                alt=""
                                className="max-w-[180px] max-h-[180px] rounded-lg object-cover border border-border/50 hover:opacity-90 transition-opacity"
                              />
                            </button>
                          );
                        })}
                      </div>
                    )}
                    <p className="text-sm whitespace-pre-wrap break-words">{msg.content?.trim() || null}</p>
                    <p className={`text-[10px] mt-1 ${isMe ? "text-primary-foreground/70" : "text-muted-foreground"}`}>
                      {format(new Date(msg.createdAt!), "h:mm a")}
                    </p>
                  </div>
                  {isMe && (
                    <Avatar className="w-7 h-7">
                      <AvatarImage src={displayAvatarUrl || undefined} />
                      <AvatarFallback className="text-xs">
                        {displayName.firstName?.[0]}{displayName.lastName?.[0]}
                      </AvatarFallback>
                    </Avatar>
                  )}
                </div>
              );
            })}
            <div ref={messagesEndRef} />
          </>
        )
    );
    return (
    <div className="flex flex-col h-full min-h-0 w-full overflow-hidden">
      {isMobile ? (
        <>
          {/* Mobile: header stacked above scroll content (responsive, no overlap) */}
          <div
            className={cn(
              "shrink-0 w-full border-b border-border bg-background transition-[padding,box-shadow] duration-200",
              chatHeaderScrolled && "shadow-sm",
              chatHeaderScrolled ? "py-2 px-4 pt-[calc(0.5rem+env(safe-area-inset-top,0px))]" : "p-4 pt-[calc(1rem+env(safe-area-inset-top,0px))]"
            )}
          >
            {chatHeader}
          </div>
          {/* Main scroll content: stacks below header */}
          <div
            ref={chatScrollRef}
            onScroll={handleChatScroll}
            className="flex-1 min-h-0 min-w-0 overflow-y-auto overflow-x-hidden overscroll-contain transition-[padding] duration-200 touch-pan-y"
            style={{ WebkitOverflowScrolling: "touch" } as React.CSSProperties}
          >
            <div className="space-y-4 py-4 pb-24 px-4">{chatBodyContent}</div>
          </div>
        </>
      ) : (
        <>
          <div
            className={cn(
              "flex items-center gap-3 border-b border-border bg-background shrink-0 transition-[padding] duration-200",
              chatHeaderScrolled ? "py-2 px-4" : "p-4"
            )}
          >
            {chatHeader}
          </div>
          <div ref={chatBodyScrollRef} onScroll={handleChatScroll} className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4">{chatBodyContent}</div>
        </>
      )}
      <ChatMessageInput
        onSubmit={handleSendMessage}
        participants={selectedJob?.participants ?? []}
        disabled={sendMessageMutation.isPending}
        placeholder={t("typeMessage")}
        fixedAtBottom={isMobile}
        jobId={selectedJobId ?? null}
        hasActiveCall={!!messages?.some((m: MessageWithSender) => {
          const meta = (m.metadata as { type?: string; callStatus?: string }) ?? {};
          return meta.type === "video_call" && meta.callStatus !== "ended";
        })}
        onStartCall={(roomUrl) => {
          setCallInviteRoomUrl(roomUrl);
          setCallInviteOpen(true);
        }}
        job={selectedJob?.job ?? null}
        isWorker={profile?.role === "worker"}
        onRequestStartJobNow={() => {
          if (!selectedJobId || sendMessageMutation.isPending) return;
          sendMessageMutation.mutate({
            content: "Requested to start this job today.",
            attachmentUrls: undefined,
            mentionedProfileIds: undefined,
            metadata: { type: "start_job_now_request", status: "pending" },
          });
          toast({ title: t("startJobNowRequestSent") ?? "Request sent. The company can accept or decline in chat." });
        }}
        hasPendingStartNowRequest={!!messages?.some((m: MessageWithSender) => {
          const meta = (m.metadata as { type?: string; status?: string }) ?? {};
          return meta.type === "start_job_now_request" && meta.status !== "accepted" && meta.status !== "declined";
        })}
      />
    </div>
  );
  };

  const ParticipantInfoPopup = () => {
    const shouldFetchWorkerData = participantPopupOpen && !!selectedJobId && !!selectedParticipant && profile?.role === "company" && selectedParticipant.role === "worker";
    const { data: workerLocation } = useQuery<{ latitude: number; longitude: number; createdAt: string; source: string } | null>({
      queryKey: ["/api/jobs", selectedJobId, "workers", selectedParticipant?.id, "location"],
      queryFn: async () => {
        if (!selectedJobId || !selectedParticipant?.id) return null;
        const res = await apiRequest("GET", `/api/jobs/${selectedJobId}/workers/${selectedParticipant.id}/location`);
        if (!res.ok) return null;
        return res.json();
      },
      enabled: shouldFetchWorkerData,
    });
    const { data: workerTimesheets } = useQuery<any[]>({
      queryKey: ["/api/jobs", selectedJobId, "workers", selectedParticipant?.id, "timesheets"],
      queryFn: async () => {
        if (!selectedJobId || !selectedParticipant?.id) return [];
        const res = await apiRequest("GET", `/api/jobs/${selectedJobId}/workers/${selectedParticipant.id}/timesheets`);
        if (!res.ok) return [];
        return res.json();
      },
      enabled: shouldFetchWorkerData,
    });
    const markupMultiplier = 1.52;

    return (
      <ResponsiveDialog
        open={participantPopupOpen}
        onOpenChange={setParticipantPopupOpen}
        title={t("contactInformation")}
        contentClassName="max-w-sm"
      >
        {selectedParticipant && (
            <div className="space-y-4">
              <div className="flex items-center gap-4">
                <Avatar className="w-16 h-16">
                  <AvatarImage src={normalizeAvatarUrl(selectedParticipant.avatarUrl) || undefined} />
                  <AvatarFallback className="text-lg">
                    {selectedParticipant.firstName?.[0]}{selectedParticipant.lastName?.[0]}
                  </AvatarFallback>
                </Avatar>
                <div>
                  <h3 className="font-semibold">
                    {selectedParticipant.companyName || `${selectedParticipant.firstName} ${selectedParticipant.lastName}`}
                  </h3>
                  <p className="text-sm text-muted-foreground capitalize">{selectedParticipant.role}</p>
                </div>
              </div>
              
              {workerLocation && workerLocation.latitude != null && workerLocation.longitude != null && (
                <div className="rounded-lg overflow-hidden border border-border">
                  <p className="text-xs text-muted-foreground px-2 py-1.5 bg-muted/50">
                    {workerLocation.source === "ping" ? "Current location" : "Last clock-in/out location"}
                  </p>
                  <a
                    href={`https://www.google.com/maps?q=${workerLocation.latitude},${workerLocation.longitude}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block"
                  >
                    <img
                      src={`https://maps.googleapis.com/maps/api/staticmap?center=${workerLocation.latitude},${workerLocation.longitude}&zoom=15&size=400x200&maptype=roadmap&markers=color:red%7C${workerLocation.latitude},${workerLocation.longitude}&key=${import.meta.env.VITE_GOOGLE_API_KEY}`}
                      alt="Worker location"
                      className="w-full h-[200px] object-cover"
                    />
                  </a>
                </div>
              )}

              {profile?.role === "company" && selectedParticipant?.role === "worker" && workerTimesheets && workerTimesheets.length > 0 && (
                <div className="space-y-2">
                  <h4 className="font-semibold text-sm flex items-center gap-2">
                    <FileText className="w-4 h-4 text-muted-foreground" />
                    Timesheets ({workerTimesheets.length})
                  </h4>
                  <div className="space-y-1.5 max-h-48 overflow-y-auto">
                    {workerTimesheets.map((ts: any) => (
                      <div key={ts.id} className="flex items-center justify-between p-2 bg-muted/30 rounded text-xs">
                        <div>
                          <p className="font-medium">
                            {format(new Date(ts.clockInTime), "MMM d, h:mm a")}
                            {ts.clockOutTime && ` – ${format(new Date(ts.clockOutTime), "h:mm a")}`}
                          </p>
                          <p className="text-[10px] text-muted-foreground">
                            {parseFloat(ts.adjustedHours || 0).toFixed(1)}h
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="font-medium">${(Math.round(parseFloat(ts.adjustedHours || 0) * (ts.hourlyRate || 0) * markupMultiplier) / 100).toFixed(2)}</p>
                          <Badge
                            variant={ts.status === "approved" ? "default" : ts.status === "pending" ? "secondary" : "outline"}
                            className="text-[8px] px-1 py-0"
                          >
                            {ts.status === "approved" && <CheckCircle className="w-2 h-2 mr-0.5" />}
                            {ts.status === "pending" && <AlertCircle className="w-2 h-2 mr-0.5" />}
                            {ts.status}
                          </Badge>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              
              <div className="space-y-3">
                {selectedParticipant.phone && (
                  <a 
                    href={`tel:${selectedParticipant.phone}`}
                    className="flex items-center gap-3 p-3 rounded-lg bg-secondary hover-elevate transition-colors"
                    data-testid="link-phone"
                  >
                    <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                      <Phone className="w-5 h-5 text-primary" />
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">{tCommon("phone")}</p>
                      <p className="font-medium">{selectedParticipant.phone}</p>
                    </div>
                  </a>
                )}
                
              </div>
            </div>
          )}
      </ResponsiveDialog>
    );
  };

  // Calculate distance between two coordinates in meters
  const calculateDistance = (lat1: number, lng1: number, lat2: number, lng2: number): number => {
    const R = 6371000; // Earth's radius in meters
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLng/2) * Math.sin(dLng/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
  };

  const formatDistance = (meters: number): string => {
    if (meters < 1609.34) {
      return `${Math.round(meters)} meters`;
    }
    return `${(meters / 1609.34).toFixed(2)} miles`;
  };

  const CallInviteDialog = () => (
    <Dialog
      open={callInviteOpen}
      onOpenChange={(open) => {
        if (!open) {
          setCallInviteOpen(false);
          setCallInviteRoomUrl(null);
        }
      }}
    >
      <DialogContent
        className="fixed inset-0 z-[201] w-full h-full max-w-none max-h-none translate-x-0 translate-y-0 rounded-none border-0 flex flex-col overflow-hidden bg-background p-0 gap-0 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0"
        aria-describedby="call-invite-desc"
      >
        {/* Header container */}
        <div className="flex-shrink-0 border-b border-border bg-muted/30 px-4 pt-[env(safe-area-inset-top,0)] pb-4 sm:px-6">
          <DialogHeader className="pr-10 sm:pr-12">
            <DialogTitle className="flex items-center gap-2 text-xl">
              <Video className="w-6 h-6 text-primary shrink-0" />
              {t("callInviteTitle")}
            </DialogTitle>
            <DialogDescription id="call-invite-desc" className="text-base mt-1.5">
              {t("callInviteDescription")}
            </DialogDescription>
          </DialogHeader>
        </div>

        {/* Body with visual flair */}
        <div className="flex-1 min-h-0 overflow-y-auto flex flex-col items-center justify-center px-4 py-8 sm:px-6">
          <div className="w-full max-w-sm rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
            <div className="bg-gradient-to-b from-primary/5 to-transparent p-6 sm:p-8">
              <div className="flex justify-center mb-4">
                <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center ring-4 ring-primary/5">
                  <Video className="w-8 h-8 text-primary" />
                </div>
              </div>
              <p className="text-center text-sm text-muted-foreground leading-relaxed">
                All participants will receive an email and a push notification with the call link.
              </p>
            </div>
            <div className="px-6 py-3 sm:px-8 sm:py-4 bg-muted/20 border-t border-border">
              <p className="text-xs text-muted-foreground text-center">
                Tap &quot;Send invites&quot; to notify everyone in this chat.
              </p>
            </div>
          </div>
        </div>

        {/* Footer container */}
        <div className="flex-shrink-0 border-t border-border bg-muted/30 px-4 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-6">
          <DialogFooter className="flex-row gap-3 sm:gap-3 justify-end">
            <Button
              variant="outline"
              onClick={() => {
                setCallInviteOpen(false);
                setCallInviteRoomUrl(null);
              }}
              disabled={callInviteMutation.isPending}
              className="min-w-[100px]"
            >
              {t("cancel")}
            </Button>
            <Button
              onClick={() => {
                if (selectedJobId && callInviteRoomUrl) {
                  callInviteMutation.mutate({ jobId: selectedJobId, roomUrl: callInviteRoomUrl });
                }
              }}
              disabled={callInviteMutation.isPending || !selectedJobId || !callInviteRoomUrl}
              className="min-w-[120px]"
            >
              {callInviteMutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Sending…
                </>
              ) : (
                t("sendInvites")
              )}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );

  const otherParticipants = useMemo(
    () => (selectedJob?.participants ?? []).filter((p) => p.id !== profile?.id),
    [selectedJob?.participants, profile?.id]
  );

  const normalizeRoomUrl = (url: string) => (url || "").trim().replace(/\/+$/, "");

  const handleEndCall = useCallback(() => {
    const jobId = selectedJobId ?? activeCallContextRef.current?.jobId ?? null;
    const roomUrl = callingRoomUrl ?? activeCallContextRef.current?.roomUrl ?? null;
    activeCallContextRef.current = null;
    setCallingDialogOpen(false);
    setCallingRoomUrl(null);
    setCallStarterProfileId(null);
    if (jobId && roomUrl) {
      const normalized = normalizeRoomUrl(roomUrl);
      setLocallyEndedRoomUrls((prev) => new Set(prev).add(normalized));
      const queryKey = ['/api/jobs', jobId, 'messages'] as const;
      const messages = queryClient.getQueryData<MessageWithSender[]>(queryKey);
      const getMsgRoomUrl = (m: MessageWithSender) => {
        const meta = (m.metadata as { type?: string; roomUrl?: string }) ?? {};
        if (meta.type === "video_call" && meta.roomUrl) return normalizeRoomUrl(meta.roomUrl);
        const match = typeof m.content === "string" && m.content.trim().match(/^Join the video call:\s*(.+)$/);
        return match ? normalizeRoomUrl(match[1].trim()) : null;
      };
      // Must end the LATEST message with this room URL (same one the UI shows as joinable)
      const withThisRoom = (messages ?? []).filter((m) => getMsgRoomUrl(m) === normalized);
      const notEnded = withThisRoom.filter((m) => (m.metadata as { callStatus?: string })?.callStatus !== "ended");
      const activeCallMsg = notEnded.length > 0
        ? [...notEnded].sort((a, b) => new Date(b.createdAt!).getTime() - new Date(a.createdAt!).getTime())[0]
        : undefined;
      if (activeCallMsg) {
        const endedAt = new Date().toISOString();
        queryClient.setQueryData<MessageWithSender[]>(queryKey, (prev) =>
          (prev ?? []).map((m) =>
            m.id === activeCallMsg!.id
              ? {
                  ...m,
                  metadata: {
                    ...(typeof m.metadata === "object" && m.metadata ? m.metadata : {}),
                    callStatus: "ended",
                    endedAt,
                  },
                }
              : m
          )
        );
        if (activeCallMsg.id > 0) {
          apiRequest("PATCH", `/api/jobs/${jobId}/messages/${activeCallMsg.id}`, {
            metadata: { callStatus: "ended", endedAt },
          })
            .then(() => {
              queryClient.invalidateQueries({ queryKey });
              setLocallyEndedRoomUrls((prev) => {
                const next = new Set(prev);
                next.delete(normalized);
                return next;
              });
            })
            .catch(() => queryClient.invalidateQueries({ queryKey }));
        }
      }
    }
  }, [selectedJobId, callingRoomUrl, queryClient]);

  const [callElapsedSeconds, setCallElapsedSeconds] = useState(0);
  const callStartTimeRef = useRef<number | null>(null);
  useEffect(() => {
    if (!callingDialogOpen) {
      callStartTimeRef.current = null;
      setCallElapsedSeconds(0);
      return;
    }
    callStartTimeRef.current = Date.now();
    const interval = setInterval(() => {
      const start = callStartTimeRef.current;
      if (start) setCallElapsedSeconds(Math.floor((Date.now() - start) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [callingDialogOpen]);

  const callElapsedFormatted = useMemo(
    () => formatCallElapsedWithSeconds(callElapsedSeconds),
    [callElapsedSeconds]
  );

  const MapPopup = () => {
    if (!mapLocation) return null;
    
    const distance = calculateDistance(
      mapLocation.clockIn.lat, mapLocation.clockIn.lng,
      mapLocation.clockOut.lat, mapLocation.clockOut.lng
    );
    
    // Create map URL that shows both points with markers
    const centerLat = (mapLocation.clockIn.lat + mapLocation.clockOut.lat) / 2;
    const centerLng = (mapLocation.clockIn.lng + mapLocation.clockOut.lng) / 2;
    const mapUrl = `https://maps.googleapis.com/maps/api/staticmap?center=${centerLat},${centerLng}&zoom=16&size=600x300&maptype=roadmap&markers=color:green%7Clabel:I%7C${mapLocation.clockIn.lat},${mapLocation.clockIn.lng}&markers=color:orange%7Clabel:O%7C${mapLocation.clockOut.lat},${mapLocation.clockOut.lng}&key=${import.meta.env.VITE_GOOGLE_API_KEY}`;
    
    return (
      <Dialog open={mapPopupOpen} onOpenChange={setMapPopupOpen}>
        <DialogContent className="max-w-lg" aria-describedby="map-popup-desc">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <MapPin className="w-5 h-5" />
              {t("clockInOutLocations")}
            </DialogTitle>
            <DialogDescription id="map-popup-desc">
              Clock in and clock out locations for this timesheet.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="flex items-center gap-3 p-3 rounded-lg bg-secondary">
              <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                <User className="w-5 h-5 text-primary" />
              </div>
              <div>
                <p className="font-medium">{mapLocation.workerName}</p>
                <p className="text-sm text-muted-foreground">{t("timesheet.hoursWorked", { hours: mapLocation.totalHours.toFixed(1) })}</p>
              </div>
            </div>
            
            <div className="rounded-lg overflow-hidden border border-border">
              <img
                src={mapUrl}
                alt="Clock in and out locations"
                className="w-full h-auto"
                data-testid="map-image"
              />
            </div>
            
            <div className="grid grid-cols-2 gap-3">
              <div className="p-3 rounded-lg bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800">
                <div className="flex items-center gap-2 mb-1">
                  <LogIn className="w-4 h-4 text-green-600 dark:text-green-400" />
                  <span className="text-sm font-medium text-green-700 dark:text-green-300">{t("worker.clockIn")}</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  {mapLocation.clockIn.lat.toFixed(5)}, {mapLocation.clockIn.lng.toFixed(5)}
                </p>
              </div>
              <div className="p-3 rounded-lg bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800">
                <div className="flex items-center gap-2 mb-1">
                  <LogOut className="w-4 h-4 text-orange-600 dark:text-orange-400" />
                  <span className="text-sm font-medium text-orange-700 dark:text-orange-300">{t("worker.clockOut")}</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  {mapLocation.clockOut.lat.toFixed(5)}, {mapLocation.clockOut.lng.toFixed(5)}
                </p>
              </div>
            </div>
            
            <div className="flex justify-between items-center p-3 rounded-lg bg-muted">
              <div className="flex items-center gap-2">
                <MapPin className="w-4 h-4 text-muted-foreground" />
                <span className="text-sm font-medium">{t("distanceBetweenLocations")}</span>
              </div>
              <Badge variant="outline">{formatDistance(distance)}</Badge>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    );
  };

  /* When embedded in dashboard (company), use dashboard header – no Chats header, no own nav/footer */
  if (embedInDashboard) {
    const isCompany = profile?.role === "company";
    /* Desktop: 3-column layout (jobs list | chat | job details). Mobile: single column. */
    if (isDesktop) {
      return (
        <>
          <div className="flex flex-1 min-h-0 overflow-hidden">
            <div className="w-80 border-r border-border flex flex-col shrink-0">
              <div className="flex-1 overflow-y-auto">
                {jobsLoading ? (
                  <div className="flex justify-center py-12">
                    <Loader2 className="w-6 h-6 animate-spin" />
                  </div>
                ) : !filteredChatJobs || filteredChatJobs.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
                    <MessageSquare className="w-10 h-10 text-muted-foreground mb-3" />
                    <h3 className="font-medium mb-1">{t("noActiveChats")}</h3>
                    <p className="text-xs text-muted-foreground">
                      {profile?.role === "company" ? t("chatsAppearInProgress") : t("chatsAppearAccepted")}
                    </p>
                  </div>
                ) : (
                  <div className="divide-y divide-border">
                  {searchedChatJobs.map(({ job, participants, unreadCount }) => {
                    const isSelected = selectedJobId === job.id;
                    const isUnread = unreadCount > 0 && !viewedJobIds.has(job.id);
                    return (
                      <ChatJobListRow
                        key={job.id}
                        job={job}
                        participants={participants}
                        unreadCount={unreadCount}
                        isUnread={isUnread}
                        isSelected={isSelected}
                        onSelect={() => setSelectedJobId(job.id)}
                        noParticipantsLabel={t("noParticipants")}
                      />
                    )})}
                  </div>
                )}
              </div>
            </div>
            <div className="flex-1 flex flex-col min-h-0 min-w-0">
              {selectedJobId ? (
                <ChatSection />
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center text-center px-4">
                  <MessageSquare className="w-16 h-16 text-muted-foreground mb-4" />
                  <h2 className="text-lg font-semibold mb-2">{t("selectAChat")}</h2>
                  <p className="text-sm text-muted-foreground max-w-xs">{t("chooseJobToViewMessages")}</p>
                </div>
              )}
            </div>
            <JobDetailsPanel
              job={jobForDetailsPanel}
              participants={selectedJob?.participants || []}
              isOpen={showJobDetails && !!selectedJobId}
              onClose={() => setShowJobDetails(false)}
              isMobile={false}
              isCompany={isCompany}
              onMarkComplete={isCompany ? (jobId, jobTitle) => {
                setMarkCompleteJobId(jobId);
                setMarkCompleteJobTitle(jobTitle);
              } : undefined}
              onStartCallForParticipant={PEERCALLS_BASE_URL && selectedJobId ? handleStartCallForParticipant : undefined}
            />
          </div>
          <ParticipantInfoPopup />
          <MapPopup />
          <CallInviteDialog />
          <CallingDialog
            open={callingDialogOpen}
            onEndCall={handleEndCall}
            callElapsedFormatted={callElapsedFormatted}
            profile={profile ?? null}
            otherParticipants={otherParticipants}
            callStarterProfileId={callStarterProfileId}
          />
          {isCompany && (
            <MarkCompleteReviewDialog
              open={!!markCompleteJobId}
              jobId={markCompleteJobId}
              jobTitle={markCompleteJobTitle}
              onOpenChange={(open) => {
                if (!open) {
                  setMarkCompleteJobId(null);
                  setMarkCompleteJobTitle("");
                }
              }}
            />
          )}
          {imagePreview && (
            <div className="fixed inset-0 z-[100] bg-black/95 flex items-center justify-center" onClick={() => setImagePreview(null)} role="button" aria-label="Close image preview">
              <button type="button" onClick={(e) => { e.stopPropagation(); setImagePreview(null); }} className="absolute top-4 right-4 z-10 p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors" aria-label="Close"><X className="w-8 h-8" /></button>
              {imagePreview.urls.length > 1 && (
                <>
                  <button type="button" onClick={(e) => { e.stopPropagation(); if (imagePreview.index > 0) setImagePreview({ ...imagePreview, index: imagePreview.index - 1 }); }} disabled={imagePreview.index === 0} className="absolute left-2 top-1/2 -translate-y-1/2 z-10 p-3 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors disabled:opacity-30 disabled:pointer-events-none" aria-label="Previous"><ChevronLeft className="w-8 h-8" /></button>
                  <button type="button" onClick={(e) => { e.stopPropagation(); if (imagePreview.index < imagePreview.urls.length - 1) setImagePreview({ ...imagePreview, index: imagePreview.index + 1 }); }} disabled={imagePreview.index === imagePreview.urls.length - 1} className="absolute right-2 top-1/2 -translate-y-1/2 z-10 p-3 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors disabled:opacity-30 disabled:pointer-events-none" aria-label="Next"><ChevronRight className="w-8 h-8" /></button>
                  <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 px-3 py-1 rounded-full bg-black/50 text-white text-sm">{imagePreview.index + 1} / {imagePreview.urls.length}</div>
                </>
              )}
              <img src={imagePreview.urls[imagePreview.index]} alt="" className="max-w-full max-h-full object-contain" onClick={(e) => e.stopPropagation()} />
            </div>
          )}
        </>
      );
    }
    /* Tablet/desktop in dashboard: 2-column layout (left jobs list + chat right), Details opens pop-up. Use md (768px) so we never get a squashed right column when the tab content area is narrow. */
    if (!isMobile) {
      return (
        <>
          <div className="flex flex-1 min-h-0 overflow-hidden">
            <div className="w-80 border-r border-border flex flex-col shrink-0">
            <div className="flex-1 overflow-y-auto">
              {jobsLoading ? (
                <div className="flex justify-center py-12">
                  <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
                </div>
              ) : !filteredChatJobs || filteredChatJobs.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
                  <MessageSquare className="w-10 h-10 text-muted-foreground mb-3" />
                  <h3 className="font-medium mb-1">{t("noActiveChats")}</h3>
                  <p className="text-xs text-muted-foreground">
                    {profile?.role === "company" ? t("chatsAppearInProgress") : t("chatsAppearAccepted")}
                  </p>
                </div>
              ) : (
                <div className="divide-y divide-border">
                  {searchedChatJobs.map(({ job, participants, unreadCount }) => {
                    const isSelected = selectedJobId === job.id;
                    const isUnread = unreadCount > 0 && !viewedJobIds.has(job.id);
                    return (
                      <ChatJobListRow
                        key={job.id}
                        job={job}
                        participants={participants}
                        unreadCount={unreadCount}
                        isUnread={isUnread}
                        isSelected={isSelected}
                        onSelect={() => setSelectedJobId(job.id)}
                        noParticipantsLabel={t("noParticipants")}
                      />
                    )})}
                </div>
              )}
            </div>
          </div>
          <div className="flex-1 flex flex-col min-h-0 min-w-0">
            {selectedJobId ? (
              <ChatSection />
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center text-center px-4">
                <MessageSquare className="w-16 h-16 text-muted-foreground mb-4" />
                <h2 className="text-lg font-semibold mb-2">{t("selectAChat")}</h2>
                <p className="text-sm text-muted-foreground max-w-xs">{t("chooseJobToViewMessages")}</p>
              </div>
            )}
          </div>
        </div>
        <ParticipantInfoPopup />
        <MapPopup />
        <CallInviteDialog />
        <CallingDialog
            open={callingDialogOpen}
            onEndCall={handleEndCall}
            callElapsedFormatted={callElapsedFormatted}
            profile={profile ?? null}
            otherParticipants={otherParticipants}
            callStarterProfileId={callStarterProfileId}
          />
        {imagePreview && (
          <div
            className="fixed inset-0 z-[100] bg-black/95 flex items-center justify-center"
            onClick={() => setImagePreview(null)}
            role="button"
            aria-label="Close image preview"
          >
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setImagePreview(null); }}
              className="absolute top-4 right-4 z-10 p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
              aria-label="Close"
            >
              <X className="w-8 h-8" />
            </button>
            {imagePreview.urls.length > 1 && (
              <>
                <button type="button" onClick={(e) => { e.stopPropagation(); if (imagePreview.index > 0) setImagePreview({ ...imagePreview, index: imagePreview.index - 1 }); }} disabled={imagePreview.index === 0} className="absolute left-2 top-1/2 -translate-y-1/2 z-10 p-3 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors disabled:opacity-30 disabled:pointer-events-none" aria-label="Previous"><ChevronLeft className="w-8 h-8" /></button>
                <button type="button" onClick={(e) => { e.stopPropagation(); if (imagePreview.index < imagePreview.urls.length - 1) setImagePreview({ ...imagePreview, index: imagePreview.index + 1 }); }} disabled={imagePreview.index === imagePreview.urls.length - 1} className="absolute right-2 top-1/2 -translate-y-1/2 z-10 p-3 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors disabled:opacity-30 disabled:pointer-events-none" aria-label="Next"><ChevronRight className="w-8 h-8" /></button>
                <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 px-3 py-1 rounded-full bg-black/50 text-white text-sm">{imagePreview.index + 1} / {imagePreview.urls.length}</div>
              </>
            )}
            <img src={imagePreview.urls[imagePreview.index]} alt="" className="max-w-full max-h-full object-contain" onClick={(e) => e.stopPropagation()} />
          </div>
        )}
        {/* Tablet in dashboard: Details opens as pop-up (ResponsiveDialog), not 3rd column */}
        <JobDetailsPanel
          job={jobForDetailsPanel}
          participants={selectedJob?.participants || []}
          isOpen={showJobDetails}
          onClose={() => setShowJobDetails(false)}
          isMobile={true}
          isCompany={isCompany}
          onMarkComplete={isCompany ? (jobId, jobTitle) => {
            setShowJobDetails(false);
            setMarkCompleteJobId(jobId);
            setMarkCompleteJobTitle(jobTitle);
          } : undefined}
          onStartCallForParticipant={PEERCALLS_BASE_URL && selectedJobId ? handleStartCallForParticipant : undefined}
        />
        {isCompany && (
          <MarkCompleteReviewDialog
            open={!!markCompleteJobId}
            jobId={markCompleteJobId}
            jobTitle={markCompleteJobTitle}
            onOpenChange={(open) => {
              if (!open) {
                setMarkCompleteJobId(null);
                setMarkCompleteJobTitle("");
              }
            }}
          />
        )}
        </>
      );
    }
    /* Mobile in dashboard: single column (list or chat), Details opens pop-up */
    return (
      <>
        <div className="flex flex-col flex-1 min-h-0 w-full overflow-hidden">
          {selectedJobId ? <ChatSection /> : <JobsList />}
        </div>
        <ParticipantInfoPopup />
        <MapPopup />
        <CallInviteDialog />
        <CallingDialog
            open={callingDialogOpen}
            onEndCall={handleEndCall}
            callElapsedFormatted={callElapsedFormatted}
            profile={profile ?? null}
            otherParticipants={otherParticipants}
            callStarterProfileId={callStarterProfileId}
          />
        {imagePreview && (
          <div
            className="fixed inset-0 z-[100] bg-black/95 flex items-center justify-center"
            onClick={() => setImagePreview(null)}
            role="button"
            aria-label="Close image preview"
          >
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setImagePreview(null); }}
              className="absolute top-4 right-4 z-10 p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
              aria-label="Close"
            >
              <X className="w-8 h-8" />
            </button>
            {imagePreview.urls.length > 1 && (
              <>
                <button type="button" onClick={(e) => { e.stopPropagation(); if (imagePreview.index > 0) setImagePreview({ ...imagePreview, index: imagePreview.index - 1 }); }} disabled={imagePreview.index === 0} className="absolute left-2 top-1/2 -translate-y-1/2 z-10 p-3 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors disabled:opacity-30 disabled:pointer-events-none" aria-label="Previous"><ChevronLeft className="w-8 h-8" /></button>
                <button type="button" onClick={(e) => { e.stopPropagation(); if (imagePreview.index === imagePreview.urls.length - 1) setImagePreview({ ...imagePreview, index: imagePreview.index + 1 }); }} disabled={imagePreview.index === imagePreview.urls.length - 1} className="absolute right-2 top-1/2 -translate-y-1/2 z-10 p-3 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors disabled:opacity-30 disabled:pointer-events-none" aria-label="Next"><ChevronRight className="w-8 h-8" /></button>
                <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 px-3 py-1 rounded-full bg-black/50 text-white text-sm">{imagePreview.index + 1} / {imagePreview.urls.length}</div>
              </>
            )}
            <img src={imagePreview.urls[imagePreview.index]} alt="" className="max-w-full max-h-full object-contain" onClick={(e) => e.stopPropagation()} />
          </div>
        )}
        <JobDetailsPanel
          job={jobForDetailsPanel}
          participants={selectedJob?.participants || []}
          isOpen={showJobDetails}
          onClose={() => setShowJobDetails(false)}
          isMobile={true}
          isCompany={isCompany}
          onMarkComplete={isCompany ? (jobId, jobTitle) => {
            setShowJobDetails(false);
            setMarkCompleteJobId(jobId);
            setMarkCompleteJobTitle(jobTitle);
          } : undefined}
          onStartCallForParticipant={PEERCALLS_BASE_URL && selectedJobId ? handleStartCallForParticipant : undefined}
        />
        {isCompany && (
          <MarkCompleteReviewDialog
            open={!!markCompleteJobId}
            jobId={markCompleteJobId}
            jobTitle={markCompleteJobTitle}
            onOpenChange={(open) => {
              if (!open) {
                setMarkCompleteJobId(null);
                setMarkCompleteJobTitle("");
              }
            }}
          />
        )}
        <MobileNotificationsPopup />
      </>
    );
  }

  if (isSmallMobile) {
    const isCompany = profile?.role === 'company';
    
    return (
        <div className={cn(
        "h-screen flex flex-col bg-background overflow-hidden",
        showMobileFooter ? "pb-24" : ""
      )}>
        {selectedJobId ? <ChatSection /> : <JobsList />}
        <ParticipantInfoPopup />
        <MapPopup />
        <CallInviteDialog />
        <CallingDialog
            open={callingDialogOpen}
            onEndCall={handleEndCall}
            callElapsedFormatted={callElapsedFormatted}
            profile={profile ?? null}
            otherParticipants={otherParticipants}
            callStarterProfileId={callStarterProfileId}
          />
        {imagePreview && (
          <div
            className="fixed inset-0 z-[100] bg-black/95 flex items-center justify-center"
            onClick={() => setImagePreview(null)}
            role="button"
            aria-label="Close image preview"
          >
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setImagePreview(null); }}
              className="absolute top-4 right-4 z-10 p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
              aria-label="Close"
            >
              <X className="w-8 h-8" />
            </button>
            {imagePreview.urls.length > 1 && (
              <>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (imagePreview.index > 0) setImagePreview({ ...imagePreview, index: imagePreview.index - 1 });
                  }}
                  disabled={imagePreview.index === 0}
                  className="absolute left-2 top-1/2 -translate-y-1/2 z-10 p-3 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors disabled:opacity-30 disabled:pointer-events-none"
                  aria-label="Previous"
                >
                  <ChevronLeft className="w-8 h-8" />
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (imagePreview.index < imagePreview.urls.length - 1) setImagePreview({ ...imagePreview, index: imagePreview.index + 1 });
                  }}
                  disabled={imagePreview.index === imagePreview.urls.length - 1}
                  className="absolute right-2 top-1/2 -translate-y-1/2 z-10 p-3 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors disabled:opacity-30 disabled:pointer-events-none"
                  aria-label="Next"
                >
                  <ChevronRight className="w-8 h-8" />
                </button>
                <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 px-3 py-1 rounded-full bg-black/50 text-white text-sm">
                  {imagePreview.index + 1} / {imagePreview.urls.length}
                </div>
              </>
            )}
            <img
              src={imagePreview.urls[imagePreview.index]}
              alt=""
              className="max-w-full max-h-full object-contain"
              onClick={(e) => e.stopPropagation()}
            />
          </div>
        )}
        
        {/* Mobile Job Details Dialog */}
        <JobDetailsPanel
          job={jobForDetailsPanel}
          participants={selectedJob?.participants || []}
          isOpen={showJobDetails}
          onClose={() => setShowJobDetails(false)}
          isMobile={true}
          isCompany={isCompany}
          onMarkComplete={isCompany ? (jobId, jobTitle) => {
            setShowJobDetails(false);
            setMarkCompleteJobId(jobId);
            setMarkCompleteJobTitle(jobTitle);
          } : undefined}
          onStartCallForParticipant={PEERCALLS_BASE_URL && selectedJobId ? handleStartCallForParticipant : undefined}
        />
        {isCompany && (
          <MarkCompleteReviewDialog
            open={!!markCompleteJobId}
            jobId={markCompleteJobId}
            jobTitle={markCompleteJobTitle}
            onOpenChange={(open) => {
              if (!open) {
                setMarkCompleteJobId(null);
                setMarkCompleteJobTitle("");
              }
            }}
          />
        )}
        
        {/* Mobile Bottom Navigation - hidden when viewing chat details */}
        {showMobileFooter && (isCompany ? (
          <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-background border-t border-border z-50 h-14" aria-label="Company dashboard navigation" data-testid="mobile-footer-nav">
            <div className="flex items-center justify-around h-full">
              <button
                onClick={() => setLocation("/company-dashboard/jobs")}
                className={`flex flex-col items-center justify-center gap-0.5 px-2 min-w-0 flex-1 h-full transition-colors ${
                  location === "/company-dashboard" || location === "/company-dashboard/jobs" ? "text-primary" : "text-muted-foreground"
                }`}
                data-testid="mobile-nav-jobs"
              >
                <Briefcase className="w-5 h-5 shrink-0" />
                <span className="text-[11px] font-medium truncate">{tCompany("nav.jobs")}</span>
              </button>
              <button
                onClick={() => setLocation("/company-dashboard/team")}
                className={`flex flex-col items-center justify-center gap-0.5 px-2 min-w-0 flex-1 h-full transition-colors ${
                  location === "/company-dashboard/team" ? "text-primary" : "text-muted-foreground"
                }`}
                data-testid="mobile-nav-team"
              >
                <Users className="w-5 h-5 shrink-0" />
                <span className="text-[11px] font-medium truncate">{tCompany("nav.team")}</span>
              </button>
              <button
                onClick={() => setLocation("/company-dashboard/timesheets")}
                className={`flex flex-col items-center justify-center gap-0.5 px-2 min-w-0 flex-1 h-full transition-colors ${
                  location === "/company-dashboard/timesheets" ? "text-primary" : "text-muted-foreground"
                }`}
                data-testid="mobile-nav-timesheets"
              >
                <Clock className="w-5 h-5 shrink-0" />
                <span className="text-[11px] font-medium truncate">{tCompany("company.timesheets")}</span>
              </button>
              <button
                onClick={() => setLocation("/company-dashboard/chats")}
                className={`flex flex-col items-center justify-center gap-0.5 px-2 min-w-0 flex-1 h-full transition-colors ${
                  location === "/company-dashboard/chats" || (location || "").startsWith("/company-dashboard/chats") ? "text-primary" : "text-muted-foreground"
                }`}
                data-testid="mobile-nav-chats"
              >
                <MessageSquare className="w-5 h-5 shrink-0" />
                <span className="text-[11px] font-medium truncate">{tCompany("nav.messages")}</span>
              </button>
            </div>
          </nav>
        ) : (
          <nav className="fixed bottom-0 left-0 right-0 bg-background border-t border-border z-50 h-14">
            <div className="flex items-center justify-around h-full">
              {/* Worker Footer: Today, Find, Jobs, Calendar, Chats */}
              {/* For employees: Only show Today, Calendar, Chats */}
              <button
                onClick={() => setLocation("/dashboard/today")}
                className="flex flex-col items-center justify-center gap-0.5 px-3 h-full transition-colors text-muted-foreground"
                data-testid="mobile-nav-today"
              >
                <Clock className="w-5 h-5" />
                <span className="text-[11px] font-medium">{tNav("nav.today")}</span>
              </button>
              {/* Find and Jobs tabs - hidden for employees */}
              {!isEmployee && (
                <>
                  <button
                    onClick={() => setLocation("/dashboard/find")}
                    className="flex flex-col items-center justify-center gap-0.5 px-3 h-full transition-colors text-muted-foreground"
                    data-testid="mobile-nav-find"
                  >
                    <Search className="w-5 h-5" />
                    <span className="text-[11px] font-medium">{tNav("nav.find")}</span>
                  </button>
                  <button
                    onClick={() => setLocation("/dashboard/jobs")}
                    className="flex flex-col items-center justify-center gap-0.5 px-3 h-full transition-colors text-muted-foreground"
                    data-testid="mobile-nav-jobs"
                  >
                    <Briefcase className="w-5 h-5" />
                    <span className="text-[11px] font-medium">{tNav("nav.jobs")}</span>
                  </button>
                </>
              )}
              <button
                onClick={() => setLocation("/dashboard/calendar")}
                className="flex flex-col items-center justify-center gap-0.5 px-3 h-full transition-colors text-muted-foreground"
                data-testid="mobile-nav-calendar"
              >
                <Calendar className="w-5 h-5" />
                <span className="text-[11px] font-medium">{tNav("nav.calendar")}</span>
              </button>
              <button
                className="flex flex-col items-center justify-center gap-0.5 px-3 h-full transition-colors text-primary"
                data-testid="mobile-nav-chats"
              >
                <MessageSquare className="w-5 h-5" />
                <span className="text-[11px] font-medium">{tNav("nav.messages")}</span>
              </button>
              {isEmployee && (
                <Popover>
                  <PopoverTrigger asChild>
                    <button
                      className="flex flex-col items-center justify-center gap-0.5 px-3 h-full transition-colors text-muted-foreground"
                      data-testid="mobile-nav-profile"
                    >
                      <Avatar className="w-5 h-5">
                        <AvatarImage src={displayAvatarUrl || undefined} />
                        <AvatarFallback className="text-[10px]">
                          {displayName.firstName?.[0]}{displayName.lastName?.[0]}
                        </AvatarFallback>
                      </Avatar>
                      <span className="text-[11px] font-medium">{tNav("nav.profile") || "Profile"}</span>
                    </button>
                  </PopoverTrigger>
                  <PopoverContent className="w-80 p-0" align="end" side="top">
                    <div className="p-4 space-y-4">
                      <div className="flex items-center gap-4">
                        <Avatar className="w-16 h-16">
                          <AvatarImage src={displayAvatarUrl || undefined} />
                          <AvatarFallback className="text-lg">
                            {displayName.firstName?.[0]}{displayName.lastName?.[0]}
                          </AvatarFallback>
                        </Avatar>
                        <div className="flex-1 min-w-0">
                          <h3 className="font-semibold text-lg truncate">
                            {displayName.firstName} {displayName.lastName}
                          </h3>
                          <p className="text-sm text-muted-foreground truncate">
                            {profile?.email}
                          </p>
                        </div>
                      </div>
                      <Separator />
                      <Button
                        variant="outline"
                        className="w-full justify-start gap-2"
                        onClick={() => logout()}
                        disabled={isLoggingOut}
                        data-testid="button-logout-mobile"
                      >
                        <LogOut className="w-4 h-4" />
                        {isLoggingOut ? "Logging out..." : "Log Out"}
                      </Button>
                    </div>
                  </PopoverContent>
                </Popover>
              )}
            </div>
          </nav>
        ))}
        <MobileNotificationsPopup />
      </div>
    );
  }
  /* embedInDashboard + isMobile (< 768px): single column so we never get a squashed 2-col */
  if (isMobile) {
      const isCompanyEmbed = profile?.role === 'company';
      return (
        <div className={cn("h-screen flex flex-col bg-background overflow-hidden min-h-0", showMobileFooter ? "pb-24" : "")}>
          <div className="flex-1 flex flex-col min-h-0 min-w-0 overflow-hidden">
            {selectedJobId ? <ChatSection /> : <JobsList />}
          </div>
          <ParticipantInfoPopup />
          <MapPopup />
          <CallInviteDialog />
          <CallingDialog open={callingDialogOpen} onEndCall={handleEndCall} callElapsedFormatted={callElapsedFormatted} profile={profile ?? null} otherParticipants={otherParticipants} callStarterProfileId={callStarterProfileId} />
          {imagePreview && (
            <div className="fixed inset-0 z-[100] bg-black/95 flex items-center justify-center" onClick={() => setImagePreview(null)} role="button" aria-label="Close image preview">
              <button type="button" onClick={(e) => { e.stopPropagation(); setImagePreview(null); }} className="absolute top-4 right-4 z-10 p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors" aria-label="Close"><X className="w-8 h-8" /></button>
              {imagePreview.urls.length > 1 && (
                <>
                  <button type="button" onClick={(e) => { e.stopPropagation(); if (imagePreview.index > 0) setImagePreview({ ...imagePreview, index: imagePreview.index - 1 }); }} disabled={imagePreview.index === 0} className="absolute left-2 top-1/2 -translate-y-1/2 z-10 p-3 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors disabled:opacity-30 disabled:pointer-events-none" aria-label="Previous"><ChevronLeft className="w-8 h-8" /></button>
                  <button type="button" onClick={(e) => { e.stopPropagation(); if (imagePreview.index < imagePreview.urls.length - 1) setImagePreview({ ...imagePreview, index: imagePreview.index + 1 }); }} disabled={imagePreview.index === imagePreview.urls.length - 1} className="absolute right-2 top-1/2 -translate-y-1/2 z-10 p-3 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors disabled:opacity-30 disabled:pointer-events-none" aria-label="Next"><ChevronRight className="w-8 h-8" /></button>
                  <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 px-3 py-1 rounded-full bg-black/50 text-white text-sm">{imagePreview.index + 1} / {imagePreview.urls.length}</div>
                </>
              )}
              <img src={imagePreview.urls[imagePreview.index]} alt="" className="max-w-full max-h-full object-contain" onClick={(e) => e.stopPropagation()} />
            </div>
          )}
          <JobDetailsPanel job={jobForDetailsPanel} participants={selectedJob?.participants || []} isOpen={showJobDetails} onClose={() => setShowJobDetails(false)} isMobile={true} isCompany={isCompanyEmbed} onMarkComplete={isCompanyEmbed ? (jobId, jobTitle) => { setShowJobDetails(false); setMarkCompleteJobId(jobId); setMarkCompleteJobTitle(jobTitle); } : undefined} onStartCallForParticipant={PEERCALLS_BASE_URL && selectedJobId ? handleStartCallForParticipant : undefined} />
          {isCompanyEmbed && <MarkCompleteReviewDialog open={!!markCompleteJobId} jobId={markCompleteJobId} jobTitle={markCompleteJobTitle} onOpenChange={(open) => { if (!open) { setMarkCompleteJobId(null); setMarkCompleteJobTitle(""); } }} />}
          {showMobileFooter && (isCompanyEmbed ? (
            <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-background border-t border-border z-50 h-14" aria-label="Company dashboard navigation" data-testid="mobile-footer-nav">
              <div className="flex items-center justify-around h-full">
                <button onClick={() => setLocation("/company-dashboard/jobs")} className="flex flex-col items-center justify-center gap-0.5 px-2 min-w-0 flex-1 h-full transition-colors text-muted-foreground" data-testid="mobile-nav-jobs"><Briefcase className="w-5 h-5 shrink-0" /><span className="text-[11px] font-medium truncate">{tCompany("nav.jobs")}</span></button>
                <button onClick={() => setLocation("/company-dashboard/team")} className="flex flex-col items-center justify-center gap-0.5 px-2 min-w-0 flex-1 h-full transition-colors text-muted-foreground" data-testid="mobile-nav-team"><Users className="w-5 h-5 shrink-0" /><span className="text-[11px] font-medium truncate">{tCompany("nav.team")}</span></button>
                <button onClick={() => setLocation("/company-dashboard/timesheets")} className="flex flex-col items-center justify-center gap-0.5 px-2 min-w-0 flex-1 h-full transition-colors text-muted-foreground" data-testid="mobile-nav-timesheets"><Clock className="w-5 h-5 shrink-0" /><span className="text-[11px] font-medium truncate">{tCompany("company.timesheets")}</span></button>
                <button onClick={() => setLocation("/company-dashboard/chats")} className={`flex flex-col items-center justify-center gap-0.5 px-2 min-w-0 flex-1 h-full transition-colors ${location === "/company-dashboard/chats" ? "text-primary" : "text-muted-foreground"}`} data-testid="mobile-nav-chats"><MessageSquare className="w-5 h-5 shrink-0" /><span className="text-[11px] font-medium truncate">{tCompany("nav.messages")}</span></button>
              </div>
            </nav>
          ) : (
            <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-background border-t border-border z-50 h-14" aria-label="Worker dashboard navigation" data-testid="mobile-footer-nav">
              <div className="flex items-center justify-around h-full">
                <button onClick={() => setLocation("/dashboard/today")} className={`flex flex-col items-center justify-center gap-0.5 px-3 h-full transition-colors ${(location || "").startsWith("/dashboard/today") ? "text-primary" : "text-muted-foreground"}`} data-testid="mobile-nav-today"><Clock className="w-5 h-5" /><span className="text-[11px] font-medium">{tNav("nav.today")}</span></button>
                {!isEmployee && (
                  <>
                    <button onClick={() => setLocation("/dashboard/find")} className={`flex flex-col items-center justify-center gap-0.5 px-3 h-full transition-colors ${(location || "").startsWith("/dashboard/find") ? "text-primary" : "text-muted-foreground"}`} data-testid="mobile-nav-find"><Search className="w-5 h-5" /><span className="text-[11px] font-medium">{tNav("nav.find")}</span></button>
                    <button onClick={() => setLocation("/dashboard/jobs")} className={`flex flex-col items-center justify-center gap-0.5 px-3 h-full transition-colors ${(location || "").startsWith("/dashboard/jobs") ? "text-primary" : "text-muted-foreground"}`} data-testid="mobile-nav-jobs"><Briefcase className="w-5 h-5" /><span className="text-[11px] font-medium">{tNav("nav.jobs")}</span></button>
                  </>
                )}
                <button onClick={() => setLocation("/dashboard/calendar")} className={`flex flex-col items-center justify-center gap-0.5 px-3 h-full transition-colors ${(location || "").startsWith("/dashboard/calendar") ? "text-primary" : "text-muted-foreground"}`} data-testid="mobile-nav-calendar"><Calendar className="w-5 h-5" /><span className="text-[11px] font-medium">{tNav("nav.calendar")}</span></button>
                <button className="flex flex-col items-center justify-center gap-0.5 px-3 h-full transition-colors text-primary" data-testid="mobile-nav-chats"><MessageSquare className="w-5 h-5" /><span className="text-[11px] font-medium">{tNav("nav.messages")}</span></button>
              </div>
            </nav>
          ))}
          <MobileNotificationsPopup />
        </div>
      );
    }

  const isCompany = profile?.role === 'company';

  const companyTabs = (
    <div className="flex items-center gap-3 w-full">
      <div className="flex-1 min-w-0 overflow-x-auto scrollbar-hide">
        <AnimatedNavigationTabs
          items={[
            { id: "jobs", label: tCompany("nav.jobs"), onClick: () => setLocation("/company-dashboard/jobs") },
            { id: "team", label: tCompany("nav.team"), onClick: () => setLocation("/company-dashboard/team") },
            { id: "timesheets", label: tCompany("timesheet.title"), onClick: () => setLocation("/company-dashboard/timesheets") },
            { id: "chats", label: tCompany("nav.messages") },
          ]}
          value="chats"
          onValueChange={() => {}}
        />
      </div>
      <Button variant="default" size="sm" className="flex-shrink-0" onClick={() => setLocation("/post-job")}>
        + New Job
      </Button>
    </div>
  );

  const workerTabsItems = [
    ...(!isEmployee ? [
      { id: "find", label: tNav("nav.find"), onClick: () => setLocation("/dashboard/find") } as const,
      { id: "jobs", label: tNav("nav.jobs"), onClick: () => setLocation("/dashboard/jobs") } as const,
    ] : []),
    { id: "today", label: tNav("nav.today"), onClick: () => setLocation("/dashboard/today") } as const,
    { id: "calendar", label: tNav("nav.calendar"), onClick: () => setLocation("/dashboard/calendar") } as const,
    { id: "chats", label: tNav("nav.messages") } as const,
  ];

  return (
    <div className="h-screen flex flex-col bg-background overflow-hidden">
      {/* Company users get the standard Navigation */}
      {!isMobile && isCompany && (
        <Navigation
          hidePostJobLink
          tabs={companyTabs}
          sidebarNavItems={[
            { id: "jobs", label: tCompany("nav.jobs"), onClick: () => setLocation("/company-dashboard/jobs") },
            { id: "team", label: tCompany("nav.team"), onClick: () => setLocation("/company-dashboard/team") },
            { id: "timesheets", label: tCompany("timesheet.title"), onClick: () => setLocation("/company-dashboard/timesheets") },
            { id: "chats", label: tCompany("nav.messages"), onClick: () => setLocation("/company-dashboard/chats") },
          ]}
        />
      )}

      {/* Worker Global Header - Full navigation with tabs (desktop only, matches TodayPage) */}
      {profile?.role === 'worker' && !isMobile && (
        <header className="flex flex-col sticky top-0 z-50 bg-background border-b border-border">
          <div className="px-4 py-3 flex items-center justify-between">
            <div className="flex items-center gap-4 md:gap-6">
              <span 
                className="text-lg md:text-xl font-bold cursor-pointer hover:text-primary transition-colors"
                onClick={() => setLocation("/dashboard/today")}
                data-testid="logo-link"
              >
                {tNav("nav.brandName")}
              </span>
              {/* Desktop navigation - AnimatedNavigationTabs style */}
              {!isMobile && (
                <div className="overflow-x-auto scrollbar-hide">
                  <AnimatedNavigationTabs
                    items={workerTabsItems}
                    value="chats"
                    onValueChange={() => {}}
                  />
                </div>
              )}
            </div>
            <div className="flex items-center gap-2 md:gap-3">
              {/* Notifications */}
              <Popover>
                <PopoverTrigger asChild>
                  <Button 
                    variant="ghost" 
                    size="icon" 
                    className="relative"
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
                </PopoverTrigger>
                <PopoverContent className="w-80 p-0" align="end">
                  <div className="p-3 border-b border-border flex items-center justify-between">
                    <h3 className="font-semibold">{tToday("notifications.title")}</h3>
                  </div>
                  <ScrollArea className="max-h-[400px]" data-testid="notifications-list">
                    {!notifications || notifications.length === 0 ? (
                      <div className="p-4 text-center text-muted-foreground" data-testid="notifications-empty">
                        <Bell className="w-8 h-8 mx-auto mb-2 opacity-50" />
                        <p className="text-sm">{tToday("empty.noNotifications")}</p>
                      </div>
                    ) : (
                      <div className="divide-y divide-border">
                        {notifications.slice(0, 20).map((notif: any) => (
                          <div 
                            key={notif.id}
                            className={`p-3 cursor-pointer hover:bg-muted/50 transition-colors ${!notif.isRead ? "bg-primary/5" : ""}`}
                            onClick={() => {
                              // Use deep linking based on notification type and data
                              const data = notif.data || {};
                              if (tryOpenTimesheetApprovalInvoiceFromNotification(notif, openTimesheetApprovalInvoice)) {
                                return;
                              }
                              if (notif.url) {
                                // External URLs (e.g. call invite) open in new tab so the action opens that exact call
                                if (notif.url.startsWith("http://") || notif.url.startsWith("https://")) {
                                  window.open(notif.url, "_blank", "noopener,noreferrer");
                                  return;
                                }
                                setLocation(notif.url);
                                return;
                              }
                              
                              if (notif.type === "call_invite" && data.roomUrl) {
                                const callUrl = typeof data.roomUrl === "string" ? data.roomUrl : (data as any).url;
                                if (callUrl && (callUrl.startsWith("http://") || callUrl.startsWith("https://"))) {
                                  window.open(callUrl, "_blank", "noopener,noreferrer");
                                  return;
                                }
                              }
                              if (notif.type === "new_message") {
                                setLocation(data.jobId ? `/accepted-job/${data.jobId}` : "/dashboard/chats");
                              } else if (notif.type === "new_job_in_territory" || notif.type === "new_job_posted") {
                                setLocation(data.jobId ? `/jobs/${data.jobId}` : "/dashboard/find");
                              } else if (notif.type === "application_approved" || notif.type === "job_application_accepted") {
                                setLocation(data.jobId ? `/dashboard/jobs?jobId=${data.jobId}&tab=active` : "/dashboard/jobs");
                              } else if (notif.type === "timesheet_approved" || notif.type === "payment_received") {
                                setLocation(data.timesheetId ? `/dashboard/settings/payouts?timesheetId=${data.timesheetId}` : "/dashboard/settings/payouts");
                              } else if (notif.type === "job_reminder" || notif.type === "job_start_reminder") {
                                setLocation(data.jobId ? `/dashboard/calendar?jobId=${data.jobId}` : "/dashboard/calendar");
                              } else {
                                setLocation("/dashboard/today");
                              }
                            }}
                            data-testid={`notification-item-${notif.id}`}
                          >
                            <div className="flex items-start gap-3">
                              <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 bg-muted">
                                <Bell className="w-4 h-4 text-muted-foreground" />
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
                </PopoverContent>
              </Popover>
              {isEmployee ? (
                <>
                <Popover>
                  <PopoverTrigger asChild>
                    <Avatar 
                      className="w-8 h-8 md:w-9 md:h-9 cursor-pointer hover:ring-2 hover:ring-primary/50 transition-all"
                      data-testid="header-avatar"
                    >
                      <AvatarImage src={displayAvatarUrl || undefined} />
                      <AvatarFallback>{displayName.firstName?.[0]}{displayName.lastName?.[0]}</AvatarFallback>
                    </Avatar>
                  </PopoverTrigger>
                  <PopoverContent className="w-80 p-0" align="end">
                    <div className="p-4 space-y-4">
                      <div className="flex items-center gap-4">
                        <Avatar className="w-16 h-16">
                          <AvatarImage src={displayAvatarUrl || undefined} />
                          <AvatarFallback className="text-lg">
                            {displayName.firstName?.[0]}{displayName.lastName?.[0]}
                          </AvatarFallback>
                        </Avatar>
                        <div className="flex-1 min-w-0">
                          <h3 className="font-semibold text-lg truncate">
                            {displayName.firstName} {displayName.lastName}
                          </h3>
                          <p className="text-sm text-muted-foreground truncate">
                            {profile?.email}
                          </p>
                        </div>
                      </div>
                      <Separator />
                      <Button
                        variant="outline"
                        className="w-full justify-start gap-2"
                        onClick={() => setShowTeammateSettings(true)}
                        data-testid="button-settings"
                      >
                        <Settings className="w-4 h-4" />
                        Settings
                      </Button>
                      <Button
                        variant="outline"
                        className="w-full justify-start gap-2"
                        onClick={() => logout()}
                        disabled={isLoggingOut}
                        data-testid="button-logout"
                      >
                        <LogOut className="w-4 h-4" />
                        {isLoggingOut ? "Logging out..." : "Log Out"}
                      </Button>
                    </div>
                  </PopoverContent>
                </Popover>
                <TeammateSettingsDialog
                  open={showTeammateSettings}
                  onOpenChange={setShowTeammateSettings}
                  profileId={profile?.id}
                />
              </>
              ) : (
                <Avatar 
                  className="w-8 h-8 md:w-9 md:h-9 cursor-pointer hover:ring-2 hover:ring-primary/50 transition-all"
                  onClick={() => setLocation("/dashboard/menu")}
                  data-testid="header-avatar"
                >
                  <AvatarImage src={displayAvatarUrl || undefined} />
                  <AvatarFallback>{displayName.firstName?.[0]}{displayName.lastName?.[0]}</AvatarFallback>
                </Avatar>
              )}
            </div>
          </div>
        </header>
      )}
      
      <div className="flex-1 flex overflow-hidden">
        <div className="w-80 border-r border-border flex flex-col">
          <div className="flex-1 overflow-y-auto">
            {jobsLoading ? (
              <div className="flex justify-center py-12">
                <Loader2 className="w-6 h-6 animate-spin" />
              </div>
            ) : !filteredChatJobs || filteredChatJobs.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
                <MessageSquare className="w-10 h-10 text-muted-foreground mb-3" />
                <h3 className="font-medium mb-1">{t("noActiveChats")}</h3>
                <p className="text-xs text-muted-foreground">
                  {profile?.role === 'company' 
                    ? t("chatsAppearInProgress")
                    : t("chatsAppearAccepted")}
                </p>
              </div>
            ) : (
              <div className="divide-y divide-border">
                {searchedChatJobs.map(({ job, participants, unreadCount }) => {
                  const isSelected = selectedJobId === job.id;
                  const isUnread = unreadCount > 0 && !viewedJobIds.has(job.id);
                  return (
                    <ChatJobListRow
                      key={job.id}
                      job={job}
                      participants={participants}
                      unreadCount={unreadCount}
                      isUnread={isUnread}
                      isSelected={isSelected}
                      onSelect={() => setSelectedJobId(job.id)}
                      noParticipantsLabel={t("noParticipants")}
                    />
                  )})}
              </div>
            )}
          </div>
        </div>
        
        <div className="flex-1 flex flex-col">
          {selectedJobId ? (
            <ChatSection />
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-center px-4">
              <MessageSquare className="w-16 h-16 text-muted-foreground mb-4" />
              <h2 className="text-lg font-semibold mb-2">{t("selectAChat")}</h2>
              <p className="text-sm text-muted-foreground max-w-xs">
                {t("chooseJobToViewMessages")}
              </p>
            </div>
          )}
        </div>
        
        {/* Desktop: side panel. Tablet: popup (ResponsiveDialog/Drawer) */}
        <JobDetailsPanel
          job={jobForDetailsPanel}
          participants={selectedJob?.participants || []}
          isOpen={showJobDetails && !!selectedJobId}
          onClose={() => setShowJobDetails(false)}
          isMobile={!isDesktop}
          isCompany={isCompany}
          onMarkComplete={isCompany ? (jobId, jobTitle) => {
            setMarkCompleteJobId(jobId);
            setMarkCompleteJobTitle(jobTitle);
          } : undefined}
          onStartCallForParticipant={PEERCALLS_BASE_URL && selectedJobId ? handleStartCallForParticipant : undefined}
        />
      </div>
      
      <ParticipantInfoPopup />
      <MapPopup />
      <CallInviteDialog />
      <CallingDialog
            open={callingDialogOpen}
            onEndCall={handleEndCall}
            callElapsedFormatted={callElapsedFormatted}
            profile={profile ?? null}
            otherParticipants={otherParticipants}
            callStarterProfileId={callStarterProfileId}
          />
      {imagePreview && (
        <div
          className="fixed inset-0 z-[100] bg-black/95 flex items-center justify-center"
          onClick={() => setImagePreview(null)}
          role="button"
          aria-label="Close image preview"
        >
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setImagePreview(null); }}
            className="absolute top-4 right-4 z-10 p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
            aria-label="Close"
          >
            <X className="w-8 h-8" />
          </button>
          {imagePreview.urls.length > 1 && (
            <>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  if (imagePreview.index > 0) setImagePreview({ ...imagePreview, index: imagePreview.index - 1 });
                }}
                disabled={imagePreview.index === 0}
                className="absolute left-4 top-1/2 -translate-y-1/2 z-10 p-3 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors disabled:opacity-30 disabled:pointer-events-none"
                aria-label="Previous"
              >
                <ChevronLeft className="w-8 h-8" />
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  if (imagePreview.index < imagePreview.urls.length - 1) setImagePreview({ ...imagePreview, index: imagePreview.index + 1 });
                }}
                disabled={imagePreview.index === imagePreview.urls.length - 1}
                className="absolute right-4 top-1/2 -translate-y-1/2 z-10 p-3 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors disabled:opacity-30 disabled:pointer-events-none"
                aria-label="Next"
              >
                <ChevronRight className="w-8 h-8" />
              </button>
              <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 px-3 py-1 rounded-full bg-black/50 text-white text-sm">
                {imagePreview.index + 1} / {imagePreview.urls.length}
              </div>
            </>
          )}
          <img
            src={imagePreview.urls[imagePreview.index]}
            alt=""
            className="max-w-full max-h-full object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}

      <MobileNotificationsPopup />
    </div>
  );
}
