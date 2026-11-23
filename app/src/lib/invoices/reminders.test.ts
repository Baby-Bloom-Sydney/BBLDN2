/**
 * The Friday invoice reminder's run (plan 06 §16.7 b5.5; §16.0, §16.3, §16.5). Through the real store
 * (`store-reminders.ts`) on a fake database, with the email sender mocked.
 *
 * - **The clock:** it acts only when London's wall clock reads Friday 16:xx, so of the two UTC cron entries
 *   (15:00 and 16:00) exactly one acts in any season, the Fridays before both clock changes included. A skip reads
 *   nothing. Every clock block switches the host zone in the file, because `vitest.setup.ts` pins `TZ` for every run
 *   (a command-line `TZ` never reaches a test): UTC, the fixed offsets UTC+11 and UTC+10, a southern-hemisphere zone
 *   with its own clock changes, and New York (BUILD/README § Wave 1 alignment item 2).
 * - **The worked example** (§16.3) and the families that get nothing.
 * - **Claim, then send, then release on failure**, nannies one at a time; a held claim is skipped; a second run the
 *   same week sends nothing.
 * - **The gates:** the switch first, then the cron proof, before any read.
 *
 * BB-wave1-041126/06b5-app, 2026-11-23.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const { createAdminClient, sendEmail } = vi.hoisted(() => ({ createAdminClient: vi.fn(), sendEmail: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient }));
vi.mock("@/lib/email/resend", () => ({ sendEmail }));

import { SITE_URL } from "@/lib/constants";
import { fakeAdmin, type FakeAdmin, type Op } from "@/lib/payments/fake-admin.test-util";
import { proveInvoiceCron, type InvoiceCronProof } from "./cron-proof";
import { runInvoiceReminders } from "./reminders";

const u = (n: number) => `b0650000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const MONDAY = "2027-02-08";
/** Friday 12 Feb 2027, 16:05 London (GMT). */
const FRIDAY = new Date("2027-02-12T16:05:00Z");
const SOPHIE = 101;
const BEN = 102;
const CHLOE = 103;
const DANI = 104;
const HOST_ZONES = ["UTC", "Etc/GMT-11", "Etc/GMT-10", "Pacific/Auckland", "America/New_York"] as const;

type Row = Record<string, unknown>;
const placement = (n: number, nanny: number, parent: number, extra: Row = {}): Row => ({
  id: u(400 + n), nanny_id: u(nanny), parent_id: u(200 + parent), status: "active", start_date: "2027-01-11", end_notes: null, ...extra,
});
const nanny = (n: number, status = "active"): Row => ({ id: u(n), user_id: u(600 + n), status });
const invoice = (n: number, placementN: number, dates: readonly string[]): Row => ({
  id: u(700 + n), placement_id: u(400 + placementN), status: "sent", pdf_path: `${u(SOPHIE)}/${u(700 + n)}.pdf`,
  period_start: dates[0], period_end: dates[dates.length - 1], nanny_invoice_lines: dates.map((d) => ({ kind: "shift", shift_date: d })),
});
const profile = (n: number, first: string, last: string): Row => ({ user_id: u(n), first_name: first, last_name: last, email: `admin+b065-${n}@babybloomnannies.co.uk` });
const PROFILES = [
  profile(600 + SOPHIE, "Sophie", "Taylor"), profile(600 + BEN, "Ben", "Carter"), profile(600 + CHLOE, "Chloe", "Evans"), profile(600 + DANI, "Dani", "Moss"),
  profile(11, "Olivia", "Hartley"), profile(12, "Priya", "Patel"), profile(13, "Grace", "Bennett"),
];

