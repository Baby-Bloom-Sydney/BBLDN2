/**
 * The families a nanny can invoice (plan 06 step 7; §12 R3 per BAI 2026-11-04: "allow nannies to select from their
 * connected parents/families"; 06b-4 rework, BAI 2026-11-12: one family picker, no Regular week / Trial Shift choice).
 * Server-only, not `"use server"`.
 *
 * - **One entry per family (one parent)**, from both sets: her placements with that parent of any status (active,
 *   paused, ended — a late invoice is allowed) except the ones she dismissed (`[NANNY_DISMISSED]`, the
 *   `getNannyPlacements` rule in `position-funnel.ts`), and her connections with that parent that have a trial date,
 *   at any stage. A family with neither is not listed; nor is one with no profile (it can't be invoiced).
 * - **The link** (amendment 21's rule, spec h, ledger reading 1): her placement with that parent — active, then paused,
 *   then the rest; the latest start first; then by id — else her connection with that parent with the latest trial
 *   date (then by id). The kind is the link's type, never chosen: a placement is `regular_week`, a connection
 *   `trial_shift`. The draft sends the link's id (`targetId`).
 * - **The earliest date** she can invoice (reading 2): the earlier of her first trial date with that parent and the
 *   linked placement's start; with neither, the placement's creation date in London (and, were that missing too,
 *   London's today, the strictest answer). London's today is the latest; there is no look-back limit.
 * - **The rate** every new shift row starts with (`prefill.ts`): the linked placement's, the position's, then her
 *   profile's (`nannies.hourly_rate_min`). A failed or malformed read of her profile rate only leaves that part blank.
 * - Each family shows the parent's name and the area of the link's position (else any of its positions).
 * - **Resolving** any of her ids for a family (her placement — not dismissed — or her trial connection) gives that
 *   family's entry, as the database works it out from the same rows; the review adds the family's email hint.
 * - Every read is the proof's nanny's; rows a query should never have returned are dropped again here. Reads are
 *   paged and chunked (`db.ts`). The database re-checks ownership when an invoice is created (amendment 21).
 *
 * Nothing is added to `position-funnel.ts` (brief §8). BB-wave1-041126/06a-build, 2026-11-04; 06b2-build,
 * 2026-11-06; BB-wave1-041126/06b4-server, 2026-11-12.
 */

import { z } from "zod";
import { londonDateOf, londonToday } from "@/lib/timezone";
import { allPages, allPagesByIds, parseRows, readOne, serviceClient, type AdminClient } from "./db";
import { nannyGate } from "./gate";
import type { NannyProof } from "./nanny-proof";
import { pickRate, type RateSource } from "./prefill";
import { FAILED, INVALID, invoiceOk, refused, type InvoiceKind, type InvoiceResult } from "./types";
import { isLondonDate } from "./week";

/** One family she can invoice, as the picker lists it. */
export interface InvoiceableFamily {
  readonly parentUserId: string;
  readonly familyName: string;
  readonly area: string | null;
  /** The family's link id, which the draft sends: her placement's id, else her connection's. */
  readonly targetId: string;
  /** The link's type, derived and never chosen. */
  readonly kind: InvoiceKind;
  /** The first date she can invoice this family for ("YYYY-MM-DD"); London's today is the last. */
  readonly earliest: string;
  /** The rate every new shift row starts with, in pence; null = blank. */
  readonly ratePence: number | null;
  readonly rateSource: RateSource | null;
}

/**
 * One family, resolved for the review screen (brief §0.4: "This invoice goes to Olivia Hartley (olivia@…)"). The
 * email is a hint only — the address an invoice goes to is the database's snapshot on the created row (security L3).
 */
export interface InvoiceTarget extends InvoiceableFamily {
  readonly familyEmailHint: string;
}

const DISMISSED = "[NANNY_DISMISSED]";
const STATUS_ORDER = ["active", "paused", "ended"] as const;
const PLACEMENT_COLUMNS = "id, nanny_id, parent_id, position_id, status, start_date, hourly_rate, end_notes, created_at";
const CONNECTION_COLUMNS = "id, nanny_id, parent_id, position_id, trial_date";

