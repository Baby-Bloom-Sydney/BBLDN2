/**
 * `updateNannyAccountSettings` — the Profile and Contact details Save (ledger B06 §9.1 R1, R2, R4):
 * - the same required-field rules as the page (`nanny-profile-rules`), each refusal by field, nothing written;
 * - her name and date of birth are locked once identity verification is done — enforced here too (they print on
 *   invoices), not only by the page;
 * - one address, stored as verification stores it;
 * - the version she loaded: a row changed since answers `stale`, nothing written.
 * Review round 1: its own file (out of the 1,100-line `nanny.ts`); the version is required and the input narrowed;
 * the lock also holds on `nannies.identity_verified` (trigger-protected); a plain sign-in message.
 *
 * BB-wave1-041126/06b3-rework, 2026-11-09.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeAdmin, writesTo, type FakeAdmin } from "@/lib/payments/fake-admin.test-util";
import { EDIT_MESSAGES } from "@/lib/settings/edit-messages";
import { PROFILE_MESSAGES as M } from "@/lib/settings/nanny-profile-rules";

const USER = "b0600000-0000-4000-8000-000000000001";
const VERSION = "2027-02-15T10:00:00.123456+00:00";
const HOME = { line1: "1 Upper Street, Islington", line2: "", town: "London", postcode: "N1 0AA" };

let session: FakeAdmin;
let admin: FakeAdmin;
let signedIn = true;
const revalidatePath = vi.fn();

vi.mock("next/cache", () => ({ revalidatePath: (p: string) => revalidatePath(p) }));
vi.mock("@/lib/ai/client", () => ({ openai: {} }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: () => ({
    ...session.client,
    auth: { getUser: async () => ({ data: { user: signedIn ? { id: USER } : null }, error: null }) },
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => admin.client }));

beforeEach(() => {
  vi.resetModules();
  revalidatePath.mockReset();
  signedIn = true;
  session = fakeAdmin();
  session.writeResults.user_profiles = [{ updated_at: "2027-02-15T10:05:00.000001+00:00" }];
  admin = fakeAdmin({ nannies: { verification_level: 1, identity_verified: false } });
});

async function save(data: unknown) {
  const { updateNannyAccountSettings } = await import("./nanny-account-settings");
  return updateNannyAccountSettings(data as Parameters<typeof updateNannyAccountSettings>[0]);
}

describe("updateNannyAccountSettings — Profile", () => {
  it("saves her name, date of birth and address with the version she loaded", async () => {
    const r = await save({ first_name: " Sophie ", last_name: "Taylor", date_of_birth: "1995-03-12", address: HOME, expected_updated_at: VERSION });
    expect(r).toEqual({ success: true, error: null });
    const [write] = writesTo(session, "user_profiles");
    expect(write?.payload).toEqual({
      first_name: "Sophie", last_name: "Taylor", date_of_birth: "1995-03-12",
      address_line1: "1 Upper Street, Islington", address_line2: null, suburb: "London", postcode: "N1 0AA",
    });
    expect(write?.filters).toEqual([["eq", "user_id", USER], ["eq", "updated_at", VERSION]]);
    expect(revalidatePath).toHaveBeenCalledWith("/nanny/settings");
  });

  it("refuses empty required fields by field, with the page's messages; nothing written", async () => {
    const r = await save({ first_name: " ", last_name: "", date_of_birth: "", address: { ...HOME, line1: "" }, expected_updated_at: VERSION });
    expect(r).toEqual({
      success: false, error: EDIT_MESSAGES.checkMarked, code: "invalid",
      fields: { firstName: M.firstName, lastName: M.lastName, dateOfBirth: M.dateOfBirth, address: M.address },
    });
    expect(writesTo(session, "user_profiles")).toEqual([]);
  });

  it("refuses a name or date of birth once identity is verified, read on the server; nothing written", async () => {
    admin.reads.nannies = { verification_level: 2 };
    expect(await save({ first_name: "Someone", last_name: "Else", expected_updated_at: VERSION }))
      .toEqual({ success: false, error: M.locked, code: "locked" });
    expect(await save({ date_of_birth: "1990-01-01", expected_updated_at: VERSION })).toMatchObject({ code: "locked" });
    expect(writesTo(session, "user_profiles")).toEqual([]);
    expect(admin.ops.find((o) => o.table === "nannies")?.filters).toEqual([["eq", "user_id", USER]]);
  });

  it("identity verified by its own (protected) flag locks too, whatever the level says", async () => {
    admin.reads.nannies = { verification_level: 0, identity_verified: true };
    expect(await save({ last_name: "Else", expected_updated_at: VERSION })).toMatchObject({ code: "locked" });
    expect(admin.ops.find((o) => o.table === "nannies")?.kind).toBe("select");
  });

  it("a verified nanny can still change her address", async () => {
    admin.reads.nannies = { verification_level: 2 };
    expect(await save({ address: HOME, expected_updated_at: VERSION })).toEqual({ success: true, error: null });
  });

  it("an unreadable verification level locks too (fails closed)", async () => {
    admin.readErrors.nannies = { message: "boom" };
    expect(await save({ first_name: "Sophie", last_name: "Taylor", expected_updated_at: VERSION })).toMatchObject({ code: "locked" });
  });

  it("a row changed since she loaded it → stale, with the plain message", async () => {
    session.writeResults.user_profiles = [];
    expect(await save({ address: HOME, expected_updated_at: VERSION }))
      .toEqual({ success: false, error: EDIT_MESSAGES.stale, code: "stale" });
  });

  it("the version she loaded is required, and the input must be an object; else invalid, nothing written", async () => {
    expect(await save({ address: HOME })).toMatchObject({ success: false, code: "invalid" });
    expect(await save({ address: HOME, expected_updated_at: 7 })).toMatchObject({ code: "invalid" });
    expect(await save(null)).toMatchObject({ code: "invalid" });
    expect(await save("x")).toMatchObject({ code: "invalid" });
    expect(writesTo(session, "user_profiles")).toEqual([]);
  });

  it("a failed write → the plain failure; nothing to write → success with no write", async () => {
    session.writeErrors.user_profiles = { message: "boom" };
    expect(await save({ address: HOME, expected_updated_at: VERSION })).toEqual({ success: false, error: "Failed to update account info" });
    expect(await save({ expected_updated_at: VERSION })).toEqual({ success: true, error: null });
  });
});

describe("updateNannyAccountSettings — Contact details", () => {
  it("saves a UK mobile, normalised", async () => {
    expect(await save({ mobile_number: "07700 900123", expected_updated_at: VERSION })).toEqual({ success: true, error: null });
    expect(writesTo(session, "user_profiles")[0]?.payload).toEqual({ mobile_number: "+447700900123" });
  });

  it("refuses a blank or non-UK mobile by field", async () => {
    expect(await save({ mobile_number: "", expected_updated_at: VERSION })).toMatchObject({ code: "invalid", fields: { mobile: M.mobileRequired } });
    expect(await save({ mobile_number: "0207 946 0000", expected_updated_at: VERSION })).toMatchObject({ fields: { mobile: M.mobile } });
    expect(writesTo(session, "user_profiles")).toEqual([]);
  });
});

describe("updateNannyAccountSettings — the session", () => {
  it("signed out → not authenticated, no read, no write", async () => {
    signedIn = false;
    expect(await save({ mobile_number: "07700900123", expected_updated_at: VERSION })).toEqual({ success: false, error: "Please sign in again, then try once more." });
    expect(session.ops).toEqual([]);
  });
});
