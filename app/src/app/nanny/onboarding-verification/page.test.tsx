/**
 * Unit 3b (BB-LDN-3b-061026) — the onboarding page routes by the one DBS decoder (brief change 1):
 * a fail card or bar → /nanny/verification; `clear` only → /nanny; a submitted certificate → processing (step 4).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { dbsRow, STORED_SECTION, type DbsFixture } from "@/lib/dbs/fixtures.test-util";
import { GUIDANCE_MESSAGES } from "@/lib/verification";

const m = vi.hoisted(() => ({ row: null as unknown, redirect: vi.fn((to: string) => { throw new Error(`REDIRECT:${to}`); }) }));
vi.mock("next/navigation", () => ({ redirect: m.redirect }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: () => ({ auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) } }),
}));
vi.mock("@/lib/supabase/admin", () => {
  const chain = { select: () => chain, eq: () => chain, single: async () => ({ data: null, error: null }) };
  return { createAdminClient: () => ({ from: () => chain }) };
});
vi.mock("@/lib/actions/verification", () => ({ getVerificationData: async () => ({ data: m.row, error: null }) }));
vi.mock("./OnboardingVerificationClient", () => ({ OnboardingVerificationClient: () => null }));

import Page from "./page";

async function route(f: DbsFixture): Promise<string | number> {
  m.row = dbsRow(f);
  try {
    const el = (await Page({})) as { props: { initialStep: number } };
    return el.props.initialStep;
  } catch (e) {
    return (e as Error).message;
  }
}

beforeEach(() => {
  m.redirect.mockClear();
});

describe("onboarding page — DBS routing", () => {
  it.each<[string, DbsFixture]>([
    ["no_match (26)", { code: 26, section: STORED_SECTION.NO_MATCH }],
    ["new_info (23)", { code: 23, section: STORED_SECTION.NEW_INFO }],
    ["failed (24)", { code: 24, section: "failed" }],
    ["rejected (22)", { code: 22, section: "rejected" }],
    ["barred (27)", { code: 27, section: "barred" }],
    ["technical_retry (20, #30)", { code: 20, section: "doc_verified", crossCheck: "pending", guidance: { ...GUIDANCE_MESSAGES.TECHNICAL_RETRY } }],
  ])("sends %s to /nanny/verification", async (_n, f) => {
    expect(await route(f)).toBe("REDIRECT:/nanny/verification");
  });

  it("sends clear (30) to the hub", async () => {
    expect(await route({ code: 30, section: "doc_verified", crossCheck: "passed" })).toBe("REDIRECT:/nanny");
  });

  it("never sends 21 to the hub — it shows processing (review bucket)", async () => {
    expect(await route({ code: 21, section: "review" })).toBe(4);
  });

  it("shows processing while the certificate is read", async () => {
    expect(await route({ code: 29, section: "pending" })).toBe(4);
  });

  it("shows the DBS step when ID is in and no certificate yet", async () => {
    expect(await route({ code: 10, section: "not_started", identity: "processing" })).toBe(3);
  });
});