const id = z.string().min(1);
const numeric = z.union([z.number(), z.string()]).nullable();
const date = z.string().refine(isLondonDate);
const placementRow = z.object({
  id, nanny_id: id, parent_id: id, position_id: id.nullable(), status: z.enum(STATUS_ORDER), start_date: date.nullable(),
  hourly_rate: numeric, end_notes: z.string().nullable(), created_at: z.string().nullable(),
});
const connectionRow = z.object({ id, nanny_id: id, parent_id: id, position_id: id.nullable(), trial_date: z.string().nullable() });
const parentRow = z.object({ id, user_id: id });
const profileRow = z.object({ user_id: id, first_name: z.string(), last_name: z.string() });
const contactRow = profileRow.extend({ email: z.string().min(1) });
const positionRow = z.object({ id, suburb: z.string().nullable(), hourly_rate: numeric });
const nannyRateRow = z.object({ id, hourly_rate_min: numeric });
type PlacementRow = z.output<typeof placementRow>;
type ConnectionRow = z.output<typeof connectionRow>;
type TrialRow = ConnectionRow & { readonly trial_date: string };
type PositionRow = z.output<typeof positionRow>;

/** Her rows with one parent: placements in link order, trials latest first. */
interface Family {
  readonly parentId: string;
  readonly placements: readonly PlacementRow[];
  readonly trials: readonly TrialRow[];
}

/** What the entry needs beyond her rows: the family's user and name, the positions, her profile rate. */
interface Facts {
  readonly userId: string;
  readonly familyName: string;
  readonly positions: ReadonlyMap<string, PositionRow>;
  readonly profileRate: number | string | null;
}

/** "olivia@…": the address's local part, never its domain (brief §0.4). */
export function emailHint(email: string): string {
  const at = email.indexOf("@");
  return at > 0 ? `${email.slice(0, at)}@…` : "…";
}

const fullName = (p: { readonly first_name: string; readonly last_name: string }): string => `${p.first_name} ${p.last_name}`.trim();
/** A placement she dismissed (`[NANNY_DISMISSED]` in its end notes); the Friday reminder reads the same rule (06b-5). */
export const isDismissed = (row: { readonly end_notes: string | null }): boolean => row.end_notes?.includes(DISMISSED) ?? false;
const unique = (values: readonly (string | null)[]): string[] => [...new Set(values.filter((v): v is string => v !== null))];
const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const hasTrial = (row: ConnectionRow): row is TrialRow => row.trial_date !== null && isLondonDate(row.trial_date);

/** Today's family-list order: active, then paused, then the rest; the latest start first (none last); then by id. */
const byLinkOrder = (a: PlacementRow, b: PlacementRow): number =>
  STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status) || compare(b.start_date ?? "", a.start_date ?? "") || compare(a.id, b.id);
const byLatestTrial = (a: TrialRow, b: TrialRow): number => compare(b.trial_date, a.trial_date) || compare(a.id, b.id);

/** Pure: her rows grouped by parent, each family's rows in link order. */
function familiesOf(placements: readonly PlacementRow[], trials: readonly TrialRow[]): Family[] {
  return unique([...placements, ...trials].map((r) => r.parent_id)).map((parentId) => ({
    parentId,
    placements: placements.filter((r) => r.parent_id === parentId).sort(byLinkOrder),
    trials: trials.filter((r) => r.parent_id === parentId).sort(byLatestTrial),
  }));
}

/** Pure: the link's kind and id, its placement (a connection link has none) and its position. */
function linkOf(family: Family): { readonly kind: InvoiceKind; readonly targetId: string; readonly placement: PlacementRow | null; readonly positionId: string | null } {
  const [placement] = family.placements;
  if (placement) return { kind: "regular_week", targetId: placement.id, placement, positionId: placement.position_id };
  const [trial] = family.trials;
  return { kind: "trial_shift", targetId: trial?.id ?? "", placement: null, positionId: trial?.position_id ?? null };
}

