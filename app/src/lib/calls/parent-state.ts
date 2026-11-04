/**
 * The loaders behind her call page and her hub card (plan B6, B7). Server-only, not `"use server"`
 * (`src/lib/invite/mint.ts:1-9`): each takes the session's user id, which its caller has already proved, and reads
 * her rows only. The switch first: off → `call_booking_disabled`, before any read. What to show is decided in
 * `parent-view.ts`.
 *
 * BB-wave1-041126/04b-build, 2026-11-04.
 */

import { callBookingEnabled } from "@/lib/features/flags";
import { CALL_BOOKING_DISABLED, CALLS_INVALID, defaultCallsDeps, type CallsDeps } from "./deps";
import { parentFreeSlots } from "./parent-booking";
import { callViewOf, hubCardFor, type HubCallCard, type MyCallView } from "./parent-view";
import type { CallsResult } from "./types";
import { uuid } from "./zod-parts";

/** Her call page: her bookings and attempts, and the free first-call times, read together. */
export async function loadMyCallView(sessionUserId: string, deps: CallsDeps = defaultCallsDeps()): Promise<CallsResult<MyCallView>> {
  if (!callBookingEnabled()) return CALL_BOOKING_DISABLED;
  if (!uuid.safeParse(sessionUserId).success) return CALLS_INVALID;
  const [bookings, entries, slots] = await Promise.all([
    deps.repo.readBookingsForParents([sessionUserId]),
    deps.repo.readLogEntriesForParents([sessionUserId]),
    parentFreeSlots(sessionUserId, deps),
  ]);
  return { ok: true, value: callViewOf({ bookings, entries, slots, now: deps.now() }) };
}

/**
 * Her hub card (plan B7), or null — with the switch off (before any read), for an id that isn't one, and when a read
 * fails (logged; no card is better than a wrong one). Called by `/parent` only while the switch is on.
 */
export async function loadHubCallCard(sessionUserId: string, deps: CallsDeps = defaultCallsDeps()): Promise<HubCallCard | null> {
  if (!callBookingEnabled()) return null;
  if (!uuid.safeParse(sessionUserId).success) return null;
  const [settings, parent, bookings, entries] = await Promise.all([
    deps.repo.readSettings(),
    deps.repo.readScopeParent(sessionUserId),
    deps.repo.readBookingsForParents([sessionUserId]),
    deps.repo.readLogEntriesForParents([sessionUserId]),
  ]);
  if (!settings.ok || !parent.ok || !bookings.ok || !entries.ok) {
    console.error("[calls/parent-state] the hub card could not be read");
    return null;
  }
  return hubCardFor({
    bookings: bookings.value,
    entries: entries.value,
    parent: parent.value,
    enabledSince: settings.value.enabledSince,
    now: deps.now(),
  });
}
