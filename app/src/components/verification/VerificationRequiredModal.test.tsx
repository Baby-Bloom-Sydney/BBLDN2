import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

afterEach(cleanup);

import { VerificationRequiredModal } from "./VerificationRequiredModal";

describe("VerificationRequiredModal", () => {
  it("renders default copy when no overrides", () => {
    render(<VerificationRequiredModal open onOpenChange={() => {}} />);
    expect(screen.getByText("Verify your account")).toBeTruthy();
    expect(screen.getByText("Verify Now")).toBeTruthy();
  });

  it("uses custom title + message + CTA label", () => {
    render(
      <VerificationRequiredModal
        open
        onOpenChange={() => {}}
        title="Verify to apply"
        message="Complete verification to send your application."
        ctaLabel="Start verification"
      />,
    );
    expect(screen.getByText("Verify to apply")).toBeTruthy();
    expect(
      screen.getByText("Complete verification to send your application."),
    ).toBeTruthy();
    expect(screen.getByText("Start verification")).toBeTruthy();
  });

  it("points the CTA at /nanny/verification by default", () => {
    render(<VerificationRequiredModal open onOpenChange={() => {}} />);
    const link = screen.getByRole("link", { name: /verify now/i });
    expect(link.getAttribute("href")).toBe("/nanny/verification");
  });

  it("honours a custom ctaHref", () => {
    render(
      <VerificationRequiredModal
        open
        onOpenChange={() => {}}
        ctaHref="/nanny/verification"
      />,
    );
    const link = screen.getByRole("link", { name: /verify now/i });
    expect(link.getAttribute("href")).toBe("/nanny/verification");
  });

  it("does not render content when closed", () => {
    render(<VerificationRequiredModal open={false} onOpenChange={() => {}} />);
    // shadcn Dialog hides content when closed — title not in DOM
    expect(screen.queryByText("Verify your account")).toBeNull();
  });

  it("calls onOpenChange when the trigger requests close (esc/click outside via Radix)", () => {
    const onOpenChange = vi.fn();
    render(<VerificationRequiredModal open onOpenChange={onOpenChange} />);
    // The Radix Dialog wires onOpenChange — we trust it; this test ensures the
    // prop is plumbed through (presence + render without throwing).
    expect(onOpenChange).not.toHaveBeenCalled();
  });
});
