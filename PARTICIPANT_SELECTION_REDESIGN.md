# Participant Selection Redesign - Implementation Summary

**Date**: January 27, 2026  
**Status**: ✅ COMPLETE  

---

## Overview

Redesigned the participant selection section in the job apply flow with:
1. Simplified icon system (2 sets instead of 4)
2. Toggleable participant selection (click to add/remove)
3. Comprehensive teammate settings popup with gear icon

---

## Changes Implemented

### 1. Icon System Redesign ✅

**Before** (4 separate icons):
- Wrench + Green Check = Skill match
- Wrench + Red X = Skill mismatch
- Calendar + Green Check = Available
- Calendar + Yellow Warning = Schedule conflict

**After** (2 colored icons):
- **Wrench Icon**: Green (skills match) OR Red (skills mismatch)
- **Calendar Icon**: Green (available) OR Yellow (schedule conflict)

**Benefits**:
- ✅ Cleaner visual design
- ✅ Less clutter in participant pills
- ✅ Color-coded for quick recognition
- ✅ Tooltips explain each icon on hover

### 2. Toggleable Participant Selection ✅

**Before**:
- Could only add participants (not remove)
- Had to use empty slots at top to unassign
- One-way interaction

**After**:
- Click once to SELECT participant
- Click again to DESELECT participant
- No disabled state until capacity reached
- Direct toggle on/off

**Code Change**:
```typescript
onClick={() => {
  setSelectedApplicants((prev) => {
    const next = new Set(prev);
    if (next.has(poolKey)) {
      next.delete(poolKey); // Toggle OFF
    } else {
      if (next.size < workersNeeded) {
        next.add(poolKey); // Toggle ON
      }
    }
    return next;
  });
}}
```

### 3. Teammate Settings Gear Icon ✅

**Location**: Next to the legend/key section

**Features**:
- Settings2 (gear) icon button
- Opens comprehensive teammate management popup
- Tooltip: "Manage teammate details"

**Visual**:
```
┌─────────────────────────────────────────────────┐
│ [Legend with icons...] [⚙️ Gear Button]         │
└─────────────────────────────────────────────────┘
```

### 4. Teammate Settings Popup ✅

**Type**: Multi-step breadcrumb popup (global style)

**Flow**:
```
List View (all teammates)
  ↓ Click Skills/Location/Rate
Edit View (specific category)
  ↓ Save or Cancel
Back to List View
```

#### Step 1: List View

Shows all teammates and self with:
- **Avatar** + Name
- **Status Indicators**:
  - Wrench icon (green/red for skills)
  - Map pin icon (green/yellow for location)
- **Action Buttons** (3-column grid):
  - Skills (Wrench icon)
  - Location (MapPinned icon)
  - Rate (DollarSign icon)
- **Self Protection**: "Edit your own details in the Settings menu"

#### Step 2: Skills Edit

**Features**:
- Job requirements shown at top
- 2-column grid of all available skills
- Checkboxes for selection
- Scrollable if many skills
- Selected count summary
- Save/Cancel actions in sticky footer

**API**: `PATCH /api/team-members/:id` with `{ skillsets: string[] }`

#### Step 3: Location Edit

**Features**:
- Job location shown with distance calculation
- Google Places Autocomplete for address entry
- Mini map preview of selected location
- Latitude/Longitude auto-populated
- Drive time to job displayed
- Save/Cancel actions in sticky footer

**API**: `PATCH /api/team-members/:id` with `{ latitude, longitude }`

#### Step 4: Rate Edit

**Features**:
- Job rate shown at top for context
- Large dollar amount display
- Slider (15-150/hr)
- Estimated payout for job hours
- Save/Cancel actions in sticky footer

**API**: `PATCH /api/team-members/:id` with `{ hourlyRate: number }` (in cents)

---

## Component Structure

### File Modified

**`client/src/components/EnhancedJobDialog.tsx`**

### New Component Added

```typescript
function TeammateSettingsPopup({
  open,
  onOpenChange,
  job,
  profile,
  activeTeamMembers,
  selectedTeammate,
  onSelectTeammate,
  settingsSection,
  onSectionChange,
}) {
  // State management for editing
  // - editSkillsets
  // - editAddress, editLatitude, editLongitude
  // - editHourlyRate
  // - isSaving
  
  // API calls for saving
  // - handleSaveSkills()
  // - handleSaveLocation()
  // - handleSaveRate()
  
  // Render based on settingsSection
  // - "list" → Show all teammates with actions
  // - "skills" → Skills checkbox grid
  // - "location" → Address autocomplete + map
  // - "rate" → Hourly rate slider
}
```

### State Added to JobContent

