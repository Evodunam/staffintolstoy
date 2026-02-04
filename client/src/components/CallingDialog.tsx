"use client";

import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "react-i18next";
import { cn, normalizeAvatarUrl } from "@/lib/utils";
import type { Profile } from "@shared/schema";
import {
  Video,
  Phone,
  Mic,
  MicOff,
  VideoOff,
  Settings2,
  LayoutGrid,
  MoreVertical,
  UserX,
  Loader2,
} from "lucide-react";

interface CallingDialogProps {
  open: boolean;
  onEndCall: () => void;
  callElapsedFormatted: string;
  profile: Profile | null;
  otherParticipants: Profile[];
  callStarterProfileId: number | null;
}

export function CallingDialog({
  open,
  onEndCall,
  callElapsedFormatted,
  profile,
  otherParticipants,
  callStarterProfileId,
}: CallingDialogProps) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [micEnabled, setMicEnabled] = useState(true);
  const [cameraEnabled, setCameraEnabled] = useState(false);
  const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([]);
  const [videoDevices, setVideoDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedMicId, setSelectedMicId] = useState<string>("");
  const [selectedCameraId, setSelectedCameraId] = useState<string>("");
  const [devicePopoverOpen, setDevicePopoverOpen] = useState(false);
  const [focusedId, setFocusedId] = useState<"local" | number | null>(null);
  const [localSpeaking, setLocalSpeaking] = useState(false);
  const [mutedParticipantIds, setMutedParticipantIds] = useState<Set<number>>(new Set());
  const [kickedParticipantIds, setKickedParticipantIds] = useState<Set<number>>(new Set());
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const silenceTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const endingCallRef = useRef(false);

  useEffect(() => {
    if (!open) {
      endingCallRef.current = false;
      setFocusedId(null);
      setMutedParticipantIds(new Set());
      setKickedParticipantIds(new Set());
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let stream: MediaStream | null = null;
    const init = async () => {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        setAudioDevices(devices.filter((d) => d.kind === "audioinput"));
        setVideoDevices(devices.filter((d) => d.kind === "videoinput"));
        stream = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: false,
        });
        const settings = stream.getAudioTracks()[0]?.getSettings();
        if (settings?.deviceId) setSelectedMicId(settings.deviceId);
        setLocalStream(stream);
      } catch (e) {
        console.error("CallingDialog getUserMedia:", e);
      }
    };
    init();
    return () => {
      stream?.getTracks().forEach((t) => t.stop());
      setLocalStream(null);
    };
  }, [open]);

  useEffect(() => {
    if (!localStream || !localVideoRef.current) return;
    localVideoRef.current.srcObject = localStream;
  }, [localStream]);

  useEffect(() => {
    if (!localStream) return;
    const audioTrack = localStream.getAudioTracks()[0];
    if (audioTrack) audioTrack.enabled = micEnabled;
  }, [localStream, micEnabled]);

  useEffect(() => {
    if (!localStream || !micEnabled) {
      setLocalSpeaking(false);
      return;
    }
    const audioContext = new AudioContext();
    const source = audioContext.createMediaStreamSource(localStream);
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.8;
    source.connect(analyser);
    const dataArray = new Uint8Array(analyser.frequencyBinCount);
    const SPEAK_THRESHOLD = 25;
    const SILENCE_DELAY_MS = 400;
    let rafId: number;
    const tick = () => {
      analyser.getByteFrequencyData(dataArray);
      const average = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;
      if (average >= SPEAK_THRESHOLD) {
        if (silenceTimeoutRef.current) {
          clearTimeout(silenceTimeoutRef.current);
          silenceTimeoutRef.current = null;
        }
        setLocalSpeaking(true);
      } else {
        if (!silenceTimeoutRef.current) {
          silenceTimeoutRef.current = setTimeout(() => {
            silenceTimeoutRef.current = null;
            setLocalSpeaking(false);
          }, SILENCE_DELAY_MS);
        }
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(rafId);
      if (silenceTimeoutRef.current) clearTimeout(silenceTimeoutRef.current);
      source.disconnect();
      audioContext.close();
    };
  }, [localStream, micEnabled]);

  const toggleCamera = useCallback(async () => {
    if (cameraEnabled && localStream) {
      localStream.getVideoTracks().forEach((track) => track.stop());
      setLocalStream(new MediaStream(localStream.getAudioTracks()));
      setCameraEnabled(false);
      return;
    }
    try {
      const videoStream = await navigator.mediaDevices.getUserMedia({
        video: selectedCameraId ? { deviceId: { exact: selectedCameraId } } : true,
      });
      const newStream = new MediaStream([
        ...(localStream?.getAudioTracks() ?? []),
        ...videoStream.getVideoTracks(),
      ]);
      videoStream.getTracks().forEach((track) => (track !== videoStream.getVideoTracks()[0] ? track.stop() : null));
      setLocalStream(newStream);
      setCameraEnabled(true);
    } catch (e) {
      console.error("Enable camera:", e);
    }
  }, [cameraEnabled, localStream, selectedCameraId]);

  const switchMic = useCallback(async (deviceId: string) => {
    setSelectedMicId(deviceId);
    if (!localStream) return;
    try {
      const newStream = await navigator.mediaDevices.getUserMedia({
        audio: { deviceId: { exact: deviceId } },
        video: false,
      });
      localStream.getAudioTracks().forEach((track) => {
        localStream.removeTrack(track);
        track.stop();
      });
      newStream.getAudioTracks().forEach((track) => localStream.addTrack(track));
    } catch (e) {
      console.error("Switch mic:", e);
    }
  }, [localStream]);

  const switchCamera = useCallback(async (deviceId: string) => {
    setSelectedCameraId(deviceId);
    if (!localStream || !cameraEnabled) return;
    try {
      const videoStream = await navigator.mediaDevices.getUserMedia({
        video: { deviceId: { exact: deviceId } },
      });
      localStream.getVideoTracks().forEach((track) => {
        localStream.removeTrack(track);
        track.stop();
      });
      videoStream.getVideoTracks().forEach((track) => localStream.addTrack(track));
    } catch (e) {
      console.error("Switch camera:", e);
    }
  }, [localStream, cameraEnabled]);

  const currentUserDisplay = profile?.companyName || [profile?.firstName, profile?.lastName].filter(Boolean).join(" ") || "You";
  const isCallStarter = profile?.id === callStarterProfileId;
  type CallParticipant = { id: "local" | number; profile: Profile; isLocal: boolean };
  const participantsList = useMemo<CallParticipant[]>(() => {
    const list: CallParticipant[] = profile ? [{ id: "local", profile, isLocal: true }] : [];
    otherParticipants.forEach((p) => list.push({ id: p.id, profile: p, isLocal: false }));
    return list;
  }, [profile, otherParticipants]);

  const visibleParticipants = useMemo(
    () => participantsList.filter((p) => p.id === "local" || !kickedParticipantIds.has(p.id)),
    [participantsList, kickedParticipantIds]
  );
  const participantCount = visibleParticipants.length;
  const gridCols = participantCount === 1 ? "grid-cols-1" : "grid-cols-2";
  const isLastItemSpan = participantCount >= 3 && participantCount % 2 === 1;

  const handleMuteParticipant = (participantId: number) => {
    setMutedParticipantIds((prev) => new Set(prev).add(participantId));
    toast({ title: t("participantMuted"), description: t("participantMutedDescription") });
  };
  const handleKickParticipant = (participantId: number) => {
    setKickedParticipantIds((prev) => new Set(prev).add(participantId));
    toast({ title: t("participantKicked"), description: t("participantKickedDescription") });
  };

  const renderCard = (participant: CallParticipant, isStrip = false) => {
    const isLocal = participant.isLocal;
    const p = participant.profile;
    const name = p.companyName || [p.firstName, p.lastName].filter(Boolean).join(" ") || "Participant";
    const isFocused = focusedId === participant.id;
    const showVideo = isLocal && cameraEnabled && localStream && !isStrip;
    const isMuted = !isLocal && typeof participant.id === "number" && mutedParticipantIds.has(participant.id);
    const showHostMenu = !isLocal && isCallStarter && !isStrip;
    const CardWrapper = showHostMenu ? "div" : "button";
    const cardContent = (
      <div className="relative flex-1 min-h-0 w-full">
        {showVideo ? (
          <video
            ref={isLocal ? localVideoRef : undefined}
            autoPlay
            playsInline
            muted
            className="absolute inset-0 w-full h-full object-cover pointer-events-none"
          />
        ) : (
          <Avatar className="absolute inset-0 w-full h-full rounded-none">
            <AvatarImage src={normalizeAvatarUrl(p.avatarUrl) || undefined} className="object-cover" />
            <AvatarFallback className={isStrip ? "text-lg" : "text-4xl sm:text-5xl"}>
              {p.firstName?.[0]}
              {p.lastName?.[0]}
              {!p.firstName && !p.lastName && p.companyName?.[0]}
            </AvatarFallback>
          </Avatar>
        )}
        <div className={cn(
          "absolute left-2 bottom-2 py-1 px-2 rounded bg-black/50 text-white text-xs font-medium truncate",
          showHostMenu ? "right-12" : "right-2"
        )}>
          {isLocal ? currentUserDisplay : name}
        </div>
        {isMuted && (
          <div className="absolute left-2 top-2 py-1 px-2 rounded bg-amber-600/90 text-white text-xs font-medium">
            {t("muted")}
          </div>
        )}
        {!isLocal && !isMuted && (
          <div className="absolute right-2 top-2 flex items-center gap-1 py-1 px-2 rounded bg-black/50 text-white text-xs">
            <Loader2 className="w-3 h-3 animate-spin shrink-0" />
            <span className="truncate max-w-[80px]">{t("waitingForToJoin", { name: p.firstName || p.companyName || "them" })}</span>
          </div>
        )}
        {showHostMenu && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="absolute right-2 bottom-2 z-10 rounded-full h-8 w-8 bg-black/50 hover:bg-black/70 text-white border-0"
                onClick={(e) => e.stopPropagation()}
                aria-label={t("participantOptions")}
              >
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" side="bottom" className="min-w-[10rem]" onClick={(e) => e.stopPropagation()}>
              <DropdownMenuItem onClick={() => typeof participant.id === "number" && handleMuteParticipant(participant.id)}>
                <MicOff className="h-4 w-4 mr-2" />
                {t("muteParticipant")}
              </DropdownMenuItem>
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onClick={() => typeof participant.id === "number" && handleKickParticipant(participant.id)}
              >
                <UserX className="h-4 w-4 mr-2" />
                {t("kickFromCall")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    );
    return (
      <CardWrapper
        {...(CardWrapper === "button"
          ? {
              type: "button" as const,
              onClick: () => (isStrip ? setFocusedId(participant.id) : setFocusedId(isFocused ? null : participant.id)),
            }
          : {
              onClick: () => (isStrip ? setFocusedId(participant.id) : setFocusedId(isFocused ? null : participant.id)),
              role: "button" as const,
              tabIndex: 0,
              onKeyDown: (e: React.KeyboardEvent) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setFocusedId(isFocused ? null : participant.id);
                }
              },
            })}
        className={cn(
          "min-h-0 flex flex-col rounded-xl overflow-hidden bg-muted border border-border shadow-sm text-left w-full transition-[box-shadow,border-color] duration-300",
          isStrip ? "w-24 h-20 sm:w-28 sm:h-24 shrink-0" : "cursor-pointer hover:ring-2 hover:ring-primary/50 flex-1 min-h-0",
          isFocused && !isStrip && "ring-2 ring-primary",
          isLocal && localSpeaking && !isStrip && "ring-2 ring-green-500 border-green-500/80"
        )}
      >
        {cardContent}
      </CardWrapper>
    );
  };

  const handleEndCallClick = useCallback(() => {
    if (endingCallRef.current) return;
    endingCallRef.current = true;
    localStream?.getTracks().forEach((track) => track.stop());
    setLocalStream(null);
    onEndCall();
  }, [localStream, onEndCall]);

  return (
    <Dialog
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen) onEndCall();
      }}
    >
      <DialogContent
        className="calling-dialog-content fixed inset-0 z-[201] w-full h-full max-w-none max-h-none translate-x-0 translate-y-0 rounded-none border-0 flex flex-col overflow-hidden bg-background p-0 gap-0 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0"
        aria-describedby="calling-dialog-desc"
        hideCloseButton
      >
        <div className="flex-shrink-0 border-b border-border bg-muted/30 px-4 pt-4 pb-4 sm:px-6 relative z-10 bg-background">
          <div className="flex items-center justify-between gap-4 w-full">
            <DialogHeader className="flex-1 min-w-0">
              <DialogTitle id="calling-dialog-title" className="flex items-center gap-2 text-xl">
                <Video className="w-6 h-6 text-primary shrink-0 animate-pulse" />
                {t("callingTitle")}
              </DialogTitle>
              <DialogDescription id="calling-dialog-desc" className="sr-only" aria-live="polite">
                {t("callDuration", { time: callElapsedFormatted })}
              </DialogDescription>
            </DialogHeader>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              className="shrink-0 gap-1.5 rounded-full h-9 px-4 relative z-10"
              onClick={handleEndCallClick}
              aria-label={t("endCall")}
              data-testid="calling-dialog-end-call"
            >
              <Phone className="h-4 w-4 rotate-[135deg]" />
              {t("endCallButton")}
            </Button>
          </div>
        </div>
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
          {focusedId !== null ? (
            <div className="flex-1 min-h-0 flex flex-col p-2 sm:p-4">
              {visibleParticipants.map((participant) =>
                participant.id === focusedId ? (
                  <div key={String(participant.id)} className="flex-1 min-h-0 w-full flex flex-col rounded-xl overflow-hidden bg-muted border border-border shadow-sm">
                    {renderCard(participant)}
                  </div>
                ) : null
              )}
            </div>
          ) : participantCount === 0 ? (
            <div className="flex-1 min-h-0 flex items-center justify-center p-4">
              <p className="text-center text-sm text-muted-foreground">{t("waitingForOthers")}</p>
            </div>
          ) : (
            <div
              className={cn(
                "flex-1 min-h-0 grid gap-2 sm:gap-3 p-2 sm:p-4 overflow-hidden",
                gridCols
              )}
            >
              {visibleParticipants.map((participant, idx) => (
                <div
                  key={String(participant.id)}
                  className={cn(
                    "min-h-0 flex flex-col",
                    isLastItemSpan && idx === participantCount - 1 && "col-span-2"
                  )}
                >
                  {renderCard(participant)}
                </div>
              ))}
            </div>
          )}

          {focusedId !== null && participantCount > 1 && (
            <div className="flex-shrink-0 border-t border-border bg-muted/30 px-2 sm:px-4 py-2 flex items-center gap-2 overflow-x-auto">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="shrink-0 gap-1.5 rounded-lg h-9"
                onClick={() => setFocusedId(null)}
                aria-label={t("showAll")}
              >
                <LayoutGrid className="h-4 w-4" />
                {t("showAll")}
              </Button>
              <div className="flex gap-2 flex-1 min-w-0 overflow-x-auto pb-1">
                {visibleParticipants
                  .filter((p) => p.id !== focusedId)
                  .map((participant) => (
                    <div key={String(participant.id)} className="shrink-0">
                      {renderCard(participant, true)}
                    </div>
                  ))}
              </div>
            </div>
          )}
        </div>
        <div className="flex-shrink-0 border-t border-border bg-muted/30 px-4 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-6">
          <div className="flex flex-wrap items-center justify-between gap-2 sm:gap-4">
            <p className="text-muted-foreground text-base tabular-nums min-w-[3rem]" aria-hidden="true">
              {callElapsedFormatted}
            </p>
            <div className="flex flex-wrap items-center gap-2 sm:gap-4">
              <Button
                variant={micEnabled ? "secondary" : "destructive"}
                size="icon"
                className="rounded-full h-11 w-11"
                onClick={() => setMicEnabled((v) => !v)}
                aria-label={micEnabled ? t("muteMic") : t("unmuteMic")}
              >
                {micEnabled ? <Mic className="h-5 w-5" /> : <MicOff className="h-5 w-5" />}
              </Button>
              <Button
                variant={cameraEnabled ? "secondary" : "outline"}
                size="icon"
                className="rounded-full h-11 w-11"
                onClick={toggleCamera}
                aria-label={cameraEnabled ? t("turnCameraOff") : t("turnCameraOn")}
              >
                {cameraEnabled ? <Video className="h-5 w-5" /> : <VideoOff className="h-5 w-5" />}
              </Button>
              <Popover open={devicePopoverOpen} onOpenChange={setDevicePopoverOpen}>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="icon" className="rounded-full h-11 w-11" aria-label={t("changeMicCamera")}>
                    <Settings2 className="h-5 w-5" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-64 p-3" align="center">
                  <p className="text-sm font-medium mb-2">{t("microphone")}</p>
                  <div className="space-y-1 mb-3">
                    {audioDevices.map((d) => (
                      <button
                        key={d.deviceId}
                        type="button"
                        className={cn(
                          "w-full text-left text-sm px-2 py-1.5 rounded-md truncate",
                          selectedMicId === d.deviceId ? "bg-primary text-primary-foreground" : "hover:bg-muted"
                        )}
                        onClick={() => switchMic(d.deviceId)}
                      >
                        {d.label || `Mic ${d.deviceId.slice(0, 8)}`}
                      </button>
                    ))}
                  </div>
                  <p className="text-sm font-medium mb-2">{t("camera")}</p>
                  <div className="space-y-1">
                    {videoDevices.map((d) => (
                      <button
                        key={d.deviceId}
                        type="button"
                        className={cn(
                          "w-full text-left text-sm px-2 py-1.5 rounded-md truncate",
                          selectedCameraId === d.deviceId ? "bg-primary text-primary-foreground" : "hover:bg-muted"
                        )}
                        onClick={() => {
                          if (cameraEnabled) switchCamera(d.deviceId);
                          else setSelectedCameraId(d.deviceId);
                        }}
                      >
                        {d.label || `Camera ${d.deviceId.slice(0, 8)}`}
                      </button>
                    ))}
                  </div>
                </PopoverContent>
              </Popover>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
