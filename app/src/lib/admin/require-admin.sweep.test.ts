/**
 * `requireAdmin()` returns `{ userId, error }` and never throws, so a caller that doesn't read `error` isn't checked.
 * Every call site binds the result and refuses on `error` within the next few lines.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(__dirname, "..", "..");
const LOOKAHEAD = 3;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = join(dir, e.name);
    if (e.isDirectory()) return e.name === "node_modules" ? [] : sourceFiles(full);
    return /\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [full] : [];
  });
}

/** The name the call's `error` lands in, or null when the result isn't bound with its error. */
function errorBinding(line: string): string | null {
  const gate = line.match(/const\s+(\w+)\s*=\s*await\s+requireAdmin\(\)/);
  if (gate) return `${gate[1]}.error`;
  const destructured = line.match(/const\s*\{([^}]*)\}\s*=\s*await\s+requireAdmin\(\)/);
  if (!destructured) return null;
  const field = destructured[1].split(",").map((f) => f.trim()).find((f) => /^error\b/.test(f));
  if (!field) return null;
  return field.includes(":") ? field.split(":")[1].trim() : "error";
}

const calls = sourceFiles(SRC).flatMap((file) => {
  const path = relative(SRC, file).split(sep).join("/");
  const lines = readFileSync(file, "utf8").split("\n");
  return lines.flatMap((line, i) => {
    // every call, in any form (a definition or a comment isn't one)
    if (!/requireAdmin\(\)/.test(line) || /^\s*(\/\/|\*)/.test(line) || /function\s+requireAdmin\(/.test(line)) return [];
    const binding = errorBinding(line);
    const next = lines.slice(i + 1, i + 1 + LOOKAHEAD).join("\n");
    // the check refuses on the error (not its negation)
    const checked = binding !== null && new RegExp(`if\\s*\\(\\s*${binding.replace(".", "\\.")}\\b`).test(next);
    return [{ at: `${path}:${i + 1}`, line: line.trim(), checked }];
  });
});

describe("requireAdmin call sites", () => {
  it("finds the call sites (the scan works)", () => {
    expect(calls.length).toBeGreaterThan(30);
  });

  it("each one refuses when the check fails", () => {
    expect(calls.filter((c) => !c.checked).map((c) => `${c.at} ${c.line}`)).toEqual([]);
  });
});
