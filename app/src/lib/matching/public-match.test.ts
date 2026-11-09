import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FULL_MATCH, PRIVATE } from "./match-fixture.test-util";
import { publicMatch } from "./public-match";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-09T12:00:00Z"));
});
afterEach(() => vi.useRealTimers());

describe("publicMatch — a match as the cards show it", () => {
  it("keeps the card's fields: first name, last initial, area, photo, age; the experience, rate and headline; the scores", () => {
    const m = publicMatch(FULL_MATCH);
    expect(m.profile).toEqual({ first_name: "nina", last_name: "W", suburb: "Islington", profile_picture_url: null, age: 33 });
    expect(m.nanny).toEqual({
      id: "n-1", total_experience_years: 6, nanny_experience_years: 4, under_3_experience_years: 3, newborn_experience_years: 1,
      hourly_rate_min: 18, ai_content: { headline: "Calm and playful" },
    });
    expect(m).toMatchObject({ nannyId: "n-1", finalScore: 88, distanceKm: 3, highestQualification: "Level 3", overQualifiedBonuses: ["Driver"] });
  });

  it("an empty last name, no date of birth and no headline stay empty", () => {
    const bare = { ...FULL_MATCH, nanny: { ...FULL_MATCH.nanny, ai_content: null }, profile: { ...FULL_MATCH.profile, last_name: "", date_of_birth: null } };
    const m = publicMatch(bare);
    expect(m.profile).toMatchObject({ last_name: "", age: null });
    expect(m.nanny.ai_content).toBeNull();
  });

  it("carries nothing only the server may hold", () => {
    expect(JSON.stringify(publicMatch(FULL_MATCH))).not.toMatch(PRIVATE);
  });
});
