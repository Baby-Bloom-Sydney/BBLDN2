/**
 * robots.txt (plan 03 row C2; brief 03 §4 row "Public route"): the parent's deposit page is never crawled. `/deposit`
 * is added to the disallow list; every existing entry stays as it was, in the same order, and the GPTBot rule and
 * the sitemap line are unchanged.
 *
 * BB-wave2-231126/03-build, 2026-11-25.
 */
import { describe, expect, it } from "vitest";
import { SITE_URL } from "@/lib/constants";
import robots from "./robots";

const BEFORE_03C = [
  "/api/",
  "/nanny/",
  "/parent/",
  "/admin/",
  "/login",
  "/signup",
  "/forgot-password",
  "/reset-password",
  "/test",
  "/ui",
  "/ui2",
  "/brandkit1",
  "/bb/test",
  "/nanny/profiletest",
];

const rules = () => {
  const r = robots().rules;
  return Array.isArray(r) ? r : [r];
};

describe("robots", () => {
  it("disallows /deposit for every crawler", () => {
    const all = rules().find((r) => r.userAgent === "*");
    expect(all?.disallow).toContain("/deposit");
  });

  it("keeps every existing entry, in order, with /deposit added after them", () => {
    const all = rules().find((r) => r.userAgent === "*");
    expect(all).toEqual({ userAgent: "*", allow: "/", disallow: [...BEFORE_03C, "/deposit"] });
  });

  it("leaves the GPTBot rule and the sitemap as they were", () => {
    expect(rules()).toContainEqual({ userAgent: "GPTBot", disallow: "/" });
    expect(rules()).toHaveLength(2);
    expect(robots().sitemap).toBe(`${SITE_URL}/sitemap.xml`);
  });
});
