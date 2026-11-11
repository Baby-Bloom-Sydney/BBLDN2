/**
 * `updateParentAccountSettings` — the parent's Profile and Contact details Save, moved out of `parent.ts`:
 * - the version she loaded is required; a row changed since answers `stale`, nothing written;
 * - today's rules (`checkParentProfileInput`, the same check the page runs), each refusal by field, nothing written;
 * - only the keys she sent are written, on her own row with her own session; the mobile stored as +44…;
 * - signed out → a plain sign-in message; no log line carries her values.
 * The answer has the nanny action's shape, so edit mode reads it with `accountOutcome`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeAdmin, writesTo, type FakeAdmin } from "@/lib/payments/fake-admin.test-util";

const USER = "p0000000-0000-4000-8000-000000000001";
const VERSION = "2027-02-15T10:00:00.123456+00:00";
const NEWER = "2027-02-15T10:05:00.000001+00:00";
const CHECK_MARKED = "Please check the details marked below.";
const STALE = "These details were changed elsewhere. The latest are now showing.";
const FAILED = "Failed to update account info";

let session: FakeAdmin;
let signedIn = true;
const revalidatePath = vi.fn();
const createAdminClient = vi.fn();

vi.mock("next/cache", () => ({ revalidatePath: (p: string) => revalidatePath(p) }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: () => ({
    ...session.client,
    auth: { getUser: async () => ({ data: { user: signedIn ? { id: USER } : null }, error: null }) },
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => createAdminClient() }));

beforeEach(() => {
  vi.resetModules();
  revalidatePath.mockReset();
  createAdminClient.mockReset();
  signedIn = true;
  session = fakeAdmin();
  session.writeResults.user_profiles = [{ updated_at: NEWER }];
});
afterEach(() => vi.restoreAllMocks());

async function save(data: unknown) {
  const { updateParentAccountSettings } = await import("./parent-account-settings");
  return updateParentAccountSettings(data as Parameters<typeof updateParentAccountSettings>[0]);
}
const written = () => writesTo(session, "user_profiles");

describe("updateParentAccountSettings — the session", () => {
  it("signed out → the plain sign-in message; nothing read or written", async () => {
    signedIn = false;
    expect(await save({ last_name: "Hartley-Reed", expected_updated_at: VERSION }))
      .toEqual({ success: false, error: "Please sign in again, then try once more." });
    expect(session.ops).toEqual([]);
  });

  it("writes with her own session, never the admin client", async () => {
    await save({ last_name: "Hartley-Reed", expected_updated_at: VERSION });
    expect(createAdminClient).not.toHaveBeenCalled();
  });
});

describe("updateParentAccountSettings — the version she loaded", () => {
  it("missing or garbage version, or input that isn't an object → invalid; nothing written", async () => {
    for (const data of [
      { last_name: "Hartley-Reed" },
      { last_name: "Hartley-Reed", expected_updated_at: 7 },
      { last_name: "Hartley-Reed", expected_updated_at: {} },
      { last_name: "Hartley-Reed", expected_updated_at: "x".repeat(65) },
      null,
      "x",
    ]) {
      expect(await save(data)).toEqual({ success: false, error: CHECK_MARKED, code: "invalid", fields: {} });
    }
    expect(written()).toEqual([]);
  });

  it("a row changed since → stale with its message; nothing written, nothing revalidated", async () => {
    session.writeResults.user_profiles = [];
    expect(await save({ last_name: "Hartley-Reed", expected_updated_at: VERSION }))
      .toEqual({ success: false, error: STALE, code: "stale" });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("the write is conditional on the version (none yet → is null)", async () => {
    await save({ last_name: "Hartley-Reed", expected_updated_at: VERSION });
    expect(written()[0]?.filters).toEqual([["eq", "user_id", USER], ["eq", "updated_at", VERSION]]);
    await save({ last_name: "Hartley-Reed", expected_updated_at: null });
    expect(written()[1]?.filters).toEqual([["eq", "user_id", USER], ["is", "updated_at", null]]);
  });
});

describe("updateParentAccountSettings — today's rules, by field", () => {
  it("blank names, a cleared date of birth and an empty mobile → each by field; nothing written", async () => {
    expect(await save({ first_name: " ", last_name: "", date_of_birth: "", mobile_number: "", expected_updated_at: VERSION })).toEqual({
      success: false, error: CHECK_MARKED, code: "invalid",
      fields: {
        firstName: "Enter your first name", lastName: "Enter your last name",
        dateOfBirth: "Enter your date of birth", mobile: "Mobile number is required.",
      },
    });
    expect(written()).toEqual([]);
  });

  it("a null date of birth or mobile, or a non-UK mobile → refused by field", async () => {
    expect(await save({ date_of_birth: null, expected_updated_at: VERSION })).toMatchObject({ code: "invalid", fields: { dateOfBirth: "Enter your date of birth" } });
    expect(await save({ mobile_number: null, expected_updated_at: VERSION })).toMatchObject({ fields: { mobile: "Mobile number is required." } });
    expect(await save({ mobile_number: "12345", expected_updated_at: VERSION })).toMatchObject({ fields: { mobile: "Enter a valid UK mobile number." } });
    expect(written()).toEqual([]);
  });

  it("an area or postcode that isn't text → invalid; nothing written", async () => {
    expect(await save({ suburb: 7, postcode: "N1 1AA", expected_updated_at: VERSION })).toMatchObject({ code: "invalid" });
    expect(await save({ suburb: "London", postcode: null, expected_updated_at: VERSION })).toMatchObject({ code: "invalid" });
    expect(written()).toEqual([]);
  });

  it("no new rule: a 150-character accented name is saved", async () => {
    const long = `Zoë ${"a".repeat(146)}`;
    expect(await save({ first_name: long, expected_updated_at: VERSION })).toEqual({ success: true, error: null });
    expect(written()[0]?.payload).toEqual({ first_name: long });
  });
});

describe("updateParentAccountSettings — the save", () => {
  it("writes only the keys she sent, names trimmed, the town and postcode as picked; revalidates her Settings", async () => {
    expect(await save({ first_name: " Olivia ", last_name: "Hartley-Reed", suburb: "London", postcode: "N1 1AA", expected_updated_at: VERSION }))
      .toEqual({ success: true, error: null });
    expect(written()).toHaveLength(1);
    expect(written()[0]?.payload).toEqual({ first_name: "Olivia", last_name: "Hartley-Reed", suburb: "London", postcode: "N1 1AA" });
    expect(revalidatePath).toHaveBeenCalledWith("/parent/settings");
  });

  it("a date of birth alone is written alone; keys it doesn't know are never written", async () => {
    await save({ date_of_birth: "1994-03-02", role: "admin", user_id: "someone-else", is_test: true, expected_updated_at: VERSION });
    expect(written()[0]?.payload).toEqual({ date_of_birth: "1994-03-02" });
  });

  it("the mobile is stored as +44…", async () => {
    expect(await save({ mobile_number: "07700 900456", expected_updated_at: VERSION })).toEqual({ success: true, error: null });
    expect(written()[0]?.payload).toEqual({ mobile_number: "+447700900456" });
  });

  it("a failed write → the plain failure, nothing revalidated", async () => {
    session.writeErrors.user_profiles = { message: "boom" };
    expect(await save({ last_name: "Hartley-Reed", expected_updated_at: VERSION })).toEqual({ success: false, error: FAILED });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("nothing to write → success, no write", async () => {
    expect(await save({ expected_updated_at: VERSION })).toEqual({ success: true, error: null });
    expect(written()).toEqual([]);
  });
});

describe("updateParentAccountSettings — logs", () => {
  it("no log line carries her values, whatever the answer", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((level) => vi.spyOn(console, level).mockImplementation(() => undefined));
    const values = ["Olivia", "Hartley-Reed", "1994-03-02", "07700 900456", "+447700900456", "N1 1AA"];
    const data = { first_name: "Olivia", last_name: "Hartley-Reed", date_of_birth: "1994-03-02", mobile_number: "07700 900456", suburb: "London", postcode: "N1 1AA" };
    await save({ ...data, expected_updated_at: VERSION });
    session.writeResults.user_profiles = [];
    await save({ ...data, expected_updated_at: VERSION });
    session.writeErrors.user_profiles = { message: "boom" };
    await save({ ...data, expected_updated_at: VERSION });
    await save({ ...data, mobile_number: "12345", expected_updated_at: VERSION });
    const logged = spies.flatMap((spy) => spy.mock.calls).map((args) => JSON.stringify(args)).join("\n");
    for (const value of values) expect(logged).not.toContain(value);
  });
});
