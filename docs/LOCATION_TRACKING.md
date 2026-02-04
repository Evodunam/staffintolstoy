# Location tracking when app is closed / in background

## Summary

- **Web (browser):** Location tracking uses the browser’s Geolocation API (`navigator.geolocation.watchPosition`). It runs only while the app/tab is open. **When the tab or browser is closed, tracking stops.** There is no background location in a closed tab.

- **Native Android:** The app uses a **foreground service** (`LocationTrackingService`) that continues to receive location updates when the app is in the **background** (user switches away). So **tracking works when the app is in the background.** When the app process is fully **closed/killed** (e.g. user swipes it away), the service stops unless the system or app restarts it (e.g. after clock-in). For automatic clock-in/out and time tracking, workers should keep the app in the background (not force-close it) or use the native app with background permission (“Allow all the time”) so the service can run.

- **Native iOS:** Same idea as Android when using Capacitor background location: tracking can continue in the background when the app is backgrounded; when the app is terminated by the user or OS, tracking stops until the app is opened again.

## Worker requirement

When a worker logs in, the app shows an **unexitable pop-up** if location is not being tracked (permission denied or unavailable). The worker must turn on location tracking to continue using the app. This is enforced globally for worker dashboard routes via `WorkerLocationRequiredModal`.

---

## Accurate hours when device is off / app closed (sure-fire strategies)

We combine several mechanisms so **billable time stays accurate** even when the worker leaves the job site while clocked in, or when the app/device is off or closed.

### 1. **App open: real-time auto clock-out**

- **TodayPage** uses `watchPosition` so when the worker moves **outside the geofence** (500 m) while clocked in, the app **auto clocks them out** immediately (with `isAutomatic: true`).
- Best experience: app open (or in foreground) and location allowed.

### 2. **Location pings while clocked in**

- While clocked in, the app sends **location pings** to the server every **90 seconds** (job + worker scoped).
- Pings are stored with `distanceFromJob` and `withinGeofence` so the server can infer “on site” vs “away.”

### 3. **Server-side auto clock-out from pings**

- A **scheduler** (`autoClockOutFromPings`) runs every **5 minutes** and looks at all **active timesheets** (no clock-out yet).
- **Left job site:** If the **last 2 consecutive pings** are **outside** the 500 m geofence, the server **auto clocks the worker out** using the **first of those ping times** as clock-out (fair to the worker). The worker and company get a notification.
- **Stale pings (device/app off):** If there has been **no ping for 15+ minutes**, the server treats the worker as no longer on site and **auto clocks them out at the last ping time** (concrete: never pay beyond last verified).
- **No recent ping (10 min):** If the last ping is older than 10 minutes but not yet 15, the server sends a **geolocation_wakeup** push, a **clock_out_reminder** push, and (throttled) a **geolocation_clock_out_reminder** email (challenge-response).
- **Scheduled end + 15 min grace:** If past shift end + 15 min, server auto clocks out at scheduled end.
- **Max shift cap:** If a timesheet has been clocked in for **14+ hours** with no clock-out, the server auto clocks out at **clock-in + 14 hours** so we never pay unbounded “forgot to clock out” or “device off” time.

All of the above use a shared **server-side clock-out** handler that applies the same **time-away-from-site** logic (using ping history) and updates timesheet, events, messages, and notifications.

### 4. **Time-away deduction at clock-out**

- When the worker **manually** clocks out (or is auto clocked out), the server computes **time away from site** from **location pings** between clock-in and clock-out (intervals where `distanceFromJob > 500 m`).
- **Billable hours** = raw shift length − time away; **adjusted hours** and **total pay** use this. So even if they left for 30 minutes and came back, only time on site is paid.

### 5. **Geolocation wakeup**

- **geolocationWakeup** scheduler sends a **silent push** (“geolocation_wakeup”), a visible **clock_in_reminder** push, and (throttled) a **geolocation_clock_in_reminder** email to workers **up to 2 hours before** a job start so the device can wake and be ready to track when they arrive.
- **autoClockOutFromPings** also sends **geolocation_wakeup** and **clock_out_reminder** push plus **geolocation_clock_out_reminder** email when pings are missing or stale so the worker is asked to open the app and clock out if needed.

