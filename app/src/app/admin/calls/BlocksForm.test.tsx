/**
 * Blocks (plan C5; brief §3 admin 5, §0.12, §9.12): add a block with a reason (native date and time inputs, read as
 * London on the server), and remove one (LDN1 never built removal). A booked call under a block stays booked (the
 * server's rule; the Calls tab tags it). The list is the blocks still to come, soonest first.
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const nav = vi.hoisted(() => ({ refresh: vi.fn() }));
const actions = vi.hoisted(() => ({ addCallBlockAction: vi.fn(), removeCallBlockAction: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => nav }));
vi.mock("./actions", () => actions);

import { BlocksForm } from "./BlocksForm";
import { CALENDAR, DENTIST_ID } from "./calendar-fixtures.test-util";

beforeEach(() => {
  nav.refresh.mockReset();
  actions.addCallBlockAction.mockReset();
  actions.addCallBlockAction.mockResolvedValue({ ok: true, value: { blockId: "new" } });
  actions.removeCallBlockAction.mockReset();
  actions.removeCallBlockAction.mockResolvedValue({ ok: true, value: { blockId: DENTIST_ID } });
});

const fill = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const list = () => screen.getByRole("list", { name: "Blocks ahead" });

describe("BlocksForm", () => {
  it("lists the blocks still to come in London words with their reasons, each removable", () => {
    render(<BlocksForm blocks={CALENDAR.blocks} defaultDate="2027-02-04" />);
    expect(screen.getByRole("heading", { level: 2, name: "Blocks (London time)" })).toBeInTheDocument();
    const items = within(list()).getAllByRole("listitem");
    expect(items.map((li) => li.querySelector("p")?.textContent)).toEqual([
      "Fri 5 Feb, 09:00 – 11:00 (London time) · dentist",
      "Mon 15 Feb, 09:00 – Fri 19 Feb, 18:00 (London time) · holiday",
    ]);
    expect(within(items[0]).getByRole("button", { name: "Remove block: Fri 5 Feb, 09:00 – 11:00 (London time), dentist" })).toBeInTheDocument();
  });

  it("no blocks ahead → says so", () => {
    render(<BlocksForm blocks={[]} defaultDate="2027-02-04" />);
    expect(screen.getByText("No blocks ahead.")).toBeInTheDocument();
  });

  it("add: the London strings as typed go to the server; 'Block added.'; the time and reason fields empty again", async () => {
    render(<BlocksForm blocks={CALENDAR.blocks} defaultDate="2027-02-04" />);
    expect(screen.getByLabelText("From date")).toHaveValue("2027-02-04");
    fill("From date", "2027-02-12");
    fill("From time", "09:00");
    fill("To time", "13:00");
    fill("Reason", "dentist");
    expect(screen.getByLabelText("To date")).toHaveValue("2027-02-12"); // moves with the start, never left before it
    fireEvent.click(screen.getByRole("button", { name: "Add block" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Block added."));
    expect(actions.addCallBlockAction).toHaveBeenCalledWith({ fromDate: "2027-02-12", fromTime: "09:00", toDate: "2027-02-12", toTime: "13:00", reason: "dentist" });
    expect(screen.getByLabelText("Reason")).toHaveValue("");
    expect(screen.getByLabelText("From time")).toHaveValue("");
    expect(nav.refresh).toHaveBeenCalled();
  });

  it("add refused → the block line, and what was typed stays", async () => {
    actions.addCallBlockAction.mockResolvedValue({ ok: false, error: "invalid" });
    render(<BlocksForm blocks={CALENDAR.blocks} defaultDate="2027-02-04" />);
    fill("Reason", "dentist");
    fireEvent.click(screen.getByRole("button", { name: "Add block" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/^Check the block:/));
    expect(screen.getByLabelText("Reason")).toHaveValue("dentist");
  });

  it("remove: that block's id to the server; 'Block removed.'", async () => {
    render(<BlocksForm blocks={CALENDAR.blocks} defaultDate="2027-02-04" />);
    fireEvent.click(screen.getByRole("button", { name: /^Remove block: Fri 5 Feb/ }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Block removed."));
    expect(actions.removeCallBlockAction).toHaveBeenCalledWith({ blockId: DENTIST_ID });
  });

  it("remove of a block already gone → 'That block has already gone — reload to see the calendar.'", async () => {
    actions.removeCallBlockAction.mockResolvedValue({ ok: false, error: "not_found" });
    render(<BlocksForm blocks={CALENDAR.blocks} defaultDate="2027-02-04" />);
    fireEvent.click(screen.getByRole("button", { name: /^Remove block: Fri 5 Feb/ }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("That block has already gone — reload to see the calendar."));
  });
});
