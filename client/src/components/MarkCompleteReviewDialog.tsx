"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Loader2, Star, Briefcase, Image, CheckCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { compressImageIfNeeded, assertMaxUploadSize } from "@/lib/image-compression";

type MarkCompleteFlowStep = "intro" | "photos" | "reviews" | "addToTeam" | "success";

type JobWithApplications = {
  id: number;
  title: string;
  images?: string[];
  companyLocationId?: number | null;
  locationId?: number | null;
  applications?: Array<{
    id: number;
    workerId: number;
    status: string;
    worker?: { id: number; firstName?: string; lastName?: string; avatarUrl?: string | null };
  }>;
  timesheets?: Array<{ id: number; status: string }>;
};

interface MarkCompleteReviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  jobId: number | null;
  jobTitle: string;
}

const STEP_TITLES: Record<MarkCompleteFlowStep, string> = {
  intro: "Close out this project",
  photos: "Completed project photos",
  reviews: "Review workers",
  addToTeam: "Add workers to your team",
  success: "Project completed",
};

/** Full-page popup on mobile and desktop (no bottom sheet). Content must be above overlay (z-[201] > overlay z-[200]). */
const FULL_PAGE_DIALOG_CLASS =
  "fixed inset-0 z-[201] w-full h-full max-w-none max-h-none translate-x-0 translate-y-0 rounded-none border-0 flex flex-col overflow-hidden bg-background p-0 gap-0 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0";

