/**
 * `/deposit/*`'s layout (plan 03 row C1, D3, §10 "no referrer and noindex"). The code is in the URL, so the page
 * sends no referrer and is never indexed; the page sits under the (public) layout (LandingHeader), so the URL stays
 * `/deposit/<code>`. It adds nothing else — no script of any kind.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import DepositLayout, { metadata } from "./layout";

describe("/deposit layout", () => {
  it("no referrer, and never indexed or followed", () => {
    expect(metadata).toEqual({ referrer: "no-referrer", robots: { index: false, follow: false } });
  });

  it("renders its page and nothing else", () => {
    render(<DepositLayout><p>the page</p></DepositLayout>);
    expect(screen.getByText("the page")).toBeInTheDocument();
    expect(document.querySelectorAll("script")).toHaveLength(0);
  });

  it("loads no script (no next/script, no <script>)", () => {
    const source = readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), "layout.tsx"), "utf8");
    expect(source).not.toMatch(/next\/script|<script|<Script/);
  });
});
