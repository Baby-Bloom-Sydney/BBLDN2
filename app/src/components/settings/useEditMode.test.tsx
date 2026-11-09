/**
 * Edit mode's lifecycle (ledger B06 §9.1 R1), the part every editable Settings page shares:
 * - Edit → fields, focus on the first; Cancel discards, focus back on Edit;
 * - a refusal by field: "Please check the details marked below.", each message by its field, focus on the first;
 * - saved: back to view after the refresh, focus on Edit; stale: the latest shows with its message;
 * - no answer in 30 s (or a throw): "We couldn't save that. Please try again.", still editing, the view refreshed;
 * - one save at a time;
 * - the alert goes once no field is marked (coordinator, round 2: walk shot 2 kept it after every field was fixed);
 * - stale: the message comes with the latest, not ahead of it (round 2: the walk's stale shot caught it over the form).
 *
 * BB-wave1-041126/06b3-rework, 2026-11-09.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Suspense, useState } from "react";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));

import { EditNotice } from "./EditNotice";
import { SAVE_WAIT_MS, useEditMode, type SaveOutcome } from "./useEditMode";

let next: () => Promise<SaveOutcome>;

function Page() {
  const mode = useEditMode();
  const [name, setName] = useState("Sophie");
  return (
    <div>
      {mode.editing ? (
        <form ref={mode.formRef} onSubmit={(e) => { e.preventDefault(); void mode.save(() => next()); }}>
          <input aria-label="First name" value={name} onChange={(e) => { mode.clearError("firstName"); setName(e.target.value); }} aria-invalid={mode.errors.firstName ? true : undefined} />
          <input aria-label="Last name" onChange={() => mode.clearError("lastName")} aria-invalid={mode.errors.lastName ? true : undefined} />
          <button type="submit">{mode.saving ? "Saving…" : "Save"}</button>
          <button type="button" onClick={mode.cancel}>Cancel</button>
          <button type="button" onClick={() => mode.refuse({ lastName: "Enter your last name" })}>Check</button>
          <button type="button" onClick={() => mode.refuse({ firstName: "Enter your first name", lastName: "Enter your last name" })}>Check both</button>
        </form>
      ) : (
        <button ref={mode.editRef} onClick={mode.begin}>Edit</button>
      )}
      <EditNotice notice={mode.notice} />
    </div>
  );
}

/** The refreshed page, held back until `release` (as a slow server answer would be): the refresh's transition waits. */
let gate: Promise<void> | null = null;
function Latest({ version }: { readonly version: number }) {
  if (version > 0 && gate) throw gate;
  return <p>Version {version}</p>;
}
function WithRefresh() {
  const [version, setVersion] = useState(0);
  refresh.mockImplementation(() => setVersion((v) => v + 1));
  return (
    <Suspense fallback={<p>Loading</p>}>
      <Latest version={version} />
      <Page />
    </Suspense>
  );
}

