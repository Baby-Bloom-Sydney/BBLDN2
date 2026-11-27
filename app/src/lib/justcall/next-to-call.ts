/**
 * Call next (plan 05 §5 PR 05b C6; R11; brief §0.3, §3.5). Server only. BB-wave2-231126/05-build.
 *
 * Walks 04's `getWhoIsNext` in its order — overdue, due now, next booked, not booked, oldest first — and gives the
 * first family that:
 *   - wasn't tried in the last 2 hours (her latest attempt, made here or logged from JustCall);
 *   - isn't waiting for a call-back still to come (04's "call back at");
 *   - has a mobile to dial (a UK mobile, sent as E.164; or a number already in E.164).
 * None left → null ("No one left to call right now."). Test families are walked like any other, as 04 lists them.
 *
 * Checks before any read: the dialer switch (`justcall_disabled`), then the admin proof (`not_authorized`). 04's read
 * failing is `error`, logged by its code.
 */

import { isAdminProof, type AdminProof } from "@/lib/calls/admin-proof";
import { defaultCallsDeps, type CallsDeps } from "@/lib/calls/deps";
import { getWhoIsNext, type WhoIsNextRow } from "@/lib/calls/who-next";
import { justcallEnabled } from "@/lib/features/flags";
import { isUkMobile, normaliseUkMobile } from "@/lib/uk-contact";
import type { JustCallActionResult } from "./types";

/** Tried more recently than this → skipped (default Q5). */
export const RECENT_ATTEMPT_MS = 2 * 60 * 60 * 1000;
const E164 = /^\+[1-9]\d{6,14}$/;

export interface NextToCall {
  readonly parentUserId: string;
  /** E.164, for the dialer. */
  readonly mobile: string;
}

/** Her mobile in E.164, or null when there is nothing to dial. */
function dialable(mobile: string | null): string | null {
  if (mobile === null || mobile.trim() === "") return null;
  if (isUkMobile(mobile)) return normaliseUkMobile(mobile);
  const compact = mobile.replace(/[\s()-]/g, "");
  return E164.test(compact) ? compact : null;
}

function triedRecently(row: WhoIsNextRow, now: Date): boolean {
  return row.lastAttemptAt !== null && now.getTime() - Date.parse(row.lastAttemptAt) < RECENT_ATTEMPT_MS;
}

function waitingForCallBack(row: WhoIsNextRow, now: Date): boolean {
  return row.callBackAt !== null && Date.parse(row.callBackAt) > now.getTime();
}

/** R11 on 04's list: the first family that is due, with a number to dial. */
export function pickNextToCall(rows: readonly WhoIsNextRow[], now: Date): NextToCall | null {
  const due = rows.filter((row) => !triedRecently(row, now) && !waitingForCallBack(row, now));
  for (const row of due) {
    const mobile = dialable(row.contact?.mobile ?? null);
    if (mobile !== null) return { parentUserId: row.parentUserId, mobile };
  }
  return null;
}

export async function nextFamilyToCall(proof: AdminProof, deps: CallsDeps = defaultCallsDeps()): Promise<JustCallActionResult<NextToCall | null>> {
  if (!justcallEnabled()) return { ok: false, error: "justcall_disabled" };
  if (!isAdminProof(proof)) return { ok: false, error: "not_authorized" };
  const order = await getWhoIsNext(proof, deps);
  if (!order.ok) {
    console.error("[justcall/next-to-call] 04's call order couldn't be read", { code: order.error });
    return { ok: false, error: "error" };
  }
  return { ok: true, value: pickNextToCall(order.value, deps.now()) };
}
