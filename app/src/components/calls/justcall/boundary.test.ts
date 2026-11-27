/**
 * The JustCall client files stay out of the server's modules (TypeScript review M4, 05a-2). 04's guard in
 * `lib/calls/calendar.test.ts` scans `app/admin/calls` only; this one scans `components/calls/justcall`: every file the
 * browser loads takes run-time imports from `@/lib/calls/*` and `@/lib/justcall/*` only from the zod-free modules, and
 * those modules import no zod and nothing server-only at run time. BB-wave2-231126/05-build.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = __dirname;
const LIB = join(__dirname, "../../../lib");
/** 04's allowed call modules, plus JustCall's words (types.ts is imported as types only). */
const ALLOWED = new Set(["calls/calendar-limits", "calls/copy", "calls/dashboard-row", "calls/outcomes", "calls/weekday", "justcall/words"]);

/** The `@/lib/calls/*` and `@/lib/justcall/*` modules a source imports at run time. */
function runtimeLibImports(source: string): string[] {
  return [...source.matchAll(/^import (?!type )[^;]*from "@\/lib\/((?:calls|justcall)\/[^"]+)";/gm)].map((m) => m[1]);
}

describe("components/calls/justcall — the browser's side of the boundary", () => {
  it("the scan finds a server module imported at run time, and ignores a type-only import", () => {
    const source = ['import type { X } from "@/lib/justcall/admin";', 'import { listUnmatched } from "@/lib/justcall/admin";', 'import { JUSTCALL_COPY } from "@/lib/justcall/words";'].join("\n");
    expect(runtimeLibImports(source).filter((name) => !ALLOWED.has(name))).toEqual(["justcall/admin"]);
  });

  it("every client file imports from the call and JustCall libraries only the zod-free modules", () => {
    const files = readdirSync(DIR).filter((f) => /\.tsx?$/.test(f) && !/\.test\./.test(f));
    expect(files.length).toBeGreaterThanOrEqual(3);
    const offending = files.flatMap((file) =>
      runtimeLibImports(readFileSync(join(DIR, file), "utf8"))
        .filter((name) => !ALLOWED.has(name))
        .map((name) => `${file} → ${name}`),
    );
    expect(offending).toEqual([]);
  });

  it("JustCall's words and types import no zod, no Supabase and no server module at run time", () => {
    for (const name of ["words", "types"]) {
      const source = readFileSync(join(LIB, "justcall", `${name}.ts`), "utf8");
      expect(source).not.toMatch(/^import (?!type )[^;]*from "(zod|@supabase\/[^"]+|@\/lib\/supabase\/[^"]+|\.\/(admin|admin-repo|repo|ledger|api|apply)|next\/[^"]+)";/m);
      expect(runtimeLibImports(source).filter((n) => !ALLOWED.has(n))).toEqual([]);
    }
  });
});
