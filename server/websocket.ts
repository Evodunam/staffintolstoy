import { WebSocketServer, WebSocket } from 'ws';
import type { Server, IncomingMessage } from 'http';
import type { Express } from 'express';
import type { Socket } from 'net';
import { getSession } from './auth/session';
import { storage } from './storage';

interface AuthenticatedWebSocket extends WebSocket {
  userId?: string;
  profileId?: number;
  isAuthenticated?: boolean;
}

interface ConnectedClient {
  ws: AuthenticatedWebSocket;
  profileId: number;
  userId: string;
  role: 'worker' | 'company';
  preferences?: {
    trades?: string[];
    serviceCategories?: string[];
    latitude?: string;
    longitude?: string;
    notifyNewJobs?: boolean;
    notifyJobUpdates?: boolean;
  };
}

interface NotificationPayload {
  type: 'new_job' | 'application_update' | 'job_update' | 'timesheet_update' | 'general';
  title: string;
  message: string;
  data?: Record<string, any>;
  timestamp: number;
}

const connectedClients: Map<number, ConnectedClient> = new Map();

let wss: WebSocketServer | null = null;

export function setupWebSocket(server: Server, app: Express) {
  wss = new WebSocketServer({ noServer: true });
  const sessionParser = getSession();

  server.on('upgrade', (req: IncomingMessage, socket: Socket, head: Buffer) => {
    // Only handle app WebSocket at /ws; leave other paths (e.g. /vite-hmr) for Vite
    if (req.url !== '/ws') {
      return;
    }

    sessionParser(req as any, {} as any, (err: any) => {
      if (err) {
        console.log('[websocket] Session parsing error:', err.message);
        socket.write('HTTP/1.1 500 Internal Server Error\r\n\r\n');
        socket.destroy();
        return;
      }

      const session = (req as any).session;
      if (!session) {
        console.log('[websocket] Unauthorized upgrade - no session');
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }

      const passport = session?.passport;
      const user = passport?.user;
      
      if (!user?.claims?.sub) {
        console.log('[websocket] Unauthorized upgrade - no authenticated user');
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }

      wss!.handleUpgrade(req, socket, head, (ws) => {
        (ws as AuthenticatedWebSocket).userId = user.claims.sub;
        (ws as AuthenticatedWebSocket).isAuthenticated = true;
        wss!.emit('connection', ws, req, user);
      });
    });
  });

  wss.on('connection', async (ws: AuthenticatedWebSocket, req: IncomingMessage, user: any) => {
    const userId = user?.claims?.sub;
    if (!userId) {
      console.log('[websocket] Connection rejected - no userId');
      ws.close(1008, 'Unauthorized');
      return;
    }

    console.log(`[websocket] Authenticated connection: userId=${userId}`);

    const profile = await storage.getProfileByUserId(userId);
    if (profile) {
      ws.profileId = profile.id;
      
      connectedClients.set(profile.id, {
        ws,
        profileId: profile.id,
        userId: userId,
        role: profile.role as 'worker' | 'company',
        preferences: {
          trades: profile.trades || [],
          serviceCategories: profile.serviceCategories || [],
          latitude: profile.latitude || undefined,
          longitude: profile.longitude || undefined,
          notifyNewJobs: profile.notifyNewJobs ?? true,
          notifyJobUpdates: profile.notifyJobUpdates ?? true,
        },
      });

      ws.send(JSON.stringify({ 
        type: 'authenticated', 
        profileId: profile.id,
        message: 'Connected to real-time notifications'
      }));
      
      console.log(`[websocket] Client registered: profileId=${profile.id}, role=${profile.role}`);
    }

    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());
        
        if (message.type === 'update_preferences') {
          const client = connectedClients.get(ws.profileId!);
          if (client) {
            client.preferences = { ...client.preferences, ...message.preferences };
            console.log(`[websocket] Updated preferences for profileId=${client.profileId}`);
          }
        }
        
        if (message.type === 'ping') {
          ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
        }
      } catch (err) {
        console.error('[websocket] Error parsing message:', err);
      }
    });

    ws.on('close', () => {
      const entries = Array.from(connectedClients.entries());
      for (const [profileId, client] of entries) {
        if (client.ws === ws) {
          connectedClients.delete(profileId);
          console.log(`[websocket] Client disconnected: profileId=${profileId}`);
          break;
        }
      }
    });

    ws.on('error', (err) => {
      console.error('[websocket] Error:', err);
    });
  });

  console.log('[websocket] WebSocket server initialized on /ws');
  return wss;
}

function calculateDistanceMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

function normalizeSkill(skill: string): string {
  return skill.toLowerCase().replace(/ lite$/, '').replace(/ elite$/, '').trim();
}

