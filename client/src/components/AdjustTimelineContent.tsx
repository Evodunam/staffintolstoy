import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { getTimeSlots, getValidEndTimeSlots, getEarliestEndTime, formatTime12h } from "@/lib/utils";

export type AdjustTimelineData = {
  timelineType: "" | "on-demand" | "one-day" | "recurring";
  onDemandDate: string;
  onDemandStartTime: string;
  oneDayDate: string;
  oneDayStartTime: string;
  oneDayEndTime: string;
  recurringDays: string[];
  recurringStartDate: string;
  recurringStartTime: string;
  recurringEndTime: string;
  recurringWeeks: number;
};

interface AdjustTimelineContentProps {
  data: AdjustTimelineData;
  onChange: (updater: (prev: AdjustTimelineData) => AdjustTimelineData) => void;
}

export function AdjustTimelineContent({ data, onChange }: AdjustTimelineContentProps) {
  return (
    <div className="space-y-4">
      <div>
        <Label>Job Type</Label>
        <Select
          value={data.timelineType}
          onValueChange={(v: "on-demand" | "one-day" | "recurring") => onChange(prev => ({ ...prev, timelineType: v }))}
        >
          <SelectTrigger>
            <SelectValue placeholder="Select type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="on-demand">On-demand</SelectItem>
            <SelectItem value="one-day">One-day</SelectItem>
            <SelectItem value="recurring">Recurring</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {data.timelineType === "on-demand" && (
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label>Date</Label>
            <Input
              type="date"
              value={data.onDemandDate}
              onChange={(e) => onChange(prev => ({ ...prev, onDemandDate: e.target.value }))}
            />
          </div>
          <div>
            <Label>Start Time</Label>
            <Input
              type="time"
              value={data.onDemandStartTime}
              onChange={(e) => onChange(prev => ({ ...prev, onDemandStartTime: e.target.value }))}
            />
          </div>
        </div>
      )}
      {(data.timelineType === "one-day" || !data.timelineType) && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Date</Label>
              <Input
                type="date"
                value={data.oneDayDate}
                onChange={(e) => onChange(prev => ({ ...prev, oneDayDate: e.target.value }))}
              />
            </div>
            <div>
              <Label>Start</Label>
              <Select
                value={data.oneDayStartTime || "09:00"}
                onValueChange={(v) => {
                  const validEnds = getValidEndTimeSlots(v);
                  const earliest = getEarliestEndTime(v);
                  onChange(prev => ({
                    ...prev,
                    oneDayStartTime: v,
                    oneDayEndTime: (prev.oneDayEndTime && validEnds.includes(prev.oneDayEndTime)) ? prev.oneDayEndTime : earliest,
                  }));
                }}
              >
                <SelectTrigger><SelectValue placeholder="Start" /></SelectTrigger>
                <SelectContent>
                  {getTimeSlots().map((slot) => (
                    <SelectItem key={slot} value={slot}>{formatTime12h(slot)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label>End Time</Label>
            <Select
              value={data.oneDayEndTime || getEarliestEndTime(data.oneDayStartTime || "09:00")}
              onValueChange={(v) => onChange(prev => ({ ...prev, oneDayEndTime: v }))}
            >
              <SelectTrigger><SelectValue placeholder="End" /></SelectTrigger>
              <SelectContent>
                {getValidEndTimeSlots(data.oneDayStartTime || "09:00").map((slot) => (
                  <SelectItem key={slot} value={slot}>{formatTime12h(slot)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      )}
      {data.timelineType === "recurring" && (
        <div className="space-y-4">
          <div>
            <Label>Start Date</Label>
            <Input
              type="date"
              value={data.recurringStartDate}
              onChange={(e) => onChange(prev => ({ ...prev, recurringStartDate: e.target.value }))}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Start Time</Label>
              <Select
                value={data.recurringStartTime || "09:00"}
                onValueChange={(v) => {
                  const validEnds = getValidEndTimeSlots(v);
                  const earliest = getEarliestEndTime(v);
                  onChange(prev => ({
                    ...prev,
                    recurringStartTime: v,
                    recurringEndTime: (prev.recurringEndTime && validEnds.includes(prev.recurringEndTime)) ? prev.recurringEndTime : earliest,
                  }));
                }}
              >
                <SelectTrigger><SelectValue placeholder="Start" /></SelectTrigger>
                <SelectContent>
                  {getTimeSlots().map((slot) => (
                    <SelectItem key={slot} value={slot}>{formatTime12h(slot)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>End Time</Label>
              <Select
                value={data.recurringEndTime || getEarliestEndTime(data.recurringStartTime || "09:00")}
                onValueChange={(v) => onChange(prev => ({ ...prev, recurringEndTime: v }))}
              >
                <SelectTrigger><SelectValue placeholder="End" /></SelectTrigger>
                <SelectContent>
                  {getValidEndTimeSlots(data.recurringStartTime || "09:00").map((slot) => (
                    <SelectItem key={slot} value={slot}>{formatTime12h(slot)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
