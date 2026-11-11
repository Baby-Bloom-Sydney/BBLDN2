import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NannyCardData } from "@/components/NannyCard";
import { publicNannyCard } from "./nanny-card";

const CARD = {
  id: "n-1", user_id: "u-1", first_name: "Nina", last_name: "Walker", suburb: "Islington", profile_picture_url: null,
  hourly_rate_min: 18, nanny_experience_years: 4, total_experience_years: 6, under_3_experience_years: 3, newborn_experience_years: null,
  highest_qualification: null, verification_tier: "tier3", verification_level: 4, drivers_license: null, vaccination_status: null,
  languages: ["English"], role_types_preferred: ["Full-time"], ai_headline: null, date_of_birth: "1993-03-03",
} satisfies NannyCardData;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-09T12:00:00Z"));
});
afterEach(() => vi.useRealTimers());

describe("publicNannyCard — a browse card as the screens show it", () => {
  it("keeps the first name, the last initial and her age; drops her account id, full last name and date of birth", () => {
    const card = publicNannyCard(CARD);
    expect(card).toMatchObject({ id: "n-1", first_name: "Nina", last_name: "W", age: 33, suburb: "Islington", hourly_rate_min: 18 });
    expect(card).not.toHaveProperty("user_id");
    expect(card).not.toHaveProperty("date_of_birth");
    expect(JSON.stringify(card)).not.toMatch(/u-1|Walker|1993-03-03/);
  });

  it("an unknown date of birth or last name stays empty", () => {
    expect(publicNannyCard({ ...CARD, date_of_birth: null, last_name: "" })).toMatchObject({ age: null, last_name: "" });
  });
});
