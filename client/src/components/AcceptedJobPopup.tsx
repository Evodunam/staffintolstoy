import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { useTranslation } from "react-i18next";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { 
  MapPin, 
  Phone, 
  Calendar, 
  Clock, 
  DollarSign, 
  Building2, 
  Send, 
  ChevronDown,
  ChevronUp,
  Loader2,
  MessageSquare,
  User,
  X
} from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { stripPhonesAndEmails } from "@/lib/utils";
import type { Job, Profile, JobMessage } from "@shared/schema";

interface AcceptedJobPopupProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  job: Job | null;
  currentUser: Profile | null;
  otherParty?: Profile | null;
}

type JobMessageWithSender = JobMessage & { sender: Profile };

export function AcceptedJobPopup({
  open,
  onOpenChange,
  job,
  currentUser,
  otherParty,
}: AcceptedJobPopupProps) {
  const { t } = useTranslation();
  const { t: tCommon } = useTranslation("common");
  const [messageText, setMessageText] = useState("");
  const [showJobDetails, setShowJobDetails] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const { data: messages = [], isLoading: messagesLoading, refetch: refetchMessages } = useQuery<JobMessageWithSender[]>({
    queryKey: ["/api/jobs", job?.id, "messages"],
    enabled: open && !!job?.id,
    refetchInterval: 5000,
  });

  const sendMessageMutation = useMutation({
    mutationFn: async (content: string) => {
      const res = await apiRequest("POST", `/api/jobs/${job?.id}/messages`, { content });
      return res.json();
    },
    onMutate: async (content: string) => {
      setMessageText("");
      if (!job?.id || !currentUser) return {};
      await queryClient.cancelQueries({ queryKey: ["/api/jobs", job.id, "messages"] });
      const previous = queryClient.getQueryData<JobMessageWithSender[]>(["/api/jobs", job.id, "messages"]);
      const optimisticMessage: JobMessageWithSender = {
        id: -Date.now(),
        jobId: job.id,
        senderId: currentUser.id,
        content,
        messageType: "text",
        timesheetId: null,
        metadata: null,
        visibleToCompanyOnly: false,
        isRead: false,
        readAt: null,
        createdAt: new Date(),
        sender: currentUser,
      };
      queryClient.setQueryData<JobMessageWithSender[]>(
        ["/api/jobs", job.id, "messages"],
        (old) => [...(old || []), optimisticMessage]
      );
      return { previous };
    },
    onError: (_err, _content, context) => {
      if (context?.previous != null && job?.id) {
        queryClient.setQueryData(["/api/jobs", job.id, "messages"], context.previous);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/jobs", job?.id, "messages"] });
    },
  });

  useEffect(() => {
    if (messages.length > 0) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages]);

  useEffect(() => {
    if (open && job?.id) {
      refetchMessages();
    }
  }, [open, job?.id, refetchMessages]);

  const handleSendMessage = () => {
    const trimmed = messageText.trim();
    if (!trimmed || sendMessageMutation.isPending) return;
    const content = stripPhonesAndEmails(trimmed);
    if (!content) {
      setMessageText("");
      return;
    }
    sendMessageMutation.mutate(content);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  if (!job) return null;

  const fullAddress = [job.address, job.city, job.state, job.zipCode]
    .filter(Boolean)
    .join(", ");

  const formatDate = (date: string | Date | null) => {
    if (!date) return tCommon("tbd");
    try {
      const d = typeof date === "string" ? parseISO(date) : date;
      return format(d, "MMM d, yyyy");
    } catch {
      return tCommon("tbd");
    }
  };

  const formatTime = (time: string | null) => {
    if (!time) return "";
    try {
      const [hours, minutes] = time.split(":");
      const h = parseInt(hours);
      const ampm = h >= 12 ? "PM" : "AM";
      const displayHour = h % 12 || 12;
      return `${displayHour}:${minutes} ${ampm}`;
    } catch {
      return time;
    }
  };

  const hourlyRate = job.hourlyRate ? (job.hourlyRate / 100).toFixed(0) : null;

  const JobDetailsSection = () => (
    <div className="space-y-4">
      <div className="space-y-2">
        <h3 className="font-semibold text-lg">{job.title}</h3>
        {job.serviceCategory && (
          <Badge variant="secondary">{job.serviceCategory}</Badge>
        )}
      </div>

      <div className="grid gap-3 text-sm">
        <div className="flex items-start gap-2">
          <MapPin className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
          <span>{fullAddress || job.location || t("job.locationNotSpecified")}</span>
        </div>

        <div className="flex items-center gap-2">
          <Calendar className="h-4 w-4 text-muted-foreground" />
          <span>
            {formatDate(job.startDate)}
            {job.endDate && job.endDate !== job.startDate && ` - ${formatDate(job.endDate)}`}
          </span>
        </div>

        {(job.scheduledTime || job.endTime) && (
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-muted-foreground" />
            <span>
              {formatTime(job.scheduledTime)}
              {job.endTime && ` - ${formatTime(job.endTime)}`}
            </span>
          </div>
        )}

        {hourlyRate && (
          <div className="flex items-center gap-2">
            <DollarSign className="h-4 w-4 text-muted-foreground" />
            <span>${hourlyRate}/hr</span>
          </div>
        )}
      </div>

      {job.description && (
        <>
          <Separator />
          <div>
            <h4 className="font-medium text-sm mb-2">{t("job.description")}</h4>
            <p className="text-sm text-muted-foreground whitespace-pre-wrap">
              {job.description}
            </p>
          </div>
        </>
      )}

      {otherParty && (
        <>
          <Separator />
          <div>
            <h4 className="font-medium text-sm mb-2">
              {currentUser?.role === "worker" ? t("company.title") : t("worker.title")}
            </h4>
            <div className="flex items-center gap-3">
              <Avatar className="h-10 w-10">
                <AvatarImage src={otherParty.avatarUrl || undefined} />
                <AvatarFallback>
                  {(otherParty.companyName || otherParty.firstName || "?").charAt(0)}
                </AvatarFallback>
              </Avatar>
              <div>
                <p className="font-medium">
                  {otherParty.companyName || `${otherParty.firstName} ${otherParty.lastName}`}
                </p>
                {otherParty.phone && (
                  <a 
                    href={`tel:${otherParty.phone}`} 
                    className="text-sm text-muted-foreground flex items-center gap-1 hover:text-primary"
                  >
                    <Phone className="h-3 w-3" />
                    {otherParty.phone}
                  </a>
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );

  const ChatSection = () => (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 pb-3 border-b">
        <MessageSquare className="h-5 w-5 text-primary" />
        <h3 className="font-semibold">{tCommon("messages")}</h3>
        {messages.length > 0 && (
          <Badge variant="secondary" className="text-xs">
            {messages.length}
          </Badge>
        )}
      </div>

      <ScrollArea className="flex-1 pr-4 py-4">
        {messagesLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-center text-muted-foreground">
            <MessageSquare className="h-10 w-10 mb-3 opacity-30" />
            <p>{t("empty.noMessages")}</p>
            <p className="text-xs mt-1">{t("chat.startConversation")}</p>
          </div>
        ) : (
          <div className="space-y-4">
            {messages.map((msg) => {
              const isOwn = msg.senderId === currentUser?.id;
              return (
                <div
                  key={msg.id}
                  className={`flex gap-3 ${isOwn ? "flex-row-reverse" : ""}`}
                  data-testid={`message-${msg.id}`}
                >
                  <Avatar className="h-8 w-8 shrink-0">
                    <AvatarImage src={msg.sender.avatarUrl || undefined} />
                    <AvatarFallback className="text-xs">
                      {(msg.sender.companyName || msg.sender.firstName || "?").charAt(0)}
                    </AvatarFallback>
                  </Avatar>
                  <div className={`max-w-[75%] ${isOwn ? "text-right" : ""}`}>
                    <div
                      className={`rounded-2xl px-4 py-2 ${
                        isOwn
                          ? "bg-primary text-primary-foreground rounded-tr-sm"
                          : "bg-muted rounded-tl-sm"
                      }`}
                    >
                      <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                    </div>
                    <p className="text-[10px] text-muted-foreground mt-1">
                      {msg.sender.companyName || msg.sender.firstName}
                      {" · "}
                      {format(new Date(msg.createdAt!), "MMM d, h:mm a")}
                    </p>
                  </div>
                </div>
              );
            })}
            <div ref={messagesEndRef} />
          </div>
        )}
      </ScrollArea>

      <div className="pt-3 border-t">
        <div className="flex gap-2">
          <Textarea
            ref={textareaRef}
            value={messageText}
            onChange={(e) => setMessageText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t("chat.typeMessage")}
            className="min-h-[44px] max-h-32 resize-none"
            rows={1}
            data-testid="input-message"
          />
          <Button
            size="icon"
            onClick={handleSendMessage}
            disabled={!messageText.trim() || sendMessageMutation.isPending}
            data-testid="button-send-message"
            className="h-11 w-11 rounded-xl bg-neutral-900 hover:bg-neutral-800 text-white border-0 flex-shrink-0"
          >
            {sendMessageMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </Button>
        </div>
      </div>
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent hideCloseButton className="max-w-5xl h-[85vh] max-h-[800px] p-0 gap-0 overflow-hidden rounded-2xl shadow-2xl border-0" aria-describedby="accepted-job-popup-desc">
        <DialogDescription id="accepted-job-popup-desc" className="sr-only">Job details and chat</DialogDescription>
        <div className="flex-shrink-0 flex items-center justify-between gap-2 px-4 sm:px-6 py-3 border-b bg-background">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <DialogTitle className="text-lg font-semibold truncate">
              {job.title}
            </DialogTitle>
            <Badge className="bg-green-500/10 text-green-600 border-green-200 flex-shrink-0">
              {t("job.accepted")}
            </Badge>
          </div>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="flex items-center justify-center rounded-full bg-muted hover:bg-muted/80 w-9 h-9 flex-shrink-0"
            aria-label="Close"
          >
            <X className="w-5 h-5 text-muted-foreground" />
          </button>
        </div>

        <div className="flex-1 overflow-hidden">
          <div className="hidden md:grid md:grid-cols-[350px_1fr] h-full">
            <div className="border-r overflow-y-auto p-6">
              <JobDetailsSection />
            </div>
            <div className="flex flex-col p-6 h-full">
              <ChatSection />
            </div>
          </div>

          <div className="md:hidden flex flex-col h-full">
            <div className="border-b">
              <Button
                variant="ghost"
                onClick={() => setShowJobDetails(!showJobDetails)}
                className="w-full justify-between h-12 rounded-none"
                data-testid="button-toggle-job-details"
              >
                <span className="flex items-center gap-2">
                  <Building2 className="h-4 w-4" />
                  {t("job.details")}
                </span>
                {showJobDetails ? (
                  <ChevronUp className="h-4 w-4" />
                ) : (
                  <ChevronDown className="h-4 w-4" />
                )}
              </Button>
              {showJobDetails && (
                <div className="p-4 border-t bg-muted/30">
                  <JobDetailsSection />
                </div>
              )}
            </div>
            <div className="flex-1 flex flex-col p-4 overflow-hidden">
              <ChatSection />
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
