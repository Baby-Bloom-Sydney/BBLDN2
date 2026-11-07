/**
 * `saveBusinessDetails` (plan 06 §14.6 b3.1; brief §0a B): the Settings Business section's one write. Through the
 * real store (`store-business.ts`) and a fake service client:
 * - switch off → `invoices_disabled` before the session or any client is read;
 * - no nanny session → refused, nothing written;
 * - the nanny id is always the session's, never the input's;
 * - a refusal answers its code with a plain message (never the database's words); nothing she typed is logged.
 *
 * BB-wave1-041126/06b3-build, 2026-11-07.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getNannyId, createAdminClient } = vi.hoisted(() => ({ getNannyId: vi.fn(), createAdminClient: vi.fn() }));
vi.mock("@/lib/actions/connection", () => ({ getNannyId }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient }));

import { fakeAdmin, type FakeAdmin } from "@/lib/payments/fake-admin.test-util";
import { saveBusinessDetails } from "./save-business-details";

const NANNY_ID = "b0600000-0000-4000-8000-000000000101";
const OTHER_NANNY = "b0600000-0000-4000-8000-000000000102";
const LTD = {
  businessType: "limited_company", tradingName: "", businessAddress: "", companyName: "Taylor Childcare Ltd",
  companyNumber: "12345678", registeredOffice: "2 Office Row\nLondon\nEC1A 1AA", partnershipName: "",
  vatMode: "added", vatNumber: "GB 123 4567 89", vatRate: "20",
};

let f: FakeAdmin;
const spies: Array<ReturnType<typeof vi.spyOn>> = [];

beforeEach(() => {
  vi.stubEnv("NANNY_INVOICES_ENABLED", "true");
  f = fakeAdmin();
  createAdminClient.mockReset().mockReturnValue(f.client);
  getNannyId.mockReset().mockResolvedValue({ nannyId: NANNY_ID, userId: "b0600000-0000-4000-8000-000000000001" });
  spies.splice(0);
  for (const level of ["error", "warn", "log", "info"] as const) spies.push(vi.spyOn(console, level).mockImplementation(() => {}));
});

afterEach(() => {
  expect(JSON.stringify(spies.flatMap((s) => s.mock.calls))).not.toMatch(/Taylor|Office Row|GB123|12345678/);
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("saveBusinessDetails", () => {
  it.each(["", "false", "TRUE", "1"])("switch %j → invoices_disabled before the session or a client", async (value) => {
    vi.stubEnv("NANNY_INVOICES_ENABLED", value);
    expect(await saveBusinessDetails(LTD)).toEqual({ ok: false, error: "invoices_disabled", message: "This isn't available right now." });
    expect(getNannyId).not.toHaveBeenCalled();
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("no nanny session → signed_out, nothing written", async () => {
    getNannyId.mockResolvedValueOnce(null);
    expect(await saveBusinessDetails(LTD)).toMatchObject({ ok: false, error: "signed_out" });
    expect(f.rpcCalls).toEqual([]);
  });

  it("saves for the session's nanny, whatever nanny id the input carries; the reply says whether anything changed", async () => {
    f.rpcResults.nanny_business_details_save = { data: { status: "saved", changed: true }, error: null };
    expect(await saveBusinessDetails({ ...LTD, nannyId: OTHER_NANNY })).toEqual({ ok: true, changed: true });
    expect(f.rpcCalls).toEqual([{
      fn: "nanny_business_details_save",
      args: {
        p_nanny: NANNY_ID, p_business_type: "limited_company", p_trading_name: null, p_business_address: null,
        p_company_name: "Taylor Childcare Ltd", p_company_number: "12345678", p_registered_office: "2 Office Row\nLondon\nEC1A 1AA",
        p_partnership_name: null, p_vat_mode: "added", p_vat_number: "GB123456789", p_vat_rate_bp: 2000,
      },
    }]);
  });

  it("an unchanged save answers changed: false", async () => {
    f.rpcResults.nanny_business_details_save = { data: { status: "saved", changed: false }, error: null };
    expect(await saveBusinessDetails(LTD)).toEqual({ ok: true, changed: false });
  });

  it("bad input → invalid with a plain message, nothing written", async () => {
    const r = await saveBusinessDetails({ ...LTD, companyNumber: "1234" });
    expect(r).toEqual({ ok: false, error: "invalid", message: "Please check the details and try again." });
    expect(await saveBusinessDetails("not an object")).toMatchObject({ ok: false, error: "invalid" });
    expect(f.rpcCalls).toEqual([]);
  });

  it("the database's refusals and failures answer their code and a fixed message, never its words", async () => {
    f.rpcResults.nanny_business_details_save = { data: { status: "nanny_inactive" }, error: null };
    expect(await saveBusinessDetails(LTD)).toMatchObject({ ok: false, error: "nanny_inactive" });
    f.rpcResults.nanny_business_details_save = { data: null, error: { message: "canceling statement due to lock timeout", code: "55P03" } };
    expect(await saveBusinessDetails(LTD)).toMatchObject({ ok: false, error: "busy" });
    f.rpcResults.nanny_business_details_save = { data: null, error: { message: "Failing row contains (Taylor Childcare Ltd)", code: "23514" } };
    const r = await saveBusinessDetails(LTD);
    expect(r).toEqual({ ok: false, error: "error", message: "We couldn't save that. Please try again." });
    expect(JSON.stringify(r)).not.toMatch(/Failing|Taylor/);
  });
});
