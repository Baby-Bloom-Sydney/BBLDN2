import { createClient } from "@/lib/supabase/client";

export type StorageBucket = "profile-pictures" | "verification-documents" | "share-screenshots";

interface UploadResult {
  url: string | null;
  error: string | null;
}

/**
 * Upload a file to Supabase Storage.
 * For public buckets: returns the permanent public URL.
 * For private buckets: returns the storage path (signed URLs generated on-demand).
 */
export async function uploadFile(
  bucket: StorageBucket,
  userId: string,
  file: File
): Promise<UploadResult> {
  const supabase = createClient();

  const timestamp = Date.now();
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const filePath = `${userId}/${timestamp}-${safeName}`;

  const { error } = await supabase.storage
    .from(bucket)
    .upload(filePath, file, {
      cacheControl: "3600",
      upsert: false,
    });

  if (error) {
    console.error("Storage upload error:", error);
    return { url: null, error: error.message };
  }

  if (bucket === "profile-pictures" || bucket === "share-screenshots") {
    const { data } = supabase.storage.from(bucket).getPublicUrl(filePath);
    return { url: data.publicUrl, error: null };
  }

  // Private buckets: store the path, generate signed URLs on-demand
  return { url: filePath, error: null };
}

/**
 * Upload a file with real-time progress via XHR.
 * Returns the storage file path on success.
 *
 * Accepts an optional AbortSignal to cancel the upload (e.g. on component unmount).
 * Uses a ref-friendly onProgress callback pattern — the caller's latest
 * callback is always invoked, avoiding stale closure issues.
 */
export async function uploadFileWithProgress(
  bucket: StorageBucket,
  userId: string,
  file: File,
  onProgress: (percent: number) => void,
  signal?: AbortSignal,
): Promise<UploadResult> {
  try {
    const supabase = createClient();

    // Force a server round-trip to validate/refresh the auth token.
    const { data: { user }, error: userErr } = await supabase.auth.getUser();
    if (userErr || !user) {
      return { url: null, error: "Not authenticated — please refresh the page and try again" };
    }

    // Now getSession() will have the freshly-refreshed token
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) {
      return { url: null, error: "Session expired — please refresh the page and try again" };
    }

    // Check if already aborted before starting XHR
    if (signal?.aborted) {
      return { url: null, error: "Upload cancelled" };
    }

    const timestamp = Date.now();
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const filePath = `${userId}/${timestamp}-${safeName}`;
    const url = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/${bucket}/${filePath}`;

    return new Promise<UploadResult>((resolve) => {
      const xhr = new XMLHttpRequest();

      // Abort handler — cancel XHR if signal fires
      const handleAbort = () => {
        xhr.abort();
        resolve({ url: null, error: "Upload cancelled" });
      };
      signal?.addEventListener("abort", handleAbort, { once: true });

      xhr.upload.addEventListener("progress", (e) => {
        if (e.lengthComputable) {
          onProgress(Math.round((e.loaded / e.total) * 100));
        }
      });

      xhr.addEventListener("load", () => {
        signal?.removeEventListener("abort", handleAbort);
        if (xhr.status >= 200 && xhr.status < 300) {
          if (bucket === "profile-pictures" || bucket === "share-screenshots") {
            const { data } = supabase.storage.from(bucket).getPublicUrl(filePath);
            resolve({ url: data.publicUrl, error: null });
          } else {
            resolve({ url: filePath, error: null });
          }
        } else if (xhr.status === 401 || xhr.status === 403) {
          resolve({ url: null, error: "Session expired — please refresh the page and try again" });
        } else {
          resolve({ url: null, error: `Upload failed (${xhr.status}) — please try again` });
        }
      });

      xhr.addEventListener("error", () => {
        signal?.removeEventListener("abort", handleAbort);
        resolve({ url: null, error: "Upload failed — check your connection and try again" });
      });

      xhr.addEventListener("timeout", () => {
        signal?.removeEventListener("abort", handleAbort);
        resolve({ url: null, error: "Upload timed out — please try again" });
      });

      xhr.timeout = 60000; // 60s timeout
      xhr.open("POST", url);
      xhr.setRequestHeader("Authorization", `Bearer ${session.access_token}`);
      xhr.setRequestHeader("x-upsert", "true");
      xhr.send(file);
    });
  } catch (err) {
    console.error("Upload error:", err);
    return { url: null, error: "Upload failed unexpectedly — please try again" };
  }
}