/** Pure (reading 2): the earlier of her first trial date and the linked placement's start; else its creation in London. */
function earliestOf(family: Family, placement: PlacementRow | null, now: Date): string {
  const dates = [...family.trials.map((t) => t.trial_date), placement?.start_date ?? null].filter((d): d is string => d !== null).sort(compare);
  const [first] = dates;
  if (first !== undefined) return first;
  const created = placement?.created_at ? new Date(placement.created_at) : null;
  return created && !Number.isNaN(created.getTime()) ? londonDateOf(created) : londonToday(now);
}

/** Pure: one family's entry from its rows and facts. */
function entryOf(family: Family, facts: Facts, now: Date): InvoiceableFamily {
  const link = linkOf(family);
  const position = (pid: string | null): PositionRow | undefined => (pid === null ? undefined : facts.positions.get(pid));
  const positionIds = [link.positionId, ...family.placements.map((r) => r.position_id), ...family.trials.map((r) => r.position_id)];
  const rate = pickRate({ placement: link.placement?.hourly_rate ?? null, position: position(link.positionId)?.hourly_rate ?? null, profile: facts.profileRate });
  return {
    parentUserId: facts.userId,
    familyName: facts.familyName,
    area: positionIds.map((pid) => position(pid)?.suburb ?? null).find((s) => s) ?? null,
    targetId: link.targetId,
    kind: link.kind,
    earliest: earliestOf(family, link.placement, now),
    ...rate,
  };
}

/** Her non-dismissed placements and her trials with a date, grouped by family. */
async function readMine(admin: AdminClient, nannyId: string): Promise<InvoiceResult<readonly Family[]>> {
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
  const mine = <R extends { readonly nanny_id: string }>(r: R) => r.nanny_id === nannyId;
  return invoiceOk(familiesOf(p.value.filter((r) => mine(r) && !isDismissed(r)), c.value.filter(mine).filter(hasTrial)));
}

/** The positions' areas and rates. */
async function readPositions(admin: AdminClient, positionIds: readonly string[]): Promise<InvoiceResult<ReadonlyMap<string, PositionRow>>> {
  const rows = parseRows("families.positions", await allPagesByIds("families.positions", positionIds, (chunk) => (from, to) =>
    admin.from("nanny_positions").select("id, suburb, hourly_rate").in("id", [...chunk]).order("id", { ascending: true }).range(from, to)), positionRow);
  return rows.ok ? invoiceOk(new Map(rows.value.map((p) => [p.id, p]))) : rows;
}

/** Her profile rate: it only fills in the form, so a failed or malformed read leaves it blank (logged by code). */
async function readProfileRate(admin: AdminClient, nannyId: string): Promise<number | string | null> {
  const r = await readOne("families.rate", () => admin.from("nannies").select("id, hourly_rate_min").eq("id", nannyId).maybeSingle(), nannyRateRow);
  return r.ok ? r.value?.hourly_rate_min ?? null : null;
}

const positionIdsOf = (families: readonly Family[]): string[] =>
  unique(families.flatMap((fam) => [...fam.placements, ...fam.trials].map((r) => r.position_id)));

/** The families' user ids and names. */
async function readNames(admin: AdminClient, parentIds: readonly string[]): Promise<InvoiceResult<ReadonlyMap<string, { userId: string; name: string }>>> {
  const parents = parseRows("families.parents", await allPagesByIds("families.parents", parentIds, (chunk) => (from, to) =>
    admin.from("parents").select("id, user_id").in("id", [...chunk]).order("id", { ascending: true }).range(from, to)), parentRow);
  if (!parents.ok) return parents;
  const profiles = parseRows("families.profiles", await allPagesByIds("families.profiles", unique(parents.value.map((p) => p.user_id)), (chunk) => (from, to) =>
    admin.from("user_profiles").select("user_id, first_name, last_name").in("user_id", [...chunk]).order("user_id", { ascending: true }).range(from, to)), profileRow);
  if (!profiles.ok) return profiles;
  const nameOf = new Map(profiles.value.map((p) => [p.user_id, fullName(p)]));
  return invoiceOk(new Map(parents.value.flatMap((p) => {
    const name = nameOf.get(p.user_id);
    return name ? [[p.id, { userId: p.user_id, name }] as const] : [];
  })));
}