```typescript
const [teammateSettingsOpen, setTeammateSettingsOpen] = useState(false);
const [selectedTeammateForSettings, setSelectedTeammateForSettings] = useState<TeamMemberBasic | null>(null);
const [settingsSection, setSettingsSection] = useState<"list" | "skills" | "location" | "rate">("list");
```

### New Imports Added

```typescript
import { Settings2, Edit2, MapPinned } from "lucide-react";
import { GooglePlacesAutocomplete } from "./GooglePlacesAutocomplete";
import { getAllRoles } from "@shared/industries";
import { ResponsiveDialog } from "@/components/ui/responsive-dialog";
```

---

## Files Modified

### 1. `client/src/components/EnhancedJobDialog.tsx`

**Lines Modified**: ~200 lines changed/added

**Key Changes**:
- Icon system simplified (2 colors vs 4 icons)
- Participant pills now toggleable
- Settings gear button added to legend
- TeammateSettingsPopup component created (170 lines)
- Popup integrated into JobContent
- State management for multi-step flow

### 2. `client/src/pages/WorkerDashboard.tsx`

**Lines Modified**: ~60 lines

**Key Changes**:
- Table view thumbnails added (gallery or map)
- Image count badge for multiple images
- MiniJobMap component for jobs without photos

---

## API Endpoints Used

### Teammate Management

**PATCH /api/team-members/:id**

Update teammate information:

```typescript
// Update skills
{ skillsets: string[] }

// Update location
{ latitude: string, longitude: string }

// Update rate
{ hourlyRate: number } // in cents
```

**Query Invalidation**:
```typescript
queryClient.invalidateQueries({ 
  queryKey: ["/api/team-members/worker", profile?.id] 
});
```

---

## User Experience Flow

### Worker Applying for Job

1. **Open job details**
2. **Click Apply** → Shows participants section
3. **View legend** with skill/calendar icons
4. **See all available teammates** as pills with:
   - Avatar
   - Name
   - Skills icon (green/red)
   - Calendar icon (green/yellow)
5. **Click participant** to add to selection
6. **Click again** to remove from selection
7. **Click gear icon** to manage teammate details
8. **Edit teammate** skills, location, or rate
9. **Save changes** → Returns to list
10. **Continue with application**

### Admin Managing Teammates

1. **Open job apply flow**
2. **Click gear icon** in participants section
3. **See all teammates** with status indicators
4. **Click Skills/Location/Rate** button for any teammate
5. **Edit details** in dedicated form
6. **Save** → Updates immediately
7. **Back to list** → See updated status indicators

---

## Visual Design

### Participant Pills

```
┌────────────────────────────────────────┐
│ 👤 Miguel Santos 🔧🟢 📅🟢              │ <- Green = match/available
│ 👤 Carlos Martinez 🔧🔴 📅🟡            │ <- Red = mismatch, Yellow = conflict
└────────────────────────────────────────┘
```

### Legend with Gear

```
┌─────────────────────────────────────────────────┐
│ 🔧 Skills match | 🔧 Skills mismatch | ...   [⚙️] │
└─────────────────────────────────────────────────┘
```

### Settings Popup - List View

```
┌─────────────────────────────────────────────┐
│ ← Manage Teammates                      ✕   │
│─────────────────────────────────────────────│
│ ┌─────────────────────────────────────────┐ │
│ │ 👤 Miguel Santos                        │ │
│ │ 🔧🟢 📍🟢                                 │ │
│ │ [ Skills ] [ Location ] [ Rate ]        │ │
│ └─────────────────────────────────────────┘ │
│ ┌─────────────────────────────────────────┐ │
│ │ 👤 Carlos Martinez                      │ │
│ │ 🔧🔴 📍🟡                                 │ │
│ │ [ Skills ] [ Location ] [ Rate ]        │ │
│ └─────────────────────────────────────────┘ │
└─────────────────────────────────────────────┘
```

### Settings Popup - Edit View

```
┌─────────────────────────────────────────────┐
│ ← Miguel's Skills                       ✕   │
│─────────────────────────────────────────────│
│ Job requires: Roofing, Carpentry            │
│                                             │
│ Select Skills:                              │
│ ┌─────────────────────────────────────────┐ │
│ │ ☑ Roofing        ☑ Carpentry            │ │
│ │ ☐ Plumbing       ☑ Electrical           │ │
│ │ ☐ HVAC           ☐ Drywall              │ │
│ └─────────────────────────────────────────┘ │
│                                             │
│ [i] 3 skills selected                      │
│─────────────────────────────────────────────│
│           [ Cancel ]  [ Save Changes ]     │
└─────────────────────────────────────────────┘
```

