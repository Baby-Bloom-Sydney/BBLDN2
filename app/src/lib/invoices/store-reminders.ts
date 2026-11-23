/**
 * The Friday invoice reminder's reads and its claim (plan 06 §16.7 b5.3; §16.0, BAI 2026-11-23; §16.5). Server-only,
 * and deliberately NOT a `"use server"` file: it reads every nanny's hires with the service role.
 *
 * - **Every operation passes `cronGate` first:** the switch (`invoices_disabled`, before a client is made), then the
 *   cron proof (`invalid`). Nothing here reads a session; only the cron route can make the proof.
 * - **A running hire:** a `nanny_placements` row that is `active`, not dismissed (the family list's rule,
 *   `families.ts`), and started by the week's Sunday or with no start date. Any source of placement counts.
 * - **Her account:** `nannies.status` is not `suspended` or `deactivated` (amendment 21's rule).
 * - **Already invoiced** (§16.0): a live invoice (`countsAsSent`) linked to one of her placements with that family,
 *   holding a shift line dated Monday–Sunday of the week. Invoices of expenses only, trial invoices (linked to the
 *   connection) and invoices whose shifts all fall in other weeks don't count. The query asks for exactly that; the
 *   rows are checked again here, whatever it returned.
 * - **Per nanny:** her user id, first name and profile email (null when there's none: the runner counts it failed),
 *   and each family left — one entry per family, carrying the placement the button links to (her latest-starting
 *   hire with them, then by id) and the parent's name. A family with no parent row or profile can't be invoiced, so
 *   it's left out (logged by code).
 * - **The claim** (`nanny_invoice_reminders`, amendment 21): an upsert that ignores duplicates on (nanny, week) —
 *   true when this run wrote it, false when another holds it. The release deletes only the claim with its own stamp.
 * - Reads are paged and chunked (`db.ts`); failures are logged by code only; results are closed codes, never thrown.
 *
 * BB-wave1-041126/06b5-app, 2026-11-23.
 */

import { z } from "zod";
import { APP_LOCALE } from "@/lib/constants";
import type { InvoiceCronProof } from "./cron-proof";
import { allPages, allPagesByIds, logFailure, parseRows, serviceClient, type AdminClient } from "./db";
import { isDismissed } from "./families";
import { cronGate } from "./gate";
import { countsAsSent } from "./status";
import { FAILED, INVALID, INVOICE_STATUSES, invoiceOk, LINE_KINDS, type InvoiceResult } from "./types";
import { isLondonDate, isLondonMonday, weekEndOf } from "./week";

/** One family she hasn't invoiced for the week, and the placement the email's button opens the form with. */
export interface DueFamily {
  readonly placementId: string;
  readonly familyName: string;
}

/** One nanny's reminder: who she is, where it goes, and the families left (in name order, at least one). */
export interface DueReminder {
  readonly nannyId: string;
  readonly userId: string;
  readonly firstName: string;
  readonly email: string | null;
  readonly families: readonly DueFamily[];
}

const CLAIMS = "nanny_invoice_reminders";
/** Amendment 21's rule: these accounts can't send an invoice, so they get no reminder. */
const LEFT_OUT_STATUSES: ReadonlySet<string> = new Set(["suspended", "deactivated"]);
const PLACEMENT_COLUMNS = "id, nanny_id, parent_id, status, start_date, end_notes";
const INVOICE_COLUMNS = "id, placement_id, status, pdf_path, nanny_invoice_lines(kind, shift_date)";

const id = z.string().min(1);
const date = z.string().refine(isLondonDate);
const placementRow = z.object({ id, nanny_id: id, parent_id: id, status: z.string(), start_date: date.nullable(), end_notes: z.string().nullable() });
const nannyRow = z.object({ id, user_id: id, status: z.string().nullable() });
const invoiceRow = z.object({
  id, placement_id: id.nullable(), status: z.enum(INVOICE_STATUSES), pdf_path: z.string().nullable(),
  nanny_invoice_lines: z.array(z.object({ kind: z.enum(LINE_KINDS), shift_date: date.nullable() })),
});
const parentRow = z.object({ id, user_id: id });
const profileRow = z.object({ user_id: id, first_name: z.string(), last_name: z.string(), email: z.string() });
type PlacementRow = z.output<typeof placementRow>;
type NannyRow = z.output<typeof nannyRow>;
type ProfileRow = z.output<typeof profileRow>;

/** A family she has a running hire with and hasn't invoiced for the week. */
interface OpenFamily {
  readonly nannyId: string;
  readonly parentId: string;
  readonly placementId: string;
}

interface Names {
  readonly parentUsers: ReadonlyMap<string, string>;
  readonly profiles: ReadonlyMap<string, ProfileRow>;
}

