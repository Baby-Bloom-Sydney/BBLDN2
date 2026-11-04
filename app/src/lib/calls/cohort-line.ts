/**
 * "Current cohort: 2 of 5 places left" on /admin/calls — the reverse direction of the 02 ↔ 04 seam (plan §7,
 * §12 R1). 02 merged second, so 02 wired it (BB-wave1-041126/02-build): `cohortsEnabled() ?
 * readCurrentCohortSummary(...)` mapped to `{ places, left }` : `null`, rendered by 04c with 02's `placesLeftLine`.
 * Null too when there's no current cohort or its numbers can't be read, so 04c shows no line rather than a guess.
 *
 * BB-wave1-041126/04a-core, 2026-11-04 (stub); wired by BB-wave1-041126/02-build, 2026-11-04.
 */

import { logFailure } from "@/lib/cohorts/db";
import { readCurrentCohortSummary } from "@/lib/cohorts/read";
import { cohortsEnabled } from "@/lib/features/flags";
import { createAdminClient } from "@/lib/supabase/admin";

export interface CohortLine {
  readonly places: number;
  readonly left: number;
}

export async function readCurrentCohortLine(now: Date = new Date()): Promise<CohortLine | null> {
  if (!cohortsEnabled()) return null;
  try {
    const summary = await readCurrentCohortSummary(createAdminClient(), now);
    return summary.kind === "current" ? { places: summary.view.places, left: summary.view.left } : null;
  } catch (thrown) {
    logFailure("cohort-line", thrown);
    return null;
  }
}
