/**
 * Brief 04b local proof (plan B8; brief §0a, §9.1–9.5, §9.9, §9.13; §12 R4, R8, R25; 04b rework W10). NOT run in CI.
 *
 * Runs only against the LOCAL wave-1 Supabase stack (LDN2/PLAN/PROOF/local-stack, `dev-env.sh`): it refuses any
 * Supabase URL that isn't localhost, so it can never touch bb-ldn or Sydney. The local stack has no real nanny
 * applicants, which satisfies R4; `EMAIL_DEV_DRY_RUN=true` keeps every email a logged dry run.
 *
 * The browser runs in Australia/Sydney on purpose: every time on the page must still be London's (brief §3 parent 6).
 *
 * 04b rework: the call is a funnel slide at `/matchmaking/call` (W1–W5), in the app a popup over the Childcare tab
 * (W9, W12); the picker reveals strictly one step per tap — the day tiles, then four time-of-day tiles, then that time
 * of day's times — and changing opens with only the days (W14, W15); a tap on a time holds it at once (W4). Nothing
 * says "London time" to a parent (W14). A quick-match parent with no position picks without a hold, and "Confirm time"
 * takes her to her position form, which opens on its intro (W11, W15).
 *
 * Two runs, one per flag state (the flag is inlined at build, so the dev server is restarted between them):
 *
 *   eval "$(LDN2/PLAN/PROOF/local-stack/dev-env.sh)"
 *   CALL_BOOKING_ENABLED=true CRON_SECRET=local-b04b-cron npx next dev -p 3101
 *   CALL_BOOKING_E2E=on  CRON_SECRET=local-b04b-cron PLAYWRIGHT_BASE_URL=http://localhost:3101 \
 *     B04B_PROOF_DIR=<proof dir> npx playwright test tests/e2e/call-booking.spec.ts --project=desktop-chrome
 *   (restart without CALL_BOOKING_ENABLED, then the same with CALL_BOOKING_E2E=off)
 *
 * Fixtures: `admin+b04b-…@babybloomnannies.co.uk` parents made by the sign-up forms, one `parent_leads` row, and
 * one temporary `call_blocks` row (removed). `call_settings.enabled_since` and `caller_number` get fixture values
 * for the walk and are restored after (plan §12 R11: never stamped on read).
 *
 * 04c-1 adds the staff Calls tab (at the end of this file; `--grep "Calls tab"`): fixture families in every section and
 * with every tag, read by an admin in the same Sydney-zone browser; the drawer, an outcome and booking, moving and
 * cancelling on a family's behalf; and the flag-off checks.
 *
 * BB-wave1-041126/04b-build, 2026-11-04; BB-wave1-041126/04b-rework, 2026-11-05; BB-wave1-041126/04c1-build, 2026-11-05.
 */
import { expect, test, type Browser, type Locator, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createCallsFixture, localDb, removeCallsFixture, type CallsFixture } from "./fixtures/call-admin";

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3101";
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const CRON_SECRET = process.env.CRON_SECRET ?? "";
const MODE = process.env.CALL_BOOKING_E2E;
const PROOF_DIR = process.env.B04B_PROOF_DIR ?? "test-results/b04b";
const IS_LOCAL = /^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(SUPABASE_URL);

const WIDTHS = [320, 768, 1024, 1440] as const;
const PASSWORD = "B04b-local-walk-1!";
const RUN = Date.now().toString(36);
const QUICK_EMAIL = `admin+b04b-quick-${RUN}@babybloomnannies.co.uk`;
const ADVANCED_EMAIL = `admin+b04b-adv-${RUN}@babybloomnannies.co.uk`;
const OFF_EMAIL = `admin+b04b-off-${RUN}@babybloomnannies.co.uk`;
const LEAD_ID = crypto.randomUUID();
const FIXTURE_CALLER = "+447700900999";
const MATCHES = "/parent?t=childcare&s=nannies&v=matches";
const CHILDCARE = "/parent?t=childcare";
const MINUTE = 60_000;
/** The fixture switch-on is this long ago: room for the 31-minute backdate, and no earlier local fixture in scope. */
const WALK_SCOPE_MINUTES = 40;

const LONDON = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London",
  weekday: "long",
  day: "numeric",
  month: "long",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** What a slot's accessible name must be: the London words for its instant, whatever the browser's zone (W14: not labelled). */
function londonName(iso: string): string {
  const parts = LONDON.formatToParts(new Date(iso));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
  return `${part("weekday")} ${part("day")} ${part("month")}, ${part("hour")}:${part("minute")}`;
}

function admin(): SupabaseClient {
  if (!IS_LOCAL) throw new Error("local stack only — refusing a non-localhost Supabase URL");
  return createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
}

async function shoot(page: Page, name: string): Promise<void> {
  mkdirSync(PROOF_DIR, { recursive: true });
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => resolve(null))));
    await page.screenshot({ path: join(PROOF_DIR, `${name}-${width}.png`), fullPage: true });
  }
  await page.setViewportSize({ width: 1280, height: 900 });
}

async function signUp(page: Page, path: string, email: string): Promise<void> {
  await page.goto(`${BASE_URL}${path}`, { timeout: 180_000 });
  await page.waitForSelector('input[name="firstName"]', { timeout: 120_000 });
  await page.fill('input[name="firstName"]', "Jane");
  await page.fill('input[name="lastName"]', "Walk");
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="mobile"]', "07700900123");
  await page.fill('input[name="password"]', PASSWORD);
  await page.fill('input[name="confirmPassword"]', PASSWORD);
  const boxes = page.locator('input[type="checkbox"]');
  for (let i = 0; i < (await boxes.count()); i += 1) await boxes.nth(i).check({ force: true });
  await page.click('button[type="submit"]');
}

