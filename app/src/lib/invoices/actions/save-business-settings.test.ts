/**
 * `saveBusinessSettings` — the Business page's one Save (ledger B06 §9.1 R1–R5; replaces 06b-3's two dialog actions).
 * Through the real store, a fake service client and a fake session client:
 * - switch off → `invoices_disabled` before the session or any client; no nanny session → `signed_out`;
 * - everything is checked before anything is written; each refusal is by field, with the page's messages;
 * - each record she changed carries the version she loaded: any record changed since → `stale`, nothing written;
 * - her address is her home address — her own row, read with her session and saved with its version (security H1);
 *   a limited company needs none of hers;
 * - a trading name equal to her own name is saved as none;
 * - a change to saved bank details sends the security email (capped, best effort, at most 5 s), no digits anywhere:
 *   not in the reply, the email or a log.
 *
 * Review round 1: her address is written first (a create in between snapshots old business details with an address
 * that already suits them); a refusal after an earlier write says what was saved, with its version, so the page can
 * re-base and a retry never reads as "changed elsewhere"; the version check reads only the bank row's version; the
 * alert goes to her sign-in email, which her own session can't rewrite.
 *
 * BB-wave1-041126/06b3-rework, 2026-11-09 (the email cases ported from 06b-3's `save-payment-details.test.ts`).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getNannyId, createAdminClient, getUserEmailInfo, sendEmail, sessionClient } = vi.hoisted(() => ({
  getNannyId: vi.fn(),
  createAdminClient: vi.fn(),
  getUserEmailInfo: vi.fn(),
  sendEmail: vi.fn(),
  sessionClient: vi.fn(),
}));
vi.mock("@/lib/actions/connection", () => ({ getNannyId }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient }));
vi.mock("@/lib/supabase/server", () => ({ createClient: sessionClient }));
vi.mock("@/lib/email/helpers", () => ({ getUserEmailInfo }));
vi.mock("@/lib/email/resend", () => ({ sendEmail }));

import { SUPPORT_INBOX } from "@/lib/constants";
import { fakeAdmin, writesTo, type FakeAdmin } from "@/lib/payments/fake-admin.test-util";
import { EDIT_MESSAGES } from "@/lib/settings/edit-messages";
import { PROFILE_MESSAGES } from "@/lib/settings/nanny-profile-rules";
import { BUSINESS_MESSAGES as B } from "../validation-business";
import { saveBusinessSettings } from "./save-business-settings";

const NANNY_ID = "b0600000-0000-4000-8000-000000000101";
const USER_ID = "b0600000-0000-4000-8000-000000000001";
const V_BIZ = "2027-02-15T10:00:00.111111+00:00";
const V_BANK = "2027-02-15T10:00:00.222222+00:00";
const V_HOME = "2027-02-15T10:00:00.333333+00:00";
const NEWER = "2027-02-15T11:00:00.999999+00:00";
const ISSUER = {
  business_type: "sole_trader", name: "Sophie Taylor", trading_name: "Sophie Taylor", trading_name_source: "name",
  address: "1 Upper Street\nLondon\nN1 0AA", company_name: null, company_number: null, registered_office: null,
  partnership_name: null, vat_mode: "none", vat_rate_bp: null, vat_number: null, business_updated_at: V_BIZ,
};
const PROFILE = { first_name: "Sophie", last_name: "Taylor", updated_at: "2027-02-15T10:00:00.444444+00:00" };
const HOME_ROW = { line1: "1 Upper Street", town: "London", postcode: "N1 0AA", updated_at: V_HOME };
const BANK_ROW = { account_name: "Sophie Taylor", sort_code: "112233", account_number: "87654321", updated_at: V_BANK };
const BUSINESS = {
  businessType: "sole_trader", tradingName: "Taylor Childcare", companyName: "", companyNumber: "", registeredOffice: "",
  partnershipName: "", vatMode: "included", vatNumber: "123 4567 89", expectedUpdatedAt: V_BIZ,
};
const ADDRESS = { line1: "7 New Road", line2: "", town: "London", postcode: "n1 1aa", expectedUpdatedAt: V_HOME };
const BANK = { accountName: "S Taylor", sortCode: "20-00-56", accountNumber: "11114321", expectedUpdatedAt: V_BANK };
const bankSaved = (firstSave: boolean, changed: boolean) => ({
  data: { status: "saved", first_save: firstSave, changed, updated_at: NEWER, sort_code_last2: "56", account_last4: "4321" }, error: null,
});

let f: FakeAdmin;
let session: FakeAdmin;
let order: string[];
let bankSelects: string[];
const spies: Array<ReturnType<typeof vi.spyOn>> = [];
const AUTH_EMAIL = "admin+b06-01@babybloomnannies.co.uk";

/** Records the order of writes across both clients, the bank row's selected columns, and gives the fake an auth API. */
function instrument() {
  order = [];
  bankSelects = [];
  const svc = f.client as unknown as Record<string, unknown> & { from: (t: string) => Record<string, unknown>; rpc: (fn: string, a: unknown) => unknown };
  const rpc = svc.rpc;
  svc.rpc = (fn: string, args: unknown) => (fn.endsWith("_save") && order.push(fn), rpc(fn, args));
  const from = svc.from;
  svc.from = (table: string) => {
    const b = from(table);
    if (table !== "nanny_payment_details") return b;
    const select = b.select as (c: string) => unknown;
    return { ...b, select: (c: string) => (bankSelects.push(c), select(c)) };
  };
  svc.auth = { admin: { getUserById: vi.fn(async () => ({ data: { user: { email: AUTH_EMAIL } }, error: null })) } };
  const mine = session.client as unknown as { from: (t: string) => Record<string, unknown> };
  const sFrom = mine.from;
  mine.from = (table: string) => {
    const b = sFrom(table);
    const update = b.update as (p: unknown) => unknown;
    return { ...b, update: (p: unknown) => (order.push(`${table} update`), update(p)) };
  };
}

