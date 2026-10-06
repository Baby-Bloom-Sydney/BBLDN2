/**
 * verify-dbs — reads page 1 of an enhanced DBS certificate (image or PDF) and decides pass / fail / review (unit 3c).
 * Replaces the certificate reader that came before it. Prompt: LDN2 06-build-drafts/01-verify-dbs-prompt-spec.md §7.
 *
 * The model's `pass` is advisory: the pass rule is enforced here in code (00-RULINGS #4, #5, #37). Invalid model output
 * is an `unreadable` fail (no throw); a transport error from the model client is RE-THROWN so the pipeline's two
 * attempts turn it into TECHNICAL_RETRY.
 *
 * Fixture seam (#29, test-only): with DBS_AI_FIXTURE_MODE=1 the model is not called; the JSON in
 * __fixtures__/dbs-extractions/<uploaded file name>.json goes through the same code rule. Refuses to load in production.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { openai } from "./client";
import { createAdminClient } from "@/lib/supabase/admin";
import { DBS_CERTIFICATE_NUMBER_PATTERN, type UserGuidance } from "@/lib/verification";
import { getDbsConfig } from "@/lib/dbs/config";
import {
  DBS_REASON_GUIDANCE,
  DBS_FALLBACK_GUIDANCE,
  DBS_REVIEW_GUIDANCE,
  type DbsFailReason,
} from "@/lib/dbs/reason-guidance";

if (process.env.DBS_AI_FIXTURE_MODE === "1" && process.env.NODE_ENV === "production") {
  throw new Error("DBS_AI_FIXTURE_MODE must never be set in production");
}

/** Same model as the certificate reader this replaces. */
export const DBS_MODEL = "gpt-5.4-nano";
const REFERENCE_PREFIX = "_reference/";
const FIXTURE_DIR = join("src", "lib", "ai", "__fixtures__", "dbs-extractions");

const BOX = z.enum(["none_recorded", "not_requested", "information", "unreadable"]).nullable().catch(null);
const str = z.string().nullable().catch(null);

const ModelSchema = z.object({
  pass: z.boolean(),
  reason_code: str.optional(),
  extracted: z.object({
    level: str.optional(),
    page: z.number().nullable().catch(null).optional(),
    certificate_number: str.optional(),
    issue_date: str.optional(),
    surname: str.optional(),
    forenames: str.optional(),
    other_names: str.optional(),
    date_of_birth: str.optional(),
    position_applied_for: str.optional(),
    workforce: z.enum(["child", "adult", "child_and_adult", "unknown"]).nullable().catch(null).optional(),
    employer_name: str.optional(),
    registered_body: str.optional(),
    countersignatory: str.optional(),
    police_records: BOX.optional(),
    s142_list: BOX.optional(),
    childrens_barred_list: BOX.optional(),
    adults_barred_list: BOX.optional(),
    other_police_info: BOX.optional(),
    statutory_statement_section: str.optional(),
    has_disclosed_content: z.boolean().nullable().catch(null).optional(),
  }),
  tamper_flags: z.array(z.string()).catch([]).optional(),
  confidence: z.enum(["high", "medium", "low"]).nullable().catch(null).optional(),
  reasoning: z.string().catch("").optional(),
  issues: z.array(z.string()).catch([]).optional(),
  user_guidance: z
    .object({ title: z.string(), explanation: z.string(), steps_to_fix: z.array(z.string()) })
    .nullable()
    .catch(null)
    .optional(),
});
type ModelOutput = z.infer<typeof ModelSchema>;

export interface DbsExtraction {
  level: string | null;
  page: number | null;
  certificate_number: string | null;
  issue_date: string | null;
  surname: string | null;
  forenames: string | null;
  other_names: string | null;
  date_of_birth: string | null;
  position_applied_for: string | null;
  workforce: "child" | "adult" | "child_and_adult" | "unknown" | null;
  employer_name: string | null;
  registered_body: string | null;
  countersignatory: string | null;
  police_records: string | null;
  s142_list: string | null;
  childrens_barred_list: string | null;
  adults_barred_list: string | null;
  other_police_info: string | null;
  statutory_statement_section: string | null;
  has_disclosed_content: boolean | null;
}

export type DbsConfidence = "high" | "medium" | "low";

