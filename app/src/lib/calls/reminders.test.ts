/**
 * The call-reminders cron's three passes (plan B2 + §12 R2, R3, R11; brief §0.4, §0.7, §9.4, §9.7).
 *
 *  - Parent: a call booked (or moved) more than 24 h ahead gets one `call_reminder` once now is in [start − 24 h, start).
 *  - Admin: one `admin_call_reminder` once now is in [start − 15 min, start).
 *  - Not booked: a parent in scope, signed up 30 min to 7 days ago, who has never had a real booking (R2), no answered
 *    call and isn't taken out, gets one `call_not_booked` — claimed by `call_nudges` (R3). Nothing until
 *    `enabled_since` is set (R11).
 * Every send is claimed first and released on a failed send, so the next run tries again; a claim another run holds
 * is skipped. Fixed clock: Thu 4 Feb 2027 10:00 London (GMT).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bookingRow, entryRow, fakeCallsRepo, type FakeCallsState } from "./fake-calls-repo.test-util";
import type { CallEmailSend } from "./mailer";
import type { ReminderKind, ReminderRepo } from "./repo";
import { runCallReminders, type ReminderDeps } from "./reminders";
import { CALL_SETTINGS_DEFAULTS } from "./settings";
import type { CallBooking, CallsResult, ParentContact, ScopeParent } from "./types";

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const SWITCH_ON = "2027-02-01T09:00:00.000Z";
const T0 = Date.parse("2027-02-04T10:00:00.000Z");
const iso = (ms: number) => new Date(ms).toISOString();

const JANE = "b0400000-0000-4000-8000-000000000001";
const contact = (userId: string, firstName = "Jane"): ParentContact => ({
  userId,
  firstName,
  lastName: "Smith",
  email: `${firstName.toLowerCase()}@example.com`,
  mobile: "+447700900123",
  isTestUser: false,
});
const scope = (userId: string, signedUpAt: string, signupSource: string | null = "advanced_match"): ScopeParent => ({ userId, signupSource, signedUpAt });

/** In-memory claims over the same bookings the fake calls repo holds. */
function fakeReminders(state: FakeCallsState, failing: { claims?: boolean } = {}) {
  const stamps = new Map<string, string>();
  const nudges = new Map<string, string>();
  const ok = <T>(value: T): CallsResult<T> => ({ ok: true, value });
  const key = (kind: ReminderKind, id: string) => `${kind}:${id}`;
  const repo: ReminderRepo = {
    readUnremindedCalls: async (kind, w) =>
      ok(state.bookings.filter((b) => b.status === "booked" && b.startsAt > w.after && b.startsAt <= w.until && !stamps.has(key(kind, b.id)))),
    claimReminder: async (kind, b, stamp) => {
      if (failing.claims) return { ok: false, error: "error" };
      if (stamps.has(key(kind, b.id))) return ok(false);
      stamps.set(key(kind, b.id), stamp);
      return ok(true);
    },
    releaseReminder: async (kind, id, stamp) => {
      if (stamps.get(key(kind, id)) === stamp) stamps.delete(key(kind, id));
      return ok(true as const);
    },
    readNudgedParents: async (ids) => ok(new Set(ids.filter((id) => nudges.has(id)))),
    claimNudge: async (id, stamp) => {
      if (failing.claims) return { ok: false, error: "error" };
      if (nudges.has(id)) return ok(false);
      nudges.set(id, stamp);
      return ok(true);
    },
    releaseNudge: async (id, stamp) => {
      if (nudges.get(id) === stamp) nudges.delete(id);
      return ok(true as const);
    },
  };
  return { repo, stamps, nudges };
}

function setup(seed: Partial<FakeCallsState> = {}, opts: { failingClaims?: boolean } = {}) {
  const fake = fakeCallsRepo({ settings: { ...CALL_SETTINGS_DEFAULTS, enabledSince: SWITCH_ON }, contacts: [contact(JANE)], ...seed });
  const reminders = fakeReminders(fake.state, { claims: opts.failingClaims });
  const send = vi.fn<CallEmailSend>(async () => ({ success: true }));
  let now = T0;
  const deps: ReminderDeps = {
    repo: fake.repo,
    reminders: reminders.repo,
    now: () => new Date(now),
    notify: async () => {},
    prebookRequests: async () => new Map(),
    send,
  };
  const at = (ms: number) => {
    now = ms;
  };
  const sentTypes = () => send.mock.calls.map(([m]) => m.emailType);
  return { fake, reminders, send, deps, at, sentTypes };
}

