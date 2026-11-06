/**
 * The shared zod schemas (plan 06 step 5; R8). Plain messages, and a message never echoes what was typed: a
 * rejected sort code or account number must not come back in a reply or a log. Fixture numbers only.
 * BB-wave1-041126/06a-build, 2026-11-04.
 */
import { describe, expect, it } from "vitest";
import { invoiceDraftSchema, paymentDetailsSchema, VALIDATION_MESSAGES as M } from "./validation";

const details = {
  accountName: "Sophie Taylor",
  sortCode: "11-22-33",
  accountNumber: "87654321",
  tradingName: "",
  invoiceAddress: "",
};

function messagesOf(result: { success: boolean; error?: { issues: readonly { message: string }[] } }): string[] {
  return result.success ? [] : (result.error?.issues ?? []).map((i) => i.message);
}

describe("paymentDetailsSchema", () => {
  it("accepts UK details, stripping spaces and hyphens, and empties the optional fields to null", () => {
    const parsed = paymentDetailsSchema.parse({ ...details, sortCode: " 11 22-33 ", accountNumber: "8765 4321" });
    expect(parsed).toEqual({
      accountName: "Sophie Taylor",
      sortCode: "112233",
      accountNumber: "87654321",
      tradingName: null,
      invoiceAddress: null,
    });
  });

  it("keeps a trading name and a multi-line address (Windows line ends normalised)", () => {
    const parsed = paymentDetailsSchema.parse({
      ...details,
      tradingName: "  Taylor Childcare ",
      invoiceAddress: "1 Upper Street\r\nLondon N1 0AA\r\n",
    });
    expect(parsed.tradingName).toBe("Taylor Childcare");
    expect(parsed.invoiceAddress).toBe("1 Upper Street\nLondon N1 0AA");
  });

  it.each([
    ["sortCode", "11223", M.sortCode],
    ["sortCode", "1122334", M.sortCode],
    ["sortCode", "11-22-3a", M.sortCode],
    ["accountNumber", "8765432", M.accountNumber],
    ["accountNumber", "876543210", M.accountNumber],
    ["accountName", "   ", M.accountName],
    ["accountName", "a".repeat(71), M.tooLong],
    ["accountName", "Sophie\nTaylor", M.oneLine],
    ["tradingName", "t".repeat(71), M.tooLong],
    ["invoiceAddress", "x".repeat(201), M.tooLong],
    ["invoiceAddress", "1 Upper Street\u0007", M.oneLine],
  ])("refuses %s %j with a plain message that doesn't echo it", (field, value, message) => {
    const result = paymentDetailsSchema.safeParse({ ...details, [field]: value });
    const messages = messagesOf(result);
    expect(messages).toContain(message);
    const typed = String(value).trim().slice(0, 6);
    if (typed !== "") for (const m of messages) expect(m).not.toContain(typed);
  });

  it.each(["BabyBloom", "Baby Bloom Ltd", "BABYBLOOM childcare", "baby  bloom", "ＢａｂｙＢｌｏｏｍ"])(
    "never lets BabyBloom be the party paid: %s (plan R8, brief D7)",
    (name) => {
      expect(messagesOf(paymentDetailsSchema.safeParse({ ...details, accountName: name }))).toContain(M.ownName);
      expect(messagesOf(paymentDetailsSchema.safeParse({ ...details, tradingName: name }))).toContain(M.ownName);
    },
  );

  it.each([
    ["a zero-width space", "Baby\u200bBloom"],
    ["a right-to-left override", "Sophie \u202eTaylor"],
    ["a soft hyphen", "Sophie\u00adTaylor"],
    ["a bidi isolate", "Sophie \u2066Taylor"],
    ["a line separator", "Sophie\u2028Taylor"],
    ["a C1 next-line", "Sophie\u0085Taylor"],
  ])("refuses invisible format characters in a name: %s (review L8)", (_label, name) => {
    expect(messagesOf(paymentDetailsSchema.safeParse({ ...details, accountName: name }))).toContain(M.oneLine);
    expect(messagesOf(paymentDetailsSchema.safeParse({ ...details, tradingName: name }))).toContain(M.oneLine);
    expect(messagesOf(paymentDetailsSchema.safeParse({ ...details, invoiceAddress: name }))).toContain(M.oneLine);
  });

  it("never echoes a rejected number in any message, even when everything is wrong", () => {
    const result = paymentDetailsSchema.safeParse({ accountName: 7, sortCode: "998877665", accountNumber: "123", tradingName: 5 });
    const all = messagesOf(result).join(" | ");
    expect(all).not.toMatch(/998877|123|\b7\b|\b5\b/);
  });
});

describe("invoiceDraftSchema", () => {
  const now = new Date("2027-02-15T10:00:00Z"); // Monday 15 Feb 2027
  const draft = {
    invoiceId: "0b6a0000-0000-4000-8000-000000000001",
    kind: "regular_week",
    targetId: "0b6a0000-0000-4000-8000-000000000411",
    periodStart: "2027-02-08",
    hours: 30,
    ratePence: 1800,
    replacesInvoiceId: null,
  };
  const schema = invoiceDraftSchema(now);

  it("accepts a past or current week and a Trial Shift day", () => {
    expect(schema.parse(draft)).toEqual(draft);
    expect(schema.safeParse({ ...draft, periodStart: "2027-02-15" }).success).toBe(true);
    expect(schema.safeParse({ ...draft, kind: "trial_shift", periodStart: "2027-02-03", hours: 4 }).success).toBe(true);
  });

  it.each([
    ["a Wednesday week", { periodStart: "2027-02-10" }, M.monday],
    ["next week", { periodStart: "2027-02-22" }, M.future],
    ["tomorrow's shift", { kind: "trial_shift", periodStart: "2027-02-16" }, M.future],
    ["not a date", { periodStart: "2027-02-30" }, M.date],
    ["0 hours", { hours: 0 }, M.hours],
    ["0.1 hours", { hours: 0.1 }, M.hourStep],
    ["168.5 hours", { hours: 168.5 }, M.hoursMax],
    ["hours as text", { hours: "30" }, M.hours],
    ["a rate of nothing", { ratePence: 0 }, M.rate],
    ["a rate above the typo ceiling", { ratePence: 25_001 }, M.rate],
    ["a rate in fractions of a penny", { ratePence: 1800.5 }, M.rate],
    ["a meet-and-greet", { kind: "meet_and_greet" }, M.kind],
    ["no family", { targetId: "hartley" }, M.family],
    ["a bad correction link", { replacesInvoiceId: "INV-0001" }, M.invalid],
    ["no invoice id", { invoiceId: undefined }, M.invalid],
  ])("refuses %s", (_label, change, message) => {
    expect(messagesOf(schema.safeParse({ ...draft, ...change }))).toContain(message);
  });

  it("says the rate bounds in pounds from config, not from a literal", () => {
    expect(M.rate).toBe("Enter a rate between £0.01 and £250.00 an hour");
  });

  it("allows the edge values (0.25 h, 168 h, 1 p, £250.00)", () => {
    for (const change of [{ hours: 0.25 }, { hours: 168 }, { ratePence: 1 }, { ratePence: 25_000 }]) {
      expect(schema.safeParse({ ...draft, ...change }).success).toBe(true);
    }
  });
});
