/**
 * 3d follow-up (BB-LDN-3dfix-141026), finding 4 — static guard: a `<form>` that holds a password field must never fall
 * back to the browser's default GET (which puts the password in the URL when it is submitted before hydration).
 * Every such form declares `method="post"` and a literal same-site `action` with no query string.
 *
 * Scope: every `.tsx` under `src/` that renders an `<input type="password">` (directly or through `<Input>`), tests
 * excluded. A new password form that skips the attributes fails here.
 * Known limits (code review L4): a password input in a shared component file with no `<form>` of its own is not
 * traced to the form that uses it; a `<form>` tag with an arrow function before `>` is cut short (fails loudly).
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const SRC = path.resolve(__dirname, "../..");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return walk(full);
    return full.endsWith(".tsx") && !/\.test\.tsx$/.test(full) ? [full] : [];
  });
}

/** A literal `type="password"`, or a JSX expression that can yield it (e.g. a show/hide toggle). Security review LOW. */
const PASSWORD_INPUT = /type=(["']password["']|\{[^}]*["']password["'][^}]*\})/;
/** Each `<form …>` opening tag, attributes included (may span lines; JSX `{…}` values hold no `>` here). */
const FORM_OPEN = /<form\b[^>]*>/g;

const passwordFiles = walk(SRC).filter((f) => PASSWORD_INPUT.test(readFileSync(f, "utf8")));
const formsInPasswordFiles = passwordFiles.flatMap((file) =>
  (readFileSync(file, "utf8").match(FORM_OPEN) ?? []).map((tag) => ({ file: path.relative(SRC, file), tag })),
);

describe("password forms never submit credentials in a URL", () => {
  it("finds the known password forms (the guard is scanning something)", () => {
    const files = new Set(formsInPasswordFiles.map((f) => f.file));
    for (const known of [
      "app/(auth)/login/page.tsx",
      "app/(auth)/signup/nanny/page.tsx",
      "app/(auth)/signup/parent/page.tsx",
    ]) {
      expect(files.has(known), known).toBe(true);
    }
  });

  it.each(formsInPasswordFiles.map((f) => [f.file, f.tag] as const))("%s declares method=post", (_file, tag) => {
    expect(tag).toMatch(/\bmethod="post"/);
  });

  it.each(formsInPasswordFiles.map((f) => [f.file, f.tag] as const))(
    "%s declares a literal same-site action with no query string",
    (_file, tag) => {
      const action = tag.match(/\baction="([^"]*)"/);
      expect(action, "a literal action=\"/path\"").not.toBeNull();
      expect(action![1]).toMatch(/^\/[^?#]*$/);
    },
  );
});
