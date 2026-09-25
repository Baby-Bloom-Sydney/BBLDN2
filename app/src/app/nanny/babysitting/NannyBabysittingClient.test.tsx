/**
 * The babysitting job card's expiry is the last live surface still pinned to a 12-hour clock
 * after `LEDGER/2b.md` §3.2 put the app on one (`NEXT.md` §3 W-3). `en-GB` is a 24-hour locale;
 * an explicit `hour12: true` overrides it, so this nanny surface disagreed with every other
 * formatted time in the product.
 *
 * The expected string is computed here from `Intl` under `APP_LOCALE`, never typed out as a
 * literal (`LEDGER/2-0.md` §8.3) — the test still passes if the locale changes its separator,
 * and still fails if the 12-hour pin comes back.
 */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { APP_LOCALE } from "@/lib/constants";
import type { NannyBabysittingJob } from "@/lib/actions/babysitting";
import { NannyBabysittingClient } from "./NannyBabysittingClient";

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

/** Far enough ahead that the card renders as "available" rather than "Expired". */
const EXPIRES_AT = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();

const EXPIRY_FORMAT = {
  weekday: "short",
  day: "numeric",
  month: "short",
  hour: "numeric",
  minute: "2-digit",
} as const;

function openJob(): NannyBabysittingJob {
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
    slots: [
      {
        id: "slot-1",
        slot_date: "2026-10-01",
        start_time: "14:30",
        end_time: "18:30",
        is_selected: false,
      },
    ],
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

describe("NannyBabysittingClient — the expiry reads one clock with the rest of the app", () => {
  it("renders the job expiry on the locale's 24-hour clock", async () => {
    const user = userEvent.setup();

    render(
      <NannyBabysittingClient jobs={[openJob()]} banned={false} banUntil={null} />,
    );

    // The expiry lives in the job's detail modal, which the card opens.
    await user.click(screen.getByText("Clapham", { exact: false }));

    const expected = new Date(EXPIRES_AT).toLocaleString(APP_LOCALE, EXPIRY_FORMAT);
    const expiry = await screen.findByText(/^Expires/);

    expect(expiry.textContent).toContain(expected);
    // `en-GB` is 24-hour; an `hour12` pin is the only way am/pm reaches this string.
    expect(expiry.textContent).not.toMatch(/\b[ap]\.?m\.?\b/i);
  });
});
