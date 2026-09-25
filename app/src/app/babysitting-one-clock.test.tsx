/**
 * Both sides of one babysitting job read the same clock.
 *
 * This is the render proof for LDN2 unit 2k (W-12). The fifteen hand-rolled
 * 12-hour formatters were not fifteen unrelated bugs: eight of them rendered
 * *the same job's slot times* to different people — the nanny on her invitation
 * card, the parent on the request, a stranger on the public share link, the
 * payment screen, Katie's words, the share post and the server-side summary.
 * Fixing a subset would have left one job reading one way to the nanny and
 * another to the parent, which is why `2j` refused to fix any of them alone.
 *
 * So the pin is not "this component renders 24-hour". It is: feed one fixture
 * to the nanny surface and to the public/parent-facing surface, and require
 * that they agree, on a string the locale produces at test time.
 */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { formatClockTime } from "@/lib/timezone";
import type {
  NannyBabysittingJob,
  PublicBsrProfile,
} from "@/lib/actions/babysitting";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

vi.mock("@/lib/actions/babysitting", () => ({
  requestBabysittingJob: vi.fn(),
  declineBabysittingRequest: vi.fn(),
  nannyCancelBabysittingRequest: vi.fn(),
}));

vi.mock("@/lib/legal/record-consent", () => ({
  recordInformedAction: vi.fn(),
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: null, role: null }),
}));

import { NannyBabysittingClient } from "./nanny/babysitting/NannyBabysittingClient";
import { BsrJobView } from "./(public)/babysitting/[id]/BsrJobView";

/** One job. An evening slot, so a 12-hour clock would read visibly differently. */
const SLOT = { slot_date: "2026-10-01", start_time: "19:47", end_time: "22:15" };

/** Far enough ahead that the nanny card renders as available, not expired. */
const EXPIRES_AT = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();

function nannySide(): NannyBabysittingJob {
  return {
    id: "job-1",
    title: null,
    special_requirements: null,
    suburb: "Clapham",
    postcode: "SW4",
    address: null,
    hourly_rate: 22,
    estimated_total: 88,
    status: "open",
    accepted_nanny_id: null,
    created_at: new Date().toISOString(),
    expires_at: EXPIRES_AT,
    slots: [{ id: "slot-1", ...SLOT, is_selected: false }],
    notification: {
      distanceKm: 2,
      notifiedAt: new Date().toISOString(),
      viewedAt: null,
      requestedAt: null,
      acceptedAt: null,
      declinedAt: null,
      notifiedFilled: false,
    },
    children: [{ age_months: 30, gender: null }],
    clashSlotIds: [],
  };
}

function parentSide(): PublicBsrProfile {
  return {
    id: "job-1",
    suburb: "Clapham",
    hourly_rate: 22,
    estimated_hours: 4,
    status: "open",
    special_requirements: null,
    created_at: new Date().toISOString(),
    expires_at: EXPIRES_AT,
    parent_first_name: "Priya",
    parent_last_name: null,
    parent_profile_pic: null,
    time_slots: [SLOT],
    children: [{ ageMonths: 30 }],
  };
}

/** What the locale itself renders for this job's slot — never typed by hand. */
const EXPECTED = `${formatClockTime(SLOT.start_time)} – ${formatClockTime(
  SLOT.end_time,
)}`;

/** What the deleted hand-rolled formatter would have printed for this slot. */
const TWELVE_HOUR = "7:47pm";

describe("one babysitting job, read by both sides", () => {
  it("shows the nanny the slot on the locale's clock", async () => {
    const { container } = render(
      <NannyBabysittingClient jobs={[nannySide()]} banned={false} banUntil={null} />,
    );
    await userEvent.setup().click(screen.getByText("Clapham", { exact: false }));

    expect(container.textContent).toContain(EXPECTED);
    expect(container.textContent).not.toContain(TWELVE_HOUR);
  });

  it("shows the parent-facing job page the same slot, the same way", () => {
    const { container } = render(<BsrJobView bsr={parentSide()} />);

    expect(container.textContent).toContain(EXPECTED);
    expect(container.textContent).not.toContain(TWELVE_HOUR);
  });

  it("renders a time a 12-hour clock would have shown differently", () => {
    // Guards the fixture itself: a slot at, say, 10:00 reads the same on both
    // clocks, so this proof would pass without proving anything.
    expect(EXPECTED).toContain("19");
    expect(EXPECTED).toContain("22");
  });
});