export interface VerifyDbsResult {
  outcome: "pass" | "fail" | "review";
  reason_code: string | null;
  confidence: DbsConfidence;
  extracted: DbsExtraction;
  tamper_flags: string[];
  reasoning: string;
  issues: string[];
  user_guidance: UserGuidance | null;
}

export interface VerifyDbsOptions {
  isPdf: boolean;
  passportSurname: string;
  passportDob: string;
  /** Storage path of the upload — names the fixture in fixture mode. */
  documentPath?: string;
}

type ContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string; detail: "high" } }
  | { type: "file"; file: { filename: string; file_data: string } };

export interface VerifyDbsDeps {
  complete?: (req: { system: string; content: ContentPart[] }) => Promise<string | null | undefined>;
  fetch?: typeof fetch;
  signReference?: (path: string) => Promise<string | null>;
  env?: Record<string, string | undefined>;
  readFixture?: (name: string) => Promise<string | null>;
}

const EMPTY: DbsExtraction = {
  level: null, page: null, certificate_number: null, issue_date: null, surname: null, forenames: null, other_names: null,
  date_of_birth: null, position_applied_for: null, workforce: null, employer_name: null, registered_body: null,
  countersignatory: null, police_records: null, s142_list: null, childrens_barred_list: null, adults_barred_list: null,
  other_police_info: null, statutory_statement_section: null, has_disclosed_content: null,
};

const JSON_SHAPE = `{
  "pass": true,
  "reason_code": null,
  "extracted": {
    "level": "enhanced",
    "page": 1,
    "certificate_number": "001234567890",
    "issue_date": "YYYY-MM-DD",
    "surname": "…",
    "forenames": "…",
    "other_names": null,
    "date_of_birth": "YYYY-MM-DD",
    "position_applied_for": "…",
    "workforce": "child",
    "employer_name": "…",
    "registered_body": "…",
    "countersignatory": "…",
    "police_records": "none_recorded",
    "s142_list": "none_recorded",
    "childrens_barred_list": "none_recorded",
    "adults_barred_list": "not_requested",
    "other_police_info": "none_recorded",
    "statutory_statement_section": "113B",
    "has_disclosed_content": false
  },
  "tamper_flags": [],
  "confidence": "high",
  "reasoning": "Step-by-step…",
  "issues": [],
  "user_guidance": null
}`;

export function buildDbsPrompt(p: { surname: string; dob: string; withReferences: boolean; isPdf: boolean }): string {
  const images = p.withReferences
    ? `You are given three images:
1. REFERENCE A — page 1 of a genuine ENHANCED DBS certificate.
2. REFERENCE B — page 1 of a genuine STANDARD DBS certificate.
3. SUBMITTED — page 1 of the certificate a nanny has uploaded (photo, scan or PDF page).`
    : `You are given one document:
SUBMITTED — page 1 of the certificate a nanny has uploaded (photo, scan or PDF page).`;
  const level = p.withReferences
    ? `2. LEVEL: The title must read "Enhanced Certificate" and the statement at the bottom must cite
   section 113B of the Police Act 1997. It must match REFERENCE A's layout, not REFERENCE B's.`
    : `2. LEVEL: The title must read "Enhanced Certificate" and the statement at the bottom must cite
   section 113B of the Police Act 1997.`;
  const alteration = p.withReferences
    ? `7. ALTERATION: Look for edited text, inconsistent fonts, flat patches in the background pattern,
   a title that disagrees with the 113A/113B statement, or a layout that differs from REFERENCE A.
   List anything found in tamper_flags (font_mismatch, background_patch, level_inconsistent, box_edited, layout_mismatch).`
    : `7. ALTERATION: Look for edited text, inconsistent fonts, flat patches in the background pattern,
   or a title that disagrees with the 113A/113B statement.
   List anything found in tamper_flags (font_mismatch, background_patch, level_inconsistent, box_edited).`;
  const pdf = p.isPdf ? `\nThe SUBMITTED document is a PDF: read page 1 only and ignore every other page.\n` : "";

  return `You are a document verification specialist for UK Disclosure and Barring Service (DBS) certificates.

${images}
${pdf}
The nanny's passport details: surname "${p.surname}", date of birth "${p.dob}".

Steps:
1. DOCUMENT: Is SUBMITTED page 1 of a DBS certificate (title "... Certificate", "Page 1 of 2",
   "Disclosure & Barring Service")? If it is page 2, a different document, or a screenshot of
   something else, fail.
${level}
3. EXTRACT every field listed in the JSON below exactly as printed. Dates as YYYY-MM-DD.
   Certificate number: digits only, must be exactly 12.
4. BOXES: For each of the five boxes, report "none_recorded", "not_requested", "information"
   or "unreadable". The "DBS Children's Barred List information" box must NOT be "not_requested".
5. WORKFORCE: From "Position applied for", report child / adult / child_and_adult / unknown.
   adult alone = fail. unknown = set confidence "low".
6. MATCH: Compare surname and date of birth to the passport details. Ignore case, leading/
   trailing spaces and accents; treat hyphen, space and apostrophe as equal. A real mismatch is not a fail: set reason_code "name_mismatch",
   pass false, confidence "low".
${alteration}
8. DO NOT fail because of the employer named, the issue date, or any box containing information.
   Those are for a person to review.

Respond with ONLY valid JSON in exactly this shape: ${JSON_SHAPE}

When "pass" is false you MUST give "reason_code" (one of: not_a_dbs_certificate, wrong_page,
not_enhanced, no_childrens_barred_list, adult_workforce_only, unreadable, altered_document,
name_mismatch) and "user_guidance" { "title", "explanation", "steps_to_fix": [...] } —
friendly, non-combative, written to the nanny, UK English. Never accuse her of forgery: for
altered_document say the image couldn't be verified and ask for a clear, unedited photo or the PDF.
When "pass" is true, reason_code and user_guidance are null.`;
}