beforeEach(() => {
  gate = null;
  refresh.mockReset();
  next = async () => ({ kind: "saved" });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("useEditMode", () => {
  it("Edit puts focus on the first field; Cancel discards and puts it back on Edit", () => {
    render(<Page />);
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.getByLabelText("First name")).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("button", { name: "Edit" })).toHaveFocus();
  });

  it("a page check that refuses: the alert, the field marked, focus on it; nothing called", () => {
    const run = vi.fn();
    next = run;
    render(<Page />);
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.click(screen.getByRole("button", { name: "Check" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Please check the details marked below.");
    expect(screen.getByLabelText("Last name")).toHaveFocus();
    expect(run).not.toHaveBeenCalled();
  });

  it("saved: back to view, the page refreshed, focus on Edit", async () => {
    render(<Page />);
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    await act(async () => { fireEvent.submit(screen.getByLabelText("First name").closest("form") as HTMLFormElement); });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Edit" })).toHaveFocus();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("the server refuses fields: the same as the page's own check", async () => {
    next = async () => ({ kind: "fields", fields: { firstName: "Enter your first name" } });
    render(<Page />);
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    await act(async () => { fireEvent.submit(screen.getByLabelText("First name").closest("form") as HTMLFormElement); });
    expect(screen.getByRole("alert")).toHaveTextContent("Please check the details marked below.");
    expect(screen.getByLabelText("First name")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("First name")).toHaveFocus();
  });

  it("stale: back to view showing the latest, with its message; focus on Edit", async () => {
    next = async () => ({ kind: "stale" });
    render(<Page />);
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    await act(async () => { fireEvent.submit(screen.getByLabelText("First name").closest("form") as HTMLFormElement); });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("alert")).toHaveTextContent("These details were changed elsewhere. The latest are now showing.");
    expect(screen.getByRole("button", { name: "Edit" })).toHaveFocus();
  });

  it("stale: the message comes with the latest, not ahead of it; until then she sees Saving…", async () => {
    let release = () => {};
    gate = new Promise<void>((resolve) => { release = () => { gate = null; resolve(); }; });
    next = async () => ({ kind: "stale" });
    render(<WithRefresh />);
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    await act(async () => { fireEvent.submit(screen.getByLabelText("First name").closest("form") as HTMLFormElement); });
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("button", { name: "Saving…" })).toBeInTheDocument();
    expect(screen.getByText("Version 0")).toBeInTheDocument();
    await act(async () => { release(); await Promise.resolve(); });
    expect(screen.getByText("Version 1")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("These details were changed elsewhere. The latest are now showing.");
    expect(screen.getByRole("button", { name: "Edit" })).toHaveFocus();
  });

  it("a plain refusal: its message, still editing, what she typed kept", async () => {
    next = async () => ({ kind: "refused", message: "Please sign in again, then try once more." });
    render(<Page />);
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText("First name"), { target: { value: "Sophia" } });
    await act(async () => { fireEvent.submit(screen.getByLabelText("First name").closest("form") as HTMLFormElement); });
    expect(screen.getByRole("alert")).toHaveTextContent("Please sign in again, then try once more.");
    expect(screen.getByLabelText("First name")).toHaveValue("Sophia");
  });

  it("no answer in 30 s: the plain message, still editing, the view underneath refreshed", async () => {
    vi.useFakeTimers();
    next = () => new Promise(() => undefined);
    render(<Page />);
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    act(() => { fireEvent.submit(screen.getByLabelText("First name").closest("form") as HTMLFormElement); });
    expect(screen.getByRole("button", { name: "Saving…" })).toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(SAVE_WAIT_MS); });
    expect(screen.getByRole("alert")).toHaveTextContent("We couldn't save that. Please try again.");
    expect(screen.getByLabelText("First name")).toBeInTheDocument();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("a save that throws (offline, a stale deploy): the same plain message", async () => {
    next = async () => { throw new Error("Failed to find Server Action"); };
    render(<Page />);
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    await act(async () => { fireEvent.submit(screen.getByLabelText("First name").closest("form") as HTMLFormElement); });
    expect(screen.getByRole("alert")).toHaveTextContent("We couldn't save that. Please try again.");
  });

  it("the alert goes once no field is marked; it stays while one still is", () => {
    render(<Page />);
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.click(screen.getByRole("button", { name: "Check both" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Please check the details marked below.");
    fireEvent.change(screen.getByLabelText("First name"), { target: { value: "Sophia" } });
    expect(screen.getByRole("alert")).toHaveTextContent("Please check the details marked below.");
    fireEvent.change(screen.getByLabelText("Last name"), { target: { value: "Taylor" } });
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByLabelText("Last name")).not.toHaveAttribute("aria-invalid");
  });

  it("the server's fields: the alert goes with the last mark; a plain refusal stays as she types", async () => {
    next = async () => ({ kind: "fields", fields: { lastName: "Enter your last name" } });
    render(<Page />);
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    await act(async () => { fireEvent.submit(screen.getByLabelText("First name").closest("form") as HTMLFormElement); });
    expect(screen.getByRole("alert")).toHaveTextContent("Please check the details marked below.");
    fireEvent.change(screen.getByLabelText("Last name"), { target: { value: "Taylor" } });
    expect(screen.queryByRole("alert")).toBeNull();
    next = async () => ({ kind: "refused", message: "Your account isn't set up for this yet." });
    await act(async () => { fireEvent.submit(screen.getByLabelText("First name").closest("form") as HTMLFormElement); });
    fireEvent.change(screen.getByLabelText("First name"), { target: { value: "Sophia" } });
    expect(screen.getByRole("alert")).toHaveTextContent("Your account isn't set up for this yet.");
  });

  it("a server refusal by field with no field named keeps its alert (nothing was fixed)", async () => {
    next = async () => ({ kind: "fields", fields: {} });
    render(<Page />);
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    await act(async () => { fireEvent.submit(screen.getByLabelText("First name").closest("form") as HTMLFormElement); });
    expect(screen.getByRole("alert")).toHaveTextContent("Please check the details marked below.");
  });

  it("one save at a time: a second Save while one is in flight runs nothing", async () => {
    let resolve: (o: SaveOutcome) => void = () => undefined;
    const run = vi.fn(() => new Promise<SaveOutcome>((r) => { resolve = r; }));
    next = run;
    render(<Page />);
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    const form = screen.getByLabelText("First name").closest("form") as HTMLFormElement;
    act(() => { fireEvent.submit(form); fireEvent.submit(form); });
    expect(run).toHaveBeenCalledTimes(1);
    await act(async () => { resolve({ kind: "saved" }); });
  });
});
