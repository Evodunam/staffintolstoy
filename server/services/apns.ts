import http2 from 'http2';

const APNS_HOST_PRODUCTION = 'api.push.apple.com';
const APNS_HOST_SANDBOX = 'api.sandbox.push.apple.com';

interface APNsPayload {
  aps: {
    alert?: {
      title?: string;
      subtitle?: string;
      body?: string;
    };
    badge?: number;
    sound?: string;
    'content-available'?: number;
    'mutable-content'?: number;
    category?: string;
    'thread-id'?: string;
  };
  [key: string]: any;
}

interface APNsOptions {
  deviceToken: string;
  payload: APNsPayload;
  topic?: string;
  expiration?: number;
  priority?: number;
  collapseId?: string;
  pushType?: 'alert' | 'background' | 'voip' | 'complication' | 'fileprovider' | 'mdm';
}

interface JWTCache {
  token: string;
  issuedAt: number;
}

let jwtCache: JWTCache | null = null;
const JWT_EXPIRY = 50 * 60 * 1000; // Refresh JWT every 50 minutes (Apple allows 60 minutes)

async function generateJWT(): Promise<string> {
  const now = Date.now();
  
  // Return cached token if still valid
  if (jwtCache && (now - jwtCache.issuedAt) < JWT_EXPIRY) {
    return jwtCache.token;
  }
  
  const keyId = process.env.APPLE_APNS_KEY_ID;
  const teamId = process.env.APPLE_TEAM_ID;
  const privateKey = process.env.APPLE_APNS_PRIVATE_KEY;
  
  if (!keyId || !teamId || !privateKey) {
    throw new Error('Missing APNs credentials. Please set APPLE_APNS_KEY_ID, APPLE_TEAM_ID, and APPLE_APNS_PRIVATE_KEY');
  }
  
  // Create JWT header
  const header = {
    alg: 'ES256',
    kid: keyId
  };
  
  // Create JWT claims
  const issuedAt = Math.floor(now / 1000);
  const claims = {
    iss: teamId,
    iat: issuedAt
  };
  
  // Base64url encode
  const base64url = (data: object) => {
    return Buffer.from(JSON.stringify(data))
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '');
  };
  
  const headerEncoded = base64url(header);
  const claimsEncoded = base64url(claims);
  const unsignedToken = `${headerEncoded}.${claimsEncoded}`;
  
  // Sign with ES256 (ECDSA with P-256 and SHA-256)
  const crypto = await import('crypto');
  const sign = crypto.createSign('SHA256');
  sign.update(unsignedToken);
  sign.end();
  
  // Format the private key properly
  let formattedKey = privateKey;
  if (!privateKey.includes('-----BEGIN')) {
    formattedKey = `-----BEGIN PRIVATE KEY-----\n${privateKey}\n-----END PRIVATE KEY-----`;
  }
  
  const signature = sign.sign(formattedKey);
  
  // Convert DER signature to raw format (r || s)
  // ES256 signature is 64 bytes (32 bytes r + 32 bytes s)
  const derSignature = signature;
  let r: Buffer, s: Buffer;
  
  // Parse DER format: 0x30 [length] 0x02 [r-length] [r] 0x02 [s-length] [s]
  if (derSignature[0] === 0x30) {
    let offset = 2;
    
    // Extract r
    if (derSignature[offset] === 0x02) {
      offset++;
      const rLength = derSignature[offset++];
      r = derSignature.slice(offset, offset + rLength);
      offset += rLength;
      
      // Extract s
      if (derSignature[offset] === 0x02) {
        offset++;
        const sLength = derSignature[offset++];
        s = derSignature.slice(offset, offset + sLength);
      } else {
        throw new Error('Invalid DER signature: missing s component');
      }
    } else {
      throw new Error('Invalid DER signature: missing r component');
    }
  } else {
    throw new Error('Invalid DER signature format');
  }
  
  // Pad or trim to 32 bytes each
  const padTo32 = (buf: Buffer): Buffer => {
    if (buf.length === 32) return buf;
    if (buf.length > 32) return buf.slice(buf.length - 32);
    const padded = Buffer.alloc(32);
    buf.copy(padded, 32 - buf.length);
    return padded;
  };
  
  const rawSignature = Buffer.concat([padTo32(r), padTo32(s)]);
  const signatureEncoded = rawSignature
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
  
  const jwt = `${unsignedToken}.${signatureEncoded}`;
  
  // Cache the token
  jwtCache = { token: jwt, issuedAt: now };
  
  return jwt;
}

