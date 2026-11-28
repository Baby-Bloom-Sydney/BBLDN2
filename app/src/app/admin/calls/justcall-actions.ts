"use server";

/**
 * /admin/calls JustCall actions (plan 05 §5 B3; brief §0.6, §0.9, §3 admin 6–7). BB-wave2-231126/05-build.
 *
 * 04's contract (`actions.ts:6-17`), for each: `justcallWebhookEnabled()` first (off → `justcall_disabled`, before any
 * read; it needs call booking on too), then `proveAdmin()` (not an admin → `not_authorized`, before any read or client),
 * then zod on the whole input (`invalid`), then one operation in `@/lib/justcall/admin` acting as the proven admin
 * (amendment 20's functions check again under 19's lock), then `/admin/calls` is revalidated after a write that landed.
 * Refusals are closed codes (`JustCallActionError`), never detail; an operation that throws answers `error`.
 *
 * - Save an outcome on a JustCall call (05a-2's Add outcome; 05b's after-call form): `justcall_save_outcome` only (R5);
 *   the call-back time is read as London clock time here, as `recordCallOutcomeAction` does.
 * - Attach an Unmatched call to a family; dismiss one; search families for Attach (a read: nothing revalidated).
 * - 05b: the next family to call (R11; a read). Its switch is the dialer's (`justcallEnabled()`), not logging's.
 * Only these five async functions are exported — every async export of a "use server" file is callable.
 */

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { proveAdmin, type AdminProof } from "@/lib/calls/admin-proof";
import { CLOCK_PATTERN } from "@/lib/calls/calendar";
import { checkOutcome } from "@/lib/calls/outcomes";
import { justcallEnabled, justcallWebhookEnabled } from "@/lib/features/flags";
import { ATTACH_INPUT, DISMISS_INPUT, SAVE_FIELDS, attachCall, dismissCall, saveJustCallOutcome, searchParentsForAttach } from "@/lib/justcall/admin";
import { nextFamilyToCall, type NextToCall } from "@/lib/justcall/next-to-call";
import type { JustCallActionResult, ParentChoice } from "@/lib/justcall/types";
import { localToUTC, wallClockExists } from "@/lib/timezone";

const PAGE = "/admin/calls";

const saveInput = z
  .strictObject({
    ...SAVE_FIELDS,
    note: z
      .string()
      .max(2000)
      .nullable()
      .transform((n) => (n === null || n.trim() === "" ? null : n.trim())),
    callBackDate: z.iso.date().nullable().optional(),
    callBackTime: z.string().regex(CLOCK_PATTERN).nullable().optional(),
  })
  .refine((i) => ((i.callBackDate ?? null) === null) === ((i.callBackTime ?? null) === null))
  .refine((i) => (i.callBackDate ?? null) === null || i.outcome === "call_back_later")
  .refine(checkOutcome);
const searchInput = z.strictObject({ query: z.string().max(100) });
const nextInput = z.strictObject({});

type Gate<T> = { readonly ok: true; readonly proof: AdminProof; readonly input: T } | { readonly ok: false; readonly error: "justcall_disabled" | "not_authorized" | "invalid" };

/** The switch (logging's, unless another is given), then the admin, then the input — each only after the one before. */
async function gate<T>(schema: z.ZodType<T>, input: unknown, switchedOn: () => boolean = justcallWebhookEnabled): Promise<Gate<T>> {
  if (!switchedOn()) return { ok: false, error: "justcall_disabled" };
  const proof = await proveAdmin();
  if (!proof) return { ok: false, error: "not_authorized" };
  const parsed = schema.safeParse(input);
  return parsed.success ? { ok: true, proof, input: parsed.data } : { ok: false, error: "invalid" };
}

/** Run one operation; revalidate after a write that landed; a throw is `error`, logged by name. */
async function run<T>(op: () => Promise<JustCallActionResult<T>>, wrote: boolean): Promise<JustCallActionResult<T>> {
  try {
    const result = await op();
    if (result.ok && wrote) revalidatePath(PAGE);
    return result;
  } catch (thrown) {
    console.error("[admin/calls/justcall] the action failed", { name: thrown instanceof Error ? thrown.name : typeof thrown });
    return { ok: false, error: "error" };
  }
}

/** The call-back typed on the form, read as London clock time; null with none; undefined when it doesn't exist or has passed. */
function callBackAt(date: string | null | undefined, time: string | null | undefined): string | null | undefined {
  if (!date || !time) return null;
  const [hour, minute] = time.split(":").map(Number);
  if (!wallClockExists(date, hour, minute)) return undefined;
  const at = localToUTC(date, hour, minute);
  return Date.parse(at) > Date.now() ? at : undefined;
}

/** BAI's words on a JustCall call: completes the entry with that sid, or creates it (R5). */
export async function saveJustCallOutcomeAction(input: unknown): Promise<JustCallActionResult<{ readonly entryId: string }>> {
  const g = await gate(saveInput, input);
  if (!g.ok) return g;
  const at = callBackAt(g.input.callBackDate, g.input.callBackTime);
  if (at === undefined) return { ok: false, error: "invalid" };
  const { callBackDate: _date, callBackTime: _time, ...rest } = g.input;
  const saved = await run(() => saveJustCallOutcome(g.proof, { ...rest, callBackAt: at }), true);
  return saved.ok ? { ok: true, value: { entryId: saved.value.entryId } } : saved;
}

/** An Unmatched call onto a family (brief §0.9). */
export async function attachJustCallAction(input: unknown): Promise<JustCallActionResult<{ readonly entryCreated: boolean }>> {
  const g = await gate(ATTACH_INPUT, input);
  if (!g.ok) return g;
  return run(() => attachCall(g.proof, g.input), true);
}

/** An Unmatched call off the list. */
export async function dismissJustCallAction(input: unknown): Promise<JustCallActionResult<{ readonly replay: boolean }>> {
  const g = await gate(DISMISS_INPUT, input);
  if (!g.ok) return g;
  return run(() => dismissCall(g.proof, g.input), true);
}

/** Families for Attach: by name or mobile, parents only, the top 10. */
export async function searchFamiliesForCallAction(input: unknown): Promise<JustCallActionResult<readonly ParentChoice[]>> {
  const g = await gate(searchInput, input);
  if (!g.ok) return g;
  return run(() => searchParentsForAttach(g.proof, g.input.query), false);
}

/** Call next (05b, R11): the next family in 04's order who is due a call, with her mobile; null when none is. */
export async function nextFamilyToCallAction(input: unknown): Promise<JustCallActionResult<NextToCall | null>> {
  const g = await gate(nextInput, input, justcallEnabled);
  if (!g.ok) return g;
  return run(() => nextFamilyToCall(g.proof), false);
}
