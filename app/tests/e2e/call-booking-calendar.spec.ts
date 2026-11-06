/**
 * Brief 04c-2 local proof (plan C5, C7; brief §9.12, §3 admin 5; BB-wave1-041126/04c2-build): the staff Calendar tab on
 * /admin/calls. NOT run in CI. LOCAL STACK ONLY — the fixtures refuse any non-localhost Supabase URL, the admin's
 * password is typed only into a local app, and every email is a dry run.
 *
 * The 04c-1 fixture families (`fixtures/call-admin.ts`), one live hold, and the walk's own block. The week starts from
 * every day 09:00–19:00 and 30-minute calls; the weekly hours, the four settings and `enabled_since` are put back after.
 * The admin reads it in an Australia/Sydney browser: every time must still be London's (brief §3 admin 1).
 *
 *   eval "$(LDN2/PLAN/PROOF/local-stack/dev-env.sh)"
 *   CALL_BOOKING_ENABLED=true npx next dev -p 3104
 *   CALL_BOOKING_E2E=on PLAYWRIGHT_BASE_URL=http://localhost:3104 B04C2_PROOF_DIR=<proof dir> \
 *     npx playwright test tests/e2e/call-booking-calendar.spec.ts --project=desktop-chrome
 *   (the flag-off check is in call-booking.spec.ts: `--grep "Calendar tab — flag off"` with the flag unset)
 */
import { expect, test, type Page } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  addHeldCall,
  BLOCK_REASON,
  CALENDAR_BLOCK_REASON,
  createCallsFixture,
  EVERY_DAY_9_TO_7,
  localDb,
  londonDate,
  londonInstant,
  readCalendarState,
  removeCallsFixture,
  restoreCalendarState,
  setWeeklyHours,
  type CalendarState,
  type CallsFixture,
} from "./fixtures/call-admin";
import {
  APP_IS_LOCAL,
  BASE_URL,
  DRY_RUN,
  IS_LOCAL,
  MODE,
  SERVICE_KEY,
  SUPABASE_URL,
  dismissCookies,
  familyRow,
  londonName,
  openIn,
  shootTo,
  signInSydney,
  step,
} from "./fixtures/call-pages";

const RUN = Date.now().toString(36);
const C2_PROOF_DIR = process.env.B04C2_PROOF_DIR ?? "test-results/b04c2";
const DAY_WORDS = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", weekday: "long", day: "numeric", month: "long", year: "numeric" });
const dayPart = (date: string, type: Intl.DateTimeFormatPartTypes) => DAY_WORDS.formatToParts(new Date(`${date}T12:00:00.000Z`)).find((p) => p.type === type)?.value ?? "";
const dayHeading = (date: string) => `${dayPart(date, "weekday")} ${dayPart(date, "day")} ${dayPart(date, "month")}`;
const cellsOn = (page: Page, date: string) => page.getByRole("region", { name: dayHeading(date) }).getByRole("listitem").allTextContents();
const londonClock = (iso: string) => londonName(iso).slice(-5);

/** Every grid time a parent's picker lists on the first open tile for that weekday ("Sat"), greyed or not; null when greyed. */
async function pickerTimes(page: Page, weekday: string): Promise<readonly string[] | null> {
  const tile = step(page, "heading").locator("button[aria-pressed]", { hasText: weekday }).first();
  if (await tile.isDisabled()) return null;
  await tile.click();
  const brackets = openIn(step(page, "time-of-day"));
  const found = new Set<string>();
  for (let i = 0; i < (await brackets.count()); i += 1) {
    await brackets.nth(i).click();
    for (const time of await step(page, "select-time").locator("time").all()) found.add((await time.getAttribute("datetime")) ?? "");
  }
  return [...found].sort();
}

