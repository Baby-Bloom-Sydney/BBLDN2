// @vitest-environment node
/**
 * Every writer of a nanny's profile text stores it with only the formatting tags kept (`safeHtml`), whatever the
 * browser or the model sends.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;
const h = vi.hoisted(() => ({
  rows: {} as Record<string, Row | Row[] | null>,
  updates: [] as Array<{ table: string; row: Row }>,
  modelOutput: "",
}));

function builder(table: string) {
  const one = () => {
    const r = h.rows[table];
    return Promise.resolve({ data: Array.isArray(r) ? (r[0] ?? null) : (r ?? null), error: null });
  };
  const b: Record<string, unknown> = {};
  for (const name of ["select", "eq", "is", "in", "neq", "order", "limit", "or", "gte", "lte", "not"]) b[name] = () => b;
  b.single = one;
  b.maybeSingle = one;
  b.update = (row: Row) => {
    h.updates.push({ table, row });
    return b;
  };
  b.then = (resolve: (v: unknown) => unknown) => {
    const r = h.rows[table];
    return resolve({ data: Array.isArray(r) ? r : r ? [r] : [], error: null });
  };
  return b;
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: () => ({
    auth: { getUser: async () => ({ data: { user: { id: "user-1" } }, error: null }) },
    from: (t: string) => builder(t),
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: (t: string) => builder(t) }) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/admin/require-admin", () => ({ requireAdmin: async () => ({ userId: "admin-1", error: null }) }));
vi.mock("@/lib/ai/client", () => ({
  openai: { chat: { completions: { create: async () => ({ choices: [{ message: { content: h.modelOutput } }] }) } } },
}));

import { updateNannyAIContent, regenerateNannyAIContent } from "./nanny";
import { adminRegenerateNannyBio } from "./admin";
import { updateNannyLead } from "./nanny-leads";
import { generateOnboardingAIContent } from "./nanny-onboarding-ai";

const BAD = "<img src=x onerror=alert(1)>";
const MODEL_OUTPUT = [
  `<headline>Warm ${BAD}</headline>`,
  `<about><p>About</p><script>x()</script></about>`,
  `<personality><p onclick="x()">Kind</p></personality>`,
  `<values><p>Values</p></values>`,
  `<background><p>Background</p><svg onload=1></svg></background>`,
  `<what_i_offer><p>Offer</p></what_i_offer>`,
  `<experience><p>Experience</p><a href="javascript:x()">x</a></experience>`,
  `<bio>Pitch<br>${BAD}</bio>`,
].join("\n");

/** Every string anywhere in a stored value. */
function strings(v: unknown): string[] {
  if (typeof v === "string") return [v];
  if (Array.isArray(v)) return v.flatMap(strings);
  if (v && typeof v === "object") return Object.values(v).flatMap(strings);
  return [];
}
/** No tag but the bare formatting tags, and no comment (a `<` that starts no tag is text, kept as typed). */
function onlyFormatting(v: unknown) {
  for (const s of strings(v)) {
    const tags = s.match(/<\/?[a-zA-Z][^>]*>/g) ?? [];
    expect(tags.every((t) => /^<\/?(p|br|strong|b|em|i)>$/.test(t)), s).toBe(true);
    expect(s).not.toContain("<!--");
  }
}
const written = (table: string) => h.updates.filter((u) => u.table === table).map((u) => u.row);

const NANNY: Row = {
  id: "nanny-1", user_id: "user-1", ai_content: {}, last_regenerated_at: null, childcare_roles: [], certificates: [],
  personality_traits: [], role_types_preferred: [], level_of_support_offered: [], languages: [],
};
const PROFILE: Row = { first_name: "Nia", last_name: "Hale", date_of_birth: "1995-01-01", suburb: "Balham" };

beforeEach(() => {
  h.updates.length = 0;
  h.modelOutput = MODEL_OUTPUT;
  h.rows = { nannies: NANNY, user_profiles: PROFILE, nanny_credentials: [], nanny_assurances: [] };
});

