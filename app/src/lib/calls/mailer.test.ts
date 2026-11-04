/**
 * mailer.ts (plan B1/B2): parent mail to her address with her user id, admin mail to ADMIN_EMAIL (else
 * SENDERS.admin); both from DEFAULT_FROM with replies to SENDERS.hello; answers whether it went; never throws.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { SENDERS } from "@/lib/constants";
import { DEFAULT_FROM } from "@/lib/email/resend";
import { firstNameOf, mailAdmin, mailParent, parentNameOf, type CallEmailSend } from "./mailer";

const JANE = { userId: "u-1", firstName: " Jane ", lastName: "Smith", email: "jane@example.com", mobile: null, isTestUser: false };
const TEMPLATE = { subject: "S", html: "<p>H</p>" };
const ok = () => vi.fn<CallEmailSend>(async () => ({ success: true }));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("names", () => {
  it("joins the parts, trimmed; '(no name)' / 'there' when empty", () => {
    expect(parentNameOf(JANE)).toBe("Jane Smith");
    expect(parentNameOf({ firstName: " ", lastName: "" })).toBe("(no name)");
    expect(firstNameOf(JANE)).toBe("Jane");
    expect(firstNameOf({ firstName: "" })).toBe("there");
  });
});

describe("mailParent / mailAdmin", () => {
  it("parent: to her, her user id, from DEFAULT_FROM, reply-to hello", async () => {
    const send = ok();
    expect(await mailParent(send, JANE, TEMPLATE, "call_reminder")).toBe(true);
    expect(send).toHaveBeenCalledWith({
      to: "jane@example.com",
      subject: "S",
      html: "<p>H</p>",
      from: DEFAULT_FROM,
      replyTo: SENDERS.hello,
      emailType: "call_reminder",
      recipientUserId: "u-1",
    });
  });

  it("admin: ADMIN_EMAIL, else SENDERS.admin; no user id", async () => {
    const send = ok();
    vi.stubEnv("ADMIN_EMAIL", "ops@example.test");
    await mailAdmin(send, TEMPLATE, "admin_call_reminder");
    vi.stubEnv("ADMIN_EMAIL", "");
    await mailAdmin(send, TEMPLATE, "admin_call_reminder");
    expect(send.mock.calls.map(([m]) => m.to)).toEqual(["ops@example.test", SENDERS.admin]);
    expect(send.mock.calls[0][0].recipientUserId).toBeUndefined();
  });

  it("a failed or throwing send answers false and logs no address", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const failed = vi.fn<CallEmailSend>(async () => ({ success: false, error: "bad jane@example.com" }));
    const thrown = vi.fn<CallEmailSend>(async () => {
      throw new Error("jane@example.com");
    });
    const notError = vi.fn<CallEmailSend>(async () => {
      throw "jane@example.com";
    });
    expect(await mailParent(failed, JANE, TEMPLATE, "t")).toBe(false);
    expect(await mailParent(thrown, JANE, TEMPLATE, "t")).toBe(false);
    expect(await mailAdmin(notError, TEMPLATE, "t")).toBe(false);
    expect(JSON.stringify(log.mock.calls)).not.toContain("jane@example.com");
  });
});
