// @vitest-environment node
/**
 * The development-image upload stores a picture only for a child the signed-in user is linked to (its parent or
 * nanny); anyone else gets "Child not found" before the consent check or any storage write.
 *
 * BB-wave1-041126, 2026-11-09.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { fakeAdmin, type FakeAdmin } from "@/lib/payments/fake-admin.test-util";

let admin: FakeAdmin;
const h = vi.hoisted(() => ({ consent: vi.fn(), upload: vi.fn() }));

vi.mock("@/lib/supabase/server", () => ({
  createClient: () => ({ auth: { getUser: async () => ({ data: { user: { id: "u-other" } }, error: null }) } }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ ...admin.client, from: admin.client.from, storage: { from: () => ({ upload: h.upload, getPublicUrl: () => ({ data: { publicUrl: "x" } }) }) } }),
}));
vi.mock("@/lib/legal/media-consent-gate", () => ({ hasParentMediaConsent: h.consent }));

import { POST } from "./route";

function upload(): NextRequest {
  const form = new FormData();
  form.append("file", new File([new Uint8Array([1, 2, 3])], "photo.jpg", { type: "image/jpeg" }));
  form.append("childId", "c-1");
  return new NextRequest("http://localhost/api/upload/development-image", { method: "POST", body: form });
}

beforeEach(() => {
  admin = fakeAdmin({ child_client: { id: "c-1", parent_user_id: "u-parent", nanny_user_id: "u-nanny" } });
  h.consent.mockReset().mockResolvedValue({ allowed: true, state: "active" });
  h.upload.mockReset().mockResolvedValue({ data: { path: "c-1/x.jpg" }, error: null });
});

describe("development-image upload — the child's parent or nanny only", () => {
  it("refuses someone not linked to the child before the consent check or any write", async () => {
    const res = await POST(upload());
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Child not found" });
    expect(h.consent).not.toHaveBeenCalled();
    expect(h.upload).not.toHaveBeenCalled();
  });
});
