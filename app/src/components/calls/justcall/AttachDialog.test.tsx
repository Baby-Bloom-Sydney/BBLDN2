/**
 * Attach to family (plan 05 §5 B4; brief §0.9, §3 admin 7): search by name or mobile (parents only, the server's), pick
 * one, then **Attach to <name>**; the call goes onto that family and the page refreshes.
 */
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ attachJustCallAction: vi.fn(), searchFamiliesForCallAction: vi.fn() }));
vi.mock("@/app/admin/calls/justcall-actions", () => h);

import type { UnmatchedCallView } from "@/lib/justcall/types";
import { AttachDialog } from "./AttachDialog";

const P1 = "b0500000-0000-4000-8000-000000000017";
const P2 = "b0500000-0000-4000-8000-000000000018";
const CALL: UnmatchedCallView = { callSid: "CAun0001", number: "+44 (0) 7700 900 599", when: "Tue 9 Feb, 14:03 (London time)", direction: "Outgoing", result: "Answered", duration: "6 min 12 s", reason: "No family with this number", resultCode: "answered", matchNote: "none" };

beforeEach(() => {
  h.searchFamiliesForCallAction.mockReset().mockResolvedValue({ ok: true, value: [
    { parentUserId: P1, name: "Ava Smith", mobile: "+44 (0) 7700 900 517" },
    { parentUserId: P2, name: "Ava Stone", mobile: null },
  ] });
  h.attachJustCallAction.mockReset().mockResolvedValue({ ok: true, value: { entryCreated: true } });
});

const dialog = () => screen.getByRole("dialog", { name: "Attach this call to a family" });

async function search(user: ReturnType<typeof userEvent.setup>, text: string) {
  await user.type(within(dialog()).getByLabelText("Family name or mobile"), text);
  await user.click(within(dialog()).getByRole("button", { name: "Search" }));
}

