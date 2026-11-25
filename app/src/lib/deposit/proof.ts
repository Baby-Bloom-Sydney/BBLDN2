/**
 * The deposit parent proof (plan 03 D5, D15). 02's hold, attach and release (`cohorts/places.ts`) take one, so no
 * caller can hold or release a family's place without having verified that family's deposit code.
 *
 * - Made only by `proveDepositCode()`: the code's format is checked first (a bad one makes no database call), then
 *   one read of `deposit_links` by code. No row, or a cancelled link → `invalid`; an open or paid link → a proof for
 *   the parent **on that row**. Nothing ties the page to a login (D15: BAI may open it from his own session to take
 *   the card), so nothing here reads a session.
 * - Branded at the type level (the brand symbol isn't exported, so no object literal type-checks as one) and at run
 *   time (`isDepositParentProof` accepts only an object issued in this process; a look-alike, a copy or a cast is
 *   refused). The `AdminProof` pattern (`src/lib/calls/admin-proof.ts`).
 * - Server-only, deliberately NOT `"use server"` (`src/lib/invite/mint.ts:1-9`). Failures are logged by error code
 *   only — never the deposit code, never a message (either can carry a family's details).
 *
 * BB-wave2-231126/03-build, 2026-11-25.
 */

import { z } from "zod";
import { isLondonDate } from "@/lib/cohorts/dates";
import type { createAdminClient } from "@/lib/supabase/admin";
import { isDepositCode } from "./code";
import { DEPOSIT_LINK_STATES, DEPOSIT_TARGETS, type VerifiedDepositLink } from "./types";

type AdminClient = ReturnType<typeof createAdminClient>;

declare const DEPOSIT_PARENT_PROOF: unique symbol;

export type DepositParentProof = {
  readonly kind: "deposit_parent_proof";
  readonly parentUserId: string;
  readonly linkId: string;
  readonly [DEPOSIT_PARENT_PROOF]: true;
};

export type ProveResult =
  | { readonly ok: true; readonly proof: DepositParentProof; readonly link: VerifiedDepositLink }
  | { readonly ok: false; readonly status: "invalid" | "error" };

const issued = new WeakSet<object>();

const INVALID = Object.freeze({ ok: false, status: "invalid" } as const);
const ERROR = Object.freeze({ ok: false, status: "error" } as const);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LINK_COLUMNS = "id, parent_user_id, state, target, goodwill_cohort_start_date, last_opened_at";

const linkRow = z
  .object({
    id: z.string().regex(UUID_RE),
    parent_user_id: z.string().regex(UUID_RE),
    state: z.enum(DEPOSIT_LINK_STATES),
    target: z.enum(DEPOSIT_TARGETS),
    goodwill_cohort_start_date: z.string().refine(isLondonDate).nullable(),
    last_opened_at: z.string().nullable(),
  })
  .refine((r) => (r.target === "goodwill") === (r.goodwill_cohort_start_date !== null));

function codeOf(detail: unknown): string {
  if (detail instanceof Error) return detail.name;
  if (typeof detail === "object" && detail !== null && typeof (detail as { code?: unknown }).code === "string") {
    return (detail as { code: string }).code;
  }
  return "unknown";
}

function logFailure(detail: unknown): void {
  console.error("[deposit] proveDepositCode failed", { code: codeOf(detail) });
}

function issue(row: z.infer<typeof linkRow> & { state: "open" | "paid" }): ProveResult {
  const proof = Object.freeze({ kind: "deposit_parent_proof", parentUserId: row.parent_user_id, linkId: row.id }) as DepositParentProof;
  issued.add(proof);
  const link: VerifiedDepositLink = Object.freeze({
    id: row.id,
    parentUserId: row.parent_user_id,
    state: row.state,
    target: row.target,
    goodwillStartDate: row.goodwill_cohort_start_date,
    lastOpenedAt: row.last_opened_at,
  });
  return Object.freeze({ ok: true, proof, link });
}

/** The parent a deposit code belongs to, proven; or `invalid` (one answer for every bad case) or `error`. */
export async function proveDepositCode(admin: AdminClient, code: unknown): Promise<ProveResult> {
  if (!isDepositCode(code)) return INVALID;
  try {
    const { data, error } = await admin.from("deposit_links").select(LINK_COLUMNS).eq("code", code).maybeSingle();
    if (error) {
      logFailure(error);
      return ERROR;
    }
    if (data === null) return INVALID;
    const row = linkRow.safeParse(data);
    if (!row.success) {
      logFailure({ code: "unexpected_row" });
      return ERROR;
    }
    const { state } = row.data;
    return state === "cancelled" ? INVALID : issue({ ...row.data, state });
  } catch (thrown) {
    logFailure(thrown);
    return ERROR;
  }
}

export function isDepositParentProof(value: unknown): value is DepositParentProof {
  return typeof value === "object" && value !== null && issued.has(value);
}
