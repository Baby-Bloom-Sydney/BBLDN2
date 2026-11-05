/**
 * The Calls tab (plan C3; brief §0.8, §0.9, §0.13, §3 admin 1, 6; BB-wave1-041126/04c1-build): the counts line and
 * the cohort line, the red/amber free-time banner, then Today and upcoming, Overdue, Not booked — to call and
 * History, each a table with a caption (md and up) and a card list (phones). Every time reads London. Each row has
 * the four links, the tags, and a Call control — `renderCallControl(row)`, a `tel:` link by default (05's seam).
 */
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CallsTab } from "./CallsTab";
import { AVA, DASHBOARD, EMPTY_DASHBOARD, FAY, HAL, POS } from "./calls-fixtures.test-util";

const table = (name: string) => screen.getByRole("table", { name });
const cards = (name: string) => screen.getByRole("list", { name });

describe("CallsTab — the top lines", () => {
  it("the counts line; the cohort line only when 02 gives one", () => {
    const { rerender } = render(<CallsTab dashboard={DASHBOARD} onOpen={vi.fn()} />);
    expect(screen.getByText("Calls still to make this week: 4 (2 booked · 2 not booked)")).toBeInTheDocument();
    expect(screen.queryByText(/Current cohort/)).not.toBeInTheDocument();
    rerender(<CallsTab dashboard={{ ...DASHBOARD, cohort: "Current cohort: 2 of 5 places left" }} onOpen={vi.fn()} />);
    expect(screen.getByText("Current cohort: 2 of 5 places left")).toBeInTheDocument();
  });

  it("counts that couldn't be read say so", () => {
    render(<CallsTab dashboard={{ ...DASHBOARD, counts: null }} onOpen={vi.fn()} />);
    expect(screen.getByRole("alert")).toHaveTextContent("The call counts could not be read — reload to try again.");
  });

  it("red banner at no free time (an alert); amber when running low (a status)", () => {
    const { rerender } = render(<CallsTab dashboard={{ ...DASHBOARD, banner: { tone: "red", line: "No free call times in the next 7 days." } }} onOpen={vi.fn()} />);
    const red = screen.getByRole("alert");
    expect(red).toHaveTextContent("No free call times in the next 7 days.");
    expect(red.className).toContain("bg-red-50");
    rerender(<CallsTab dashboard={{ ...DASHBOARD, banner: { tone: "amber", line: "Free call times are running low in the next 7 days." } }} onOpen={vi.fn()} />);
    const amber = screen.getByRole("status");
    expect(amber).toHaveTextContent("Free call times are running low in the next 7 days.");
    expect(amber.className).toContain("bg-amber-50");
  });
});

