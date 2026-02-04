import { cn } from "@/lib/utils"
import { Card, CardContent } from "./card"
import { Badge } from "./badge"
import { Avatar, AvatarImage, AvatarFallback } from "./avatar"
import { Button } from "./button"
import { 
  Clock, Calendar, Users, AlertTriangle
} from "lucide-react"
import { formatDistanceToNow } from "date-fns"

export interface JobTimelineItem {
  id: number
  title: string
  trade: string
  description: string
  startDate: string
  endDate?: string
  startTime?: string
  endTime?: string
  timelineType: "on-demand" | "one-day" | "recurring"
  hourlyRate: number
  estimatedHours: number
  maxWorkersNeeded: number
  workersHired: number
  status: string
  applications: any[]
  timesheets?: any[]
  images?: string[]
  videos?: string[]
  locationId: number
  recurringDays?: string[]
  recurringWeeks?: number
  createdAt?: string
}

export interface JobTimelineProps {
  jobs: JobTimelineItem[]
  onJobClick: (job: JobTimelineItem) => void
  onApplicantsClick: (job: JobTimelineItem, e: React.MouseEvent) => void
  onAdjustTimeline?: (job: JobTimelineItem, e: React.MouseEvent) => void
  formatRate: (rate: number) => string
  isMobile?: boolean
  renderActions?: (job: JobTimelineItem) => React.ReactNode
}

const getTimelineTypeConfig = (type: string) => {
  switch (type) {
    case "on-demand":
      return {
        label: "ASAP",
        color: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300",
        icon: Clock
      }
    case "one-day":
      return {
        label: "One Day",
        color: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
        icon: Calendar
      }
    case "recurring":
      return {
        label: "Recurring",
        color: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300",
        icon: Calendar
      }
    default:
      return {
        label: type,
        color: "bg-gray-100 text-gray-700 dark:bg-gray-900/30 dark:text-gray-300",
        icon: Clock
      }
  }
}

const formatDateWithSuffix = (dateStr: string) => {
  if (!dateStr) return ""
  const date = new Date(dateStr)
  const day = date.getDate()
  const suffix = day % 10 === 1 && day !== 11 ? "st" 
               : day % 10 === 2 && day !== 12 ? "nd"
               : day % 10 === 3 && day !== 13 ? "rd" : "th"
  const month = date.toLocaleDateString('en-US', { month: 'short' })
  return `${month} ${day}${suffix}`
}

const formatTime = (timeStr?: string) => {
  if (!timeStr) return ""
  const [hours, minutes] = timeStr.split(":").map(Number)
  const isPM = hours >= 12
  const hour12 = hours % 12 || 12
  const period = isPM ? "pm" : "am"
  return minutes > 0 ? `${hour12}:${minutes.toString().padStart(2, "0")}${period}` : `${hour12}${period}`
}

// Helper function to format creation date (e.g., "Created today", "Created yesterday", "Created 4 days ago")
const formatCreationDate = (createdAt?: string): string | null => {
  if (!createdAt) return null;
  
  try {
    const createdDate = new Date(createdAt);
    const now = new Date();
    const diffInMs = now.getTime() - createdDate.getTime();
    const diffInDays = Math.floor(diffInMs / (1000 * 60 * 60 * 24));
    
    if (diffInDays === 0) {
      // Check if it's today
      const today = new Date();
      if (createdDate.toDateString() === today.toDateString()) {
        return "Created today";
      }
    } else if (diffInDays === 1) {
      return "Created yesterday";
    } else if (diffInDays > 1) {
      return `Created ${diffInDays} days ago`;
    }
    
    // Fallback to relative time
    return `Created ${formatDistanceToNow(createdDate, { addSuffix: true })}`;
  } catch (error) {
    return null;
  }
}

const getDaysAway = (dateStr: string): { text: string; isPast: boolean; isToday: boolean } => {
  if (!dateStr) return { text: "", isPast: false, isToday: false }
  
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  
  const targetDate = new Date(dateStr)
  targetDate.setHours(0, 0, 0, 0)
  
  const diffTime = targetDate.getTime() - today.getTime()
  const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24))
  
  if (diffDays === 0) {
    return { text: "Today", isPast: false, isToday: true }
  } else if (diffDays === 1) {
    return { text: "Tomorrow", isPast: false, isToday: false }
  } else if (diffDays > 1) {
    return { text: `${diffDays} days away`, isPast: false, isToday: false }
  } else {
    return { text: "", isPast: true, isToday: false }
  }
}

