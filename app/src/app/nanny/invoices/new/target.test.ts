/**
 * What the new-invoice page starts from (plan 06 old step 14, §14.3, §14.6 b4.4; §16.7 b5.8: this page owns
 * `?placement=`, `?connection=` and `?replaces=`, and takes no `week`):
 * - **The request:** a correction (`?replaces=`) first, then a placement (Regular week), then a trial connection
 *   (Trial Shift); an id that isn't one, or a repeated parameter, is ignored (the plain page).
 * - **Her families** for the picker: name, area, the placement a Regular week uses (active first), the trial dates —
 *   no family id.
 * - **A placement:** resolved as hers with last week's pre-fill (a week with no future day), which becomes her
 *   pattern; the weeks she can pick (this week back to the placement's first); this week first.
 * - **A trial:** its date, fixed.
 * - **A correction:** her own cancelled invoice that no live one has corrected yet: its family, kind and period, its
 *   lines as the rows and expenses, "Replaces …". Anything else → the plain page.
 * - Not hers (or no trial date, or any refusal but a failed read) → the plain page; a failed read → `error`.
 *
 * BB-wave1-041126/06b4, 2026-11-12.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({ resolveInvoiceTarget: vi.fn(), readMyInvoices: vi.fn(), readMyInvoiceLines: vi.fn() }));
vi.mock("@/lib/invoices/families", () => ({ resolveInvoiceTarget: calls.resolveInvoiceTarget }));
vi.mock("@/lib/invoices/store", () => ({ readMyInvoices: calls.readMyInvoices, readMyInvoiceLines: calls.readMyInvoiceLines }));

import { myInvoiceRow } from "@/lib/invoices/store-map-lines";
import type { InvoiceableFamily } from "@/lib/invoices/families";
import type { NannyProof } from "@/lib/invoices/nanny-proof";
import { CONNECTION, invoiceRow, OTHER_PARENT, PARENT_USER, PLACEMENT, RATE, TARGET, TRIAL_TARGET } from "@/lib/invoices/invoice-rows.test-util";
import { familyOptions, loadTarget, targetRequestOf } from "./target";

const PROOF = { kind: "nanny_proof" } as unknown as NannyProof;
const NOW = new Date("2027-02-17T10:00:00Z"); // a Wednesday: this week is w/c 15 Feb, last week w/c 8 Feb
const OLD = "b0600000-0000-4000-8000-000000007001";
const ENDED = "b0600000-0000-4000-8000-000000000412";
const FAMILIES: readonly InvoiceableFamily[] = [
  {
    parentUserId: PARENT_USER, familyName: "Olivia Hartley", area: "Islington",
    placements: [
      { placementId: PLACEMENT, status: "active", startDate: "2027-02-02", weeklyHours: 25, ratePence: RATE },
      { placementId: ENDED, status: "ended", startDate: "2026-01-05", weeklyHours: 30, ratePence: RATE },
    ],
    trials: [],
  },
  { parentUserId: OTHER_PARENT, familyName: "Priya Patel", area: null, placements: [], trials: [{ connectionId: CONNECTION, trialDate: "2027-02-03", ratePence: RATE }] },
];
const WEEK_PREFILL = {
  shifts: [
    { date: "2027-02-08", hours: 8.5, ratePence: RATE, description: null },
    { date: "2027-02-10", hours: 8.25, ratePence: RATE, description: null },
    { date: "2027-02-12", hours: 8.25, ratePence: RATE, description: null },
  ],
  ratePence: RATE, rateSource: "placement" as const,
};

beforeEach(() => {
  calls.resolveInvoiceTarget.mockReset().mockResolvedValue({ ok: true, value: { ...TARGET, prefill: WEEK_PREFILL } });
  calls.readMyInvoices.mockReset().mockResolvedValue({ ok: true, value: [] });
  calls.readMyInvoiceLines.mockReset();
});

describe("targetRequestOf", () => {
  it("a correction first, then a placement, then a connection", () => {
    expect(targetRequestOf({ replaces: OLD, placement: PLACEMENT })).toEqual({ replaces: OLD });
    expect(targetRequestOf({ placement: PLACEMENT, connection: CONNECTION })).toEqual({ kind: "regular_week", targetId: PLACEMENT });
    expect(targetRequestOf({ connection: CONNECTION })).toEqual({ kind: "trial_shift", targetId: CONNECTION });
  });

  it("nothing, an id that isn't one, or a repeated parameter → the plain page (no week parameter is read)", () => {
    for (const params of [undefined, {}, { placement: "x" }, { replaces: "../1" }, { placement: [PLACEMENT, PLACEMENT] }, { week: "2027-02-08" }]) {
      expect(targetRequestOf(params)).toBeNull();
    }
  });
});

describe("familyOptions", () => {
  it("name, area, the placement a Regular week uses (the first: active first), the trial dates — no family id", () => {
    const options = familyOptions(FAMILIES);
    expect(options).toEqual([
      { key: "0", familyName: "Olivia Hartley", area: "Islington", placementId: PLACEMENT, trials: [] },
      { key: "1", familyName: "Priya Patel", area: null, placementId: null, trials: [{ connectionId: CONNECTION, date: "2027-02-03" }] },
    ]);
    expect(JSON.stringify(options)).not.toContain(PARENT_USER);
  });
});

describe("loadTarget — a placement or a trial", () => {
  it("nothing asked → no target, nothing read", async () => {
    expect(await loadTarget(PROOF, null, FAMILIES, NOW)).toEqual({ ok: true, value: null });
    expect(calls.resolveInvoiceTarget).not.toHaveBeenCalled();
  });

  it("a placement: resolved as hers for last week; its pattern; this week back to the first; this week first", async () => {
    const r = await loadTarget(PROOF, { kind: "regular_week", targetId: PLACEMENT }, FAMILIES, NOW);
    expect(calls.resolveInvoiceTarget).toHaveBeenCalledWith(PROOF, "regular_week", PLACEMENT, "2027-02-08", NOW);
    expect(r).toEqual({
      ok: true,
      value: {
        kind: "regular_week", targetId: PLACEMENT, familyKey: "0", familyName: "Olivia Hartley", area: "Islington",
        weeks: ["2027-02-15", "2027-02-08", "2027-02-01"], periodStart: "2027-02-15",
        pattern: [
          { offset: 0, hours: 8.5, ratePence: RATE, description: null },
          { offset: 2, hours: 8.25, ratePence: RATE, description: null },
          { offset: 4, hours: 8.25, ratePence: RATE, description: null },
        ],
        expenses: [], ratePence: RATE, replaces: null,
      },
    });
    expect(JSON.stringify(r)).not.toMatch(new RegExp(`${PARENT_USER}|admin\\+b06`));
  });

  it("the ended placement's weeks run back to its own start (at most 26)", async () => {
    const r = await loadTarget(PROOF, { kind: "regular_week", targetId: ENDED }, FAMILIES, NOW);
    expect(r.ok && r.value?.weeks).toHaveLength(26);
  });

  it("a trial: its date, fixed; no weeks", async () => {
    calls.resolveInvoiceTarget.mockResolvedValueOnce({ ok: true, value: { ...TRIAL_TARGET, parentUserId: OTHER_PARENT, familyName: "Priya Patel", area: null } });
    const r = await loadTarget(PROOF, { kind: "trial_shift", targetId: CONNECTION }, FAMILIES, NOW);
    expect(calls.resolveInvoiceTarget).toHaveBeenCalledWith(PROOF, "trial_shift", CONNECTION, null, NOW);
    expect(r.ok && r.value).toMatchObject({
      kind: "trial_shift", targetId: CONNECTION, familyKey: "1", weeks: [], periodStart: "2027-02-03",
      pattern: [{ offset: 0, hours: null, ratePence: RATE, description: null }],
    });
  });

  it("not hers, no trial date or any other refusal → the plain page; a failed read → error", async () => {
    for (const error of ["not_hers", "no_trial", "invalid", "future", "no_contact"]) {
      calls.resolveInvoiceTarget.mockResolvedValueOnce({ ok: false, error });
      expect(await loadTarget(PROOF, { kind: "regular_week", targetId: PLACEMENT }, FAMILIES, NOW)).toEqual({ ok: true, value: null });
    }
    calls.resolveInvoiceTarget.mockResolvedValueOnce({ ok: false, error: "error" });
    expect(await loadTarget(PROOF, { kind: "regular_week", targetId: PLACEMENT }, FAMILIES, NOW)).toEqual({ ok: false, error: "error" });
  });
});

describe("loadTarget — a correction (?replaces=)", () => {
  const cancelled = (over: Record<string, unknown> = {}) => myInvoiceRow.parse(invoiceRow({
    id: OLD, invoice_number: "BB-SophieTaylor-270214-0001", status: "cancelled", cancel_reason: "wrong_hours",
    cancelled_at: "2027-02-14T11:00:00+00:00", ...over,
  }));
  const LINES = [
    { lineNo: 2, kind: "shift", date: "2027-02-10", hours: 2, ratePence: 2200, description: "evening", amountPence: 4400 },
    { lineNo: 1, kind: "shift", date: "2027-02-08", hours: 6, ratePence: RATE, description: null, amountPence: 10800 },
    { lineNo: 3, kind: "expense", expenseType: "activities", description: null, amountPence: 1250 },
  ];

  it("her cancelled invoice: its family, period, lines and expenses, Replaces …", async () => {
    calls.readMyInvoices.mockResolvedValueOnce({ ok: true, value: [cancelled()] });
    calls.readMyInvoiceLines.mockResolvedValueOnce({ ok: true, value: LINES });
    const r = await loadTarget(PROOF, { replaces: OLD }, FAMILIES, NOW);
    expect(calls.readMyInvoiceLines).toHaveBeenCalledWith(PROOF, OLD);
    expect(calls.resolveInvoiceTarget).toHaveBeenCalledWith(PROOF, "regular_week", PLACEMENT, "2027-02-08", NOW);
    expect(r.ok && r.value).toMatchObject({
      kind: "regular_week", targetId: PLACEMENT, familyKey: "0", periodStart: "2027-02-08",
      pattern: [{ offset: 0, hours: 6, ratePence: RATE, description: null }, { offset: 2, hours: 2, ratePence: 2200, description: "evening" }],
      expenses: [{ expenseType: "activities", amount: "12.50", description: "" }],
      replaces: { invoiceId: OLD, number: "BB-SophieTaylor-270214-0001" },
    });
  });

  it("not hers, not cancelled, or already corrected by a live one → the plain page", async () => {
    for (const mine of [[], [cancelled({ status: "sent", cancel_reason: null, cancelled_at: null })],
      [cancelled(), myInvoiceRow.parse(invoiceRow({ replaces_invoice_id: OLD }))]]) {
      calls.readMyInvoices.mockResolvedValueOnce({ ok: true, value: mine });
      expect(await loadTarget(PROOF, { replaces: OLD }, FAMILIES, NOW)).toEqual({ ok: true, value: null });
    }
    expect(calls.readMyInvoiceLines).not.toHaveBeenCalled();
  });

  it("a failed read → error", async () => {
    calls.readMyInvoices.mockResolvedValueOnce({ ok: false, error: "error" });
    expect(await loadTarget(PROOF, { replaces: OLD }, FAMILIES, NOW)).toEqual({ ok: false, error: "error" });
    calls.readMyInvoices.mockResolvedValueOnce({ ok: true, value: [cancelled()] });
    calls.readMyInvoiceLines.mockResolvedValueOnce({ ok: false, error: "error" });
    expect(await loadTarget(PROOF, { replaces: OLD }, FAMILIES, NOW)).toEqual({ ok: false, error: "error" });
  });
});