const holds = (f: string, value: unknown, arg: unknown): boolean => {
  if (f === "eq") return value === arg;
  if (f === "in") return (arg as unknown[]).includes(value);
  if (f === "lte") return value !== null && String(value) <= String(arg);
  if (f === "gte") return value !== null && String(value) >= String(arg);
  if (f === "not") return value !== null;
  return true;
};
/** As PostgREST: top-level filters choose rows; `nanny_invoice_lines.*` filters choose the embedded lines; `range` pages. */
const answer = (rows: readonly Row[]) => (op: Op) => {
  const filters = op.filters.filter(([f]) => f !== "order" && f !== "range");
  const nested = filters.filter(([, col]) => String(col).includes("."));
  const hits = rows.filter((r) => filters.filter(([, col]) => !String(col).includes(".")).every(([f, col, arg]) => holds(f, r[col], arg)));
  const shaped = hits.map((r) => (nested.length === 0 ? r : {
    ...r, nanny_invoice_lines: (r.nanny_invoice_lines as Row[]).filter((l) => nested.every(([f, col, arg]) => holds(f, l[String(col).split(".")[1] ?? ""], arg))),
  }));
  const range = op.filters.find(([f]) => f === "range");
  return range ? shaped.slice(Number(range[1]), Number(range[2]) + 1) : shaped;
};

let f: FakeAdmin;
let proof: InvoiceCronProof;
/** The claim table: key "nanny/week" → its stamp. An upsert ignoring duplicates; a delete by key and stamp. */
let claims: Map<string, string>;

function world(data: { placements: readonly Row[]; nannies?: readonly Row[]; invoices?: readonly Row[]; profiles?: readonly Row[] }) {
  f.reads.nanny_placements = answer(data.placements);
  f.reads.nannies = answer(data.nannies ?? [nanny(SOPHIE), nanny(BEN), nanny(CHLOE), nanny(DANI)]);
  f.reads.nanny_invoices = answer(data.invoices ?? []);
  f.reads.parents = answer([11, 12, 13].map((n) => ({ id: u(200 + n), user_id: u(n) })));
  f.reads.user_profiles = answer(data.profiles ?? PROFILES);
}

/** §16.3 and §16.8's fixtures: Sophie invoiced the Hartleys this week and the Patels only last week; Ben invoiced both
 * his families; Chloe is suspended; Dani has only a trial (a connection, no placement). */
const WORKED = {
  placements: [placement(1, SOPHIE, 11), placement(2, SOPHIE, 12), placement(3, BEN, 11), placement(4, BEN, 13), placement(5, CHLOE, 12)],
  nannies: [nanny(SOPHIE), nanny(BEN), nanny(CHLOE, "suspended"), nanny(DANI)],
  invoices: [
    invoice(1, 1, ["2027-02-08", "2027-02-09", "2027-02-10", "2027-02-11"]),
    invoice(2, 2, ["2027-02-01", "2027-02-05"]),
    invoice(3, 3, ["2027-02-09"]),
    invoice(4, 4, ["2027-02-12"]),
  ],
};

const sends = () => sendEmail.mock.calls.map(([params]) => params as { to: string; subject: string; text: string; html: string; emailType: string; recipientUserId: string });
const run = async (at: Date = FRIDAY) => {
  const r = await runInvoiceReminders(proof, at);
  if (!r.ok) throw new Error(`refused: ${r.error}`);
  return r.value;
};

