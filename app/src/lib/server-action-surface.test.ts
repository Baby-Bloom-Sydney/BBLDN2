/**
 * Server-only helpers stay out of `"use server"` modules: the names below live in plain server modules (or are
 * internal), so none is exported from a file whose first statement is the `"use server"` directive. And the full list
 * of exported actions is pinned (the snapshot), so a new one is a reviewed change.
 *
 * BB-wave1-041126, 2026-11-09.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(__dirname, "..");

const SERVER_ONLY = [
  "getNannyPhone",
  "getParentPhone",
  "getPositionSummary",
  "createInboxMessage",
  "logConnectionEvent",
  "beginScreenshotCheck",
  "recordCheckResult",
  "createNannyProfileShare",
  "createParentPositionShare",
  "createParentBsrShare",
  "activateDfyPosition",
  "processDfyWaves",
  "autofireMatchmaking",
  "recalculateProgress",
  "writeHistorySnapshot",
  "getProgressScores",
  "getActivity",
  "generateTileInsight",
  "getChildContext",
  "signupViaInvite",
  "syncNannyVerificationState",
];

const DIRECTIVE = /^(?:\s|\/\/[^\n]*\n|\/\*[\s\S]*?\*\/)*["']use server["']/;
const EXPORTED = /export\s+(?:async\s+)?function\s+(\w+)|export\s+const\s+(\w+)\s*=\s*async/g;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "node_modules" ? [] : sourceFiles(path);
    return /\.tsx?$/.test(entry.name) && !/\.(test|spec)\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

function serverActionList(): Array<[string, string]> {
  return sourceFiles(SRC).flatMap((file) => {
    const source = readFileSync(file, "utf8");
    if (!DIRECTIVE.test(source)) return [];
    return Array.from(source.matchAll(EXPORTED)).map((match): [string, string] => [match[1] ?? match[2], relative(SRC, file)]);
  });
}

const serverActionExports = (): Map<string, string> => new Map(serverActionList());

describe("server action modules", () => {
  it("finds the server action modules it scans", () => {
    expect(serverActionExports().get("updateNannyProfile")).toBe("lib/actions/nanny.ts");
  });

  it("export none of the server-only helpers", () => {
    const exported = serverActionExports();
    const exposed = SERVER_ONLY.filter((name) => exported.has(name)).map((name) => `${name} (${exported.get(name)})`);
    expect(exposed).toEqual([]);
  });

  it("export the reviewed list of actions (adding one updates this snapshot on purpose)", () => {
    const list = serverActionList().map(([name, file]) => `${file.split(sep).join("/")} ${name}`).sort();
    expect(list).toMatchSnapshot();
  });
});
