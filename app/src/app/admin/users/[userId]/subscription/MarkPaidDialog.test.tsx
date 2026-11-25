/**
 * Mark deposit paid (bank transfer) — the dialog (plan 03 row B3; brief 03 §0.7, §3 Admin 5; D10). The cohort target
 * (goodwill only when offered), a required note (1–500 once trimmed), Confirm. A refusal stays in the dialog with its
 * plain line and nothing is recorded; done → the dialog closes and the page refreshes. B2's action is mocked.
 *
 * BB-wave2-231126/03-build, 2026-11-25.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const actions = vi.hoisted(() => ({ markDepositPaid: vi.fn() }));
const refresh = vi.hoisted(() => vi.fn());
vi.mock("./deposit-actions", () => actions);
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

import type { PanelCohorts } from "@/lib/deposit/panel";
import { MarkPaidDialog } from "./MarkPaidDialog";

const PARENT = "b0300000-0000-4000-8000-000000000001";
const CURRENT = Object.freeze({ start: "2027-02-01", places: 5, taken: 5, beingPaid: 0, left: 0, overBy: 0 });
const NEXT = Object.freeze({ start: "2027-02-08", places: 5, taken: 0, beingPaid: 0, left: 5, overBy: 0 });
const NO_GOODWILL: PanelCohorts = { current: CURRENT, next: NEXT, canOfferGoodwill: false };
const GOODWILL: PanelCohorts = { current: CURRENT, next: NEXT, canOfferGoodwill: true };

beforeEach(() => {
  actions.markDepositPaid.mockReset();
  refresh.mockReset();
});

async function openDialog(cohorts: PanelCohorts = NO_GOODWILL) {
  render(<MarkPaidDialog parentUserId={PARENT} cohorts={cohorts} disabled={false} />);
  await userEvent.click(screen.getByRole("button", { name: "Mark deposit paid (bank transfer)" }));
  return within(await screen.findByRole("dialog"));
}

describe("Mark deposit paid (bank transfer)", () => {
  it("the dialog scrolls inside a short screen (03b review React L4)", async () => {
    await openDialog();
    expect(screen.getByRole("dialog")).toHaveClass("max-w-md", "max-h-[90vh]", "overflow-y-auto");
  });

  it("the trigger follows the block's pending state", () => {
    render(<MarkPaidDialog parentUserId={PARENT} cohorts={NO_GOODWILL} disabled />);
    expect(screen.getByRole("button", { name: "Mark deposit paid (bank transfer)" })).toBeDisabled();
  });

  it("Confirm needs a note: empty or spaces → disabled; the note box takes at most 500", async () => {
    const dialog = await openDialog();
    const confirm = dialog.getByRole("button", { name: "Confirm" });
    const note = dialog.getByRole("textbox", { name: "Note" });
    expect(note).toBeRequired();
    expect(note).toHaveAttribute("maxLength", "500");
    expect(confirm).toBeDisabled();
    await userEvent.type(note, "   ");
    expect(confirm).toBeDisabled();
    await userEvent.type(note, "transfer ref JONES");
    expect(confirm).toBeEnabled();
  });

  it("no goodwill offered: no choice; Confirm → current, the trimmed note; done → closes and refreshes", async () => {
    actions.markDepositPaid.mockResolvedValue({ ok: true });
    const dialog = await openDialog();
    expect(dialog.queryByRole("radio")).toBeNull();
    await userEvent.type(dialog.getByRole("textbox", { name: "Note" }), "  transfer ref JONES  ");
    await userEvent.click(dialog.getByRole("button", { name: "Confirm" }));
    expect(actions.markDepositPaid).toHaveBeenCalledWith(PARENT, { target: "current", note: "transfer ref JONES" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("goodwill offered: the choice, current by default; goodwill picked → sent as goodwill", async () => {
    actions.markDepositPaid.mockResolvedValue({ ok: true });
    const dialog = await openDialog(GOODWILL);
    expect(dialog.getByRole("radio", { name: "Current cohort" })).toBeChecked();
    await userEvent.click(dialog.getByRole("radio", { name: "Next cohort, goodwill (Mon 8 Feb · 5 left)" }));
    await userEvent.type(dialog.getByRole("textbox", { name: "Note" }), "ref 1");
    await userEvent.click(dialog.getByRole("button", { name: "Confirm" }));
    expect(actions.markDepositPaid).toHaveBeenCalledWith(PARENT, { target: "goodwill", note: "ref 1" });
  });

  it.each([
    ["cohort_full", "This cohort is full"],
    ["already_paid", "The deposit is already paid."],
    ["being_paid", "The last place is being paid for right now. Try again later."],
    ["something_new", "Something went wrong. Try again."],
  ])("refused (%s) → %s in role=alert; the dialog stays, nothing refreshed", async (error, line) => {
    actions.markDepositPaid.mockResolvedValue({ ok: false, error });
    const dialog = await openDialog();
    await userEvent.type(dialog.getByRole("textbox", { name: "Note" }), "ref");
    await userEvent.click(dialog.getByRole("button", { name: "Confirm" }));
    expect(await dialog.findByRole("alert")).toHaveTextContent(line);
    expect(dialog.getByRole("alert")).toHaveClass("text-amber-700");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("disabled while pending, and can't be closed mid-request; a throw → the generic line", async () => {
    let reject: (e: unknown) => void = () => undefined;
    actions.markDepositPaid.mockReturnValue(new Promise((_r, j) => (reject = j)));
    const dialog = await openDialog();
    await userEvent.type(dialog.getByRole("textbox", { name: "Note" }), "ref");
    await userEvent.click(dialog.getByRole("button", { name: "Confirm" }));
    expect(dialog.getByRole("button", { name: "Confirm" })).toBeDisabled();
    expect(dialog.getByRole("button", { name: "Back" })).toBeDisabled();
    await userEvent.keyboard("{Escape}");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    reject(new Error("offline"));
    expect(await dialog.findByRole("alert")).toHaveTextContent("Something went wrong. Try again.");
    expect(actions.markDepositPaid).toHaveBeenCalledTimes(1);
  });

  it("Back closes without recording, and a reopened dialog starts empty", async () => {
    const dialog = await openDialog();
    await userEvent.type(dialog.getByRole("textbox", { name: "Note" }), "ref");
    await userEvent.click(dialog.getByRole("button", { name: "Back" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(actions.markDepositPaid).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Mark deposit paid (bank transfer)" }));
    expect(within(await screen.findByRole("dialog")).getByRole("textbox", { name: "Note" })).toHaveValue("");
  });
});
