/**
 * updateSession — public-marketing-root redirect for logged-in users.
 *
 * Bug context (T-030, 2026-05-20): logged-in users hitting `/` saw the
 * marketing landing page instead of their role hub. Existing middleware
 * had redirects for (protected + no session) and (auth + session), but
 * no rule for (public-root + session). These tests cover the new third
 * rule plus its fail-soft posture.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

const state = vi.hoisted(() => ({
  user: null as null | { id: string },
  roleData: null as null | { role: string },
  roleErr: null as null | { message: string },
}));

beforeEach(() => {
  state.user = null;
  state.roleData = null;
  state.roleErr = null;
  vi.resetModules();
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://localhost:54321";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-test-key";
});

afterEach(() => {
  vi.unstubAllEnvs();
});

/* eslint-disable @typescript-eslint/no-explicit-any */
vi.mock("@supabase/ssr", () => ({
  createServerClient: () =>
    ({
      auth: {
        getUser: async () => ({
          data: { user: state.user },
          error: null,
        }),
      },
      from: (_table: string) => ({
        select: () => ({
          eq: () => ({
            single: async () => ({
              data: state.roleData,
              error: state.roleErr,
            }),
          }),
        }),
      }),
    }) as any,
}));
/* eslint-enable @typescript-eslint/no-explicit-any */

async function callMiddleware(pathname: string) {
  const { updateSession } = await import("./middleware");
  const req = new NextRequest(new URL(pathname, "http://localhost"));
  return updateSession(req);
}

describe("updateSession — public-marketing-root redirect (logged-in)", () => {
  it("redirects logged-in nanny from / to /nanny", async () => {
    state.user = { id: "user-nanny" };
    state.roleData = { role: "nanny" };

    const res = await callMiddleware("/");

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("http://localhost/nanny");
  });

  it("redirects logged-in parent from / to /parent", async () => {
    state.user = { id: "user-parent" };
    state.roleData = { role: "parent" };

    const res = await callMiddleware("/");

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("http://localhost/parent");
  });

  it("redirects logged-in admin from / to /admin/dashboard", async () => {
    state.user = { id: "user-admin" };
    state.roleData = { role: "admin" };

    const res = await callMiddleware("/");

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe(
      "http://localhost/admin/dashboard",
    );
  });

  it("redirects logged-in super_admin from / to /admin/dashboard", async () => {
    state.user = { id: "user-super-admin" };
    state.roleData = { role: "super_admin" };

    const res = await callMiddleware("/");

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe(
      "http://localhost/admin/dashboard",
    );
  });

  it("does NOT redirect logged-out visitor on /", async () => {
    state.user = null;

    const res = await callMiddleware("/");

    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
  });

  it("does NOT redirect when role lookup fails — fail-soft posture preserved", async () => {
    // The existing getUser() call (line 79-84 of middleware.ts) wraps in
    // try/catch + treats failure as unauthenticated. The new public-root
    // branch must inherit that posture: a transient DB blip on the
    // user_roles lookup should not error the page render or trap the user
    // in a redirect loop — let the request fall through to the normal
    // public-route response and rely on the eventually-consistent retry.
    state.user = { id: "user-no-role" };
    state.roleData = null;
    state.roleErr = { message: "transient db failure" };

    const res = await callMiddleware("/");

    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
  });

  it("does NOT redirect when role value is outside the known UserRole union", async () => {
    // Defence-in-depth: getUserRole() casts the DB value `as UserRole`
    // without a runtime union check. If the row contains a dirty value
    // (legacy role, test fixture, typo), `ROLE_DASHBOARDS[badRole]`
    // returns undefined and `new URL(undefined, ...)` would coerce to
    // a 307 to /undefined. The branch must guard via the lookup, not
    // the raw role value, so unmappable roles fall through cleanly.
    state.user = { id: "user-dirty-role" };
    state.roleData = { role: "moderator" }; // not in ROLE_DASHBOARDS

    const res = await callMiddleware("/");

    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
  });

  it("does NOT redirect logged-in user on other public routes (only exact /)", async () => {
    // Routes like /about, /babysitting/[id], /browse, /pricing, /legal/*
    // are intentionally viewable by logged-in users. The redirect must be
    // narrow: only the marketing landing page (exact match on `/`) — not
    // every public path.
    state.user = { id: "user-nanny" };
    state.roleData = { role: "nanny" };

    const aboutRes = await callMiddleware("/about");
    expect(aboutRes.status).toBe(200);
    expect(aboutRes.headers.get("location")).toBeNull();

    const babysittingRes = await callMiddleware("/babysitting/abc-123");
    expect(babysittingRes.status).toBe(200);
    expect(babysittingRes.headers.get("location")).toBeNull();
  });
});

