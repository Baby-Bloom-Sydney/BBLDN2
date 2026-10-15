/**
 * Her connections after a failed DBS re-check (unit 3i, BB-LDN-3i-141026; brief change 4b as amended by README P-9).
 * Plain server module (NOT 'use server': nothing here is callable from the browser).
 *
 * Rulings: README **P-3** — on a re-check fail she keeps the positions where she is hired; her other connections are
 * dropped. **P-9** — dropped connections are silent to parents: the existing neutral expiry, no message, no email, no
 * reason (supersedes the brief's interim "DECLINED + 'unable to proceed' inbox message"). A **bar** is not handled here
 * (P-14: 3d's `dropBarredConnections` drops everything, hired too).
 *
 * Contract
 * - Input: admin client + her `nannies.id`.
 * - Hired = `CONNECTION_STAGE.CONFIRMED` (34) or `ACTIVE` (40) — kept untouched. `OFFERED` (33) is not hired.
 * - Already closed (`HIDDEN_CONNECTION_STAGES`, incl. FINISHED 41) — untouched.
 * - Every other row of hers is dropped exactly as a bar drops it (the shared helpers in lib/connections/silent-hold.ts):
 *   rows the parent never saw (held 4, DFY 9) are deleted; every other row → `status='expired'`, stage 10 →
 *   SCHEDULE_EXPIRED, any other → REQUEST_EXPIRED; each write is guarded on the stage read.
 * - Output: `{ kept, dropped, notDropped }` counts only (logged in the `dbs_status_check` row; no names).
 *   `notDropped` = a write error, or the row moved on between the read and the guarded write.
 * - Throws when the read fails (never a silent "nothing to drop").
 * - Never: messages or emails a parent, touches a hired or closed row, another nanny's rows, positions or placements.
 */
import type { createAdminClient } from "@/lib/supabase/admin";
import { CONNECTION_STAGE, HIDDEN_CONNECTION_STAGES } from "@/lib/position/constants";
import { CONNECTION_COLUMNS, expireRow, isUnseenByParent, type LiveRow } from "@/lib/connections/silent-hold";

type AdminClient = ReturnType<typeof createAdminClient>;

/** "Hired" for P-3 — the 30–39 Outcome block ends in CONFIRMED; 40 is Active. Constants, never literals. */
export const HIRED_CONNECTION_STAGES: readonly number[] = [CONNECTION_STAGE.CONFIRMED, CONNECTION_STAGE.ACTIVE];

const CLOSED: readonly number[] = HIDDEN_CONNECTION_STAGES;

export interface RecheckDropResult {
  kept: number;
  dropped: number;
  notDropped: number;
}

/** Deletes one unseen held row, guarded on the stage read. True = it was removed. */
async function deleteUnseen(admin: AdminClient, nannyId: string, r: LiveRow): Promise<boolean> {
  const { data, error } = await admin
    .from("connection_requests")
    .delete()
    .eq("id", r.id)
    .eq("nanny_id", nannyId)
    .eq("connection_stage", r.connection_stage)
    .select("id");
  return !error && Array.isArray(data) && data.length === 1;
}

/** P-3 + P-9: keep her hired connections, silently drop the rest. See the module contract. */
export async function dropNonHiredConnections(admin: AdminClient, nannyId: string): Promise<RecheckDropResult> {
  const { data, error } = await admin.from("connection_requests").select(CONNECTION_COLUMNS).eq("nanny_id", nannyId);
  if (error) throw new Error(`re-check drop: connection_requests read failed: ${error.message}`);

  const live = ((data ?? []) as unknown as LiveRow[]).filter((r) => !CLOSED.includes(r.connection_stage));
  const kept = live.filter((r) => HIRED_CONNECTION_STAGES.includes(r.connection_stage));
  const toDrop = live.filter((r) => !HIRED_CONNECTION_STAGES.includes(r.connection_stage));

  const now = new Date().toISOString();
  const moved = await Promise.all(
    toDrop.map((r) => (isUnseenByParent(r) ? deleteUnseen(admin, nannyId, r) : expireRow(admin, nannyId, r, now))),
  );
  const dropped = moved.filter(Boolean).length;
  return { kept: kept.length, dropped, notDropped: toDrop.length - dropped };
}
