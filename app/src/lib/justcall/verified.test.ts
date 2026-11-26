/**
 * The verified-event brand (plan 05 D8): only a signature check (or a ledger row one created) issues one, and a
 * look-alike, a copy or a cast is refused — the `calls/admin-proof.ts` WeakSet pattern.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { issueVerifiedJustCallEvent, isVerifiedJustCallEvent } from "./verified";

const FIELDS = { eventType: "call.completed", callSid: "CAtest0001", justcallId: null, requestId: null, requestTimestamp: "1", source: "webhook" } as const;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? sourceFiles(full) : /\.tsx?$/.test(name) ? [full] : [];
  });
}

describe("VerifiedJustCallEvent", () => {
  it("accepts an issued event, frozen", () => {
    const event = issueVerifiedJustCallEvent(FIELDS);
    expect(isVerifiedJustCallEvent(event)).toBe(true);
    expect(Object.isFrozen(event)).toBe(true);
    expect(event).toMatchObject({ kind: "justcall_event", ...FIELDS });
  });

  it.each([
    ["a look-alike", { kind: "justcall_event", ...FIELDS }],
    ["null", null],
    ["a string", "call.completed"],
  ])("refuses %s", (_label, value) => {
    expect(isVerifiedJustCallEvent(value)).toBe(false);
  });

  it("refuses a copy of an issued event", () => {
    expect(isVerifiedJustCallEvent({ ...issueVerifiedJustCallEvent(FIELDS) })).toBe(false);
  });

  it("is issued only by the signature check and the ledger (outside tests)", () => {
    const root = path.resolve(__dirname, "../..");
    const issuers = sourceFiles(root)
      .filter((f) => !/\.test(-util)?\.tsx?$/.test(f) && !f.endsWith(`${path.sep}verified.ts`))
      .filter((f) => readFileSync(f, "utf8").includes("issueVerifiedJustCallEvent"))
      .map((f) => path.relative(root, f));
    const allowed = ["lib/justcall/ledger.ts", "lib/justcall/signature.ts"].map((f) => f.split("/").join(path.sep));
    expect(issuers).toContain(allowed[1]);
    expect(issuers.filter((f) => !allowed.includes(f))).toEqual([]);
  });
});
