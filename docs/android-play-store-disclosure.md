# Google Play Store Background Location Disclosure

This document contains the required disclosure text for Google Play Store submission when using `ACCESS_BACKGROUND_LOCATION` permission.

## Background Location Declaration Form

### 1. Why is background location essential to your app's core functionality?

Tolstoy Staffing is a construction staffing platform that provides automatic time tracking for workers at job sites. Background location is essential because:

- **Automatic Clock In/Out**: Workers are automatically clocked in when they arrive at job sites and clocked out when they leave, eliminating manual time entry and ensuring accurate payroll.
- **Geofence Verification**: The app verifies workers are physically present at assigned job sites before allowing time to be recorded.
- **Payroll Accuracy**: Continuous location monitoring during scheduled work hours ensures work time is captured even if the worker forgets to manually clock in.
- **Dispute Prevention**: Location-based time records provide verifiable proof of attendance at job sites, preventing payroll disputes between workers and companies.

### 2. Why is foreground-only location insufficient?

Foreground-only location is insufficient because:

- Workers often close the app or lock their phones while working, which would stop location tracking and prevent automatic clock in/out.
- Construction workers cannot reasonably keep their phones unlocked with the app open during physical labor.
- Missed clock events would result in lost wages for workers and administrative burden on companies.
- The core value proposition of "automatic" time tracking requires the app to function without user interaction.

### 3. How do users control this behavior?

Users have full control over location tracking:

- **In-App Toggle**: A prominent "Automatic Time Tracking" toggle in settings allows users to enable or disable background location at any time.
- **Manual Fallback**: When automatic tracking is disabled, users can manually clock in and out using the app.
- **Scheduled Only**: Location is only actively tracked during scheduled work hours for assigned jobs, not 24/7.
- **Clear Notifications**: A persistent notification shows when tracking is active, with an option to stop tracking.
- **Permission Revocation**: Users can revoke location permission at any time through Android settings.

### 4. Additional Information

- **Privacy Policy**: Our privacy policy explicitly states that background location is collected only for work time tracking, is not used for advertising, and is not shared outside of payroll/operations purposes.
- **Data Minimization**: Location data is only stored as timestamps for clock events, not continuous tracking logs.
- **User Benefit**: This feature directly benefits users (workers) by ensuring they are paid for all time worked.

## In-App Disclosure Text

### Before Requesting Background Location Permission

"Tolstoy Staffing needs background location access to automatically track your work hours at job sites. This allows us to:

- Automatically clock you in when you arrive at a job site
- Automatically clock you out when you leave
- Ensure you get paid for all time worked

Your location is only tracked during scheduled work hours and is used solely for time tracking purposes. You can disable this feature at any time in Settings."

### Settings Screen Description

"Automatic Time Tracking: When enabled, the app will use your location to automatically record when you arrive at and leave job sites. This ensures accurate timekeeping and prevents missed clock events. Location is only tracked during scheduled work hours."

## Privacy Policy Requirements

The privacy policy must include:

1. Statement that background location data is collected
2. Purpose: "Used exclusively for automatic work time tracking at job sites"
3. Data retention: "Clock in/out timestamps are retained for payroll records"
4. Non-advertising: "Location data is never used for advertising purposes"
5. Limited sharing: "Location data is shared only with employing companies for payroll verification"
6. User control: "Users can disable automatic tracking at any time through the app settings"
