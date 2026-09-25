/**
 * Render proof for unit 2b (12.02) — the snooze anchor.
 *
 * `/admin/leads` is admin-gated, so the browser proof for the `Next action`
 * snooze is this render instead (04 §0, proof 3). What it pins is the thing
 * the old hardcoded offset got wrong: the anchor must be 09:00 **London**
 * wall-clock, which is a different UTC instant in winter than in summer.
 *
 * A fixed offset cannot satisfy both rows below; `localToUTC` on `APP_TZ` can.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { LeadDetail } from "@/lib/leads/fetch-lead-detail";

const setNextAction = vi.fn(async () => ({ success: true, error: null }));
const logContact = vi.fn(async () => ({ success: true, error: null }));

vi.mock("./actions", () => ({
  logContact: (...args: unknown[]) => logContact(...(args as [])),
  setNextAction: (...args: unknown[]) => setNextAction(...(args as [])),
}));

const { LeadDrawerLogContactForm } = await import("./LeadDrawerLogContactForm");

const detail = {
  nanny_user_id: "00000000-0000-0000-0000-0000000000aa",
  contact_state: null,
} as unknown as LeadDetail;

async function snoozeTo(date: string): Promise<string> {
  const user = userEvent.setup();
  render(
    <LeadDrawerLogContactForm detail={detail} onLocalPatch={() => {}} />,
  );
  const dateInput = document.querySelector(
    'input[type="date"]',
  ) as HTMLInputElement;
  await user.type(dateInput, date);
  await user.click(screen.getByRole("button", { name: /log contact/i }));
  expect(setNextAction).toHaveBeenCalledOnce();
  const arg = setNextAction.mock.calls[0][0] as { next_action_at: string };
  return arg.next_action_at;
}

describe("LeadDrawerLogContactForm — snooze anchor (12.02)", () => {
  beforeEach(() => {
    setNextAction.mockClear();
    logContact.mockClear();
  });

  it("anchors a summer (BST, UTC+1) follow-up to 08:00Z = 09:00 London", async () => {
    // 2026-06-22 is inside British Summer Time.
    expect(await snoozeTo("2026-06-22")).toBe("2026-06-22T08:00:00.000Z");
  });

  it("anchors a winter (GMT, UTC+0) follow-up to 09:00Z = 09:00 London", async () => {
    // 2026-12-22 is outside British Summer Time.
    expect(await snoozeTo("2026-12-22")).toBe("2026-12-22T09:00:00.000Z");
  });
});
