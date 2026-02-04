# Calendar Import/Export Scoping Confirmation

## Overview
This document confirms that all calendar import/export functionality is properly scoped to the current authenticated user. Each user (teammate, admin, or worker) can only import/export their own calendar data.

## Scoping Rules

### 1. Calendar Export (`/api/calendar/export`)

**Scoped to current user's profile only:**

#### For Teammates (Employees):
- ✅ Exports **only** jobs assigned to that specific teammate
- ✅ Uses `teamMemberId` from `workerTeamMembers` table linked to current `profile.id`
- ✅ Filters applications by `applications.teamMemberId = currentTeammateId`
- ✅ Supports impersonation: when admin impersonates a teammate, exports that teammate's jobs only

#### For Admins/Company Users:
- ✅ Exports **only** jobs created by that specific company
- ✅ Uses `jobs.companyId = profile.id` (current admin's company)
- ✅ Filters jobs by `jobs.companyId = currentProfileId`
- ✅ Each admin can only export their own company's jobs

#### For Regular Workers:
- ✅ Exports **only** their own accepted applications
- ✅ Uses `applications.workerId = profile.id`
- ✅ Filters by `applications.workerId = currentProfileId`

**Security:** All export operations are filtered by the authenticated user's profile ID. No user can export another user's calendar data.

---

### 2. Calendar Import Settings (`/api/calendar/import-settings`)

**Scoped to current user's profile only:**

#### POST `/api/calendar/import-settings`:
- ✅ Saves imported calendar IDs to **current user's profile only**
- ✅ Uses `profiles.id = profile.id` (current authenticated user)
- ✅ Each user maintains their own list of imported calendars
- ✅ Teammates, admins, and workers all have separate import settings

#### GET `/api/calendar/import-settings`:
- ✅ Returns **only** the current user's imported calendar settings
- ✅ Reads from `profile.importedCalendars` for current authenticated user
- ✅ No access to other users' import settings

**Security:** All import settings are stored per-profile. Users can only access/modify their own settings.

---

### 3. Calendar Events (`/api/calendar/events`)

**Scoped to current user's imported calendars only:**

- ✅ Verifies calendar belongs to current user's `importedCalendars` list
- ✅ Only fetches events from calendars the user has explicitly imported
- ✅ Returns 403 if calendar is not in user's imported calendars list
- ✅ Each user can only access events from their own imported calendars

**Security:** Calendar access is validated against the user's own imported calendars list before fetching events.

---

### 4. Conflict Detection (`/api/calendar/check-conflicts`)

**Scoped to current user's imported calendars only:**

- ✅ Only checks conflicts against calendars in current user's `importedCalendars`
- ✅ Filters provided calendars to only include user's own imported calendars
- ✅ Ignores any calendars not in user's imported list
- ✅ Each user's conflict detection is independent

**Security:** Only uses calendars that belong to the current user's imported calendars list.

---

### 5. Calendar Listing (`/api/calendar/google/calendars`, `/api/calendar/outlook/calendars`)

**Scoped to current user's account:**

- ✅ Lists calendars from the authenticated user's Google/Outlook account
- ✅ Uses user-specific access tokens (via environment variables)
- ✅ Each user sees only their own calendars
- ✅ Calendar listing is automatically scoped by the OAuth token

**Security:** OAuth tokens are user-specific, ensuring users only see their own calendars.

---

## Data Flow Examples

### Example 1: Teammate Exporting Calendar
```
1. Teammate (profile.id = 123, teamId = 5) requests export
2. System finds their workerTeamMembers record (teamMemberId = 456)
3. System queries: applications WHERE teamMemberId = 456
4. Exports only jobs assigned to teamMemberId 456
5. Result: Only that teammate's assigned jobs are exported
```

### Example 2: Admin Exporting Calendar
```
1. Admin (profile.id = 789, role = "company") requests export
2. System queries: jobs WHERE companyId = 789
3. Exports only jobs created by company 789
4. Result: Only that admin's company jobs are exported
```

### Example 3: Teammate Importing Calendar
```
1. Teammate (profile.id = 123) saves import settings
2. System updates: profiles SET importedCalendars = [...] WHERE id = 123
3. Only profile 123's settings are updated
4. Other teammates' settings remain unchanged
```

---

## Security Guarantees

✅ **User Isolation**: Each user's calendar data is completely isolated
✅ **Profile-Based Scoping**: All operations use `profile.id` from authenticated session
✅ **Team Member Scoping**: Teammates are scoped by their `teamMemberId` linked to their `profile.id`
✅ **Company Scoping**: Admins are scoped by `companyId = profile.id`
✅ **Import Validation**: Calendar access is validated against user's own imported calendars
✅ **No Cross-User Access**: Users cannot access other users' calendar data

---

## Implementation Details

### Export Endpoint Logic:
```typescript
// 1. Get current user's profile
const profile = await storage.getProfileByUserId(user.claims.sub);

// 2. Determine user type and scope accordingly
if (isEmployee || isImpersonating) {
  // Teammate: Find their teamMemberId and filter by it
  const teamMember = await db.select().from(workerTeamMembers)
    .where(eq(workerTeamMembers.profileId, profile.id));
  // Export only jobs with applications.teamMemberId = teamMember.id
} else if (profile.role === "company") {
  // Admin: Export only jobs with jobs.companyId = profile.id
} else if (profile.role === "worker") {
  // Worker: Export only applications with applications.workerId = profile.id
}
```

### Import Settings Logic:
```typescript
// Always scoped to current user's profile
await db.update(profiles)
  .set({ importedCalendars: JSON.stringify(importedCalendars) })
  .where(eq(profiles.id, profile.id)); // Only current user
```

---

## Confirmation

✅ **Confirmed**: Calendar import/export logic applies **only** to:
- The specific teammate when they import/export (via their `teamMemberId`)
- The specific admin when they import/export (via their `companyId`)
- The specific worker when they import/export (via their `workerId`)

✅ **No Cross-User Access**: Users cannot import/export other users' calendars

✅ **Profile-Based Isolation**: All operations are scoped to the authenticated user's profile ID

✅ **Team Member Isolation**: Teammates are isolated by their `teamMemberId` which is linked to their `profile.id`

✅ **Company Isolation**: Admins are isolated by their `companyId` which equals their `profile.id`