export function notifyNewJob(job: {
  id: number;
  title: string;
  trade?: string;
  serviceCategory?: string;
  hourlyRate?: number;
  latitude?: string;
  longitude?: string;
  location?: string;
  city?: string;
  state?: string;
}) {
  const notification: NotificationPayload = {
    type: 'new_job',
    title: 'New Job Available',
    message: `${job.title} - ${job.trade || 'General'} in ${job.location || `${job.city}, ${job.state}`}`,
    data: {
      jobId: job.id,
      trade: job.trade,
      hourlyRate: job.hourlyRate,
      location: job.location || `${job.city}, ${job.state}`,
    },
    timestamp: Date.now(),
  };

  const jobLat = job.latitude ? parseFloat(job.latitude) : null;
  const jobLng = job.longitude ? parseFloat(job.longitude) : null;
  const jobTrade = normalizeSkill(job.trade || '');
  const jobCategory = normalizeSkill(job.serviceCategory || '');

  let notifiedCount = 0;
  const entries = Array.from(connectedClients.entries());

  for (const [profileId, client] of entries) {
    if (client.role !== 'worker') continue;
    if (!client.preferences?.notifyNewJobs) continue;

    const prefs = client.preferences;
    
    if (jobLat && jobLng && prefs.latitude && prefs.longitude) {
      const workerLat = parseFloat(prefs.latitude);
      const workerLng = parseFloat(prefs.longitude);
      const distanceMeters = calculateDistanceMeters(jobLat, jobLng, workerLat, workerLng);
      const distanceMiles = distanceMeters / 1609.34;
      
      if (distanceMiles > 50) continue;
    }

    const workerTrades = (prefs.trades || []).map(normalizeSkill);
    const workerCategories = (prefs.serviceCategories || []).map(normalizeSkill);

    let hasMatchingSkill = false;
    
    if (jobTrade || jobCategory) {
      hasMatchingSkill = workerTrades.some((t: string) => 
        t === jobTrade || t === jobCategory || t.includes(jobTrade) || jobTrade.includes(t)
      );
      
      if (!hasMatchingSkill && jobCategory) {
        hasMatchingSkill = workerCategories.some((c: string) => c === jobCategory);
      }
    } else {
      hasMatchingSkill = workerTrades.some((t: string) => t === 'general labor' || t === 'laborer');
    }

    if (!hasMatchingSkill && workerTrades.length > 0) continue;

    try {
      client.ws.send(JSON.stringify(notification));
      notifiedCount++;
    } catch (err) {
      console.error(`[websocket] Failed to send to profileId=${profileId}:`, err);
    }
  }

  console.log(`[websocket] Notified ${notifiedCount} workers about new job: ${job.title}`);
}

export function notifyApplicationUpdate(
  workerId: number,
  update: {
    applicationId: number;
    jobId: number;
    jobTitle: string;
    status: 'pending' | 'accepted' | 'rejected';
    message?: string;
  }
) {
  const client = connectedClients.get(workerId);
  if (!client) return;

  const statusMessages: Record<string, string> = {
    pending: 'Your application is pending review',
    accepted: 'Congratulations! Your application has been accepted',
    rejected: 'Your application was not selected for this job',
  };

  const notification: NotificationPayload = {
    type: 'application_update',
    title: update.status === 'accepted' ? 'Application Accepted!' : 
           update.status === 'rejected' ? 'Application Update' : 'Application Submitted',
    message: update.message || `${statusMessages[update.status]} for "${update.jobTitle}"`,
    data: {
      applicationId: update.applicationId,
      jobId: update.jobId,
      jobTitle: update.jobTitle,
      status: update.status,
    },
    timestamp: Date.now(),
  };

  try {
    client.ws.send(JSON.stringify(notification));
    console.log(`[websocket] Notified worker ${workerId} about application update: ${update.status}`);
  } catch (err) {
    console.error(`[websocket] Failed to send application update to worker ${workerId}:`, err);
  }
}

export function notifyJobUpdate(
  companyId: number,
  update: {
    jobId: number;
    jobTitle: string;
    type: 'new_application' | 'worker_clocked_in' | 'worker_clocked_out' | 'timesheet_submitted';
    workerName?: string;
    message?: string;
  }
) {
  const client = connectedClients.get(companyId);
  if (!client) return;

  const typeMessages: Record<string, string> = {
    new_application: `New inquiry from ${update.workerName || 'a worker'}`,
    worker_clocked_in: `${update.workerName || 'Worker'} has clocked in`,
    worker_clocked_out: `${update.workerName || 'Worker'} has clocked out`,
    timesheet_submitted: `${update.workerName || 'Worker'} submitted a timesheet for review`,
  };

  const notification: NotificationPayload = {
    type: 'job_update',
    title: update.type === 'new_application' ? 'New Worker Inquiry' : 'Job Update',
    message: update.message || `${typeMessages[update.type]} for "${update.jobTitle}"`,
    data: {
      jobId: update.jobId,
      jobTitle: update.jobTitle,
      updateType: update.type,
      workerName: update.workerName,
    },
    timestamp: Date.now(),
  };

  try {
    client.ws.send(JSON.stringify(notification));
    console.log(`[websocket] Notified company ${companyId} about job update: ${update.type}`);
  } catch (err) {
    console.error(`[websocket] Failed to send job update to company ${companyId}:`, err);
  }
}

