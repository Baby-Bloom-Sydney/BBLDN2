/**
 * The Friday reminder's reads and claim (plan 06 §16.7 b5.3; §16.0 BAI's 2026-11-23 week rule; §16.5).
 *
 * - **Who:** a nanny with a running hire — a placement that is `active`, not dismissed, and started by the week's
 *   Sunday (or with no start date) — whose account isn't suspended or deactivated.
 * - **Already invoiced** (§16.0): a live invoice (sent, with its PDF) for that family's placement holding a shift line
 *   dated Monday–Sunday of that week. Cancelled, failed and sending ones don't count; nor do trial invoices, invoices of
 *   expenses only, or invoices whose shifts all fall in other weeks (a period that spans the week with no shift in it
 *   included). The rows are checked again here, whatever the query returned.
 * - Per nanny: her first name and email, and each family left with its placement (one entry per family).
 * - Reads paged and chunked; a failed read is `error`, logged by code only.
 * - The claim: an upsert that ignores duplicates (true when written, false when held); the release deletes only the
 *   claim with its own stamp. Every read and write passes `cronGate` first.
 *
 * BB-wave1-041126/06b5-app, 2026-11-23.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { createAdminClient } = vi.hoisted(() => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient }));

import { fakeAdmin, writesTo, type FakeAdmin, type Op } from "@/lib/payments/fake-admin.test-util";
import { proveInvoiceCron, type InvoiceCronProof } from "./cron-proof";
import { claimReminder, readDueReminders, releaseReminder } from "./store-reminders";

const u = (n: number) => `b0650000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const MONDAY = "2027-02-08";
const SUNDAY = "2027-02-14";
const STAMP = "2027-02-12T16:05:00.000Z";
const SOPHIE = 101;
const AMARA = 102;

type Row = Record<string, unknown>;
const placement = (n: number, nanny: number, parent: number, extra: Row = {}): Row => ({
  id: u(400 + n), nanny_id: u(nanny), parent_id: u(200 + parent), status: "active", start_date: "2027-01-11", end_notes: null, ...extra,
});
const nanny = (n: number, status: string | null = "active"): Row => ({ id: u(n), user_id: u(600 + n), status });
const shift = (date: string): Row => ({ kind: "shift", shift_date: date });
const expense = (): Row => ({ kind: "expense", shift_date: null });
const invoice = (n: number, placementN: number | null, lines: readonly Row[], extra: Row = {}): Row => {
  const dates = lines.flatMap((l) => (typeof l.shift_date === "string" ? [l.shift_date] : [])).sort();
  return {
    id: u(700 + n), placement_id: placementN === null ? null : u(400 + placementN), status: "sent", pdf_path: `${u(SOPHIE)}/${u(700 + n)}.pdf`,
    period_start: dates[0] ?? "2027-02-10", period_end: dates[dates.length - 1] ?? "2027-02-10", nanny_invoice_lines: lines, ...extra,
  };
};
const parent = (n: number): Row => ({ id: u(200 + n), user_id: u(n) });
const PROFILES: readonly Row[] = [
  { user_id: u(600 + SOPHIE), first_name: "Sophie", last_name: "Taylor", email: "admin+b065-sophie@babybloomnannies.co.uk" },
  { user_id: u(600 + AMARA), first_name: "Amara", last_name: "Okafor", email: "admin+b065-amara@babybloomnannies.co.uk" },
  { user_id: u(11), first_name: "Olivia", last_name: "Hartley", email: "admin+b065-11@babybloomnannies.co.uk" },
  { user_id: u(12), first_name: "Priya", last_name: "Patel", email: "admin+b065-12@babybloomnannies.co.uk" },
  { user_id: u(13), first_name: "Grace", last_name: "Bennett", email: "admin+b065-13@babybloomnannies.co.uk" },
];

const holds = (f: string, value: unknown, arg: unknown): boolean => {
  if (f === "eq") return value === arg;
  if (f === "in") return (arg as unknown[]).includes(value);
  if (f === "lte") return value !== null && String(value) <= String(arg);
  if (f === "gte") return value !== null && String(value) >= String(arg);
  if (f === "not") return value !== null;
  return true;
};

/**
 * Answer a read as PostgREST would: top-level filters choose rows, `nanny_invoice_lines.*` filters choose the embedded
 * lines (an invoice with none left still comes back, with `[]`), and `range` pages. `ignoreNested` returns every line.
 */
