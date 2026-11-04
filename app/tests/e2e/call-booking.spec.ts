/**
 * Brief 04b local proof (plan B8; brief §9.1–9.5, §9.9, §9.13; §12 R4, R8, R25). NOT run in CI.
 *
 * Runs only against the LOCAL wave-1 Supabase stack (LDN2/PLAN/PROOF/local-stack, `dev-env.sh`): it refuses any
 * Supabase URL that isn't localhost, so it can never touch bb-ldn or Sydney. The local stack has no real nanny
 * applicants, which satisfies R4; `EMAIL_DEV_DRY_RUN=true` keeps every email a logged dry run.
 *
 * The browser runs in Australia/Sydney on purpose: every time on the page must still read London (brief §3 parent 6).
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
 * BB-wave1-041126/04b-build, 2026-11-04.
 */
import { expect, test, type Browser, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

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

/** What a slot's accessible name must be: the London words for its instant, whatever the browser's zone. */
function londonName(iso: string): string {
  const parts = LONDON.formatToParts(new Date(iso));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
  return `${part("weekday")} ${part("day")} ${part("month")}, ${part("hour")}:${part("minute")} (London time)`;
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

/** Pick the nth time the way a person does: the visible pill (the radio itself is visually hidden). */
async function pickSlot(page: Page, n: number): Promise<void> {
  await page.locator("label:has(time)").nth(n).click();
  await expect(page.getByRole("radio").nth(n)).toBeChecked();
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

  test("quick sign-up lands on /parent/call; the picker reads London in a Sydney browser", async () => {
    await signUp(page, "/signup?src=std", QUICK_EMAIL);
    await page.waitForURL(`${BASE_URL}/parent/call?next=%2Fparent`, { timeout: 180_000 });
    quickId = await userIdOf(db, QUICK_EMAIL);
    await expect(page.getByRole("heading", { name: "Your Complimentary matchmaker call" })).toBeVisible();
    await dismissCookies(page);
    expect(await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone)).toBe("Australia/Sydney");
    const first = page.getByRole("radio").first();
    const startsAt = await first.getAttribute("value");
    expect(await first.getAttribute("aria-label")).toBe(londonName(startsAt ?? ""));
    readback.quickLanding = page.url();
    readback.firstSlot = { startsAt, name: await first.getAttribute("aria-label"), browserZone: "Australia/Sydney" };
    await expect(page.getByRole("link", { name: "Go to my matches" })).toHaveAttribute("href", "/parent");
    await shoot(page, "picker");
  });

  test("book: choose, hold, confirm → booked", async () => {
    await pickSlot(page, 0);
    await page.getByRole("button", { name: "Choose this time" }).click();
    await expect(page.getByText(/We're holding .* \(London time\) for you until \d\d:\d\d\./)).toBeVisible();
    await shoot(page, "held");
    await page.getByRole("button", { name: "Confirm this time" }).click();
    await expect(page.getByText(/^Your Complimentary matchmaker call is on .* at \d\d:\d\d \(London time\)$/)).toBeVisible();
    const { data } = await db.from("call_bookings").select("id, status, starts_at").eq("parent_user_id", quickId).eq("status", "booked").single();
    bookingId = (data as { id: string }).id;
    readback.booked = data;
    await shoot(page, "booked");
  });

  test("the hub card shows the booked time · Change", async () => {
    await page.goto(`${BASE_URL}/parent`, { timeout: 180_000 });
    await expect(page.getByText(/Your Complimentary matchmaker call: \w{3} \d{1,2} \w{3}, \d\d:\d\d \(London time\)/)).toBeVisible({ timeout: 120_000 });
    await expect(page.getByRole("link", { name: "Change" })).toHaveAttribute("href", "/parent/call");
    await shoot(page, "hub-booked");
  });

  test("change time moves the same booking", async () => {
    await page.goto(`${BASE_URL}/parent/call`, { timeout: 180_000 });
    await page.getByRole("button", { name: "Change time" }).click();
    await pickSlot(page, 3);
    await page.getByRole("button", { name: "Choose this time" }).click();
    await page.getByRole("button", { name: "Confirm this time" }).click();
    await expect(page.getByRole("button", { name: "Change time" })).toBeVisible();
    const { data } = await db.from("call_bookings").select("id, status, starts_at, moved_at, moved_from_starts_at").eq("parent_user_id", quickId).eq("status", "booked").single();
    expect((data as { id: string }).id).toBe(bookingId);
    expect((data as { moved_at: string | null }).moved_at).not.toBeNull();
    readback.moved = data;
  });

  test("cancel → back to picking; the hub card says Pick a time", async () => {
    await page.getByRole("button", { name: "Cancel" }).click();
    await page.getByRole("button", { name: "Yes, cancel it" }).click();
    await expect(page.getByRole("button", { name: "Choose this time" })).toBeVisible();
    const { data } = await db.from("call_bookings").select("id, status, cancel_reason").eq("id", bookingId).single();
    expect(data).toMatchObject({ status: "cancelled", cancel_reason: "parent" });
    readback.cancelled = data;
    await page.goto(`${BASE_URL}/parent`, { timeout: 180_000 });
    await expect(page.getByRole("link", { name: "Pick a time for your Complimentary matchmaker call" })).toBeVisible({ timeout: 120_000 });
    await shoot(page, "hub-not-booked");
  });

  test("no free time → the no-times line", async () => {
    const block = { starts_at: new Date().toISOString(), ends_at: new Date(Date.now() + 10 * 24 * 60 * MINUTE).toISOString(), reason: `b04b walk ${RUN}` };
    await db.from("call_blocks").insert(block);
    await page.goto(`${BASE_URL}/parent/call`, { timeout: 180_000 });
    await expect(page.getByText("No times free right now — we'll still call you for your Complimentary matchmaker call.")).toBeVisible();
    await shoot(page, "no-times");
    await db.from("call_blocks").delete().eq("reason", block.reason);
  });

  test("advanced sign-up lands on /parent/call with next = today's matches target", async ({ browser }) => {
    const fresh = await sydneyPage(browser);
    await signUp(fresh, `/matchmaking/signup?lead=${LEAD_ID}`, ADVANCED_EMAIL);
    await fresh.waitForURL(`${BASE_URL}/parent/call?next=${encodeURIComponent(MATCHES)}`, { timeout: 180_000 });
    await expect(fresh.getByRole("link", { name: "Go to my matches" })).toHaveAttribute("href", MATCHES);
    advancedId = await userIdOf(db, ADVANCED_EMAIL);
    readback.advancedLanding = fresh.url();
    const { count } = await db.from("email_logs").select("id", { count: "exact", head: true }).eq("recipient_email", ADVANCED_EMAIL).eq("email_type", "welcome_adv_parent");
    readback.advancedWelcomeLogged = count; // by address: today's lead-conversion sends it without recipientUserId
    await fresh.context().close();
  });

  test("the emails: confirmation (with the caller number), admin booked, changed, cancelled — dry run", async () => {
    const { data } = await db.from("email_logs").select("email_type, subject, body_html, recipient_user_id").in("email_type", ["call_booking_confirmation", "call_booking_changed", "call_booking_cancelled", "admin_call_booked"]).order("created_at", { ascending: true });
    const rows = (data ?? []) as Array<{ email_type: string; subject: string; body_html: string; recipient_user_id: string | null }>;
    const hers = rows.filter((r) => r.recipient_user_id === quickId);
    expect(hers.map((r) => r.email_type)).toEqual(["call_booking_confirmation", "call_booking_changed", "call_booking_cancelled"]);
    expect(hers[0].body_html).toContain("+44 (0) 7700 900 999");
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
    expect(await count(advancedId)).toBe(1);
    expect(await count(quickId)).toBe(0);
    const { count: walkWide } = await db.from("email_logs").select("id", { count: "exact", head: true }).eq("email_type", "call_not_booked").gte("created_at", cronStart);
    expect(walkWide).toBe(1);
    const unauthorised = await request.get(`${BASE_URL}/api/cron/call-reminders`, { headers: { authorization: "Bearer wrong" } });
    expect(unauthorised.status()).toBe(401);
    readback.cron = { statuses, notBookedForNeverBooked: 1, notBookedForBookedThenCancelled: 0, notBookedAcrossTheStack: walkWide, wrongBearer: unauthorised.status() };
  });

  test("the sign-up subtitle names the call", async ({ browser }) => {
    const fresh = await sydneyPage(browser);
    await fresh.goto(`${BASE_URL}/signup?src=std`, { timeout: 180_000 });
    await expect(fresh.getByText("Next: your Complimentary matchmaker call, to introduce you to your top nannies.")).toBeVisible();
    await fresh.screenshot({ path: join(PROOF_DIR, "signup-subtitle-on-1440.png") });
    await fresh.context().close();
  });
});

test.describe.serial("call booking — flag off (local stack)", () => {
  test.skip(MODE !== "off" || !IS_LOCAL, "set CALL_BOOKING_E2E=off with the local stack's env");
  test.setTimeout(240_000);

  test("signed out: /parent/call → 307 to /login (R8); the cron → 404 even with the bearer", async ({ request }) => {
    const signedOut = await request.get(`${BASE_URL}/parent/call`, { maxRedirects: 0 });
    expect(signedOut.status()).toBe(307);
    expect(signedOut.headers().location).toContain("/login?redirect=%2Fparent%2Fcall");
    const cron = await request.get(`${BASE_URL}/api/cron/call-reminders`, { headers: { authorization: `Bearer ${CRON_SECRET}` } });
    expect(cron.status()).toBe(404);
    mkdirSync(PROOF_DIR, { recursive: true });
    writeFileSync(join(PROOF_DIR, "flag-off-http.json"), `${JSON.stringify({ signedOutParentCall: signedOut.status(), location: signedOut.headers().location, cron: cron.status() }, null, 2)}\n`);
  });

  test("today's sign-up: lands on /parent, no card; /parent/call is a 404 for a parent", async ({ browser }) => {
    const page = await sydneyPage(browser);
    await page.goto(`${BASE_URL}/signup?src=std`, { timeout: 180_000 });
    await expect(page.getByText("Sign up to find the best childcare for your family")).toBeVisible({ timeout: 120_000 });
    await page.screenshot({ path: join(PROOF_DIR, "signup-subtitle-off-1440.png") });
    await signUp(page, "/signup?src=std", OFF_EMAIL);
    await page.waitForURL(`${BASE_URL}/parent`, { timeout: 180_000 });
    await expect(page.getByText("Pick a time for your Complimentary matchmaker call")).toHaveCount(0);
    await page.screenshot({ path: join(PROOF_DIR, "hub-flag-off-1440.png"), fullPage: true });
    const response = await page.goto(`${BASE_URL}/parent/call`, { timeout: 180_000 });
    expect(response?.status()).toBe(404);
    await shoot(page, "flag-off-404");
  });
});