/** Every family she can invoice today, by name (spec a). */
export async function listInvoiceableFamilies(proof: NannyProof, now: Date = new Date()): Promise<InvoiceResult<readonly InvoiceableFamily[]>> {
  const refusal = nannyGate(proof);
  if (refusal) return refusal;
  const admin = serviceClient();
  if (!admin) return FAILED;
  const mine = await readMine(admin, proof.nannyId);
  if (!mine.ok) return mine;
  if (mine.value.length === 0) return invoiceOk([]);
  const names = await readNames(admin, mine.value.map((fam) => fam.parentId));
  if (!names.ok) return names;
  const [positions, profileRate] = await Promise.all([readPositions(admin, positionIdsOf(mine.value)), readProfileRate(admin, proof.nannyId)]);
  if (!positions.ok) return positions;
  return invoiceOk(mine.value.flatMap((fam): InvoiceableFamily[] => {
    const who = names.value.get(fam.parentId);
    return who ? [entryOf(fam, { userId: who.userId, familyName: who.name, positions: positions.value, profileRate }, now)] : [];
  }).sort((a, b) => a.familyName.localeCompare(b.familyName, "en-GB")));
}

/** The family's user, its contact (name and email) — none is `not_hers` / `no_contact`. */
async function readContact(admin: AdminClient, parentId: string): Promise<InvoiceResult<{ readonly userId: string; readonly name: string; readonly email: string }>> {
  const parent = await readOne("families.parent", () => admin.from("parents").select("id, user_id").eq("id", parentId).maybeSingle(), parentRow);
  if (!parent.ok) return parent;
  if (parent.value === null) return refused("not_hers");
  const userId = parent.value.user_id;
  const contact = await readOne("families.contact", () =>
    admin.from("user_profiles").select("user_id, first_name, last_name, email").eq("user_id", userId).maybeSingle(), contactRow);
  if (!contact.ok) return contact;
  if (contact.value === null || fullName(contact.value) === "") return refused("no_contact");
  return invoiceOk({ userId, name: fullName(contact.value), email: contact.value.email });
}

/**
 * Check an id is one of hers for a family (her placement, not dismissed, or her trial connection) and resolve that
 * family — its link, kind, earliest date and rate, as the list gives them — for the review screen. The database works
 * out the same from the same rows, under her lock, when it creates the invoice, so a caller that skipped this can't
 * get past it.
 */
export async function resolveInvoiceTarget(proof: NannyProof, targetId: string, now: Date = new Date()): Promise<InvoiceResult<InvoiceTarget>> {
  const refusal = nannyGate(proof);
  if (refusal) return refusal;
  if (!z.guid().safeParse(targetId).success) return INVALID;
  const admin = serviceClient();
  if (!admin) return FAILED;
  const mine = await readMine(admin, proof.nannyId);
  if (!mine.ok) return mine;
  const family = mine.value.find((fam) => [...fam.placements, ...fam.trials].some((r) => r.id === targetId));
  if (!family) return refused("not_hers");
  const contact = await readContact(admin, family.parentId);
  if (!contact.ok) return contact;
  const [positions, profileRate] = await Promise.all([readPositions(admin, positionIdsOf([family])), readProfileRate(admin, proof.nannyId)]);
  if (!positions.ok) return positions;
  const { userId, name, email } = contact.value;
  return invoiceOk({ ...entryOf(family, { userId, familyName: name, positions: positions.value, profileRate }, now), familyEmailHint: emailHint(email) });
}