describe("AttachDialog", () => {
  it("closed with no call", () => {
    render(<AttachDialog call={null} onClose={vi.fn()} onAttached={vi.fn()} />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("search, pick, attach: the call onto that family; then onAttached", async () => {
    const user = userEvent.setup();
    const onAttached = vi.fn();
    render(<AttachDialog call={CALL} onClose={vi.fn()} onAttached={onAttached} />);
    expect(within(dialog()).getByText("+44 (0) 7700 900 599 · Tue 9 Feb, 14:03 (London time)")).toBeInTheDocument();
    await search(user, "ava");
    expect(h.searchFamiliesForCallAction).toHaveBeenCalledWith({ query: "ava" });
    const choices = within(dialog()).getAllByRole("radio");
    expect(choices.map((c) => c.closest("label")?.textContent)).toEqual(["Ava Smith · +44 (0) 7700 900 517", "Ava Stone"]);
    expect(within(dialog()).queryByRole("button", { name: /Attach to/ })).toBeNull();
    await user.click(choices[0]);
    await user.click(within(dialog()).getByRole("button", { name: "Attach to Ava Smith" }));
    expect(h.attachJustCallAction).toHaveBeenCalledWith({ callSid: "CAun0001", parentUserId: P1 });
    expect(onAttached).toHaveBeenCalledTimes(1);
  });

  it("too short a search says what to type and asks nothing", async () => {
    const user = userEvent.setup();
    render(<AttachDialog call={CALL} onClose={vi.fn()} onAttached={vi.fn()} />);
    await search(user, "a");
    expect(within(dialog()).getByText("Type at least 2 letters of a name, or a mobile.")).toBeInTheDocument();
    expect(h.searchFamiliesForCallAction).not.toHaveBeenCalled();
  });

  it("no family found says so", async () => {
    const user = userEvent.setup();
    h.searchFamiliesForCallAction.mockResolvedValue({ ok: true, value: [] });
    render(<AttachDialog call={CALL} onClose={vi.fn()} onAttached={vi.fn()} />);
    await search(user, "zed");
    expect(await within(dialog()).findByText("No family found.")).toBeInTheDocument();
  });

  it.each([
    ["the search", "searchFamiliesForCallAction", "invalid", "Check the result, outcome and time, then try again."],
    ["the attach", "attachJustCallAction", "not_a_parent", "That account isn't a family."],
  ] as const)("%s refused shows its line", async (_label, action, error, line) => {
    const user = userEvent.setup();
    h[action].mockResolvedValue({ ok: false, error });
    const onAttached = vi.fn();
    render(<AttachDialog call={CALL} onClose={vi.fn()} onAttached={onAttached} />);
    await search(user, "ava");
    if (action === "attachJustCallAction") {
      await user.click(within(dialog()).getAllByRole("radio")[0]);
      await user.click(within(dialog()).getByRole("button", { name: "Attach to Ava Smith" }));
    }
    expect(await within(dialog()).findByRole("alert")).toHaveTextContent(line);
    expect(onAttached).not.toHaveBeenCalled();
  });

  it("a double click on Attach sends it once", async () => {
    const user = userEvent.setup();
    let release: (v: unknown) => void = () => {};
    h.attachJustCallAction.mockImplementation(() => new Promise((r) => (release = r)));
    render(<AttachDialog call={CALL} onClose={vi.fn()} onAttached={vi.fn()} />);
    await search(user, "ava");
    await user.click(within(dialog()).getAllByRole("radio")[0]);
    const attach = within(dialog()).getByRole("button", { name: "Attach to Ava Smith" });
    await user.dblClick(attach);
    expect(h.attachJustCallAction).toHaveBeenCalledTimes(1);
    release({ ok: true, value: { entryCreated: true } });
  });
});

describe("AttachDialog — the React review's points", () => {
  it("results are announced and the choices are a labelled group; the hint is tied to the field", async () => {
    const user = userEvent.setup();
    render(<AttachDialog call={CALL} onClose={vi.fn()} onAttached={vi.fn()} />);
    await search(user, "a");
    const field = within(dialog()).getByLabelText("Family name or mobile");
    expect(field).toHaveAttribute("aria-invalid", "true");
    expect(field).toHaveAccessibleDescription("Type at least 2 letters of a name, or a mobile.");
    await user.clear(field);
    await search(user, "ava");
    expect(within(dialog()).getByRole("status")).toHaveTextContent("2 families found.");
    expect(within(dialog()).getByRole("group", { name: "Choose a family" })).toBeInTheDocument();
  });

  it("closing is held while an attach is in flight (review M2)", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    h.attachJustCallAction.mockImplementation(() => new Promise(() => {}));
    render(<AttachDialog call={CALL} onClose={onClose} onAttached={vi.fn()} />);
    await search(user, "ava");
    await user.click(within(dialog()).getAllByRole("radio")[0]);
    await user.click(within(dialog()).getByRole("button", { name: "Attach to Ava Smith" }));
    await user.keyboard("{Escape}");
    expect(onClose).not.toHaveBeenCalled();
    expect(dialog()).toBeInTheDocument();
  });

  it("a refusal's line clears when another family is picked (review L9)", async () => {
    const user = userEvent.setup();
    h.attachJustCallAction.mockResolvedValue({ ok: false, error: "not_a_parent" });
    render(<AttachDialog call={CALL} onClose={vi.fn()} onAttached={vi.fn()} />);
    await search(user, "ava");
    await user.click(within(dialog()).getAllByRole("radio")[0]);
    await user.click(within(dialog()).getByRole("button", { name: "Attach to Ava Smith" }));
    expect(await within(dialog()).findByRole("alert")).toBeInTheDocument();
    await user.click(within(dialog()).getAllByRole("radio")[1]);
    expect(within(dialog()).queryByRole("alert")).toBeNull();
  });

  it("fits a phone: the dialog scrolls within the screen (review M8)", () => {
    render(<AttachDialog call={CALL} onClose={vi.fn()} onAttached={vi.fn()} />);
    expect(dialog()).toHaveClass("max-h-[85dvh]", "overflow-y-auto");
  });

  it("a new call starts afresh", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<AttachDialog call={CALL} onClose={vi.fn()} onAttached={vi.fn()} />);
    await search(user, "ava");
    rerender(<AttachDialog call={{ ...CALL, callSid: "CAun0002" }} onClose={vi.fn()} onAttached={vi.fn()} />);
    expect(within(dialog()).queryAllByRole("radio")).toEqual([]);
    expect(within(dialog()).getByLabelText("Family name or mobile")).toHaveValue("");
  });
});
