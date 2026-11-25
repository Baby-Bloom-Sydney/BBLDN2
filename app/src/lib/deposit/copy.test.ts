/**
 * The parent's words (brief 03 §3 parent drafts; plan 03 row A4) — placeholders BAI edits before switch-on (Q4).
 * The amount is formatted at run time from `PRICES` (the money-literal gate: no amount is ever written), the date
 * is 04's `dayWords(...).legend` ("Monday 1 February"), and the brand is `SITE_NAME`. Expected amounts here are
 * built from the price too, so no amount is written in this file either.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { SITE_NAME } from "@/lib/constants";
import { HOLD_MINUTES } from "@/lib/cohorts/constants";

const price = vi.hoisted(() => ({ depositPence: null as number | null }));
vi.mock("@/config/prices", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/config/prices")>();
  return {
    ...actual,
    PRICES: {
      ...actual.PRICES,
      get dfy() {
        return { ...actual.PRICES.dfy, depositPence: price.depositPence ?? actual.PRICES.dfy.depositPence };
      },
    },
  };
});

import { PRICES } from "@/config/prices";
import {
  bookableIntro,
  depositAmount,
  donePaid,
  maskEmail,
  PAGE_COPY,
  payButtonLabel,
  placeHeading,
  prebookCallLine,
} from "./copy";
import {
  depositStateLine,
  depositWarningLines,
  goodwillChoiceLabel,
  linkLine,
  PANEL_COPY,
  penceAmount,
  prebookedLine,
  savedCardWords,
  sendAgainQuestion,
} from "./copy";
import type { DepositPanel, PanelLink } from "./panel";

const POUND = "£";
const PENCE_PER_POUND = 100;
/** "£<whole pounds>" with en-GB grouping, built from the price rather than written. */
const whole = (pence: number) => `${POUND}${(pence / PENCE_PER_POUND).toLocaleString("en-GB")}`;
const withPence = (pence: number) =>
  `${POUND}${(pence / PENCE_PER_POUND).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

afterEach(() => {
  price.depositPence = null;
});

describe("the amount", () => {
  it("comes from PRICES.dfy.depositPence, as whole pounds when whole (the brief reads it that way)", () => {
    expect(depositAmount()).toBe(whole(PRICES.dfy.depositPence));
    expect(depositAmount()).toMatch(/^£\d[\d,]*$/);
  });

  it("follows the price when it changes (brief §9.2: change it in 01 → the page follows)", () => {
    const base = PRICES.dfy.depositPence;
    price.depositPence = base * 2;
    expect(depositAmount()).toBe(whole(base * 2));
    expect(payButtonLabel()).toBe(`Pay ${whole(base * 2)}`);
    price.depositPence = base + 1;
    expect(depositAmount()).toBe(withPence(base + 1));
    expect(bookableIntro("Sarah", "2027-02-01")).toContain(`Your ${withPence(base + 1)} deposit`);
  });
});

describe("the bookable page", () => {
  it("the heading names the cohort's day", () => {
    expect(placeHeading("2027-02-01")).toBe("Your place in the cohort starting Monday 1 February");
  });

  it("the intro: her first name, the amount twice, the cohort's day (brief §3 parent 1)", () => {
    const amount = depositAmount();
    expect(bookableIntro("Sarah", "2027-02-01")).toBe(
      `Hi Sarah. Your ${amount} deposit confirms your place in the cohort starting Monday 1 February, and we start ` +
        "arranging your Trial Shifts straight away. It's part of your fee, not an extra. You pay your nanny for her " +
        `Trial Shift on the day, and the full ${amount} comes off your final bill. If you choose not to go with any of ` +
        "the nannies we match you with, you get it back.",
    );
  });

  it("with no first name it still greets her plainly; the name is trimmed", () => {
    expect(bookableIntro(null, "2027-02-01")).toMatch(/^Hello\. Your /);
    expect(bookableIntro("   ", "2027-02-01")).toMatch(/^Hello\. Your /);
    expect(bookableIntro("  Sarah ", "2027-02-01")).toMatch(/^Hi Sarah\. Your /);
  });

  it("a goodwill page names next week's date the same way", () => {
    expect(bookableIntro("Sarah", "2027-02-08")).toContain("the cohort starting Monday 8 February");
  });

  it("the consent sentence, the footnote (brand from SITE_NAME) and the Pay button", () => {
    expect(PAGE_COPY.consent).toBe(
      "We'll save your card securely with Stripe. We only charge the rest of your bill once you're happy with your nanny, and we'll tell you the amount first.",
    );
    expect(PAGE_COPY.footnote).toBe(`Payments are handled by Stripe. ${SITE_NAME} never sees your card number.`);
    expect(payButtonLabel()).toBe(`Pay ${depositAmount()}`);
  });

  it("a date that isn't one shows as itself rather than breaking the page", () => {
    expect(placeHeading("soon")).toBe("Your place in the cohort starting soon");
  });
});

describe("the other states", () => {
  it("paid, done (paid / not yet paid)", () => {
    expect(PAGE_COPY.paid).toBe("Your deposit is paid. Thank you.");
    expect(donePaid("2027-02-01")).toBe("Payment received. Your place in the cohort starting Monday 1 February is confirmed.");
    expect(donePaid(null)).toBe("Payment received. Thank you.");
    expect(PAGE_COPY.doneNotPaid).toBe("We haven't received your payment yet. Try again.");
  });

  it("full, the pre-book button, and the being-paid line with 02's hold minutes", () => {
    expect(PAGE_COPY.full).toBe("This cohort is full.");
    expect(PAGE_COPY.prebookButton).toBe("Pre-book next available cohort");
    expect(PAGE_COPY.beingPaid).toBe(
      `The last place is being paid for right now. Try again in ${HOLD_MINUTES} minutes, or pre-book the next cohort.`,
    );
  });

  it("the pre-book outcomes", () => {
    expect(prebookCallLine("2027-02-08")).toBe("We'll call you on Monday 8 February to confirm your place.");
    expect(PAGE_COPY.prebookNoCohort).toBe("We'll be in touch to arrange your place.");
  });

  it("one invalid-page sentence for every bad case, brand from SITE_NAME", () => {
    expect(PAGE_COPY.invalid).toBe(`This link isn't working. Ask ${SITE_NAME} to send it again.`);
  });

  it("Pay's failure lines", () => {
    expect(PAGE_COPY.tryAgain).toBe("Try again.");
    expect(PAGE_COPY.tryAgainSoon).toBe("Try again in a moment.");
  });

  it("the static lines are frozen", () => {
    expect(Object.isFrozen(PAGE_COPY)).toBe(true);
  });
});

