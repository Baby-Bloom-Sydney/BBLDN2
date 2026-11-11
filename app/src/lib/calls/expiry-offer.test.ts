/**
 * The call offer in the family's connection-expiry email follows the call page's own rule, so the email never links
 * a page that would turn her away: the switch on; the call offered (in scope; never after an answered call or Stop
 * calling); no booked call; and no hired or connected nanny, read with the admin client (the cron has no session).
 * Any read that fails or throws → no offer.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CONNECTION_STAGE } from "@/lib/position/constants";
import type { CallsDeps } from "./deps";
import { callOfferForExpiredFamily, type AdminReader, type ExpiryOfferDeps } from "./expiry-offer";
import { bookingRow, entryRow, fakeCallsRepo, type FakeCallsState } from "./fake-calls-repo.test-util";
import { loadHubCall, type HubCall } from "./parent-state";
import { CALL_SETTINGS_DEFAULTS } from "./settings";

const HER = "b0400000-0000-4000-8000-000000000001";
const HER_PARENT_ID = "p-her";
const NOW = new Date("2027-02-04T10:00:00.000Z");
const STARTED = { ...CALL_SETTINGS_DEFAULTS, enabledSince: "2026-09-01T09:00:00.000Z" };
const SCOPE = { userId: HER, signupSource: "advanced_match", signedUpAt: "2026-09-03T10:00:00.000Z" };

type Row = Readonly<Record<string, unknown>>;
interface AdminSeed {
  readonly placements?: readonly Row[];
  readonly connections?: readonly Row[];
  /** This table's read answers with an error. */
  readonly failing?: string;
  /** Reading this table throws. */
  readonly throwing?: string;
}

/** The two reads the rule makes, with eq / gte / not-in / limit applied as Postgres would. */
function fakeAdmin(seed: AdminSeed = {}) {
  const reads: string[] = [];
  const tables: Readonly<Record<string, readonly Row[]>> = {
    nanny_placements: seed.placements ?? [],
    connection_requests: seed.connections ?? [],
  };
  const from = (table: string) => {
    reads.push(table);
    if (seed.throwing === table) throw new Error("network down");
    const filters: Array<(r: Row) => boolean> = [];
    let max = Number.POSITIVE_INFINITY;
    const result = () =>
      seed.failing === table
        ? { data: null, error: { code: "57014", message: "canceling statement due to statement timeout" } }
        : { data: (tables[table] ?? []).filter((r) => filters.every((f) => f(r))).slice(0, max), error: null };
    const b = {
      select: () => b,
      eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), b),
      gte: (c: string, v: number) => (filters.push((r) => Number(r[c]) >= v), b),
      not: (c: string, op: string, list: string) => {
        if (op !== "in") throw new Error(`unsupported not(${op})`);
        const out = new Set(list.replace(/[()]/g, "").split(",").map(Number));
        filters.push((r) => !out.has(Number(r[c])));
        return b;
      },
      limit: (n: number) => ((max = n), b),
      then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => Promise.resolve(result()).then(resolve, reject),
    };
    return b;
  };
  return { admin: { from } as unknown as AdminReader, reads };
}

function setup(over: { calls?: Partial<FakeCallsState>; admin?: AdminSeed } = {}) {
  const fake = fakeCallsRepo({ settings: STARTED, scope: [SCOPE], ...over.calls });
  const callsDeps: CallsDeps = { repo: fake.repo, now: () => NOW, notify: async () => {}, prebookRequests: async () => new Map() };
  const hub = vi.fn((id: string) => loadHubCall(id, callsDeps));
  const { admin, reads } = fakeAdmin(over.admin);
  const makeAdmin = vi.fn(() => admin);
  const deps: ExpiryOfferDeps = { hub, admin: makeAdmin };
  return { deps, hub, makeAdmin, reads };
}

const connection = (stage: number, parentId = HER_PARENT_ID): Row => ({ id: `c-${stage}`, parent_id: parentId, connection_stage: stage });
const placement = (status: string, parentId = HER_PARENT_ID): Row => ({ id: `pl-${status}`, parent_id: parentId, status });

let errors: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.stubEnv("CALL_BOOKING_ENABLED", "true");
  errors = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  errors.mockRestore();
});

describe("callOfferForExpiredFamily — offered", () => {
  it("all clear → true; the hub is read for her user id and both nanny reads for her parents row", async () => {
    const s = setup();
    expect(await callOfferForExpiredFamily(HER, HER_PARENT_ID, s.deps)).toBe(true);
    expect(s.hub).toHaveBeenCalledWith(HER);
    expect([...s.reads].sort()).toEqual(["connection_requests", "nanny_placements"]);
  });

  it("another family's placement or connected nanny doesn't count", async () => {
    const s = setup({ admin: { placements: [placement("active", "p-other")], connections: [connection(20, "p-other")] } });
    expect(await callOfferForExpiredFamily(HER, HER_PARENT_ID, s.deps)).toBe(true);
  });

  it("an ended placement doesn't count", async () => {
    const s = setup({ admin: { placements: [placement("ended")] } });
    expect(await callOfferForExpiredFamily(HER, HER_PARENT_ID, s.deps)).toBe(true);
  });

  it.each([
    ["a request sent", CONNECTION_STAGE.REQUEST_SENT],
    ["an accepted request, no meet booked", CONNECTION_STAGE.ACCEPTED],
    ["not hired", CONNECTION_STAGE.NOT_HIRED],
    ["not selected", CONNECTION_STAGE.NOT_SELECTED],
    ["active", CONNECTION_STAGE.ACTIVE],
    ["finished", CONNECTION_STAGE.FINISHED],
    ["cancelled by the family", CONNECTION_STAGE.CANCELLED_BY_PARENT],
    ["cancelled by the nanny", CONNECTION_STAGE.CANCELLED_BY_NANNY],
  ])("a nanny only at %s (stage %i) is not a connected nanny → still true", async (_label, stage) => {
    const s = setup({ admin: { connections: [connection(stage)] } });
    expect(await callOfferForExpiredFamily(HER, HER_PARENT_ID, s.deps)).toBe(true);
  });
});