beforeEach(() => {
  vi.stubEnv("NANNY_INVOICES_ENABLED", "true");
  vi.stubEnv("CRON_SECRET", "s");
  f = fakeAdmin();
  claims = new Map();
  f.writeResults.nanny_invoice_reminders = (op: Op) => {
    const value = (col: string) => op.filters.find(([, c]) => c === col)?.[2];
    if (op.kind === "upsert") {
      const p = op.payload as { nanny_id: string; week_start: string; claimed_at: string };
      const key = `${p.nanny_id}/${p.week_start}`;
      if (claims.has(key)) return [];
      claims.set(key, p.claimed_at);
      return [{ nanny_id: p.nanny_id }];
    }
    const key = `${String(value("nanny_id"))}/${String(value("week_start"))}`;
    if (op.kind === "delete" && claims.get(key) === value("claimed_at")) claims.delete(key);
    return null;
  };
  createAdminClient.mockReset();
  createAdminClient.mockReturnValue(f.client);
  sendEmail.mockReset();
  sendEmail.mockResolvedValue({ success: true, messageId: "dry-run" });
  vi.spyOn(console, "info").mockImplementation(() => {});
  const made = proveInvoiceCron("Bearer s");
  if (!made) throw new Error("no proof");
  proof = made;
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe.each(HOST_ZONES)("the clock, with the host in %s", (zone) => {
  let previous: string | undefined;
  beforeAll(() => {
    previous = process.env.TZ;
    process.env.TZ = zone;
  });
  afterAll(() => {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  });

  const NOT_TIME = { skipped: "not_time" };
  const acts = async (iso: string): Promise<boolean> => {
    createAdminClient.mockClear();
    world({ placements: [] });
    const value = await run(new Date(iso));
    if ("readFailed" in value) {
      expect(createAdminClient).toHaveBeenCalled();
      return true;
    }
    expect(value).toEqual(NOT_TIME);
    expect(createAdminClient).not.toHaveBeenCalled();
    return false;
  };

  it("winter (GMT): Fri 12 Feb 2027 16:00 UTC acts; 15:00 UTC is skipped", async () => {
    expect(await acts("2027-02-12T16:00:00Z")).toBe(true);
    expect(await acts("2027-02-12T15:00:00Z")).toBe(false);
  });

  it("summer (BST): Fri 2 Jul 2027 15:00 UTC acts; 16:00 UTC is skipped", async () => {
    expect(await acts("2027-07-02T15:00:00Z")).toBe(true);
    expect(await acts("2027-07-02T16:00:00Z")).toBe(false);
  });

  it("any minute of 16:xx London acts; 15:59 and 17:00 don't", async () => {
    expect(await acts("2027-02-12T16:59:59Z")).toBe(true);
    expect(await acts("2027-02-12T15:59:59Z")).toBe(false);
    expect(await acts("2027-02-12T17:00:00Z")).toBe(false);
  });

  it("Thursday 16:00 London and Saturday 16:00 London are skipped", async () => {
    expect(await acts("2027-02-11T16:00:00Z")).toBe(false);
    expect(await acts("2027-02-13T16:00:00Z")).toBe(false);
  });

  it("the Friday before each clock change, and the Friday after, acts exactly once of the two entries", async () => {
    // spring: clocks go forward on Sun 28 Mar 2027; autumn: back on Sun 31 Oct 2027
    for (const [day, utcHourThatActs] of [["2027-03-26", 16], ["2027-04-02", 15], ["2027-10-29", 15], ["2027-11-05", 16]] as const) {
      const results = [await acts(`${day}T15:00:00Z`), await acts(`${day}T16:00:00Z`)];
      expect(results).toEqual([utcHourThatActs === 15, utcHourThatActs === 16]);
    }
  });

  it("the week is the London Monday–Sunday holding the Friday", async () => {
    world({ placements: [placement(2, SOPHIE, 12)] });
    await run(new Date("2027-02-12T16:05:00Z"));
    expect(sends()[0]?.subject).toBe("Invoice reminder — week of 8 Feb 2027");
    const invoiceRead = f.ops.find((o) => o.table === "nanny_invoices");
    expect(invoiceRead?.filters).toEqual(expect.arrayContaining([["gte", "period_end", MONDAY], ["lte", "period_start", "2027-02-14"]]));
  });
});

describe("the worked example (§16.3, §16.8)", () => {
  it("one email, to Sophie, naming Priya Patel only, with the form pre-filled for the Patels; one claim", async () => {
    world(WORKED);
    expect(await run()).toEqual({ sent: 1, failed: 0, skipped: 0, readFailed: false });
    const [email] = sends();
    expect(sends()).toHaveLength(1);
    expect(email).toMatchObject({
      to: "admin+b065-701@babybloomnannies.co.uk",
      subject: "Invoice reminder — week of 8 Feb 2027",
      emailType: "invoice_reminder",
      recipientUserId: u(600 + SOPHIE),
    });
    expect(email?.text).toContain("You haven't sent an invoice to Priya Patel for the week of 8 Feb 2027 yet.");
    expect(email?.text).toContain(`Create invoice: ${SITE_URL}/nanny/invoices/new?placement=${u(402)}`);
    expect(email?.html).not.toContain("Olivia Hartley");
    expect([...claims.entries()]).toEqual([[`${u(SOPHIE)}/${MONDAY}`, FRIDAY.toISOString()]]);
  });

  it("nothing invoiced: one email naming both, with the plain form", async () => {
    world({ placements: [placement(1, SOPHIE, 11), placement(2, SOPHIE, 12)] });
    await run();
    expect(sends()).toHaveLength(1);
    expect(sends()[0]?.text).toContain("Olivia Hartley\nPriya Patel");
    expect(sends()[0]?.text).toContain(`Create invoice: ${SITE_URL}/nanny/invoices/new\n`);
  });

  it.each([
    ["both invoiced", { placements: [placement(3, BEN, 11), placement(4, BEN, 13)], invoices: WORKED.invoices }],
    ["a trial only (no placement)", { placements: [] }],
    ["suspended", { placements: [placement(5, CHLOE, 12)], nannies: [nanny(CHLOE, "suspended")] }],
    ["deactivated", { placements: [placement(5, CHLOE, 12)], nannies: [nanny(CHLOE, "deactivated")] }],
    ["the hire ended", { placements: [placement(1, SOPHIE, 11, { status: "ended" })] }],
    ["the hire starts next week", { placements: [placement(1, SOPHIE, 11, { start_date: "2027-02-15" })] }],
  ])("%s → no email, no claim", async (_label, data) => {
    world(data);
    expect(await run()).toEqual({ sent: 0, failed: 0, skipped: 0, readFailed: false });
    expect(sendEmail).not.toHaveBeenCalled();
    expect(claims.size).toBe(0);
  });
});

describe("claim, then send, then release on failure", () => {
  it("a claim another run holds → skipped, no send", async () => {
    world(WORKED);
    claims.set(`${u(SOPHIE)}/${MONDAY}`, "2027-02-12T16:00:01.000Z");
    expect(await run()).toEqual({ sent: 0, failed: 0, skipped: 1, readFailed: false });
    expect(sendEmail).not.toHaveBeenCalled();
    expect(claims.get(`${u(SOPHIE)}/${MONDAY}`)).toBe("2027-02-12T16:00:01.000Z");
  });

  it("a second run the same week sends nothing", async () => {
    world(WORKED);
    await run();
    expect(await run(new Date("2027-02-12T16:20:00Z"))).toEqual({ sent: 0, failed: 0, skipped: 1, readFailed: false });
    expect(sends()).toHaveLength(1);
  });

  it("a failed send releases its own claim and counts as failed; a later run that hour sends it", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    world(WORKED);
    sendEmail.mockResolvedValueOnce({ success: false, error: "provider down" });
    expect(await run()).toEqual({ sent: 0, failed: 1, skipped: 0, readFailed: false });
    expect(claims.size).toBe(0);
    expect(log).toHaveBeenCalledWith("[invoices] reminders.send failed", { code: "send_failed" });
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/provider down|babybloomnannies/);
    expect(await run(new Date("2027-02-12T16:30:00Z"))).toEqual({ sent: 1, failed: 0, skipped: 0, readFailed: false });
  });

  it("a send that throws is a failed send: released, logged by its name only", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    world(WORKED);
    sendEmail.mockRejectedValueOnce(new TypeError("fetch failed for admin+b065-701@babybloomnannies.co.uk"));
    expect(await run()).toEqual({ sent: 0, failed: 1, skipped: 0, readFailed: false });
    expect(claims.size).toBe(0);
    expect(log).toHaveBeenCalledWith("[invoices] reminders.send failed", { code: "TypeError" });
    expect(JSON.stringify(log.mock.calls)).not.toContain("babybloomnannies");
  });

  it("a claim that can't be written → failed, nothing sent", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    world(WORKED);
    f.writeErrors.nanny_invoice_reminders = { message: "x", code: "42501" };
    expect(await run()).toEqual({ sent: 0, failed: 1, skipped: 0, readFailed: false });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("no email on file → failed and logged by code, with no claim taken and nothing sent", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    world({ placements: [placement(2, SOPHIE, 12)], profiles: PROFILES.filter((p) => p.user_id !== u(600 + SOPHIE)) });
    expect(await run()).toEqual({ sent: 0, failed: 1, skipped: 0, readFailed: false });
    expect(sendEmail).not.toHaveBeenCalled();
    expect(claims.size).toBe(0);
    expect(log).toHaveBeenCalledWith("[invoices] reminders.send failed", { code: "no_email" });
  });

  it("nannies one at a time: the next send starts only after the last one finished; each is counted", async () => {
    world({ placements: [placement(1, SOPHIE, 11), placement(3, BEN, 13), placement(5, DANI, 12)] });
    let finishFirst: (v: { success: boolean }) => void = () => {};
    sendEmail.mockImplementationOnce(() => new Promise((resolve) => { finishFirst = resolve; }));
    sendEmail.mockResolvedValueOnce({ success: false });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const pending = runInvoiceReminders(proof, FRIDAY);
    await vi.waitFor(() => expect(sendEmail).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(sendEmail).toHaveBeenCalledTimes(1);
    finishFirst({ success: true });
    expect(await pending).toEqual({ ok: true, value: { sent: 2, failed: 1, skipped: 0, readFailed: false } });
    expect(sends().map((s) => s.recipientUserId)).toEqual([u(600 + SOPHIE), u(600 + BEN), u(600 + DANI)]);
  });

  it("logs the run's counts, and nothing else about anyone", async () => {
    world(WORKED);
    await run();
    expect(console.info).toHaveBeenCalledWith("[invoices] reminders run", { sent: 1, failed: 0, skipped: 0, readFailed: false });
  });
});

