import { notFound } from "next/navigation";
import { proveAdmin, type AdminProof } from "@/lib/calls/admin-proof";
import { loadCohortBoard } from "@/lib/cohorts/board";
import { logFailure } from "@/lib/cohorts/db";
import type { CohortBoard } from "@/lib/cohorts/types";
import { cohortsEnabled } from "@/lib/features/flags";
import { createAdminClient } from "@/lib/supabase/admin";
import { CohortsClient } from "./CohortsClient";
import { AlertLine } from "./parts";

/**
 * `/admin/cohorts` — weekly cohorts: places, who has taken them, the warnings (brief 02; plan `BUILD/plans/02-plan.md`).
 * The `/admin/guarantees` shape with the switch in front: `COHORTS_ENABLED` off → 404 before the admin check or any
 * read; not an admin → 404; then one board read. Admin only (middleware `/admin` + `proveAdmin`). Nothing here is
 * shown to a parent or a nanny. BB-wave1-041126/02-build.
 */
export const dynamic = "force-dynamic";

async function readBoard(proof: AdminProof): Promise<CohortBoard | null> {
  try {
    const board = await loadCohortBoard(proof, createAdminClient(), new Date());
    return board.ok ? board.value : null;
  } catch (thrown) {
    logFailure("admin/cohorts board", thrown);
    return null;
  }
}

export default async function AdminCohortsPage() {
  if (!cohortsEnabled()) notFound();
  const proof = await proveAdmin();
  if (!proof) notFound();
  const board = await readBoard(proof);

  return (
    <div className="mx-auto max-w-7xl px-4 py-10">
      <h1 className="text-2xl font-bold text-slate-900">Cohorts</h1>
      <p className="mt-1 text-sm text-slate-500">How many places each weekly cohort has, and who has taken them.</p>
      {board ? (
        <CohortsClient board={board} />
      ) : (
        <div className="mt-6">
          <AlertLine>The cohorts could not be read — reload to try again.</AlertLine>
        </div>
      )}
    </div>
  );
}
