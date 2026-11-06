/**
 * Call settings (plan C5; brief §3 admin 5, §0a.13): the call length is a choice of 15 / 20 / 30 / 45 / 60 minutes
 * only (a native <select> styled as the input), then notice, hold and the caller number. The values go to the server
 * as typed; the server checks them (and refuses a length off the list). One write per press.
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const nav = vi.hoisted(() => ({ refresh: vi.fn() }));
const actions = vi.hoisted(() => ({ saveCallSettingsAction: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => nav }));
vi.mock("./actions", () => actions);

import { CALL_SETTINGS_DEFAULTS } from "@/lib/calls/settings";
import { CallSettingsForm } from "./CallSettingsForm";

beforeEach(() => {
  nav.refresh.mockReset();
  actions.saveCallSettingsAction.mockReset();
  actions.saveCallSettingsAction.mockResolvedValue({ ok: true, value: true });
});

const length = () => screen.getByLabelText("Call length") as HTMLSelectElement;
const save = () => screen.getByRole("button", { name: "Save settings" });

describe("CallSettingsForm", () => {
  it("call length offers exactly 15, 20, 30, 45 and 60 minutes, the stored one chosen; then notice, hold, caller number", () => {
    render(<CallSettingsForm settings={CALL_SETTINGS_DEFAULTS} />);
    expect(screen.getByRole("heading", { level: 2, name: "Call settings" })).toBeInTheDocument();
    expect(within(length()).getAllByRole("option").map((o) => o.textContent)).toEqual(["15 minutes", "20 minutes", "30 minutes", "45 minutes", "60 minutes"]);
    expect(length().value).toBe("30");
    expect(screen.getByLabelText("Notice (minutes)")).toHaveValue(120);
    expect(screen.getByLabelText("Hold (minutes)")).toHaveValue(5);
    expect(screen.getByLabelText("Caller number shown in emails")).toHaveValue("");
  });

  it("45 → Save: the strings as typed go to the server; 'Saved.'; the page refreshed", async () => {
    render(<CallSettingsForm settings={{ ...CALL_SETTINGS_DEFAULTS, callerNumber: "+442079460000" }} />);
    fireEvent.change(length(), { target: { value: "45" } });
    fireEvent.change(screen.getByLabelText("Notice (minutes)"), { target: { value: "60" } });
    fireEvent.click(save());
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Saved."));
    expect(actions.saveCallSettingsAction).toHaveBeenCalledWith({ slotMinutes: "45", noticeMinutes: "60", holdMinutes: "5", callerNumber: "+442079460000" });
    expect(nav.refresh).toHaveBeenCalled();
  });

  it("a stored length off the list (25, set outside the app) shows as itself, not as 15", () => {
    render(<CallSettingsForm settings={{ ...CALL_SETTINGS_DEFAULTS, slotMinutes: 25 }} />);
    expect(length().value).toBe("25");
    expect(within(length()).getAllByRole("option").map((o) => o.textContent)).toContain("25 minutes (not on the list)");
  });

  it("the server refuses → the settings line (it names the fixed lengths); nothing refreshed", async () => {
    actions.saveCallSettingsAction.mockResolvedValue({ ok: false, error: "invalid" });
    render(<CallSettingsForm settings={{ ...CALL_SETTINGS_DEFAULTS, slotMinutes: 25 }} />);
    fireEvent.click(save());
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/15, 20, 30, 45 or 60 minutes/));
    expect(nav.refresh).not.toHaveBeenCalled();
  });

  it("a double click sends one save; while it saves the button says so and stays focusable (aria-disabled, review M4)", async () => {
    let finish: (v: unknown) => void = () => {};
    actions.saveCallSettingsAction.mockReturnValue(new Promise((r) => (finish = r)));
    render(<CallSettingsForm settings={CALL_SETTINGS_DEFAULTS} />);
    const button = save();
    fireEvent.click(button);
    fireEvent.click(button);
    expect(actions.saveCallSettingsAction).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.getByRole("button", { name: "Saving…" })).toHaveAttribute("aria-disabled", "true"));
    expect(screen.getByRole("button", { name: "Saving…" })).toBeEnabled();
    finish({ ok: true, value: true });
    await waitFor(() => expect(save()).not.toHaveAttribute("aria-disabled", "true"));
  });
});

describe("CallSettingsForm — review round 1 (04c-2: the form's limits are the server's)", () => {
  it("notice 0–10080 and hold 1–60, from calendar-limits", () => {
    render(<CallSettingsForm settings={CALL_SETTINGS_DEFAULTS} />);
    expect(screen.getByLabelText("Notice (minutes)")).toHaveAttribute("min", "0");
    expect(screen.getByLabelText("Notice (minutes)")).toHaveAttribute("max", "10080");
    expect(screen.getByLabelText("Hold (minutes)")).toHaveAttribute("min", "1");
    expect(screen.getByLabelText("Hold (minutes)")).toHaveAttribute("max", "60");
  });
});
