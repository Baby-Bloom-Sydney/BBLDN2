/**
 * Test-only fixtures for the /admin/calls screens (BB-wave1-041126/04c1-build): one dashboard with a row in every
 * section and every tag, a quick-match family with no position, and one family's drawer.
 */
import type { CallRowView, CallsDashboard } from "@/lib/calls/dashboard";
import type { FamilyPanel } from "@/lib/calls/family-panel";
import { groupSlotGridByDay } from "@/lib/calls/group-slots-by-day";

export const AVA = "b0400000-0000-4000-8000-000000000001";
export const BEN = "b0400000-0000-4000-8000-000000000002";
export const FAY = "b0400000-0000-4000-8000-000000000006";
export const GUS = "b0400000-0000-4000-8000-000000000007";
export const HAL = "b0400000-0000-4000-8000-000000000008";
export const POS = "d0400000-0000-4000-8000-000000000001";
export const BOOKING = "c0400000-0000-4000-8000-000000000001";

const links = (id: string, positionId: string | null) => ({
  profile: `/admin/viewer/${id}`,
  account: `/admin/users?openUser=${id}`,
  money: `/admin/users/${id}/subscription`,
  position: positionId === null ? null : `/admin/positions?openPosition=${positionId}`,
});

const POSITION = {
  positionId: POS,
  area: "Islington",
  hours: "30 hours a week",
  days: "Monday, Tuesday",
  children: "8 months, 2 years",
  starts: "Starts 1 March 2027",
  nannies: "6 nannies contacted · 2 replied",
};

export function row(over: Partial<CallRowView> & Pick<CallRowView, "parentUserId" | "section">): CallRowView {
  return {
    key: over.bookingId ?? over.parentUserId,
    bookingId: null,
    startsAt: null,
    when: null,
    signedUp: "Signed up Mon 1 Feb, 10:00 (London time)",
    lastTried: null,
    callBack: null,
    contact: { name: "Someone", email: "someone@example.test", mobile: { href: "tel:+447700900123", text: "+44 (0) 7700 900 123" } },
    signupType: "Advanced",
    position: POSITION,
    links: links(over.parentUserId, POS),
    tags: [],
    ...over,
  };
}

export const OVERDUE_ROW = row({
  parentUserId: AVA,
  section: "overdue",
  bookingId: BOOKING,
  startsAt: "2027-02-04T09:30:00.000Z",
  when: "Thu 4 Feb, 09:30 (London time)",
  contact: { name: "Ava Overdue", email: "ava@example.test", mobile: { href: "tel:+447700900111", text: "+44 (0) 7700 900 111" } },
  tags: ["overdue"],
});

export const UPCOMING_ROW = row({
  parentUserId: BEN,
  section: "upcoming",
  bookingId: "c0400000-0000-4000-8000-000000000002",
  startsAt: "2027-02-05T14:00:00.000Z",
  when: "Fri 5 Feb, 14:00 (London time)",
  contact: { name: "Ben Blocked", email: "ben@example.test", mobile: null },
  tags: ["blocked_over", "cohort_prebook"],
});

export const QUICK_ROW = row({
  parentUserId: FAY,
  section: "not_booked",
  contact: { name: "Fay Quick", email: "fay@example.test", mobile: { href: "tel:+447700900666", text: "+44 (0) 7700 900 666" } },
  signupType: "Quick match",
  position: null,
  links: links(FAY, null),
  lastTried: "Last tried Wed 3 Feb, 11:00 (London time)",
});

export const TEST_ROW = row({
  parentUserId: GUS,
  section: "not_booked",
  contact: { name: "Gus Tester", email: "gus@example.test", mobile: null },
  tags: ["test"],
});

export const DASHBOARD: CallsDashboard = {
  counts: "Calls still to make this week: 4 (2 booked · 2 not booked)",
  cohort: null,
  banner: null,
  overdue: [OVERDUE_ROW],
  upcoming: [UPCOMING_ROW],
  notBooked: [QUICK_ROW, TEST_ROW],
  history: [{ key: "e1", parentUserId: HAL, when: "Wed 3 Feb, 15:00 (London time)", name: "Hal Past", what: "No answer", note: "Rang twice", by: "Bai Admin", tags: [] }],
};

export const EMPTY_DASHBOARD: CallsDashboard = {
  counts: "Calls still to make this week: 0 (0 booked · 0 not booked)",
  cohort: null,
  banner: null,
  overdue: [],
  upcoming: [],
  notBooked: [],
  history: [],
};

const slot = (startsAt: string, free: boolean) => ({ startsAt, endsAt: new Date(Date.parse(startsAt) + 30 * 60 * 1000).toISOString(), free });

export const PANEL_DAYS = groupSlotGridByDay({
  dates: ["2027-02-09", "2027-02-10"],
  slots: [slot("2027-02-09T14:00:00.000Z", true), slot("2027-02-09T14:30:00.000Z", true), slot("2027-02-10T09:00:00.000Z", true)],
});

export const PANEL: FamilyPanel = {
  parentUserId: AVA,
  contact: OVERDUE_ROW.contact,
  signupType: "Advanced",
  signedUp: "Signed up Mon 1 Feb, 10:00 (London time)",
  position: POSITION,
  deposit: "Deposit paid 3 February 2027",
  links: links(AVA, POS),
  tags: ["test"],
  booking: { bookingId: BOOKING, startsAt: "2027-02-08T10:00:00.000Z", when: "Mon 8 Feb, 10:00 (London time)", changeable: true, purpose: "first_call" },
  attempts: [
    { key: "e2", when: "Wed 3 Feb, 17:00 (London time)", what: "Answered · Call back later", note: null, by: null, callBack: "Call back Fri 5 Feb, 17:00 (London time)" },
    { key: "e1", when: "Wed 3 Feb, 15:00 (London time)", what: "No answer", note: "Rang twice", by: "Bai Admin", callBack: null },
  ],
  days: PANEL_DAYS,
};
