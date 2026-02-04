import { Navigation } from "@/components/Navigation";
import { useJob } from "@/hooks/use-jobs";
import { useRoute, Link } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { useProfile } from "@/hooks/use-profiles";
import { useCreateApplication, useJobApplications } from "@/hooks/use-applications";
import { Loader2, MapPin, Calendar, Clock, DollarSign, Building2, ChevronLeft, Users, Image as ImageIcon, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import { Textarea } from "@/components/ui/textarea";
import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useTranslation } from "react-i18next";

function formatDateFriendly(dateString: string | Date): string {
  if (!dateString) return "";
  const date = typeof dateString === 'string' ? new Date(dateString) : dateString;
  const day = date.getDate();
  const suffix = day % 10 === 1 && day !== 11 ? "st" 
               : day % 10 === 2 && day !== 12 ? "nd"
               : day % 10 === 3 && day !== 13 ? "rd" : "th";
  return format(date, "MMMM") + " " + day + suffix;
}

function formatTimeFriendly(timeString: string): string {
  if (!timeString) return "";
  const [hours, minutes] = timeString.split(":").map(Number);
  const isPM = hours >= 12;
  const hour12 = hours % 12 || 12;
  const period = isPM ? "pm" : "am";
  return minutes > 0 ? `${hour12}:${minutes.toString().padStart(2, "0")}${period}` : `${hour12}${period}`;
}

function formatTimeRange(scheduledTime?: string | null): string {
  if (!scheduledTime) return "";
  const parts = scheduledTime.split(" - ");
  if (parts.length === 2) {
    return `${formatTimeFriendly(parts[0].trim())} - ${formatTimeFriendly(parts[1].trim())}`;
  }
  return formatTimeFriendly(scheduledTime);
}

