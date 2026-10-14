/**
 * 3d follow-up (BB-LDN-3dfix-141026), finding 2 — after "Run DBS check now" in the open DBSCheckModal, `router.refresh()`
 * brings new queues, but the modal kept the row it was opened with, so the Update Service badge stayed stale until it
 * was reopened. The open modal must show the refreshed row.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("@/lib/actions/admin", () => ({ adminRejectWWCC: vi.fn(), adminSendEmail: vi.fn() }));
vi.mock("@/lib/actions/admin-dbs", () => ({
  adminVerifyWWCC: vi.fn(),
  adminBarDbs: vi.fn(),
  adminLiftDbsBar: vi.fn(),
  adminRunDbsCheck: vi.fn(),
}));
vi.mock("./ContactUserModal", () => ({ ContactUserModal: () => null }));

import { DbsQueueTab } from "./DbsQueueTab";
import type { DbsQueues, PendingDbsCheck } from "@/lib/admin/dbs-queues";

const row = (over: Partial<PendingDbsCheck> = {}): PendingDbsCheck => ({
  id: "v1", user_id: "u1", verification_status: 21, wwcc_status: "doc_verified", wwcc_status_at: "2026-10-06T10:00:00Z",
  identity_status: "verified",
  cross_check_status: "review", cross_check_reasoning: null, cross_check_issues: null,
  wwcc_user_guidance: null, ocg_result_status: null,
  ocg_result_text: null, ocg_verified_at: null, wwcc_verified_at: null, wwcc_verified_by: null,
  extracted_wwcc_clearance_type: null,
  certificate_url: null, is_pdf: false,
  extracted_wwcc_number: "001234567890", extracted_wwcc_surname: "Taylor", extracted_wwcc_first_name: "Sophie",
  extracted_wwcc_other_names: null, extracted_wwcc_dob: "1990-03-05", extracted_wwcc_expiry: "2024-01-10",
  extracted_surname: "Taylor", extracted_given_names: "Sophie", extracted_dob: "1990-03-05",
  wwcc_ai_reasoning: null, wwcc_ai_issues: null, wwcc_rejection_reason: null,
  first_name: "Sophie", last_name: "Taylor", email: "sophie.taylor+3dfix@example.test", profile_picture_url: null,
  created_at: "2026-10-06T09:00:00Z", history: [], api_down_since: null,
  ...over,
});

const queues = (r: PendingDbsCheck): DbsQueues<PendingDbsCheck> => ({
  awaiting: [], needsPerson: [r], recheckAlerts: [], barred: [], badgeCount: 1,
});

const updateServicePanel = () => {
  const heading = screen.getByRole("heading", { name: "DBS Update Service" });
  return within(heading.closest("div.p-4") as HTMLElement);
};

describe("DbsQueueTab — the open modal follows a refresh", () => {
  it("shows the new Update Service result after the queues refresh, without reopening", () => {
    const { rerender } = render(<DbsQueueTab queues={queues(row())} />);
    fireEvent.click(screen.getByRole("button", { name: "Review" }));
    expect(updateServicePanel().getByText("Not run")).toBeInTheDocument();

    // router.refresh() after Run DBS check now → the server sends the row with the stored result.
    rerender(<DbsQueueTab queues={queues(row({ ocg_result_status: "BLANK_NO_NEW_INFO", ocg_verified_at: "2026-10-14T01:00:00Z" }))} />);

    expect(updateServicePanel().queryByText("Not run")).toBeNull();
    expect(updateServicePanel().getByText(/Clear/)).toBeInTheDocument();
  });

  it("keeps the modal open on the last row it showed when the row leaves every list", () => {
    const { rerender } = render(<DbsQueueTab queues={queues(row())} />);
    fireEvent.click(screen.getByRole("button", { name: "Review" }));
    rerender(<DbsQueueTab queues={{ awaiting: [], needsPerson: [], recheckAlerts: [], barred: [], badgeCount: 0 }} />);
    expect(screen.getByRole("heading", { name: "DBS Update Service" })).toBeInTheDocument();
  });

  it("follows the row into its new list (API-down B → A after the phase passes): Approve becomes available", () => {
    const apiDown = row({ verification_status: 20, cross_check_status: "pending" });
    const { rerender } = render(<DbsQueueTab queues={queues(apiDown)} />);
    fireEvent.click(screen.getByRole("button", { name: "Review" }));
    const passed = row({ verification_status: 30, cross_check_status: "passed", ocg_result_status: "BLANK_NO_NEW_INFO", ocg_verified_at: "2026-10-14T01:00:00Z" });
    rerender(<DbsQueueTab queues={{ awaiting: [passed], needsPerson: [], recheckAlerts: [], barred: [], badgeCount: 1 }} />);
    expect(screen.getByRole("button", { name: /APPROVE DBS/ })).toBeEnabled();
  });
});