const getRecurringDaysShort = (days?: string[]) => {
  if (!days || days.length === 0) return ""
  const dayMap: Record<string, string> = {
    "monday": "Mon",
    "tuesday": "Tue",
    "wednesday": "Wed",
    "thursday": "Thur",
    "friday": "Fri",
    "saturday": "Sat",
    "sunday": "Sun"
  }
  return days.map(d => dayMap[d.toLowerCase()] || d).join(", ")
}

const formatJobDateTime = (job: JobTimelineItem) => {
  const dateStr = formatDateWithSuffix(job.startDate)
  const startTime = formatTime(job.startTime)
  const endTime = formatTime(job.endTime)
  const { text: daysAwayText, isPast, isToday } = getDaysAway(job.startDate)
  
  let timeInfo = ""
  let daysAway = ""
  
  if (!isPast && daysAwayText) {
    daysAway = ` (${daysAwayText})`
  }
  
  switch (job.timelineType) {
    case "one-day":
      if (startTime && endTime) {
        timeInfo = `${dateStr} - ${startTime} to ${endTime}${daysAway}`
      } else if (startTime) {
        timeInfo = `${dateStr} - ${startTime}${daysAway}`
      } else {
        timeInfo = `${dateStr}${daysAway}`
      }
      break
    case "on-demand":
      if (startTime) {
        timeInfo = `${dateStr} - Start at ${startTime}${daysAway}`
      } else {
        timeInfo = `${dateStr}${daysAway}`
      }
      break
    case "recurring":
      const recurringDays = getRecurringDaysShort(job.recurringDays)
      if (startTime && endTime && recurringDays) {
        timeInfo = `${dateStr} - ${startTime} to ${endTime} (${recurringDays})${daysAway}`
      } else if (startTime && recurringDays) {
        timeInfo = `${dateStr} - ${startTime} (${recurringDays})${daysAway}`
      } else if (recurringDays) {
        timeInfo = `${dateStr} (${recurringDays})${daysAway}`
      } else {
        timeInfo = `${dateStr}${daysAway}`
      }
      break
    default:
      timeInfo = `${dateStr}${daysAway}`
  }
  
  return { timeInfo, isPast, isToday }
}

