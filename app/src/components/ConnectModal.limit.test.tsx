/**
 * ConnectModal at the open-request limit.
 *
 * At 5 or more open requests the modal shows a limit view in place of the
 * form: no message box, no Connect button, and no request can be sent. A
 * refusal from the server with the AT_LIMIT code (e.g. a request sent from
 * another tab) lands on the same view. The success line gives the nanny's
 * response window.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ConnectModal } from "./ConnectModal";

const mocks = vi.hoisted(() => ({
  createConnectionRequest: vi.fn(),
}));

vi.mock("@/lib/actions/connection", () => ({
  createConnectionRequest: mocks.createConnectionRequest,
}));

vi.mock("@/lib/legal/record-consent", () => ({
  recordInformedAction: vi.fn(() => Promise.resolve()),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

const NANNY = {
  id: "nanny-1",
  first_name: "alex",
  last_name: "Smith",
  suburb: "Clapham",
  hourly_rate_min: 35,
  profile_picture_url: null,
  date_of_birth: null,
};

const LIMIT_TITLE = "You have 5 open requests";
const LIMIT_BODY =
  "That's the most at one time. To connect with Alex, please step back from one of your other requests first.";

function renderModal(pendingRequestCount: number, onClose = vi.fn()) {
  render(
    <ConnectModal
      isOpen
      onClose={onClose}
      nanny={NANNY}
      pendingRequestCount={pendingRequestCount}
    />,
  );
  return { onClose };
}

function submitForm() {
  const form = document.querySelector("form");
  if (!form) throw new Error("Form not found");
  fireEvent.submit(form);
}

describe("ConnectModal — limit view at 5 open requests", () => {
  beforeEach(() => {
    mocks.createConnectionRequest.mockReset();
    mocks.createConnectionRequest.mockResolvedValue({
      success: true,
      error: null,
    });
  });

  it("shows the limit title and the body with her name", () => {
    renderModal(5);

    expect(
      screen.getByRole("heading", { name: LIMIT_TITLE }),
    ).toBeInTheDocument();
    expect(screen.getByText(LIMIT_BODY)).toBeInTheDocument();
  });

  it("links 'See my requests' to the parent's connections", () => {
    renderModal(5);

    const link = screen.getByRole("link", { name: "See my requests" });
    expect(link).toHaveAttribute("href", "/parent?t=childcare&s=connections");
  });

  it("closes the modal when 'See my requests' is followed (the list can be on the same page)", () => {
    const { onClose } = renderModal(5);

    fireEvent.click(screen.getByRole("link", { name: "See my requests" }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes the modal from 'Not now'", () => {
    const { onClose } = renderModal(5);

    fireEvent.click(screen.getByRole("button", { name: "Not now" }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("shows no form, message box, Connect button or counter", () => {
    renderModal(5);

    expect(document.querySelector("form")).toBeNull();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Connect with/ }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/\d+\/5 ongoing/)).not.toBeInTheDocument();
  });

  it("never sends a request", () => {
    renderModal(5);

    fireEvent.click(screen.getByRole("button", { name: "Not now" }));

    expect(mocks.createConnectionRequest).not.toHaveBeenCalled();
  });

  it("shows the limit view above 5 as well", () => {
    renderModal(6);

    expect(
      screen.getByRole("heading", { name: LIMIT_TITLE }),
    ).toBeInTheDocument();
    expect(document.querySelector("form")).toBeNull();
  });
});

describe("ConnectModal — below the limit", () => {
  beforeEach(() => {
    mocks.createConnectionRequest.mockReset();
  });

  it("shows the form with the counter at 4 open requests", () => {
    renderModal(4);

    expect(screen.getByRole("textbox")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Connect with Alex" }),
    ).toBeEnabled();
    expect(screen.getByText("4/5 ongoing")).toBeInTheDocument();
    expect(screen.queryByText(LIMIT_TITLE)).not.toBeInTheDocument();
  });

  it("shows the limit view when the server refuses at the limit", async () => {
    mocks.createConnectionRequest.mockResolvedValue({
      success: false,
      error: "AT_LIMIT",
    });
    renderModal(4);

    submitForm();

    expect(
      await screen.findByRole("heading", { name: LIMIT_TITLE }),
    ).toBeInTheDocument();
    expect(screen.getByText(LIMIT_BODY)).toBeInTheDocument();
    expect(document.querySelector("form")).toBeNull();
    expect(screen.queryByText(/\d+\/5 ongoing/)).not.toBeInTheDocument();
    expect(mocks.createConnectionRequest).toHaveBeenCalledTimes(1);
  });

  it("reads her count afresh after the limit view is closed", async () => {
    mocks.createConnectionRequest.mockResolvedValue({ success: false, error: "AT_LIMIT" });
    const onClose = vi.fn();
    const { rerender } = render(<ConnectModal isOpen onClose={onClose} nanny={NANNY} pendingRequestCount={4} />);
    submitForm();
    await screen.findByRole("heading", { name: LIMIT_TITLE });
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    rerender(<ConnectModal isOpen={false} onClose={onClose} nanny={NANNY} pendingRequestCount={3} />);
    rerender(<ConnectModal isOpen onClose={onClose} nanny={NANNY} pendingRequestCount={3} />);
    expect(screen.queryByRole("heading", { name: LIMIT_TITLE })).toBeNull();
    expect(document.querySelector("form")).not.toBeNull();
  });

  it("reads her count afresh after the modal is closed by its X", async () => {
    mocks.createConnectionRequest.mockResolvedValue({ success: false, error: "AT_LIMIT" });
    const onClose = vi.fn();
    const { rerender } = render(<ConnectModal isOpen onClose={onClose} nanny={NANNY} pendingRequestCount={4} />);
    submitForm();
    await screen.findByRole("heading", { name: LIMIT_TITLE });
    rerender(<ConnectModal isOpen={false} onClose={onClose} nanny={NANNY} pendingRequestCount={3} />);
    rerender(<ConnectModal isOpen onClose={onClose} nanny={NANNY} pendingRequestCount={3} />);
    expect(screen.queryByRole("heading", { name: LIMIT_TITLE })).toBeNull();
  });

  it("tells the parent she has 7 days to respond after a request is sent", async () => {
    mocks.createConnectionRequest.mockResolvedValue({
      success: true,
      error: null,
      requestId: "req-1",
    });
    renderModal(0);

    submitForm();

    const days = await screen.findByText("7 days");
    expect(days.parentElement).toHaveTextContent(
      "Alex has 7 days to respond to your request.",
    );
    expect(screen.queryByText("3 days")).not.toBeInTheDocument();
  });
});
