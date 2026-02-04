"use client";

import { Label } from "@/components/ui/label";
import { OnDemandScheduleMultiStep } from "@/components/OnDemandScheduleMultiStep";
import { OneDayScheduleMultiStep } from "@/components/OneDayScheduleMultiStep";
import { RecurringScheduleMultiStep } from "@/components/RecurringScheduleMultiStep";
import { ChevronRight } from "lucide-react";
import { cn, parseLocalDate, SHIFT_TYPE_INFO, type ShiftType } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";

export type RescheduleScheduleData = {
  timelineType: "" | "on-demand" | "one-day" | "recurring";
  onDemandDate: string;
  onDemandStartTime: string;
  onDemandDoneByDate: string;
  onDemandBudget: number | null;
  oneDayDate: string;
  oneDayStartTime: string;
  oneDayEndTime: string;
  recurringDays: string[];
  recurringStartDate: string;
  recurringEndDate: string;
  recurringStartTime: string;
  recurringEndTime: string;
  recurringWeeks: number;
};

interface RescheduleScheduleFlowProps {
  data: RescheduleScheduleData;
  onChange: (updater: (prev: RescheduleScheduleData) => RescheduleScheduleData) => void;
  currentView: "type-select" | ShiftType;
  onViewChange: (view: "type-select" | ShiftType) => void;
  onDemandFormStep: number;
  onDemandFormStepChange: (step: number) => void;
  oneDayFormStep: number;
  oneDayFormStepChange: (step: number) => void;
  recurringFormStep: number;
  recurringFormStepChange: (step: number) => void;
  scheduleError: string | null;
  onScheduleErrorChange: (error: string | null) => void;
  workersNeeded: number;
  todayStr: string;
  validateOnDemandTime: (date: string, time: string) => { valid: boolean; error: string | null };
  isValidScheduleTime: (date: string, startTime: string, endTime?: string) => { valid: boolean; error: string | null };
  /** When true, show type pills (On-Demand / One-Day / Recurring) above the form. Use only in Action Required inline flow. */
  showTypePills?: boolean;
}

function computeRecurringEndDate(startStr: string, weeks: number): string {
  if (!startStr || weeks < 1) return "";
  const [y, m, d] = startStr.split("-").map(Number);
  const start = new Date(y, m - 1, d);
  const end = new Date(start);
  end.setDate(end.getDate() + Math.max(0, weeks * 7 - 1));
  return `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, "0")}-${String(end.getDate()).padStart(2, "0")}`;
}

