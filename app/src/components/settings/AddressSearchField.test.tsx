/**
 * The inline address search (ledger B06 §9.1 R2), extracted from `AddressPickerDialog` (which keeps wrapping it for
 * parent Settings): UK addresses from the search, served London districts only; the current address stays until she
 * picks another; a pick gives her whole address (street line, town, postcode).
 *
 * BB-wave1-041126/06b3-rework, 2026-11-09.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AddressSearchField } from "./AddressSearchField";

const HOME = { line1: "1 Upper Street", line2: "", town: "London", postcode: "N1 0AA" };

function respond(url: string) {
  if (url.startsWith("/api/london-districts")) return [{ district: "N1", prefix: "N1", label: "Islington" }];
  return [
    { sla: "7 NEW ROAD, LONDON N1 1AA", pid: "a", score: 1 },
    { sla: "2 FAR LANE, LEEDS LS1 1AA", pid: "b", score: 1 },
  ];
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.stubGlobal("fetch", vi.fn(async (url: string) => ({ ok: true, json: async () => respond(url) })));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function search(text: string) {
  fireEvent.change(screen.getByLabelText("Address"), { target: { value: text } });
  await act(async () => { await vi.advanceTimersByTimeAsync(250); });
}

describe("AddressSearchField", () => {
  it("shows her current address in full; it stays until another is picked", async () => {
    const onPick = vi.fn();
    render(<AddressSearchField id="home" value={HOME} onPick={onPick} />);
    expect(screen.getByText("1 Upper Street")).toBeInTheDocument();
    expect(screen.getByText("N1 0AA")).toBeInTheDocument();
    expect(screen.getByLabelText("Address")).toHaveValue("");
    await search("7 new");
    expect(screen.getByText("1 Upper Street")).toBeInTheDocument();
    expect(onPick).not.toHaveBeenCalled();
  });

  it("a served address picked: her whole address, stored as verification stores it", async () => {
    const onPick = vi.fn();
    render(<AddressSearchField id="home" value={null} onPick={onPick} />);
    await search("7 new");
    fireEvent.click(screen.getByRole("button", { name: "7 New Road, London N1 1aa" }));
    expect(onPick).toHaveBeenCalledWith({ line1: "7 New Road", line2: "", town: "London", postcode: "N1 1AA" });
    expect(screen.getByLabelText("Address")).toHaveValue("");
  });

  it("an address outside the service area is not taken", async () => {
    const onPick = vi.fn();
    render(<AddressSearchField id="home" value={HOME} onPick={onPick} />);
    await search("2 far");
    fireEvent.click(screen.getByRole("button", { name: "2 Far Lane, Leeds Ls1 1aa" }));
    expect(onPick).not.toHaveBeenCalled();
    expect(screen.getByText(/outside our service area/)).toBeInTheDocument();
  });

  it("no address on file reads Not added; an error is shown and wired to the field", () => {
    render(<AddressSearchField id="home" value={null} onPick={vi.fn()} error="Choose your address" />);
    expect(screen.getByText("Not added")).toBeInTheDocument();
    const input = screen.getByLabelText("Address");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAccessibleDescription(/Choose your address/);
  });

  it("keyboard: arrow down to the results, Escape back to the field", async () => {
    render(<AddressSearchField id="home" value={HOME} onPick={vi.fn()} />);
    await search("7 new");
    fireEvent.keyDown(screen.getByLabelText("Address"), { key: "ArrowDown" });
    expect(screen.getByRole("button", { name: "7 New Road, London N1 1aa" })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole("button", { name: "7 New Road, London N1 1aa" }), { key: "Escape" });
    expect(screen.getByLabelText("Address")).toHaveFocus();
    expect(screen.queryByRole("button", { name: "7 New Road, London N1 1aa" })).toBeNull();
  });
});