function answer(rows: readonly Row[], ignoreNested = false) {
  return (op: Op) => {
    const filters = op.filters.filter(([f]) => f !== "order" && f !== "range");
    const top = filters.filter(([, col]) => !String(col).includes("."));
    const nested = filters.filter(([, col]) => String(col).includes("."));
    const hits = rows.filter((r) => top.every(([f, col, arg]) => holds(f, r[col], arg))).map((r) =>
      ignoreNested || nested.length === 0 ? r : {
        ...r,
        nanny_invoice_lines: (r.nanny_invoice_lines as Row[]).filter((l) => nested.every(([f, col, arg]) => holds(f, l[String(col).split(".")[1] ?? ""], arg))),
      });
    const range = op.filters.find(([f]) => f === "range");
    return range ? hits.slice(Number(range[1]), Number(range[2]) + 1) : hits;
  };
}

let f: FakeAdmin;
let proof: InvoiceCronProof;

function load(data: { placements: readonly Row[]; nannies?: readonly Row[]; invoices?: readonly Row[]; parents?: readonly Row[]; profiles?: readonly Row[] }, ignoreNested = false) {
  f.reads.nanny_placements = answer(data.placements);
  f.reads.nannies = answer(data.nannies ?? [nanny(SOPHIE), nanny(AMARA)]);
  f.reads.nanny_invoices = answer(data.invoices ?? [], ignoreNested);
  f.reads.parents = answer(data.parents ?? [11, 12, 13].map(parent));
  f.reads.user_profiles = answer(data.profiles ?? PROFILES);
}

const reminders = async () => {
  const r = await readDueReminders(proof, MONDAY);
  if (!r.ok) throw new Error(`read refused: ${r.error}`);
  return r.value;
};
const familiesOf = async () => (await reminders()).map((n) => ({ nannyId: n.nannyId, families: n.families.map((fam) => fam.familyName) }));

