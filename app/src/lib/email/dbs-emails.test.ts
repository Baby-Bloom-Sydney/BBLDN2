/**
 * Unit 3c (BB-LDN-3c-061026) — the DBS sender module (brief change 11). Placeholder bodies: one plain paragraph,
 * no regulator words from the old ladder; same email types and recipients as the webhook senders they replace.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({ sendEmail: vi.fn(async () => ({ success: true })), info: null as unknown }));
vi.mock("./resend", () => ({ sendEmail: h.sendEmail }));
vi.mock("./helpers", () => ({ getUserEmailInfo: vi.fn(async () => h.info) }));

import { sendDbsManualReviewEmail, sendBarredEmails } from "./dbs-emails";
import { SENDERS } from "@/lib/constants";

type Sent = { to: string; subject: string; html: string; emailType: string; recipientUserId?: string; replyTo?: string };
const sent = () => h.sendEmail.mock.calls.map((c) => (c as unknown as [Sent])[0]);
const OLD_WORDS = /\b(OCG|NSW|WWCC|Working With Children|Children's Guardian|Service NSW)\b/i;

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  h.info = { email: "admin+3c@babybloomsydney.com.au", firstName: "Jane", lastName: "Doe", userId: "u1" };
});

describe("lib/email/dbs-emails", () => {
  it("VER-004-DBS goes to her with the manual-review email type and a placeholder body", async () => {
    await sendDbsManualReviewEmail("u1");
    const [m] = sent();
    expect(m).toMatchObject({ to: "admin+3c@babybloomsydney.com.au", emailType: "verification_pending", recipientUserId: "u1" });
    expect(m.subject).toMatch(/DBS certificate/);
    expect(m.html).not.toMatch(OLD_WORDS);
  });

  it("VER-010 goes to her (reply to hello@) and VER-011 to ADMIN_EMAIL, falling back to SENDERS.admin", async () => {
    await sendBarredEmails("u1");
    const [nanny, admin] = sent();
    expect(nanny).toMatchObject({ to: "admin+3c@babybloomsydney.com.au", emailType: "verification_rejected", recipientUserId: "u1", replyTo: SENDERS.hello });
    expect(admin).toMatchObject({ to: SENDERS.admin, emailType: "admin_notification" });
    for (const m of sent()) expect(m.html).not.toMatch(OLD_WORDS);

    vi.clearAllMocks();
    vi.stubEnv("ADMIN_EMAIL", "ops@example.test");
    await sendBarredEmails("u1");
    expect(sent()[1].to).toBe("ops@example.test");
  });

  it("escapes her name in the HTML", async () => {
    h.info = { email: "a@b.test", firstName: "<b>x</b>", lastName: "&", userId: "u1" };
    await sendBarredEmails("u1");
    for (const m of sent()) expect(m.html).not.toContain("<b>x</b>");
  });

  it("sends nothing when she has no profile", async () => {
    h.info = null;
    await sendDbsManualReviewEmail("u1");
    await sendBarredEmails("u1");
    expect(h.sendEmail).not.toHaveBeenCalled();
  });
});
