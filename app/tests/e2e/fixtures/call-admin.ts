/**
 * Brief 04c-1 local proof (plan C7; BB-wave1-041126/04c1-build): the families behind /admin/calls — one in every
 * section and with every tag — and the admin who reads them. LOCAL STACK ONLY: `localDb` refuses any Supabase URL
 * that isn't localhost, so this can never touch bb-ldn or Sydney. Every fixture user is `admin+b04c1-…@…`, and
 * `removeCallsFixture` deletes everything they made (`PROOF/B04/04c-1/cleanup-queries.sql` is the same, in SQL).
 *
 *   Overdue            Priya Shah     a booked call that started an hour ago
 *   Today and upcoming Olivia Hartley tomorrow 14:00 (deposit paid; 5 nannies contacted, 2 replied)
 *                      Tom Reid       tomorrow 12:00, under a block ("Blocked over — move or cancel")
 *                      Ada Lowe       in four days, 10:00, a cohort pre-book
 *   Not booked         Sarah Jones    advanced, never booked
 *                      Grace Moss     answered, "call back later" tomorrow 17:00
 *                      Fay Morgan     quick match (no position), no answer earlier
 *                      Leo Hart       a test family (left out of the counts)
 *   History only       Noah Park      answered, deposit taken
 *                      Mia Fox        stop calling
 *
 * `call_settings.enabled_since` gets a fixture value just before the first fixture sign-up (so only these families
 * are in the to-call scope) and is restored afterwards (plan §12 R11: never stamped on read).
 */
import { randomBytes } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export const CALLS_EMAIL_PREFIX = "admin+b04c1-";
export const BLOCK_REASON = "b04c1 walk: school run";
const DOMAIN = "babybloomnannies.co.uk";
const MINUTE = 60_000;
const LOCAL = /^http:\/\/(127\.0\.0\.1|localhost):\d+$/;

/** Clients `localDb` made for a localhost URL: the only ones the fixture functions accept (review round 2 L12). */
const LOCAL_CLIENTS = new WeakSet<SupabaseClient>();

export function localDb(url: string, serviceKey: string): SupabaseClient {
  if (!LOCAL.test(url)) throw new Error("local stack only — refusing a non-localhost Supabase URL");
  const client = createClient(url, serviceKey, { auth: { persistSession: false } });
  LOCAL_CLIENTS.add(client);
  return client;
}

function assertLocal(db: SupabaseClient): void {
  if (!LOCAL_CLIENTS.has(db)) throw new Error("local stack only — refusing a client not made by localDb");
}

/** A fresh password per run, so none is fixed in this public repo (L12). Local-only users, removed after the run. */
function runPassword(): string {
  return `B04c1-${randomBytes(12).toString("base64url")}-1!`;
}

const LONDON_PARTS = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function londonWall(at: Date): { date: string; minutes: number } {
  const p = Object.fromEntries(LONDON_PARTS.formatToParts(at).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, minutes: Number(p.hour) * 60 + Number(p.minute) };
}

/** A London wall-clock time → its instant (two passes: GMT and BST alike). */
export function londonInstant(date: string, hour: number, minute: number): string {
  const guess = Date.parse(`${date}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00.000Z`);
  let at = guess;
  for (let pass = 0; pass < 2; pass += 1) {
    const wall = londonWall(new Date(at));
    const wallMs = Date.parse(`${wall.date}T00:00:00.000Z`) + wall.minutes * MINUTE;
    at += guess - wallMs;
  }
  return new Date(at).toISOString();
}

