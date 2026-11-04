/**
 * The nanny proof (plan 06 §9 surface 3; the 04a/02 review lesson): every invoice operation for a nanny takes one,
 * and only `proveNanny()` makes one — from the request's session, never from an id a caller passes.
 * BB-wave1-041126/06a-build, 2026-11-04.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getNannyId } = vi.hoisted(() => ({ getNannyId: vi.fn() }));
vi.mock("@/lib/actions/connection", () => ({ getNannyId }));

import { isNannyProof, proveNanny } from "./nanny-proof";

const NANNY = { nannyId: "b0600000-0000-4000-8000-000000000101", userId: "b0600000-0000-4000-8000-000000000001" };

beforeEach(() => vi.stubEnv("NANNY_INVOICES_ENABLED", "true"));
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  getNannyId.mockReset();
});

describe("proveNanny", () => {
  it("a nanny session → a frozen proof carrying her nanny and user ids", async () => {
    getNannyId.mockResolvedValueOnce(NANNY);
    const proof = await proveNanny();
    expect(proof).toEqual({ kind: "nanny_proof", ...NANNY });
    expect(Object.isFrozen(proof)).toBe(true);
    expect(isNannyProof(proof)).toBe(true);
  });

  it("no nanny session → null", async () => {
    getNannyId.mockResolvedValueOnce(null);
    expect(await proveNanny()).toBeNull();
  });

  it("a session check that throws → null, logged by error name only", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    getNannyId.mockRejectedValueOnce(new TypeError("cookies() outside a request"));
    expect(await proveNanny()).toBeNull();
    expect(log).toHaveBeenCalledWith("[invoices] the nanny check failed", { code: "TypeError" });
  });

  it("a malformed answer → null", async () => {
    getNannyId.mockResolvedValueOnce({ nannyId: "", userId: NANNY.userId });
    expect(await proveNanny()).toBeNull();
  });

  it("switch off → null before the session is read", async () => {
    vi.stubEnv("NANNY_INVOICES_ENABLED", "");
    expect(await proveNanny()).toBeNull();
    expect(getNannyId).not.toHaveBeenCalled();
  });
});

describe("isNannyProof", () => {
  it("refuses a look-alike, a copy and a cast", async () => {
    getNannyId.mockResolvedValueOnce(NANNY);
    const real = await proveNanny();
    expect(isNannyProof({ kind: "nanny_proof", ...NANNY })).toBe(false);
    expect(isNannyProof({ ...real })).toBe(false);
    expect(isNannyProof(null)).toBe(false);
    expect(isNannyProof("nanny_proof")).toBe(false);
  });
});
