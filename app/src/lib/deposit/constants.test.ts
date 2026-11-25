/**
 * Brief 03's fixed numbers (plan 03 row A4). The hold length is 02's, reused, never a second copy.
 */
import { describe, expect, it } from "vitest";
import { HOLD_MINUTES as COHORT_HOLD_MINUTES } from "@/lib/cohorts/constants";
import {
  CHECKOUT_SESSION_MINUTES,
  DEPOSIT_CODE_BYTES,
  DEPOSIT_CODE_LENGTH,
  EMAIL_MAX,
  HOLD_MINUTES,
  NOTE_MAX,
  NOTE_MIN,
  PAY_REREAD_DELAY_MS,
  PAY_REREAD_TRIES,
  REFUND_REASON_MAX,
  REFUND_REASON_MIN,
} from "./constants";

describe("deposit constants", () => {
  it("the code is 32 random bytes, written as 43 base64url characters (256 bits)", () => {
    expect(DEPOSIT_CODE_BYTES).toBe(32);
    expect(DEPOSIT_CODE_LENGTH).toBe(43);
    expect(DEPOSIT_CODE_LENGTH).toBe(Math.ceil((DEPOSIT_CODE_BYTES * 8) / 6));
  });

  it("the hold is 02's HOLD_MINUTES; Stripe's session lasts 30 minutes, its minimum", () => {
    expect(HOLD_MINUTES).toBe(COHORT_HOLD_MINUTES);
    expect(CHECKOUT_SESSION_MINUTES).toBe(30);
  });

  it("the bank-transfer note is 1–500 characters and the refund reason 3–500", () => {
    expect([NOTE_MIN, NOTE_MAX]).toEqual([1, 500]);
    expect([REFUND_REASON_MIN, REFUND_REASON_MAX]).toEqual([3, 500]);
  });

  it("a double tap on Pay re-reads 3 times, 1 second apart; an email is at most 320 characters", () => {
    expect(PAY_REREAD_TRIES).toBe(3);
    expect(PAY_REREAD_DELAY_MS).toBe(1000);
    expect(EMAIL_MAX).toBe(320);
  });
});
