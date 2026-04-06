/**
 * Offline support for worker Today and Calendar pages.
 * - Caches accepted assignments/applications when online for use when offline.
 * - Queues clock-in/clock-out when offline and syncs when back online.
 * - In offline mode we only show and act on accepted jobs.
 * Geofencing: enforced when online (server validates location). In offline mode we do not enforce geofencing; clock-ins sync as unvalidated.
 * When the user comes back online we confirm general location: they must provide their pin location. If within 50mi of the job site we verify and the timesheet can be submitted for approval; if not verified we never submit that timesheet (beyond 50mi = reject + strike).
 */

const KEY_PREFIX = "tolstoy_offline_";
export const KEY_ACCEPTED_ASSIGNMENTS = `${KEY_PREFIX}accepted_assignments`;
export const KEY_ACCEPTED_APPLICATIONS = `${KEY_PREFIX}accepted_applications`;
export const KEY_PENDING_CLOCK_EVENTS = `${KEY_PREFIX}pending_clock_events`;
export const KEY_LAST_CACHE_TIME = `${KEY_PREFIX}last_cache_time`;

const CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export type PendingClockIn = {
  type: "clock_in";
  localId: string;
  jobId: number;
  workerId: number;
  clockInTime: string; // ISO
  latitude: number | null;
  longitude: number | null;
  teamMemberId?: number | null;
};

export type PendingClockOut = {
  type: "clock_out";
  localId: string; // links to clock_in localId
  clockOutTime: string; // ISO
  latitude: number | null;
  longitude: number | null;
};

export type PendingClockEvent = PendingClockIn | PendingClockOut;

function safeGet<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    if (raw == null) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function safeSet(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // quota or disabled
  }
}

export function getCachedAssignments(): unknown[] | null {
  const data = safeGet<{ assignments: unknown[]; at: number }>(KEY_ACCEPTED_ASSIGNMENTS);
  if (!data?.assignments?.length) return null;
  if (Date.now() - (data.at || 0) > CACHE_MAX_AGE_MS) return null;
  return data.assignments;
}

export function setCachedAssignments(assignments: unknown[]): void {
  safeSet(KEY_ACCEPTED_ASSIGNMENTS, { assignments, at: Date.now() });
}

export function getCachedAcceptedApplications(): unknown[] | null {
  const data = safeGet<{ applications: unknown[]; at: number }>(KEY_ACCEPTED_APPLICATIONS);
  if (!data?.applications?.length) return null;
  if (Date.now() - (data.at || 0) > CACHE_MAX_AGE_MS) return null;
  return data.applications;
}

export function setCachedAcceptedApplications(applications: unknown[]): void {
  safeSet(KEY_ACCEPTED_APPLICATIONS, { applications, at: Date.now() });
}

export function getPendingClockEvents(): PendingClockEvent[] {
  return safeGet<PendingClockEvent[]>(KEY_PENDING_CLOCK_EVENTS) ?? [];
}

function setPendingClockEvents(events: PendingClockEvent[]): void {
  safeSet(KEY_PENDING_CLOCK_EVENTS, events);
}

export function addPendingClockIn(params: {
  jobId: number;
  workerId: number;
  latitude: number | null;
  longitude: number | null;
  teamMemberId?: number | null;
}): string {
  const localId = `ci_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  const event: PendingClockIn = {
    type: "clock_in",
    localId,
    jobId: params.jobId,
    workerId: params.workerId,
    clockInTime: new Date().toISOString(),
    latitude: params.latitude,
    longitude: params.longitude,
    teamMemberId: params.teamMemberId,
  };
  const events = getPendingClockEvents();
  events.push(event);
  setPendingClockEvents(events);
  return localId;
}

export function addPendingClockOut(clockInLocalId: string): void {
  const event: PendingClockOut = {
    type: "clock_out",
    localId: clockInLocalId,
    clockOutTime: new Date().toISOString(),
    latitude: null,
    longitude: null,
  };
  const events = getPendingClockEvents();
  events.push(event);
  setPendingClockEvents(events);
}

/** Remove pending events after successful sync. */
export function clearPendingClockEvents(): void {
  setPendingClockEvents([]);
}

/** Get the last pending clock-in localId (for showing "clocked in" state offline). */
export function getLastPendingClockInLocalId(): string | null {
  const events = getPendingClockEvents();
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].type === "clock_in") return (events[i] as PendingClockIn).localId;
    if (events[i].type === "clock_out") return null; // already clocked out after last in
  }
  return null;
}

/** Check if there is a pending clock-in that hasn't been clocked out (offline "active" state). */
export function hasPendingClockedIn(): boolean {
  const events = getPendingClockEvents();
  let lastClockInId: string | null = null;
  for (const e of events) {
    if (e.type === "clock_in") lastClockInId = e.localId;
    if (e.type === "clock_out" && e.localId === lastClockInId) lastClockInId = null;
  }
  return lastClockInId != null;
}

/** Get jobId for the pending clock-in (for UI). */
export function getPendingClockedInJobId(): number | null {
  const events = getPendingClockEvents();
  let lastClockIn: PendingClockIn | null = null;
  for (const e of events) {
    if (e.type === "clock_in") lastClockIn = e as PendingClockIn;
    if (e.type === "clock_out" && lastClockIn && e.localId === lastClockIn.localId) lastClockIn = null;
  }
  return lastClockIn?.jobId ?? null;
}

/** Get clock-in time for the pending clock-in (for duration display). */
export function getPendingClockInTime(): string | null {
  const events = getPendingClockEvents();
  let lastClockIn: PendingClockIn | null = null;
  for (const e of events) {
    if (e.type === "clock_in") lastClockIn = e as PendingClockIn;
    if (e.type === "clock_out" && lastClockIn && e.localId === lastClockIn.localId) lastClockIn = null;
  }
  return lastClockIn?.clockInTime ?? null;
}
