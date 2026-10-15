import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/admin/require-admin";
import { GuaranteesClient } from "./GuaranteesClient";
import { isPromise } from "./rules";
import type { GuaranteeListRow } from "./types";

/**
 * `/admin/guarantees` — the guarantee ledger (4e brief step 2; offer §7.5, runbook SOP 14, screen S-A-29).
 * Admin only: the list newest first and the record form. Nothing here is shown to a parent or a nanny.
 * BB-LDN-4e-151026.
 */
export const dynamic = "force-dynamic";

const LIST_LIMIT = 500;

interface EventRow {
  id: string;
  parent_user_id: string;
  promise: string;
  condition_met: boolean;
  outcome: string;
  paid_out_pence: number;
  notes: string | null;
  recorded_by: string;
  recorded_at: string;
}

interface ProfileRow {
  user_id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
}

const fullName = (p: ProfileRow | undefined) => [p?.first_name, p?.last_name].filter(Boolean).join(" ");

export default async function AdminGuaranteesPage() {
  const { error } = await requireAdmin();
  if (error) notFound();
  const admin = createAdminClient();

  const [{ data: events, error: readErr }, { count: placementCount }] = await Promise.all([
    admin
      .from("guarantee_events")
      .select("id, parent_user_id, promise, condition_met, outcome, paid_out_pence, notes, recorded_by, recorded_at")
      .order("recorded_at", { ascending: false })
      .limit(LIST_LIMIT)
      .returns<EventRow[]>(),
    admin.from("nanny_placements").select("id", { count: "exact", head: true }),
  ]);
  if (readErr) console.error("[admin/guarantees] list read failed", readErr.message);

  const eventRows = events ?? [];
  const ids = [...new Set(eventRows.flatMap((e) => [e.parent_user_id, e.recorded_by]))];
  const { data: profileRows } = ids.length
    ? await admin.from("user_profiles").select("user_id, first_name, last_name, email").in("user_id", ids).returns<ProfileRow[]>()
    : { data: [] as ProfileRow[] };
  const profiles = new Map((profileRows ?? []).map((p) => [p.user_id, p]));

  const rows: GuaranteeListRow[] = eventRows.flatMap((e) => {
    if (!isPromise(e.promise)) return [];
    const family = profiles.get(e.parent_user_id);
    const recorder = profiles.get(e.recorded_by);
    return [
      {
        id: e.id,
        familyName: fullName(family),
        familyEmail: family?.email ?? null,
        promise: e.promise,
        conditionMet: e.condition_met,
        outcome: e.outcome,
        paidOutPence: e.paid_out_pence,
        notes: e.notes,
        recordedBy: fullName(recorder) || recorder?.email || "admin",
        recordedAt: e.recorded_at,
      },
    ];
  });

  return (
    <div className="mx-auto max-w-7xl px-4 py-10">
      <h1 className="text-2xl font-bold text-slate-900">Guarantees</h1>
      <p className="mt-1 text-sm text-slate-500">
        The ledger of every guarantee outcome — record one after the call. {rows.length} recorded
        {readErr ? " · the list could not be read, try again" : ""}.
      </p>
      <GuaranteesClient rows={rows} placementCount={placementCount ?? 0} />
    </div>
  );
}
