/**
 * Her trading name (plan 06 §14.6 b3.3; BAI 2026-11-07: "not mandatory"; when entered it "replaces the business
 * name" on her invoices). Blank means her own name. BB-wave1-041126/06b3-build, 2026-11-07.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { TradingNameDialog } from "./TradingNameDialog";
import type { BusinessView, SaveOutcome } from "./business-view";

afterEach(cleanup);

const SOLE: BusinessView = {
  businessType: "sole_trader", name: "Sophie Taylor", tradingName: null, address: "1 Upper Street", addressSource: "verification",
  companyName: null, companyNumber: null, registeredOffice: null, partnershipName: null, vatMode: "none", vatNumber: null, vatRateBp: null,
};

function show(view: BusinessView = SOLE, outcome: SaveOutcome = { success: true }) {
  const onSave = vi.fn(async () => outcome);
  render(<TradingNameDialog open onOpenChange={vi.fn()} view={view} onSave={onSave} />);
  return { onSave };
}

describe("TradingNameDialog", () => {
  it("optional: blank uses her own name, which it names", () => {
    show();
    expect(screen.getByRole("dialog", { name: "Trading name" })).toBeInTheDocument();
    expect(screen.getByLabelText("Trading name (optional)")).toHaveValue("");
    expect(screen.getByText("Leave this blank to use your own name, Sophie Taylor.")).toBeInTheDocument();
  });

  it("for a company or partnership it says the trading name is printed instead of the registered name", () => {
    show({ ...SOLE, businessType: "limited_company", tradingName: "Little Steps" });
    expect(screen.getByLabelText("Trading name (optional)")).toHaveValue("Little Steps");
    expect(screen.getByText("If you add one, your invoices show it instead of the company's registered name.")).toBeInTheDocument();
    cleanup();
    show({ ...SOLE, businessType: "partnership" });
    expect(screen.getByText("If you add one, your invoices show it instead of the partnership's name.")).toBeInTheDocument();
  });

  it("with no printable name on file it asks for one", () => {
    show({ ...SOLE, name: null });
    expect(screen.getByText("Add the name to print on your invoices.")).toBeInTheDocument();
  });

  it("saves what she typed (blank included)", async () => {
    const { onSave } = show();
    fireEvent.change(screen.getByLabelText("Trading name (optional)"), { target: { value: "Little Steps" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith({ tradingName: "Little Steps" }));
  });

  it("a refusal shows the plain message by the field", async () => {
    show(SOLE, { success: false, error: "Please check the details marked below.", fields: { tradingName: "Use your own name or business name — BabyBloom can't be the one paid" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Use your own name or business name — BabyBloom can't be the one paid")).toBeInTheDocument();
    expect(screen.getByLabelText("Trading name (optional)")).toHaveAttribute("aria-invalid", "true");
  });
});
