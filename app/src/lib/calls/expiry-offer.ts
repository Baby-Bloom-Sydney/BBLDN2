/**
 * Should the family's connection-expiry email offer her Complimentary matchmaker call? Only when the call page would
 * take her, so the email never links a page that turns her away:
 *
 *   the switch on; the card's rule (`callOffered`: in scope; never after an answered call or Stop calling); no booked
 *   call; and no hired or connected nanny → true
 *   anything else, and any read that fails or throws → false (logged by error name or code only)
 *
 * The nanny facts are `hasNannyNow`'s (`call-allowed.ts`) read with the admin client, since the cron has no session:
 * an active `nanny_placements` row, or one of her `connection_requests` at a booked meet or later that is still going
 * (the filter of `getConfirmedConnections`, across all her rows rather than one position's).
 *
 * Server-only, not `"use server"`: its one caller is the expiry cron, which passes ids from its own rows.
 */

import { callBookingEnabled } from "@/lib/features/flags";
import { CONNECTION_STAGE } from "@/lib/position/constants";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadHubCall, type HubCall } from "./parent-state";

export type AdminReader = ReturnType<typeof createAdminClient>;

export interface ExpiryOfferDeps {
  readonly hub: (parentUserId: string) => Promise<HubCall>;
  readonly admin: () => AdminReader;
}

const DEFAULT_DEPS: ExpiryOfferDeps = { hub: (parentUserId) => loadHubCall(parentUserId), admin: createAdminClient };

/** Stages at or past a booked meet that no longer mean a connected nanny (as `getConfirmedConnections`). */
const NOT_CONNECTED = `(${[
  CONNECTION_STAGE.NOT_HIRED,
  CONNECTION_STAGE.NOT_SELECTED,
  CONNECTION_STAGE.FINISHED,
  CONNECTION_STAGE.ACTIVE,
  CONNECTION_STAGE.CANCELLED_BY_PARENT,
  CONNECTION_STAGE.CANCELLED_BY_NANNY,
].join(",")})`;

const LOG = "[calls/expiry-offer]";
const nameOf = (thrown: unknown): string => (thrown instanceof Error ? thrown.name : typeof thrown);

/** True with a hired or connected nanny; null when a read failed. */
async function hasNannyFor(admin: AdminReader, parentId: string): Promise<boolean | null> {
  const [placements, connections] = await Promise.all([
    admin.from("nanny_placements").select("id").eq("parent_id", parentId).eq("status", "active").limit(1),
    admin
      .from("connection_requests")
      .select("id")
      .eq("parent_id", parentId)
      .gte("connection_stage", CONNECTION_STAGE.INTRO_SCHEDULED)
      .not("connection_stage", "in", NOT_CONNECTED)
      .limit(1),
  ]);
  const failed = placements.error ?? connections.error;
  if (failed !== null) {
    console.error(`${LOG} a nanny read failed`, { code: failed.code ?? null });
    return null;
  }
  return (placements.data?.length ?? 0) > 0 || (connections.data?.length ?? 0) > 0;
}

/** Offered by the card's rule, read cleanly, and no call already booked. */
function offeredAndNotBooked(hub: HubCall): boolean {
  return !hub.failed && hub.offered && hub.card?.kind !== "booked";
}

export async function callOfferForExpiredFamily(
  parentUserId: string,
  parentId: string,
  deps: ExpiryOfferDeps = DEFAULT_DEPS,
): Promise<boolean> {
  if (!callBookingEnabled()) return false;
  try {
    if (!offeredAndNotBooked(await deps.hub(parentUserId))) return false;
    return (await hasNannyFor(deps.admin(), parentId)) === false;
  } catch (thrown) {
    console.error(`${LOG} the call offer check failed`, { name: nameOf(thrown) });
    return false;
  }
}
