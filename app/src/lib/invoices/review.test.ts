/**
 * The review (plan 06 §14.6 b4.2; 06b-2 handoff "changed compares only the total"): what the preview shows and what
 * the send checks again, worked out on the server from her issuer, her bank details and `totals.ts` — never from a
 * client figure.
 * - `readReview`: the family (through `resolveInvoiceTarget`: its link, kind and earliest date), her issuer, the
 *   masks (never the full numbers), the totals, the period (the earliest to the latest shift date; the send date for
 *   expenses only), a date before the family's earliest allowed date (`too_early`, by line), the duplicate warning
 *   (a live invoice to the same family whose period overlaps), the correction rules (R4) and the daily cap.
 * - `checkSend`: her issuer, her full bank details and the family's link at send; `no_details`, `no_address`,
 *   `too_early`; `changed` when the total or anything the review showed (issuer, VAT, bank account, the lines, the
 *   period, the link) differs from what she reviewed.
 * - Logs carry codes only.
 *
 * BB-wave1-041126/06b4, 2026-11-12; 06b-4 rework (no week, no kind): BB-wave1-041126/06b4-server, 2026-11-12.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getNannyId, createAdminClient, resolveInvoiceTarget } = vi.hoisted(() => ({
  getNannyId: vi.fn(),
  createAdminClient: vi.fn(),
  resolveInvoiceTarget: vi.fn(),
}));
vi.mock("@/lib/actions/connection", () => ({ getNannyId }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient }));
vi.mock("./families", () => ({ resolveInvoiceTarget }));

import { fakeAdmin, type FakeAdmin, type Op } from "@/lib/payments/fake-admin.test-util";
import {
  ACTIVITIES,
  BANK_ROW,
  CONNECTION,
  DRAFT_IN,
  expense,
  INVOICE,
  invoiceRow,
  ISSUER,
  LINES,
  NANNY_ID,
  NANNY_USER,
  NOW,
  OTHER_PARENT,
  SECRETS,
  shift,
  TARGET,
  TRIAL_TARGET,
} from "./invoice-rows.test-util";
import { proveNanny, type NannyProof } from "./nanny-proof";
import { checkSend, newInvoiceId, readReview, reviewKey } from "./review";
import { invoiceDraftSchema, type InvoiceDraft } from "./validation-lines";

let f: FakeAdmin;
let proof: NannyProof;
let mine: Record<string, unknown>[];
let capRows: Record<string, unknown>[];
const spies: Array<ReturnType<typeof vi.spyOn>> = [];

const draftOf = (over: Readonly<Record<string, unknown>> = {}): InvoiceDraft =>
  invoiceDraftSchema(NOW).parse({ ...DRAFT_IN, invoiceId: INVOICE, ...over });

beforeEach(async () => {
  vi.stubEnv("NANNY_INVOICES_ENABLED", "true");
  mine = [];
  capRows = [];
  f = fakeAdmin({
    nanny_payment_details: BANK_ROW,
    nanny_invoices: (op: Op) => (op.filters.some(([fn]) => fn === "limit") ? capRows : mine),
  });
  f.rpcResults.nanny_invoice_issuer = { data: ISSUER, error: null };
  createAdminClient.mockReset().mockReturnValue(f.client);
  getNannyId.mockReset().mockResolvedValue({ nannyId: NANNY_ID, userId: NANNY_USER });
  resolveInvoiceTarget.mockReset().mockResolvedValue({ ok: true, value: TARGET });
  const p = await proveNanny();
  if (!p) throw new Error("fixture proof");
  proof = p;
  spies.splice(0);
  for (const level of ["error", "warn", "log", "info"] as const) spies.push(vi.spyOn(console, level).mockImplementation(() => {}));
});

afterEach(() => {
  expect(JSON.stringify(spies.flatMap((s) => s.mock.calls))).not.toMatch(SECRETS);
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("newInvoiceId", () => {
  it("a fresh uuid each time", () => {
    const a = newInvoiceId();
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(newInvoiceId()).not.toBe(a);
  });
});

describe("readReview", () => {
  it("the worked example: totals from the server's maths, masks only, the family, no warnings", async () => {
    const r = await readReview(proof, draftOf(), NOW);
    if (!r.ok) throw new Error(r.error);
    expect(r.value.totals).toEqual({ hours: 32, shiftsPence: 58_400, expensesPence: ACTIVITIES, vatPence: 0, netShiftsPence: 58_400, totalPence: 59_650 });
    expect(r.value.masks).toMatchObject({ accountName: "Sophie Taylor", sortCodeLast2: "33", accountLast4: "4321" });
    expect(JSON.stringify(r.value)).not.toMatch(/112233|87654321/);
    expect(r.value.target).toEqual(TARGET);
    expect(r.value.issuer).toMatchObject({ businessType: "sole_trader", tradingName: "Sophie Taylor", address: "1 Upper Street\nLondon\nN1 0AA" });
    expect(r.value.duplicates).toEqual([]);
    expect(r.value.replaces).toBeNull();
    expect(r.value.key).toMatch(/^[0-9a-f]{64}$/);
    expect(r.value.period).toEqual({ start: "2027-02-08", end: "2027-02-12" });
    expect(resolveInvoiceTarget).toHaveBeenCalledWith(proof, TARGET.targetId, NOW);
  });

  it("the period is the earliest to the latest shift date, over any length; the send date for expenses only (spec d, g)", async () => {
    const long = await readReview(proof, draftOf({ lines: [shift("2027-02-12", 6, 1800), shift("2027-01-25", 6, 1800), expense("travel", 640)] }), NOW);
    expect(long.ok && long.value.period).toEqual({ start: "2027-01-25", end: "2027-02-12" });
    const expensesOnly = await readReview(proof, draftOf({ lines: [expense("travel", 640)] }), NOW);
    expect(expensesOnly.ok && [expensesOnly.value.period, expensesOnly.value.totals]).toEqual([
      { start: "2027-02-15", end: "2027-02-15" },
      { hours: 0, shiftsPence: 0, expensesPence: 640, vatPence: 0, netShiftsPence: 0, totalPence: 640 },
    ]);
  });

  it("a date before the family's earliest allowed date → too_early, naming each such line; the earliest itself is fine", async () => {
    const lines = [shift("2027-01-25", 6, 1800), shift("2027-01-24", 6, 1800), expense("food", 100), shift("2026-12-01", 2, 1800)];
    expect(await readReview(proof, draftOf({ lines }), NOW)).toEqual({ ok: false, error: "too_early", lines: [1, 3] });
    resolveInvoiceTarget.mockResolvedValue({ ok: true, value: TRIAL_TARGET });
    expect(await readReview(proof, draftOf({ targetId: CONNECTION, lines: [shift("2027-02-02", 4, 1800)] }), NOW)).toEqual({ ok: false, error: "too_early", lines: [0] });
    expect((await readReview(proof, draftOf({ targetId: CONNECTION, lines: [shift("2027-02-03", 4, 1800), shift("2027-02-10", 6, 1800)] }), NOW)).ok).toBe(true);
  });

  it("VAT from her issuer: added on top, or included", async () => {
    f.rpcResults.nanny_invoice_issuer = { data: { ...ISSUER, vat_mode: "added", vat_rate_bp: 2000, vat_number: "GB123456789" }, error: null };
    const added = await readReview(proof, draftOf(), NOW);
    expect(added.ok && added.value.totals).toMatchObject({ vatPence: 11_680, totalPence: 71_330 });
    f.rpcResults.nanny_invoice_issuer = { data: { ...ISSUER, vat_mode: "included", vat_rate_bp: 2000, vat_number: "GB123456789" }, error: null };
    const included = await readReview(proof, draftOf(), NOW);
    expect(included.ok && included.value.totals).toMatchObject({ vatPence: 9733, totalPence: 59_650 });
  });

  it("no bank details yet: masks null (the setup asks), not a refusal", async () => {
    f.reads.nanny_payment_details = null;
    const r = await readReview(proof, draftOf(), NOW);
    expect(r.ok && r.value.masks).toBeNull();
  });

  it("no printable address: the issuer says so (the setup asks), not a refusal", async () => {
    f.rpcResults.nanny_invoice_issuer = { data: { ...ISSUER, address: null }, error: null };
    const r = await readReview(proof, draftOf(), NOW);
    expect(r.ok && r.value.issuer.address).toBeNull();
  });

  it("a name that can't print → no_contact", async () => {
    f.rpcResults.nanny_invoice_issuer = { data: { ...ISSUER, trading_name: null, name: null }, error: null };
    expect(await readReview(proof, draftOf(), NOW)).toEqual({ ok: false, error: "no_contact" });
  });

  it("the duplicate warning: her live invoices to this family whose period overlaps this one, on any date", async () => {
    const dup = invoiceRow();
    const sending = invoiceRow({ status: "sending", sent_at: null, family_email_status: null, nanny_email_status: null, created_at: "2027-02-15T09:58:00+00:00" });
    const touching = invoiceRow({ period_start: "2027-02-01", period_end: "2027-02-08" });
    const inside = invoiceRow({ period_start: "2027-02-10", period_end: "2027-02-10" });
    const trial = invoiceRow({ kind: "trial_shift", placement_id: null, connection_request_id: CONNECTION, period_start: "2027-02-12", period_end: "2027-02-20" });
    mine = [
      dup, sending, touching, inside, trial,
      invoiceRow({ status: "cancelled", cancelled_at: "2027-02-14T11:00:00+00:00", cancel_reason: "wrong_hours" }),
      invoiceRow({ status: "failed", sent_at: null, family_email_status: null, nanny_email_status: null }),
      invoiceRow({ status: "sending", sent_at: null, family_email_status: null, nanny_email_status: null, created_at: "2027-02-15T09:00:00+00:00" }),
      invoiceRow({ period_start: "2027-02-01", period_end: "2027-02-07" }),
      invoiceRow({ period_start: "2027-02-13", period_end: "2027-02-14" }),
      invoiceRow({ parent_user_id: OTHER_PARENT }),
    ];
    const r = await readReview(proof, draftOf(), NOW);
    expect(r.ok && r.value.duplicates).toEqual([dup, sending, touching, inside, trial].map((i) => ({ invoiceId: i.id, number: i.invoice_number })));
  });

  it("an invoice of expenses only overlaps an invoice whose period covers its send date", async () => {
    const covering = invoiceRow({ period_start: "2027-02-08", period_end: "2027-02-15" });
    mine = [covering, invoiceRow()];
    const r = await readReview(proof, draftOf({ lines: [expense("travel", 640)] }), NOW);
    expect(r.ok && r.value.duplicates).toEqual([{ invoiceId: covering.id, number: covering.invoice_number }]);
  });

  describe("a correction (R4)", () => {
    const old = () => invoiceRow({ status: "cancelled", cancelled_at: "2027-02-14T11:00:00+00:00", cancel_reason: "wrong_hours" });

    it("her own cancelled invoice to the same family: named in the review", async () => {
      const o = old();
      mine = [o];
      const r = await readReview(proof, draftOf({ replacesInvoiceId: o.id }), NOW);
      expect(r.ok && r.value.replaces).toEqual({ invoiceId: o.id, number: o.invoice_number });
    });

    it("not hers, not cancelled, or another family's → bad_replaces", async () => {
      const sent = invoiceRow();
      const other = invoiceRow({ status: "cancelled", cancelled_at: "2027-02-14T11:00:00+00:00", cancel_reason: "other", parent_user_id: OTHER_PARENT });
      mine = [sent, other];
      for (const id of ["b0600000-0000-4000-8000-00000000ffff", sent.id, other.id]) {
        expect(await readReview(proof, draftOf({ replacesInvoiceId: id }), NOW)).toEqual({ ok: false, error: "bad_replaces" });
      }
    });

    it("already corrected by a live invoice → already_replaced; a failed correction doesn't count", async () => {
      const o = old();
      mine = [o, invoiceRow({ replaces_invoice_id: o.id })];
      expect(await readReview(proof, draftOf({ replacesInvoiceId: o.id }), NOW)).toEqual({ ok: false, error: "already_replaced" });
      mine = [o, invoiceRow({ replaces_invoice_id: o.id, status: "failed", sent_at: null, family_email_status: null, nanny_email_status: null })];
      expect((await readReview(proof, draftOf({ replacesInvoiceId: o.id }), NOW)).ok).toBe(true);
    });
  });

  it("the daily cap reached → cap", async () => {
    capRows = Array.from({ length: 10 }, () => invoiceRow({ created_at: "2027-02-15T08:00:00+00:00" }));
    expect(await readReview(proof, draftOf(), NOW)).toEqual({ ok: false, error: "cap" });
    capRows = capRows.slice(1);
    expect((await readReview(proof, draftOf(), NOW)).ok).toBe(true);
  });

  it("the family read's refusal passes through (not_hers, no_contact …)", async () => {
    resolveInvoiceTarget.mockResolvedValue({ ok: false, error: "not_hers" });
    expect(await readReview(proof, draftOf(), NOW)).toEqual({ ok: false, error: "not_hers" });
  });

  it("a failed read → error", async () => {
    f.rpcResults.nanny_invoice_issuer = { data: null, error: { message: "boom", code: "XX000" } };
    expect(await readReview(proof, draftOf(), NOW)).toEqual({ ok: false, error: "error" });
    f.rpcResults.nanny_invoice_issuer = { data: ISSUER, error: null };
    f.readErrors.nanny_invoices = { message: "down", code: "08006" };
    expect(await readReview(proof, draftOf(), NOW)).toEqual({ ok: false, error: "error" });
  });

  it("switch off → invoices_disabled, nothing read", async () => {
    vi.stubEnv("NANNY_INVOICES_ENABLED", "false");
    expect(await readReview(proof, draftOf(), NOW)).toEqual({ ok: false, error: "invoices_disabled" });
    expect(createAdminClient).not.toHaveBeenCalled();
    expect(resolveInvoiceTarget).not.toHaveBeenCalled();
  });
});

describe("reviewKey", () => {
  const issuer = {
    businessType: "sole_trader" as const, name: "Sophie Taylor", tradingName: "Sophie Taylor", tradingNameSource: "name" as const,
    address: "1 Upper Street\nLondon\nN1 0AA", companyName: null, companyNumber: null, registeredOffice: null, partnershipName: null,
    vat: { mode: "none" as const, rateBp: null, number: null }, businessUpdatedAt: "2027-02-01T09:00:00.111111+00:00",
  };
  const totals = { hours: 32, shiftsPence: 58_400, expensesPence: ACTIVITIES, vatPence: 0, netShiftsPence: 58_400, totalPence: 59_650 };
  const link = { targetId: TARGET.targetId, kind: TARGET.kind };
  const period = { start: "2027-02-08", end: "2027-02-12" };
  const base = { draft: draftOf(), link, period, issuer, accountLast4: "4321", totals };

  it("the same facts give the same key; the invoice id, the id she picked the family by and the business version don't count", () => {
    expect(reviewKey(base)).toBe(reviewKey({ ...base, draft: draftOf({ invoiceId: "b0600000-0000-4000-8000-00000000aaaa" }) }));
    expect(reviewKey(base)).toBe(reviewKey({ ...base, draft: draftOf({ targetId: CONNECTION }) }));
    expect(reviewKey(base)).toBe(reviewKey({ ...base, issuer: { ...issuer, businessUpdatedAt: "2027-02-14T09:00:00+00:00" } }));
  });

  it("anything she reviewed changes it: a line, the period, the link, the issuer, VAT, the account, a figure", () => {
    const key = reviewKey(base);
    const changed = [
      { ...base, period: { ...period, end: "2027-02-13" } },
      { ...base, link: { targetId: CONNECTION, kind: "trial_shift" as const } },
      { ...base, draft: draftOf({ replacesInvoiceId: "b0600000-0000-4000-8000-00000000aaaa" }) },
      { ...base, draft: draftOf({ lines: [...LINES.slice(0, 5), shift("2027-02-10", 2, 2300, "evening, agreed rate"), LINES[6]] }) },
      { ...base, issuer: { ...issuer, tradingName: "Taylor Childcare" } },
      { ...base, issuer: { ...issuer, address: "7 New Road\nLondon\nN1 1AA" } },
      { ...base, issuer: { ...issuer, vat: { mode: "included" as const, rateBp: 2000, number: "GB123456789" } } },
      { ...base, accountLast4: "9999" },
      { ...base, accountLast4: null },
      { ...base, totals: { ...totals, totalPence: 59_651 } },
    ];
    for (const facts of changed) expect(reviewKey(facts)).not.toBe(key);
  });
});

describe("checkSend", () => {
  const draft = () => draftOf();
  const reviewed = async () => {
    const r = await readReview(proof, draft(), NOW);
    if (!r.ok) throw new Error(r.error);
    return { totalPence: r.value.totals.totalPence, reviewKey: r.value.key };
  };

  it("unchanged since the review: her issuer and full bank details for the PDF, and the family's link", async () => {
    const expected = await reviewed();
    const r = await checkSend(proof, draft(), expected, NOW);
    if (!r.ok) throw new Error(r.error);
    expect(r.value.details).toEqual({ accountName: "Sophie Taylor", sortCode: "112233", accountNumber: "87654321", accountLast4: "4321" });
    expect(r.value.issuer.tradingName).toBe("Sophie Taylor");
    expect(r.value.target).toEqual(TARGET);
    expect(resolveInvoiceTarget).toHaveBeenLastCalledWith(proof, TARGET.targetId, NOW);
  });

  it("the family's link moved since the review (a hire made after a trial) → changed", async () => {
    resolveInvoiceTarget.mockResolvedValue({ ok: true, value: TRIAL_TARGET });
    const lines = [shift("2027-02-08", 6, 1800)];
    const r = await readReview(proof, draftOf({ targetId: CONNECTION, lines }), NOW);
    if (!r.ok) throw new Error(r.error);
    resolveInvoiceTarget.mockResolvedValue({ ok: true, value: TARGET });
    expect(await checkSend(proof, draftOf({ targetId: CONNECTION, lines }), { totalPence: r.value.totals.totalPence, reviewKey: r.value.key }, NOW))
      .toEqual({ ok: false, error: "changed" });
  });

  it("an invoice of expenses only reviewed before midnight and sent after → changed (its period is the send date)", async () => {
    const lines = [expense("travel", 640)];
    const r = await readReview(proof, draftOf({ lines }), NOW);
    if (!r.ok) throw new Error(r.error);
    const sealed = { totalPence: r.value.totals.totalPence, reviewKey: r.value.key };
    expect((await checkSend(proof, draftOf({ lines }), sealed, NOW)).ok).toBe(true);
    expect(await checkSend(proof, draftOf({ lines }), sealed, new Date("2027-02-16T10:00:00Z"))).toEqual({ ok: false, error: "changed" });
  });

  it("a date before the family's earliest allowed date at send → too_early (its first day moved); the family's refusal passes through", async () => {
    const expected = await reviewed();
    resolveInvoiceTarget.mockResolvedValue({ ok: true, value: { ...TARGET, earliest: "2027-02-10" } });
    expect(await checkSend(proof, draft(), expected, NOW)).toEqual({ ok: false, error: "too_early", lines: [0, 1] });
    resolveInvoiceTarget.mockResolvedValue({ ok: false, error: "not_hers" });
    expect(await checkSend(proof, draft(), expected, NOW)).toEqual({ ok: false, error: "not_hers" });
  });

  it("no bank details → no_details; no printable address → no_address; no printable name → no_contact", async () => {
    const expected = await reviewed();
    f.reads.nanny_payment_details = null;
    expect(await checkSend(proof, draft(), expected, NOW)).toEqual({ ok: false, error: "no_details" });
    f.reads.nanny_payment_details = BANK_ROW;
    f.rpcResults.nanny_invoice_issuer = { data: { ...ISSUER, address: null }, error: null };
    expect(await checkSend(proof, draft(), expected, NOW)).toEqual({ ok: false, error: "no_address" });
    f.rpcResults.nanny_invoice_issuer = { data: { ...ISSUER, trading_name: null }, error: null };
    expect(await checkSend(proof, draft(), expected, NOW)).toEqual({ ok: false, error: "no_contact" });
  });

  it("her VAT changed since the review → changed (the total moved)", async () => {
    const expected = await reviewed();
    f.rpcResults.nanny_invoice_issuer = { data: { ...ISSUER, vat_mode: "added", vat_rate_bp: 2000, vat_number: "GB123456789" }, error: null };
    expect(await checkSend(proof, draft(), expected, NOW)).toEqual({ ok: false, error: "changed" });
  });

  it("her trading name, or VAT included at the same total, changed since → changed (06b-2 handoff L2)", async () => {
    const expected = await reviewed();
    f.rpcResults.nanny_invoice_issuer = { data: { ...ISSUER, trading_name: "Taylor Childcare", trading_name_source: "business" }, error: null };
    expect(await checkSend(proof, draft(), expected, NOW)).toEqual({ ok: false, error: "changed" });
    f.rpcResults.nanny_invoice_issuer = { data: { ...ISSUER, vat_mode: "included", vat_rate_bp: 2000, vat_number: "GB123456789" }, error: null };
    expect(await checkSend(proof, draft(), expected, NOW)).toEqual({ ok: false, error: "changed" });
  });

  it("her bank account changed since → changed", async () => {
    const expected = await reviewed();
    f.reads.nanny_payment_details = { ...BANK_ROW, account_number: "11119999", account_last4: "9999" };
    expect(await checkSend(proof, draft(), expected, NOW)).toEqual({ ok: false, error: "changed" });
  });

  it("a client total or key that isn't the server's → changed", async () => {
    const expected = await reviewed();
    expect(await checkSend(proof, draft(), { ...expected, totalPence: 1 }, NOW)).toEqual({ ok: false, error: "changed" });
    expect(await checkSend(proof, draft(), { ...expected, reviewKey: "0".repeat(64) }, NOW)).toEqual({ ok: false, error: "changed" });
    expect(await checkSend(proof, draftOf({ lines: LINES.slice(0, 6) }), expected, NOW)).toEqual({ ok: false, error: "changed" });
  });

  it("a failed read → error; switch off → invoices_disabled", async () => {
    const expected = await reviewed();
    f.readErrors.nanny_payment_details = { message: "down", code: "08006" };
    expect(await checkSend(proof, draft(), expected, NOW)).toEqual({ ok: false, error: "error" });
    vi.stubEnv("NANNY_INVOICES_ENABLED", "");
    expect(await checkSend(proof, draft(), expected, NOW)).toEqual({ ok: false, error: "invoices_disabled" });
  });
});
