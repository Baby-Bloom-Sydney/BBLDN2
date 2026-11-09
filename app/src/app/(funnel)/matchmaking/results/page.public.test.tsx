/**
 * The guest results page hands its client component matches as the cards show them. BB-wave1-041126, 2026-11-09.
 */
import { describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
import { FULL_MATCH, PRIVATE } from "@/lib/matching/match-fixture.test-util";

vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/matching/pre-auth", () => ({ runPreAuthMatching: async () => ({ matches: [FULL_MATCH], totalEligible: 1 }) }));

import Page from "./page";

describe("/matchmaking/results — the props sent to the browser", () => {
  it("carry the matches for their cards and nothing only the server may hold", async () => {
    const el = (await Page({ searchParams: Promise.resolve({ lead: "lead-1" }) })) as ReactElement<{ matches: unknown[] }>;
    expect(el.props.matches).toHaveLength(1);
    expect(JSON.stringify(el.props)).not.toMatch(PRIVATE);
  });
});
