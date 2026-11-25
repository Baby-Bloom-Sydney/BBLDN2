/**
 * BAI's deposit actions (plan 03 row B2, D10, D15; brief 03 §3 Admin 3–6; contract-03b). Every action: the switch
 * first (no auth call, no read), then `proveAdmin`, then validation, then 03a's domain calls on the fake admin, then
 * `revalidatePath` after a write only. Paid → `already_paid` before anything is made or emailed; goodwill only when
 * offered, its date from the server; `target_differs` writes nothing until BAI chooses.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FakeAdmin, Op } from "@/lib/payments/fake-admin.test-util";

const ADMIN = "a0300000-0000-4000-8000-000000000041";
const h = vi.hoisted(() => ({
  gate: { userId: "a0300000-0000-4000-8000-000000000041", error: null as string | null },
  gateCalls: 0,
  clients: 0,
  clientThrows: false,
  fake: null as FakeAdmin | null,
  revalidated: [] as string[],
  seq: [] as string[],
  sendEmail: vi.fn(),
  stampThrows: false,
}));
vi.mock("@/lib/admin/require-admin", () => ({
  requireAdmin: async () => {
    h.gateCalls += 1;
    return h.gate;
  },
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    h.clients += 1;
    if (h.clientThrows) throw new Error("no credentials for sarah@gmail.com");
    return h.fake!.client;
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: (p: string) => h.revalidated.push(p) }));
vi.mock("@/lib/email/resend", () => ({ sendEmail: h.sendEmail }));
// 03b review LOW-3: the real stamp, unless a test makes it throw after the email is out.
vi.mock("@/lib/deposit/links", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/deposit/links")>();
  return {
    ...actual,
    stampLinkSent: async (...args: Parameters<typeof actual.stampLinkSent>) => {
      if (h.stampThrows) throw new Error("stamp failed for sarah@gmail.com");
      return actual.stampLinkSent(...args);
    },
  };
});

import { PRICES } from "@/config/prices";
import { SITE_URL } from "@/lib/constants";
import { EMAIL_MAX } from "@/lib/deposit/constants";
import { fakeAdmin, writesTo } from "@/lib/payments/fake-admin.test-util";
import * as actions from "./deposit-actions";
import {
  cancelDepositLink,
  copyDepositLink,
  markDepositPaid,
  recordDepositBankRefund,
  sendDepositLink,
  takeDepositPaymentNow,
} from "./deposit-actions";

const PARENT = "b0300000-0000-4000-8000-000000000041";
const LINK = "d0300000-0000-4000-8000-000000000041";
const NEW_LINK = "d0300000-0000-4000-8000-000000000042";
const CODE = "Ab0_-".repeat(8) + "xyz";
const CURRENT = "2027-02-01";
const NEXT = "2027-02-08";
const NOW = new Date("2027-02-03T10:00:00Z");
const EMAIL = "sarah@gmail.com";
const MASKED = "s•••@gmail.com";
const PANEL_PATH = `/admin/users/${PARENT}/subscription`;
const URL_OF = (code: string) => `${SITE_URL}/deposit/${code}`;
const LINK_URL = /^https?:\/\/[^/]+\/deposit\/[A-Za-z0-9_-]{43}$/;
const NO_WARNINGS = { refunded_but_held: [], paid_without_place: [] };

type Row = Record<string, unknown>;
const openRow = (over: Row = {}): Row => ({
  id: LINK,
  parent_user_id: PARENT,
  code: CODE,
  state: "open",
  target: "current",
  goodwill_cohort_start_date: null,
  last_emailed_at: null,
  last_emailed_to: null,
  last_opened_at: null,
  created_at: "2027-02-03T08:59:00+00:00",
  ...over,
});
const GOODWILL_OPEN = { target: "goodwill", goodwill_cohort_start_date: NEXT };
const paidRow = (over: Row = {}): Row => ({
  deposit_pence: PRICES.dfy.depositPence,
  deposit_paid_at: "2027-02-02T09:00:00+00:00",
  deposit_refunded_at: null,
  deposit_method: "card",
  deposit_stripe_payment_intent_id: "pi_3Test",
  ...over,
});
const taken = (start: string, n: number): Row[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `c0300000-0000-4000-8000-0000000001${String(i).padStart(2, "0")}`,
    cohort_start_date: start,
    parent_user_id: `b0300000-0000-4000-8000-0000000009${String(i).padStart(2, "0")}`,
    state: "taken",
    is_goodwill: false,
    hold_expires_at: null,
    paid_by: "card",
    taken_at: "2027-01-30T09:00:00Z",
    reopened_at: null,
    reopen_reason: null,
  }));

/** The database as the fake answers it: her open link (changed by the writes) and the other families' places. */
let world: { open: Row | null; counted: Row[] };
let fake: FakeAdmin;
let log: ReturnType<typeof vi.spyOn>;

