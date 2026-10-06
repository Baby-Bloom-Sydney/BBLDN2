/**
 * Unit 3b (BB-LDN-3b-061026) — GuidanceCard gains an optional explainer + up to two links (ruling #22, brief change 8).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { GuidanceCard } from "./GuidanceCard";
import type { UserGuidance } from "@/lib/verification";

afterEach(cleanup);

const g: UserGuidance = { title: "Card title", explanation: "Card text", steps_to_fix: ["Step one", "Step two"] };

describe("GuidanceCard", () => {
  it("renders at most two links when given three, as external links", () => {
    render(
      <GuidanceCard
        guidance={g}
        links={[
          { label: "One", href: "https://a.example/1" },
          { label: "Two", href: "https://a.example/2" },
          { label: "Three", href: "https://a.example/3" },
        ]}
      />,
    );
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(2);
    expect(links[0]).toHaveAttribute("href", "https://a.example/1");
    expect(links[0]).toHaveAttribute("target", "_blank");
    expect(links[0]).toHaveAttribute("rel", "noopener noreferrer");
    expect(links[0]).toHaveTextContent("One →");
    expect(screen.queryByText(/Three/)).toBeNull();
  });

  it("renders the explainer heading and body when given an explainer", () => {
    render(<GuidanceCard guidance={g} explainer={{ heading: "What is it?", body: "It is this." }} />);
    expect(screen.getByText("What is it?")).toBeInTheDocument();
    expect(screen.getByText("It is this.")).toBeInTheDocument();
  });

  it("renders exactly as today when given no explainer or links (identity regression)", () => {
    const primary = vi.fn();
    const secondary = vi.fn();
    const { container } = render(
      <GuidanceCard
        guidance={g}
        primaryAction={{ label: "Edit & Resubmit", onClick: primary }}
        secondaryAction={{ label: "Manual Review", onClick: secondary }}
      />,
    );
    expect(screen.queryAllByRole("link")).toHaveLength(0);
    expect(screen.getByText("Card title")).toBeInTheDocument();
    expect(screen.getByText("To fix this:")).toBeInTheDocument();
    expect(container.querySelectorAll("li")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Edit & Resubmit" }));
    fireEvent.click(screen.getByRole("button", { name: "Manual Review" }));
    expect(primary).toHaveBeenCalledTimes(1);
    expect(secondary).toHaveBeenCalledTimes(1);
  });
});
