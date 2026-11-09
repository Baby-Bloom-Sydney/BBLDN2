/**
 * Leaving with unsaved changes (ledger B06 §9.1 R1): a link inside the app asks first — "Discard your changes?"
 * (Keep editing / Discard); reloading or closing the tab gets the browser's own prompt. Nothing asks when nothing
 * changed, for a new tab, or for a link to where she already is.
 *
 * BB-wave1-041126/06b3-rework, 2026-11-09.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }));

import { DiscardChangesDialog } from "./DiscardChangesDialog";
import { useUnsavedGuard } from "./useUnsavedGuard";

const onDiscard = vi.fn();

function Page({ dirty }: { readonly dirty: boolean }) {
  const guard = useUnsavedGuard(dirty, onDiscard);
  return (
    <div>
      <a href="/nanny/settings?s=contact">Contact details</a>
      <a href="/nanny/settings?s=contact" target="_blank" rel="noreferrer">In a new tab</a>
      <a href={`${window.location.pathname}${window.location.search}`}>Here</a>
      <DiscardChangesDialog open={guard.confirming} onKeepEditing={guard.keepEditing} onDiscard={guard.discard} onClosed={guard.returnFocus} />
    </div>
  );
}

beforeEach(() => {
  push.mockReset();
  onDiscard.mockReset();
});
afterEach(cleanup);

const click = (name: string) => fireEvent.click(screen.getByRole("link", { name }), { button: 0 });

describe("useUnsavedGuard — links inside the app", () => {
  it("unchanged: a link goes straight through", () => {
    render(<Page dirty={false} />);
    click("Contact details");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("changed: the confirm asks first; Keep editing stays, focus back on the link", async () => {
    render(<Page dirty />);
    click("Contact details");
    const dialog = screen.getByRole("dialog", { name: "Discard your changes?" });
    expect(dialog).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Keep editing" })).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(push).not.toHaveBeenCalled();
    expect(onDiscard).not.toHaveBeenCalled();
    // Radix gives focus back once the dialog has closed (a timeout of its own)
    await waitFor(() => expect(screen.getByRole("link", { name: "Contact details" })).toHaveFocus());
  });

  it("changed: Discard drops the changes and goes where she clicked", () => {
    render(<Page dirty />);
    click("Contact details");
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(onDiscard).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledWith("/nanny/settings?s=contact");
  });

  it("a new tab, a modified click, or a link to where she is: no confirm", () => {
    render(<Page dirty />);
    click("In a new tab");
    fireEvent.click(screen.getByRole("link", { name: "Contact details" }), { button: 0, metaKey: true });
    click("Here");
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("useUnsavedGuard — reload or close", () => {
  it("changed: the browser's own prompt; unchanged: none", () => {
    const { rerender } = render(<Page dirty />);
    const asked = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(asked);
    expect(asked.defaultPrevented).toBe(true);
    rerender(<Page dirty={false} />);
    const quiet = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(quiet);
    expect(quiet.defaultPrevented).toBe(false);
  });
});
