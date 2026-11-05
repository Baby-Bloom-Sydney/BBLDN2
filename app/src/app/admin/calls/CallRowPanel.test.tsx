/**
 * The row drawer's content (plan C4; brief §3 admin 2–4; BB-wave1-041126/04c1-build): the family's name, tags,
 * sign-up and the four links up top; then contact (the Call control), her matchmaker call (book, move, cancel on her
 * behalf), the outcome form, position and nannies, the deposit (read-only), and every past attempt and note. It
 * says the times are London time.
 */
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("./actions", () => ({
  holdCallForFamily: vi.fn(),
  confirmCallForFamily: vi.fn(),
  cancelCallForFamily: vi.fn(),
  reloadFamilySlots: vi.fn(),
  recordCallOutcomeAction: vi.fn(),
}));

import { defaultCallControl } from "./CallRowParts";
import { CallRowPanel } from "./CallRowPanel";
import { AVA, PANEL, POS } from "./calls-fixtures.test-util";

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

  it("no attempts yet says so", () => {
    render(<CallRowPanel panel={{ ...PANEL, attempts: [] }} renderCallControl={defaultCallControl} onChanged={vi.fn()} />);
    expect(within(block("Every attempt")).getByText("No attempts yet.")).toBeInTheDocument();
  });
});
