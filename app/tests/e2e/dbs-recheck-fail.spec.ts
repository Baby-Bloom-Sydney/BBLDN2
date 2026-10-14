/**
 * Unit 3i (BB-LDN-3i-141026) — E2E for the daily DBS re-check (test plan §4.2; brief "Tests first").
 *
 * One scenario per run, chosen by DBS_RECHECK_E2E_RESULT, because a failed nanny leaves level 4 (she is never re-checked
 * twice): `BLANK` (nothing on any screen changes), `NEW_INFO` (23, "You'll need a new DBS certificate"), `NO_MATCH` (26,
 * the Update Service card with its explainer and both links). Both fail cards offer Edit & Resubmit · Request manual review.
 *
 * Opt-in and local only (it writes through the cron to a real database row):
 *   PLAYWRIGHT_DBS_RECHECK_ENABLED=true
 *   PLAYWRIGHT_BASE_URL            local `next dev` (never a deployment)
 *   CRON_SECRET                    the local dev server's secret (never Vercel's)
 *   FAKE_DBS_URL                   the fake Update Service root, e.g. http://127.0.0.1:5123 (never the live DBS URL)
 *   DBS_RECHECK_E2E_CERT           the synthetic nanny's 12-digit certificate number
 *   DBS_RECHECK_E2E_EMAIL / _PASSWORD   the synthetic level-4 nanny (fixture)
 *   DBS_RECHECK_E2E_RESULT         BLANK | NEW_INFO | NO_MATCH
 * Never: runs against the live DBS service or a deployment; asserts nothing about a parent (P-9: they are told nothing).
 */
import { test, expect, type Page } from "@playwright/test";
import { signInAs } from "./fixtures/sign-in";

const enabled = process.env.PLAYWRIGHT_DBS_RECHECK_ENABLED === "true";
const result = process.env.DBS_RECHECK_E2E_RESULT ?? "NEW_INFO";
const fakeUrl = process.env.FAKE_DBS_URL ?? "";
const cert = process.env.DBS_RECHECK_E2E_CERT ?? "";
const nanny = {
  userId: "",
  email: process.env.DBS_RECHECK_E2E_EMAIL ?? "",
  password: process.env.DBS_RECHECK_E2E_PASSWORD ?? "",
  role: "nanny" as const,
};

test.describe("daily DBS re-check (3i, test plan §4.2)", () => {
  test.skip(!enabled, "opt-in: PLAYWRIGHT_DBS_RECHECK_ENABLED=true (writes through the cron to a real row)");
  test.skip(!/^http:\/\/(127\.0\.0\.1|localhost)/.test(fakeUrl), "FAKE_DBS_URL must be the local fake");

  async function verificationCard(page: Page) {
    await page.goto("/nanny/verification", { waitUntil: "networkidle" });
    return page.getByRole("main").last(); // the page content (the portal shell has its own outer <main>)
  }

  test(`a ${result} re-check shows the right state to her`, async ({ browser, request, baseURL }) => {
    const base = baseURL ?? "http://localhost:3000";
    const ctx = await signInAs(browser, nanny, base);
    const page = await ctx.newPage();
    const before = await (await verificationCard(page)).innerText();

    const put = await request.put(`${fakeUrl}/__override/${cert}?status=${result}`);
    expect(put.status()).toBe(204);

    const res = await request.get(`${base}/api/cron/dbs-recheck`, { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.checked).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(body)).not.toMatch(/@|\d{12}/); // counts only — no names or numbers

    const main = await verificationCard(page);
    if (result === "BLANK") {
      expect(body.passed).toBeGreaterThanOrEqual(1);
      expect(await main.innerText()).toBe(before);
    } else if (result === "NEW_INFO") {
      expect(body.failed_new_info).toBeGreaterThanOrEqual(1);
      await expect(main.getByText("You'll need a new DBS certificate").first()).toBeVisible();
      await expect(main.getByRole("button", { name: /Edit & Resubmit/i })).toBeVisible();
      await expect(main.getByRole("button", { name: /Request manual review/i })).toBeVisible();
    } else {
      expect(body.failed_no_match).toBeGreaterThanOrEqual(1);
      await expect(main.getByText("What is the Update Service?", { exact: false }).first()).toBeVisible();
      await expect(main.getByRole("link", { name: "Join the Update Service" })).toBeVisible();
      await expect(main.getByRole("link", { name: "Get an enhanced DBS" })).toBeVisible();
      await expect(main.getByRole("button", { name: /Edit & Resubmit/i })).toBeVisible();
      await expect(main.getByRole("button", { name: /Request manual review/i })).toBeVisible();
    }

    await request.delete(`${fakeUrl}/__override`);
    await ctx.close();
  });
});
