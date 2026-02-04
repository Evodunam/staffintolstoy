import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

/** Parse "yyyy-MM-dd" as local date (avoids UTC timezone off-by-one issues) */
export function parseLocalDate(str: string): Date {
  const [y, m, d] = str.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Normalizes an avatar URL to ensure it's in the correct format.
 * Handles various formats:
 * - Full URLs (http/https) - returns as-is
 * - Relative paths starting with / - returns as-is
 * - UUIDs or partial paths - constructs full path
 * - Paths missing bucket name - adds /objects/avatar/ prefix
 */
export function normalizeAvatarUrl(avatarUrl: string | null | undefined): string | undefined {
  if (!avatarUrl) return undefined;
  
  // Data URLs (base64) must be used as-is - do not prefix with /objects/
  if (avatarUrl.startsWith("data:")) {
    return avatarUrl;
  }
  
  // If it's already a full URL, return as-is
  if (avatarUrl.startsWith("http://") || avatarUrl.startsWith("https://")) {
    return avatarUrl;
  }
  
  // If it's already a relative path starting with /, check if it needs normalization
  if (avatarUrl.startsWith("/")) {
    // If it's missing the /objects/ prefix, add it
    if (!avatarUrl.startsWith("/objects/")) {
      // If it's just a UUID or path without /objects/, construct full path
      if (avatarUrl.match(/^\/[a-f0-9-]+$/i)) {
        // Just a UUID, construct full path
        return `/objects/avatar/uploads${avatarUrl}`;
      }
      return `/objects/avatar${avatarUrl}`;
    }
    
    // If it's /objects/uploads/uuid, add bucket name
    if (avatarUrl.startsWith("/objects/uploads/")) {
      return avatarUrl.replace("/objects/uploads/", "/objects/avatar/uploads/");
    }
    
    // If it's /objects/ but missing bucket, add avatar bucket
    const pathParts = avatarUrl.split("/").filter(p => p);
    if (pathParts.length >= 2 && pathParts[1] !== "avatar" && pathParts[1] !== "bio" && pathParts[1] !== "jobs" && pathParts[1] !== "reviews") {
      // Missing bucket name, add avatar
      return `/objects/avatar/${pathParts.slice(1).join("/")}`;
    }
    
    // Already properly formatted
    return avatarUrl;
  }
  
  // If it's just a UUID or path without leading slash, construct full path
  if (avatarUrl.match(/^[a-f0-9-]+$/i)) {
    // Just a UUID, construct full path
    return `/objects/avatar/uploads/${avatarUrl}`;
  }
  
  // Otherwise, assume it needs /objects/avatar/ prefix
  return `/objects/avatar/${avatarUrl}`;
}

/** Schedule validation - shared with PostJob and Reschedule flows */
export function validateOnDemandTime(date: string, time: string): { valid: boolean; error: string | null } {
  if (!date || !time) return { valid: false, error: "Please select date and time" };
  const selectedDateTime = new Date(`${date}T${time}`);
  const now = new Date();
  if (selectedDateTime < now) {
    return { valid: false, error: "Start date and time cannot be in the past" };
  }
  const minTime = new Date(now.getTime() + 2 * 60 * 60 * 1000);
  if (selectedDateTime < minTime) {
    return { valid: false, error: "Start time must be at least 2 hours from now" };
  }
  return { valid: true, error: null };
}

export function isValidScheduleTime(
  date: string,
  startTime: string,
  endTime?: string
): { valid: boolean; error: string | null } {
  if (!date || !startTime) return { valid: false, error: "Please select date and time" };
  if (endTime) {
    const [startH, startM] = startTime.split(":").map((x) => parseInt(x, 10));
    const [endH, endM] = endTime.split(":").map((x) => parseInt(x, 10));
    const startMinutes = (startH ?? 0) * 60 + (startM ?? 0);
    const endMinutes = (endH ?? 0) * 60 + (endM ?? 0);
    if (endMinutes <= startMinutes) return { valid: false, error: "End time must be after start time" };
    if (endMinutes - startMinutes < 180) return { valid: false, error: "Shift must be at least 3 hours" };
    if (endMinutes > 22 * 60) return { valid: false, error: "End time cannot be after 10:00 PM" };
  }
  const selectedDateTime = new Date(`${date}T${startTime}`);
  const now = new Date();
  if (selectedDateTime < now) {
    return { valid: false, error: "Start date and time cannot be in the past" };
  }
  return { valid: true, error: null };
}

/** Convert 24h "HH:mm" to 12h display e.g. "9:00 AM", "12:30 PM" */
export function formatTime12h(time24: string): string {
  if (!time24) return "";
  const [hStr, mStr] = time24.split(":");
  const h = parseInt(hStr, 10);
  const m = mStr ? parseInt(mStr, 10) : 0;
  if (h === 0) return `12:${String(m).padStart(2, "0")} AM`;
  if (h === 12) return `12:${String(m).padStart(2, "0")} PM`;
  if (h < 12) return `${h}:${String(m).padStart(2, "0")} AM`;
  return `${h - 12}:${String(m).padStart(2, "0")} PM`;
}

/** Minutes since midnight for "HH:mm" */
export function timeToMinutes(time: string): number {
  if (!time) return 0;
  const [h, m] = time.split(":").map((x) => parseInt(x, 10));
  return (h ?? 0) * 60 + (m ?? 0);
}

/** 30-min time slots from 6 AM to 8 PM (for start time) */
export function getTimeSlots(): string[] {
  const slots: string[] = [];
  for (let h = 6; h <= 20; h++) {
    slots.push(`${String(h).padStart(2, "0")}:00`);
    if (h < 20) slots.push(`${String(h).padStart(2, "0")}:30`);
  }
  return slots;
}

/** 30-min slots from 6 AM to 10 PM (for end time range) */
export function getEndTimeSlotCandidates(): string[] {
  const slots: string[] = [];
  for (let h = 6; h <= 22; h++) {
    slots.push(`${String(h).padStart(2, "0")}:00`);
    if (h < 22) slots.push(`${String(h).padStart(2, "0")}:30`);
  }
  return slots;
}

/** End time must be at least 3 hours after start, max 10 PM. Returns valid end-time slots. */
export function getValidEndTimeSlots(startTime: string): string[] {
  if (!startTime) return getEndTimeSlotCandidates();
  const minEndMinutes = timeToMinutes(startTime) + 3 * 60;
  return getEndTimeSlotCandidates().filter(
    (slot) => timeToMinutes(slot) >= minEndMinutes && timeToMinutes(slot) <= 22 * 60
  );
}

/** Earliest valid end time (start + 3 hours), rounded up to next 30-min slot, max 10 PM */
export function getEarliestEndTime(startTime: string): string {
  if (!startTime) return "09:00";
  const minEndMinutes = timeToMinutes(startTime) + 3 * 60;
  const h = Math.floor(minEndMinutes / 60);
  const m = minEndMinutes % 60;
  let slotH = h;
  let slotM = 0;
  if (m === 0) slotM = 0;
  else if (m <= 30) slotM = 30;
  else {
    slotH = h + 1;
    slotM = 0;
  }
  if (slotH >= 23 || (slotH === 22 && slotM > 0)) return "22:00";
  return `${String(slotH).padStart(2, "0")}:${String(slotM).padStart(2, "0")}`;
}

export type ShiftType = "on-demand" | "one-day" | "recurring";

export const SHIFT_TYPE_INFO: Record<
  ShiftType,
  { title: string; description: string; recommended?: boolean }
> = {
  "on-demand": {
    title: "On-Demand (ASAP)",
    description: "Workers arrive within hours and work until the task is complete. Best for urgent needs.",
    recommended: true,
  },
  "one-day": {
    title: "One-Day Shift",
    description: "Schedule workers for a specific date and time range. Best for planned single-day projects.",
  },
  "recurring": {
    title: "Recurring Shifts",
    description: "Set up a weekly schedule for ongoing projects. Best for multi-week projects.",
  },
};
