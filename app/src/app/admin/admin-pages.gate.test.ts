// @vitest-environment node
/**
 * The admin pages and the position-apply test page check the admin themselves (not only in middleware): a caller who
 * isn't an admin gets the not-found page before any read.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  gate: { userId: "", error: "Not authenticated" as string | null },
  adminClient: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
  redirect: vi.fn(() => {
    throw new Error("NEXT_REDIRECT");
  }),
}));

vi.mock("@/lib/admin/require-admin", () => ({ requireAdmin: async () => h.gate }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    h.adminClient();
    throw new Error("admin client used");
  },
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: () => {
    h.adminClient();
    throw new Error("session client used");
  },
}));
vi.mock("next/navigation", () => ({ notFound: h.notFound, redirect: h.redirect, useRouter: () => ({}), usePathname: () => "/" }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const PAGES: Array<[string, () => Promise<{ default: (props: never) => unknown }>, unknown]> = [
  ["admin/leads", () => import("./leads/page"), { searchParams: {} }],
  ["admin/payouts", () => import("./payouts/page"), { searchParams: {} }],
  ["admin/subscriptions", () => import("./subscriptions/page"), { searchParams: {} }],
  ["admin/support", () => import("./support/page"), { searchParams: {} }],
  ["admin/support/[messageId]", () => import("./support/[messageId]/page"), { params: { messageId: "m1" } }],
  ["admin/users/[userId]/subscription", () => import("./users/[userId]/subscription/page"), { params: { userId: "u1" }, searchParams: {} }],
  ["bb/test/position-apply", () => import("../bb/test/position-apply/page"), {}],
];

beforeEach(() => {
  vi.stubEnv("PAYOUTS_ENABLED", "true"); // the payouts page is hidden (404) with its flag off; the check is behind it
  h.gate = { userId: "", error: "Not authenticated" };
  h.adminClient.mockClear();
  h.notFound.mockClear();
});

describe("admin pages refuse a caller who isn't an admin", () => {
  it.each(PAGES)("%s", async (_name, load, props) => {
    const Page = (await load()).default;
    await expect(Promise.resolve().then(() => Page(props as never))).rejects.toThrow("NEXT_NOT_FOUND");
    expect(h.notFound).toHaveBeenCalled();
    expect(h.adminClient).not.toHaveBeenCalled();
  });
});
