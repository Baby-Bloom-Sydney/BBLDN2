/**
 * notify.ts (plan A7, B1): an injectable sender. A sender that fails is logged and swallowed — an email failure
 * never undoes or fails a booking. 04b wires the templates: booked → `call_booking_confirmation` (+
 * `admin_call_booked` when the parent booked it herself), moved → `call_booking_changed`, cancelled →
 * `call_booking_cancelled`; from `DEFAULT_FROM`, reply-to `SENDERS.hello`, `recipientUserId` set; admin mail to
 * `ADMIN_EMAIL`, else `SENDERS.admin`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SENDERS, SITE_URL } from "@/lib/constants";
import { depositLinkUrl } from "@/lib/deposit/links";
import { buildCallBookingCancelledEmail } from "@/lib/email/templates/call-booking-cancelled";
import { buildCallBookingChangedEmail } from "@/lib/email/templates/call-booking-changed";
import { buildCallBookingConfirmationEmail } from "@/lib/email/templates/call-booking-confirmation";
import { CALL_PAGE_URL } from "@/lib/email/templates/call-email-parts";
import { fakeAdmin } from "@/lib/payments/fake-admin.test-util";
import { bookingRow, callsTo, fakeCallsRepo } from "./fake-calls-repo.test-util";
import type { CallEmailSend } from "./mailer";
import { createCallNoticeSender, notifyCall, sendCallNotice, type CallNotice, type OpenDepositCodeReader } from "./notify";
import { CALL_SETTINGS_DEFAULTS } from "./settings";
import type { CallPurpose } from "./types";

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

// ── Plan 03 C3 (D8), add-only: a pre-booked family's "Change or cancel" button opens her deposit page ─────────────
// first_call → today's emails, byte for byte. cohort_prebook with an open link → `/deposit/<code>`; with none, a
// failed read, or the switch off → today's call page. Label and copy unchanged; the cancel email is untouched.

const CODE = "Ab0_-".repeat(8) + "xyz";
const FROM = "2027-02-08T10:30:00.000Z";
const PARAMS = { firstName: "Jane", callerNumber: CALLER, startsAt: NOTICE.startsAt };
const MOVED: CallNotice = { ...NOTICE, kind: "moved", fromStartsAt: FROM };
const ONE_LINK: OpenDepositCodeReader = async () => ({ ok: true, value: CODE });
const TODAY_CONFIRMATION = () => buildCallBookingConfirmationEmail(PARAMS).html;

/** A sender over her contact, one booking of this purpose (none for null) and the given open-link reader. */
function d8Sender(purpose: CallPurpose | null, read: OpenDepositCodeReader = ONE_LINK, seed: Parameters<typeof fakeCallsRepo>[0] = {}) {
  const bookings = purpose === null ? [] : [bookingRow({ id: NOTICE.bookingId, parentUserId: PARENT, startsAt: NOTICE.startsAt, purpose })];
  const fake = fakeCallsRepo({ contacts: [JANE], settings: { ...CALL_SETTINGS_DEFAULTS, callerNumber: CALLER }, bookings, ...seed });
  const send = vi.fn<CallEmailSend>(async () => ({ success: true, messageId: "m-1" }));
  const readCode = vi.fn(read);
  return { fake, send, readCode, notice: createCallNoticeSender({ repo: fake.repo, send, readOpenDepositCode: readCode }) };
}

const htmlOf = (send: ReturnType<typeof d8Sender>["send"], emailType: string) => mails(send).find((m) => m.emailType === emailType)?.html;

