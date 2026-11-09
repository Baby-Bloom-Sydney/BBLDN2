/**
 * R6 (ledger B06 §9.1): small grey text in the shared Settings components is slate-500 (4.8:1 on white), not
 * slate-400 (about 2.5:1, under AA). Icons and borders keep their colours. A check over what each component renders:
 * no element whose own text shows is in slate-400.
 *
 * BB-wave1-041126/06b3-rework, 2026-11-09.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("@/lib/actions/contact", () => ({ submitContactRequest: vi.fn() }));

import { ContactSection } from "./ContactSection";
import { SettingsRow } from "./SettingsRow";
import { SettingsShell } from "./SettingsShell";
import { SettingsSidebar } from "./SettingsSidebar";
import { SettingsSubsection } from "./SettingsSubsection";

afterEach(cleanup);

/** Elements in slate-400 that carry text of their own (an icon's colour is fine). */
function faintText(container: HTMLElement): string[] {
  return [...container.querySelectorAll<HTMLElement>(".text-slate-400")]
    .filter((el) => [...el.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? "").trim() !== ""))
    .map((el) => el.textContent ?? "");
}

describe("small grey text is slate-500", () => {
  it("SettingsRow: the Not set placeholder and the caption", () => {
    const { container } = render(<SettingsRow label="Mobile number" caption="Last updated today" />);
    expect(faintText(container)).toEqual([]);
  });

  it("SettingsSubsection: the footnote", () => {
    const { container } = render(<SettingsSubsection header="Email" footnote="A note">rows</SettingsSubsection>);
    expect(faintText(container)).toEqual([]);
  });

  it("SettingsSidebar: the group label", () => {
    const { container } = render(<SettingsSidebar basePath="/x" tree={[{ id: "a", label: "A" }]} activeRootId="" groupLabel="Personal" />);
    expect(faintText(container)).toEqual([]);
  });

  it("SettingsShell: the desktop landing caption and the page-bottom link", () => {
    const { container } = render(
      <SettingsShell title="Settings" basePath="/x" tree={[{ id: "a", label: "A" }]} activeId="" renderLeaf={() => null}
        pageBottomLink={{ label: "Close account", targetId: "a" }} />,
    );
    expect(faintText(container)).toEqual([]);
  });

  it("ContactSection: the character count", () => {
    const { container } = render(<ContactSection />);
    expect(faintText(container)).toEqual([]);
  });
});
