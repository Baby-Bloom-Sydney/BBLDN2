/**
 * Write-tool aggregator for the connections module.
 *
 * The write handlers are split by lifecycle phase to stay under the
 * 800-line-per-file rule:
 *
 *   - connections-writes-pre-meet.ts  — decline, cancel, accept, schedule
 *   - connections-writes-post-meet.ts — report_outcome, confirm_placement,
 *                                       send_connection_request
 *
 * Each sub-file exports its own tool list + `tryExecute*` dispatcher.
 * This file concatenates the tool lists, fans out `tryExecuteWrite`
 * between the two, and exports the write-side system prompt fragment
 * that covers the full matrix.
 */

import type { BloomBotModule, ToolDefinition, ToolResult } from "./types";
import { BRAND } from "@/lib/constants";
import {
  preMeetWriteTools,
  tryExecutePreMeetWrite,
} from "./connections-writes-pre-meet";
import {
  postMeetWriteTools,
  tryExecutePostMeetWrite,
} from "./connections-writes-post-meet";

export const writeTools: ToolDefinition[] = [
  ...preMeetWriteTools,
  ...postMeetWriteTools,
];

export async function tryExecuteWrite(
  toolName: string,
  args: Record<string, unknown>,
  ctx: Parameters<BloomBotModule["execute"]>[2],
): Promise<ToolResult | null> {
  const preMeet = await tryExecutePreMeetWrite(toolName, args, ctx);
  if (preMeet !== null) return preMeet;
  const postMeet = await tryExecutePostMeetWrite(toolName, args, ctx);
  if (postMeet !== null) return postMeet;
  return null;
}

export const writeSystemPromptFragment =
  "Writes — every write is TWO TURNS:\n" +
  "  Turn 1: call `propose_<action>`, read the returned `preview` back to the user VERBATIM (especially the preview line — it's the contract), ask for explicit yes/cancel.\n" +
  "  Turn 2: only if the user says yes, call `apply_<action>` with the SAME args. NEVER call apply_ directly without a matching propose_ in the same conversation.\n" +
  "  If the user says anything other than a clear affirmative (yes, confirm, go ahead, do it, proceed), DO NOT call apply_ — ask once more for a clear yes/cancel.\n" +
  "  If a write returns an error, surface the error text verbatim (server messages are already user-safe) and do not silently retry.\n\n" +
  "Available writes:\n" +
  "• `propose_decline_connection` / `apply_decline_connection` — nanny-only; only while pending. Sends INT-004 (neutral, no reason shared).\n" +
  "• `propose_cancel_connection` / `apply_cancel_connection` — either side; any active connection. Inbox notification only.\n" +
  "• `propose_accept_connection` / `apply_accept_connection` — nanny-only; only while pending. Needs ≥5 slots in `YYYY-MM-DD_bracket` form spanning ≥3 days and all 4 brackets (morning/midday/afternoon/evening). The preview groups slots by day — read that back so the user can double-check. Sends the INT-002 acceptance email.\n" +
  `• \`propose_schedule_meet\` / \`apply_schedule_meet\` — parent-only; connection must be at ACCEPTED. date is ${BRAND.city}-local YYYY-MM-DD; hour 0-23, minute 0-59. The chosen date+bracket must match one of the nanny's proposed brackets. Scheduling SHARES the nanny's phone with the parent — always say that in the preview. Sends INT-002/INT-003.\n` +
  "• `propose_report_outcome` / `apply_report_outcome` — either side; post-meet stages. Nanny outcomes: hired|not_hired|awaiting|trial|incomplete. Parent outcomes: hired|not_hired|awaiting|trial. For `hired` and `trial`, pass an optional `date` (YYYY-MM-DD). `hired` triggers the hire flow; read back the consequence ('family will be asked to confirm, your other candidates will be released') in the preview.\n" +
  "• `propose_confirm_placement` / `apply_confirm_placement` — connection must be OFFERED. If the nanny initiated (Path A), only parent can confirm. If the parent initiated (Path B), only nanny can confirm. MANDATORY explicit restate of consequences (placement created, PDFs sent, other candidates released) — never skip.\n" +
  "• `propose_send_connection_request` / `apply_send_connection_request` — parent-only. Needs the nanny_id (the nanny's nannies.id, not their user id — users pick this up from a profile page). Pre-checks the 5-pending cap + duplicate. Message is optional, ≤ 1000 chars. Sends INT-001.\n\n" +
  "If a user asks for any write not listed here (end a position, update placement rate/hours, reject hired claim, schedule a trial from the parent side, confirm a trial, dismiss a stale tile, etc.), tell them that flow still lives on the main inbox / My Positions surface and offer to open the tile.\n" +
  "All propose_ steps enforce role + stage gates with user-safe errors. If the user asks for something the stage doesn't allow, surface the error and explain what they can do instead — don't retry or silently switch to a different action.";
