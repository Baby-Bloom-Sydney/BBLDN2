/**
 * The admin proof (04a security review H2e): only `proveAdmin()` makes one, and only after `requireAdmin()` passes.
 * A look-alike object is not a proof.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const { requireAdmin } = vi.hoisted(() => ({ requireAdmin: vi.fn() }));
vi.mock("@/lib/admin/require-admin", () => ({ requireAdmin }));

import { isAdminProof, proveAdmin, type AdminProof } from "./admin-proof";

const ADMIN = "a0400000-0000-4000-8000-000000000001";

afterEach(() => vi.restoreAllMocks());

describe("proveAdmin", () => {
  it("an admin session → a frozen proof carrying her user id", async () => {
    requireAdmin.mockResolvedValueOnce({ userId: ADMIN, error: null });
    const proof = await proveAdmin();
    expect(proof).toEqual({ kind: "admin_proof", userId: ADMIN });
    expect(Object.isFrozen(proof)).toBe(true);
    expect(isAdminProof(proof)).toBe(true);
  });

  it.each([
    { userId: "", error: "Not authenticated" },
    { userId: "", error: "Not authorized — admin role required" },
    { userId: "", error: null },
  ])("no admin (%j) → null", async (gate) => {
    requireAdmin.mockResolvedValueOnce(gate);
    expect(await proveAdmin()).toBeNull();
  });

  it("a gate that throws → null, logged by name only", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    requireAdmin.mockRejectedValueOnce(new TypeError("cookies() outside a request"));
    expect(await proveAdmin()).toBeNull();
    expect(log).toHaveBeenCalledWith("[calls/admin-proof] the admin check failed", { name: "TypeError" });
  });
});

describe("isAdminProof", () => {
  it("refuses a look-alike, a copy of a real proof, and non-objects", async () => {
    requireAdmin.mockResolvedValueOnce({ userId: ADMIN, error: null });
    const real = await proveAdmin();
    const forged = { kind: "admin_proof", userId: ADMIN } as unknown as AdminProof;
    expect(isAdminProof(forged)).toBe(false);
    expect(isAdminProof({ ...real })).toBe(false);
    expect(isAdminProof(null)).toBe(false);
    expect(isAdminProof("admin_proof")).toBe(false);
  });
});
