/**
 * `identityLocked`: her name and date of birth are fixed once her identity is verified — `nannies.identity_verified`,
 * or verification level 2 and up. A row that can't be read counts as locked; no nannies row (not a nanny) does not.
 *
 * BB-wave1-041126, 2026-11-09.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeAdmin, type FakeAdmin } from "@/lib/payments/fake-admin.test-util";

const USER = "b0600000-0000-4000-8000-000000000001";
let admin: FakeAdmin;
let broken = false;

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    if (broken) throw new Error("Missing Supabase environment variables");
    return admin.client;
  },
}));

import { identityLocked } from "./identity-lock";

beforeEach(() => {
  admin = fakeAdmin();
  broken = false;
});

describe("identityLocked", () => {
  it("locks once her identity is verified, whatever the level", async () => {
    admin.reads.nannies = { identity_verified: true, verification_level: 0 };
    expect(await identityLocked(USER)).toBe(true);
  });

  it("locks at level 2 and above", async () => {
    for (const level of [2, 3, 4]) {
      admin.reads.nannies = { identity_verified: false, verification_level: level };
      expect(await identityLocked(USER)).toBe(true);
    }
  });

  it("does not lock before the identity check", async () => {
    for (const level of [0, 1, null]) {
      admin.reads.nannies = { identity_verified: false, verification_level: level };
      expect(await identityLocked(USER)).toBe(false);
    }
  });

  it("does not lock without a nannies row", async () => {
    admin.reads.nannies = null;
    expect(await identityLocked(USER)).toBe(false);
  });

  it("locks when her row can't be read", async () => {
    vi.spyOn(console, "error").mockImplementationOnce(() => {});
    admin.readErrors.nannies = { message: "timeout" };
    expect(await identityLocked(USER)).toBe(true);
  });

  it("locks, and logs a code only, when the service client can't be made", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    broken = true;
    expect(await identityLocked(USER)).toBe(true);
    expect(spy).toHaveBeenCalledWith("[identityLocked] lookup failed", { code: "Error" });
    spy.mockRestore();
  });

  it("logs a read error by its code only", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    admin.readErrors.nannies = { message: "Failing row contains (Sophie)", code: "57014" };
    expect(await identityLocked(USER)).toBe(true);
    expect(spy).toHaveBeenCalledWith("[identityLocked] lookup failed", { code: "57014" });
    expect(JSON.stringify(spy.mock.calls)).not.toMatch(/Sophie/);
    spy.mockRestore();
  });

  it("reads only her row, by her user id", async () => {
    admin.reads.nannies = { identity_verified: false, verification_level: 1 };
    await identityLocked(USER);
    expect(admin.ops).toEqual([{ table: "nannies", kind: "select", payload: undefined, filters: [["eq", "user_id", USER]] }]);
  });
});
