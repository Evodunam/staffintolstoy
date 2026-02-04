// Calendar Integration Service for Google Calendar and Outlook
// Provides import/export functionality for worker calendars

import { google } from 'googleapis';
import { Client } from '@microsoft/microsoft-graph-client';

// Google Calendar connection settings cache (deprecated - using env vars now)
let googleConnectionSettings: any;

async function getGoogleAccessToken() {
  // Use environment variable for Google OAuth token
  const accessToken = process.env.GOOGLE_CALENDAR_ACCESS_TOKEN;
  
  if (!accessToken) {
    throw new Error('Google Calendar access token not configured. Set GOOGLE_CALENDAR_ACCESS_TOKEN environment variable.');
  }
  
  return accessToken;
}

// Outlook connection settings cache (deprecated - using env vars now)
let outlookConnectionSettings: any;

async function getOutlookAccessToken() {
  // Use environment variable for Outlook OAuth token
  const accessToken = process.env.OUTLOOK_ACCESS_TOKEN;
  
  if (!accessToken) {
    throw new Error('Outlook access token not configured. Set OUTLOOK_ACCESS_TOKEN environment variable.');
  }
  
  return accessToken;
}

// Get fresh Google Calendar client
export async function getGoogleCalendarClient() {
  const accessToken = await getGoogleAccessToken();
  const oauth2Client = new google.auth.OAuth2();
  oauth2Client.setCredentials({ access_token: accessToken });
  return google.calendar({ version: 'v3', auth: oauth2Client });
}

// Get fresh Outlook client
export async function getOutlookClient() {
  const accessToken = await getOutlookAccessToken();
  return Client.initWithMiddleware({
    authProvider: {
      getAccessToken: async () => accessToken
    }
  });
}

// External calendar event interface
export interface ExternalCalendarEvent {
  id: string;
  title: string;
  start: Date;
  end: Date;
  allDay: boolean;
  source: 'google' | 'outlook';
  calendarId?: string;
  calendarName?: string;
}

// Platform job event for export
export interface PlatformJobEvent {
  id: number;
  title: string;
  description: string;
  start: Date;
  end: Date;
  location: string;
  status: 'pending' | 'accepted' | 'completed';
  url: string;
  companyName?: string;
  hourlyRate?: number;
}

const BASE_URL = process.env.BASE_URL || process.env.APP_URL || 'http://localhost:5000';

// === Google Calendar Functions ===

export async function listGoogleCalendars(): Promise<{ id: string; name: string; primary: boolean }[]> {
  try {
    const calendar = await getGoogleCalendarClient();
    const response = await calendar.calendarList.list();
    return (response.data.items || []).map(cal => ({
      id: cal.id || '',
      name: cal.summary || 'Unnamed Calendar',
      primary: cal.primary || false
    }));
  } catch (error: any) {
    console.error('Error listing Google calendars:', error);
    throw new Error('Failed to list Google calendars: ' + error.message);
  }
}

export async function getGoogleCalendarEvents(
  calendarId: string,
  timeMin: Date,
  timeMax: Date
): Promise<ExternalCalendarEvent[]> {
  try {
    const calendar = await getGoogleCalendarClient();
    const response = await calendar.events.list({
      calendarId,
      timeMin: timeMin.toISOString(),
      timeMax: timeMax.toISOString(),
      singleEvents: true,
      orderBy: 'startTime'
    });
    
    return (response.data.items || []).map(event => ({
      id: event.id || '',
      title: event.summary || 'Untitled Event',
      start: new Date(event.start?.dateTime || event.start?.date || ''),
      end: new Date(event.end?.dateTime || event.end?.date || ''),
      allDay: !event.start?.dateTime,
      source: 'google' as const,
      calendarId,
      calendarName: response.data.summary || undefined
    }));
  } catch (error: any) {
    console.error('Error fetching Google calendar events:', error);
    throw new Error('Failed to fetch Google calendar events: ' + error.message);
  }
}

export async function createGoogleCalendarEvent(
  calendarId: string,
  event: PlatformJobEvent,
  timezone: string = 'UTC'
): Promise<string> {
  try {
    const calendar = await getGoogleCalendarClient();
    const response = await calendar.events.insert({
      calendarId,
      requestBody: {
        summary: `[Tolstoy] ${event.title}`,
        description: buildEventDescription(event),
        start: {
          dateTime: event.start.toISOString(),
          timeZone: timezone
        },
        end: {
          dateTime: event.end.toISOString(),
          timeZone: timezone
        },
        location: event.location,
        colorId: event.status === 'accepted' ? '10' : event.status === 'pending' ? '5' : '2'
      }
    });
    return response.data.id || '';
  } catch (error: any) {
    console.error('Error creating Google calendar event:', error);
    throw new Error('Failed to create Google calendar event: ' + error.message);
  }
}

export async function exportJobsToGoogleCalendar(
  calendarId: string,
  jobs: PlatformJobEvent[]
): Promise<{ success: number; failed: number }> {
  let success = 0;
  let failed = 0;
  
  for (const job of jobs) {
    try {
      await createGoogleCalendarEvent(calendarId, job);
      success++;
    } catch (error) {
      console.error(`Failed to export job ${job.id}:`, error);
      failed++;
    }
  }
  
  return { success, failed };
}

// === Outlook Calendar Functions ===

