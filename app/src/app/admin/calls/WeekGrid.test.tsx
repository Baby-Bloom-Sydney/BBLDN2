/**
 * The 7-day grid (plan C5; brief §3 admin 5, §9.12): free / booked (with the family's name) / held / blocked, each said
 * in words as well as colour; London labels for admin; a booked call inside a block is booked and tagged "Blocked over
 * — move or cancel".
 */
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CALENDAR } from "./calendar-fixtures.test-util";
import { WeekGrid } from "./WeekGrid";

const day = (name: string) => screen.getByRole("region", { name });
const cells = (name: string) => within(day(name)).queryAllByRole("listitem").map((li) => li.textContent);

describe("WeekGrid", () => {
  it("is headed with the London note, one region per day, today first", () => {
    render(<WeekGrid days={CALENDAR.days} />);
    expect(screen.getByRole("heading", { level: 2, name: "Next 7 days (London time)" })).toBeInTheDocument();
    const headings = screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent);
    expect(headings).toEqual([
      "Thursday 4 February",
      "Friday 5 February",
      "Saturday 6 February",
      "Sunday 7 February",
      "Monday 8 February",
      "Tuesday 9 February",
      "Wednesday 10 February",
    ]);
  });

  it("free, blocked (with the reason), and a booked call under the block: booked, named, tagged Blocked over", () => {
    render(<WeekGrid days={CALENDAR.days} />);
    expect(cells("Friday 5 February").slice(0, 5)).toEqual([
      "09:00–09:30Blocked · dentist",
      "09:30–10:00Blocked · dentist",
      "10:00–10:30Booked · Jane SmithBlocked over — move or cancel",
      "10:30–11:00Blocked · dentist",
      "11:00–11:30Free",
    ]);
  });

  it("a held time says Held (no name); a booked call with its family's name", () => {
    render(<WeekGrid days={CALENDAR.days} />);
    expect(cells("Saturday 6 February")).toContain("11:00–11:30Held");
    expect(cells("Monday 8 February")).toContain("14:00–14:30Booked · Ola Brown");
  });

  it("a day with no call hours says so", () => {
    render(<WeekGrid days={CALENDAR.days} />);
    expect(within(day("Thursday 4 February")).getByText("No times")).toBeInTheDocument();
    expect(cells("Thursday 4 February")).toEqual([]);
  });

  it("each cell carries its kind (for the colour key) and the time as a <time>", () => {
    render(<WeekGrid days={CALENDAR.days} />);
    const items = within(day("Friday 5 February")).getAllByRole("listitem");
    expect(items.slice(0, 3).map((li) => li.getAttribute("data-kind"))).toEqual(["blocked", "blocked", "booked"]);
    expect(items[2].querySelector("time")?.getAttribute("dateTime")).toBe("2027-02-05T10:00:00.000Z");
  });

  it("a key says what each colour means", () => {
    render(<WeekGrid days={CALENDAR.days} />);
    const key = screen.getByRole("list", { name: "Key" });
    expect(within(key).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["Free", "Booked", "Held", "Blocked"]);
  });
});
