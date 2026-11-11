/**
 * Server-only helpers stay out of `"use server"` modules: the names below live in plain server modules (or are
 * internal), so none is exported from a file whose first statement is the `"use server"` directive. And the full list
 * of exported actions is pinned (the snapshot), so a new one is a reviewed change. Read with the TypeScript parser, so
 * every runtime export form counts (`export { … }`, typed consts, default exports).
 *
 * BB-wave1-041126, 2026-11-09.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import ts from "typescript";
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

/** The runtime names a module exports (type-only exports are not runtime exports). */
function exportedNames(source: string): string[] {
  const file = ts.createSourceFile("module.tsx", source, ts.ScriptTarget.Latest, false, ts.ScriptKind.TSX);
  return file.statements.flatMap((statement): string[] => {
    if (ts.isExportAssignment(statement)) return ["default"];
    if (ts.isExportDeclaration(statement)) {
      if (statement.isTypeOnly || !statement.exportClause || !ts.isNamedExports(statement.exportClause)) return [];
      return statement.exportClause.elements.filter((e) => !e.isTypeOnly).map((e) => e.name.text);
    }
    const modifiers = ts.canHaveModifiers(statement) ? ts.getModifiers(statement) ?? [] : [];
    if (!modifiers.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) return [];
    if (modifiers.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword)) return ["default"];
    if (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) return statement.name ? [statement.name.text] : [];
    if (ts.isVariableStatement(statement)) {
      return statement.declarationList.declarations.flatMap((d) => (ts.isIdentifier(d.name) ? [d.name.text] : []));
    }
    return [];
  });
}

/** A `"use server"` module: its first statement is the directive. */
function isServerActionModule(source: string): boolean {
  const file = ts.createSourceFile("module.tsx", source, ts.ScriptTarget.Latest, false, ts.ScriptKind.TSX);
  const first = file.statements[0];
  return !!first && ts.isExpressionStatement(first) && ts.isStringLiteral(first.expression) && first.expression.text === "use server";
}

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
    if (!isServerActionModule(source)) return [];
    return exportedNames(source).map((name): [string, string] => [name, relative(SRC, file)]);
  });
}

const serverActionExports = (): Map<string, string> => new Map(serverActionList());

describe("reading a module's exports", () => {
  it("finds every runtime export form, and no type-only one", () => {
    const source = [
      '"use server";',
      "export async function a() {}",
      "export function b() {}",
      "export const c = async () => 1;",
      "export const d: () => Promise<number> = async () => 1;",
      "const e = async () => 1; const f = async () => 2;",
      "export { e, f as g };",
      "export default async function h() {}",
      "export type T = string;",
      "export interface I { x: number }",
      "export { type T as U };",
    ].join("\n");
    expect(exportedNames(source).sort()).toEqual(["a", "b", "c", "d", "default", "e", "g"]);
  });
});

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
