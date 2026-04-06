"use client";

import { useState } from "react";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { AlertCircle, CalendarDays, ChevronDown, ChevronRight } from "lucide-react";
import { cn, getTimeSlots, getValidEndTimeSlots, getEarliestEndTime, formatTime12h } from "@/lib/utils";

const DAYS_OF_WEEK = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
const TIME_SLOTS = getTimeSlots();

function parseLocalDate(str: string): Date {
  const [y, m, d] = str.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/** Compute number of calendar months between start and end (inclusive), clamped 1–12 */
function monthsBetween(startStr: string, endStr: string): number {
  if (!startStr || !endStr) return 0;
  const start = parseLocalDate(startStr);
  const end = parseLocalDate(endStr);
  if (end < start) return 0;
  const months = (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth()) + 1;
  return Math.max(1, Math.min(12, months));
}

export interface MonthlyScheduleMultiStepProps {
  startDate: string;
  onStartDateChange: (date: string) => void;
  endDate: string;
  onEndDateChange: (date: string) => void;
  minDate: Date;
  todayStr: string;
  days: string[];
  onDaysChange: (days: string[]) => void;
  startTime: string;
  onStartTimeChange: (time: string) => void;
  endTime: string;
  onEndTimeChange: (time: string) => void;
  workersNeeded?: number;
  scheduleError?: string | null;
  onComplete?: () => void;
  step?: number;
  onStepChange?: (step: number) => void;
  hideFooter?: boolean;
}

export function MonthlyScheduleMultiStep({
  startDate,
  onStartDateChange,
  endDate,
  onEndDateChange,
  minDate,
  todayStr,
  days,
  onDaysChange,
  startTime,
  onStartTimeChange,
  endTime,
  onEndTimeChange,
  scheduleError,
  onComplete,
  hideFooter = false,
}: MonthlyScheduleMultiStepProps) {
  const [startTimeOpen, setStartTimeOpen] = useState(!startTime);
  const [endTimeOpen, setEndTimeOpen] = useState(!!startTime && !endTime);

  const startStr = startDate || todayStr;
  const endStr = endDate || startStr;
  const minDateStr = format(minDate, "yyyy-MM-dd");

  const monthsCount = monthsBetween(startStr, endStr);

  const handleStartDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    if (!v) return;
    onStartDateChange(v);
    const start = parseLocalDate(v);
    const currentEnd = endDate ? parseLocalDate(endDate) : null;
    if (!currentEnd || currentEnd < start) {
      const maxEnd = new Date(start.getFullYear(), start.getMonth() + 12, 0);
      onEndDateChange(format(maxEnd, "yyyy-MM-dd"));
    }
  };

  const handleEndDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    if (!v) return;
    const start = parseLocalDate(startStr);
    const end = parseLocalDate(v);
    if (end >= start) {
      const months = monthsBetween(startStr, v);
      if (months <= 12) onEndDateChange(v);
    }
  };

  const toggleDay = (day: string) => {
    onDaysChange(
      days.includes(day) ? days.filter((d) => d !== day) : [...days, day]
    );
  };

  const hoursPerDay =
    startTime && endTime
      ? parseInt(endTime.split(":")[0], 10) - parseInt(startTime.split(":")[0], 10)
      : 0;
  const canProceed =
    days.length > 0 &&
    !!startStr &&
    !!endStr &&
    parseLocalDate(endStr) >= parseLocalDate(startStr) &&
    monthsCount >= 1 &&
    monthsCount <= 12 &&
    !!startTime &&
    !!endTime &&
    hoursPerDay > 0;

  const handleDone = () => {
    if (canProceed && onComplete) onComplete();
  };

  return (
    <div className="space-y-4 py-2">
      {/* Date range: Start Date + End Date inputs only (no full calendar, no "How many months?" stepper) */}
      <div className="rounded-none border border-border overflow-hidden">
        <div className="flex flex-row overflow-x-auto">
          <div className="flex-[5] min-w-0 shrink-0 border-r border-border flex flex-col px-4 py-4 bg-muted/20 gap-4 min-w-[200px]">
            <div className="w-full max-w-[280px] space-y-4">
              <div>
                <Label className="text-sm font-semibold">Start date</Label>
                <p className="text-xs text-muted-foreground mb-1">First day of the schedule</p>
                <Input
                  type="date"
                  min={minDateStr}
                  value={startStr}
                  onChange={handleStartDateChange}
                  className="mt-1 w-full"
                  data-testid="input-monthly-start-date"
                />
                {startStr && (
                  <p className="text-xs text-muted-foreground mt-1">
                    {format(parseLocalDate(startStr), "EEE, MMM d, yyyy")}
                  </p>
                )}
              </div>
              <div>
                <Label className="text-sm font-semibold">End date</Label>
                <p className="text-xs text-muted-foreground mb-1">Last day (range up to 12 months)</p>
                <Input
                  type="date"
                  min={startStr || minDateStr}
                  value={endStr}
                  onChange={handleEndDateChange}
                  className="mt-1 w-full"
                  data-testid="input-monthly-end-date"
                />
                {endStr && (
                  <p className="text-xs text-muted-foreground mt-1">
                    {format(parseLocalDate(endStr), "EEE, MMM d, yyyy")}
                    {monthsCount > 0 && (
                      <span className="ml-1">({monthsCount} month{monthsCount !== 1 ? "s" : ""})</span>
                    )}
                  </p>
                )}
              </div>
            </div>
          </div>
          <div className="flex-[4] min-w-0 px-[6px] py-4 min-h-[280px] min-w-[180px]">
            <ScrollArea className="h-full">
              <div className="space-y-4 pr-2">
                <div>
                  <div className="flex items-start gap-2 mb-2">
                    <CalendarDays className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                    <div>
                      <Label className="text-sm font-semibold">Which days repeat?</Label>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Weekdays when work will occur each month
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {DAYS_OF_WEEK.map((day) => {
                      const selected = days.includes(day);
                      return (
                        <Button
                          key={day}
                          variant="outline"
                          size="sm"
                          className={cn(
                            "text-xs capitalize h-8",
                            selected &&
                              "bg-green-600 text-white border-green-600 hover:bg-green-700 hover:text-white focus-visible:ring-green-600 dark:bg-green-600 dark:border-green-600 dark:text-white dark:hover:bg-green-700"
                          )}
                          onClick={() => toggleDay(day)}
                        >
                          {day.slice(0, 3)}
                        </Button>
                      );
                    })}
                  </div>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Start time (daily)</Label>
                  <Collapsible
                    open={startTimeOpen}
                    onOpenChange={(open) => {
                      setStartTimeOpen(open);
                      if (open) setEndTimeOpen(false);
                    }}
                  >
                    <CollapsibleTrigger asChild>
                      <Button variant="outline" className="w-full mt-1 justify-between h-9 text-sm">
                        <span>{startTime ? formatTime12h(startTime) : "Select start time"}</span>
                        {startTimeOpen ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
                      </Button>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <div className="grid gap-1.5 mt-1 grid-cols-1 max-h-[200px] overflow-y-auto">
                        {TIME_SLOTS.map((timeSlot) => (
                          <Button
                            key={timeSlot}
                            variant={startTime === timeSlot ? "default" : "outline"}
                            size="sm"
                            className="w-full"
                            onClick={() => {
                              onStartTimeChange(timeSlot);
                              setStartTimeOpen(false);
                              const validEnds = getValidEndTimeSlots(timeSlot);
                              const earliest = getEarliestEndTime(timeSlot);
                              if (endTime && !validEnds.includes(endTime) && earliest) onEndTimeChange(earliest);
                            }}
                          >
                            {formatTime12h(timeSlot)}
                          </Button>
                        ))}
                      </div>
                    </CollapsibleContent>
                  </Collapsible>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">End time (daily)</Label>
                  <Collapsible
                    open={endTimeOpen}
                    onOpenChange={(open) => {
                      setEndTimeOpen(open);
                      if (open) setStartTimeOpen(false);
                    }}
                  >
                    <CollapsibleTrigger asChild>
                      <Button variant="outline" className="w-full mt-1 justify-between h-9 text-sm">
                        <span>{endTime ? formatTime12h(endTime) : "Select end time"}</span>
                        {endTimeOpen ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
                      </Button>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <div className="grid gap-1.5 mt-1 grid-cols-1 max-h-[200px] overflow-y-auto">
                        {startTime
                          ? getValidEndTimeSlots(startTime).map((timeSlot) => (
                              <Button
                                key={timeSlot}
                                variant={endTime === timeSlot ? "default" : "outline"}
                                size="sm"
                                className="w-full"
                                onClick={() => {
                                  onEndTimeChange(timeSlot);
                                  setEndTimeOpen(false);
                                }}
                              >
                                {formatTime12h(timeSlot)}
                              </Button>
                            ))
                          : null}
                      </div>
                    </CollapsibleContent>
                  </Collapsible>
                </div>
              </div>
            </ScrollArea>
          </div>
        </div>
      </div>
      {scheduleError && (
        <div className="flex gap-2 text-destructive text-sm">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {scheduleError}
        </div>
      )}
      {!hideFooter && (
        <div className="flex justify-end">
          <Button onClick={handleDone} disabled={!canProceed}>
            Done
          </Button>
        </div>
      )}
    </div>
  );
}
