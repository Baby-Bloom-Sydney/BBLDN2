/**
 * An expired connection stays on the family's list, marked expired with its reason, until they connect with that
 * nanny again. Which rows: only those that ran out of time while the family could see them. The two time-based
 * expiries (`expireStaleRequests` and the expiry cron) record what the family saw in the row's `expired` event
 * (`connections_log.event_data.family_saw`); a row expired any other way (a bar, a DBS re-check), a held row and a
 * nanny's application carry no mark and never show.
 */
import { CONNECTION_STAGE } from "@/lib/position/constants";
import { isUnseenByParent } from "./silent-hold";
import type { createAdminClient } from "@/lib/supabase/admin";

type AdminClient = ReturnType<typeof createAdminClient>;

export type FamilySaw = "request" | "booking";

/**
 * Before it expires: her reply still awaited (stage 0, or a family's request she answered while held, which the family
 * reads as still waiting) → "request"; her accept awaiting the family's booking (stage 10) → "booking"; else nothing.
 */
export function familySawAtExpiry(row: { connection_stage: number | null; source: string | null }): FamilySaw | null {
  if (row.connection_stage === CONNECTION_STAGE.REQUEST_SENT) return "request";
  if (row.connection_stage === CONNECTION_STAGE.ACCEPTED_PENDING && row.source !== "dfy") return "request";
  if (row.connection_stage === CONNECTION_STAGE.ACCEPTED) return "booking";
  return null;
}

export interface ExpiredConnection {
  readonly connectionId: string;
  readonly nannyId: string;
  readonly nannyFirstName: string;
  readonly nannyLastName: string;
  /** First and last name (the Connections list's form); the Matched Nannies list shows the first name only. */
  readonly nannyName: string;
  readonly nannySuburb: string;
  readonly nannyPhoto: string | null;
  readonly source: string | null;
  /** no_reply: she didn't reply in time; not_booked: the meet and greet wasn't booked in time. */
  readonly expiredBecause: "no_reply" | "not_booked";
}

interface Row {
  id: string;
  nanny_id: string;
  status: string;
  connection_stage: number | null;
  source: string | null;
  created_at: string;
}

const EXPIRED_STAGES: number[] = [CONNECTION_STAGE.REQUEST_EXPIRED, CONNECTION_STAGE.SCHEDULE_EXPIRED];
/** The newest expired rows read back (one per nanny); older ones aren't shown. */
const MAX_SHOWN = 50;

function logged(what: string, error: { code?: string } | null): void {
  if (error) console.error(`[expired-rows] ${what} failed`, { code: error.code ?? null });
}

/** The newest row per nanny the family can see (not a held row), kept only when it is an expired one. */
function newestExpiredPerNanny(rows: readonly Row[]): Row[] {
  const newest = new Map<string, Row>();
  for (const r of rows) {
    if (r.connection_stage !== null && isUnseenByParent({ connection_stage: r.connection_stage, source: r.source })) continue;
    const seen = newest.get(r.nanny_id);
    if (!seen || r.created_at > seen.created_at) newest.set(r.nanny_id, r);
  }
  return Array.from(newest.values()).filter(
    (r) => r.status === "expired" && r.connection_stage !== null && EXPIRED_STAGES.includes(r.connection_stage),
  );
}

async function marksFor(admin: AdminClient, ids: string[]): Promise<Map<string, FamilySaw>> {
  const { data, error } = await admin
    .from("connections_log")
    .select("connection_request_id, event_data")
    .in("connection_request_id", ids)
    .eq("event_type", "expired");
  logged("the expiry marks read", error);
  const marks = new Map<string, FamilySaw>();
  for (const e of (data ?? []) as { connection_request_id: string; event_data: Record<string, unknown> | null }[]) {
    const saw = e.event_data?.family_saw;
    if (saw === "request" || saw === "booking") marks.set(e.connection_request_id, saw);
  }
  return marks;
}

/** A nanny who has left or been taken off the platform: her expired connection isn't offered again. */
const GONE_STATUSES: ReadonlySet<string> = new Set(["suspended", "deactivated", "inactive"]);

async function namesFor(admin: AdminClient, nannyIds: string[]) {
  const { data: nannies, error } = await admin.from("nannies").select("id, user_id, status").in("id", nannyIds);
  logged("the nannies read", error);
  const listed = ((nannies ?? []) as { id: string; user_id: string; status: string | null }[]).filter(
    (n) => n.status === null || !GONE_STATUSES.has(n.status),
  );
  const userOf = new Map(listed.map((n) => [n.id, n.user_id]));
  const { data: profiles, error: profilesError } = await admin
    .from("user_profiles")
    .select("user_id, first_name, last_name, suburb, profile_picture_url")
    .in("user_id", Array.from(userOf.values()));
  logged("the profiles read", profilesError);
  type Profile = { user_id: string; first_name: string | null; last_name: string | null; suburb: string | null; profile_picture_url: string | null };
  const byUser = new Map(((profiles ?? []) as Profile[]).map((p) => [p.user_id, p]));
  return {
    // listed, and named: a nanny with no profile to read isn't shown
    isListed: (nannyId: string) => byUser.has(userOf.get(nannyId) ?? ""),
    profileOf: (nannyId: string) => byUser.get(userOf.get(nannyId) ?? "") ?? null,
  };
}

/** Her expired connections to show (both lists: `source` tells which), newest first. */
export async function readFamilyExpiredConnections(admin: AdminClient, parentId: string): Promise<ExpiredConnection[]> {
  const { data, error } = await admin
    .from("connection_requests")
    .select("id, nanny_id, status, connection_stage, source, created_at")
    .eq("parent_id", parentId);
  logged("the family's rows read", error);
  const candidates = newestExpiredPerNanny((data ?? []) as Row[])
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
    .slice(0, MAX_SHOWN);
  if (candidates.length === 0) return [];
  const marks = await marksFor(admin, candidates.map((r) => r.id));
  const shown = candidates
    .filter((r) => marks.has(r.id))
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  if (shown.length === 0) return [];
  const { isListed, profileOf } = await namesFor(admin, shown.map((r) => r.nanny_id));
  return shown.filter((r) => isListed(r.nanny_id)).map((r) => {
    const p = profileOf(r.nanny_id);
    const first = p?.first_name?.trim() || "Your nanny";
    const last = p?.last_name?.trim() ?? "";
    return {
      connectionId: r.id,
      nannyId: r.nanny_id,
      nannyFirstName: first,
      nannyLastName: last,
      nannyName: `${first} ${last}`.trim(),
      nannySuburb: p?.suburb ?? "",
      nannyPhoto: p?.profile_picture_url ?? null,
      source: r.source,
      expiredBecause: marks.get(r.id) === "booking" ? "not_booked" : "no_reply",
    };
  });
}
