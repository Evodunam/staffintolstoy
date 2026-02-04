import type { Express, Request, Response, NextFunction } from "express";
import { ObjectStorageService, ObjectNotFoundError, StorageBucket } from "./objectStorage";
import { isAuthenticated } from "../auth/middleware";
import { randomUUID } from "crypto";
import { resolve } from "path";
import { existsSync, readFileSync } from "fs";

/** Max allowed upload size: 10 GB (global for all uploads) */
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024 * 1024;

/**
 * In development, re-read .env.development and .env and parse IDRIVE_E2_* into process.env.
 * Allows uploads to work after adding credentials without restarting the server.
 */
function tryLoadIdriveE2FromEnvFiles(): boolean {
  if (process.env.NODE_ENV !== "development") return false;
  const cwd = process.cwd();
  const files = [
    resolve(cwd, ".env.development"),
    resolve(cwd, ".env"),
  ];
  let loaded = 0;
  for (const filePath of files) {
    if (!existsSync(filePath)) continue;
    try {
      const content = readFileSync(filePath, "utf-8");
      const lines = content.split(/\r?\n/);
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eq = trimmed.indexOf("=");
        if (eq === -1) continue;
        const key = trimmed.substring(0, eq).trim();
        const value = trimmed.substring(eq + 1).trim();
        if (!key.startsWith("IDRIVE_E2_")) continue;
        const clean = value.replace(/^["']|["']$/g, "").trim();
        if (clean) {
          process.env[key] = clean;
          loaded++;
        }
      }
    } catch {
      // ignore read errors
    }
  }
  if (loaded > 0) {
    console.log(`[uploads] Loaded ${loaded} IDRIVE_E2 variable(s) from .env file(s).`);
  }
  return loaded > 0;
}

/**
 * Register object storage routes for file uploads.
 *
 * This provides example routes for the presigned URL upload flow:
 * 1. POST /api/uploads/request-url - Get a presigned URL for uploading
 * 2. The client then uploads directly to the presigned URL
 *
 * IMPORTANT: These are example routes. Customize based on your use case:
 * - Add authentication middleware for protected uploads
 * - Add file metadata storage (save to database after upload)
 * - Add ACL policies for access control
 */
export function registerObjectStorageRoutes(app: Express): void {
  const objectStorageService = new ObjectStorageService();

  /**
   * Request a presigned URL for file upload.
   *
   * Request body (JSON):
   * {
   *   "name": "filename.jpg",
   *   "size": 12345,
   *   "contentType": "image/jpeg",
   *   "bucket": "avatar" // Optional: "avatar" | "bio" | "jobs" | "reviews" (defaults to "avatar")
   * }
   *
   * Response:
   * {
   *   "uploadURL": "https://s3.us-midwest-1.idrivee2.com/...",
   *   "objectPath": "/objects/avatar/uploads/uuid"
   * }
   *
   * IMPORTANT: The client should NOT send the file to this endpoint.
   * Send JSON metadata only, then upload the file directly to uploadURL.
   */
  app.post("/api/uploads/request-url", async (req, res) => {
    // In dev mode, bypass authentication for testing
    const isDev = process.env.NODE_ENV === "development";
    if (!isDev) {
      // Production mode: require authentication
      if (!req.isAuthenticated || !req.isAuthenticated()) {
        return res.status(401).json({ error: "Unauthorized" });
      }
    }
    
    try {
      const { name, contentType, bucket } = req.body;
      const fileSizeBytes = Number(req.body.size ?? 0);

      if (!name) {
        return res.status(400).json({
          error: "Missing required field: name",
        });
      }

      if (typeof fileSizeBytes === "number" && fileSizeBytes > MAX_UPLOAD_BYTES) {
        return res.status(400).json({
          error: `File exceeds the maximum upload size of 10 GB.`,
        });
      }

      // Validate environment variables before attempting upload
      const accessKeyId = process.env.IDRIVE_E2_ACCESS_KEY_ID;
      const secretAccessKey = process.env.IDRIVE_E2_SECRET_ACCESS_KEY;
      const endpoint = process.env.IDRIVE_E2_ENDPOINT || "s3.us-midwest-1.idrivee2.com";
      const region = process.env.IDRIVE_E2_REGION || "us-midwest-1";

      console.log("IDrive E2 Configuration Check:", {
        hasAccessKey: !!accessKeyId,
        hasSecretKey: !!secretAccessKey,
        endpoint,
        region,
        accessKeyPrefix: accessKeyId ? accessKeyId.substring(0, 4) + "..." : "missing",
      });

      let finalAccessKeyId = accessKeyId;
      let finalSecretAccessKey = secretAccessKey;
      if (!finalAccessKeyId || !finalSecretAccessKey) {
        if (isDev) {
          tryLoadIdriveE2FromEnvFiles();
          finalAccessKeyId = process.env.IDRIVE_E2_ACCESS_KEY_ID;
          finalSecretAccessKey = process.env.IDRIVE_E2_SECRET_ACCESS_KEY;
        }
        if (!finalAccessKeyId || !finalSecretAccessKey) {
          console.error("IDrive E2 credentials not configured", {
            IDRIVE_E2_ACCESS_KEY_ID: !!finalAccessKeyId,
            IDRIVE_E2_SECRET_ACCESS_KEY: !!finalSecretAccessKey,
          });
          return res.status(500).json({
            error: "Object storage not configured. Please set IDRIVE_E2_ACCESS_KEY_ID and IDRIVE_E2_SECRET_ACCESS_KEY in .env.development (then save and retry, or restart the server).",
          });
        }
      }

      // Determine the bucket to use
      const storageBucket = objectStorageService.determineBucket(bucket);
      
      console.log("Upload request received:", {
        requestedBucket: bucket,
        determinedBucket: storageBucket,
        contentType,
        fileName: name,
      });

      const uploadURL = await objectStorageService.getObjectEntityUploadURL(contentType, storageBucket);

      if (!uploadURL) {
        console.error("getObjectEntityUploadURL returned null/undefined");
        return res.status(500).json({
          error: "Failed to generate upload URL. The storage service returned an invalid URL.",
        });
      }

      // Extract object path from the presigned URL for later reference
      // Always ensure the object path includes the bucket name
      let objectPath: string;
      const bucketName = objectStorageService.getBucketName(storageBucket);
      
      try {
        objectPath = objectStorageService.normalizeObjectEntityPath(uploadURL);
        
        // Ensure objectPath includes bucket name - if normalization failed, construct it manually
        if (!objectPath.startsWith("/objects/")) {
          // Fallback: construct path from bucket and extract UUID from URL
          // Try to extract UUID from the presigned URL
          const urlMatch = uploadURL.match(/uploads\/([a-f0-9-]+)/i);
          const objectId = urlMatch ? urlMatch[1] : randomUUID();
          objectPath = `/objects/${bucketName}/uploads/${objectId}`;
        } else {
          // Verify bucket is in path, if not add it
          const pathParts = objectPath.split("/").filter(p => p);
          if (pathParts.length >= 2 && pathParts[1] !== bucketName) {
            // Path is missing bucket or has wrong bucket, reconstruct
            const objectKey = pathParts.slice(1).join("/") || pathParts[pathParts.length - 1];
            objectPath = `/objects/${bucketName}/${objectKey}`;
          } else if (pathParts.length === 1 || (pathParts.length === 2 && pathParts[1] === "uploads")) {
            // Path is just /objects/uploads/uuid - add bucket
            const uuid = pathParts[pathParts.length - 1];
            objectPath = `/objects/${bucketName}/uploads/${uuid}`;
          }
        }
        
        console.log("Normalized object path:", {
          originalUrl: uploadURL.substring(0, 100) + "...",
          normalizedPath: objectPath,
          bucket: storageBucket,
          bucketName,
        });
      } catch (normalizeError: any) {
        console.error("Error normalizing object path:", normalizeError);
        // Fallback: construct path from bucket and extract UUID from URL
        const urlMatch = uploadURL.match(/uploads\/([a-f0-9-]+)/i);
        const objectId = urlMatch ? urlMatch[1] : randomUUID();
        objectPath = `/objects/${bucketName}/uploads/${objectId}`;
        console.log("Using fallback object path:", objectPath);
      }

      res.json({
        uploadURL,
        objectPath,
        // Echo back the metadata for client convenience
        metadata: { name, size: fileSizeBytes, contentType, bucket: storageBucket },
      });
    } catch (error: any) {
      console.error("Error generating upload URL:", error);
      console.error("Error details:", {
        message: error.message,
        stack: error.stack,
        name: error.name,
        code: error.code,
        $metadata: error.$metadata,
        cause: error.cause,
      });
      
      // Provide more specific error messages
      let errorMessage = "Failed to generate upload URL";
      const errorMsg = error.message || String(error);
      
      if (errorMsg.includes("IDrive E2") || errorMsg.includes("IDRIVE_E2")) {
        errorMessage = `IDrive E2 error: ${errorMsg}. Please check IDRIVE_E2_ACCESS_KEY_ID and IDRIVE_E2_SECRET_ACCESS_KEY.`;
      } else if (errorMsg.includes("bucket") || errorMsg.includes("Bucket")) {
        errorMessage = `S3 bucket error: ${errorMsg}. Please check that the bucket exists.`;
      } else if (errorMsg.includes("credentials") || errorMsg.includes("authentication") || errorMsg.includes("permission")) {
        errorMessage = `S3 authentication error: ${errorMsg}. Please check your IDRIVE_E2_ACCESS_KEY_ID and IDRIVE_E2_SECRET_ACCESS_KEY.`;
      } else if (errorMsg) {
        errorMessage = errorMsg;
      }
      
      console.error("Upload URL generation failed:", errorMessage);
      res.status(500).json({ 
        error: errorMessage,
        details: process.env.NODE_ENV === "development" ? {
          message: error.message,
          name: error.name,
          code: error.code,
          stack: error.stack?.split('\n').slice(0, 5).join('\n'), // First 5 lines of stack
        } : undefined,
      });
    }
  });

  /**
   * Serve uploaded objects.
   *
   * GET /objects/:objectPath(*)
   *
   * This serves files from object storage. For public files, no auth needed.
   * For protected files, add authentication middleware and ACL checks.
   */
  app.get("/objects/:objectPath(*)", async (req, res) => {
    const isDev = process.env.NODE_ENV === "development";
    
    try {
      let objectPath = req.path;
      // Prevent path traversal - reject paths containing .. or that escape /objects/
      if (objectPath.includes("..") || !objectPath.startsWith("/objects/")) {
        return res.status(400).json({ error: "Invalid path" });
      }
      const normalized = objectPath.split("/").filter((p) => p && p !== ".").join("/");
      if (!normalized.startsWith("objects/")) {
        return res.status(400).json({ error: "Invalid path" });
      }
      objectPath = "/" + normalized;
      
      console.log("Serving object:", {
        path: objectPath,
        hasBucket: objectPath.split("/").length >= 3,
      });
      
      // In dev mode, check if storage is configured before attempting to access
      // This prevents errors from being thrown in the storage service
      if (isDev && (!process.env.IDRIVE_E2_ACCESS_KEY_ID || !process.env.IDRIVE_E2_SECRET_ACCESS_KEY)) {
        console.warn("Dev mode: Object storage not configured, returning 404 for:", objectPath);
        return res.status(404).json({ 
          error: "Object not found (storage not configured in dev mode)",
        });
      }
      
      // Handle legacy paths that are missing the bucket name
      // Format: /objects/uploads/uuid -> try /objects/avatar/uploads/uuid, /objects/bio/uploads/uuid, etc.
      if (objectPath.startsWith("/objects/uploads/")) {
        const uuid = objectPath.replace("/objects/uploads/", "");
        console.log("Legacy path detected, trying buckets for UUID:", uuid);
        
        // Try common buckets in order of likelihood
        const bucketsToTry = ["avatar", "bio", "jobs", "reviews", "chats"];
        
        for (const bucket of bucketsToTry) {
          try {
            const testPath = `/objects/${bucket}/uploads/${uuid}`;
            console.log(`Trying bucket "${bucket}" with path: ${testPath}`);
            const objectFile = await objectStorageService.getObjectEntityFile(testPath);
            console.log(`Found object in bucket "${bucket}"`);
            await objectStorageService.downloadObject(objectFile, res);
            return; // Success, exit early
          } catch (error: any) {
            // Continue to next bucket if this one fails
            if (error instanceof ObjectNotFoundError) {
              console.log(`Object not found in bucket "${bucket}", trying next...`);
              continue;
            }
            // Check for 404 status codes
            if (error.$metadata?.httpStatusCode === 404 || error.name === "NotFound") {
              console.log(`Object not found in bucket "${bucket}" (404), trying next...`);
              continue;
            }
            // Log non-404 errors but continue trying other buckets
            console.error(`Error checking bucket "${bucket}":`, {
              message: error?.message,
              name: error?.name,
              code: error?.code,
              httpStatusCode: error?.$metadata?.httpStatusCode,
            });
            // Only re-throw if it's a critical error that prevents checking other buckets
            // (e.g., credential errors that would affect all buckets)
            if (error instanceof Error && 
                (error.message.includes("credentials") || 
                 error.message.includes("authentication") ||
                 error.message.includes("IDrive E2 not configured"))) {
              throw error;
            }
            // For other errors, continue trying other buckets
            continue;
          }
        }
        
        // If we get here, none of the buckets worked
        console.error("Object not found in any bucket:", uuid);
        return res.status(404).json({ error: "Object not found in any bucket" });
      }
      
      // Normal path with bucket name
      try {
        const objectFile = await objectStorageService.getObjectEntityFile(objectPath);
        await objectStorageService.downloadObject(objectFile, res);
      } catch (error: any) {
        // In dev mode, if storage isn't configured, just return 404
        const isDev = process.env.NODE_ENV === "development";
        const errorMessage = error instanceof Error ? error.message : String(error);
        
        if (isDev && (
          errorMessage?.includes("IDrive E2 not configured") ||
          errorMessage?.includes("credentials") ||
          errorMessage?.includes("authentication") ||
          errorMessage?.includes("not configured") ||
          error?.code === "CredentialsError" ||
          error?.name === "CredentialsError"
        )) {
          return res.status(404).json({ 
            error: "Object not found (storage not configured in dev mode)",
          });
        }
        
        // Also check for ObjectNotFoundError
        if (error instanceof ObjectNotFoundError) {
          return res.status(404).json({ error: "Object not found" });
        }
        
        // If normal path fails and it looks like it might be missing bucket, try fallback
        const pathParts = objectPath.split("/").filter(p => p);
        if (pathParts.length === 2 && pathParts[1] === "uploads") {
          // Path is /objects/uploads/uuid - try buckets
          const uuid = pathParts[pathParts.length - 1] || pathParts[1];
          const bucketsToTry = ["avatar", "bio", "jobs", "reviews", "chats"];
          
          for (const bucket of bucketsToTry) {
            try {
              const testPath = `/objects/${bucket}/uploads/${uuid}`;
              const objectFile = await objectStorageService.getObjectEntityFile(testPath);
              await objectStorageService.downloadObject(objectFile, res);
              return;
            } catch (innerError) {
              if (innerError instanceof ObjectNotFoundError) {
                continue;
              }
              // In dev mode, treat storage errors as 404
              if (isDev && innerError instanceof Error && (
                innerError.message?.includes("IDrive E2 not configured") ||
                innerError.message?.includes("credentials") ||
                innerError.message?.includes("authentication")
              )) {
                return res.status(404).json({ 
                  error: "Object not found (storage not configured in dev mode)",
                });
              }
            }
          }
        }
        throw error; // Re-throw original error if fallback didn't work
      }
    } catch (error: any) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const isDev = process.env.NODE_ENV === "development";
      
      console.error("Error serving object:", {
        path: req.path,
        error: errorMessage,
        name: error?.name,
        code: error?.code,
        httpStatusCode: error?.$metadata?.httpStatusCode,
        stack: isDev && error instanceof Error ? error.stack?.split('\n').slice(0, 5).join('\n') : undefined,
      });
      
      // Check for ObjectNotFoundError first
      if (error instanceof ObjectNotFoundError || 
          error?.name === "NotFound" || 
          error?.$metadata?.httpStatusCode === 404) {
        return res.status(404).json({ error: "Object not found" });
      }
      
      // Check for credential/configuration errors (check multiple possible error messages)
      const isConfigError = 
        errorMessage?.includes("IDrive E2 not configured") ||
        errorMessage?.includes("IDRIVE_E2") ||
        errorMessage?.includes("credentials") ||
        errorMessage?.includes("authentication") ||
        errorMessage?.includes("not configured") ||
        error?.code === "CredentialsError" ||
        error?.name === "CredentialsError" ||
        error?.code === "InvalidAccessKeyId" ||
        error?.code === "SignatureDoesNotMatch";
      
      if (isConfigError) {
        console.error("IDrive E2 configuration error:", errorMessage);
        
        // In dev mode, return 404 instead of 500 for missing configuration
        // This allows the app to continue working without object storage
        if (isDev) {
          return res.status(404).json({ 
            error: "Object not found (storage not configured in dev mode)",
            details: errorMessage,
          });
        }
        
        return res.status(500).json({ 
          error: "Object storage not configured. Please check IDRIVE_E2_ACCESS_KEY_ID and IDRIVE_E2_SECRET_ACCESS_KEY.",
          details: isDev ? errorMessage : undefined,
        });
      }
      
      // In dev mode, treat most errors as 404 to avoid breaking the UI
      if (isDev) {
        console.warn("Dev mode: Treating error as 404 for:", req.path, errorMessage);
        return res.status(404).json({ 
          error: "Object not found",
          details: errorMessage,
        });
      }
      
      // Provide more detailed error in development
      return res.status(500).json({ 
        error: "Failed to serve object",
        details: isDev ? errorMessage : undefined,
      });
    }
  });

  /**
   * Legacy compatibility: Handle URLs with /api/uploads/ prefix
   * 
   * Redirects /api/uploads//objects/... to /objects/...
   * This handles legacy data that was saved with incorrect URL format.
   */
  app.get("/api/uploads/*", async (req, res, next) => {
    // Extract the path after /api/uploads/
    const fullPath = req.path;
    
    // Check if it contains /objects/ - if so, extract and redirect
    const objectsIndex = fullPath.indexOf("/objects/");
    if (objectsIndex !== -1) {
      const correctPath = fullPath.slice(objectsIndex);
      try {
        const objectFile = await objectStorageService.getObjectEntityFile(correctPath);
        await objectStorageService.downloadObject(objectFile, res);
      } catch (error) {
        console.error("Error serving legacy object:", error);
        if (error instanceof ObjectNotFoundError) {
          return res.status(404).json({ error: "Object not found" });
        }
        return res.status(500).json({ error: "Failed to serve object" });
      }
    } else {
      next();
    }
  });
}
