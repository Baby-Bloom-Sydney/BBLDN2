/**
 * `bsr` module — Katie's full read + write surface over the
 * Babysitting Requests pipeline. Role-aware, translates internal
 * state + timestamps + distances to plain English before Katie
 * speaks.
 *
 * Thin assembly file — the actual logic is split across:
 *
 *   - bsr-shared.ts           — types, helpers, role gate errors
 *   - bsr-reads.ts            — 3 read tools
 *   - bsr-writes-nanny.ts     — 4 nanny writes (request / decline /
 *                               withdraw / nanny_cancel_accepted)
 *   - bsr-writes-parent.ts    — 3 parent writes (accept_nanny /
 *                               decline_nanny / cancel_request)
 *   - bsr-translator.ts       — plain-English mappings
 *
 * Total: 10 tools.
 *
 * Hard rules (from system/APP/BLOOMBOT/modules/bsr/katie-scope.md):
 *   1. Never expose raw `status` values, internal timestamps, or
 *      field names. The translator handles that before Katie sees
 *      output.
 *   2. NEVER volunteer the nanny's phone number to the parent until
 *      parent-accept succeeds. The read tools deliberately don't
 *      return phone; apply_accept_nanny returns it in `data` for the
 *      success message only.
 *   3. nanny_cancel_accepted MUST include the 3-cancellation ban
 *      disclosure in the propose preview, verbatim.
 *   4. request_job is single-turn by design — speed matters for the
 *      nanny; the tool description includes the phone-share
 *      disclosure that Katie surfaces inline.
 */

import type { BloomBotModule } from "./types";
import {
  readTools,
  tryExecuteRead,
  readSystemPromptFragment,
} from "./bsr-reads";
import { nannyWriteTools, tryExecuteNannyWrite } from "./bsr-writes-nanny";
import { parentWriteTools, tryExecuteParentWrite } from "./bsr-writes-parent";
import { bsrTriggers } from "./bsr-triggers";
import { babysittingEnabled } from "@/lib/features/flags";

const personaHeader =
  "For anything about babysitting requests (one-off jobs, BSRs, 'sitters'), call the bsr tools. Hard rules:\n\n" +
  "• NEVER say raw status values ('pending_payment', 'awaiting_parent_choice', 'nanny_cancelled'), internal fields, or timestamps. The tools return pre-rendered strings (`headline`, `expires`, `slots[]`, `distance`, `children`) — surface them directly.\n" +
  "• NEVER say 'bsr_banned_until', '3-strike', etc. If a nanny is banned, the `ban_text` field already reads well.\n" +
  "• NEVER expose a nanny's phone until `apply_accept_nanny` returns it in the success data. The read tools deliberately don't include phone; only the accept success path reveals it to the parent.\n" +
  "• NEVER expose a parent's address.\n" +
  "• Expiry is urgent when `expires_urgent: true`. Flag urgency in the narration ('about 4 hours left — worth responding quickly').\n\n";

const writeSystemPromptFragment =
  "Writes — some single-turn, some two-turn (see per-tool rules):\n\n" +
  "Nanny-side:\n" +
  "• `request_job` — SINGLE-TURN. Speed matters — the parent picks from early requesters. Still always read the phone-share disclosure inline ('your phone will be shared with the family if they accept you'). Pre-checks include ban status + schedule clash.\n" +
  "• `propose_decline_job` / `apply_decline_job` — two-turn, TERMINAL. 'Decline means you can't request this job again later. Confirm?'\n" +
  "• `propose_withdraw_request` / `apply_withdraw_request` — same server action as decline_job; alias for when the nanny's in the Requested bucket instead of Available. Also terminal.\n" +
  "• `propose_nanny_cancel_accepted` / `apply_nanny_cancel_accepted` — MANDATORY two-turn. The preview INCLUDES THE 3-CANCELLATION BAN DISCLOSURE — read that verbatim. If the apply response has `banned: true`, relay the suspension plainly.\n\n" +
  "Parent-side:\n" +
  "• `propose_accept_nanny` / `apply_accept_nanny` — MANDATORY two-turn, phone reveal on success. The preview restates: phone is shared, other applicants auto-released, cancellation later forfeits spot. The apply response includes `nanny_first_name` + `nanny_phone` — surface those in the success narration.\n" +
  "• `decline_nanny` — SINGLE-TURN confirm ('Pass on [FirstName]?'). The nanny gets NO notification.\n" +
  "• `propose_cancel_request` / `apply_cancel_request` — two-turn, terminal for the request.\n\n" +
  "Write tools NOT yet wired here:\n" +
  "• `create_request` (post a new BSR) — multi-step, involves payment. Route to /parent/babysitting.\n" +
  "• `bsr_activate_request` — system-initiated (post-payment), not a user-facing tool.\n" +
  "If asked, tell the user those still live on /parent/babysitting.";

export const bsrModule: BloomBotModule = {
  id: "bsr",
  name: "Babysitting Requests",
  description:
    "Full surface for the babysitting-request pipeline — nanny job invitations, parent requests, nanny request/decline/cancel, parent accept/decline/cancel. All state translated to plain English; phone and address never leak until the appropriate apply returns them.",

  rolesAllowed: ["nanny", "parent"],

  // 5c (P-23): not offered while BABYSITTING_ENABLED is off — the registry drops a module whose `enabled` is false
  // (no tools, no proactive triggers, no prompt fragment). Read at call time.
  get enabled() {
    return babysittingEnabled();
  },

  proactiveTriggers: bsrTriggers,

  tools: [...readTools, ...nannyWriteTools, ...parentWriteTools],

  async execute(toolName, args, ctx) {
    const readResult = await tryExecuteRead(toolName, args, ctx);
    if (readResult !== null) return readResult;
    const nannyResult = await tryExecuteNannyWrite(toolName, args, ctx);
    if (nannyResult !== null) return nannyResult;
    const parentResult = await tryExecuteParentWrite(toolName, args, ctx);
    if (parentResult !== null) return parentResult;
    return { success: false, error: `Unknown tool: ${toolName}` };
  },

  systemPromptFragment:
    personaHeader +
    readSystemPromptFragment +
    "\n\n" +
    writeSystemPromptFragment,
};
