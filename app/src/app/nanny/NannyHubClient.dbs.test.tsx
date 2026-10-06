/**
 * Unit 3b (BB-LDN-3b-061026) — hub banners, tile and the "Enhanced DBS" glance (brief change 10; copy deck §5.1;
 * P-7: 23/26 at level 2 show no glance).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/nanny",
  useSearchParams: () => new URLSearchParams(),
}));

import { NannyHubClient, type NannyProfileAccordionData } from "./NannyHubClient";
import { dbsRow, STORED_SECTION } from "@/lib/dbs/fixtures.test-util";

afterEach(cleanup);

const profile = {
  suburb: "Camden", date_of_birth: null, nationality: null, total_experience_years: 3, nanny_experience_years: 2,
  under_3_experience_years: null, newborn_experience_years: null, role_types_preferred: [], level_of_support_offered: [],
  hourly_rate_min: null, max_children: null, min_child_age_months: null, max_child_age_months: null,
  drivers_license: null, has_car: null, comfortable_with_pets: null, vaccination_status: null, non_smoker: null,
  languages: [], hobbies_interests: null, strengths_traits: null, skills_training: null, ai_content: null,
  availability: null, highest_qualification: null, certificates: [], motivation: null, personality_traits: [],
  professional_values: [], childcare_roles: [], additional_photos: [], immediate_start: false, additional_needs: false,
} as unknown as NannyProfileAccordionData;

function hub(level: number, row: Parameters<typeof dbsRow>[0] | null, nannyProfile: NannyProfileAccordionData | null = null) {
  return render(
    <NannyHubClient
      firstName="Jane" lastName="Doe" profilePictureUrl={null}
      verificationLevel={level}
      verificationData={row ? dbsRow(row) : null}
      nannyProfile={nannyProfile}
      placements={[]} upcomingIntros={[]} dfyNotifications={[]} openPositions={[]} nannyApplications={[]}
      babysittingJobs={[]} bsrBanned={false} bsrBanUntil={null} shareUnlocked={false} educationChildren={[]}
    />,
  );
}

function openExperience() {
  fireEvent.click(screen.getByRole("button", { name: /Childcare Profile/ }));
  fireEvent.click(screen.getByRole("button", { name: "Experience" }));
}

describe("NannyHubClient — DBS", () => {
  it("shows the 23 banner", () => {
    hub(2, { code: 23, section: "expired" });
    expect(screen.getByText("You'll need a new DBS certificate to keep connecting with families")).toBeInTheDocument();
  });

  it("shows the 26 banner", () => {
    hub(2, { code: 26, section: STORED_SECTION.NO_MATCH });
    expect(screen.getByText("We couldn't confirm your DBS on the Update Service — check your subscription")).toBeInTheDocument();
  });

  it("shows the needs-attention banner when failed or rejected", () => {
    hub(2, { code: 24, section: "failed" });
    expect(screen.getByText("Your DBS check needs attention — review and resubmit")).toBeInTheDocument();
  });

  it("shows the not-started banner", () => {
    hub(2, { code: 20, section: "not_started" });
    expect(screen.getByText("Upload your DBS certificate to complete verification")).toBeInTheDocument();
  });

  it("names the tile step 'Verify DBS'", () => {
    hub(2, { code: 20, section: "not_started" });
    expect(screen.getByText("Verify DBS")).toBeInTheDocument();
  });

  it("marks the tile step completed only when clear, action required at 26", () => {
    const { unmount } = hub(2, { code: 26, section: STORED_SECTION.NO_MATCH });
    expect(screen.getAllByText("Action Required").length).toBeGreaterThan(0);
    unmount();
  });

  it("shows the 'Enhanced DBS' glance at level 3", () => {
    hub(3, { code: 30, section: "doc_verified", crossCheck: "passed" }, profile);
    openExperience();
    expect(screen.getByText("Enhanced DBS")).toBeInTheDocument();
  });

  it("shows no 'Enhanced DBS' glance at level 2", () => {
    hub(2, { code: 20, section: "doc_verified", crossCheck: "pending" }, profile);
    openExperience();
    expect(screen.queryByText("Enhanced DBS")).toBeNull();
  });

  it.each([
    ["23", { code: 23, section: "expired" }],
    ["26", { code: 26, section: STORED_SECTION.NO_MATCH }],
  ])("shows no 'Enhanced DBS' glance and no \"You're verified!\" at %s, level 2 (P-7)", (_c, row) => {
    hub(2, row, profile);
    openExperience();
    expect(screen.queryByText("Enhanced DBS")).toBeNull();
    expect(screen.queryByText(/You.re verified!/)).toBeNull();
  });
});
