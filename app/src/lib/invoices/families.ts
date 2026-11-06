/**
 * The families a nanny can invoice (plan 06 step 7; §12 R3 per BAI 2026-11-04: "allow nannies to select from their
 * connected parents/families"). Server-only, not `"use server"`.
 *
 * - **Regular week:** each of her placements, any status (active, paused, ended — a late last week is allowed),
 *   except the ones she dismissed (`[NANNY_DISMISSED]`, the `getNannyPlacements` rule in `position-funnel.ts`).
 * - **Trial Shift:** each of her connections with a trial date, at any stage (cancelled 50/51 after a worked trial
 *   included). A connection with no trial date and no placement is not listed.
 * - Each family shows the parent's name and the position's area (`suburb`, for every status).
 * - **Pre-fill** (06b-2, plan 14.3; the rules are `prefill.ts`): shift rows for the chosen week from her usual days
 *   (the position's schedule, else its days) with the placement's weekly hours split over them, or a Trial Shift's
 *   one row; her rate from the placement, the position, then her profile (`nannies.hourly_rate_min`). Nothing here
 *   is capped or changed: the form shows it and she edits it.
 * - Every read is the proof's nanny's; rows a query should never have returned are dropped again here. Reads are
 *   paged and chunked (`db.ts`). The database re-checks ownership when an invoice is created (amendment 21).
 *
 * Nothing is added to `position-funnel.ts` (brief §8). BB-wave1-041126/06a-build, 2026-11-04; 06b2-build, 2026-11-06.
 */

import { z } from "zod";
import { londonMondayOf, londonToday } from "@/lib/timezone";
import { allPages, allPagesByIds, parseRows, readOne, serviceClient, type AdminClient } from "./db";
import { nannyGate } from "./gate";
import { poundsToPence } from "./money";
import type { NannyProof } from "./nanny-proof";
import { pickRate, trialPrefill, usualDays, weekPrefill, type Prefill } from "./prefill";
import { FAILED, INVALID, INVOICE_KINDS, invoiceOk, refused, type InvoiceKind, type InvoiceResult } from "./types";
import { isFutureLondonDate, isLondonDate, isLondonMonday } from "./week";

export interface FamilyPlacement {
  readonly placementId: string;
  readonly status: "active" | "paused" | "ended";
  readonly startDate: string | null;
  readonly weeklyHours: number | null;
  readonly ratePence: number | null;
}

export interface FamilyTrial {
  readonly connectionId: string;
  readonly trialDate: string;
  readonly ratePence: number | null;
}

export interface InvoiceableFamily {
  readonly parentUserId: string;
  readonly familyName: string;
  readonly area: string | null;
  readonly placements: readonly FamilyPlacement[];
  readonly trials: readonly FamilyTrial[];
}

/**
 * One target, resolved for the review screen (brief §0.4: "This invoice goes to Olivia Hartley (olivia@…)"). The
 * email is a hint only — the address an invoice goes to is the database's snapshot on the created row (security L3).
 */
export interface InvoiceTarget {
  readonly kind: InvoiceKind;
  readonly targetId: string;
  readonly parentUserId: string;
  readonly familyName: string;
  readonly familyEmailHint: string;
  readonly area: string | null;
  readonly prefill: Prefill;
}

const DISMISSED = "[NANNY_DISMISSED]";
const STATUS_ORDER = ["active", "paused", "ended"] as const;
const PLACEMENT_COLUMNS = "id, nanny_id, parent_id, position_id, status, start_date, weekly_hours, hourly_rate, end_notes";
const CONNECTION_COLUMNS = "id, nanny_id, parent_id, position_id, trial_date";

const id = z.string().min(1);
const numeric = z.union([z.number(), z.string()]).nullable();
const placementRow = z.object({
  id, nanny_id: id, parent_id: id, position_id: id.nullable(), status: z.enum(STATUS_ORDER),
  start_date: z.string().nullable(), weekly_hours: numeric, hourly_rate: numeric, end_notes: z.string().nullable(),
});
const connectionRow = z.object({ id, nanny_id: id, parent_id: id, position_id: id.nullable(), trial_date: z.string().nullable() });
const parentRow = z.object({ id, user_id: id });
const profileRow = z.object({ user_id: id, first_name: z.string(), last_name: z.string() });
const contactRow = profileRow.extend({ email: z.string().min(1) });
const positionRow = z.object({ id, suburb: z.string().nullable(), hourly_rate: numeric });
const targetPositionRow = positionRow.extend({ days_required: z.array(z.string()).nullable() });
const scheduleRow = z.object({ position_id: id, schedule: z.unknown() });
const nannyRateRow = z.object({ id, hourly_rate_min: numeric });
type PlacementRow = z.output<typeof placementRow>;
type TargetPositionRow = z.output<typeof targetPositionRow>;
type ConnectionRow = z.output<typeof connectionRow>;
type PositionRow = z.output<typeof positionRow>;