/** A booked first call, booked `aheadMs` before it starts. */
const booked = (startsAtMs: number, aheadMs: number, over: Partial<CallBooking> = {}) =>
  bookingRow({ parentUserId: JANE, startsAt: iso(startsAtMs), bookedAt: iso(startsAtMs - aheadMs), createdAt: iso(startsAtMs - aheadMs), ...over });

beforeEach(() => vi.stubEnv("CALL_BOOKING_ENABLED", "true"));
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("the switch and the settings", () => {
  it("off → call_booking_disabled, zero repo calls, nothing sent", async () => {
    vi.stubEnv("CALL_BOOKING_ENABLED", "");
    const { fake, deps, send } = setup();
    expect(await runCallReminders(deps)).toEqual({ ok: false, error: "call_booking_disabled" });
    expect(fake.calls).toEqual([]);
    expect(send).not.toHaveBeenCalled();
  });

  it("the settings can't be read → error, nothing sent", async () => {
    const { deps, send } = setup({ failing: ["readSettings"] });
    expect(await runCallReminders(deps)).toEqual({ ok: false, error: "error" });
    expect(send).not.toHaveBeenCalled();
  });
});

describe("parent reminder (brief §9.7)", () => {
  const START = T0 + 3 * DAY;

  it("booked 3 days ahead → one call_reminder at T−24 h, never again", async () => {
    const s = setup({ bookings: [booked(START, 3 * DAY)] });
    s.at(START - DAY - 5 * MIN);
    await runCallReminders(s.deps);
    expect(s.sentTypes()).toEqual([]);
    for (const t of [START - DAY, START - DAY + 5 * MIN, START - 2 * HOUR]) {
      s.at(t);
      await runCallReminders(s.deps);
    }
    expect(s.sentTypes().filter((t) => t === "call_reminder")).toHaveLength(1);
    const [mail] = s.send.mock.calls[0];
    expect(mail).toMatchObject({ to: "jane@example.com", recipientUserId: JANE, emailType: "call_reminder" });
    expect(mail.subject).toBe("Reminder: your Complimentary matchmaker call, Sunday 7 February, 10:00");
  });

  it("booked 3 hours ahead → no call_reminder", async () => {
    const s = setup({ bookings: [booked(T0 + 3 * HOUR, 3 * HOUR)] });
    s.at(T0 + HOUR);
    await runCallReminders(s.deps);
    expect(s.sentTypes()).not.toContain("call_reminder");
  });

  it("moved within 24 h of the new time → none; moved more than 24 h ahead → one (from moved_at)", async () => {
    const lateMove = setup({ bookings: [booked(START, 5 * DAY, { movedAt: iso(START - 10 * HOUR), movedFromStartsAt: iso(START + DAY) })] });
    lateMove.at(START - 9 * HOUR);
    await runCallReminders(lateMove.deps);
    expect(lateMove.sentTypes()).not.toContain("call_reminder");
    const earlyMove = setup({ bookings: [booked(START, 3 * DAY, { movedAt: iso(START - 2 * DAY), movedFromStartsAt: iso(START - DAY) })] });
    earlyMove.at(START - 9 * HOUR);
    await runCallReminders(earlyMove.deps);
    expect(earlyMove.sentTypes()).toContain("call_reminder");
  });

  it("the window is [start − 24 h, start): at the start itself, nothing", async () => {
    const s = setup({ bookings: [booked(START, 3 * DAY)] });
    s.at(START);
    await runCallReminders(s.deps);
    expect(s.sentTypes()).toEqual([]);
  });

  it("a failed send releases the claim, so the next run sends it", async () => {
    const s = setup({ bookings: [booked(START, 3 * DAY)] });
    vi.spyOn(console, "error").mockImplementation(() => {});
    s.send.mockResolvedValueOnce({ success: false, error: "x" });
    s.at(START - 23 * HOUR);
    const first = await runCallReminders(s.deps);
    expect(first.ok && first.value.parent).toEqual({ sent: 0, failed: 1, readFailed: false });
    expect(s.reminders.stamps.size).toBe(0);
    s.at(START - 23 * HOUR + 5 * MIN);
    await runCallReminders(s.deps);
    expect(s.sentTypes().filter((t) => t === "call_reminder")).toHaveLength(2);
    expect(s.reminders.stamps.has(`parent:${s.fake.state.bookings[0].id}`)).toBe(true);
  });

  it("a claim another run holds is skipped (nothing sent, nothing counted); a failed claim is counted and sends nothing", async () => {
    const held = setup({ bookings: [booked(START, 3 * DAY)] });
    held.at(START - 23 * HOUR);
    const run = await runCallReminders({ ...held.deps, reminders: { ...held.deps.reminders, claimReminder: async () => ({ ok: true, value: false }) } });
    expect(run.ok && run.value.parent).toEqual({ sent: 0, failed: 0, readFailed: false });
    expect(held.send).not.toHaveBeenCalled();
    const failing = setup({ bookings: [booked(START, 3 * DAY)] }, { failingClaims: true });
    failing.at(START - 23 * HOUR);
    const failed = await runCallReminders(failing.deps);
    expect(failed.ok && failed.value.parent).toEqual({ sent: 0, failed: 1, readFailed: false });
    expect(failing.send).not.toHaveBeenCalled();
  });

  it("a family BAI has taken out (Deposit taken) gets no reminder; no contact → counted, nothing claimed", async () => {
    const out = setup({
      bookings: [booked(START, 3 * DAY)],
      entries: [entryRow({ parentUserId: JANE, occurredAt: iso(T0), result: "answered", outcome: "deposit_taken" })],
    });
    out.at(START - 23 * HOUR);
    await runCallReminders(out.deps);
    expect(out.send).not.toHaveBeenCalled();
    vi.spyOn(console, "error").mockImplementation(() => {});
    const noContact = setup({ bookings: [booked(START, 3 * DAY)], contacts: [] });
    noContact.at(START - 23 * HOUR);
    const run = await runCallReminders(noContact.deps);
    expect(run.ok && run.value.parent).toEqual({ sent: 0, failed: 1, readFailed: false });
    expect(noContact.reminders.stamps.has(`parent:${noContact.fake.state.bookings[0].id}`)).toBe(false);
  });
});

