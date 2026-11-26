/**
 * 05a-2's admin operations (plan 05 §5 B2; brief §0.5–§0.9, §3 admin 6–7; R5, R7). Server-only, not `"use server"`:
 * the actions (`justcall-actions.ts`) and the page call these with the `AdminProof` they made.
 *
 * Each checks, before any read: the logging switch (`justcallWebhookEnabled()`, which needs call booking too) →
 * `justcall_disabled`; then the proof → `not_authorized`; then its input → `invalid`. Refusals are closed codes
 * (`JustCallActionError`); nothing is thrown.
 *
 * - `listUnmatched`: the newest 100 Unmatched calls in words, with the full count.
 * - `detailsForCalls` / `justcallAttemptsFor`: the details 04's readers turn into 05's words. `justcallAttemptsFor`
 *   never fails a page: a read that fails (or throws) gives no words, so 04's own stand.
 * - `attachCall`, `dismissCall`: amendment 20's functions, as the proven admin.
 * - `saveJustCallOutcome`: BAI's words on a JustCall call, through `justcall_save_outcome` only (R5; 05a-1 §5) — never
 *   04's writer with a JustCall id. 04's outcome rules are checked here too.
 * - `searchParentsForAttach`: a mobile (any form `normaliseUkMobile` reads) or a name (letters, spaces, hyphens,
 *   apostrophes; 2–100 characters); parents only; the top 10 by name.
 *
 * BB-wave2-231126/05-build, 2026-11-26.
 */

import { z } from "zod";
import { isAdminProof, type AdminProof } from "@/lib/calls/admin-proof";
import { CALL_OUTCOMES, CALL_RESULTS, checkOutcome } from "@/lib/calls/outcomes";
import type { CallLogEntry, CallOutcomeCode, CallResultCode } from "@/lib/calls/types";
import { justcallWebhookEnabled } from "@/lib/features/flags";
import { formatUkMobile, isUkMobile, normaliseUkMobile } from "@/lib/uk-contact";
import { createJustCallAdminRepo, type JustCallAdminRepo, type ParentQuery } from "./admin-repo";
import { createJustCallRepo, type JustCallRepo } from "./repo";
import {
  CALL_SID_PATTERN,
  type JustCallActionError,
  type JustCallActionResult,
  type JustCallAttempt,
  type JustCallDetails,
  type ParentChoice,
  type UnmatchedList,
} from "./types";
import { justcallAttempt, unmatchedView } from "./words";

export const UNMATCHED_LIMIT = 100;
export const SEARCH_LIMIT = 10;

export interface AdminDeps {
  readonly adminRepo: JustCallAdminRepo;
  readonly repo: Pick<JustCallRepo, "attachCall" | "dismissCall" | "saveOutcome">;
}

export function defaultAdminDeps(): AdminDeps {
  return { adminRepo: createJustCallAdminRepo(), repo: createJustCallRepo() };
}

/** What BAI saves on a JustCall call; `callBackAt` is an instant (the action reads his London clock). */
export interface JustCallSaveInput {
  readonly parentUserId: string;
  readonly bookingId: string | null;
  readonly callSid: string;
  readonly result: CallResultCode | null;
  readonly outcome: CallOutcomeCode | null;
  readonly note: string | null;
  readonly callBackAt: string | null;
}

const sid = z.string().regex(CALL_SID_PATTERN);
/** The inputs `justcall-actions.ts` parses too (one definition; the reviews' shared-schema point). */
export const ATTACH_INPUT = z.strictObject({ callSid: sid, parentUserId: z.uuid() });
export const DISMISS_INPUT = z.strictObject({ callSid: sid });
/** A save's fields both sides share; the action adds the typed call-back date and time and trims the note. */
export const SAVE_FIELDS = {
  parentUserId: z.uuid(),
  bookingId: z.uuid().nullable(),
  callSid: sid,
  result: z.enum(CALL_RESULTS).nullable(),
  outcome: z.enum(CALL_OUTCOMES).nullable(),
} as const;
const saveInput = z
  .strictObject({
    ...SAVE_FIELDS,
    note: z.string().max(2000).nullable(),
    callBackAt: z.iso.datetime({ offset: true }).nullable(),
  })
  .refine(checkOutcome)
  .refine((i) => i.callBackAt === null || i.outcome === "call_back_later");
