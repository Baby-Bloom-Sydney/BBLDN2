/**
 * The Business section's server leaf (plan 06 §14.6 b3.3; A1, A2; ledger B06 §9.1 R2, R3).
 * - Switch off ("", "false", "TRUE", "1"): it renders nothing and reads nothing — not the session, not a client.
 * - Switch on: her issuer and her bank details in full (her own Settings page only, R3) for the session's nanny,
 *   with her home address and its version the Settings page read. The **RSC payload** — the props serialised to
 *   the browser — is re-pinned to exactly what the page needs: her business details, her bank details, her address
 *   and the three versions; never an id, a proof or a family field, whatever extra the reads carried.
 * - A failed read or no nanny session: a plain message under the page title, never an empty or half section.
 *
 * BB-wave1-041126/06b3-build, 2026-11-07; re-pinned for the rework by BB-wave1-041126/06b3-rework, 2026-11-09.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { isValidElement, type ReactElement } from "react";

const { getNannyId, createAdminClient } = vi.hoisted(() => ({ getNannyId: vi.fn(), createAdminClient: vi.fn() }));
vi.mock("@/lib/actions/connection", () => ({ getNannyId }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("@/lib/invoices/actions/save-business-settings", () => ({ saveBusinessSettings: vi.fn() }));

import { fakeAdmin, type FakeAdmin } from "@/lib/payments/fake-admin.test-util";
import { BusinessSettingsLazy } from "./BusinessSettingsLazy";
import { BusinessSettingsLeaf, LOAD_FAILED } from "./BusinessSettingsLeaf";

const NANNY_ID = "b0600000-0000-4000-8000-000000000101";
const USER_ID = "b0600000-0000-4000-8000-000000000001";
const PARENT_USER_ID = "b0600000-0000-4000-8000-000000000011";
const V_BIZ = "2027-02-15T10:00:00.111111+00:00";
const V_BANK = "2027-02-15T10:00:00.222222+00:00";
const V_HOME = "2027-02-15T10:00:00.333333+00:00";
const ISSUER = {
  business_type: "sole_trader", name: "Sophie Taylor", trading_name: "Sophie Taylor", trading_name_source: "name",
  address: "1 Upper Street\nLondon\nN1 0AA", company_name: null, company_number: null, registered_office: null,
  partnership_name: null, vat_mode: "none", vat_rate_bp: null, vat_number: null, business_updated_at: V_BIZ,
  // what a wrong function body might add: never passed on
  parent_user_id: PARENT_USER_ID, nanny_id: NANNY_ID,
};
const BANK_ROW = {
  account_name: "Sophie Taylor", sort_code: "112233", account_number: "87654321", updated_at: V_BANK,
  // what a wrong select might add: never passed on
  nanny_id: NANNY_ID, created_at: "2027-01-01T00:00:00Z",
};
const HOME = { line1: "1 Upper Street", line2: "", town: "London", postcode: "N1 0AA" };
const props = { home: HOME, homeUpdatedAt: V_HOME };

let f: FakeAdmin;
let selects: Array<[string, string]>;

beforeEach(() => {
  vi.stubEnv("NANNY_INVOICES_ENABLED", "true");
  f = fakeAdmin({ nanny_payment_details: BANK_ROW });
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
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => [] })));
});
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("BusinessSettingsLeaf — switch off", () => {
  it.each(["", "false", "TRUE", "1"])("%j → renders nothing and reads nothing", async (value) => {
    vi.stubEnv("NANNY_INVOICES_ENABLED", value);
    expect(await BusinessSettingsLeaf(props)).toBeNull();
    expect(getNannyId).not.toHaveBeenCalled();
    expect(createAdminClient).not.toHaveBeenCalled();
  });
});

describe("BusinessSettingsLeaf — switch on", () => {
  it("reads her issuer and her bank details for the session's nanny, then renders the client section (loaded lazily)", async () => {
    const out = (await BusinessSettingsLeaf(props)) as ReactElement;
    expect(isValidElement(out)).toBe(true);
    expect(out.type).toBe(BusinessSettingsLazy);
    expect(f.rpcCalls).toEqual([{ fn: "nanny_invoice_issuer", args: { p_nanny: NANNY_ID } }]);
    expect(selects).toEqual([["nanny_payment_details", "account_name, sort_code, account_number, updated_at"]]);
    expect(f.ops.find((o) => o.table === "nanny_payment_details")?.filters).toEqual([["eq", "nanny_id", NANNY_ID]]);
  });

  it("the RSC payload: exactly the page's needs — business, full bank, address, versions; no id, proof or family field", async () => {
    const out = (await BusinessSettingsLeaf(props)) as ReactElement<Record<string, unknown>>;
    const payload = JSON.stringify(out.props);
    expect(Object.keys(out.props).sort()).toEqual(["bank", "business", "home", "versions"]);
    expect(out.props.bank).toEqual({ accountName: "Sophie Taylor", sortCode: "112233", accountNumber: "87654321" });
    expect(Object.keys(out.props.business as object).sort()).toEqual([
      "businessType", "companyName", "companyNumber", "name", "partnershipName", "registeredOffice", "tradingName", "vatMode", "vatNumber",
    ]);
    expect(out.props.home).toEqual(HOME);
    expect(out.props.versions).toEqual({ business: V_BIZ, bank: V_BANK, home: V_HOME });
    for (const secret of [NANNY_ID, USER_ID, PARENT_USER_ID, "nanny_proof", "parentUserId", "created_at", "2027-01-01"]) {
      expect(payload).not.toContain(secret);
    }
  });

  it("zero setup renders the defaults (A2)", async () => {
    f.reads.nanny_payment_details = null;
    f.rpcResults.nanny_invoice_issuer = { data: { ...ISSUER, business_updated_at: null }, error: null };
    const out = (await BusinessSettingsLeaf(props)) as ReactElement<Record<string, unknown>>;
    expect(out.props.bank).toBeNull();
    expect(out.props.versions).toEqual({ business: null, bank: null, home: V_HOME });
    render(out);
    expect(await screen.findByText("Sole trader")).toBeInTheDocument();
    expect(screen.getByText("None")).toBeInTheDocument();
    expect(screen.getByText("1 Upper Street")).toBeInTheDocument();
    expect(screen.getByText("No")).toBeInTheDocument();
    expect(screen.getByText("Not added")).toBeInTheDocument();
  });

  it("no nanny session → the plain message under the title, no read", async () => {
    getNannyId.mockResolvedValueOnce(null);
    render(await BusinessSettingsLeaf(props));
    expect(screen.getByRole("heading", { level: 2, name: "Business" })).toBeInTheDocument();
    expect(screen.getByText(LOAD_FAILED)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull(); // static text: an alert on load isn't reliably read (React review L4)
    expect(f.rpcCalls).toEqual([]);
  });

  it("a failed read → the plain message, never a half section", async () => {
    f.rpcResults.nanny_invoice_issuer = { data: null, error: { message: "boom", code: "XX000" } };
    render(await BusinessSettingsLeaf(props));
    expect(screen.getByText(LOAD_FAILED)).toBeInTheDocument();
    expect(screen.queryByText("Business type")).toBeNull();
    cleanup();
    f.rpcResults.nanny_invoice_issuer = { data: ISSUER, error: null };
    f.readErrors.nanny_payment_details = { message: "boom" };
    render(await BusinessSettingsLeaf(props));
    expect(screen.getByText(LOAD_FAILED)).toBeInTheDocument();
  });
});