describe("updateSession — existing behaviour preserved (regression guard)", () => {
  it("logged-in user on /login still redirects to dashboard (auth-route rule)", async () => {
    state.user = { id: "user-nanny" };
    state.roleData = { role: "nanny" };

    const res = await callMiddleware("/login");

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("http://localhost/nanny");
  });

  it("logged-out user on /nanny still redirects to /login (protected-route rule)", async () => {
    state.user = null;

    const res = await callMiddleware("/nanny");

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe(
      "http://localhost/login?redirect=%2Fnanny",
    );
  });
});

/**
 * 5a — the six demo/test roots answer only to an admin (R-1, Stage 5).
 * Each root is matched as itself or itself followed by "/"; `/nanny/profiletest`
 * is decided before the `/nanny` prefix so an admin reaches it.
 */
describe("updateSession — demo/test roots gated behind admin (5a, R-1)", () => {
  const DEMO_PATHS = [
    "/ui",
    "/ui/embed/button",
    "/ui2",
    "/brandkit1",
    "/test",
    "/test/shareprofile",
    "/bb/test",
    "/bb/test/position-apply",
    "/nanny/profiletest",
  ];

  it.each(DEMO_PATHS)("anonymous visitor on %s is redirected to /login", async (path) => {
    state.user = null;

    const res = await callMiddleware(path);

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe(
      `http://localhost/login?redirect=${encodeURIComponent(path)}`,
    );
  });

  it.each(DEMO_PATHS)("nanny on %s is redirected to /nanny", async (path) => {
    state.user = { id: "user-nanny" };
    state.roleData = { role: "nanny" };

    const res = await callMiddleware(path);

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("http://localhost/nanny");
  });

  it.each(DEMO_PATHS)("parent on %s is redirected to /parent", async (path) => {
    state.user = { id: "user-parent" };
    state.roleData = { role: "parent" };

    const res = await callMiddleware(path);

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("http://localhost/parent");
  });

  it.each(DEMO_PATHS)("admin on %s passes through", async (path) => {
    state.user = { id: "user-admin" };
    state.roleData = { role: "admin" };

    const res = await callMiddleware(path);

    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
  });

  it("signed-in user with no role row on /test is redirected to /login", async () => {
    state.user = { id: "user-no-role" };
    state.roleData = null;

    const res = await callMiddleware("/test");

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("http://localhost/login");
  });

  it("super_admin on /nanny/profiletest passes through", async () => {
    state.user = { id: "user-super" };
    state.roleData = { role: "super_admin" };

    const res = await callMiddleware("/nanny/profiletest");

    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
  });

  it.each(["/testimonials", "/uikit", "/brandkit10", "/bb/testing"])(
    "anonymous visitor on %s is not caught by a demo root (boundary match)",
    async (path) => {
      state.user = null;

      const res = await callMiddleware(path);

      expect(res.status).toBe(200);
      expect(res.headers.get("location")).toBeNull();
    },
  );

  it("admin on /nanny (not a demo root) is still redirected to /admin/dashboard", async () => {
    state.user = { id: "user-admin" };
    state.roleData = { role: "admin" };

    const res = await callMiddleware("/nanny");

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("http://localhost/admin/dashboard");
  });

  it("nanny on /nanny/profile (sibling of profiletest) still passes through", async () => {
    state.user = { id: "user-nanny" };
    state.roleData = { role: "nanny" };

    const res = await callMiddleware("/nanny/profile");

    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
  });
});