interface People {
  readonly userOfParent: ReadonlyMap<string, string>;
  readonly nameOfUser: ReadonlyMap<string, string>;
  readonly positions: ReadonlyMap<string, PositionRow>;
}

/** "olivia@…": the address's local part, never its domain (brief §0.4). */
export function emailHint(email: string): string {
  const at = email.indexOf("@");
  return at > 0 ? `${email.slice(0, at)}@…` : "…";
}

const fullName = (p: { readonly first_name: string; readonly last_name: string }): string => `${p.first_name} ${p.last_name}`.trim();
const hoursOf = (value: number | string | null): number | null => {
  const n = value === null ? Number.NaN : Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
};
const isDismissed = (row: PlacementRow): boolean => row.end_notes?.includes(DISMISSED) ?? false;
const unique = (values: readonly (string | null)[]): string[] => [...new Set(values.filter((v): v is string => v !== null))];

/** Her non-dismissed placements and her trials with a date. */
async function readMine(admin: AdminClient, nannyId: string): Promise<InvoiceResult<{ placements: readonly PlacementRow[]; trials: readonly ConnectionRow[] }>> {
  const [placements, connections] = await Promise.all([
    allPages("families.placements", (from, to) =>
      admin.from("nanny_placements").select(PLACEMENT_COLUMNS).eq("nanny_id", nannyId).order("id", { ascending: true }).range(from, to)),
    allPages("families.trials", (from, to) =>
      admin.from("connection_requests").select(CONNECTION_COLUMNS).eq("nanny_id", nannyId).not("trial_date", "is", null)
        .order("id", { ascending: true }).range(from, to)),
  ]);
  const p = parseRows("families.placements", placements, placementRow);
  const c = parseRows("families.trials", connections, connectionRow);
  if (!p.ok) return p;
  if (!c.ok) return c;
  return invoiceOk({
    placements: p.value.filter((r) => r.nanny_id === nannyId && !isDismissed(r)),
    trials: c.value.filter((r) => r.nanny_id === nannyId && r.trial_date !== null && isLondonDate(r.trial_date)),
  });
}

/** The families' user ids and names, and the positions' areas and rates. */
async function readPeople(admin: AdminClient, parentIds: readonly string[], positionIds: readonly string[]): Promise<InvoiceResult<People>> {
  const parents = parseRows("families.parents", await allPagesByIds("families.parents", parentIds, (chunk) => (from, to) =>
    admin.from("parents").select("id, user_id").in("id", [...chunk]).order("id", { ascending: true }).range(from, to)), parentRow);
  if (!parents.ok) return parents;
  const userIds = unique(parents.value.map((p) => p.user_id));
  const [profiles, positions] = await Promise.all([
    allPagesByIds("families.profiles", userIds, (chunk) => (from, to) =>
      admin.from("user_profiles").select("user_id, first_name, last_name").in("user_id", [...chunk]).order("user_id", { ascending: true }).range(from, to)),
    allPagesByIds("families.positions", positionIds, (chunk) => (from, to) =>
      admin.from("nanny_positions").select("id, suburb, hourly_rate").in("id", [...chunk]).order("id", { ascending: true }).range(from, to)),
  ]);
  const names = parseRows("families.profiles", profiles, profileRow);
  const places = parseRows("families.positions", positions, positionRow);
  if (!names.ok) return names;
  if (!places.ok) return places;
  return invoiceOk({
    userOfParent: new Map(parents.value.map((p) => [p.id, p.user_id])),
    nameOfUser: new Map(names.value.map((p) => [p.user_id, fullName(p)])),
    positions: new Map(places.value.map((p) => [p.id, p])),
  });
}

const byStatusThenStart = (a: FamilyPlacement, b: FamilyPlacement): number =>
  STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status) || (b.startDate ?? "").localeCompare(a.startDate ?? "");

