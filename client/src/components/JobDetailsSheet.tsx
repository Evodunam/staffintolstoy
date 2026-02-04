import { format, parseISO } from "date-fns";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { MobilePopup } from "@/components/ui/mobile-popup";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { MapPin, Navigation, XCircle, Phone, Building2, Clock, LogOut, AlertCircle, Loader2 } from "lucide-react";
import { MiniJobMap } from "./JobsMap";
import type { Job, Profile, WorkerTeamMember, Timesheet } from "@shared/schema";

interface TeamMemberBasic {
  id: number;
  firstName: string;
  lastName: string;
  avatarUrl: string | null;
  hourlyRate: number;
  phone?: string | null;
}

interface CompanyInfo {
  id: number;
  companyName: string | null;
  phone: string | null;
}

interface ClockInStatus {
  isClockedIn: boolean;
  activeTimesheet: Timesheet | null;
  activeJobId: number | null;
}

interface JobDetailsSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  job: Job | null;
  status: "accepted" | "pending" | "opportunity" | "rejected";
  applicationId?: number;
  proposedRate?: number;
  profile: Profile | null;
  teamMember?: TeamMemberBasic | null;
  company?: CompanyInfo | null;
  activeTeamMembers?: TeamMemberBasic[];
  workerHourlyRate?: number;
  clockInStatus?: ClockInStatus;
  clockInError?: string | null;
  isClockingIn?: boolean;
  isClockingOut?: boolean;
  isWithdrawing?: boolean;
  onClockIn?: (jobId: number, workerId: number) => Promise<{ success: boolean; error?: string }>;
  onClockOut?: (timesheetId: number) => Promise<{ success: boolean; error?: string }>;
  onGetDirections?: (job: Job) => void;
  onWithdraw?: (applicationId: number) => void;
  onUpdateTeamMember?: (applicationId: number, teamMemberId: number | null) => void;
  onApply?: (job: Job) => void;
}

