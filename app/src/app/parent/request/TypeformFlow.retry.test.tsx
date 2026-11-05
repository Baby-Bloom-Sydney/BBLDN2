/**
 * F-7: the in-app position form's save can be retried (`BUILD-ORDER.md` § FIXES F-7; `LEDGER/F07.md`). A save that
 * returns an error, or rejects (a network drop), shows the error and "Try again"; "Try again" saves again, once.
 * One question stands in for the seventeen; the save itself is mocked.
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

// One router object for every render, as Next's `useRouter` gives: a fresh object per render would re-run the save
// effect on any re-render and hide the bug.
const h = vi.hoisted(() => {
  const push = vi.fn();
  return { push, save: vi.fn(), router: { push } };
});
vi.mock("next/navigation", () => ({ useRouter: () => h.router }));
vi.mock("@/lib/actions/parent", () => ({ saveTypeformPosition: h.save }));
vi.mock("./questions", async (original) => ({
  ...(await original<typeof import("./questions")>()),
  INITIAL_FORM_DATA: {},
  QUESTIONS: [{ id: "min_age", type: "single-select", question: "How old should the nanny be?", field: "minimum_age", options: [{ value: "18", label: "18+" }], columns: 2 }],
}));

import { TypeformFlow } from "./TypeformFlow";

const SAVED = { success: true, error: null, positionId: "pos-1" };

beforeEach(() => {
  h.push.mockReset();
  h.save.mockReset();
});

async function finish() {
  const user = userEvent.setup();
  render(<TypeformFlow />);
  await user.click(await screen.findByRole("button", { name: "18+" }, { timeout: 5000 }));
  await waitFor(() => expect(h.save).toHaveBeenCalledTimes(1), { timeout: 3000 });
  return user;
}

describe("TypeformFlow — F-7: a failed save can be retried", () => {
  it("an error, then Try again saves again and goes on", async () => {
    h.save.mockResolvedValueOnce({ success: false, error: "Failed to create position" }).mockResolvedValueOnce(SAVED);
    const user = await finish();
    expect(await screen.findByText("Failed to create position")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Try again" }));

    await waitFor(() => expect(h.save).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(h.push).toHaveBeenCalledWith("/parent"));
  });

  it("a rejected save (network drop) shows the error and Try again, not an endless spinner", async () => {
    h.save.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await finish();

    expect(await screen.findByText("Failed to save position")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
    expect(screen.queryByText("Finalizing your childcare position...")).not.toBeInTheDocument();
  });

  it("after a rejected save, Try again saves again and goes on", async () => {
    h.save.mockRejectedValueOnce(new TypeError("Failed to fetch")).mockResolvedValueOnce(SAVED);
    const user = await finish();
    await user.click(await screen.findByRole("button", { name: "Try again" }));

    await waitFor(() => expect(h.push).toHaveBeenCalledWith("/parent"));
    expect(h.save).toHaveBeenCalledTimes(2);
  });

  it("each Try again is one save, not more", async () => {
    h.save
      .mockResolvedValueOnce({ success: false, error: "Failed to create position" })
      .mockResolvedValueOnce({ success: false, error: "Failed to create position" })
      .mockResolvedValueOnce(SAVED);
    const user = await finish();
    await user.click(await screen.findByRole("button", { name: "Try again" }));
    await waitFor(() => expect(h.save).toHaveBeenCalledTimes(2));
    await user.click(await screen.findByRole("button", { name: "Try again" }));

    await waitFor(() => expect(h.push).toHaveBeenCalledWith("/parent"));
    expect(h.save).toHaveBeenCalledTimes(3);
  });
});
