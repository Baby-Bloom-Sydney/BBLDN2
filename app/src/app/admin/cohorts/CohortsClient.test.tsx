/**
 * /admin/cohorts client (plan 02 step 8; brief §0.1–§0.12, §3). Every line the brief words, the families list with
 * Re-open place, the inline places edit, the warnings box, the past cohorts and the schedule form.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const actions = vi.hoisted(() => ({
  saveCohortSchedule: vi.fn(),
  setCohortPlaces: vi.fn(),
  reopenCohortPlace: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock("./actions", () => ({
  saveCohortSchedule: actions.saveCohortSchedule,
  setCohortPlaces: actions.setCohortPlaces,
  reopenCohortPlace: actions.reopenCohortPlace,
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: actions.refresh }) }));

import { CohortsClient } from "./CohortsClient";
import { entry, family, makeBoard, weeks } from "./board-fixture.test-util";

const SCHEDULE = { firstStartDate: "2027-02-01", repeatWeeks: 1, defaultPlaces: 5 };

beforeEach(() => {
  for (const fn of [actions.saveCohortSchedule, actions.setCohortPlaces, actions.reopenCohortPlace]) fn.mockResolvedValue({ ok: true });
});
afterEach(() => vi.clearAllMocks());

describe("states of the page", () => {
  it("§0.1 empty: the line and the three-field form, suggesting the next Monday, weekly, 5 places", () => {
    render(<CohortsClient board={makeBoard()} />);
    expect(screen.getByText("No cohorts yet. Set the first start date to begin.")).toBeInTheDocument();
    expect(screen.getByLabelText("First cohort starts")).toHaveValue("2026-11-09");
    expect(screen.getByLabelText("Repeat every (weeks)")).toHaveValue(1);
    expect(screen.getByLabelText("Places in each new cohort")).toHaveValue(5);
  });

  it("§0.2 / §3.2 schedule set, first date ahead: no current cohort; 8 cohorts, 7 days apart, each 5 · 0 · 5", () => {
    const upcoming = weeks("2027-02-01", 8);
    render(<CohortsClient board={makeBoard({ schedule: SCHEDULE, upcoming, next: upcoming[0] })} />);
    expect(screen.getByText("No current cohort. The first cohort opens Mon 1 Feb 2027.")).toBeInTheDocument();
    expect(screen.getAllByText("5 places · 0 taken · 5 left")).toHaveLength(8);
    const table = screen.getByRole("table", { name: "Upcoming cohorts" });
    expect(within(table).getByText("Mon 1 Feb 2027")).toBeInTheDocument();
    expect(within(table).getByText("Mon 8 Feb 2027")).toBeInTheDocument();
    expect(within(table).getByText("Mon 22 Mar 2027")).toBeInTheDocument();
    expect(screen.queryByText(/No cohorts yet/)).toBeNull();
  });
});

describe("the current cohort's card (§0.3, §0.6, §0.10, §0.12)", () => {
  const board = (fields: Parameters<typeof entry>[1] = { taken: 3 }, calls = makeBoard().calls) =>
    makeBoard({ today: "2027-02-03", schedule: SCHEDULE, current: entry("2027-02-01", fields), calls });

  it("the headline and the sentence BAI reads on the call, with 04's {8, 4}", () => {
    render(<CohortsClient board={board({ taken: 3 }, { kind: "counts", counts: { booked: 8, notBooked: 4 } })} />);
    expect(screen.getByText("Cohort starting Mon 1 Feb 2027 · 5 places · 3 taken · 2 left")).toBeInTheDocument();
    expect(screen.getByText("2 places left and 12 more families to call this week (8 booked · 4 not booked).")).toBeInTheDocument();
  });

  it("calls not connected: says so, never '0 more families'", () => {
    render(<CohortsClient board={board()} />);
    expect(screen.getByText("Calls: not connected yet")).toBeInTheDocument();
    expect(screen.queryByText(/0 more families/)).toBeNull();
  });

  it("1 being paid now", () => {
    render(<CohortsClient board={board({ taken: 3, beingPaid: 1 })} />);
    expect(screen.getByText("1 being paid now")).toBeInTheDocument();
  });

  it("over by 1, in amber; left never below 0", () => {
    render(<CohortsClient board={board({ taken: 6 })} />);
    const over = screen.getByText("Over by 1");
    expect(over.className).toMatch(/amber/);
    expect(screen.getByText("Cohort starting Mon 1 Feb 2027 · 5 places · 6 taken · 0 left")).toBeInTheDocument();
  });
});

describe("the next cohort's card (§0.11)", () => {
  it("goodwill places and pre-booked calls (03's stub at 2)", () => {
    const next = entry("2027-02-08", { taken: 1 }, { goodwillTaken: 1 });
    render(<CohortsClient board={makeBoard({ schedule: SCHEDULE, current: entry("2027-02-01"), next, upcoming: [next], preBooked: { kind: "count", count: 2 } })} />);
    const card = screen.getByRole("region", { name: "Next cohort" });
    expect(within(card).getByText("1 goodwill place taken")).toBeInTheDocument();
    expect(within(card).getByText("2 pre-booked calls")).toBeInTheDocument();
  });

  it("pre-booking not connected yet", () => {
    const next = entry("2027-02-08");
    render(<CohortsClient board={makeBoard({ schedule: SCHEDULE, next, upcoming: [next] })} />);
    expect(screen.getByText("Pre-booked calls: not connected yet")).toBeInTheDocument();
  });
});

describe("families in a cohort, and Re-open place (§0.5, §0.8, §3.7)", () => {
  const families = [
    family(1, { name: "Sarah Jones", paidBy: "card" }),
    family(2, { name: "Amira Khan", paidBy: "bank_transfer", isGoodwill: true }),
    family(3, { name: "Tom Reid", state: "reopened", reopenedAt: "2027-02-03T15:00:00Z", reopenReason: "moved abroad" }),
    family(4, { name: "Ada Lowe", state: "held", paidBy: null, takenAt: null }),
  ];
  const open = () => {
    render(<CohortsClient board={makeBoard({ schedule: SCHEDULE, current: entry("2027-02-01", { taken: 2 }, { families }) })} />);
    fireEvent.click(screen.getByRole("button", { name: "Families in the cohort starting Mon 1 Feb 2027 (4)" }));
    return screen.getByRole("dialog");
  };

  it("name (linking to the family's subscription), how they paid, goodwill, date, state", () => {
    const dialog = open();
    expect(within(dialog).getByRole("link", { name: "Sarah Jones" })).toHaveAttribute("href", `/admin/users/${families[0].parentUserId}/subscription`);
    expect(within(dialog).getAllByText("Card")).toHaveLength(2);
    expect(within(dialog).getByText("Bank transfer")).toBeInTheDocument();
    expect(within(dialog).getByText("Goodwill")).toBeInTheDocument();
    expect(within(dialog).getByText("Re-opened 3 Feb — moved abroad")).toBeInTheDocument();
    expect(within(dialog).getByText("Being paid now")).toBeInTheDocument();
    expect(within(dialog).getAllByText("2 Feb 2027").length).toBeGreaterThan(0);
    expect(within(dialog).getAllByRole("button", { name: /^Re-open place/ })).toHaveLength(2);
  });

  it("re-open needs a reason of 3+ characters, then confirms", async () => {
    const dialog = open();
    fireEvent.click(within(dialog).getByRole("button", { name: "Re-open place: Sarah Jones" }));
    const confirm = within(dialog).getByRole("button", { name: "Confirm re-open" });
    fireEvent.change(within(dialog).getByLabelText("Reason (required)"), { target: { value: "ab" } });
    expect(confirm).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText("Reason (required)"), { target: { value: "moved abroad" } });
    fireEvent.click(confirm);
    await waitFor(() => expect(actions.reopenCohortPlace).toHaveBeenCalledWith({ placeId: families[0].placeId, reason: "moved abroad" }));
    await waitFor(() => expect(actions.refresh).toHaveBeenCalled());
  });

  it("a second click says 'Already re-opened'", async () => {
    actions.reopenCohortPlace.mockResolvedValue({ ok: true, message: "Already re-opened" });
    const dialog = open();
    fireEvent.click(within(dialog).getByRole("button", { name: "Re-open place: Sarah Jones" }));
    fireEvent.change(within(dialog).getByLabelText("Reason (required)"), { target: { value: "moved abroad" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirm re-open" }));
    expect(await within(dialog).findByText("Already re-opened")).toBeInTheDocument();
  });

  it("a refused re-open shows the amber alert line", async () => {
    actions.reopenCohortPlace.mockResolvedValue({ ok: false, error: "save_failed", message: "That didn't save — try again." });
    const dialog = open();
    fireEvent.click(within(dialog).getByRole("button", { name: "Re-open place: Sarah Jones" }));
    fireEvent.change(within(dialog).getByLabelText("Reason (required)"), { target: { value: "moved abroad" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirm re-open" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("That didn't save — try again.");
  });
});

describe("places, edited inline (§0.4, §3.9)", () => {
  it("5 → 7 saves; → 2 is refused with the brief's message and the old value comes back", async () => {
    render(<CohortsClient board={makeBoard({ schedule: SCHEDULE, current: entry("2027-02-01", { taken: 3 }) })} />);
    const input = screen.getByLabelText("Places in the cohort starting Mon 1 Feb 2027");
    fireEvent.change(input, { target: { value: "7" } });
    fireEvent.click(within(input.closest("div")!.parentElement!).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(actions.setCohortPlaces).toHaveBeenCalledWith({ startDate: "2027-02-01", places: "7" }));
    actions.setCohortPlaces.mockResolvedValue({ ok: false, error: "below_taken", message: "3 places are already taken or being paid for. Set at least 3." });
    fireEvent.change(input, { target: { value: "2" } });
    fireEvent.click(within(input.closest("div")!.parentElement!).getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("3 places are already taken or being paid for. Set at least 3.");
    expect(input).toHaveValue(5);
  });
});

describe("the warnings box (§0.9, §3.8)", () => {
  const warnings = {
    kind: "ok" as const,
    truncated: false,
    list: [
      { kind: "refunded_but_held" as const, placeId: family(1).placeId, parentUserId: family(1).parentUserId, name: "Sarah Jones", cohortStartDate: "2027-02-01" },
      { kind: "paid_without_place" as const, parentUserId: family(9).parentUserId, name: "Tom Reid" },
      { kind: "over_capacity" as const, cohortStartDate: "2027-02-01", overBy: 1 },
    ],
  };

  it("each row with its fix", async () => {
    render(<CohortsClient board={makeBoard({ schedule: SCHEDULE, current: entry("2027-02-01", { taken: 6 }), warnings })} />);
    const box = screen.getByRole("region", { name: "Warnings" });
    expect(within(box).getByText("Deposit refunded but place still held: Sarah Jones")).toBeInTheDocument();
    expect(within(box).getByRole("link", { name: "Open family: Tom Reid" })).toHaveAttribute("href", `/admin/users/${family(9).parentUserId}/subscription`);
    expect(within(box).getByText("Over by 1: cohort starting Mon 1 Feb 2027")).toBeInTheDocument();
    fireEvent.click(within(box).getByRole("button", { name: "Re-open: Sarah Jones" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByLabelText("Reason (required)")).toHaveValue("Deposit refunded in Stripe");
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirm re-open" }));
    await waitFor(() => expect(actions.reopenCohortPlace).toHaveBeenCalledWith({ placeId: family(1).placeId, reason: "Deposit refunded in Stripe" }));
  });

  it("over capacity opens the cohort's families", () => {
    render(<CohortsClient board={makeBoard({ schedule: SCHEDULE, current: entry("2027-02-01", { taken: 6 }), warnings })} />);
    fireEvent.click(screen.getByRole("button", { name: "Open cohort: Mon 1 Feb 2027" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("Families · Mon 1 Feb 2027");
  });

  it("a failed read is flagged, never an empty box; a full list says so", () => {
    const { rerender } = render(<CohortsClient board={makeBoard({ schedule: SCHEDULE, warnings: { kind: "unavailable" } })} />);
    expect(screen.getByText("The warnings could not be read — reload to try again.")).toBeInTheDocument();
    rerender(<CohortsClient board={makeBoard({ schedule: SCHEDULE, warnings: { ...warnings, truncated: true } })} />);
    expect(screen.getByText("Showing the first 100 of each kind.")).toBeInTheDocument();
  });

  it("no warnings, no box", () => {
    render(<CohortsClient board={makeBoard({ schedule: SCHEDULE })} />);
    expect(screen.queryByRole("region", { name: "Warnings" })).toBeNull();
  });
});

describe("past cohorts, folded away (§3.6; plan R12)", () => {
  it("read-only: date, places, taken, re-opened", () => {
    const past = [entry("2027-01-25", { taken: 4 }, { reopened: 1 })];
    render(<CohortsClient board={makeBoard({ schedule: SCHEDULE, current: entry("2027-02-01"), past })} />);
    const trigger = screen.getByRole("button", { name: "Past cohorts (1)" });
    fireEvent.click(trigger);
    const table = screen.getByRole("table", { name: "Past cohorts" });
    expect(within(table).getByText("Mon 25 Jan 2027")).toBeInTheDocument();
    expect(within(table).getByText("1 re-opened")).toBeInTheDocument();
    expect(within(table).queryByRole("spinbutton")).toBeNull();
  });
});

describe("the schedule form (§3.1, §3.9)", () => {
  it("saves the three fields as typed", async () => {
    render(<CohortsClient board={makeBoard()} />);
    fireEvent.change(screen.getByLabelText("First cohort starts"), { target: { value: "2027-02-01" } });
    fireEvent.click(screen.getByRole("button", { name: "Save schedule" }));
    await waitFor(() => expect(actions.saveCohortSchedule).toHaveBeenCalledWith({ firstStartDate: "2027-02-01", repeatWeeks: "1", defaultPlaces: "5" }));
    expect(actions.refresh).toHaveBeenCalled();
  });

  it("a failed save: the amber line, and the typed values stay", async () => {
    actions.saveCohortSchedule.mockResolvedValue({ ok: false, error: "invalid_places", message: "Places must be a whole number from 0 to 99." });
    render(<CohortsClient board={makeBoard({ schedule: SCHEDULE })} />);
    fireEvent.change(screen.getByLabelText("Places in each new cohort"), { target: { value: "100" } });
    fireEvent.click(screen.getByRole("button", { name: "Save schedule" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Places must be a whole number from 0 to 99.");
    expect(screen.getByLabelText("Places in each new cohort")).toHaveValue(100);
    expect(screen.getByLabelText("First cohort starts")).toHaveValue("2027-02-01");
  });
});
