/**
 * justcall-replay.ts — re-apply JustCall webhook deliveries left `unresolved` (brief 05 §3 edges; plan 05 R9, A10).
 * The Stripe replay's rule (`LAUNCH.md` §4): **run on BAI's word only.**
 *
 * Each row goes through the same idempotent path as the webhook (the API re-read, then `justcall_record_call`, one
 * entry per call), paced under JustCall's rate limit. It prints counts only. Refused while
 * `JUSTCALL_WEBHOOK_ENABLED` (or `CALL_BOOKING_ENABLED`) is off, or a JustCall setting is missing.
 *
 * Env (names only), **exported in the shell** — no .env file is read, so it never reaches a database by accident:
 * NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CALL_BOOKING_ENABLED, JUSTCALL_WEBHOOK_ENABLED,
 * JUSTCALL_API_KEY, JUSTCALL_API_SECRET, JUSTCALL_WEBHOOK_URL. Values come from the keychain or Vercel, never typed on
 * the command line.
 *
 * Run:
 *   npx tsx scripts/justcall-replay.ts --id=<ledger row id>
 *   npx tsx scripts/justcall-replay.ts --unresolved
 *
 * Exit: 0 every row applied or ignored · 1 a row left unresolved or not replayed · 2 refused.
 *
 * BB-wave2-231126/05-build, 2026-11-26.
 */

import { runReplayCli } from "../src/lib/justcall/replay";

runReplayCli(process.argv.slice(2), (line) => console.log(line)).then(
  (code) => {
    process.exitCode = code;
  },
  (thrown: unknown) => {
    console.error("justcall-replay: failed", thrown instanceof Error ? thrown.name : typeof thrown);
    process.exitCode = 1;
  },
);
