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
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { AlertCircle, ChevronDown, ChevronRight } from "lucide-react";
import { cn, parseLocalDate, getTimeSlots, getValidEndTimeSlots, getEarliestEndTime, formatTime12h } from "@/lib/utils";

const TIME_SLOTS = getTimeSlots();

export interface OneDayScheduleMultiStepProps {
  date: string;
  onDateChange: (date: string) => void;
  startTime: string;
  onStartTimeChange: (time: string) => void;
  endTime: string;
  onEndTimeChange: (time: string) => void;
  minDate: Date;
  workersNeeded: number;
  scheduleError: string | null;
  onScheduleErrorChange: (error: string | null) => void;
  validateTime?: (date: string, startTime: string, endTime?: string) => { valid: boolean; error: string | null };
  onComplete?: () => void;
  step?: number;
  onStepChange?: (step: number) => void;
  hideFooter?: boolean;
}

export function OneDayScheduleMultiStep({
  date,
  onDateChange,
  startTime,
  onStartTimeChange,
  endTime,
  onEndTimeChange,
  minDate,
  workersNeeded,
  scheduleError,
  onScheduleErrorChange,
  validateTime,
  onComplete,
  step: controlledStep,
  onStepChange,
  hideFooter = false,
}: OneDayScheduleMultiStepProps) {
  const [internalStep, setInternalStep] = useState(1);
  const step = controlledStep ?? internalStep;
  const setStep = onStepChange ?? setInternalStep;

  // Only one of Start time / End time accordion open at a time
  const [startTimeOpen, setStartTimeOpen] = useState(!startTime);
  const [endTimeOpen, setEndTimeOpen] = useState(!!startTime && !endTime);
  const dateObj = date ? parseLocalDate(date) : minDate;

  const estimatedHours =
    date && startTime && endTime
      ? (parseInt(endTime.split(":")[0]) - parseInt(startTime.split(":")[0])) *
        workersNeeded
      : 0;

  const handleDateSelect = (newDate: Date | undefined) => {
    if (!newDate) return;
    const str = format(newDate, "yyyy-MM-dd");
    onDateChange(str);
    const v = validateTime?.(str, startTime, endTime);
    if (v) onScheduleErrorChange(v.valid ? null : v.error);
  };

  const handleStartTimeSelect = (slot: string) => {
    onStartTimeChange(slot);
    setStartTimeOpen(false);
    const validEnds = getValidEndTimeSlots(slot);
    const earliest = getEarliestEndTime(slot);
    const endStillValid = endTime && validEnds.includes(endTime);
    if (!endStillValid && earliest) {
      onEndTimeChange(earliest);
    }
    const newEnd = endStillValid ? endTime : earliest;
    const v = validateTime?.(date, slot, newEnd);
    if (v) onScheduleErrorChange(v.valid ? null : v.error);
  };

  const handleEndTimeSelect = (slot: string) => {
    onEndTimeChange(slot);
    setEndTimeOpen(false);
    const v = validateTime?.(date, startTime, slot);
    if (v) onScheduleErrorChange(v.valid ? null : v.error);
  };

  const canProceedStep1 =
    date &&
    startTime &&
    endTime &&
    (!validateTime || validateTime(date, startTime, endTime).valid);

  const handleDone = () => {
    if (canProceedStep1 && onComplete) onComplete();
  };

  return (
    <div className="space-y-4 py-2">
      <>
        <h3 className="text-base font-semibold">Choose date and time</h3>
          <div className="rounded-lg border border-border overflow-hidden">
            <div className="flex flex-row">
              <div className="flex-[6] min-w-0 w-full border-r border-border flex justify-center items-center py-4">
                <Calendar
                  mode="single"
                  selected={dateObj}
                  onSelect={handleDateSelect}
                  className="p-2 sm:p-4 bg-background w-full max-w-full"
                  disabled={{ before: minDate }}
                />
              </div>
              <div className="relative w-full flex-[4] min-w-0 min-h-[280px]">
                <div className="absolute inset-0 border-l border-border py-4">
                  <ScrollArea className="h-full">
                    <div className="space-y-4 px-4 sm:px-5">
                      <div>
                        <p className="text-sm font-medium mb-2">
                          {date ? format(dateObj, "EEEE, MMM d") : "Select date on calendar"}
                        </p>
                        <p className="text-xs text-muted-foreground mb-2">Pick a date on the calendar to the left</p>

                        <Collapsible
                          open={startTimeOpen}
                          onOpenChange={(open) => {
                            setStartTimeOpen(open);
                            if (open) setEndTimeOpen(false);
                          }}
                        >
                          <Label className="text-xs text-muted-foreground">
                            Start Time
                          </Label>
                          <CollapsibleTrigger asChild>
                            <Button
                              variant="outline"
                              className="w-full mt-1 justify-between"
                            >
                              <span>
                                {startTime
                                  ? formatTime12h(startTime)
                                  : "Select start time"}
                              </span>
                              {startTimeOpen ? (
                                <ChevronDown className="h-4 w-4" />
                              ) : (
                                <ChevronRight className="h-4 w-4" />
                              )}
                            </Button>
                          </CollapsibleTrigger>
                          <CollapsibleContent>
                            <div className="grid gap-1.5 mt-1 grid-cols-1">
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
                          </CollapsibleContent>
                        </Collapsible>
                      </div>

                      {startTime && (
                        <Collapsible
                          open={endTimeOpen}
                          onOpenChange={(open) => {
                            setEndTimeOpen(open);
                            if (open) setStartTimeOpen(false);
                          }}
                        >
                          <Label className="text-xs text-muted-foreground">
                            End Time
                          </Label>
                          <CollapsibleTrigger asChild>
                            <Button
                              variant="outline"
                              className="w-full mt-1 justify-between"
                            >
                              <span>
                                {endTime
                                  ? formatTime12h(endTime)
                                  : "Select end time"}
                              </span>
                              {endTimeOpen ? (
                                <ChevronDown className="h-4 w-4" />
                              ) : (
                                <ChevronRight className="h-4 w-4" />
                              )}
                            </Button>
                          </CollapsibleTrigger>
                          <CollapsibleContent>
                            <div className="grid gap-1.5 mt-1 grid-cols-1">
                              {getValidEndTimeSlots(startTime).map((timeSlot) => (
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
                          </CollapsibleContent>
                        </Collapsible>
                      )}
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
          {!hideFooter && (
            <div className="flex justify-end">
              <Button onClick={handleDone} disabled={!canProceedStep1}>
                Done
              </Button>
            </div>
          )}
        </>
    </div>
  );
}
