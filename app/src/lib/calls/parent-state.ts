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
import { callViewOf, type MyCallView } from "./parent-view";
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
