/**
 * BAI's deposit-link operations (plan 03 row A5, §3 "Link"; brief 03 §3 admin 3–4). One open link per family with a
 * stable code: get-or-create returns the same code every time, mints a 43-character code only when none is open, and
 * re-reads on the unique conflict a concurrent press causes. An open link made for another target (or another goodwill
 * pin) is handed back unchanged as `target_differs`, never as `ok`. Cancel ends the link, so the next send makes a new
 * code.
 * Every admin operation refuses a non-proof before any read; logs carry an error code only — never the code value.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const gate = vi.hoisted(() => ({ result: { userId: "a0300000-0000-4000-8000-000000000031", error: null as string | null } }));
vi.mock("@/lib/admin/require-admin", () => ({ requireAdmin: async () => gate.result }));

import { proveAdmin, type AdminProof } from "@/lib/calls/admin-proof";
import { SITE_URL } from "@/lib/constants";
import { fakeAdmin, writesTo, type FakeAdmin, type Op } from "@/lib/payments/fake-admin.test-util";
import { isDepositCode } from "./code";
import { EMAIL_MAX } from "./constants";
import { cancelOpenLink, depositLinkUrl, getOrCreateOpenLink, stampLinkOpened, stampLinkSent } from "./links";
import { proveDepositCode, type DepositParentProof } from "./proof";

const ADMIN = "a0300000-0000-4000-8000-000000000031";
const PARENT = "b0300000-0000-4000-8000-000000000011";
const LINK = "d0300000-0000-4000-8000-000000000011";
const CODE = "Ab0_-".repeat(8) + "xyz";
const OTHER_CODE = "Zz9-_".repeat(8) + "abc";

const linkRow = (over: Record<string, unknown> = {}) => ({
  id: LINK,
  parent_user_id: PARENT,
  code: CODE,
  state: "open",
  target: "current",
  goodwill_cohort_start_date: null,
  last_emailed_at: null,
  last_emailed_to: null,
  last_opened_at: null,
  created_at: "2027-01-25T10:00:00+00:00",
  ...over,
});

const CURRENT = { parentUserId: PARENT, target: "current", goodwillStartDate: null } as const;
const GOODWILL_A = { parentUserId: PARENT, target: "goodwill", goodwillStartDate: "2027-02-08" } as const;
const GOODWILL_B = { parentUserId: PARENT, target: "goodwill", goodwillStartDate: "2027-02-15" } as const;

let admin: AdminProof;
let fake: FakeAdmin;
let log: ReturnType<typeof vi.spyOn>;
beforeEach(async () => {
  log = vi.spyOn(console, "error").mockImplementation(() => {});
  log.mockClear();
  const p = await proveAdmin();
  if (!p) throw new Error("no admin proof");
  admin = p;
  fake = fakeAdmin();
});

const LOOK_ALIKE = Object.freeze({ kind: "admin_proof", userId: ADMIN }) as unknown as AdminProof;
const logged = () => JSON.stringify(log.mock.calls);

describe("getOrCreateOpenLink — refusals before any read", () => {
  it("a look-alike admin proof → invalid with zero database calls", async () => {
    expect(await getOrCreateOpenLink(LOOK_ALIKE, fake.client, CURRENT)).toEqual({ status: "invalid" });
    expect(fake.ops).toHaveLength(0);
  });

  it.each([
    ["a parent that isn't a uuid", { ...CURRENT, parentUserId: "nope" }],
    ["current with a date", { ...CURRENT, goodwillStartDate: "2027-02-08" }],
    ["goodwill without a date", { parentUserId: PARENT, target: "goodwill", goodwillStartDate: null }],
    ["goodwill with a non-date", { parentUserId: PARENT, target: "goodwill", goodwillStartDate: "2027-02-30" }],
    ["an unknown target", { parentUserId: PARENT, target: "next", goodwillStartDate: null }],
  ])("%s → invalid with zero database calls", async (_label, req) => {
    expect(await getOrCreateOpenLink(admin, fake.client, req as never)).toEqual({ status: "invalid" });
    expect(fake.ops).toHaveLength(0);
  });
});

describe("getOrCreateOpenLink — the same code every time", () => {
  it("an open link → that link, unchanged, from one bounded read (no insert)", async () => {
    fake.reads.deposit_links = linkRow({ last_emailed_at: "2027-01-26T14:02:00+00:00", last_emailed_to: "sarah@example.com" });
    const r = await getOrCreateOpenLink(admin, fake.client, CURRENT);
    expect(r).toEqual({
      status: "ok",
      created: false,
      link: {
        id: LINK, parentUserId: PARENT, code: CODE, state: "open", target: "current", goodwillStartDate: null,
        lastEmailedAt: "2027-01-26T14:02:00+00:00", lastEmailedTo: "sarah@example.com", lastOpenedAt: null,
        createdAt: "2027-01-25T10:00:00+00:00",
      },
    });
    expect(fake.ops).toHaveLength(1);
    expect(fake.ops[0]).toMatchObject({ table: "deposit_links", kind: "select" });
    expect(fake.ops[0].filters).toEqual([["eq", "parent_user_id", PARENT], ["eq", "state", "open"]]);
    expect(Object.isFrozen(r)).toBe(true);
    if (r.status === "ok") expect(Object.isFrozen(r.link)).toBe(true);
  });

  it("an open goodwill link asked for with the same pin → ok, that link, and zero writes", async () => {
    fake.reads.deposit_links = linkRow({ target: "goodwill", goodwill_cohort_start_date: "2027-02-08" });
    const r = await getOrCreateOpenLink(admin, fake.client, GOODWILL_A);
    expect(r).toMatchObject({ status: "ok", created: false, link: { code: CODE, target: "goodwill", goodwillStartDate: "2027-02-08" } });
    expect(writesTo(fake, "deposit_links")).toHaveLength(0);
  });

  it("no open link → inserts one with a fresh 43-character code, made by this admin", async () => {
    fake.reads.deposit_links = null;
    fake.writeResults.deposit_links = (op: Op) => linkRow({ code: (op.payload as { code: string }).code });
    const r = await getOrCreateOpenLink(admin, fake.client, { parentUserId: PARENT, target: "goodwill", goodwillStartDate: "2027-02-08" });
    const [ins] = writesTo(fake, "deposit_links");
    expect(ins.kind).toBe("insert");
    const payload = ins.payload as Record<string, unknown>;
    expect(payload).toEqual({
      parent_user_id: PARENT,
      code: expect.any(String),
      state: "open",
      target: "goodwill",
      goodwill_cohort_start_date: "2027-02-08",
      created_by: ADMIN,
    });
    expect(isDepositCode(payload.code)).toBe(true);
    expect(r).toMatchObject({ status: "ok", created: true, link: { code: payload.code } });
  });

  it("two creations make two different codes (randomBytes, never a counter)", async () => {
    fake.reads.deposit_links = null;
    fake.writeResults.deposit_links = (op: Op) => linkRow({ code: (op.payload as { code: string }).code });
    await getOrCreateOpenLink(admin, fake.client, CURRENT);
    await getOrCreateOpenLink(admin, fake.client, CURRENT);
    const [a, b] = writesTo(fake, "deposit_links").map((o) => (o.payload as { code: string }).code);
    expect(a).not.toBe(b);
  });

  it("the unique conflict (a concurrent press made one first) → re-reads and returns that link", async () => {
    let reads = 0;
    fake.reads.deposit_links = () => (reads++ === 0 ? null : linkRow({ code: OTHER_CODE }));
    fake.writeErrors.deposit_links = { message: "duplicate key value", code: "23505" };
    const r = await getOrCreateOpenLink(admin, fake.client, CURRENT);
    expect(r).toMatchObject({ status: "ok", created: false, link: { code: OTHER_CODE } });
    expect(fake.ops.map((o) => o.kind)).toEqual(["select", "insert", "select"]);
    expect(log).not.toHaveBeenCalled();
  });

  it("the unique conflict, and still no open link on the re-read → error", async () => {
    fake.reads.deposit_links = null;
    fake.writeErrors.deposit_links = { message: "duplicate key value", code: "23505" };
    expect(await getOrCreateOpenLink(admin, fake.client, CURRENT)).toEqual({ status: "error" });
  });
});

describe("getOrCreateOpenLink — the open link was made for another target (03b decides: send as is, or cancel)", () => {
  it.each([
    ["current → goodwill", linkRow(), GOODWILL_A],
    ["goodwill → current", linkRow({ target: "goodwill", goodwill_cohort_start_date: "2027-02-08" }), CURRENT],
    ["goodwill pin A → pin B", linkRow({ target: "goodwill", goodwill_cohort_start_date: "2027-02-08" }), GOODWILL_B],
  ])("%s → target_differs with the open link unchanged (same code), and zero writes", async (_label, row, req) => {
    fake.reads.deposit_links = row;
    const r = await getOrCreateOpenLink(admin, fake.client, req);
    expect(r).toMatchObject({
      status: "target_differs",
      link: { code: CODE, target: row.target, goodwillStartDate: row.goodwill_cohort_start_date },
    });
    expect(r).not.toHaveProperty("created");
    expect(Object.isFrozen(r)).toBe(true);
    expect(fake.ops.map((o) => o.kind)).toEqual(["select"]);
    expect(writesTo(fake, "deposit_links")).toHaveLength(0);
  });

  it("the unique conflict's re-read finds a link for another target → target_differs", async () => {
    let reads = 0;
    fake.reads.deposit_links = () => (reads++ === 0 ? null : linkRow({ code: OTHER_CODE }));
    fake.writeErrors.deposit_links = { message: "duplicate key value", code: "23505" };
    const r = await getOrCreateOpenLink(admin, fake.client, GOODWILL_A);
    expect(r).toMatchObject({ status: "target_differs", link: { code: OTHER_CODE, target: "current" } });
  });
});

describe("getOrCreateOpenLink — failures are error, logged by code only", () => {
  it("a read error → error, logged with its code and never the message", async () => {
    fake.readErrors.deposit_links = { message: "secret detail", code: "XX000" };
    expect(await getOrCreateOpenLink(admin, fake.client, CURRENT)).toEqual({ status: "error" });
    expect(logged()).toContain("XX000");
    expect(logged()).not.toContain("secret detail");
  });

  it("an insert error other than the conflict → error; the minted code is never logged", async () => {
    fake.reads.deposit_links = null;
    fake.writeErrors.deposit_links = { message: "boom", code: "23514" };
    expect(await getOrCreateOpenLink(admin, fake.client, CURRENT)).toEqual({ status: "error" });
    const code = (writesTo(fake, "deposit_links")[0].payload as { code: string }).code;
    expect(logged()).toContain("23514");
    expect(logged()).not.toContain(code);
  });

  it.each([
    ["a malformed code", linkRow({ code: "short" })],
    ["a goodwill link with no date", linkRow({ target: "goodwill" })],
    ["an unknown state", linkRow({ state: "lost" })],
  ])("a row that doesn't fit (%s) → error, and the row's code is not logged", async (_label, row) => {
    fake.reads.deposit_links = row;
    expect(await getOrCreateOpenLink(admin, fake.client, CURRENT)).toEqual({ status: "error" });
    expect(logged()).toContain("unexpected_row");
    expect(logged()).not.toContain(CODE);
  });

  it("a throw → error", async () => {
    const broken = { from: () => { throw new TypeError("kaput"); } } as unknown as FakeAdmin["client"];
    expect(await getOrCreateOpenLink(admin, broken, CURRENT)).toEqual({ status: "error" });
    expect(logged()).toContain("TypeError");
  });
});

describe("cancelOpenLink", () => {
  it("a look-alike proof or a bad parent → invalid with zero database calls", async () => {
    expect(await cancelOpenLink(LOOK_ALIKE, fake.client, PARENT)).toEqual({ status: "invalid" });
    expect(await cancelOpenLink(admin, fake.client, "nope")).toEqual({ status: "invalid" });
    expect(fake.ops).toHaveLength(0);
  });

  it("cancels the family's open link: state, when and by whom", async () => {
    fake.writeResults.deposit_links = [{ id: LINK }];
    expect(await cancelOpenLink(admin, fake.client, PARENT)).toEqual({ status: "cancelled" });
    const [up] = writesTo(fake, "deposit_links");
    expect(up.kind).toBe("update");
    expect(up.payload).toEqual({ state: "cancelled", cancelled_at: expect.any(String), cancelled_by: ADMIN });
    expect(up.filters).toEqual([["eq", "parent_user_id", PARENT], ["eq", "state", "open"]]);
  });

  it("no open link → none", async () => {
    fake.writeResults.deposit_links = [];
    expect(await cancelOpenLink(admin, fake.client, PARENT)).toEqual({ status: "none" });
  });

  it("a write error → error", async () => {
    fake.writeErrors.deposit_links = { message: "boom", code: "40001" };
    expect(await cancelOpenLink(admin, fake.client, PARENT)).toEqual({ status: "error" });
  });

  it("after a cancel, the next get-or-create mints a new code", async () => {
    fake.writeResults.deposit_links = [{ id: LINK }];
    await cancelOpenLink(admin, fake.client, PARENT);
    const next = fakeAdmin({ deposit_links: null });
    next.writeResults.deposit_links = (op: Op) => linkRow({ code: (op.payload as { code: string }).code });
    const r = await getOrCreateOpenLink(admin, next.client, CURRENT);
    expect(r).toMatchObject({ status: "ok", created: true });
    if (r.status === "ok") expect(r.link.code).not.toBe(CODE);
  });
});

describe("stampLinkSent", () => {
  it("records when and to which address the link was last emailed", async () => {
    fake.writeResults.deposit_links = [{ id: LINK }];
    expect(await stampLinkSent(admin, fake.client, { linkId: LINK, to: " sarah@example.com " })).toEqual({ status: "stamped" });
    const [up] = writesTo(fake, "deposit_links");
    expect(up.payload).toEqual({ last_emailed_at: expect.any(String), last_emailed_to: "sarah@example.com" });
    expect(up.filters).toEqual([["eq", "id", LINK]]);
  });

  it.each([
    ["a look-alike proof", LOOK_ALIKE, { linkId: LINK, to: "a@b.co" }],
    ["a bad link id", null, { linkId: "nope", to: "a@b.co" }],
    ["an empty address", null, { linkId: LINK, to: "   " }],
    ["an address over the limit", null, { linkId: LINK, to: `${"a".repeat(EMAIL_MAX)}@b.co` }],
    ["a non-string address", null, { linkId: LINK, to: 42 }],
  ])("%s → invalid with zero database calls", async (_label, proof, req) => {
    expect(await stampLinkSent(proof ?? admin, fake.client, req as never)).toEqual({ status: "invalid" });
    expect(fake.ops).toHaveLength(0);
  });

  it("no such link → not_found; a write error → error (address not logged)", async () => {
    fake.writeResults.deposit_links = [];
    expect(await stampLinkSent(admin, fake.client, { linkId: LINK, to: "sarah@example.com" })).toEqual({ status: "not_found" });
    const failing = fakeAdmin();
    failing.writeErrors.deposit_links = { message: "boom", code: "40001" };
    expect(await stampLinkSent(admin, failing.client, { linkId: LINK, to: "sarah@example.com" })).toEqual({ status: "error" });
    expect(logged()).not.toContain("sarah@example.com");
  });
});

describe("stampLinkOpened — the parent's page, with her proof", () => {
  async function parentProof(): Promise<DepositParentProof> {
    const links = fakeAdmin({ deposit_links: linkRow() });
    const proven = await proveDepositCode(links.client, CODE);
    if (!proven.ok) throw new Error("no deposit proof");
    return proven.proof;
  }

  it("stamps last_opened_at on the proven link of the proven parent", async () => {
    const proof = await parentProof();
    fake.writeResults.deposit_links = [{ id: LINK }];
    expect(await stampLinkOpened(fake.client, proof)).toEqual({ status: "stamped" });
    const [up] = writesTo(fake, "deposit_links");
    expect(up.payload).toEqual({ last_opened_at: expect.any(String) });
    expect(up.filters).toEqual([["eq", "id", LINK], ["eq", "parent_user_id", PARENT]]);
  });

  it("a look-alike proof → invalid with zero database calls", async () => {
    const fakeProof = Object.freeze({ kind: "deposit_parent_proof", parentUserId: PARENT, linkId: LINK }) as unknown as DepositParentProof;
    expect(await stampLinkOpened(fake.client, fakeProof)).toEqual({ status: "invalid" });
    expect(fake.ops).toHaveLength(0);
  });

  it("a write error → error", async () => {
    const proof = await parentProof();
    fake.writeErrors.deposit_links = { message: "boom", code: "40001" };
    expect(await stampLinkOpened(fake.client, proof)).toEqual({ status: "error" });
  });
});

describe("depositLinkUrl", () => {
  it("is the site's /deposit/<code>, nothing after it", () => {
    expect(depositLinkUrl(CODE)).toBe(`${SITE_URL}/deposit/${CODE}`);
  });

  it("refuses anything that isn't a deposit code", () => {
    expect(() => depositLinkUrl("short")).toThrow(RangeError);
    expect(() => depositLinkUrl(`${CODE}/../admin`)).toThrow(RangeError);
  });
});