describe("callOfferForExpiredFamily — not offered", () => {
  it("switch off → false, with no reads", async () => {
    vi.stubEnv("CALL_BOOKING_ENABLED", "");
    const s = setup();
    expect(await callOfferForExpiredFamily(HER, HER_PARENT_ID, s.deps)).toBe(false);
    expect(s.hub).not.toHaveBeenCalled();
    expect(s.makeAdmin).not.toHaveBeenCalled();
  });

  it.each([
    ["this month", "2027-02-02T11:00:00.000Z"],
    ["months ago", "2026-10-05T11:00:00.000Z"],
  ])("an answered call (%s) → false", async (_when, occurredAt) => {
    const s = setup({ calls: { entries: [entryRow({ parentUserId: HER, occurredAt, result: "answered" })] } });
    expect(await callOfferForExpiredFamily(HER, HER_PARENT_ID, s.deps)).toBe(false);
  });

  it("Stop calling → false", async () => {
    const entry = entryRow({ parentUserId: HER, occurredAt: "2026-12-01T11:00:00.000Z", result: "no_answer", outcome: "stop_calling" });
    const s = setup({ calls: { entries: [entry] } });
    expect(await callOfferForExpiredFamily(HER, HER_PARENT_ID, s.deps)).toBe(false);
  });

  it("out of scope (signed up from an invite) → false", async () => {
    const s = setup({ calls: { scope: [{ ...SCOPE, signupSource: "parent_invite" }] } });
    expect(await callOfferForExpiredFamily(HER, HER_PARENT_ID, s.deps)).toBe(false);
  });

  it("a booked call → false, though the call is still offered", async () => {
    const s = setup({ calls: { bookings: [bookingRow({ parentUserId: HER, startsAt: "2027-02-09T14:00:00.000Z" })] } });
    const hub: HubCall = await s.hub(HER);
    expect(hub).toMatchObject({ offered: true, card: { kind: "booked" } });
    expect(await callOfferForExpiredFamily(HER, HER_PARENT_ID, s.deps)).toBe(false);
  });

  it("an active placement (a hired nanny) → false", async () => {
    const s = setup({ admin: { placements: [placement("active")] } });
    expect(await callOfferForExpiredFamily(HER, HER_PARENT_ID, s.deps)).toBe(false);
  });

  it.each([
    ["a meet booked", CONNECTION_STAGE.INTRO_SCHEDULED],
    ["a trial arranged", CONNECTION_STAGE.TRIAL_ARRANGED],
    ["an offer made", CONNECTION_STAGE.OFFERED],
  ])("a connected nanny (%s, stage %i) → false", async (_label, stage) => {
    const s = setup({ admin: { connections: [connection(CONNECTION_STAGE.REQUEST_SENT), connection(stage)] } });
    expect(await callOfferForExpiredFamily(HER, HER_PARENT_ID, s.deps)).toBe(false);
  });
});

describe("callOfferForExpiredFamily — a read that fails or throws → no offer", () => {
  it("a failed hub read → false, with no nanny reads", async () => {
    const s = setup({ calls: { failing: ["readSettings"] } });
    expect(await callOfferForExpiredFamily(HER, HER_PARENT_ID, s.deps)).toBe(false);
    expect(s.reads).toEqual([]);
  });

  it.each(["nanny_placements", "connection_requests"])("a failed %s read → false (logged)", async (table) => {
    const s = setup({ admin: { failing: table } });
    expect(await callOfferForExpiredFamily(HER, HER_PARENT_ID, s.deps)).toBe(false);
    expect(errors).toHaveBeenCalled();
  });

  it("a thrown read → false, logged by the error's name only", async () => {
    const s = setup({ admin: { throwing: "connection_requests" } });
    expect(await callOfferForExpiredFamily(HER, HER_PARENT_ID, s.deps)).toBe(false);
    expect(errors).toHaveBeenCalledWith(expect.any(String), { name: "Error" });
    expect(JSON.stringify(errors.mock.calls)).not.toContain("network down");
  });

  it("a hub that throws → false", async () => {
    const s = setup();
    const deps: ExpiryOfferDeps = { ...s.deps, hub: async () => Promise.reject(new TypeError("fetch failed")) };
    expect(await callOfferForExpiredFamily(HER, HER_PARENT_ID, deps)).toBe(false);
    expect(errors).toHaveBeenCalledWith(expect.any(String), { name: "TypeError" });
  });

  it("no admin client (missing credentials) → false", async () => {
    const s = setup();
    const deps: ExpiryOfferDeps = {
      ...s.deps,
      admin: () => {
        throw new Error("Missing Supabase admin credentials");
      },
    };
    expect(await callOfferForExpiredFamily(HER, HER_PARENT_ID, deps)).toBe(false);
  });
});