/** The picker's three steps (W14), each a group of toggle buttons (W17): the days, the times of day, the chosen one's times. */
type Step = "heading" | "time-of-day" | "select-time";
const step = (scope: Page | Locator, which: Step) => scope.locator(`[role="group"][aria-labelledby$="-${which}"]`);
const openIn = (group: Locator) => group.locator("button[aria-pressed]:not([disabled])");

/**
 * Pick the way a person does: an open day not already chosen (the first, the last, or the tile at `day`), its first
 * open time of day, then that one's `n`th open time. Returns its instant.
 */
async function pickSlot(scope: Page | Locator, { n = 0, day, last = false }: { readonly n?: number; readonly day?: number; readonly last?: boolean } = {}): Promise<string> {
  const days = step(scope, "heading");
  const open = days.locator('button[aria-pressed="false"]:not([disabled])');
  await (day !== undefined ? days.locator("button[aria-pressed]").nth(day) : last ? open.last() : open.first()).click();
  await openIn(step(scope, "time-of-day")).first().click();
  const time = openIn(step(scope, "select-time")).nth(n);
  const startsAt = (await time.locator("time").getAttribute("datetime")) ?? "";
  await time.click();
  return startsAt;
}

async function dismissCookies(page: Page): Promise<void> {
  const decline = page.getByRole("button", { name: "Decline" });
  if (await decline.isVisible().catch(() => false)) await decline.click();
}

async function userIdOf(db: SupabaseClient, email: string): Promise<string> {
  const { data } = await db.from("user_profiles").select("user_id").eq("email", email).single();
  if (!data) throw new Error(`no profile for ${email}`);
  return (data as { user_id: string }).user_id;
}

async function sydneyPage(browser: Browser): Promise<Page> {
  const context = await browser.newContext({ timezoneId: "Australia/Sydney", viewport: { width: 1280, height: 900 } });
  return context.newPage();
}

