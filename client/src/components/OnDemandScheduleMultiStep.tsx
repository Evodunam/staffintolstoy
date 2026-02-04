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
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { AlertCircle, ChevronDown, ChevronRight, Info } from "lucide-react";
import { cn, parseLocalDate } from "@/lib/utils";

type DateRange = { from?: Date; to?: Date };

const ON_DEMAND_EST_HOURLY = 40;
const ON_DEMAND_EST_HOURS_PER_DAY = 8;

/** Convert 24h "HH:mm" to 12h display e.g. "9:00 AM", "12:30 PM" */
function formatTime12h(time24: string): string {
  const [hStr, mStr] = time24.split(":");
  const h = parseInt(hStr, 10);
  const m = mStr ? parseInt(mStr, 10) : 0;
  if (h === 0) return `12:${String(m).padStart(2, "0")} AM`;
  if (h === 12) return `12:${String(m).padStart(2, "0")} PM`;
  if (h < 12) return `${h}:${String(m).padStart(2, "0")} AM`;
  return `${h - 12}:${String(m).padStart(2, "0")} PM`;
}

/** Generate 30-min time slots from 6 AM to 8 PM in 24h format */
function getTimeSlots(): string[] {
  const slots: string[] = [];
  for (let h = 6; h <= 20; h++) {
    slots.push(`${String(h).padStart(2, "0")}:00`);
    if (h < 20) slots.push(`${String(h).padStart(2, "0")}:30`);
  }
  return slots;
}

const TIME_SLOTS = getTimeSlots();

export interface OnDemandScheduleMultiStepProps {
  date: string;
  onDateChange: (date: string) => void;
  time: string;
  onTimeChange: (time: string) => void;
  doneByDate: string;
  onDoneByDateChange: (date: string) => void;
  budget: number | null;
  onBudgetChange: (value: number | null) => void;
  workersNeeded: number;
  todayStr: string;
  minDateForStart: Date;
  validateTime: (date: string, time: string) => { valid: boolean; error: string | null };
  scheduleError: string | null;
  onScheduleErrorChange: (error: string | null) => void;
  /** Callback when user completes the flow (e.g. to close popup) */
  onComplete?: () => void;
  /** Compact layout for inline/desktop when not in a modal */
  compact?: boolean;
  /** Controlled step (1-3). When provided with onStepChange, progress/footer is managed by parent. */
  step?: number;
  onStepChange?: (step: number) => void;
  /** Hide progress bar and footer - use when parent (e.g. ResponsiveDialog) provides footer with progress + actions */
  hideFooter?: boolean;
}

