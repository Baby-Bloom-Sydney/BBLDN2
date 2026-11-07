/**
 * `savePaymentDetails` (plan 06 §14.6 b3.1; brief §0a 2, §3 nanny 10, §11 Q12): her bank details for invoices, saved
 * from Settings (and, in 06b-4, from the first invoice). Through the real store and a fake service client:
 * - switch off → `invoices_disabled` before the session or any client is read; no nanny session → refused;
 * - the nanny id is the session's; the reply carries the **masks only**;
 * - **a change to saved details** (not the first save, not an unchanged re-save) sends the security email to her,
 *   with no digit in it and replies to the support inbox; an email failure never fails the save;
 * - the digits never reach `console.*`, on any path.
 *
 * BB-wave1-041126/06b3-build, 2026-11-07.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getNannyId, createAdminClient, getUserEmailInfo, sendEmail } = vi.hoisted(() => ({
  getNannyId: vi.fn(),
  createAdminClient: vi.fn(),
  getUserEmailInfo: vi.fn(),
  sendEmail: vi.fn(),
}));
vi.mock("@/lib/actions/connection", () => ({ getNannyId }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient }));
vi.mock("@/lib/email/helpers", () => ({ getUserEmailInfo }));
vi.mock("@/lib/email/resend", () => ({ sendEmail }));

import { SUPPORT_INBOX } from "@/lib/constants";
import { fakeAdmin, type FakeAdmin } from "@/lib/payments/fake-admin.test-util";
import { savePaymentDetails } from "./save-payment-details";

const NANNY_ID = "b0600000-0000-4000-8000-000000000101";
const USER_ID = "b0600000-0000-4000-8000-000000000001";
const IN = { accountName: "Sophie Taylor", sortCode: "11-22-33", accountNumber: "87654321" };
const saved = (firstSave: boolean, changed: boolean) => ({
  data: { status: "saved", first_save: firstSave, changed, sort_code_last2: "33", account_last4: "4321" },
  error: null,
});

let f: FakeAdmin;
const spies: Array<ReturnType<typeof vi.spyOn>> = [];

beforeEach(() => {
  vi.stubEnv("NANNY_INVOICES_ENABLED", "true");
  f = fakeAdmin();
  createAdminClient.mockReset().mockReturnValue(f.client);
  getNannyId.mockReset().mockResolvedValue({ nannyId: NANNY_ID, userId: USER_ID });
  getUserEmailInfo.mockReset().mockResolvedValue({ email: "admin+b06-01@babybloomnannies.co.uk", firstName: "Sophie", lastName: "Taylor", userId: USER_ID });
  sendEmail.mockReset().mockResolvedValue({ success: true, messageId: "m1" });
  spies.splice(0);
  for (const level of ["error", "warn", "log", "info"] as const) spies.push(vi.spyOn(console, level).mockImplementation(() => {}));
});

afterEach(() => {
  expect(JSON.stringify(spies.flatMap((s) => s.mock.calls))).not.toMatch(/112233|11-22-33|87654321/);
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("savePaymentDetails — gates", () => {
  it.each(["", "false", "TRUE", "1"])("switch %j → invoices_disabled before the session or a client", async (value) => {
    vi.stubEnv("NANNY_INVOICES_ENABLED", value);
    expect(await savePaymentDetails(IN)).toEqual({ ok: false, error: "invoices_disabled", message: "This isn't available right now." });
    expect(getNannyId).not.toHaveBeenCalled();
    expect(createAdminClient).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("no nanny session → signed_out, nothing written or sent", async () => {
    getNannyId.mockResolvedValueOnce(null);
    expect(await savePaymentDetails(IN)).toMatchObject({ ok: false, error: "signed_out" });
    expect(f.rpcCalls).toEqual([]);
    expect(sendEmail).not.toHaveBeenCalled();
  });
});

describe("savePaymentDetails — saving", () => {
  it("first save: saved for the session's nanny; the reply is the masks only; no email", async () => {
    f.rpcResults.nanny_payment_details_save = saved(true, true);
    const r = await savePaymentDetails({ ...IN, nannyId: "b0600000-0000-4000-8000-000000000102" });
    expect(r).toEqual({ ok: true, masks: { sortCodeLast2: "33", accountLast4: "4321" } });
    expect(JSON.stringify(r)).not.toMatch(/112233|87654321|Sophie/);
    expect(f.rpcCalls).toEqual([{
      fn: "nanny_payment_details_save",
      args: { p_nanny: NANNY_ID, p_account_name: "Sophie Taylor", p_sort_code: "112233", p_account_number: "87654321" },
    }]);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("a re-save with nothing changed sends no email", async () => {
    f.rpcResults.nanny_payment_details_save = saved(false, false);
    expect(await savePaymentDetails(IN)).toMatchObject({ ok: true });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("a change to saved details sends her the security email: no digits, replies to support, logged by type", async () => {
    f.rpcResults.nanny_payment_details_save = saved(false, true);
    expect(await savePaymentDetails(IN)).toEqual({ ok: true, masks: { sortCodeLast2: "33", accountLast4: "4321" } });
    expect(getUserEmailInfo).toHaveBeenCalledWith(USER_ID);
    expect(sendEmail).toHaveBeenCalledTimes(1);
    const sent = sendEmail.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(sent).toMatchObject({
      to: "admin+b06-01@babybloomnannies.co.uk",
      subject: "Your BabyBloom payment details were changed",
      replyTo: SUPPORT_INBOX,
      emailType: "invoice_payment_details_changed",
      recipientUserId: USER_ID,
    });
    expect(sent.attachments).toBeUndefined();
    expect(`${String(sent.html)}${String(sent.text)}`).not.toMatch(/112233|11-22-33|87654321|4321|••/);
    expect(String(sent.text)).toContain("Hi Sophie,");
  });

  it("the email failing, or her profile missing, never fails the save; each is logged by code only", async () => {
    f.rpcResults.nanny_payment_details_save = saved(false, true);
    sendEmail.mockResolvedValueOnce({ success: false, error: "provider down" });
    expect(await savePaymentDetails(IN)).toMatchObject({ ok: true });
    expect(console.error).toHaveBeenLastCalledWith("[invoices] the details-changed email failed", { code: "send_failed" });
    getUserEmailInfo.mockResolvedValueOnce(null);
    expect(await savePaymentDetails(IN)).toMatchObject({ ok: true });
    expect(console.error).toHaveBeenLastCalledWith("[invoices] the details-changed email failed", { code: "no_profile" });
    sendEmail.mockRejectedValueOnce(new TypeError("fetch failed"));
    expect(await savePaymentDetails(IN)).toMatchObject({ ok: true });
    expect(console.error).toHaveBeenLastCalledWith("[invoices] the details-changed email failed", { code: "TypeError" });
  });
});

describe("savePaymentDetails — the alert is capped (security review M1)", () => {
  it("3 alerts already sent to her in the last hour: the save happens, no 4th email; the lookup is hers, this type, the last hour", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2027-02-15T14:00:00.000Z"));
    try {
      f.rpcResults.nanny_payment_details_save = saved(false, true);
      f.reads.email_logs = [{ id: "e1" }, { id: "e2" }, { id: "e3" }];
      expect(await savePaymentDetails(IN)).toEqual({ ok: true, masks: { sortCodeLast2: "33", accountLast4: "4321" } });
      expect(sendEmail).not.toHaveBeenCalled();
      const lookup = f.ops.find((o) => o.table === "email_logs");
      expect(lookup?.filters).toEqual([
        ["eq", "recipient_user_id", USER_ID],
        ["eq", "email_type", "invoice_payment_details_changed"],
        ["gte", "created_at", "2027-02-15T13:00:00.000Z"],
        ["limit", 3, undefined],
      ]);
      expect(console.warn).toHaveBeenLastCalledWith("[invoices] the details-changed email skipped", { code: "alert_cap" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("fewer than 3 in the hour: sent", async () => {
    f.rpcResults.nanny_payment_details_save = saved(false, true);
    f.reads.email_logs = [{ id: "e1" }, { id: "e2" }];
    await savePaymentDetails(IN);
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });

  it("the lookup failing never silences the alert: sent, the failure logged by code", async () => {
    f.rpcResults.nanny_payment_details_save = saved(false, true);
    f.readErrors.email_logs = { message: "boom", code: "XX000" };
    await savePaymentDetails(IN);
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(console.error).toHaveBeenCalledWith("[invoices] the details-changed email cap failed", { code: "XX000" });
  });
});

describe("savePaymentDetails — refusals", () => {
  it("bad input → invalid with a plain message; nothing written or sent", async () => {
    for (const bad of [{ ...IN, sortCode: "11223" }, { ...IN, accountNumber: "1234567" }, { ...IN, accountName: "Baby Bloom" }, null]) {
      expect(await savePaymentDetails(bad)).toEqual({ ok: false, error: "invalid", message: "Please check the details and try again." });
    }
    expect(f.rpcCalls).toEqual([]);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("the database's refusals and failures: their code and a fixed message, never its words; no email", async () => {
    f.rpcResults.nanny_payment_details_save = { data: { status: "nanny_inactive" }, error: null };
    expect(await savePaymentDetails(IN)).toMatchObject({ ok: false, error: "nanny_inactive" });
    f.rpcResults.nanny_payment_details_save = { data: null, error: { message: "lock timeout", code: "55P03" } };
    expect(await savePaymentDetails(IN)).toMatchObject({ ok: false, error: "busy" });
    f.rpcResults.nanny_payment_details_save = { data: null, error: { message: "Failing row contains (112233, 87654321)", code: "23514" } };
    const r = await savePaymentDetails(IN);
    expect(r).toEqual({ ok: false, error: "error", message: "We couldn't save that. Please try again." });
    expect(JSON.stringify(r)).not.toMatch(/Failing|112233|87654321/);
    expect(sendEmail).not.toHaveBeenCalled();
  });
});
