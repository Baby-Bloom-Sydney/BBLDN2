/**
 * The address search's edges (06b-3 rework, ledger B06 §9.1 R2): short text searches nothing; a failed or refused
 * search shows no results; an unreadable pick is not taken; the districts failing to load lets a parsed address
 * through (as before); a tap outside closes the results; keyboard moves through them.
 *
 * BB-wave1-041126/06b3-rework, 2026-11-09.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AddressSearchField } from "./AddressSearchField";

let search: (url: string) => Promise<{ ok: boolean; json: () => Promise<unknown> }>;

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  search = async () => ({ ok: true, json: async () => [] });
  vi.stubGlobal("fetch", vi.fn((url: string) => search(url)));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function type(text: string) {
  fireEvent.change(screen.getByLabelText(/^Address/), { target: { value: text } });
  await act(async () => { await vi.advanceTimersByTimeAsync(250); });
}
const RESULTS = [{ sla: "7 NEW ROAD, LONDON N1 1AA", pid: "a", score: 1 }, { sla: "NO POSTCODE HERE", pid: "b", score: 1 }];

describe("useAddressSearch via AddressSearchField", () => {
  it("fewer than 4 characters: no search", async () => {
    render(<AddressSearchField id="h" value={null} onPick={vi.fn()} />);
    await type("7 n");
    expect(vi.mocked(fetch).mock.calls.filter(([u]) => String(u).startsWith("/api/address-search"))).toHaveLength(0);
  });

  it("a refused or failing search shows nothing", async () => {
    render(<AddressSearchField id="h" value={null} onPick={vi.fn()} />);
    search = async (url) => (url.startsWith("/api/address-search") ? { ok: false, json: async () => [] } : { ok: true, json: async () => [] });
    await type("7 new road");
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    search = async (url) => { if (url.startsWith("/api/address-search")) throw new TypeError("offline"); return { ok: true, json: async () => [] }; };
    await type("7 new roads");
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  it("districts unavailable: a parsed address is taken; an unreadable one is not", async () => {
    const onPick = vi.fn();
    search = async (url) => {
      if (url.startsWith("/api/london-districts")) throw new TypeError("offline");
      return { ok: true, json: async () => RESULTS };
    };
    render(<AddressSearchField id="h" value={null} onPick={onPick} />);
    await type("7 new road");
    fireEvent.click(screen.getByRole("button", { name: "No Postcode Here" }));
    expect(onPick).not.toHaveBeenCalled();
    await type("7 new road ");
    fireEvent.click(screen.getByRole("button", { name: "7 New Road, London N1 1aa" }));
    expect(onPick).toHaveBeenCalledWith({ line1: "7 New Road", line2: "", town: "London", postcode: "N1 1AA" });
  });

  it("keyboard: down and up through the results, up from the first back to the field; Escape in the field closes them; a tap outside too; focus reopens", async () => {
    search = async (url) => ({ ok: true, json: async () => (url.startsWith("/api/address-search") ? RESULTS : []) });
    render(<div><AddressSearchField id="h" value={null} onPick={vi.fn()} /><p>outside</p></div>);
    await type("7 new road");
    const input = screen.getByLabelText(/^Address/);
    fireEvent.keyDown(input, { key: "ArrowDown" });
    const [first, second] = screen.getAllByRole("button");
    expect(first).toHaveFocus();
    fireEvent.keyDown(first as HTMLElement, { key: "ArrowDown" });
    expect(second).toHaveFocus();
    fireEvent.keyDown(second as HTMLElement, { key: "ArrowUp" });
    expect(first).toHaveFocus();
    fireEvent.keyDown(first as HTMLElement, { key: "ArrowUp" });
    expect(input).toHaveFocus();
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    fireEvent.focus(input);
    expect(screen.getAllByRole("button")).toHaveLength(2);
    fireEvent.mouseDown(screen.getByText("outside"));
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });
});
