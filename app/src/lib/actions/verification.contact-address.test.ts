/**
 * Verification's residence step writes her one address (ledger B06 §9.1 R2, brief 06 §0b 2): `submitContactSection`
 * keeps `verifications.address_line/city/postcode` and saves the same address as her home address — her own
 * owner-only row (security H1, coordinator option (a), §9.11), what she just confirmed replacing it whatever its
 * version — with her profile's area (suburb, postcode) following in the same save, as main keeps it. Her profile
 * never gets her street line. Profile, Business and her invoices show what she just confirmed.
 *
 * BB-wave1-041126/06b3-rework, 2026-11-09.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeAdmin, writesTo, type FakeAdmin } from "@/lib/payments/fake-admin.test-util";

const USER = "b0600000-0000-4000-8000-000000000001";
let admin: FakeAdmin;

vi.mock("@/lib/supabase/server", () => ({ createClient: () => ({ auth: { getUser: async () => ({ data: { user: { id: USER } }, error: null }) } }) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => admin.client }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/ai/verification-pipeline", () => ({ triggerCrossCheck: vi.fn() }));
vi.mock("@/lib/email/resend", () => ({ sendEmail: vi.fn() }));
vi.mock("@/lib/email/helpers", () => ({ getUserEmailInfo: vi.fn() }));
vi.mock("./connection-helpers", () => ({ createInboxMessage: vi.fn() }));

import { submitContactSection } from "./verification";

const CONTACT = { phone_number: "", address_line: " 1 Upper Street, Islington ", city: " London ", postcode: " N1 0AA ", country: "United Kingdom" };

beforeEach(() => {
  admin = fakeAdmin();
});

describe("submitContactSection — her one address (R2, security H1)", () => {
  it("saves it as her home address (any version: what she confirmed replaces it), never on her profile", async () => {
    admin.rpcResults.nanny_home_address_save = { data: { status: "saved", changed: true, updated_at: "2027-02-15T10:05:00.000001+00:00" }, error: null };
    expect(await submitContactSection({ ...CONTACT, postcode: " n1 0aa " })).toEqual({ success: true, error: null });
    expect(admin.rpcCalls).toEqual([{
      fn: "nanny_home_address_save",
      args: { p_user: USER, p_line1: "1 Upper Street, Islington", p_town: "London", p_postcode: "N1 0AA", p_expected_updated_at: null, p_any_version: true },
    }]);
    expect(writesTo(admin, "user_profiles")).toEqual([]);
    expect(writesTo(admin, "verifications")[0]?.payload).toMatchObject({ address_line: "1 Upper Street, Islington", city: "London", postcode: "n1 0aa" });
  });

  it("a refused or failed home address save: her area is still synced, as main does; logged by status only; the step stands (round 2 #2)", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    admin.rpcResults.nanny_home_address_save = { data: null, error: { message: "Failing row contains (1 Upper Street)" } };
    expect(await submitContactSection(CONTACT)).toEqual({ success: true, error: null });
    expect(spy).toHaveBeenCalledWith("[submitContactSection] home address save failed", { status: "error" });
    expect(writesTo(admin, "user_profiles")[0]?.payload).toMatchObject({ suburb: "London", postcode: "N1 0AA" });
    admin.rpcResults.nanny_home_address_save = { data: { status: "invalid" }, error: null };
    await submitContactSection(CONTACT);
    expect(spy).toHaveBeenLastCalledWith("[submitContactSection] home address save failed", { status: "invalid" });
    expect(writesTo(admin, "user_profiles")).toHaveLength(2);
    expect(writesTo(admin, "user_profiles")[1]?.filters).toEqual([["eq", "user_id", USER]]);
    expect(JSON.stringify(writesTo(admin, "user_profiles").map((w) => w.payload))).not.toMatch(/address_line/);
    expect(JSON.stringify(spy.mock.calls)).not.toMatch(/Upper Street/);
    spy.mockRestore();
  });

  it("an address the address rule refuses (a control character, a postcode that isn't UK): no home address row, but her area is synced as main does; logged as invalid; the step stands (security review L1, round 2 #2)", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await submitContactSection({ ...CONTACT, address_line: "1 Upper" + String.fromCharCode(10) + "Street" })).toEqual({ success: true, error: null });
    expect(await submitContactSection({ ...CONTACT, postcode: " 90210 " })).toEqual({ success: true, error: null });
    expect(admin.rpcCalls).toEqual([]);
    expect(writesTo(admin, "user_profiles").map((w) => w.payload)).toMatchObject([
      { suburb: "London", postcode: "N1 0AA" }, { suburb: "London", postcode: "90210" },
    ]);
    expect(spy).toHaveBeenCalledWith("[submitContactSection] home address save failed", { status: "invalid" });
    expect(JSON.stringify(spy.mock.calls)).not.toMatch(/Upper/);
    spy.mockRestore();
  });

  it("the area write failing is logged by its code only, never the address; the step still stands (code review L1)", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    admin.rpcResults.nanny_home_address_save = { data: { status: "invalid" }, error: null };
    admin.writeErrors.user_profiles = { message: "Failing row contains (1 Upper Street)" };
    expect(await submitContactSection(CONTACT)).toEqual({ success: true, error: null });
    expect(spy).toHaveBeenCalledWith("[submitContactSection] area sync failed", { code: "Error" });
    expect(JSON.stringify(spy.mock.calls)).not.toMatch(/Upper/);
    spy.mockRestore();
  });

  it("a missing street line writes nothing", async () => {
    expect(await submitContactSection({ ...CONTACT, address_line: " " })).toMatchObject({ success: false });
    expect(admin.ops).toEqual([]);
  });
});
