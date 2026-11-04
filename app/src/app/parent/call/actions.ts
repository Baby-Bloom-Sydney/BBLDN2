"use server";

/**
 * `/parent/call` server actions (brief 04 §3 parent 2–4, 8, §9.15; plan B6 + §12 R9, R23).
 *
 * Contract, for each: `callBookingEnabled()` first (off → `call_booking_disabled`), then zod on every input
 * (`invalid`), then the parent **from the session** (`sessionParentId`; anyone else → `not_a_parent`) — each before
 * anything is read. Only then `parent-booking.ts`, which takes nothing but her session id: no parent, actor,
 * position or purpose ever comes from the browser. Refusals are codes only (`refusalOf`), never detail.
 *
 * `confirmMyCallHold` returns the booking id and whether it was a move or a replay: brief 10 adds its `Schedule`
 * event here, on a first booking only (plan §12 R9). After a booking changes, `/parent` is revalidated so the hub
 * card reads fresh.
 *
 * Only these four async functions are exported — every async export of a "use server" file is callable.
 * BB-wave1-041126/04b-build, 2026-11-04.
 */

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { PARENT_HOME } from "@/lib/calls/next-path";
import { parentCancelBooking, parentConfirmHold, parentHoldSlot } from "@/lib/calls/parent-booking";
import { sessionParentId } from "@/lib/calls/parent-session";
import { loadMyCallView } from "@/lib/calls/parent-state";
import {
  bookedViewOf,
  heldViewOf,
  refusalOf,
  type ConfirmedCallView,
  type HeldCallView,
  type MyCallRefusal,
  type MyCallResult,
  type MyCallView,
} from "@/lib/calls/parent-view";
import { callBookingEnabled } from "@/lib/features/flags";

const startsAtInput = z.iso.datetime({ offset: true });
const bookingIdInput = z.uuid();
const confirmInput = z.strictObject({ holdId: z.uuid(), idempotencyKey: z.string().min(1).max(200) });

type Gate<T> = { readonly ok: true; readonly parentId: string; readonly input: T } | { readonly ok: false; readonly error: MyCallRefusal };

function parsed<T>(schema: z.ZodType<T>, value: unknown): T | null {
  const result = schema.safeParse(value);
  return result.success ? result.data : null;
}

/** The switch, the input, then the session's parent — each only after the one before passed. */
async function gate<T>(input: T | null): Promise<Gate<T>> {
  if (!callBookingEnabled()) return { ok: false, error: "call_booking_disabled" };
  if (input === null) return { ok: false, error: "invalid" };
  const parentId = await sessionParentId();
  return parentId === null ? { ok: false, error: "not_a_parent" } : { ok: true, parentId, input };
}

/** "Choose this time": hold it for her. */
export async function holdMyCallSlot(startsAt: unknown): Promise<MyCallResult<HeldCallView>> {
  const g = await gate(parsed(startsAtInput, startsAt));
  if (!g.ok) return g;
  const held = await parentHoldSlot(g.parentId, g.input);
  return held.ok ? { ok: true, value: heldViewOf(held.value) } : { ok: false, error: refusalOf(held.error) };
}

/** "Confirm this time": her first booking, or her booked call moved there. */
export async function confirmMyCallHold(holdId: unknown, idempotencyKey: unknown): Promise<MyCallResult<ConfirmedCallView>> {
  const g = await gate(parsed(confirmInput, { holdId, idempotencyKey }));
  if (!g.ok) return g;
  const confirmed = await parentConfirmHold(g.parentId, g.input.holdId, g.input.idempotencyKey);
  if (!confirmed.ok) return { ok: false, error: refusalOf(confirmed.error) };
  revalidatePath(PARENT_HOME);
  const c = confirmed.value;
  return {
    ok: true,
    value: {
      bookingId: c.bookingId,
      moved: c.kind === "moved",
      replay: c.kind === "booked" && c.replay,
      booking: bookedViewOf({ id: c.bookingId, startsAt: c.startsAt }, new Date()),
    },
  };
}

/** Cancel her booked call; she is back to picking (and still called). Her fresh view comes back. */
export async function cancelMyCall(bookingId: unknown): Promise<MyCallResult<MyCallView>> {
  const g = await gate(parsed(bookingIdInput, bookingId));
  if (!g.ok) return g;
  const cancelled = await parentCancelBooking(g.parentId, g.input);
  if (!cancelled.ok) return { ok: false, error: refusalOf(cancelled.error) };
  revalidatePath(PARENT_HOME);
  const view = await loadMyCallView(g.parentId);
  return { ok: true, value: view.ok ? view.value : { kind: "load_failed" } };
}

/** Her view again (Retry, after a taken slot, Change time). */
export async function reloadMyCallSlots(): Promise<MyCallResult<MyCallView>> {
  const g = await gate(true);
  if (!g.ok) return g;
  const view = await loadMyCallView(g.parentId);
  return view.ok ? view : { ok: false, error: refusalOf(view.error) };
}
