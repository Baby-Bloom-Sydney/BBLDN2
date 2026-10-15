/**
 * Unit 5a (BB-LDN-5a-151026) — `/nanny/profiletest` is a demo sandbox that answers only to an admin
 * (R-1). The middleware already lets only admins through; the page's own `requireAdmin()` is the second
 * lock and turns anyone else into a 404.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const gate = vi.hoisted(() => ({ result: { userId: "", error: null as string | null } }));

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));
vi.mock("@/lib/admin/require-admin", () => ({
  requireAdmin: async () => gate.result,
}));
vi.mock("./ProfileTestClient", () => ({
  ProfileTestClient: () => null,
}));

import ProfileTestPage from "./page";

describe("/nanny/profiletest — admin only (5a, R-1)", () => {
  beforeEach(() => {
    gate.result = { userId: "", error: null };
  });

  it("404s for a signed-out visitor", async () => {
    gate.result = { userId: "", error: "Not authenticated" };

    await expect(ProfileTestPage()).rejects.toThrow("NOT_FOUND");
  });

  it("404s for a non-admin (nanny or parent)", async () => {
    gate.result = { userId: "", error: "Not authorized — admin role required" };

    await expect(ProfileTestPage()).rejects.toThrow("NOT_FOUND");
  });

  it("renders the sandbox for an admin", async () => {
    gate.result = { userId: "admin-1", error: null };

    const el = await ProfileTestPage();

    expect(el).toBeTruthy();
  });
});
