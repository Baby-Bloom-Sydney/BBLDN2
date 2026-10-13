/**
 * Unit 3c (BB-LDN-3c-061026) — the DBS sender module (brief change 11). Placeholder bodies: one plain paragraph;
 * same email types and recipients as the webhook senders they replace. That no old-ladder word survives in the module
 * is the london-sweep gate's job (it scans this file), not a literal list here (LEDGER/2-0 §8(3)).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({ sendEmail: vi.fn(async () => ({ success: true })), info: null as unknown }));
vi.mock("./resend", () => ({ sendEmail: h.sendEmail }));
vi.mock("./helpers", () => ({ getUserEmailInfo: vi.fn(async () => h.info) }));

import { sendDbsManualReviewEmail, sendBarredNannyEmail, sendBarredAdminAlert, sendDbsRejectedEmail } from "./dbs-emails";
import type { AffectedFamily } from "@/lib/connections/silent-hold";
import { SENDERS } from "@/lib/constants";

type Sent = { to: string; subject: string; html: string; emailType: string; recipientUserId?: string; replyTo?: string };
const sent = () => h.sendEmail.mock.calls.map((c) => (c as unknown as [Sent])[0]);

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  h.info = { email: "jane.doe@example.test", firstName: "Jane", lastName: "Doe", userId: "u1" };
});

describe("lib/email/dbs-emails", () => {
  it("VER-004-DBS goes to her with the manual-review email type and a placeholder body", async () => {
    await sendDbsManualReviewEmail("u1");
    const [m] = sent();
    expect(m).toMatchObject({ to: "jane.doe@example.test", emailType: "verification_pending", recipientUserId: "u1" });
    expect(m.subject).toMatch(/DBS certificate/);
    expect(m.html).toContain("24–48 hours");
  });

  // Unit 3d (BB-LDN-3d-141026, README P-14): VER-010 (her) and VER-011 (admin) are separate senders — the sync's barred
  // branch sends VER-011 once per bar, with the families to contact; the admin Bar action sends VER-010.
  it("VER-010 goes to her only (reply to hello@)", async () => {
    await sendBarredNannyEmail("u1");
    expect(sent()).toHaveLength(1);
    expect(sent()[0]).toMatchObject({ to: "jane.doe@example.test", emailType: "verification_rejected", recipientUserId: "u1", replyTo: SENDERS.hello });
    expect(sent()[0].html).toMatch(/DBS certificate/);
  });

  it("VER-011 goes to ADMIN_EMAIL, falling back to SENDERS.admin", async () => {
    await sendBarredAdminAlert("u1", [], 0);
    expect(sent()).toHaveLength(1);
    expect(sent()[0]).toMatchObject({ to: SENDERS.admin, emailType: "admin_notification" });
    vi.clearAllMocks();
    vi.stubEnv("ADMIN_EMAIL", "ops@example.test");
    await sendBarredAdminAlert("u1", [], 0);
    expect(sent()[0].to).toBe("ops@example.test");
  });

  it("P-14 VER-011 lists every affected family — name, email, phone, position, stage — so the team can contact them", async () => {
    const families: AffectedFamily[] = [
      { connectionId: "c40", parentName: "Olivia Hartley", email: "olivia.hartley@example.test", phone: "07700 900123",
        positionId: "pos1", positionTitle: "After-school nanny", stage: 40 },
      { connectionId: "c20", parentName: "James Okafor", email: "james.okafor@example.test", phone: null,
        positionId: null, positionTitle: null, stage: 20 },
    ];
    await sendBarredAdminAlert("u1", families, 1);
    const [m] = sent();
    for (const s of ["Olivia Hartley", "olivia.hartley@example.test", "07700 900123", "After-school nanny", "pos1",
      "James Okafor", "james.okafor@example.test"]) expect(m.html).toContain(s);
    expect(m.html).toMatch(/Active \(40\)/);
    expect(m.html).toMatch(/Meet Scheduled \(20\)/);
    expect(m.subject).toMatch(/2 famil/);
    expect(m.html).toMatch(/1 held/);
  });

  it("P-14 VER-011 flags rows that could NOT be dropped, so admin checks them by hand", async () => {
    await sendBarredAdminAlert("u1", [], 0, [
      { connectionId: "c33", parentName: "Priya Shah", email: "priya.shah@example.test", phone: null, positionId: null, positionTitle: null, stage: 33 },
    ]);
    const [m] = sent();
    expect(m.html).toMatch(/could NOT be dropped/);
    expect(m.html).toContain("Priya Shah");
    expect(m.html).not.toMatch(/No families were affected/);
  });

  it("the subject strips line breaks from her name (security L3)", async () => {
    h.info = { email: "a@b.test", firstName: "Jane\r\nBcc: x@y.test", lastName: "Doe", userId: "u1" };
    await sendBarredAdminAlert("u1", [], 0);
    expect(sent()[0].subject).not.toMatch(/[\r\n]/);
  });

  it("P-14 VER-011 says so when no family was affected", async () => {
    await sendBarredAdminAlert("u1", [], 0);
    expect(sent()[0].html).toMatch(/No families were affected/);
  });

  it("escapes her name and every family field in the HTML", async () => {
    h.info = { email: "a@b.test", firstName: "<b>x</b>", lastName: "&", userId: "u1" };
    const evil = "<script>alert(1)</script>";
    await sendBarredNannyEmail("u1");
    await sendBarredAdminAlert("u1", [
      { connectionId: "c", parentName: evil, email: evil, phone: evil, positionId: evil, positionTitle: evil, stage: 40 },
    ], 0);
    for (const m of sent()) {
      expect(m.html).not.toContain("<b>x</b>");
      expect(m.html).not.toContain("<script>");
    }
  });

  it("VER-011 throws when the send fails, so the caller can log it", async () => {
    h.sendEmail.mockResolvedValueOnce({ success: false, error: "down" } as never);
    await expect(sendBarredAdminAlert("u1", [], 0)).rejects.toThrow(/down/);
  });

  it("sends nothing when she has no profile", async () => {
    h.info = null;
    await sendDbsManualReviewEmail("u1");
    await sendBarredNannyEmail("u1");
    expect(h.sendEmail).not.toHaveBeenCalled();
  });

  it("VER-011 still goes to admin when her profile is missing (the families matter more than her name)", async () => {
    h.info = null;
    await sendBarredAdminAlert("u1", [], 0);
    expect(sent()).toHaveLength(1);
    expect(sent()[0].html).toContain("u1");
  });

  // Unit 3d (BB-LDN-3d-061026, README P-4)
  it("P-4 reject email goes to her with the reason escaped, the two next steps and a link to her verification page", async () => {
    await sendDbsRejectedEmail("u1", "Surname <b>differs</b>");
    const [m] = sent();
    expect(m).toMatchObject({ to: "jane.doe@example.test", emailType: "verification_rejected", recipientUserId: "u1", replyTo: SENDERS.hello });
    expect(m.html).toContain("Surname &lt;b&gt;differs&lt;/b&gt;");
    expect(m.html).toMatch(/Edit &amp; Resubmit|Edit & Resubmit/);
    expect(m.html).toMatch(/manual review/);
    expect(m.html).toContain("/nanny/verification");
  });

  it("P-4 reject email throws when the send fails, so the caller can warn", async () => {
    h.sendEmail.mockResolvedValueOnce({ success: false, error: "down" } as never);
    await expect(sendDbsRejectedEmail("u1", "r")).rejects.toThrow(/down/);
  });
});