beforeEach(() => {
  vi.stubEnv("NANNY_INVOICES_ENABLED", "true");
  f = fakeAdmin({ nanny_payment_details: BANK_ROW });
  f.rpcResults.nanny_invoice_issuer = { data: ISSUER, error: null };
  f.rpcResults.nanny_business_details_save = { data: { status: "saved", changed: true, updated_at: NEWER }, error: null };
  f.rpcResults.nanny_payment_details_save = bankSaved(false, true);
  f.rpcResults.nanny_home_address_save = { data: { status: "saved", changed: true, updated_at: NEWER }, error: null };
  createAdminClient.mockReset().mockReturnValue(f.client);
  session = fakeAdmin({ user_profiles: PROFILE, nanny_home_addresses: HOME_ROW });
  session.writeResults.user_profiles = [{ updated_at: NEWER }];
  sessionClient.mockReset().mockReturnValue(session.client);
  getNannyId.mockReset().mockResolvedValue({ nannyId: NANNY_ID, userId: USER_ID });
  instrument();
  getUserEmailInfo.mockReset().mockResolvedValue({ email: "admin+b06-01@babybloomnannies.co.uk", firstName: "Sophie", lastName: "Taylor", userId: USER_ID });
  sendEmail.mockReset().mockResolvedValue({ success: true, messageId: "m1" });
  spies.splice(0);
  for (const level of ["error", "warn", "log", "info"] as const) spies.push(vi.spyOn(console, level).mockImplementation(() => {}));
});

