import * as apns from './apns';
import * as fcm from './fcm';
import { db } from '../db';
import { deviceTokens } from '@shared/schema';
import { eq, and } from 'drizzle-orm';

export type Platform = 'ios' | 'android' | 'web';

export interface DeviceToken {
  id: number;
  profileId: number;
  token: string;
  deviceName: string | null;
  deviceType: string | null;
  userAgent: string | null;
  lastUsed: Date | null;
  isActive: boolean | null;
  createdAt: Date | null;
}

export async function sendPushNotification(
  profileId: number,
  type: 'geolocation_wakeup' | 'clock_in_reminder' | 'clock_out_reminder' | 'auto_clock',
  data: {
    jobId: number;
    jobTitle?: string;
    startTime?: string;
    action?: 'clocked_in' | 'clocked_out';
    workerId?: number;
  }
): Promise<{ sent: number; failed: number; errors: string[] }> {
  try {
    // Get all active device tokens for this user
    const tokens = await db.select()
      .from(deviceTokens)
      .where(and(
        eq(deviceTokens.profileId, profileId),
        eq(deviceTokens.isActive, true)
      ));
    
    if (tokens.length === 0) {
      console.log(`[Push] No active device tokens for profile ${profileId}`);
      return { sent: 0, failed: 0, errors: [] };
    }
    
    let sent = 0;
    let failed = 0;
    const errors: string[] = [];
    
    for (const token of tokens) {
      const platform = token.deviceType as Platform | null;
      let result: { success: boolean; error?: string };
      
      try {
        switch (type) {
          case 'geolocation_wakeup':
            if (platform === 'ios') {
              result = await apns.sendGeolocationWakeup(token.token, data.jobId, data.workerId || profileId);
            } else if (platform === 'android') {
              result = await fcm.sendGeolocationWakeup(token.token, data.jobId, data.workerId || profileId);
            } else {
              result = { success: false, error: 'Unsupported platform for geolocation wakeup' };
            }
            break;
            
          case 'clock_in_reminder':
            if (platform === 'ios') {
              result = await apns.sendClockInReminder(token.token, data.jobId, data.jobTitle || 'Job', data.startTime || '');
            } else if (platform === 'android') {
              result = await fcm.sendClockInReminder(token.token, data.jobId, data.jobTitle || 'Job', data.startTime || '');
            } else {
              result = { success: false, error: 'Unsupported platform' };
            }
            break;
            
          case 'clock_out_reminder':
            if (platform === 'ios') {
              result = await apns.sendClockOutReminder(token.token, data.jobId, data.jobTitle || 'Job');
            } else if (platform === 'android') {
              result = await fcm.sendClockOutReminder(token.token, data.jobId, data.jobTitle || 'Job');
            } else {
              result = { success: false, error: 'Unsupported platform' };
            }
            break;
            
          case 'auto_clock':
            if (!data.action) {
              result = { success: false, error: 'Missing action for auto_clock' };
            } else if (platform === 'ios') {
              result = await apns.sendAutoClockNotification(token.token, data.jobId, data.jobTitle || 'Job', data.action);
            } else if (platform === 'android') {
              result = await fcm.sendAutoClockNotification(token.token, data.jobId, data.jobTitle || 'Job', data.action);
            } else {
              result = { success: false, error: 'Unsupported platform' };
            }
            break;
            
          default:
            result = { success: false, error: `Unknown notification type: ${type}` };
        }
        
        if (result.success) {
          sent++;
        } else {
          failed++;
          if (result.error) {
            errors.push(`${platform}: ${result.error}`);
            
            // Deactivate token if it's invalid
            if (result.error.includes('BadDeviceToken') || 
                result.error.includes('Unregistered') ||
                result.error.includes('InvalidRegistration') ||
                result.error.includes('NotRegistered')) {
              console.log(`[Push] Deactivating invalid token for profile ${profileId}`);
              await db.update(deviceTokens)
                .set({ isActive: false, lastUsed: new Date() })
                .where(eq(deviceTokens.id, token.id));
            }
          }
        }
      } catch (error) {
        failed++;
        errors.push(`${platform}: ${String(error)}`);
      }
    }
    
    console.log(`[Push] Sent ${sent}, failed ${failed} notifications to profile ${profileId}`);
    return { sent, failed, errors };
  } catch (error) {
    console.error('[Push] Error sending notifications:', error);
    return { sent: 0, failed: 1, errors: [String(error)] };
  }
}

export async function registerDeviceToken(
  profileId: number,
  token: string,
  deviceType: Platform,
  deviceName?: string,
  userAgent?: string
): Promise<DeviceToken | null> {
  try {
    // Check if token already exists
    const existing = await db.select()
      .from(deviceTokens)
      .where(eq(deviceTokens.token, token))
      .limit(1);
    
    if (existing.length > 0) {
      // Update existing token
      const [updated] = await db.update(deviceTokens)
        .set({ 
          profileId, 
          deviceType, 
          deviceName,
          userAgent,
          isActive: true, 
          lastUsed: new Date() 
        })
        .where(eq(deviceTokens.token, token))
        .returning();
      
      console.log(`[Push] Updated device token for profile ${profileId}`);
      return updated as DeviceToken;
    }
    
    // Insert new token
    const [inserted] = await db.insert(deviceTokens)
      .values({
        profileId,
        token,
        deviceType,
        deviceName,
        userAgent,
        isActive: true
      })
      .returning();
    
    console.log(`[Push] Registered new ${deviceType} device token for profile ${profileId}`);
    return inserted as DeviceToken;
  } catch (error) {
    console.error('[Push] Error registering device token:', error);
    return null;
  }
}

export async function unregisterDeviceToken(token: string): Promise<boolean> {
  try {
    await db.update(deviceTokens)
      .set({ isActive: false, lastUsed: new Date() })
      .where(eq(deviceTokens.token, token));
    
    console.log('[Push] Unregistered device token');
    return true;
  } catch (error) {
    console.error('[Push] Error unregistering device token:', error);
    return false;
  }
}

export async function getActiveDeviceTokens(profileId: number): Promise<DeviceToken[]> {
  try {
    const tokens = await db.select()
      .from(deviceTokens)
      .where(and(
        eq(deviceTokens.profileId, profileId),
        eq(deviceTokens.isActive, true)
      ));
    
    return tokens as DeviceToken[];
  } catch (error) {
    console.error('[Push] Error getting device tokens:', error);
    return [];
  }
}
