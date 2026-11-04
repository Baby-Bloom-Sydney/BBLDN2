/**
 * The in-app position flow's last step (04b rework W8; brief 04 §0a.3, place 2): after the save it goes to the
 * server's `redirectTo` (her Childcare tab with the call popup, while call booking is on), else `/parent` as today.
 * One question stands in for the seventeen; the save itself is mocked.
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ push: vi.fn(), save: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: h.push }) }));
vi.mock("@/lib/actions/parent", () => ({ saveTypeformPosition: h.save }));
vi.mock("./questions", async (original) => ({
  ...(await original<typeof import("./questions")>()),
  INITIAL_FORM_DATA: {},
  QUESTIONS: [{ id: "min_age", type: "single-select", question: "How old should the nanny be?", field: "minimum_age", options: [{ value: "18", label: "18+" }], columns: 2 }],
}));

import { TypeformFlow } from "./TypeformFlow";

beforeEach(() => {
  h.push.mockReset();
  h.save.mockReset();
});

async function finish() {
  const user = userEvent.setup();
  render(<TypeformFlow />);
  await user.click(await screen.findByRole("button", { name: "18+" }, { timeout: 2000 }));
  await waitFor(() => expect(h.save).toHaveBeenCalled(), { timeout: 3000 });
}

describe("TypeformFlow — where she goes after the save", () => {
  it("the server's redirectTo (the Childcare tab with the call popup)", async () => {
    h.save.mockResolvedValue({ success: true, error: null, positionId: "pos-1", redirectTo: "/parent?t=childcare&call=open" });
    await finish();
    await waitFor(() => expect(h.push).toHaveBeenCalledWith("/parent?t=childcare&call=open"));
  });

  it("no redirectTo → /parent, as today", async () => {
    h.save.mockResolvedValue({ success: true, error: null, positionId: "pos-1" });
    await finish();
    await waitFor(() => expect(h.push).toHaveBeenCalledWith("/parent"));
  });
});
