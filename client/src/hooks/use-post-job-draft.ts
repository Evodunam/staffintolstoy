"use client";

import { useCallback, useEffect, useRef } from "react";

const STORAGE_KEY = "postJob_draft";

export interface PostJobDraft {
  step: number;
  selectedLocationId: number | null;
  locationListExpanded: boolean;
  jobDescription: string;
  aiCategories: string[];
  selectedSkillsets: string[];
  lastAnalyzedDescription: string;
  userModifiedSkills: boolean;
  aiGeneratedTitle: string | null;
  companyJobTitle?: string;
  mediaPermanentUrls: { url: string; type: "image" | "video" }[];
  workersNeeded: number;
  shiftType: "on-demand" | "one-day" | "recurring" | "monthly" | null;
  scheduleError: string | null;
  onDemandBudget: number | null;
  onDemandDate: string;
  onDemandDoneByDate: string;
  onDemandStartTime: string;
  onDemandFormStep: number;
  oneDayFormStep?: number;
  recurringFormStep?: number;
  monthlyFormStep?: number;
  oneDaySchedule: { date: string; startTime: string; endTime: string };
  recurringSchedule: { days: string[]; startDate?: string; endDate?: string; startTime: string; endTime: string; weeks: number };
  monthlySchedule?: { startDate: string; endDate: string; days: string[]; startTime: string; endTime: string };
  showSchedulePopup: "on-demand" | "one-day" | "recurring" | "monthly" | null;
  datePickerFor: { field: "onDemandStart" | "onDemandDoneBy" | "oneDayDate"; minDate: string } | null;
  showLocationPopup: boolean;
  editingLocationId: number | null;
  addLocationStep: number;
  showCustomContactPopup: boolean;
  showAddTeamMemberPopup: boolean;
  newLocation: {
    name: string;
    address: string;
    address2?: string;
    city: string;
    state: string;
    zipCode: string;
    useCompanyDefault: boolean;
    contactName: string;
    contactPhone: string;
    contactEmail: string;
    contactAltPhone: string;
    representativeTeamMemberId: number | null;
    selectedPhoneOption: string;
    paymentMethodId?: number | null;
  };
  /** Step 3 — total job budget (USD); also used for auto-fulfill when enabled */
  jobBudgetDollars?: number | null;
  autoFulfillEnabled?: boolean;
  /** @deprecated merged into jobBudgetDollars; read on restore only */
  autoFulfillLaborBudgetDollars?: number | null;
  /** 1–5, minimum worker star rating for auto-accept */
  autoFulfillMinWorkerStars?: number;
  /** @deprecated restored for older drafts only */
  autoFulfillBudgetWindow?: "one_day" | "weekly" | "monthly" | "custom";
  autoFulfillCustomStart?: string;
  autoFulfillCustomEnd?: string;
  autoFulfillExpectedHoursOverride?: string;
  autoFulfillMinRating?: string;
  autoFulfillMinReviews?: number;
  autoFulfillMaxHourlyDollars?: string;
  autoFulfillMinHourlyDollars?: string;
  autoFulfillTermsAck?: boolean;
  version: number;
}

const DRAFT_VERSION = 2;

function storageKey(userId?: number): string {
  return userId ? `${STORAGE_KEY}_${userId}` : STORAGE_KEY;
}

export function getStoredDraft(userId?: number): PostJobDraft | null {
  try {
    const raw = sessionStorage.getItem(storageKey(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PostJobDraft;
    if (parsed.version === 1) {
      const migrated = { ...parsed, version: 2 as const };
      if (typeof migrated.step === "number" && migrated.step >= 3) migrated.step = migrated.step + 1;
      return migrated;
    }
    if (parsed.version !== DRAFT_VERSION) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearStoredDraft(userId?: number): void {
  try {
    sessionStorage.removeItem(storageKey(userId));
  } catch {}
}

export function saveDraftToStorage(draft: PostJobDraft, userId?: number): void {
  try {
    sessionStorage.setItem(storageKey(userId), JSON.stringify({ ...draft, version: DRAFT_VERSION }));
  } catch {}
}

export interface UsePostJobDraftOptions {
  userId?: number;
  isNewJob: boolean;
  isReady: boolean;
  draft: PostJobDraft | null;
  onRestore: (draft: PostJobDraft) => void;
  debounceMs?: number;
}

/**
 * Persists PostJob form state to sessionStorage.
 * - Restore on mount if draft exists and !isNewJob
 * - Save on changes (debounced)
 * - Clear on success or explicit "start new"
 */
export function usePostJobDraft({
  userId,
  isNewJob,
  isReady,
  draft,
  onRestore,
  debounceMs = 400,
}: UsePostJobDraftOptions): {
  hasDraft: boolean;
  clearDraft: () => void;
} {
  const clearDraft = useCallback(() => {
    clearStoredDraft(userId);
  }, [userId]);

  const saveRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasRestoredRef = useRef(false);

  useEffect(() => {
    if (!isReady) return;
    if (isNewJob) {
      clearStoredDraft(userId);
      hasRestoredRef.current = false;
      return;
    }
    if (hasRestoredRef.current) return;
    const existing = getStoredDraft(userId);
    if (existing) {
      hasRestoredRef.current = true;
      onRestore(existing);
    }
  }, [isReady, isNewJob, userId, onRestore]);

  useEffect(() => {
    if (!isReady || !draft) return;
    const timer = setTimeout(() => {
      saveDraftToStorage(draft, userId);
    }, debounceMs);
    saveRef.current = timer;
    return () => {
      if (saveRef.current) clearTimeout(saveRef.current);
    };
  }, [draft, isReady, userId, debounceMs]);

  const hasDraft = !!getStoredDraft(userId);

  return { hasDraft, clearDraft };
}