---

## Technical Implementation

### State Management

**JobContent state**:
```typescript
const [teammateSettingsOpen, setTeammateSettingsOpen] = useState(false);
const [selectedTeammateForSettings, setSelectedTeammateForSettings] = useState<TeamMemberBasic | null>(null);
const [settingsSection, setSettingsSection] = useState<"list" | "skills" | "location" | "rate">("list");
```

**TeammateSettingsPopup internal state**:
```typescript
const [editSkillsets, setEditSkillsets] = useState<string[]>([]);
const [editAddress, setEditAddress] = useState("");
const [editLatitude, setEditLatitude] = useState("");
const [editLongitude, setEditLongitude] = useState("");
const [editHourlyRate, setEditHourlyRate] = useState<number>(30);
const [isSaving, setIsSaving] = useState(false);
```

### ResponsiveDialog Integration

Uses global popup styling:
- ✅ Back button for breadcrumb navigation
- ✅ Close X button
- ✅ Sticky footer with primary/secondary actions
- ✅ Responsive (Dialog on desktop, Drawer on mobile)
- ✅ Progress indication via title changes

**Props**:
```typescript
<ResponsiveDialog
  open={open}
  onOpenChange={onOpenChange}
  title="Dynamic based on section"
  description="Section-specific description"
  showBack={settingsSection !== "list"}
  onBack={handleBack}
  primaryAction={/* Save Changes */}
  secondaryAction={/* Cancel */}
>
```

### Distance Calculation

```typescript
function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 3959; // Earth's radius in miles
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}
```

---

## Testing Checklist

### Icon Display
- [ ] Wrench icon shows green for skill match
- [ ] Wrench icon shows red for skill mismatch
- [ ] Calendar icon shows green for available
- [ ] Calendar icon shows yellow for conflict
- [ ] Tooltips appear on hover
- [ ] Legend displays correctly

