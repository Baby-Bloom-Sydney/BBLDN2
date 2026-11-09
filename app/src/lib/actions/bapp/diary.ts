"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { revalidatePath } from "next/cache";
import { requireChildFamilyAccess } from "@/lib/payments/access-gate";
import { requireMediaConsentForImageWrite } from "@/lib/legal/require-media-consent";
import { notifyParentOfFeedPost } from "@/lib/email/feed-post-notification";
import { isChildMember, CHILD_NOT_FOUND } from "@/lib/bapp/child-member";

/** Transition child to active_nanny on first action */
async function maybeActivateChild(childId: string): Promise<void> {
  const admin = createAdminClient();
  const { data: child } = await admin
    .from("child_client")
    .select("status")
    .eq("id", childId)
    .single();

  if (
    child &&
    (child.status === "setup" || child.status === "created_manual")
  ) {
    await admin
      .from("child_client")
      .update({ status: "active_nanny" })
      .eq("id", childId);

    await admin
      .from("child_client_events")
      .update({ active_nanny_at: new Date().toISOString() })
      .eq("child_client_id", childId);
  }
}

export async function logDiaryEntry(
  childId: string,
  data: Record<string, unknown>,
): Promise<{
  success: boolean;
  error: string | null;
}> {
  try {
    const supabase = createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return { success: false, error: "Not authenticated" };
    }

    // Only the child's parent or nanny.
    if (!(await isChildMember(childId, user.id))) {
      return { success: false, error: CHILD_NOT_FOUND };
    }

    // Paywall gate — block writes when the family's subscription has
    // lapsed. Nanny-only children (no parent connected) pass through
    // unconditionally. See payments §5.
    const gate = await requireChildFamilyAccess(childId);
    if (!gate.hasAccess) {
      return { success: false, error: "subscription_required" };
    }

    // Media consent gate (T-015). `data` is a free-form JSONB bag —
    // pull `image_url` defensively in case the caller didn't include
    // it. Text-only diary entries still work.
    const dataImageUrl = (data as { image_url?: string | null })?.image_url;
    const mediaGate = await requireMediaConsentForImageWrite({
      childId,
      imageUrl: dataImageUrl ?? null,
    });
    if (!mediaGate.ok) {
      return { success: false, error: mediaGate.error };
    }

    const admin = createAdminClient();

    const { error: insertError } = await admin.from("bapp_logs").insert({
      child_client_id: childId,
      author_id: user.id,
      type: "diary",
      status: "completed",
      context: "adhoc",
      data,
    });

    if (insertError) {
      console.error("logDiaryEntry insert error:", insertError);
      return { success: false, error: insertError.message };
    }

    await maybeActivateChild(childId);

    revalidatePath(`/nanny/development/${childId}`);
    revalidatePath(`/parent/development/${childId}`);

    // Email the linked parent that a new tile landed (non-fatal — internal
    // errors are absorbed, never cause action failure). Skip rules + lookups
    // are inside the helper.
    await notifyParentOfFeedPost({
      childId,
      authorId: user.id,
      logType: "diary",
      logContext: "adhoc",
    });

    return { success: true, error: null };
  } catch (err) {
    console.error("logDiaryEntry unexpected error:", err);
    return { success: false, error: "Failed to log diary entry" };
  }
}
