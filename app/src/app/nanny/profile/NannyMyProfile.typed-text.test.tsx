/**
 * Profile text typed with < and > in the editor: what the editor saves, what the profile then shows, and what the
 * editor shows when it is opened again — each as before (the server stores the text as typed).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const h = vi.hoisted(() => ({ saveText: vi.fn(), saveProfile: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/nanny/profile",
}));
vi.mock("@/lib/actions/nanny", () => ({
  updateNannyProfile: h.saveProfile,
  updateNannyAIContent: h.saveText,
  regenerateNannyAIContent: vi.fn(),
}));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({}) }));
vi.mock("@/lib/supabase/storage", () => ({ uploadFile: vi.fn() }));

import { NannyMyProfile } from "./NannyMyProfile";
import { nannyProfileFixture } from "@/lib/dbs/fixtures.test-util";

afterEach(cleanup);

const TYPED = "Kids <5\n\n2 > 1\n\n<3";

function profileWith(about: string) {
  return { ...nannyProfileFixture(4, true), ai_content: { headline: "Calm", bio_summary: { about } } } as Parameters<typeof NannyMyProfile>[0]["profile"];
}
const rawText = (html: string) => {
  const d = document.createElement("div");
  d.innerHTML = html;
  return d.textContent ?? "";
};

describe("NannyMyProfile — text typed with < and >", () => {
  it("is saved, shown and reopened as before", async () => {
    h.saveProfile.mockResolvedValue({ success: true, error: null });
    h.saveText.mockResolvedValue({ success: true, error: null });

    // type it into the About section and save
    render(<NannyMyProfile profile={profileWith("<p>About</p>")} />);
    fireEvent.click(screen.getByTitle("Edit Profile"));
    fireEvent.change(screen.getByDisplayValue("About"), { target: { value: TYPED } });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    await waitFor(() => expect(h.saveText).toHaveBeenCalledTimes(1));
    const sent = (h.saveText.mock.calls[0][1] as { bio_summary: { about: string } }).bio_summary.about;
    expect(sent).toBe("<p>Kids <5</p><p>2 > 1</p><p><3</p>");
    cleanup();

    // the profile shows what the browser showed for it before
    render(<NannyMyProfile profile={profileWith(sent)} />);
    expect(rawText(sent)).toBe("Kids <52 > 1<3");
    expect(document.body.textContent).toContain(rawText(sent));

    // opened again, the editor shows what it showed before (its own handling of "<", unchanged)
    fireEvent.click(screen.getByTitle("Edit Profile"));
    const reopened = (document.querySelectorAll("textarea")[1] as HTMLTextAreaElement | undefined)?.value;
    expect(reopened).toBe("Kids  1");
  });
});
