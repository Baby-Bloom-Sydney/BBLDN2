/**
 * Chat message compaction — writes `chat_summaries` rollups so long
 * conversations don't balloon the context window.
 *
 * Daily tier:
 *   - One pass per bot per day.
 *   - Reads all chat_messages in the local-timezone day window.
 *   - Summarises via Gemini Flash (or falls back to a trivial
 *     heuristic when fewer than 4 messages exist — not worth an
 *     LLM round trip).
 *   - Upserts into chat_summaries (UNIQUE on bloombot_id +
 *     child_client_id + period + date_start).
 *
 * Weekly / monthly tiers: same shape, different window + different
 * prompt. Deferred for a follow-up WU.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { generate } from "@/lib/ai/gemini-client";
import { APP_LOCALE } from "@/lib/constants";
import { APP_TZ } from "@/lib/constants";

interface Message {
  role: string;
  content: string;
}

interface DayWindow {
  dateIso: string; // YYYY-MM-DD in target timezone
  startUtc: string;
  endUtc: string;
}

/** Computes [start, end) UTC ISO bounds for the given date in a timezone. */
export function dayWindow(dateIso: string, timezone: string): DayWindow {
  // Start of `dateIso` at 00:00 in `timezone`. Build via Intl to avoid
  // pulling in a date library — find the UTC instant whose local date
  // matches.
  const [y, m, d] = dateIso.split("-").map(Number);
  // Approximate: noon UTC on the same day is safely inside the target
  // timezone's calendar date; then we compute offset from formatter.
  const probe = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  const fmt = new Intl.DateTimeFormat(APP_LOCALE, {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(probe);
  const localHour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const localMin = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  // offset_minutes = (localTime - utcTime). probe is at 12:00 UTC.
  const offsetMinutes = localHour * 60 + localMin - 12 * 60;

  // Local midnight (dateIso 00:00) in UTC = UTC midnight - offset.
  const utcMidnight = Date.UTC(y, m - 1, d, 0, 0, 0);
  const startUtcMs = utcMidnight - offsetMinutes * 60 * 1000;
  const endUtcMs = startUtcMs + 24 * 60 * 60 * 1000;

  return {
    dateIso,
    startUtc: new Date(startUtcMs).toISOString(),
    endUtc: new Date(endUtcMs).toISOString(),
  };
}

export function summariseMessagesFallback(msgs: Message[]): string | null {
  if (msgs.length === 0) return null;
  const firstLines = msgs
    .slice(0, 3)
    .map((m) => `- ${m.role}: ${m.content.split("\n")[0].slice(0, 120)}`)
    .join("\n");
  return `${msgs.length} turns.\n${firstLines}`;
}

async function summariseMessagesAI(msgs: Message[]): Promise<string | null> {
  if (msgs.length < 4) return summariseMessagesFallback(msgs);

  const transcript = msgs
    .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
    .join("\n\n")
    .slice(0, 8000); // cap input size

  const systemPrompt = [
    "You are summarising a single day of chat between the user and Katie (an assistant).",
    "Write 3–6 sentences. Focus on: decisions made, facts surfaced, commitments/reminders set, anything worth recalling tomorrow.",
    "Do NOT restate what Katie *said*. Summarise what HAPPENED and what's now TRUE about the user or their children. Neutral tone.",
  ].join("\n");

  try {
    const resp = await generate({
      model: "gemini-3-flash-preview",
      systemPrompt,
      contents: [{ role: "user", parts: [{ text: transcript }] }],
    });
    const out = (resp.text ?? "").trim();
    return out.length > 0 ? out : summariseMessagesFallback(msgs);
  } catch {
    return summariseMessagesFallback(msgs);
  }
}

interface CompactDayArgs {
  admin: SupabaseClient;
  botId: string;
  dateIso: string; // YYYY-MM-DD in timezone
  timezone?: string;
}

export interface CompactDayResult {
  bot_id: string;
  date_iso: string;
  status: "skipped_no_messages" | "written" | "error";
  message_count?: number;
  summary_id?: string;
  reason?: string;
}

export async function compactDailyForBot(
  args: CompactDayArgs,
): Promise<CompactDayResult> {
  const { admin, botId, dateIso } = args;
  const timezone = args.timezone ?? APP_TZ;
  const { startUtc, endUtc } = dayWindow(dateIso, timezone);

  const { data: msgs, error: readErr } = await admin
    .from("chat_messages")
    .select("role, content")
    .eq("bloombot_id", botId)
    .in("role", ["user", "assistant"])
    .gte("created_at", startUtc)
    .lt("created_at", endUtc)
    .order("created_at", { ascending: true });

  if (readErr) {
    return {
      bot_id: botId,
      date_iso: dateIso,
      status: "error",
      reason: readErr.message,
    };
  }

  const messages = (msgs ?? []) as Message[];
  if (messages.length === 0) {
    return {
      bot_id: botId,
      date_iso: dateIso,
      status: "skipped_no_messages",
      message_count: 0,
    };
  }

  const summary =
    (await summariseMessagesAI(messages)) ??
    summariseMessagesFallback(messages) ??
    "(empty)";

  const { data: inserted, error: writeErr } = await admin
    .from("chat_summaries")
    .upsert(
      {
        bloombot_id: botId,
        child_client_id: null,
        period: "daily",
        date_start: dateIso,
        date_end: dateIso,
        summary,
        message_count: messages.length,
      },
      { onConflict: "bloombot_id,child_client_id,period,date_start" },
    )
    .select("id")
    .single();

  if (writeErr || !inserted) {
    return {
      bot_id: botId,
      date_iso: dateIso,
      status: "error",
      reason: writeErr?.message ?? "upsert returned no row",
    };
  }

  return {
    bot_id: botId,
    date_iso: dateIso,
    status: "written",
    message_count: messages.length,
    summary_id: (inserted as { id: string }).id,
  };
}

/** Runs compactDailyForBot for every active bot. */
export async function compactDailyAllBots(
  admin: SupabaseClient,
  dateIso: string,
): Promise<CompactDayResult[]> {
  const { data: bots } = await admin
    .from("bloombot")
    .select("id, settings")
    .eq("is_active", true);

  const results: CompactDayResult[] = [];
  for (const b of (bots ?? []) as Array<{
    id: string;
    settings: { waking_hours?: { timezone?: string } } | null;
  }>) {
    const tz = b.settings?.waking_hours?.timezone ?? APP_TZ;
    const r = await compactDailyForBot({
      admin,
      botId: b.id,
      dateIso,
      timezone: tz,
    });
    results.push(r);
  }
  return results;
}
