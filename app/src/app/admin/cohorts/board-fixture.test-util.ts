/**
 * Test-only builders for /admin/cohorts' board (B02). Pure data, matching `CohortBoard`.
 */
import type { CohortBoard, CohortEntry, CohortView, FamilyRow } from "@/lib/cohorts/types";
import { addLondonDays } from "@/lib/timezone";

export const view = (start: string, fields: Partial<CohortView> = {}): CohortView => {
  const places = fields.places ?? 5;
  const taken = fields.taken ?? 0;
  const beingPaid = fields.beingPaid ?? 0;
  return { start, places, taken, beingPaid, left: Math.max(0, places - taken - beingPaid), overBy: Math.max(0, taken - places), ...fields };
};

export const entry = (start: string, fields: Partial<CohortView> = {}, rest: Partial<Omit<CohortEntry, "view">> = {}): CohortEntry => ({
  view: view(start, fields),
  goodwillTaken: 0,
  reopened: 0,
  families: [],
  ...rest,
});

export const family = (n: number, fields: Partial<FamilyRow> = {}): FamilyRow => ({
  placeId: `c0200000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`,
  parentUserId: `b0200000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`,
  name: `Family ${n}`,
  state: "taken",
  paidBy: "card",
  isGoodwill: false,
  takenAt: "2027-02-02T09:00:00Z",
  reopenedAt: null,
  reopenReason: null,
  ...fields,
});

export const weeks = (first: string, count: number, fields: Partial<CohortView> = {}): CohortEntry[] =>
  Array.from({ length: count }, (_, k) => entry(addLondonDays(first, 7 * k), fields));

export const makeBoard = (fields: Partial<CohortBoard> = {}): CohortBoard => ({
  today: "2026-11-04",
  suggestedFirst: "2026-11-09",
  schedule: null,
  current: null,
  next: null,
  upcoming: [],
  past: [],
  warnings: { kind: "ok", list: [], truncated: false },
  calls: { kind: "not_connected" },
  preBooked: { kind: "not_connected" },
  ...fields,
});
