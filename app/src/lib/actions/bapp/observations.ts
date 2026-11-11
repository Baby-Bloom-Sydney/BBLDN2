"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { revalidatePath } from "next/cache";
import { recalculateProgress, writeHistorySnapshot } from "@/lib/bapp/progress-write";
import { generateTileInsight, getChildContext } from "./insights";
import { MASTERY_LABELS } from "@/lib/bapp-constants";
import type { MasteryScore } from "@/lib/bapp-constants";
import { dispatchActionTriggeredInBackground } from "@/lib/chat/proactive/action-triggered";
import { requireChildFamilyAccess } from "@/lib/payments/access-gate";
import { requireMediaConsentForImageWrite } from "@/lib/legal/require-media-consent";
import { notifyParentOfFeedPost } from "@/lib/email/feed-post-notification";
import { isChildMember, CHILD_NOT_FOUND } from "@/lib/bapp/child-member";

// ---------------------------------------------------------------------------
// Helper: transition child to active_nanny on first action
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// logObservation — General + Focused observations
// ---------------------------------------------------------------------------

export async function logObservation(
  childId: string,
  data: {
    domain: string;
    milestone_id: string | null;
    score: number | null;
    note: string | null;
    image_url: string | null;
    title: string;
  },
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
    // lapsed. Nanny-only children pass through unconditionally.
    const gate = await requireChildFamilyAccess(childId);
    if (!gate.hasAccess) {
      return { success: false, error: "subscription_required" };
    }

    // Media consent gate (T-015) — block image writes when parent
    // hasn't given current consent on this child. Text observations
    // still work; the image_url is what's gated.
    const mediaGate = await requireMediaConsentForImageWrite({
      childId,
      imageUrl: data.image_url,
    });
    if (!mediaGate.ok) {
      return { success: false, error: mediaGate.error };
    }

    const admin = createAdminClient();

    const { data: logRow, error: insertError } = await admin
      .from("bapp_logs")
      .insert({
        child_client_id: childId,
        author_id: user.id,
        type: "observation",
        status: "completed",
        context: "adhoc",
        data: {
          domain: data.domain,
          milestone_id: data.milestone_id,
          score: data.score,
          note: data.note,
          image_url: data.image_url,
          title: data.title,
        },
      })
      .select("id")
      .single();

    if (insertError) {
      console.error("logObservation insert error:", insertError);
      return { success: false, error: insertError.message };
    }

    // If milestone + score provided, recalculate progress
    if (data.milestone_id && data.score) {
      await recalculateProgress(childId, [
        { id: data.milestone_id, score: data.score },
      ]);
      await writeHistorySnapshot(childId, null);
    }

    // Transition child status on first action
    await maybeActivateChild(childId);

    // Generate insight for focused observations (not General)
    if (logRow && data.domain && data.domain !== "General") {
      const childCtx = await getChildContext(childId);
      // Resolve milestone description if available
      let milestoneDescs: string[] = [];
      if (data.milestone_id) {
        const { data: ms } = await admin
          .from("bapp_milestones")
          .select("description")
          .eq("id", data.milestone_id)
          .single();
        if (ms) milestoneDescs = [ms.description];
      }
      const level = data.score
        ? (MASTERY_LABELS[data.score as MasteryScore] ?? null)
        : null;

      await generateTileInsight(logRow.id, childId, {
        ...childCtx,
        entryType: "observation",
        domain: data.domain,
        note: data.note,
        milestoneDescriptions: milestoneDescs,
        masteryLevel: level,
      });
    }

    // Proactive: narrate milestone-scored observations to the nanny's
    // Katie. Only fires when both milestone_id AND score are present —
    // "general" observations are too frequent to narrate each one.
    if (data.milestone_id && data.score) {
      const { data: childRow } = await admin
        .from("child_client")
        .select("first_name")
        .eq("id", childId)
        .maybeSingle();
      const { data: milestoneRow } = await admin
        .from("bapp_milestones")
        .select("description")
        .eq("id", data.milestone_id)
        .maybeSingle();
      dispatchActionTriggeredInBackground({
        triggerId: "observations.milestone_scored",
        recipientUserId: user.id,
        payload: {
          child_name: childRow?.first_name ?? "your child",
          score: data.score,
          milestone_label: milestoneRow?.description ?? "that milestone",
        },
      });
    }

    revalidatePath(`/nanny/development/${childId}`);
    revalidatePath(`/parent/development/${childId}`);

    // Email the linked parent that a new tile landed (non-fatal — internal
    // errors are absorbed, never cause action failure). Skip rules + lookups
    // are inside the helper.
    await notifyParentOfFeedPost({
      childId,
      authorId: user.id,
      logType: "observation",
      logContext: "adhoc",
    });

    return { success: true, error: null };
  } catch (err) {
    console.error("logObservation unexpected error:", err);
    return { success: false, error: "Failed to log observation" };
  }
}