export function notifyTimesheetUpdate(
  workerId: number,
  update: {
    timesheetId: number;
    jobTitle: string;
    status: 'approved' | 'rejected' | 'edited' | 'disputed';
    amount?: number;
    message?: string;
  }
) {
  const client = connectedClients.get(workerId);
  if (!client) return;

  const statusMessages: Record<string, string> = {
    approved: `Your timesheet for "${update.jobTitle}" has been approved${update.amount ? ` - $${(update.amount / 100).toFixed(2)} earned` : ''}`,
    rejected: `Your timesheet for "${update.jobTitle}" was rejected`,
    edited: `Your timesheet for "${update.jobTitle}" was edited by the company`,
    disputed: `Your timesheet for "${update.jobTitle}" has been reported`,
  };

  const notification: NotificationPayload = {
    type: 'timesheet_update',
    title: update.status === 'approved' ? 'Payment Approved!' : 'Timesheet Update',
    message: update.message || statusMessages[update.status],
    data: {
      timesheetId: update.timesheetId,
      jobTitle: update.jobTitle,
      status: update.status,
      amount: update.amount,
    },
    timestamp: Date.now(),
  };

  try {
    client.ws.send(JSON.stringify(notification));
    console.log(`[websocket] Notified worker ${workerId} about timesheet update: ${update.status}`);
  } catch (err) {
    console.error(`[websocket] Failed to send timesheet update to worker ${workerId}:`, err);
  }
}

export function notifyProfile(profileId: number, notification: NotificationPayload) {
  const client = connectedClients.get(profileId);
  if (!client) return false;

  try {
    client.ws.send(JSON.stringify(notification));
    return true;
  } catch (err) {
    console.error(`[websocket] Failed to send notification to profileId=${profileId}:`, err);
    return false;
  }
}

export function getConnectedClientsCount(): number {
  return connectedClients.size;
}

export function isProfileConnected(profileId: number): boolean {
  return connectedClients.has(profileId);
}

interface PresenceUpdate {
  workerId: number;
  workerName: string;
  avatarUrl?: string | null;
  companyId: number;
  teamId?: number | null;
  teamMemberId?: number | null;
  teamMemberName?: string | null;
  teamMemberAvatarUrl?: string | null;
  action: 'clock_in' | 'clock_out';
  latitude?: number | null;
  longitude?: number | null;
  jobId: number;
  jobTitle: string;
  timestamp: number;
}

export function broadcastPresenceUpdate(update: PresenceUpdate) {
  const client = connectedClients.get(update.companyId);
  if (!client) {
    console.log(`[websocket] Company ${update.companyId} not connected for presence update`);
    return;
  }

  const payload = {
    type: 'presence_update',
    workerId: update.workerId,
    workerName: update.workerName,
    avatarUrl: update.avatarUrl,
    teamMemberId: update.teamMemberId,
    teamMemberName: update.teamMemberName,
    teamMemberAvatarUrl: update.teamMemberAvatarUrl,
    action: update.action,
    latitude: update.latitude,
    longitude: update.longitude,
    jobId: update.jobId,
    jobTitle: update.jobTitle,
    timestamp: update.timestamp,
  };

  try {
    client.ws.send(JSON.stringify(payload));
    console.log(`[websocket] Sent presence update (${update.action}) for worker ${update.workerName} to company ${update.companyId}`);
  } catch (err) {
    console.error(`[websocket] Failed to send presence update to company ${update.companyId}:`, err);
  }
}

export function notifyWorkerTeamPresence(
  operatorId: number,
  update: {
    teamMemberId: number;
    teamMemberName: string;
    teamMemberAvatarUrl?: string | null;
    action: 'clock_in' | 'clock_out';
    latitude?: number | null;
    longitude?: number | null;
    jobId: number;
    jobTitle: string;
  }
) {
  const client = connectedClients.get(operatorId);
  if (!client) return;

  const payload = {
    type: 'team_presence_update',
    ...update,
    timestamp: Date.now(),
  };

  try {
    client.ws.send(JSON.stringify(payload));
    console.log(`[websocket] Notified operator ${operatorId} about team member ${update.teamMemberName} ${update.action}`);
  } catch (err) {
    console.error(`[websocket] Failed to send team presence update to operator ${operatorId}:`, err);
  }
}
