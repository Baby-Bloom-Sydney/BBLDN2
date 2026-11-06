/**
 * The page helpers the call-booking walks share (`call-booking.spec.ts`, `call-booking-calendar.spec.ts`): the env they
 * read, sign-in in an Australia/Sydney browser, the 4-width screenshots with the sideways-scroll check, the picker's
 * steps, London names, the Calls tab's tables. Moved unchanged from `call-booking.spec.ts` (BB-wave1-041126/04c2-build,
 * 2026-11-06: that file had reached 800 lines); written by BB-wave1-041126/04b-build and /04c1-build.
 *
 * Local stack only: the walks skip unless `IS_LOCAL` (and, for the admin walks, `APP_IS_LOCAL` and `DRY_RUN`).
 */
import { expect, type Browser, type Locator, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

export const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3101";
export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
export const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
export const MODE = process.env.CALL_BOOKING_E2E;
export const IS_LOCAL = /^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(SUPABASE_URL);
export const WIDTHS = [320, 768, 1024, 1440] as const;

/** The fixture admin's password is typed into this app: only ever a local one (security review L3). */
export const APP_IS_LOCAL = /^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(BASE_URL);
/** The walk books, moves and cancels on families' behalf: only with every email a dry run (review round 2 L12). */
export const DRY_RUN = process.env.EMAIL_DEV_DRY_RUN === "true";

export const LONDON = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London",
  weekday: "long",
  day: "numeric",
  month: "long",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** What a slot's accessible name must be: the London words for its instant, whatever the browser's zone (W14: not labelled). */
export function londonName(iso: string): string {
  const parts = LONDON.formatToParts(new Date(iso));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
  return `${part("weekday")} ${part("day")} ${part("month")}, ${part("hour")}:${part("minute")}`;
}

/** The picker's three steps (W14), each a group of toggle buttons (W17): the days, the times of day, the chosen one's times. */
export type Step = "heading" | "time-of-day" | "select-time";
export const step = (scope: Page | Locator, which: Step) => scope.locator(`[role="group"][aria-labelledby$="-${which}"]`);
export const openIn = (group: Locator) => group.locator("button[aria-pressed]:not([disabled])");

export async function dismissCookies(page: Page): Promise<void> {
  const decline = page.getByRole("button", { name: "Decline" });
  if (await decline.isVisible().catch(() => false)) await decline.click();
}

export async function sydneyPage(browser: Browser): Promise<Page> {
  const context = await browser.newContext({ timezoneId: "Australia/Sydney", viewport: { width: 1280, height: 900 } });
  return context.newPage();
}

/** The elements wider than the window (a page that scrolls sideways), or none. */
export async function sideScroll(page: Page): Promise<readonly string[]> {
  return page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    if (document.documentElement.scrollWidth <= vw) return [];
    return [...document.querySelectorAll("body *")]
      .filter((el) => el.getClientRects().length > 0 && el.getBoundingClientRect().right > vw + 1)
      .slice(0, 8)
      .map((el) => `${el.tagName.toLowerCase()}.${String(el.className).slice(0, 60)} → ${Math.round(el.getBoundingClientRect().right)}px`);
  });
}

/** After the next frame, every running CSS animation and transition has finished (the shell's resize, a slide's fade). */
export async function settled(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    await Promise.all(document.getAnimations().map((a) => a.finished.catch(() => null)));
  });
}

/**
 * Screenshots at 320 / 768 / 1024 / 1440, each checked for no sideways scroll; the cookie bar dismissed first. The
 * drawer is fixed and scrolls inside itself, so drawer shots are the window (taller), not the page behind it.
 */
export async function shootTo(page: Page, dir: string, name: string, { drawer = false }: { readonly drawer?: boolean } = {}): Promise<void> {
  mkdirSync(dir, { recursive: true });
  await dismissCookies(page);
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: drawer ? 1600 : 900 });
    await settled(page); // the admin shell animates its sidebar padding on resize (transition-all, 200 ms)
    expect(await sideScroll(page), `${name} at ${width}px scrolls sideways`).toEqual([]);
    await page.screenshot({ path: join(dir, `${name}-${width}.png`), fullPage: !drawer });
  }
  await page.setViewportSize({ width: 1280, height: 900 });
}

export async function signInSydney(browser: Browser, email: string, password: string, to: string): Promise<Page> {
  const signedIn = await sydneyPage(browser);
  await signedIn.goto(`${BASE_URL}/login?redirect=${encodeURIComponent(to)}`, { timeout: 180_000, waitUntil: "networkidle" });
  await signedIn.fill('input[name="email"]', email);
  await signedIn.fill('input[name="password"]', password);
  await signedIn.click('button[type="submit"]');
  await signedIn.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 180_000 });
  return signedIn;
}

export const section = (page: Page, name: string) => page.getByRole("table", { name });
export const familyRow = (page: Page, table: string, name: string) => section(page, table).locator("tr", { hasText: name });
