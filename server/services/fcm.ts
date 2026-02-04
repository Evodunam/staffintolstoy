interface FCMPayload {
  notification?: {
    title?: string;
    body?: string;
    image?: string;
  };
  data?: Record<string, string>;
  android?: {
    priority?: 'normal' | 'high';
    ttl?: string;
    collapseKey?: string;
    notification?: {
      channelId?: string;
      sound?: string;
      clickAction?: string;
    };
  };
  apns?: {
    headers?: Record<string, string>;
    payload?: {
      aps: {
        alert?: {
          title?: string;
          body?: string;
        };
        badge?: number;
        sound?: string;
        'content-available'?: number;
      };
    };
  };
}

interface FCMOptions {
  deviceToken: string;
  payload: FCMPayload;
}

interface FCMResponse {
  success: boolean;
  messageId?: string;
  error?: string;
}

async function getAccessToken(): Promise<string> {
  const apiKey = process.env.FIREBASE_API_KEY;
  
  if (!apiKey) {
    throw new Error('Missing FIREBASE_API_KEY for FCM');
  }
  
  // For legacy HTTP API, we use the API key directly
  // For HTTP v1 API, you would use OAuth2 with a service account
  return apiKey;
}

export async function sendFCMNotification(options: FCMOptions): Promise<FCMResponse> {
  const { deviceToken, payload } = options;
  
  try {
    const apiKey = await getAccessToken();
    
    // Using Firebase Cloud Messaging legacy HTTP API
    // For production, consider migrating to HTTP v1 API with service account
    const response = await fetch('https://fcm.googleapis.com/fcm/send', {
      method: 'POST',
      headers: {
        'Authorization': `key=${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        to: deviceToken,
        ...payload
      })
    });
    
    const result = await response.json();
    
    if (response.ok && result.success === 1) {
      console.log('[FCM] Notification sent successfully, message_id:', result.results?.[0]?.message_id);
      return { 
        success: true, 
        messageId: result.results?.[0]?.message_id 
      };
    } else {
      const error = result.results?.[0]?.error || result.error || 'Unknown error';
      console.error('[FCM] Failed to send notification:', error);
      return { success: false, error };
    }
  } catch (error) {
    console.error('[FCM] Error sending notification:', error);
    return { success: false, error: String(error) };
  }
}

export async function sendGeolocationWakeup(deviceToken: string, jobId: number, workerId: number): Promise<FCMResponse> {
  // Data-only message for background wakeup - no notification field
  // This ensures the app receives the message even in background
  const payload: FCMPayload = {
    data: {
      type: 'geolocation_wakeup',
      jobId: String(jobId),
      workerId: String(workerId),
      timestamp: String(Date.now()),
      content_available: 'true' // Signals background processing needed
    },
    android: {
      priority: 'high', // Required for background delivery
      ttl: '300s', // 5 minutes - don't deliver stale wakeups
      collapseKey: `geo-wakeup-${jobId}-${workerId}` // Prevent backlog of duplicate wakeups
    }
  };
  
  return sendFCMNotification({
    deviceToken,
    payload
  });
}

export async function sendClockInReminder(deviceToken: string, jobId: number, jobTitle: string, startTime: string): Promise<FCMResponse> {
  const payload: FCMPayload = {
    notification: {
      title: 'Time to Clock In',
      body: `Your shift for ${jobTitle} starts at ${startTime}. Make sure you're at the job site to clock in.`
    },
    data: {
      type: 'clock_in_reminder',
      jobId: String(jobId),
      timestamp: String(Date.now())
    },
    android: {
      priority: 'high',
      notification: {
        channelId: 'clock_reminders',
        sound: 'default'
      }
    }
  };
  
  return sendFCMNotification({
    deviceToken,
    payload
  });
}

export async function sendClockOutReminder(deviceToken: string, jobId: number, jobTitle: string): Promise<FCMResponse> {
  const payload: FCMPayload = {
    notification: {
      title: 'Clock Out Reminder',
      body: `Don't forget to clock out from ${jobTitle} when you leave the job site.`
    },
    data: {
      type: 'clock_out_reminder',
      jobId: String(jobId),
      timestamp: String(Date.now())
    },
    android: {
      priority: 'high',
      notification: {
        channelId: 'clock_reminders',
        sound: 'default'
      }
    }
  };
  
  return sendFCMNotification({
    deviceToken,
    payload
  });
}

export async function sendAutoClockNotification(
  deviceToken: string, 
  jobId: number, 
  jobTitle: string, 
  action: 'clocked_in' | 'clocked_out'
): Promise<FCMResponse> {
  const isClockIn = action === 'clocked_in';
  
  const payload: FCMPayload = {
    notification: {
      title: isClockIn ? 'Clocked In' : 'Clocked Out',
      body: isClockIn 
        ? `You've been automatically clocked in to ${jobTitle} at the job site.`
        : `You've been automatically clocked out from ${jobTitle}.`
    },
    data: {
      type: 'auto_clock',
      action,
      jobId: String(jobId),
      timestamp: String(Date.now())
    },
    android: {
      priority: 'high',
      notification: {
        channelId: 'clock_notifications',
        sound: 'default'
      }
    }
  };
  
  return sendFCMNotification({
    deviceToken,
    payload
  });
}