export async function listOutlookCalendars(): Promise<{ id: string; name: string; primary: boolean }[]> {
  try {
    const client = await getOutlookClient();
    const response = await client.api('/me/calendars').get();
    return (response.value || []).map((cal: any) => ({
      id: cal.id || '',
      name: cal.name || 'Unnamed Calendar',
      primary: cal.isDefaultCalendar || false
    }));
  } catch (error: any) {
    console.error('Error listing Outlook calendars:', error);
    throw new Error('Failed to list Outlook calendars: ' + error.message);
  }
}

export async function getOutlookCalendarEvents(
  calendarId: string,
  timeMin: Date,
  timeMax: Date
): Promise<ExternalCalendarEvent[]> {
  try {
    const client = await getOutlookClient();
    const response = await client
      .api(`/me/calendars/${calendarId}/events`)
      .header('Prefer', 'outlook.timezone="UTC"')
      .filter(`start/dateTime ge '${timeMin.toISOString()}' and end/dateTime le '${timeMax.toISOString()}'`)
      .orderby('start/dateTime')
      .get();
    
    return (response.value || []).map((event: any) => {
      const startTz = event.start?.timeZone || 'UTC';
      const endTz = event.end?.timeZone || 'UTC';
      const startStr = event.start?.dateTime || '';
      const endStr = event.end?.dateTime || '';
      
      return {
        id: event.id || '',
        title: event.subject || 'Untitled Event',
        start: new Date(startTz === 'UTC' ? startStr + 'Z' : startStr),
        end: new Date(endTz === 'UTC' ? endStr + 'Z' : endStr),
        allDay: event.isAllDay || false,
        source: 'outlook' as const,
        calendarId,
        calendarName: undefined
      };
    });
  } catch (error: any) {
    console.error('Error fetching Outlook calendar events:', error);
    throw new Error('Failed to fetch Outlook calendar events: ' + error.message);
  }
}

export async function createOutlookCalendarEvent(
  calendarId: string,
  event: PlatformJobEvent,
  timezone: string = 'UTC'
): Promise<string> {
  try {
    const client = await getOutlookClient();
    const response = await client.api(`/me/calendars/${calendarId}/events`).post({
      subject: `[Tolstoy] ${event.title}`,
      body: {
        contentType: 'HTML',
        content: buildEventDescription(event, true)
      },
      start: {
        dateTime: event.start.toISOString().replace('Z', ''),
        timeZone: timezone
      },
      end: {
        dateTime: event.end.toISOString().replace('Z', ''),
        timeZone: timezone
      },
      location: {
        displayName: event.location
      },
      categories: [event.status === 'accepted' ? 'Green category' : event.status === 'pending' ? 'Yellow category' : 'Blue category']
    });
    return response.id || '';
  } catch (error: any) {
    console.error('Error creating Outlook calendar event:', error);
    throw new Error('Failed to create Outlook calendar event: ' + error.message);
  }
}

export async function exportJobsToOutlookCalendar(
  calendarId: string,
  jobs: PlatformJobEvent[]
): Promise<{ success: number; failed: number }> {
  let success = 0;
  let failed = 0;
  
  for (const job of jobs) {
    try {
      await createOutlookCalendarEvent(calendarId, job);
      success++;
    } catch (error) {
      console.error(`Failed to export job ${job.id}:`, error);
      failed++;
    }
  }
  
  return { success, failed };
}

// === Conflict Detection ===

export interface CalendarConflict {
  jobStart: Date;
  jobEnd: Date;
  conflictingEvent: ExternalCalendarEvent;
  overlapMinutes: number;
}

export function checkForConflicts(
  jobStart: Date,
  jobEnd: Date,
  externalEvents: ExternalCalendarEvent[]
): CalendarConflict[] {
  const conflicts: CalendarConflict[] = [];
  
  for (const event of externalEvents) {
    // Skip all-day events for conflict detection (they're typically holidays/reminders)
    if (event.allDay) continue;
    
    // Check for overlap
    const overlapStart = Math.max(jobStart.getTime(), event.start.getTime());
    const overlapEnd = Math.min(jobEnd.getTime(), event.end.getTime());
    
    if (overlapStart < overlapEnd) {
      const overlapMinutes = Math.round((overlapEnd - overlapStart) / (1000 * 60));
      conflicts.push({
        jobStart,
        jobEnd,
        conflictingEvent: event,
        overlapMinutes
      });
    }
  }
  
  return conflicts;
}

// Build event description with URL links
function buildEventDescription(event: PlatformJobEvent, html: boolean = false): string {
  const lines = [
    `Company: ${event.companyName || 'N/A'}`,
    `Status: ${event.status.charAt(0).toUpperCase() + event.status.slice(1)}`,
    `Rate: $${event.hourlyRate || 0}/hr`,
    '',
    event.description || '',
    '',
    html 
      ? `<a href="${event.url}">View on Tolstoy Staffing</a>`
      : `View on Tolstoy Staffing: ${event.url}`
  ];
  
  return html 
    ? lines.map(l => `<p>${l}</p>`).join('')
    : lines.join('\n');
}

// Check connection status
export async function checkGoogleCalendarConnection(): Promise<boolean> {
  try {
    await getGoogleAccessToken();
    return true;
  } catch {
    return false;
  }
}

export async function checkOutlookConnection(): Promise<boolean> {
  try {
    await getOutlookAccessToken();
    return true;
  } catch {
    return false;
  }
}