export default function JobDetail() {
  const { t } = useTranslation("jobDetail");
  const [, params] = useRoute("/jobs/:id");
  const jobId = parseInt(params?.id || "0");
  
  const { data: job, isLoading } = useJob(jobId);
  const { user } = useAuth();
  const { data: profile } = useProfile(user?.id);
  const { mutate: apply, isPending: isApplying } = useCreateApplication();
  
  // Fetch existing applications to check if already applied
  // Only valid if user is logged in
  const { data: applications } = useJobApplications(jobId);
  
  const [message, setMessage] = useState("");
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  const hasApplied = applications?.some(app => app.workerId === profile?.id);
  const isOwner = job?.companyId === profile?.id;

  const handleApply = () => {
    apply({ jobId, message }, {
      onSuccess: () => setIsDialogOpen(false)
    });
  };

  if (isLoading) {
    return <div className="min-h-screen flex items-center justify-center"><Loader2 className="w-8 h-8 animate-spin" /></div>;
  }

  if (!job) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center">
        <h2 className="text-2xl font-bold mb-4">{t("jobNotFound")}</h2>
        <Link href="/jobs"><Button>{t("backToJobs")}</Button></Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background pb-20">
      <Navigation />
      
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 pt-8">
        <Link href="/jobs" className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground mb-6">
          <ChevronLeft className="w-4 h-4 mr-1" /> {t("backToJobs")}
        </Link>
        
        <div className="bg-card rounded-3xl shadow-sm border border-border overflow-hidden">
          <div className="bg-secondary/30 p-8 border-b border-border">
            <div className="flex flex-col md:flex-row justify-between items-start gap-4">
              <div>
                <span className="inline-block px-3 py-1 rounded-full text-xs font-semibold bg-primary text-primary-foreground mb-3 capitalize">
                  {job.trade}
                </span>
                <h1 className="text-3xl md:text-4xl font-bold mb-2 font-display">{job.title}</h1>
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Building2 className="w-4 h-4" />
                  <span className="font-medium text-foreground">{job.company.companyName}</span>
                </div>
              </div>
              
              <div className="text-right">
                <div className="text-2xl font-bold mb-1">${(job.hourlyRate / 100).toFixed(2)}<span className="text-base font-normal text-muted-foreground">/hr</span></div>
                <div className="text-sm text-muted-foreground">{t("approxHours", { hours: job.estimatedHours })}</div>
              </div>
            </div>
          </div>
          
          <div className="p-8">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
              <div className="flex items-center gap-3 p-4 rounded-xl bg-secondary/20">
                <MapPin className="w-5 h-5 text-primary" />
                <div>
                  <div className="text-xs text-muted-foreground">{t("location")}</div>
                  <div className="font-medium">{(job as any).locationName || job.city || job.location}</div>
                </div>
              </div>
              <div className="flex items-center gap-3 p-4 rounded-xl bg-secondary/20">
                <Calendar className="w-5 h-5 text-primary" />
                <div>
                  <div className="text-xs text-muted-foreground">{t("startDate")}</div>
                  <div className="font-medium">{formatDateFriendly(job.startDate)}</div>
                </div>
              </div>
              {job.scheduledTime && (
                <div className="flex items-center gap-3 p-4 rounded-xl bg-secondary/20">
                  <Clock className="w-5 h-5 text-primary" />
                  <div>
                    <div className="text-xs text-muted-foreground">{t("schedule")}</div>
                    <div className="font-medium">{formatTimeRange(job.scheduledTime)}</div>
                  </div>
                </div>
              )}
              <div className="flex items-center gap-3 p-4 rounded-xl bg-secondary/20">
                <Users className="w-5 h-5 text-primary" />
                <div>
                  <div className="text-xs text-muted-foreground">{t("workersNeeded")}</div>
                  <div className="font-medium">{job.workersHired}/{job.maxWorkersNeeded}</div>
                </div>
              </div>
            </div>

            {(((job as any).images && (job as any).images.length > 0) || ((job as any).videos && (job as any).videos.length > 0)) && (
              <div className="mb-8">
                <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
                  <ImageIcon className="w-5 h-5" /> {t("photosAndVideos")}
                </h3>
                <div className="flex gap-3 overflow-x-auto pb-2">
                  {(job as any).images?.map((image: string, idx: number) => (
                    <img 
                      key={`img-${idx}`} 
                      src={image} 
                      alt={`Job photo ${idx + 1}`} 
                      className="w-48 h-32 object-cover rounded-lg flex-shrink-0 border"
                      data-testid={`image-job-${idx}`}
                    />
                  ))}
                  {(job as any).videos?.map((video: string, idx: number) => (
                    <div key={`vid-${idx}`} className="relative w-48 h-32 flex-shrink-0">
                      <video 
                        src={video} 
                        controls 
                        className="w-full h-full object-cover rounded-lg border"
                        data-testid={`video-job-${idx}`}
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="prose max-w-none mb-12">
              <h3 className="text-xl font-bold mb-4">{t("jobDescription")}</h3>
              <p className="text-muted-foreground whitespace-pre-line leading-relaxed">{job.description}</p>
            </div>

            <div className="border-t border-border pt-8 flex justify-end">
              {isOwner ? (
                <Button variant="secondary" disabled>{t("youPostedThisJob")}</Button>
              ) : hasApplied ? (
                <Button variant="outline" disabled className="gap-2">
                  <span className="w-2 h-2 rounded-full bg-green-500" /> {t("applied")}
                </Button>
              ) : (
                profile?.role === "worker" ? (
                  <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
                    <DialogTrigger asChild>
                      <Button size="lg" className="w-full md:w-auto px-8">{t("applyNow")}</Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>{t("applyForJob", { jobTitle: job.title })}</DialogTitle>
                      </DialogHeader>
                      <div className="space-y-4 py-4">
                        <Textarea 
                          placeholder={t("introduceYourself")}
                          className="min-h-[120px]"
                          value={message}
                          onChange={(e) => setMessage(e.target.value)}
                        />
                        <Button onClick={handleApply} disabled={isApplying} className="w-full">
                          {isApplying ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                          {t("sendApplication")}
                        </Button>
                      </div>
                    </DialogContent>
                  </Dialog>
                ) : (
                  <Button variant="secondary" disabled>{t("signInAsWorkerToApply")}</Button>
                )
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