export function MarkCompleteReviewDialog({
  open,
  onOpenChange,
  jobId,
  jobTitle,
}: MarkCompleteReviewDialogProps) {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [flowStep, setFlowStep] = useState<MarkCompleteFlowStep>("intro");
  const [reviewWorkerIndex, setReviewWorkerIndex] = useState(0);
  const [reviewRatings, setReviewRatings] = useState({
    timeliness: 0,
    effort: 0,
    communication: 0,
    value: 0,
  });
  const [reviewPrivateNote, setReviewPrivateNote] = useState("");
  const [completionPhotoUrls, setCompletionPhotoUrls] = useState<string[]>([]);
  const [completionPhotosUploading, setCompletionPhotosUploading] = useState(false);
  const [addToTeamSelectedWorkerIds, setAddToTeamSelectedWorkerIds] = useState<number[]>([]);
  const [addToTeamAdding, setAddToTeamAdding] = useState(false);

  const { data: companyJobs, isLoading } = useQuery<JobWithApplications[]>({
    queryKey: ["/api/company/jobs"],
    enabled: open && !!jobId,
  });

  const { data: savedTeam = [] } = useQuery<{ workerId: number; companyLocationId?: number | null }[]>({
    queryKey: ["/api/saved-team"],
    enabled: open && flowStep === "addToTeam",
  });

  const job = companyJobs?.find((j) => j.id === jobId) ?? null;
  const pendingCount = job?.timesheets?.filter((t) => t.status === "pending").length ?? 0;
  const showPendingWarning = open && !!job && pendingCount > 0;
  const showFlowDialog = open && !!job && pendingCount === 0;

  const acceptedApps = (job?.applications || []).filter((a: { status: string }) => a.status === "accepted");
  const workers = acceptedApps.map((a: any) => ({
    app: a,
    workerId: a.worker?.id ?? a.workerId,
    name: a.worker
      ? `${a.worker.firstName || ""} ${a.worker.lastName || ""}`.trim() || "Worker"
      : "Worker",
  }));
  const currentWorker = workers[reviewWorkerIndex];
  const isLastWorker = reviewWorkerIndex >= workers.length - 1;
  const canCompleteReviewStep = workers.length === 0 || isLastWorker;
  const jobLocationId =
    job && ((job as any).locationId != null && (job as any).locationId > 0
      ? (job as any).locationId
      : job.companyLocationId != null && job.companyLocationId > 0
        ? job.companyLocationId
        : null);

  const resetFlowState = () => {
    setFlowStep("intro");
    setReviewWorkerIndex(0);
    setReviewRatings({ timeliness: 0, effort: 0, communication: 0, value: 0 });
    setReviewPrivateNote("");
    setCompletionPhotoUrls([]);
    setAddToTeamSelectedWorkerIds([]);
  };

  const handleClose = () => {
    onOpenChange(false);
    resetFlowState();
  };

  const handleContinueFromIntro = () => setFlowStep("photos");

  const handleContinueFromPhotos = async () => {
    if (!job) return;
    if (completionPhotoUrls.length > 0) {
      try {
        const existing = (job.images || []) as string[];
        await apiRequest("PATCH", `/api/company/jobs/${job.id}`, {
          images: [...existing, ...completionPhotoUrls],
        });
        queryClient.invalidateQueries({ queryKey: ["/api/company/jobs"] });
      } catch (e) {
        toast({ title: "Error", description: "Failed to save photos", variant: "destructive" });
        return;
      }
    }
    setFlowStep("reviews");
  };

  const handleNextOrCompleteReview = async () => {
    if (!job) return;
    if (
      currentWorker &&
      reviewRatings.timeliness > 0 &&
      reviewRatings.effort > 0 &&
      reviewRatings.communication > 0 &&
      reviewRatings.value > 0
    ) {
      try {
        await fetch("/api/reviews", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            jobId: job.id,
            workerId: currentWorker.workerId,
            timeliness: reviewRatings.timeliness,
            effort: reviewRatings.effort,
            communication: reviewRatings.communication,
            value: reviewRatings.value,
            comment: reviewPrivateNote || undefined,
          }),
        });
      } catch (e) {
        console.error("Submit review failed", e);
      }
      setReviewRatings({ timeliness: 0, effort: 0, communication: 0, value: 0 });
      setReviewPrivateNote("");
    }
    if (canCompleteReviewStep) {
      setFlowStep("addToTeam");
      return;
    }
    setReviewWorkerIndex((i) => i + 1);
  };

  const handleCompleteFromAddToTeam = async () => {
    if (!job) return;
    setAddToTeamAdding(true);
    try {
      for (const workerId of addToTeamSelectedWorkerIds) {
        await apiRequest("POST", "/api/saved-team", {
          workerId,
          jobId: job.id,
          locationId: jobLocationId ?? undefined,
        });
      }
      queryClient.invalidateQueries({ queryKey: ["/api/saved-team"] });
      queryClient.invalidateQueries({ queryKey: ["/api/team-by-location"] });
      const res = await apiRequest("PATCH", `/api/company/jobs/${job.id}`, { status: "completed" });
      if (res.ok) {
        queryClient.invalidateQueries({ queryKey: ["/api/company/jobs"] });
        queryClient.invalidateQueries({ queryKey: ["/api/chats/jobs"] });
        toast({ title: "Job completed", description: `"${job.title}" has been marked complete.` });
        setFlowStep("success");
      } else {
        toast({ title: "Error", description: "Failed to complete job", variant: "destructive" });
      }
    } catch (e) {
      toast({ title: "Error", description: "Failed to complete", variant: "destructive" });
    } finally {
      setAddToTeamAdding(false);
    }
  };

  const goToDashboardTimesheets = () => {
    onOpenChange(false);
    resetFlowState();
    setLocation("/company-dashboard/timesheets");
  };

  const StarRating = ({
    value,
    onChange,
    label,
  }: {
    value: number;
    onChange: (n: number) => void;
    label: string;
  }) => (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-sm font-medium w-24 shrink-0">{label}</span>
      <div className="flex gap-1">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => onChange(n)}
            className="p-1 rounded hover:bg-muted"
            aria-label={`${n} stars`}
          >
            <Star
              className={cn(
                "w-6 h-6",
                value >= n ? "fill-amber-400 text-amber-400" : "text-muted-foreground"
              )}
            />
          </button>
        ))}
      </div>
    </div>
  );

  if (!open) return null;

  if (showPendingWarning) {
    return (
      <Dialog open={true} onOpenChange={(o) => !o && onOpenChange(false)}>
        <DialogContent className={FULL_PAGE_DIALOG_CLASS} hideCloseButton={false} aria-describedby="pending-warning-desc">
          <DialogHeader className="flex-shrink-0 border-b px-4 pr-12 py-3 sm:px-6 sm:pr-14">
            <DialogTitle>Timesheets requiring approval</DialogTitle>
            <DialogDescription id="pending-warning-desc">
              {`Approve or reject the ${pendingCount} pending timesheet(s) for "${jobTitle}" before completing the job.`}
            </DialogDescription>
          </DialogHeader>
          <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4 sm:px-6">
            <p className="text-sm text-muted-foreground">
              Go to the company dashboard → Timesheets to approve or reject pending timesheets, then
              you can mark this job complete.
            </p>
          </div>
          <DialogFooter className="flex-shrink-0 border-t px-4 py-4 sm:px-6 flex flex-row gap-2 justify-end">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              OK
            </Button>
            <Button onClick={goToDashboardTimesheets}>
              <Briefcase className="w-4 h-4 mr-2" />
              Go to dashboard
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  if (isLoading || !job) {
    return (
      <Dialog open={true} onOpenChange={(o) => !o && onOpenChange(false)}>
        <DialogContent className={FULL_PAGE_DIALOG_CLASS} hideCloseButton={false} aria-describedby="mark-complete-loading-desc">
          <DialogHeader className="flex-shrink-0 border-b px-4 pr-12 py-3 sm:px-6 sm:pr-14">
            <DialogTitle>Mark job complete</DialogTitle>
            <DialogDescription id="mark-complete-loading-desc">Loading job details.</DialogDescription>
          </DialogHeader>
          <div className="flex-1 min-h-0 overflow-y-auto flex items-center justify-center py-12">
            <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  if (!showFlowDialog) return null;

  const stepTitle = STEP_TITLES[flowStep];
  const stepDescription = flowStep === "intro" || flowStep === "success" ? job.title : undefined;

  let footer: React.ReactNode = null;
  if (flowStep === "intro") {
    footer = (
      <div className="flex gap-2 flex-wrap w-full justify-end">
        <Button onClick={handleContinueFromIntro} data-testid="button-mark-complete-continue-intro">
          Continue
        </Button>
      </div>
    );
  } else if (flowStep === "photos") {
    footer = (
      <div className="flex gap-2 flex-wrap w-full justify-end">
        <Button variant="outline" onClick={() => setFlowStep("reviews")} data-testid="button-mark-complete-skip-photos">
          Skip
        </Button>
        <Button onClick={handleContinueFromPhotos} data-testid="button-mark-complete-continue-photos">
          Continue
        </Button>
      </div>
    );
  } else if (flowStep === "reviews") {
    footer = (
      <div className="flex gap-2 flex-wrap w-full justify-end">
        <Button
          onClick={handleNextOrCompleteReview}
          disabled={
            workers.length > 0 &&
            !!currentWorker &&
            (reviewRatings.timeliness === 0 ||
              reviewRatings.effort === 0 ||
              reviewRatings.communication === 0 ||
              reviewRatings.value === 0)
          }
          data-testid="button-next-or-complete-job"
        >
          {canCompleteReviewStep ? "Continue" : "Next worker"}
        </Button>
      </div>
    );
  } else if (flowStep === "addToTeam") {
    footer = (
      <div className="flex gap-2 flex-wrap w-full justify-end">
        <Button
          onClick={handleCompleteFromAddToTeam}
          disabled={addToTeamAdding}
          data-testid="button-mark-complete-finish"
        >
          {addToTeamAdding ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Completing…
            </>
          ) : (
            "Complete job"
          )}
        </Button>
      </div>
    );
  } else {
    footer = (
      <div className="flex gap-2 flex-wrap w-full justify-end">
        <Button onClick={handleClose} data-testid="button-mark-complete-done">
          Done
        </Button>
      </div>
    );
  }

  return (
    <Dialog
      open={showFlowDialog}
      onOpenChange={(o) => {
        if (!o) handleClose();
      }}
    >
      <DialogContent className={FULL_PAGE_DIALOG_CLASS} hideCloseButton={false} aria-describedby="mark-complete-flow-desc">
        <DialogHeader className="flex-shrink-0 border-b px-4 pr-12 py-3 sm:px-6 sm:pr-14">
          <DialogTitle>{stepTitle}</DialogTitle>
          {stepDescription != null && (
            <DialogDescription id="mark-complete-flow-desc">{stepDescription}</DialogDescription>
          )}
          {stepDescription == null && <DialogDescription id="mark-complete-flow-desc">Review and close out this job.</DialogDescription>}
        </DialogHeader>
        <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4 sm:px-6">
          <div className="space-y-4 max-w-md mx-auto">
        {flowStep === "intro" && (
          <p className="text-sm text-muted-foreground">
            You&apos;re about to close out this project. You&apos;ll confirm completed project photos
            (optional), leave reviews for each worker, optionally add workers to your team for this
            location, and then mark the job complete. Once complete, the job will be archived and no
            further chats, timesheets, or job details will be available.
          </p>
        )}

        {flowStep === "photos" && (
          <>
            <p className="text-sm text-muted-foreground">
              Add photos of the completed project (optional). These apply to the whole job.
            </p>
            <div className="flex flex-wrap gap-2">
              {completionPhotoUrls.map((url, i) => (
                <div key={i} className="relative w-20 h-20 rounded-lg overflow-hidden border bg-muted">
                  <img
                    src={
                      url.startsWith("http") || url.startsWith("/")
                        ? url
                        : `${typeof window !== "undefined" ? window.location.origin : ""}${url}`
                    }
                    alt=""
                    className="w-full h-full object-cover"
                  />
                  <button
                    type="button"
                    className="absolute top-0 right-0 p-1 bg-black/60 text-white rounded-bl"
                    onClick={() => setCompletionPhotoUrls((u) => u.filter((_, j) => j !== i))}
                  >
                    ×
                  </button>
                </div>
              ))}
              {completionPhotoUrls.length < 5 && (
                <label className="w-20 h-20 rounded-lg border border-dashed flex items-center justify-center cursor-pointer hover:bg-muted/50">
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    disabled={completionPhotosUploading}
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      e.target.value = "";
                      setCompletionPhotosUploading(true);
                      try {
                        assertMaxUploadSize(file);
                        const fileToUpload = await compressImageIfNeeded(file);
                        const urlResponse = await apiRequest("POST", "/api/uploads/request-url", {
                          name: fileToUpload.name,
                          size: fileToUpload.size,
                          contentType: fileToUpload.type,
                        });
                        const { uploadURL, objectPath } = await urlResponse.json();
                        await fetch(uploadURL, {
                          method: "PUT",
                          body: fileToUpload,
                          headers: { "Content-Type": fileToUpload.type },
                        });
                        if (!objectPath) throw new Error("No object path");
                        setCompletionPhotoUrls((u) => [...u, objectPath].slice(0, 5));
                      } catch (err) {
                        toast({ title: "Upload failed", variant: "destructive" });
                      } finally {
                        setCompletionPhotosUploading(false);
                      }
                    }}
                  />
                  {completionPhotosUploading ? (
                    <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                  ) : (
                    <Image className="w-6 h-6 text-muted-foreground" />
                  )}
                </label>
              )}
            </div>
          </>
        )}

        {flowStep === "reviews" && (
          <>
            {workers.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No accepted workers to review. You can continue to the next step.
              </p>
            ) : (
              <>
                <p className="text-sm text-muted-foreground">
                  Rate each worker ({reviewWorkerIndex + 1} of {workers.length}). If a worker is part
                  of a Business Operator&apos;s team, the review and private note go to the Business
                  Operator.
                </p>
                {currentWorker && (
                  <>
                    <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
                      <Avatar className="h-10 w-10">
                        <AvatarImage src={currentWorker.app.worker?.avatarUrl ?? undefined} />
                        <AvatarFallback>{currentWorker.name.slice(0, 2).toUpperCase()}</AvatarFallback>
                      </Avatar>
                      <span className="font-medium">{currentWorker.name}</span>
                      <span className="text-xs text-muted-foreground ml-auto">
                        Worker {reviewWorkerIndex + 1} of {workers.length}
                      </span>
                    </div>
                    <div className="space-y-4 py-2">
                      <StarRating
                        label="Timeliness"
                        value={reviewRatings.timeliness}
                        onChange={(n) => setReviewRatings((r) => ({ ...r, timeliness: n }))}
                      />
                      <StarRating
                        label="Effort"
                        value={reviewRatings.effort}
                        onChange={(n) => setReviewRatings((r) => ({ ...r, effort: n }))}
                      />
                      <StarRating
                        label="Communication"
                        value={reviewRatings.communication}
                        onChange={(n) => setReviewRatings((r) => ({ ...r, communication: n }))}
                      />
                      <StarRating
                        label="Value"
                        value={reviewRatings.value}
                        onChange={(n) => setReviewRatings((r) => ({ ...r, value: n }))}
                      />
                      <Label className="text-sm">Private note (optional)</Label>
                      <Textarea
                        placeholder="Feedback for your records (goes to Business Operator if this is a team member)"
                        value={reviewPrivateNote}
                        onChange={(e) => setReviewPrivateNote(e.target.value)}
                        className="min-h-[60px]"
                      />
                    </div>
                  </>
                )}
              </>
            )}
          </>
        )}

        {flowStep === "addToTeam" && (
          <>
            <p className="text-sm text-muted-foreground">
              {jobLocationId
                ? "Select workers from this job to add to your team for this location. You can invite them to future jobs at this location."
                : "Select workers from this job to add to your team."}
            </p>
            <div className="space-y-2 max-h-48 overflow-y-auto">
              {workers.map((w: any) => {
                const isSelected = addToTeamSelectedWorkerIds.includes(w.workerId);
                const alreadyOnTeam = savedTeam.some(
                  (m: any) =>
                    m.workerId === w.workerId &&
                    (jobLocationId == null || (m.companyLocationId ?? null) === jobLocationId)
                );
                return (
                  <div key={w.workerId} className="flex items-center gap-3 p-2 rounded-lg border">
                    <input
                      type="checkbox"
                      id={`add-team-${w.workerId}`}
                      checked={isSelected}
                      disabled={!!alreadyOnTeam}
                      onChange={() =>
                        setAddToTeamSelectedWorkerIds((ids) =>
                          isSelected ? ids.filter((id) => id !== w.workerId) : [...ids, w.workerId]
                        )
                      }
                    />
                    <label
                      htmlFor={`add-team-${w.workerId}`}
                      className="flex items-center gap-2 flex-1 cursor-pointer"
                    >
                      <Avatar className="h-8 w-8">
                        <AvatarImage src={w.app?.worker?.avatarUrl} />
                        <AvatarFallback>{w.name.slice(0, 2).toUpperCase()}</AvatarFallback>
                      </Avatar>
                      <span className="text-sm font-medium">{w.name}</span>
                      {alreadyOnTeam && (
                        <span className="text-xs text-muted-foreground">Already on team</span>
                      )}
                    </label>
                  </div>
                );
              })}
            </div>
          </>
        )}

        {flowStep === "success" && (
          <div className="py-4 text-center space-y-2">
            <CheckCircle className="w-12 h-12 text-green-500 mx-auto" />
            <p className="font-medium">Project completed</p>
            <p className="text-sm text-muted-foreground">
              This job is now closed. No more chats, timesheets, or job details—the project is
              archived and will appear in your completed filter.
            </p>
          </div>
        )}
          </div>
        </div>
        <DialogFooter className="flex-shrink-0 border-t px-4 py-4 sm:px-6 flex flex-row gap-2 justify-end">
          {footer}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
