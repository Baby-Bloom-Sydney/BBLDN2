/**
 * POST /api/chat/upload — multipart image upload for Katie's input.
 *
 * Returns a public URL the chat client can append to the next user
 * message as `[Image attached: <url>]`. Katie reads that marker as
 * text context (NOT multimodal input), deduces what kind of tile
 * the user wants from the conversation, and calls the appropriate
 * tool (`log_observation`, `log_food`, `log_sleep`, `create_tile`,
 * etc.) passing the URL as `image_url`.
 *
 * Reuses the existing `development-images` Storage bucket — same one
 * `app/api/upload/development-image/route.ts` writes child-keyed entries
 * to. Chat uploads share the bucket because:
 *   - same image lifecycle (public-read URLs embedded in tiles)
 *   - same operational surface (one bucket to monitor, back up, GC)
 *   - many chat uploads end up persisted by Katie's tools
 *     (log_observation / log_food / etc.) which reference these
 *     public URLs anyway, so a separate bucket would just split
 *     the same dataset across two locations
 *
 * Path layout (distinct prefix from child-keyed uploads):
 *   development-images/chat/{user_id}/{uuid}.{ext}
 *
 * Validation:
 *   - image content-types only (jpeg/png/webp/gif/heic)
 *   - max 10 MB (chat is for snapshots, not raw camera dumps)
 */

import { NextResponse } from "next/server";
import sharp from "sharp";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { KATIE_ENABLED } from "@/lib/chat/flags";

export const runtime = "nodejs";

/**
 * Strips EXIF / IPTC / XMP / GPS metadata from an uploaded image (WU 11.4).
 *
 * Privacy guarantee: phone photos commonly carry GPS coordinates of where
 * the photo was taken, plus camera serial, timestamps, and other
 * identifiers. Tiles backed by these images render a public Storage URL
 * that the child's whole shared circle can see — and a future leak of
 * any one image leaks all of that bundled metadata. Sharp's default
 * encode behaviour is to DROP every metadata block unless `.withMetadata`
 * is called, so a `rotate().toBuffer()` round-trip is a clean strip.
 *
 * `.rotate()` with no args reads the EXIF orientation FIRST and applies
 * it before the strip — without it, portrait shots from many phones
 * encode the pixel data sideways and rely on EXIF to display upright.
 *
 * HEIC/HEIF: sharp's HEIC support depends on the libvips build. We
 * convert HEIC to JPEG unconditionally so the output is portable AND
 * stripped. If sharp can't decode the input at all (corrupt file,
 * unsupported variant), we fail-closed — better to reject the upload
 * than to ship an image with unknown metadata to a public bucket.
 */
async function stripMetadata(
  buffer: Buffer,
  contentType: string,
): Promise<{
  buffer: Buffer;
  contentType: string;
  ext: string;
}> {
  if (contentType === "image/heic" || contentType === "image/heif") {
    const out = await sharp(buffer).rotate().jpeg({ quality: 90 }).toBuffer();
    return { buffer: out, contentType: "image/jpeg", ext: "jpg" };
  }
  // Non-HEIC: preserve format. sharp picks the encoder from the input
  // unless we explicitly chain a format conversion.
  const out = await sharp(buffer).rotate().toBuffer();
  const ext = (() => {
    switch (contentType) {
      case "image/jpeg":
        return "jpg";
      case "image/png":
        return "png";
      case "image/webp":
        return "webp";
      case "image/gif":
        return "gif";
      default:
        return "bin";
    }
  })();
  return { buffer: out, contentType, ext };
}

// Route segment config — informs Vercel of the expected request body
// size. Without this, the platform applies its default cap (4.5 MB
// on the serverless tier) which would reject 10 MB uploads at the
// edge before our handler runs. We intentionally validate again
// inside the handler in case the platform raises the cap; this is
// belt-and-braces.
export const maxDuration = 30;

const ALLOWED_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/heic",
  "image/heif",
]);

const ALLOWED_EXTS = new Set([
  "jpg",
  "jpeg",
  "png",
  "webp",
  "gif",
  "heic",
  "heif",
]);

const MAX_BYTES = 10 * 1024 * 1024;

const BUCKET = "development-images";
const PATH_PREFIX = "chat";

