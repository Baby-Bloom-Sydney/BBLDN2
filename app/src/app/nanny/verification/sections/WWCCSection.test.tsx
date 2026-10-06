/**
 * Unit 3b (BB-LDN-3b-061026) — the DBS section on /nanny/verification (brief changes 3, 7, 8; rulings #6, #7, #13,
 * #18, #22; copy deck §2.3–§2.4, §3). File name kept (D-4).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";

const m = vi.hoisted(() => ({ review: vi.fn(), submit: vi.fn() }));
vi.mock("@/lib/actions/dbs-review", () => ({ submitDbsForManualReview: m.review }));
vi.mock("@/lib/actions/verification", () => ({ submitWWCCSection: m.submit }));
vi.mock("@/lib/supabase/storage", () => ({ uploadFileWithProgress: vi.fn() }));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) } }),
}));

import { WWCCSection } from "./WWCCSection";
import { dbsRow, STORED_SECTION } from "@/lib/dbs/fixtures.test-util";
import { GUIDANCE_MESSAGES, type UserGuidance } from "@/lib/verification";
import { DBS_LINKS } from "@/lib/constants";

afterEach(cleanup);
beforeEach(() => {
  m.review.mockReset();
  m.submit.mockReset();
});

const show = (over: Parameters<typeof dbsRow>[0]) =>
  render(<WWCCSection verification={dbsRow(over)} identityVerified onSaved={vi.fn()} />);

const failGuidance: UserGuidance = { title: "Model title", explanation: "Model text", steps_to_fix: ["x"], reason_code: "not_enhanced" };

const FAIL_ROWS: Array<[string, Parameters<typeof dbsRow>[0]]> = [
  ["failed", { code: 24, section: "failed", guidance: failGuidance }],
  ["new_info", { code: 23, section: "expired", guidance: { ...GUIDANCE_MESSAGES.DBS_NEW_INFO } }],
  ["no_match", { code: 26, section: STORED_SECTION.NO_MATCH, guidance: { ...GUIDANCE_MESSAGES.DBS_NO_MATCH } }],
  ["rejected", { code: 22, section: "rejected", rejection: "Certificate unreadable" }],
  ["technical_retry", { code: 20, section: "doc_verified", crossCheck: "pending", guidance: { ...GUIDANCE_MESSAGES.TECHNICAL_RETRY } }],
  ["failed, no guidance", { code: 24, section: "failed" }],
];

describe("WWCCSection — DBS display mode", () => {
  it("shows the number, issue date and 'Update Service: current · checked …' rows when clear", () => {
    show({
      code: 30, section: "doc_verified", crossCheck: "passed",
      number: "001234567890", issued: "2024-03-05", checkedAt: "2026-10-06T09:00:00.000Z",
    });
    expect(screen.getByText("Certificate number: 0012 3456 7890")).toBeInTheDocument();
    expect(screen.getByText("Issued: 5 Mar 2024")).toBeInTheDocument();
    expect(screen.getByText("Update Service: current · checked 6 Oct 2026")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit & Resubmit" })).toBeNull();
  });

  it.each(FAIL_ROWS)("shows Edit & Resubmit + Request manual review when %s", (_s, row) => {
    show(row);
    expect(screen.getByRole("button", { name: "Edit & Resubmit" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Request manual review" })).toBeInTheDocument();
  });

  it("shows no buttons when barred", () => {
    show({ code: 27, section: "barred", guidance: { ...GUIDANCE_MESSAGES.DBS_BARRED } });
    expect(screen.getByText(GUIDANCE_MESSAGES.DBS_BARRED.title)).toBeInTheDocument();
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  it("shows the deck card, not the stored model title, when reason_code is not_enhanced", () => {
    show({ code: 24, section: "failed", guidance: failGuidance });
    expect(screen.getByText("This isn't an enhanced DBS certificate")).toBeInTheDocument();
    expect(screen.queryByText("Model title")).toBeNull();
    expect(screen.getByRole("link", { name: /Get an enhanced DBS/ })).toHaveAttribute("href", DBS_LINKS.getEnhanced);
  });

  it("shows the no-match card with the explainer and both links", () => {
    show({ code: 26, section: STORED_SECTION.NO_MATCH, guidance: { ...GUIDANCE_MESSAGES.DBS_NO_MATCH } });
    expect(screen.getByText("What is the Update Service?")).toBeInTheDocument();
    const hrefs = screen.getAllByRole("link").map((a) => a.getAttribute("href"));
    expect(hrefs).toEqual([DBS_LINKS.joinUpdateService, DBS_LINKS.getEnhanced]);
  });

  it("shows the admin reason under the 22 title", () => {
    show({ code: 22, section: "rejected", rejection: "Certificate unreadable" });
    expect(screen.getByText("We couldn't accept your DBS certificate")).toBeInTheDocument();
    expect(screen.getByText("Certificate unreadable")).toBeInTheDocument();
  });

  it("shows the reading line while the certificate is read", () => {
    show({ code: 29, section: "pending" });
    expect(screen.getByText("We're reading your DBS certificate. This usually takes about 15 seconds.")).toBeInTheDocument();
  });

  it("shows the checking line while the Update Service runs", () => {
    show({ code: 20, section: "doc_verified", crossCheck: "pending" });
    expect(screen.getByText("Checking your certificate with the DBS Update Service…")).toBeInTheDocument();
  });

  it("shows the pending-manual-review line when she asked for it", () => {
    show({ code: 21, section: "review", guidance: null });
    expect(screen.getByText("Pending manual review")).toBeInTheDocument();
    expect(screen.getByText("We'll check your DBS certificate by hand. This may take up to 3 days.")).toBeInTheDocument();
  });

  it("shows the neutral closer-look card when the AI sent it to the team", () => {
    show({ code: 21, section: "review", guidance: { title: "t", explanation: "e", steps_to_fix: [], reason_code: "name_mismatch" } });
    expect(screen.getByText("We're taking a closer look")).toBeInTheDocument();
    expect(screen.queryByText("t")).toBeNull();
  });

});

describe("WWCCSection — Request manual review", () => {
  const openDialog = () => {
    show({ code: 26, section: STORED_SECTION.NO_MATCH, guidance: { ...GUIDANCE_MESSAGES.DBS_NO_MATCH } });
    fireEvent.click(screen.getByRole("button", { name: "Request manual review" }));
    return screen.getByRole("dialog");
  };

  it("opens the confirm dialog with the kept turnaround body (#18) and the deck buttons", () => {
    const d = openDialog();
    expect(within(d).getByText("Submit for manual review?")).toBeInTheDocument();
    expect(within(d).getByText("Manual review can take up to 3 days. We recommend re-attempting verification first.")).toBeInTheDocument();
    expect(within(d).getByRole("button", { name: "No, I'll try again" })).toBeInTheDocument();
  });

  it("calls submitDbsForManualReview once after the dialog's Yes, then shows the toast", async () => {
    m.review.mockResolvedValue({ success: true, error: null });
    const d = openDialog();
    fireEvent.click(within(d).getByRole("button", { name: "Yes, submit for review" }));
    await waitFor(() => expect(m.review).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("Sent to our team. We'll email you.")).toBeInTheDocument();
    expect(screen.getByText("Pending manual review")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Request manual review" })).toBeNull();
  });

  it("shows the error pill when the action fails", async () => {
    m.review.mockResolvedValue({ success: false, error: "Manual review isn't available right now." });
    const d = openDialog();
    fireEvent.click(within(d).getByRole("button", { name: "Yes, submit for review" }));
    expect(await screen.findByText("Manual review isn't available right now.")).toBeInTheDocument();
    expect(screen.queryByText("Sent to our team. We'll email you.")).toBeNull();
  });

  it("shows the error pill when the action throws", async () => {
    m.review.mockRejectedValue(new Error("network"));
    const d = openDialog();
    fireEvent.click(within(d).getByRole("button", { name: "Yes, submit for review" }));
    expect(await screen.findByText("We couldn't send your request. Please try again.")).toBeInTheDocument();
  });

  it("'No, I'll try again' opens the upload form instead", () => {
    const d = openDialog();
    fireEvent.click(within(d).getByRole("button", { name: "No, I'll try again" }));
    expect(m.review).not.toHaveBeenCalled();
    expect(screen.getByText("Your DBS certificate")).toBeInTheDocument();
  });
});

describe("WWCCSection — edit mode", () => {
  it("opens with the DBS upload form when not started, and submits path + consent", async () => {
    m.submit.mockResolvedValue({ success: true, error: null, verificationId: "ver-1" });
    const onSaved = vi.fn();
    const fetchMock = vi.fn(async () => ({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    const storage = await import("@/lib/supabase/storage");
    vi.mocked(storage.uploadFileWithProgress).mockResolvedValue({ url: "user-1/1-page1.png", error: null });
    const { container } = render(<WWCCSection verification={dbsRow({})} identityVerified onSaved={onSaved} />);
    expect(screen.getByText("Your DBS certificate")).toBeInTheDocument();
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    expect(input).toHaveAttribute("accept", "image/*,application/pdf");
    fireEvent.change(input, { target: { files: [new File(["x"], "page1.png", { type: "image/png" })] } });
    await screen.findByText("Certificate uploaded");
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Verify DBS" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith("ver-1", "dbs_certificate"));
    expect(m.submit).toHaveBeenCalledWith({ certificate_path: "user-1/1-page1.png", consent: true });
    expect(fetchMock).toHaveBeenCalledWith("/api/run-verification", expect.objectContaining({ method: "POST" }));
    vi.unstubAllGlobals();
  });

  it("shows the server's error and stays in edit mode when the save fails", async () => {
    m.submit.mockResolvedValue({ success: false, error: "We couldn't save your certificate. Please try again." });
    const storage = await import("@/lib/supabase/storage");
    vi.mocked(storage.uploadFileWithProgress).mockResolvedValue({ url: "user-1/1-page1.png", error: null });
    const { container } = render(<WWCCSection verification={dbsRow({})} identityVerified onSaved={vi.fn()} />);
    fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [new File(["x"], "page1.png", { type: "image/png" })] } });
    await screen.findByText("Certificate uploaded");
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Verify DBS" }));
    expect(await screen.findByText("We couldn't save your certificate. Please try again.")).toBeInTheDocument();
  });
});