const isHers = (op: Op) => op.filters.some(([f, c, v]) => f === "eq" && c === "parent_user_id" && v === PARENT);
const payloadOf = (op: Op) => op.payload as Row;

function linkWrite(op: Op): unknown {
  const p = payloadOf(op);
  if (op.kind === "insert") {
    h.seq.push("insert");
    world = { ...world, open: openRow({ id: NEW_LINK, code: p.code, target: p.target, goodwill_cohort_start_date: p.goodwill_cohort_start_date }) };
    return world.open;
  }
  const had = world.open;
  if (p.state === "cancelled") {
    h.seq.push("cancel");
    world = { ...world, open: null };
  } else {
    h.seq.push("stamp");
    world = { ...world, open: had === null ? null : { ...had, ...p } };
  }
  return had === null ? [] : [{ id: had.id }];
}

function makeFake(): FakeAdmin {
  const f = fakeAdmin({
    parent_subscriptions: null,
    family_saved_cards: null,
    deposit_bank_transfers: null,
    deposit_links: () => world.open,
    deposit_prebookings: null,
    cohort_schedule: { first_start_date: "2027-01-25", repeat_weeks: 1, default_places: 5, created_at: "2026-11-04T05:00:00Z" },
    cohorts: [{ start_date: CURRENT, places: 5 }, { start_date: NEXT, places: 5 }],
    cohort_places: (op: Op) => (isHers(op) ? [] : world.counted),
    user_profiles: { email: EMAIL, first_name: "Sarah" },
  });
  f.counts.deposit_duplicate_payments = 0;
  f.rpcResults.cohort_warnings = { data: NO_WARNINGS, error: null };
  f.rpcResults.cohort_ensure = { data: { status: "ensured", places: 5 }, error: null };
  f.writeResults.deposit_links = linkWrite;
  f.writeResults.activity_logs = () => {
    h.seq.push("activity");
    return null;
  };
  const rpc = f.client.rpc.bind(f.client);
  Object.assign(f.client, {
    rpc: (fn: string, args: unknown) => {
      h.seq.push(`rpc:${fn}`);
      return rpc(fn as never, args as never);
    },
  });
  return f;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  vi.stubEnv("DEPOSIT_LINK_ENABLED", "true");
  vi.stubEnv("COHORTS_ENABLED", "true");
  log = vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
  h.gate = { userId: ADMIN, error: null };
  h.gateCalls = 0;
  h.clients = 0;
  h.clientThrows = false;
  h.stampThrows = false;
  h.revalidated = [];
  h.seq = [];
  h.sendEmail.mockReset();
  h.sendEmail.mockImplementation(async () => {
    h.seq.push("email");
    return { success: true, messageId: "m_1" };
  });
  world = { open: null, counted: [] };
  fake = makeFake();
  h.fake = fake;
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

/** Every write: a non-select op, or an RPC other than the read-only `cohort_warnings`. */
const writes = () => [
  ...fake.ops.filter((o) => o.kind !== "select").map((o) => `${o.kind}:${o.table}`),
  ...fake.rpcCalls.filter((c) => c.fn !== "cohort_warnings").map((c) => `rpc:${c.fn}`),
];
const linkInserts = () => writesTo(fake, "deposit_links").filter((o) => o.kind === "insert");
const stamps = () => writesTo(fake, "deposit_links").filter((o) => o.kind === "update" && payloadOf(o).last_emailed_at !== undefined);
const activity = () => writesTo(fake, "activity_logs").map((o) => o.payload);
const emailed = () => h.sendEmail.mock.calls.map(([params]) => params as { to: string; html: string; emailType: string; recipientUserId: string; subject: string });
const codeIn = (html: string) => /\/deposit\/([A-Za-z0-9_-]{43})"/.exec(html)?.[1] ?? null;
const offerGoodwill = () => {
  world = { ...world, counted: taken(CURRENT, 5) };
};

type Act = (id: string) => Promise<{ ok: boolean }>;
const ACTIONS: ReadonlyArray<readonly [string, Act]> = [
  ["sendDepositLink", (id) => sendDepositLink(id, { target: "current" })],
  ["copyDepositLink", (id) => copyDepositLink(id, { target: "current" })],
  ["takeDepositPaymentNow", (id) => takeDepositPaymentNow(id)],
  ["cancelDepositLink", (id) => cancelDepositLink(id)],
  ["markDepositPaid", (id) => markDepositPaid(id, { target: "current", note: "transfer ref JONES" })],
  ["recordDepositBankRefund", (id) => recordDepositBankRefund(id, { reason: "changed plans" })],
];

describe("the module", () => {
  it("exports exactly the six actions, each an async function (every export of a use-server file is public)", () => {
    expect(Object.keys(actions).sort()).toEqual(
      ["cancelDepositLink", "copyDepositLink", "markDepositPaid", "recordDepositBankRefund", "sendDepositLink", "takeDepositPaymentNow"],
    );
    for (const fn of Object.values(actions)) expect(fn.constructor.name).toBe("AsyncFunction");
  });
});

describe("every action — the gates, in order", () => {
  it.each(ACTIONS)("%s: DEPOSIT_LINK_ENABLED unset → deposit_disabled, no auth call, no client, no op", async (_name, act) => {
    vi.stubEnv("DEPOSIT_LINK_ENABLED", undefined);
    expect(await act(PARENT)).toEqual({ ok: false, error: "deposit_disabled" });
    expect([h.gateCalls, h.clients, fake.ops.length, fake.rpcCalls.length, h.sendEmail.mock.calls.length, h.revalidated.length]).toEqual([0, 0, 0, 0, 0, 0]);
  });

  it.each(ACTIONS)("%s: COHORTS_ENABLED off → deposit_disabled, no auth call, no client, no op", async (_name, act) => {
    vi.stubEnv("COHORTS_ENABLED", undefined);
    expect(await act(PARENT)).toEqual({ ok: false, error: "deposit_disabled" });
    expect([h.gateCalls, h.clients, fake.ops.length, fake.rpcCalls.length]).toEqual([0, 0, 0, 0]);
  });

  it.each(ACTIONS)("%s: not an admin → not_admin with zero ops", async (_name, act) => {
    h.gate = { userId: "", error: "Not authorized — admin role required" };
    expect(await act(PARENT)).toEqual({ ok: false, error: "not_admin" });
    expect(h.gateCalls).toBe(1);
    expect([h.clients, fake.ops.length, fake.rpcCalls.length, h.sendEmail.mock.calls.length]).toEqual([0, 0, 0, 0]);
  });

  it.each(ACTIONS.flatMap(([name, act]) => [["not a uuid", "sarah"], ["empty", ""], ["a path", "../x"], ["not a string", 7]].map(([label, id]) => [name, label, act, id] as const)))(
    "%s: a parent id that is %s → invalid with zero ops",
    async (_name, _label, act, id) => {
      expect(await act(id as string)).toEqual({ ok: false, error: "invalid" });
      expect([h.clients, fake.ops.length, fake.rpcCalls.length, h.sendEmail.mock.calls.length]).toEqual([0, 0, 0, 0]);
    },
  );

  it.each([
    ["send: no request", () => sendDepositLink(PARENT, null as never)],
    ["send: an unknown target", () => sendDepositLink(PARENT, { target: "next" } as never)],
    ["send: confirmResend not a boolean", () => sendDepositLink(PARENT, { target: "current", confirmResend: "yes" } as never)],
    ["send: an unknown choice", () => sendDepositLink(PARENT, { target: "current", onTargetDiffers: "merge" } as never)],
    ["copy: an unknown target", () => copyDepositLink(PARENT, { target: "" } as never)],
    ["copy: an unknown choice", () => copyDepositLink(PARENT, { target: "goodwill", onTargetDiffers: true } as never)],
    ["mark paid: an empty note", () => markDepositPaid(PARENT, { target: "current", note: "" })],
    ["mark paid: a blank note", () => markDepositPaid(PARENT, { target: "current", note: "   " })],
    ["mark paid: a note over 500 characters", () => markDepositPaid(PARENT, { target: "current", note: "x".repeat(501) })],
    ["mark paid: an unknown target", () => markDepositPaid(PARENT, { target: "later", note: "ref" } as never)],
    ["refund: a 2-character reason", () => recordDepositBankRefund(PARENT, { reason: "ab" })],
    ["refund: 2 characters once trimmed", () => recordDepositBankRefund(PARENT, { reason: "  ab  " })],
    ["refund: a reason over 500 characters", () => recordDepositBankRefund(PARENT, { reason: "x".repeat(501) })],
    ["refund: not a string", () => recordDepositBankRefund(PARENT, { reason: 7 } as never)],
  ])("%s → invalid with zero ops", async (_label, act) => {
    expect(await act()).toEqual({ ok: false, error: "invalid" });
    expect([h.clients, fake.ops.length, fake.rpcCalls.length]).toEqual([0, 0, 0]);
  });
});

describe("paid → already_paid before anything is made or emailed", () => {
  const PAID_STATES = [
    ["paid by card", paidRow()],
    ["paid by bank transfer", paidRow({ deposit_method: "bank_transfer", deposit_stripe_payment_intent_id: null })],
    ["refunded", paidRow({ deposit_refunded_at: "2027-02-03T08:00:00+00:00" })],
  ] as const;
  const TAKING: ReadonlyArray<readonly [string, () => Promise<{ ok: boolean }>]> = [
    ["send", () => sendDepositLink(PARENT, { target: "current", confirmResend: true })],
    ["copy", () => copyDepositLink(PARENT, { target: "current" })],
    ["take payment now", () => takeDepositPaymentNow(PARENT)],
    ["mark paid", () => markDepositPaid(PARENT, { target: "current", note: "ref JONES" })],
  ];
  it.each(TAKING.flatMap(([name, act]) => PAID_STATES.map(([state, row]) => [name, state, act, row] as const)))(
    "%s, %s → already_paid with zero writes",
    async (_name, _state, act, row) => {
      fake.reads.parent_subscriptions = row;
      expect(await act()).toEqual({ ok: false, error: "already_paid" });
      expect(writes()).toEqual([]);
      expect(h.sendEmail).not.toHaveBeenCalled();
      expect(h.revalidated).toEqual([]);
    },
  );
});

describe("sendDepositLink", () => {
  it("first send: makes the link, emails it once, then stamps it and logs one deposit.link_sent row", async () => {
    const res = await sendDepositLink(PARENT, { target: "current" });
    expect(res).toEqual({ ok: true, sentAt: NOW.toISOString(), to: MASKED });
    const [mail] = emailed();
    expect(emailed()).toHaveLength(1);
    expect(mail).toMatchObject({ to: EMAIL, emailType: "deposit_link", recipientUserId: PARENT });
    expect(mail.html).toContain("Hi Sarah,");
    const code = codeIn(mail.html);
    expect(code).toBe(payloadOf(linkInserts()[0]).code);
    expect(mail.html).toContain(`href="${URL_OF(code ?? "")}"`);
    expect(payloadOf(stamps()[0])).toEqual({ last_emailed_at: NOW.toISOString(), last_emailed_to: EMAIL });
    expect(stamps()[0].filters).toContainEqual(["eq", "id", NEW_LINK]);
    expect(activity()).toEqual([
      { user_id: PARENT, action_type: "deposit.link_sent", action_details: { link_id: NEW_LINK, target: "current", goodwill_cohort_start_date: null, actor: ADMIN } },
    ]);
    expect(JSON.stringify(activity())).not.toContain(EMAIL);
    expect(h.seq.filter((s) => !s.startsWith("rpc:cohort_warnings"))).toEqual(["insert", "email", "stamp", "activity"]);
    expect(h.revalidated).toEqual([PANEL_PATH]);
  });

  it("the same code on two sends; the second asks first (confirm_resend with the time), then sends on confirm", async () => {
    await sendDepositLink(PARENT, { target: "current" });
    const first = codeIn(emailed()[0].html);
    vi.setSystemTime(new Date("2027-02-03T10:05:00Z"));
    expect(await sendDepositLink(PARENT, { target: "current" })).toEqual({ ok: false, error: "confirm_resend", sentAt: NOW.toISOString() });
    expect(emailed()).toHaveLength(1);
    expect(await sendDepositLink(PARENT, { target: "current", confirmResend: true })).toEqual({ ok: true, sentAt: "2027-02-03T10:05:00.000Z", to: MASKED });
    expect(emailed()).toHaveLength(2);
    expect(codeIn(emailed()[1].html)).toBe(first);
    expect(linkInserts()).toHaveLength(1);
    expect(activity()).toHaveLength(2);
  });

  it.each([["confirmResend absent", undefined], ["confirmResend false", false]])(
    "an emailed link, %s → confirm_resend with its time; nothing sent or written",
    async (_label, confirmResend) => {
      world = { ...world, open: openRow({ last_emailed_at: "2027-02-03T09:02:00+00:00", last_emailed_to: EMAIL }) };
      expect(await sendDepositLink(PARENT, { target: "current", confirmResend })).toEqual({ ok: false, error: "confirm_resend", sentAt: "2027-02-03T09:02:00.000Z" });
      expect(h.sendEmail).not.toHaveBeenCalled();
      expect(writes()).toEqual([]);
      expect(h.revalidated).toEqual([]);
    },
  );

  it("a failed send → email_failed + the link's URL; no stamp, no activity row, nothing to revalidate", async () => {
    world = { ...world, open: openRow() };
    h.sendEmail.mockResolvedValue({ success: false, error: "provider said no" });
    expect(await sendDepositLink(PARENT, { target: "current" })).toEqual({ ok: false, error: "email_failed", url: URL_OF(CODE) });
    expect(writes()).toEqual([]);
    expect(h.revalidated).toEqual([]);
    expect(JSON.stringify(log.mock.calls)).not.toContain("provider said no");
  });

  it("a send that throws → email_failed + the URL, no stamp", async () => {
    world = { ...world, open: openRow() };
    h.sendEmail.mockRejectedValue(new Error(`bounced ${EMAIL}`));
    expect(await sendDepositLink(PARENT, { target: "current" })).toEqual({ ok: false, error: "email_failed", url: URL_OF(CODE) });
    expect(stamps()).toEqual([]);
    expect(activity()).toEqual([]);
    expect(JSON.stringify(log.mock.calls)).not.toContain(EMAIL);
  });

  it("a failed first send still leaves the new link (revalidated) and answers its URL; no stamp", async () => {
    h.sendEmail.mockResolvedValue({ success: false, error: "down" });
    const res = await sendDepositLink(PARENT, { target: "current" });
    expect(res).toEqual({ ok: false, error: "email_failed", url: URL_OF(String(payloadOf(linkInserts()[0]).code)) });
    expect(stamps()).toEqual([]);
    expect(activity()).toEqual([]);
    expect(h.revalidated).toEqual([PANEL_PATH]);
  });

  it.each([
    ["no profile row", null],
    ["a null email", { email: null, first_name: "Sarah" }],
    ["a blank email", { email: "   ", first_name: "Sarah" }],
    ["not an address", { email: "sarah", first_name: "Sarah" }],
    // 03b review LOW-2: one plain address only — never a list or a display-name form for the provider to expand.
    ["two addresses", { email: "a@b.com,c@d.com", first_name: "Sarah" }],
    ["a trailing comma", { email: "sarah@gmail.com,", first_name: "Sarah" }],
    ["a semicolon list", { email: "sarah@gmail.com;eve", first_name: "Sarah" }],
    ["angle brackets", { email: "<sarah@gmail.com>", first_name: "Sarah" }],
    ["a quoted local part", { email: '"sarah"@gmail.com', first_name: "Sarah" }],
    ["longer than EMAIL_MAX", { email: `${"s".repeat(EMAIL_MAX)}@gmail.com`, first_name: "Sarah" }],
  ])("%s → no_email; no link made, nothing sent", async (_label, profile) => {
    fake.reads.user_profiles = profile;
    expect(await sendDepositLink(PARENT, { target: "current" })).toEqual({ ok: false, error: "no_email" });
    expect(writes()).toEqual([]);
    expect(h.sendEmail).not.toHaveBeenCalled();
  });

  it("reads the address by her user id; a missing first name gets the plain greeting", async () => {
    fake.reads.user_profiles = { email: EMAIL, first_name: null };
    await sendDepositLink(PARENT, { target: "current" });
    const read = fake.ops.find((o) => o.table === "user_profiles");
    expect(read?.filters).toContainEqual(["eq", "user_id", PARENT]);
    expect(emailed()[0].html).toContain("Hello,");
  });

  it("a stamp that fails after the email went → still ok (the email is out), logged by code only", async () => {
    world = { ...world, open: openRow() };
    fake.writeErrors.deposit_links = { message: `bad ${EMAIL}`, code: "XX000" };
    expect(await sendDepositLink(PARENT, { target: "current" })).toEqual({ ok: true, sentAt: NOW.toISOString(), to: MASKED });
    expect(JSON.stringify(log.mock.calls)).not.toContain(EMAIL);
  });

  it("a stamp that throws after the email went → still ok, the history row still written, logged without the address", async () => {
    world = { ...world, open: openRow() };
    h.stampThrows = true;
    expect(await sendDepositLink(PARENT, { target: "current" })).toEqual({ ok: true, sentAt: NOW.toISOString(), to: MASKED });
    expect(emailed()).toHaveLength(1);
    expect(activity()).toHaveLength(1);
    expect(h.revalidated).toEqual([PANEL_PATH]);
    expect(log).toHaveBeenCalled();
    expect(JSON.stringify(log.mock.calls)).not.toContain(EMAIL);
  });

  it("an activity row that fails → still ok, logged by code only", async () => {
    fake.writeErrors.activity_logs = { message: `bad ${EMAIL}`, code: "23514" };
    expect((await sendDepositLink(PARENT, { target: "current" })).ok).toBe(true);
    expect(JSON.stringify(log.mock.calls)).not.toContain(EMAIL);
    expect(JSON.stringify(log.mock.calls)).toContain("23514");
  });
});

describe("goodwill (D10): only when offered; the date is the server's", () => {
  it("offered → pins next week's start with ensureCohort, then makes a goodwill link for it", async () => {
    offerGoodwill();
    expect((await sendDepositLink(PARENT, { target: "goodwill" })).ok).toBe(true);
    expect(fake.rpcCalls.find((c) => c.fn === "cohort_ensure")?.args).toEqual({ p_start: NEXT });
    expect(payloadOf(linkInserts()[0])).toMatchObject({ target: "goodwill", goodwill_cohort_start_date: NEXT, created_by: ADMIN });
    expect(h.seq.indexOf("rpc:cohort_ensure")).toBeLessThan(h.seq.indexOf("insert"));
    expect(activity()[0]).toMatchObject({ action_details: { target: "goodwill", goodwill_cohort_start_date: NEXT } });
  });

  it("the date never comes from the client", async () => {
    offerGoodwill();
    const res = await copyDepositLink(PARENT, { target: "goodwill", goodwillStartDate: "2027-03-01", startDate: "2027-03-01" } as never);
    expect(res.ok).toBe(true);
    expect(fake.rpcCalls.find((c) => c.fn === "cohort_ensure")?.args).toEqual({ p_start: NEXT });
    expect(payloadOf(linkInserts()[0]).goodwill_cohort_start_date).toBe(NEXT);
  });

  it.each([
    ["send", () => sendDepositLink(PARENT, { target: "goodwill" })],
    ["copy", () => copyDepositLink(PARENT, { target: "goodwill" })],
    ["mark paid", () => markDepositPaid(PARENT, { target: "goodwill", note: "ref" })],
  ])("%s: not offered (the current cohort has places) → goodwill_not_offered, zero writes", async (_label, act) => {
    expect(await act()).toEqual({ ok: false, error: "goodwill_not_offered" });
    expect(writes()).toEqual([]);
  });

  it.each([["not_bookable"], ["not_a_cohort"], ["invalid"]])("ensureCohort refuses (%s) → goodwill_not_offered, no link made", async (status) => {
    offerGoodwill();
    fake.rpcResults.cohort_ensure = { data: { status }, error: null };
    expect(await sendDepositLink(PARENT, { target: "goodwill" })).toEqual({ ok: false, error: "goodwill_not_offered" });
    expect(linkInserts()).toEqual([]);
    expect(h.sendEmail).not.toHaveBeenCalled();
  });

  it("ensureCohort fails → error, no link made", async () => {
    offerGoodwill();
    fake.rpcResults.cohort_ensure = { data: null, error: { message: "boom", code: "XX000" } };
    expect(await copyDepositLink(PARENT, { target: "goodwill" })).toEqual({ ok: false, error: "error" });
    expect(linkInserts()).toEqual([]);
  });
});

describe("target_differs: answered, nothing written, until BAI chooses", () => {
  it.each([
    ["send", () => sendDepositLink(PARENT, { target: "goodwill" })],
    ["copy", () => copyDepositLink(PARENT, { target: "goodwill" })],
  ])("%s goodwill with a current link open → target_differs; no pin, no link, no email", async (_label, act) => {
    offerGoodwill();
    world = { ...world, open: openRow() };
    expect(await act()).toEqual({ ok: false, error: "target_differs", openTarget: "current", openGoodwillStartDate: null });
    expect(writes()).toEqual([]);
    expect(h.sendEmail).not.toHaveBeenCalled();
    expect(h.revalidated).toEqual([]);
  });

  it("current with a goodwill link open → target_differs naming its pin", async () => {
    world = { ...world, open: openRow(GOODWILL_OPEN) };
    expect(await sendDepositLink(PARENT, { target: "current" })).toEqual({ ok: false, error: "target_differs", openTarget: "goodwill", openGoodwillStartDate: NEXT });
    expect(writes()).toEqual([]);
  });

  it("send_as_is → the open link, unchanged: its code, no new link, no cancel", async () => {
    world = { ...world, open: openRow(GOODWILL_OPEN) };
    expect((await sendDepositLink(PARENT, { target: "current", onTargetDiffers: "send_as_is" })).ok).toBe(true);
    expect(codeIn(emailed()[0].html)).toBe(CODE);
    expect(writes()).toEqual(["update:deposit_links", "insert:activity_logs"]);
    expect(activity()[0]).toMatchObject({ action_details: { link_id: LINK, target: "goodwill", goodwill_cohort_start_date: NEXT } });
  });

  it("replace → the open link cancelled, then a new code made and sent", async () => {
    world = { ...world, open: openRow(GOODWILL_OPEN) };
    expect((await sendDepositLink(PARENT, { target: "current", onTargetDiffers: "replace" })).ok).toBe(true);
    const fresh = codeIn(emailed()[0].html);
    expect(fresh).not.toBe(CODE);
    expect(fresh).toBe(payloadOf(linkInserts()[0]).code);
    expect(h.seq.filter((s) => s === "cancel" || s === "insert" || s === "email")).toEqual(["cancel", "insert", "email"]);
    expect(payloadOf(writesTo(fake, "deposit_links")[0])).toMatchObject({ state: "cancelled", cancelled_by: ADMIN });
  });

  it("copy replace → a new URL, no email", async () => {
    world = { ...world, open: openRow() };
    offerGoodwill();
    const res = await copyDepositLink(PARENT, { target: "goodwill", onTargetDiffers: "replace" });
    expect(res).toEqual({ ok: true, url: URL_OF(String(payloadOf(linkInserts()[0]).code)) });
    expect(h.sendEmail).not.toHaveBeenCalled();
    expect(h.revalidated).toEqual([PANEL_PATH]);
  });

  it("a choice with no difference is ignored: the matching open link is used", async () => {
    world = { ...world, open: openRow() };
    expect(await copyDepositLink(PARENT, { target: "current", onTargetDiffers: "replace" })).toEqual({ ok: true, url: URL_OF(CODE) });
    expect(writes()).toEqual([]);
  });
});

describe("copyDepositLink", () => {
  it("no link yet → makes one and answers its URL; no email, no stamp, no activity row", async () => {
    const res = await copyDepositLink(PARENT, { target: "current" });
    expect(res).toEqual({ ok: true, url: URL_OF(String(payloadOf(linkInserts()[0]).code)) });
    expect(h.sendEmail).not.toHaveBeenCalled();
    expect(writes()).toEqual(["insert:deposit_links"]);
    expect(h.revalidated).toEqual([PANEL_PATH]);
  });

  it("an open link → the same URL, nothing written or revalidated", async () => {
    world = { ...world, open: openRow({ last_emailed_at: "2027-02-03T09:02:00+00:00", last_emailed_to: EMAIL }) };
    expect(await copyDepositLink(PARENT, { target: "current" })).toEqual({ ok: true, url: URL_OF(CODE) });
    expect(writes()).toEqual([]);
    expect(h.revalidated).toEqual([]);
  });

  it("a panel read that fails → error, zero writes", async () => {
    fake.readErrors.parent_subscriptions = { message: "boom", code: "XX000" };
    expect(await copyDepositLink(PARENT, { target: "current" })).toEqual({ ok: false, error: "error" });
    expect(writes()).toEqual([]);
  });
});

describe("takeDepositPaymentNow (D15)", () => {
  it("no link → a new current link; answers exactly { ok, url }; no email, no stamp, no activity row", async () => {
    const res = await takeDepositPaymentNow(PARENT);
    expect(Object.keys(res)).toEqual(["ok", "url"]);
    if (!res.ok) throw new Error("expected ok");
    expect(res.url).toMatch(LINK_URL);
    expect(res.url).toBe(URL_OF(String(payloadOf(linkInserts()[0]).code)));
    expect(payloadOf(linkInserts()[0])).toMatchObject({ target: "current", goodwill_cohort_start_date: null });
    expect(writes()).toEqual(["insert:deposit_links"]);
    expect(h.sendEmail).not.toHaveBeenCalled();
    expect(h.revalidated).toEqual([PANEL_PATH]);
  });

  it.each([
    ["a current link", openRow()],
    ["a goodwill link (any target)", openRow(GOODWILL_OPEN)],
    ["an emailed link", openRow({ last_emailed_at: "2027-02-03T09:02:00+00:00", last_emailed_to: EMAIL })],
  ])("%s open → its URL, nothing written", async (_label, row) => {
    world = { ...world, open: row };
    expect(await takeDepositPaymentNow(PARENT)).toEqual({ ok: true, url: URL_OF(CODE) });
    expect(writes()).toEqual([]);
    expect(h.sendEmail).not.toHaveBeenCalled();
    expect(h.revalidated).toEqual([]);
  });

  it("the link store fails → error", async () => {
    fake.writeErrors.deposit_links = { message: "boom", code: "XX000" };
    expect(await takeDepositPaymentNow(PARENT)).toEqual({ ok: false, error: "error" });
    expect(h.revalidated).toEqual([]);
  });
});

describe("cancelDepositLink", () => {
  it("an open link → cancelled by the admin; revalidated", async () => {
    world = { ...world, open: openRow() };
    expect(await cancelDepositLink(PARENT)).toEqual({ ok: true, cancelled: true });
    expect(payloadOf(writesTo(fake, "deposit_links")[0])).toMatchObject({ state: "cancelled", cancelled_by: ADMIN });
    expect(h.revalidated).toEqual([PANEL_PATH]);
  });

  it("no open link → cancelled: false, nothing to revalidate", async () => {
    expect(await cancelDepositLink(PARENT)).toEqual({ ok: true, cancelled: false });
    expect(h.revalidated).toEqual([]);
  });

  it("the update fails → error", async () => {
    world = { ...world, open: openRow() };
    fake.writeErrors.deposit_links = { message: "boom", code: "XX000" };
    expect(await cancelDepositLink(PARENT)).toEqual({ ok: false, error: "error" });
    expect(h.revalidated).toEqual([]);
  });
});

describe("markDepositPaid", () => {
  const markReply = (data: unknown) => {
    fake.rpcResults.deposit_mark_bank_transfer = { data, error: null };
  };

  it("current → the bank-transfer RPC for the current cohort, the note trimmed, the admin as actor; revalidated", async () => {
    markReply({ status: "marked", place_id: "c0300000-0000-4000-8000-000000000201", cohort_start_date: CURRENT, is_goodwill: false });
    expect(await markDepositPaid(PARENT, { target: "current", note: "  transfer ref JONES  " })).toEqual({ ok: true });
    expect(fake.rpcCalls.find((c) => c.fn === "deposit_mark_bank_transfer")?.args).toEqual({
      p_parent: PARENT, p_start: CURRENT, p_goodwill: false, p_pence: PRICES.dfy.depositPence, p_note: "transfer ref JONES", p_actor: ADMIN, p_keep_status: false,
    });
    expect(h.revalidated).toEqual([PANEL_PATH]);
  });

  it("goodwill, offered → pinned, then marked for next week's cohort as goodwill", async () => {
    offerGoodwill();
    markReply({ status: "marked", place_id: "c0300000-0000-4000-8000-000000000202", cohort_start_date: NEXT, is_goodwill: true });
    expect(await markDepositPaid(PARENT, { target: "goodwill", note: "ref" })).toEqual({ ok: true });
    expect(fake.rpcCalls.find((c) => c.fn === "deposit_mark_bank_transfer")?.args).toMatchObject({ p_start: NEXT, p_goodwill: true });
    expect(h.seq.indexOf("rpc:cohort_ensure")).toBeLessThan(h.seq.indexOf("rpc:deposit_mark_bank_transfer"));
  });

  it("full → cohort_full; nothing written beyond the RPC, nothing revalidated", async () => {
    markReply({ status: "full", reason: "all_taken" });
    expect(await markDepositPaid(PARENT, { target: "current", note: "ref" })).toEqual({ ok: false, error: "cohort_full" });
    expect(writes()).toEqual(["rpc:deposit_mark_bank_transfer"]);
    expect(h.revalidated).toEqual([]);
  });

  it("full because the last place is being paid → being_paid", async () => {
    markReply({ status: "full", reason: "being_paid" });
    expect(await markDepositPaid(PARENT, { target: "current", note: "ref" })).toEqual({ ok: false, error: "being_paid" });
  });

  it.each([["already_paid"], ["not_bookable"], ["not_a_cohort"], ["already_taken"], ["invalid"]])("the RPC answers %s → the same", async (status) => {
    markReply({ status });
    expect(await markDepositPaid(PARENT, { target: "current", note: "ref" })).toEqual({ ok: false, error: status });
    expect(h.revalidated).toEqual([]);
  });

  it("no current cohort set up → not_bookable, no RPC", async () => {
    fake.reads.cohort_schedule = null;
    fake.reads.cohorts = [];
    expect(await markDepositPaid(PARENT, { target: "current", note: "ref" })).toEqual({ ok: false, error: "not_bookable" });
    expect(writes()).toEqual([]);
  });

  it("the RPC fails → error", async () => {
    fake.rpcResults.deposit_mark_bank_transfer = { data: null, error: { message: "boom", code: "XX000" } };
    expect(await markDepositPaid(PARENT, { target: "current", note: "ref" })).toEqual({ ok: false, error: "error" });
  });
});

describe("recordDepositBankRefund", () => {
  const refundReply = (data: unknown) => {
    fake.rpcResults.deposit_record_bank_refund = { data, error: null };
  };

  it("refunded → ok; the reason trimmed, the admin as actor; revalidated", async () => {
    refundReply({ status: "refunded", place: "reopened" });
    expect(await recordDepositBankRefund(PARENT, { reason: "  changed plans  " })).toEqual({ ok: true });
    expect(fake.rpcCalls.map((c) => c.args)).toEqual([{ p_parent: PARENT, p_reason: "changed plans", p_actor: ADMIN }]);
    expect(h.revalidated).toEqual([PANEL_PATH]);
  });

  it.each([["not_bank_transfer"], ["already_refunded"], ["invalid"]])("the RPC answers %s → the same, nothing revalidated", async (status) => {
    refundReply({ status });
    expect(await recordDepositBankRefund(PARENT, { reason: "changed plans" })).toEqual({ ok: false, error: status });
    expect(h.revalidated).toEqual([]);
  });

  it("the RPC fails → error", async () => {
    fake.rpcResults.deposit_record_bank_refund = { data: null, error: { message: "boom", code: "XX000" } };
    expect(await recordDepositBankRefund(PARENT, { reason: "changed plans" })).toEqual({ ok: false, error: "error" });
  });
});

describe("unexpected failures", () => {
  it.each(ACTIONS)("%s: the admin client can't be made → error, logged by error name only", async (_name, act) => {
    h.clientThrows = true;
    expect(await act(PARENT)).toEqual({ ok: false, error: "error" });
    expect(JSON.stringify(log.mock.calls)).not.toContain(EMAIL);
  });
});
