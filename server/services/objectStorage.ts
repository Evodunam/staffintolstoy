import { S3Client, GetObjectCommand, HeadObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { Response } from "express";
import { randomUUID } from "crypto";
import {
  ObjectAclPolicy,
  ObjectPermission,
  canAccessObject,
  getObjectAclPolicy,
  setObjectAclPolicy,
} from "./objectAcl";

// S3-compatible storage client for IDrive E2
let s3Client: S3Client | null = null;

function initializeS3Client(): S3Client {
  const baseEndpoint = process.env.IDRIVE_E2_ENDPOINT || "s3.us-midwest-1.idrivee2.com";
  const region = process.env.IDRIVE_E2_REGION || "us-midwest-1";
  const accessKeyId = process.env.IDRIVE_E2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.IDRIVE_E2_SECRET_ACCESS_KEY;

  if (!accessKeyId || !secretAccessKey) {
    throw new Error("IDrive E2 credentials not configured. Please set IDRIVE_E2_ACCESS_KEY_ID and IDRIVE_E2_SECRET_ACCESS_KEY environment variables.");
  }

  // IDrive E2 uses subdomain-based buckets (e.g., avatar.s3.us-midwest-1.idrivee2.com)
  // We'll use a base endpoint and construct bucket-specific endpoints dynamically
  return new S3Client({
    endpoint: `https://${baseEndpoint}`,
    region,
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
    forcePathStyle: false, // Use virtual-hosted style for subdomain buckets
  });
}

// Lazy initialization - reinitialize on each call to ensure we have latest env vars
function getS3Client(): S3Client {
  // Always reinitialize to ensure we have the latest environment variables
  // This is important because env vars might be loaded after module initialization
  try {
    s3Client = initializeS3Client();
    return s3Client;
  } catch (error: any) {
    console.error("Error initializing S3 client:", error);
    throw error;
  }
}

// Export function to get the S3 client (for use in objectAcl.ts)
export { getS3Client };

// Bucket names for different content types
export enum StorageBucket {
  AVATAR = "avatar",
  BIO = "bio",
  JOBS = "jobs",
  REVIEWS = "reviews",
  CHAT_ATTACHMENTS = "chats",
  RECEIPTS = "receipts",
}

// S3 Object wrapper to maintain compatibility with existing code
export class S3Object {
  constructor(
    public bucket: string,
    public key: string,
  ) {}

  get name(): string {
    return this.key;
  }
}

export class ObjectNotFoundError extends Error {
  constructor() {
    super("Object not found");
    this.name = "ObjectNotFoundError";
    Object.setPrototypeOf(this, ObjectNotFoundError.prototype);
  }
}

// The object storage service is used to interact with the object storage service.
export class ObjectStorageService {
  constructor() {}

  // Gets the bucket name for a given storage bucket enum
  getBucketName(bucket: StorageBucket): string {
    return bucket;
  }

  // Determines the appropriate bucket based on the upload context
  // This can be called from the upload route with a bucket parameter
  determineBucket(bucketParam?: string): StorageBucket {
    if (bucketParam) {
      // Validate bucket parameter
      const validBuckets = Object.values(StorageBucket);
      if (validBuckets.includes(bucketParam as StorageBucket)) {
        return bucketParam as StorageBucket;
      }
    }
    // Default to avatar bucket for backward compatibility
    return StorageBucket.AVATAR;
  }

  // Gets the public object search paths.
  getPublicObjectSearchPaths(): Array<string> {
    const pathsStr = process.env.PUBLIC_OBJECT_SEARCH_PATHS || "";
    const paths = Array.from(
      new Set(
        pathsStr
          .split(",")
          .map((path) => path.trim())
          .filter((path) => path.length > 0)
      )
    );
    if (paths.length === 0) {
      throw new Error(
        "PUBLIC_OBJECT_SEARCH_PATHS not set. Set PUBLIC_OBJECT_SEARCH_PATHS env var (comma-separated paths)."
      );
    }
    return paths;
  }

  // Search for a public object from the search paths.
  async searchPublicObject(filePath: string): Promise<S3Object | null> {
    const baseEndpoint = process.env.IDRIVE_E2_ENDPOINT || "s3.us-midwest-1.idrivee2.com";
    const region = process.env.IDRIVE_E2_REGION || "us-midwest-1";
    const accessKeyId = process.env.IDRIVE_E2_ACCESS_KEY_ID!;
    const secretAccessKey = process.env.IDRIVE_E2_SECRET_ACCESS_KEY!;

    for (const searchPath of this.getPublicObjectSearchPaths()) {
      const { bucketName, objectName } = parseObjectPath(searchPath);
      
      // Create bucket-specific client
      const bucketEndpoint = `${bucketName}.${baseEndpoint}`;
      const bucketS3Client = new S3Client({
        endpoint: `https://${bucketEndpoint}`,
        region,
        credentials: { accessKeyId, secretAccessKey },
        forcePathStyle: true, // Use path-style when endpoint already includes bucket subdomain
      });
      
      try {
        const command = new HeadObjectCommand({
          Bucket: bucketName,
          Key: objectName,
        });
        await bucketS3Client.send(command);
        return new S3Object(bucketName, objectName);
      } catch (error: any) {
        if (error.name === "NotFound" || error.$metadata?.httpStatusCode === 404) {
          continue;
        }
        throw error;
      }
    }

    return null;
  }

  // Downloads an object to the response.
  async downloadObject(object: S3Object, res: Response, cacheTtlSec: number = 3600) {
    const baseEndpoint = process.env.IDRIVE_E2_ENDPOINT || "s3.us-midwest-1.idrivee2.com";
    const region = process.env.IDRIVE_E2_REGION || "us-midwest-1";
    const accessKeyId = process.env.IDRIVE_E2_ACCESS_KEY_ID!;
    const secretAccessKey = process.env.IDRIVE_E2_SECRET_ACCESS_KEY!;

    // Use base endpoint + virtual-hosted style (same as upload) so path is /key not /bucket/key.
    const bucketS3Client = new S3Client({
      endpoint: `https://${baseEndpoint}`,
      region,
      credentials: { accessKeyId, secretAccessKey },
      forcePathStyle: false,
    });

    try {
      // Get object metadata
      const headCommand = new HeadObjectCommand({
        Bucket: object.bucket,
        Key: object.key,
      });
      const metadata = await bucketS3Client.send(headCommand);

      // Get the ACL policy for the object.
      const aclPolicy = await getObjectAclPolicy(object);
      const isPublic = aclPolicy?.visibility === "public";

      // Set appropriate headers
      res.set({
        "Content-Type": metadata.ContentType || "application/octet-stream",
        "Content-Length": metadata.ContentLength?.toString() || "0",
        "Cache-Control": `${
          isPublic ? "public" : "private"
        }, max-age=${cacheTtlSec}`,
      });

      // Get the object
      const getCommand = new GetObjectCommand({
        Bucket: object.bucket,
        Key: object.key,
      });
      const response = await bucketS3Client.send(getCommand);

      if (!response.Body) {
        throw new Error("Object body is empty");
      }

      // Stream the file to the response
      const stream = response.Body as any;
      if (stream.on) {
        stream.on("error", (err: any) => {
          console.error("Stream error:", err);
          if (!res.headersSent) {
            res.status(500).json({ error: "Error streaming file" });
          }
        });
        stream.pipe(res);
      } else {
        // If it's a ReadableStream, convert it
        const chunks: Uint8Array[] = [];
        for await (const chunk of stream) {
          chunks.push(chunk);
        }
        const buffer = Buffer.concat(chunks);
        res.send(buffer);
      }
    } catch (error: any) {
      console.error("Error downloading file:", error);
      if (!res.headersSent) {
        if (error.name === "NotFound" || error.$metadata?.httpStatusCode === 404) {
          res.status(404).json({ error: "Object not found" });
        } else {
          res.status(500).json({ error: "Error downloading file" });
        }
      }
    }
  }

  // Gets the upload URL for an object entity.
  async getObjectEntityUploadURL(
    contentType?: string,
    bucket: StorageBucket = StorageBucket.AVATAR
  ): Promise<string> {
    // Check if S3 is properly configured
    if (!process.env.IDRIVE_E2_ACCESS_KEY_ID || !process.env.IDRIVE_E2_SECRET_ACCESS_KEY) {
      throw new Error(
        "IDrive E2 not configured. Please set IDRIVE_E2_ACCESS_KEY_ID and IDRIVE_E2_SECRET_ACCESS_KEY environment variables."
      );
    }

    const objectId = randomUUID();
    const bucketName = this.getBucketName(bucket);
    const objectKey = `uploads/${objectId}`;

    // IDrive E2 uses subdomain-based buckets (e.g., avatar.s3.us-midwest-1.idrivee2.com)
    // Use the base endpoint with virtual-hosted style - SDK will construct the subdomain
    const baseEndpoint = process.env.IDRIVE_E2_ENDPOINT || "s3.us-midwest-1.idrivee2.com";
    const region = process.env.IDRIVE_E2_REGION || "us-midwest-1";
    const accessKeyId = process.env.IDRIVE_E2_ACCESS_KEY_ID!;
    const secretAccessKey = process.env.IDRIVE_E2_SECRET_ACCESS_KEY!;

    // Create a client with the base endpoint - SDK will use virtual-hosted style
    // which constructs URLs like: https://bucket-name.endpoint/key
    const bucketS3Client = new S3Client({
      endpoint: `https://${baseEndpoint}`,
      region,
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
      forcePathStyle: false, // Virtual-hosted style - SDK constructs bucket subdomain
    });

    console.log("Generating presigned URL for upload:", {
      bucketName,
      baseEndpoint,
      objectKey,
      contentType: contentType || "application/octet-stream",
      bucketEnum: bucket,
      expectedUrl: `https://${bucketName}.${baseEndpoint}/${objectKey}`,
    });

    try {
      // Use provided contentType or default to application/octet-stream
      const finalContentType = contentType || "application/octet-stream";

      const command = new PutObjectCommand({
        Bucket: bucketName,
        Key: objectKey,
        ContentType: finalContentType,
      });

      console.log("Creating presigned URL with:", {
        endpoint: baseEndpoint,
        bucket: bucketName,
        key: objectKey,
        contentType: finalContentType,
        expectedUrl: `https://${bucketName}.${baseEndpoint}/${objectKey}`,
      });

      const signedUrl = await getSignedUrl(bucketS3Client, command, {
        expiresIn: 15 * 60, // 15 minutes
      });

      console.log("Presigned URL generated successfully:", {
        urlLength: signedUrl.length,
        urlPrefix: signedUrl.substring(0, 50) + "...",
      });

      return signedUrl;
    } catch (error: any) {
      console.error("S3 getSignedUrl error:", {
        message: error.message,
        code: error.code,
        name: error.name,
        stack: error.stack,
        $metadata: error.$metadata,
        cause: error.cause,
        bucketName,
        objectKey,
      });
      
      // Provide more helpful error messages
      if (error.message?.includes("bucket") || error.message?.includes("Bucket") || error.$metadata?.httpStatusCode === 404) {
        throw new Error(`S3 bucket error: ${error.message || error.code}. Please check that the bucket "${bucketName}" exists.`);
      }
      if (error.message?.includes("credentials") || error.message?.includes("authentication") || error.message?.includes("permission") || error.$metadata?.httpStatusCode === 401 || error.$metadata?.httpStatusCode === 403) {
        throw new Error(`S3 authentication error: ${error.message || error.code}. Please check your IDRIVE_E2_ACCESS_KEY_ID and IDRIVE_E2_SECRET_ACCESS_KEY.`);
      }
      if (error.code || error.$metadata?.httpStatusCode) {
        throw new Error(`S3 error (${error.code || error.$metadata?.httpStatusCode}): ${error.message || 'Unknown error'}. Please check your IDrive E2 configuration.`);
      }
      throw error;
    }
  }

  // Gets the object entity file from the object path.
  async getObjectEntityFile(objectPath: string): Promise<S3Object> {
    if (!process.env.IDRIVE_E2_ACCESS_KEY_ID || !process.env.IDRIVE_E2_SECRET_ACCESS_KEY) {
      throw new Error("IDrive E2 not configured. Please set IDRIVE_E2_ACCESS_KEY_ID and IDRIVE_E2_SECRET_ACCESS_KEY.");
    }
    
    if (!objectPath.startsWith("/objects/")) {
      throw new ObjectNotFoundError();
    }

    const parts = objectPath.slice(1).split("/");
    if (parts.length < 2) {
      throw new ObjectNotFoundError();
    }

    // Extract bucket and key from path
    // Format: /objects/<bucket>/<key>
    const bucketName = parts[1];
    const objectKey = parts.slice(2).join("/");

    // Use same client config as upload: base endpoint + virtual-hosted style.
    // Bucket-in-host endpoint can cause SDK to double bucket in path and 404.
    const baseEndpoint = process.env.IDRIVE_E2_ENDPOINT || "s3.us-midwest-1.idrivee2.com";
    const region = process.env.IDRIVE_E2_REGION || "us-midwest-1";
    const accessKeyId = process.env.IDRIVE_E2_ACCESS_KEY_ID!;
    const secretAccessKey = process.env.IDRIVE_E2_SECRET_ACCESS_KEY!;
    const bucketS3Client = new S3Client({
      endpoint: `https://${baseEndpoint}`,
      region,
      credentials: { accessKeyId, secretAccessKey },
      forcePathStyle: false,
    });

    try {
      const command = new HeadObjectCommand({
        Bucket: bucketName,
        Key: objectKey,
      });
      await bucketS3Client.send(command);
      return new S3Object(bucketName, objectKey);
    } catch (error: any) {
      if (error.name === "NotFound" || error.$metadata?.httpStatusCode === 404) {
        throw new ObjectNotFoundError();
      }
      throw error;
    }
  }

  normalizeObjectEntityPath(rawPath: string): string {
    // Handle S3 presigned URLs
    // IDrive E2 uses virtual-hosted style: https://bucket-name.endpoint/key?signature...
    // Example: https://avatar.s3.us-midwest-1.idrivee2.com/uploads/uuid?signature...
    try {
      const url = new URL(rawPath);
      
      // Check if it's virtual-hosted style (bucket is subdomain)
      const hostname = url.hostname;
      const baseEndpoint = process.env.IDRIVE_E2_ENDPOINT || "s3.us-midwest-1.idrivee2.com";
      
      // Check if hostname starts with a bucket name (e.g., "avatar.s3.us-midwest-1.idrivee2.com")
      if (hostname.includes(`.${baseEndpoint}`)) {
        const bucketName = hostname.split(`.${baseEndpoint}`)[0];
        const objectKey = url.pathname.slice(1); // Remove leading /
        
        if (bucketName && objectKey) {
          return `/objects/${bucketName}/${objectKey}`;
        }
      }
      
      // Fallback: try path-style parsing
      const pathParts = url.pathname.split("/").filter(p => p);
      
      if (pathParts.length >= 2) {
        const bucketName = pathParts[0];
        const objectKey = pathParts.slice(1).join("/");
        
        // Return normalized path: /objects/bucket/key
        return `/objects/${bucketName}/${objectKey}`;
      }
      
      return rawPath;
    } catch {
      // If it's already a normalized path (starts with /objects/), return as-is
      if (rawPath.startsWith("/objects/")) {
        return rawPath;
      }
      // If it's not a URL, return as-is
      return rawPath;
    }
  }

  // Tries to set the ACL policy for the object entity and return the normalized path.
  async trySetObjectEntityAclPolicy(
    rawPath: string,
    aclPolicy: ObjectAclPolicy
  ): Promise<string> {
    const normalizedPath = this.normalizeObjectEntityPath(rawPath);
    if (!normalizedPath.startsWith("/")) {
      return normalizedPath;
    }

    const objectFile = await this.getObjectEntityFile(normalizedPath);
    await setObjectAclPolicy(objectFile, aclPolicy);
    return normalizedPath;
  }

  // Checks if the user can access the object entity.
  async canAccessObjectEntity({
    userId,
    objectFile,
    requestedPermission,
  }: {
    userId?: string;
    objectFile: S3Object;
    requestedPermission?: ObjectPermission;
  }): Promise<boolean> {
    return canAccessObject({
      userId,
      objectFile,
      requestedPermission: requestedPermission ?? ObjectPermission.READ,
    });
  }
}

function parseObjectPath(path: string): {
  bucketName: string;
  objectName: string;
} {
  if (!path.startsWith("/")) {
    path = `/${path}`;
  }
  const pathParts = path.split("/").filter(p => p);
  if (pathParts.length < 1) {
    throw new Error("Invalid path: must contain at least a bucket name");
  }

  const bucketName = pathParts[0];
  const objectName = pathParts.slice(1).join("/");

  return {
    bucketName,
    objectName,
  };
}
