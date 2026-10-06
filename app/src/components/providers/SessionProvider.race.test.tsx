/**
 * Unit 3b (BB-LDN-3b-061026) — security review of dc39a0e (MEDIUM): the deferred fetchUserData had no staleness
 * guard, so a slow role/profile fetch could land after SIGNED_OUT, or overwrite a newly signed-in user's data.
 * Results are now dropped unless they belong to the current user; an error / no row clears role and profile (LOW).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, cleanup, waitFor, screen, act } from "@testing-library/react";

type Result = { data: unknown; error: unknown };
const sb = vi.hoisted(() => ({
  listener: null as null | ((event: string, session: unknown) => unknown),
  pending: new Map<string, (r: { data: unknown; error: unknown }) => void>(),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      getSession: async () => ({ data: { session: null } }),
      onAuthStateChange: (cb: (event: string, session: unknown) => unknown) => {
        sb.listener = cb;
        return { data: { subscription: { unsubscribe: vi.fn() } } };
      },
      signOut: vi.fn(),
    },
    from: (table: string) => {
      let uid = "";
      const q = {
        select: () => q,
        eq: (_c: string, v: string) => {
          uid = v;
          return q;
        },
        single: () => new Promise<Result>((resolve) => sb.pending.set(`${table}:${uid}`, resolve)),
      };
      return q;
    },
  }),
}));

import { SessionProvider } from "./SessionProvider";
import { useAuth } from "@/contexts/AuthContext";

function Probe() {
  const { role, profile } = useAuth();
  return <p data-testid="probe">{`${role ?? "none"}|${(profile as { first_name?: string } | null)?.first_name ?? "none"}`}</p>;
}

const probe = () => screen.getByTestId("probe").textContent;

async function signIn(id: string, event = "SIGNED_IN") {
  await act(async () => {
    sb.listener!(event, { user: { id } });
    await new Promise((r) => setTimeout(r, 0));
  });
}

async function answer(table: string, id: string, r: Result) {
  await waitFor(() => expect(sb.pending.has(`${table}:${id}`)).toBe(true));
  await act(async () => {
    sb.pending.get(`${table}:${id}`)!(r);
    sb.pending.delete(`${table}:${id}`);
    await new Promise((res) => setTimeout(res, 0));
  });
}

beforeEach(async () => {
  sb.pending.clear();
  sb.listener = null;
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
  render(<SessionProvider><Probe /></SessionProvider>);
  await waitFor(() => expect(sb.listener).not.toBeNull());
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("SessionProvider — deferred fetch staleness guard", () => {
  it("drops a role/profile that arrives after SIGNED_OUT", async () => {
    await signIn("user-1");
    await act(async () => {
      sb.listener!("SIGNED_OUT", null);
    });
    await answer("user_roles", "user-1", { data: { role: "nanny" }, error: null });
    await answer("user_profiles", "user-1", { data: { first_name: "Jane" }, error: null }).catch(() => {});
    expect(probe()).toBe("none|none");
  });

  it("never lets a slow fetch for the previous user overwrite the new user", async () => {
    await signIn("user-1");
    await signIn("user-2");
    await answer("user_roles", "user-2", { data: { role: "parent" }, error: null });
    await answer("user_profiles", "user-2", { data: { first_name: "Sam" }, error: null });
    await answer("user_roles", "user-1", { data: { role: "nanny" }, error: null });
    await answer("user_profiles", "user-1", { data: { first_name: "Jane" }, error: null }).catch(() => {});
    expect(probe()).toBe("parent|Sam");
  });

  it("clears role and profile when a later fetch errors or finds no row", async () => {
    await signIn("user-1");
    await answer("user_roles", "user-1", { data: { role: "nanny" }, error: null });
    await answer("user_profiles", "user-1", { data: { first_name: "Jane" }, error: null });
    expect(probe()).toBe("nanny|Jane");
    await signIn("user-1", "USER_UPDATED");
    await answer("user_roles", "user-1", { data: null, error: { message: "boom" } });
    await answer("user_profiles", "user-1", { data: null, error: null });
    expect(probe()).toBe("none|none");
  });
});
