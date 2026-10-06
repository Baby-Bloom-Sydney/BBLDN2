/**
 * Unit 3d (BB-LDN-3d-061026) — DBSCheckModal render rules (brief change 11, spec §2.2; #11, #27, #36, P-1).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const h = vi.hoisted(() => ({
  adminVerifyWWCC: vi.fn(async () => ({ success: true, error: null })),
  adminRejectWWCC: vi.fn(async () => ({ success: true, error: null })),
  adminBarDbs: vi.fn(async () => ({ success: true, error: null })),
  adminLiftDbsBar: vi.fn(async () => ({ success: true, error: null })),
  adminRunDbsCheck: vi.fn(async () => ({ success: true, error: null, result: "BLANK" })),
  refresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: h.refresh, push: vi.fn() }) }));
vi.mock("@/lib/actions/admin", () => ({ adminRejectWWCC: h.adminRejectWWCC, adminSendEmail: vi.fn() }));
vi.mock("@/lib/actions/admin-dbs", () => ({
  adminVerifyWWCC: h.adminVerifyWWCC,
  adminBarDbs: h.adminBarDbs,
  adminLiftDbsBar: h.adminLiftDbsBar,
  adminRunDbsCheck: h.adminRunDbsCheck,
}));
vi.mock("./ContactUserModal", () => ({
  ContactUserModal: (p: { open: boolean; defaultSubject?: string }) => (p.open ? <div>contact:{p.defaultSubject}</div> : null),
}));

import { DBSCheckModal } from "./DBSCheckModal";
import type { PendingDbsCheck } from "@/lib/admin/dbs-queues";

const check = (over: Partial<PendingDbsCheck> = {}): PendingDbsCheck => ({
  id: "v1", user_id: "u1", verification_status: 30, wwcc_status: "doc_verified", wwcc_status_at: "2026-10-06T10:00:00Z",
  identity_status: "verified",
  cross_check_status: "passed", cross_check_reasoning: "Surname + DOB match; Update Service: BLANK_NO_NEW_INFO", cross_check_issues: null,
  wwcc_user_guidance: { confidence: "high", reason_code: "PASS" }, ocg_result_status: "BLANK_NO_NEW_INFO",
  ocg_result_text: "<statusCheckResult/>", ocg_verified_at: "2026-10-06T10:00:00Z", wwcc_verified_at: null, wwcc_verified_by: null,
  extracted_wwcc_clearance_type: JSON.stringify({ level: "Enhanced", childrens_barred_list: "none_recorded", has_disclosed_content: false }),
  certificate_url: "https://storage.test/signed/u1/page1.png", is_pdf: false,
  extracted_wwcc_number: "001234567890", extracted_wwcc_surname: "Taylor", extracted_wwcc_first_name: "Sophie",
  extracted_wwcc_other_names: null, extracted_wwcc_dob: "1990-03-05", extracted_wwcc_expiry: "2024-01-10",
  extracted_surname: "Taylor", extracted_given_names: "Sophie", extracted_dob: "1990-03-05",
  wwcc_ai_reasoning: "All checks passed", wwcc_ai_issues: "[]", wwcc_rejection_reason: null,
  first_name: "Sophie", last_name: "Taylor", email: "admin+3d@babybloomsydney.com.au", profile_picture_url: null,
  created_at: "2026-10-06T09:00:00Z", history: [], api_down_since: null,
  ...over,
});

const open = (c: PendingDbsCheck, list: "awaiting" | "needsPerson" | "recheckAlerts" | "barred" = "awaiting") =>
  render(<DBSCheckModal check={c} list={list} open onOpenChange={vi.fn()} />);

beforeEach(() => vi.clearAllMocks());

describe("DBSCheckModal", () => {
  it("Approve is enabled with an API pass and runs the two-step confirm", async () => {
    open(check());
    const approve = screen.getByRole("button", { name: /APPROVE DBS/ });
    expect(approve).toBeEnabled();
    fireEvent.click(approve);
    fireEvent.click(screen.getByRole("button", { name: /Yes, approve/ }));
    await waitFor(() => expect(h.adminVerifyWWCC).toHaveBeenCalledWith("v1"));
    expect(h.refresh).toHaveBeenCalled();
  });

  it("Approve is disabled with a reason when there is no API pass", () => {
    open(check({ verification_status: 21, ocg_result_status: null }), "needsPerson");
    expect(screen.getByRole("button", { name: /APPROVE DBS/ })).toBeDisabled();
    expect(screen.getByText(/Needs an Update Service pass/)).toBeInTheDocument();
  });

  it("PDF shows Open PDF, image shows zoom", () => {
    const { unmount } = open(check({ is_pdf: true, certificate_url: "https://storage.test/signed/u1/page1.pdf" }));
    expect(screen.getByRole("button", { name: /Open PDF/ })).toBeInTheDocument();
    expect(screen.queryByAltText("DBS certificate page 1")).toBeNull();
    unmount();
    open(check());
    fireEvent.click(screen.getByAltText("DBS certificate page 1"));
    expect(screen.getByAltText("Enlarged certificate")).toBeInTheDocument();
  });

  it("Ask for page 2 only when content continues", () => {
    const { unmount } = open(check());
    expect(screen.queryByRole("button", { name: /Ask for page 2/ })).toBeNull();
    unmount();
    open(check({ ocg_result_status: "NON_BLANK_NO_NEW_INFO" }));
    fireEvent.click(screen.getByRole("button", { name: /Ask for page 2/ }));
    expect(screen.getByText(/contact:Your DBS certificate — page 2/)).toBeInTheDocument();
  });

  it("no OCG text anywhere in the modal", () => {
    const { container } = open(check());
    expect(container.ownerDocument.body.textContent).not.toMatch(/OCG/);
  });

  it("Reject needs a reason; the DBS chips fill it", async () => {
    open(check());
    fireEvent.click(screen.getByRole("button", { name: /^REJECT$/ }));
    const yes = screen.getByRole("button", { name: /Yes, reject/ });
    expect(yes).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Your DBS certificate image is unclear or unreadable" }));
    expect(yes).toBeEnabled();
    fireEvent.click(yes);
    await waitFor(() => expect(h.adminRejectWWCC).toHaveBeenCalledWith("v1", "Your DBS certificate image is unclear or unreadable"));
  });

  it("list C is read-only: no Approve, Run DBS check now live", async () => {
    open(check({ verification_status: 23, wwcc_status: "expired", wwcc_verified_at: "2026-09-01T00:00:00Z" }), "recheckAlerts");
    expect(screen.queryByRole("button", { name: /APPROVE DBS/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Run DBS check now/ }));
    await waitFor(() => expect(h.adminRunDbsCheck).toHaveBeenCalledWith("v1"));
  });

  it("list D shows only Lift bar", async () => {
    open(check({ verification_status: 27, wwcc_status: "barred" }), "barred");
    expect(screen.queryByRole("button", { name: /APPROVE DBS/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^REJECT$/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Run DBS check now/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /LIFT BAR/ }));
    fireEvent.click(screen.getByRole("button", { name: /Yes, lift/ }));
    await waitFor(() => expect(h.adminLiftDbsBar).toHaveBeenCalledWith("v1"));
  });

  it("Run DBS check now is disabled with the reason when number, surname or DOB is missing", () => {
    open(check({ extracted_wwcc_dob: null }));
    expect(screen.getByRole("button", { name: /Run DBS check now/ })).toBeDisabled();
    expect(screen.getByText(/certificate number, surname and date of birth/)).toBeInTheDocument();
  });
});
