/**
 * GET /api/admin — admin-only (5e, coordinator ruling 2026-10-15).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const gate = vi.hoisted(() => ({ result: { userId: "admin-1", error: null as string | null } }));
vi.mock("@/lib/admin/require-admin", () => ({ requireAdmin: vi.fn(async () => gate.result) }));

const createAdminClient = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient }));

/** Every query resolves `{ data, count, error }`; any chain method returns the same thenable. */
function client(data: unknown = [], count = 0): unknown {
  return {
    from: () => {
      const target: Record<string, unknown> = {};
      const proxy: unknown = new Proxy(target, {
        get(_t, prop: string) {
          if (prop === "then") return (resolve: (v: unknown) => unknown) => resolve({ data, count, error: null });
          return () => proxy;
        },
      });
      return proxy;
    },
  };
}

const ANON = { userId: "", error: "Not authenticated" };
const NOT_ADMIN = { userId: "", error: "Not authorized — admin role required" };

import { GET } from "./route";

describe("GET /api/admin — requireAdmin first (5e, coordinator ruling)", () => {
  beforeEach(() => {
    createAdminClient.mockReset();
    createAdminClient.mockImplementation(() => client());
    gate.result = { userId: "admin-1", error: null };
  });

  it("anonymous → 401, no service-role client created", async () => {
    gate.result = ANON;
    const res = await GET();
    expect(res.status).toBe(401);
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("signed-in non-admin → 403, no service-role client created", async () => {
    gate.result = NOT_ADMIN;
    const res = await GET();
    expect(res.status).toBe(403);
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("admin → proceeds", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ message: "Admin API" });
  });
});
