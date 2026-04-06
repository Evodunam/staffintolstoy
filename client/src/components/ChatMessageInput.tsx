import { useState, useRef, useEffect, useCallback } from "react";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { ImagePlus, Mic, MicOff, Send, X, Plus, Paperclip, Video, CalendarClock } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import type { Profile } from "@shared/schema";
import { useTranslation } from "react-i18next";
import { cn, normalizeAvatarUrl } from "@/lib/utils";

const MAX_ATTACHMENTS = 5;
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"];

function getObjectUrl(path: string): string {
  if (path.startsWith("http") || path.startsWith("/")) return path;
  return `/objects/chats/${path}`;
}

interface ChatMessageInputProps {
  onSubmit: (payload: { content: string; attachmentUrls?: string[]; mentionedProfileIds?: number[] }) => void;
  participants: Profile[];
  disabled?: boolean;
  placeholder?: string;
  /** When true, renders fixed at bottom of screen (for mobile chat view) */
  fixedAtBottom?: boolean;
  /** Job ID for the current chat (enables "Start a call" with Peer Calls) */
  jobId?: number | null;
  /** When true, only one call per job – disables "Start a call" and shows call-in-progress state */
  hasActiveCall?: boolean;
  /** Called when user starts a call: roomUrl to open, and optional message to send in chat so participants can join */
  onStartCall?: (roomUrl: string) => void;
  /** Job with startDate – when provided with isWorker and onRequestStartJobNow, shows "Request to start job now" if job has not started */
  job?: { startDate: string | null } | null;
  /** Current user is a worker (so they can request to start job now) */
  isWorker?: boolean;
  /** Called when worker taps "Request to start job now"; parent should send the special message */
  onRequestStartJobNow?: () => void;
  /** When true, a start-now request is already pending (hide the button) */
  hasPendingStartNowRequest?: boolean;
}

const PEERCALLS_BASE_URL = (() => {
  if (typeof import.meta === "undefined") return "";
  const url = import.meta.env?.VITE_PEERCALLS_URL;
  if (url && String(url).trim()) return String(url).replace(/\/$/, "");
  if (import.meta.env?.DEV) return "http://localhost:3000";
  return "";
})();

function isJobNotStarted(startDate: string | null | undefined): boolean {
  if (!startDate) return false;
  const start = new Date(startDate);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  start.setHours(0, 0, 0, 0);
  return start > today;
}