export function OnDemandScheduleMultiStep({
  date,
  onDateChange,
  time,
  onTimeChange,
  doneByDate,
  onDoneByDateChange,
  budget,
  onBudgetChange,
  workersNeeded,
  todayStr,
  minDateForStart,
  validateTime,
  scheduleError,
  onScheduleErrorChange,
  onComplete,
  compact = false,
  step: controlledStep,
  onStepChange,
  hideFooter = false,
}: OnDemandScheduleMultiStepProps) {
  const [internalStep, setInternalStep] = useState(1);
  const step = controlledStep ?? internalStep;
  const setStep = onStepChange ?? setInternalStep;
  const [timeOpen, setTimeOpen] = useState(!time);
  const rangeSelected: DateRange | undefined = date
    ? { from: parseLocalDate(date), to: doneByDate ? parseLocalDate(doneByDate) : undefined }
    : undefined;

  const handleRangeSelect = (range: DateRange | undefined) => {
    if (!range?.from) {
      onDateChange("");
      onDoneByDateChange("");
      return;
    }
    const fromStr = format(range.from, "yyyy-MM-dd");
    const toStr = range.to ? format(range.to, "yyyy-MM-dd") : "";
    onDateChange(fromStr);
    onDoneByDateChange(toStr);
    if (fromStr && (!time || time === "09:00")) onTimeChange("09:00");
    setTimeOpen(false);
    const v = validateTime(fromStr, time || "09:00");
    onScheduleErrorChange(v.valid ? null : v.error);
  };

  const clearRange = () => {
    onDateChange("");
    onDoneByDateChange("");
    onScheduleErrorChange(null);
  };

  const calculatedBudget = (() => {
    const endDate = doneByDate || date;
    if (!date || !endDate) return ON_DEMAND_EST_HOURS_PER_DAY * ON_DEMAND_EST_HOURLY * workersNeeded;
    const start = parseLocalDate(date);
    const end = parseLocalDate(endDate);
    if (end < start) return ON_DEMAND_EST_HOURS_PER_DAY * ON_DEMAND_EST_HOURLY * workersNeeded;
    const days = Math.ceil((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000)) + 1;
    return days * ON_DEMAND_EST_HOURS_PER_DAY * ON_DEMAND_EST_HOURLY * workersNeeded;
  })();

  const handleTimeSelect = (slot: string) => {
    onTimeChange(slot);
    const v = validateTime(date, slot);
    onScheduleErrorChange(v.valid ? null : v.error);
  };

  const suggestedBudget = calculatedBudget;

  const canProceedStep1 = date && time && validateTime(date, time).valid;

  const handleNext = () => {
    if (step === 1 && canProceedStep1) {
      setStep(2);
      if (!budget) onBudgetChange(suggestedBudget);
    } else if (step === 2 && onComplete) onComplete();
  };

  const handleBack = () => {
    if (step > 1) setStep(step - 1);
  };

  const renderStepIndicator = () =>
    !hideFooter ? (
      <div className="flex items-center gap-1 mb-4">
        <div className="h-2 rounded-full flex-1 transition-colors bg-primary" />
      </div>
    ) : null;

  const rangeHeaderTooltip = (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex items-center gap-1.5 cursor-help">
            <span>Choose start and end date</span>
            <Info className="h-4 w-4 text-muted-foreground shrink-0" />
          </span>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-[280px]">
          <p>Click a date to set start, then click another to set end. The range will highlight. Use &quot;Clear selection&quot; below to remove the range.</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );

  const calendarTimeLayout = (
    <div className="space-y-3">
      <h3 className="text-base font-semibold">{rangeHeaderTooltip}</h3>
      <div className="rounded-lg border border-border overflow-hidden">
        <div className="flex flex-row">
          <div className="flex-[6] min-w-0 w-full border-r border-border flex flex-col justify-center items-center py-4">
            <p className="text-xs text-muted-foreground mb-2 px-2 text-center w-full">
              Click a start date on the calendar, then select another for due by date (optional)
            </p>
            <Calendar
              mode="range"
              selected={rangeSelected}
              onSelect={handleRangeSelect as (range: DateRange | undefined) => void}
              className="p-2 sm:p-4 bg-background w-full max-w-full"
              disabled={{ before: minDateForStart }}
            />
          </div>
          <div className="relative w-full flex-[4] min-w-0 min-h-[280px]">
            <div className="absolute inset-0 border-l border-border py-4">
              <ScrollArea className="h-full">
                <div className="space-y-4 px-4 sm:px-5">
                  <div>
                    {date ? (
                      <>
                        <p className="text-sm font-medium mb-1">Start date: {format(parseLocalDate(date), "EEE, MMM d")}</p>
                        {doneByDate ? (
                          <>
                            <p className="text-sm font-medium mb-1">Due by date: {format(parseLocalDate(doneByDate), "EEE, MMM d")}</p>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={clearRange}
                              className="mt-2 h-8 text-xs"
                            >
                              Clear selection
                            </Button>
                          </>
                        ) : (
                          <p className="text-xs text-muted-foreground">Click another date for due by (optional)</p>
                        )}
                      </>
                    ) : null}
                  </div>
                  <Collapsible open={timeOpen} onOpenChange={setTimeOpen}>
                    <Label className="text-xs text-muted-foreground">Start time</Label>
                    <CollapsibleTrigger asChild>
                      <Button
                        variant="outline"
                        className="w-full mt-1 justify-between"
                      >
                        <span>{time ? formatTime12h(time) : "Select start time"}</span>
                        {timeOpen ? (
                          <ChevronDown className="h-4 w-4 shrink-0" />
                        ) : (
                          <ChevronRight className="h-4 w-4 shrink-0" />
                        )}
                      </Button>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <div className="grid gap-1.5 mt-1 grid-cols-1">
                        {TIME_SLOTS.map((timeSlot) => (
                          <Button
                            key={timeSlot}
                            variant={time === timeSlot ? "default" : "outline"}
                            size="sm"
                            className="w-full"
                            onClick={() => {
                              handleTimeSelect(timeSlot);
                              setTimeOpen(false);
                            }}
                          >
                            {formatTime12h(timeSlot)}
                          </Button>
                        ))}
                      </div>
                    </CollapsibleContent>
                  </Collapsible>
                </div>
              </ScrollArea>
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  if (compact) {
    return (
      <div className="space-y-4">
        {renderStepIndicator()}
        {step === 1 && (
          <>
            {calendarTimeLayout}
          </>
        )}
        {scheduleError && step === 1 && (
          <div className="flex items-center gap-2 text-destructive text-sm">
            <AlertCircle className="w-4 h-4 shrink-0" />
            {scheduleError}
          </div>
        )}
        {!hideFooter && (
          <div className="flex items-center justify-between gap-3 pt-2 border-t pt-4 -mx-1 px-1">
            <Button
              variant="outline"
              className="flex-1 sm:flex-none sm:min-w-[100px] h-9 rounded-lg"
              onClick={handleBack}
              disabled={step === 1}
            >
              Back
            </Button>
            <Button
              className="flex-1 sm:flex-none sm:min-w-[120px] h-9 text-sm font-semibold rounded-lg shadow-md bg-neutral-900 hover:bg-neutral-800 text-white border-0"
              onClick={handleNext}
              disabled={step === 1 && !canProceedStep1}
            >
              {step === 2 ? "Done" : "Next"}
            </Button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4 py-2">
      {renderStepIndicator()}
      {step === 1 && (
        <>
          {calendarTimeLayout}
          {scheduleError && (
            <div className="flex items-center gap-2 text-destructive text-sm">
              <AlertCircle className="w-4 h-4 shrink-0" />
              {scheduleError}
            </div>
          )}
          {!hideFooter && (
            <div className="flex justify-end">
              <Button onClick={handleNext} disabled={!canProceedStep1} data-testid="button-ondemand-done">
                Done
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
