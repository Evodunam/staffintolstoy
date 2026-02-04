"use client";

import { useState } from "react";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { AlertCircle, CalendarDays, ChevronDown, ChevronRight } from "lucide-react";
import { cn, getTimeSlots, getEndTimeSlotCandidates, getValidEndTimeSlots, getEarliestEndTime, formatTime12h } from "@/lib/utils";

const DAYS_OF_WEEK = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
const DAY_TO_NUM: Record<string, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

const TIME_SLOTS = getTimeSlots();
const END_TIME_CANDIDATES = getEndTimeSlotCandidates();

/** Parse "yyyy-MM-dd" as local date (avoids UTC timezone issues) */
function parseLocalDate(str: string): Date {
  const [y, m, d] = str.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export interface RecurringScheduleMultiStepProps {
  startDate: string;
  onStartDateChange: (date: string) => void;
  endDate: string;
  onEndDateChange: (date: string) => void;
  days: string[];
  onDaysChange: (days: string[]) => void;
  startTime: string;
  onStartTimeChange: (time: string) => void;
  endTime: string;
  onEndTimeChange: (time: string) => void;
  weeks: number;
  onWeeksChange: (weeks: number) => void;
  minDate: Date;
  workersNeeded: number;
  todayStr: string;
  scheduleError?: string | null;
  onComplete?: () => void;
  step?: number;
  onStepChange?: (step: number) => void;
  hideFooter?: boolean;
}

export function RecurringScheduleMultiStep({
  startDate,
  onStartDateChange,
  endDate,
  onEndDateChange,
  days,
  onDaysChange,
  startTime,
  onStartTimeChange,
  endTime,
  onEndTimeChange,
  weeks,
  onWeeksChange,
  minDate,
  workersNeeded,
  todayStr,
  scheduleError,
  onComplete,
  step: _step,
  onStepChange: _onStepChange,
  hideFooter = false,
}: RecurringScheduleMultiStepProps) {
  // Only one of Start time / End time accordion open at a time
  const [startTimeOpen, setStartTimeOpen] = useState(!startTime);
  const [endTimeOpen, setEndTimeOpen] = useState(!!startTime && !endTime);

  const startStr = startDate || todayStr;
  /** End date = start + (weeks * 7 - 1) days so N weeks gives exactly N*7 days inclusive */
  const computeEndFromWeeks = (start: Date, w: number) => {
    const end = new Date(start);
    end.setDate(end.getDate() + Math.max(0, w * 7 - 1));
    return format(end, "yyyy-MM-dd");
  };
  const endStr = endDate || (() => {
    const start = parseLocalDate(startStr);
    return computeEndFromWeeks(start, weeks);
  })();

  const handleWeeksChange = (w: number) => {
    onWeeksChange(w);
    if (startStr && w > 0) {
      const start = parseLocalDate(startStr);
      onEndDateChange(computeEndFromWeeks(start, w));
    }
  };

  const handleStartDateSelect = (newDate: Date | undefined) => {
    if (!newDate) return;
    const str = format(newDate, "yyyy-MM-dd");
    onStartDateChange(str);
    const newStart = parseLocalDate(str);
    const currentEnd = endDate ? parseLocalDate(endDate) : null;
    if (!currentEnd || currentEnd < newStart) {
      onEndDateChange(computeEndFromWeeks(newStart, weeks));
    }
  };

  const toggleDay = (day: string) => {
    onDaysChange(
      days.includes(day) ? days.filter((d) => d !== day) : [...days, day]
    );
  };

  // Working days: dates between start and end that fall on selected weekdays only
  const workingDates = (() => {
    if (!startStr || !endStr || days.length === 0) return [];
    const start = parseLocalDate(startStr);
    const end = parseLocalDate(endStr);
    if (end < start) return [];
    const result: Date[] = [];
    const dayNums = days.map((d) => DAY_TO_NUM[d] ?? -1).filter((n) => n >= 0);
    const current = new Date(start.getFullYear(), start.getMonth(), start.getDate());
    const endDate = new Date(end.getFullYear(), end.getMonth(), end.getDate());
    while (current <= endDate) {
      if (dayNums.includes(current.getDay())) {
        result.push(new Date(current.getTime()));
      }
      current.setDate(current.getDate() + 1);
    }
    return result;
  })();

  const isWorkingDate = (date: Date) =>
    workingDates.some(
      (d) =>
        d.getFullYear() === date.getFullYear() &&
        d.getMonth() === date.getMonth() &&
        d.getDate() === date.getDate()
    );

  const startDateObj = startStr ? parseLocalDate(startStr) : undefined;

  const hoursPerDay =
    startTime && endTime
      ? parseInt(endTime.split(":")[0]) - parseInt(startTime.split(":")[0])
      : 0;
  const estimatedHours =
    days.length > 0 && startStr && endStr && workingDates.length > 0
      ? hoursPerDay * workingDates.length * workersNeeded
      : hoursPerDay * days.length * weeks * workersNeeded;

  const canProceed =
    days.length > 0 &&
    weeks >= 1 &&
    !!startStr &&
    !!startTime &&
    !!endTime &&
    hoursPerDay > 0;

  const handleDone = () => {
    if (canProceed && onComplete) onComplete();
  };

  /* Single card: left = calendar + weeks, right = days + start/end time */
  return (
    <div className="space-y-4 py-2">
      <div className="rounded-lg border border-border overflow-hidden">
        <div className="flex flex-row overflow-x-auto">
          {/* Left column: calendar + number of weeks */}
          <div className="flex-[5] min-w-0 shrink-0 border-r border-border flex flex-col items-center p-4 bg-muted/20 gap-4 min-w-[200px]">
            <div className="w-full max-w-[260px]">
              <Label className="text-sm font-semibold">Start week</Label>
              <p className="text-xs text-muted-foreground mb-2">Pick the start date</p>
              <Calendar
                mode="single"
                selected={startDateObj}
                onSelect={handleStartDateSelect}
                className="p-2 sm:p-3 bg-background w-full max-w-full rounded-md border border-border"
                disabled={{ before: minDate }}
                classNames={{
                  day_selected:
                    "bg-gray-200 text-gray-900 hover:bg-gray-300 focus:bg-gray-200 dark:bg-gray-600 dark:text-gray-100 dark:hover:bg-gray-500 dark:focus:bg-gray-600",
                }}
                modifiers={
                  workingDates.length > 0
                    ? { working: (date: Date) => isWorkingDate(date) }
                    : undefined
                }
                modifiersClassNames={
                  workingDates.length > 0
                    ? { working: "bg-green-600 text-white ring-1 ring-green-600/50 dark:bg-green-600 dark:text-white dark:ring-green-500/50" }
                    : undefined
                }
              />
              {startStr && (
                <p className="text-xs text-muted-foreground mt-2">
                  Starts {format(parseLocalDate(startStr), "EEE, MMM d")}
                </p>
              )}
            </div>
            <div className="w-full max-w-[260px]">
              <Label className="text-xs font-medium text-muted-foreground">
                How many weeks?
              </Label>
              <div className="mt-1 flex w-full items-center gap-0 rounded-lg border border-border bg-background overflow-hidden">
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="h-9 w-9 shrink-0 rounded-none border-0 border-r border-border"
                  onClick={() => handleWeeksChange(Math.max(1, weeks - 1))}
                  disabled={weeks <= 1}
                  aria-label="Decrease weeks"
                >
                  −
                </Button>
                <Input
                  type="number"
                  min={1}
                  max={52}
                  value={weeks}
                  onChange={(e) => {
                    const v = parseInt(e.target.value, 10);
                    if (!Number.isNaN(v)) handleWeeksChange(Math.max(1, Math.min(52, v)));
                  }}
                  className="h-9 flex-1 min-w-0 rounded-none border-0 text-center px-1 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="h-9 w-9 shrink-0 rounded-none border-0 border-l border-border"
                  onClick={() => handleWeeksChange(Math.min(52, weeks + 1))}
                  disabled={weeks >= 52}
                  aria-label="Increase weeks"
                >
                  +
                </Button>
              </div>
            </div>
          </div>
          {/* Right column: which days + start time + end time */}
          <div className="flex-[4] min-w-0 p-4 min-h-[280px] min-w-[180px]">
            <ScrollArea className="h-full">
              <div className="space-y-4 pr-2">
                <div>
                  <div className="flex items-start gap-2 mb-2">
                    <CalendarDays className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                    <div>
                      <Label className="text-sm font-semibold">Which days repeat?</Label>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Mon–Sun when work will occur
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
