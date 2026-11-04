/**
 * Where she goes after saving her position in the app (brief 04 §0a.3, place 2; 04b rework W8, with W12's
 * destination: the call is a popup inside the app, not a page). Decided on the server, for her own session:
 *
 *   flag off                                → undefined (the flow keeps today's `/parent`)
 *   no hired nanny and no confirmed connection → `/parent?t=childcare&call=open` (the popup over her Childcare tab)
 *   otherwise, or if it couldn't tell          → `/parent` (today's)
 *
 * It never throws (a failure is logged by error name only), so it can never fail the position save.
 * Server-only, not `"use server"`.
 *
 * BB-wave1-041126/04b-rework, 2026-11-05.
 */

import { getConfirmedConnections, getParentPlacement } from "@/lib/actions/position-funnel";
import { callBookingEnabled } from "@/lib/features/flags";
import { callPopupPath, PARENT_HOME } from "./next-path";

export interface AfterPositionDeps {
  /** True with a hired or connected nanny; null when it couldn't tell. */
  readonly hasNanny: (positionId: string) => Promise<boolean | null>;
}

/** Her placement and this position's confirmed connections, read as her (the session's parent). */
async function hasNannyNow(positionId: string): Promise<boolean | null> {
  const [placement, connections] = await Promise.all([getParentPlacement(), getConfirmedConnections(positionId)]);
  if (placement.error !== null || connections.error !== null) return null;
  return placement.data !== null || connections.data.length > 0;
}

const DEFAULT_DEPS: AfterPositionDeps = { hasNanny: hasNannyNow };

export async function redirectAfterPosition(positionId: string, deps: AfterPositionDeps = DEFAULT_DEPS): Promise<string | undefined> {
  if (!callBookingEnabled()) return undefined;
  try {
    return (await deps.hasNanny(positionId)) === false ? callPopupPath("open") : PARENT_HOME;
  } catch (thrown) {
    console.error("[calls/after-position] the nanny check failed", { name: thrown instanceof Error ? thrown.name : typeof thrown });
    return PARENT_HOME;
  }
}