/** A name: letters (any script), spaces, hyphens, apostrophes — nothing PostgREST's filter syntax could read. */
const NAME = /^[\p{L}][\p{L}' -]*$/u;

type Refusal = { readonly ok: false; readonly error: JustCallActionError };
const refused = (error: JustCallActionError): Refusal => ({ ok: false, error });
const INVALID = refused("invalid");

/** The switch, then the proof; null when both pass. */
function gate(proof: AdminProof): Refusal | null {
  if (!justcallWebhookEnabled()) return refused("justcall_disabled");
  return isAdminProof(proof) ? null : refused("not_authorized");
}

export async function listUnmatched(proof: AdminProof, deps: AdminDeps = defaultAdminDeps()): Promise<JustCallActionResult<UnmatchedList>> {
  const shut = gate(proof);
  if (shut) return shut;
  const read = await deps.adminRepo.readUnmatched(UNMATCHED_LIMIT);
  if (!read.ok) return refused("error");
  return { ok: true, value: { calls: read.value.calls.map(unmatchedView), total: read.value.total } };
}

export async function detailsForCalls(
  proof: AdminProof,
  sids: readonly string[],
  deps: AdminDeps = defaultAdminDeps(),
): Promise<JustCallActionResult<ReadonlyMap<string, JustCallDetails>>> {
  const shut = gate(proof);
  if (shut) return shut;
  const wanted = [...new Set(sids.filter((s) => CALL_SID_PATTERN.test(s)))];
  if (wanted.length === 0) return { ok: true, value: new Map() };
  const read = await deps.adminRepo.readDetails(wanted);
  return read.ok ? { ok: true, value: read.value } : refused("error");
}

/**
 * 05's words for each attempt made through JustCall, by entry id (04's `family-panel.ts` and `dashboard.ts`, with
 * logging on). Never fails the page: off, no proof, nothing to read, or a failed read → an empty map (04's words).
 */
export async function justcallAttemptsFor(
  proof: AdminProof,
  entries: readonly CallLogEntry[],
  deps: AdminDeps = defaultAdminDeps(),
): Promise<ReadonlyMap<string, JustCallAttempt>> {
  const withSid = entries.filter((e): e is CallLogEntry & { readonly justcallCallId: string } => e.justcallCallId !== null);
  if (withSid.length === 0 || gate(proof) !== null) return new Map();
  try {
    const details = await detailsForCalls(proof, withSid.map((e) => e.justcallCallId), deps);
    if (!details.ok) return new Map();
    return new Map(withSid.flatMap((e) => {
      const d = details.value.get(e.justcallCallId);
      return d === undefined ? [] : [[e.id, justcallAttempt(e, d)] as const];
    }));
  } catch (thrown) {
    console.error("[justcall/admin] the details read failed; 04's words stand", { name: thrown instanceof Error ? thrown.name : typeof thrown });
    return new Map();
  }
}

export async function attachCall(proof: AdminProof, input: unknown, deps: AdminDeps = defaultAdminDeps()): Promise<JustCallActionResult<{ readonly entryCreated: boolean }>> {
  const shut = gate(proof);
  if (shut) return shut;
  const parsed = ATTACH_INPUT.safeParse(input);
  if (!parsed.success) return INVALID;
  const attached = await deps.repo.attachCall(parsed.data.callSid, parsed.data.parentUserId, proof.userId);
  return attached.ok ? { ok: true, value: { entryCreated: attached.value.entryCreated } } : refused(attached.error);
}

export async function dismissCall(proof: AdminProof, input: unknown, deps: AdminDeps = defaultAdminDeps()): Promise<JustCallActionResult<{ readonly replay: boolean }>> {
  const shut = gate(proof);
  if (shut) return shut;
  const parsed = DISMISS_INPUT.safeParse(input);
  if (!parsed.success) return INVALID;
  const dismissed = await deps.repo.dismissCall(parsed.data.callSid, proof.userId);
  return dismissed.ok ? { ok: true, value: dismissed.value } : refused(dismissed.error);
}

export async function saveJustCallOutcome(
  proof: AdminProof,
  input: JustCallSaveInput,
  deps: AdminDeps = defaultAdminDeps(),
): Promise<JustCallActionResult<{ readonly entryId: string; readonly completed: boolean }>> {
  const shut = gate(proof);
  if (shut) return shut;
  const parsed = saveInput.safeParse(input);
  if (!parsed.success) return INVALID;
  const saved = await deps.repo.saveOutcome({ ...parsed.data, actorUserId: proof.userId });
  return saved.ok ? { ok: true, value: saved.value } : refused(saved.error);
}

/** The typed search as a query: a UK mobile, or one or two names (lower case); null when it is neither. */
function parentQuery(raw: string): ParentQuery | null {
  const text = raw.trim().replace(/\s+/g, " ");
  if (text.length < 2 || text.length > 100) return null;
  if (isUkMobile(text)) return { kind: "mobile", e164: normaliseUkMobile(text) };
  if (!NAME.test(text)) return null;
  const words = text.toLowerCase().split(" ");
  return { kind: "name", first: words[0], last: words.length > 1 ? words[words.length - 1] : null };
}

export async function searchParentsForAttach(
  proof: AdminProof,
  query: string,
  deps: AdminDeps = defaultAdminDeps(),
): Promise<JustCallActionResult<readonly ParentChoice[]>> {
  const shut = gate(proof);
  if (shut) return shut;
  const q = typeof query === "string" ? parentQuery(query) : null;
  if (q === null) return INVALID;
  const found = await deps.adminRepo.searchParents(q);
  if (!found.ok) return refused("error");
  const choices = found.value.map((p): ParentChoice => ({
    parentUserId: p.userId,
    name: `${p.firstName} ${p.lastName}`.trim(),
    mobile: p.mobile !== null && isUkMobile(p.mobile) ? formatUkMobile(p.mobile) : null,
  }));
  return { ok: true, value: [...choices].sort((a, b) => a.name.localeCompare(b.name)).slice(0, SEARCH_LIMIT) };
}
