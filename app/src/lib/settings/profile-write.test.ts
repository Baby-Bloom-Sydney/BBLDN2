/**
 * Her profile row, read and written with the version she loaded (ledger B06 §9.1 R1, R2): the one writer the Profile,
 * Contact details and Business saves share. A row changed since she loaded it is `stale` and nothing is written; the
 * address is stored as verification stores it (street line, no second line, town, postcode).
 *
 * BB-wave1-041126/06b3-rework, 2026-11-09.
 */
import { describe, expect, it } from "vitest";
import { fakeAdmin } from "@/lib/payments/fake-admin.test-util";
import { readOwnProfile, writeOwnProfile } from "./profile-write";

const USER = "b0600000-0000-4000-8000-000000000001";
const VERSION = "2027-02-15T10:00:00.123456+00:00";

describe("readOwnProfile", () => {
  it("reads her name and version, hers only — never an address (security H1: hers is her own row)", async () => {
    const f = fakeAdmin({ user_profiles: { first_name: "Sophie", last_name: "Taylor", updated_at: VERSION } });
    expect(await readOwnProfile(f.client, USER)).toEqual({ firstName: "Sophie", lastName: "Taylor", updatedAt: VERSION });
    expect(f.ops[0]?.filters).toEqual([["eq", "user_id", USER]]);
  });

  it("no version yet → null version; no row or a failed read → null", async () => {
    const f = fakeAdmin({ user_profiles: { first_name: "Sophie", last_name: "Taylor", updated_at: null } });
    expect(await readOwnProfile(f.client, USER)).toEqual({ firstName: "Sophie", lastName: "Taylor", updatedAt: null });
    expect(await readOwnProfile(fakeAdmin({ user_profiles: null }).client, USER)).toBeNull();
    const failing = fakeAdmin();
    failing.readErrors.user_profiles = { message: "boom" };
    expect(await readOwnProfile(failing.client, USER)).toBeNull();
  });
});

describe("writeOwnProfile", () => {
  it("writes only if the row is still the version she loaded", async () => {
    const f = fakeAdmin();
    f.writeResults.user_profiles = [{ updated_at: "2027-02-15T10:05:00.000001+00:00" }];
    expect(await writeOwnProfile(f.client, USER, { mobile_number: "07700900123" }, VERSION))
      .toEqual({ status: "saved", updatedAt: "2027-02-15T10:05:00.000001+00:00" });
    expect(f.ops[0]).toMatchObject({ kind: "update", payload: { mobile_number: "07700900123" } });
    expect(f.ops[0]?.filters).toEqual([["eq", "user_id", USER], ["eq", "updated_at", VERSION]]);
  });

  it("a row with no version yet is matched as such", async () => {
    const f = fakeAdmin();
    f.writeResults.user_profiles = [{ updated_at: VERSION }];
    expect(await writeOwnProfile(f.client, USER, { first_name: "Sophie" }, null)).toEqual({ status: "saved", updatedAt: VERSION });
    expect(f.ops[0]?.filters).toEqual([["eq", "user_id", USER], ["is", "updated_at", null]]);
  });

  it("no row matched → stale (changed since); a write error → error", async () => {
    const f = fakeAdmin();
    f.writeResults.user_profiles = [];
    expect(await writeOwnProfile(f.client, USER, { first_name: "Sophie" }, VERSION)).toEqual({ status: "stale" });
    f.writeErrors.user_profiles = { message: "boom" };
    expect(await writeOwnProfile(f.client, USER, { first_name: "Sophie" }, VERSION)).toEqual({ status: "error" });
  });

});