beforeEach(() => {
  vi.stubEnv("NANNY_INVOICES_ENABLED", "true");
  vi.stubEnv("CRON_SECRET", "s");
  f = fakeAdmin();
  createAdminClient.mockReset();
  createAdminClient.mockReturnValue(f.client);
  const made = proveInvoiceCron("Bearer s");
  if (!made) throw new Error("no proof");
  proof = made;
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("readDueReminders — who gets one", () => {
  it("the worked example (§16.3): Sophie invoiced the Hartleys for the week, so only Priya Patel is left", async () => {
    load({
      placements: [placement(1, SOPHIE, 11), placement(2, SOPHIE, 12)],
      invoices: [invoice(1, 1, [shift("2027-02-08"), shift("2027-02-11")])],
    });
    expect(await reminders()).toEqual([{
      nannyId: u(SOPHIE), userId: u(600 + SOPHIE), firstName: "Sophie", email: "admin+b065-sophie@babybloomnannies.co.uk",
      families: [{ placementId: u(402), familyName: "Priya Patel" }],
    }]);
  });

  it("nothing invoiced: both families, in name order; one nanny per entry", async () => {
    load({ placements: [placement(2, SOPHIE, 12), placement(1, SOPHIE, 11), placement(3, AMARA, 13)] });
    expect(await familiesOf()).toEqual([
      { nannyId: u(SOPHIE), families: ["Olivia Hartley", "Priya Patel"] },
      { nannyId: u(AMARA), families: ["Grace Bennett"] },
    ]);
  });

  it("all invoiced → she isn't listed", async () => {
    load({
      placements: [placement(1, SOPHIE, 11), placement(2, SOPHIE, 12)],
      invoices: [invoice(1, 1, [shift("2027-02-09")]), invoice(2, 2, [shift("2027-02-14")])],
    });
    expect(await reminders()).toEqual([]);
  });

  it("only active placements: ended and paused ones are left out, even when the query returns them", async () => {
    load({ placements: [placement(1, SOPHIE, 11, { status: "ended" }), placement(2, SOPHIE, 12, { status: "paused" }), placement(3, SOPHIE, 13)] });
    f.reads.nanny_placements = () => [placement(1, SOPHIE, 11, { status: "ended" }), placement(2, SOPHIE, 12, { status: "paused" }), placement(3, SOPHIE, 13)];
    expect(await familiesOf()).toEqual([{ nannyId: u(SOPHIE), families: ["Grace Bennett"] }]);
    const read = f.ops.find((o) => o.table === "nanny_placements");
    expect(read?.filters).toContainEqual(["eq", "status", "active"]);
  });

  it("a dismissed placement is left out", async () => {
    load({ placements: [placement(1, SOPHIE, 11, { end_notes: "Moved on [NANNY_DISMISSED] 2027-01-30" }), placement(2, SOPHIE, 12)] });
    expect(await familiesOf()).toEqual([{ nannyId: u(SOPHIE), families: ["Priya Patel"] }]);
  });

  it("started by the week's Sunday (or no start date) counts; a hire starting next week doesn't", async () => {
    load({
      placements: [
        placement(1, SOPHIE, 11, { start_date: SUNDAY }),
        placement(2, SOPHIE, 12, { start_date: "2027-02-15" }),
        placement(3, SOPHIE, 13, { start_date: null }),
      ],
    });
    expect(await familiesOf()).toEqual([{ nannyId: u(SOPHIE), families: ["Grace Bennett", "Olivia Hartley"] }]);
  });

  it("a suspended or deactivated nanny is left out; any other status (or none) is kept", async () => {
    load({
      placements: [placement(1, SOPHIE, 11), placement(2, AMARA, 12), placement(3, 103, 13), placement(4, 104, 11), placement(5, 105, 12)],
      nannies: [nanny(SOPHIE, "suspended"), nanny(AMARA, "deactivated"), nanny(103, "inactive"), nanny(104, "pending_verification"), nanny(105, null)],
    });
    expect((await reminders()).map((n) => n.nannyId)).toEqual([u(103), u(104), u(105)]);
  });

  it("a family with two running hires is one entry, and either hire's invoice for the week counts for the family", async () => {
    load({ placements: [placement(1, SOPHIE, 11, { start_date: "2027-01-04" }), placement(2, SOPHIE, 11, { start_date: "2027-02-01" })] });
    expect((await reminders())[0]?.families).toEqual([{ placementId: u(402), familyName: "Olivia Hartley" }]);
    load({
      placements: [placement(1, SOPHIE, 11), placement(2, SOPHIE, 11)],
      invoices: [invoice(1, 1, [shift("2027-02-10")])],
    });
    expect(await reminders()).toEqual([]);
  });

  it("the same family's hires with two nannies are two reminders", async () => {
    load({ placements: [placement(1, SOPHIE, 11), placement(2, AMARA, 11)] });
    expect(await familiesOf()).toEqual([
      { nannyId: u(SOPHIE), families: ["Olivia Hartley"] },
      { nannyId: u(AMARA), families: ["Olivia Hartley"] },
    ]);
  });
});

describe("readDueReminders — what counts as already invoiced (§16.0)", () => {
  const OTHER = placement(2, SOPHIE, 12);
  const left = async (invoices: readonly Row[], ignoreNested = false) => {
    load({ placements: [placement(1, SOPHIE, 11), OTHER], invoices }, ignoreNested);
    return (await reminders())[0]?.families.map((fam) => fam.familyName) ?? [];
  };

  it("a live invoice with a shift on the Monday, or on the Sunday, counts", async () => {
    expect(await left([invoice(1, 1, [shift(MONDAY)])])).toEqual(["Priya Patel"]);
    expect(await left([invoice(1, 1, [shift(SUNDAY)])])).toEqual(["Priya Patel"]);
  });

  it("a two-week invoice with one shift in the week counts", async () => {
    expect(await left([invoice(1, 1, [shift("2027-02-02"), shift("2027-02-09")])])).toEqual(["Priya Patel"]);
  });

  it("cancelled, failed and sending invoices don't count, even when the query returns them", async () => {
    for (const status of ["cancelled", "failed", "sending"]) {
      expect(await left([invoice(1, 1, [shift("2027-02-10")], { status })])).toEqual(["Olivia Hartley", "Priya Patel"]);
    }
    load({ placements: [placement(1, SOPHIE, 11), OTHER] });
    f.reads.nanny_invoices = () => [invoice(1, 1, [shift("2027-02-10")], { status: "cancelled" })];
    expect((await reminders())[0]?.families).toHaveLength(2);
  });

  it("an invoice without its PDF doesn't count (countsAsSent)", async () => {
    load({ placements: [placement(1, SOPHIE, 11), OTHER] });
    f.reads.nanny_invoices = () => [invoice(1, 1, [shift("2027-02-10")], { pdf_path: null })];
    expect((await reminders())[0]?.families).toHaveLength(2);
  });

  it("an invoice of expenses only doesn't count", async () => {
    expect(await left([invoice(1, 1, [expense(), expense()])])).toEqual(["Olivia Hartley", "Priya Patel"]);
  });

  it("a trial invoice (linked to the connection, not the placement) doesn't count, even when the query returns it", async () => {
    expect(await left([invoice(1, null, [shift("2027-02-10")], { connection_request_id: u(501) })])).toEqual(["Olivia Hartley", "Priya Patel"]);
    load({ placements: [placement(1, SOPHIE, 11), OTHER] });
    f.reads.nanny_invoices = () => [invoice(1, null, [shift("2027-02-10")])];
    expect((await reminders())[0]?.families).toHaveLength(2);
  });

  it("an invoice for another placement doesn't count for this one", async () => {
    load({ placements: [placement(1, SOPHIE, 11), OTHER] });
    f.reads.nanny_invoices = () => [invoice(1, 9, [shift("2027-02-10")])];
    expect((await reminders())[0]?.families).toHaveLength(2);
  });

  it("shifts all in the week before or the week after don't count", async () => {
    expect(await left([invoice(1, 1, [shift("2027-02-01"), shift("2027-02-07")])])).toEqual(["Olivia Hartley", "Priya Patel"]);
    expect(await left([invoice(1, 1, [shift("2027-02-15"), shift("2027-02-19")])])).toEqual(["Olivia Hartley", "Priya Patel"]);
  });

  it("a period that spans the week with no shift in it doesn't count — checked here even when every line comes back", async () => {
    const spanning = invoice(1, 1, [shift("2027-02-05"), expense(), shift("2027-02-16")]);
    expect(spanning.period_start).toBe("2027-02-05");
    expect(spanning.period_end).toBe("2027-02-16");
    expect(await left([spanning])).toEqual(["Olivia Hartley", "Priya Patel"]);
    expect(await left([spanning], true)).toEqual(["Olivia Hartley", "Priya Patel"]);
  });

  it("asks only for live invoices of the running placements that meet the week, with their shift lines in the week", async () => {
    await left([]);
    const read = f.ops.find((o) => o.table === "nanny_invoices");
    expect(read?.filters).toEqual(expect.arrayContaining([
      ["in", "placement_id", [u(401), u(402)]],
      ["eq", "status", "sent"],
      ["not", "pdf_path", "is"],
      ["lte", "period_start", SUNDAY],
      ["gte", "period_end", MONDAY],
      ["eq", "nanny_invoice_lines.kind", "shift"],
      ["gte", "nanny_invoice_lines.shift_date", MONDAY],
      ["lte", "nanny_invoice_lines.shift_date", SUNDAY],
    ]));
  });
});

describe("readDueReminders — names and emails", () => {
  it("her first name and profile email; a nanny with no profile gets a blank name and no email", async () => {
    load({ placements: [placement(1, SOPHIE, 11), placement(2, AMARA, 12)], profiles: PROFILES.filter((p) => p.user_id !== u(600 + AMARA)) });
    const [sophie, amara] = await reminders();
    expect(sophie).toMatchObject({ firstName: "Sophie", email: "admin+b065-sophie@babybloomnannies.co.uk" });
    expect(amara).toMatchObject({ nannyId: u(AMARA), userId: u(600 + AMARA), firstName: "", email: null });
  });

  it("a family with no parent row or no profile can't be invoiced, so it's left out (logged by code)", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    load({
      placements: [placement(1, SOPHIE, 11), placement(2, SOPHIE, 12), placement(3, SOPHIE, 14)],
      profiles: PROFILES.filter((p) => p.user_id !== u(12)),
    });
    expect(await familiesOf()).toEqual([{ nannyId: u(SOPHIE), families: ["Olivia Hartley"] }]);
    expect(log).toHaveBeenCalledWith("[invoices] reminders.family failed", { code: "no_profile" });
  });

  it("no due family → nothing more is read", async () => {
    load({ placements: [placement(1, SOPHIE, 11)], invoices: [invoice(1, 1, [shift("2027-02-10")])] });
    expect(await reminders()).toEqual([]);
    expect(f.ops.some((o) => o.table === "parents" || o.table === "user_profiles")).toBe(false);
  });

  it("no running hire → only the placements are read", async () => {
    load({ placements: [placement(1, SOPHIE, 11, { status: "ended" })] });
    expect(await reminders()).toEqual([]);
    expect(f.ops.map((o) => o.table)).toEqual(["nanny_placements"]);
  });
});

describe("readDueReminders — reads", () => {
  it("pages the placements (500 a page) and chunks every id list (at most 100 to a request)", async () => {
    const many = Array.from({ length: 501 }, (_, i) => placement(i + 1, SOPHIE, 1000 + i));
    load({
      placements: many,
      parents: many.map((_, i) => parent(1000 + i)),
      profiles: [...PROFILES, ...many.map((_, i) => ({ user_id: u(1000 + i), first_name: "Family", last_name: String(i).padStart(3, "0"), email: `admin+b065-${i}@babybloomnannies.co.uk` }))],
    });
    const [sophie] = await reminders();
    expect(sophie?.families).toHaveLength(501);
    const pages = f.ops.filter((o) => o.table === "nanny_placements").map((o) => o.filters.find(([k]) => k === "range"));
    expect(pages).toEqual([["range", 0, 499], ["range", 500, 999]]);
    for (const table of ["nanny_invoices", "parents", "user_profiles"]) {
      const sizes = f.ops.filter((o) => o.table === table).map((o) => (o.filters.find(([k]) => k === "in")?.[2] as unknown[]).length);
      expect(Math.max(...sizes)).toBeLessThanOrEqual(100);
      expect(sizes.reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(501);
    }
  });

  it.each(["nanny_placements", "nannies", "nanny_invoices", "parents", "user_profiles"])(
    "a failed read of %s → error, logged by code only (never the message)",
    async (table) => {
      const log = vi.spyOn(console, "error").mockImplementation(() => {});
      load({ placements: [placement(1, SOPHIE, 11)] });
      f.readErrors[table] = { message: "Failing row contains (admin+b065-11@babybloomnannies.co.uk)", code: "57014" };
      expect(await readDueReminders(proof, MONDAY)).toEqual({ ok: false, error: "error" });
      expect(log).toHaveBeenCalledWith(expect.stringMatching(/^\[invoices\] reminders\.\w+ failed$/), { code: "57014" });
      expect(JSON.stringify(log.mock.calls)).not.toContain("babybloomnannies");
    },
  );

  it("a row that doesn't fit fails the read", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    load({ placements: [placement(1, SOPHIE, 11, { start_date: "08/02/2027" })] });
    expect(await readDueReminders(proof, MONDAY)).toEqual({ ok: false, error: "error" });
  });

  it("no service client → error", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    createAdminClient.mockImplementation(() => {
      throw new Error("no key");
    });
    expect(await readDueReminders(proof, MONDAY)).toEqual({ ok: false, error: "error" });
  });
});

