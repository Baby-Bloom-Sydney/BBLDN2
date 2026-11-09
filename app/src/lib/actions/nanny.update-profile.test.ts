/**
 * `updateNannyProfile` — the nanny's profile editor and Katie's rate and age-range tools:
 * - writes only the fields on its list (her profile row, her nannies row, the related tables); anything else refuses
 *   the whole update before any write;
 * - her name and date of birth are fixed once her identity is verified (enforced in the action);
 * - otherwise exactly as before (the same rows, the same messages).
 *
 * BB-wave1-041126, 2026-11-09.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeAdmin, writesTo, type FakeAdmin } from "@/lib/payments/fake-admin.test-util";
import { PROFILE_MESSAGES } from "@/lib/settings/nanny-profile-rules";

const USER = "b0600000-0000-4000-8000-000000000001";
const NANNY = "b0600000-0000-4000-8000-000000000101";

let session: FakeAdmin;
let admin: FakeAdmin;
let signedIn = true;

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/ai/client", () => ({ openai: {} }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: () => ({
    ...session.client,
    auth: { getUser: async () => ({ data: { user: signedIn ? { id: USER } : null }, error: null }) },
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => admin.client }));

import { updateNannyProfile } from "./nanny";

type Update = Parameters<typeof updateNannyProfile>[0];
const REFUSED = { success: false, error: "Failed to update profile" };

beforeEach(() => {
  signedIn = true;
  session = fakeAdmin({ nannies: { id: NANNY } });
  admin = fakeAdmin({ nannies: { identity_verified: false, verification_level: 1 } });
});

describe("updateNannyProfile — the fields it writes", () => {
  it("writes her profile fields to her nannies row and her photo to her profile row, as before", async () => {
    const result = await updateNannyProfile({ profile_picture_url: "https://x/p.jpg", hourly_rate_min: 21, min_child_age_months: 6, max_child_age_months: 48 });
    expect(result).toEqual({ success: true, error: null });
    expect(writesTo(session, "user_profiles")).toEqual([
      { table: "user_profiles", kind: "update", payload: { profile_picture_url: "https://x/p.jpg" }, filters: [["eq", "user_id", USER]] },
    ]);
    expect(writesTo(session, "nannies")).toEqual([
      { table: "nannies", kind: "update", payload: { hourly_rate_min: 21, min_child_age_months: 6, max_child_age_months: 48 }, filters: [["eq", "user_id", USER]] },
    ]);
  });

  it("writes the related tables from their own fields, never to her nannies row", async () => {
    expect(await updateNannyProfile({ available_days: ["Mon"], schedule: { Mon: ["am"] }, assurances: ["None"] })).toEqual({ success: true, error: null });
    expect(writesTo(session, "nannies")).toEqual([]);
    expect(writesTo(session, "nanny_availability")[0]?.payload).toEqual({ nanny_id: NANNY, days_available: ["Mon"], schedule: { Mon: ["am"] } });
  });

  it("refuses the whole update, writing nothing, when a field is not on its list", async () => {
    for (const key of ["unlisted_field", "user_id", "id", "email"]) {
      session = fakeAdmin({ nannies: { id: NANNY } });
      expect(await updateNannyProfile({ hourly_rate_min: 21, [key]: 4 } as Update)).toEqual(REFUSED);
      expect(session.ops.filter((o) => o.kind !== "select")).toEqual([]);
    }
  });

  it("refuses a related field in the wrong shape, writing nothing", async () => {
    expect(await updateNannyProfile({ hourly_rate_min: 21, certificates: "First Aid" } as unknown as Update)).toEqual(REFUSED);
    expect(session.ops.filter((o) => o.kind !== "select")).toEqual([]);
  });

  it("refuses an input that isn't an object", async () => {
    expect(await updateNannyProfile(null as unknown as Update)).toEqual(REFUSED);
    expect(session.ops).toEqual([]);
  });

  it("logs a failed write by its code only, never the row", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    session.writeErrors.user_profiles = { message: "violates check constraint", code: "23514", details: "Failing row contains (Sophie, Taylor, +447700900001)" };
    expect(await updateNannyProfile({ first_name: "Sophie" })).toEqual({ success: false, error: "Failed to update profile" });
    expect(spy).toHaveBeenCalledWith("Profile update error", { code: "23514" });
    session = fakeAdmin({ nannies: { id: NANNY } });
    session.writeErrors.nannies = { message: "violates check constraint", details: "Failing row contains (Sophie)" };
    expect(await updateNannyProfile({ hourly_rate_min: 21 })).toEqual({ success: false, error: "Failed to update nanny data" });
    expect(spy).toHaveBeenCalledWith("Nanny update error", { code: "Error" });
    expect(JSON.stringify(spy.mock.calls)).not.toMatch(/Sophie|Taylor|\+447700900001|Failing row/);
    spy.mockRestore();
  });

  it("asks a signed-out caller to sign in, writing nothing", async () => {
    signedIn = false;
    expect(await updateNannyProfile({ hourly_rate_min: 21 })).toEqual({ success: false, error: "Not authenticated" });
    expect(session.ops).toEqual([]);
  });
});

describe("updateNannyProfile — as before", () => {
  it("replaces her qualification, certificates and assurances, leaving out None", async () => {
    const sent = { highest_qualification: "Level 3", certificates: ["First Aid", "None"], assurances: ["Enhanced DBS", "None"] };
    expect(await updateNannyProfile(sent)).toEqual({ success: true, error: null });
    expect(writesTo(session, "nanny_credentials").map((w) => [w.kind, w.payload])).toEqual([
      ["delete", undefined],
      ["insert", { nanny_id: NANNY, credential_category: "qualification", qualification_type: "Level 3" }],
      ["insert", { nanny_id: NANNY, credential_category: "certification", certification_type: "First Aid" }],
    ]);
    expect(writesTo(session, "nanny_assurances").map((w) => [w.kind, w.payload])).toEqual([
      ["delete", undefined],
      ["insert", { nanny_id: NANNY, assurance_type: "Enhanced DBS" }],
    ]);
  });

  it("refuses inappropriate language in her motivation, writing nothing", async () => {
    const result = await updateNannyProfile({ motivation: "What a shit day" });
    expect(result.success).toBe(false);
    expect(session.ops.filter((o) => o.kind !== "select")).toEqual([]);
  });

  it("says so when her nannies row is missing", async () => {
    session.reads.nannies = null;
    expect(await updateNannyProfile({ hourly_rate_min: 21 })).toEqual({ success: false, error: "Nanny record not found" });
  });
});

describe("updateNannyProfile — her name and date of birth after the identity check", () => {
  it("refuses a name or date of birth once her identity is verified, writing nothing", async () => {
    for (const nanny of [{ identity_verified: true, verification_level: 0 }, { identity_verified: false, verification_level: 2 }, { identity_verified: false, verification_level: 4 }]) {
      admin.reads.nannies = nanny;
      for (const sent of [{ first_name: "Someone" }, { last_name: "Else" }, { date_of_birth: "2001-01-01" }, { first_name: "Someone", hourly_rate_min: 21 }]) {
        session = fakeAdmin({ nannies: { id: NANNY } });
        expect(await updateNannyProfile(sent)).toEqual({ success: false, error: PROFILE_MESSAGES.locked });
        expect(session.ops.filter((o) => o.kind !== "select")).toEqual([]);
      }
    }
  });

  it("refuses when her nannies row can't be read (locked)", async () => {
    admin.readErrors.nannies = { message: "timeout" };
    expect(await updateNannyProfile({ last_name: "Else" })).toEqual({ success: false, error: PROFILE_MESSAGES.locked });
    expect(writesTo(session, "user_profiles")).toEqual([]);
  });

  it("writes her name before the identity check, as before", async () => {
    expect(await updateNannyProfile({ first_name: "Sophie", last_name: "Taylor", date_of_birth: "1995-05-05" })).toEqual({ success: true, error: null });
    expect(writesTo(session, "user_profiles")[0]?.payload).toEqual({ first_name: "Sophie", last_name: "Taylor", date_of_birth: "1995-05-05" });
  });

  it("doesn't read the lock for an update without her name or date of birth", async () => {
    admin.reads.nannies = { identity_verified: true, verification_level: 4 };
    expect(await updateNannyProfile({ hourly_rate_min: 22, mobile_number: "+447700900001" })).toEqual({ success: true, error: null });
    expect(admin.ops).toEqual([]);
  });
});
