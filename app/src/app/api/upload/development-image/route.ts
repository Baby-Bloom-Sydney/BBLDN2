import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { hasParentMediaConsent } from "@/lib/legal/media-consent-gate";
import { isChildMember, CHILD_NOT_FOUND } from "@/lib/bapp/child-member";

const BUCKET = "development-images";

export async function POST(request: NextRequest) {
  try {
    // Auth check
    const supabase = createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const childId = formData.get("childId") as string | null;

    if (!file || !childId) {
      return NextResponse.json(
        { error: "Missing file or childId" },
        { status: 400 },
      );
    }

    if (!file.type.startsWith("image/")) {
      return NextResponse.json(
        { error: "File must be an image" },
        { status: 400 },
      );
    }

    // 10MB limit
    if (file.size > 10 * 1024 * 1024) {
      return NextResponse.json(
        { error: "Image must be under 10MB" },
        { status: 400 },
      );
    }

    // Only the child's parent or nanny.
    if (!(await isChildMember(childId, user.id))) {
      return NextResponse.json({ error: CHILD_NOT_FOUND }, { status: 404 });
    }

    const admin = createAdminClient();

    // Parent-app-consent gate (T-015). Bail BEFORE the storage write
    // so the bucket never holds bytes for a child whose parent hasn't
    // consented. Covers Katie + FAB + any future surface that POSTs
    // here — the upload route is the canonical entry point.
    const mediaGate = await hasParentMediaConsent({ childId }, { admin });
    if (!mediaGate.allowed) {
      return NextResponse.json(
        { error: "media_consent_required", reason: mediaGate.state },
        { status: 403 },
      );
    }
    const ext = file.name.split(".").pop() || "jpg";
    const path = `${childId}/${crypto.randomUUID()}.${ext}`;

    const buffer = Buffer.from(await file.arrayBuffer());

    const { error: uploadError } = await admin.storage
      .from(BUCKET)
      .upload(path, buffer, {
        contentType: file.type,
        cacheControl: "3600",
        upsert: false,
      });

    if (uploadError) {
      console.error("Development image upload error:", uploadError);
      return NextResponse.json({ error: uploadError.message }, { status: 500 });
    }

    const {
      data: { publicUrl },
    } = admin.storage.from(BUCKET).getPublicUrl(path);

    return NextResponse.json({ url: publicUrl });
  } catch (err) {
    console.error("Development image upload unexpected error:", err);
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }
}