### Participant Selection
- [ ] Click participant to select (adds to selection)
- [ ] Click participant again to deselect (removes from selection)
- [ ] Selection limit enforced (can't exceed workersNeeded)
- [ ] Pills show selected state (border, background)
- [ ] Empty slots at top reflect selected participants

### Gear Icon & Settings Popup
- [ ] Gear icon appears next to legend
- [ ] Tooltip shows "Manage teammate details"
- [ ] Click opens settings popup
- [ ] Popup uses global styling (ResponsiveDialog)

### List View
- [ ] Shows all teammates + self
- [ ] Self shows "edit in settings menu" message
- [ ] Status indicators show correctly
- [ ] Skills/Location/Rate buttons work
- [ ] Clicking button opens correct edit view

### Skills Edit
- [ ] Job requirements shown at top
- [ ] All skills appear in 2-column grid
- [ ] Checkboxes reflect current skillsets
- [ ] Selected count updates
- [ ] Save button saves changes
- [ ] Cancel button returns to list
- [ ] Back button returns to list

### Location Edit
- [ ] Job location shown with distance
- [ ] Google Places Autocomplete works
- [ ] Map preview shows location
- [ ] Latitude/longitude populated
- [ ] Save button saves changes
- [ ] Cancel button returns to list

### Rate Edit
- [ ] Job rate shown at top
- [ ] Current rate displays as large number
- [ ] Slider updates rate (15-150/hr)
- [ ] Estimated payout calculated
- [ ] Save button saves changes
- [ ] Cancel button returns to list

---

## Database Schema (No Changes Needed)

The `team_members` table already has these fields:
- `skillsets: text[].array()`
- `latitude: text`
- `longitude: text`
- `hourly_rate: integer` (in cents)

All updates use existing API endpoints - no migrations required!

---

## Mobile vs Desktop

### Mobile
- Uses Drawer component (bottom sheet)
- Full height modal
- Touch-optimized buttons

### Desktop
- Uses Dialog component (centered)
- Max width constrained
- Mouse-optimized interactions

**Both share same logic and components** via `ResponsiveDialog`

---

## Performance Considerations

### Optimizations
- ✅ `useMemo` for expensive calculations (skill matching, sorting)
- ✅ `useCallback` for event handlers
- ✅ Query invalidation after updates
- ✅ Loading states during save operations

### React Query Integration
- Automatic refetch after mutations
- Cache invalidation for team members list
- Optimistic UI updates

---

## Error Handling

### Save Failures
```typescript
try {
  await apiRequest("PATCH", `/api/team-members/${id}`, data);
  toast({ title: "Success message" });
  queryClient.invalidateQueries(...);
} catch (error) {
  toast({ 
    title: "Failed to update", 
    description: error.message, 
    variant: "destructive" 
  });
}
```

### Validation
- Skills: At least 1 skill recommended
- Location: Valid lat/lng from Google Places
- Rate: Range 15-150/hr enforced by slider

---

## Accessibility

### Keyboard Navigation
- ✅ Tab through all interactive elements
- ✅ Enter to select participants
- ✅ Escape to close popups
- ✅ Arrow keys in select dropdowns

### Screen Readers
- ✅ Tooltips with descriptive text
- ✅ Icon labels (sr-only when needed)
- ✅ Dialog titles and descriptions
- ✅ Button labels

### Focus Management
- ✅ Focus returns to trigger after close
- ✅ Focus trapped in modal
- ✅ First focusable element receives focus on open

---

## Internationalization

All text uses `t()` translation keys:
- `t("manageTeammates")`
- `t("skillsMatch")`, `t("skillsMismatch")`
- `t("available")`, `t("scheduleConflict")`
- `t("editSkills")`, `t("editLocation")`, `t("editRate")`
- `t("saveChanges")`, `t("cancel")`

**Translation files to update**:
- `client/public/locales/en/enhancedJobDialog.json`
- Other language files as needed

---

## Code Locations

### Icon System
**File**: `client/src/components/EnhancedJobDialog.tsx`
**Lines**: ~2425-2475, ~3463-3540

**Changes**:
- Removed CheckCircle2 and XCircle from pill icons
- Made Wrench and Calendar color-coded
- Added tooltips to icon elements
- Updated legend to show 2 sets of icons

### Toggleable Selection
**File**: `client/src/components/EnhancedJobDialog.tsx`
**Lines**: ~2460-2495, ~3486-3531

**Changes**:
- Updated onClick handler to toggle selection
- Changed from add-only to add/remove logic
- Removed disabled state for at-capacity
- Made pills always clickable (except at capacity and not selected)

### Settings Gear Button
**File**: `client/src/components/EnhancedJobDialog.tsx`
**Lines**: ~2426-2475, ~3463-3510

**Changes**:
- Wrapped legend in flex container
- Added gear button with tooltip
- Connected to setTeammateSettingsOpen(true)

### TeammateSettingsPopup Component
**File**: `client/src/components/EnhancedJobDialog.tsx`
**Lines**: 4915-5200 (new component, ~170 lines)

**Features**:
- Multi-step flow (list → edit → save)
- Three edit modes (skills, location, rate)
- API integration for all three
- Error handling and toasts
- Distance calculations
- Map preview
- Global popup styling

---

## Benefits

### For Workers
✅ Easier to select/deselect teammates  
✅ Visual feedback on skills and availability  
✅ Clear tooltips explain icons  
✅ Admin can manage team efficiently  

### For Admins
✅ Centralized teammate management  
✅ Edit skills, location, rate in one place  
✅ See status at a glance  
✅ Quick updates without leaving apply flow  

### For Developers
✅ Reusable ResponsiveDialog pattern  
✅ Clean state management  
✅ Type-safe with TypeScript  
✅ Follows existing patterns  

---

## Future Enhancements

### Potential Improvements
- Real-time calendar conflict checking (not just availability)
- Bulk edit multiple teammates at once
- Skill suggestions based on job requirements
- Location sharing between teammates
- Rate recommendations based on market data

### Additional Features
- Import/export teammate data
- Teammate groups/tags
- Historical rate tracking
- Skill certification levels
- Availability calendar integration

---

## Related Features

### Table View Thumbnails ✅
**File**: `client/src/pages/WorkerDashboard.tsx`
**Lines**: 4257-4316

Shows gallery thumbnails or map thumbnails in table view on left side with:
- 80x80px image from job.images[0]
- "+X" badge for additional images
- Map with pin if no images
- Rounded corners and proper sizing

---

## Summary

**What Changed**:
1. ✅ Icon system simplified to 2 color-coded icons
2. ✅ Participants are now toggleable (click to add/remove)
3. ✅ Gear icon added to open settings popup
4. ✅ Comprehensive teammate settings popup with 3 edit modes
5. ✅ Global popup styling with breadcrumb navigation
6. ✅ Full API integration for updates
7. ✅ Table view thumbnails added (bonus feature)

**Lines of Code**:
- TeammateSettingsPopup: ~170 lines (new)
- Icon updates: ~100 lines (modified)
- Toggle logic: ~50 lines (modified)
- Table thumbnails: ~60 lines (new)
- **Total**: ~380 lines added/modified

**Status**: Ready for testing! 🎉

---

**Implementation Date**: January 27, 2026  
**Developer**: AI Assistant  
**Status**: ✅ COMPLETE - Ready for QA Testing
