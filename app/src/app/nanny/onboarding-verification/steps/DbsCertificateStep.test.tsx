/**
 * Unit 3b (BB-LDN-3b-061026) — onboarding step 3 body: one page-1 upload (image or PDF), Update Service notice,
 * one consent tick, no chooser / number / date (rulings #1, #3, #14; brief changes 2–3; copy deck §1.3).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";

const upload = vi.hoisted(() => ({ fn: vi.fn() }));
vi.mock("@/lib/supabase/storage", () => ({ uploadFileWithProgress: upload.fn }));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) } }),
}));

import { DbsCertificateStep } from "./DbsCertificateStep";
import { DBS_LINKS } from "@/lib/constants";

afterEach(cleanup);
beforeEach(() => {
  upload.fn.mockReset();
  upload.fn.mockImplementation(async (_b: string, uid: string, f: File) => ({ url: `${uid}/1-${f.name}`, error: null }));
});

const fileInput = (c: HTMLElement) => c.querySelectorAll<HTMLInputElement>('input[type="file"]');
const pick = (c: HTMLElement, f: File) => fireEvent.change(fileInput(c)[0], { target: { files: [f] } });
const pdf = () => new File(["%PDF-1.7 synthetic"], "page1.pdf", { type: "application/pdf" });

function setup(onSubmit = vi.fn()) {
  const r = render(<DbsCertificateStep userId="user-1" layout="onboarding" submitting={false} error={null} onSubmit={onSubmit} />);
  return { ...r, onSubmit };
}

describe("DbsCertificateStep", () => {
  it("renders exactly one file input, accepting image/*,application/pdf, when shown", () => {
    const { container } = setup();
    expect(fileInput(container)).toHaveLength(1);
    expect(fileInput(container)[0]).toHaveAttribute("accept", "image/*,application/pdf");
    expect(screen.getByText("Page 1 of your DBS certificate")).toBeInTheDocument();
  });

  it("renders no number, date or method-chooser field when shown", () => {
    const { container } = setup();
    expect(container.querySelectorAll('input[type="text"], input[type="date"], input[type="number"], select')).toHaveLength(0);
    expect(screen.queryByText(/verification method/i)).toBeNull();
    expect(screen.queryByText(/enter (details )?manually/i)).toBeNull();
  });

  it("renders the Update Service notice with a link to DBS_LINKS.joinUpdateService", () => {
    setup();
    expect(screen.getByText("You'll need to be on the DBS Update Service.")).toBeInTheDocument();
    const link = screen.getByRole("link", { name: /Join the Update Service/ });
    expect(link).toHaveAttribute("href", DBS_LINKS.joinUpdateService);
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("renders the How-to box and the static selected card from the deck", () => {
    setup();
    expect(screen.getByText("How to upload your DBS certificate:")).toBeInTheDocument();
    expect(screen.getByText("A photo of page 1, or a PDF")).toBeInTheDocument();
  });

  it("disables Verify DBS until a file is uploaded and consent is ticked", async () => {
    const { container, onSubmit } = setup();
    const cta = () => screen.getByRole("button", { name: "Verify DBS" });
    expect(cta()).toBeDisabled();
    pick(container, pdf());
    await screen.findByText("Certificate uploaded");
    expect(cta()).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox"));
    expect(cta()).toBeEnabled();
    fireEvent.click(cta());
    expect(onSubmit).toHaveBeenCalledWith("user-1/1-page1.pdf");
  });

  it("shows the type error when given a .docx, and uploads nothing", async () => {
    const { container } = setup();
    pick(container, new File(["PK"], "cert.docx", { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }));
    expect(await screen.findByText("This file type isn't supported. Upload a photo (JPG or PNG) or a PDF.")).toBeInTheDocument();
    expect(upload.fn).not.toHaveBeenCalled();
  });

  it("shows the PDF error when given a non-PDF named .pdf, and uploads nothing", async () => {
    const { container } = setup();
    pick(container, new File(["not a pdf"], "cert.pdf", { type: "application/pdf" }));
    expect(await screen.findByText("We couldn't open this PDF. Try a photo of page 1 instead.")).toBeInTheDocument();
    expect(upload.fn).not.toHaveBeenCalled();
  });

  it("shows the upload error and keeps the CTA disabled when the upload fails", async () => {
    upload.fn.mockResolvedValueOnce({ url: null, error: "Upload failed — please try again" });
    const { container } = setup();
    pick(container, pdf());
    expect(await screen.findByText("Upload failed — please try again")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox"));
    expect(screen.getByRole("button", { name: "Verify DBS" })).toBeDisabled();
  });

  it("shows 'Get an enhanced DBS →' with DBS_LINKS.getEnhanced when 'I don't have an enhanced DBS certificate' is chosen", () => {
    const { container } = setup();
    fireEvent.click(screen.getByRole("button", { name: "I don't have an enhanced DBS certificate" }));
    const link = screen.getByRole("link", { name: /Get an enhanced DBS/ });
    expect(link).toHaveAttribute("href", DBS_LINKS.getEnhanced);
    expect(link).toHaveTextContent("Get an enhanced DBS →");
    expect(fileInput(container)).toHaveLength(0);
    expect(screen.queryByRole("button", { name: "Verify DBS" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "I have an enhanced DBS certificate" }));
    expect(fileInput(container)).toHaveLength(1);
  });

  it("renders the inline layout without the onboarding-only toggle and card", () => {
    render(<DbsCertificateStep userId="user-1" layout="inline" submitting={false} error={null} onSubmit={vi.fn()} />);
    expect(screen.queryByText("A photo of page 1, or a PDF")).toBeNull();
    expect(screen.queryByRole("button", { name: /don't have an enhanced DBS/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Verify DBS" })).toBeDisabled();
  });

  it("resolves the user id from the session when none is passed (verification page)", async () => {
    const { container } = render(<DbsCertificateStep layout="inline" submitting={false} error={null} onSubmit={vi.fn()} />);
    pick(container, pdf());
    await waitFor(() => expect(upload.fn).toHaveBeenCalledWith("verification-documents", "user-1", expect.any(File), expect.any(Function), expect.anything()));
  });

  it("shows the error pill and the busy label it is given", () => {
    render(<DbsCertificateStep userId="user-1" layout="inline" submitting error="We couldn't send your certificate. Please try again." onSubmit={vi.fn()} />);
    expect(screen.getByText("We couldn't send your certificate. Please try again.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Verifying/ })).toBeDisabled();
  });
});
