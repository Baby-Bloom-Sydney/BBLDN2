/**
 * Where she goes after saving her position in the app (brief 04 §0a.3, place 2; §0a.6; 04b rework W8, W11, W12; TS
 * review). BAI 2026-11-05: "immediately after creating their position". Decided on the server, for her own session:
 *
 *   flag off                                            → undefined (the flow keeps today's `/parent`)
 *   an edit of her position, with no picked time        → undefined, and nothing is read (an inline edit pays nothing)
 *   not offered (the card's rule: in scope, not after an
 *   answered call or Stop calling), or a hired or
 *   connected nanny — a definite no                     → undefined
 *   couldn't tell (a read failed or threw): no picked
 *   time → undefined; a picked time → `…&call=open&failed=1` (her time isn't silently dropped, W17)
 *   a picked time (`callAt`, W11), held then confirmed as her:
 *     booked                                            → `…&call=booked` ("You're booked"; /parent revalidated)
 *     taken (someone else has it)                       → `…&call=gone&at=` (the taken notice names it)
 *     any other failure                                 → `…&call=open&failed=1` (the picker, with 04b's line)
 *   otherwise (a new position)                          → `/parent?t=childcare&call=open` (the popup, picking)
 *
 * A malformed `callAt` is ignored. Nothing here throws (failures are logged by error name only), so it can never fail
 * the position save. Server-only, not `"use server"`.
 *
 * BB-wave1-041126/04b-rework, 2026-11-05.
 */

import { revalidatePath } from "next/cache";
import { callBookingEnabled } from "@/lib/features/flags";
import { hasNannyNow } from "./call-allowed";
import { callPopupPath, PARENT_HOME, parseCallAt } from "./next-path";
import { parentConfirmHold, parentHoldSlot } from "./parent-booking";
import { sessionParentId } from "./parent-session";
import { loadHubCall } from "./parent-state";

export type BookOutcome = "booked" | "taken" | "failed";

export interface AfterPositionDeps {
  /** Is the call offered to her (the card's rule), as her session? null when it couldn't be read. */
  readonly offered: () => Promise<boolean | null>;
  /** True with a hired or connected nanny; null when it couldn't tell. */
  readonly hasNanny: (positionId: string) => Promise<boolean | null>;
  /** Hold then confirm this time as her (the session's parent). */
  readonly book: (startsAt: string) => Promise<BookOutcome>;
}

export interface AfterPosition {
  /** The save created her position (rather than editing it). */
  readonly created: boolean;
  /** The time she picked on the call slide before she had a position (W11), unchecked. */
  readonly callAt?: string | null;
}

/** Only these say someone else has the time (TS review); a refused "too soon" or a throttle does not. */
const TAKEN: ReadonlySet<string> = new Set(["taken", "overlap"]);

/** The card's rule for her session; null = couldn't tell (no session, or a read failed — W17: not a "no"). */
async function offeredNow(): Promise<boolean | null> {
  const parentId = await sessionParentId();
  if (parentId === null) return null;
  const hub = await loadHubCall(parentId);
  return hub.failed ? null : hub.offered;
}

/** The existing parent booking path, as her own session: the hold rechecks the time is free; the hold id is the key. */
async function bookAsHer(startsAt: string): Promise<BookOutcome> {
  const parentId = await sessionParentId();
  if (parentId === null) return "failed";
  const held = await parentHoldSlot(parentId, startsAt);
  if (!held.ok) return TAKEN.has(held.error) ? "taken" : "failed";
  const confirmed = await parentConfirmHold(parentId, held.value.bookingId, held.value.bookingId);
  if (!confirmed.ok) return TAKEN.has(confirmed.error) ? "taken" : "failed";
  revalidatePath(PARENT_HOME); // as confirmMyCallHold does: her hub card reads fresh (W17)
  return "booked";
}

const DEFAULT_DEPS: AfterPositionDeps = { offered: offeredNow, hasNanny: hasNannyNow, book: bookAsHer };

const nameOf = (thrown: unknown): string => (thrown instanceof Error ? thrown.name : typeof thrown);

async function bookedOrGone(startsAt: string, deps: AfterPositionDeps): Promise<string> {
  let outcome: BookOutcome = "failed";
  try {
    outcome = await deps.book(startsAt);
  } catch (thrown) {
    console.error("[calls/after-position] the booking failed", { name: nameOf(thrown) });
  }
  if (outcome === "booked") return callPopupPath("booked");
  return outcome === "taken" ? callPopupPath("gone", { at: startsAt }) : callPopupPath("open", { failed: true });
}

/** "yes": offered and no hired or connected nanny; "no": a definite no from either; "unknown": couldn't tell (W17). */
type Allowed = "yes" | "no" | "unknown";

async function callAllowed(positionId: string, deps: AfterPositionDeps): Promise<Allowed> {
  try {
    const [offered, nanny] = await Promise.all([deps.offered(), deps.hasNanny(positionId)]);
    if (offered === false || nanny === true) return "no";
    return offered === true && nanny === false ? "yes" : "unknown";
  } catch (thrown) {
    console.error("[calls/after-position] the call check failed", { name: nameOf(thrown) });
    return "unknown";
  }
}

export async function redirectAfterPosition(positionId: string, after: AfterPosition, deps: AfterPositionDeps = DEFAULT_DEPS): Promise<string | undefined> {
  if (!callBookingEnabled()) return undefined;
  const picked = parseCallAt(after.callAt);
  if (!after.created && picked === null) return undefined;
  const allowed = await callAllowed(positionId, deps);
  if (allowed === "no") return undefined;
  // Couldn't tell: a time she picked opens the picker with 04b's line rather than vanishing (W17); else today's.
  if (allowed === "unknown") return picked === null ? undefined : callPopupPath("open", { failed: true });
  return picked === null ? callPopupPath("open") : bookedOrGone(picked, deps);
}
