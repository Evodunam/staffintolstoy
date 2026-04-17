import { useState, useCallback } from "react";
import type { UppyFile } from "@uppy/core";
import { compressImageIfNeeded, assertMaxUploadSize, MAX_UPLOAD_BYTES } from "@/lib/image-compression";

export type StorageBucket = "avatar" | "bio" | "jobs" | "reviews" | "receipts";

interface UploadMetadata {
  name: string;
  size: number;
  contentType: string;
  bucket?: StorageBucket;
}

interface UploadResponse {
  uploadURL: string;
  objectPath: string;
  metadata: UploadMetadata;
}

interface UseUploadOptions {
  onSuccess?: (response: UploadResponse) => void;
  onError?: (error: Error) => void;
  defaultBucket?: StorageBucket; // Default bucket for uploads
  onboardingUpload?: boolean; // Marks upload intent as onboarding-only (server enforces scope)
}

/**
 * React hook for handling file uploads with presigned URLs.
 *
 * This hook implements the two-step presigned URL upload flow:
 * 1. Request a presigned URL from your backend (sends JSON metadata, NOT the file)
 * 2. Upload the file directly to the presigned URL
 *
 * @example
 * ```tsx
 * function FileUploader() {
 *   const { uploadFile, isUploading, error } = useUpload({
 *     onSuccess: (response) => {
 *       console.log("Uploaded to:", response.objectPath);
 *     },
 *   });
 *
 *   const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
 *     const file = e.target.files?.[0];
 *     if (file) {
 *       await uploadFile(file);
 *     }
 *   };
 *
 *   return (
 *     <div>
 *       <input type="file" onChange={handleFileChange} disabled={isUploading} />
 *       {isUploading && <p>Uploading...</p>}
 *       {error && <p>Error: {error.message}</p>}
 *     </div>
 *   );
 * }
 * ```
 */
export function useUpload(options: UseUploadOptions = {}) {
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [progress, setProgress] = useState(0);

  /**
   * Request a presigned URL from the backend.
   * IMPORTANT: Send JSON metadata, NOT the file itself.
   */
  const requestUploadUrl = useCallback(
    async (file: File, bucket?: StorageBucket): Promise<UploadResponse> => {
      const bucketToUse = bucket || options.defaultBucket || "avatar";
      
      const response = await fetch("/api/uploads/request-url", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: file.name,
          size: file.size,
          contentType: file.type || "application/octet-stream",
          bucket: bucketToUse,
          ...(options.onboardingUpload ? { onboardingUpload: true } : {}),
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        console.error("Upload URL request failed:", {
          status: response.status,
          statusText: response.statusText,
          error: errorData.error,
          details: errorData.details,
        });
        throw new Error(errorData.error || "Failed to get upload URL");
      }

      return response.json();
    },
    [options.defaultBucket]
  );

  /**
   * Upload a file directly to the presigned URL.
   */
  const uploadToPresignedUrl = useCallback(
    async (file: File, uploadURL: string): Promise<void> => {
      const response = await fetch(uploadURL, {
        method: "PUT",
        body: file,
        headers: {
          "Content-Type": file.type || "application/octet-stream",
        },
      });

      if (!response.ok) {
        throw new Error("Failed to upload file to storage");
      }
    },
    []
  );

  const uploadViaDirectFallback = useCallback(
    async (file: File, bucket: StorageBucket): Promise<UploadResponse> => {
      const response = await fetch(
        `/api/uploads/upload-direct?bucket=${encodeURIComponent(bucket)}&onboardingUpload=${options.onboardingUpload ? "true" : "false"}&name=${encodeURIComponent(file.name)}`,
        {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": file.type || "application/octet-stream",
          },
          body: file,
        }
      );

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || "Failed to upload file via fallback");
      }

      const data = await response.json();
      return {
        uploadURL: "",
        objectPath: data.objectPath,
        metadata: data.metadata,
      };
    },
    [options.onboardingUpload]
  );

  /**
   * Upload a file using the presigned URL flow.
   * Images (jpg, png, webp) are compressed before upload. Max upload size is 10 GB.
   *
   * @param file - The file to upload
   * @param bucket - Optional bucket to upload to ("avatar" | "bio" | "jobs" | "reviews")
   * @returns The upload response containing the object path
   */
  const uploadFile = useCallback(
    async (file: File, bucket?: StorageBucket): Promise<UploadResponse | null> => {
      setIsUploading(true);
      setError(null);
      setProgress(0);

      try {
        assertMaxUploadSize(file);

        // Compress images (jpg, png, webp) before upload
        setProgress(5);
        const fileToUpload = await compressImageIfNeeded(file);

        const bucketToUse = bucket || options.defaultBucket || "avatar";

        // Step 1: Request presigned URL (send metadata as JSON)
        setProgress(10);
        const uploadResponse = await requestUploadUrl(fileToUpload, bucketToUse);

        // Step 2: Upload file directly to presigned URL
        setProgress(30);
        let finalResponse = uploadResponse;
        try {
          await uploadToPresignedUrl(fileToUpload, uploadResponse.uploadURL);
        } catch (directUploadError) {
          // Worker/company onboarding uploads can fail on browser-side CORS/privacy blocks.
          // For onboarding flows, fallback to server-side direct upload to keep UX reliable.
          const canFallback =
            options.onboardingUpload === true &&
            (fileToUpload.type || "").startsWith("image/");
          if (!canFallback) {
            throw directUploadError;
          }
          finalResponse = await uploadViaDirectFallback(fileToUpload, bucketToUse);
          if (import.meta.env.DEV) {
            console.warn("Presigned upload failed; using direct upload fallback", directUploadError);
          }
        }

        setProgress(100);
        options.onSuccess?.(finalResponse);
        return finalResponse;
      } catch (err) {
        const error = err instanceof Error ? err : new Error("Upload failed");
        setError(error);
        options.onError?.(error);
        return null;
      } finally {
        setIsUploading(false);
      }
    },
    [requestUploadUrl, uploadToPresignedUrl, uploadViaDirectFallback, options]
  );

  /**
   * Get upload parameters for Uppy's AWS S3 plugin.
   *
   * IMPORTANT: This function receives the UppyFile object from Uppy.
   * Use file.name, file.size, file.type to request per-file presigned URLs.
   *
   * Use this with the ObjectUploader component:
   * ```tsx
   * <ObjectUploader onGetUploadParameters={getUploadParameters}>
   *   Upload
   * </ObjectUploader>
   * ```
   */
  const getUploadParameters = useCallback(
    async (
      file: UppyFile<Record<string, unknown>, Record<string, unknown>>,
      bucket?: StorageBucket
    ): Promise<{
      method: "PUT";
      url: string;
      headers?: Record<string, string>;
    }> => {
      const bucketToUse = bucket || options.defaultBucket || "avatar";
      
      // Use the actual file properties to request a per-file presigned URL
      const response = await fetch("/api/uploads/request-url", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: file.name,
          size: file.size,
          contentType: file.type || "application/octet-stream",
          bucket: bucketToUse,
          ...(options.onboardingUpload ? { onboardingUpload: true } : {}),
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to get upload URL");
      }

      const data = await response.json();
      return {
        method: "PUT",
        url: data.uploadURL,
        headers: { "Content-Type": file.type || "application/octet-stream" },
      };
    },
    [options.defaultBucket]
  );

  return {
    uploadFile,
    getUploadParameters,
    isUploading,
    error,
    progress,
  };
}

