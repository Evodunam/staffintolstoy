import { useState, useEffect, useCallback } from "react";
import {
  getCachedAssignments,
  setCachedAssignments,
  getCachedAcceptedApplications,
  setCachedAcceptedApplications,
  getPendingClockEvents,
  addPendingClockIn as addPendingClockInStorage,
  addPendingClockOut as addPendingClockOutStorage,
  clearPendingClockEvents,
  getLastPendingClockInLocalId,
  hasPendingClockedIn,
  getPendingClockedInJobId,
  getPendingClockInTime,
  type PendingClockEvent,
  type PendingClockIn,
} from "@/lib/offline-worker";

export function useOfflineWorker(profileId: number | undefined) {
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== "undefined" ? navigator.onLine : true
  );
  const [pendingEvents, setPendingEvents] = useState<PendingClockEvent[]>(() =>
    getPendingClockEvents()
  );
  const [isSyncing, setIsSyncing] = useState(false);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  const refreshPending = useCallback(() => {
    setPendingEvents(getPendingClockEvents());
  }, []);

  const cachedAssignments = isOnline ? null : getCachedAssignments();
  const cachedAcceptedApplications = isOnline ? null : getCachedAcceptedApplications();

  const cacheAssignments = useCallback((assignments: unknown[]) => {
    if (!assignments.length) return;
    setCachedAssignments(assignments);
  }, []);

  const cacheAcceptedApplications = useCallback((applications: unknown[]) => {
    const accepted = Array.isArray(applications)
      ? applications.filter((a) => (a as { status?: string }).status === "accepted")
      : [];
    if (!accepted.length) return;
    setCachedAcceptedApplications(accepted);
  }, []);

  const addPendingClockIn = useCallback(
    (params: {
      jobId: number;
      workerId: number;
      latitude: number | null;
      longitude: number | null;
      teamMemberId?: number | null;
    }) => {
      const localId = addPendingClockInStorage(params);
      refreshPending();
      return localId;
    },
    [refreshPending]
  );

  const addPendingClockOut = useCallback(
    (clockInLocalId: string) => {
      addPendingClockOutStorage(clockInLocalId);
      refreshPending();
    },
    [refreshPending]
  );

  const syncPending = useCallback(async (): Promise<{ synced: number; errors: string[] }> => {
    const events = getPendingClockEvents();
    if (!events.length) return { synced: 0, errors: [] };
    setIsSyncing(true);
    const errors: string[] = [];
    const localIdToTimesheetId: Record<string, number> = {};
    let synced = 0;

    try {
      for (const event of events) {
        if (event.type === "clock_in") {
          const e = event as PendingClockIn;
          // Server accepts clock-in without location (creates unvalidated timesheet). User must then submit pin location when back online; within 50mi we verify and timesheet can be approved; otherwise we never submit it.
          const lat = e.latitude ?? null;
          const lng = e.longitude ?? null;
          try {
            const res = await fetch("/api/timesheets/clock-in", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              credentials: "include",
              body: JSON.stringify({
                jobId: e.jobId,
                workerId: e.workerId,
                latitude: lat,
                longitude: lng,
                isAutomatic: false,
                teamMemberId: e.teamMemberId ?? undefined,
              }),
            });
            if (!res.ok) {
              const data = await res.json().catch(() => ({}));
              errors.push(data?.message || `Clock-in failed: ${res.status}`);
              continue;
            }
            const data = await res.json();
            const tid = data?.timesheetId ?? data?.id;
            if (tid != null) localIdToTimesheetId[e.localId] = Number(tid);
            synced++;
          } catch (err: unknown) {
            errors.push(err instanceof Error ? err.message : "Clock-in request failed");
          }
        } else {
          const timesheetId = localIdToTimesheetId[event.localId];
          if (timesheetId == null) {
            errors.push("Clock-out skipped: no matching clock-in found.");
            continue;
          }
          try {
            const res = await fetch("/api/timesheets/clock-out", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              credentials: "include",
              body: JSON.stringify({
                timesheetId,
                latitude: event.latitude,
                longitude: event.longitude,
                isAutomatic: false,
              }),
            });
            if (!res.ok) {
              const data = await res.json().catch(() => ({}));
              errors.push(data?.message || `Clock-out failed: ${res.status}`);
              continue;
            }
            synced++;
          } catch (err: unknown) {
            errors.push(err instanceof Error ? err.message : "Clock-out request failed");
          }
        }
      }
      if (synced > 0 || errors.length === 0) clearPendingClockEvents();
      refreshPending();
    } finally {
      setIsSyncing(false);
    }
    return { synced, errors };
  }, [refreshPending]);

  return {
    isOnline,
    cachedAssignments,
    cachedAcceptedApplications,
    cacheAssignments,
    cacheAcceptedApplications,
    pendingClockEvents: pendingEvents,
    addPendingClockIn,
    addPendingClockOut,
    syncPending,
    isSyncing,
    lastPendingClockInLocalId: getLastPendingClockInLocalId(),
    hasPendingClockedIn: hasPendingClockedIn(),
    pendingClockedInJobId: getPendingClockedInJobId(),
    pendingClockInTime: getPendingClockInTime(),
    refreshPending,
  };
}