describe("maskEmail", () => {
  it("keeps the first character and the domain", () => {
    expect(maskEmail("sarah@gmail.com")).toBe("s•••@gmail.com");
    expect(maskEmail("  Sarah.Jones@example.co.uk ")).toBe("S•••@example.co.uk");
  });

  it.each([
    ["no @", "sarah.gmail.com"],
    ["two @", "sarah@x@gmail.com"],
    ["nothing before @", "@gmail.com"],
    ["nothing after @", "sarah@"],
    ["no dot in the domain", "sarah@localhost"],
    ["a space inside", "sa rah@gmail.com"],
    ["a control character", "sarah\u0000@gmail.com"],
    ["empty", ""],
    ["too long", `${"a".repeat(320)}@gmail.com`],
  ])("malformed (%s) → only the mask, revealing nothing", (_label, value) => {
    expect(maskEmail(value)).toBe("•••");
  });

  it.each([[null], [undefined], [42], [{}]])("a non-string (%j) → only the mask", (value) => {
    expect(maskEmail(value)).toBe("•••");
  });

  it("a first character outside the basic plane is kept whole", () => {
    expect(maskEmail("\u{1F600}x@gmail.com")).toBe("\u{1F600}•••@gmail.com");
  });
});

/**
 * The admin panel's words (brief 03 §3 Admin 1–7; plan 03 row A5): pure functions of `readDepositPanel`'s view
 * model. Amounts come from the formatter (what she paid, `deposit_pence`), dates from 02's helpers ("3 Feb",
 * "Mon 1 Feb"), times on the London clock, emails masked. Placeholders BAI edits before switch-on (Q4).
 */