test.describe.serial("call booking — flag on (local stack)", () => {
  test.skip(MODE !== "on" || !IS_LOCAL, "set CALL_BOOKING_E2E=on with the local stack's env");
  test.setTimeout(240_000);

  let db: SupabaseClient;
  let page: Page;
  let quickId = "";
  let advancedId = "";
  let bookingId = "";
  let settingsBefore: { enabled_since: string | null; caller_number: string | null } | null = null;
  const readback: Record<string, unknown> = { run: RUN };

  test.beforeAll(async ({ browser }) => {
    db = admin();
    const { data } = await db.from("call_settings").select("enabled_since, caller_number").eq("id", 1).single();
    settingsBefore = data as typeof settingsBefore;
    // A recent fixture switch-on, so only this walk's parents are in scope (other local fixtures signed up earlier).
    const since = new Date(Date.now() - WALK_SCOPE_MINUTES * MINUTE).toISOString();
    await db.from("call_settings").update({ enabled_since: since, caller_number: FIXTURE_CALLER }).eq("id", 1);
    const lead = { id: LEAD_ID, form_data: { first_name: "Jane", suburb: "Islington", postcode: "N1 1AA", num_children: 1, child_a_age: "1–2 years", weekly_roster: ["Monday"], monday_roster: ["morning"] }, suburb: "Islington", postcode: "N1 1AA" };
    const { error } = await db.from("parent_leads").insert(lead);
    if (error) throw new Error(`lead fixture: ${error.message}`);
    page = await sydneyPage(browser);
  });

  test.afterAll(async () => {
    if (settingsBefore) await db.from("call_settings").update(settingsBefore).eq("id", 1);
    await db.from("call_blocks").delete().eq("reason", `b04b walk ${RUN}`);
    await db.from("parent_leads").delete().eq("id", LEAD_ID);
    mkdirSync(PROOF_DIR, { recursive: true });
    writeFileSync(join(PROOF_DIR, "walk-readback.json"), `${JSON.stringify(readback, null, 2)}\n`);
  });

  test("advanced sign-up lands on the call slide (/matchmaking/call), next = today's matches; London in a Sydney browser", async () => {
    await signUp(page, `/matchmaking/signup?lead=${LEAD_ID}`, ADVANCED_EMAIL);
    await page.waitForURL(`${BASE_URL}/matchmaking/call?next=${encodeURIComponent(MATCHES)}`, { timeout: 180_000 });
    advancedId = await userIdOf(db, ADVANCED_EMAIL);
    await expect(page.getByRole("heading", { level: 1, name: "Your Complimentary matchmaker call" })).toBeVisible();
    await dismissCookies(page);
    expect(await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone)).toBe("Australia/Sydney");
    // Step by step (W14): only the days; a day → the times of day; a time of day → its times.
    await expect(step(page, "time-of-day")).toHaveCount(0);
    await shoot(page, "picker-days");
    await openIn(step(page, "heading")).first().click();
    await expect(step(page, "select-time")).toHaveCount(0);
    await shoot(page, "picker-time-of-day");
    await openIn(step(page, "time-of-day")).first().click();
    const first = openIn(step(page, "select-time")).first();
    const startsAt = (await first.locator("time").getAttribute("datetime")) ?? "";
    expect(await first.getAttribute("aria-label")).toBe(londonName(startsAt));
    await expect(page.getByText(/London time/)).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Skip for now" })).toHaveAttribute("href", MATCHES);
    readback.advancedLanding = page.url();
    readback.firstSlot = { startsAt, name: await first.getAttribute("aria-label"), browserZone: "Australia/Sydney" };
    await shoot(page, "picker-times");
    // Unselecting the day hides what came after it.
    await step(page, "heading").locator('[aria-pressed="true"]').click();
    await expect(step(page, "time-of-day")).toHaveCount(0);
    await expect(step(page, "select-time")).toHaveCount(0);
  });

  test("book: a tap holds at once, Confirm time → You're booked", async () => {
    await pickSlot(page);
    // W16: BAI's line with the settings' hold minutes (the green panel above names the time).
    const { data: hold } = await db.from("call_settings").select("hold_minutes").eq("id", 1).single();
    const minutes = (hold as { hold_minutes: number }).hold_minutes;
    await expect(page.getByText(`Your time is being reserved for ${minutes} ${minutes === 1 ? "minute" : "minutes"}`, { exact: true })).toBeVisible();
    await shoot(page, "held");
    await page.getByRole("button", { name: "Confirm time" }).click();
    await expect(page.getByRole("heading", { name: "You're booked" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Go to my matches" })).toHaveAttribute("href", MATCHES);
    const { data } = await db.from("call_bookings").select("id, status, starts_at").eq("parent_user_id", advancedId).eq("status", "booked").single();
    bookingId = (data as { id: string }).id;
    readback.booked = data;
    await shoot(page, "booked");
  });

  test("the Childcare card shows her time · Change time (no nanny hired or connected)", async () => {
    await page.goto(`${BASE_URL}${CHILDCARE}`, { timeout: 180_000 });
    await expect(page.getByText(/^\w{3} \d{1,2} \w{3}, \d\d:\d\d$/)).toBeVisible({ timeout: 120_000 });
    await expect(page.getByText(/London time/)).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Change time" })).toBeVisible();
    await shoot(page, "card-booked");
  });

  test("Change time opens the popup in place and moves the same booking", async () => {
    await page.getByRole("button", { name: "Change time" }).click();
    const dialog = page.getByRole("dialog", { name: "Your Complimentary matchmaker call" });
    await expect(dialog.getByText(/^Your call: /)).toBeVisible({ timeout: 120_000 });
    expect(new URL(page.url()).pathname).toBe("/parent");
    // Changing opens with her booking on top and only the days, nothing chosen (W15).
    await expect(dialog.locator('[role="group"]')).toHaveCount(1);
    await expect(step(dialog, "heading").locator('[aria-pressed="true"]')).toHaveCount(0);
    await shoot(page, "popup-change");
    await pickSlot(dialog, { last: true }); // her time was the first open day's: the last open day is another
    await dialog.getByRole("button", { name: "Confirm time" }).click();
    await expect(page.getByRole("dialog", { name: "You're booked" })).toBeVisible();
    const { data } = await db.from("call_bookings").select("id, status, starts_at, moved_at, moved_from_starts_at").eq("parent_user_id", advancedId).eq("status", "booked").single();
    expect((data as { id: string }).id).toBe(bookingId);
    expect((data as { moved_at: string | null }).moved_at).not.toBeNull();
    readback.moved = data;
  });

  test("Cancel in the popup → back to picking; the card says Book a time", async () => {
    const dialog = page.getByRole("dialog", { name: "You're booked" });
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await dialog.getByRole("button", { name: "Yes, cancel it" }).click();
    await expect(page.getByRole("dialog").getByRole("button", { name: "Confirm time" })).toBeVisible();
    const { data } = await db.from("call_bookings").select("id, status, cancel_reason").eq("id", bookingId).single();
    expect(data).toMatchObject({ status: "cancelled", cancel_reason: "parent" });
    readback.cancelled = data;
    await page.keyboard.press("Escape");
    await page.reload({ timeout: 180_000 });
    await expect(page.getByRole("button", { name: "Book a time" })).toBeVisible({ timeout: 120_000 });
    await shoot(page, "card-not-booked");
  });

  test("no free time → the no-times line", async () => {
    const block = { starts_at: new Date().toISOString(), ends_at: new Date(Date.now() + 10 * 24 * 60 * MINUTE).toISOString(), reason: `b04b walk ${RUN}` };
    await db.from("call_blocks").insert(block);
    await page.goto(`${BASE_URL}/matchmaking/call`, { timeout: 180_000 });
    await expect(page.getByText("No times free right now — we'll still call you for your Complimentary matchmaker call.")).toBeVisible();
    await shoot(page, "no-times");
    await db.from("call_blocks").delete().eq("reason", block.reason);
  });

  test("quick sign-up lands on the slide (next = her Childcare tab); with no position a pick holds nothing; the intro (W11, W15)", async ({ browser }) => {
    const fresh = await sydneyPage(browser);
    await signUp(fresh, "/signup?src=std", QUICK_EMAIL);
    await fresh.waitForURL(`${BASE_URL}/matchmaking/call?next=${encodeURIComponent(CHILDCARE)}`, { timeout: 180_000 });
    quickId = await userIdOf(db, QUICK_EMAIL);
    const startsAt = await pickSlot(fresh);
    await expect(fresh.getByText("Complete your childcare position so that we can confirm your call with your matchmaker.")).toBeVisible();
    const onward = fresh.getByRole("link", { name: "Confirm time" });
    await expect(onward).toHaveAttribute("href", `/parent/request?callAt=${encodeURIComponent(startsAt)}`);
    const { count } = await db.from("call_bookings").select("id", { count: "exact", head: true }).eq("parent_user_id", quickId);
    expect(count).toBe(0);
    readback.quickLanding = fresh.url();
    // Confirm time → her position form, which opens on its intro and then moves on to question 1 (W15).
    await onward.click();
    await expect(fresh.getByText("Create your childcare position to get your best matches")).toBeVisible({ timeout: 180_000 });
    await expect(fresh.getByText("How many children will be in your nanny's care?")).toBeVisible({ timeout: 30_000 });
    await expect(fresh.getByText("Create your childcare position to get your best matches")).toHaveCount(0);
    await fresh.context().close();
  });

  test("the emails: confirmation (with the caller number), admin booked, changed, cancelled — dry run", async () => {
    const { data } = await db.from("email_logs").select("email_type, subject, body_html, recipient_user_id").in("email_type", ["call_booking_confirmation", "call_booking_changed", "call_booking_cancelled", "admin_call_booked"]).order("created_at", { ascending: true });
    const rows = (data ?? []) as Array<{ email_type: string; subject: string; body_html: string; recipient_user_id: string | null }>;
    const hers = rows.filter((r) => r.recipient_user_id === advancedId);
    expect(hers.map((r) => r.email_type)).toEqual(["call_booking_confirmation", "call_booking_changed", "call_booking_cancelled"]);
    expect(hers[0].body_html).toContain("+44 (0) 7700 900 999");
    expect(hers[0].body_html).toContain("/matchmaking/call");
    const adminBooked = rows.filter((r) => r.email_type === "admin_call_booked" && r.subject.includes("Jane Walk"));
    expect(adminBooked.length).toBeGreaterThanOrEqual(1);
    readback.emails = [...hers, ...adminBooked].map((r) => ({ type: r.email_type, subject: r.subject }));
  });

  test("the cron, six runs: one call_not_booked for the never-booked parent, none for the one who booked (R2)", async ({ request }) => {
    // Past the 30-minute delay, still after the fixture switch-on (re-set now, however long the walk took).
    const since = new Date(Date.now() - WALK_SCOPE_MINUTES * MINUTE).toISOString();
    await db.from("call_settings").update({ enabled_since: since }).eq("id", 1);
    const backdated = new Date(Date.now() - 31 * MINUTE).toISOString();
    await db.from("parents").update({ created_at: backdated }).in("user_id", [quickId, advancedId]);
    const cronStart = new Date().toISOString();
    const statuses: number[] = [];
    for (let n = 0; n < 6; n += 1) {
      const res = await request.get(`${BASE_URL}/api/cron/call-reminders`, { headers: { authorization: `Bearer ${CRON_SECRET}` } });
      statuses.push(res.status());
    }
    expect(statuses).toEqual([200, 200, 200, 200, 200, 200]);
    const count = async (id: string) =>
      (await db.from("email_logs").select("id", { count: "exact", head: true }).eq("recipient_user_id", id).eq("email_type", "call_not_booked")).count;
    expect(await count(quickId)).toBe(1);
    expect(await count(advancedId)).toBe(0);
    // Across the stack: other local parents in the scope window may get one too (they never booked either), but never
    // a parent who ever booked (R2). Asserted on the recipients, not a stack-wide count.
    const { data: sent } = await db.from("email_logs").select("recipient_user_id").eq("email_type", "call_not_booked").gte("created_at", cronStart);
    const recipients = [...new Set(((sent ?? []) as Array<{ recipient_user_id: string }>).map((r) => r.recipient_user_id))];
    const { count: everBooked } = await db.from("call_bookings").select("id", { count: "exact", head: true }).in("parent_user_id", recipients).not("booked_at", "is", null);
    expect(recipients).toContain(quickId);
    expect(everBooked).toBe(0);
    const walkWide = recipients.length;
    const unauthorised = await request.get(`${BASE_URL}/api/cron/call-reminders`, { headers: { authorization: "Bearer wrong" } });
    expect(unauthorised.status()).toBe(401);
    readback.cron = { statuses, notBookedForNeverBooked: 1, notBookedForBookedThenCancelled: 0, notBookedRecipientsAcrossTheStack: walkWide, recipientsWhoEverBooked: everBooked, wrongBearer: unauthorised.status() };
  });

  test("plan §8 row 7: the 24 h parent reminder and the 15 min admin reminder, each once (clock advanced on the fixture)", async ({ request }) => {
    const cron = async () => (await request.get(`${BASE_URL}/api/cron/call-reminders`, { headers: { authorization: `Bearer ${CRON_SECRET}` } })).status();
    await page.goto(`${BASE_URL}/matchmaking/call`, { timeout: 180_000 });
    // The third day tile is at least a day and a half ahead: a time there is ≥ 25 h away.
    const startsAt = await pickSlot(page, { day: 2 });
    expect(Date.parse(startsAt)).toBeGreaterThanOrEqual(Date.now() + 25 * 60 * MINUTE);
    await page.getByRole("button", { name: "Confirm time" }).click();
    await expect(page.getByRole("heading", { name: "You're booked" })).toBeVisible();
    const { data } = await db.from("call_bookings").select("id, starts_at, ends_at, booked_at").eq("parent_user_id", advancedId).eq("status", "booked").single();
    const original = data as { id: string; starts_at: string; ends_at: string; booked_at: string };
    const since = new Date().toISOString();
    const sent = async (type: string) =>
      (await db.from("email_logs").select("id", { count: "exact", head: true }).eq("email_type", type).gte("created_at", since)).count ?? 0;
    const counts = async () => ({ call_reminder: await sent("call_reminder"), admin_call_reminder: await sent("admin_call_reminder") });
    /** Advance the clock: shift the fixture's start, end and booked_at back together, so the start is `fromNow` away. */
    const startIn = async (fromNow: number) => {
      const delta = Date.parse(original.starts_at) - (Date.now() + fromNow);
      const back = (at: string) => new Date(Date.parse(at) - delta).toISOString();
      await db.from("call_bookings").update({ starts_at: back(original.starts_at), ends_at: back(original.ends_at), booked_at: back(original.booked_at) }).eq("id", original.id);
      return { starts_at: back(original.starts_at), booked_at: back(original.booked_at) };
    };
    const steps: Array<Record<string, unknown>> = [];
    steps.push({ step: "booked, start ≥ 25 h ahead", startsAt: original.starts_at, bookedAt: original.booked_at, cron: await cron(), ...(await counts()) });
    steps.push({ step: "clock advanced: start in 23 h", ...(await startIn(23 * 60 * MINUTE)), cron: await cron(), ...(await counts()) });
    steps.push({ step: "re-run", cron: await cron(), ...(await counts()) });
    steps.push({ step: "clock advanced: start in 10 min", ...(await startIn(10 * MINUTE)), cron: await cron(), ...(await counts()) });
    steps.push({ step: "re-run", cron: await cron(), ...(await counts()) });
    const { data: stamps } = await db.from("call_bookings").select("id, status, starts_at, booked_at, parent_reminder_sent_at, admin_reminder_sent_at").eq("id", original.id).single();
    const { data: rows } = await db.from("email_logs").select("email_type, subject, status, provider_message_id, created_at").in("email_type", ["call_reminder", "admin_call_reminder"]).gte("created_at", since).order("created_at", { ascending: true });
    expect(steps.map((st) => [st.call_reminder, st.admin_call_reminder])).toEqual([[0, 0], [1, 0], [1, 0], [1, 1], [1, 1]]);
    expect(steps.every((st) => st.cron === 200)).toBe(true);
    expect((stamps as { parent_reminder_sent_at: string | null }).parent_reminder_sent_at).not.toBeNull();
    expect((stamps as { admin_reminder_sent_at: string | null }).admin_reminder_sent_at).not.toBeNull();
    mkdirSync(PROOF_DIR, { recursive: true });
    writeFileSync(join(PROOF_DIR, "walk-row7-readback.json"), `${JSON.stringify({ run: RUN, bookingId: original.id, steps, stamps, emailLogs: rows }, null, 2)}\n`);
    // Tidy: cancel the fixture booking (its start is still ahead).
    await page.goto(`${BASE_URL}/matchmaking/call`, { timeout: 180_000 });
    await page.getByRole("button", { name: "Cancel" }).click();
    await page.getByRole("button", { name: "Yes, cancel it" }).click();
    await expect(page.getByRole("button", { name: "Confirm time" })).toBeVisible();
  });

  test("the subtitles: /matchmaking/signup and the quick match name the call; a cold /signup keeps today's (W7, W11)", async ({ browser }) => {
    const fresh = await sydneyPage(browser);
    const callLine = "Next: your Complimentary matchmaker call, to introduce you to your top nannies.";
    await fresh.goto(`${BASE_URL}/matchmaking/signup?lead=${LEAD_ID}`, { timeout: 180_000 });
    await expect(fresh.getByText(callLine)).toBeVisible();
    await fresh.screenshot({ path: join(PROOF_DIR, "signup-subtitle-on-1440.png") });
    await fresh.goto(`${BASE_URL}/signup?src=std`, { timeout: 180_000 });
    await expect(fresh.getByText(callLine)).toBeVisible();
    await fresh.goto(`${BASE_URL}/signup`, { timeout: 180_000 });
    await expect(fresh.getByText("Sign up to find the best childcare for your family")).toBeVisible();
    await fresh.context().close();
  });
});

test.describe.serial("call booking — flag off (local stack)", () => {
  test.skip(MODE !== "off" || !IS_LOCAL, "set CALL_BOOKING_E2E=off with the local stack's env");
  test.setTimeout(240_000);

  test("signed out: /matchmaking/call → 404 before any read; the cron → 404 even with the bearer", async ({ request }) => {
    const signedOut = await request.get(`${BASE_URL}/matchmaking/call`, { maxRedirects: 0 });
    expect(signedOut.status()).toBe(404);
    const cron = await request.get(`${BASE_URL}/api/cron/call-reminders`, { headers: { authorization: `Bearer ${CRON_SECRET}` } });
    expect(cron.status()).toBe(404);
    mkdirSync(PROOF_DIR, { recursive: true });
    writeFileSync(join(PROOF_DIR, "flag-off-http.json"), `${JSON.stringify({ signedOutMatchmakingCall: signedOut.status(), cron: cron.status() }, null, 2)}\n`);
  });

  test("today's sign-up: lands on /parent, no card, ?call=open ignored; /matchmaking/call is a 404 for a parent", async ({ browser }) => {
    const page = await sydneyPage(browser);
    await page.goto(`${BASE_URL}/signup?src=std`, { timeout: 180_000 });
    await expect(page.getByText("Sign up to find the best childcare for your family")).toBeVisible({ timeout: 120_000 });
    await page.screenshot({ path: join(PROOF_DIR, "signup-subtitle-off-1440.png") });
    await signUp(page, "/signup?src=std", OFF_EMAIL);
    await page.waitForURL(`${BASE_URL}/parent`, { timeout: 180_000 });
    await page.goto(`${BASE_URL}${CHILDCARE}&call=open`, { timeout: 180_000 });
    await expect(page.getByRole("button", { name: "My childcare" })).toBeVisible({ timeout: 120_000 });
    await expect(page.getByRole("heading", { name: "Your Complimentary matchmaker call" })).toHaveCount(0);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.screenshot({ path: join(PROOF_DIR, "hub-flag-off-1440.png"), fullPage: true });
    const response = await page.goto(`${BASE_URL}/matchmaking/call`, { timeout: 180_000 });
    expect(response?.status()).toBe(404);
    await shoot(page, "flag-off-404");
  });
});

// ── 04c-1: the staff Calls tab (plan C7; brief §9.1, §9.8–9.11; BB-wave1-041126/04c1-build) ───────────────────────
//
// Fixture families in every section and with every tag (`fixtures/call-admin.ts`, local stack only), read by an admin
// in an Australia/Sydney browser: every time on /admin/calls must still be London's, and say so (brief §3 admin 1).
// Run just these with `--grep "Calls tab"`; screenshots go to B04C1_PROOF_DIR.

const C1_PROOF_DIR = process.env.B04C1_PROOF_DIR ?? "test-results/b04c1";
/** The fixture admin's password is typed into this app: only ever a local one (security review L3). */
const APP_IS_LOCAL = /^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(BASE_URL);
/** The walk books, moves and cancels on families' behalf: only with every email a dry run (review round 2 L12). */
const DRY_RUN = process.env.EMAIL_DEV_DRY_RUN === "true";

const LONDON_SHORT = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

/** "Thu 5 Nov, 14:00 (London time)" — what every admin time must read, whatever the browser's zone. */
function londonLabelOf(iso: string): string {
  const parts = LONDON_SHORT.formatToParts(new Date(iso));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
  return `${part("weekday")} ${part("day")} ${part("month")}, ${part("hour")}:${part("minute")} (London time)`;
}

/** The elements wider than the window (a page that scrolls sideways), or none. */
async function sideScroll(page: Page): Promise<readonly string[]> {
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
async function settled(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    await Promise.all(document.getAnimations().map((a) => a.finished.catch(() => null)));
  });
}

/**
 * Screenshots at 320 / 768 / 1024 / 1440, each checked for no sideways scroll; the cookie bar dismissed first. The
 * drawer is fixed and scrolls inside itself, so drawer shots are the window (taller), not the page behind it.
 */
async function shootTo(page: Page, dir: string, name: string, { drawer = false }: { readonly drawer?: boolean } = {}): Promise<void> {
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

async function signInSydney(browser: Browser, email: string, password: string, to: string): Promise<Page> {
  const signedIn = await sydneyPage(browser);
  await signedIn.goto(`${BASE_URL}/login?redirect=${encodeURIComponent(to)}`, { timeout: 180_000, waitUntil: "networkidle" });
  await signedIn.fill('input[name="email"]', email);
  await signedIn.fill('input[name="password"]', password);
  await signedIn.click('button[type="submit"]');
  await signedIn.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 180_000 });
  return signedIn;
}

