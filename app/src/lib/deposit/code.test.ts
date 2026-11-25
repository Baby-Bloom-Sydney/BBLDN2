/**
 * The deposit code (plan 03 §3 "Link", row A4): 32 random bytes as 43 base64url characters, and the format check
 * every page and action runs before any read. Pure and client-safe — the randomness is the caller's.
 */
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { depositCodeFrom, isDepositCode, isUuid, UUID_RE } from "./code";
import { DEPOSIT_CODE_BYTES, DEPOSIT_CODE_LENGTH } from "./constants";

const VALID = "Ab0_-".repeat(8) + "xyz"; // 43 characters

describe("depositCodeFrom", () => {
  it("32 random bytes → 43 base64url characters that pass the format check", () => {
    const code = depositCodeFrom(randomBytes(DEPOSIT_CODE_BYTES));
    expect(code).toHaveLength(DEPOSIT_CODE_LENGTH);
    expect(isDepositCode(code)).toBe(true);
  });

  it("is exactly base64url with no padding (matches Node's encoder)", () => {
    for (let i = 0; i < 200; i += 1) {
      const bytes = randomBytes(DEPOSIT_CODE_BYTES);
      expect(depositCodeFrom(bytes)).toBe(Buffer.from(bytes).toString("base64url"));
    }
    expect(depositCodeFrom(new Uint8Array(DEPOSIT_CODE_BYTES))).toBe("A".repeat(DEPOSIT_CODE_LENGTH));
    expect(depositCodeFrom(new Uint8Array(DEPOSIT_CODE_BYTES).fill(255))).toBe(Buffer.alloc(DEPOSIT_CODE_BYTES, 255).toString("base64url"));
  });

  it("1,000 draws are all different", () => {
    const codes = new Set(Array.from({ length: 1000 }, () => depositCodeFrom(randomBytes(DEPOSIT_CODE_BYTES))));
    expect(codes.size).toBe(1000);
  });

  it.each([0, 16, 31, 33, 48])("throws on %i bytes", (n) => {
    expect(() => depositCodeFrom(new Uint8Array(n))).toThrow(RangeError);
  });

  it("throws on anything that isn't bytes", () => {
    expect(() => depositCodeFrom(Array.from({ length: DEPOSIT_CODE_BYTES }, () => 0) as unknown as Uint8Array)).toThrow(RangeError);
    expect(() => depositCodeFrom("A".repeat(DEPOSIT_CODE_BYTES) as unknown as Uint8Array)).toThrow(RangeError);
  });

  it("stays client-safe: no node crypto in the file (the caller draws the bytes)", () => {
    const source = readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), "code.ts"), "utf8");
    expect(source).not.toMatch(/from\s+["'](?:node:)?crypto["']/);
    expect(source).not.toMatch(/\bBuffer\s*[.(]/);
  });
});

describe("isDepositCode", () => {
  it("accepts exactly 43 characters of A–Z, a–z, 0–9, _ and -", () => {
    expect(VALID).toHaveLength(43);
    expect(isDepositCode(VALID)).toBe(true);
    expect(isDepositCode("-".repeat(43))).toBe(true);
  });

  it.each([
    ["42 characters", VALID.slice(1)],
    ["44 characters", `${VALID}A`],
    ["a plus", `+${VALID.slice(1)}`],
    ["a slash", `/${VALID.slice(1)}`],
    ["padding", `${VALID.slice(1)}=`],
    ["a space inside", `${VALID.slice(0, 20)} ${VALID.slice(21)}`],
    ["a leading space", ` ${VALID.slice(1)}`],
    ["a trailing newline", `${VALID.slice(1)}\n`],
    ["a non-ASCII letter", `é${VALID.slice(1)}`],
    ["empty", ""],
  ])("rejects %s", (_label, value) => {
    expect(isDepositCode(value)).toBe(false);
  });

  it.each([[null], [undefined], [43], [{}], [[VALID]]])("rejects a non-string (%j)", (value) => {
    expect(isDepositCode(value)).toBe(false);
  });
});

describe("isUuid — the one uuid check of src/lib/deposit (row and user ids, as Postgres writes them)", () => {
  it.each([
    ["a v4 id", "b0300000-0000-4000-8000-000000000051"],
    ["upper case", "B0300000-0000-4000-8000-0000000000AB"],
    ["any version and variant (Postgres's uuid type checks neither)", "d0300000-0000-0000-0000-000000000001"],
    ["the nil uuid", "00000000-0000-0000-0000-000000000000"],
  ])("accepts %s", (_label, value) => {
    expect(isUuid(value)).toBe(true);
    expect(UUID_RE.test(value)).toBe(true);
  });

  it.each([
    ["no hyphens", "b03000000000400080000000000000051"],
    ["braces", "{b0300000-0000-4000-8000-000000000051}"],
    ["one short", "b0300000-0000-4000-8000-00000000005"],
    ["a non-hex letter", "g0300000-0000-4000-8000-000000000051"],
    ["a trailing newline", "b0300000-0000-4000-8000-000000000051\n"],
    ["empty", ""],
  ])("rejects %s", (_label, value) => {
    expect(isUuid(value)).toBe(false);
  });

  it.each([[null], [undefined], [7], [{}]])("rejects a non-string (%j)", (value) => {
    expect(isUuid(value)).toBe(false);
  });
});
