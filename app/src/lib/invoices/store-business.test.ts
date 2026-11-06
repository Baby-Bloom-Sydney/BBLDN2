/**
 * Her business details in the store (plan 06 §14.4, b2.4): `readIssuer` (who she is on her invoices, with the
 * defaults the database holds — no bank field) and `saveBusiness` (parsed again here, then
 * `nanny_business_details_save`, which takes her lock). Switch off → `invoices_disabled` before any client; not a
 * proof → `invalid`; the nanny id always from the proof. Nothing logged carries her details (console.* spy).
 *
 * BB-wave1-041126/06b2-build, 2026-11-06.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getNannyId, createAdminClient } = vi.hoisted(() => ({ getNannyId: vi.fn(), createAdminClient: vi.fn() }));
vi.mock("@/lib/actions/connection", () => ({ getNannyId }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient }));

import { fakeAdmin, type FakeAdmin } from "@/lib/payments/fake-admin.test-util";
import { proveNanny, type NannyProof } from "./nanny-proof";
import { readIssuer, saveBusiness } from "./store-business";

const NANNY_ID = "b0600000-0000-4000-8000-000000000101";
const OTHER_NANNY = "b0600000-0000-4000-8000-000000000102";
const ISSUER = {
  business_type: "sole_trader", name: "Sophie Taylor", trading_name: "Sophie Taylor", trading_name_source: "name",
  address: "1 Upper Street\nLondon\nN1 0AA", address_source: "verification", company_name: null, company_number: null,
  registered_office: null, partnership_name: null, vat_mode: "none", vat_rate_bp: null, vat_number: null,
};
const LTD_IN = {
  businessType: "limited_company", tradingName: "Taylor Childcare", businessAddress: "", companyName: "Taylor Childcare Ltd",
  companyNumber: "sc 123 456", registeredOffice: "1 Upper Street\nLondon N1 0AA", partnershipName: "dropped",
  vatMode: "added", vatNumber: "123 4567 89", vatRate: "20",
};

let f: FakeAdmin;
let nanny: NannyProof;
const spies: Array<ReturnType<typeof vi.spyOn>> = [];

beforeEach(async () => {
  vi.stubEnv("NANNY_INVOICES_ENABLED", "true");
  f = fakeAdmin();
  createAdminClient.mockReset().mockReturnValue(f.client);
  getNannyId.mockResolvedValue({ nannyId: NANNY_ID, userId: "b0600000-0000-4000-8000-000000000001" });
  const n = await proveNanny();
  if (!n) throw new Error("fixture proof");
  nanny = n;
  spies.splice(0);
  for (const level of ["error", "warn", "log", "info"] as const) spies.push(vi.spyOn(console, level).mockImplementation(() => {}));
});

afterEach(() => {
  expect(JSON.stringify(spies.flatMap((s) => s.mock.calls))).not.toMatch(/Taylor|Upper Street|GB123|12345678|SC123/);
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("the gates", () => {
  it("switch off: both refuse before a client is made", async () => {
    vi.stubEnv("NANNY_INVOICES_ENABLED", "");
    expect(await readIssuer(nanny)).toEqual({ ok: false, error: "invoices_disabled" });
    expect(await saveBusiness(nanny, LTD_IN)).toEqual({ ok: false, error: "invoices_disabled" });
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("a look-alike proof is invalid, before any read", async () => {
    const lookAlike = { kind: "nanny_proof", nannyId: OTHER_NANNY, userId: "x" } as unknown as NannyProof;
    expect(await readIssuer(lookAlike)).toEqual({ ok: false, error: "invalid" });
    expect(await saveBusiness(lookAlike, LTD_IN)).toEqual({ ok: false, error: "invalid" });
    expect(f.rpcCalls).toEqual([]);
  });

  it("no service client → error, logged by name only", async () => {
    createAdminClient.mockImplementation(() => { throw new Error("Missing Supabase admin credentials"); });
    expect(await readIssuer(nanny)).toEqual({ ok: false, error: "error" });
    expect(await saveBusiness(nanny, LTD_IN)).toEqual({ ok: false, error: "error" });
    expect(console.error).toHaveBeenCalledWith("[invoices] createAdminClient failed", { code: "Error" });
  });
});

describe("readIssuer", () => {
  it("reads her effective issuer for the proof's nanny: the zero-setup default, with no bank field", async () => {
    f.rpcResults.nanny_invoice_issuer = { data: { ...ISSUER, account_number: "87654321" }, error: null };
    const r = await readIssuer(nanny);
    expect(f.rpcCalls).toEqual([{ fn: "nanny_invoice_issuer", args: { p_nanny: NANNY_ID } }]);
    expect(r).toEqual({
      ok: true,
      value: {
        businessType: "sole_trader", name: "Sophie Taylor", tradingName: "Sophie Taylor", tradingNameSource: "name",
        address: "1 Upper Street\nLondon\nN1 0AA", addressSource: "verification", companyName: null, companyNumber: null,
        registeredOffice: null, partnershipName: null, vat: { mode: "none", rateBp: null, number: null },
      },
    });
    expect(JSON.stringify(r)).not.toMatch(/87654321|account|sort/);
  });

  it("no such nanny, a malformed reply or a failed call is an error", async () => {
    f.rpcResults.nanny_invoice_issuer = { data: null, error: null };
    expect(await readIssuer(nanny)).toEqual({ ok: false, error: "error" });
    f.rpcResults.nanny_invoice_issuer = { data: { ...ISSUER, business_type: "charity" }, error: null };
    expect(await readIssuer(nanny)).toEqual({ ok: false, error: "error" });
    f.rpcResults.nanny_invoice_issuer = { data: null, error: { message: "x", code: "XX000" } };
    expect(await readIssuer(nanny)).toEqual({ ok: false, error: "error" });
    expect(console.error).toHaveBeenLastCalledWith("[invoices] nanny_invoice_issuer failed", { code: "XX000" });
  });
});

describe("saveBusiness", () => {
  it("saves the parsed details for the proof's nanny (normalised; fields that don't apply null)", async () => {
    f.rpcResults.nanny_business_details_save = { data: { status: "saved", changed: true }, error: null };
    expect(await saveBusiness(nanny, { ...LTD_IN, nannyId: OTHER_NANNY })).toEqual({ ok: true, value: { changed: true } });
    expect(f.rpcCalls).toEqual([{
      fn: "nanny_business_details_save",
      args: {
        p_nanny: NANNY_ID, p_business_type: "limited_company", p_trading_name: "Taylor Childcare", p_business_address: null,
        p_company_name: "Taylor Childcare Ltd", p_company_number: "SC123456", p_registered_office: "1 Upper Street\nLondon N1 0AA",
        p_partnership_name: null, p_vat_mode: "added", p_vat_number: "GB123456789", p_vat_rate_bp: 2000,
      },
    }]);
  });

  it("saving the defaults sends nulls and 'none'", async () => {
    f.rpcResults.nanny_business_details_save = { data: { status: "saved", changed: false }, error: null };
    expect(await saveBusiness(nanny, { businessType: "sole_trader", vatMode: "none" })).toEqual({ ok: true, value: { changed: false } });
    expect(f.rpcCalls[0]?.args).toMatchObject({ p_business_type: "sole_trader", p_trading_name: null, p_vat_mode: "none", p_vat_number: null, p_vat_rate_bp: null });
  });

  it("refuses bad input without calling the database (a company without its number; BabyBloom as the trading name)", async () => {
    expect(await saveBusiness(nanny, { ...LTD_IN, companyNumber: "" })).toEqual({ ok: false, error: "invalid" });
    expect(await saveBusiness(nanny, { businessType: "sole_trader", vatMode: "none", tradingName: "Baby Bloom" })).toEqual({ ok: false, error: "invalid" });
    expect(await saveBusiness(nanny, "not an object")).toEqual({ ok: false, error: "invalid" });
    expect(f.rpcCalls).toEqual([]);
  });

  it("maps the database's refusals, a lock timeout, a failure and a reply it doesn't recognise", async () => {
    for (const status of ["invalid", "nanny_inactive"] as const) {
      f.rpcResults.nanny_business_details_save = { data: { status }, error: null };
      expect(await saveBusiness(nanny, LTD_IN)).toEqual({ ok: false, error: status });
    }
    f.rpcResults.nanny_business_details_save = { data: null, error: { message: "canceling statement due to lock timeout", code: "55P03" } };
    expect(await saveBusiness(nanny, LTD_IN)).toEqual({ ok: false, error: "busy" });
    f.rpcResults.nanny_business_details_save = { data: null, error: { message: "Failing row contains (Taylor Childcare Ltd)", code: "23514" } };
    expect(await saveBusiness(nanny, LTD_IN)).toEqual({ ok: false, error: "error" });
    f.rpcResults.nanny_business_details_save = { data: { status: "saved" }, error: null };
    expect(await saveBusiness(nanny, LTD_IN)).toEqual({ ok: false, error: "error" });
  });
});