const section = (page: Page, name: string) => page.getByRole("table", { name });
const familyRow = (page: Page, table: string, name: string) => section(page, table).locator("tr", { hasText: name });

test("Calls tab — the fixture refuses any client not made by localDb (review round 2 L12)", async () => {
  test.skip(MODE !== "on" && MODE !== "off", "set CALL_BOOKING_E2E");
  const remote = createClient("https://example.supabase.co", "x", { auth: { persistSession: false } });
  await expect(createCallsFixture(remote, RUN)).rejects.toThrow(/local stack only/);
  await expect(removeCallsFixture(remote)).rejects.toThrow(/local stack only/);
});

test.describe.serial("Calls tab — flag on (local stack)", () => {
  test.skip(MODE !== "on" || !IS_LOCAL || !APP_IS_LOCAL || !DRY_RUN, "set CALL_BOOKING_E2E=on with the local stack's env, a local app and EMAIL_DEV_DRY_RUN=true");
  test.setTimeout(240_000);

  let db: SupabaseClient;
  let page: Page;
  let fx: CallsFixture;
  const readback: Record<string, unknown> = { run: RUN };

  const openDrawer = async (name: string): Promise<Locator> => {
    await page.goto(`${BASE_URL}/admin/calls`, { timeout: 180_000 });
    await page.getByRole("button", { name, exact: true }).first().click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { level: 2, name, exact: true })).toBeVisible({ timeout: 120_000 });
    return dialog;
  };

  test.beforeAll(async ({ browser }) => {
    db = localDb(SUPABASE_URL, SERVICE_KEY);
    fx = await createCallsFixture(db, RUN);
    readback.enabledSince = fx.enabledSince;
    page = await signInSydney(browser, fx.adminEmail, fx.password, "/admin/calls");
  });

  test.afterAll(async () => {
    // Even when the set-up failed part-way (enabled_since is only changed once it is complete).
    if (db) await removeCallsFixture(db, fx?.enabledSinceBefore);
    mkdirSync(C1_PROOF_DIR, { recursive: true });
    writeFileSync(join(C1_PROOF_DIR, "walk-readback.json"), `${JSON.stringify(readback, null, 2)}\n`);
  });

  test("Calls sits after Contacts; every section and tag; every time London in a Sydney browser", async () => {
    await page.goto(`${BASE_URL}/admin/calls`, { timeout: 180_000 });
    expect(await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone)).toBe("Australia/Sydney");
    const nav = await page.locator("aside a").evaluateAll((links) => links.map((a) => a.getAttribute("href")));
    expect(nav.indexOf("/admin/calls")).toBe(nav.indexOf("/admin/leads") + 1);
    await expect(page.getByRole("heading", { level: 1, name: "Calls" })).toBeVisible();
    await expect(page.getByText(/^Calls still to make this week: \d+ \(\d+ booked · \d+ not booked\)$/)).toBeVisible();
    const f = fx.families;
    await expect(familyRow(page, "Overdue", f.priya.name)).toContainText(londonLabelOf(f.priya.startsAt!));
    await expect(familyRow(page, "Overdue", f.priya.name)).toContainText("Overdue");
    await expect(familyRow(page, "Today and upcoming", f.olivia.name)).toContainText(londonLabelOf(f.olivia.startsAt!));
    await expect(familyRow(page, "Today and upcoming", f.olivia.name)).toContainText("5 nannies contacted · 2 replied");
    await expect(familyRow(page, "Today and upcoming", f.tom.name)).toContainText("Blocked over — move or cancel");
    await expect(familyRow(page, "Today and upcoming", f.ada.name)).toContainText("Cohort pre-book");
    await expect(familyRow(page, "Not booked — to call", f.fay.name)).toContainText("No position yet");
    await expect(familyRow(page, "Not booked — to call", f.fay.name)).toContainText("Quick match");
    await expect(familyRow(page, "Not booked — to call", f.leo.name)).toContainText("Test");
    await expect(familyRow(page, "Not booked — to call", f.grace.name)).toContainText(/Call back \w{3} \d{1,2} \w{3}, 17:00 \(London time\)/);
    await expect(familyRow(page, "History", f.noah.name)).toContainText("Answered · Deposit taken");
    await expect(familyRow(page, "History", f.mia.name)).toContainText("Stop calling");
    // The families taken out are in History only; the to-call order is oldest sign-up first.
    await expect(familyRow(page, "Not booked — to call", f.noah.name)).toHaveCount(0);
    // Sign-ups: Sarah, Grace, Fay, Leo — but Grace asked to be called back tomorrow, so she is due last.
    const order = await section(page, "Not booked — to call").locator("tbody tr button").allTextContents();
    const ours = new Set([f.sarah.name, f.grace.name, f.fay.name, f.leo.name]);
    expect(order.filter((n) => ours.has(n))).toEqual([f.sarah.name, f.fay.name, f.leo.name, f.grace.name]);
    readback.counts = await page.getByText(/^Calls still to make this week:/).textContent();
    readback.overdue = { name: f.priya.name, label: londonLabelOf(f.priya.startsAt!), browserZone: "Australia/Sydney" };
    await shootTo(page, C1_PROOF_DIR, "calls-tab");
  });

  test("the four links; Position opens her row expanded on /admin/positions", async () => {
    await page.goto(`${BASE_URL}/admin/calls`, { timeout: 180_000 });
    const olivia = fx.families.olivia;
    const row = familyRow(page, "Today and upcoming", olivia.name);
    await expect(row.getByRole("link", { name: "Profile" })).toHaveAttribute("href", `/admin/viewer/${olivia.id}`);
    await expect(row.getByRole("link", { name: "Account" })).toHaveAttribute("href", `/admin/users?openUser=${olivia.id}`);
    await expect(row.getByRole("link", { name: "Money" })).toHaveAttribute("href", `/admin/users/${olivia.id}/subscription`);
    await row.getByRole("link", { name: "Position" }).click();
    await page.waitForURL(`${BASE_URL}/admin/positions?openPosition=${olivia.positionId}`, { timeout: 180_000 });
    await expect(page.locator(`a[href="/position/${olivia.positionId}"]`)).toBeVisible({ timeout: 120_000 });
    await expect(page.locator(`#position-row-${olivia.positionId}`)).toBeInViewport();
    await shootTo(page, C1_PROOF_DIR, "positions-open");
  });

  test("the drawer: contact, her booked call, the outcome form, position and nannies, the deposit, every attempt", async () => {
    const dialog = await openDrawer(fx.families.olivia.name);
    expect(new URL(page.url()).searchParams.get("openCall")).toBe(fx.families.olivia.id);
    await expect(dialog.getByText("Every time on this page is London time.")).toBeVisible();
    await expect(dialog.getByText(londonLabelOf(fx.families.olivia.startsAt!))).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Move" })).toBeVisible();
    await expect(dialog.getByRole("region", { name: "Deposit (read-only)" })).toContainText(/^Deposit \(read-only\)Deposit paid \d{1,2} \w+ \d{4}$/);
    await expect(dialog.getByText("5 nannies contacted · 2 replied")).toBeVisible();
    await expect(dialog.getByRole("region", { name: "Record outcome" })).toBeVisible();
    await shootTo(page, C1_PROOF_DIR, "drawer-booked", { drawer: true });
  });

  test("on behalf: book Sarah a time — Held for N minutes, Book this time; booked by the admin; her confirmation email", async () => {
    const sarah = fx.families.sarah;
    const dialog = await openDrawer(sarah.name);
    await dialog.getByRole("button", { name: "Book a matchmaker call" }).click();
    await expect(dialog.getByRole("heading", { name: "Matchmaker's availability (London time)" })).toBeVisible();
    const startsAt = await pickSlot(dialog);
    await expect(dialog.getByText(/^Held for \d+ minutes?$/)).toBeVisible();
    await shootTo(page, C1_PROOF_DIR, "drawer-on-behalf-held", { drawer: true });
    await dialog.getByRole("button", { name: "Book this time" }).click();
    await expect(dialog.getByText("Booked — the family is emailed.")).toBeVisible({ timeout: 60_000 });
    const { data } = await db.from("call_bookings").select("id, status, starts_at, booked_by_kind").eq("parent_user_id", sarah.id).eq("status", "booked").single();
    expect(data).toMatchObject({ status: "booked", booked_by_kind: "admin" });
    expect(new Date((data as { starts_at: string }).starts_at).toISOString()).toBe(startsAt);
    const { data: mail } = await db.from("email_logs").select("email_type").eq("recipient_email", sarah.email);
    expect((mail ?? []).map((m: { email_type: string }) => m.email_type)).toContain("call_booking_confirmation");
    readback.bookedOnBehalf = data;
  });

  test("on behalf: move Olivia's call — Move to this time; the same booking moved; her change email", async () => {
    const olivia = fx.families.olivia;
    const dialog = await openDrawer(olivia.name);
    await dialog.getByRole("button", { name: "Move" }).click();
    await pickSlot(dialog, { last: true });
    await dialog.getByRole("button", { name: "Move to this time" }).click();
    await expect(dialog.getByText("Moved — the family is emailed.")).toBeVisible({ timeout: 60_000 });
    const { data } = await db.from("call_bookings").select("id, status, moved_at, moved_from_starts_at").eq("parent_user_id", olivia.id).eq("status", "booked").single();
    expect((data as { id: string }).id).toBe(olivia.bookingId);
    expect((data as { moved_at: string | null }).moved_at).not.toBeNull();
    const { data: mail } = await db.from("email_logs").select("email_type").eq("recipient_email", olivia.email);
    expect((mail ?? []).map((m: { email_type: string }) => m.email_type)).toContain("call_booking_changed");
    readback.movedOnBehalf = data;
  });

  test("on behalf: cancel Tom's call (it asks first) — cancelled by the admin; his cancellation email; back under Not booked", async () => {
    const tom = fx.families.tom;
    const dialog = await openDrawer(tom.name);
    await dialog.getByRole("button", { name: "Cancel booking" }).click();
    await dialog.getByRole("button", { name: "Yes, cancel it" }).click();
    await expect(dialog.getByText("Cancelled — the family is back under Not booked.")).toBeVisible({ timeout: 60_000 });
    const { data } = await db.from("call_bookings").select("status, cancel_reason").eq("id", tom.bookingId!).single();
    expect(data).toEqual({ status: "cancelled", cancel_reason: "admin" });
    const { data: mail } = await db.from("email_logs").select("email_type").eq("recipient_email", tom.email);
    expect((mail ?? []).map((m: { email_type: string }) => m.email_type)).toContain("call_booking_cancelled");
    await page.goto(`${BASE_URL}/admin/calls`, { timeout: 180_000 });
    await expect(familyRow(page, "Not booked — to call", tom.name)).toHaveCount(1);
    readback.cancelledOnBehalf = data;
  });

  test("Stop calling while booked is refused: 'Cancel the booked time first'", async () => {
    const dialog = await openDrawer(fx.families.ada.name);
    await dialog.getByRole("button", { name: "Stop calling" }).click();
    await dialog.getByRole("button", { name: "Save outcome" }).click();
    await expect(dialog.getByRole("alert")).toHaveText("Cancel the booked time first");
  });

  test("No answer on Priya's overdue call: closed, she is under Not booked and in History; her page says we tried", async ({ browser }) => {
    const priya = fx.families.priya;
    const dialog = await openDrawer(priya.name);
    await dialog.getByRole("button", { name: "No answer", exact: true }).click();
    await dialog.getByLabel("Note (optional)").fill("Rang twice, no answer.");
    await dialog.getByRole("button", { name: "Save outcome" }).click();
    await expect(dialog.getByText("Saved.")).toBeVisible({ timeout: 60_000 });
    const { data } = await db.from("call_bookings").select("status, closed_at").eq("id", priya.bookingId!).single();
    expect((data as { status: string }).status).toBe("no_answer");
    await expect(dialog.getByRole("region", { name: "Every attempt" })).toContainText("Rang twice, no answer.", { timeout: 60_000 });
    await shootTo(page, C1_PROOF_DIR, "drawer-after-no-answer", { drawer: true });
    await page.goto(`${BASE_URL}/admin/calls`, { timeout: 180_000 });
    await expect(familyRow(page, "Not booked — to call", priya.name)).toHaveCount(1);
    await expect(familyRow(page, "History", priya.name)).toContainText("No answer");
    await expect(familyRow(page, "Overdue", priya.name)).toHaveCount(0);
    await shootTo(page, C1_PROOF_DIR, "calls-tab-after");
    const hers = await signInSydney(browser, priya.email, fx.password, "/matchmaking/call");
    await expect(hers.getByText("We tried to call you — pick another time")).toBeVisible({ timeout: 120_000 });
    await dismissCookies(hers);
    await settled(hers);
    await hers.screenshot({ path: join(C1_PROOF_DIR, "parent-after-no-answer-1440.png"), fullPage: true });
    await hers.context().close();
    readback.noAnswer = data;
  });
});

