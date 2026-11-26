/**
 * Applying one verified JustCall event (plan 05 §5 A8; brief §0.5–§0.7, §0.9; R3, R7, R8).
 *
 *   API re-read (by `call_sid`) → map (R3, R6) → match her number (R7) → `justcall_record_call` (amendment 20)
 *
 * - The event carries only its type and sid: every fact written is the API's answer, so a forged body under a valid
 *   signature writes nothing but what JustCall itself says about that call (brief §8 security, §9.9).
 * - `call.completed` and `call.updated` are applied the same way: the call is re-read each time, so notes or a
 *   disposition added later refresh the same row, and an update that arrives first creates it (brief §3 edges).
 * - Outcomes: `applied`; `ignored` (the API's 404, a type or direction R3 doesn't know, input the database refuses —
 *   retrying can't help); `unresolved` (the API or the database unavailable — kept for the replay, R9). Codes are short
 *   and carry no number.
 *
 * BB-wave2-231126/05-build, 2026-11-26.
 */

import { getCall as getCallFromApi, type GetCallResult } from "./api";
import type { JustCallConfig } from "./config";
import { mapCall } from "./map";
import { matchParent } from "./match";
import { createJustCallRepo, type JustCallRepo } from "./repo";
import { isHandledEventType, type ApplyResult } from "./types";
import { isVerifiedJustCallEvent, type VerifiedJustCallEvent } from "./verified";

export interface ApplyDeps {
  readonly getCall: (callSid: string) => Promise<GetCallResult>;
  readonly repo: Pick<JustCallRepo, "parentsByMobile" | "recordCall">;
}

/** The real dependencies: JustCall's API with the given settings, and the service-role repository (made on first use). */
export function defaultApplyDeps(config: Pick<JustCallConfig, "apiKey" | "apiSecret">, repo: JustCallRepo = createJustCallRepo()): ApplyDeps {
  return { getCall: (callSid) => getCallFromApi(callSid, { fetch: globalThis.fetch, config }), repo };
}

const result = (outcome: ApplyResult["outcome"], code: string | null): ApplyResult => ({ outcome, code });

export async function applyJustCallEvent(event: VerifiedJustCallEvent, deps: ApplyDeps): Promise<ApplyResult> {
  if (!isVerifiedJustCallEvent(event)) return result("ignored", "not_verified");
  if (!isHandledEventType(event.eventType)) return result("ignored", "unhandled_type");

  const call = await deps.getCall(event.callSid);
  if (!call.ok) return call.error === "not_found" ? result("ignored", "api_not_found") : result("unresolved", call.code);

  const mapped = mapCall(call.value);
  if (!mapped.ok) return result("ignored", mapped.code);

  const match = await matchParent(mapped.value.contactNumber, deps.repo.parentsByMobile);
  if (!match.ok) return result("unresolved", "match_read_failed");

  const recorded = await deps.repo.recordCall({
    ...mapped.value,
    parentUserId: match.value.kind === "one" ? match.value.parentUserId : null,
    matchNote: match.value.kind === "one" ? null : match.value.kind,
  });
  if (recorded.ok) return result("applied", null);
  return recorded.error === "invalid" ? result("ignored", "record_invalid") : result("unresolved", "record_failed");
}
