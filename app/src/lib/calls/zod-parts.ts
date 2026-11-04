/**
 * Shared zod pieces for the call modules: database timestamps come back as "2027-02-09T14:00:00+00:00", and every
 * call module compares instants as UTC ISO strings, so each one is normalised to `toISOString()` on the way in.
 *
 * BB-wave1-041126/04a-core, 2026-11-04.
 */

import { z } from "zod";

const parses = (value: string): boolean => !Number.isNaN(Date.parse(value));

/** Any timestamp string Postgres or a client sends, as "…Z". */
export const instant = z.string().refine(parses, "not a time").transform((value) => new Date(value).toISOString());

/** A full ISO instant with an offset or Z (client input: never a bare local time). */
export const isoInstantInput = z.iso
  .datetime({ offset: true })
  .transform((value) => new Date(value).toISOString());

export const uuid = z.uuid();

/** A London calendar date "YYYY-MM-DD" that exists. */
export const londonDate = z.iso.date();