const guid = z.guid();
const stampSchema = z.iso.datetime();
const unique = (values: readonly (string | null | undefined)[]): string[] => [...new Set(values.filter((v): v is string => typeof v === "string"))];
const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
/** Her latest-starting hire first (none last), then by id: the link the family list gives the family too. */
const byLinkOrder = (a: PlacementRow, b: PlacementRow): number => compare(b.start_date ?? "", a.start_date ?? "") || compare(a.id, b.id);
const byName = (a: DueFamily, b: DueFamily): number => a.familyName.localeCompare(b.familyName, APP_LOCALE) || compare(a.placementId, b.placementId);
const fullName = (p: ProfileRow): string => `${p.first_name} ${p.last_name}`.trim();

/** Pure: a hire that is running in the week ending `sunday`. The query asks for `active`; it's checked again here. */
const runsBy = (sunday: string) => (p: PlacementRow): boolean =>
  p.status === "active" && !isDismissed(p) && (p.start_date === null || p.start_date <= sunday);

async function readRunning(admin: AdminClient, sunday: string): Promise<InvoiceResult<readonly PlacementRow[]>> {
  const rows = parseRows("reminders.placements", await allPages("reminders.placements", (from, to) =>
    admin.from("nanny_placements").select(PLACEMENT_COLUMNS).eq("status", "active").order("id", { ascending: true }).range(from, to)), placementRow);
  return rows.ok ? invoiceOk(rows.value.filter(runsBy(sunday))) : rows;
}

/** The nannies that may get a reminder, by id (suspended and deactivated accounts left out). */
async function readNannies(admin: AdminClient, nannyIds: readonly string[]): Promise<InvoiceResult<ReadonlyMap<string, NannyRow>>> {
  const rows = parseRows("reminders.nannies", await allPagesByIds("reminders.nannies", nannyIds, (chunk) => (from, to) =>
    admin.from("nannies").select("id, user_id, status").in("id", [...chunk]).order("id", { ascending: true }).range(from, to)), nannyRow);
  if (!rows.ok) return rows;
  return invoiceOk(new Map(rows.value.filter((n) => !LEFT_OUT_STATUSES.has(n.status ?? "")).map((n) => [n.id, n])));
}

/** The placements with a live invoice holding a shift dated in the week (§16.0). */
async function readInvoiced(admin: AdminClient, placementIds: readonly string[], monday: string, sunday: string): Promise<InvoiceResult<ReadonlySet<string>>> {
  const rows = parseRows("reminders.invoices", await allPagesByIds("reminders.invoices", placementIds, (chunk) => (from, to) =>
    admin.from("nanny_invoices").select(INVOICE_COLUMNS).in("placement_id", [...chunk]).eq("status", "sent").not("pdf_path", "is", null)
      .lte("period_start", sunday).gte("period_end", monday)
      .eq("nanny_invoice_lines.kind", "shift").gte("nanny_invoice_lines.shift_date", monday).lte("nanny_invoice_lines.shift_date", sunday)
      .order("id", { ascending: true }).range(from, to)), invoiceRow);
  if (!rows.ok) return rows;
  const shiftInWeek = (l: { readonly kind: string; readonly shift_date: string | null }): boolean =>
    l.kind === "shift" && l.shift_date !== null && l.shift_date >= monday && l.shift_date <= sunday;
  return invoiceOk(new Set(rows.value.flatMap((r) =>
    r.placement_id !== null && countsAsSent({ status: r.status, pdfPath: r.pdf_path }) && r.nanny_invoice_lines.some(shiftInWeek)
      ? [r.placement_id]
      : [])));
}

/** Pure: one entry per nanny and family, left out when any of her hires with them is invoiced for the week. */
function openFamilies(running: readonly PlacementRow[], invoiced: ReadonlySet<string>): OpenFamily[] {
  const keyOf = (p: PlacementRow): string => `${p.nanny_id}/${p.parent_id}`;
  return unique(running.map(keyOf)).flatMap((key) => {
    const [link, ...rest] = running.filter((p) => keyOf(p) === key).sort(byLinkOrder);
    if (!link || [link, ...rest].some((p) => invoiced.has(p.id))) return [];
    return [{ nannyId: link.nanny_id, parentId: link.parent_id, placementId: link.id }];
  });
}

/** The families' user ids, then one profile read for the families and the nannies together. */
async function readNames(admin: AdminClient, parentIds: readonly string[], nannyUserIds: readonly string[]): Promise<InvoiceResult<Names>> {
  const parents = parseRows("reminders.parents", await allPagesByIds("reminders.parents", parentIds, (chunk) => (from, to) =>
    admin.from("parents").select("id, user_id").in("id", [...chunk]).order("id", { ascending: true }).range(from, to)), parentRow);
  if (!parents.ok) return parents;
  const userIds = unique([...parents.value.map((p) => p.user_id), ...nannyUserIds]);
  const profiles = parseRows("reminders.profiles", await allPagesByIds("reminders.profiles", userIds, (chunk) => (from, to) =>
    admin.from("user_profiles").select("user_id, first_name, last_name, email").in("user_id", [...chunk]).order("user_id", { ascending: true }).range(from, to)), profileRow);
  if (!profiles.ok) return profiles;
  return invoiceOk({
    parentUsers: new Map(parents.value.map((p) => [p.id, p.user_id])),
    profiles: new Map(profiles.value.map((p) => [p.user_id, p])),
  });
}