// ── Code-enforced rule ──

const CHECKED_BOX = new Set(["none_recorded", "information"]);

function failReason(m: ModelOutput, e: DbsExtraction): DbsFailReason | null {
  const said = m.reason_code ?? null;
  if (said === "not_a_dbs_certificate") return "not_a_dbs_certificate";
  if (said === "wrong_page" || e.page !== 1) return "wrong_page";
  if (e.level?.toLowerCase() !== "enhanced" || e.statutory_statement_section?.toUpperCase() !== "113B") return "not_enhanced";
  if (e.childrens_barred_list === "not_requested") return "no_childrens_barred_list";
  if (e.workforce === "adult") return "adult_workforce_only";
  if (
    said === "unreadable" ||
    !DBS_CERTIFICATE_NUMBER_PATTERN.test(e.certificate_number ?? "") ||
    !CHECKED_BOX.has(e.childrens_barred_list ?? "")
  ) {
    return "unreadable";
  }
  if ((m.tamper_flags ?? []).length > 0 || said === "altered_document") return "altered_document";
  return null;
}

function decide(m: ModelOutput, refsNone: boolean): VerifyDbsResult {
  const extracted: DbsExtraction = { ...EMPTY, ...(m.extracted as Partial<DbsExtraction>) };
  const tamper_flags = m.tamper_flags ?? [];
  const issues = [...(m.issues ?? []), ...(refsNone ? ["refs:none"] : [])];
  let confidence: DbsConfidence = m.confidence ?? "low";
  const base = { extracted, tamper_flags, reasoning: m.reasoning ?? "", issues };

  const fail = failReason(m, extracted);
  if (fail) {
    const card = DBS_REASON_GUIDANCE[fail] ?? m.user_guidance ?? DBS_FALLBACK_GUIDANCE;
    return { ...base, outcome: "fail", reason_code: fail, confidence, user_guidance: { ...card, reason_code: fail, confidence } };
  }

  const jobTitleOnly = extracted.workforce === "unknown" || extracted.workforce === null;
  if (jobTitleOnly) confidence = "low";
  const nameMismatch = m.reason_code === "name_mismatch";
  if (confidence === "low" || nameMismatch || !m.pass) {
    const reason_code = nameMismatch ? "name_mismatch" : null;
    return {
      ...base,
      outcome: "review",
      reason_code,
      confidence,
      user_guidance: { ...DBS_REVIEW_GUIDANCE, ...(reason_code ? { reason_code } : {}), confidence },
    };
  }
  return { ...base, outcome: "pass", reason_code: null, confidence, user_guidance: null };
}

function unreadable(reasoning: string, refsNone: boolean): VerifyDbsResult {
  return {
    outcome: "fail",
    reason_code: "unreadable",
    confidence: "low",
    extracted: { ...EMPTY },
    tamper_flags: [],
    reasoning,
    issues: ["AI response could not be read", ...(refsNone ? ["refs:none"] : [])],
    user_guidance: { ...DBS_REASON_GUIDANCE.unreadable, reason_code: "unreadable", confidence: "low" },
  };
}