describe("the gates", () => {
  it("switch off → invoices_disabled before a client is made, for every operation", async () => {
    vi.stubEnv("NANNY_INVOICES_ENABLED", "");
    expect(await readDueReminders(proof, MONDAY)).toEqual({ ok: false, error: "invoices_disabled" });
    expect(await claimReminder(proof, u(SOPHIE), MONDAY, STAMP)).toEqual({ ok: false, error: "invoices_disabled" });
    expect(await releaseReminder(proof, u(SOPHIE), MONDAY, STAMP)).toEqual({ ok: false, error: "invoices_disabled" });
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("not a cron proof → invalid, with nothing read or written", async () => {
    const fake = { kind: "invoice_cron_proof" } as unknown as InvoiceCronProof;
    expect(await readDueReminders(fake, MONDAY)).toEqual({ ok: false, error: "invalid" });
    expect(await claimReminder(fake, u(SOPHIE), MONDAY, STAMP)).toEqual({ ok: false, error: "invalid" });
    expect(await releaseReminder(fake, u(SOPHIE), MONDAY, STAMP)).toEqual({ ok: false, error: "invalid" });
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("a week that isn't a Monday, a nanny id that isn't one, or a stamp that isn't a time → invalid", async () => {
    expect(await readDueReminders(proof, "2027-02-09")).toEqual({ ok: false, error: "invalid" });
    expect(await claimReminder(proof, u(SOPHIE), "2027-02-12", STAMP)).toEqual({ ok: false, error: "invalid" });
    expect(await claimReminder(proof, "nanny-1", MONDAY, STAMP)).toEqual({ ok: false, error: "invalid" });
    expect(await claimReminder(proof, u(SOPHIE), MONDAY, "Friday")).toEqual({ ok: false, error: "invalid" });
    expect(await releaseReminder(proof, u(SOPHIE), "2027-02-14", STAMP)).toEqual({ ok: false, error: "invalid" });
    expect(createAdminClient).not.toHaveBeenCalled();
  });
});

describe("claimReminder / releaseReminder", () => {
  it("claims with an upsert that ignores duplicates and returns the key: one row back → true", async () => {
    f.writeResults.nanny_invoice_reminders = [{ nanny_id: u(SOPHIE) }];
    expect(await claimReminder(proof, u(SOPHIE), MONDAY, STAMP)).toEqual({ ok: true, value: true });
    const [write] = writesTo(f, "nanny_invoice_reminders");
    expect(write).toMatchObject({
      kind: "upsert",
      payload: { nanny_id: u(SOPHIE), week_start: MONDAY, claimed_at: STAMP },
      options: { onConflict: "nanny_id,week_start", ignoreDuplicates: true },
    });
  });

  it("held by another run (no row back) → false", async () => {
    f.writeResults.nanny_invoice_reminders = [];
    expect(await claimReminder(proof, u(SOPHIE), MONDAY, STAMP)).toEqual({ ok: true, value: false });
  });

  it("a failed or odd claim → error, logged by code only", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    f.writeErrors.nanny_invoice_reminders = { message: "permission denied for table nanny_invoice_reminders", code: "42501" };
    expect(await claimReminder(proof, u(SOPHIE), MONDAY, STAMP)).toEqual({ ok: false, error: "error" });
    expect(log).toHaveBeenCalledWith("[invoices] claimReminder failed", { code: "42501" });
    f.writeErrors.nanny_invoice_reminders = undefined;
    f.writeResults.nanny_invoice_reminders = [{ nanny_id: u(SOPHIE) }, { nanny_id: u(AMARA) }];
    expect(await claimReminder(proof, u(SOPHIE), MONDAY, STAMP)).toEqual({ ok: false, error: "error" });
    f.writeResults.nanny_invoice_reminders = null;
    expect(await claimReminder(proof, u(SOPHIE), MONDAY, STAMP)).toEqual({ ok: false, error: "error" });
  });

  it("a claim that throws → error, logged by its name", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    createAdminClient.mockReturnValue({ from: () => { throw new TypeError("fetch failed"); } });
    expect(await claimReminder(proof, u(SOPHIE), MONDAY, STAMP)).toEqual({ ok: false, error: "error" });
    expect(await releaseReminder(proof, u(SOPHIE), MONDAY, STAMP)).toEqual({ ok: false, error: "error" });
    expect(log).toHaveBeenCalledWith("[invoices] claimReminder failed", { code: "TypeError" });
    expect(log).toHaveBeenCalledWith("[invoices] releaseReminder failed", { code: "TypeError" });
  });

  it("releases only its own claim: nanny, week and stamp", async () => {
    expect(await releaseReminder(proof, u(SOPHIE), MONDAY, STAMP)).toEqual({ ok: true, value: true });
    const [write] = writesTo(f, "nanny_invoice_reminders");
    expect(write?.kind).toBe("delete");
    expect(write?.filters).toEqual([["eq", "nanny_id", u(SOPHIE)], ["eq", "week_start", MONDAY], ["eq", "claimed_at", STAMP]]);
  });

  it("a failed release → error, logged by code only", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    f.writeErrors.nanny_invoice_reminders = { message: "x", code: "40001" };
    expect(await releaseReminder(proof, u(SOPHIE), MONDAY, STAMP)).toEqual({ ok: false, error: "error" });
    expect(log).toHaveBeenCalledWith("[invoices] releaseReminder failed", { code: "40001" });
  });

  it("no service client → error", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    createAdminClient.mockImplementation(() => {
      throw new Error("no key");
    });
    expect(await claimReminder(proof, u(SOPHIE), MONDAY, STAMP)).toEqual({ ok: false, error: "error" });
    expect(await releaseReminder(proof, u(SOPHIE), MONDAY, STAMP)).toEqual({ ok: false, error: "error" });
  });
});