describe("admin reminder (brief §9.7)", () => {
  const START = T0 + 3 * DAY;

  it("one admin_call_reminder once now is within 15 min of the start, each call once", async () => {
    vi.stubEnv("ADMIN_EMAIL", "ops@example.test");
    const s = setup({ bookings: [booked(START, 3 * DAY)] });
    for (const t of [START - 20 * MIN, START - 15 * MIN, START - 10 * MIN, START - 5 * MIN]) {
      s.at(t);
      await runCallReminders(s.deps);
    }
    const admin = s.send.mock.calls.map(([m]) => m).filter((m) => m.emailType === "admin_call_reminder");
    expect(admin).toHaveLength(1);
    expect(admin[0]).toMatchObject({ to: "ops@example.test", subject: "Matchmaker call soon: Jane Smith, Sun 7 Feb, 10:00" });
  });

  it("even for a call booked 10 minutes ahead, and with no contact row ('(no name)')", async () => {
    const s = setup({ bookings: [booked(T0 + 10 * MIN, 10 * MIN)], contacts: [] });
    await runCallReminders(s.deps);
    const [admin] = s.send.mock.calls.map(([m]) => m).filter((m) => m.emailType === "admin_call_reminder");
    expect(admin.subject).toContain("(no name)");
  });
});

