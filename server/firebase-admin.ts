import admin from "firebase-admin";
import path from "path";
import fs from "fs";

let firebaseApp: admin.app.App | null = null;

export function getFirebaseAdmin(): admin.app.App | null {
  if (firebaseApp) {
    return firebaseApp;
  }
  
  try {
    // Option 1: Use GOOGLE_APPLICATION_CREDENTIALS (file path)
    if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      const credentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
      if (fs.existsSync(credentialsPath)) {
        firebaseApp = admin.initializeApp({
          credential: admin.credential.cert(credentialsPath),
        });
        console.log("Firebase Admin initialized from file:", credentialsPath);
        return firebaseApp;
      } else {
        console.warn(`Firebase credentials file not found: ${credentialsPath}`);
      }
    }

    // Option 2: Use service account JSON from environment variables
    if (process.env.FIREBASE_PRIVATE_KEY) {
      const serviceAccount = {
        type: "service_account",
        project_id: process.env.FIREBASE_PROJECT_ID || "tolstoy-staffing-23032",
        private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID || "",
        private_key: (process.env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n"),
        client_email: process.env.FIREBASE_CLIENT_EMAIL || "firebase-adminsdk-fbsvc@tolstoy-staffing-23032.iam.gserviceaccount.com",
        client_id: process.env.FIREBASE_CLIENT_ID || "",
        auth_uri: "https://accounts.google.com/o/oauth2/auth",
        token_uri: "https://oauth2.googleapis.com/token",
        auth_provider_x509_cert_url: "https://www.googleapis.com/oauth2/v1/certs",
        client_x509_cert_url: process.env.FIREBASE_CLIENT_CERT_URL || "",
      };
      
      firebaseApp = admin.initializeApp({
        credential: admin.credential.cert(serviceAccount as admin.ServiceAccount),
      });
      console.log("Firebase Admin initialized from environment variables");
      return firebaseApp;
    }

    // Option 3: Use GCS_SERVICE_ACCOUNT_KEY (same service account for GCS)
    if (process.env.GCS_SERVICE_ACCOUNT_KEY) {
      try {
        const credentials = JSON.parse(process.env.GCS_SERVICE_ACCOUNT_KEY);
        firebaseApp = admin.initializeApp({
          credential: admin.credential.cert(credentials),
        });
        console.log("Firebase Admin initialized from GCS_SERVICE_ACCOUNT_KEY");
        return firebaseApp;
      } catch (error) {
        console.error("Failed to parse GCS_SERVICE_ACCOUNT_KEY:", error);
      }
    }

    console.warn("Firebase Admin SDK not configured - push notifications will be disabled");
    return null;
  } catch (error) {
    console.error("Failed to initialize Firebase Admin:", error);
    return null;
  }
}

export async function sendPushNotification(
  tokens: string[],
  title: string,
  body: string,
  data?: Record<string, string>
): Promise<{ successCount: number; failureCount: number; failedTokens: string[] }> {
  const app = getFirebaseAdmin();
  if (!app) {
    console.log("Push notification skipped - Firebase Admin not configured");
    return { successCount: 0, failureCount: 0, failedTokens: [] };
  }
  
  if (tokens.length === 0) {
    return { successCount: 0, failureCount: 0, failedTokens: [] };
  }
  
  const targetPath = data?.url || data?.path || "/";
  const message: admin.messaging.MulticastMessage = {
    tokens,
    notification: {
      title,
      body,
    },
    data: data || {},
    android: {
      priority: "high",
    },
    apns: {
      payload: {
        aps: {
          sound: "default",
        },
      },
    },
    webpush: {
      fcmOptions: {
        link: targetPath,
      },
      notification: {
        icon: "/favicon.ico",
        badge: "/favicon.ico",
        requireInteraction: true,
      },
    },
  };
  
  try {
    const response = await admin.messaging().sendEachForMulticast(message);
    
    const failedTokens: string[] = [];
    response.responses.forEach((res, idx) => {
      if (!res.success) {
        failedTokens.push(tokens[idx]);
        console.error("Push notification failed for token:", tokens[idx], res.error);
      }
    });
    
    return {
      successCount: response.successCount,
      failureCount: response.failureCount,
      failedTokens,
    };
  } catch (error) {
    console.error("Error sending push notification:", error);
    return { successCount: 0, failureCount: tokens.length, failedTokens: tokens };
  }
}