/** Pure but for logging: the families named, per nanny; a family with no name is left out (it can't be invoiced). */
function remindersOf(open: readonly OpenFamily[], nannies: ReadonlyMap<string, NannyRow>, names: Names): DueReminder[] {
  const familyName = (parentId: string): string => {
    const userId = names.parentUsers.get(parentId);
    const profile = userId === undefined ? undefined : names.profiles.get(userId);
    return profile === undefined ? "" : fullName(profile);
  };
  return unique(open.map((o) => o.nannyId)).sort(compare).flatMap((nannyId): DueReminder[] => {
    const families = open.filter((o) => o.nannyId === nannyId).flatMap((o): DueFamily[] => {
      const name = familyName(o.parentId);
      if (name !== "") return [{ placementId: o.placementId, familyName: name }];
      logFailure("reminders.family", { code: "no_profile" });
      return [];
    }).sort(byName);
    const nanny = nannies.get(nannyId);
    if (families.length === 0 || nanny === undefined) return [];
    const profile = names.profiles.get(nanny.user_id);
    const email = profile?.email.trim() ?? "";
    return [{ nannyId, userId: nanny.user_id, firstName: profile?.first_name.trim() ?? "", email: email === "" ? null : email, families }];
  });
}

/**
 * Every nanny due a reminder for the London week starting `monday`, with the families she hasn't invoiced for it.
 * Nannies with none left aren't listed.
 */
export async function readDueReminders(proof: InvoiceCronProof, monday: string): Promise<InvoiceResult<readonly DueReminder[]>> {
  const gate = cronGate(proof);
  if (gate) return gate;
  if (!isLondonMonday(monday)) return INVALID;
  const admin = serviceClient();
  if (!admin) return FAILED;
  const sunday = weekEndOf(monday);
  const running = await readRunning(admin, sunday);
  if (!running.ok) return running;
  if (running.value.length === 0) return invoiceOk([]);
  const nannies = await readNannies(admin, unique(running.value.map((p) => p.nanny_id)));
  if (!nannies.ok) return nannies;
  const theirs = running.value.filter((p) => nannies.value.has(p.nanny_id));
  if (theirs.length === 0) return invoiceOk([]);
  const invoiced = await readInvoiced(admin, theirs.map((p) => p.id), monday, sunday);
  if (!invoiced.ok) return invoiced;
  const open = openFamilies(theirs, invoiced.value);
  if (open.length === 0) return invoiceOk([]);
  const names = await readNames(admin, unique(open.map((o) => o.parentId)), unique(open.map((o) => nannies.value.get(o.nannyId)?.user_id)));
  if (!names.ok) return names;
  return invoiceOk(remindersOf(open, nannies.value, names.value));
}

/** The gates and the key's shape, shared by the claim and its release. */
function claimRefusal(proof: InvoiceCronProof, nannyId: string, weekStart: string, stamp: string): InvoiceResult<never> | null {
  const gate = cronGate(proof);
  if (gate) return gate;
  const keyOk = guid.safeParse(nannyId).success && isLondonMonday(weekStart) && stampSchema.safeParse(stamp).success;
  return keyOk ? null : INVALID;
}

/** Claim her reminder for the week: true when this run wrote the claim, false when another run already holds it. */
export async function claimReminder(proof: InvoiceCronProof, nannyId: string, weekStart: string, stamp: string): Promise<InvoiceResult<boolean>> {
  const refusal = claimRefusal(proof, nannyId, weekStart, stamp);
  if (refusal) return refusal;
  const admin = serviceClient();
  if (!admin) return FAILED;
  try {
    const { data, error } = await admin.from(CLAIMS)
      .upsert({ nanny_id: nannyId, week_start: weekStart, claimed_at: stamp }, { onConflict: "nanny_id,week_start", ignoreDuplicates: true })
      .select("nanny_id");
    if (error || !Array.isArray(data) || data.length > 1) {
      logFailure("claimReminder", error ?? { code: "unexpected_rows" });
      return FAILED;
    }
    return invoiceOk(data.length === 1);
  } catch (thrown) {
    logFailure("claimReminder", thrown);
    return FAILED;
  }
}

/** Release this run's own claim (same nanny, week and stamp) after a failed send, so a later run can try again. */
export async function releaseReminder(proof: InvoiceCronProof, nannyId: string, weekStart: string, stamp: string): Promise<InvoiceResult<true>> {
  const refusal = claimRefusal(proof, nannyId, weekStart, stamp);
  if (refusal) return refusal;
  const admin = serviceClient();
  if (!admin) return FAILED;
  try {
    const { error } = await admin.from(CLAIMS).delete().eq("nanny_id", nannyId).eq("week_start", weekStart).eq("claimed_at", stamp);
    if (error) {
      logFailure("releaseReminder", error);
      return FAILED;
    }
    return invoiceOk(true);
  } catch (thrown) {
    logFailure("releaseReminder", thrown);
    return FAILED;
  }
}
