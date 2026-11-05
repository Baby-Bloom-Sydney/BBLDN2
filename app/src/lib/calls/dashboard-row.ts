/**
 * The words on one /admin/calls row and in its drawer (plan C3, C4; brief §0.9, §3 admin 1, 2, 6). Pure: the reads
 * are `dashboard-reads.ts` and the call repository; these decide what staff read.
 *
 * - Every time is labelled London: "Tue 9 Feb, 14:00 (London time)" (brief §3 admin 1 — staff are not in London; the
 *   parent-side "no London time" ruling, §0a.10, is for parents only). Built from `slot-words.ts`, so on the one
 *   London clock whatever the server's or the browser's zone.
 * - The mobile shows in the `+44 (0) …` form staff can dial from abroad; its `tel:` link is E.164.
 * - The four links (§0.9); a quick-match family has no position, so no Position link ("No position yet").
 *
 * BB-wave1-041126/04c1-build, 2026-11-05.
 */

import { APP_LOCALE, APP_TZ } from "@/lib/constants";
import { londonDateOf } from "@/lib/timezone";
import { formatUkMobile, isUkMobile, normaliseUkMobile } from "@/lib/uk-contact";
import { ADMIN_COPY, LONDON_TIME_SUFFIX, hoursLine, nanniesLine, type DepositState } from "./copy";
import { outcomeLabel, resultLabel } from "./outcomes";
import { slotWords } from "./slot-words";
import type { CallOutcomeCode, CallResultCode, ParentContact } from "./types";

/** "Tue 9 Feb, 14:00 (London time)". */
export function londonLabel(iso: string): string {
  return `${slotWords(iso).short} ${LONDON_TIME_SUFFIX}`;
}

const DAY_WORDS = new Intl.DateTimeFormat(APP_LOCALE, { timeZone: APP_TZ, day: "numeric", month: "long", year: "numeric" });

/** A London date in words, "1 March 2027" — from "YYYY-MM-DD" or an instant (its London date). */
export function londonDayWords(dateOrInstant: string): string {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(dateOrInstant) ? dateOrInstant : londonDateOf(dateOrInstant);
  // Midday UTC is the same calendar date in London in every season.
  return DAY_WORDS.format(new Date(`${date}T12:00:00.000Z`));
}

const SIGNUP_TYPES: Readonly<Record<string, string>> = Object.freeze({
  standard_match: ADMIN_COPY.signupQuick,
  advanced_match: ADMIN_COPY.signupAdvanced,
});

/** How she signed up: Quick match, Advanced, or Direct (a cold sign-up, or no source recorded). */
export function signupTypeOf(source: string | null): string {
  return (source !== null && SIGNUP_TYPES[source]) || ADMIN_COPY.signupDirect;
}

export interface MobileLink {
  readonly href: string;
  readonly text: string;
}

export interface ContactWords {
  readonly name: string;
  readonly email: string | null;
  /** `mailto:` with the address encoded, so a stored address can't carry mail headers (security review L1). */
  readonly emailHref: string | null;
  readonly mobile: MobileLink | null;
}

function mobileLink(raw: string | null): MobileLink | null {
  if (raw === null || raw.trim() === "") return null;
  if (isUkMobile(raw)) return { href: `tel:${normaliseUkMobile(raw)}`, text: formatUkMobile(raw) };
  return { href: `tel:${raw.replace(/[^\d+]/g, "")}`, text: raw };
}

function mailtoOf(email: string): string {
  const at = email.lastIndexOf("@");
  if (at < 0) return `mailto:${encodeURIComponent(email)}`;
  return `mailto:${encodeURIComponent(email.slice(0, at))}@${encodeURIComponent(email.slice(at + 1))}`;
}

export function contactWords(contact: ParentContact | null): ContactWords {
  if (contact === null) return { name: "Unknown family", email: null, emailHref: null, mobile: null };
  const full = `${contact.firstName} ${contact.lastName}`.trim();
  return { name: full || contact.email, email: contact.email, emailHref: mailtoOf(contact.email), mobile: mobileLink(contact.mobile) };
}

/** A position's facts, read in batches by `dashboard-reads.ts`. */
export interface PositionFacts {
  readonly id: string;
  readonly parentUserId: string;
  readonly area: string | null;
  readonly hoursPerWeek: number | null;
  readonly daysRequired: readonly string[];
  /** "YYYY-MM-DD", or null. */
  readonly startDate: string | null;
  readonly createdAt: string;
  readonly childAgesMonths: readonly number[];
  /** Nannies the blast notified (`dfy_match_notifications`). */
  readonly nanniesContacted: number;
  /** Nannies who replied (`connection_requests` with `responded_at` set). */
  readonly nanniesReplied: number;
}

