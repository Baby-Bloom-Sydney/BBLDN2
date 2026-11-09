import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import type { NannyCardData } from "@/components/NannyCard";
import { NannyCardBK } from "./NannyCardBK";

const CARD: NannyCardData = {
  id: "n-1", first_name: "Nina", last_name: "W", suburb: "Islington", profile_picture_url: null, hourly_rate_min: 18,
  nanny_experience_years: 4, total_experience_years: 6, under_3_experience_years: 3, newborn_experience_years: null,
  highest_qualification: null, verification_tier: "tier3", verification_level: 4, drivers_license: null, vaccination_status: null,
  languages: ["English"], role_types_preferred: ["Full-time"], ai_headline: null, age: 33,
};

describe("NannyCardBK — the age the card is given", () => {
  it("shows her first name and the age from the card (no date of birth on it)", () => {
    render(<NannyCardBK nanny={CARD} />);
    expect(screen.getByRole("heading", { name: /Nina,\s*33/ })).toBeTruthy();
    expect(screen.getAllByText("NW").length).toBeGreaterThan(0);
  });
});