test.describe.serial("Calendar tab — flag on (local stack)", () => {
  test.skip(MODE !== "on" || !IS_LOCAL || !APP_IS_LOCAL || !DRY_RUN, "set CALL_BOOKING_E2E=on with the local stack's env, a local app and EMAIL_DEV_DRY_RUN=true");
  test.setTimeout(240_000);

  let db: SupabaseClient;
  let page: Page;
  let fx: CallsFixture;
  let before: CalendarState | null = null;
  const now = new Date();
  const [tomorrow, adaDay] = [londonDate(now, 1), londonDate(now, 4)];
  const saturday = [0, 1, 2, 3, 4, 5, 6].map((d) => londonDate(now, d)).find((d) => dayPart(d, "weekday") === "Saturday") ?? tomorrow;
  const readback: Record<string, unknown> = { run: RUN, tomorrow, adaDay, saturday };
  const region = (name: string) => page.getByRole("region", { name });
  const calendar = async () => {
    await page.goto(`${BASE_URL}/admin/calls?tab=calendar`, { timeout: 180_000 });
    await expect(region("Next 7 days (London time)")).toBeVisible({ timeout: 120_000 });
  };
  const settings = async () => (await db.from("call_settings").select("slot_minutes, enabled_since").eq("id", 1).single()).data as { slot_minutes: number; enabled_since: string | null };
  const hours = async () => (await db.from("call_weekly_hours").select("weekday, start_minute, end_minute").order("weekday").order("start_minute")).data;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(240_000);
    db = localDb(SUPABASE_URL, SERVICE_KEY);
    before = await readCalendarState(db);
    await setWeeklyHours(db, EVERY_DAY_9_TO_7);
    await db.from("call_settings").update({ slot_minutes: 30, notice_minutes: 120, hold_minutes: 5 }).eq("id", 1);
    fx = await createCallsFixture(db, RUN, now);
    await addHeldCall(db, fx.families.sarah, londonInstant(tomorrow, 16, 0));
    page = await signInSydney(browser, fx.adminEmail, fx.password, "/admin/calls?tab=calendar");
  });

  test.afterAll(async () => {
    if (db) await removeCallsFixture(db, fx?.enabledSinceBefore);
    if (db && before) await restoreCalendarState(db, before);
    mkdirSync(C2_PROOF_DIR, { recursive: true });
    writeFileSync(join(C2_PROOF_DIR, "walk-readback.json"), `${JSON.stringify(readback, null, 2)}\n`);
  });

  test("?tab=calendar opens it; the grid: free, booked with the name, held, blocked, Blocked over; London in a Sydney browser", async () => {
    await calendar();
    expect(await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone)).toBe("Australia/Sydney");
    await expect(page.getByRole("tab", { name: "Calendar" })).toHaveAttribute("aria-selected", "true");
    const f = fx.families;
    const cells = await cellsOn(page, tomorrow);
    expect(cells).toContain(`12:00–12:30Booked · ${f.tom.name}Blocked over — move or cancel`);
    expect(cells).toContain(`14:00–14:30Booked · ${f.olivia.name}`);
    expect(cells).toContain("16:00–16:30Held");
    expect(cells).toContain(`11:30–12:00Blocked · ${BLOCK_REASON}`);
    expect(cells.filter((c) => c.endsWith("Free")).length).toBeGreaterThan(0);
    readback.grid = cells;
    await shootTo(page, C2_PROOF_DIR, "calendar-tab");
  });

  test("weekly hours: Saturday off → greyed for a parent; Saturday 10:00–14:00 → her picker lists Saturday 10:00 … 13:30", async ({ browser }) => {
    const sat = page.getByRole("group", { name: "Saturday" });
    const saveHours = async () => {
      await page.getByRole("button", { name: "Save weekly hours" }).click();
      await expect(region("Weekly hours (London time)").getByRole("status")).toHaveText("Saved.", { timeout: 60_000 });
    };
    await calendar();
    await sat.getByRole("button", { name: "Remove Saturday 1" }).click();
    await saveHours();
    const fay = await signInSydney(browser, fx.families.fay.email, fx.password, "/matchmaking/call");
    expect(await pickerTimes(fay, "Sat")).toBeNull();
    await sat.getByRole("button", { name: "Add hours on Saturday" }).click();
    await page.getByLabel("Saturday 1 from", { exact: true }).fill("10:00");
    await page.getByLabel("Saturday 1 to", { exact: true }).fill("14:00");
    await saveHours();
    expect((await hours())?.filter((h: { weekday: number }) => h.weekday === 6)).toEqual([{ weekday: 6, start_minute: 600, end_minute: 840 }]);
    await fay.reload({ timeout: 180_000 });
    const times = (await pickerTimes(fay, "Sat")) ?? [];
    expect(times.map(londonClock)).toEqual(["10:00", "10:30", "11:00", "11:30", "12:00", "12:30", "13:00", "13:30"]);
    expect(times.every((t) => londonName(t).startsWith("Saturday"))).toBe(true);
    await dismissCookies(fay);
    await fay.screenshot({ path: join(C2_PROOF_DIR, "parent-saturday-1440.png"), fullPage: true });
    await fay.context().close();
    readback.saturdayTimes = times;
  });

  test("call length 45 → a 45-minute grid; Ada's 30-minute pre-book keeps its time", async () => {
    await calendar();
    await page.getByLabel("Call length", { exact: true }).selectOption("45");
    await page.getByRole("button", { name: "Save settings" }).click();
    await expect(region("Call settings").getByRole("status")).toHaveText("Saved.", { timeout: 60_000 });
    expect((await settings()).slot_minutes).toBe(45);
    const ada = fx.families.ada;
    expect((await cellsOn(page, adaDay)).slice(0, 3)).toEqual(["09:00–09:45Free", `10:00–10:30Booked · ${ada.name}`, "10:30–11:15Free"]);
    const { data } = await db.from("call_bookings").select("starts_at, ends_at, status").eq("id", ada.bookingId!).single();
    expect(new Date((data as { starts_at: string }).starts_at).toISOString()).toBe(ada.startsAt);
    readback.length45 = { adaBooking: data, cells: (await cellsOn(page, adaDay)).slice(0, 4) };
    await shootTo(page, C2_PROOF_DIR, "calendar-45");
  });

  test("a length off the list (25, put in the page by hand) is refused by the server; 45 stays", async () => {
    const length = page.getByLabel("Call length", { exact: true });
    await length.evaluate((el) => el.appendChild(Object.assign(document.createElement("option"), { value: "25", text: "25 minutes" })));
    await length.selectOption("25");
    await page.getByRole("button", { name: "Save settings" }).click();
    await expect(region("Call settings").getByRole("alert")).toContainText("15, 20, 30, 45 or 60 minutes", { timeout: 60_000 });
    expect((await settings()).slot_minutes).toBe(45);
  });

  test("a block over Ada's booking: tagged Blocked over, still booked (both tabs); removed → her day's times come back", async () => {
    const ada = fx.families.ada;
    const blocks = region("Blocks (London time)");
    await calendar();
    await blocks.getByLabel("From date", { exact: true }).fill(adaDay);
    await blocks.getByLabel("From time", { exact: true }).fill("09:00");
    await blocks.getByLabel("To date", { exact: true }).fill(adaDay);
    await blocks.getByLabel("To time", { exact: true }).fill("11:15");
    await blocks.getByLabel("Reason", { exact: true }).fill(CALENDAR_BLOCK_REASON);
    await blocks.getByRole("button", { name: "Add block" }).click();
    await expect(blocks.getByRole("status")).toHaveText("Block added.", { timeout: 60_000 });
    const under = [`09:00–09:45Blocked · ${CALENDAR_BLOCK_REASON}`, `10:00–10:30Booked · ${ada.name}Blocked over — move or cancel`, `10:30–11:15Blocked · ${CALENDAR_BLOCK_REASON}`];
    await expect.poll(async () => (await cellsOn(page, adaDay)).slice(0, 3), { timeout: 60_000 }).toEqual(under);
    expect((await db.from("call_bookings").select("status").eq("id", ada.bookingId!).single()).data).toEqual({ status: "booked" });
    await shootTo(page, C2_PROOF_DIR, "calendar-block-over");
    await page.goto(`${BASE_URL}/admin/calls`, { timeout: 180_000 });
    await expect(familyRow(page, "Today and upcoming", ada.name)).toContainText("Blocked over — move or cancel", { timeout: 120_000 });
    await calendar();
    await blocks.getByRole("button", { name: new RegExp(`^Remove block: .*${CALENDAR_BLOCK_REASON}$`) }).click();
    await expect(blocks.getByRole("status")).toHaveText("Block removed.", { timeout: 60_000 });
    await expect.poll(async () => (await cellsOn(page, adaDay)).slice(0, 3), { timeout: 60_000 }).toEqual(["09:00–09:45Free", `10:00–10:30Booked · ${ada.name}`, "10:30–11:15Free"]);
    readback.block = { added: under, removedBlocks: (await db.from("call_blocks").select("id").eq("reason", CALENDAR_BLOCK_REASON)).data };
  });

  test("overlapping hours are refused ('Those hours overlap — change one range'); the hours stay as they were", async () => {
    const was = await hours();
    await calendar();
    await page.getByRole("group", { name: "Monday" }).getByRole("button", { name: "Add hours on Monday" }).click();
    await page.getByLabel("Monday 2 from", { exact: true }).fill("12:00");
    await page.getByLabel("Monday 2 to", { exact: true }).fill("15:00");
    await page.getByRole("button", { name: "Save weekly hours" }).click();
    await expect(region("Weekly hours (London time)").getByRole("alert")).toHaveText("Those hours overlap — change one range", { timeout: 60_000 });
    expect(await hours()).toEqual(was);
  });

  test("Start call booking: before it no parent is offered the call; it asks first; then enabled_since is set once and only the date shows", async ({ browser }) => {
    await db.from("call_settings").update({ enabled_since: null }).eq("id", 1);
    const fay = await signInSydney(browser, fx.families.fay.email, fx.password, "/matchmaking/call");
    await fay.waitForURL((url) => !url.pathname.startsWith("/matchmaking/call"), { timeout: 120_000 });
    readback.beforeStart = { fayLandedOn: new URL(fay.url()).pathname };
    await fay.context().close();
    await calendar();
    await expect(page.getByText("Call booking hasn't started: no parent is offered a matchmaker call yet.")).toBeVisible();
    await shootTo(page, C2_PROOF_DIR, "start-before");
    await page.getByRole("button", { name: "Start call booking" }).click();
    const dialog = page.getByRole("dialog", { name: "Start call booking?" });
    await expect(dialog).toContainText("This can't be undone.");
    await shootTo(page, C2_PROOF_DIR, "start-dialog", { drawer: true });
    await dialog.getByRole("button", { name: "Not yet" }).click();
    await expect(dialog).toBeHidden();
    expect((await settings()).enabled_since).toBeNull();
    await page.getByRole("button", { name: "Start call booking" }).click();
    await dialog.getByRole("button", { name: "Yes, start call booking" }).click();
    const started = page.getByText(/^Call booking started on \d{1,2} \w+ \d{4}\.$/);
    await expect(started).toBeVisible({ timeout: 60_000 });
    const stamp = (await settings()).enabled_since;
    expect(stamp).not.toBeNull();
    await expect(started).toHaveText(`Call booking started on ${dayPart(londonDate(new Date(stamp!)), "day")} ${dayPart(londonDate(new Date(stamp!)), "month")} ${dayPart(londonDate(new Date(stamp!)), "year")}.`);
    await page.reload({ timeout: 180_000 });
    await expect(started).toBeVisible({ timeout: 120_000 });
    await expect(page.getByRole("button", { name: "Start call booking" })).toHaveCount(0);
    expect((await settings()).enabled_since).toBe(stamp);
    readback.started = { enabledSince: stamp, shown: await started.textContent() };
    await shootTo(page, C2_PROOF_DIR, "start-after");
  });
});
