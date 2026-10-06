/**
 * Unit 3b (BB-LDN-3b-061026) — found by the live walk: every browser upload (passport, selfie, DBS certificate)
 * hung at 0 %, because the auth listener awaited a Supabase query while auth-js held its auth-token lock — the query
 * waits for that same lock, so the lock is never released and every later `auth.getUser()` waits for ever.
 * supabase-js guidance: an `onAuthStateChange` callback must not await Supabase calls; defer them.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, cleanup, waitFor } from "@testing-library/react";

const sb = vi.hoisted(() => ({
  listener: null as null | ((event: string, session: unknown) => unknown),
  from: vi.fn(),
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
      sb.from(table);
      const q = { select: () => q, eq: () => q, single: async () => ({ data: null, error: null }) };
      return q;
    },
  }),
}));

import { SessionProvider } from "./SessionProvider";

afterEach(cleanup);

describe("SessionProvider auth listener", () => {
  it.each(["SIGNED_IN", "USER_UPDATED"])(
    "returns synchronously on %s and queries only after the callback has returned (no deadlock on the auth lock)",
    async (event) => {
      render(<SessionProvider><div /></SessionProvider>);
      await waitFor(() => expect(sb.listener).not.toBeNull());
      sb.from.mockClear();

      const returned = sb.listener!(event, { user: { id: "user-1" } });

      expect(returned instanceof Promise).toBe(false);
      expect(sb.from).not.toHaveBeenCalled();
      await waitFor(() => expect(sb.from).toHaveBeenCalledWith("user_roles"));
    },
  );
});
