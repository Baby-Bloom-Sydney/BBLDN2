/**
 * The Calendar tab (plan C5, §13; brief §3 admin 5): Start call booking, the 7-day grid, the settings, the blocks and
 * the weekly hours, from one server read. A failed read says so; it never draws an empty calendar.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("./actions", () => ({
  saveCallSettingsAction: vi.fn(),
  saveWeeklyHoursAction: vi.fn(),
  addCallBlockAction: vi.fn(),
  removeCallBlockAction: vi.fn(),
  startCallBookingAction: vi.fn(),
}));

import { CALENDAR, CALENDAR_STARTED } from "./calendar-fixtures.test-util";
import { CalendarTab } from "./CalendarTab";

describe("CalendarTab", () => {
  it("not started: Start call booking first, then the grid, the settings, the blocks and the weekly hours", () => {
    render(<CalendarTab calendar={CALENDAR} />);
    expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual([
      "Start call booking",
      "Next 7 days (London time)",
      "Call settings",
      "Blocks (London time)",
      "Weekly hours (London time)",
    ]);
    expect(screen.getByRole("button", { name: "Start call booking" })).toBeInTheDocument();
    expect(screen.getByText("When you can take matchmaker calls. Parents' pickers show these the next time they load.")).toBeInTheDocument();
  });

  it("the add-block form starts on today's London date", () => {
    render(<CalendarTab calendar={CALENDAR} />);
    expect(screen.getByLabelText("From date")).toHaveValue("2027-02-04");
  });

  it("started: only the date; the stored settings in the form", () => {
    render(<CalendarTab calendar={CALENDAR_STARTED} />);
    expect(screen.getByText("Call booking started on 1 February 2027.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Start call booking" })).toBeNull();
    expect(screen.getByLabelText("Call length")).toHaveValue("45");
    expect(screen.getByLabelText("Caller number shown in emails")).toHaveValue("+442079460000");
  });

  it("the calendar couldn't be read → says so, and draws nothing else", () => {
    render(<CalendarTab calendar={null} />);
    expect(screen.getByRole("alert")).toHaveTextContent("The calendar could not be read — reload to try again.");
    expect(screen.queryByRole("heading", { level: 2 })).toBeNull();
  });
});
