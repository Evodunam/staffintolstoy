"use client";

import { useState, useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { useProfile } from "@/hooks/use-profiles";
import { apiRequest } from "@/lib/queryClient";
import { normalizeAvatarUrl } from "@/lib/utils";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Phone, Video, PhoneOff } from "lucide-react";
import { useTranslation } from "react-i18next";

interface NotificationWithData {
  id: number;
  type: string;
  title: string;
  body?: string;
  url?: string | null;
  data?: { jobId?: number; roomUrl?: string; inviterName?: string; inviterAvatarUrl?: string };
  isRead: boolean;
  createdAt: string;
}

export function IncomingCallPopup() {
  const { user, isAuthenticated } = useAuth();
  const { data: profile } = useProfile(user?.id);
  const queryClient = useQueryClient();
  const { t } = useTranslation("chat");
  const [dismissedId, setDismissedId] = useState<number | null>(null);

  const { data: notifications = [] } = useQuery<NotificationWithData[]>({
    queryKey: ["/api/notifications", profile?.id],
    enabled: !!profile?.id && isAuthenticated,
    refetchInterval: 12000,
  });

  const incomingCall = useMemo(() => {
    const list = Array.isArray(notifications) ? notifications : [];
    const maxAgeMs = 5 * 60 * 1000; // only show popup for call invites from the last 5 minutes
    const unread = list.find((n) => {
      if (n.type !== "call_invite" || n.isRead || n.id === dismissedId) return false;
      const createdAt = (n as any).createdAt ?? (n as any).created_at;
      if (createdAt && Date.now() - new Date(createdAt).getTime() > maxAgeMs) return false;
      return true;
    });
    return unread ?? null;
  }, [notifications, dismissedId]);

  useEffect(() => {
    if (!incomingCall) setDismissedId(null);
  }, [incomingCall]);

  const callerName =
    (incomingCall?.data as { inviterName?: string })?.inviterName ??
    incomingCall?.title?.replace(/ invited you to a video call$/i, "") ??
    t("someoneIsCalling", "Someone");

  const callerAvatarUrl = (incomingCall?.data as { inviterAvatarUrl?: string })
    ?.inviterAvatarUrl;
  const callUrl = incomingCall?.url ?? (incomingCall?.data as { roomUrl?: string })?.roomUrl;

  const markReadAndClose = async () => {
    if (!incomingCall?.id || !profile?.id) return;
    setDismissedId(incomingCall.id);
    try {
      await apiRequest("PATCH", `/api/notifications/${incomingCall.id}/read`, {});
      queryClient.invalidateQueries({ queryKey: ["/api/notifications", profile.id] });
    } catch {
      // ignore
    }
  };

  const handleAnswer = (openInNewTab = true) => {
    if (callUrl && (callUrl.startsWith("http://") || callUrl.startsWith("https://"))) {
      if (openInNewTab) window.open(callUrl, "_blank", "noopener,noreferrer");
      else window.location.href = callUrl;
    }
    markReadAndClose();
  };

  const handleDecline = () => {
    markReadAndClose();
  };

  if (!incomingCall) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-black/70 backdrop-blur-md p-4"
      role="dialog"
      aria-modal="true"
      aria-label={t("incomingCall", "Incoming call")}
    >
      {/* Header: branding + "[Name] is calling you" */}
      <div className="absolute left-4 top-4 sm:left-6 sm:top-6 flex items-center gap-3">
        <div className="w-10 h-10 rounded-lg bg-primary flex items-center justify-center shrink-0">
          <Video className="w-6 h-6 text-primary-foreground" />
        </div>
        <p className="text-white text-lg sm:text-xl font-semibold">
          {t("isCallingYou", { name: callerName })}
        </p>
      </div>

      {/* Large circular avatar */}
      <div className="flex flex-col items-center justify-center flex-1 min-h-0 w-full max-w-md">
        <Avatar className="w-40 h-40 sm:w-52 sm:h-52 rounded-full border-4 border-white/20 shadow-2xl shrink-0 overflow-hidden">
          <AvatarImage
            src={normalizeAvatarUrl(callerAvatarUrl) || undefined}
            className="object-cover"
          />
          <AvatarFallback className="text-5xl sm:text-6xl bg-muted text-muted-foreground">
            {callerName.slice(0, 2).toUpperCase()}
          </AvatarFallback>
        </Avatar>
      </div>

      {/* Action buttons: Answer with video (purple), Answer (blue), Decline (red) */}
      <div className="flex items-center justify-center gap-4 sm:gap-6 pb-8 sm:pb-12">
        <button
          type="button"
          onClick={() => handleAnswer(true)}
          className="flex flex-col items-center gap-2 rounded-full bg-[#7c3aed] hover:bg-[#6d28d9] text-white p-4 sm:p-5 transition-colors shadow-lg"
          aria-label={t("answerWithVideo", "Answer with video")}
        >
          <Video className="w-8 h-8 sm:w-10 sm:h-10" />
          <span className="text-xs sm:text-sm font-medium">{t("answerWithVideo", "Video")}</span>
        </button>
        <button
          type="button"
          onClick={() => handleAnswer(true)}
          className="flex flex-col items-center gap-2 rounded-full bg-[#2563eb] hover:bg-[#1d4ed8] text-white p-4 sm:p-5 transition-colors shadow-lg"
          aria-label={t("answerCall", "Answer")}
        >
          <Phone className="w-8 h-8 sm:w-10 sm:h-10" />
          <span className="text-xs sm:text-sm font-medium">{t("answerCall", "Answer")}</span>
        </button>
        <button
          type="button"
          onClick={handleDecline}
          className="flex flex-col items-center gap-2 rounded-full bg-destructive hover:bg-destructive/90 text-white p-4 sm:p-5 transition-colors shadow-lg"
          aria-label={t("declineCall", "Decline")}
        >
          <PhoneOff className="w-8 h-8 sm:w-10 sm:h-10 rotate-[135deg]" />
          <span className="text-xs sm:text-sm font-medium">{t("declineCall", "Decline")}</span>
        </button>
      </div>
    </div>
  );
}
