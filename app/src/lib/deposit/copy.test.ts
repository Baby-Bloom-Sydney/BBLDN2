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
