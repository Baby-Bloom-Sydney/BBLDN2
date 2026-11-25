/**
 * BAI's deposit-link operations (plan 03 §3 "Link"; brief 03 §3 admin 3–4). 03b's admin actions call these after
 * `proveAdmin()`; the parent's page calls `stampLinkOpened` with her `DepositParentProof`.
 *
 * - One open link per family, with a stable code: `getOrCreateOpenLink` mints a new 32-byte code only when none is
 *   open. An open link made for the target asked for (and the same goodwill pin) → `ok`. One made for another target
 *   or pin → `target_differs` with that link unchanged: never `ok`, so 03b decides (send it as is, or cancel and send
 *   again). A concurrent press that inserted first hits amendment 18's one-open-per-family index (23505): this
 *   re-reads and answers for that link the same way.
 * - `cancelOpenLink` ends the open link; the next get-or-create mints a new code.
 * - Every admin operation checks `isAdminProof` and its input before any read. Reads are single rows
 *   (`maybeSingle`). Failures are logged by error code only — never a deposit code, an address or a message.
 * - Server-only, deliberately NOT `"use server"` (`src/lib/invite/mint.ts:1-9`). Results are frozen.
 *
 * BB-wave2-231126/03-build, 2026-11-25.
 */

import { randomBytes } from "node:crypto";
import { z } from "zod";
import { isAdminProof, type AdminProof } from "@/lib/calls/admin-proof";
import { logFailure, type AdminClient } from "@/lib/cohorts/db";
import { isLondonDate } from "@/lib/cohorts/dates";
import { SITE_URL } from "@/lib/constants";
import { depositCodeFrom, isDepositCode, isUuid } from "./code";
import { DEPOSIT_CODE_BYTES, EMAIL_MAX } from "./constants";
import { depositLinkRow, isDepositParentProof, type DepositParentProof } from "./proof";
import type { DepositLinkState, DepositTarget } from "./types";

/** Postgres unique_violation: another open link for the family won the race. */
const UNIQUE_VIOLATION = "23505";
const COLUMNS =
  "id, parent_user_id, code, state, target, goodwill_cohort_start_date, last_emailed_at, last_emailed_to, last_opened_at, created_at";

const INVALID = Object.freeze({ status: "invalid" } as const);
const ERROR = Object.freeze({ status: "error" } as const);

/** A family's deposit link as BAI's panel and actions see it. */
export interface DepositLink {
  readonly id: string;
  readonly parentUserId: string;
  readonly code: string;
  readonly state: DepositLinkState;
  readonly target: DepositTarget;
  readonly goodwillStartDate: string | null;
  readonly lastEmailedAt: string | null;
  readonly lastEmailedTo: string | null;
  readonly lastOpenedAt: string | null;
  readonly createdAt: string;
}

export interface OpenLinkRequest {
  readonly parentUserId: string;
  readonly target: DepositTarget;
  /** A London date for a goodwill link (pinned first with `ensureCohort`); null for the current cohort. */
  readonly goodwillStartDate: string | null;
}

export type OpenLinkResult =
  | { readonly status: "ok"; readonly link: DepositLink; readonly created: boolean }
  /** The family's open link, unchanged, was made for another target or goodwill pin than this request's. */
  | { readonly status: "target_differs"; readonly link: DepositLink }
  | typeof INVALID
  | typeof ERROR;
export type CancelLinkResult = { readonly status: "cancelled" | "none" } | typeof INVALID | typeof ERROR;
export type StampResult = { readonly status: "stamped" | "not_found" } | typeof INVALID | typeof ERROR;

const linkRow = depositLinkRow.safeExtend({
  code: z.string().refine(isDepositCode),
  last_emailed_at: z.string().nullable(),
  last_emailed_to: z.string().nullable(),
  last_opened_at: z.string().nullable(),
  created_at: z.string(),
});

const idRows = z.array(z.object({ id: z.string() }));

type Parsed<T> = { readonly ok: true; readonly value: T } | { readonly ok: false };

function toLink(label: string, data: unknown): Parsed<DepositLink> {
  const row = linkRow.safeParse(data);
  if (!row.success) {
    logFailure(label, { code: "unexpected_row" });
    return { ok: false };
  }
  const r = row.data;
  return {
    ok: true,
    value: Object.freeze({
      id: r.id, parentUserId: r.parent_user_id, code: r.code, state: r.state, target: r.target,
      goodwillStartDate: r.goodwill_cohort_start_date, lastEmailedAt: r.last_emailed_at, lastEmailedTo: r.last_emailed_to,
      lastOpenedAt: r.last_opened_at, createdAt: r.created_at,
    }),
  };
}

const found = (link: DepositLink, created: boolean): OpenLinkResult => Object.freeze({ status: "ok", link, created });

/** The open link found (an earlier send's, or a concurrent press's): `ok` only for this request's target and pin. */
const existing = (link: DepositLink, req: OpenLinkRequest): OpenLinkResult =>
  link.target === req.target && link.goodwillStartDate === req.goodwillStartDate
    ? found(link, false)
    : Object.freeze({ status: "target_differs", link });

function isValidRequest(req: OpenLinkRequest): boolean {
  if (!isUuid(req.parentUserId)) return false;
  if (req.target === "current") return req.goodwillStartDate === null;
  return req.target === "goodwill" && isLondonDate(req.goodwillStartDate);
}

