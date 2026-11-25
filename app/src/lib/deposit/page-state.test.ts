/**
 * What the parent's page shows (plan 03 §3 "Page state", D11; brief §3 parent 1–9). Pure. The rules, in order:
 * no link or cancelled → invalid; paid → paid; her own live hold → bookable there; the current cohort with a place →
 * bookable (also a goodwill pin that has since become current); a goodwill pin that is still next, with a place →
 * bookable as goodwill (a pin that is past is never offered, 02's rule); the cohort she'd get being paid → being
 * paid; else full. Being paid and full both carry the next available cohort for pre-booking.
 */
import { describe, expect, it } from "vitest";
import type { CohortView } from "@/lib/cohorts/types";
import { depositPageState } from "./page-state";
import type { DepositCohorts, DepositLinkFacts, DepositPageInput } from "./types";

const CUR = "2027-02-01";
const NEXT = "2027-02-08";
const LATER = "2027-02-15";
const PAST = "2027-01-25";

const view = (start: string, over: Partial<CohortView> = {}): CohortView => {
  const places = over.places ?? 5;
  const taken = over.taken ?? 0;
  const beingPaid = over.beingPaid ?? 0;
  return { start, places, taken, beingPaid, left: Math.max(0, places - taken - beingPaid), overBy: Math.max(0, taken - places), ...over };
};
const open = view; // a cohort with places left
const allTaken = (start: string) => view(start, { taken: 5 });
const lastBeingPaid = (start: string) => view(start, { taken: 4, beingPaid: 1 });

const CURRENT_LINK: DepositLinkFacts = { state: "open", target: "current", goodwillStartDate: null };
const goodwillLink = (pin: string): DepositLinkFacts => ({ state: "open", target: "goodwill", goodwillStartDate: pin });

const cohorts = (current: CohortView | null, next: CohortView | null, nextAvailable: CohortView | null = null): DepositCohorts => ({
  current,
  next,
  nextAvailable,
});

const input = (over: Partial<DepositPageInput> = {}): DepositPageInput => ({
  link: CURRENT_LINK,
  depositPaidAt: null,
  cohorts: cohorts(open(CUR), open(NEXT), open(NEXT)),
  ownHold: null,
  ...over,
});