// ---------------------------------------------------------------------------
// logBulkProgress — Progress wizard (bulk milestone updates)
// ---------------------------------------------------------------------------

export async function logBulkProgress(
  childId: string,
  updates: { id: string; score: number }[],
  note: string | null,
  imageUrl: string | null,
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

    // Paywall gate — block writes when the family's subscription has lapsed.
    const gate = await requireChildFamilyAccess(childId);
    if (!gate.hasAccess) {
      return { success: false, error: "subscription_required" };
    }

    // Media consent gate (T-015).
    const mediaGate = await requireMediaConsentForImageWrite({
      childId,
      imageUrl,
    });
    if (!mediaGate.ok) {
      return { success: false, error: mediaGate.error };
    }

    const admin = createAdminClient();

    // Insert progress log
    const { data: logRow, error: insertError } = await admin
      .from("bapp_logs")
      .insert({
        child_client_id: childId,
        author_id: user.id,
        type: "progress",
        status: "completed",
        context: "adhoc",
        data: {
          updates,
          title: "Manual Progress Update",
          image_url: imageUrl,
          note,
        },
      })
      .select("id")
      .single();

    if (insertError) {
      console.error("logBulkProgress insert error:", insertError);
      return { success: false, error: insertError.message };
    }

    // Recalculate progress scores
    await recalculateProgress(childId, updates);

    // Write history snapshot
    await writeHistorySnapshot(childId, logRow?.id ?? null);

    // Transition child status on first action
    await maybeActivateChild(childId);

    // Generate insight for progress update
    if (logRow) {
      const admin2 = createAdminClient();
      const childCtx = await getChildContext(childId);
      // Resolve milestone descriptions for context
      const milestoneIds = updates.map((u) => u.id);
      const { data: milestones } = await admin2
        .from("bapp_milestones")
        .select("description, domain")
        .in("id", milestoneIds);
      const descriptions = milestones?.map((m) => m.description) ?? [];
      const domains = [...new Set(milestones?.map((m) => m.domain) ?? [])].join(
        ", ",
      );

      // Summarise mastery levels for context
      const levels = updates
        .map((u) => MASTERY_LABELS[u.score as MasteryScore])
        .filter(Boolean);
      const levelSummary = [...new Set(levels)].join(", ");

      await generateTileInsight(logRow.id, childId, {
        ...childCtx,
        entryType: "progress",
        domain: domains || null,
        note,
        milestoneDescriptions: descriptions,
        masteryLevel: levelSummary || null,
      });
    }

    revalidatePath(`/nanny/development/${childId}`);
    revalidatePath(`/parent/development/${childId}`);

    // Email the linked parent that a new tile landed (non-fatal — internal
    // errors are absorbed, never cause action failure). Skip rules + lookups
    // are inside the helper.
    await notifyParentOfFeedPost({
      childId,
      authorId: user.id,
      logType: "progress",
      logContext: "adhoc",
    });

    return { success: true, error: null };
  } catch (err) {
    console.error("logBulkProgress unexpected error:", err);
    return { success: false, error: "Failed to log progress" };
  }
}
