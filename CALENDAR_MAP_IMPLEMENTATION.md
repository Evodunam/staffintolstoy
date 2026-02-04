# Calendar Map View Implementation

## Overview
This document describes the implementation of a Map view for the Admin Calendar page that displays real-time or scheduled routes for teammates based on assigned jobs for a selected day.

## Components Created

### 1. CalendarMapView Component (`client/src/components/CalendarMapView.tsx`)

A React component that displays teammate routes on a Google Map using the Directions API.

#### Features:
- **Route Calculation**: Uses Google Maps Directions API to calculate optimal routes
- **Multiple Teammates**: Supports multiple teammates with color-coded routes
- **Starting Points**: Routes start from either:
  - Teammate's work location address (if configured)
  - Teammate's live location (if enabled and available)
- **Job Stops**: Displays all assigned job stops for the selected day in sequence
- **Real-time Updates**: Routes update when date or teammate filter changes
- **Interactive Markers**: Click on routes or pins to see teammate and job details

#### Data Model:

```typescript
interface TeammateRoute {
  teammateId: number;
  teammateName: string;
  teammateAvatar?: string | null;
  workLocation?: {
    address: string;
    lat: number;
    lng: number;
  } | null;
  liveLocation?: {
    lat: number;
    lng: number;
    timestamp: Date;
  } | null;
  jobs: JobStop[];
  route?: google.maps.DirectionsResult | null;
  routeColor: string;
  totalDistance?: string;
  totalDuration?: string;
}

interface JobStop {
  jobId: number;
  jobTitle: string;
  address: string;
  lat: number;
  lng: number;
  scheduledStart: Date;
  scheduledEnd: Date;
  status: "scheduled" | "in-progress" | "completed";
  sequence: number;
}
```

#### Props:
- `selectedDate`: Date to filter jobs
- `teammates`: Array of teammate data with locations
- `jobAssignments`: Array of job assignments with team member IDs
- `enabledTeammates`: Set of enabled teammate IDs for filtering
- `onToggleTeammate`: Callback to toggle teammate visibility
- `height`: Map height (default: "600px")

### 2. CompanyDashboard Integration

#### Changes Made:
1. Added "calendar" to active tab options
2. Added Calendar tab trigger in navigation
3. Added Calendar TabsContent with view mode selector
4. Integrated CalendarMapView component

#### View Modes:
- **Day**: Single day view (placeholder - coming soon)
- **Week**: Week view (placeholder - coming soon)
- **Month**: Month view (placeholder - coming soon)
- **Map**: Map view with routes (implemented)

#### State Management:
```typescript
const [calendarViewMode, setCalendarViewMode] = useState<"day" | "week" | "month" | "map">("day");
const [selectedCalendarDate, setSelectedCalendarDate] = useState(new Date());
const [enabledTeammates, setEnabledTeammates] = useState<Set<number>>(new Set());
```

## Google Maps API Usage

### APIs Used:
1. **Maps JavaScript API**: For displaying the map
2. **Directions API**: For calculating routes between waypoints
3. **Places API**: Loaded but not actively used (available for future enhancements)

### Route Calculation:
- Uses `google.maps.DirectionsService` to calculate routes
- Optimizes waypoints using `optimizeWaypoints: true`
- Travel mode: `DRIVING`
- Routes are color-coded per teammate (8 color palette)

### Route Display:
- Uses `DirectionsRenderer` to display routes on the map
- Custom markers for:
  - Start points (colored circles)
  - Job stops (numbered arrows with sequence)
- Info windows show teammate and job details on click

## Data Requirements

### Teammate Data Structure:
```typescript
{
  id: number;
  firstName: string;
  lastName: string;
  avatarUrl?: string | null;
  workLocationAddress?: string | null;
  workLocationLat?: number | null;
  workLocationLng?: number | null;
  liveLocationLat?: number | null;
  liveLocationLng?: number | null;
  liveLocationTimestamp?: Date | null;
}
```

### Job Assignment Data Structure:
```typescript
{
  jobId: number;
  jobTitle: string;
  address: string;
  latitude: string | null;
  longitude: string | null;
  scheduledStart: string | Date;
  scheduledEnd: string | Date;
  status: string;
  teamMemberId: number;
}
```

## Sample Data Example

### Teammate:
```json
{
  "id": 1,
  "firstName": "John",
  "lastName": "Doe",
  "avatarUrl": "https://example.com/avatar.jpg",
  "workLocationAddress": "123 Main St, Austin, TX 78701",
  "workLocationLat": 30.2672,
  "workLocationLng": -97.7431,
  "liveLocationLat": 30.2680,
  "liveLocationLng": -97.7440,
  "liveLocationTimestamp": "2024-01-15T08:00:00Z"
}
```

### Job Assignments:
```json
[
  {
    "jobId": 101,
    "jobTitle": "Construction Site Setup",
    "address": "456 Oak Ave, Austin, TX 78702",
    "latitude": "30.2700",
    "longitude": "-97.7500",
    "scheduledStart": "2024-01-15T09:00:00Z",
    "scheduledEnd": "2024-01-15T12:00:00Z",
    "status": "scheduled",
    "teamMemberId": 1
  },
  {
    "jobId": 102,
    "jobTitle": "Material Delivery",
    "address": "789 Pine St, Austin, TX 78703",
    "latitude": "30.2750",
    "longitude": "-97.7600",
    "scheduledStart": "2024-01-15T13:00:00Z",
    "scheduledEnd": "2024-01-15T16:00:00Z",
    "status": "scheduled",
    "teamMemberId": 1
  }
]
```

### Example Route Output:
For the above data, the route would:
1. Start from John's work location (123 Main St) or live location if available
2. Go to Job 101 (Construction Site Setup) - Stop 1
3. Go to Job 102 (Material Delivery) - Stop 2
4. Display total distance and duration
5. Show route in blue color (first color in palette)

## UI Features

### Teammate Filter Sidebar:
- Checkbox list of all teammates
- Shows job count badge for each teammate
- Color indicator for active routes
- Toggle teammates on/off to show/hide routes

### Map Controls:
- Date navigation (Previous/Next/Today)
- View mode selector (Day/Week/Month/Map)
- Fullscreen control
- Auto-fit bounds to show all routes

### Interactive Elements:
- Click on route markers to see info window
- Hover over routes to see teammate name
- Info window shows:
  - Teammate name and avatar
  - Total route distance and duration
  - List of all job stops with times

## Future Enhancements

1. **Day/Week/Month Views**: Implement calendar grid views
2. **Route Optimization**: Use Route Optimization API for better waypoint ordering
3. **Fleet Routing**: Integrate Fleet Routing API for multi-vehicle optimization
4. **Real-time Updates**: WebSocket integration for live location updates
5. **Route History**: Save and compare routes over time
6. **Traffic Data**: Show traffic-aware routing
7. **Route Sharing**: Share routes with teammates via link

## API Recommendations

### Current APIs (Sufficient for Basic Routing):
- ✅ Maps JavaScript API
- ✅ Directions API

### Recommended for Advanced Features:
- **Routes API**: For more advanced route calculation
- **Route Optimization API**: For optimal waypoint ordering
- **Fleet Routing API**: For multi-vehicle fleet management

## Notes

- The component handles missing coordinates gracefully (skips jobs/teammates without valid lat/lng)
- Routes are recalculated when date or teammate filter changes
- Map automatically fits bounds to show all visible routes
- Color palette cycles through 8 colors for multiple teammates
