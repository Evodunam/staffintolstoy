/**
 * Global image compression and upload limits.
 * All image uploads (jpg, png, webp) are run through compression before upload.
 */

/** Max allowed file size for upload: 10 GB */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024 * 1024;

/** MIME types we compress (jpg, png, webp) */
const COMPRESSIBLE_IMAGE_TYPES = [
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
] as const;

function isCompressibleImage(type: string): type is (typeof COMPRESSIBLE_IMAGE_TYPES)[number] {
  return COMPRESSIBLE_IMAGE_TYPES.includes(type as (typeof COMPRESSIBLE_IMAGE_TYPES)[number]);
}

/** Max dimension (width or height) to avoid huge canvases; images are scaled down if larger */
const MAX_DIMENSION = 4096;

/** JPEG/WebP quality (0–1). PNG is lossless so we only resize if needed. */
const DEFAULT_QUALITY = 0.88;

/** Timeout (ms) for image load; fall back to original file if exceeded */
const LOAD_TIMEOUT_MS = 30000;

/** Extension to use per output MIME (for consistent filenames) */
function getExtensionForMime(mime: string, originalName: string): string {
  const fromName = originalName.split(".").pop()?.toLowerCase();
  if (mime === "image/png") return "png";
  if (mime === "image/webp") return "webp";
  return fromName === "jpeg" ? "jpeg" : "jpg";
}

/**
 * Compress an image file (jpeg, png, webp) using canvas.
 * Returns the same file if not a compressible image type or if compression fails.
 */
export async function compressImageIfNeeded(file: File): Promise<File> {
  if (!isCompressibleImage(file.type)) {
    return file;
  }

  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);

    const cleanup = (fallback: File) => {
      URL.revokeObjectURL(url);
      resolve(fallback);
    };

    const timeoutId = setTimeout(() => cleanup(file), LOAD_TIMEOUT_MS);

    img.crossOrigin = "anonymous";

    img.onload = () => {
      clearTimeout(timeoutId);
      URL.revokeObjectURL(url);

      let width = img.naturalWidth;
      let height = img.naturalHeight;

      if (!width || !height) {
        resolve(file);
        return;
      }

      if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
        if (width > height) {
          height = Math.round((height * MAX_DIMENSION) / width);
          width = MAX_DIMENSION;
        } else {
          width = Math.round((width * MAX_DIMENSION) / height);
          height = MAX_DIMENSION;
        }
      }

      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        resolve(file);
        return;
      }

      ctx.drawImage(img, 0, 0, width, height);

      const mime = file.type === "image/png" ? "image/png" : file.type === "image/webp" ? "image/webp" : "image/jpeg";
      const quality = mime === "image/png" ? undefined : DEFAULT_QUALITY;

      canvas.toBlob(
        (blob) => {
          if (!blob) {
            resolve(file);
            return;
          }
          const ext = getExtensionForMime(mime, file.name);
          const baseName = file.name.replace(/\.[^.]+$/i, "");
          const outName = `${baseName}.${ext}`;
          resolve(new File([blob], outName, { type: blob.type, lastModified: Date.now() }));
        },
        mime,
        quality
      );
    };

    img.onerror = () => {
      clearTimeout(timeoutId);
      cleanup(file);
    };

    img.src = url;
  });
}

/**
 * Throws if file size exceeds MAX_UPLOAD_BYTES (10 GB).
 */
export function assertMaxUploadSize(file: File): void {
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new Error(
      `File "${file.name}" exceeds the maximum upload size of 10 GB.`
    );
  }
}
