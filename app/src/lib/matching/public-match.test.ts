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
    expect(m.breakdown).toEqual({ experience: 90, schedule: 80, location: 70 });
  });

  it("an empty last name, no date of birth and no headline stay empty", () => {
    const bare = { ...FULL_MATCH, nanny: { ...FULL_MATCH.nanny, ai_content: null }, profile: { ...FULL_MATCH.profile, last_name: "", date_of_birth: null } };
    const m = publicMatch(bare);
    expect(m.profile).toMatchObject({ last_name: "", age: null });
    expect(m.nanny.ai_content).toBeNull();
  });

  it("has exactly the card's keys at every level (an allow-list throughout)", () => {
    const m = publicMatch(FULL_MATCH);
    expect(Object.keys(m).sort()).toEqual([
      "breakdown", "distanceKm", "finalScore", "highestQualification", "nanny", "nannyId", "nannySchedule",
      "overQualifiedBonuses", "profile", "unmetRequirements",
    ]);
    expect(Object.keys(m.breakdown).sort()).toEqual(["experience", "location", "schedule"]);
    expect(Object.keys(m.nanny).sort()).toEqual([
      "ai_content", "hourly_rate_min", "id", "nanny_experience_years", "newborn_experience_years", "total_experience_years",
      "under_3_experience_years",
    ]);
    expect(Object.keys(m.nanny.ai_content ?? {})).toEqual(["headline"]);
    expect(Object.keys(m.profile).sort()).toEqual(["age", "first_name", "last_name", "profile_picture_url", "suburb"]);
  });

  it("carries nothing only the server may hold", () => {
    expect(JSON.stringify(publicMatch(FULL_MATCH))).not.toMatch(PRIVATE);
  });
});