describe("CallsTab — the sections, top to bottom (brief §3 admin 1)", () => {
  it("Today and upcoming, Overdue, Not booked — to call, History", () => {
    render(<CallsTab dashboard={DASHBOARD} onOpen={vi.fn()} />);
    expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual([
      expect.stringContaining("Today and upcoming"),
      expect.stringContaining("Overdue"),
      expect.stringContaining("Not booked — to call"),
      expect.stringContaining("History"),
    ]);
  });

  it("each section is a table with a caption, and a card list for phones", () => {
    render(<CallsTab dashboard={DASHBOARD} onOpen={vi.fn()} />);
    for (const name of ["Today and upcoming", "Overdue", "Not booked — to call", "History"]) {
      expect(table(name)).toBeInTheDocument();
      expect(cards(name)).toBeInTheDocument();
    }
    expect(within(table("Not booked — to call")).getAllByRole("row")).toHaveLength(3); // header + 2
  });

  it("a section with nobody says so", () => {
    render(<CallsTab dashboard={{ ...DASHBOARD, overdue: [] }} onOpen={vi.fn()} />);
    expect(screen.getByRole("heading", { name: /Overdue/ }).closest("section")).toHaveTextContent("None right now.");
  });

  it("nothing at all → one empty state, no empty tables", () => {
    render(<CallsTab dashboard={EMPTY_DASHBOARD} onOpen={vi.fn()} />);
    expect(screen.getByText("No matchmaker calls yet")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("History that couldn't be read says so", () => {
    render(<CallsTab dashboard={{ ...DASHBOARD, history: null }} onOpen={vi.fn()} />);
    expect(screen.getByRole("heading", { name: /History/ }).closest("section")).toHaveTextContent("The call history could not be read — reload to try again.");
  });
});

describe("CallsTab — a row (brief §0.9)", () => {
  it("the London time, name, mobile, email, sign-up type, position facts and the nannies line", () => {
    render(<CallsTab dashboard={DASHBOARD} onOpen={vi.fn()} />);
    const overdue = table("Overdue");
    for (const text of [
      "Thu 4 Feb, 09:30 (London time)",
      "Ava Overdue",
      "+44 (0) 7700 900 111",
      "ava@example.test",
      "Advanced",
      "Islington",
      "30 hours a week",
      "Monday, Tuesday",
      "8 months, 2 years",
      "Starts 1 March 2027",
      "6 nannies contacted · 2 replied",
    ]) {
      expect(within(overdue).getByText(text)).toBeInTheDocument();
    }
  });

  it("the four links", () => {
    render(<CallsTab dashboard={DASHBOARD} onOpen={vi.fn()} />);
    const overdue = table("Overdue");
    expect(within(overdue).getByRole("link", { name: "Profile" })).toHaveAttribute("href", `/admin/viewer/${AVA}`);
    expect(within(overdue).getByRole("link", { name: "Account" })).toHaveAttribute("href", `/admin/users?openUser=${AVA}`);
    expect(within(overdue).getByRole("link", { name: "Money" })).toHaveAttribute("href", `/admin/users/${AVA}/subscription`);
    expect(within(overdue).getByRole("link", { name: "Position" })).toHaveAttribute("href", `/admin/positions?openPosition=${POS}`);
  });

  it("a quick-match family: 'No position yet' and no Position link", () => {
    render(<CallsTab dashboard={DASHBOARD} onOpen={vi.fn()} />);
    const fay = within(table("Not booked — to call")).getByText("Fay Quick").closest("tr")!;
    expect(within(fay).getByText("No position yet")).toBeInTheDocument();
    expect(within(fay).getByText("Quick match")).toBeInTheDocument();
    expect(within(fay).queryByRole("link", { name: "Position" })).not.toBeInTheDocument();
    expect(within(fay).getByRole("link", { name: "Profile" })).toHaveAttribute("href", `/admin/viewer/${FAY}`);
    expect(within(fay).getByText("Last tried Wed 3 Feb, 11:00 (London time)")).toBeInTheDocument();
  });

  it("the tags", () => {
    render(<CallsTab dashboard={DASHBOARD} onOpen={vi.fn()} />);
    expect(within(table("Overdue")).getByText("Overdue", { selector: "span" })).toBeInTheDocument();
    const upcoming = table("Today and upcoming");
    expect(within(upcoming).getByText("Blocked over — move or cancel")).toBeInTheDocument();
    expect(within(upcoming).getByText("Cohort pre-book")).toBeInTheDocument();
    expect(within(table("Not booked — to call")).getByText("Test")).toBeInTheDocument();
  });

  it("the Call control defaults to a tel: link; no mobile says so", () => {
    render(<CallsTab dashboard={DASHBOARD} onOpen={vi.fn()} />);
    expect(within(table("Overdue")).getByRole("link", { name: /Call Ava Overdue/ })).toHaveAttribute("href", "tel:+447700900111");
    expect(within(table("Today and upcoming")).getByText("No mobile")).toBeInTheDocument();
  });

  it("renderCallControl replaces it (brief 05's dialer)", () => {
    render(<CallsTab dashboard={DASHBOARD} onOpen={vi.fn()} renderCallControl={(r) => <button type="button">Dial {r.contact.name}</button>} />);
    expect(within(table("Overdue")).getByRole("button", { name: "Dial Ava Overdue" })).toBeInTheDocument();
    expect(within(table("Overdue")).queryByRole("link", { name: /Call Ava Overdue/ })).not.toBeInTheDocument();
  });

  it("the family's name opens her drawer — from the table, the cards, and History", () => {
    const onOpen = vi.fn();
    render(<CallsTab dashboard={DASHBOARD} onOpen={onOpen} />);
    fireEvent.click(within(table("Overdue")).getByRole("button", { name: "Ava Overdue" }));
    fireEvent.click(within(cards("Not booked — to call")).getByRole("button", { name: "Fay Quick" }));
    fireEvent.click(within(table("History")).getByRole("button", { name: "Hal Past" }));
    expect(onOpen.mock.calls).toEqual([[AVA], [FAY], [HAL]]);
  });

  it("History: when (London), the family, what happened, the note, who recorded it", () => {
    render(<CallsTab dashboard={DASHBOARD} onOpen={vi.fn()} />);
    const history = table("History");
    for (const text of ["Wed 3 Feb, 15:00 (London time)", "Hal Past", "No answer", "Rang twice", "Bai Admin"]) {
      expect(within(history).getByText(text)).toBeInTheDocument();
    }
  });
});
