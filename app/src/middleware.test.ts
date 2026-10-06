/**
 * middleware — the env guard fails CLOSED.
 *
 * Defect context (LDN2 Stage 0 finding 6, §4.1; unit H1, `LEDGER/H1.md` §2):
 * the guard returned `NextResponse.next()` when either Supabase variable was
 * missing or malformed, so a single mistyped preview env var served the whole
 * application unauthenticated with no error and no log line. `ecc-lite` rule 5:
 * unknown or unconfigured must deny, not allow.
 *
 * `updateSession` is mocked — these tests are about the guard in front of it,
 * not about session management (that is `lib/supabase/middleware.test.ts`).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const state = vi.hoisted(() => ({
  updateSession: vi.fn(),
}));

vi.mock("@/lib/supabase/middleware", () => ({
  updateSession: state.updateSession,
}));

const ORIGINAL_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ORIGINAL_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const ORIGINAL_DEV_MODE = process.env.NEXT_PUBLIC_DEV_MODE;

beforeEach(() => {
  vi.resetModules();
  state.updateSession.mockReset();
  state.updateSession.mockResolvedValue(
    NextResponse.next({ headers: { "x-proceeded": "1" } }),
  );
  // The dev-mode bypass (middleware.ts:6) short-circuits before the guard and
  // is deliberately out of this unit's scope (P-22) — keep it off throughout.
  process.env.NEXT_PUBLIC_DEV_MODE = "false";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://localhost:54321";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-test-key";
});

afterEach(() => {
  vi.restoreAllMocks();
  restore("NEXT_PUBLIC_SUPABASE_URL", ORIGINAL_URL);
  restore("NEXT_PUBLIC_SUPABASE_ANON_KEY", ORIGINAL_KEY);
  restore("NEXT_PUBLIC_DEV_MODE", ORIGINAL_DEV_MODE);
});

function restore(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
}

async function call(pathname = "/parent") {
  const { middleware } = await import("./middleware");
  return middleware(new NextRequest(new URL(pathname, "http://localhost")));
}

describe("middleware env guard — fails closed (Stage 0 finding 6)", () => {
  it("returns 503 when NEXT_PUBLIC_SUPABASE_ANON_KEY is missing", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    const response = await call();

    expect(response.status).toBe(503);
    expect(await response.text()).toBe(
      "Service unavailable: configuration missing",
    );
    expect(state.updateSession).not.toHaveBeenCalled();
  });

  it("returns 503 when NEXT_PUBLIC_SUPABASE_URL is missing", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;

    const response = await call();

    expect(response.status).toBe(503);
    expect(state.updateSession).not.toHaveBeenCalled();
  });

  it("returns 503 when NEXT_PUBLIC_SUPABASE_URL is not an http URL", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    process.env.NEXT_PUBLIC_SUPABASE_URL = "localhost:54321";

    const response = await call();

    expect(response.status).toBe(503);
    expect(state.updateSession).not.toHaveBeenCalled();
  });

  it("names the missing variable in a single console.error and never its value", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "super-secret-anon-key";
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;

    await call();

    expect(consoleError).toHaveBeenCalledTimes(1);
    const logged = consoleError.mock.calls[0].join(" ");
    expect(logged).toContain("NEXT_PUBLIC_SUPABASE_URL");
    expect(logged).not.toContain("super-secret-anon-key");
  });

  it("lets the request proceed to updateSession when both variables are set", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    const response = await call();

    expect(state.updateSession).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(200);
    expect(response.headers.get("x-proceeded")).toBe("1");
    expect(consoleError).not.toHaveBeenCalled();
  });
});
