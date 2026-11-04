/**
 * The stub 04 owns for the reverse direction of the 02 ↔ 04 seam (plan §7, §12 R1): until 02 is wired it answers
 * null, and /admin/calls shows no cohort line.
 */
import { describe, expect, expectTypeOf, it } from "vitest";
import { readCurrentCohortLine, type CohortLine } from "./cohort-line";

describe("readCurrentCohortLine (stub)", () => {
  it("answers null until 02 wires it", async () => {
    expect(await readCurrentCohortLine()).toBeNull();
  });

  it("has the shape plan §7 fixes", () => {
    expectTypeOf<CohortLine>().toEqualTypeOf<{ readonly places: number; readonly left: number }>();
    expectTypeOf(readCurrentCohortLine).returns.resolves.toEqualTypeOf<CohortLine | null>();
  });
});
