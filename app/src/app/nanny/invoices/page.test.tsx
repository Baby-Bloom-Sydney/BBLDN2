/**
 * `/nanny/invoices`, the server page (plan 06 old step 14, §14.6 b4.4; brief §8, §9.1; R20):
 * - Switch off ("", "false", "TRUE", "1"): `notFound()` before any auth or read (the `payouts-hidden` pattern).
 * - No nanny session (a parent, an admin, nobody): `notFound()` — the invoices are the nanny's side only (R20).
 * - On: her own invoices, her business (the type and trading name) and her bank details **masked**. The **RSC
 *   payload** — the props serialised to the browser — holds the rows' strings, the invoice ids, the masks and no
 *   other id, no full sort code or account number, no version, whatever extra the reads carried.
 * - A failed read: the page still renders (header, "New invoice") with one plain message.
 * - `?notice=` shows only the three send answers that land here.
 *
 * BB-wave1-041126/06b4, 2026-11-12.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isValidElement, type ReactElement } from "react";

const calls = vi.hoisted(() => ({
  proveNanny: vi.fn(),
  readMyInvoices: vi.fn(),
  readMaskedDetails: vi.fn(),
  readIssuer: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));
vi.mock("@/lib/invoices/nanny-proof", () => ({ proveNanny: calls.proveNanny }));
vi.mock("@/lib/invoices/store", () => ({ readMyInvoices: calls.readMyInvoices, readMaskedDetails: calls.readMaskedDetails }));
vi.mock("@/lib/invoices/store-business", () => ({ readIssuer: calls.readIssuer }));
vi.mock("@/lib/invoices/actions/cancel-invoice", () => ({ cancelInvoice: vi.fn() }));
vi.mock("@/lib/invoices/actions/resend-invoice-email", () => ({ resendInvoiceEmail: vi.fn() }));

import { myInvoiceRow, issuerReply } from "@/lib/invoices/store-map-lines";
import { invoiceRow, ISSUER, NANNY_ID, NANNY_USER, PARENT_USER, PLACEMENT } from "@/lib/invoices/invoice-rows.test-util";
import NannyInvoicesPage, { maxDuration } from "./page";
import { InvoicesClient } from "./InvoicesClient";

const PROOF = { kind: "nanny_proof", nannyId: NANNY_ID, userId: NANNY_USER };
const MASKS = { accountName: "Sophie Taylor", sortCodeLast2: "33", accountLast4: "4321", updatedAt: "2027-02-01T09:00:00.222Z" };

beforeEach(() => {
  vi.stubEnv("NANNY_INVOICES_ENABLED", "true");
  calls.proveNanny.mockReset().mockResolvedValue(PROOF);
  calls.readMyInvoices.mockReset().mockResolvedValue({ ok: true, value: [myInvoiceRow.parse(invoiceRow())] });
  calls.readMaskedDetails.mockReset().mockResolvedValue({ ok: true, value: MASKS });
  calls.readIssuer.mockReset().mockResolvedValue({ ok: true, value: issuerReply.parse(ISSUER) });
});
afterEach(() => vi.unstubAllEnvs());

const render = async (searchParams: Record<string, string | string[] | undefined> = {}) =>
  (await NannyInvoicesPage({ searchParams })) as ReactElement<Record<string, unknown>>;

describe("/nanny/invoices — switch off", () => {
  it.each(["", "false", "TRUE", "1"])("%j → notFound() before any auth or read", async (value) => {
    vi.stubEnv("NANNY_INVOICES_ENABLED", value);
    await expect(render()).rejects.toThrow("NOT_FOUND");
    expect(calls.proveNanny).not.toHaveBeenCalled();
    expect(calls.readMyInvoices).not.toHaveBeenCalled();
    expect(calls.readMaskedDetails).not.toHaveBeenCalled();
    expect(calls.readIssuer).not.toHaveBeenCalled();
  });
});

describe("/nanny/invoices — switch on", () => {
  it("lives up to 30 seconds (a cancel sends two emails from here)", () => {
    expect(maxDuration).toBe(30);
  });

  it("no nanny session (a parent, an admin, nobody) → notFound(), nothing read", async () => {
    calls.proveNanny.mockResolvedValueOnce(null);
    await expect(render()).rejects.toThrow("NOT_FOUND");
    expect(calls.readMyInvoices).not.toHaveBeenCalled();
  });

  it("reads her invoices, masks and business with the session's proof, and renders the client", async () => {
    const out = await render();
    expect(isValidElement(out)).toBe(true);
    expect(out.type).toBe(InvoicesClient);
    for (const read of [calls.readMyInvoices, calls.readMaskedDetails, calls.readIssuer]) expect(read).toHaveBeenCalledWith(PROOF);
  });

  it("the RSC payload: rows, masks and her business only — no other id, no full numbers, no version", async () => {
    calls.readMaskedDetails.mockResolvedValueOnce({ ok: true, value: { ...MASKS, sortCode: "112233", accountNumber: "87654321", nannyId: NANNY_ID } });
    const out = await render();
    expect(Object.keys(out.props).sort()).toEqual(["bank", "business", "loadFailed", "notice", "rows"]);
    expect(out.props.bank).toEqual({ accountName: "Sophie Taylor", sortCodeLast2: "33", accountLast4: "4321" });
    expect(out.props.business).toEqual({ businessType: "Sole trader", tradingName: null });
    const payload = JSON.stringify(out.props);
    for (const secret of [NANNY_ID, NANNY_USER, PARENT_USER, PLACEMENT, "112233", "87654321", "nanny_proof", "2027-02-01T09:00", "Upper Street"]) {
      expect(payload).not.toContain(secret);
    }
  });

  it("no bank details yet → bank null (the card says Not added; New invoice stays available)", async () => {
    calls.readMaskedDetails.mockResolvedValueOnce({ ok: true, value: null });
    expect((await render()).props.bank).toBeNull();
  });

  it("a trading name she entered is shown; her own name isn't a trading name", async () => {
    calls.readIssuer.mockResolvedValueOnce({ ok: true, value: issuerReply.parse({ ...ISSUER, trading_name: "Little Steps", trading_name_source: "business" }) });
    expect((await render()).props.business).toEqual({ businessType: "Sole trader", tradingName: "Little Steps" });
  });

  it.each(["readMyInvoices", "readMaskedDetails", "readIssuer"] as const)("a failed %s → the page with one plain message, no rows", async (read) => {
    calls[read].mockResolvedValueOnce({ ok: false, error: "error" });
    const out = await render();
    expect(out.props).toMatchObject({ loadFailed: true, rows: [], bank: null, business: null });
  });

  it("?notice= → the plain message for a send answer that lands here; anything else ignored", async () => {
    expect((await render({ notice: "not_recorded" })).props.notice).toMatch(/^Your invoice was emailed/);
    expect((await render({ notice: "<script>" })).props.notice).toBeNull();
    expect((await render({ notice: ["in_progress", "x"] })).props.notice).toBeNull();
  });
});
