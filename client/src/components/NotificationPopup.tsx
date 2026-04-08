import { useState, useEffect } from "react";
import { 
  Bell, Check, CheckCheck, Trash2, Smartphone, Monitor, Tablet, Loader2,
  Briefcase, Clock, DollarSign, User, MapPin, AlertCircle, Calendar,
  FileText, Settings, Users, Star, MessageSquare, CreditCard, Building,
  CheckCircle, XCircle, Send, Eye, Zap, Gift, Shield, TrendingUp, ArrowRight, ExternalLink
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { MobilePopup } from "@/components/ui/mobile-popup";
import { useIsMobile } from "@/hooks/use-mobile";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { useNotifications } from "@/hooks/use-notifications";
import { useProfile, useUpdateProfile } from "@/hooks/use-profiles";
import { useToast } from "@/hooks/use-toast";
import { formatDistanceToNow } from "date-fns";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { useTimesheetApprovalInvoice } from "@/contexts/TimesheetApprovalInvoiceContext";
import { tryOpenTimesheetApprovalInvoiceFromNotification } from "@/lib/worker-timesheet-notification";

interface NotificationPopupProps {
  profileId: number | undefined;
}

// Notification type categories for routing and icons
type NotificationType = 
  // Job-related
  | "new_job_posted" | "job_application_received" | "job_application_accepted" 
  | "job_application_rejected" | "job_cancelled" | "job_updated" | "job_reminder"
  | "job_started" | "job_completed" | "job_rescheduled" | "direct_job_request"
  // Timesheet-related
  | "timesheet_submitted" | "timesheet_approved" | "timesheet_rejected"
  | "timesheet_auto_approved" | "timesheet_edited" | "clock_in_reminder"
  | "clock_out_reminder" | "overtime_alert"
  // Payment-related
  | "payment_received" | "payment_sent" | "payout_pending" | "payout_completed"
  | "balance_low" | "auto_recharge_triggered" | "invoice_generated"
  | "payment_method_added" | "payment_failed" | "escrow_released"
  // Team-related
  | "team_member_joined" | "team_member_invited" | "team_member_removed"
  | "worker_added_to_team" | "worker_removed_from_team"
  // Profile/Account
  | "profile_verified" | "profile_incomplete" | "rating_received"
  | "skill_endorsed" | "badge_earned" | "account_warning"
  // Calendar
  | "calendar_conflict" | "calendar_synced" | "event_reminder"
  // System
  | "welcome" | "feature_update" | "maintenance" | "security_alert"
  | "general";

export function NotificationPopup({ profileId }: NotificationPopupProps) {
  const [open, setOpen] = useState(false);
  const [, setLocation] = useLocation();
  const { openTimesheetApprovalInvoice } = useTimesheetApprovalInvoice();
  const isMobile = useIsMobile();
  const { toast } = useToast();
  const { t } = useTranslation();
  const { t: tCommon } = useTranslation("common");
  const { data: profile } = useProfile(profileId ? undefined : undefined);
  const updateProfile = useUpdateProfile();
  const {
    notifications,
    deviceTokens,
    unreadCount,
    isLoadingNotifications,
    isLoadingDevices,
    isSupported,
    isCurrentDeviceRegistered,
    enableNotifications,
    removeDevice,
    markAsRead,
    markAllAsRead,
    isEnabling,
  } = useNotifications(profileId);

  // Unified notification settings state based on profile preferences
  const [localSettings, setLocalSettings] = useState({
    // Email notifications
    emailNewApplications: profile?.notifyNewJobs ?? true,
    emailTimesheets: profile?.notifyJobUpdates ?? true,
    emailPayments: profile?.notifyPayments ?? true,
    emailMessages: profile?.notifyMessages ?? true,
    // SMS notifications
    smsNewApplications: (profile?.smsNotifications ?? true) && (profile?.notifyNewJobs ?? true),
    smsTimesheets: (profile?.smsNotifications ?? true) && (profile?.notifyJobUpdates ?? true),
    smsPayments: (profile?.smsNotifications ?? true) && (profile?.notifyPayments ?? true),
    smsMessages: (profile?.smsNotifications ?? true) && (profile?.notifyMessages ?? true),
    // Push notifications
    pushNewApplications: (profile?.pushNotifications ?? true) && (profile?.notifyNewJobs ?? true),
    pushTimesheets: (profile?.pushNotifications ?? true) && (profile?.notifyJobUpdates ?? true),
    pushPayments: (profile?.pushNotifications ?? true) && (profile?.notifyPayments ?? true),
    pushMessages: (profile?.pushNotifications ?? true) && (profile?.notifyMessages ?? true),
    // Global toggles
    emailNotifications: profile?.emailNotifications ?? true,
    smsNotifications: profile?.smsNotifications ?? true,
    pushNotifications: profile?.pushNotifications ?? true,
  });

  // Update local settings when profile changes
  useEffect(() => {
    if (profile) {
      setLocalSettings({
        emailNewApplications: profile.notifyNewJobs ?? true,
        emailTimesheets: profile.notifyJobUpdates ?? true,
        emailPayments: profile.notifyPayments ?? true,
        emailMessages: profile.notifyMessages ?? true,
        smsNewApplications: (profile.smsNotifications ?? true) && (profile.notifyNewJobs ?? true),
        smsTimesheets: (profile.smsNotifications ?? true) && (profile.notifyJobUpdates ?? true),
        smsPayments: (profile.smsNotifications ?? true) && (profile.notifyPayments ?? true),
        smsMessages: (profile.smsNotifications ?? true) && (profile.notifyMessages ?? true),
        pushNewApplications: (profile.pushNotifications ?? true) && (profile.notifyNewJobs ?? true),
        pushTimesheets: (profile.pushNotifications ?? true) && (profile.notifyJobUpdates ?? true),
        pushPayments: (profile.pushNotifications ?? true) && (profile.notifyPayments ?? true),
        pushMessages: (profile.pushNotifications ?? true) && (profile.notifyMessages ?? true),
        emailNotifications: profile.emailNotifications ?? true,
        smsNotifications: profile.smsNotifications ?? true,
        pushNotifications: profile.pushNotifications ?? true,
      });
    }
  }, [profile]);

  const handleSaveNotificationSettings = async () => {
    if (!profile) return;
    
    try {
      await updateProfile.mutateAsync({
        id: profile.id,
        data: {
          emailNotifications: localSettings.emailNotifications,
          smsNotifications: localSettings.smsNotifications,
          pushNotifications: localSettings.pushNotifications,
          notifyNewJobs: localSettings.emailNewApplications || localSettings.smsNewApplications || localSettings.pushNewApplications,
          notifyJobUpdates: localSettings.emailTimesheets || localSettings.smsTimesheets || localSettings.pushTimesheets,
          notifyPayments: localSettings.emailPayments || localSettings.smsPayments || localSettings.pushPayments,
          notifyMessages: localSettings.emailMessages || localSettings.smsMessages || localSettings.pushMessages,
        },
      });
      
      toast({
        title: t("notifications.settingsSaved"),
        description: t("notifications.preferencesUpdated"),
      });
    } catch (error: any) {
      toast({
        title: tCommon("error"),
        description: error.message || t("notifications.failedToSave"),
        variant: "destructive",
      });
    }
  };

  // Get icon based on notification type
  const getNotificationIcon = (type: string) => {
    const iconMap: Record<string, React.ReactNode> = {
      // Job-related
      new_job_posted: <Briefcase className="w-4 h-4 text-blue-500" />,
      job_application_received: <User className="w-4 h-4 text-purple-500" />,
      new_application: <User className="w-4 h-4 text-purple-500" />,
      job_application_accepted: <CheckCircle className="w-4 h-4 text-green-500" />,
      job_application_rejected: <XCircle className="w-4 h-4 text-red-500" />,
      job_cancelled: <XCircle className="w-4 h-4 text-red-500" />,
      job_updated: <Briefcase className="w-4 h-4 text-blue-500" />,
      job_reminder: <AlertCircle className="w-4 h-4 text-orange-500" />,
      job_started: <Zap className="w-4 h-4 text-green-500" />,
      job_completed: <CheckCircle className="w-4 h-4 text-green-500" />,
      job_rescheduled: <Calendar className="w-4 h-4 text-orange-500" />,
      direct_job_request: <Send className="w-4 h-4 text-purple-500" />,
      // Timesheet-related
      timesheet_submitted: <Clock className="w-4 h-4 text-blue-500" />,
      timesheet_approved: <CheckCircle className="w-4 h-4 text-green-500" />,
      timesheet_rejected: <XCircle className="w-4 h-4 text-red-500" />,
      timesheet_auto_approved: <Check className="w-4 h-4 text-green-500" />,
      timesheet_edited: <FileText className="w-4 h-4 text-orange-500" />,
      clock_in_reminder: <Clock className="w-4 h-4 text-orange-500" />,
      clock_out_reminder: <Clock className="w-4 h-4 text-orange-500" />,
      overtime_alert: <AlertCircle className="w-4 h-4 text-red-500" />,
      // Payment-related
      payment_received: <DollarSign className="w-4 h-4 text-green-500" />,
      payment_sent: <DollarSign className="w-4 h-4 text-green-500" />,
      payout_pending: <Clock className="w-4 h-4 text-orange-500" />,
      payout_completed: <DollarSign className="w-4 h-4 text-green-500" />,
      balance_low: <AlertCircle className="w-4 h-4 text-red-500" />,
      auto_recharge_triggered: <CreditCard className="w-4 h-4 text-blue-500" />,
      invoice_generated: <FileText className="w-4 h-4 text-blue-500" />,
      payment_method_added: <CreditCard className="w-4 h-4 text-green-500" />,
      payment_failed: <XCircle className="w-4 h-4 text-red-500" />,
      escrow_released: <DollarSign className="w-4 h-4 text-green-500" />,
      // Team-related
      team_member_joined: <Users className="w-4 h-4 text-blue-500" />,
      team_member_invited: <Send className="w-4 h-4 text-purple-500" />,
      team_member_removed: <Users className="w-4 h-4 text-red-500" />,
      worker_added_to_team: <User className="w-4 h-4 text-green-500" />,
      worker_removed_from_team: <User className="w-4 h-4 text-red-500" />,
      // Profile/Account
      profile_verified: <Shield className="w-4 h-4 text-green-500" />,
      profile_incomplete: <AlertCircle className="w-4 h-4 text-orange-500" />,
      rating_received: <Star className="w-4 h-4 text-yellow-500" />,
      skill_endorsed: <TrendingUp className="w-4 h-4 text-blue-500" />,
      badge_earned: <Gift className="w-4 h-4 text-purple-500" />,
      account_warning: <AlertCircle className="w-4 h-4 text-red-500" />,
      // Calendar
      calendar_conflict: <Calendar className="w-4 h-4 text-red-500" />,
      calendar_synced: <Calendar className="w-4 h-4 text-green-500" />,
      event_reminder: <Calendar className="w-4 h-4 text-orange-500" />,
      // System
      welcome: <Gift className="w-4 h-4 text-purple-500" />,
      feature_update: <Zap className="w-4 h-4 text-blue-500" />,
      maintenance: <Settings className="w-4 h-4 text-orange-500" />,
      security_alert: <Shield className="w-4 h-4 text-red-500" />,
      general: <Bell className="w-4 h-4 text-muted-foreground" />,
    };
    return iconMap[type] || <Bell className="w-4 h-4 text-muted-foreground" />;
  };

  // Get background color for notification icon based on type
  const getIconBackground = (type: string, isRead: boolean) => {
    if (isRead) return "bg-muted";
    
    const bgMap: Record<string, string> = {
      // Green - success/accepted
      job_application_accepted: "bg-green-100 dark:bg-green-900/30",
      job_completed: "bg-green-100 dark:bg-green-900/30",
      timesheet_approved: "bg-green-100 dark:bg-green-900/30",
      payment_received: "bg-green-100 dark:bg-green-900/30",
      payout_completed: "bg-green-100 dark:bg-green-900/30",
      profile_verified: "bg-green-100 dark:bg-green-900/30",
      // Red - rejected/failed/warning
      job_application_rejected: "bg-red-100 dark:bg-red-900/30",
      job_cancelled: "bg-red-100 dark:bg-red-900/30",
      timesheet_rejected: "bg-red-100 dark:bg-red-900/30",
      payment_failed: "bg-red-100 dark:bg-red-900/30",
      balance_low: "bg-red-100 dark:bg-red-900/30",
      calendar_conflict: "bg-red-100 dark:bg-red-900/30",
      security_alert: "bg-red-100 dark:bg-red-900/30",
      // Orange - pending/reminder
      job_reminder: "bg-orange-100 dark:bg-orange-900/30",
      clock_in_reminder: "bg-orange-100 dark:bg-orange-900/30",
      clock_out_reminder: "bg-orange-100 dark:bg-orange-900/30",
      payout_pending: "bg-orange-100 dark:bg-orange-900/30",
      job_rescheduled: "bg-orange-100 dark:bg-orange-900/30",
      profile_incomplete: "bg-orange-100 dark:bg-orange-900/30",
      // Blue - info/new
      new_job_posted: "bg-blue-100 dark:bg-blue-900/30",
      timesheet_submitted: "bg-blue-100 dark:bg-blue-900/30",
      invoice_generated: "bg-blue-100 dark:bg-blue-900/30",
      auto_recharge_triggered: "bg-blue-100 dark:bg-blue-900/30",
      // Purple - actions/requests
      job_application_received: "bg-purple-100 dark:bg-purple-900/30",
      direct_job_request: "bg-purple-100 dark:bg-purple-900/30",
      team_member_invited: "bg-purple-100 dark:bg-purple-900/30",
      welcome: "bg-purple-100 dark:bg-purple-900/30",
      badge_earned: "bg-purple-100 dark:bg-purple-900/30",
    };
    return bgMap[type] || "bg-primary/10";
  };

  // Route notifications to the appropriate location with deep links
  const getNotificationRoute = (notification: any): string | null => {
    const type = notification.type as NotificationType;
    const data = notification.data || {};
    
    // Build deep links with query parameters based on notification type and data
    // Prefer routeMap over notification.url - server URLs may be wrong for user context (e.g. /dashboard for company)
    const routeMap: Record<string, () => string | null> = {
      // Job-related - deep link to specific jobs
      new_job_posted: () => data.jobId ? `/jobs/${data.jobId}` : "/dashboard/find",
      new_job_in_territory: () => data.jobId ? `/jobs/${data.jobId}` : "/dashboard/find",
      job_application_received: () => {
        if (data.jobId) return `/company-dashboard/jobs?jobId=${data.jobId}&tab=applications`;
        if (data.applicationId) return `/company-dashboard/jobs?applicationId=${data.applicationId}`;
        return "/company-dashboard/jobs";
      },
      job_application_accepted: () => {
        if (data.jobId) return `/dashboard/jobs?jobId=${data.jobId}&tab=active`;
        return "/dashboard/jobs";
      },
      job_application_rejected: () => {
        if (data.jobId) return `/dashboard/jobs?jobId=${data.jobId}&tab=history`;
        return "/dashboard/jobs";
      },
      job_offer_received: () => {
        if (data.jobId) return `/dashboard/jobs?jobId=${data.jobId}&tab=offers`;
        return "/dashboard/jobs";
      },
      application_approved: () => {
        if (data.jobId) return `/dashboard/jobs?jobId=${data.jobId}&tab=active`;
        return "/dashboard/jobs";
      },
      application_rejected: () => {
        if (data.jobId) return `/dashboard/jobs?jobId=${data.jobId}&tab=history`;
        return "/dashboard/jobs";
      },
      job_cancelled: () => {
        if (data.jobId) return `/dashboard/jobs?jobId=${data.jobId}`;
        return "/dashboard/jobs";
      },
      job_updated: () => {
        if (data.jobId) return `/jobs/${data.jobId}`;
        return "/dashboard/find";
      },
      job_reminder: () => {
        if (data.jobId) return `/dashboard/calendar?jobId=${data.jobId}`;
        return "/dashboard/calendar";
      },
      job_start_reminder: () => {
        if (data.jobId) return `/dashboard/calendar?jobId=${data.jobId}`;
        return "/dashboard/calendar";
      },
      job_started: () => {
        if (data.jobId) return `/dashboard/jobs?jobId=${data.jobId}&tab=active`;
        return "/dashboard/jobs";
      },
      job_completed: () => {
        if (data.jobId) return `/dashboard/jobs?jobId=${data.jobId}&tab=history`;
        return "/dashboard/jobs";
      },
      job_rescheduled: () => {
        if (data.jobId) return `/dashboard/calendar?jobId=${data.jobId}`;
        return "/dashboard/calendar";
      },
      direct_job_request: () => {
        if (data.jobId) return `/dashboard/jobs?jobId=${data.jobId}`;
        return "/dashboard/jobs";
      },
      
      // Timesheet-related - deep link to specific timesheets
      timesheet_submitted: () => {
        if (data.timesheetId) return `/company-dashboard/timesheets?timesheetId=${data.timesheetId}`;
        if (data.jobId) return `/company-dashboard/timesheets?jobId=${data.jobId}`;
        return "/company-dashboard/timesheets";
      },
      timesheet_approved: () => {
        if (data.timesheetId) return `/dashboard/settings/payouts?timesheetId=${data.timesheetId}`;
        return "/dashboard/settings/payouts";
      },
      timesheet_rejected: () => {
        if (data.timesheetId) return `/dashboard/jobs?timesheetId=${data.timesheetId}`;
        if (data.jobId) return `/dashboard/jobs?jobId=${data.jobId}`;
        return "/dashboard/jobs";
      },
      timesheet_auto_approved: () => {
        if (data.timesheetId) return `/dashboard/settings/payouts?timesheetId=${data.timesheetId}`;
        return "/dashboard/settings/payouts";
      },
      timesheet_edited: () => {
        if (data.timesheetId) return `/company-dashboard/timesheets?timesheetId=${data.timesheetId}`;
        return "/company-dashboard/timesheets";
      },
      timesheet_reported: () => {
        if (data.timesheetId) return `/dashboard/strikes?timesheetId=${data.timesheetId}`;
        return "/dashboard/strikes";
      },
      clock_in_reminder: () => {
        if (data.jobId) return `/dashboard/jobs?jobId=${data.jobId}&action=clockin`;
        return "/dashboard/jobs";
      },
      clock_out_reminder: () => {
        if (data.jobId) return `/dashboard/jobs?jobId=${data.jobId}&action=clockout`;
        return "/dashboard/jobs";
      },
      overtime_alert: () => {
        if (data.timesheetId) return `/company-dashboard/timesheets?timesheetId=${data.timesheetId}`;
        return "/company-dashboard/timesheets";
      },
      
      // Payment-related - deep link to specific payments
      payment_received: () => {
        if (data.timesheetId) return `/dashboard/settings/payouts?timesheetId=${data.timesheetId}`;
        return "/dashboard/settings/payouts";
      },
      payment_sent: () => {
        if (data.timesheetId) return `/company-dashboard/timesheets?timesheetId=${data.timesheetId}`;
        return "/company-dashboard/timesheets";
      },
      payout_pending: () => {
        if (data.payoutId) return `/dashboard/settings/payouts?payoutId=${data.payoutId}`;
        return "/dashboard/settings/payouts";
      },
      payout_completed: () => {
        if (data.payoutId) return `/dashboard/settings/payouts?payoutId=${data.payoutId}`;
        return "/dashboard/settings/payouts";
      },
      balance_low: () => "/company-dashboard/menu/balance",
      balance_topped_up: () => "/company-dashboard/menu/billing",
      auto_recharge_triggered: () => "/company-dashboard/menu/balance",
      invoice_generated: () => {
        if (data.invoiceId) return `/company-dashboard/menu/billing?invoiceId=${data.invoiceId}`;
        return "/company-dashboard/menu/billing";
      },
      payment_method_added: () => "/company-dashboard/menu/payment-methods",
      payment_failed: () => "/company-dashboard/menu/payment-methods",
      escrow_released: () => {
        if (data.timesheetId) return `/dashboard/settings/payouts?timesheetId=${data.timesheetId}`;
        return "/dashboard/settings/payouts";
      },
      
      // Team-related - deep link to team members
      team_member_joined: () => {
        if (data.teamMemberId) return `/company-dashboard/team?memberId=${data.teamMemberId}`;
        return "/company-dashboard/team";
      },
      team_member_invited: () => {
        if (data.inviteId) return `/company-dashboard/team?inviteId=${data.inviteId}`;
        return "/company-dashboard/team";
      },
      team_member_removed: () => "/company-dashboard/team",
      worker_added_to_team: () => {
        if (data.workerId) return `/company-dashboard/team?workerId=${data.workerId}`;
        return "/company-dashboard/team";
      },
      worker_removed_from_team: () => "/company-dashboard/team",
      
      // Worker inquiry - deep link to application
      worker_inquiry: () => {
        if (data.jobId && data.workerId) return `/company-dashboard/jobs?jobId=${data.jobId}&workerId=${data.workerId}&tab=applications`;
        if (data.jobId) return `/company-dashboard/jobs?jobId=${data.jobId}&tab=applications`;
        if (data.applicationId) return `/company-dashboard/jobs?applicationId=${data.applicationId}`;
        return "/company-dashboard/jobs";
      },
      new_application: () => {
        if (data.jobId) return `/company-dashboard/jobs?jobId=${data.jobId}&tab=applications`;
        if (data.applicationId) return `/company-dashboard/jobs?applicationId=${data.applicationId}`;
        return "/company-dashboard/jobs";
      },
      worker_availability_updated: () => {
        if (data.jobId) return `/company-dashboard/jobs?jobId=${data.jobId}`;
        return "/company-dashboard/jobs";
      },
      worker_clocked_in: () => {
        if (data.timesheetId) return `/company-dashboard/timesheets?timesheetId=${data.timesheetId}`;
        if (data.jobId) return `/company-dashboard/jobs?jobId=${data.jobId}&tab=timesheets`;
        return "/company-dashboard/timesheets";
      },
      worker_clocked_out: () => {
        if (data.timesheetId) return `/company-dashboard/timesheets?timesheetId=${data.timesheetId}`;
        if (data.jobId) return `/company-dashboard/jobs?jobId=${data.jobId}&tab=timesheets`;
        return "/company-dashboard/timesheets";
      },
      
      // Profile/Account
      profile_verified: () => "/dashboard/settings/profile",
      profile_incomplete: () => "/worker-onboarding",
      rating_received: () => {
        if (data.jobId) return `/dashboard/jobs?jobId=${data.jobId}`;
        return "/dashboard/settings/profile";
      },
      skill_endorsed: () => "/dashboard/settings/profile",
      badge_earned: () => "/dashboard/settings/profile",
      account_warning: () => "/dashboard/settings/account",
      strike_issued: () => {
        if (data.timesheetId) return `/dashboard/strikes?timesheetId=${data.timesheetId}`;
        return "/dashboard/strikes";
      },
      account_terminated: () => "/",
      
      // Calendar
      calendar_conflict: () => {
        if (data.jobId) return `/dashboard/calendar?jobId=${data.jobId}&conflict=true`;
        return "/dashboard/calendar";
      },
      calendar_synced: () => "/dashboard/calendar",
      event_reminder: () => {
        if (data.jobId) return `/dashboard/calendar?jobId=${data.jobId}`;
        return "/dashboard/calendar";
      },
      
      // System - these don't navigate anywhere, just mark as read
      welcome: () => null,
      feature_update: () => null,
      maintenance: () => null,
      security_alert: () => "/dashboard/settings/account",
      marketing_post_job: () => "/post-job",
      general: () => null,
    };
    
    const routeFn = routeMap[type];
    const routeFromMap = routeFn ? routeFn() : null;
    if (routeFromMap) return routeFromMap;
    // Fallback: use notification.url when type not in routeMap (enhance with data if needed)
    if (notification.url) {
      let url = notification.url;
      if (data.jobId && !url.includes('jobId=') && !url.includes(`/jobs/${data.jobId}`)) {
        url += (url.includes('?') ? '&' : '?') + `jobId=${data.jobId}`;
      }
      if (data.timesheetId && !url.includes('timesheetId=')) {
        url += (url.includes('?') ? '&' : '?') + `timesheetId=${data.timesheetId}`;
      }
      if (data.applicationId && !url.includes('applicationId=')) {
        url += (url.includes('?') ? '&' : '?') + `applicationId=${data.applicationId}`;
      }
      return url;
    }
    return null;
  };

  const handleNotificationClick = (notification: any) => {
    if (!notification.isRead) {
      markAsRead(notification.id);
    }

    if (tryOpenTimesheetApprovalInvoiceFromNotification(notification, openTimesheetApprovalInvoice)) {
      setOpen(false);
      return;
    }

    const route = getNotificationRoute(notification);
    if (route) {
      setLocation(route);
      setOpen(false);
    }
  };

  const getDeviceIcon = (deviceType: string | null) => {
    if (deviceType === "android" || deviceType === "ios") {
      return <Smartphone className="w-5 h-5" />;
    }
    if (deviceType === "tablet") {
      return <Tablet className="w-5 h-5" />;
    }
    return <Monitor className="w-5 h-5" />;
  };

  // Get action text for notification types that have specific actions
  const getActionText = (notification: any): string | null => {
    const type = notification.type as NotificationType;
    const route = getNotificationRoute(notification);
    
    // Only show action text for notifications that have a destination
    if (!route) return null;
    
    const actionMap: Record<string, string> = {
      // Job-related
      new_job_posted: "View Job",
      new_job_in_territory: "View Job",
      job_application_received: "Review",
      job_application_accepted: "View Job",
      job_application_rejected: "View",
      job_offer_received: "View Offer",
      application_approved: "View Job",
      application_rejected: "View",
      job_updated: "View Job",
      job_reminder: "View Calendar",
      job_start_reminder: "View Job",
      job_started: "View Job",
      job_completed: "View Job",
      job_rescheduled: "View Calendar",
      direct_job_request: "View Job",
      
      // Timesheet-related
      timesheet_submitted: "Review",
      timesheet_approved: "View invoice",
      timesheet_rejected: "View",
      timesheet_auto_approved: "View invoice",
      timesheet_edited: "View Timesheet",
      timesheet_reported: "View Strikes",
      clock_in_reminder: "Clock In",
      clock_out_reminder: "Clock Out",
      overtime_alert: "View Timesheet",
      
      // Payment-related
      payment_received: "View Payment",
      payment_sent: "View Timesheet",
      payout_pending: "View Status",
      payout_completed: "View Payment",
      balance_low: "Top Up",
      balance_topped_up: "View History",
      auto_recharge_triggered: "View Balance",
      invoice_generated: "View Invoice",
      payment_method_added: "View Methods",
      payment_failed: "Fix Payment",
      escrow_released: "View Payment",
      
      // Team-related
      team_member_joined: "View Team",
      team_member_invited: "View Team",
      worker_inquiry: "View Application",
      new_application: "View Application",
      worker_availability_updated: "View Job",
      worker_clocked_in: "View Timesheet",
      worker_clocked_out: "View Timesheet",
      
      // Profile/Account
      profile_incomplete: "Complete",
      rating_received: "View",
      strike_issued: "View Strikes",
      
      // Calendar
      calendar_conflict: "Resolve",
      event_reminder: "View Calendar",
      
      // Marketing
      marketing_post_job: "Post Job",
    };
    return actionMap[type] || "View";
  };
  
  // Extract clickable links from notification body text
  const extractClickableLinks = (notification: any): Array<{ text: string; route: string }> => {
    const links: Array<{ text: string; route: string }> = [];
    const data = notification.data || {};
    const route = getNotificationRoute(notification);
    
    // Add main route as primary link
    if (route) {
      links.push({ text: "View Details", route });
    }
    
    // Add contextual links based on data
    if (data.jobId && !route?.includes(`jobId=${data.jobId}`) && !route?.includes(`/jobs/${data.jobId}`)) {
      links.push({ text: "View Job", route: `/jobs/${data.jobId}` });
    }
    if (data.timesheetId && !route?.includes(`timesheetId=${data.timesheetId}`)) {
      links.push({ text: "View Timesheet", route: `/company-dashboard/timesheets?timesheetId=${data.timesheetId}` });
    }
    if (data.workerId) {
      links.push({ text: "View Worker", route: `/company-dashboard/workers?workerId=${data.workerId}` });
    }
    if (data.applicationId) {
      links.push({ text: "View Application", route: `/company-dashboard/jobs?applicationId=${data.applicationId}` });
    }
    
    return links;
  };

  const triggerButton = (
    <Button
      variant="ghost"
      size="icon"
      className="relative"
      data-testid="button-notifications"
      {...(isMobile ? { onClick: () => setOpen(true) } : {})}
    >
      <Bell className="w-5 h-5" />
      {unreadCount > 0 && (
        <Badge
          variant="destructive"
          className="absolute -top-1 -right-1 h-5 w-5 p-0 flex items-center justify-center text-xs"
        >
          {unreadCount > 9 ? "9+" : unreadCount}
        </Badge>
      )}
    </Button>
  );

  const notificationContent = (
    <>
        {/* Header */}
        <div className="flex items-center justify-between gap-2 p-4 border-b">
          <div>
            <h3 className="font-semibold">{t("notifications.title")}</h3>
            {unreadCount > 0 && (
              <p className="text-xs text-muted-foreground">{t("notifications.unread", { count: unreadCount })}</p>
            )}
          </div>
          {notifications.length > 0 && unreadCount > 0 && (
            <Button 
              variant="ghost" 
              size="sm"
              onClick={() => markAllAsRead()}
              className="h-8 text-xs"
              data-testid="button-mark-all-read"
            >
              <CheckCheck className="w-3.5 h-3.5 mr-1" /> 
              {t("notifications.markAllRead")}
            </Button>
          )}
        </div>
        
        {/* Tabs using shadcn Tabs component */}
        <Tabs defaultValue="notifications" className="w-full">
          <TabsList className="w-full justify-start rounded-none border-b bg-transparent p-0">
            <TabsTrigger 
              value="notifications" 
              className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent"
              data-testid="tab-notifications"
            >
              {t("notifications.title")}
              {unreadCount > 0 && (
                <Badge className="ml-1.5 h-5 px-1.5 bg-primary text-primary-foreground text-xs">
                  {unreadCount}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger 
              value="devices" 
              className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent"
              data-testid="tab-devices"
            >
              {t("notifications.devices")}
              <Badge variant="secondary" className="ml-1.5 h-5 px-1.5 text-xs">
                {deviceTokens.length}
              </Badge>
            </TabsTrigger>
            <TabsTrigger 
              value="settings" 
              className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent"
              data-testid="tab-settings"
            >
              {t("settings.title")}
            </TabsTrigger>
          </TabsList>
          
          <TabsContent value="notifications" className="m-0">
            <ScrollArea className="h-[min(400px,60vh)]">
              {isLoadingNotifications ? (
                <div className="flex items-center justify-center h-32">
                  <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                </div>
              ) : notifications.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-32 text-muted-foreground">
                  <Bell className="w-10 h-10 mb-2 opacity-20" />
                  <p className="text-sm">{t("empty.noNotifications")}</p>
                </div>
              ) : (
                <div className="divide-y">
                  {notifications.map((notification) => {
                    const route = getNotificationRoute(notification);
                    const actionText = getActionText(notification);
                    const isClickable = !!route;
                    
                    return (
                      <div
                        key={notification.id}
                        className={`p-3 transition-all ${
                          !notification.isRead 
                            ? 'bg-primary/5 border-l-2 border-primary' 
                            : ''
                        } ${isClickable ? 'cursor-pointer hover-elevate hover:bg-muted/50 hover:border-l-primary/50' : ''} border-l-2 border-transparent`}
                        onClick={() => isClickable && handleNotificationClick(notification)}
                        data-testid={`notification-${notification.id}`}
                      >
                        <div className="flex items-start gap-3">
                          {/* Icon */}
                          <div className={`p-2 rounded-full flex-shrink-0 ${getIconBackground(notification.type, !!notification.isRead)}`}>
                            {getNotificationIcon(notification.type)}
                          </div>
                          
                          {/* Content */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-start justify-between gap-2">
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-1.5">
                                  <p className={`text-sm font-medium truncate ${notification.isRead ? 'text-muted-foreground' : ''}`}>
                                    {notification.title}
                                  </p>
                                  {!notification.isRead && (
                                    <div className="w-2 h-2 rounded-full bg-primary flex-shrink-0" />
                                  )}
                                </div>
                                <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">
                                  {(() => {
                                    // Make notification body more interactive with clickable elements
                                    const body = notification.body;
                                    const data = (notification.data || {}) as { jobId?: number };
                                    
                                    // If body contains quoted text (job titles, etc.), make them clickable
                                    const parts: Array<string | JSX.Element> = [];
                                    let lastIndex = 0;
                                    
                                    // Match quoted strings (job titles, etc.)
                                    const quoteRegex = /"([^"]+)"/g;
                                    let match;
                                    
                                    while ((match = quoteRegex.exec(body)) !== null) {
                                      // Add text before the match
                                      if (match.index > lastIndex) {
                                        parts.push(body.substring(lastIndex, match.index));
                                      }
                                      
                                      // Add clickable link for quoted text
                                      const quotedText = match[1];
                                      if (data.jobId) {
                                        parts.push(
                                          <button
                                            key={`link-${match.index}`}
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              setLocation(`/jobs/${data.jobId}`);
                                              setOpen(false);
                                              if (!notification.isRead) {
                                                markAsRead(notification.id);
                                              }
                                            }}
                                            className="text-primary hover:text-primary/80 hover:underline font-medium"
                                          >
                                            "{quotedText}"
                                          </button>
                                        );
                                      } else {
                                        parts.push(`"${quotedText}"`);
                                      }
                                      
                                      lastIndex = match.index + match[0].length;
                                    }
                                    
                                    // Add remaining text
                                    if (lastIndex < body.length) {
                                      parts.push(body.substring(lastIndex));
                                    }
                                    
                                    return parts.length > 0 ? parts : body;
                                  })()}
                                </p>
                                
                                {/* Clickable Links */}
                                {isClickable && (() => {
                                  const links = extractClickableLinks(notification);
                                  if (links.length === 0) return null;
                                  
                                  return (
                                    <div className="flex flex-wrap gap-2 mt-2 pt-2 border-t border-border/50">
                                      {links.map((link, idx) => (
                                        <button
                                          key={idx}
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            setLocation(link.route);
                                            setOpen(false);
                                            if (!notification.isRead) {
                                              markAsRead(notification.id);
                                            }
                                          }}
                                          className="text-xs text-primary hover:text-primary/80 hover:underline font-medium transition-colors flex items-center gap-1 px-2 py-1 rounded-md hover:bg-primary/5"
                                        >
                                          {link.text}
                                          <ArrowRight className="w-3 h-3" />
                                        </button>
                                      ))}
                                    </div>
                                  );
                                })()}
                              </div>
                            </div>
                            
                            {/* Footer with time and action */}
                            <div className="flex items-center justify-between gap-2 mt-2">
                              <p className="text-xs text-muted-foreground">
                                {notification.createdAt && formatDistanceToNow(new Date(notification.createdAt), { addSuffix: true })}
                              </p>
                              {actionText && (
                                <Badge 
                                  variant="secondary" 
                                  className="text-xs px-2 py-0.5 cursor-pointer hover:bg-secondary/80 transition-colors flex items-center gap-1"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    if (route) {
                                      setLocation(route);
                                      setOpen(false);
                                      if (!notification.isRead) {
                                        markAsRead(notification.id);
                                      }
                                    }
                                  }}
                                >
                                  {actionText}
                                  <ArrowRight className="w-3 h-3" />
                                </Badge>
                              )}
                              {isClickable && !actionText && (
                                <ArrowRight className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </ScrollArea>
            {notifications.length > 0 && (
              <div className="p-2 border-t border-border">
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full text-muted-foreground"
                  onClick={() => {
                    setOpen(false);
                    setLocation(
                      profile?.role === "company"
                        ? "/company-dashboard/notifications"
                        : "/dashboard/notifications"
                    );
                  }}
                  data-testid="notifications-view-all"
                >
                  {t("notificationsCenter.viewAll")}
                </Button>
              </div>
            )}
          </TabsContent>
          
          <TabsContent value="devices" className="m-0">
            <ScrollArea className="h-[min(400px,60vh)]">
              {/* Enable this device prompt */}
              {isSupported && !isCurrentDeviceRegistered && (
                <div className="p-3 border-b bg-muted/30">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-full bg-primary/10">
                        <Monitor className="w-4 h-4 text-primary" />
                      </div>
                      <div>
                        <p className="text-sm font-medium">{t("notifications.thisDevice")}</p>
                        <p className="text-xs text-muted-foreground">{t("notifications.notReceivingPush")}</p>
                      </div>
                    </div>
                    <Button 
                      size="sm"
                      onClick={() => enableNotifications()}
                      disabled={isEnabling}
                      data-testid="button-enable-this-device"
                    >
                      {isEnabling ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : null}
                      {t("banners.enable")}
                    </Button>
                  </div>
                </div>
              )}
              
              {isLoadingDevices ? (
                <div className="flex items-center justify-center h-32">
                  <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                </div>
              ) : deviceTokens.length === 0 && (!isSupported || isCurrentDeviceRegistered) ? (
                <div className="flex flex-col items-center justify-center h-32 text-muted-foreground">
                  <Smartphone className="w-10 h-10 mb-2 opacity-20" />
                  <p className="text-sm">{t("notifications.noDevicesConnected")}</p>
                  <p className="text-xs">{t("notifications.enableToReceiveUpdates")}</p>
                </div>
              ) : (
                <div className="divide-y">
                  {deviceTokens.map((device) => {
                    const isCurrentDevice = device.userAgent === navigator.userAgent;
                    return (
                      <div 
                        key={device.id} 
                        className={`p-3 ${isCurrentDevice ? 'bg-primary/5' : ''}`}
                        data-testid={`device-${device.id}`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-3">
                            <div className={`p-2 rounded-full ${isCurrentDevice ? 'bg-primary/10' : 'bg-muted'}`}>
                              {getDeviceIcon(device.deviceType)}
                            </div>
                            <div>
                              <div className="flex items-center gap-2 flex-wrap">
                                <p className="text-sm font-medium">{device.deviceName || t("notifications.unknownDevice")}</p>
                                {isCurrentDevice && (
                                  <Badge className="text-[10px] px-1.5 py-0 h-4 bg-primary/10 text-primary border-0">
                                    {t("notifications.current")}
                                  </Badge>
                                )}
                              </div>
                              <p className="text-xs text-muted-foreground">
                                {t("notifications.lastActive")}: {device.lastUsed && formatDistanceToNow(new Date(device.lastUsed), { addSuffix: true })}
                              </p>
                            </div>
                          </div>
                          <Button 
                            variant="ghost" 
                            size="icon"
                            className="h-8 w-8 flex-shrink-0"
                            onClick={() => removeDevice(device.id)}
                            data-testid={`button-remove-device-${device.id}`}
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </ScrollArea>
          </TabsContent>
          
          <TabsContent value="settings" className="m-0">
            <ScrollArea className="h-[min(400px,60vh)]">
              <div className="p-4 space-y-6">
                <div>
                  <h4 className="font-medium mb-3 text-sm">{t("notifications.emailNotifications")}</h4>
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <Label className="text-sm">New Worker Applications</Label>
                      <Switch 
                        checked={localSettings.emailNewApplications && localSettings.emailNotifications}
                        onCheckedChange={(checked) => {
                          setLocalSettings(prev => ({ ...prev, emailNewApplications: checked }));
                          if (!checked && !localSettings.emailTimesheets && !localSettings.emailPayments && !localSettings.emailMessages) {
                            setLocalSettings(prev => ({ ...prev, emailNotifications: false }));
                          }
                        }}
                        disabled={!localSettings.emailNotifications}
                        data-testid="switch-email-applications"
                      />
                    </div>
                    <div className="flex items-center justify-between">
                      <Label className="text-sm">{t("notifications.timesheetSubmissions")}</Label>
                      <Switch 
                        checked={localSettings.emailTimesheets && localSettings.emailNotifications}
                        onCheckedChange={(checked) => {
                          setLocalSettings(prev => ({ ...prev, emailTimesheets: checked }));
                          if (!checked && !localSettings.emailNewApplications && !localSettings.emailPayments && !localSettings.emailMessages) {
                            setLocalSettings(prev => ({ ...prev, emailNotifications: false }));
                          }
                        }}
                        disabled={!localSettings.emailNotifications}
                        data-testid="switch-email-timesheets"
                      />
                    </div>
                    <div className="flex items-center justify-between">
                      <Label className="text-sm">{t("notifications.paymentConfirmations")}</Label>
                      <Switch 
                        checked={localSettings.emailPayments && localSettings.emailNotifications}
                        onCheckedChange={(checked) => {
                          setLocalSettings(prev => ({ ...prev, emailPayments: checked }));
                          if (!checked && !localSettings.emailNewApplications && !localSettings.emailTimesheets && !localSettings.emailMessages) {
                            setLocalSettings(prev => ({ ...prev, emailNotifications: false }));
                          }
                        }}
                        disabled={!localSettings.emailNotifications}
                        data-testid="switch-email-payments"
                      />
                    </div>
                    <div className="flex items-center justify-between">
                      <Label className="text-sm">{tCommon("messages")}</Label>
                      <Switch 
                        checked={localSettings.emailMessages && localSettings.emailNotifications}
                        onCheckedChange={(checked) => {
                          setLocalSettings(prev => ({ ...prev, emailMessages: checked }));
                          if (!checked && !localSettings.emailNewApplications && !localSettings.emailTimesheets && !localSettings.emailPayments) {
                            setLocalSettings(prev => ({ ...prev, emailNotifications: false }));
                          }
                        }}
                        disabled={!localSettings.emailNotifications}
                        data-testid="switch-email-messages"
                      />
                    </div>
                  </div>
                </div>
                <Separator />
                <div>
                  <h4 className="font-medium mb-3 text-sm">{t("notifications.smsNotifications")}</h4>
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <Label className="text-sm">New Worker Applications</Label>
                      <Switch 
                        checked={localSettings.smsNewApplications && localSettings.smsNotifications}
                        onCheckedChange={(checked) => {
                          setLocalSettings(prev => ({ ...prev, smsNewApplications: checked }));
                          if (!checked && !localSettings.smsTimesheets && !localSettings.smsPayments && !localSettings.smsMessages) {
                            setLocalSettings(prev => ({ ...prev, smsNotifications: false }));
                          }
                        }}
                        disabled={!localSettings.smsNotifications}
                        data-testid="switch-sms-applications"
                      />
                    </div>
                    <div className="flex items-center justify-between">
                      <Label className="text-sm">{t("notifications.timesheetSubmissions")}</Label>
                      <Switch 
                        checked={localSettings.smsTimesheets && localSettings.smsNotifications}
                        onCheckedChange={(checked) => {
                          setLocalSettings(prev => ({ ...prev, smsTimesheets: checked }));
                          if (!checked && !localSettings.smsNewApplications && !localSettings.smsPayments && !localSettings.smsMessages) {
                            setLocalSettings(prev => ({ ...prev, smsNotifications: false }));
                          }
                        }}
                        disabled={!localSettings.smsNotifications}
                        data-testid="switch-sms-timesheets"
                      />
                    </div>
                    <div className="flex items-center justify-between">
                      <Label className="text-sm">{t("notifications.paymentConfirmations")}</Label>
                      <Switch 
                        checked={localSettings.smsPayments && localSettings.smsNotifications}
                        onCheckedChange={(checked) => {
                          setLocalSettings(prev => ({ ...prev, smsPayments: checked }));
                          if (!checked && !localSettings.smsNewApplications && !localSettings.smsTimesheets && !localSettings.smsMessages) {
                            setLocalSettings(prev => ({ ...prev, smsNotifications: false }));
                          }
                        }}
                        disabled={!localSettings.smsNotifications}
                        data-testid="switch-sms-payments"
                      />
                    </div>
                    <div className="flex items-center justify-between">
                      <Label className="text-sm">{tCommon("messages")}</Label>
                      <Switch 
                        checked={localSettings.smsMessages && localSettings.smsNotifications}
                        onCheckedChange={(checked) => {
                          setLocalSettings(prev => ({ ...prev, smsMessages: checked }));
                          if (!checked && !localSettings.smsNewApplications && !localSettings.smsTimesheets && !localSettings.smsPayments) {
                            setLocalSettings(prev => ({ ...prev, smsNotifications: false }));
                          }
                        }}
                        disabled={!localSettings.smsNotifications}
                        data-testid="switch-sms-messages"
                      />
                    </div>
                  </div>
                </div>
                <Separator />
                <div>
                  <h4 className="font-medium mb-3 text-sm">{t("notifications.pushNotifications")}</h4>
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <Label className="text-sm">New Worker Applications</Label>
                      <Switch 
                        checked={localSettings.pushNewApplications && localSettings.pushNotifications}
                        onCheckedChange={(checked) => {
                          setLocalSettings(prev => ({ ...prev, pushNewApplications: checked }));
                          if (!checked && !localSettings.pushTimesheets && !localSettings.pushPayments && !localSettings.pushMessages) {
                            setLocalSettings(prev => ({ ...prev, pushNotifications: false }));
                          }
                        }}
                        disabled={!localSettings.pushNotifications}
                        data-testid="switch-push-applications"
                      />
                    </div>
                    <div className="flex items-center justify-between">
                      <Label className="text-sm">{t("notifications.timesheetSubmissions")}</Label>
                      <Switch 
                        checked={localSettings.pushTimesheets && localSettings.pushNotifications}
                        onCheckedChange={(checked) => {
                          setLocalSettings(prev => ({ ...prev, pushTimesheets: checked }));
                          if (!checked && !localSettings.pushNewApplications && !localSettings.pushPayments && !localSettings.pushMessages) {
                            setLocalSettings(prev => ({ ...prev, pushNotifications: false }));
                          }
                        }}
                        disabled={!localSettings.pushNotifications}
                        data-testid="switch-push-timesheets"
                      />
                    </div>
                    <div className="flex items-center justify-between">
                      <Label className="text-sm">{t("notifications.paymentConfirmations")}</Label>
                      <Switch 
                        checked={localSettings.pushPayments && localSettings.pushNotifications}
                        onCheckedChange={(checked) => {
                          setLocalSettings(prev => ({ ...prev, pushPayments: checked }));
                          if (!checked && !localSettings.pushNewApplications && !localSettings.pushTimesheets && !localSettings.pushMessages) {
                            setLocalSettings(prev => ({ ...prev, pushNotifications: false }));
                          }
                        }}
                        disabled={!localSettings.pushNotifications}
                        data-testid="switch-push-payments"
                      />
                    </div>
                    <div className="flex items-center justify-between">
                      <Label className="text-sm">{tCommon("messages")}</Label>
                      <Switch 
                        checked={localSettings.pushMessages && localSettings.pushNotifications}
                        onCheckedChange={(checked) => {
                          setLocalSettings(prev => ({ ...prev, pushMessages: checked }));
                          if (!checked && !localSettings.pushNewApplications && !localSettings.pushTimesheets && !localSettings.pushPayments) {
                            setLocalSettings(prev => ({ ...prev, pushNotifications: false }));
                          }
                        }}
                        disabled={!localSettings.pushNotifications}
                        data-testid="switch-push-messages"
                      />
                    </div>
                  </div>
                </div>
                <Separator />
                <div className="flex items-center justify-between p-3 bg-muted/30 rounded-lg">
                  <div>
                    <Label className="text-sm font-medium">{t("notifications.enableAllEmail")}</Label>
                    <p className="text-xs text-muted-foreground">{t("notifications.masterToggleEmail")}</p>
                  </div>
                  <Switch 
                    checked={localSettings.emailNotifications}
                    onCheckedChange={(checked) => setLocalSettings(prev => ({ ...prev, emailNotifications: checked }))}
                    data-testid="switch-email-all"
                  />
                </div>
                <div className="flex items-center justify-between p-3 bg-muted/30 rounded-lg">
                  <div>
                    <Label className="text-sm font-medium">{t("notifications.enableAllSMS")}</Label>
                    <p className="text-xs text-muted-foreground">{t("notifications.masterToggleSMS")}</p>
                  </div>
                  <Switch 
                    checked={localSettings.smsNotifications}
                    onCheckedChange={(checked) => setLocalSettings(prev => ({ ...prev, smsNotifications: checked }))}
                    data-testid="switch-sms-all"
                  />
                </div>
                <div className="flex items-center justify-between p-3 bg-muted/30 rounded-lg">
                  <div>
                    <Label className="text-sm font-medium">{t("notifications.enableAllPush")}</Label>
                    <p className="text-xs text-muted-foreground">{t("notifications.masterTogglePush")}</p>
                  </div>
                  <Switch 
                    checked={localSettings.pushNotifications}
                    onCheckedChange={(checked) => setLocalSettings(prev => ({ ...prev, pushNotifications: checked }))}
                    data-testid="switch-push-all"
                  />
                </div>
              </div>
            </ScrollArea>
            <div className="p-4 border-t flex gap-2">
              <Button 
                variant="outline" 
                size="sm" 
                className="flex-1"
                onClick={() => setOpen(false)}
                data-testid="button-cancel-settings"
              >
                {tCommon("cancel")}
              </Button>
                <Button 
                size="sm" 
                className="flex-1"
                onClick={() => {
                  handleSaveNotificationSettings();
                  setOpen(false);
                }}
                data-testid="button-save-settings"
              >
                {tCommon("saveChanges")}
              </Button>
            </div>
          </TabsContent>
        </Tabs>
    </>
  );

  if (isMobile) {
    return (
      <>
        {triggerButton}
        <MobilePopup
          open={open}
          onOpenChange={setOpen}
          title={t("notifications.title")}
          description={unreadCount > 0 ? t("notifications.unread", { count: unreadCount }) : undefined}
          maxWidth="md"
        >
          {notificationContent}
        </MobilePopup>
      </>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{triggerButton}</PopoverTrigger>
      <PopoverContent className="w-96 p-0" align="end" sideOffset={8}>
        {notificationContent}
      </PopoverContent>
    </Popover>
  );
}
