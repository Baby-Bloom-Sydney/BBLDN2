/**
 * FunnelSlide (brief 04 §0a.1; 04b rework W3): the call as the next slide of the matchmaking funnel, in the funnel's
 * own classes (`(public)/matchmaking/onboarding/QuestionShell.tsx`): a full progress bar at the top, a centred heading
 * and subtitle, the choices and one primary button in a `max-w-md` area at the bottom, on a white page. The fade-in
 * runs only when motion is allowed (`motion-safe:`), so `prefers-reduced-motion` shows it still.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FunnelSlide, FUNNEL_PRIMARY } from "./FunnelSlide";

const slide = () =>
  render(
    <FunnelSlide heading="Your Complimentary matchmaker call" subtitle="Pick a time and we'll call you then. All times are London time.">
      <button type="button">a choice</button>
    </FunnelSlide>,
  );

describe("FunnelSlide", () => {
  it("a white full-height page with the funnel's progress bar, full", () => {
    const { container } = slide();
    const page = container.firstElementChild as HTMLElement;
    expect(page.className).toContain("min-h-dvh");
    expect(page.className).toContain("bg-white");
    const track = screen.getByTestId("funnel-progress");
    expect(track.className).toContain("h-1");
    expect(track.className).toContain("bg-slate-100");
    expect(track.firstElementChild?.className).toContain("bg-violet-600");
    expect(track.firstElementChild?.className).toContain("w-full");
    expect(track).toHaveAttribute("aria-hidden", "true");
  });

  it("the heading and subtitle centred in the funnel's type", () => {
    slide();
    const heading = screen.getByRole("heading", { level: 1, name: "Your Complimentary matchmaker call" });
    expect(heading.className).toContain("text-xl");
    expect(heading.className).toContain("sm:text-2xl");
    expect(heading.className).toContain("font-semibold");
    expect(heading.className).toContain("text-slate-800");
    expect(heading.parentElement?.className).toContain("text-center");
    const subtitle = screen.getByText("Pick a time and we'll call you then. All times are London time.");
    expect(subtitle.className).toContain("text-sm");
    expect(subtitle.className).toContain("text-slate-500");
  });

  it("the choices sit in the bottom area, max-w-md and centred", () => {
    slide();
    const bottom = screen.getByRole("button", { name: "a choice" }).parentElement as HTMLElement;
    expect(bottom.className).toContain("max-w-md");
    expect(bottom.className).toContain("mx-auto");
  });

  it("fades in only when motion is allowed (prefers-reduced-motion shows it still)", () => {
    const { container } = slide();
    const animated = Array.from(container.querySelectorAll("[class*='animate-in']"));
    expect(animated.length).toBeGreaterThan(0);
    for (const el of animated) {
      expect(el.className).not.toMatch(/(^|\s)animate-in/);
      expect(el.className).toContain("motion-safe:animate-in");
    }
  });

  it("an optional mark above the heading (the booked tick)", () => {
    render(
      <FunnelSlide heading="You're booked" mark={<span data-testid="tick" />}>
        <p>x</p>
      </FunnelSlide>,
    );
    expect(screen.getByTestId("tick")).toBeInTheDocument();
    expect(screen.queryByText("Pick a time", { exact: false })).not.toBeInTheDocument();
  });

  it("exports the funnel's primary button classes", () => {
    expect(FUNNEL_PRIMARY).toBe("w-full h-11 bg-violet-500 hover:bg-violet-600 text-white rounded-lg font-medium text-sm");
  });
});