export function ChatMessageInput({
  onSubmit,
  participants,
  disabled = false,
  placeholder,
  fixedAtBottom = false,
  jobId = null,
  hasActiveCall = false,
  onStartCall,
  job = null,
  isWorker = false,
  onRequestStartJobNow,
  hasPendingStartNowRequest = false,
}: ChatMessageInputProps) {
  const { t } = useTranslation("chat");
  const showStartNowBanner = Boolean(
    isWorker &&
    job?.startDate &&
    isJobNotStarted(job.startDate) &&
    onRequestStartJobNow &&
    !hasPendingStartNowRequest
  );
  const [value, setValue] = useState("");
  const [attachmentUrls, setAttachmentUrls] = useState<string[]>([]);
  const [mentionQuery, setMentionQuery] = useState("");
  const [mentionStart, setMentionStart] = useState<number | null>(null);
  const [showMentionDropdown, setShowMentionDropdown] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [attachSheetOpen, setAttachSheetOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const recognitionRef = useRef<SpeechRecognition | null>(null);

  const getDisplayName = (p: Profile) =>
    p.firstName || p.companyName || p.email || "Unknown";

  const filteredParticipants = participants.filter(
    (p) =>
      !mentionQuery ||
      getDisplayName(p).toLowerCase().includes(mentionQuery.toLowerCase())
  );

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const v = e.target.value;
    const caret = e.target.selectionStart || 0;

    setValue(v);

    const beforeCaret = v.slice(0, caret);
    const lastAt = beforeCaret.lastIndexOf("@");

    if (lastAt >= 0) {
      const afterAt = beforeCaret.slice(lastAt + 1);
      if (!/\s/.test(afterAt)) {
        setMentionStart(lastAt);
        setMentionQuery(afterAt);
        setShowMentionDropdown(true);
        return;
      }
    }
    setShowMentionDropdown(false);
    setMentionStart(null);
  };

  const selectMention = (p: Profile) => {
    if (mentionStart === null) return;
    const endOfQuery = mentionStart + 1 + (mentionQuery?.length ?? 0);
    const before = value.slice(0, mentionStart);
    const after = value.slice(endOfQuery);
    const insert = `@${getDisplayName(p)} `;
    const newValue = before + insert + after;
    setValue(newValue);
    setShowMentionDropdown(false);
    setMentionStart(null);
    setMentionQuery("");
    setTimeout(() => {
      textareaRef.current?.focus();
      const pos = before.length + insert.length;
      textareaRef.current?.setSelectionRange(pos, pos);
    }, 0);
  };

  const extractMentionedIds = (text: string): number[] => {
    const ids: number[] = [];
    const matches = text.matchAll(/@([^@\n]+?)(?=\s|$|@)/g);
    for (const m of matches) {
      const name = m[1].trim().toLowerCase();
      const p = participants.find((x) => getDisplayName(x).toLowerCase() === name);
      if (p && !ids.includes(p.id)) ids.push(p.id);
    }
    return ids;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = value.trim();
    if ((!trimmed && attachmentUrls.length === 0) || disabled) return;

    const mentionedIds = extractMentionedIds(trimmed);

    onSubmit({
      content: trimmed || " ",
      attachmentUrls: attachmentUrls.length > 0 ? attachmentUrls : undefined,
      mentionedProfileIds: mentionedIds.length > 0 ? mentionedIds : undefined,
    });

    setValue("");
    setAttachmentUrls([]);
  };

  const handleImageSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    const valid = files.filter((f) => IMAGE_TYPES.includes(f.type) && f.size <= 10 * 1024 * 1024);
    const total = attachmentUrls.length + valid.length;
    if (total > MAX_ATTACHMENTS) return;

    setIsUploading(true);
    try {
      for (const file of valid) {
        const res = await apiRequest("POST", "/api/uploads/request-url", {
          name: file.name,
          size: file.size,
          contentType: file.type,
          bucket: "chats",
        });
        if (!res.ok) throw new Error("Failed to get upload URL");

        const { uploadURL, objectPath } = await res.json();

        const putRes = await fetch(uploadURL, {
          method: "PUT",
          body: file,
          headers: { "Content-Type": file.type },
        });
        if (!putRes.ok) throw new Error("Failed to upload");

        let path = objectPath;
        if (!path.startsWith("/objects/")) {
          path = path.startsWith("/") ? path : `/${path}`;
        }
        setAttachmentUrls((prev) => [...prev, path]);
      }
    } catch (err) {
      console.error("Upload error:", err);
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const removeAttachment = (idx: number) => {
    setAttachmentUrls((prev) => prev.filter((_, i) => i !== idx));
  };

  const toggleVoice = useCallback(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    if (isRecording) {
      recognitionRef.current?.stop();
      setIsRecording(false);
      return;
    }

    const rec = new SpeechRecognition();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = "en-US";

    rec.onresult = (e: SpeechRecognitionEvent) => {
      const last = e.results.length - 1;
      const text = (e.results[last] as SpeechRecognitionAlternative)[0].transcript;
      if (e.results[last].isFinal) {
        setValue((prev) => (prev ? prev + " " + text : text));
      }
    };

    rec.onend = () => setIsRecording(false);
    rec.start();
    recognitionRef.current = rec;
    setIsRecording(true);
  }, [isRecording]);

  const canSubmit = (value.trim() || attachmentUrls.length > 0) && !disabled;
  const hasSpeech = typeof window !== "undefined" && !!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = "auto";
      const newHeight = Math.min(textarea.scrollHeight, 200);
      textarea.style.height = `${newHeight}px`;
    }
  }, [value]);

  const formContent = (
    <form onSubmit={handleSubmit} className={cn(
      "relative flex flex-col rounded-[28px] p-2 shadow-sm transition-colors bg-white dark:bg-[#303030] border dark:border-transparent border-border"
    )}>
      <input
        ref={fileInputRef}
        type="file"
        accept={IMAGE_TYPES.join(",")}
        multiple
        className="hidden"
        onChange={handleImageSelect}
      />

      {attachmentUrls.length > 0 && (
        <div className="flex gap-2 mb-1 flex-wrap px-1 pt-1">
          {attachmentUrls.map((url, i) => (
            <div key={i} className="relative group">
              <img
                src={getObjectUrl(url)}
                alt=""
                className="w-14 h-14 object-cover rounded-[1rem] border border-border"
              />
              <button
                type="button"
                onClick={() => removeAttachment(i)}
                className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-background/80 dark:bg-[#303030] border border-border flex items-center justify-center hover:bg-destructive hover:text-destructive-foreground hover:border-destructive transition-colors"
                aria-label="Remove"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      <textarea
        ref={textareaRef}
        rows={1}
        value={value}
        onChange={handleInputChange}
        onKeyDown={(e) => {
          if (showMentionDropdown && (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter")) {
            e.preventDefault();
          }
        }}
        placeholder={placeholder ?? t("typeMessage")}
        disabled={disabled}
        className="w-full resize-none border-0 bg-transparent p-3 text-foreground dark:text-white placeholder:text-muted-foreground focus:ring-0 focus-visible:outline-none min-h-12 max-h-[200px]"
        data-testid="input-message"
      />

      {showMentionDropdown && filteredParticipants.length > 0 && (
        <div className="absolute bottom-full left-0 right-0 mb-1 mx-2 bg-popover border border-border rounded-xl shadow-lg overflow-hidden z-50 max-h-40 overflow-y-auto">
          {filteredParticipants.map((p) => (
            <button
              key={p.id}
              type="button"
              className="w-full flex items-center gap-2 px-3 py-2 hover:bg-muted text-left"
              onClick={() => selectMention(p)}
            >
              <Avatar className="w-6 h-6">
                <AvatarImage src={normalizeAvatarUrl(p.avatarUrl) || undefined} />
                <AvatarFallback className="text-xs">
                  {p.firstName?.[0]}{p.lastName?.[0]}
                </AvatarFallback>
              </Avatar>
              <span className="text-sm truncate">{getDisplayName(p)}</span>
            </button>
          ))}
        </div>
      )}

      <div className="mt-0.5 p-1 pt-0">
        <TooltipProvider delayDuration={100}>
          <div className="flex items-center gap-2">
            <Sheet open={attachSheetOpen} onOpenChange={setAttachSheetOpen}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <SheetTrigger asChild>
                    <button
                      type="button"
                      disabled={disabled}
                      className="flex h-8 w-8 items-center justify-center rounded-full text-foreground dark:text-white transition-colors hover:bg-accent dark:hover:bg-[#515151] focus-visible:outline-none disabled:opacity-50"
                      aria-label="Add attachment or start call"
                    >
                      <Plus className="h-5 w-5" />
                    </button>
                  </SheetTrigger>
                </TooltipTrigger>
                <TooltipContent side="top">Add</TooltipContent>
              </Tooltip>
              <SheetContent
                side="bottom"
                hideCloseButton
                className="global-attach-call-sheet px-0 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))]"
              >
                <div className="flex flex-col items-center px-4 pb-2">
                  <div className="sheet-drag-handle" aria-hidden />
                  <div className="flex items-center justify-between w-full mt-3">
                    <h2 className="text-lg font-semibold text-foreground">Attach or call</h2>
                    <button
                      type="button"
                      onClick={() => setAttachSheetOpen(false)}
                      className="rounded-full p-2 hover:bg-muted transition-colors"
                      aria-label="Close"
                    >
                      <X className="h-5 w-5" />
                    </button>
                  </div>
                </div>
                <div className="grid gap-1 py-2 px-4 overflow-y-auto">
                  <button
                    type="button"
                    onClick={() => {
                      fileInputRef.current?.click();
                      setAttachSheetOpen(false);
                    }}
                    disabled={disabled || isUploading || attachmentUrls.length >= MAX_ATTACHMENTS}
                    className="flex items-center gap-3 w-full px-4 py-3 rounded-xl text-left hover:bg-muted transition-colors disabled:opacity-50"
                  >
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted">
                      <Paperclip className="h-5 w-5 text-muted-foreground" />
                    </div>
                    <div>
                      <p className="font-medium">Attach files</p>
                      <p className="text-xs text-muted-foreground">Images (up to {MAX_ATTACHMENTS})</p>
                    </div>
                  </button>
                  {jobId != null && onStartCall && PEERCALLS_BASE_URL && (
                    <button
                      type="button"
                      onClick={() => {
                        if (hasActiveCall) return;
                        const roomSlug = `job-${jobId}`;
                        const roomUrl = `${PEERCALLS_BASE_URL}/${roomSlug}`;
                        onStartCall(roomUrl);
                        setAttachSheetOpen(false);
                      }}
                      disabled={disabled || hasActiveCall}
                      className="flex items-center gap-3 w-full px-4 py-3 rounded-xl text-left hover:bg-muted transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted">
                        <Video className="h-5 w-5 text-muted-foreground" />
                      </div>
                      <div>
                        <p className="font-medium">{hasActiveCall ? t("callInProgress") : "Start a call"}</p>
                        <p className="text-xs text-muted-foreground">
                          {hasActiveCall ? "Only one call at a time per job" : "Video call with everyone on this job (Peer Calls)"}
                        </p>
                      </div>
                    </button>
                  )}
                </div>
              </SheetContent>
            </Sheet>

            <div className="flex-1 min-w-0" />

            <div className="flex items-center gap-2">
              {hasSpeech && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={toggleVoice}
                      disabled={disabled}
                      className={cn(
                        "flex h-8 w-8 items-center justify-center rounded-full text-foreground dark:text-white transition-colors hover:bg-accent dark:hover:bg-[#515151] focus-visible:outline-none",
                        isRecording && "text-destructive"
                      )}
                    >
                      {isRecording ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top">{t("voiceInput") || "Voice input"}</TooltipContent>
                </Tooltip>
              )}

              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="submit"
                    disabled={!canSubmit}
                    className="flex h-8 w-8 items-center justify-center rounded-full text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40"
                    data-testid="button-send-message"
                  >
                    <Send className="h-5 w-5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top">Send</TooltipContent>
              </Tooltip>
            </div>
          </div>
        </TooltipProvider>
      </div>
    </form>
  );

  const startNowBanner = showStartNowBanner ? (
    <div className="mb-2 px-2 py-2 rounded-lg bg-primary/10 border border-primary/20">
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="w-full justify-start gap-2 text-primary border-primary/30 hover:bg-primary/15"
        onClick={onRequestStartJobNow}
        disabled={disabled}
      >
        <CalendarClock className="h-4 w-4" />
        {t("requestToStartJobNow") ?? "Request to start job now"}
      </Button>
    </div>
  ) : null;

  if (fixedAtBottom) {
    return (
      <div className="fixed bottom-0 left-0 right-0 z-50 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] bg-background border-t border-border">
        <div className="relative w-full">
          {startNowBanner}
          {formContent}
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 border-t border-border bg-background">
      <div className="relative w-full">
        {startNowBanner}
        {formContent}
      </div>
    </div>
  );
}
