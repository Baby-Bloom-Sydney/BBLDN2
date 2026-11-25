/**
 * Sentry never gets a deposit code (03c security review M1; plan 03 §10 "the code is in the URL"). The root layout's
 * browser `Sentry.init` sends the page URL — `/deposit/<code>`, and the done page's `?session=cs_…` — in events,
 * transactions (page loads, the server actions' POSTs to the page URL) and breadcrumbs (navigation, fetch, console).
 * `scrubDepositForSentry` rewrites every string in what it is given: `/deposit/<code>` → `/deposit/[code]` and a
 * `session` query value dropped. The layout inlines its source text (`SENTRY_SCRUB_OPTIONS`), so the same function is
 * tested here twice: imported, and evaluated from that text in a fresh context (proving it needs no outer name).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { scrubDepositForSentry, SENTRY_SCRUB_OPTIONS } from "./sentry-scrub";

const CODE = "Sx0_-".repeat(8) + "xyz";
const SITE = "https://www.example.co.uk";

type Hooks = {
  beforeSend: (event: unknown, hint?: unknown) => unknown;
  beforeSendTransaction: (event: unknown, hint?: unknown) => unknown;
  beforeBreadcrumb: (breadcrumb: unknown, hint?: unknown) => unknown;
};
const inlined = (): Hooks => runInNewContext(`({ ${SENTRY_SCRUB_OPTIONS} })`) as Hooks;

describe("scrubDepositForSentry — one string", () => {
  it.each([
    [`${SITE}/deposit/${CODE}`, `${SITE}/deposit/[code]`],
    [`/deposit/${CODE}?cancelled=1`, "/deposit/[code]?cancelled=1"],
    [`${SITE}/deposit/${CODE}/done?session=cs_test_a1B2`, `${SITE}/deposit/[code]/done?session=`],
    [`/deposit/${CODE}/done?x=1&session=cs_test_a1B2#top`, "/deposit/[code]/done?x=1&session=#top"],
    [`/deposit/${CODE}#pay`, "/deposit/[code]#pay"],
    [`POST /deposit/${CODE}`, "POST /deposit/[code]"],
    [`Failed at /deposit/${CODE} just now`, "Failed at /deposit/[code] just now"],
    [`%2Fdeposit%2F${CODE}`, "%2Fdeposit%2F[code]"],
    ["/deposit", "/deposit"],
    ["/deposit/[code]", "/deposit/[code]"],
    ["/parent/subscription?session_id=cs_test_keep", "/parent/subscription?session_id=cs_test_keep"],
    ["/about", "/about"],
  ])("%s → %s", (raw, scrubbed) => {
    expect(scrubDepositForSentry(raw)).toBe(scrubbed);
  });

  it("a script chunk path keeps its name (the route folder is already [code])", () => {
    const chunk = "/_next/static/chunks/app/(public)/deposit/[code]/page-0a1b.js";
    expect(scrubDepositForSentry(chunk)).toBe(chunk);
  });
});

describe("scrubDepositForSentry — whole events and breadcrumbs", () => {
  const event = () => ({
    event_id: "e1",
    transaction: `/deposit/${CODE}`,
    message: `went wrong on /deposit/${CODE}/done?session=cs_test_1`,
    request: { url: `${SITE}/deposit/${CODE}/done?session=cs_test_1`, headers: { Referer: `${SITE}/deposit/${CODE}`, "User-Agent": "UA" } },
    tags: { url: `${SITE}/deposit/${CODE}`, level: 3 },
    exception: { values: [{ type: "TypeError", value: `bad /deposit/${CODE}` }] },
    spans: [{ description: `POST /deposit/${CODE}`, data: { url: `/deposit/${CODE}` } }],
    breadcrumbs: [{ category: "navigation", data: { from: `/deposit/${CODE}`, to: `/deposit/${CODE}/done?session=cs_test_1` } }],
    extra: { when: new Date("2027-02-02T10:00:00Z"), nothing: null, flag: true },
  });

  it("every string, at any depth, scrubbed; numbers, booleans, null and non-plain objects kept", () => {
    const scrubbed = scrubDepositForSentry(event());
    expect(JSON.stringify(scrubbed)).not.toContain(CODE);
    expect(JSON.stringify(scrubbed)).not.toContain("cs_test_1");
    expect(scrubbed).toMatchObject({
      transaction: "/deposit/[code]",
      request: { url: `${SITE}/deposit/[code]/done?session=`, headers: { Referer: `${SITE}/deposit/[code]`, "User-Agent": "UA" } },
      tags: { url: `${SITE}/deposit/[code]`, level: 3 },
      spans: [{ description: "POST /deposit/[code]", data: { url: "/deposit/[code]" } }],
      breadcrumbs: [{ data: { from: "/deposit/[code]", to: "/deposit/[code]/done?session=" } }],
    });
    expect(scrubbed.extra.when).toBeInstanceOf(Date);
    expect(scrubbed.extra).toMatchObject({ nothing: null, flag: true });
  });

  it("returns a copy: what it was given is unchanged", () => {
    const original = event();
    const before = JSON.stringify(original);
    scrubDepositForSentry(original);
    expect(JSON.stringify(original)).toBe(before);
  });

  it("a very deep object stops recursing rather than overflowing", () => {
    let deep: Record<string, unknown> = { url: `/deposit/${CODE}` };
    for (let i = 0; i < 200; i += 1) deep = { next: deep };
    expect(() => scrubDepositForSentry(deep)).not.toThrow();
  });
});

describe("SENTRY_SCRUB_OPTIONS — the text the root layout inlines into Sentry.init", () => {
  it("evaluates on its own (no import, no outer name) to the three hooks", () => {
    const hooks = inlined();
    expect(Object.keys(hooks).sort()).toEqual(["beforeBreadcrumb", "beforeSend", "beforeSendTransaction"]);
    for (const hook of Object.values(hooks)) expect(typeof hook).toBe("function");
  });

  it("each hook scrubs what Sentry hands it, ignoring the hint Sentry passes second", () => {
    const hooks = inlined();
    const hint = { originalException: new Error("x"), depth: 99 };
    const sent = hooks.beforeSend({ request: { url: `/deposit/${CODE}` } }, hint);
    const trace = hooks.beforeSendTransaction({ transaction: `/deposit/${CODE}/done?session=cs_test_9` }, hint);
    const crumb = hooks.beforeBreadcrumb({ category: "fetch", data: { url: `/deposit/${CODE}`, method: "POST" } }, hint);
    expect(sent).toEqual({ request: { url: "/deposit/[code]" } });
    expect(trace).toEqual({ transaction: "/deposit/[code]/done?session=" });
    expect(crumb).toEqual({ category: "fetch", data: { url: "/deposit/[code]", method: "POST" } });
  });

  it("the root layout passes them inside its Sentry.init, keeping its DSN and sample rate", () => {
    const layout = readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), "../../app/layout.tsx"), "utf8");
    expect(layout).toMatch(/import \{ SENTRY_SCRUB_OPTIONS \} from "@\/lib\/deposit\/sentry-scrub";/);
    const init = layout.slice(layout.indexOf("Sentry.init({"), layout.indexOf("});", layout.indexOf("Sentry.init({")));
    expect(init).toContain("dsn:");
    expect(init).toContain("tracesSampleRate: 0.1,");
    expect(init).toContain("${SENTRY_SCRUB_OPTIONS}");
  });
});
