/**
 * The Business section's server leaf (plan 06 §14.6 b3.3; A1, A2; 06b-2 handoff "keep `parentUserId` and every bank
 * field except the masks out of RSC props").
 * - Switch off ("", "false", "TRUE", "1"): it renders nothing and reads nothing — not the session, not a client.
 * - Switch on: it reads her issuer and her **masked** bank details for the session's nanny and hands the client
 *   section exactly two props. The **RSC payload** — the props serialised to the browser — holds no full sort code or
 *   account number, no id, no proof, no family field, whatever extra fields the reads carried.
 * - A failed read or no nanny session: a plain message, never an empty or half section.
 *
 * BB-wave1-041126/06b3-build, 2026-11-07.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { isValidElement, type ReactElement } from "react";

const { getNannyId, createAdminClient } = vi.hoisted(() => ({ getNannyId: vi.fn(), createAdminClient: vi.fn() }));
vi.mock("@/lib/actions/connection", () => ({ getNannyId }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/invoices/actions/save-business-details", () => ({ saveBusinessDetails: vi.fn() }));
vi.mock("@/lib/invoices/actions/save-payment-details", () => ({ savePaymentDetails: vi.fn() }));

import { fakeAdmin, type FakeAdmin } from "@/lib/payments/fake-admin.test-util";
import { BusinessSettingsLazy } from "./BusinessSettingsLazy";
import { BusinessSettingsLeaf, LOAD_FAILED } from "./BusinessSettingsLeaf";

const NANNY_ID = "b0600000-0000-4000-8000-000000000101";
const USER_ID = "b0600000-0000-4000-8000-000000000001";
const PARENT_USER_ID = "b0600000-0000-4000-8000-000000000011";
const ISSUER = {
  business_type: "sole_trader", name: "Sophie Taylor", trading_name: "Sophie Taylor", trading_name_source: "name",
  address: "1 Upper Street\nLondon\nN1 0AA", address_source: "verification", company_name: null, company_number: null,
  registered_office: null, partnership_name: null, vat_mode: "none", vat_rate_bp: null, vat_number: null,
  // what a wrong function body might add: never passed on
  account_number: "87654321", sort_code: "112233", parent_user_id: PARENT_USER_ID, nanny_id: NANNY_ID,
};
const MASKED_ROW = {
  account_name: "Sophie Taylor", sort_code_last2: "33", account_last4: "4321", updated_at: "2027-02-15T10:00:00Z",
  // what a wrong select might add: never passed on
  sort_code: "112233", account_number: "87654321", nanny_id: NANNY_ID,
};

let f: FakeAdmin;
let selects: Array<[string, string]>;

beforeEach(() => {
  vi.stubEnv("NANNY_INVOICES_ENABLED", "true");
  f = fakeAdmin({ nanny_payment_details: MASKED_ROW });
  f.rpcResults.nanny_invoice_issuer = { data: ISSUER, error: null };
  selects = [];
  const client = f.client as unknown as { from: (t: string) => { select: (c: string) => unknown } };
  const from = client.from;
  client.from = (table: string) => {
    const builder = from(table);
    const select = builder.select;
    return { ...builder, select: (columns: string) => (selects.push([table, columns]), select(columns)) };
  };
  createAdminClient.mockReset().mockReturnValue(f.client);
  getNannyId.mockReset().mockResolvedValue({ nannyId: NANNY_ID, userId: USER_ID });
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("BusinessSettingsLeaf — switch off", () => {
  it.each(["", "false", "TRUE", "1"])("%j → renders nothing and reads nothing", async (value) => {
    vi.stubEnv("NANNY_INVOICES_ENABLED", value);
    expect(await BusinessSettingsLeaf()).toBeNull();
    expect(getNannyId).not.toHaveBeenCalled();
    expect(createAdminClient).not.toHaveBeenCalled();
  });
});

describe("BusinessSettingsLeaf — switch on", () => {
  it("reads her issuer and her masks for the session's nanny, then renders the client section (loaded lazily)", async () => {
    const out = (await BusinessSettingsLeaf()) as ReactElement;
    expect(isValidElement(out)).toBe(true);
    expect(out.type).toBe(BusinessSettingsLazy);
    expect(f.rpcCalls).toEqual([{ fn: "nanny_invoice_issuer", args: { p_nanny: NANNY_ID } }]);
    expect(selects).toEqual([["nanny_payment_details", "account_name, sort_code_last2, account_last4, updated_at"]]);
    expect(f.ops.find((o) => o.table === "nanny_payment_details")?.filters).toEqual([["eq", "nanny_id", NANNY_ID]]);
  });

  it("the RSC payload: two props, their keys pinned, masks only — no full number, id, proof or family field", async () => {
    const out = (await BusinessSettingsLeaf()) as ReactElement<Record<string, unknown>>;
    const payload = JSON.stringify(out.props);
    expect(Object.keys(out.props).sort()).toEqual(["bank", "business"]);
    expect(Object.keys(out.props.bank as object).sort()).toEqual(["accountLast4", "accountName", "sortCodeLast2"]);
    expect(Object.keys(out.props.business as object).sort()).toEqual([
      "address", "addressSource", "businessType", "companyName", "companyNumber", "name", "partnershipName",
      "registeredOffice", "tradingName", "vatMode", "vatNumber", "vatRateBp",
    ]);
    for (const secret of ["112233", "11-22-33", "87654321", NANNY_ID, USER_ID, PARENT_USER_ID, "nanny_proof", "parentUserId", "updatedAt"]) {
      expect(payload).not.toContain(secret);
    }
    expect(out.props.bank).toEqual({ accountName: "Sophie Taylor", sortCodeLast2: "33", accountLast4: "4321" });
  });

  it("zero setup renders the defaults with their sources (A2)", async () => {
    f.reads.nanny_payment_details = null;
    render(await BusinessSettingsLeaf());
    expect(await screen.findByText("Sole trader")).toBeInTheDocument();
    expect(screen.getByText("(your name)")).toBeInTheDocument();
    expect(screen.getByText("(from your verification)")).toBeInTheDocument();
    expect(screen.getByText("Not VAT registered")).toBeInTheDocument();
    expect(screen.getByText("Not added yet")).toBeInTheDocument();
  });

  it("no bank details saved → bank: null", async () => {
    f.reads.nanny_payment_details = null;
    const out = (await BusinessSettingsLeaf()) as ReactElement<Record<string, unknown>>;
    expect(out.props.bank).toBeNull();
  });

  it("no nanny session → the plain message, no read", async () => {
    getNannyId.mockResolvedValueOnce(null);
    render(await BusinessSettingsLeaf());
    expect(screen.getByText(LOAD_FAILED)).toBeInTheDocument();
    expect(f.rpcCalls).toEqual([]);
  });

  it("a failed read → the plain message, never a half section", async () => {
    f.rpcResults.nanny_invoice_issuer = { data: null, error: { message: "boom", code: "XX000" } };
    render(await BusinessSettingsLeaf());
    expect(screen.getByText(LOAD_FAILED)).toBeInTheDocument();
    expect(screen.queryByText("Business type")).toBeNull();
    cleanup();
    f.rpcResults.nanny_invoice_issuer = { data: ISSUER, error: null };
    f.readErrors.nanny_payment_details = { message: "boom" };
    render(await BusinessSettingsLeaf());
    expect(screen.getByText(LOAD_FAILED)).toBeInTheDocument();
  });
});