/** London's date `plusDays` from `at`. */
export function londonDate(at: Date, plusDays = 0): string {
  const today = londonWall(at).date;
  const d = new Date(`${today}T12:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + plusDays);
  return d.toISOString().slice(0, 10);
}

type Key = "olivia" | "priya" | "tom" | "ada" | "sarah" | "grace" | "fay" | "leo" | "noah" | "mia";

interface PositionSpec {
  readonly area: string;
  readonly hours: number;
  readonly days: readonly string[];
  readonly start: string;
  readonly ages: readonly number[];
  readonly contacted: number;
  readonly replied: number;
}

interface FamilySpec {
  readonly key: Key;
  readonly first: string;
  readonly last: string;
  readonly source: string;
  readonly test?: boolean;
  readonly position: PositionSpec | null;
}

const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
const FAMILIES: readonly FamilySpec[] = [
  { key: "noah", first: "Noah", last: "Park", source: "advanced_match", position: { area: "Richmond", hours: 25, days: ["Monday", "Wednesday"], start: "2026-12-07", ages: [14], contacted: 5, replied: 3 } },
  { key: "mia", first: "Mia", last: "Fox", source: "standard_match", position: null },
  { key: "olivia", first: "Olivia", last: "Hartley", source: "advanced_match", position: { area: "Islington", hours: 30, days: ["Monday", "Tuesday", "Wednesday"], start: "2026-12-01", ages: [8, 38], contacted: 5, replied: 2 } },
  { key: "priya", first: "Priya", last: "Shah", source: "advanced_match", position: { area: "Camden", hours: 20, days: ["Thursday", "Friday"], start: "2027-01-04", ages: [18], contacted: 3, replied: 0 } },
  { key: "tom", first: "Tom", last: "Reid", source: "advanced_match", position: { area: "Hackney", hours: 40, days: WEEKDAYS, start: "2026-11-23", ages: [26, 60], contacted: 4, replied: 1 } },
  { key: "ada", first: "Ada", last: "Lowe", source: "advanced_match", position: { area: "Clapham", hours: 15, days: ["Saturday"], start: "2027-02-01", ages: [5], contacted: 2, replied: 0 } },
  { key: "sarah", first: "Sarah", last: "Jones", source: "advanced_match", position: { area: "Greenwich", hours: 35, days: WEEKDAYS.slice(0, 4), start: "2026-12-14", ages: [30], contacted: 4, replied: 1 } },
  { key: "grace", first: "Grace", last: "Moss", source: "advanced_match", position: { area: "Wimbledon", hours: 24, days: ["Tuesday", "Thursday"], start: "2027-01-11", ages: [20, 48], contacted: 2, replied: 1 } },
  { key: "fay", first: "Fay", last: "Morgan", source: "standard_match", position: null },
  { key: "leo", first: "Leo", last: "Hart", source: "direct", test: true, position: null },
];

export interface FixtureFamily {
  readonly id: string;
  readonly email: string;
  readonly name: string;
  readonly positionId: string | null;
  bookingId: string | null;
  startsAt: string | null;
}

export interface CallsFixture {
  readonly adminId: string;
  readonly adminEmail: string;
  /** This run's password for every fixture user. */
  readonly password: string;
  readonly families: Record<Key, FixtureFamily>;
  readonly enabledSinceBefore: string | null;
  readonly enabledSince: string;
}

async function must<T>(label: string, query: PromiseLike<{ data: T; error: { message: string } | null }>): Promise<T> {
  const { data, error } = await query;
  if (error) throw new Error(`${label}: ${error.message}`);
  return data;
}

interface NewUser {
  readonly email: string;
  readonly password: string;
  readonly first: string;
  readonly last: string;
  readonly role: "admin" | "parent";
  readonly test: boolean;
}

async function createUser(db: SupabaseClient, { email, password, first, last, role, test }: NewUser): Promise<string> {
  const created = await db.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { first_name: first, last_name: last, role } });
  if (created.error || !created.data.user) throw new Error(`createUser ${email}: ${created.error?.message}`);
  const id = created.data.user.id;
  await must("user_roles", db.from("user_roles").insert({ user_id: id, role }));
  const mobile = role === "parent" ? `+4477009001${String(FAMILIES.findIndex((f) => f.first === first) + 10).padStart(2, "0")}` : null;
  await must("user_profiles", db.from("user_profiles").insert({ user_id: id, first_name: first, last_name: last, email, mobile_number: mobile, is_test_user: test }));
  return id;
}

async function nannyIds(db: SupabaseClient): Promise<readonly string[]> {
  const rows = await must("nannies", db.from("nannies").select("id").order("id").limit(6));
  return (rows as Array<{ id: string }>).map((r) => r.id);
}

async function addPosition(db: SupabaseClient, parentId: string, spec: PositionSpec, nannies: readonly string[]): Promise<string> {
  const pos = await must(
    "nanny_positions",
    db.from("nanny_positions").insert({ parent_id: parentId, suburb: spec.area, hours_per_week: spec.hours, days_required: spec.days, start_date: spec.start, stage: 1, position_status: 1 }).select("id").single(),
  );
  const positionId = (pos as { id: string }).id;
  const children = spec.ages.map((age, i) => ({ position_id: positionId, child_label: ["A", "B", "C"][i], age_months: age, display_order: i + 1 }));
  if (children.length) await must("position_children", db.from("position_children").insert(children));
  const contacted = nannies.slice(0, spec.contacted);
  const notes = contacted.map((nanny, i) => ({ position_id: positionId, nanny_id: nanny, match_score: 80 - i, status: i < spec.replied ? "interested" : "notified" }));
  if (notes.length) await must("dfy_match_notifications", db.from("dfy_match_notifications").insert(notes));
  const replies = contacted.slice(0, spec.replied).map((nanny) => ({ nanny_id: nanny, parent_id: parentId, position_id: positionId, status: "accepted", connection_stage: 9, responded_at: new Date().toISOString(), source: "dfy" }));
  if (replies.length) await must("connection_requests", db.from("connection_requests").insert(replies));
  return positionId;
}

interface FamilyRun {
  readonly run: string;
  readonly password: string;
  readonly signedUpAt: string;
  readonly nannies: readonly string[];
}

async function addFamily(db: SupabaseClient, spec: FamilySpec, { run, password, signedUpAt, nannies }: FamilyRun): Promise<FixtureFamily> {
  const email = `${CALLS_EMAIL_PREFIX}${spec.key}-${run}@${DOMAIN}`;
  const id = await createUser(db, { email, password, first: spec.first, last: spec.last, role: "parent", test: spec.test === true });
  const parent = await must("parents", db.from("parents").insert({ user_id: id, signup_source: spec.source, created_at: signedUpAt }).select("id").single());
  const positionId = spec.position ? await addPosition(db, (parent as { id: string }).id, spec.position, nannies) : null;
  return { id, email, name: `${spec.first} ${spec.last}`, positionId, bookingId: null, startsAt: null };
}

interface BookingSpec {
  readonly now: Date;
  readonly family: FixtureFamily;
  readonly startsAt: string;
  readonly status?: "booked" | "done";
  readonly purpose?: "first_call" | "cohort_prebook";
}

async function addBooking(db: SupabaseClient, b: BookingSpec): Promise<void> {
  const endsAt = new Date(Date.parse(b.startsAt) + 30 * MINUTE).toISOString();
  const status = b.status ?? "booked";
  const row = await must(
    "call_bookings",
    db
      .from("call_bookings")
      .insert({ parent_user_id: b.family.id, position_id: b.family.positionId, starts_at: b.startsAt, ends_at: endsAt, status, purpose: b.purpose ?? "first_call", booked_by_kind: "parent", booked_by: b.family.id, booked_at: new Date(Math.min(b.now.getTime(), Date.parse(b.startsAt)) - 30 * MINUTE).toISOString(), closed_at: status === "done" ? endsAt : null })
      .select("id")
      .single(),
  );
  b.family.bookingId = (row as { id: string }).id;
  b.family.startsAt = b.startsAt;
}

/** Where the fixture's scope starts: 150 minutes back, or just after the latest local sign-up that isn't ours. */
async function scopeStart(db: SupabaseClient, now: Date): Promise<number> {
  const latest = await must("parents", db.from("parents").select("created_at").order("created_at", { ascending: false }).limit(1));
  const last = (latest as Array<{ created_at: string }>)[0];
  return Math.max(now.getTime() - 150 * MINUTE, last ? Date.parse(last.created_at) + MINUTE : 0);
}

async function addBookingsAndAttempts(db: SupabaseClient, f: Record<Key, FixtureFamily>, adminId: string, now: Date): Promise<void> {
  const tomorrow = londonDate(now, 1);
  const halfHour = Math.floor(now.getTime() / (30 * MINUTE)) * 30 * MINUTE;
  await addBooking(db, { now, family: f.priya, startsAt: new Date(halfHour - 60 * MINUTE).toISOString() });
  await addBooking(db, { now, family: f.olivia, startsAt: londonInstant(tomorrow, 14, 0) });
  await addBooking(db, { now, family: f.tom, startsAt: londonInstant(tomorrow, 12, 0) });
  await addBooking(db, { now, family: f.ada, startsAt: londonInstant(londonDate(now, 4), 10, 0), purpose: "cohort_prebook" });
  await addBooking(db, { now, family: f.noah, startsAt: new Date(halfHour - 90 * MINUTE).toISOString(), status: "done" });
  // Olivia paid her deposit two days ago (amendment 12's columns; the drawer shows it read-only).
  const paidAt = new Date(now.getTime() - 2 * 24 * 60 * MINUTE).toISOString();
  await must("parent_subscriptions", db.from("parent_subscriptions").insert({ parent_user_id: f.olivia.id, status: "deposit_paid", family_type: "dfy", deposit_pence: 15000, deposit_paid_at: paidAt }));
  await must("call_blocks", db.from("call_blocks").insert({ starts_at: londonInstant(tomorrow, 11, 30), ends_at: londonInstant(tomorrow, 13, 0), reason: BLOCK_REASON, created_by: adminId }));
  const at = (minutesAgo: number) => new Date(now.getTime() - minutesAgo * MINUTE).toISOString();
  const entry = (family: FixtureFamily, over: Record<string, unknown>) => ({ parent_user_id: family.id, recorded_by: adminId, method: "phone", source: "manual", ...over });
  await must(
    "call_log_entries",
    db.from("call_log_entries").insert([
      entry(f.noah, { booking_id: f.noah.bookingId, occurred_at: at(70), result: "answered", outcome: "deposit_taken", note: "Deposit taken over the phone." }),
      entry(f.mia, { occurred_at: at(60), result: null, outcome: "stop_calling", note: "Found a nanny elsewhere." }),
      entry(f.grace, { occurred_at: at(30), result: "answered", outcome: "call_back_later", note: "Wants to talk to her partner first.", call_back_at: londonInstant(tomorrow, 17, 0) }),
      entry(f.fay, { occurred_at: at(20), result: "no_answer", note: null }),
    ]),
  );
}

/** Make the whole fixture. */
export async function createCallsFixture(db: SupabaseClient, run: string, now: Date = new Date()): Promise<CallsFixture> {
  assertLocal(db);
  await removeCallsFixture(db); // a run that died left rows behind: start clean
  const before = await must("call_settings", db.from("call_settings").select("enabled_since").eq("id", 1).single());
  const password = runPassword();
  const adminEmail = `${CALLS_EMAIL_PREFIX}admin-${run}@${DOMAIN}`;
  const adminId = await createUser(db, { email: adminEmail, password, first: "Sam", last: "Admin", role: "admin", test: false });
  const start = await scopeStart(db, now);
  const nannies = await nannyIds(db);
  const entries: Array<[Key, FixtureFamily]> = [];
  for (const [i, spec] of FAMILIES.entries()) {
    const signedUpAt = new Date(start + (i + 1) * 4 * MINUTE).toISOString();
    entries.push([spec.key, await addFamily(db, spec, { run, password, signedUpAt, nannies })]);
  }
  const families = Object.fromEntries(entries) as Record<Key, FixtureFamily>;
  await addBookingsAndAttempts(db, families, adminId, now);
  const enabledSince = new Date(start).toISOString();
  await must("call_settings", db.from("call_settings").update({ enabled_since: enabledSince }).eq("id", 1));
  return { adminId, adminEmail, password, families, enabledSinceBefore: (before as { enabled_since: string | null }).enabled_since, enabledSince };
}

async function fixtureUserIds(db: SupabaseClient): Promise<string[]> {
  const rows = await must("user_profiles", db.from("user_profiles").select("user_id").like("email", `${CALLS_EMAIL_PREFIX}%`));
  return (rows as Array<{ user_id: string }>).map((r) => r.user_id);
}

const CALL_TABLES_BY_PARENT = ["call_log_entries", "call_nudges", "call_bookings", "parent_subscriptions"] as const;

/** Positions' stats rows (not linked by a foreign key), then the families' parents rows (positions, children,
 *  notifications and connection requests cascade from them). */
async function removeFamilies(db: SupabaseClient, ids: readonly string[]): Promise<void> {
  const parents = (await must("parents", db.from("parents").select("id").in("user_id", ids))) as Array<{ id: string }>;
  if (parents.length === 0) return;
  const positions = (await must("nanny_positions", db.from("nanny_positions").select("id").in("parent_id", parents.map((p) => p.id)))) as Array<{ id: string }>;
  const positionIds = positions.map((p) => p.id);
  if (positionIds.length) {
    await must("connection_stats", db.from("connection_stats").delete().in("position_id", positionIds));
    await must("position_stats", db.from("position_stats").delete().in("position_id", positionIds));
  }
  await must("parents", db.from("parents").delete().in("user_id", ids));
}

/**
 * Delete every public row the fixture made, and restore `enabled_since` when given. The `auth.users` rows stay:
 * the local auth service can't delete users on this stack (its role lacks rights on `katie_prompt_version`), so
 * `PROOF/B04/04c-1/cleanup-queries.sql` removes them with psql. With no profile, role or parents row left they are
 * inert.
 */
export async function removeCallsFixture(db: SupabaseClient, enabledSinceBefore?: string | null): Promise<void> {
  assertLocal(db);
  await must("call_blocks", db.from("call_blocks").delete().eq("reason", BLOCK_REASON));
  const ids = await fixtureUserIds(db);
  if (ids.length > 0) {
    await must("activity_logs", db.from("activity_logs").delete().in("user_id", ids));
    for (const table of CALL_TABLES_BY_PARENT) await must(table, db.from(table).delete().in("parent_user_id", ids));
    await removeFamilies(db, ids);
    await must("user_stats", db.from("user_stats").delete().in("user_id", ids));
    await must("user_roles", db.from("user_roles").delete().in("user_id", ids));
    await must("user_profiles", db.from("user_profiles").delete().in("user_id", ids));
  }
  await must("email_logs", db.from("email_logs").delete().like("recipient_email", `${CALLS_EMAIL_PREFIX}%`));
  if (enabledSinceBefore !== undefined) await must("call_settings", db.from("call_settings").update({ enabled_since: enabledSinceBefore }).eq("id", 1));
}