describe("the button's href (plan 03 C3, D8)", () => {
  beforeEach(() => {
    vi.stubEnv("ADMIN_EMAIL", "ops@example.test");
    vi.stubEnv("COHORTS_ENABLED", "true");
    vi.stubEnv("DEPOSIT_LINK_ENABLED", "true");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("first_call → today's confirmation and change emails, byte for byte; her deposit link is never read", async () => {
    const s = d8Sender("first_call");
    await s.notice(NOTICE);
    await s.notice(MOVED);
    expect(htmlOf(s.send, "call_booking_confirmation")).toBe(TODAY_CONFIRMATION());
    expect(htmlOf(s.send, "call_booking_changed")).toBe(buildCallBookingChangedEmail({ ...PARAMS, fromStartsAt: FROM }).html);
    expect(s.readCode).not.toHaveBeenCalled();
  });

  it("cohort_prebook with an open link → both buttons open her /deposit/<code>; label, copy and the admin email as before", async () => {
    const s = d8Sender("cohort_prebook");
    await s.notice(NOTICE);
    await s.notice(MOVED);
    const href = depositLinkUrl(CODE);
    expect(href).toBe(`${SITE_URL}/deposit/${CODE}`);
    expect(htmlOf(s.send, "call_booking_confirmation")).toBe(buildCallBookingConfirmationEmail({ ...PARAMS, href }).html);
    expect(htmlOf(s.send, "call_booking_changed")).toBe(buildCallBookingChangedEmail({ ...PARAMS, fromStartsAt: FROM, href }).html);
    expect(htmlOf(s.send, "call_booking_confirmation")).not.toContain(CALL_PAGE_URL);
    expect(htmlOf(s.send, "call_booking_confirmation")).toContain(">Change or cancel</a>");
    expect(htmlOf(s.send, "admin_call_booked")).not.toContain("/deposit/");
    expect(s.readCode.mock.calls).toEqual([[PARENT], [PARENT]]);
    expect(callsTo(s.fake, "readBookingsForParents")[0].args).toEqual([[PARENT]]);
  });

  it("cohort_prebook with no open link → today's call page", async () => {
    const s = d8Sender("cohort_prebook", async () => ({ ok: true, value: null }));
    await s.notice(NOTICE);
    expect(htmlOf(s.send, "call_booking_confirmation")).toBe(TODAY_CONFIRMATION());
    expect(s.readCode).toHaveBeenCalledTimes(1);
  });

  it("cohort_prebook, the link read failing or throwing → today's call page, logged by code only, never the code value", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const failed = d8Sender("cohort_prebook", async () => ({ ok: false }));
    await failed.notice(NOTICE);
    const thrown = d8Sender("cohort_prebook", async () => {
      throw Object.assign(new Error(`no link ${CODE}`), { code: "XX000" });
    });
    await thrown.notice(NOTICE);
    for (const s of [failed, thrown]) expect(htmlOf(s.send, "call_booking_confirmation")).toBe(TODAY_CONFIRMATION());
    expect(log).toHaveBeenCalledWith("[calls/notify] deposit link read failed", { bookingId: NOTICE.bookingId, code: "read_failed" });
    expect(log).toHaveBeenCalledWith("[calls/notify] deposit link read failed", { bookingId: NOTICE.bookingId, code: "XX000" });
    expect(JSON.stringify(log.mock.calls)).not.toContain(CODE);
  });

  it("a reader answering something other than a deposit code → today's call page, never a malformed link", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const s = d8Sender("cohort_prebook", async () => ({ ok: true, value: "../admin" }));
    await s.notice(NOTICE);
    expect(htmlOf(s.send, "call_booking_confirmation")).toBe(TODAY_CONFIRMATION());
    expect(log).toHaveBeenCalledWith("[calls/notify] deposit link read failed", { bookingId: NOTICE.bookingId, code: "not_a_code" });
  });

  it("her booking not found, or its read failing → today's call page; her link is never read", async () => {
    const missing = d8Sender(null);
    await missing.notice(NOTICE);
    const failing = d8Sender("cohort_prebook", ONE_LINK, { failing: ["readBookingsForParents"] });
    await failing.notice(NOTICE);
    for (const s of [missing, failing]) {
      expect(htmlOf(s.send, "call_booking_confirmation")).toBe(TODAY_CONFIRMATION());
      expect(s.readCode).not.toHaveBeenCalled();
    }
  });

  it.each(["DEPOSIT_LINK_ENABLED", "COHORTS_ENABLED"])("%s off → today's call page, with no booking or link read", async (flag) => {
    vi.stubEnv(flag, "");
    const s = d8Sender("cohort_prebook");
    await s.notice(NOTICE);
    await s.notice(MOVED);
    expect(htmlOf(s.send, "call_booking_confirmation")).toBe(TODAY_CONFIRMATION());
    expect(htmlOf(s.send, "call_booking_changed")).toBe(buildCallBookingChangedEmail({ ...PARAMS, fromStartsAt: FROM }).html);
    expect(callsTo(s.fake, "readBookingsForParents")).toEqual([]);
    expect(s.readCode).not.toHaveBeenCalled();
  });

  it("a cancel → its email as before, with no booking or link read", async () => {
    const s = d8Sender("cohort_prebook");
    await s.notice({ ...NOTICE, kind: "cancelled" });
    expect(htmlOf(s.send, "call_booking_cancelled")).toBe(buildCallBookingCancelledEmail(PARAMS).html);
    expect(callsTo(s.fake, "readBookingsForParents")).toEqual([]);
    expect(s.readCode).not.toHaveBeenCalled();
  });

  it("her booking read throwing → the email still goes, with today's call page; logged by code only", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const fake = fakeCallsRepo({ contacts: [JANE], settings: { ...CALL_SETTINGS_DEFAULTS, callerNumber: CALLER } });
    const repo = { ...fake.repo, readBookingsForParents: async () => Promise.reject(new TypeError("jane@example.com")) };
    const send = vi.fn<CallEmailSend>(async () => ({ success: true, messageId: "m-1" }));
    await createCallNoticeSender({ repo, send, readOpenDepositCode: ONE_LINK })(NOTICE);
    expect(htmlOf(send, "call_booking_confirmation")).toBe(TODAY_CONFIRMATION());
    expect(log).toHaveBeenCalledWith("[calls/notify] booking read failed", { bookingId: NOTICE.bookingId, code: "TypeError" });
    expect(JSON.stringify(log.mock.calls)).not.toContain("jane@example.com");
  });

  it("a sender built without a reader → today's call page, with no booking read", async () => {
    const fake = fakeCallsRepo({
      contacts: [JANE],
      settings: { ...CALL_SETTINGS_DEFAULTS, callerNumber: CALLER },
      bookings: [bookingRow({ id: NOTICE.bookingId, parentUserId: PARENT, startsAt: NOTICE.startsAt, purpose: "cohort_prebook" })],
    });
    const send = vi.fn<CallEmailSend>(async () => ({ success: true, messageId: "m-1" }));
    await createCallNoticeSender({ repo: fake.repo, send })(NOTICE);
    expect(htmlOf(send, "call_booking_confirmation")).toBe(TODAY_CONFIRMATION());
    expect(callsTo(fake, "readBookingsForParents")).toEqual([]);
  });

  it("the default sender reads her booking and her open link through the service-role client", async () => {
    const f = fakeAdmin({
      user_profiles: [{ user_id: PARENT, first_name: "Jane", last_name: "Smith", email: "jane@example.com", mobile_number: null, is_test_user: false }],
      call_bookings: [
        {
          id: NOTICE.bookingId, parent_user_id: PARENT, position_id: null, starts_at: "2027-02-09T14:00:00+00:00",
          ends_at: "2027-02-09T14:30:00+00:00", status: "booked", purpose: "cohort_prebook", booked_by_kind: "parent",
          hold_expires_at: null, booked_at: "2027-02-04T10:01:00+00:00", moved_at: null, moved_from_starts_at: null,
          cancelled_at: null, cancel_reason: null, closed_at: null, created_at: "2027-02-04T10:00:00+00:00",
        },
      ],
      deposit_links: {
        id: "d0300000-0000-4000-8000-000000000011", parent_user_id: PARENT, code: CODE, state: "open", target: "current",
        goodwill_cohort_start_date: null, last_emailed_at: null, last_emailed_to: null, last_opened_at: null,
        created_at: "2027-01-25T10:00:00+00:00",
      },
    });
    h.client = f.client;
    h.send.mockReset();
    h.send.mockResolvedValue({ success: true, messageId: "dry-run" });
    await sendCallNotice(NOTICE);
    const toHer = h.send.mock.calls.map(([m]) => m).find((m) => m.emailType === "call_booking_confirmation");
    expect(toHer?.html).toContain(`href="${depositLinkUrl(CODE)}"`);
    expect(f.ops.find((o) => o.table === "deposit_links")?.filters).toEqual([["eq", "parent_user_id", PARENT], ["eq", "state", "open"]]);
  });
});
