/**
 * The deposit page's shell and its plain notices (brief 03 §3 parent 8, §7: the `InvalidLinkPage` shape, the violet
 * card). The invalid page has ONE message for every case (malformed, unknown, cancelled, no code), so it reveals
 * nothing; it offers no login or dashboard link.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PAGE_COPY } from "@/lib/deposit/copy";
import { DepositNotice, DepositShell, DepositTryAgain, InvalidDepositLink } from "./InvalidDepositLink";

describe("InvalidDepositLink", () => {
  it("one plain message, as the page's heading, inside the page's main", () => {
    render(<InvalidDepositLink />);
    expect(screen.getByRole("main")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(PAGE_COPY.invalid);
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("DepositTryAgain", () => {
  it("the plain try-again line", () => {
    render(<DepositTryAgain />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(PAGE_COPY.tryAgain);
  });
});

describe("DepositNotice and DepositShell", () => {
  it("a heading with what follows it; the success tone marks it with a decorative tick", () => {
    render(<DepositNotice heading="Payment received." tone="success"><a href="/x">onward</a></DepositNotice>);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Payment received.");
    expect(screen.getByRole("link", { name: "onward" })).toBeInTheDocument();
    expect(document.querySelector("svg[aria-hidden='true']")).not.toBeNull();
  });

  it("the shell is one main with one card, mobile first (no fixed width)", () => {
    render(<DepositShell><p>inside</p></DepositShell>);
    const main = screen.getByRole("main");
    expect(main).toHaveTextContent("inside");
    expect(main.className).toMatch(/max-w-xl/);
    expect(main.className).toMatch(/px-4/);
    expect(main.innerHTML).not.toMatch(/w-\[\d+px\]/);
  });
});
