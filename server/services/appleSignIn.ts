import jwt from 'jsonwebtoken';
import { db } from '../db';
import { profiles } from '@shared/schema';
import { eq } from 'drizzle-orm';

export interface AppleSignInNotification {
  iss: string;
  aud: string;
  iat: number;
  jti: string;
  events: string;
}

export interface AppleSignInEvent {
  type: string;
  sub: string;
  email?: string;
  is_private_email?: boolean | string;
  event_time: number;
}

export type AppleEventType = 
  | 'email-disabled'
  | 'email-enabled'
  | 'consent-revoked'
  | 'account-delete';

const APPLE_ISSUER = 'https://appleid.apple.com';

async function getApplePublicKeys(): Promise<any[]> {
  try {
    const response = await fetch('https://appleid.apple.com/auth/keys');
    const data = await response.json();
    return data.keys || [];
  } catch (error) {
    console.error('[AppleSignIn] Error fetching Apple public keys:', error);
    return [];
  }
}

function convertJwkToPem(jwk: any): string {
  // This is a simplified conversion - in production, use a library like 'jwk-to-pem'
  const crypto = require('crypto');
  const keyObject = crypto.createPublicKey({ key: jwk, format: 'jwk' });
  return keyObject.export({ type: 'spki', format: 'pem' }) as string;
}

export async function verifyAppleNotification(token: string): Promise<AppleSignInNotification | null> {
  try {
    const bundleId = process.env.APPLE_BUNDLE_ID;
    
    if (!bundleId) {
      console.error('[AppleSignIn] Missing APPLE_BUNDLE_ID');
      return null;
    }
    
    // Decode header to get key ID
    const decoded = jwt.decode(token, { complete: true });
    if (!decoded || !decoded.header || !decoded.header.kid) {
      console.error('[AppleSignIn] Invalid JWT format');
      return null;
    }
    
    // Fetch Apple's public keys
    const keys = await getApplePublicKeys();
    const matchingKey = keys.find(k => k.kid === decoded.header.kid);
    
    if (!matchingKey) {
      console.error('[AppleSignIn] No matching public key found');
      return null;
    }
    
    // Convert JWK to PEM
    const publicKey = convertJwkToPem(matchingKey);
    
    // Verify the token
    const payload = jwt.verify(token, publicKey, {
      issuer: APPLE_ISSUER,
      audience: bundleId,
      algorithms: ['RS256']
    }) as AppleSignInNotification;
    
    return payload;
  } catch (error) {
    console.error('[AppleSignIn] Error verifying notification:', error);
    return null;
  }
}

export async function handleAppleNotification(payload: AppleSignInNotification): Promise<void> {
  try {
    // Parse the events JSON string
    const event: AppleSignInEvent = JSON.parse(payload.events);
    
    console.log(`[AppleSignIn] Received event type: ${event.type} for user: ${event.sub}`);
    
    switch (event.type) {
      case 'email-disabled':
        // User has stopped sharing their private email relay
        console.log(`[AppleSignIn] User ${event.sub} disabled email relay`);
        await updateUserEmailPreference(event.sub, false);
        break;
        
      case 'email-enabled':
        // User has enabled their private email relay
        console.log(`[AppleSignIn] User ${event.sub} enabled email relay`);
        await updateUserEmailPreference(event.sub, true);
        break;
        
      case 'consent-revoked':
        // User has revoked consent for the app
        console.log(`[AppleSignIn] User ${event.sub} revoked app consent`);
        await handleConsentRevoked(event.sub);
        break;
        
      case 'account-delete':
        // User has deleted their Apple Account
        console.log(`[AppleSignIn] User ${event.sub} deleted their Apple Account`);
        await handleAccountDelete(event.sub);
        break;
        
      default:
        console.log(`[AppleSignIn] Unknown event type: ${event.type}`);
    }
  } catch (error) {
    console.error('[AppleSignIn] Error handling notification:', error);
    throw error;
  }
}

async function updateUserEmailPreference(appleUserId: string, emailEnabled: boolean): Promise<void> {
  try {
    // Find user by Apple user ID (stored in userId or a dedicated field)
    // For now, we'll log this - in production, you'd want to update a field
    console.log(`[AppleSignIn] Email preference for ${appleUserId}: ${emailEnabled}`);
    
    // You could update a user preference here
    // await db.update(profiles)
    //   .set({ appleEmailEnabled: emailEnabled })
    //   .where(eq(profiles.appleUserId, appleUserId));
  } catch (error) {
    console.error('[AppleSignIn] Error updating email preference:', error);
  }
}

async function handleConsentRevoked(appleUserId: string): Promise<void> {
  try {
    // When consent is revoked, the user no longer wants to use Sign in with Apple
    // You should:
    // 1. Invalidate any tokens associated with this user
    // 2. Optionally mark the account for review or notify the user
    console.log(`[AppleSignIn] Handling consent revocation for ${appleUserId}`);
    
    // In a real implementation, you would find the user and handle this appropriately
    // For example, you might mark their Apple Sign In as disconnected
    // but keep their account if they have other sign-in methods
  } catch (error) {
    console.error('[AppleSignIn] Error handling consent revocation:', error);
  }
}

async function handleAccountDelete(appleUserId: string): Promise<void> {
  try {
    // The user has deleted their entire Apple Account
    // You should handle this according to your data retention policy
    console.log(`[AppleSignIn] Handling account deletion for ${appleUserId}`);
    
    // In a real implementation, you might:
    // 1. Anonymize the user's data
    // 2. Delete the account after a grace period
    // 3. Send a notification to the user's other contact methods
  } catch (error) {
    console.error('[AppleSignIn] Error handling account deletion:', error);
  }
}