export function RescheduleScheduleFlow({
  data,
  onChange,
  currentView,
  onViewChange,
  onDemandFormStep,
  onDemandFormStepChange,
  oneDayFormStep,
  oneDayFormStepChange,
  recurringFormStep,
  recurringFormStepChange,
  scheduleError,
  onScheduleErrorChange,
  workersNeeded,
  todayStr,
  validateOnDemandTime,
  isValidScheduleTime,
  showTypePills = false,
}: RescheduleScheduleFlowProps) {
  const isMobile = useIsMobile();

  const handleTypeSelect = (type: ShiftType) => {
    onChange((prev) => ({ ...prev, timelineType: type }));
    onViewChange(type);
  };

  const recurringSchedule = {
    days: data.recurringDays,
    startDate: data.recurringStartDate,
    endDate: data.recurringEndDate || computeRecurringEndDate(data.recurringStartDate || todayStr, data.recurringWeeks),
    startTime: data.recurringStartTime,
    endTime: data.recurringEndTime,
    weeks: data.recurringWeeks,
  };

  const validateRecurringStart = (): string | null => {
    const startDate = recurringSchedule.startDate || todayStr;
    if (!startDate || !recurringSchedule.startTime) return null;
    const selectedDateTime = new Date(`${startDate}T${recurringSchedule.startTime}`);
    const now = new Date();
    if (selectedDateTime < now) {
      return "Start date and time cannot be in the past";
    }
    return null;
  };
  const recurringStartError = currentView === "recurring" ? validateRecurringStart() : null;

  /** Pill row to switch type when already in a schedule form (on-demand / one-day / recurring). */
  const typePills = (
    <div className="flex flex-wrap gap-2">
      {(Object.keys(SHIFT_TYPE_INFO) as ShiftType[]).map((type) => {
        const info = SHIFT_TYPE_INFO[type];
        const isActive = data.timelineType === type;
        return (
          <button
            key={type}
            type="button"
            onClick={() => handleTypeSelect(type)}
            className={cn(
              "inline-flex items-center rounded-full px-4 py-2 text-sm font-medium transition-colors",
              isActive
                ? "bg-primary text-primary-foreground shadow-sm"
                : "bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground"
            )}
            data-testid={`pill-shift-${type}`}
          >
            {info.title}
          </button>
        );
      })}
    </div>
  );

  if (currentView === "type-select") {
    return (
      <div className="space-y-4">
        <div>
          <Label>How do you want to hire?</Label>
          <p className="text-sm text-muted-foreground mb-3">
            Select a shift type before scheduling
          </p>
          <div className="space-y-3">
            {(Object.keys(SHIFT_TYPE_INFO) as ShiftType[]).map((type) => {
              const info = SHIFT_TYPE_INFO[type];
              const isSelected = data.timelineType === type;
              return (
                <div
                  key={type}
                  className={cn(
                    "p-4 rounded-lg border cursor-pointer transition-colors",
                    isSelected ? "border-primary bg-primary/5" : "hover:border-primary/50"
                  )}
                  onClick={() => handleTypeSelect(type)}
                  data-testid={`button-shift-${type}`}
                >
                  <div className="flex items-center gap-3">
                    <div
                      className={cn(
                        "w-5 h-5 rounded-full border-2 flex items-center justify-center",
                        isSelected ? "border-primary" : "border-muted-foreground"
                      )}
                    >
                      {isSelected && <div className="w-3 h-3 rounded-full bg-primary" />}
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{info.title}</span>
                        {info.recommended && (
                          <span className="text-xs bg-primary text-primary-foreground px-2 py-0.5 rounded-full">
                            Recommended
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-muted-foreground mt-1">{info.description}</p>
                    </div>
                    {isMobile && <ChevronRight className="w-5 h-5 text-muted-foreground flex-shrink-0" />}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  if (currentView === "on-demand") {
    return (
      <div className="space-y-4 py-2">
        {showTypePills && typePills}
        <OnDemandScheduleMultiStep
          date={data.onDemandDate}
          onDateChange={(d) => onChange((prev) => ({ ...prev, onDemandDate: d }))}
          time={data.onDemandStartTime}
          onTimeChange={(t) => onChange((prev) => ({ ...prev, onDemandStartTime: t }))}
          doneByDate={data.onDemandDoneByDate}
          onDoneByDateChange={(d) => onChange((prev) => ({ ...prev, onDemandDoneByDate: d }))}
          budget={data.onDemandBudget}
          onBudgetChange={(b) => onChange((prev) => ({ ...prev, onDemandBudget: b }))}
          workersNeeded={workersNeeded}
          todayStr={todayStr}
          minDateForStart={parseLocalDate(todayStr)}
          validateTime={validateOnDemandTime}
          scheduleError={scheduleError}
          onScheduleErrorChange={onScheduleErrorChange}
          step={onDemandFormStep}
          onStepChange={onDemandFormStepChange}
          hideFooter
        />
      </div>
    );
  }

  if (currentView === "one-day") {
    return (
      <div className="space-y-4 py-2">
        {showTypePills && typePills}
        <OneDayScheduleMultiStep
          date={data.oneDayDate}
          onDateChange={(d) => onChange((prev) => ({ ...prev, oneDayDate: d }))}
          startTime={data.oneDayStartTime}
          onStartTimeChange={(t) => onChange((prev) => ({ ...prev, oneDayStartTime: t }))}
          endTime={data.oneDayEndTime}
          onEndTimeChange={(t) => onChange((prev) => ({ ...prev, oneDayEndTime: t }))}
          minDate={parseLocalDate(todayStr)}
          workersNeeded={workersNeeded}
          scheduleError={scheduleError}
          onScheduleErrorChange={onScheduleErrorChange}
          validateTime={(date, start, end) => isValidScheduleTime(date, start, end)}
          step={oneDayFormStep}
          onStepChange={oneDayFormStepChange}
          hideFooter
        />
      </div>
    );
  }

  if (currentView === "recurring") {
    return (
      <div className="space-y-4 py-2">
        {showTypePills && typePills}
        <RecurringScheduleMultiStep
          startDate={recurringSchedule.startDate}
          onStartDateChange={(d) =>
            onChange((prev) => {
              const end = computeRecurringEndDate(d || todayStr, prev.recurringWeeks);
              return { ...prev, recurringStartDate: d, recurringEndDate: end || prev.recurringEndDate };
            })
          }
          endDate={recurringSchedule.endDate}
          onEndDateChange={(d) => onChange((prev) => ({ ...prev, recurringEndDate: d }))}
          days={recurringSchedule.days}
          onDaysChange={(days) => onChange((prev) => ({ ...prev, recurringDays: days }))}
          startTime={recurringSchedule.startTime}
          onStartTimeChange={(t) => onChange((prev) => ({ ...prev, recurringStartTime: t }))}
          endTime={recurringSchedule.endTime}
          onEndTimeChange={(t) => onChange((prev) => ({ ...prev, recurringEndTime: t }))}
          weeks={recurringSchedule.weeks}
          onWeeksChange={(w) =>
            onChange((prev) => {
              const end = computeRecurringEndDate(prev.recurringStartDate || todayStr, w);
              return { ...prev, recurringWeeks: w, recurringEndDate: end || prev.recurringEndDate };
            })
          }
          minDate={parseLocalDate(todayStr)}
          workersNeeded={workersNeeded}
          todayStr={todayStr}
          scheduleError={recurringStartError}
          step={recurringFormStep}
          onStepChange={recurringFormStepChange}
          hideFooter
        />
      </div>
    );
  }

  return null;
}