export function JobDetailsSheet({
  open,
  onOpenChange,
  job,
  status,
  applicationId,
  proposedRate,
  profile,
  teamMember,
  company,
  activeTeamMembers = [],
  workerHourlyRate = 30,
  clockInStatus,
  clockInError,
  isClockingIn,
  isClockingOut,
  isWithdrawing,
  onClockIn,
  onClockOut,
  onGetDirections,
  onWithdraw,
  onUpdateTeamMember,
  onApply,
}: JobDetailsSheetProps) {
  if (!job) return null;

  const fullAddress = `${job.address || ""}, ${job.city || ""}, ${job.state || ""} ${job.zipCode || ""}`.replace(/^, |, $/g, "");

  const getDisplayAddress = () => {
    if (status === "accepted") {
      return fullAddress || job.location || "Address not provided";
    }
    const streetWithoutNumber = (job.address || "").replace(/^\d+\s*/, "");
    const partialAddress = [streetWithoutNumber, job.city, job.state, job.zipCode]
      .filter(Boolean)
      .join(", ");
    return partialAddress || job.location || "General area";
  };

  const getHourlyRate = () => {
    // Always use proposedRate first (the rate at time of application), not current team member rate
    return proposedRate || teamMember?.hourlyRate || workerHourlyRate;
  };

  const getEstimatedPayout = () => {
    const hours = job.estimatedHours || 8;
    const rate = getHourlyRate();
    return `$${(rate * hours).toFixed(0)}`;
  };

  const startDate = job.startDate instanceof Date ? job.startDate : new Date(job.startDate);
  const isClockedInToThisJob = clockInStatus?.activeJobId === job.id;
  const isJobToday = new Date().toDateString() === startDate.toDateString();
  const isAssignedWorker = !teamMember;
  const canClockIn = status === "accepted" && isJobToday && !clockInStatus?.isClockedIn && isAssignedWorker;
  const canClockOut = isClockedInToThisJob && clockInStatus?.activeTimesheet && isAssignedWorker;
  const isJobPast = new Date() >= startDate;
  const isRoleFilled = status === "pending" && (job.workersHired ?? 0) >= (job.maxWorkersNeeded ?? 1) && (job.maxWorkersNeeded ?? 1) > 0;

  const handleClockIn = async () => {
    if (onClockIn && profile) {
      await onClockIn(job.id, profile.id);
    }
  };

  const handleClockOut = async () => {
    if (onClockOut && clockInStatus?.activeTimesheet) {
      await onClockOut(clockInStatus.activeTimesheet.id);
    }
  };

  return (
    <MobilePopup
      open={open}
      onOpenChange={onOpenChange}
      title={job.title}
      description={job.trade || ""}
      maxWidth="lg"
    >
        <div className="space-y-6">
          <div className="flex items-center gap-2">
            <Badge 
              variant={status === "opportunity" ? "outline" : "default"}
              className={
                status === "accepted" ? "bg-green-500 text-white" :
                isRoleFilled ? "bg-gray-500 text-white" :
                status === "pending" ? "bg-amber-500 text-white" :
                status === "rejected" ? "bg-red-500 text-white" :
                "border-dashed border-blue-400 text-blue-600"
              }
            >
              {status === "accepted" ? "Accepted" : 
               isRoleFilled ? "Role Filled" :
               status === "pending" ? "Pending Review" : 
               status === "rejected" ? "Not Selected" :
               "Available"}
            </Badge>
          </div>

          {status !== "opportunity" && (
            <div className="flex items-center gap-3">
              <Avatar className="w-12 h-12 border-2 border-primary/20">
                <AvatarImage src={teamMember?.avatarUrl || profile?.avatarUrl || undefined} />
                <AvatarFallback>
                  {teamMember ? `${teamMember.firstName?.[0]}${teamMember.lastName?.[0]}` : `${profile?.firstName?.[0]}${profile?.lastName?.[0]}`}
                </AvatarFallback>
              </Avatar>
              <div>
                <p className="font-medium">
                  {teamMember ? `${teamMember.firstName} ${teamMember.lastName}` : `${profile?.firstName} ${profile?.lastName}`}
                </p>
                {teamMember && (
                  <p className="text-sm text-muted-foreground">Team Member</p>
                )}
              </div>
            </div>
          )}
          
          <Card className="bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Estimated Payout</p>
                  <p className="text-2xl font-bold text-green-600">{getEstimatedPayout()}</p>
                </div>
                <div className="text-right">
                  <p className="text-sm text-muted-foreground">
                    {job.estimatedHours || 8} hours @ ${getHourlyRate()}/hr
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
          
          <div className="space-y-4">
            <div>
              <h4 className="text-sm font-medium text-muted-foreground mb-1">Date & Time</h4>
              <p className="font-medium">
                {format(startDate, "EEEE, MMMM d, yyyy")}
              </p>
              {job.scheduledTime ? (
                <p className="text-sm text-muted-foreground">at {job.scheduledTime}</p>
              ) : startDate.getHours() !== 0 || startDate.getMinutes() !== 0 ? (
                <p className="text-sm text-muted-foreground">{format(startDate, "h:mm a")}</p>
              ) : null}
              {job.endDate && (
                <p className="text-sm text-muted-foreground">
                  to {format(new Date(job.endDate), "h:mm a")}
                </p>
              )}
            </div>
            
            <div>
              <h4 className="text-sm font-medium text-muted-foreground mb-1">
                {status === "accepted" ? "Full Address" : "Location"}
              </h4>
              <p className="font-medium flex items-center gap-1">
                <MapPin className="w-4 h-4 flex-shrink-0 text-muted-foreground" />
                {getDisplayAddress()}
              </p>
            </div>
            
            {job.serviceCategory && (
              <div>
                <h4 className="text-sm font-medium text-muted-foreground mb-1">Skills Required</h4>
                <Badge variant="secondary">{job.serviceCategory} {job.skillLevel && `(${job.skillLevel})`}</Badge>
              </div>
            )}
            
            {job.description && (
              <div>
                <h4 className="text-sm font-medium text-muted-foreground mb-1">Description</h4>
                <p className="text-sm">{job.description}</p>
              </div>
            )}
          </div>
          
          {status === "accepted" && company && (
            <Card className="border-primary/20">
              <CardContent className="p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <Building2 className="w-5 h-5 text-primary" />
                  <h4 className="font-medium">Company Contact</h4>
                </div>
                <div className="space-y-2">
                  <p className="font-medium">{company.companyName || 'Company'}</p>
                  {company.phone && (
                    <a 
                      href={`tel:${company.phone}`}
                      className="flex items-center gap-2 text-primary hover:underline"
                      data-testid="job-sheet-company-phone"
                    >
                      <Phone className="w-4 h-4" />
                      {company.phone}
                    </a>
                  )}
                </div>
              </CardContent>
            </Card>
          )}
          
          {status === "accepted" && (
            <Card className="border-blue-200 dark:border-blue-800">
              <CardContent className="p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <Phone className="w-5 h-5 text-blue-500" />
                  <h4 className="font-medium">Assigned Worker</h4>
                </div>
                <div className="flex items-center gap-3">
                  <Avatar className="w-10 h-10 border">
                    <AvatarImage src={teamMember?.avatarUrl || profile?.avatarUrl || undefined} />
                    <AvatarFallback>
                      {teamMember ? `${teamMember.firstName?.[0]}${teamMember.lastName?.[0]}` : `${profile?.firstName?.[0]}${profile?.lastName?.[0]}`}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1">
                    <p className="font-medium">
                      {teamMember ? `${teamMember.firstName} ${teamMember.lastName}` : `${profile?.firstName} ${profile?.lastName}`}
                    </p>
                    {(teamMember?.phone || profile?.phone) && (
                      <a 
                        href={`tel:${teamMember?.phone || profile?.phone}`}
                        className="flex items-center gap-1 text-sm text-blue-500 hover:underline"
                        data-testid="job-sheet-worker-phone"
                      >
                        <Phone className="w-3 h-3" />
                        {teamMember?.phone || profile?.phone}
                      </a>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
          
          {status === "pending" && activeTeamMembers.length > 0 && applicationId && onUpdateTeamMember && (
            <div className="space-y-2">
              <h4 className="text-sm font-medium text-muted-foreground">Assign Team Member</h4>
              <Select
                value={teamMember?.id?.toString() || "self"}
                onValueChange={(value) => {
                  const newTeamMemberId = value === "self" ? null : parseInt(value);
                  onUpdateTeamMember(applicationId, newTeamMemberId);
                }}
              >
                <SelectTrigger data-testid="job-sheet-select-team-member">
                  <SelectValue placeholder="Select team member" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="self" data-testid="job-sheet-select-team-member-self">
                    <div className="flex items-center gap-2">
                      <Avatar className="w-6 h-6">
                        <AvatarImage src={profile?.avatarUrl || undefined} />
                        <AvatarFallback>{profile?.firstName?.[0]}{profile?.lastName?.[0]}</AvatarFallback>
                      </Avatar>
                      <span>Myself - ${profile?.hourlyRate}/hr</span>
                    </div>
                  </SelectItem>
                  {activeTeamMembers.map((member) => (
                    <SelectItem key={member.id} value={member.id.toString()} data-testid={`job-sheet-select-team-member-${member.id}`}>
                      <div className="flex items-center gap-2">
                        <Avatar className="w-6 h-6">
                          <AvatarImage src={member.avatarUrl || undefined} />
                          <AvatarFallback>{member.firstName?.[0]}{member.lastName?.[0]}</AvatarFallback>
                        </Avatar>
                        <span>{member.firstName} {member.lastName} - ${member.hourlyRate}/hr</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          
          {clockInError && (
            <Alert variant="destructive" className="mb-3">
              <AlertCircle className="w-4 h-4" />
              <AlertDescription>{clockInError}</AlertDescription>
            </Alert>
          )}
          
          <div className="space-y-3">
            {canClockIn && onClockIn && (
              <Button 
                className="w-full bg-green-600 hover:bg-green-700"
                onClick={handleClockIn}
                disabled={isClockingIn}
                data-testid="job-sheet-clock-in"
              >
                {isClockingIn ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <Clock className="w-4 h-4 mr-2" />
                )}
                Clock In
              </Button>
            )}
            
            {canClockOut && onClockOut && (
              <Button 
                variant="outline"
                className="w-full border-amber-500 text-amber-600 hover:bg-amber-50"
                onClick={handleClockOut}
                disabled={isClockingOut}
                data-testid="job-sheet-clock-out"
              >
                {isClockingOut ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <LogOut className="w-4 h-4 mr-2" />
                )}
                Clock Out
              </Button>
            )}
            
            {status === "accepted" && onGetDirections && (
              <Button 
                className="w-full" 
                onClick={() => onGetDirections(job)}
                data-testid="job-sheet-get-directions"
              >
                <Navigation className="w-4 h-4 mr-2" />
                Get Directions
              </Button>
            )}
            
            {status === "pending" && onWithdraw && applicationId && !isJobPast && (
              <Button 
                variant="destructive" 
                className="w-full"
                onClick={() => onWithdraw(applicationId)}
                disabled={isWithdrawing}
                data-testid="job-sheet-withdraw"
              >
                {isWithdrawing ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <XCircle className="w-4 h-4 mr-2" />
                )}
                Withdraw Application
              </Button>
            )}
            
            {status === "opportunity" && onApply && (
              <Button 
                className="w-full"
                onClick={() => onApply(job)}
                data-testid="job-sheet-apply"
              >
                Apply for This Job
              </Button>
            )}
          </div>
          
          {((job as any).mapThumbnailUrl || (job.latitude && job.longitude)) && (
            <div className="rounded-lg overflow-hidden border h-48">
              {(job as any).mapThumbnailUrl ? (
                <img src={(job as any).mapThumbnailUrl} alt="Job location" className="w-full h-full object-cover" />
              ) : (
                <MiniJobMap
                  job={{
                    id: job.id,
                    lat: parseFloat(job.latitude!),
                    lng: parseFloat(job.longitude!),
                    title: job.title,
                  }}
                />
              )}
            </div>
          )}
        </div>
    </MobilePopup>
  );
}
