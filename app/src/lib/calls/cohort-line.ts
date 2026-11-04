/**
 * "Current cohort: 2 of 5 places left" on /admin/calls — the reverse direction of the 02 ↔ 04 seam (plan §7,
 * §12 R1). A stub that answers null, so 04c renders no line.
 *
 * Wiring (whichever of 02 and 04c merges second does it in its own PR): `cohortsEnabled() ?
 * readCurrentCohortSummary(...)` mapped to `{ places, left }` : `null`, rendered with 02's `placesLeftLine`.
 *
 * BB-wave1-041126/04a-core, 2026-11-04.
 */

export interface CohortLine {
  readonly places: number;
  readonly left: number;
}

export async function readCurrentCohortLine(): Promise<CohortLine | null> {
  return null;
}
