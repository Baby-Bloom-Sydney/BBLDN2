/**
 * May she hold or confirm a call time right now? (04b rework W17, final review item 12.) The hold and confirm
 * actions ask this after their own gate (switch, input, session), so a parent the app wouldn't offer the call to can't
 * book one by calling the action directly:
 *
 *   the card's rule (`callOffered`: in scope; not after an answered call or Stop calling) — or a booked call still
 *   ahead, which the card shows offered or not (she is changing her time) — and no hired or connected nanny (the
 *   page's rule for the card, W9) → "yes"
 *   a definite no from either → "no";  a read that failed or threw → "unknown" (refused with the generic code)
 *
 * Server-only, not `"use server"`: it takes the session's parent id, which its caller has already proved.
 *
 * BB-wave1-041126/04b-rework, 2026-11-05.
 */

import { getConfirmedConnections, getParentPlacement } from "@/lib/actions/position-funnel";
import { defaultCallsDeps } from "./deps";
import { loadHubCall, type HubCall } from "./parent-state";

export type CallAllowed = "yes" | "no" | "unknown";

export interface MayBookDeps {
  readonly hub: (parentId: string) => Promise<HubCall>;
  /** Her latest position's id; null with none; undefined when it couldn't be read. */
  readonly latestPosition: (parentId: string) => Promise<string | null | undefined>;
  /** True with a hired or connected nanny; null when it couldn't tell. */
  readonly hasNanny: (positionId: string | null) => Promise<boolean | null>;
}

/** Her placement and (with a position) its confirmed connections, read as her (the session's parent). */
export async function hasNannyNow(positionId: string | null): Promise<boolean | null> {
  const [placement, connections] = await Promise.all([
    getParentPlacement(),
    positionId === null ? Promise.resolve({ data: [], error: null }) : getConfirmedConnections(positionId),
  ]);
  if (placement.error !== null || connections.error !== null) return null;
  return placement.data !== null || connections.data.length > 0;
}

async function latestPositionOf(parentId: string): Promise<string | null | undefined> {
  const latest = await defaultCallsDeps().repo.readLatestPositionId(parentId);
  return latest.ok ? latest.value : undefined;
}

const DEFAULT_DEPS: MayBookDeps = { hub: loadHubCall, latestPosition: latestPositionOf, hasNanny: hasNannyNow };

/** Offered, or changing a booked call still ahead; null when the hub couldn't be read. */
function offeredOrChanging(hub: HubCall): boolean | null {
  if (hub.failed) return null;
  return hub.offered || (hub.card?.kind === "booked" && hub.card.changeable);
}

const nameOf = (thrown: unknown): string => (thrown instanceof Error ? thrown.name : typeof thrown);

export async function mayBookNow(parentId: string, deps: MayBookDeps = DEFAULT_DEPS): Promise<CallAllowed> {
  try {
    const [hub, position] = await Promise.all([deps.hub(parentId), deps.latestPosition(parentId)]);
    const nanny = position === undefined ? null : await deps.hasNanny(position);
    const offered = offeredOrChanging(hub);
    if (offered === false || nanny === true) return "no";
    return offered === true && nanny === false ? "yes" : "unknown";
  } catch (thrown) {
    console.error("[calls/call-allowed] the call check failed", { name: nameOf(thrown) });
    return "unknown";
  }
}
