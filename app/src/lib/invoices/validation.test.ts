/**
 * Her bank details' schema and the shared text rules (plan 06 step 5; R8; §14.4 b2.3: 3 fields). Plain messages,
 * and a message never echoes what was typed: a rejected sort code or account number must not come back in a reply
 * or a log. Fixture numbers only. The draft's tests are `validation-lines.test.ts`; the business details' are
 * `validation-business.test.ts`.
 *
 * BB-wave1-041126/06a-build, 2026-11-04; BB-wave1-041126/06b2-build, 2026-11-06.
 */
import { describe, expect, it } from "vitest";
import { optionalAddress, optionalName, optionalText, paymentDetailsSchema, requiredAddress, requiredName, VALIDATION_MESSAGES as M } from "./validation";

const details = { accountName: "Sophie Taylor", sortCode: "11-22-33", accountNumber: "87654321" };
const cp = (n: number) => String.fromCodePoint(n);

function messagesOf(result: { success: boolean; error?: { issues: readonly { message: string }[] } }): string[] {
  return result.success ? [] : (result.error?.issues ?? []).map((i) => i.message);
}

describe("paymentDetailsSchema (3 fields)", () => {
  it("accepts UK details, stripping spaces and hyphens; any other field is dropped", () => {
    const parsed = paymentDetailsSchema.parse({ ...details, sortCode: " 11 22-33 ", accountNumber: "8765 4321", tradingName: "x", invoiceAddress: "y" });
    expect(parsed).toEqual({ accountName: "Sophie Taylor", sortCode: "112233", accountNumber: "87654321" });
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
    },
  );

  it.each([
    ["a zero-width space", `Baby${cp(0x200b)}Bloom`],
    ["a right-to-left override", `Sophie ${cp(0x202e)}Taylor`],
    ["a soft hyphen", `Sophie${cp(0xad)}Taylor`],
    ["a bidi isolate", `Sophie ${cp(0x2066)}Taylor`],
    ["a line separator", `Sophie${cp(0x2028)}Taylor`],
    ["a C1 next-line", `Sophie${cp(0x85)}Taylor`],
  ])("refuses invisible format characters in the account name: %s (review L8)", (_label, name) => {
    expect(messagesOf(paymentDetailsSchema.safeParse({ ...details, accountName: name }))).toContain(M.oneLine);
  });

  it("never echoes a rejected number in any message, even when everything is wrong", () => {
    const result = paymentDetailsSchema.safeParse({ accountName: 7, sortCode: "998877665", accountNumber: "123" });
    const all = messagesOf(result).join(" | ");
    expect(all).not.toMatch(/998877|123|\b7\b/);
  });
});

describe("the shared text builders (used by the business details and the lines)", () => {
  it("requiredName: trimmed, required, one line, never BabyBloom", () => {
    const name = requiredName(10, "Enter a name");
    expect(name.parse("  Taylor  ")).toBe("Taylor");
    expect(messagesOf(name.safeParse(null))).toEqual(["Enter a name"]);
    expect(messagesOf(name.safeParse("   "))).toEqual(["Enter a name"]);
    expect(messagesOf(name.safeParse("t".repeat(11)))).toContain(M.tooLong);
    expect(messagesOf(name.safeParse("Baby Bloom"))).toContain(M.ownName);
  });

  it("optionalName and optionalText: blank is null; optionalText allows the word BabyBloom (a description isn't a party)", () => {
    expect(optionalName(70).parse("  ")).toBeNull();
    expect(optionalName(70).parse(undefined)).toBeNull();
    expect(messagesOf(optionalName(70).safeParse("BabyBloom Care"))).toContain(M.ownName);
    expect(optionalText(120).parse(" Park with the BabyBloom group ")).toBe("Park with the BabyBloom group");
    expect(messagesOf(optionalText(120).safeParse(`park${cp(0x200b)}`))).toContain(M.oneLine);
    expect(messagesOf(optionalText(120).safeParse(5))).toContain(M.oneLine);
  });

  it("optionalAddress and requiredAddress keep line breaks, normalise Windows line ends and refuse other controls", () => {
    expect(optionalAddress(200).parse("1 Upper Street\r\n London N1 0AA \r\n")).toBe("1 Upper Street\nLondon N1 0AA");
    expect(optionalAddress(200).parse("")).toBeNull();
    expect(messagesOf(optionalAddress(200).safeParse(`1 Upper Street${String.fromCharCode(7)}`))).toContain(M.oneLine);
    expect(messagesOf(requiredAddress(200, "Enter an address").safeParse(" \n "))).toEqual(["Enter an address"]);
    expect(messagesOf(requiredAddress(5, "Enter an address").safeParse("1 Upper Street"))).toContain(M.tooLong);
  });
});