/** Pure: one entry per family she can invoice, by name; a family with no profile can't be invoiced and is left out. */
function groupFamilies(placements: readonly PlacementRow[], trials: readonly ConnectionRow[], people: People): InvoiceableFamily[] {
  const position = (pid: string | null): PositionRow | undefined => (pid === null ? undefined : people.positions.get(pid));
  const userIds = unique([...placements, ...trials].map((r) => people.userOfParent.get(r.parent_id) ?? null));
  return userIds.flatMap((userId): InvoiceableFamily[] => {
    const familyName = people.nameOfUser.get(userId);
    if (!familyName) return [];
    const isTheirs = (r: { readonly parent_id: string }) => people.userOfParent.get(r.parent_id) === userId;
    const own = placements.filter(isTheirs);
    const tried = trials.filter(isTheirs);
    const area = [...own, ...tried].map((r) => position(r.position_id)?.suburb ?? null).find((s) => s) ?? null;
    return [{
      parentUserId: userId,
      familyName,
      area,
      placements: own.map((r): FamilyPlacement => ({
        placementId: r.id, status: r.status, startDate: r.start_date, weeklyHours: hoursOf(r.weekly_hours), ratePence: poundsToPence(r.hourly_rate),
      })).sort(byStatusThenStart),
      trials: tried.map((r): FamilyTrial => ({
        connectionId: r.id, trialDate: r.trial_date ?? "", ratePence: poundsToPence(position(r.position_id)?.hourly_rate ?? null),
      })).sort((a, b) => b.trialDate.localeCompare(a.trialDate)),
    }];
  }).sort((a, b) => a.familyName.localeCompare(b.familyName, "en-GB"));
}

/** Every family she can invoice (plan step 7). */
export async function listInvoiceableFamilies(proof: NannyProof): Promise<InvoiceResult<readonly InvoiceableFamily[]>> {
  const refusal = nannyGate(proof);
  if (refusal) return refusal;
  const admin = serviceClient();
  if (!admin) return FAILED;
  const mine = await readMine(admin, proof.nannyId);
  if (!mine.ok) return mine;
  const { placements, trials } = mine.value;
  if (placements.length === 0 && trials.length === 0) return invoiceOk([]);
  const rows = [...placements, ...trials];
  const people = await readPeople(admin, unique(rows.map((r) => r.parent_id)), unique(rows.map((r) => r.position_id)));
  return people.ok ? invoiceOk(groupFamilies(placements, trials, people.value)) : people;
}

interface Link {
  readonly parentId: string;
  readonly positionId: string | null;
  readonly placement: PlacementRow | null;
  readonly trialDate: string | null;
}

/** Her placement (not dismissed) or her trial connection (with a date): its family and position. */
async function readLink(admin: AdminClient, kind: InvoiceKind, targetId: string, nannyId: string): Promise<InvoiceResult<Link>> {
  if (kind === "regular_week") {
    const r = await readOne("families.placement", () =>
      admin.from("nanny_placements").select(PLACEMENT_COLUMNS).eq("id", targetId).eq("nanny_id", nannyId).maybeSingle(), placementRow);
    if (!r.ok) return r;
    if (r.value === null || r.value.nanny_id !== nannyId || isDismissed(r.value)) return refused("not_hers");
    return invoiceOk({ parentId: r.value.parent_id, positionId: r.value.position_id, placement: r.value, trialDate: null });
  }
  const c = await readOne("families.trial", () =>
    admin.from("connection_requests").select(CONNECTION_COLUMNS).eq("id", targetId).eq("nanny_id", nannyId).maybeSingle(), connectionRow);
  if (!c.ok) return c;
  if (c.value === null || c.value.nanny_id !== nannyId) return refused("not_hers");
  if (c.value.trial_date === null || !isLondonDate(c.value.trial_date)) return refused("no_trial");
  return invoiceOk({ parentId: c.value.parent_id, positionId: c.value.position_id, placement: null, trialDate: c.value.trial_date });
}

interface PrefillRows {
  readonly position: TargetPositionRow | null;
  readonly schedule: unknown;
  readonly profileRate: number | string | null;
}