describe("not booked (brief §9.4; R2, R3, R11)", () => {
  const signedUp = iso(T0 - 31 * MIN);

  it("six runs → exactly one call_not_booked; the parent stays listed", async () => {
    const s = setup({ scope: [scope(JANE, signedUp)] });
    for (let n = 0; n < 6; n += 1) {
      s.at(T0 + n * 5 * MIN);
      await runCallReminders(s.deps);
    }
    expect(s.sentTypes()).toEqual(["call_not_booked"]);
    expect(s.send.mock.calls[0][0]).toMatchObject({ to: "jane@example.com", recipientUserId: JANE });
    expect(s.reminders.nudges.has(JANE)).toBe(true);
  });

  it("not before 30 minutes after sign-up, and not past 7 days", async () => {
    const early = setup({ scope: [scope(JANE, iso(T0 - 20 * MIN))] });
    await runCallReminders(early.deps);
    expect(early.send).not.toHaveBeenCalled();
    const old = setup({ scope: [scope(JANE, iso(T0 - 8 * DAY))], settings: { ...CALL_SETTINGS_DEFAULTS, enabledSince: iso(T0 - 30 * DAY) } });
    await runCallReminders(old.deps);
    expect(old.send).not.toHaveBeenCalled();
  });

  it("a parent who signed up before the switch-on date gets nothing; with enabled_since unset nobody does (R11)", async () => {
    const before = setup({ scope: [scope(JANE, iso(Date.parse(SWITCH_ON) - MIN))] });
    await runCallReminders(before.deps);
    expect(before.send).not.toHaveBeenCalled();
    const unset = setup({ scope: [scope(JANE, signedUp)], settings: CALL_SETTINGS_DEFAULTS });
    await runCallReminders(unset.deps);
    expect(unset.send).not.toHaveBeenCalled();
    expect(unset.fake.calls.map((c) => c.method)).not.toContain("readScopeParents");
  });

  it("an invite sign-up is out of scope", async () => {
    const s = setup({ scope: [scope(JANE, signedUp, "nanny_invite")] });
    await runCallReminders(s.deps);
    expect(s.send).not.toHaveBeenCalled();
  });

  it("R2: booked then No answer → none; booked then cancelled → none", async () => {
    const noAnswer = setup({
      scope: [scope(JANE, signedUp)],
      bookings: [bookingRow({ parentUserId: JANE, startsAt: iso(T0 - 10 * MIN), bookedAt: iso(T0 - 29 * MIN), status: "no_answer", closedAt: iso(T0 - 5 * MIN) })],
      entries: [entryRow({ parentUserId: JANE, occurredAt: iso(T0 - 5 * MIN), result: "no_answer" })],
    });
    await runCallReminders(noAnswer.deps);
    expect(noAnswer.send).not.toHaveBeenCalled();
    const cancelled = setup({
      scope: [scope(JANE, signedUp)],
      bookings: [
        bookingRow({ parentUserId: JANE, startsAt: iso(T0 + DAY), bookedAt: iso(T0 - 29 * MIN), status: "cancelled", cancelReason: "parent", cancelledAt: iso(T0 - 2 * MIN) }),
      ],
    });
    await runCallReminders(cancelled.deps);
    expect(cancelled.send).not.toHaveBeenCalled();
  });

  it("R2: a hold that ran out was never a booking → she still gets it", async () => {
    const s = setup({
      scope: [scope(JANE, signedUp)],
      bookings: [
        bookingRow({ parentUserId: JANE, startsAt: iso(T0 + DAY), bookedAt: null, status: "cancelled", cancelReason: "hold_expired", cancelledAt: iso(T0 - 20 * MIN) }),
      ],
    });
    await runCallReminders(s.deps);
    expect(s.sentTypes()).toEqual(["call_not_booked"]);
  });

  it("an answered call, or Stop calling, → none; a live hold → not this run, the next one", async () => {
    const answered = setup({
      scope: [scope(JANE, signedUp)],
      entries: [entryRow({ parentUserId: JANE, occurredAt: iso(T0 - 10 * MIN), result: "answered", outcome: "call_back_later" })],
    });
    await runCallReminders(answered.deps);
    const stopped = setup({
      scope: [scope(JANE, signedUp)],
      entries: [entryRow({ parentUserId: JANE, occurredAt: iso(T0 - 10 * MIN), result: null, outcome: "stop_calling" })],
    });
    await runCallReminders(stopped.deps);
    expect(answered.send).not.toHaveBeenCalled();
    expect(stopped.send).not.toHaveBeenCalled();
    const holding = setup({
      scope: [scope(JANE, signedUp)],
      bookings: [bookingRow({ parentUserId: JANE, startsAt: iso(T0 + DAY), bookedAt: null, status: "held", holdExpiresAt: iso(T0 + 3 * MIN) })],
    });
    await runCallReminders(holding.deps);
    expect(holding.send).not.toHaveBeenCalled();
    holding.at(T0 + 5 * MIN);
    await runCallReminders(holding.deps);
    expect(holding.sentTypes()).toEqual(["call_not_booked"]);
  });

  it("a failed send releases the claim, and the next run sends it once", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const s = setup({ scope: [scope(JANE, signedUp)] });
    s.send.mockResolvedValueOnce({ success: false, error: "x" });
    const first = await runCallReminders(s.deps);
    expect(first.ok && first.value.notBooked).toEqual({ sent: 0, failed: 1, readFailed: false });
    expect(s.reminders.nudges.has(JANE)).toBe(false);
    s.at(T0 + 5 * MIN);
    const second = await runCallReminders(s.deps);
    expect(second.ok && second.value.notBooked).toEqual({ sent: 1, failed: 0, readFailed: false });
  });

  it("already claimed (another run, or an earlier one) → skipped without a claim attempt", async () => {
    const s = setup({ scope: [scope(JANE, signedUp)] });
    s.reminders.nudges.set(JANE, "earlier");
    const claim = vi.spyOn(s.reminders.repo, "claimNudge");
    await runCallReminders(s.deps);
    expect(claim).not.toHaveBeenCalled();
    expect(s.send).not.toHaveBeenCalled();
  });

  it("a scope read failure is reported, and the reminder passes still run", async () => {
    const START = T0 + 3 * DAY;
    const s = setup({ scope: [scope(JANE, signedUp)], bookings: [booked(START, 3 * DAY)], failing: ["readScopeParents"] });
    s.at(START - 23 * HOUR);
    const run = await runCallReminders(s.deps);
    expect(run.ok && run.value.notBooked.readFailed).toBe(true);
    expect(s.sentTypes()).toEqual(["call_reminder"]);
  });
});

