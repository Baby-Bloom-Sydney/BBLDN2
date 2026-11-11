/**
 * The profile text a family or a signed-out visitor sees renders its formatting tags and nothing a browser would run.
 */
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PublicNannyProfile } from "@/lib/actions/nanny";
import type { PublicMatchResult } from "@/lib/matching/public-match";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => "/" }));
vi.mock("@/components/ConnectModal", () => ({ ConnectModal: () => null }));

import { ParentNannyProfileView } from "./ParentNannyProfileView";
import { NannyProfileView } from "@/app/(public)/nannies/[id]/NannyProfileView";
import { PublicMatchCard } from "@/app/(funnel)/matchmaking/results/PublicMatchCard";

afterEach(cleanup);

const PAYLOAD = {
  headline: "<img src=x onerror=\"window.__ran=1\">Warm nanny",
  parent_pitch: "<p>Pitch</p><a href=\"javascript:window.__ran=1\">link</a>",
  bio_summary: {
    about: "<p>About</p><script>window.__ran=1</script><p style=\"position:fixed\">styled</p>",
    personality: "<svg onload=\"window.__ran=1\"></svg><p onclick=\"window.__ran=1\">Kind</p>",
    values: "<p>Values</p>",
    what_i_offer: "<p>Offer</p>",
    background: "<p>Background</p>",
  },
  experience_summary: "<p>Experience</p>",
  skills_highlight: "<strong>Skills</strong><br><img src=x onerror=1>",
};

const FORMATTED = {
  headline: "Calm, <strong>kind</strong> and creative",
  parent_pitch: "Line one<br>Line two",
  bio_summary: { about: "<p>First</p><p>Second</p>", personality: "<p>Kind</p>", values: "<p>V</p>", what_i_offer: "<p>O</p>", background: "<p>B</p>" },
  experience_summary: "<p>E</p>",
  skills_highlight: "<strong>Skill</strong><br>",
};

function nanny(ai_content: Record<string, unknown>): PublicNannyProfile {
  return {
    nanny_id: "n1", user_id: "u1", first_name: "nia", last_name: "hale", suburb: "Balham", age: 30,
    certificates: [], languages: [], role_types_preferred: [], level_of_support_offered: [], pay_frequency: [],
    ai_content,
  } as unknown as PublicNannyProfile;
}

function match(ai_content: Record<string, unknown>): PublicMatchResult {
  return {
    nannyId: "n1", finalScore: 80, distanceKm: 1,
    nanny: { ai_content, hourly_rate_min: 18 },
    profile: { first_name: "nia", age: 30, suburb: "Balham" },
    breakdown: {}, overQualifiedBonuses: [], unmetRequirements: [],
  } as unknown as PublicMatchResult;
}

function nothingRuns(container: HTMLElement) {
  expect(container.querySelectorAll("img[onerror], script, svg[onload], a[href^='javascript'], [onclick], [onload], [style*='fixed']").length).toBe(0);
  expect(container.innerHTML).not.toMatch(/onerror=|onload=|onclick=|javascript:|<script|position:fixed/i);
}

describe("profile text: nothing a browser would run", () => {
  it("the family's and the public profile view (ParentNannyProfileView)", () => {
    const { container } = render(<ParentNannyProfileView nanny={nanny(PAYLOAD)} />);
    expect(container.textContent).toContain("About");
    nothingRuns(container);
  });

  it("the matchmaking profile view (NannyProfileView)", () => {
    const { container } = render(<NannyProfileView nanny={nanny(PAYLOAD)} isParent />);
    expect(container.textContent).toContain("Pitch");
    nothingRuns(container);
  });

  it("the signed-out match card (PublicMatchCard)", () => {
    const { container } = render(<PublicMatchCard match={match(PAYLOAD)} />);
    expect(container.textContent).toContain("Warm nanny");
    nothingRuns(container);
  });
});

describe("profile text: formatting renders as before", () => {
  it("keeps paragraphs, line breaks and bold in the family's view", () => {
    const { container } = render(<ParentNannyProfileView nanny={nanny(FORMATTED)} />);
    expect(container.innerHTML).toContain("<p>First</p><p>Second</p>");
    expect(container.innerHTML).toContain("Calm, <strong>kind</strong> and creative");
  });

  it("keeps the pitch's line break in the matchmaking view", () => {
    const { container } = render(<NannyProfileView nanny={nanny(FORMATTED)} isParent />);
    expect(container.innerHTML).toContain("Line one<br>Line two");
  });
});