describe("the panel's words", () => {
  const PARENT = "b0300000-0000-4000-8000-000000000001";
  const PAID_AT = "2027-02-03T09:00:00.000Z";
  const CARD = Object.freeze({ brand: "visa", last4: "4242", expMonth: 12, expYear: 2030 });
  const TAKEN = Object.freeze({ cohortStartDate: "2027-02-01", isGoodwill: false, state: "taken" as const });
  const LINK: PanelLink = Object.freeze({
    id: "d0300000-0000-4000-8000-000000000001",
    code: "Ab0_-".repeat(8) + "xyz",
    target: "current",
    goodwillStartDate: null,
    createdAt: "2027-02-03T08:59:00.000Z",
    lastEmailedAt: "2027-02-03T09:02:00.000Z",
    lastEmailedTo: "sarah@gmail.com",
  });
  const panelOf = (over: Partial<DepositPanel> = {}): DepositPanel => ({
    parentUserId: PARENT,
    today: "2027-02-03",
    state: "not_paid",
    payment: null,
    card: null,
    bankTransfer: null,
    place: null,
    link: null,
    prebooking: null,
    duplicatePayments: 0,
    warnings: [],
    cohorts: { current: null, next: null, canOfferGoodwill: false },
    canTakeDeposit: true,
    canRecordBankRefund: false,
    ...over,
  });
  const paid = (method: "card" | "bank_transfer" | null, pence: number | null = PRICES.dfy.depositPence) => ({
    pence,
    paidAt: PAID_AT,
    refundedAt: null,
    method,
    paymentIntentId: method === "card" ? "pi_3Test" : null,
  });

  it("penceAmount formats what she paid like the page's amount — never written, always formatted", () => {
    const base = PRICES.dfy.depositPence;
    expect(penceAmount(base)).toBe(depositAmount());
    expect(penceAmount(base)).toBe(whole(base));
    expect(penceAmount(base + 1)).toBe(withPence(base + 1));
    expect(penceAmount(base * 10)).toBe(whole(base * 10));
  });

  it("not paid", () => {
    expect(depositStateLine(panelOf())).toBe("Not paid");
  });

  it("paid by card: amount, London day, saved card, her cohort (brief §3 Admin 1)", () => {
    const line = depositStateLine(panelOf({ state: "paid_card", payment: paid("card"), card: CARD, place: TAKEN }));
    expect(line).toBe(`Paid ${depositAmount()} by card, 3 Feb · Card saved Visa •••• 4242 (12/30) · Cohort Mon 1 Feb`);
  });

  it("paid by card with no card row → 'Card: not recorded' (D7); no place yet → no cohort part", () => {
    expect(depositStateLine(panelOf({ state: "paid_card", payment: paid("card") }))).toBe(
      `Paid ${depositAmount()} by card, 3 Feb · Card: not recorded`,
    );
  });

  it("paid by bank transfer: no card saved (brief §3 Admin 1)", () => {
    expect(depositStateLine(panelOf({ state: "paid_bank_transfer", payment: paid("bank_transfer") }))).toBe(
      `Paid ${depositAmount()} by bank transfer · no card saved`,
    );
    expect(depositStateLine(panelOf({ state: "paid_bank_transfer", payment: paid("bank_transfer"), place: { ...TAKEN, isGoodwill: true } }))).toBe(
      `Paid ${depositAmount()} by bank transfer · no card saved · Cohort Mon 1 Feb (goodwill)`,
    );
  });

  it("an old preset deposit says so, with or without a card on file", () => {
    expect(depositStateLine(panelOf({ state: "paid_preset", payment: paid(null) }))).toBe(
      `Paid ${depositAmount()}, 3 Feb (old payment link) · no card saved`,
    );
    expect(depositStateLine(panelOf({ state: "paid_preset", payment: paid(null), card: CARD }))).toBe(
      `Paid ${depositAmount()}, 3 Feb (old payment link) · Card saved Visa •••• 4242 (12/30)`,
    );
  });

  it("the amount she actually paid, not today's price; no amount recorded → no amount shown", () => {
    const other = PRICES.dfy.depositPence * 2;
    expect(depositStateLine(panelOf({ state: "paid_card", payment: paid("card", other), card: CARD }))).toContain(`Paid ${whole(other)} by card`);
    expect(depositStateLine(panelOf({ state: "paid_card", payment: paid("card", null), card: CARD }))).toMatch(/^Paid by card, 3 Feb · /);
  });

  it("a re-opened place shows no cohort", () => {
    expect(depositStateLine(panelOf({ state: "paid_card", payment: paid("card"), card: CARD, place: { ...TAKEN, state: "reopened" } }))).not.toContain(
      "Cohort",
    );
  });

  it("refunded: the London day it was refunded", () => {
    const payment = { ...paid("card"), refundedAt: "2027-02-10T12:00:00.000Z" };
    expect(depositStateLine(panelOf({ state: "refunded", payment }))).toBe("Refunded 10 Feb");
  });

  it.each([
    [{ brand: "visa", last4: "4242", expMonth: 12, expYear: 2030 }, "Visa •••• 4242 (12/30)"],
    [{ brand: "mastercard", last4: "4444", expMonth: 2, expYear: 2031 }, "Mastercard •••• 4444 (02/31)"],
    [{ brand: "amex", last4: "0005", expMonth: 1, expYear: 2100 }, "Amex •••• 0005 (01/00)"],
    [{ brand: "jcb", last4: "0000", expMonth: 7, expYear: 2029 }, "JCB •••• 0000 (07/29)"],
    [{ brand: "unionpay", last4: "0005", expMonth: 7, expYear: 2029 }, "UnionPay •••• 0005 (07/29)"],
    [{ brand: "cartes_bancaires", last4: "1001", expMonth: 7, expYear: 2029 }, "Cartes Bancaires •••• 1001 (07/29)"],
  ])("the saved card %j → %s", (card, words) => {
    expect(savedCardWords(card)).toBe(words);
  });

  it("pre-booked: the cohort's short date, or none set up; nothing when not pre-booked", () => {
    const prebooking = { id: "e0300000-0000-4000-8000-000000000001", parentUserId: PARENT, cohortStartDate: "2027-02-08", callBookingId: null, createdAt: PAID_AT };
    expect(prebookedLine(panelOf({ prebooking }))).toBe("Pre-booked for Mon 8 Feb");
    expect(prebookedLine(panelOf({ prebooking: { ...prebooking, cohortStartDate: null } }))).toBe("Pre-booked (no cohort set up yet)");
    expect(prebookedLine(panelOf())).toBeNull();
  });

  it("the link: none, made but not emailed, sent today (London clock), sent another day", () => {
    expect(linkLine(panelOf())).toBe("No deposit link yet");
    expect(linkLine(panelOf({ link: { ...LINK, lastEmailedAt: null, lastEmailedTo: null } }))).toBe("Link made, not emailed yet");
    expect(linkLine(panelOf({ link: LINK }))).toBe("Sent 09:02 to s•••@gmail.com");
    expect(linkLine(panelOf({ link: { ...LINK, lastEmailedAt: "2027-02-01T18:30:00.000Z" } }))).toBe("Sent 1 Feb 18:30 to s•••@gmail.com");
  });

  it("the time is London's: 13:02 UTC in June is 14:02 (brief §0.1's example)", () => {
    const june = panelOf({ today: "2027-06-01", link: { ...LINK, lastEmailedAt: "2027-06-01T13:02:00.000Z" } });
    expect(linkLine(june)).toBe("Sent 14:02 to s•••@gmail.com");
    expect(sendAgainQuestion(june)).toBe("Sent at 14:02. Send again?");
  });

  it("the address is always masked; none recorded → just the time; a goodwill link names its cohort", () => {
    expect(linkLine(panelOf({ link: { ...LINK, lastEmailedTo: "not an address" } }))).toBe("Sent 09:02 to •••");
    expect(linkLine(panelOf({ link: { ...LINK, lastEmailedTo: null } }))).toBe("Sent 09:02");
    expect(linkLine(panelOf({ link: { ...LINK, target: "goodwill", goodwillStartDate: "2027-02-08" } }))).toBe(
      "Sent 09:02 to s•••@gmail.com · goodwill Mon 8 Feb",
    );
  });

  it("a second send asks first, only once it has been sent", () => {
    expect(sendAgainQuestion(panelOf({ link: LINK }))).toBe("Sent at 09:02. Send again?");
    expect(sendAgainQuestion(panelOf({ link: { ...LINK, lastEmailedAt: "2027-02-01T18:30:00.000Z" } }))).toBe("Sent at 1 Feb 18:30. Send again?");
    expect(sendAgainQuestion(panelOf({ link: { ...LINK, lastEmailedAt: null } }))).toBeNull();
    expect(sendAgainQuestion(panelOf())).toBeNull();
  });

  it("the warnings (brief §3 Admin 7), in the panel's order; none → none", () => {
    expect(depositWarningLines(panelOf({ warnings: ["duplicate_payment", "refunded_but_held"] }))).toEqual([
      "Second deposit received. Refund one in Stripe",
      "Deposit refunded but place still held",
    ]);
    expect(depositWarningLines(panelOf())).toEqual([]);
  });

  it("the goodwill choice names next week and its places left (brief §3 Admin 2)", () => {
    expect(goodwillChoiceLabel({ start: "2027-02-08", places: 5, taken: 0, beingPaid: 0, left: 5, overBy: 0 })).toBe(
      "Next cohort, goodwill (Mon 8 Feb · 5 left)",
    );
  });

  it("the panel's fixed words, frozen", () => {
    expect(PANEL_COPY).toEqual({
      notPaid: "Not paid",
      cardNotRecorded: "Card: not recorded",
      noCardSaved: "no card saved",
      noLink: "No deposit link yet",
      notEmailed: "Link made, not emailed yet",
      duplicateWarning: "Second deposit received. Refund one in Stripe",
      refundedButHeldWarning: "Deposit refunded but place still held",
      emailButton: "Email deposit link",
      copyButton: "Copy link",
      cancelButton: "Cancel link",
      takePaymentButton: "Take payment now",
      markPaidButton: "Mark deposit paid (bank transfer)",
      bankRefundButton: "Record refund (bank transfer)",
      targetCurrent: "Current cohort",
      emailFailed: "Email didn't send. Copy the link instead.",
      cohortFull: "This cohort is full",
      alreadyPaid: "The deposit is already paid.",
      unavailable: "Deposit: could not be read",
    });
    expect(Object.isFrozen(PANEL_COPY)).toBe(true);
  });
});

