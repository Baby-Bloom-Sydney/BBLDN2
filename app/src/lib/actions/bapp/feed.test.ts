/**
 * `getFeed` — A-09 column-enumeration contract.
 *
 * The user-facing feed read MUST omit `internal_notes` (Katie's
 * private context column). Postgres has no column-level RLS, so
 * the enforcement boundary is the explicit-column SELECT list in
 * `getFeed`. This test pins that contract: if a refactor
 * accidentally restores `select("*")` (or adds the column to the
 * enumerated list), this test fails before the regression ships.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

const queryMock = vi.fn();
const fromAdminMock = vi.fn();
const getUserMock = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: () => ({
    auth: { getUser: () => getUserMock() },
  }),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => fromAdminMock(table),
  }),
}));

// The caller is the child's parent or nanny (that check has its own tests: lib/bapp/child-member.test.ts).
vi.mock("@/lib/bapp/child-member", () => ({ isChildMember: async () => true, CHILD_NOT_FOUND: "Child not found" }));

const USER_ID = "11111111-1111-4000-8000-111111111111";
const CHILD_ID = "22222222-2222-4000-8000-222222222222";

beforeEach(() => {
  vi.resetModules();
  queryMock.mockReset();
  fromAdminMock.mockReset();
  getUserMock.mockReset();

  getUserMock.mockResolvedValue({
    data: { user: { id: USER_ID } },
    error: null,
  });

  // No logs by default — we're asserting on the SELECT call shape,
  // not the row-mapping side. Tests that need rows override this.
  queryMock.mockResolvedValue({ data: [], error: null });

  // Build the chain: from('bapp_logs').select(cols).eq.eq.order.limit
  // returns the awaited result. We inspect the first arg passed to
  // `select` to verify the column list.
  const limitFn = vi.fn().mockImplementation(() => queryMock());
  const orderFn = vi.fn().mockReturnValue({ limit: limitFn });
  const eqIsActiveFn = vi.fn().mockReturnValue({ order: orderFn });
  const eqChildFn = vi.fn().mockReturnValue({ eq: eqIsActiveFn });

  const selectFn = vi.fn().mockReturnValue({ eq: eqChildFn });
  fromAdminMock.mockReturnValue({ select: selectFn });

  // Expose the select spy so the test can read it.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).__feedSelectSpy = selectFn;
});

describe("getFeed — column-list contract", () => {
  it("calls .select() with an explicit column list and OMITS internal_notes", async () => {
    const { getFeed } = await import("./feed");
    await getFeed(CHILD_ID);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const selectSpy = (globalThis as any).__feedSelectSpy as ReturnType<
      typeof vi.fn
    >;
    expect(selectSpy).toHaveBeenCalledTimes(1);
    const columnList = selectSpy.mock.calls[0][0] as string;

    // Hardstop: never `*` (would leak internal_notes).
    expect(columnList).not.toBe("*");
    expect(columnList).not.toContain("*");
    // Explicitly assert the private column is NOT in the list.
    expect(columnList).not.toContain("internal_notes");
    // Sanity: at least the user-visible columns are present.
    expect(columnList).toContain("id");
    expect(columnList).toContain("data");
  });
});
