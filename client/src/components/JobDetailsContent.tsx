"use client";

import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { MapPin, Briefcase } from "lucide-react";

/**
 * Shared job details content: cost summary (company) + Job Details card.
 * Used 1:1 in JobDetailsPanel (Chats) and CompanyDashboard job details view.
 */
export interface JobDetailsContentProps {
  /** Show the 3 cost summary cards (Spent, Pending, Hours) in a horizontal strip */
  showCostSummary: boolean;
  estimatedTotalCost?: number;
  /** e.g. "8h × 2 workers" or "Flexible hours" (unused; Est. Total removed) */
  estTotalSubtext?: string;
  amountSpent: number;
  approvedCount: number;
  amountPending: number;
  pendingCount: number;
  hoursClocked: number;
  hoursRemaining?: number;
  /** Single line: address, city, state (e.g. "123 Main St, Cincinnati, OH") */
  addressLine: string;
  trade: string;
  rateDisplay: string;
  estimatedHoursDisplay: string;
  workersDisplay: string;
  jobTypeDisplay?: string;
  timeDisplay?: string;
  startDateDisplay?: string;
  endDateDisplay?: string;
  recurringDaysDisplay?: string;
  description?: string;
}

export function JobDetailsContent({
  showCostSummary,
  estimatedTotalCost,
  estTotalSubtext,
  amountSpent,
  approvedCount,
  amountPending,
  pendingCount,
  hoursClocked,
  hoursRemaining,
  addressLine,
  trade,
  rateDisplay,
  estimatedHoursDisplay,
  workersDisplay,
  jobTypeDisplay,
  timeDisplay,
  startDateDisplay,
  endDateDisplay,
  recurringDaysDisplay,
  description,
}: JobDetailsContentProps) {
  return (
    <div className="space-y-4">
      {showCostSummary && (
        <div className="overflow-x-auto -mx-1 px-1 scrollbar-pill-on-scroll" data-testid="job-cost-summary">
          <div className="flex gap-2 flex-nowrap min-w-0">
            <div className="flex-shrink-0 bg-gradient-to-br from-green-50 to-emerald-50 dark:from-green-950/40 dark:to-emerald-950/30 rounded-md p-1.5 sm:p-2 border border-green-200/50 dark:border-green-800/30 min-w-[72px] sm:min-w-[80px]">
              <p className="text-[10px] sm:text-xs text-green-700 dark:text-green-300 font-medium">Spent</p>
              <p className="text-sm sm:text-base font-bold text-green-800 dark:text-green-200 leading-tight" data-testid="text-amount-spent">${amountSpent.toLocaleString()}</p>
            </div>
            <div className="flex-shrink-0 bg-gradient-to-br from-yellow-50 to-amber-50 dark:from-yellow-950/40 dark:to-amber-950/30 rounded-md p-1.5 sm:p-2 border border-yellow-200/50 dark:border-yellow-800/30 min-w-[72px] sm:min-w-[80px]">
              <p className="text-[10px] sm:text-xs text-yellow-700 dark:text-yellow-300 font-medium">Pending</p>
              <p className="text-sm sm:text-base font-bold text-yellow-800 dark:text-yellow-200 leading-tight" data-testid="text-amount-pending">${amountPending.toLocaleString()}</p>
            </div>
            <div className="flex-shrink-0 bg-gradient-to-br from-purple-50 to-pink-50 dark:from-purple-950/40 dark:to-pink-950/30 rounded-md p-1.5 sm:p-2 border border-purple-200/50 dark:border-purple-800/30 min-w-[72px] sm:min-w-[80px]">
              <p className="text-[10px] sm:text-xs text-purple-700 dark:text-purple-300 font-medium">Hours</p>
              <p className="text-sm sm:text-base font-bold text-purple-800 dark:text-purple-200 leading-tight" data-testid="text-hours-clocked">{hoursClocked.toFixed(1)}h</p>
            </div>
          </div>
        </div>
      )}

      <Card className="p-3">
        <h4 className="font-semibold text-sm mb-2 flex items-center gap-2">
          <Briefcase className="w-4 h-4 text-muted-foreground" />
          Job Details
        </h4>
        <div className="space-y-2 text-sm">
          <div className="flex items-center gap-2 text-muted-foreground">
            <MapPin className="w-3 h-3" />
            <span className="text-xs">{addressLine}</span>
          </div>
          {trade && (
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">Trade</span>
              <Badge variant="secondary" className="text-[10px]">{trade}</Badge>
            </div>
          )}
          <div className="flex justify-between text-xs">
            <span className="text-muted-foreground">Rate</span>
            <span className="font-medium">{rateDisplay}</span>
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-muted-foreground">Est. Hours</span>
            <span className="font-medium">{estimatedHoursDisplay}</span>
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-muted-foreground">Workers</span>
            <span className="font-medium">{workersDisplay}</span>
          </div>
          {jobTypeDisplay != null && jobTypeDisplay !== "" && (
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">Type</span>
              <span className="font-medium capitalize">
                {jobTypeDisplay.toLowerCase() === "recurring" && recurringDaysDisplay
                  ? `Recurring (${recurringDaysDisplay})`
                  : jobTypeDisplay}
              </span>
            </div>
          )}
          {recurringDaysDisplay != null && recurringDaysDisplay !== "" && jobTypeDisplay?.toLowerCase() !== "recurring" && (
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">Recurring days</span>
              <span className="font-medium capitalize">{recurringDaysDisplay}</span>
            </div>
          )}
          {timeDisplay != null && timeDisplay !== "" && (
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">Time</span>
              <span className="font-medium">{timeDisplay}</span>
            </div>
          )}
          {startDateDisplay != null && startDateDisplay !== "" && (
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">Start Date</span>
              <span className="font-medium">{startDateDisplay}</span>
            </div>
          )}
          {endDateDisplay != null && endDateDisplay !== "" && (
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">End Date</span>
              <span className="font-medium">{endDateDisplay}</span>
            </div>
          )}
        </div>
        {description != null && description !== "" && (
          <div className="mt-3 pt-2 border-t hidden sm:block">
            <p className="text-xs text-muted-foreground line-clamp-3">{description}</p>
          </div>
        )}
      </Card>
    </div>
  );
}