export interface PositionSummary {
  readonly positionId: string;
  readonly area: string;
  readonly hours: string | null;
  readonly days: string | null;
  readonly children: string | null;
  readonly starts: string | null;
  readonly nannies: string;
}

const plural = (n: number, one: string): string => `${n} ${one}${n === 1 ? "" : "s"}`;

/** "8 months", "2 years 6 months". */
export function ageWords(months: number): string {
  if (months < 1) return "Under 1 month";
  if (months < 12) return plural(months, "month");
  const years = Math.floor(months / 12);
  const rest = months % 12;
  return rest === 0 ? plural(years, "year") : `${plural(years, "year")} ${plural(rest, "month")}`;
}

/** The row's position words; null for a family with no position (the row says "No position yet"). */
export function positionSummaryOf(p: PositionFacts | null): PositionSummary | null {
  if (p === null) return null;
  return {
    positionId: p.id,
    area: p.area?.trim() || "—",
    hours: p.hoursPerWeek === null ? null : hoursLine(p.hoursPerWeek),
    days: p.daysRequired.length === 0 ? null : p.daysRequired.join(", "),
    children: p.childAgesMonths.length === 0 ? null : p.childAgesMonths.map(ageWords).join(", "),
    starts: p.startDate === null ? null : `Starts ${londonDayWords(p.startDate)}`,
    nannies: nanniesLine({ contacted: p.nanniesContacted, replied: p.nanniesReplied }),
  };
}

export interface RowLinks {
  readonly profile: string;
  readonly account: string;
  readonly money: string;
  /** Null with no position. */
  readonly position: string | null;
}

/** Brief §0.9: Profile, Account, Money and Position. */
export function rowLinks(parentUserId: string, positionId: string | null): RowLinks {
  const id = encodeURIComponent(parentUserId);
  return {
    profile: `/admin/viewer/${id}`,
    account: `/admin/users?openUser=${id}`,
    money: `/admin/users/${id}/subscription`,
    position: positionId === null ? null : `/admin/positions?openPosition=${encodeURIComponent(positionId)}`,
  };
}

export type CallTag = "blocked_over" | "overdue" | "cohort_prebook" | "test";

const TAG_LABELS: Readonly<Record<CallTag, string>> = Object.freeze({
  blocked_over: ADMIN_COPY.tagBlockedOver,
  overdue: ADMIN_COPY.tagOverdue,
  cohort_prebook: ADMIN_COPY.tagCohortPrebook,
  test: ADMIN_COPY.tagTest,
});

export const tagLabel = (tag: CallTag): string => TAG_LABELS[tag];

/** Brief §3 admin 6, in a fixed order. */
export function tagsOf(facts: { readonly blockedOver: boolean; readonly overdue: boolean; readonly cohortPrebook: boolean; readonly test: boolean }): readonly CallTag[] {
  const tags: readonly [CallTag, boolean][] = [
    ["blocked_over", facts.blockedOver],
    ["overdue", facts.overdue],
    ["cohort_prebook", facts.cohortPrebook],
    ["test", facts.test],
  ];
  return Object.freeze(tags.filter(([, on]) => on).map(([tag]) => tag));
}

/** "No answer", "Answered · Deposit taken", "Stop calling". */
export function attemptWords(entry: { readonly result: CallResultCode | null; readonly outcome: CallOutcomeCode | null }): string {
  const parts = [entry.result === null ? null : resultLabel(entry.result), entry.outcome === null ? null : outcomeLabel(entry.outcome)];
  return parts.filter((p): p is string => p !== null).join(" · ");
}

/** Her `parent_subscriptions` row's deposit facts (amendment 12), read-only. */
export interface DepositFacts {
  readonly status: string;
  readonly depositPaidAt: string | null;
  readonly depositRefundedAt: string | null;
}

/** Refunded, then placed, then paid, else none. */
export function depositStateOf(row: DepositFacts | null): DepositState {
  if (row === null) return { kind: "none" };
  if (row.depositRefundedAt !== null) return { kind: "refunded", on: londonDayWords(row.depositRefundedAt) };
  if (row.status === "placed") return { kind: "placed" };
  if (row.depositPaidAt !== null) return { kind: "paid", on: londonDayWords(row.depositPaidAt) };
  return { kind: "none" };
}