describe("profile text writers store only the formatting tags", () => {
  it("her own edit (updateNannyAIContent), keeping her formatting tags", async () => {
    const res = await updateNannyAIContent("nanny-1", {
      headline: `Calm ${BAD}`,
      bio_summary: { about: "<p>First</p><p>Second</p><script>x()</script>" },
    });
    expect(res.success).toBe(true);
    const [row] = written("nannies");
    onlyFormatting(row.ai_content);
    expect((row.ai_content as { bio_summary: { about: string } }).bio_summary.about).toBe("<p>First</p><p>Second</p>");
  });

  it("the regenerated profile (regenerateNannyAIContent)", async () => {
    const res = await regenerateNannyAIContent();
    expect(res.success).toBe(true);
    const row = written("nannies").find((r) => r.ai_content);
    expect(row).toBeDefined();
    onlyFormatting(row?.ai_content);
  });

  it("the admin's regeneration (adminRegenerateNannyBio)", async () => {
    const res = await adminRegenerateNannyBio("user-1");
    expect(res.success).toBe(true);
    const row = written("nannies").find((r) => r.ai_content);
    expect(row).toBeDefined();
    onlyFormatting(row?.ai_content);
  });

  it("the applicant's generated profile (generateOnboardingAIContent), stored and returned", async () => {
    h.rows.nanny_leads = { id: "lead-1", first_name: "Nia", residency: {}, experience: {}, preferences: {}, matching: {}, about_you: {}, salary: {}, availability: {}, qualifications: {} };
    const res = await generateOnboardingAIContent("lead-1");
    expect(res.success).toBe(true);
    const row = written("nanny_leads").find((r) => r.ai_content);
    onlyFormatting(row?.ai_content);
    onlyFormatting(row?.ai_bio);
    onlyFormatting((res as { aiContent?: unknown }).aiContent);
    onlyFormatting((res as { bio?: unknown }).bio);
  });

  it("the applicant's lead update (updateNannyLead)", async () => {
    const res = await updateNannyLead("lead-1", { ai_bio: `Pitch ${BAD}`, ai_content: { headline: BAD, bio_summary: { about: "<p>a</p>" } } });
    expect(res.success).toBe(true);
    const [row] = written("nanny_leads");
    onlyFormatting(row.ai_content);
    onlyFormatting(row.ai_bio);
    expect((row.ai_content as { bio_summary: { about: string } }).bio_summary.about).toBe("<p>a</p>");
  });
});

describe("profile text typed with < and > is stored exactly as typed", () => {
  const TYPED_HEADLINE = "Kids <5 · 2 > 1 · <3";
  const TYPED_ABOUT = "<p>Kids <5</p><p>2 > 1</p><p><3</p>";

  it("her own edit (updateNannyAIContent)", async () => {
    await updateNannyAIContent("nanny-1", { headline: TYPED_HEADLINE, bio_summary: { about: TYPED_ABOUT }, tags: ["<3", "2 > 1"] });
    const [row] = written("nannies");
    const stored = row.ai_content as { headline: string; bio_summary: { about: string }; tags: string[] };
    expect(stored.headline).toBe(TYPED_HEADLINE);
    expect(stored.bio_summary.about).toBe(TYPED_ABOUT);
    expect(stored.tags).toEqual(["<3", "2 > 1"]);
  });

  it("the applicant's generated profile (generateOnboardingAIContent): stored and returned as written", async () => {
    h.modelOutput = `<headline>${TYPED_HEADLINE}</headline><about>${TYPED_ABOUT}</about><bio>Pitch <3</bio>`;
    h.rows.nanny_leads = { id: "lead-1", first_name: "Nia", residency: {}, experience: {}, preferences: {}, matching: {}, about_you: {}, salary: {}, availability: {}, qualifications: {} };
    const res = (await generateOnboardingAIContent("lead-1")) as unknown as { aiContent: { headline: string; bio_summary: { about: string } }; bio: string };
    expect(res.aiContent.headline).toBe(TYPED_HEADLINE);
    expect(res.aiContent.bio_summary.about).toBe(TYPED_ABOUT);
    expect(res.bio).toBe("Pitch <3");
    const row = written("nanny_leads").find((r) => r.ai_content);
    expect((row?.ai_content as { headline: string }).headline).toBe(TYPED_HEADLINE);
  });

  it("the regenerated profile (regenerateNannyAIContent)", async () => {
    h.modelOutput = `<headline>${TYPED_HEADLINE}</headline><about>${TYPED_ABOUT}</about>`;
    await regenerateNannyAIContent();
    const row = written("nannies").find((r) => r.ai_content);
    expect((row?.ai_content as { headline: string }).headline).toBe(TYPED_HEADLINE);
    expect((row?.ai_content as { bio_summary: { about: string } }).bio_summary.about).toBe(TYPED_ABOUT);
  });

  it("the applicant's lead update (updateNannyLead)", async () => {
    await updateNannyLead("lead-1", { ai_bio: "Pitch <3", ai_content: { headline: TYPED_HEADLINE } });
    const [row] = written("nanny_leads");
    expect(row.ai_bio).toBe("Pitch <3");
    expect((row.ai_content as { headline: string }).headline).toBe(TYPED_HEADLINE);
  });
});
