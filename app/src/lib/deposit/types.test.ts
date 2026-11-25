/**
 * Brief 03's shared shapes (plan 03 row A4): the link's states and targets as amendment 18 spells them, and the
 * page's five states. Types are checked by `tsc`; the lists are checked here.
 */
import { describe, expect, expectTypeOf, it } from "vitest";
import type { FoundCohorts } from "@/lib/cohorts/read";
import {
  DEPOSIT_LINK_STATES,
  DEPOSIT_TARGETS,
  type DepositCohorts,
  type DepositLinkFacts,
  type DepositLinkState,
  type DepositPageState,
  type DepositTarget,
  type VerifiedDepositLink,
} from "./types";

describe("deposit types", () => {
  it("the link states and targets match amendment 18's CHECKs, and the lists are frozen", () => {
    expect(DEPOSIT_LINK_STATES).toEqual(["open", "paid", "cancelled"]);
    expect(DEPOSIT_TARGETS).toEqual(["current", "goodwill"]);
    expect(Object.isFrozen(DEPOSIT_LINK_STATES)).toBe(true);
    expect(Object.isFrozen(DEPOSIT_TARGETS)).toBe(true);
    expectTypeOf<DepositLinkState>().toEqualTypeOf<"open" | "paid" | "cancelled">();
    expectTypeOf<DepositTarget>().toEqualTypeOf<"current" | "goodwill">();
  });

  it("a verified link is never cancelled, and fits what the page decides with", () => {
    expectTypeOf<VerifiedDepositLink["state"]>().toEqualTypeOf<"open" | "paid">();
    expectTypeOf<VerifiedDepositLink>().toMatchTypeOf<DepositLinkFacts>();
  });

  it("the page has exactly five states", () => {
    expectTypeOf<DepositPageState["kind"]>().toEqualTypeOf<"invalid" | "paid" | "bookable" | "being_paid" | "full">();
  });

  it("02's findCohorts answer is what the page reads", () => {
    expectTypeOf<FoundCohorts>().toMatchTypeOf<DepositCohorts>();
  });
});
