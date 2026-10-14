/**
 * W6-D4 / dispatch D3 (3w6fix, BB-LDN-3w6fix-141026) — the admin Contact User picker sends a local part only.
 * The client bundle cannot read `EMAIL_FROM_DOMAIN`, so a domain built in the browser is the wrong one wherever the
 * From host differs from the site domain; the server builds the address (`adminFromAddress`) and validates it.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const h = vi.hoisted(() => ({
  adminSendEmail: vi.fn(async () => ({ success: true, error: null as string | null })),
}));
vi.mock("@/lib/actions/admin", () => ({ adminSendEmail: h.adminSendEmail }));

import { ContactUserModal } from "./ContactUserModal";
import { ADMIN_FROM_LOCAL_PARTS } from "@/lib/constants";

function open(props: Partial<Parameters<typeof ContactUserModal>[0]> = {}) {
  return render(
    <ContactUserModal
      userEmail="sophie.taylor+3w6fix@example.test"
      userName="Sophie Taylor"
      userId="nanny-u"
      open
      onOpenChange={() => {}}
      defaultSubject="Your DBS certificate — page 2"
      defaultBody="Please reply with a photo of page 2."
      {...props}
    />,
  );
}

beforeEach(() => vi.clearAllMocks());

describe("ContactUserModal — From picker (W6-D4)", () => {
  it("offers every listed local part and no domain", () => {
    open();
    const options = screen.getAllByRole("option").map((o) => (o as HTMLOptionElement).value);
    expect(options).toEqual([...ADMIN_FROM_LOCAL_PARTS]);
    for (const o of screen.getAllByRole("option")) expect(o.textContent).toMatch(/^[a-z]+@$/);
  });

  it("sends the chosen local part, never an address", async () => {
    open({ logActionType: "dbs_page2_requested" });
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "verification" } });
    fireEvent.click(screen.getByRole("button", { name: /send/i }));
    await waitFor(() => expect(h.adminSendEmail).toHaveBeenCalledTimes(1));
    expect(h.adminSendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ fromLocalPart: "verification", logActionType: "dbs_page2_requested" }),
    );
    expect(JSON.stringify(h.adminSendEmail.mock.calls[0])).not.toContain('"fromAddress"');
  });
});