afterEach(() => {
  expect(JSON.stringify(spies.flatMap((s) => s.mock.calls))).not.toMatch(/112233|11-22-33|87654321|200056|11114321|Taylor|New Road/);
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const saves = () => f.rpcCalls.filter((c) => c.fn.endsWith("_save"));

describe("gates", () => {
  it.each(["", "false", "TRUE", "1"])("switch %j → invoices_disabled before the session or a client", async (value) => {
    vi.stubEnv("NANNY_INVOICES_ENABLED", value);
    expect(await saveBusinessSettings({ business: BUSINESS })).toEqual({ ok: false, error: "invoices_disabled", message: "This isn't available right now." });
    expect(getNannyId).not.toHaveBeenCalled();
    expect(createAdminClient).not.toHaveBeenCalled();
    expect(sessionClient).not.toHaveBeenCalled();
  });

  it("no nanny session → signed_out, nothing read or written", async () => {
    getNannyId.mockResolvedValueOnce(null);
    expect(await saveBusinessSettings({ business: BUSINESS })).toMatchObject({ ok: false, error: "signed_out" });
    expect(f.rpcCalls).toEqual([]);
    expect(session.ops).toEqual([]);
  });

  it("an envelope that doesn't fit → invalid, nothing read", async () => {
    for (const bad of [null, "x", { bank: { accountName: "a" } }]) {
      expect(await saveBusinessSettings(bad)).toEqual({ ok: false, error: "invalid", message: "Please check the details and try again." });
    }
    expect(f.rpcCalls).toEqual([]);
  });
});

describe("everything is checked before anything is written", () => {
  it("refusals by field across the page; nothing written", async () => {
    const r = await saveBusinessSettings({
      business: { ...BUSINESS, businessType: "limited_company" },
      bank: { ...BANK, sortCode: "1" },
      address: { ...ADDRESS, line1: "" },
    });
    expect(r).toEqual({
      ok: false, error: "invalid", message: EDIT_MESSAGES.checkMarked,
      fields: { companyName: B.companyName, companyNumber: B.companyNumber, registeredOffice: B.registeredOffice, address: PROFILE_MESSAGES.address, sortCode: "Enter a 6-digit sort code" },
    });
    expect(saves()).toEqual([]);
    expect(writesTo(session, "user_profiles")).toEqual([]);
  });

  it("a sole trader with no address on file and none picked is refused by the address field", async () => {
    session.reads.nanny_home_addresses = null;
    expect(await saveBusinessSettings({ business: BUSINESS })).toMatchObject({ ok: false, fields: { address: PROFILE_MESSAGES.address } });
    expect(saves()).toEqual([]);
  });

  it("her profile unreadable → the plain failure, nothing written", async () => {
    session.reads.user_profiles = null;
    expect(await saveBusinessSettings({ business: BUSINESS })).toMatchObject({ ok: false, error: "error", message: EDIT_MESSAGES.gaveUp });
    expect(saves()).toEqual([]);
  });

  it("her home address unreadable → the plain failure, nothing written", async () => {
    session.readErrors.nanny_home_addresses = { message: "boom" };
    expect(await saveBusinessSettings({ business: BUSINESS, address: ADDRESS })).toMatchObject({ ok: false, error: "error" });
    expect(saves()).toEqual([]);
  });
});

describe("saving the page", () => {
  it("writes each record she changed with the version she loaded, for the session's nanny; the reply carries nothing of hers", async () => {
    const r = await saveBusinessSettings({ business: BUSINESS, address: ADDRESS, bank: BANK, nannyId: "b0600000-0000-4000-8000-000000000102" });
    expect(r).toEqual({ ok: true });
    expect(saves()).toEqual([
      {
        fn: "nanny_home_address_save",
        args: { p_user: USER_ID, p_line1: "7 New Road", p_town: "London", p_postcode: "N1 1AA", p_expected_updated_at: V_HOME, p_any_version: false },
      },
      {
        fn: "nanny_business_details_save",
        args: {
          p_nanny: NANNY_ID, p_business_type: "sole_trader", p_trading_name: "Taylor Childcare", p_company_name: null,
          p_company_number: null, p_registered_office: null, p_partnership_name: null, p_vat_mode: "included",
          p_vat_number: "GB123456789", p_vat_rate_bp: 2000, p_expected_updated_at: V_BIZ,
        },
      },
      {
        fn: "nanny_payment_details_save",
        args: { p_nanny: NANNY_ID, p_account_name: "S Taylor", p_sort_code: "200056", p_account_number: "11114321", p_expected_updated_at: V_BANK },
      },
    ]);
    expect(writesTo(session, "user_profiles")).toEqual([]);
    expect(writesTo(f, "user_profiles")).toEqual([]);
  });

  it("her address is written first, then her business details, then her bank details", async () => {
    await saveBusinessSettings({ business: BUSINESS, address: ADDRESS, bank: BANK });
    expect(order).toEqual(["nanny_home_address_save", "nanny_business_details_save", "nanny_payment_details_save"]);
  });

  it("a refusal after an earlier write says what was saved, with its version (the page re-bases; a retry isn't stale)", async () => {
    f.rpcResults.nanny_payment_details_save = { data: null, error: { message: "lock timeout", code: "55P03" } };
    expect(await saveBusinessSettings({ business: BUSINESS, address: ADDRESS, bank: BANK })).toEqual({
      ok: false, error: "busy", message: "Your details are being saved elsewhere — try again in a moment.",
      saved: { home: NEWER, business: NEWER },
    });
    f.rpcResults.nanny_business_details_save = { data: { status: "nanny_inactive" }, error: null };
    expect(await saveBusinessSettings({ business: BUSINESS, address: ADDRESS })).toMatchObject({ error: "nanny_inactive", saved: { home: NEWER } });
    expect(await saveBusinessSettings({ business: BUSINESS })).not.toHaveProperty("saved");
  });

  it("the version check reads only the bank row's version, not her numbers", async () => {
    await saveBusinessSettings({ bank: BANK });
    expect(bankSelects).toEqual(["updated_at"]);
  });

  it("only the records sent are read and written (bank only)", async () => {
    expect(await saveBusinessSettings({ bank: BANK })).toEqual({ ok: true });
    expect(saves().map((c) => c.fn)).toEqual(["nanny_payment_details_save"]);
    expect(f.rpcCalls.map((c) => c.fn)).not.toContain("nanny_invoice_issuer");
    expect(f.rpcCalls.map((c) => c.fn)).not.toContain("nanny_home_address_save");
  });

  it("a trading name equal to her own name (any case, spaces collapsed) is saved as none", async () => {
    await saveBusinessSettings({ business: { ...BUSINESS, tradingName: "  sophie   TAYLOR " } });
    expect(saves()[0]?.args).toMatchObject({ p_trading_name: null });
  });

  it("a limited company saves with no address of hers on file", async () => {
    session.reads.nanny_home_addresses = null;
    const ltd = { ...BUSINESS, businessType: "limited_company", companyName: "Taylor Childcare Ltd", companyNumber: "12345678", registeredOffice: "9 Office Row\nLondon EC1A 1AA" };
    expect(await saveBusinessSettings({ business: ltd })).toEqual({ ok: true });
    expect(saves()[0]?.args).toMatchObject({ p_business_type: "limited_company", p_registered_office: "9 Office Row\nLondon EC1A 1AA" });
  });
});

describe("stale: a record changed since she pressed Edit", () => {
  it.each([
    ["her business details", () => { f.rpcResults.nanny_invoice_issuer = { data: { ...ISSUER, business_updated_at: NEWER }, error: null }; }],
    ["her bank details", () => { f.reads.nanny_payment_details = { ...BANK_ROW, updated_at: NEWER }; }],
    ["her home address", () => { session.reads.nanny_home_addresses = { ...HOME_ROW, updated_at: NEWER }; }],
    ["bank details added elsewhere when she had none", () => { f.reads.nanny_payment_details = BANK_ROW; }],
  ])("%s → stale, nothing written", async (label, arrange) => {
    arrange();
    const bank = label.startsWith("bank details added") ? { ...BANK, expectedUpdatedAt: null } : BANK;
    expect(await saveBusinessSettings({ business: BUSINESS, address: ADDRESS, bank }))
      .toEqual({ ok: false, error: "stale", message: EDIT_MESSAGES.stale });
    expect(saves()).toEqual([]);
  });

  it("a change landing between the check and the write: the database answers stale", async () => {
    f.rpcResults.nanny_business_details_save = { data: { status: "stale" }, error: null };
    expect(await saveBusinessSettings({ business: BUSINESS })).toMatchObject({ ok: false, error: "stale" });
    f.rpcResults.nanny_home_address_save = { data: { status: "stale" }, error: null };
    expect(await saveBusinessSettings({ address: ADDRESS })).toMatchObject({ ok: false, error: "stale" });
  });

  it("a version read that fails → the plain failure, nothing written", async () => {
    f.rpcResults.nanny_invoice_issuer = { data: null, error: { message: "x", code: "XX000" } };
    expect(await saveBusinessSettings({ business: BUSINESS })).toMatchObject({ ok: false, error: "error" });
    expect(saves()).toEqual([]);
  });
});

describe("the bank-change email (R7; security review M1, TS review M2)", () => {
  it("a change to saved details sends it once: no digits, replies to support, logged by type", async () => {
    expect(await saveBusinessSettings({ bank: BANK })).toEqual({ ok: true });
    expect(sendEmail).toHaveBeenCalledTimes(1);
    const sent = sendEmail.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(sent).toMatchObject({
      to: AUTH_EMAIL, subject: "Your BabyBloom bank details were changed",
      replyTo: SUPPORT_INBOX, emailType: "invoice_payment_details_changed", recipientUserId: USER_ID,
    });
    expect(`${String(sent.html)}${String(sent.text)}`).not.toMatch(/112233|200056|11114321|4321|••/);
  });

  it("it goes to her sign-in email, not the profile's (which her own session could rewrite; security review M1)", async () => {
    getUserEmailInfo.mockResolvedValue({ email: "someone-else@example.test", firstName: "Sophie", lastName: "Taylor", userId: USER_ID });
    await saveBusinessSettings({ bank: BANK });
    expect((sendEmail.mock.calls[0]?.[0] as { to: string }).to).toBe(AUTH_EMAIL);
    expect((f.client as unknown as { auth: { admin: { getUserById: ReturnType<typeof vi.fn> } } }).auth.admin.getUserById).toHaveBeenCalledWith(USER_ID);
  });

  it("no sign-in email → no alert, logged by code; the save stands", async () => {
    (f.client as unknown as { auth: unknown }).auth = { admin: { getUserById: vi.fn(async () => ({ data: { user: null }, error: { message: "x" } })) } };
    expect(await saveBusinessSettings({ bank: BANK })).toEqual({ ok: true });
    expect(sendEmail).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenLastCalledWith("[invoices] the details-changed email failed", { code: "no_account_email" });
  });

  it("the first save and an unchanged re-save send none", async () => {
    f.reads.nanny_payment_details = null;
    f.rpcResults.nanny_payment_details_save = bankSaved(true, true);
    await saveBusinessSettings({ bank: { ...BANK, expectedUpdatedAt: null } });
    f.reads.nanny_payment_details = BANK_ROW;
    f.rpcResults.nanny_payment_details_save = bankSaved(false, false);
    await saveBusinessSettings({ bank: BANK });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("the email failing never fails the save; logged by code only", async () => {
    sendEmail.mockResolvedValueOnce({ success: false, error: "provider down" });
    expect(await saveBusinessSettings({ bank: BANK })).toEqual({ ok: true });
    expect(console.error).toHaveBeenLastCalledWith("[invoices] the details-changed email failed", { code: "send_failed" });
    getUserEmailInfo.mockResolvedValueOnce(null);
    expect(await saveBusinessSettings({ bank: BANK })).toEqual({ ok: true });
    expect(console.error).toHaveBeenLastCalledWith("[invoices] the details-changed email failed", { code: "no_profile" });
  });

  it("3 already in the last hour: the save happens, no 4th email", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2027-02-15T14:00:00.000Z"));
    try {
      f.reads.email_logs = [{ id: "e1" }, { id: "e2" }, { id: "e3" }];
      expect(await saveBusinessSettings({ bank: BANK })).toEqual({ ok: true });
      expect(sendEmail).not.toHaveBeenCalled();
      expect(f.ops.find((o) => o.table === "email_logs")?.filters).toEqual([
        ["eq", "recipient_user_id", USER_ID], ["eq", "email_type", "invoice_payment_details_changed"],
        ["gte", "created_at", "2027-02-15T13:00:00.000Z"], ["limit", 3, undefined],
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("the cap lookup failing never silences it", async () => {
    f.readErrors.email_logs = { message: "boom", code: "XX000" };
    await saveBusinessSettings({ bank: BANK });
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(console.error).toHaveBeenCalledWith("[invoices] the details-changed email cap failed", { code: "XX000" });
  });

  it("the reply waits at most 5 seconds for it", async () => {
    vi.useFakeTimers();
    try {
      sendEmail.mockImplementationOnce(() => new Promise(() => undefined));
      const reply = saveBusinessSettings({ bank: BANK });
      await vi.advanceTimersByTimeAsync(5_000);
      expect(await reply).toEqual({ ok: true });
      expect(console.error).toHaveBeenLastCalledWith("[invoices] the details-changed email failed", { code: "timeout" });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("the database's refusals", () => {
  it("their code and a fixed message, never its words; no email", async () => {
    f.rpcResults.nanny_payment_details_save = { data: { status: "nanny_inactive" }, error: null };
    expect(await saveBusinessSettings({ bank: BANK })).toMatchObject({ ok: false, error: "nanny_inactive" });
    f.rpcResults.nanny_payment_details_save = { data: null, error: { message: "lock timeout", code: "55P03" } };
    expect(await saveBusinessSettings({ bank: BANK })).toMatchObject({ ok: false, error: "busy" });
    f.rpcResults.nanny_business_details_save = { data: null, error: { message: "Failing row contains (Taylor Childcare)", code: "23514" } };
    const r = await saveBusinessSettings({ business: BUSINESS });
    expect(r).toEqual({ ok: false, error: "error", message: "We couldn't save that. Please try again." });
    f.rpcResults.nanny_home_address_save = { data: null, error: { message: "boom", code: "XX000" } };
    expect(await saveBusinessSettings({ address: ADDRESS })).toMatchObject({ ok: false, error: "error" });
    f.rpcResults.nanny_home_address_save = { data: { status: "invalid" }, error: null };
    expect(await saveBusinessSettings({ address: ADDRESS })).toMatchObject({ ok: false, error: "invalid" });
    expect(sendEmail).not.toHaveBeenCalled();
  });
});
