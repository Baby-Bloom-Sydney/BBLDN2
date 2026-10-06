/**
 * Unit 3b (BB-LDN-3b-061026) — Katie tile stepper sub-text (brief change 12; copy deck §5.4).
 */
import { afterEach, describe, expect, it } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { VerificationProgress } from "./VerificationProgress";
import { STORED_SECTION } from "@/lib/dbs/fixtures.test-util";

afterEach(cleanup);

const steps = (dbs: string) => [
  { label: "Profile complete", status: "verified" },
  { label: "ID verified", status: "verified" },
  { label: "Enhanced DBS", status: dbs },
];

describe("VerificationProgress — DBS sub-text", () => {
  it.each([
    ["new_info", "New certificate needed"],
    ["no_match", "Not on Update Service — action needed"],
    [STORED_SECTION.NEW_INFO, "New certificate needed"],
    [STORED_SECTION.NO_MATCH, "Not on Update Service — action needed"],
    ["review", "Pending manual review"],
    ["failed", "Action needed"],
    ["rejected", "Action needed"],
    ["pending", "Verifying..."],
    ["processing", "Verifying..."],
  ])("shows the deck sub-text for %s", (status, text) => {
    render(<VerificationProgress steps={steps(status)} />);
    expect(screen.getByText(text)).toBeInTheDocument();
  });

  it("drops the old 'Expired — please resubmit' line", () => {
    render(<VerificationProgress steps={steps(STORED_SECTION.NEW_INFO)} />);
    expect(screen.queryByText(/please resubmit/)).toBeNull();
  });

  it("shows no action line when barred", () => {
    render(<VerificationProgress steps={steps("barred")} />);
    expect(screen.queryByText("Action needed")).toBeNull();
  });

  it("shows nothing for the deleted regulator states", () => {
    render(<VerificationProgress steps={steps("application_pending")} />);
    expect(screen.queryByText("Pending manual review")).toBeNull();
  });
});