test.describe.serial("Calls tab — flag off (local stack)", () => {
  test.skip(MODE !== "off" || !IS_LOCAL || !APP_IS_LOCAL || !DRY_RUN, "set CALL_BOOKING_E2E=off with the local stack's env, a local app and EMAIL_DEV_DRY_RUN=true");
  test.setTimeout(240_000);

  let db: SupabaseClient;
  let fx: CallsFixture;

  test.beforeAll(async () => {
    db = localDb(SUPABASE_URL, SERVICE_KEY);
    fx = await createCallsFixture(db, RUN);
  });
  test.afterAll(async () => {
    if (db) await removeCallsFixture(db, fx?.enabledSinceBefore);
  });

  test("signed out: /admin/calls → the login redirect (middleware), as every /admin path", async ({ request }) => {
    const res = await request.get(`${BASE_URL}/admin/calls`, { maxRedirects: 0 });
    expect(res.status()).toBe(307);
    expect(res.headers().location).toContain("/login");
  });

  test("an admin: /admin/calls is a 404, no Calls entry, ?openPosition ignored", async ({ browser }) => {
    const page = await signInSydney(browser, fx.adminEmail, fx.password, "/admin/dashboard");
    const nav = await page.locator("aside a").evaluateAll((links) => links.map((a) => a.getAttribute("href")));
    expect(nav).toContain("/admin/leads");
    expect(nav).not.toContain("/admin/calls");
    await shootTo(page, C1_PROOF_DIR, "flag-off-nav");
    const res = await page.goto(`${BASE_URL}/admin/calls`, { timeout: 180_000 });
    expect(res?.status()).toBe(404);
    await shootTo(page, C1_PROOF_DIR, "flag-off-404");
    const olivia = fx.families.olivia;
    await page.goto(`${BASE_URL}/admin/positions?openPosition=${olivia.positionId}`, { timeout: 180_000 });
    await expect(page.getByText("Olivia Hartley Family").or(page.getByText("Olivia Hartley")).first()).toBeVisible({ timeout: 120_000 });
    await expect(page.locator(`a[href="/position/${olivia.positionId}"]`)).toHaveCount(0);
    await shootTo(page, C1_PROOF_DIR, "flag-off-positions");
    mkdirSync(C1_PROOF_DIR, { recursive: true });
    writeFileSync(join(C1_PROOF_DIR, "flag-off-readback.json"), `${JSON.stringify({ run: RUN, adminCalls: res?.status(), navHasCalls: nav.includes("/admin/calls"), openPositionExpanded: false }, null, 2)}\n`);
    await page.context().close();
  });
});
