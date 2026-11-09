/**
 * The shared shell's two opt-ins for edit mode (ledger B06 §9.1 R1, R6), off by default so parent Settings is
 * unchanged until its own PR: `defaultLeafId` (desktop with no `?s=` opens that leaf, not "Select a setting from the
 * sidebar."; mobile still shows the menu) and a node's `ownHeader` (the leaf draws its own title row, where Edit sits).
 *
 * BB-wave1-041126/06b3-rework, 2026-11-09.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { SettingsShell } from "./SettingsShell";
import type { SettingsNode } from "./tree";

afterEach(cleanup);

const TREE: SettingsNode[] = [
  { id: "profile", label: "Profile", ownHeader: true },
  { id: "security", label: "Security" },
];
const leaf = (node: SettingsNode) => <p data-testid={`leaf-${node.id}`}>{node.label} content</p>;

describe("SettingsShell", () => {
  it("without defaultLeafId the desktop landing is today's panel", () => {
    render(<SettingsShell title="Settings" basePath="/x" tree={TREE} activeId="" renderLeaf={leaf} />);
    expect(screen.getByText("Select a setting from the sidebar.")).toBeInTheDocument();
    expect(screen.queryByTestId("leaf-profile")).toBeNull();
  });

  it("with defaultLeafId, desktop with no ?s= opens that leaf (once: the mobile pane keeps its menu)", () => {
    render(<SettingsShell title="Settings" basePath="/x" tree={TREE} activeId="" renderLeaf={leaf} defaultLeafId="profile" />);
    expect(screen.queryByText("Select a setting from the sidebar.")).toBeNull();
    expect(screen.getAllByTestId("leaf-profile")).toHaveLength(1);
    expect(screen.getAllByRole("link", { name: /Security/ }).length).toBeGreaterThan(0);
  });

  it("ownHeader: the shell draws no title for that leaf (the leaf draws its own); others keep theirs", () => {
    const { unmount } = render(<SettingsShell title="Settings" basePath="/x" tree={TREE} activeId="profile" renderLeaf={leaf} />);
    expect(screen.queryAllByRole("heading", { level: 2, name: "Profile" })).toHaveLength(0);
    unmount();
    render(<SettingsShell title="Settings" basePath="/x" tree={TREE} activeId="security" renderLeaf={leaf} />);
    expect(screen.getAllByRole("heading", { level: 2, name: "Security" }).length).toBeGreaterThan(0);
  });
});
