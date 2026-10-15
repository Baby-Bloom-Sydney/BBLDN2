/**
 * Unit 5c (BB-LDN-5c-151026) — the one shared "Coming soon." panel for the babysitting tabs and pages. No CTA.
 */
import { afterEach, describe, expect, it } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { BabysittingComingSoon } from "./BabysittingComingSoon";

afterEach(cleanup);

describe("BabysittingComingSoon", () => {
  it('says "Coming soon." and offers no link or button', () => {
    const { container } = render(<BabysittingComingSoon />);
    expect(screen.getByText("Coming soon.")).toBeInTheDocument();
    expect(container.querySelector("a, button")).toBeNull();
    expect(screen.queryByRole("heading")).toBeNull();
  });

  it('shows the page heading "Babysitting" when asked', () => {
    render(<BabysittingComingSoon withHeading />);
    expect(screen.getByRole("heading", { level: 1, name: "Babysitting" })).toBeInTheDocument();
    expect(screen.getByText("Coming soon.")).toBeInTheDocument();
  });
});
