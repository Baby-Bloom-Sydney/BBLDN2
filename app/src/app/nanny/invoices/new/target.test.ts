/**
 * What the new-invoice page starts from (plan 06 old step 14, §14.3, §14.6 b4.4; 06b-4 rework, BAI 2026-11-12: one
 * family picker, no week and no kind; this page owns `?placement=`, `?connection=` and `?replaces=`, and takes no
 * `week`):
 * - **The request:** a correction (`?replaces=`) first, then any of her ids for a family (`?placement=`, then
 *   `?connection=`); an id that isn't one, or a repeated parameter, is ignored (the plain page).
 * - **Her families** for the picker: name, area, the family's link id, its earliest date and its rate — no family id,
 *   no kind.
 * - **A family's id** (any of hers: a placement, an older placement, a trial connection): resolved as hers, and that
 *   family is pre-selected; the form starts empty.
 * - **A correction:** her own cancelled invoice that no live one has corrected yet: its family (fixed), its lines with
 *   their own dates, rates and descriptions, its expenses, "Replaces …". Anything else → the plain page.
 * - Not hers (or any refusal but a failed read) → the plain page; a failed read → `error`.
 *
 * BB-wave1-041126/06b4, 2026-11-12; BB-wave1-041126/06b4-ui, 2026-11-12 (rework).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({ resolveInvoiceTarget: vi.fn(), readMyInvoices: vi.fn(), readMyInvoiceLines: vi.fn() }));
vi.mock("@/lib/invoices/families", () => ({ resolveInvoiceTarget: calls.resolveInvoiceTarget }));
vi.mock("@/lib/invoices/store", () => ({ readMyInvoices: calls.readMyInvoices, readMyInvoiceLines: calls.readMyInvoiceLines }));

import { myInvoiceRow } from "@/lib/invoices/store-map-lines";
import type { InvoiceableFamily } from "@/lib/invoices/families";
import type { NannyProof } from "@/lib/invoices/nanny-proof";
import { CONNECTION, EVENING_RATE, invoiceRow, OTHER_PARENT, PARENT_USER, PLACEMENT, RATE, TARGET, TRIAL_TARGET } from "@/lib/invoices/invoice-rows.test-util";
import { familyOptions, loadTarget, targetRequestOf } from "./target";

const PROOF = { kind: "nanny_proof" } as unknown as NannyProof;
const NOW = new Date("2027-02-17T10:00:00Z");
const OLD = "b0600000-0000-4000-8000-000000007001";
const ENDED = "b0600000-0000-4000-8000-000000000412";
const HARTLEYS: InvoiceableFamily = {
  parentUserId: PARENT_USER, familyName: "Olivia Hartley", area: "Islington", targetId: PLACEMENT, kind: "regular_week",
  earliest: "2027-01-25", ratePence: RATE, rateSource: "placement",
};
const PATELS: InvoiceableFamily = {
  parentUserId: OTHER_PARENT, familyName: "Priya Patel", area: null, targetId: CONNECTION, kind: "trial_shift",
  earliest: "2027-02-03", ratePence: null, rateSource: null,
};
const FAMILIES: readonly InvoiceableFamily[] = [HARTLEYS, PATELS];
const PATELS_RESOLVED = { ...TRIAL_TARGET, parentUserId: OTHER_PARENT, familyName: "Priya Patel", area: null, ratePence: null, rateSource: null };

beforeEach(() => {
  calls.resolveInvoiceTarget.mockReset().mockResolvedValue({ ok: true, value: TARGET });
  calls.readMyInvoices.mockReset().mockResolvedValue({ ok: true, value: [] });
  calls.readMyInvoiceLines.mockReset();
});

describe("targetRequestOf", () => {
  it("a correction first, then a placement's id, then a connection's id", () => {
    expect(targetRequestOf({ replaces: OLD, placement: PLACEMENT })).toEqual({ replaces: OLD });
    expect(targetRequestOf({ placement: PLACEMENT, connection: CONNECTION })).toEqual({ targetId: PLACEMENT });
    expect(targetRequestOf({ connection: CONNECTION })).toEqual({ targetId: CONNECTION });
  });

  it("nothing, an id that isn't one, or a repeated parameter → the plain page (no week parameter is read)", () => {
    for (const params of [undefined, {}, { placement: "x" }, { replaces: "../1" }, { placement: [PLACEMENT, PLACEMENT] }, { week: "2027-02-08" }]) {
      expect(targetRequestOf(params)).toBeNull();
    }
  });
});

describe("familyOptions", () => {
  it("name, area, the family's link id, its earliest date and rate — no family id, no kind", () => {
    const options = familyOptions(FAMILIES);
    expect(options).toEqual([
      { key: "0", familyName: "Olivia Hartley", area: "Islington", targetId: PLACEMENT, earliest: "2027-01-25", ratePence: RATE },
      { key: "1", familyName: "Priya Patel", area: null, targetId: CONNECTION, earliest: "2027-02-03", ratePence: null },
    ]);
    expect(JSON.stringify(options)).not.toMatch(new RegExp(`${PARENT_USER}|${OTHER_PARENT}|regular_week|trial_shift`));
  });
});

describe("loadTarget — a family's id", () => {
  it("nothing asked → no target, nothing read", async () => {
    expect(await loadTarget(PROOF, null, FAMILIES, NOW)).toEqual({ ok: true, value: null });
    expect(calls.resolveInvoiceTarget).not.toHaveBeenCalled();
  });

  it("a placement: resolved as hers; that family pre-selected; the form starts empty", async () => {
    const r = await loadTarget(PROOF, { targetId: PLACEMENT }, FAMILIES, NOW);
    expect(calls.resolveInvoiceTarget).toHaveBeenCalledWith(PROOF, PLACEMENT, NOW);
    expect(r).toEqual({ ok: true, value: { familyKey: "0", shifts: [], expenses: [], replaces: null } });
    expect(JSON.stringify(r)).not.toMatch(new RegExp(`${PARENT_USER}|admin\\+b06`));
  });

  it("any of her ids for a family pre-selects that family: an older placement, a trial connection", async () => {
    expect(await loadTarget(PROOF, { targetId: ENDED }, FAMILIES, NOW)).toEqual({ ok: true, value: { familyKey: "0", shifts: [], expenses: [], replaces: null } });
    calls.resolveInvoiceTarget.mockResolvedValueOnce({ ok: true, value: PATELS_RESOLVED });
    expect(await loadTarget(PROOF, { targetId: CONNECTION }, FAMILIES, NOW)).toEqual({ ok: true, value: { familyKey: "1", shifts: [], expenses: [], replaces: null } });
  });

  it("a family resolved but not in her list (read in between) → the plain page", async () => {
    calls.resolveInvoiceTarget.mockResolvedValueOnce({ ok: true, value: { ...TARGET, parentUserId: "b0600000-0000-4000-8000-000000000099" } });
    expect(await loadTarget(PROOF, { targetId: PLACEMENT }, FAMILIES, NOW)).toEqual({ ok: true, value: null });
  });

  it("not hers or any other refusal → the plain page; a failed read → error", async () => {
    for (const error of ["not_hers", "invalid", "no_contact", "invoices_disabled"]) {
      calls.resolveInvoiceTarget.mockResolvedValueOnce({ ok: false, error });
      expect(await loadTarget(PROOF, { targetId: PLACEMENT }, FAMILIES, NOW)).toEqual({ ok: true, value: null });
    }
    calls.resolveInvoiceTarget.mockResolvedValueOnce({ ok: false, error: "error" });
    expect(await loadTarget(PROOF, { targetId: PLACEMENT }, FAMILIES, NOW)).toEqual({ ok: false, error: "error" });
  });
});

describe("loadTarget — a correction (?replaces=)", () => {
  const cancelled = (over: Record<string, unknown> = {}) => myInvoiceRow.parse(invoiceRow({
    id: OLD, invoice_number: "BB-SophieTaylor-270214-0001", status: "cancelled", cancel_reason: "wrong_hours",
    cancelled_at: "2027-02-14T11:00:00+00:00", ...over,
  }));
  const LINES = [
    { lineNo: 2, kind: "shift", date: "2027-01-29", hours: 2, ratePence: EVENING_RATE, description: "evening", amountPence: 4400 },
    { lineNo: 1, kind: "shift", date: "2027-02-08", hours: 7.75, ratePence: RATE, description: null, amountPence: 13950 },
    { lineNo: 3, kind: "expense", expenseType: "activities", description: null, amountPence: 1250 },
  ];

  it("her cancelled invoice: its family, fixed; its lines with their own dates; its expenses; Replaces …", async () => {
    calls.readMyInvoices.mockResolvedValueOnce({ ok: true, value: [cancelled()] });
    calls.readMyInvoiceLines.mockResolvedValueOnce({ ok: true, value: LINES });
    const r = await loadTarget(PROOF, { replaces: OLD }, FAMILIES, NOW);
    expect(calls.readMyInvoiceLines).toHaveBeenCalledWith(PROOF, OLD);
    expect(calls.resolveInvoiceTarget).toHaveBeenCalledWith(PROOF, PLACEMENT, NOW);
    expect(r).toEqual({
      ok: true,
      value: {
        familyKey: "0",
        shifts: [
          { date: "2027-02-08", hours: "7.75", rate: "18.00", description: "" },
          { date: "2027-01-29", hours: "2", rate: "22.00", description: "evening" },
        ],
        expenses: [{ expenseType: "activities", amount: "12.50", description: "" }],
        replaces: { invoiceId: OLD, number: "BB-SophieTaylor-270214-0001" },
      },
    });
  });

  it("one linked through her trial connection: resolved from that id", async () => {
    calls.readMyInvoices.mockResolvedValueOnce({ ok: true, value: [cancelled({ kind: "trial_shift", placement_id: null, connection_request_id: CONNECTION, parent_user_id: OTHER_PARENT })] });
    calls.readMyInvoiceLines.mockResolvedValueOnce({ ok: true, value: [LINES[0]] });
    calls.resolveInvoiceTarget.mockResolvedValueOnce({ ok: true, value: PATELS_RESOLVED });
    const r = await loadTarget(PROOF, { replaces: OLD }, FAMILIES, NOW);
    expect(calls.resolveInvoiceTarget).toHaveBeenCalledWith(PROOF, CONNECTION, NOW);
    expect(r.ok && r.value).toMatchObject({ familyKey: "1", expenses: [], replaces: { invoiceId: OLD } });
  });

  it("not hers, not cancelled, already corrected by a live one, or its family no longer hers → the plain page", async () => {
    for (const mine of [[], [cancelled({ status: "sent", cancel_reason: null, cancelled_at: null })],
      [cancelled(), myInvoiceRow.parse(invoiceRow({ replaces_invoice_id: OLD }))]]) {
      calls.readMyInvoices.mockResolvedValueOnce({ ok: true, value: mine });
      expect(await loadTarget(PROOF, { replaces: OLD }, FAMILIES, NOW)).toEqual({ ok: true, value: null });
    }
    expect(calls.readMyInvoiceLines).not.toHaveBeenCalled();
    calls.readMyInvoices.mockResolvedValueOnce({ ok: true, value: [cancelled()] });
    calls.readMyInvoiceLines.mockResolvedValueOnce({ ok: true, value: LINES });
    calls.resolveInvoiceTarget.mockResolvedValueOnce({ ok: false, error: "not_hers" });
    expect(await loadTarget(PROOF, { replaces: OLD }, FAMILIES, NOW)).toEqual({ ok: true, value: null });
  });

  it("a failed read → error", async () => {
    calls.readMyInvoices.mockResolvedValueOnce({ ok: false, error: "error" });
    expect(await loadTarget(PROOF, { replaces: OLD }, FAMILIES, NOW)).toEqual({ ok: false, error: "error" });
    calls.readMyInvoices.mockResolvedValueOnce({ ok: true, value: [cancelled()] });
    calls.readMyInvoiceLines.mockResolvedValueOnce({ ok: false, error: "error" });
    expect(await loadTarget(PROOF, { replaces: OLD }, FAMILIES, NOW)).toEqual({ ok: false, error: "error" });
  });
});