describe("reads and gates", () => {
  it("a read that fails → readFailed, nothing sent", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    world(WORKED);
    f.readErrors.nanny_invoices = { message: "timeout", code: "57014" };
    expect(await run()).toEqual({ sent: 0, failed: 0, skipped: 0, readFailed: true });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("switch off → invoices_disabled, with nothing read or sent", async () => {
    vi.stubEnv("NANNY_INVOICES_ENABLED", "");
    expect(await runInvoiceReminders(proof, FRIDAY)).toEqual({ ok: false, error: "invoices_disabled" });
    expect(createAdminClient).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("not a cron proof → invalid, with nothing read or sent", async () => {
    const fake = { kind: "invoice_cron_proof" } as unknown as InvoiceCronProof;
    expect(await runInvoiceReminders(fake, FRIDAY)).toEqual({ ok: false, error: "invalid" });
    expect(createAdminClient).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("the gates come before the clock: off at the wrong time is still invoices_disabled", async () => {
    vi.stubEnv("NANNY_INVOICES_ENABLED", "");
    expect(await runInvoiceReminders(proof, new Date("2027-02-10T09:00:00Z"))).toEqual({ ok: false, error: "invoices_disabled" });
  });

  it("now defaults to the real time", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(FRIDAY);
    const madeNow = proveInvoiceCron("Bearer s");
    world(WORKED);
    expect(await runInvoiceReminders(madeNow as InvoiceCronProof)).toEqual({ ok: true, value: { sent: 1, failed: 0, skipped: 0, readFailed: false } });
    vi.setSystemTime(new Date("2027-02-12T12:00:00Z"));
    expect(await runInvoiceReminders(proveInvoiceCron("Bearer s") as InvoiceCronProof)).toEqual({ ok: true, value: { skipped: "not_time" } });
  });
});
