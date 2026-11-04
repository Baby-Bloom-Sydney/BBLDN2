/**
 * notify.ts (plan A7, B1): an injectable sender. A sender that fails is logged and swallowed — an email failure
 * never undoes or fails a booking. 04b wires the templates: booked → `call_booking_confirmation` (+
 * `admin_call_booked` when the parent booked it herself), moved → `call_booking_changed`, cancelled →
 * `call_booking_cancelled`; from `DEFAULT_FROM`, reply-to `SENDERS.hello`, `recipientUserId` set; admin mail to
 * `ADMIN_EMAIL`, else `SENDERS.admin`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SENDERS } from "@/lib/constants";
import { fakeAdmin } from "@/lib/payments/fake-admin.test-util";
import { callsTo, fakeCallsRepo } from "./fake-calls-repo.test-util";
import type { CallEmailSend } from "./mailer";
import { createCallNoticeSender, notifyCall, sendCallNotice, type CallNotice } from "./notify";
import { CALL_SETTINGS_DEFAULTS } from "./settings";

const h = vi.hoisted(() => ({ client: null as unknown, send: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => h.client }));
vi.mock("@/lib/email/resend", () => ({ sendEmail: h.send, DEFAULT_FROM: "Baby Bloom <noreply@example.test>" }));

const NOTICE: CallNotice = {
  kind: "booked",
  parentUserId: "b0400000-0000-4000-8000-000000000001",
  bookingId: "c0400000-0000-4000-8000-000000000001",
  startsAt: "2027-02-09T14:00:00.000Z",
  actorKind: "parent",
};

afterEach(() => vi.restoreAllMocks());

describe("notifyCall", () => {
  it("hands the notice to the sender", async () => {
    const send = vi.fn(async () => {});
    await notifyCall(NOTICE, send);
    expect(send).toHaveBeenCalledWith(NOTICE);
  });

  it("logs and swallows a sender that throws — the error's name and code only, never its message", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const failure = Object.assign(new Error("invalid to address jane@example.com"), { name: "ResendError", code: "validation_error" });
    await expect(
      notifyCall(NOTICE, async () => {
        throw failure;
      }),
    ).resolves.toBeUndefined();
    expect(log).toHaveBeenCalledWith("[calls/notify] booked notice failed", {
      bookingId: NOTICE.bookingId,
      name: "ResendError",
      code: "validation_error",
    });
    expect(JSON.stringify(log.mock.calls)).not.toContain("jane@example.com");
  });

  it("logs a thrown non-error by its type", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    await notifyCall(NOTICE, async () => {
      throw "jane@example.com bounced";
    });
    expect(log).toHaveBeenCalledWith("[calls/notify] booked notice failed", { bookingId: NOTICE.bookingId, name: "string", code: undefined });
  });

});

const PARENT = NOTICE.parentUserId;
const JANE = { userId: PARENT, firstName: "Jane", lastName: "Smith", email: "jane@example.com", mobile: "+447700900123", isTestUser: false };
const CALLER = "+447700900999";

function sender(seed: Parameters<typeof fakeCallsRepo>[0] = {}) {
  const fake = fakeCallsRepo({ contacts: [JANE], settings: { ...CALL_SETTINGS_DEFAULTS, callerNumber: CALLER }, ...seed });
  const send = vi.fn<CallEmailSend>(async () => ({ success: true, messageId: "m-1" }));
  return { fake, send, notice: createCallNoticeSender({ repo: fake.repo, send }) };
}

const mails = (send: ReturnType<typeof sender>["send"]) => send.mock.calls.map(([m]) => m);

describe("createCallNoticeSender — the emails (plan B1)", () => {
  beforeEach(() => vi.stubEnv("ADMIN_EMAIL", "ops@example.test"));
  afterEach(() => vi.unstubAllEnvs());

  it("her own booking: the confirmation to her, then admin_call_booked to ADMIN_EMAIL", async () => {
    const { send, notice } = sender();
    await notice(NOTICE);
    const [toHer, toAdmin] = mails(send);
    expect(toHer).toMatchObject({
      to: "jane@example.com",
      from: "Baby Bloom <noreply@example.test>",
      replyTo: SENDERS.hello,
      emailType: "call_booking_confirmation",
      recipientUserId: PARENT,
      subject: "Your Complimentary matchmaker call: Tuesday 9 February, 14:00",
    });
    expect(toHer.html).toContain("+44 (0) 7700 900 999");
    expect(toAdmin).toMatchObject({ to: "ops@example.test", emailType: "admin_call_booked", subject: "New matchmaker call booked: Jane Smith, Tue 9 Feb, 14:00" });
    expect(toAdmin.recipientUserId).toBeUndefined();
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("her own booking: both emails go out together — a slow or failing one never holds up the other (review F9)", async () => {
    const { send, notice } = sender();
    let release: (v: { success: boolean }) => void = () => {};
    send.mockImplementationOnce(() => new Promise((resolve) => (release = resolve)));
    const pending = notice(NOTICE);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mails(send).map((m) => m.emailType)).toEqual(["call_booking_confirmation", "admin_call_booked"]);
    release({ success: false });
    await expect(pending).resolves.toBeUndefined();
  });

  it("a booking BAI made for her: her confirmation only, no admin_call_booked", async () => {
    const { send, notice } = sender();
    await notice({ ...NOTICE, actorKind: "admin" });
    expect(mails(send).map((m) => m.emailType)).toEqual(["call_booking_confirmation"]);
  });

  it("a move: call_booking_changed with the old time; no admin email", async () => {
    const { send, notice } = sender();
    await notice({ ...NOTICE, kind: "moved", fromStartsAt: "2027-02-08T10:30:00.000Z" });
    expect(mails(send).map((m) => m.emailType)).toEqual(["call_booking_changed"]);
    expect(mails(send)[0].html).toContain("It was Monday 8 February at 10:30.");
  });

  it("a cancel (hers or BAI's): call_booking_cancelled to her", async () => {
    const { send, notice } = sender();
    await notice({ ...NOTICE, kind: "cancelled" });
    await notice({ ...NOTICE, kind: "cancelled", actorKind: "admin" });
    expect(mails(send).map((m) => m.emailType)).toEqual(["call_booking_cancelled", "call_booking_cancelled"]);
  });

  it("no caller number set → no caller line; the settings read failing → sent without it", async () => {
    const unset = sender({ settings: CALL_SETTINGS_DEFAULTS });
    await unset.notice(NOTICE);
    expect(mails(unset.send)[0].html).not.toContain("call you from");
    const failing = sender({ failing: ["readSettings"] });
    await failing.notice(NOTICE);
    expect(mails(failing.send)[0].emailType).toBe("call_booking_confirmation");
    expect(mails(failing.send)[0].html).not.toContain("call you from");
  });

  it("reads only her contact", async () => {
    const { fake, notice } = sender();
    await notice(NOTICE);
    expect(callsTo(fake, "readContacts")[0].args).toEqual([[PARENT]]);
  });

  it("ADMIN_EMAIL unset → SENDERS.admin", async () => {
    vi.stubEnv("ADMIN_EMAIL", "");
    const { send, notice } = sender();
    await notice(NOTICE);
    expect(mails(send)[1].to).toBe(SENDERS.admin);
  });

  it("no contact row, or the read failing → nothing sent, logged without detail", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const missing = sender({ contacts: [] });
    await missing.notice(NOTICE);
    const failing = sender({ failing: ["readContacts"] });
    await failing.notice(NOTICE);
    expect(missing.send).not.toHaveBeenCalled();
    expect(failing.send).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledTimes(2);
  });

  it("a failed or throwing send is logged by type and booking only — never her address", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const failed = sender();
    failed.send.mockResolvedValue({ success: false, error: "invalid to jane@example.com" });
    await failed.notice(NOTICE);
    const thrown = sender();
    thrown.send.mockRejectedValue(new Error("jane@example.com bounced"));
    await expect(thrown.notice(NOTICE)).resolves.toBeUndefined();
    expect(log).toHaveBeenCalled();
    expect(JSON.stringify(log.mock.calls)).not.toContain("jane@example.com");
  });

  it("an empty first name reads 'Hi there,'", async () => {
    const { send, notice } = sender({ contacts: [{ ...JANE, firstName: "" }] });
    await notice(NOTICE);
    expect(mails(send)[0].html).toContain("Hi there,");
  });
});

describe("sendCallNotice — the default sender", () => {
  beforeEach(() => vi.stubEnv("ADMIN_EMAIL", "ops@example.test"));
  afterEach(() => vi.unstubAllEnvs());

  it("reads through the service-role repository and sends through sendEmail (04b: the templates are live)", async () => {
    const f = fakeAdmin({
      user_profiles: [{ user_id: PARENT, first_name: "Jane", last_name: "Smith", email: "jane@example.com", mobile_number: null, is_test_user: false }],
      call_settings: {
        slot_minutes: 30,
        window_days: 7,
        notice_minutes: 120,
        hold_minutes: 5,
        parent_reminder_minutes: 1440,
        admin_reminder_minutes: 15,
        overdue_grace_minutes: 15,
        not_booked_delay_minutes: 30,
        caller_number: CALLER,
        enabled_since: null,
      },
    });
    h.client = f.client;
    h.send.mockReset();
    h.send.mockResolvedValue({ success: true, messageId: "dry-run" });
    await sendCallNotice(NOTICE);
    expect(h.send.mock.calls.map(([m]) => m.emailType)).toEqual(["call_booking_confirmation", "admin_call_booked"]);
  });
});
