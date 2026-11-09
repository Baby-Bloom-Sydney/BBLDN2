/** Tile insights and the child context they use. Server-only; not a server action. */
import { createAdminClient } from "@/lib/supabase/admin";
import { openai } from "@/lib/ai/client";

const TILE_INSIGHT_PROMPT = `You are an early childhood development expert. Your job is to look at a simple everyday moment with a child under 3 and reveal the real developmental science behind it — in plain, warm language a parent can understand.

You will receive: child's name, age, developmental domain, specific objective, mastery level, and optionally a carer's note. Use the domain and objective to ground your insight in real developmental knowledge. The parent already knows what happened — your job is to tell them WHY it matters and WHAT it means for their child's brain and growth.

EXACTLY 3 sentences. Each MUST be its own paragraph separated by \\n\\n.

1. **Name the real skill** — Don't repeat the activity. Name what's really happening. e.g. "Obie swapping hands means both sides of his brain are connecting."

2. **Why it matters** — What does this unlock? Be specific. e.g. "That connection later powers writing, catching, and dressing himself."

3. **Where they're headed** — Warm, forward-looking. e.g. "Fine movement independence is really clicking into place."

Rules:
- MAX 12 words per sentence. Ruthlessly short. Cut every unnecessary word.
- Be SPECIFIC and EDUCATIONAL. Every sentence must teach the parent something they didn't know. No filler, no fluff, no empty praise.
- Use simple everyday language but convey real developmental knowledge. Say "both sides of his brain working together" not "bilateral coordination". Say "learning to control small movements" not "fine motor development".
- Never use: discrimination, embodied, auditory, motor, spatial, cognitive, milestone, foundational, sensory, tactile, neural, stimuli, regulation, schema, bilateral, proprioceptive
- Never use "kid" — say "child" or "little one"
- Third person. Never "you" or "your". Never give advice.
- Vary sentence openers. Don't always start with the child's name.

Respond with valid JSON: { "text": "sentence1\\n\\nsentence2\\n\\nsentence3" }`;

/**
 * generateTileInsight — Produce a 1-sentence "dopamine hit" insight
 * to attach to a progress, observation, or report tile.
 *
 * Called automatically after logging. Non-blocking: if it fails,
 * the log is still saved — the insight just won't appear.
 */
export async function generateTileInsight(
  logId: string,
  childId: string,
  context: {
    childName: string | null;
    ageMonths: number | null;
    entryType: "progress" | "observation" | "report";
    domain: string | null;
    note: string | null;
    milestoneDescriptions: string[];
    masteryLevel?: string | null;
  }
): Promise<void> {
  try {
    const name = context.childName ?? "the child";
    const age = context.ageMonths ? `${context.ageMonths} months old` : "";

    const objectives =
      context.milestoneDescriptions.length > 0
        ? `Objective(s): ${context.milestoneDescriptions.join("; ")}`
        : "";

    const userPrompt = `Child: ${name}${age ? `, ${age}` : ""}
${context.domain ? `Domain: ${context.domain}` : ""}
${objectives}
${context.masteryLevel ? `Level achieved: ${context.masteryLevel}` : ""}
${context.note ? `Carer's note: ${context.note}` : "No note provided."}

Write the 3-paragraph insight.`;

    const completion = await openai.chat.completions.create({
      model: "gpt-5.4-nano",
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: TILE_INSIGHT_PROMPT },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.9,
      max_completion_tokens: 150,
    });

    const raw = completion.choices[0]?.message?.content;
    if (!raw) return;

    const parsed = JSON.parse(raw) as { text: string };
    if (!parsed.text) return;

    // Patch the insight into the existing log's data JSONB
    const admin = createAdminClient();
    const { data: logRow } = await admin
      .from("bapp_logs")
      .select("data")
      .eq("id", logId)
      .single();

    if (logRow) {
      const updatedData = {
        ...(logRow.data as Record<string, unknown>),
        insight: parsed.text,
      };
      await admin
        .from("bapp_logs")
        .update({ data: updatedData })
        .eq("id", logId);
    }
  } catch (err) {
    // Non-fatal — the log is already saved, insight is a bonus
    console.error("generateTileInsight error (non-fatal):", err);
  }
}

/**
 * Helper: fetch child name + age for insight context
 */
export async function getChildContext(childId: string): Promise<{
  childName: string | null;
  ageMonths: number | null;
}> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("child_client")
    .select("first_name, date_of_birth")
    .eq("id", childId)
    .single();

  if (!data) return { childName: null, ageMonths: null };

  const ageMonths = data.date_of_birth
    ? Math.floor(
        (Date.now() - new Date(data.date_of_birth).getTime()) /
          (1000 * 60 * 60 * 24 * 30.44)
      )
    : null;

  return { childName: data.first_name, ageMonths };
}
