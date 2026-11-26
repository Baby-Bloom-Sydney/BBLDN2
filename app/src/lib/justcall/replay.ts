/**
 * The JustCall replay (plan 05 §5 A10, R9; brief §3 edges: "the JustCall API is down → the event stays unresolved for
 * a manual replay, the same as Stripe"). Run by hand, **on BAI's word only**, through `scripts/justcall-replay.ts`.
 *
 * - `--id=<ledger row id>` re-applies one row not yet finished; `--unresolved` re-applies every `unresolved` row and
 *   every row still in flight 10 minutes after it arrived, oldest first. A row already applied or ignored is left as
 *   it is (counted "not replayed").
 * - Each row is re-issued from the ledger as a verified event and goes through the same idempotent path as the webhook
 *   (`apply.ts` → `justcall_record_call`, one entry per call_sid), then its outcome is written back.
 * - Refused while the logging switch is off: no JustCall request leaves the app (brief §0.12).
 * - Paced at one API read every 2.1 s, under the Team plan's 30 a minute (plan K6).
 * - Prints counts only: no sid, number or name.
 *
 * BB-wave2-231126/05-build, 2026-11-26.
 */

import { justcallWebhookEnabled } from "@/lib/features/flags";
import { applyJustCallEvent, defaultApplyDeps, type ApplyDeps } from "./apply";
import { readJustCallConfig, type JustCallConfig } from "./config";
import { finishEvent, replayableEvent, unresolvedEventIds } from "./ledger";
import { createJustCallRepo, type JustCallRepo } from "./repo";

export const REPLAY_PAUSE_MS = 2_100;

export type ReplayTarget = { readonly kind: "one"; readonly id: string } | { readonly kind: "unresolved" };

export interface ReplayCounts {
  readonly rows: number;
  readonly applied: number;
  readonly ignored: number;
  readonly unresolved: number;
  readonly notReplayed: number;
}

export interface ReplayDeps {
  readonly repo: JustCallRepo;
  readonly applyDeps: ApplyDeps;
  readonly sleep: (ms: number) => Promise<void>;
}

export type ReplayResult =
  | { readonly ok: true; readonly counts: ReplayCounts }
  | { readonly ok: false; readonly error: "disabled" | "read_failed" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const USAGE = "usage: npx tsx scripts/justcall-replay.ts --id=<ledger row id> | --unresolved";

export function parseReplayArgs(argv: readonly string[]): ReplayTarget | null {
  if (argv.length !== 1) return null;
  const [arg] = argv;
  if (arg === "--unresolved") return { kind: "unresolved" };
  const id = /^--id=(.+)$/.exec(arg)?.[1];
  return id !== undefined && UUID.test(id) ? { kind: "one", id } : null;
}

type Outcome = "applied" | "ignored" | "unresolved" | "notReplayed";

async function replayOne(id: string, deps: ReplayDeps): Promise<Outcome> {
  const stored = await replayableEvent(id, deps.repo);
  if (!stored.ok) return "notReplayed";
  const result = await applyJustCallEvent(stored.event, deps.applyDeps);
  return (await finishEvent(id, result, deps.repo)) ? result.outcome : "notReplayed";
}

async function idsFor(target: ReplayTarget, repo: JustCallRepo): Promise<readonly string[] | null> {
  if (target.kind === "one") return [target.id];
  const listed = await unresolvedEventIds(repo);
  return listed.ok ? listed.value : null;
}

export async function replayJustCallEvents(target: ReplayTarget, deps: ReplayDeps): Promise<ReplayResult> {
  if (!justcallWebhookEnabled()) return { ok: false, error: "disabled" };
  const ids = await idsFor(target, deps.repo);
  if (ids === null) return { ok: false, error: "read_failed" };
  const tally: Record<Outcome, number> = { applied: 0, ignored: 0, unresolved: 0, notReplayed: 0 };
  for (const [index, id] of ids.entries()) {
    if (index > 0) await deps.sleep(REPLAY_PAUSE_MS);
    tally[await replayOne(id, deps)] += 1;
  }
  return { ok: true, counts: { rows: ids.length, ...tally } };
}

export function defaultReplayDeps(config: JustCallConfig): ReplayDeps {
  const repo = createJustCallRepo();
  return { repo, applyDeps: defaultApplyDeps(config, repo), sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)) };
}

/** The script's whole run; returns the exit code (0 all applied or ignored, 1 something left, 2 refused). */
export async function runReplayCli(
  argv: readonly string[],
  print: (line: string) => void,
  makeDeps: (config: JustCallConfig) => ReplayDeps = defaultReplayDeps,
): Promise<number> {
  const target = parseReplayArgs(argv);
  if (target === null) return (print(USAGE), 2);
  if (!justcallWebhookEnabled()) {
    return (print("justcall-replay: refused — JUSTCALL_WEBHOOK_ENABLED and CALL_BOOKING_ENABLED must both be exported as \"true\""), 2);
  }
  const config = readJustCallConfig();
  if (!config.ok) return (print(`justcall-replay: refused — missing settings: ${config.missing.join(", ")}`), 2);
  const result = await replayJustCallEvents(target, makeDeps(config.value));
  if (!result.ok) return (print(`justcall-replay: ${result.error === "disabled" ? "refused — switched off" : "could not read the ledger"}`), result.error === "disabled" ? 2 : 1);
  const c = result.counts;
  print(`justcall-replay: ${c.rows} rows — applied ${c.applied}, ignored ${c.ignored}, unresolved ${c.unresolved}, not replayed ${c.notReplayed}`);
  return c.unresolved === 0 && c.notReplayed === 0 ? 0 : 1;
}
