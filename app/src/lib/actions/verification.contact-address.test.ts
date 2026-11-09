/**
 * Verification's residence step writes her one address (ledger B06 §9.1 R2, brief 06 §0b 2): `submitContactSection`
 * keeps `verifications.address_line/city/postcode` and syncs her profile with the same address — the street line as
 * `address_line1` (as Settings stores it), no `address_line2`, the town as `suburb`, the postcode — so Profile,
 * Business and her invoices show what she just confirmed.
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

describe("submitContactSection — her one address (R2)", () => {
  it("syncs the whole address to her profile: street line, no second line, town, postcode", async () => {
    expect(await submitContactSection(CONTACT)).toEqual({ success: true, error: null });
    const [profile] = writesTo(admin, "user_profiles");
    expect(profile?.payload).toMatchObject({
      address_line1: "1 Upper Street, Islington", address_line2: null, suburb: "London", postcode: "N1 0AA",
    });
    expect(profile?.filters).toEqual([["eq", "user_id", USER]]);
    expect(writesTo(admin, "verifications")[0]?.payload).toMatchObject({ address_line: "1 Upper Street, Islington", city: "London", postcode: "N1 0AA" });
  });

  it("a failed profile sync is logged by code, not ignored (review round 1)", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    admin.writeErrors.user_profiles = { message: "Failing row contains (1 Upper Street)" };
    await submitContactSection(CONTACT);
    expect(spy).toHaveBeenCalledWith("[submitContactSection] profile sync failed", { code: "Error" });
    expect(JSON.stringify(spy.mock.calls)).not.toMatch(/Upper Street/);
    spy.mockRestore();
  });

  it("a missing street line writes nothing", async () => {
    expect(await submitContactSection({ ...CONTACT, address_line: " " })).toMatchObject({ success: false });
    expect(admin.ops).toEqual([]);
  });
});
