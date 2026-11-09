/**
 * 06b-3 rework, review round 1 (ledger B06 §9.8): the shared edit-mode pieces' fixes, each red first.
 * - Address search: results in the page's flow (a card's `overflow-hidden` clipped them: code H1, a11y C1, React H1);
 *   Enter in the box never submits the page (TS M3, React M1); results close when focus leaves (a11y M1); after a pick,
 *   focus is back in the box and the new address is announced (a11y H3, React M4); a search with nothing found says so
 *   and outside-the-area is an alert (a11y M2); required (a11y M4).
 * - Edit mode: Save stays focusable while saving and gets focus back after a refusal or the give-up (a11y H2, React
 *   M3); the notice sits in the pinned header (a11y H2); every notice is an alert; "Saving…" / "Saved" are announced
 *   (a11y M3); a field's error clears as she changes it (a11y M7); the first focus is the checked radio (a11y L2).
 * - Fields expose required (a11y M4) and an invalid field is rose-600 (a11y M5); the confirm's buttons follow the
 *   focus order (a11y L3); a protocol-relative path is never pushed (security L3); row values can wrap (a11y M6).
 *
 * BB-wave1-041126/06b3-rework, 2026-11-09.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";

const { refresh, push } = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push }) }));

import { AddressSearchField } from "./AddressSearchField";
import { DiscardChangesDialog } from "./DiscardChangesDialog";
import { RadioChoice, TextField } from "./SettingsFields";
import { SettingsEditHeader } from "./SettingsEditHeader";
import { SettingsRow } from "./SettingsRow";
import { useEditMode, type SaveOutcome } from "./useEditMode";
import { useUnsavedGuard } from "./useUnsavedGuard";

function respond(url: string) {
  if (url.startsWith("/api/london-districts")) return [{ district: "N1", prefix: "N1", label: "Islington" }];
  if (url.includes("nothing")) return [];
  return [{ sla: "7 NEW ROAD, LONDON N1 1AA", pid: "a", score: 1 }, { sla: "2 FAR LANE, LEEDS LS1 1AA", pid: "b", score: 1 }];
}

beforeEach(() => {
  refresh.mockReset();
  push.mockReset();
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.stubGlobal("fetch", vi.fn(async (url: string) => ({ ok: true, json: async () => respond(url) })));
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

describe("address search", () => {
  it("results are in the page's flow, never an overlay a card can clip", async () => {
    render(<AddressSearchField id="h" value={null} onPick={vi.fn()} />);
    await type("7 new road");
    const list = screen.getByRole("button", { name: "7 New Road, London N1 1aa" }).parentElement as HTMLElement;
    expect(list.className).not.toMatch(/\babsolute\b/);
  });

  it("Enter in the box never submits the page", async () => {
    const submit = vi.fn((e: React.FormEvent) => e.preventDefault());
    render(<form onSubmit={submit}><AddressSearchField id="h" value={null} onPick={vi.fn()} /><button type="submit">Save</button></form>);
    await type("7 new road");
    const enter = fireEvent.keyDown(screen.getByLabelText(/^Address/), { key: "Enter" });
    expect(enter).toBe(false); // default prevented: no implicit submission
  });

  it("results close when focus leaves the field and its list", async () => {
    render(<div><AddressSearchField id="h" value={null} onPick={vi.fn()} /><button>Next</button></div>);
    await type("7 new road");
    fireEvent.blur(screen.getByLabelText(/^Address/), { relatedTarget: screen.getByRole("button", { name: "Next" }) });
    expect(screen.queryByRole("button", { name: "7 New Road, London N1 1aa" })).toBeNull();
  });

  it("a pick: focus back in the box; the new address announced", async () => {
    const Host = () => {
      const [home, setHome] = useState<null | { line1: string; line2: string; town: string; postcode: string }>(null);
      return <AddressSearchField id="h" value={home} onPick={setHome} />;
    };
    render(<Host />);
    await type("7 new road");
    fireEvent.click(screen.getByRole("button", { name: "7 New Road, London N1 1aa" }));
    expect(screen.getByLabelText(/^Address/)).toHaveFocus();
    expect(document.getElementById("h-current")).toHaveAttribute("aria-live", "polite");
    expect(document.getElementById("h-current")).toHaveTextContent("7 New Road");
  });

  it("nothing found says so; outside the area is an alert; the box is required and named for searching", async () => {
    render(<AddressSearchField id="h" value={null} onPick={vi.fn()} required />);
    await type("nothing here");
    expect(screen.getByText("No addresses found")).toBeInTheDocument();
    await type("2 far lane");
    fireEvent.click(screen.getByRole("button", { name: "2 Far Lane, Leeds Ls1 1aa" }));
    expect(screen.getByRole("alert")).toHaveTextContent(/outside our service area/);
    const box = screen.getByLabelText(/^Address/);
    expect(box).toHaveAttribute("aria-required", "true");
    expect(box).toHaveAccessibleName("Address, search for another");
  });
});

let next: () => Promise<SaveOutcome>;
function Page() {
  const mode = useEditMode();
  const [kind, setKind] = useState("a");
  return (
    <div>
      <SettingsEditHeader title="Profile" editing={mode.editing} saving={mode.saving} onEdit={mode.begin} onCancel={mode.cancel}
        formId="f" editRef={mode.editRef} saveRef={mode.saveRef} notice={mode.notice} announcement={mode.announcement} />
      {mode.editing && (
        <form id="f" ref={mode.formRef} onSubmit={(e) => { e.preventDefault(); void mode.save(() => next()); }}>
          <RadioChoice name="k" value="a" checked={kind === "a"} onSelect={() => setKind("a")} label="First" />
          <RadioChoice name="k" value="b" checked={kind === "b"} onSelect={() => setKind("b")} label="Second" />
          <TextField id="n" label="Name" value="" onChange={() => mode.clearError("name")} error={mode.errors.name} required />
          <button type="button" onClick={() => mode.refuse({ name: "Enter your name" })}>Check</button>
        </form>
      )}
    </div>
  );
}

describe("edit mode", () => {
  it("the first focus is the checked radio; required is exposed", () => {
    render(<Page />);
    fireEvent.click(screen.getByRole("button", { name: "Edit profile" }));
    expect(screen.getByRole("radio", { name: "First" })).toHaveFocus();
    cleanup();
    render(<Page />);
    fireEvent.click(screen.getByRole("button", { name: "Edit profile" }));
    fireEvent.click(screen.getByRole("radio", { name: "Second" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "Edit profile" }));
    expect(screen.getByLabelText("Name")).toHaveAttribute("aria-required", "true");
  });

  it("while saving, Save stays focusable (aria-disabled) and 'Saving…' is announced; a refusal gives focus back to Save, the notice in the pinned header as an alert", async () => {
    let resolve: (o: SaveOutcome) => void = () => undefined;
    next = () => new Promise((r) => { resolve = r; });
    render(<Page />);
    fireEvent.click(screen.getByRole("button", { name: "Edit profile" }));
    const save = screen.getByRole("button", { name: "Save" });
    save.focus();
    act(() => { fireEvent.click(save); });
    const busy = screen.getByRole("button", { name: "Saving…" });
    expect(busy).not.toBeDisabled();
    expect(busy).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("status")).toHaveTextContent("Saving…");
    await act(async () => { resolve({ kind: "refused", message: "Please sign in again, then try once more." }); });
    expect(screen.getByRole("button", { name: "Save" })).toHaveFocus();
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Please sign in again");
    expect(alert.closest("[data-pinned]")).toHaveAttribute("data-pinned", "true");
  });

  it("saved is announced; stale is an alert too", async () => {
    next = async () => ({ kind: "saved" });
    render(<Page />);
    fireEvent.click(screen.getByRole("button", { name: "Edit profile" }));
    await act(async () => { fireEvent.submit(document.getElementById("f") as HTMLFormElement); });
    expect(screen.getByRole("status")).toHaveTextContent("Saved");
    next = async () => ({ kind: "stale" });
    fireEvent.click(screen.getByRole("button", { name: "Edit profile" }));
    await act(async () => { fireEvent.submit(document.getElementById("f") as HTMLFormElement); });
    expect(screen.getByRole("alert")).toHaveTextContent("These details were changed elsewhere. The latest are now showing.");
  });

  it("a field's error clears as she changes it", () => {
    render(<Page />);
    fireEvent.click(screen.getByRole("button", { name: "Edit profile" }));
    fireEvent.click(screen.getByRole("button", { name: "Check" }));
    expect(screen.getByLabelText("Name")).toHaveAttribute("aria-invalid", "true");
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "S" } });
    expect(screen.getByLabelText("Name")).not.toHaveAttribute("aria-invalid");
  });
});

describe("fields, the confirm, the guard, rows", () => {
  it("an invalid field is rose-600 (3:1 and more), not rose-400", () => {
    render(<TextField id="x" label="X" value="" onChange={vi.fn()} error="Wrong" />);
    expect(screen.getByLabelText("X").className).toMatch(/border-rose-600/);
    expect(screen.getByLabelText("X").className).not.toMatch(/rose-400/);
  });

  it("the confirm's buttons follow the focus order: Keep editing first, on top on a phone", () => {
    render(<DiscardChangesDialog open onKeepEditing={vi.fn()} onDiscard={vi.fn()} onClosed={vi.fn()} />);
    const footer = screen.getByRole("button", { name: "Keep editing" }).parentElement as HTMLElement;
    expect(footer.className).toMatch(/\bflex-col\b/);
    expect(footer.className).not.toMatch(/flex-col-reverse/);
  });

  it("a link whose path starts with // is never pushed as another site", () => {
    const Guarded = () => {
      const guard = useUnsavedGuard(true, vi.fn());
      return <div><a href="/.//evil.example/x">odd</a><DiscardChangesDialog open={guard.confirming} onKeepEditing={guard.keepEditing} onDiscard={guard.discard} onClosed={guard.returnFocus} /></div>;
    };
    render(<Guarded />);
    fireEvent.click(screen.getByRole("link", { name: "odd" }), { button: 0 });
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(push).toHaveBeenCalledWith("/evil.example/x");
  });

  it("a row can wrap its value instead of cutting it off", () => {
    render(<SettingsRow label="Email address" value="a-very-long-address@example.test" wrap />);
    const cell = screen.getByText("a-very-long-address@example.test").parentElement as HTMLElement;
    expect(cell.className).toMatch(/break-words/);
    expect(cell.className).not.toMatch(/\btruncate\b/);
  });
});
