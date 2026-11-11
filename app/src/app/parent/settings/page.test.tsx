/**
 * /parent/settings (server): the profile read adds the row's version (`updated_at`), and the client gets it — null
 * when the row has none — so her Save can send the version she loaded. Everything else the page reads and passes is
 * unchanged.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { type ReactElement } from "react";

const h = vi.hoisted(() => ({
  user: { id: "p0000000-0000-4000-8000-000000000001" } as { id: string } | null,
  selects: [] as string[],
  profileRow: null as Record<string, unknown> | null,
  children: [] as unknown[],
}));

vi.mock("next/navigation", () => ({ redirect: (to: string) => { throw new Error(`REDIRECT ${to}`); } }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: () => ({ auth: { getUser: async () => ({ data: { user: h.user }, error: null }) } }),
}));
vi.mock("@/lib/supabase/admin", () => {
  const chain = (table: string): Record<string, unknown> => {
    const c: Record<string, unknown> = {};
    for (const f of ["eq", "order"]) c[f] = () => c;
    c.select = (columns: string) => {
      if (table === "user_profiles") h.selects.push(columns);
      return c;
    };
    c.single = async () => ({ data: table === "user_profiles" ? h.profileRow : null, error: null });
    c.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ data: h.children, error: null }).then(resolve);
    return c;
  };
  return { createAdminClient: () => ({ from: chain }) };
});
vi.mock("./ParentSettingsClient", () => ({ ParentSettingsClient: () => null }));

import ParentSettingsPage from "./page";

const VERSION = "2027-02-15T10:00:00.123456+00:00";
const ROW = {
  first_name: "Olivia", last_name: "Hartley", email: "olivia@example.test", mobile_number: "+447700900123",
  date_of_birth: null, suburb: "Clapham", postcode: "SW4", updated_at: VERSION,
};

async function clientProps(): Promise<Record<string, unknown>> {
  const tree = (await ParentSettingsPage()) as ReactElement<Record<string, unknown>>;
  return tree.props;
}

beforeEach(() => {
  h.user = { id: "p0000000-0000-4000-8000-000000000001" };
  h.selects = [];
  h.profileRow = ROW;
  h.children = [];
});

describe("/parent/settings", () => {
  it("reads the row's version with her profile and passes it to the client", async () => {
    const props = await clientProps();
    expect(h.selects).toHaveLength(1);
    expect(h.selects[0]?.split(",").map((c) => c.trim())).toEqual([
      "first_name", "last_name", "email", "mobile_number", "date_of_birth", "suburb", "postcode", "updated_at",
    ]);
    expect(props.profile).toEqual({
      first_name: "Olivia", last_name: "Hartley", email: "olivia@example.test", mobile_number: "+447700900123",
      date_of_birth: "", suburb: "Clapham", postcode: "SW4", updated_at: VERSION,
    });
  });

  it("no version on the row, or no row → null", async () => {
    h.profileRow = { ...ROW, updated_at: null };
    expect((await clientProps()).profile).toMatchObject({ updated_at: null });
    h.profileRow = null;
    expect((await clientProps()).profile).toEqual({
      first_name: "", last_name: "", email: "", mobile_number: "", date_of_birth: "", suburb: "", postcode: "", updated_at: null,
    });
  });

  it("her children are passed on as before", async () => {
    h.children = [{ id: "c1" }];
    expect((await clientProps()).managedChildren).toEqual([{ id: "c1" }]);
  });

  it("signed out → the sign-in page", async () => {
    h.user = null;
    await expect(ParentSettingsPage()).rejects.toThrow("REDIRECT /login");
  });
});
