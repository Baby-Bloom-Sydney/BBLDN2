/**
 * The Settings actions' replies (b3.1): a refusal carries its code and one fixed, plain message — never the
 * database's words, never what she typed. BB-wave1-041126/06b3-build, 2026-11-07.
 */
import { describe, expect, it } from "vitest";
import { ACTION_MESSAGES, actionRefusal, fieldsRefusal } from "./messages";

describe("actionRefusal", () => {
  it.each([
    ["invoices_disabled", "This isn't available right now."],
    ["signed_out", "Please sign in again, then try once more."],
    ["invalid", "Please check the details and try again."],
    ["busy", "Your details are being saved elsewhere — try again in a moment."],
    ["nanny_inactive", "Your account isn't active, so this can't be saved. Please contact us."],
    ["error", "We couldn't save that. Please try again."],
    ["stale", "These details were changed elsewhere. The latest are now showing."],
  ] as const)("%s → %s", (code, message) => {
    expect(actionRefusal(code)).toEqual({ ok: false, error: code, message });
  });

  it("any other code gets the general message, so no reply is ever without words", () => {
    expect(actionRefusal("cap")).toEqual({ ok: false, error: "cap", message: ACTION_MESSAGES.error });
  });

  it("a refusal by field: the shared 'marked below' message and each field's own (06b-3 rework)", () => {
    expect(fieldsRefusal({ sortCode: "Enter a 6-digit sort code" })).toEqual({
      ok: false, error: "invalid", message: "Please check the details marked below.", fields: { sortCode: "Enter a 6-digit sort code" },
    });
  });

  it("is frozen", () => {
    expect(Object.isFrozen(actionRefusal("busy"))).toBe(true);
    expect(Object.isFrozen(ACTION_MESSAGES)).toBe(true);
  });
});
