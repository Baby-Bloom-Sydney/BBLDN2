/**
 * Where she goes after saving her position in the app (brief 04 §0a.3, place 2; §0a.6; 04b rework W8, W11, with
 * W12's destinations: in the app the call is a popup over her Childcare tab, not a page). Decided on the server, for
 * her own session:
 *
 *   flag off                                    → undefined (the flow keeps today's `/parent`)
 *   a hired nanny or a confirmed connection,
 *   or it couldn't tell                         → `/parent` (today's)
 *   she picked a time first (`callAt`, W11)     → held then confirmed as her: `…&call=booked`, or `…&call=gone&at=`
 *   otherwise                                   → `/parent?t=childcare&call=open` (the popup, picking)
 *
 * A malformed `callAt` is ignored. Nothing here throws (failures are logged by error name only), so it can never fail
 * the position save. Server-only, not `"use server"`.
 *
 * BB-wave1-041126/04b-rework, 2026-11-05.
 */

import { getConfirmedConnections, getParentPlacement } from "@/lib/actions/position-funnel";
import { callBookingEnabled } from "@/lib/features/flags";
import { callPopupPath, PARENT_HOME, parseCallAt } from "./next-path";
import { parentConfirmHold, parentHoldSlot } from "./parent-booking";
import { sessionParentId } from "./parent-session";

export interface AfterPositionDeps {
  /** True with a hired or connected nanny; null when it couldn't tell. */
  readonly hasNanny: (positionId: string) => Promise<boolean | null>;
  /** Hold then confirm this time as her (the session's parent); true when booked. */
  readonly book: (startsAt: string) => Promise<boolean>;
}

/** Her placement and this position's confirmed connections, read as her (the session's parent). */
async function hasNannyNow(positionId: string): Promise<boolean | null> {
  const [placement, connections] = await Promise.all([getParentPlacement(), getConfirmedConnections(positionId)]);
  if (placement.error !== null || connections.error !== null) return null;
  return placement.data !== null || connections.data.length > 0;
}

/** The existing parent booking path, as her own session: the hold rechecks the time is free; the hold id is the key. */
async function bookAsHer(startsAt: string): Promise<boolean> {
  const parentId = await sessionParentId();
  if (parentId === null) return false;
  const held = await parentHoldSlot(parentId, startsAt);
  if (!held.ok) return false;
  const confirmed = await parentConfirmHold(parentId, held.value.bookingId, held.value.bookingId);
  return confirmed.ok;
}

const DEFAULT_DEPS: AfterPositionDeps = { hasNanny: hasNannyNow, book: bookAsHer };

const nameOf = (thrown: unknown): string => (thrown instanceof Error ? thrown.name : typeof thrown);

async function bookedOrGone(startsAt: string, deps: AfterPositionDeps): Promise<string> {
  try {
    if (await deps.book(startsAt)) return callPopupPath("booked");
  } catch (thrown) {
    console.error("[calls/after-position] the booking failed", { name: nameOf(thrown) });
  }
  return callPopupPath("gone", startsAt);
}

export async function redirectAfterPosition(
  positionId: string,
  deps: AfterPositionDeps = DEFAULT_DEPS,
  callAt?: string,
): Promise<string | undefined> {
  if (!callBookingEnabled()) return undefined;
  let nanny: boolean | null;
  try {
    nanny = await deps.hasNanny(positionId);
  } catch (thrown) {
    console.error("[calls/after-position] the nanny check failed", { name: nameOf(thrown) });
    return PARENT_HOME;
  }
  if (nanny !== false) return PARENT_HOME;
  const picked = parseCallAt(callAt);
  return picked === null ? callPopupPath("open") : bookedOrGone(picked, deps);
}
