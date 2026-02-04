"use client";

import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { AlertCircle } from "lucide-react";
import { getTimeSlots, getEndTimeSlotCandidates, getValidEndTimeSlots, getEarliestEndTime, formatTime12h } from "@/lib/utils";

const TIME_SLOTS = getTimeSlots();
const END_TIME_CANDIDATES = getEndTimeSlotCandidates();
const DAYS_OF_WEEK = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];

export interface OneDayScheduleCalendarTimeProps {
  date: string;
  onDateChange: (date: string) => void;
  startTime: string;
  onStartTimeChange: (time: string) => void;
  endTime: string;
  onEndTimeChange: (time: string) => void;
  minDate: Date;
  scheduleError: string | null;
  onScheduleErrorChange: (error: string | null) => void;
  validateTime?: (date: string, startTime: string, endTime: string) => { valid: boolean; error: string | null };
}

export function OneDayScheduleCalendarTime({
  date,
  onDateChange,
  startTime,
  onStartTimeChange,
  endTime,
  onEndTimeChange,
  minDate,
  scheduleError,
  onScheduleErrorChange,
  validateTime,
}: OneDayScheduleCalendarTimeProps) {
  const dateObj = date ? new Date(date) : new Date();

  const handleDateSelect = (newDate: Date | undefined) => {
    if (!newDate) return;
    const str = format(newDate, "yyyy-MM-dd");
    onDateChange(str);
    const v = validateTime?.(str, startTime, endTime);
    if (v) onScheduleErrorChange(v.valid ? null : v.error);
  };

  const handleStartTimeSelect = (slot: string) => {
    onStartTimeChange(slot);
    const validEnds = getValidEndTimeSlots(slot);
    const earliest = getEarliestEndTime(slot);
    if (endTime && !validEnds.includes(endTime) && earliest) {
      onEndTimeChange(earliest);
    }
    const newEnd = endTime && validEnds.includes(endTime) ? endTime : earliest;
    const v = validateTime?.(date, slot, newEnd);
    if (v) onScheduleErrorChange(v.valid ? null : v.error);
  };

  const handleEndTimeSelect = (slot: string) => {
    onEndTimeChange(slot);
    const v = validateTime?.(date, startTime, slot);
    if (v) onScheduleErrorChange(v.valid ? null : v.error);
  };

  return (
    <div className="space-y-3">
      <h3 className="text-base font-semibold">Choose start date and time</h3>
      <div className="rounded-lg border border-border overflow-hidden">
        <div className="flex flex-col sm:flex-row">
          <div className="flex-[6] min-w-0 sm:border-r sm:border-border flex justify-center items-center py-4">
            <Calendar
              mode="single"
              selected={dateObj}
              onSelect={handleDateSelect}
              className="p-2 sm:p-4 bg-background mx-auto"
              disabled={{ before: minDate }}
            />
          </div>
          <div className="relative w-full flex-[4] min-w-0 max-sm:min-h-[12rem] sm:min-h-[280px]">
            <div className="absolute inset-0 border-t sm:border-t-0 sm:border-l border-border py-4">
              <ScrollArea className="h-full">
                <div className="space-y-4 px-4 sm:px-5">
                  <div>
                    <p className="text-sm font-medium mb-2">{date ? format(dateObj, "EEEE, d") : "Select date"}</p>
                    <Label className="text-xs text-muted-foreground">Start Time</Label>
                    <div className="grid gap-1.5 mt-1 max-sm:grid-cols-2">
                      {TIME_SLOTS.map((timeSlot) => (
                        <Button
                          key={timeSlot}
                          variant={startTime === timeSlot ? "default" : "outline"}
                          size="sm"
                          className="w-full"
                          onClick={() => handleStartTimeSelect(timeSlot)}
                        >
                          {formatTime12h(timeSlot)}
                        </Button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">End Time</Label>
                    <div className="grid gap-1.5 mt-1 max-sm:grid-cols-2">
                      {(startTime ? getValidEndTimeSlots(startTime) : END_TIME_CANDIDATES).map((timeSlot) => (
                        <Button
                          key={timeSlot}
                          variant={endTime === timeSlot ? "default" : "outline"}
                          size="sm"
                          className="w-full"
                          onClick={() => handleEndTimeSelect(timeSlot)}
                        >
                          {formatTime12h(timeSlot)}
                        </Button>
                      ))}
                    </div>
                  </div>
                </div>
              </ScrollArea>
            </div>
          </div>
        </div>
      </div>
      {scheduleError && (
        <div className="flex gap-2 text-destructive text-sm">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {scheduleError}
        </div>
      )}
    </div>
  );
}

/** Map day name to JS weekday (0=Sun, 1=Mon, ... 6=Sat) */
const DAY_TO_NUM: Record<string, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

export interface RecurringScheduleCalendarTimeProps {
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
}

export function RecurringScheduleCalendarTime({
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
}: RecurringScheduleCalendarTimeProps) {
  const dateObj = startDate ? new Date(startDate) : new Date();

  const handleStartDateSelect = (newDate: Date | undefined) => {
    if (!newDate) return;
    const str = format(newDate, "yyyy-MM-dd");
    onStartDateChange(str);
    if (!endDate || new Date(endDate) < newDate) {
      const end = new Date(newDate);
      end.setDate(end.getDate() + (weeks - 1) * 7);
      onEndDateChange(format(end, "yyyy-MM-dd"));
    }
  };

  const toggleDay = (day: string) => {
    onDaysChange(
      days.includes(day) ? days.filter((d) => d !== day) : [...days, day]
    );
  };

  const handleWeeksChange = (w: number) => {
    onWeeksChange(w);
    if (startDate && w > 0) {
      const start = new Date(startDate);
      const end = new Date(start);
      end.setDate(end.getDate() + (w - 1) * 7);
      onEndDateChange(format(end, "yyyy-MM-dd"));
    }
  };

  // Dates that match the recurring pattern (between start and end, on selected days)
  const recurringDates = (() => {
    if (!startDate || !endDate || days.length === 0) return [];
    const start = new Date(startDate);
    const end = new Date(endDate);
    const result: Date[] = [];
    const dayNums = days.map((d) => DAY_TO_NUM[d] ?? -1).filter((n) => n >= 0);
    const current = new Date(start);
    current.setHours(0, 0, 0, 0);
    end.setHours(23, 59, 59, 999);
    while (current <= end) {
      if (dayNums.includes(current.getDay())) {
        result.push(new Date(current));
      }
      current.setDate(current.getDate() + 1);
    }
    return result;
  })();

  const isRecurringDate = (date: Date) =>
    recurringDates.some(
      (d) =>
        d.getFullYear() === date.getFullYear() &&
        d.getMonth() === date.getMonth() &&
        d.getDate() === date.getDate()
    );

  return (
    <div className="space-y-3">
      <h3 className="text-base font-semibold">Choose start date and time</h3>

      {/* Recurring days - above the main container */}
      <div className="rounded-lg border border-border bg-muted/30 p-3">
        <Label className="text-sm font-medium">Recurring days</Label>
        <p className="text-xs text-muted-foreground mb-2">
          Select which weekdays this schedule repeats
        </p>
        <div className="flex flex-wrap gap-1.5">
          {DAYS_OF_WEEK.map((day) => (
            <Button
              key={day}
              variant={days.includes(day) ? "default" : "outline"}
              size="sm"
              className="text-xs capitalize"
              onClick={() => toggleDay(day)}
            >
              {day.slice(0, 3)}
            </Button>
          ))}
        </div>
      </div>

      <div className="rounded-lg border border-border overflow-hidden">
        <div className="flex flex-col sm:flex-row">
          <div className="flex-[6] min-w-0 sm:border-r sm:border-border flex flex-col justify-center items-center py-4 gap-2">
            <Calendar
              mode="single"
              selected={dateObj}
              onSelect={handleStartDateSelect}
              className="p-2 sm:p-4 bg-background mx-auto"
              disabled={{ before: minDate }}
              modifiers={
                recurringDates.length > 0
                  ? { recurring: (date: Date) => isRecurringDate(date) }
                  : undefined
              }
              modifiersClassNames={
                recurringDates.length > 0
                  ? {
                      recurring: "bg-neutral-900 text-white ring-1 ring-neutral-900/50",
                    }
                  : undefined
              }
            />
            {recurringDates.length > 0 && (
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span className="w-3 h-3 rounded-sm bg-neutral-900 ring-1 ring-neutral-900/50" />
                <span>Recurring dates</span>
              </div>
            )}
          </div>
          <div className="relative w-full flex-[4] min-w-0 max-sm:min-h-[12rem] sm:min-h-[280px]">
            <div className="absolute inset-0 border-t sm:border-t-0 sm:border-l border-border py-4">
              <ScrollArea className="h-full">
                <div className="space-y-4 px-4 sm:px-5">
                  <div>
                    <Label className="text-xs text-muted-foreground">Start date</Label>
                    <Input
                      type="date"
                      value={startDate}
                      onChange={(e) => onStartDateChange(e.target.value)}
                      min={format(minDate, "yyyy-MM-dd")}
                      className="mt-1"
                    />
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">End date</Label>
                    <Input
                      type="date"
                      value={endDate}
                      onChange={(e) => onEndDateChange(e.target.value)}
                      min={startDate || format(minDate, "yyyy-MM-dd")}
                      className="mt-1"
                    />
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">Weeks</Label>
                    <Input
                      type="number"
                      min={1}
                      max={52}
                      value={weeks}
                      onChange={(e) =>
                        handleWeeksChange(parseInt(e.target.value) || 1)
                      }
                      className="mt-1"
                    />
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">Start Time</Label>
                    <div className="grid gap-1.5 mt-1 max-sm:grid-cols-2">
                      {TIME_SLOTS.map((timeSlot) => (
                        <Button
                          key={timeSlot}
                          variant={startTime === timeSlot ? "default" : "outline"}
                          size="sm"
                          className="w-full"
                          onClick={() => {
                            onStartTimeChange(timeSlot);
                            const validEnds = getValidEndTimeSlots(timeSlot);
                            const earliest = getEarliestEndTime(timeSlot);
                            if (endTime && !validEnds.includes(endTime) && earliest) {
                              onEndTimeChange(earliest);
                            }
                          }}
                        >
                          {formatTime12h(timeSlot)}
                        </Button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">End Time</Label>
                    <div className="grid gap-1.5 mt-1 max-sm:grid-cols-2">
                      {(startTime ? getValidEndTimeSlots(startTime) : END_TIME_CANDIDATES).map((timeSlot) => (
                        <Button
                          key={timeSlot}
                          variant={endTime === timeSlot ? "default" : "outline"}
                          size="sm"
                          className="w-full"
                          onClick={() => onEndTimeChange(timeSlot)}
                        >
                          {formatTime12h(timeSlot)}
                        </Button>
                      ))}
                    </div>
                  </div>
                </div>
              </ScrollArea>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