export async function sendAPNsNotification(options: APNsOptions): Promise<{ success: boolean; apnsId?: string; error?: string }> {
  const {
    deviceToken,
    payload,
    topic = process.env.APPLE_BUNDLE_ID,
    expiration = 0,
    priority = 10,
    collapseId,
    pushType = 'alert'
  } = options;
  
  if (!topic) {
    throw new Error('Missing APPLE_BUNDLE_ID for APNs topic');
  }
  
  const useSandbox = process.env.NODE_ENV !== 'production';
  const host = useSandbox ? APNS_HOST_SANDBOX : APNS_HOST_PRODUCTION;
  
  try {
    const jwt = await generateJWT();
    
    return new Promise((resolve, reject) => {
      const client = http2.connect(`https://${host}`);
      
      client.on('error', (err) => {
        console.error('[APNs] Connection error:', err);
        reject(err);
      });
      
      const headers = {
        ':method': 'POST',
        ':path': `/3/device/${deviceToken}`,
        'authorization': `bearer ${jwt}`,
        'apns-topic': topic,
        'apns-push-type': pushType,
        'apns-priority': String(priority),
        'apns-expiration': String(expiration),
        'content-type': 'application/json',
        ...(collapseId && { 'apns-collapse-id': collapseId })
      };
      
      const req = client.request(headers);
      
      let responseData = '';
      let responseHeaders: http2.IncomingHttpHeaders = {};
      
      req.on('response', (headers) => {
        responseHeaders = headers;
      });
      
      req.on('data', (chunk) => {
        responseData += chunk;
      });
      
      req.on('end', () => {
        client.close();
        
        const status = responseHeaders[':status'];
        const apnsId = responseHeaders['apns-id'] as string | undefined;
        
        if (status === 200) {
          console.log('[APNs] Notification sent successfully, apns-id:', apnsId);
          resolve({ success: true, apnsId });
        } else {
          let errorReason = 'Unknown error';
          try {
            const errorBody = JSON.parse(responseData);
            errorReason = errorBody.reason || errorReason;
          } catch {}
          
          console.error('[APNs] Failed to send notification:', status, errorReason);
          resolve({ success: false, error: `${status}: ${errorReason}` });
        }
      });
      
      req.on('error', (err) => {
        client.close();
        console.error('[APNs] Request error:', err);
        reject(err);
      });
      
      req.write(JSON.stringify(payload));
      req.end();
    });
  } catch (error) {
    console.error('[APNs] Error sending notification:', error);
    return { success: false, error: String(error) };
  }
}

export async function sendGeolocationWakeup(deviceToken: string, jobId: number, workerId: number): Promise<{ success: boolean; apnsId?: string; error?: string }> {
  // Silent background push for iOS - must be data-only with content-available
  // No alert, no sound, no badge to ensure background delivery
  const payload: APNsPayload = {
    aps: {
      'content-available': 1
    },
    type: 'geolocation_wakeup',
    jobId,
    workerId,
    timestamp: Date.now()
  };
  
  return sendAPNsNotification({
    deviceToken,
    payload,
    pushType: 'background',
    priority: 5, // Required for background delivery
    collapseId: `geo-wakeup-${jobId}-${workerId}`, // Prevent backlog of duplicate wakeups
    expiration: 300 // 5 minutes - don't deliver stale wakeups
  });
}

export async function sendClockInReminder(deviceToken: string, jobId: number, jobTitle: string, startTime: string): Promise<{ success: boolean; apnsId?: string; error?: string }> {
  const payload: APNsPayload = {
    aps: {
      alert: {
        title: 'Time to Clock In',
        subtitle: jobTitle,
        body: `Your shift starts at ${startTime}. Make sure you're at the job site to clock in.`
      },
      sound: 'default',
      category: 'CLOCK_IN_REMINDER'
    },
    type: 'clock_in_reminder',
    jobId,
    timestamp: Date.now()
  };
  
  return sendAPNsNotification({
    deviceToken,
    payload,
    pushType: 'alert',
    priority: 10
  });
}

export async function sendClockOutReminder(deviceToken: string, jobId: number, jobTitle: string): Promise<{ success: boolean; apnsId?: string; error?: string }> {
  const payload: APNsPayload = {
    aps: {
      alert: {
        title: 'Clock Out Reminder',
        subtitle: jobTitle,
        body: 'Don\'t forget to clock out when you leave the job site.'
      },
      sound: 'default',
      category: 'CLOCK_OUT_REMINDER'
    },
    type: 'clock_out_reminder',
    jobId,
    timestamp: Date.now()
  };
  
  return sendAPNsNotification({
    deviceToken,
    payload,
    pushType: 'alert',
    priority: 10
  });
}

export async function sendAutoClockNotification(
  deviceToken: string, 
  jobId: number, 
  jobTitle: string, 
  action: 'clocked_in' | 'clocked_out'
): Promise<{ success: boolean; apnsId?: string; error?: string }> {
  const isClockIn = action === 'clocked_in';
  
  const payload: APNsPayload = {
    aps: {
      alert: {
        title: isClockIn ? 'Clocked In' : 'Clocked Out',
        subtitle: jobTitle,
        body: isClockIn 
          ? 'You\'ve been automatically clocked in at the job site.' 
          : 'You\'ve been automatically clocked out from the job site.'
      },
      sound: 'default'
    },
    type: 'auto_clock',
    action,
    jobId,
    timestamp: Date.now()
  };
  
  return sendAPNsNotification({
    deviceToken,
    payload,
    pushType: 'alert',
    priority: 10
  });
}
