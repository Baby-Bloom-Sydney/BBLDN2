/**
 * The edit-mode page header (ledger B06 §9.1 R1): the page title with one Edit button at the top right; while
 * editing, Cancel and Save replace it and the header stays pinned, so Save is in reach at 320 px.
 *
 * BB-wave1-041126/06b3-rework, 2026-11-09.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { SettingsEditHeader } from "./SettingsEditHeader";

afterEach(cleanup);

function show(editing: boolean, saving = false) {
  const onEdit = vi.fn();
  const onCancel = vi.fn();
  const editRef = createRef<HTMLButtonElement>();
  render(
    <form id="profile-form" onSubmit={(e) => e.preventDefault()}>
      <SettingsEditHeader title="Profile" editing={editing} saving={saving} onEdit={onEdit} onCancel={onCancel} formId="profile-form" editRef={editRef} />
    </form>,
  );
  return { onEdit, onCancel, editRef };
}

describe("SettingsEditHeader", () => {
  it("view: the title as the page heading and one Edit button", () => {
    const { onEdit, editRef } = show(false);
    expect(screen.getByRole("heading", { level: 2, name: "Profile" })).toBeInTheDocument();
    const edit = screen.getByRole("button", { name: "Edit profile" });
    expect(edit).toHaveTextContent("Edit");
    expect(editRef.current).toBe(edit);
    fireEvent.click(edit);
    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
  });

  it("edit: Cancel and Save replace Edit; Save submits the page's form; the header is pinned", () => {
    const { onCancel } = show(true);
    expect(screen.queryByRole("button", { name: /Edit/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    const save = screen.getByRole("button", { name: "Save" });
    expect(save).toHaveAttribute("type", "submit");
    expect(save).toHaveAttribute("form", "profile-form");
    expect(screen.getByRole("heading", { name: "Profile" }).closest("[data-pinned]")).toHaveAttribute("data-pinned", "true");
  });

  it("saving: Save reads Saving… and both are disabled", () => {
    show(true, true);
    expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
  });
});
