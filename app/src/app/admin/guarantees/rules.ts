/**
 * /admin/guarantees — pure rules (4e brief step 2; ADR-088, offer §4, runbook SOP 14). BB-LDN-4e-151026.
 *
 * Every number comes from `@/config/offer`. The windows (G1, G2) are information for the admin, never a block:
 * the offer's "one call with us first" means the admin decides. G4 is offered only once the business has made
 * `G4.enabledAfterPlacements` placements (the action refuses it below that too).
 * Plain module (no server or client imports) so the page, the client form and the action share it.
 */
import { G1, G2, G4 } from "@/config/offer";

export const PROMISES = ["G1", "G2", "G3", "G4", "G5"] as const;
export type GuaranteePromise = (typeof PROMISES)[number];

const PROMISE_TEXT: Record<GuaranteePromise, string> = {
  G1: `G1 — a nanny within ${G1.windowDays} days of our call, or her first week on us`,
  G2: `G2 — full refund in the first ${G2.windowDays} days`,
  G3: "G3 — wages reimbursed up to the fee, new nanny",
  G4: "G4 — refund and wages reimbursed",
  G5: "G5 — we keep working with you",
};

export const promiseLabel = (p: GuaranteePromise): string => PROMISE_TEXT[p];

export const isPromise = (v: unknown): v is GuaranteePromise =>
  typeof v === "string" && (PROMISES as readonly string[]).includes(v);

export const g4Enabled = (placementCount: number): boolean =>
  placementCount >= G4.enabledAfterPlacements;

export const g4DisabledReason = (): string =>
  `Offered after ${G4.enabledAfterPlacements} placements`;

export type WindowState = "open" | "closed" | "unknown";

/** G2's window from the subscription's `satisfaction_window_ends_at` (4c). Information only. */
export function g2WindowState(endsAtIso: string | null, nowMs: number = Date.now()): WindowState {
  if (!endsAtIso) return "unknown";
  const end = Date.parse(endsAtIso);
  if (Number.isNaN(end)) return "unknown";
  return nowMs <= end ? "open" : "closed";
}

const PENCE_PER_POUND = 100;
/** Up to six digits of pounds and two of pence; no sign, symbol, separator or exponent. */
const POUNDS_RE = /^(\d{1,6})(?:\.(\d{1,2}))?$/;

/** Pounds typed by the admin → whole pence, exactly (no float), or null. */
export function poundsToPence(raw: string): number | null {
  const m = POUNDS_RE.exec(raw.trim());
  if (!m) return null;
  const fraction = (m[2] ?? "").padEnd(2, "0");
  return Number(m[1]) * PENCE_PER_POUND + Number(fraction);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const OUTCOME_MAX = 500;
export const NOTES_MAX = 2000;

export interface GuaranteeRecord {
  parentUserId: string;
  promise: GuaranteePromise;
  conditionMet: boolean;
  outcome: string;
  paidOutPence: number;
  notes: string | null;
}

export type GuaranteeInputError =
  | "invalid_input"
  | "invalid_family"
  | "invalid_promise"
  | "invalid_condition"
  | "outcome_required"
  | "outcome_too_long"
  | "invalid_amount"
  | "notes_too_long";

export type ValidationResult =
  | { ok: true; value: GuaranteeRecord }
  | { ok: false; error: GuaranteeInputError };

/** The form's fields (untrusted) → a record ready to insert, or the first error. */
export function validateGuaranteeInput(raw: unknown): ValidationResult {
  if (!raw || typeof raw !== "object") return { ok: false, error: "invalid_input" };
  const r = raw as Record<string, unknown>;
  if (typeof r.parentUserId !== "string" || !UUID_RE.test(r.parentUserId)) {
    return { ok: false, error: "invalid_family" };
  }
  if (!isPromise(r.promise)) return { ok: false, error: "invalid_promise" };
  if (typeof r.conditionMet !== "boolean") return { ok: false, error: "invalid_condition" };
  const outcome = typeof r.outcome === "string" ? r.outcome.trim() : "";
  if (!outcome) return { ok: false, error: "outcome_required" };
  if (outcome.length > OUTCOME_MAX) return { ok: false, error: "outcome_too_long" };
  const paidOutPence = typeof r.paidOutPounds === "string" ? poundsToPence(r.paidOutPounds) : null;
  if (paidOutPence === null) return { ok: false, error: "invalid_amount" };
  const notes = typeof r.notes === "string" ? r.notes.trim() : "";
  if (notes.length > NOTES_MAX) return { ok: false, error: "notes_too_long" };
  return {
    ok: true,
    value: {
      parentUserId: r.parentUserId,
      promise: r.promise,
      conditionMet: r.conditionMet,
      outcome,
      paidOutPence,
      notes: notes || null,
    },
  };
}
