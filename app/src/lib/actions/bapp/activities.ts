"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { revalidatePath } from "next/cache";
import { openai } from "@/lib/ai/client";
import {
  ACTIVITY_SYSTEM_PROMPT,
  buildActivityUserPrompt,
} from "@/lib/ai/prompts/bapp-activity-generation";
import type { ActivityPlan } from "@/types/bapp";
import { requireChildFamilyAccess } from "@/lib/payments/access-gate";
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

// ---------------------------------------------------------------------------
// generateActivity
// ---------------------------------------------------------------------------

export async function generateActivity(
  childId: string,
  milestoneIds: string[],
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

    // Paywall gate — block AI generation when the family's subscription has lapsed.
    const gate = await requireChildFamilyAccess(childId);
    if (!gate.hasAccess) {
      return { success: false, error: "subscription_required" };
    }

    const admin = createAdminClient();

    // 1. Get child details
    const { data: child } = await admin
      .from("child_client")
      .select("first_name, date_of_birth")
      .eq("id", childId)
      .single();

    if (!child) {
      return { success: false, error: "Child not found" };
    }

    const childName = child.first_name ?? "Child";
    const ageMonths = child.date_of_birth
      ? Math.floor(
          (Date.now() - new Date(child.date_of_birth).getTime()) /
            (1000 * 60 * 60 * 24 * 30.44),
        )
      : 12;

    // 2. Get milestone details
    const { data: milestones } = await admin
      .from("bapp_milestones")
      .select("id, domain, age_bracket, description")
      .in("id", milestoneIds);

    if (!milestones || milestones.length === 0) {
      return { success: false, error: "No milestones found" };
    }

    const promptContext = milestones.map((m) => ({
      domain: m.domain,
      age: m.age_bracket,
      desc: m.description,
    }));

    // 3. Insert pending log
    const { data: logRow, error: insertError } = await admin
      .from("bapp_logs")
      .insert({
        child_client_id: childId,
        author_id: user.id,
        type: "activity",
        status: "pending",
        context: "adhoc",
        data: {
          milestone_ids: milestoneIds,
          prompt_context: promptContext,
          activity_json: null,
          title: "Generating Plan...",
        },
      })
      .select("id")
      .single();

    if (insertError) {
      console.error("generateActivity insert error:", insertError);
      return { success: false, error: insertError.message };
    }

    const logId = logRow!.id;

    // Activate child on first action
    await maybeActivateChild(childId);

    revalidatePath(`/nanny/development/${childId}`);
    revalidatePath(`/parent/development/${childId}`);

    // 4. Call OpenAI (async — don't block the response). The parent-
    // notification email fires INSIDE callOpenAI's success branch (after
    // the status='ready' update) so the email's CTA always resolves to a
    // fully-rendered tile, not a "Generating Plan..." skeleton. Per T-033
    // KEY decision option A (BAI 2026-05-20).
    callOpenAI(
      logId,
      childId,
      user.id,
      childName,
      ageMonths,
      promptContext,
    ).catch((err) => console.error("OpenAI call failed:", err));

    return { success: true, error: null };
  } catch (err) {
    console.error("generateActivity unexpected error:", err);
    return { success: false, error: "Failed to generate activity" };
  }
}

async function callOpenAI(
  logId: string,
  childId: string,
  authorId: string,
  childName: string,
  ageMonths: number,
  promptContext: { domain: string; age: string; desc: string }[],
): Promise<void> {
  const admin = createAdminClient();

  try {
    const userPrompt = buildActivityUserPrompt(
      childName,
      ageMonths,
      promptContext,
    );

    const response = await openai.chat.completions.create({
      model: "gpt-5.4-nano",
      messages: [
        { role: "system", content: ACTIVITY_SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.7,
      response_format: { type: "json_object" },
    });

    const content = response.choices[0]?.message?.content;
    if (!content) throw new Error("Empty response from OpenAI");

    const activityJson = JSON.parse(content) as ActivityPlan;

    // Read original data to preserve milestone_ids, then update in one shot
    const { data: original } = await admin
      .from("bapp_logs")
      .select("data")
      .eq("id", logId)
      .single();

    const origData = (original?.data as Record<string, unknown>) ?? {};

    await admin
      .from("bapp_logs")
      .update({
        status: "ready",
        data: {
          ...origData,
          activity_json: activityJson,
          title: activityJson.creativeName,
        },
      })
      .eq("id", logId);

    // Email the linked parent NOW that the tile is renderable (non-fatal —
    // helper absorbs its own errors). Per T-033 KEY decision option A
    // (BAI 2026-05-20): notify fires AFTER the status='ready' update so
    // the email's CTA always lands on a fully-rendered activity, not a
    // "Generating Plan..." skeleton. Skipped on OpenAI failure (the catch
    // below) — there's no point summoning a parent to a tile that never
    // resolved.
    await notifyParentOfFeedPost({
      childId,
      authorId,
      logType: "activity",
      logContext: "adhoc",
    });
  } catch (err) {
    console.error("OpenAI activity generation failed:", err);
    // Status stays 'pending' — frontend will keep polling. Email is NOT
    // sent because the parent shouldn't be summoned to a tile that won't
    // render.
  }
}