### 6. **Ping windows by job type**

- **Recurring / one-time with jobSchedules:** Ping window = 2 hrs before start to 4 hrs after end.
- **On-demand:** Ping window = 2 hrs before start date/time until job is closed or endDate.
- **One-time without schedule:** 2 hrs before start to 4 hrs after end (from job fields).

Wakeups go to workers from **jobAssignments** (status assigned) or **applications** (status accepted).

### 7. **Native ping when app is closed**

- Android: When `geolocation_wakeup` push arrives, `MessagingService` starts `LocationTrackingService` and calls `PingFromPushHelper.sendPingFromPush()`.
- Native gets location (FusedLocationProvider), then POSTs to `/api/location-pings/from-push` with device token auth.
- Server creates ping and, if within auto geofence, performs server-side auto clock-in.

### 8. **Concrete time rules (app closed)**

- **15 min max unverified:** No ping for 15+ min → clock out at last ping time (never pay beyond last verified).
- **Scheduled end + 15 min grace:** Past shift end + 15 min → clock out at scheduled end.
- **10 min challenge:** No ping for 10 min → send push/email reminder (confirm presence or clock out).
- **14 h cap:** Max shift length; auto clock-out at cap.

### 9. **OS geofencing (Android)**

- When worker clocks in, app registers an OS-level geofence around the job site (500 m).
- When worker exits the geofence, the OS fires an event; app POSTs to `/api/location-pings/geofence-exit`.
- Server performs auto clock-out. Works when app is in background.

### 10. **Location chain (device → Google → ipapi → other)**

When obtaining location for tracking, we use a chain until one method succeeds:

1. **Device:** Web (`navigator.geolocation`), iOS, or Android (Capacitor).
2. **Google:** IP-based via Google Geolocation API.
3. **ipapi.co:** Fallback IP geolocation.
4. **ip-api.com:** Additional fallback.

The first method that returns a location is used for pinging:
- **Device source:** `watchPosition` for continuous updates.
- **IP source:** Poll `/api/geolocation/ip` every 3 minutes.

### 11. **Clock-in prompt banner (no geolocation)**

- When geolocation is off and the worker has jobs within the ping window (2 hrs before start to 4 hrs after end), a banner appears prompting them to clock in.
- If multiple jobs (e.g. on-demand + one-day), a list is shown so the worker can pick one.
- Tapping a job requests location and attempts clock-in; the server validates they are within the geofence.
- Banner displays elapsed time (H:M:S) since shift start.
- API: `GET /api/worker/clock-in-prompt-jobs`.

### 12. **Email + push when app is closed**

- When we cannot get location pings (app closed, device off), we use both **push** and **email** to reach the worker:
  - **Clock-in reminder:** Email “Please clock in for [job]” plus push during the job’s wakeup window (2 hrs before start).
  - **Clock-out reminder:** Email “Please clock out from [job]” plus push when no pings for 10+ min while clocked in (throttled to once per 30 min).
  - **Auto clocked out:** Email “You were auto clocked out” after we auto clock out due to stale pings, left job site, or max shift.

### Summary table

| Scenario | What happens |
|----------|----------------|
| App open, worker leaves site | App auto clock-out (watchPosition) or next ping run → server auto clock-out |
| App in background, worker leaves | Pings show outside → after 2 consecutive outside pings, server auto clock-out |
| App closed / device off, worker left | No new pings → push + email (10 min); after 15 min stale, server auto clock-out at last ping time + email |
| Forgot to clock out / device off 14+ h | Server auto clock-out at clock-in + 14 h (with last known coords) + email |
| No pings for 15 min (clocked in) | Push + email: “Please open app and clock out if you’ve left” (throttled) |
| Worker returns and manually clocks out | Server uses ping history to deduct time away; only on-site time is paid |

For **best accuracy**, workers should keep the app open or allow **background location** so pings continue. When that’s not possible, the **ping history + server-side rules** still keep billable hours aligned with time on site.
