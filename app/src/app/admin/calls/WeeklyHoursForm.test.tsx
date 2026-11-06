/**
 * Weekly hours (plan C5; brief §3 admin 5, §9.12): every weekday, several ranges allowed (native time inputs, London
 * clock); add and remove ranges; the whole week is saved at once through `replaceWeeklyHours`. Overlapping ranges are
 * refused by the server in their own words; touching ranges are fine.
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const nav = vi.hoisted(() => ({ refresh: vi.fn() }));
const actions = vi.hoisted(() => ({ saveWeeklyHoursAction: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => nav }));
vi.mock("./actions", () => actions);

import { CALENDAR } from "./calendar-fixtures.test-util";
import { WeeklyHoursForm } from "./WeeklyHoursForm";

beforeEach(() => {
  nav.refresh.mockReset();
  actions.saveWeeklyHoursAction.mockReset();
  actions.saveWeeklyHoursAction.mockResolvedValue({ ok: true, value: true });
});

const day = (name: string) => screen.getByRole("group", { name });
const save = () => screen.getByRole("button", { name: "Save weekly hours" });

describe("WeeklyHoursForm", () => {
  it("every weekday, Monday first, with its ranges as London clock times; a day with none says so", () => {
    render(<WeeklyHoursForm hours={CALENDAR.hours} />);
    expect(screen.getByRole("heading", { level: 2, name: "Weekly hours (London time)" })).toBeInTheDocument();
    expect(screen.getAllByRole("group").map((g) => g.getAttribute("aria-label") ?? g.querySelector("legend")?.textContent)).toEqual([
      "Monday",
      "Tuesday",
      "Wednesday",
      "Thursday",
      "Friday",
      "Saturday",
      "Sunday",
    ]);
    expect(screen.getByLabelText("Monday 1 from")).toHaveValue("09:00");
    expect(screen.getByLabelText("Monday 1 to")).toHaveValue("12:00");
    expect(screen.getByLabelText("Monday 2 from")).toHaveValue("13:00");
    expect(screen.getByLabelText("Saturday 1 to")).toHaveValue("14:00");
    expect(within(day("Thursday")).getByText("No calls")).toBeInTheDocument();
  });

  it("Add hours on Sunday gives a range to set; Remove takes one away; Save sends the whole week, Monday first", async () => {
    render(<WeeklyHoursForm hours={CALENDAR.hours} />);
    fireEvent.click(within(day("Sunday")).getByRole("button", { name: "Add hours on Sunday" }));
    fireEvent.change(screen.getByLabelText("Sunday 1 from"), { target: { value: "10:00" } });
    fireEvent.change(screen.getByLabelText("Sunday 1 to"), { target: { value: "14:00" } });
    fireEvent.click(within(day("Monday")).getByRole("button", { name: "Remove Monday 2" }));
    expect(screen.queryByLabelText("Monday 2 from")).toBeNull();
    fireEvent.click(save());
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Saved."));
    expect(actions.saveWeeklyHoursAction).toHaveBeenCalledWith([
      { weekday: 1, start: "09:00", end: "12:00" },
      { weekday: 5, start: "09:00", end: "19:00" },
      { weekday: 6, start: "10:00", end: "14:00" },
      { weekday: 7, start: "10:00", end: "14:00" },
    ]);
    expect(nav.refresh).toHaveBeenCalled();
  });

  it("a second range on a day starts where the last one ends", () => {
    render(<WeeklyHoursForm hours={CALENDAR.hours} />);
    fireEvent.click(within(day("Saturday")).getByRole("button", { name: "Add hours on Saturday" }));
    expect(screen.getByLabelText("Saturday 2 from")).toHaveValue("14:00");
  });

  it("overlapping ranges → the server's 'Those hours overlap — change one range'; nothing refreshed", async () => {
    actions.saveWeeklyHoursAction.mockResolvedValue({ ok: false, error: "overlap" });
    render(<WeeklyHoursForm hours={CALENDAR.hours} />);
    fireEvent.change(screen.getByLabelText("Monday 2 from"), { target: { value: "11:00" } });
    fireEvent.click(save());
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Those hours overlap — change one range"));
    expect(nav.refresh).not.toHaveBeenCalled();
  });

  it("a half-filled range → the server's invalid, as the hours line", async () => {
    actions.saveWeeklyHoursAction.mockResolvedValue({ ok: false, error: "invalid" });
    render(<WeeklyHoursForm hours={CALENDAR.hours} />);
    fireEvent.change(screen.getByLabelText("Monday 1 to"), { target: { value: "" } });
    fireEvent.click(save());
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Check each range: a start and an end, the end after the start."));
  });

  it("removing every range is allowed (no calls that week)", async () => {
    render(<WeeklyHoursForm hours={[{ weekday: 6, dayName: "Saturday", start: "10:00", end: "14:00" }]} />);
    fireEvent.click(screen.getByRole("button", { name: "Remove Saturday 1" }));
    fireEvent.click(save());
    await waitFor(() => expect(actions.saveWeeklyHoursAction).toHaveBeenCalledWith([]));
  });
});
