/**
 * Brief §0.10 / §9.10: nothing in the place layer can issue a refund. A late payment is taken and shown "Over by 1";
 * no module here imports the Stripe client or calls a refund. (The refund hook only reads the charge's type.)
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const DIR = path.dirname(new URL(import.meta.url).pathname);
const sources = readdirSync(DIR).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));

describe("the cohorts layer never touches Stripe's money", () => {
  it.each(sources)("%s imports no Stripe client and calls no refund", (file) => {
    const text = readFileSync(path.join(DIR, file), "utf8");
    expect(text).not.toMatch(/@\/lib\/stripe/);
    expect(text).not.toMatch(/getStripeClient|refunds\.create|new Stripe\(/);
    for (const line of text.split("\n").filter((l) => /from\s+["']stripe["']/.test(l))) {
      expect(line).toMatch(/^import type /);
    }
  });

  it("covers the place operations and the refund hook", () => {
    expect(sources).toEqual(expect.arrayContaining(["places.ts", "refund-hook.ts", "board.ts", "read.ts"]));
  });
});
