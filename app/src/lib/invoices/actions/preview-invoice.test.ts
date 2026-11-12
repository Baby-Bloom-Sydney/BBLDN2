/**
 * `previewInvoice` — the review step (plan 06 §14.6 b4.2; old step 12; brief §3 nanny 6, §0a A, C). Through the real
 * store and review, a fake service client and a fake session client; the family read is stubbed (its own spec is
 * `families.test.ts`).
 * - Switch off → `invoices_disabled` before the session or any read; no nanny session → `signed_out`.
 * - The nanny is the session's, never the input's; the figures are the server's (`totals.ts` with her issuer), never
 *   the client's; the invoice id is minted here, never taken from the input.
 * - It returns the family (name, a masked email, area), her issuer read-only, the masks only, `needsPaymentDetails`,
 *   `needsAddress` (with her home address's version for the setup's save), `expectedTotalPence`, the review key, the
 *   duplicate warning and the invoice a correction replaces.
 * - Refusals carry a fixed plain message; a draft the schema refused carries its fields.
 * - No full bank number in the reply; nothing personal in a log.
 *
 * BB-wave1-041126/06b4, 2026-11-12.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getNannyId, createAdminClient, sessionClient, resolveInvoiceTarget } = vi.hoisted(() => ({
  getNannyId: vi.fn(),
  createAdminClient: vi.fn(),
  sessionClient: vi.fn(),
  resolveInvoiceTarget: vi.fn(),
}));
vi.mock("@/lib/actions/connection", () => ({ getNannyId }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient }));
vi.mock("@/lib/supabase/server", () => ({ createClient: sessionClient }));
vi.mock("../families", () => ({ resolveInvoiceTarget }));

import { fakeAdmin, type FakeAdmin, type Op } from "@/lib/payments/fake-admin.test-util";
import {
  BANK_ROW,
  DRAFT_IN,
  INVOICE,
  invoiceRow,
  ISSUER,
  NANNY_ID,
  NANNY_USER,
  NOW,
  SECRETS,
  TARGET,
} from "../invoice-rows.test-util";
import { LINE_MESSAGES } from "../validation-lines";
import { previewInvoice } from "./preview-invoice";

const HOME_VERSION = "2027-02-01T09:00:00.333333+00:00";
let f: FakeAdmin;
let session: FakeAdmin;
let mine: Record<string, unknown>[];
const spies: Array<ReturnType<typeof vi.spyOn>> = [];

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  vi.stubEnv("NANNY_INVOICES_ENABLED", "true");
  mine = [];
  f = fakeAdmin({ nanny_payment_details: BANK_ROW, nanny_invoices: (op: Op) => (op.filters.some(([fn]) => fn === "limit") ? [] : mine) });
  f.rpcResults.nanny_invoice_issuer = { data: ISSUER, error: null };
  createAdminClient.mockReset().mockReturnValue(f.client);
  session = fakeAdmin({ nanny_home_addresses: { line1: "", town: "London", postcode: "N1 0AA", updated_at: HOME_VERSION } });
  sessionClient.mockReset().mockReturnValue(session.client);
  getNannyId.mockReset().mockResolvedValue({ nannyId: NANNY_ID, userId: NANNY_USER });
  resolveInvoiceTarget.mockReset().mockResolvedValue({ ok: true, value: TARGET });
  spies.splice(0);
  for (const level of ["error", "warn", "log", "info"] as const) spies.push(vi.spyOn(console, level).mockImplementation(() => {}));
});

afterEach(() => {
  expect(JSON.stringify(spies.flatMap((s) => s.mock.calls))).not.toMatch(SECRETS);
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("gates", () => {
  it.each(["", "false", "TRUE", "1"])("switch %j → invoices_disabled before the session or any read", async (value) => {
    vi.stubEnv("NANNY_INVOICES_ENABLED", value);
    expect(await previewInvoice(DRAFT_IN)).toEqual({ ok: false, error: "invoices_disabled", message: "This isn't available right now." });
    expect(getNannyId).not.toHaveBeenCalled();
    expect(createAdminClient).not.toHaveBeenCalled();
    expect(sessionClient).not.toHaveBeenCalled();
    expect(resolveInvoiceTarget).not.toHaveBeenCalled();
  });

  it("no nanny session → signed_out, nothing read", async () => {
    getNannyId.mockResolvedValueOnce(null);
    expect(await previewInvoice(DRAFT_IN)).toMatchObject({ ok: false, error: "signed_out" });
    expect(f.rpcCalls).toEqual([]);
    expect(resolveInvoiceTarget).not.toHaveBeenCalled();
  });
});

describe("the draft", () => {
  it("not an object → invalid", async () => {
    for (const input of [null, "x", 42, []]) expect(await previewInvoice(input)).toMatchObject({ ok: false, error: "invalid" });
    expect(resolveInvoiceTarget).not.toHaveBeenCalled();
  });

  it("refused by field, with the schema's plain messages; nothing read", async () => {
    const r = await previewInvoice({ ...DRAFT_IN, lines: [{ kind: "shift", date: "2027-02-08", hours: 0.1, ratePence: 1800, description: null }] });
    expect(r).toEqual({ ok: false, error: "invalid", message: "Please check the details marked below.", fields: { "lines.0.hours": LINE_MESSAGES.hourStep } });
    expect(resolveInvoiceTarget).not.toHaveBeenCalled();
  });

  it("a week that hasn't happened yet → future", async () => {
    const r = await previewInvoice({ ...DRAFT_IN, periodStart: "2027-02-22", lines: [{ kind: "shift", date: "2027-02-22", hours: 6, ratePence: 1800, description: null }] });
    expect(r).toMatchObject({ ok: false, error: "future", message: LINE_MESSAGES.future });
  });
});

describe("the review", () => {
  it("the worked example: the server's figures, the family, her issuer, masks only", async () => {
    const r = await previewInvoice(DRAFT_IN);
    if (!r.ok) throw new Error(r.error);
    const p = r.preview;
    expect(p.invoiceId).toMatch(/^[0-9a-f-]{36}$/);
    expect(p.reviewKey).toMatch(/^[0-9a-f]{64}$/);
    expect(p.expectedTotalPence).toBe(59_650);
    expect(p.totals).toEqual({ hours: 32, shiftsPence: 58_400, expensesPence: 1250, vatPence: 0, netShiftsPence: 58_400, totalPence: 59_650 });
    expect(p.vat).toEqual({ mode: "none", rateBp: null });
    expect(p.recipient).toEqual({ familyName: "Olivia Hartley", emailHint: "admin+b06-11@…", area: "Islington" });
    expect(p.issuer).toEqual({
      businessType: "sole_trader", name: "Sophie Taylor", tradingName: "Sophie Taylor", tradingNameSource: "name",
      address: "1 Upper Street\nLondon\nN1 0AA", companyName: null, companyNumber: null, registeredOffice: null, partnershipName: null,
      vat: { mode: "none", rateBp: null, number: null },
    });
    expect(p.bank).toEqual({ accountName: "Sophie Taylor", sortCodeLast2: "33", accountLast4: "4321" });
    expect(p).toMatchObject({ needsPaymentDetails: false, needsAddress: false, addressVersion: null, duplicates: [], replaces: null });
    expect(JSON.stringify(r)).not.toMatch(/112233|87654321|admin\+b06-11@babybloom/);
    expect(sessionClient).not.toHaveBeenCalled();
  });

  it("the nanny is the session's; the invoice id is minted here; client figures are ignored", async () => {
    const r = await previewInvoice({ ...DRAFT_IN, nannyId: "b0600000-0000-4000-8000-000000000102", invoiceId: INVOICE, expectedTotalPence: 1, totals: { totalPence: 1 } });
    if (!r.ok) throw new Error(r.error);
    expect(r.preview.invoiceId).not.toBe(INVOICE);
    expect(r.preview.expectedTotalPence).toBe(59_650);
    expect(f.rpcCalls.find((c) => c.fn === "nanny_invoice_issuer")?.args).toEqual({ p_nanny: NANNY_ID });
    expect(resolveInvoiceTarget.mock.calls[0]?.[0]).toMatchObject({ nannyId: NANNY_ID });
    const second = await previewInvoice(DRAFT_IN);
    expect(second.ok && second.preview.invoiceId).not.toBe(r.preview.invoiceId);
  });

  it("no bank details: needsPaymentDetails, bank null", async () => {
    f.reads.nanny_payment_details = null;
    const r = await previewInvoice(DRAFT_IN);
    expect(r.ok && r.preview).toMatchObject({ needsPaymentDetails: true, bank: null });
  });

  it("no printable address: needsAddress, with her home row's version for the setup's save", async () => {
    f.rpcResults.nanny_invoice_issuer = { data: { ...ISSUER, address: null }, error: null };
    const r = await previewInvoice(DRAFT_IN);
    expect(r.ok && r.preview).toMatchObject({ needsAddress: true, addressVersion: HOME_VERSION });
    expect(session.ops[0]?.filters).toContainEqual(["eq", "user_id", NANNY_USER]);
    session.reads.nanny_home_addresses = null;
    const none = await previewInvoice(DRAFT_IN);
    expect(none.ok && none.preview).toMatchObject({ needsAddress: true, addressVersion: null });
    session.readErrors.nanny_home_addresses = { message: "down" };
    expect(await previewInvoice(DRAFT_IN)).toMatchObject({ ok: false, error: "error" });
  });

  it("the duplicate warning and the replaced invoice", async () => {
    const dup = invoiceRow();
    const old = invoiceRow({ status: "cancelled", cancelled_at: "2027-02-14T11:00:00+00:00", cancel_reason: "wrong_hours" });
    mine = [dup, old];
    const r = await previewInvoice({ ...DRAFT_IN, replacesInvoiceId: old.id });
    expect(r.ok && r.preview.duplicates).toEqual([{ invoiceId: dup.id, number: dup.invoice_number }]);
    expect(r.ok && r.preview.replaces).toEqual({ invoiceId: old.id, number: old.invoice_number });
  });

  it.each([
    ["not_hers", "You can only invoice families you work with."],
    ["no_trial", "This family has no Trial Shift date to invoice."],
    ["no_contact", "A name or email this invoice needs is missing."],
  ] as const)("the family read's %s → a plain message", async (error, message) => {
    resolveInvoiceTarget.mockResolvedValueOnce({ ok: false, error });
    expect(await previewInvoice(DRAFT_IN)).toEqual({ ok: false, error, message });
  });

  it("a failed read → error, with the general message", async () => {
    f.rpcResults.nanny_invoice_issuer = { data: null, error: { message: "boom Sophie", code: "XX000" } };
    expect(await previewInvoice(DRAFT_IN)).toEqual({ ok: false, error: "error", message: "Something went wrong. Please try again." });
  });

  it("writes nothing", async () => {
    await previewInvoice(DRAFT_IN);
    expect(f.ops.filter((o) => o.kind !== "select")).toEqual([]);
    expect(f.rpcCalls.map((c) => c.fn)).toEqual(["nanny_invoice_issuer"]);
  });
});