describe("depositPageState", () => {
  describe("invalid", () => {
    it("no link → invalid", () => {
      expect(depositPageState(input({ link: null }))).toEqual({ kind: "invalid" });
    });

    it("a cancelled link → invalid, even if a deposit was paid", () => {
      expect(depositPageState(input({ link: { ...CURRENT_LINK, state: "cancelled" }, depositPaidAt: "2027-02-02T10:00:00Z" }))).toEqual({
        kind: "invalid",
      });
    });
  });

  describe("paid", () => {
    it("the link is paid → paid", () => {
      expect(depositPageState(input({ link: { ...CURRENT_LINK, state: "paid" } }))).toEqual({ kind: "paid" });
    });

    it("the deposit was paid before she opened the link (e.g. a bank transfer) → paid, never a second Pay", () => {
      expect(depositPageState(input({ depositPaidAt: "2027-02-02T10:00:00Z" }))).toEqual({ kind: "paid" });
    });

    it("paid beats her own hold and a full cohort", () => {
      const s = input({
        depositPaidAt: "2027-02-02T10:00:00Z",
        ownHold: { cohortStartDate: CUR, isGoodwill: false },
        cohorts: cohorts(allTaken(CUR), allTaken(NEXT)),
      });
      expect(depositPageState(s)).toEqual({ kind: "paid" });
    });
  });

  describe("her own live hold", () => {
    it("her Pay is in progress: bookable at the hold's cohort, even though her hold fills it", () => {
      const s = input({ ownHold: { cohortStartDate: CUR, isGoodwill: false }, cohorts: cohorts(lastBeingPaid(CUR), allTaken(NEXT)) });
      expect(depositPageState(s)).toEqual({ kind: "bookable", start: CUR, goodwill: false });
    });

    it("a goodwill hold stays goodwill", () => {
      const s = input({
        link: goodwillLink(NEXT),
        ownHold: { cohortStartDate: NEXT, isGoodwill: true },
        cohorts: cohorts(allTaken(CUR), lastBeingPaid(NEXT)),
      });
      expect(depositPageState(s)).toEqual({ kind: "bookable", start: NEXT, goodwill: true });
    });
  });

  describe("bookable", () => {
    it("the current cohort has a place → bookable there, not goodwill", () => {
      expect(depositPageState(input())).toEqual({ kind: "bookable", start: CUR, goodwill: false });
    });

    it("the current cohort with a place beats a goodwill pin (brief §3 parent 9)", () => {
      expect(depositPageState(input({ link: goodwillLink(NEXT) }))).toEqual({ kind: "bookable", start: CUR, goodwill: false });
    });

    it("a goodwill pin that has since become the current cohort is offered as current", () => {
      const s = input({ link: goodwillLink(NEXT), cohorts: cohorts(open(NEXT), open(LATER), open(LATER)) });
      expect(depositPageState(s)).toEqual({ kind: "bookable", start: NEXT, goodwill: false });
    });

    it("current full, the pin is still next with a place → bookable next as goodwill", () => {
      const s = input({ link: goodwillLink(NEXT), cohorts: cohorts(allTaken(CUR), open(NEXT), open(NEXT)) });
      expect(depositPageState(s)).toEqual({ kind: "bookable", start: NEXT, goodwill: true });
    });

    it("a current link never gets the next cohort, even with places there", () => {
      const s = input({ cohorts: cohorts(allTaken(CUR), open(NEXT), open(NEXT)) });
      expect(depositPageState(s)).toEqual({ kind: "full", nextAvailable: NEXT });
    });
  });

  describe("a goodwill pin that can't be offered", () => {
    it("a pin now past (before the current cohort) is never offered → full with the next available", () => {
      const s = input({ link: goodwillLink(PAST), cohorts: cohorts(allTaken(CUR), open(NEXT), open(NEXT)) });
      expect(depositPageState(s)).toEqual({ kind: "full", nextAvailable: NEXT });
    });

    it("a pin that became current and is full → full", () => {
      const s = input({ link: goodwillLink(NEXT), cohorts: cohorts(allTaken(NEXT), open(LATER), open(LATER)) });
      expect(depositPageState(s)).toEqual({ kind: "full", nextAvailable: LATER });
    });

    it("a pin further out than the next cohort is not offered (02 allows only the next)", () => {
      const s = input({ link: goodwillLink(LATER), cohorts: cohorts(allTaken(CUR), allTaken(NEXT), open(LATER)) });
      expect(depositPageState(s)).toEqual({ kind: "full", nextAvailable: LATER });
    });

    it("the pinned next cohort is full → full", () => {
      const s = input({ link: goodwillLink(NEXT), cohorts: cohorts(allTaken(CUR), allTaken(NEXT), open(LATER)) });
      expect(depositPageState(s)).toEqual({ kind: "full", nextAvailable: LATER });
    });
  });

  describe("being paid", () => {
    it("the last place in the current cohort is held by someone else → being paid, with the next available", () => {
      const s = input({ cohorts: cohorts(lastBeingPaid(CUR), open(NEXT), open(NEXT)) });
      expect(depositPageState(s)).toEqual({ kind: "being_paid", nextAvailable: NEXT });
    });

    it("a goodwill link whose pinned next cohort's last place is being paid → being paid", () => {
      const s = input({ link: goodwillLink(NEXT), cohorts: cohorts(allTaken(CUR), lastBeingPaid(NEXT), open(LATER)) });
      expect(depositPageState(s)).toEqual({ kind: "being_paid", nextAvailable: LATER });
    });

    it("being paid with no cohort available after it → being paid, nothing to pre-book", () => {
      const s = input({ cohorts: cohorts(lastBeingPaid(CUR), allTaken(NEXT), null) });
      expect(depositPageState(s)).toEqual({ kind: "being_paid", nextAvailable: null });
    });

    it("a cohort over capacity is full, not being paid", () => {
      const s = input({ cohorts: cohorts(view(CUR, { taken: 6 }), allTaken(NEXT), null) });
      expect(depositPageState(s)).toEqual({ kind: "full", nextAvailable: null });
    });
  });

  describe("full", () => {
    it("every place taken, a later cohort has places → full with it to pre-book", () => {
      const s = input({ cohorts: cohorts(allTaken(CUR), allTaken(NEXT), open(LATER)) });
      expect(depositPageState(s)).toEqual({ kind: "full", nextAvailable: LATER });
    });

    it("every place taken and no cohort available → full, nothing to pre-book", () => {
      const s = input({ cohorts: cohorts(allTaken(CUR), allTaken(NEXT), null) });
      expect(depositPageState(s)).toEqual({ kind: "full", nextAvailable: null });
    });

    it("a cohort with no places at all (set to 0) is full", () => {
      const s = input({ cohorts: cohorts(view(CUR, { places: 0 }), null, null) });
      expect(depositPageState(s)).toEqual({ kind: "full", nextAvailable: null });
    });

    it("no current cohort at all (the schedule hasn't started) → full with the first available", () => {
      const s = input({ cohorts: cohorts(null, open(NEXT), open(NEXT)) });
      expect(depositPageState(s)).toEqual({ kind: "full", nextAvailable: NEXT });
    });

    it("no current cohort: a goodwill pin on the first cohort is not bookable either (02: nothing before the first)", () => {
      const s = input({ link: goodwillLink(NEXT), cohorts: cohorts(null, open(NEXT), open(NEXT)) });
      expect(depositPageState(s)).toEqual({ kind: "full", nextAvailable: NEXT });
    });

    it("nothing set up at all → full, nothing to pre-book", () => {
      expect(depositPageState(input({ cohorts: cohorts(null, null, null) }))).toEqual({ kind: "full", nextAvailable: null });
    });
  });

  it("returns a frozen result and leaves its input untouched", () => {
    const s = input();
    const before = JSON.stringify(s);
    const out = depositPageState(s);
    expect(Object.isFrozen(out)).toBe(true);
    expect(JSON.stringify(s)).toBe(before);
  });
});
