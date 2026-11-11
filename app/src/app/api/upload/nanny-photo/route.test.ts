// @vitest-environment node
/**
 * The funnel's photo upload stores a picture only for an applicant's lead that has no account yet, or for a signed-in
 * nanny; anyone else is refused before any storage write. The type and size rules, the object path
 * (`leads/anonymous/<time>-<name>`), the content type and the public URL are the ones below.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { fakeAdmin, type FakeAdmin } from "@/lib/payments/fake-admin.test-util";

let admin: FakeAdmin;
const h = vi.hoisted(() => ({ upload: vi.fn(), user: null as { id: string } | null }));

vi.mock("@/lib/supabase/server", () => ({
  createClient: () => ({ auth: { getUser: async () => ({ data: { user: h.user }, error: null }) } }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    ...admin.client,
    from: admin.client.from,
    storage: { from: () => ({ upload: h.upload, getPublicUrl: (p: string) => ({ data: { publicUrl: `https://storage.test/${p}` } }) }) },
  }),
}));

import { POST } from "./route";

const LEAD = "5e1c0000-0000-4000-8000-000000000042";

function request(fields: Record<string, string | File>): NextRequest {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  return new NextRequest("http://localhost/api/upload/nanny-photo", { method: "POST", body: form });
}
const photo = (name = "me.jpg", type = "image/jpeg", bytes = 3) => new File([new Uint8Array(bytes)], name, { type });

beforeEach(() => {
  admin = fakeAdmin({});
  h.user = null;
  h.upload.mockReset().mockResolvedValue({ data: { path: "x" }, error: null });
});

describe("nanny-photo upload — who may upload", () => {
  it("refuses a caller with no lead and no sign-in, before any write", async () => {
    const res = await POST(request({ file: photo() }));
    expect(res.status).toBe(401);
    expect(h.upload).not.toHaveBeenCalled();
  });

  it("refuses a lead id that isn't one", async () => {
    const res = await POST(request({ file: photo(), leadId: "anonymous" }));
    expect(res.status).toBe(401);
    expect(h.upload).not.toHaveBeenCalled();
  });

  it("refuses a lead that doesn't exist or already has an account (the read asks for no account)", async () => {
    admin.reads.nanny_leads = null;
    const res = await POST(request({ file: photo(), leadId: LEAD }));
    expect(res.status).toBe(401);
    expect(h.upload).not.toHaveBeenCalled();
    const read = admin.ops.find((o) => o.table === "nanny_leads");
    expect(read?.filters).toEqual(expect.arrayContaining([["eq", "id", LEAD], ["is", "auth_user_id", null]]));
  });

  it("refuses a signed-in user who isn't a nanny", async () => {
    h.user = { id: "u-parent" };
    admin.reads.nannies = null;
    const res = await POST(request({ file: photo() }));
    expect(res.status).toBe(401);
    expect(h.upload).not.toHaveBeenCalled();
  });

  it("stores an applicant's photo under leads/anonymous with its own type", async () => {
    admin.reads.nanny_leads = { id: LEAD };
    const res = await POST(request({ file: photo("my photo.jpg"), leadId: LEAD }));
    expect(res.status).toBe(200);
    const [path, , options] = h.upload.mock.calls[0];
    expect(path).toMatch(/^leads\/anonymous\/\d+-my_photo\.jpg$/);
    expect(options).toEqual({ contentType: "image/jpeg", cacheControl: "3600", upsert: false });
    expect(await res.json()).toEqual({ url: `https://storage.test/${path}`, path });
  });

  it("stores a signed-in nanny's photo", async () => {
    h.user = { id: "u-nanny" };
    admin.reads.nannies = { id: "n-1" };
    const res = await POST(request({ file: photo() }));
    expect(res.status).toBe(200);
    expect(h.upload).toHaveBeenCalledTimes(1);
  });
});

describe("nanny-photo upload — the file rules are unchanged", () => {
  beforeEach(() => {
    admin.reads.nanny_leads = { id: LEAD };
  });

  it("refuses a file that isn't an image", async () => {
    const res = await POST(request({ file: photo("a.pdf", "application/pdf"), leadId: LEAD }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "File must be an image" });
  });

  it("refuses an image over 10MB", async () => {
    const res = await POST(request({ file: photo("big.jpg", "image/jpeg", 10 * 1024 * 1024 + 1), leadId: LEAD }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Image must be under 10MB" });
  });

  it("refuses a request with no file", async () => {
    const res = await POST(request({ leadId: LEAD }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "No file provided" });
  });
});