function deriveExt(file: File): string {
  // Prefer the MIME type → ext mapping; fall back to the filename
  // suffix if the type is generic. Cap to a known whitelist so a
  // user-supplied filename can't smuggle a path-traversal segment
  // into the storage key.
  const fromType = (() => {
    switch (file.type) {
      case "image/jpeg":
        return "jpg";
      case "image/png":
        return "png";
      case "image/webp":
        return "webp";
      case "image/gif":
        return "gif";
      case "image/heic":
        return "heic";
      case "image/heif":
        return "heif";
      default:
        return null;
    }
  })();
  if (fromType) return fromType;
  const tail = file.name.split(".").pop()?.toLowerCase() ?? "";
  return ALLOWED_EXTS.has(tail) ? tail : "bin";
}

export async function POST(request: Request) {
  if (!KATIE_ENABLED) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  // Auth
  const supabase = createClient();
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError) {
    console.error("[chat/upload] auth.getUser error:", authError);
    return NextResponse.json(
      { error: "Auth lookup failed — please try again." },
      { status: 500 },
    );
  }
  if (!authData.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const userId = authData.user.id;

  // Role gate. KATIE_ENABLED is a global feature flag — it doesn't
  // tell us whether THIS user has any business uploading. Require a
  // recognised app role so a stale signed-in session for a deleted
  // / non-app user can't write into our bucket.
  const admin = createAdminClient();
  const { data: roleRow, error: roleErr } = await admin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .maybeSingle();
  if (roleErr) {
    console.error("[chat/upload] user_roles lookup error:", roleErr);
    return NextResponse.json(
      { error: "Role lookup failed — please try again." },
      { status: 500 },
    );
  }
  const role = (roleRow as { role?: string } | null)?.role;
  if (role !== "nanny" && role !== "parent" && role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  // Parse multipart
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json(
      { error: "Could not read upload — try again." },
      { status: 400 },
    );
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json(
      { error: "Missing `file` field." },
      { status: 400 },
    );
  }

  // Validate type + size BEFORE buffering
  if (!ALLOWED_TYPES.has(file.type)) {
    return NextResponse.json(
      { error: `Unsupported image type (${file.type || "unknown"}).` },
      { status: 415 },
    );
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      {
        error: `Image is too large (max ${Math.floor(MAX_BYTES / 1024 / 1024)} MB).`,
      },
      { status: 413 },
    );
  }
  if (file.size === 0) {
    return NextResponse.json(
      { error: "Image file is empty." },
      { status: 400 },
    );
  }

  // WU 11.4 — strip EXIF/GPS BEFORE upload. Fail-closed on decode
  // errors: an image we can't process is one we can't be sure is
  // metadata-free, and the bucket is publicly-readable so a leak of
  // raw GPS coords to anyone with the URL is a real privacy harm.
  const inputBuffer = Buffer.from(await file.arrayBuffer());
  let stripped: { buffer: Buffer; contentType: string; ext: string };
  try {
    stripped = await stripMetadata(inputBuffer, file.type);
  } catch (err) {
    console.error("[chat/upload] EXIF strip failed:", err);
    return NextResponse.json(
      {
        error:
          "Couldn't process that image — try a different photo, or convert to JPEG and re-upload.",
      },
      { status: 422 },
    );
  }

  // Use the post-strip extension/content-type. For HEIC inputs the
  // strip path converts to JPEG, so the storage object lands as
  // .jpg. Fall back to the filename-derived ext only if the strip
  // returned "bin" (shouldn't happen with the allowlist gate above
  // but kept as belt-and-braces).
  const ext = stripped.ext === "bin" ? deriveExt(file) : stripped.ext;
  const path = `${PATH_PREFIX}/${userId}/${crypto.randomUUID()}.${ext}`;

  // Admin client for the upload — same pattern as the existing
  // development-image upload route. Bucket is publicly readable; RLS on
  // writes is bypassed by the service role.
  const { error: uploadError } = await admin.storage
    .from(BUCKET)
    .upload(path, new Uint8Array(stripped.buffer), {
      contentType: stripped.contentType,
      upsert: false,
    });
  if (uploadError) {
    console.error("[chat/upload] storage.upload error:", uploadError);
    return NextResponse.json(
      { error: "Upload failed — try again." },
      { status: 500 },
    );
  }

  const {
    data: { publicUrl },
  } = admin.storage.from(BUCKET).getPublicUrl(path);

  return NextResponse.json({
    url: publicUrl,
    path,
    size: stripped.buffer.length,
    type: stripped.contentType,
  });
}
