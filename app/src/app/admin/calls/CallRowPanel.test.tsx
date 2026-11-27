/**
 * The row drawer's content (plan C4; brief §3 admin 2–4; BB-wave1-041126/04c1-build): the family's name, tags,
 * sign-up and the four links up top; then contact (the Call control), her matchmaker call (book, move, cancel on her
 * behalf), the outcome form, position and nannies, the deposit (read-only), and every past attempt and note. It
 * says the times are London time.
 */
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

const actions = vi.hoisted(() => ({
  holdCallForFamily: vi.fn(),
  confirmCallForFamily: vi.fn(),
  cancelCallForFamily: vi.fn(),
  reloadFamilySlots: vi.fn(),
  recordCallOutcomeAction: vi.fn(),
}));
vi.mock("./actions", () => actions);

import { defaultCallControl } from "./CallRowParts";
import { CallRowPanel } from "./CallRowPanel";
import { AVA, BOOKING, PANEL, POS } from "./calls-fixtures.test-util";

const block = (title: string) => screen.getByRole("region", { name: title });

describe("CallRowPanel", () => {
  it("the header: name, tags, sign-up type, when she signed up, the four links; London time said once", () => {
    render(<CallRowPanel panel={PANEL} renderCallControl={defaultCallControl} onChanged={vi.fn()} />);
    expect(screen.getByRole("heading", { level: 2, name: "Ava Overdue" })).toBeInTheDocument();
    expect(screen.getByText("Test")).toBeInTheDocument();
    expect(screen.getByText("Advanced · Signed up Mon 1 Feb, 10:00 (London time)")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Position" })).toHaveAttribute("href", `/admin/positions?openPosition=${POS}`);
    expect(screen.getByRole("link", { name: "Money" })).toHaveAttribute("href", `/admin/users/${AVA}/subscription`);
    expect(screen.getByText("Every time on this page is London time.")).toBeInTheDocument();
  });

  it("contact: the Call control and her email", () => {
    render(<CallRowPanel panel={PANEL} renderCallControl={defaultCallControl} onChanged={vi.fn()} />);
    expect(within(block("Contact")).getByRole("link", { name: /Call Ava Overdue/ })).toHaveAttribute("href", "tel:+447700900111");
    expect(within(block("Contact")).getByRole("link", { name: "ava@example.test" })).toHaveAttribute("href", "mailto:ava@example.test");
  });

  it("05's dialer replaces the Call control here too", () => {
    render(<CallRowPanel panel={PANEL} renderCallControl={(t) => <button type="button">Dial {t.contact.name}</button>} onChanged={vi.fn()} />);
    expect(within(block("Contact")).getByRole("button", { name: "Dial Ava Overdue" })).toBeInTheDocument();
  });

  it("her booked call with Move and Cancel booking; the outcome form", () => {
    render(<CallRowPanel panel={PANEL} renderCallControl={defaultCallControl} onChanged={vi.fn()} />);
    const call = block("Matchmaker call");
    expect(within(call).getByText("Mon 8 Feb, 10:00 (London time)")).toBeInTheDocument();
    expect(within(call).getByRole("button", { name: "Move" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Record outcome" })).toBeInTheDocument();
  });

  it("position and nannies; the deposit, read-only", () => {
    render(<CallRowPanel panel={PANEL} renderCallControl={defaultCallControl} onChanged={vi.fn()} />);
    expect(within(block("Position")).getByText("Islington")).toBeInTheDocument();
    expect(within(block("Position")).getByText("6 nannies contacted · 2 replied")).toBeInTheDocument();
    expect(within(block("Deposit (read-only)")).getByText("Deposit paid 3 February 2027")).toBeInTheDocument();
    expect(within(block("Deposit (read-only)")).queryByRole("button")).not.toBeInTheDocument();
  });

  it("nanny counts that couldn't be read show — in the drawer (M10)", () => {
    render(<CallRowPanel panel={{ ...PANEL, position: { ...PANEL.position!, nannies: null } }} renderCallControl={defaultCallControl} onChanged={vi.fn()} />);
    expect(within(block("Position")).getByText("—")).toBeInTheDocument();
  });

  it("a quick-match family: 'No position yet', no Position link", () => {
    render(<CallRowPanel panel={{ ...PANEL, position: null, links: { ...PANEL.links, position: null } }} renderCallControl={defaultCallControl} onChanged={vi.fn()} />);
    expect(within(block("Position")).getByText("No position yet")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Position" })).not.toBeInTheDocument();
  });

  it("every attempt, newest first, with the note, who recorded it and any call-back", () => {
    render(<CallRowPanel panel={PANEL} renderCallControl={defaultCallControl} onChanged={vi.fn()} />);
    const items = within(block("Every attempt")).getAllByRole("listitem");
    expect(items.map((i) => i.textContent)).toEqual([
      expect.stringContaining("Answered · Call back later"),
      expect.stringContaining("No answer"),
    ]);
    expect(items[0]).toHaveTextContent("Call back Fri 5 Feb, 17:00 (London time)");
    expect(items[1]).toHaveTextContent("Rang twice");
    expect(items[1]).toHaveTextContent("by Bai Admin");
  });

  it("the page's refresh after a write keeps the drawer's status lines (the picker and the form aren't remounted)", async () => {
    const user = userEvent.setup();
    actions.cancelCallForFamily.mockResolvedValue({ ok: true, value: { bookingId: PANEL.booking!.bookingId } });
    const { rerender } = render(<CallRowPanel panel={PANEL} renderCallControl={defaultCallControl} onChanged={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Cancel booking" }));
    await user.click(screen.getByRole("button", { name: "Yes, cancel it" }));
    expect(await screen.findByText("Cancelled — the family is back under Not booked.")).toBeInTheDocument();
    rerender(<CallRowPanel panel={{ ...PANEL, booking: null, days: [...PANEL.days!] }} renderCallControl={defaultCallControl} onChanged={vi.fn()} />);
    expect(screen.getByText("Cancelled — the family is back under Not booked.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Book a matchmaker call" })).toBeInTheDocument();
  });

  it("the body scrolls inside the drawer, so the header (name, links, close) stays (review: the leads drawer's model)", () => {
    render(<CallRowPanel panel={PANEL} renderCallControl={defaultCallControl} onChanged={vi.fn()} />);
    const body = screen.getByText("Every time on this page is London time.").parentElement!;
    expect(body.className).toContain("min-h-0 flex-1 overflow-y-auto");
  });

  it("no attempts yet says so", () => {
    render(<CallRowPanel panel={{ ...PANEL, attempts: [] }} renderCallControl={defaultCallControl} onChanged={vi.fn()} />);
    expect(within(block("Every attempt")).getByText("No attempts yet.")).toBeInTheDocument();
  });
});

describe("CallRowPanel — brief 05's attempt slot (05a-2, D4)", () => {
  it("renderAttemptAction draws under each attempt, given the attempt and her id and booked call", () => {
    const renderAttemptAction = vi.fn((attempt: { readonly key: string }) => <button type="button">{`Act on ${attempt.key}`}</button>);
    render(<CallRowPanel panel={PANEL} renderCallControl={defaultCallControl} onChanged={vi.fn()} renderAttemptAction={renderAttemptAction} />);
    const items = within(block("Every attempt")).getAllByRole("listitem");
    expect(within(items[0]).getByRole("button", { name: "Act on e2" })).toBeInTheDocument();
    expect(within(items[1]).getByRole("button", { name: "Act on e1" })).toBeInTheDocument();
    expect(renderAttemptAction).toHaveBeenCalledWith(PANEL.attempts[0], { parentUserId: AVA, bookingId: PANEL.booking?.bookingId });
  });

  it("without it each attempt is drawn as today", () => {
    const { container: withSlot } = render(<CallRowPanel panel={PANEL} renderCallControl={defaultCallControl} onChanged={vi.fn()} renderAttemptAction={() => null} />);
    const slotted = within(withSlot).getByRole("region", { name: "Every attempt" }).innerHTML;
    const { container: today } = render(<CallRowPanel panel={PANEL} renderCallControl={defaultCallControl} onChanged={vi.fn()} />);
    expect(within(today).getByRole("region", { name: "Every attempt" }).innerHTML.replace(/:r[0-9a-z]+:/g, "")).toBe(slotted.replace(/:r[0-9a-z]+:/g, ""));
  });
});

describe("CallRowPanel — brief 05's after-call form (05b, D2)", () => {
  const form = () => screen.getByRole("region", { name: "Record outcome" });

  it("afterCall is asked with her id and booked call; its form has the JustCall line, its save and Save and call next", async () => {
    const user = userEvent.setup();
    const save = vi.fn().mockResolvedValue({ ok: true, entryId: "e-1" });
    const onSavedNext = vi.fn();
    const afterCall = vi.fn().mockReturnValue({ key: "CAab12", extraReadOnly: <p>JustCall · Outgoing · 6 min 12 s · Ref CAab12</p>, save, saveNext: { label: "Save and call next", onSavedNext } });
    render(<CallRowPanel panel={PANEL} renderCallControl={defaultCallControl} onChanged={vi.fn()} afterCall={afterCall} />);
    expect(afterCall).toHaveBeenCalledWith({ parentUserId: AVA, bookingId: BOOKING });
    expect(within(form()).getByText("JustCall · Outgoing · 6 min 12 s · Ref CAab12")).toBeInTheDocument();
    await user.click(within(form()).getByRole("button", { name: "No answer" }));
    await user.click(within(form()).getByRole("button", { name: "Save and call next" }));
    await waitFor(() => expect(onSavedNext).toHaveBeenCalledWith("e-1"));
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ parentUserId: AVA, bookingId: BOOKING, result: "no_answer" }));
    expect(actions.recordCallOutcomeAction).not.toHaveBeenCalled();
  });

  it("a new call (a new key) gives a fresh form; the same call keeps what was picked", async () => {
    const user = userEvent.setup();
    const after = (key: string) => () => ({ key, save: vi.fn() });
    const { rerender } = render(<CallRowPanel panel={PANEL} renderCallControl={defaultCallControl} onChanged={vi.fn()} afterCall={after("CA1")} />);
    await user.click(within(form()).getByRole("button", { name: "No answer" }));
    rerender(<CallRowPanel panel={PANEL} renderCallControl={defaultCallControl} onChanged={vi.fn()} afterCall={after("CA1")} />);
    expect(within(form()).getByRole("button", { name: "No answer" })).toHaveAttribute("aria-pressed", "true");
    rerender(<CallRowPanel panel={PANEL} renderCallControl={defaultCallControl} onChanged={vi.fn()} afterCall={after("CA2")} />);
    expect(within(form()).getByRole("button", { name: "No answer" })).toHaveAttribute("aria-pressed", "false");
  });

  it("afterCall answering null (not her call) leaves today's form", () => {
    render(<CallRowPanel panel={PANEL} renderCallControl={defaultCallControl} onChanged={vi.fn()} afterCall={() => null} />);
    expect(within(form()).queryByText(/JustCall/)).toBeNull();
    expect(within(form()).queryByRole("button", { name: "Save and call next" })).toBeNull();
  });
});