describe("read failures", () => {
  it("each pass reports its own; nothing is sent from a pass that couldn't read", async () => {
    const s = setup({ scope: [scope(JANE, iso(T0 - 31 * MIN))] });
    const run = await runCallReminders({ ...s.deps, reminders: { ...s.deps.reminders, readUnremindedCalls: async () => ({ ok: false, error: "error" }) } });
    expect(run.ok && [run.value.parent.readFailed, run.value.admin.readFailed, run.value.notBooked.readFailed]).toEqual([true, true, false]);
    expect(s.sentTypes()).toEqual(["call_not_booked"]);
  });

  it("the family facts failing → that pass reports it", async () => {
    const s = setup({ scope: [scope(JANE, iso(T0 - 31 * MIN))], bookings: [booked(T0 + 10 * MIN, 3 * DAY)], failing: ["readBookingsForParents"] });
    const run = await runCallReminders(s.deps);
    expect(run.ok && [run.value.parent.readFailed, run.value.admin.readFailed, run.value.notBooked.readFailed]).toEqual([true, true, true]);
    expect(s.send).not.toHaveBeenCalled();
  });

  it("the nudged-parents read failing → reported, nothing sent", async () => {
    const s = setup({ scope: [scope(JANE, iso(T0 - 31 * MIN))] });
    const run = await runCallReminders({ ...s.deps, reminders: { ...s.deps.reminders, readNudgedParents: async () => ({ ok: false, error: "error" }) } });
    expect(run.ok && run.value.notBooked.readFailed).toBe(true);
    expect(s.send).not.toHaveBeenCalled();
  });
});

describe("two runs at once (review F8c)", () => {
  const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

  it("each read and claim yields, so the runs interleave; the claim is a compare-and-set, so each email goes once", async () => {
    const START = T0 + 23 * HOUR;
    const OTHER = "b0400000-0000-4000-8000-000000000002";
    const NEW = "b0400000-0000-4000-8000-000000000003";
    const s = setup({
      bookings: [booked(START, 3 * DAY), bookingRow({ parentUserId: OTHER, startsAt: iso(T0 + 10 * MIN), bookedAt: iso(T0 - HOUR), createdAt: iso(T0 - HOUR) })],
      contacts: [contact(JANE), contact(OTHER, "Olive"), contact(NEW, "Nina")],
      scope: [scope(NEW, iso(T0 - 31 * MIN))],
    });
    const base = s.reminders.repo;
    const attempts = { parent: 0, admin: 0, nudge: 0 };
    const yielding: ReminderRepo = {
      readUnremindedCalls: async (kind, w) => {
        await tick();
        return base.readUnremindedCalls(kind, w);
      },
      claimReminder: async (kind, b, stamp) => {
        attempts[kind] += 1;
        await tick();
        return base.claimReminder(kind, b, stamp);
      },
      releaseReminder: base.releaseReminder,
      readNudgedParents: async (ids) => {
        await tick();
        return base.readNudgedParents(ids);
      },
      claimNudge: async (id, stamp) => {
        attempts.nudge += 1;
        await tick();
        return base.claimNudge(id, stamp);
      },
      releaseNudge: base.releaseNudge,
    };
    const deps = { ...s.deps, reminders: yielding };
    await Promise.all([runCallReminders(deps), runCallReminders(deps)]);
    expect(attempts).toEqual({ parent: 2, admin: 2, nudge: 2 });
    expect([...s.sentTypes()].sort()).toEqual(["admin_call_reminder", "call_not_booked", "call_reminder"]);
  });
});
