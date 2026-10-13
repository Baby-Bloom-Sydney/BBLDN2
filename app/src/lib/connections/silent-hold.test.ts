/**
 * Unit 3d (BB-LDN-3d-141026) — README P-14 (BAI 2026-10-14): a barred nanny loses every connection, hired ones too,
 * at any stage and any level, and the admin alert (VER-011) lists each family so the team contacts them. P-9 still
 * holds for the automated side: parents get no message and no reason. Written red first.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMemoryDb, type MemoryDb } from "../../../tests/fakes/memory-supabase";

const h = vi.hoisted(() => ({
  db: null as unknown as MemoryDb,
  sendBarredAdminAlert: vi.fn(async () => {}),
  createInboxMessage: vi.fn(async () => {}),
  sendEmail: vi.fn(async () => ({ success: true })),
}));

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => h.db.client() }));
vi.mock("@/lib/email/dbs-emails", () => ({ sendBarredAdminAlert: h.sendBarredAdminAlert }));
vi.mock("@/lib/email/resend", () => ({ sendEmail: h.sendEmail }));
vi.mock("@/lib/email/helpers", () => ({ getUserEmailInfo: vi.fn(async () => null) }));
vi.mock("@/lib/actions/connection-helpers", () => ({ createInboxMessage: h.createInboxMessage }));

import { dropBarredConnections, onNannyBarred } from "./silent-hold";

type Row = Record<string, unknown>;
const conn = (id: string, stage: number, status: string, extra: Row = {}): Row => ({
  id, nanny_id: "n1", parent_id: "p1", position_id: "pos1", connection_stage: stage, status, source: "parent", ...extra,
});

function seed(connections: Row[]) {
  h.db = createMemoryDb({
    connection_requests: connections,
    parents: [{ id: "p1", user_id: "parent-u1" }, { id: "p2", user_id: "parent-u2" }],
    user_profiles: [
      { user_id: "parent-u1", first_name: "Olivia", last_name: "Hartley", email: "olivia.hartley@example.test", mobile_number: "07700 900123" },
      { user_id: "parent-u2", first_name: "James", last_name: "Okafor", email: "james.okafor@example.test", mobile_number: null },
    ],
    nanny_positions: [{ id: "pos1", title: "After-school nanny, Islington" }, { id: "pos2", title: "Full-time nanny" }],
  });
}
const row = (id: string) => h.db.tables.connection_requests.find((c) => c.id === id);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const admin = () => h.db.client() as any;

beforeEach(() => vi.clearAllMocks());

describe("dropBarredConnections — P-14", () => {
  it("drops a hired (stage 40) row to the neutral expired state and lists the family", async () => {
    seed([conn("c40", 40, "confirmed")]);
    const r = await dropBarredConnections(admin(), "n1");
    expect(row("c40")).toMatchObject({ connection_stage: 1, status: "expired" });
    expect(r.families).toEqual([
      expect.objectContaining({
        connectionId: "c40", parentName: "Olivia Hartley", email: "olivia.hartley@example.test",
        phone: "07700 900123", positionId: "pos1", positionTitle: "After-school nanny, Islington", stage: 40,
      }),
    ]);
    expect(r.removedUnseen).toBe(0);
  });

  it("an accepted (stage 10) row expires as the existing accepted-row expiry (SCHEDULE_EXPIRED)", async () => {
    seed([conn("c10", 10, "accepted")]);
    await dropBarredConnections(admin(), "n1");
    expect(row("c10")).toMatchObject({ connection_stage: 11, status: "expired" });
  });

  it("every parent-visible stage is dropped: request, applied, held parent accept, meet, trial, offered, confirmed", async () => {
    const stages = [0, 5, 9, 20, 21, 30, 31, 32, 33, 34];
    seed(stages.map((s) => conn(`c${s}`, s, s >= 10 || s === 9 ? "accepted" : "pending")));
    const r = await dropBarredConnections(admin(), "n1");
    for (const s of stages) expect(row(`c${s}`)?.status).toBe("expired");
    expect(r.families.map((f) => f.stage).sort((a, b) => a - b)).toEqual(stages);
  });

  it("rows parents never saw (held application, DFY held accept) are deleted and not listed", async () => {
    seed([conn("c4", 4, "pending"), conn("c9dfy", 9, "accepted", { source: "dfy" })]);
    const r = await dropBarredConnections(admin(), "n1");
    expect(row("c4")).toBeUndefined();
    expect(row("c9dfy")).toBeUndefined();
    expect(r).toEqual({ families: [], notDropped: [], removedUnseen: 2 });
  });

  it("leaves terminal rows (finished, already expired, declined) untouched", async () => {
    seed([conn("c41", 41, "confirmed"), conn("c1", 1, "expired"), conn("c2", 2, "declined")]);
    const r = await dropBarredConnections(admin(), "n1");
    expect(row("c41")).toMatchObject({ connection_stage: 41, status: "confirmed" });
    expect(row("c2")).toMatchObject({ connection_stage: 2, status: "declined" });
    expect(r.families).toHaveLength(0);
    expect(h.db.writes).toHaveLength(0);
  });

  it("never touches another nanny's connections", async () => {
    seed([conn("other", 40, "confirmed", { nanny_id: "n2" })]);
    await dropBarredConnections(admin(), "n1");
    expect(row("other")).toMatchObject({ connection_stage: 40 });
  });

  it("P-9: parents get no inbox message and no email", async () => {
    seed([conn("c40", 40, "confirmed"), conn("c9", 9, "accepted")]);
    await dropBarredConnections(admin(), "n1");
    expect(h.createInboxMessage).not.toHaveBeenCalled();
    expect(h.sendEmail).not.toHaveBeenCalled();
  });

  it("a family with no phone and no position still lists (phone null, position null)", async () => {
    seed([conn("c20", 20, "accepted", { parent_id: "p2", position_id: null })]);
    const r = await dropBarredConnections(admin(), "n1");
    expect(r.families[0]).toMatchObject({ parentName: "James Okafor", phone: null, positionId: null, positionTitle: null });
  });
});

describe("onNannyBarred — one admin alert per bar", () => {
  it("drops and sends the admin alert once with the families", async () => {
    seed([conn("c40", 40, "confirmed")]);
    await onNannyBarred(admin(), { nannyId: "n1", userId: "nanny-u", alreadyBarred: false });
    expect(h.sendBarredAdminAlert).toHaveBeenCalledTimes(1);
    expect(h.sendBarredAdminAlert).toHaveBeenCalledWith(
      "nanny-u",
      [expect.objectContaining({ connectionId: "c40", parentName: "Olivia Hartley" })],
      0,
      [],
    );
  });

  it("sends the alert even when no family was affected (the email says so)", async () => {
    seed([]);
    await onNannyBarred(admin(), { nannyId: "n1", userId: "nanny-u", alreadyBarred: false });
    expect(h.sendBarredAdminAlert).toHaveBeenCalledWith("nanny-u", [], 0, []);
  });

  it("a re-sync of an already-barred nanny with nothing left to drop sends nothing", async () => {
    seed([conn("c1", 1, "expired")]);
    await onNannyBarred(admin(), { nannyId: "n1", userId: "nanny-u", alreadyBarred: true });
    expect(h.sendBarredAdminAlert).not.toHaveBeenCalled();
  });

  it("a failed alert send does not throw (the drop stands; rows stay findable as expired)", async () => {
    seed([conn("c40", 40, "confirmed")]);
    h.sendBarredAdminAlert.mockRejectedValueOnce(new Error("resend down"));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(onNannyBarred(admin(), { nannyId: "n1", userId: "nanny-u", alreadyBarred: false })).resolves.toBeUndefined();
    expect(row("c40")?.status).toBe("expired");
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });
});

describe("review fixes (code-reviewer HIGH 1, MEDIUM 3/4) — never a false 'no families'", () => {
  it("throws when the connection read fails, so no 'no families' alert goes out", async () => {
    seed([conn("c40", 40, "confirmed")]);
    const real = admin();
    const failing = { ...real, from: (t: string) => (t === "connection_requests"
      ? { select: () => ({ eq: async () => ({ data: null, error: { message: "timeout" } }) }) }
      : real.from(t)) };
    await expect(dropBarredConnections(failing, "n1")).rejects.toThrow(/timeout/);
    await expect(onNannyBarred(failing, { nannyId: "n1", userId: "nanny-u", alreadyBarred: false })).rejects.toThrow();
    expect(h.sendBarredAdminAlert).not.toHaveBeenCalled();
  });

  it("throws when a family detail read fails", async () => {
    seed([conn("c40", 40, "confirmed")]);
    const real = admin();
    const failing = { ...real, from: (t: string) => (t === "user_profiles"
      ? { select: () => ({ in: async () => ({ data: null, error: { message: "profiles down" } }) }) }
      : real.from(t)) };
    await expect(dropBarredConnections(failing, "n1")).rejects.toThrow(/profiles down/);
  });

  it("a row that moved on between read and write is not stomped and is reported as NOT dropped", async () => {
    seed([conn("c30", 30, "accepted")]);
    const real = admin();
    let moved = false;
    const racing = { ...real, from: (t: string) => {
      if (t === "connection_requests" && !moved && h.db.tables.connection_requests[0]) {
        // after the read, a parent advances the row to Offered (33)
        const b = real.from(t);
        const origUpdate = b.update;
        b.update = (...a: unknown[]) => { moved = true; h.db.tables.connection_requests[0].connection_stage = 33; return origUpdate(...a); };
        return b;
      }
      return real.from(t);
    } };
    const r = await dropBarredConnections(racing, "n1");
    expect(row("c30")).toMatchObject({ connection_stage: 33, status: "accepted" });
    expect(r.families).toHaveLength(0);
    expect(r.notDropped).toEqual([expect.objectContaining({ connectionId: "c30", stage: 30 })]);
  });

  it("onNannyBarred passes rows that could not be dropped to the alert", async () => {
    seed([conn("c40", 40, "confirmed")]);
    await onNannyBarred(admin(), { nannyId: "n1", userId: "nanny-u", alreadyBarred: false });
    expect(h.sendBarredAdminAlert).toHaveBeenCalledWith("nanny-u", expect.any(Array), 0, []);
  });

  it("known limit (MEDIUM 2): a nanny already at level 0 + suspended for another reason, barred with nothing to drop, gets no sync alert (admin Bar still sends VER-010; ledger)", async () => {
    seed([]);
    await onNannyBarred(admin(), { nannyId: "n1", userId: "nanny-u", alreadyBarred: true });
    expect(h.sendBarredAdminAlert).not.toHaveBeenCalled();
  });
});
