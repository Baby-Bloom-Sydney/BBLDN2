/**
 * Unit 5b (BB-LDN-5b-151026) — the four share pages 404 while `SHARE_LOOP_ENABLED` is off, before any data read
 * (P-23, Stage 5 ruling 2). With the flag on they run as before, which is asserted by the data read they reach.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const calls = vi.hoisted(() => ({ dataRead: vi.fn(), adminFrom: vi.fn() }));

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
}));
vi.mock("@/lib/actions/viral-loop", () => {
  const read = (name: string) => async () => {
    calls.dataRead(name);
    throw new Error(`DATA_READ:${name}`);
  };
  return {
    getNannySharePageData: read("getNannySharePageData"),
    getPositionSharePageData: read("getPositionSharePageData"),
    getBsrSharePageData: read("getBsrSharePageData"),
    createShareRecord: read("createShareRecord"),
  };
});
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      calls.adminFrom(table);
      throw new Error(`DATA_READ:${table}`);
    },
  }),
}));
// The pages' client components are never rendered here (the page throws first); stub them so the test does not
// pull their browser-only imports.
vi.mock("./nanny/share/NannyShareClient", () => ({ NannyShareClient: () => null }));
vi.mock("./parent/matches/share/PositionShareClient", () => ({ PositionShareClient: () => null }));
vi.mock("./parent/babysitting/[id]/share/BsrShareClient", () => ({ BsrShareClient: () => null }));

beforeEach(() => {
  calls.dataRead.mockReset();
  calls.adminFrom.mockReset();
});
afterEach(() => vi.unstubAllEnvs());

type Page = (props: { params: { id: string } }) => unknown;
const PAGES: Array<[string, () => Promise<{ default: Page }>, string]> = [
  ["/nanny/share", () => import("./nanny/share/page") as Promise<{ default: Page }>, "DATA_READ:getNannySharePageData"],
  ["/parent/matches/share", () => import("./parent/matches/share/page") as Promise<{ default: Page }>, "DATA_READ:getPositionSharePageData"],
  ["/parent/babysitting/[id]/share", () => import("./parent/babysitting/[id]/share/page") as Promise<{ default: Page }>, "DATA_READ:getBsrSharePageData"],
  ["/test/shareprofile", () => import("./test/shareprofile/page") as Promise<{ default: Page }>, "DATA_READ:user_profiles"],
];

describe("share pages — hidden while SHARE_LOOP_ENABLED is off", () => {
  it.each(PAGES)("%s → notFound() before any data read", async (_path, load) => {
    vi.stubEnv("SHARE_LOOP_ENABLED", "");
    const { default: Page } = await load();
    await expect(async () => Page({ params: { id: "bsr-1" } })).rejects.toThrow("NOT_FOUND");
    expect(calls.dataRead).not.toHaveBeenCalled();
    expect(calls.adminFrom).not.toHaveBeenCalled();
  });
});

describe("share pages — reopen with SHARE_LOOP_ENABLED=true", () => {
  it.each(PAGES)("%s → proceeds to its data read", async (_path, load, reached) => {
    vi.stubEnv("SHARE_LOOP_ENABLED", "true");
    const { default: Page } = await load();
    await expect(async () => Page({ params: { id: "bsr-1" } })).rejects.toThrow(reached);
  });
});
