/**
 * `updateNannyAccountSettings` — the Profile and Contact details Save (ledger B06 §9.1 R1, R2, R4):
 * - the same required-field rules as the page (`nanny-profile-rules`), each refusal by field, nothing written;
 * - her name and date of birth are locked once identity verification is done — enforced here too (they print on
 *   invoices), not only by the page;
 * - one address, stored as verification stores it;
 * - the version she loaded: a row changed since answers `stale`, nothing written.
 * Review round 1: its own file (out of the 1,100-line `nanny.ts`); the version is required and the input narrowed;
 * the lock also holds on `nannies.identity_verified` (trigger-protected); a plain sign-in message.
 * Security H1 (coordinator, option (a), ledger B06 §9.11): a Profile change is one atomic save (`nanny_profile_save`)
 * across her profile and her own home address row, each with the version she loaded; her profile never gets her
 * street line. Contact details keep their own versioned write.
 *
 * BB-wave1-041126/06b3-rework, 2026-11-09.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeAdmin, writesTo, type FakeAdmin } from "@/lib/payments/fake-admin.test-util";
import { EDIT_MESSAGES } from "@/lib/settings/edit-messages";
import { PROFILE_MESSAGES as M } from "@/lib/settings/nanny-profile-rules";

const USER = "b0600000-0000-4000-8000-000000000001";
const VERSION = "2027-02-15T10:00:00.123456+00:00";
const ADDRESS_VERSION = "2027-02-15T10:00:00.654321+00:00";
const NEWER = "2027-02-15T10:05:00.000001+00:00";
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
  admin.rpcResults.nanny_profile_save = { data: { status: "saved", profile_updated_at: NEWER, address_updated_at: NEWER }, error: null };
});

const profileSaves = () => admin.rpcCalls.filter((c) => c.fn === "nanny_profile_save");

async function save(data: unknown) {
  const { updateNannyAccountSettings } = await import("./nanny-account-settings");
  return updateNannyAccountSettings(data as Parameters<typeof updateNannyAccountSettings>[0]);
}

describe("updateNannyAccountSettings — Profile", () => {
  it("saves her name, date of birth and address at once, each row with the version she loaded; her profile gets no street line", async () => {
    const r = await save({
      first_name: " Sophie ", last_name: "Taylor", date_of_birth: "1995-03-12", address: HOME,
      expected_updated_at: VERSION, expected_address_updated_at: ADDRESS_VERSION,
    });
    expect(r).toEqual({ success: true, error: null });
    expect(profileSaves()).toEqual([{
      fn: "nanny_profile_save",
      args: {
        p_user: USER, p_first_name: "Sophie", p_last_name: "Taylor", p_date_of_birth: "1995-03-12",
        p_line1: "1 Upper Street, Islington", p_town: "London", p_postcode: "N1 0AA",
        p_expected_profile_updated_at: VERSION, p_expected_address_updated_at: ADDRESS_VERSION,
      },
    }]);
    expect(writesTo(session, "user_profiles")).toEqual([]);
    expect(writesTo(admin, "user_profiles")).toEqual([]);
    expect(revalidatePath).toHaveBeenCalledWith("/nanny/settings");
  });

  it("refuses empty required fields by field, with the page's messages; nothing written", async () => {
    const r = await save({ first_name: " ", last_name: "", date_of_birth: "", address: { ...HOME, line1: "" }, expected_updated_at: VERSION, expected_address_updated_at: null });
    expect(r).toEqual({
      success: false, error: EDIT_MESSAGES.checkMarked, code: "invalid",
      fields: { firstName: M.firstName, lastName: M.lastName, dateOfBirth: M.dateOfBirth, address: M.address },
    });
    expect(writesTo(session, "user_profiles")).toEqual([]);
    expect(profileSaves()).toEqual([]);
  });

  it("refuses a name or date of birth once identity is verified, read on the server; nothing written", async () => {
    admin.reads.nannies = { verification_level: 2 };
    expect(await save({ first_name: "Someone", last_name: "Else", expected_updated_at: VERSION, expected_address_updated_at: null }))
      .toEqual({ success: false, error: M.locked, code: "locked" });
    expect(await save({ date_of_birth: "1990-01-01", expected_updated_at: VERSION, expected_address_updated_at: null })).toMatchObject({ code: "locked" });
    expect(profileSaves()).toEqual([]);
    expect(admin.ops.find((o) => o.table === "nannies")?.filters).toEqual([["eq", "user_id", USER]]);
  });

  it("identity verified by its own (protected) flag locks too, whatever the level says", async () => {
    admin.reads.nannies = { verification_level: 0, identity_verified: true };
    expect(await save({ last_name: "Else", expected_updated_at: VERSION, expected_address_updated_at: null })).toMatchObject({ code: "locked" });
    expect(admin.ops.find((o) => o.table === "nannies")?.kind).toBe("select");
  });

  it("a verified nanny can still change her address", async () => {
    admin.reads.nannies = { verification_level: 2 };
    expect(await save({ address: HOME, expected_updated_at: VERSION, expected_address_updated_at: ADDRESS_VERSION })).toEqual({ success: true, error: null });
    expect(profileSaves()[0]?.args).toMatchObject({ p_first_name: null, p_last_name: null, p_date_of_birth: null, p_line1: "1 Upper Street, Islington" });
  });

  it("an unreadable verification level locks too (fails closed)", async () => {
    admin.readErrors.nannies = { message: "boom" };
    expect(await save({ first_name: "Sophie", last_name: "Taylor", expected_updated_at: VERSION, expected_address_updated_at: null })).toMatchObject({ code: "locked" });
  });

  it("either row changed since she loaded it → stale, with the plain message", async () => {
    admin.rpcResults.nanny_profile_save = { data: { status: "stale" }, error: null };
    expect(await save({ address: HOME, expected_updated_at: VERSION, expected_address_updated_at: ADDRESS_VERSION }))
      .toEqual({ success: false, error: EDIT_MESSAGES.stale, code: "stale" });
  });

  it("both versions she loaded are required with a Profile change, and the input must be an object; else invalid, nothing written", async () => {
    expect(await save({ address: HOME })).toMatchObject({ success: false, code: "invalid" });
    expect(await save({ address: HOME, expected_updated_at: 7, expected_address_updated_at: null })).toMatchObject({ code: "invalid" });
    expect(await save({ address: HOME, expected_updated_at: VERSION })).toMatchObject({ code: "invalid" });
    expect(await save({ last_name: "Taylor", expected_updated_at: VERSION, expected_address_updated_at: 7 })).toMatchObject({ code: "invalid" });
    expect(await save(null)).toMatchObject({ code: "invalid" });
    expect(await save("x")).toMatchObject({ code: "invalid" });
    expect(profileSaves()).toEqual([]);
    expect(writesTo(session, "user_profiles")).toEqual([]);
  });

  it("a Profile change and a mobile in one save → invalid (each page saves its own), nothing written", async () => {
    expect(await save({ last_name: "Taylor", mobile_number: "07700900123", expected_updated_at: VERSION, expected_address_updated_at: null }))
      .toMatchObject({ code: "invalid" });
    expect(profileSaves()).toEqual([]);
    expect(writesTo(session, "user_profiles")).toEqual([]);
  });

  it("a failed or refused save → the plain failure; nothing to write → success with no write", async () => {
    admin.rpcResults.nanny_profile_save = { data: null, error: { message: "boom" } };
    expect(await save({ address: HOME, expected_updated_at: VERSION, expected_address_updated_at: null })).toEqual({ success: false, error: "Failed to update account info" });
    admin.rpcResults.nanny_profile_save = { data: { status: "invalid" }, error: null };
    expect(await save({ address: HOME, expected_updated_at: VERSION, expected_address_updated_at: null })).toEqual({ success: false, error: "Failed to update account info" });
    expect(await save({ expected_updated_at: VERSION })).toEqual({ success: true, error: null });
  });
});

describe("updateNannyAccountSettings — Contact details", () => {
  it("saves a UK mobile, normalised", async () => {
    expect(await save({ mobile_number: "07700 900123", expected_updated_at: VERSION })).toEqual({ success: true, error: null });
    expect(writesTo(session, "user_profiles")[0]?.payload).toEqual({ mobile_number: "+447700900123" });
    expect(writesTo(session, "user_profiles")[0]?.filters).toEqual([["eq", "user_id", USER], ["eq", "updated_at", VERSION]]);
    expect(profileSaves()).toEqual([]);
  });

  it("a mobile row changed since she loaded it → stale; a failed write → the plain failure", async () => {
    session.writeResults.user_profiles = [];
    expect(await save({ mobile_number: "07700900123", expected_updated_at: VERSION })).toMatchObject({ code: "stale" });
    session.writeErrors.user_profiles = { message: "boom" };
    expect(await save({ mobile_number: "07700900123", expected_updated_at: VERSION })).toEqual({ success: false, error: "Failed to update account info" });
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