/** Parse + decide. Never throws on bad model output. */
export function evaluateDbsModelOutput(raw: string | null | undefined, refsNone: boolean): VerifyDbsResult {
  if (!raw) return unreadable("AI returned an empty response", refsNone);
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return unreadable("AI returned invalid JSON", refsNone);
  }
  const parsed = ModelSchema.safeParse(json);
  if (!parsed.success) return unreadable("AI returned JSON of the wrong shape", refsNone);
  return decide(parsed.data, refsNone);
}

// ── Transport ──

async function defaultComplete(req: { system: string; content: ContentPart[] }) {
  const completion = await openai.chat.completions.create({
    model: DBS_MODEL,
    messages: [
      { role: "system", content: req.system },
      { role: "user", content: req.content as never },
    ],
    response_format: { type: "json_object" },
    max_completion_tokens: 2000,
  });
  return completion.choices[0]?.message?.content?.trim();
}

async function defaultSignReference(path: string): Promise<string | null> {
  const { data, error } = await createAdminClient().storage.from("verification-documents").createSignedUrl(path, 3600);
  return error || !data?.signedUrl ? null : data.signedUrl;
}

async function defaultReadFixture(name: string): Promise<string | null> {
  try {
    return await readFile(join(process.cwd(), FIXTURE_DIR, `${name}.json`), "utf8");
  } catch {
    return null;
  }
}

/** `user/1728000000000-page1-pass.pdf` → `page1-pass`; null when the name is not a plain fixture name. */
function fixtureName(documentPath: string | undefined): string | null {
  const base = (documentPath ?? "").split("/").pop() ?? "";
  const name = base.replace(/\.[A-Za-z0-9]+$/, "").replace(/^\d+-/, "");
  return /^[A-Za-z0-9_-]+$/.test(name) ? name : null;
}

async function references(env: Record<string, string | undefined>, sign: (p: string) => Promise<string | null>) {
  const cfg = getDbsConfig({ ...env, NODE_ENV: env.NODE_ENV ?? "development" });
  const paths = [cfg.referenceEnhancedPath, cfg.referenceStandardPath];
  if (paths.some((p) => !p || !p.startsWith(REFERENCE_PREFIX))) return null;
  const urls = await Promise.all(paths.map((p) => sign(p as string)));
  return urls.every(Boolean) ? (urls as string[]) : null;
}

async function submittedPart(url: string, isPdf: boolean, doFetch: typeof fetch): Promise<ContentPart> {
  if (!isPdf) return { type: "image_url", image_url: { url, detail: "high" } };
  const res = await doFetch(url);
  if (!res.ok) throw new Error(`Failed to download PDF: ${res.status}`);
  const base64 = Buffer.from(await res.arrayBuffer()).toString("base64");
  return { type: "file", file: { filename: "dbs-certificate.pdf", file_data: `data:application/pdf;base64,${base64}` } };
}

export async function verifyDBS(documentSignedUrl: string, opts: VerifyDbsOptions, deps: VerifyDbsDeps = {}): Promise<VerifyDbsResult> {
  const env = deps.env ?? process.env;

  if (env.DBS_AI_FIXTURE_MODE === "1") {
    const name = fixtureName(opts.documentPath);
    const raw = name ? await (deps.readFixture ?? defaultReadFixture)(name) : null;
    return evaluateDbsModelOutput(raw, true);
  }

  const refs = await references(env, deps.signReference ?? defaultSignReference);
  const system = buildDbsPrompt({ surname: opts.passportSurname, dob: opts.passportDob, withReferences: refs !== null, isPdf: opts.isPdf });
  const submitted = await submittedPart(documentSignedUrl, opts.isPdf, deps.fetch ?? fetch);
  const content: ContentPart[] = [
    { type: "text", text: "Please verify the DBS certificate below." },
    ...(refs ?? []).map((url): ContentPart => ({ type: "image_url", image_url: { url, detail: "high" } })),
    submitted,
  ];
  // Transport errors propagate on purpose: the pipeline's two attempts turn them into TECHNICAL_RETRY.
  const raw = await (deps.complete ?? defaultComplete)({ system, content });
  return evaluateDbsModelOutput(raw, refs === null);
}
