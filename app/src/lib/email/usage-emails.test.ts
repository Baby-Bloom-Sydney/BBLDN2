/**
 * The one admin email of the weekly usage check (4e brief step 3; SOP 16, card 7a). BB-LDN-4e-151026.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock("./resend", () => ({ sendEmail: h.send }));

import { sendUsageLowAdminAlert } from "./usage-emails";
import { SENDERS } from "@/lib/constants";

const FAMILIES = [
  {
    parentUserId: "p1",
    name: "Ann <b>Lee</b>",
    email: "ann@example.com",
    children: [
      { childId: "c1", firstName: "Mila", posts: 0 },
      { childId: "c2", firstName: null, posts: 3 },
    ],
  },
];

beforeEach(() => {
  h.send.mockReset();
  h.send.mockResolvedValue({ success: true, messageId: "dry-run" });
});
afterEach(() => vi.unstubAllEnvs());

describe("sendUsageLowAdminAlert", () => {
  it("one email to ADMIN_EMAIL, admin_notification, listing family, children and counts, escaped", async () => {
    vi.stubEnv("ADMIN_EMAIL", "ops@example.com");
    await sendUsageLowAdminAlert(FAMILIES, 7);
    expect(h.send).toHaveBeenCalledTimes(1);
    const mail = h.send.mock.calls[0][0];
    expect(mail.to).toBe("ops@example.com");
    expect(mail.emailType).toBe("admin_notification");
    expect(mail.subject).toContain("1 family");
    expect(mail.html).toContain("ann@example.com");
    expect(mail.html).toContain("Mila: 0");
    expect(mail.html).toContain("(no name): 3");
    expect(mail.html).toContain("&lt;b&gt;Lee&lt;/b&gt;");
    expect(mail.html).not.toContain("<b>Lee</b>");
    expect(mail.html).toContain("/admin/users/p1");
    expect(mail.recipientUserId).toBeUndefined();
  });

  it("falls back to the admin sender when ADMIN_EMAIL is unset", async () => {
    vi.stubEnv("ADMIN_EMAIL", "");
    await sendUsageLowAdminAlert(FAMILIES, 7);
    expect(h.send.mock.calls[0][0].to).toBe(SENDERS.admin);
  });

  it("throws when the send fails, so the caller stamps nothing", async () => {
    h.send.mockResolvedValue({ success: false, error: "boom" });
    await expect(sendUsageLowAdminAlert(FAMILIES, 7)).rejects.toThrow(/boom/);
  });
});