/** The position (area, rate, days), its schedule and her profile rate: the pre-fill's two extra reads (14.6 b2.5). */
async function readPrefillRows(admin: AdminClient, positionId: string | null, nannyId: string): Promise<InvoiceResult<PrefillRows>> {
  const none = <T>() => Promise.resolve(invoiceOk<T | null>(null));
  const [position, schedule, nanny] = await Promise.all([
    positionId === null ? none<TargetPositionRow>() : readOne("families.position", () =>
      admin.from("nanny_positions").select("id, suburb, hourly_rate, days_required").eq("id", positionId).maybeSingle(), targetPositionRow),
    positionId === null ? none<z.output<typeof scheduleRow>>() : readOne("families.schedule", () =>
      admin.from("position_schedule").select("position_id, schedule").eq("position_id", positionId).maybeSingle(), scheduleRow),
    readOne("families.rate", () => admin.from("nannies").select("id, hourly_rate_min").eq("id", nannyId).maybeSingle(), nannyRateRow),
  ]);
  if (!position.ok) return position;
  if (!schedule.ok) return schedule;
  if (!nanny.ok) return nanny;
  return invoiceOk({ position: position.value, schedule: schedule.value?.schedule ?? null, profileRate: nanny.value?.hourly_rate_min ?? null });
}

/** The form's starting rows and rate (14.3). */
function buildPrefill(kind: InvoiceKind, link: Link, rows: PrefillRows, weekStart: string, now: Date): Prefill {
  const rate = pickRate(kind, { placement: link.placement?.hourly_rate ?? null, position: rows.position?.hourly_rate ?? null, profile: rows.profileRate });
  const shifts = kind === "trial_shift" && link.trialDate !== null
    ? trialPrefill(link.trialDate, rate.ratePence)
    : weekPrefill({
        weekStart,
        days: usualDays(rows.schedule, rows.position?.days_required ?? null),
        weeklyHours: hoursOf(link.placement?.weekly_hours ?? null),
        ratePence: rate.ratePence,
        now,
      });
  return { shifts, ...rate };
}

/** The week a Regular week's rows fill: the one given (a London Monday, not future) or, by default, this week. */
function weekFor(weekStart: string | null, now: Date): InvoiceResult<string> {
  const week = weekStart ?? londonMondayOf(londonToday(now));
  if (!isLondonMonday(week)) return INVALID;
  return isFutureLondonDate(week, now) ? refused("future") : invoiceOk(week);
}

/**
 * Check one target is hers and resolve its family (plan step 7's `assertFamilyIsHers`) for the review screen, with the
 * form's pre-fill for `weekStart` (a Regular week; default this London week) or the trial date. The database applies
 * the ownership rules again, under her lock, when it creates the invoice (a dismissed placement, a trial's date), so a
 * caller that skipped this can't get past them.
 */
export async function resolveInvoiceTarget(
  proof: NannyProof,
  kind: InvoiceKind,
  targetId: string,
  weekStart: string | null = null,
  now: Date = new Date(),
): Promise<InvoiceResult<InvoiceTarget>> {
  const refusal = nannyGate(proof);
  if (refusal) return refusal;
  if (!INVOICE_KINDS.includes(kind) || !z.guid().safeParse(targetId).success) return INVALID;
  const week = weekFor(weekStart, now);
  if (kind === "regular_week" && !week.ok) return week;
  const admin = serviceClient();
  if (!admin) return FAILED;
  const link = await readLink(admin, kind, targetId, proof.nannyId);
  if (!link.ok) return link;
  const parent = await readOne("families.parent", () => admin.from("parents").select("id, user_id").eq("id", link.value.parentId).maybeSingle(), parentRow);
  if (!parent.ok) return parent;
  if (parent.value === null) return refused("not_hers");
  const userId = parent.value.user_id;
  const [contact, rows] = await Promise.all([
    readOne("families.contact", () => admin.from("user_profiles").select("user_id, first_name, last_name, email").eq("user_id", userId).maybeSingle(), contactRow),
    readPrefillRows(admin, link.value.positionId, proof.nannyId),
  ]);
  if (!contact.ok) return contact;
  if (!rows.ok) return rows;
  if (contact.value === null || fullName(contact.value) === "") return refused("no_contact");
  return invoiceOk({
    kind,
    targetId,
    parentUserId: userId,
    familyName: fullName(contact.value),
    familyEmailHint: emailHint(contact.value.email),
    area: rows.value.position?.suburb ?? null,
    prefill: buildPrefill(kind, link.value, rows.value, week.ok ? week.value : londonMondayOf(londonToday(now)), now),
  });
}
