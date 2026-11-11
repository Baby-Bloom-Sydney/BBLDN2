import { activateDfyPosition } from "@/lib/matching/dfy-dispatch";

/**
 * Fire Advanced-tier matchmaking the instant a parent position exists. Server-only (not a server action).
 *
 * Wraps `activateDfyPosition(positionId, 'priority')` so that the nanny blast
 * + downstream notifications never propagate failure back into the position-
 * creation write path. A failed blast must NOT roll back the position the
 * parent just paid the cost (form completion / payment / etc.) to create.
 *
 * Used by the three position-creation seams documented in
 * `system/matchmaking/AUTOFIRE/planning2building-handoff.md` §1b:
 *   - `signUpAndConvertLead` (advanced funnel)
 *   - `createPosition` (logged-in dashboard create)
 *   - `saveTypeformPosition` (logged-in dashboard typeform create branch only)
 */
export async function autofireMatchmaking(positionId: string): Promise<void> {
  try {
    await activateDfyPosition(positionId, "priority");
  } catch (err) {
    console.error("[autofire] failed for position", positionId, err);
  }
}
