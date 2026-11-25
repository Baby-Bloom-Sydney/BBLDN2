/**
 * Record refund (bank transfer) — the dialog (plan 03 row B3; brief 03 §0.8, §3 Admin 6): a required reason (3–500
 * once trimmed), Confirm. A refusal stays in the dialog with its plain line; done → closes and refreshes. B2's
 * action is mocked.
 *
 * BB-wave2-231126/03-build, 2026-11-25.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const actions = vi.hoisted(() => ({ recordDepositBankRefund: vi.fn() }));
const refresh = vi.hoisted(() => vi.fn());
vi.mock("./deposit-actions", () => actions);
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

import { BankRefundDialog } from "./BankRefundDialog";

const PARENT = "b0300000-0000-4000-8000-000000000001";

beforeEach(() => {
  actions.recordDepositBankRefund.mockReset();
  refresh.mockReset();
});

async function openDialog() {
  render(<BankRefundDialog parentUserId={PARENT} disabled={false} />);
  await userEvent.click(screen.getByRole("button", { name: "Record refund (bank transfer)" }));
  return within(await screen.findByRole("dialog"));
}

describe("Record refund (bank transfer)", () => {
  it("the dialog scrolls inside a short screen (03b review React L4)", async () => {
    await openDialog();
    expect(screen.getByRole("dialog")).toHaveClass("max-w-md", "max-h-[90vh]", "overflow-y-auto");
  });

  it("the title leaves room for the close button at 320 px (03b proof finding)", async () => {
    await openDialog();
    expect(screen.getByRole("heading", { name: "Record refund (bank transfer)" })).toHaveClass("pr-8");
  });

  it("the trigger follows the block's pending state", () => {
    render(<BankRefundDialog parentUserId={PARENT} disabled />);
    expect(screen.getByRole("button", { name: "Record refund (bank transfer)" })).toBeDisabled();
  });

  it("Confirm needs a reason of at least 3 characters once trimmed; at most 500", async () => {
    const dialog = await openDialog();
    const reason = dialog.getByRole("textbox", { name: "Reason" });
    const confirm = dialog.getByRole("button", { name: "Confirm" });
    expect(reason).toBeRequired();
    expect(reason).toHaveAttribute("maxLength", "500");
    expect(confirm).toBeDisabled();
    await userEvent.type(reason, "  ab  ");
    expect(confirm).toBeDisabled();
    await userEvent.clear(reason);
    await userEvent.type(reason, "abc");
    expect(confirm).toBeEnabled();
  });

  it("Confirm → the trimmed reason; done → closes and refreshes", async () => {
    actions.recordDepositBankRefund.mockResolvedValue({ ok: true });
    const dialog = await openDialog();
    await userEvent.type(dialog.getByRole("textbox", { name: "Reason" }), " She chose not to go ahead ");
    await userEvent.click(dialog.getByRole("button", { name: "Confirm" }));
    expect(actions.recordDepositBankRefund).toHaveBeenCalledWith(PARENT, { reason: "She chose not to go ahead" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["not_bank_transfer", "This deposit wasn't paid by bank transfer."],
    ["already_refunded", "The deposit is already refunded."],
    ["error", "Something went wrong. Try again."],
  ])("refused (%s) → %s in role=alert; the dialog stays", async (error, line) => {
    actions.recordDepositBankRefund.mockResolvedValue({ ok: false, error });
    const dialog = await openDialog();
    await userEvent.type(dialog.getByRole("textbox", { name: "Reason" }), "reason");
    await userEvent.click(dialog.getByRole("button", { name: "Confirm" }));
    expect(await dialog.findByRole("alert")).toHaveTextContent(line);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("Back closes without recording", async () => {
    const dialog = await openDialog();
    await userEvent.type(dialog.getByRole("textbox", { name: "Reason" }), "reason");
    await userEvent.click(dialog.getByRole("button", { name: "Back" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(actions.recordDepositBankRefund).not.toHaveBeenCalled();
  });

  it("disabled while pending", async () => {
    let resolve: (v: unknown) => void = () => undefined;
    actions.recordDepositBankRefund.mockReturnValue(new Promise((r) => (resolve = r)));
    const dialog = await openDialog();
    await userEvent.type(dialog.getByRole("textbox", { name: "Reason" }), "reason");
    await userEvent.click(dialog.getByRole("button", { name: "Confirm" }));
    expect(dialog.getByRole("button", { name: "Confirm" })).toBeDisabled();
    resolve({ ok: true });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});