/** The family's open link, or null. At most one exists (amendment 18's partial unique index). */
async function readOpen(admin: AdminClient, parentUserId: string): Promise<Parsed<DepositLink | null>> {
  const { data, error } = await admin.from("deposit_links").select(COLUMNS).eq("parent_user_id", parentUserId).eq("state", "open").maybeSingle();
  if (error) {
    logFailure("deposit links read", error);
    return { ok: false };
  }
  return data === null ? { ok: true, value: null } : toLink("deposit links read", data);
}

/** Insert a new open link; `conflict` when a concurrent press inserted one first. */
async function insertOpen(proof: AdminProof, admin: AdminClient, req: OpenLinkRequest): Promise<Parsed<DepositLink> | { readonly ok: "conflict" }> {
  const row = {
    parent_user_id: req.parentUserId,
    code: depositCodeFrom(new Uint8Array(randomBytes(DEPOSIT_CODE_BYTES))),
    state: "open",
    target: req.target,
    goodwill_cohort_start_date: req.goodwillStartDate,
    created_by: proof.userId,
  };
  const { data, error } = await admin.from("deposit_links").insert(row).select(COLUMNS).single();
  if (error?.code === UNIQUE_VIOLATION) return { ok: "conflict" };
  if (error) {
    logFailure("deposit links insert", error);
    return { ok: false };
  }
  return toLink("deposit links insert", data);
}

/**
 * BAI's send, copy and "Take payment now": the family's one open link, made if there is none. An open link for
 * another target or pin → `target_differs` (that link, unchanged; nothing written).
 */
export async function getOrCreateOpenLink(proof: AdminProof, admin: AdminClient, req: OpenLinkRequest): Promise<OpenLinkResult> {
  if (!isAdminProof(proof) || !isValidRequest(req)) return INVALID;
  try {
    const open = await readOpen(admin, req.parentUserId);
    if (!open.ok) return ERROR;
    if (open.value !== null) return existing(open.value, req);
    const made = await insertOpen(proof, admin, req);
    if (made.ok === true) return found(made.value, true);
    if (made.ok === false) return ERROR;
    const again = await readOpen(admin, req.parentUserId);
    if (!again.ok) return ERROR;
    if (again.value === null) {
      logFailure("deposit links insert", { code: "conflict_without_open_link" });
      return ERROR;
    }
    return existing(again.value, req);
  } catch (thrown) {
    logFailure("getOrCreateOpenLink", thrown);
    return ERROR;
  }
}

/** Run one update that selects the ids it changed; how many rows it matched, or null on an error (logged). */
async function updatedCount(label: string, run: () => PromiseLike<{ data: unknown; error: { code?: string } | null }>): Promise<number | null> {
  try {
    const { data, error } = await run();
    if (error) {
      logFailure(label, error);
      return null;
    }
    const rows = idRows.safeParse(data);
    if (!rows.success) {
      logFailure(label, { code: "unexpected_reply" });
      return null;
    }
    return rows.data.length;
  } catch (thrown) {
    logFailure(label, thrown);
    return null;
  }
}

/** BAI stops the family's open link (a wrong address or a leak). The next send makes a new code. */
export async function cancelOpenLink(proof: AdminProof, admin: AdminClient, parentUserId: string): Promise<CancelLinkResult> {
  if (!isAdminProof(proof) || !isUuid(parentUserId)) return INVALID;
  const count = await updatedCount("deposit links cancel", () =>
    admin
      .from("deposit_links")
      .update({ state: "cancelled", cancelled_at: new Date().toISOString(), cancelled_by: proof.userId })
      .eq("parent_user_id", parentUserId)
      .eq("state", "open")
      .select("id"),
  );
  if (count === null) return ERROR;
  return Object.freeze({ status: count > 0 ? "cancelled" : "none" });
}

/** After the link email is sent: when, and to which address (brief 03 §3 admin 3, "Sent at 14:02. Send again?"). */
export async function stampLinkSent(
  proof: AdminProof,
  admin: AdminClient,
  req: { readonly linkId: string; readonly to: string },
): Promise<StampResult> {
  const to = typeof req.to === "string" ? req.to.trim() : "";
  if (!isAdminProof(proof) || !isUuid(req.linkId) || to.length === 0 || to.length > EMAIL_MAX) return INVALID;
  const count = await updatedCount("deposit links sent stamp", () =>
    admin.from("deposit_links").update({ last_emailed_at: new Date().toISOString(), last_emailed_to: to }).eq("id", req.linkId).select("id"),
  );
  if (count === null) return ERROR;
  return Object.freeze({ status: count > 0 ? "stamped" : "not_found" });
}

/** The parent opened her page: stamped on her proven link only. */
export async function stampLinkOpened(admin: AdminClient, proof: DepositParentProof): Promise<StampResult> {
  if (!isDepositParentProof(proof)) return INVALID;
  const count = await updatedCount("deposit links opened stamp", () =>
    admin
      .from("deposit_links")
      .update({ last_opened_at: new Date().toISOString() })
      .eq("id", proof.linkId)
      .eq("parent_user_id", proof.parentUserId)
      .select("id"),
  );
  if (count === null) return ERROR;
  return Object.freeze({ status: count > 0 ? "stamped" : "not_found" });
}

/** The link the parent opens: `<SITE_URL>/deposit/<code>`. Anything but a deposit code throws: no malformed URL. */
export function depositLinkUrl(code: string): string {
  if (!isDepositCode(code)) throw new RangeError("not a deposit code");
  return `${SITE_URL}/deposit/${code}`;
}