// ── The panel's action words (plan 03 row B3; BB-wave2-231126/03-build, 2026-11-25) ─────────────────────────────────
import {
  ACTION_ERROR_COPY,
  depositActionErrorLine,
  PANEL_ACTION_COPY,
  sendAgainQuestionAt,
  targetDiffersLine,
  type DepositActionCode,
  type DepositRefusalCode,
} from "./copy";

/** Every code contract-03b gives the six actions; the two prompts are asked, never shown as a line (03b review TS M1). */
const CONTRACT_CODES = [
  "deposit_disabled", "not_admin", "invalid", "error", "confirm_resend", "target_differs", "email_failed", "already_paid",
  "goodwill_not_offered", "no_email", "cohort_full", "being_paid", "not_bookable", "not_a_cohort", "already_taken",
  "not_bank_transfer", "already_refunded",
] as const;
const PROMPT_CODES = ["confirm_resend", "target_differs"] as const;
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

describe("the panel's action words (row B3)", () => {
  it("the server's 'already sent' time asks the same question, on the London clock", () => {
    expect(sendAgainQuestionAt("2027-06-01T13:02:00.000Z", "2027-06-01")).toBe("Sent at 14:02. Send again?");
    expect(sendAgainQuestionAt("2027-02-01T18:30:00.000Z", "2027-02-03")).toBe("Sent at 1 Feb 18:30. Send again?");
  });

  it("target_differs names the open link's target, and offers both ways", () => {
    expect(targetDiffersLine("current", null)).toBe(
      "The open link is for the current cohort. Use it as it is, or cancel it and make a new one?",
    );
    expect(targetDiffersLine("goodwill", "2027-02-08")).toBe(
      "The open link is for the goodwill cohort Mon 8 Feb. Use it as it is, or cancel it and make a new one?",
    );
    expect(targetDiffersLine("goodwill", null)).toBe(
      "The open link is for a goodwill cohort. Use it as it is, or cancel it and make a new one?",
    );
  });

  it("the cancel question never promises to close a payment page already open (03a handoff, LOW-4)", () => {
    expect(PANEL_ACTION_COPY.cancelQuestion).toBe(
      "Cancel this link? It stops working, but a payment page already open can still be paid.",
    );
    expect(PANEL_ACTION_COPY.cancelQuestion).not.toMatch(/clos|stops? (the )?payment|can't be paid|cannot be paid/i);
  });

  it.each([
    ["cohort_full", "This cohort is full"],
    ["already_paid", "The deposit is already paid."],
    ["email_failed", "Email didn't send. Copy the link instead."],
    ["deposit_disabled", "Deposit links are switched off."],
    ["not_admin", "Only an admin can do this. Sign in again."],
    ["invalid", "That didn't look right. Reload the page and try again."],
    ["error", "Something went wrong. Try again."],
    ["goodwill_not_offered", "Goodwill isn't on offer now. Reload the page."],
    ["no_email", "This family has no email address. Copy the link instead."],
    ["being_paid", "The last place is being paid for right now. Try again later."],
    ["not_bookable", "This cohort can't take a deposit now."],
    ["not_a_cohort", "That cohort isn't set up."],
    ["already_taken", "This family already has a place."],
    ["not_bank_transfer", "This deposit wasn't paid by bank transfer."],
    ["already_refunded", "The deposit is already refunded."],
  ] satisfies ReadonlyArray<readonly [DepositRefusalCode, string]>)("the refusal %s → %s", (code, line) => {
    expect(depositActionErrorLine(code)).toBe(line);
  });

  it("an unknown code (or an object key) → the generic line, never the code itself", () => {
    for (const unknown of ["something_new", "constructor", "__proto__", "confirm_resend", "target_differs"]) {
      expect(depositActionErrorLine(unknown as DepositRefusalCode)).toBe("Something went wrong. Try again.");
    }
  });

  it("the line table is complete at compile time: exactly the contract's codes, less the two it asks about", () => {
    const derivedIsTheContract: Same<DepositActionCode, (typeof CONTRACT_CODES)[number]> = true;
    const tableIsTheRefusals: Same<DepositRefusalCode, Exclude<(typeof CONTRACT_CODES)[number], (typeof PROMPT_CODES)[number]>> = true;
    expect([derivedIsTheContract, tableIsTheRefusals]).toEqual([true, true]);
    const refusals = CONTRACT_CODES.filter((code) => !(PROMPT_CODES as readonly string[]).includes(code));
    expect(Object.keys(ACTION_ERROR_COPY).sort()).toEqual([...refusals].sort());
    expect(Object.isFrozen(ACTION_ERROR_COPY)).toBe(true);
    for (const line of Object.values(ACTION_ERROR_COPY)) expect(line).not.toMatch(new RegExp(`${POUND}\\d`));
  });

  it("the action words, frozen; no amount written in any of them", () => {
    expect(Object.isFrozen(PANEL_ACTION_COPY)).toBe(true);
    for (const words of Object.values(PANEL_ACTION_COPY)) expect(words).not.toMatch(new RegExp(`${POUND}\\d`));
    expect(PANEL_ACTION_COPY).toMatchObject({
      sendAgain: "Send again",
      notNow: "Not now",
      sendAsIs: "Send as is",
      replaceAndSend: "Cancel and send again",
      copyAsIs: "Copy as is",
      replaceAndCopy: "Cancel and copy a new one",
      cancelConfirm: "Yes, cancel link",
      noOpenLink: "There was no open link to cancel.",
      openPaymentPage: "Open the payment page",
      openPaymentPageLead: "If it didn't open:",
      confirm: "Confirm",
      back: "Back",
      genericError: "Something went wrong. Try again.",
    });
  });
});
