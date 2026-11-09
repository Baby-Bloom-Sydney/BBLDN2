/**
 * Her home address (06b-3 rework, security H1 — coordinator, option (a), ledger B06 §9.11): her own owner-only row,
 * `nanny_home_addresses` (amendment 21), never her profile row, which parents may read for a visible nanny.
 * - read with her own session (RLS: her row only), its version exactly as stored;
 * - what Profile and Business show: her row, or with none her area from her profile (what she saw before);
 * - the row's parts from what she picked: a second line folded into the street line, the postcode as stored;
 * - the two saves, through the service client after her session has been proved by the caller: the address alone
 *   (Business; the residence step with any version) and the Profile save (name, date of birth and address at once,
 *   with both versions). Neither writes her profile row directly.
 *
 * BB-wave1-041126/06b3-rework, 2026-11-09.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeAdmin, type FakeAdmin } from "@/lib/payments/fake-admin.test-util";

let admin: FakeAdmin;
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => admin.client }));

import { homeParts, readOwnHome, saveHomeAddress, saveOwnProfile, shownHome } from "./home-address";

const USER = "b0600000-0000-4000-8000-000000000001";
const VERSION = "2027-02-15T10:00:00.123456+00:00";
const NEWER = "2027-02-15T10:05:00.000001+00:00";
const ROW = { line1: "1 Upper Street", town: "London", postcode: "N1 0AA", updated_at: VERSION };
const HOME = { line1: "7 New Road", line2: "", town: "London", postcode: "N1 1AA" };

beforeEach(() => {
  admin = fakeAdmin();
});

describe("readOwnHome", () => {
  it("reads her own row with her session, its version exactly as stored", async () => {
    const session = fakeAdmin({ nanny_home_addresses: ROW });
    expect(await readOwnHome(session.client, USER)).toEqual({
      home: { line1: "1 Upper Street", line2: "", town: "London", postcode: "N1 0AA" }, updatedAt: VERSION,
    });
    expect(session.ops.map((o) => [o.table, o.kind])).toEqual([["nanny_home_addresses", "select"]]);
    expect(session.ops[0]?.filters).toEqual([["eq", "user_id", USER]]);
  });

  it("no row → no address and no version; no town → a blank town; a failed read → null", async () => {
    expect(await readOwnHome(fakeAdmin({ nanny_home_addresses: null }).client, USER)).toEqual({ home: null, updatedAt: null });
    expect((await readOwnHome(fakeAdmin({ nanny_home_addresses: { ...ROW, town: null } }).client, USER))?.home)
      .toEqual({ line1: "1 Upper Street", line2: "", town: "", postcode: "N1 0AA" });
    const failing = fakeAdmin();
    failing.readErrors.nanny_home_addresses = { message: "boom" };
    expect(await readOwnHome(failing.client, USER)).toBeNull();
  });
});

describe("shownHome", () => {
  const own = { line1: "1 Upper Street", line2: "", town: "London", postcode: "N1 0AA" };

  it("her row when she has one", () => {
    expect(shownHome(own, { suburb: "Elsewhere", postcode: "E1 1AA" })).toEqual(own);
  });

  it("with none, her area from her profile, as she saw it before; nothing at all → null", () => {
    expect(shownHome(null, { suburb: "London", postcode: "SW4 7AA" })).toEqual({ line1: "", line2: "", town: "London", postcode: "SW4 7AA" });
    expect(shownHome(null, { suburb: null, postcode: " " })).toBeNull();
  });
});

describe("homeParts", () => {
  it("folds a second line into the street line, trims, stores the postcode in capitals with one space", () => {
    expect(homeParts({ line1: " 1 Upper Street ", line2: " Islington ", town: " London ", postcode: "n10aa" }))
      .toEqual({ line1: "1 Upper Street, Islington", town: "London", postcode: "N1 0AA" });
    expect(homeParts({ ...HOME, town: " " })).toEqual({ line1: "7 New Road", town: null, postcode: "N1 1AA" });
  });
});

describe("saveHomeAddress", () => {
  it("saves through the address save with the version she loaded, for her user id; nothing written to her profile here", async () => {
    admin.rpcResults.nanny_home_address_save = { data: { status: "saved", changed: true, updated_at: NEWER }, error: null };
    expect(await saveHomeAddress(USER, HOME, VERSION)).toEqual({ status: "saved", updatedAt: NEWER });
    expect(admin.rpcCalls).toEqual([{
      fn: "nanny_home_address_save",
      args: { p_user: USER, p_line1: "7 New Road", p_town: "London", p_postcode: "N1 1AA", p_expected_updated_at: VERSION, p_any_version: false },
    }]);
    expect(admin.ops).toEqual([]);
  });

  it("the residence step replaces it whatever the version", async () => {
    admin.rpcResults.nanny_home_address_save = { data: { status: "saved", changed: true, updated_at: NEWER }, error: null };
    await saveHomeAddress(USER, HOME, null, true);
    expect(admin.rpcCalls[0]?.args).toMatchObject({ p_expected_updated_at: null, p_any_version: true });
  });

  it("stale and invalid as answered; a failed call or an odd reply → error", async () => {
    for (const status of ["stale", "invalid"] as const) {
      admin.rpcResults.nanny_home_address_save = { data: { status }, error: null };
      expect(await saveHomeAddress(USER, HOME, VERSION)).toEqual({ status });
    }
    admin.rpcResults.nanny_home_address_save = { data: null, error: { message: "boom", code: "XX000" } };
    expect(await saveHomeAddress(USER, HOME, VERSION)).toEqual({ status: "error" });
    for (const odd of [{ status: "saved" }, { status: "nanny_inactive" }, "saved", null]) {
      admin.rpcResults.nanny_home_address_save = { data: odd, error: null };
      expect(await saveHomeAddress(USER, HOME, VERSION)).toEqual({ status: "error" });
    }
  });
});

describe("a failed call (security review L4)", () => {
  it("is logged by its code only — never its words, which can carry the row — for both saves", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const failed = { data: null, error: { message: "new row violates check", code: "23514", details: "Failing row contains (7 New Road)" } };
    admin.rpcResults.nanny_home_address_save = failed;
    admin.rpcResults.nanny_profile_save = { ...failed, error: { ...failed.error, code: "42501" } };
    expect(await saveHomeAddress(USER, HOME, VERSION)).toEqual({ status: "error" });
    expect(await saveOwnProfile(USER, { address: HOME }, { profile: VERSION, address: VERSION })).toEqual({ status: "error" });
    expect(spy.mock.calls).toEqual([
      ["[home-address] nanny_home_address_save failed", { code: "23514" }],
      ["[home-address] nanny_profile_save failed", { code: "42501" }],
    ]);
    expect(JSON.stringify(spy.mock.calls)).not.toMatch(/New Road|check/);
    spy.mockRestore();
  });
});

describe("saveOwnProfile", () => {
  it("name, date of birth and address at once, each row with the version she loaded; both versions back", async () => {
    admin.rpcResults.nanny_profile_save = { data: { status: "saved", profile_updated_at: NEWER, address_updated_at: NEWER }, error: null };
    const r = await saveOwnProfile(USER, { first_name: " Sophie ", last_name: "Taylor", date_of_birth: "1995-03-12", address: HOME }, { profile: VERSION, address: null });
    expect(r).toEqual({ status: "saved", profileUpdatedAt: NEWER, addressUpdatedAt: NEWER });
    expect(admin.rpcCalls).toEqual([{
      fn: "nanny_profile_save",
      args: {
        p_user: USER, p_first_name: "Sophie", p_last_name: "Taylor", p_date_of_birth: "1995-03-12",
        p_line1: "7 New Road", p_town: "London", p_postcode: "N1 1AA",
        p_expected_profile_updated_at: VERSION, p_expected_address_updated_at: null,
      },
    }]);
    expect(admin.ops).toEqual([]);
  });

  it("only what she changed is sent; the rest left as it is (null)", async () => {
    admin.rpcResults.nanny_profile_save = { data: { status: "saved", profile_updated_at: NEWER, address_updated_at: null }, error: null };
    expect(await saveOwnProfile(USER, { last_name: "Taylor-Brown" }, { profile: VERSION, address: null }))
      .toEqual({ status: "saved", profileUpdatedAt: NEWER, addressUpdatedAt: null });
    expect(admin.rpcCalls[0]?.args).toMatchObject({
      p_first_name: null, p_last_name: "Taylor-Brown", p_date_of_birth: null, p_line1: null, p_town: null, p_postcode: null,
    });
  });

  it("stale and invalid as answered; a failed call or an odd reply → error", async () => {
    for (const status of ["stale", "invalid"] as const) {
      admin.rpcResults.nanny_profile_save = { data: { status }, error: null };
      expect(await saveOwnProfile(USER, { last_name: "T" }, { profile: VERSION, address: VERSION })).toEqual({ status });
    }
    admin.rpcResults.nanny_profile_save = { data: null, error: { message: "boom", code: "XX000" } };
    expect(await saveOwnProfile(USER, { last_name: "T" }, { profile: VERSION, address: VERSION })).toEqual({ status: "error" });
    admin.rpcResults.nanny_profile_save = { data: { status: "saved", address_updated_at: NEWER }, error: null };
    expect(await saveOwnProfile(USER, { last_name: "T" }, { profile: VERSION, address: VERSION })).toEqual({ status: "error" });
  });
});
