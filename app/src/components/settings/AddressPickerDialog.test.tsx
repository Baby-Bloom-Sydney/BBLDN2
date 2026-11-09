/**
 * Parent Settings' address dialog, unchanged in behaviour after the 06b-3 rework moved its search into
 * `useAddressSearch` + `AddressSearchInput` (ledger B06 §9.1 R2): it opens on the saved town and postcode, offers only
 * served London addresses, saves the picked one, and typing again drops the pick.
 *
 * BB-wave1-041126/06b3-rework, 2026-11-09.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AddressPickerDialog } from "./AddressPickerDialog";

function respond(url: string) {
  if (url.startsWith("/api/london-districts")) return [{ district: "N1", prefix: "N1", label: "Islington" }];
  return [{ sla: "7 NEW ROAD, LONDON N1 1AA", pid: "a", score: 1 }, { sla: "2 FAR LANE, LEEDS LS1 1AA", pid: "b", score: 1 }];
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

async function type(text: string) {
  fireEvent.change(screen.getByLabelText("Address"), { target: { value: text } });
  await act(async () => { await vi.advanceTimersByTimeAsync(250); });
}

function show(onSubmit = vi.fn(async () => ({ success: true }))) {
  const onOpenChange = vi.fn();
  render(<AddressPickerDialog open onOpenChange={onOpenChange} currentSuburb="Camden" currentPostcode="NW1 0AA" onSubmit={onSubmit} />);
  return { onSubmit, onOpenChange };
}

describe("AddressPickerDialog (parent Settings)", () => {
  it("opens on her town and postcode; Save waits for a pick", () => {
    show();
    expect(screen.getByLabelText("Address")).toHaveValue("Camden NW1 0AA");
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    expect(screen.getByText("London only")).toHaveClass("text-slate-500");
  });

  it("a served pick shows its town and postcode and saves the parsed address; then closes", async () => {
    const { onSubmit, onOpenChange } = show();
    await type("7 new road");
    fireEvent.click(screen.getByRole("button", { name: "7 New Road, London N1 1aa" }));
    expect(screen.getByLabelText("Address")).toHaveValue("London N1 1AA");
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Save" })); });
    expect(onSubmit).toHaveBeenCalledWith({ line1: "7 New Road", line2: "", town: "London", postcode: "N1 1AA" });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("Enter in the box after a pick saves, as it always has (round 2 #6: only the inline search blocks Enter)", async () => {
    const { onSubmit } = show();
    await type("7 new road");
    fireEvent.click(screen.getByRole("button", { name: "7 New Road, London N1 1aa" }));
    const box = screen.getByLabelText("Address");
    await act(async () => {
      const allowed = fireEvent.keyDown(box, { key: "Enter" });
      if (allowed) fireEvent.submit(box.closest("form") as HTMLFormElement);
    });
    expect(onSubmit).toHaveBeenCalledWith({ line1: "7 New Road", line2: "", town: "London", postcode: "N1 1AA" });
  });

  it("typing again drops the pick; an address outside the area is refused", async () => {
    show();
    await type("7 new road");
    fireEvent.click(screen.getByRole("button", { name: "7 New Road, London N1 1aa" }));
    await type("2 far");
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "2 Far Lane, Leeds Ls1 1aa" }));
    expect(screen.getByText(/outside our service area/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("a refused save shows its message (or the default) and stays open", async () => {
    const onSubmit = vi.fn().mockResolvedValueOnce({ success: false, error: "Not authenticated" }).mockResolvedValueOnce({ success: false });
    const { onOpenChange } = show(onSubmit);
    await type("7 new road");
    fireEvent.click(screen.getByRole("button", { name: "7 New Road, London N1 1aa" }));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Save" })); });
    expect(screen.getByRole("alert")).toHaveTextContent("Not authenticated");
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Save" })); });
    expect(screen.getByRole("alert")).toHaveTextContent("Couldn't save address.");
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