export function JobTimeline({ 
  jobs, 
  onJobClick, 
  onApplicantsClick,
  onAdjustTimeline,
  formatRate,
  isMobile = false,
  renderActions
}: JobTimelineProps) {
  if (!jobs || jobs.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        No jobs to display
      </div>
    )
  }

  const sortedJobs = [...jobs].sort((a, b) => {
    const dateA = new Date(a.startDate || "9999-12-31")
    const dateB = new Date(b.startDate || "9999-12-31")
    return dateA.getTime() - dateB.getTime()
  })

  return (
    <div className="relative">
      <div 
        className="absolute left-5 top-0 bottom-0 w-0.5 bg-border" 
        aria-hidden="true"
      />
      
      <div className="space-y-4">
        {sortedJobs.map((job) => {
          const typeConfig = getTimelineTypeConfig(job.timelineType)
          const TypeIcon = typeConfig.icon
          const pendingApplicants = job.applications.filter(a => a.status === "pending").length
          const acceptedWorkers = job.applications.filter(a => a.status === "accepted")
          const hasWorkersWorking = job.workersHired > 0 || acceptedWorkers.length > 0
          const showInProgress = (job.status === "open" || job.status === "in_progress") && hasWorkersWorking
          const { timeInfo, isPast } = formatJobDateTime(job)
          const needsReschedule = isPast && acceptedWorkers.length === 0 && job.status === "open"
          const isDelayed = job.status !== "completed" && job.status !== "cancelled" &&
            job.workersHired < job.maxWorkersNeeded && job.startDate && (() => {
              const today = new Date();
              today.setHours(0, 0, 0, 0);
              const start = new Date(job.startDate);
              start.setHours(0, 0, 0, 0);
              return (today.getTime() - start.getTime()) >= 24 * 60 * 60 * 1000;
            })()
          
          return (
            <div
              key={job.id}
              className="relative group"
            >
              <div className="flex items-start gap-4">
                <div className="relative flex-shrink-0 z-10">
                  <div className={cn(
                    "w-10 h-10 rounded-full flex items-center justify-center border-2 border-background shadow-sm",
                    needsReschedule
                      ? "bg-amber-100 dark:bg-amber-900/50"
                      : job.status === "completed" 
                      ? "bg-green-100 dark:bg-green-900/50" 
                      : showInProgress || job.status === "in_progress"
                      ? "bg-blue-100 dark:bg-blue-900/50"
                      : "bg-primary/10"
                  )}>
                    {needsReschedule ? (
                      <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                    ) : (
                      <TypeIcon className={cn(
                        "w-4 h-4",
                        job.status === "completed" 
                          ? "text-green-600 dark:text-green-400" 
                          : job.status === "in_progress"
                          ? "text-blue-600 dark:text-blue-400"
                          : "text-primary"
                      )} />
                    )}
                  </div>
                </div>

                <Card 
                  className={cn(
                    "flex-1 cursor-pointer transition-all duration-200 hover:shadow-md border-border/60",
                    "group-hover:border-primary/30",
                    needsReschedule && "border-amber-300 dark:border-amber-700"
                  )}
                  onClick={() => onJobClick(job)}
                  data-testid={`job-timeline-${job.id}`}
                >
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2 mb-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <h4 className="font-semibold text-base group-hover:text-primary transition-colors">
                              {job.title}
                            </h4>
                            <Badge 
                              variant={showInProgress ? "secondary" : job.status === "open" ? "default" : job.status === "in_progress" ? "secondary" : "outline"} 
                              className="text-xs"
                            >
                              {showInProgress ? "In Progress" : job.status === "in_progress" ? "In Progress" : job.status.charAt(0).toUpperCase() + job.status.slice(1)}
                            </Badge>
                          </div>
                        </div>
                        
                        <div className="flex items-center gap-2 flex-wrap text-sm text-muted-foreground mb-2">
                          {formatCreationDate(job.createdAt) && (
                            <Badge variant="outline" className="text-xs">
                              {formatCreationDate(job.createdAt)}
                            </Badge>
                          )}
                          <span>{job.trade} • {job.estimatedHours}h</span>
                          <Badge className={cn("text-xs font-medium", typeConfig.color)}>
                            <TypeIcon className="w-3 h-3 mr-1" />
                            {typeConfig.label}
                          </Badge>
                          <Badge variant="outline" className="text-xs">
                            <Users className="w-3 h-3 mr-1" />
                            {job.workersHired}/{job.maxWorkersNeeded} workers
                          </Badge>
                          {isDelayed && (
                            <Badge variant="outline" className="text-xs border-amber-500/60 bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-500/50">
                              Delayed
                            </Badge>
                          )}
                        </div>
                        
                        {job.startDate && (
                          <div className={cn(
                            "text-sm mb-2 flex items-center gap-1",
                            needsReschedule ? "text-amber-600 dark:text-amber-400 font-medium" : "text-muted-foreground"
                          )}>
                            <Calendar className="w-3 h-3" />
                            {timeInfo}
                          </div>
                        )}
                        
                        {pendingApplicants > 0 && (
                          <div className="flex flex-wrap items-center gap-2 mb-2">
                            <Badge 
                              variant="destructive" 
                              className="text-xs cursor-pointer hover:opacity-80"
                              onClick={(e) => {
                                e.stopPropagation()
                                onApplicantsClick(job, e)
                              }}
                              data-testid={`badge-applicants-${job.id}`}
                            >
                              {pendingApplicants} applicant{pendingApplicants !== 1 ? 's' : ''}
                            </Badge>
                          </div>
                        )}
                        
                        {needsReschedule && onAdjustTimeline && (
                          <div className="mt-3" onClick={(e) => e.stopPropagation()}>
                            <Button 
                              size="sm" 
                              variant="outline"
                              className="border-amber-300 text-amber-700 hover:bg-amber-50 dark:border-amber-700 dark:text-amber-400 dark:hover:bg-amber-900/30"
                              onClick={(e) => onAdjustTimeline(job, e)}
                              data-testid={`button-reschedule-${job.id}`}
                            >
                              <AlertTriangle className="w-3 h-3 mr-1" />
                              Reschedule & Resend Alert
                            </Button>
                          </div>
                        )}
                        
                        {!isMobile && acceptedWorkers.length > 0 && (
                          <div className="flex items-center gap-1 mt-3" onClick={(e) => e.stopPropagation()}>
                            {acceptedWorkers.slice(0, 4).map((app) => (
                              <Avatar key={app.id} className="w-6 h-6 border-2 border-background">
                                <AvatarImage src={app.worker.avatarUrl} />
                                <AvatarFallback className="text-[8px]">
                                  {app.worker.firstName[0]}{app.worker.lastName[0]}
                                </AvatarFallback>
                              </Avatar>
                            ))}
                            {acceptedWorkers.length > 4 && (
                              <span className="text-xs text-muted-foreground ml-1">
                                +{acceptedWorkers.length - 4}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                      
                      {renderActions && (
                        <div onClick={(e) => e.stopPropagation()}>
                          {renderActions(job)}
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
