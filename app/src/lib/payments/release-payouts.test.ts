/**
 * release-payouts — automated coverage of the auto-payout pipeline.
 *
 * Bailey 2026-05-14: this is the test suite that answers the
 * question "will nannies who have set up payouts actually get paid?"
 * Every branch of the cron's per-row decision tree is covered here,
 * with mocked Supabase + mocked Stripe.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { releasePayouts } from "./release-payouts";
import type { StripeResult } from "@/types/payments";
import type { SendTransferInput, SendTransferOutput } from "@/lib/stripe/types";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const NOW = new Date("2026-06-01T12:00:00+01:00");
const PAST = new Date("2026-05-30T00:00:00+01:00").toISOString();
const FUTURE = new Date("2026-07-01T00:00:00+01:00").toISOString();

type Status =
  | "pending"
  | "held"
  | "sending"
  | "sent"
  | "paid"
  | "failed"
  | "cancelled"
  | "frozen";

interface PayoutRow {
  id: string;
  nanny_user_id: string;
  parent_user_id: string;
  amount_aud_cents: number;
  status: Status;
  scheduled_release_at: string;
  paid_at?: string | null;
  failed_at?: string | null;
  failure_reason?: string | null;
  sent_at?: string | null;
  stripe_transfer_id?: string | null;
}

interface NannyRow {
  user_id: string;
  stripe_connect_account_id: string | null;
  payouts_enabled: boolean;
  payout_application_status:
    | "not_applied"
    | "in_progress"
    | "pending_review"
    | "approved"
    | "verified"
    | "restricted"
    | "requires_action"
    | "rejected"
    | "pending";
}

interface ProfileRow {
  user_id: string;
  is_test_user: boolean;
}

interface ActivityLogRow {
  user_id: string;
  action_type: string;
  action_details: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Minimal Supabase fake — implements just the chain shapes we use.
// ---------------------------------------------------------------------------

function createFakeAdmin(seed: {
  payouts: PayoutRow[];
  nannies: NannyRow[];
  profiles: ProfileRow[];
}) {
  const payouts = [...seed.payouts];
  const nannies = [...seed.nannies];
  const profiles = [...seed.profiles];
  const activityLogs: ActivityLogRow[] = [];

  return {
    state: { payouts, nannies, profiles, activityLogs },
    client: {
      from(table: string) {
        if (table === "nanny_payouts") return nannyPayoutsTable(payouts);
        if (table === "nannies") return nanniesTable(nannies);
        if (table === "user_profiles") return userProfilesTable(profiles);
        if (table === "activity_logs") return activityLogsTable(activityLogs);
        throw new Error(`fake admin: unhandled table ${table}`);
      },
    },
  };
}

function nannyPayoutsTable(payouts: PayoutRow[]) {
  return {
    select(_columns?: string) {
      return makeSelectChain(payouts);
    },
    update(patch: Partial<PayoutRow>) {
      return makeUpdateChain(payouts, patch);
    },
  };
}

/** Read-path builder for nanny_payouts. Supports the exact sequence
 *  the production code uses: select().eq().lte().order().returns(). */
function makeSelectChain(payouts: PayoutRow[]) {
  const filters: Array<(p: PayoutRow) => boolean> = [];
  const builder: {
    eq: (field: keyof PayoutRow, value: unknown) => typeof builder;
    lte: (field: keyof PayoutRow, isoCutoff: string) => typeof builder;
    order: (field: string, opts: unknown) => typeof builder;
    returns: <T>() => { data: T; error: null };
  } = {
    eq(field, value) {
      filters.push((p) => p[field] === value);
      return builder;
    },
    lte(field, isoCutoff) {
      filters.push((p) => {
        const v = p[field];
        return typeof v === "string" && v <= isoCutoff;
      });
      return builder;
    },
    order(_field, _opts) {
      return builder;
    },
    returns<T>() {
      const filtered = payouts.filter((p) => filters.every((f) => f(p)));
      return { data: filtered as unknown as T, error: null };
    },
  };
  return builder;
}

/** Write-path builder for nanny_payouts. Supports both shapes:
 *    update().eq()                         → bare write, await-able
 *    update().eq().eq().select().maybeSingle() → conditional claim
 *  Constraints accumulate on each `.eq()`; the patch only applies if
 *  the constraint set matches a row. */
function makeUpdateChain(payouts: PayoutRow[], patch: Partial<PayoutRow>) {
  const filters: Array<(p: PayoutRow) => boolean> = [];
  let consumed = false;
  const apply = (): PayoutRow | null => {
    if (consumed) return null;
    consumed = true;
    const target = payouts.find((p) => filters.every((f) => f(p)));
    if (target) Object.assign(target, patch);
    return target ?? null;
  };
  const builder: {
    eq: (field: keyof PayoutRow, value: unknown) => typeof builder;
    select: (cols: string) => {
      maybeSingle: <T>() => Promise<{ data: T | null; error: null }>;
    };
    then: <TResult>(
      onfulfilled?: ((value: { data: null; error: null }) => TResult) | null,
    ) => Promise<TResult>;
  } = {
    eq(field, value) {
      filters.push((p) => p[field] === value);
      return builder;
    },
    select(_cols) {
      return {
        async maybeSingle<T>() {
          const target = apply();
          if (!target) return { data: null, error: null };
          return {
            data: { id: target.id } as unknown as T,
            error: null,
          };
        },
      };
    },
    then<TResult>(
      onfulfilled?: ((value: { data: null; error: null }) => TResult) | null,
    ): Promise<TResult> {
      apply();
      const v = { data: null, error: null };
      return Promise.resolve(
        onfulfilled ? onfulfilled(v) : (v as unknown as TResult),
      );
    },
  };
  return builder;
}

function nanniesTable(nannies: NannyRow[]) {
  return {
    select(_columns: string) {
      return {
        eq(field: keyof NannyRow, value: unknown) {
          return {
            async maybeSingle<T>(): Promise<{ data: T | null; error: null }> {
              const row = nannies.find((n) => n[field] === value) ?? null;
              return { data: row as unknown as T | null, error: null };
            },
          };
        },
      };
    },
  };
}

function userProfilesTable(profiles: ProfileRow[]) {
  return {
    select(_columns: string) {
      return {
        in(field: keyof ProfileRow, values: unknown[]) {
          return {
            returns<T>(): { data: T; error: null } {
              const matched = profiles.filter((p) => values.includes(p[field]));
              return { data: matched as unknown as T, error: null };
            },
          };
        },
      };
    },
  };
}

function activityLogsTable(activityLogs: ActivityLogRow[]) {
  return {
    async insert(
      payload: ActivityLogRow,
    ): Promise<{ data: null; error: null }> {
      activityLogs.push(payload);
      return { data: null, error: null };
    },
  };
}

// ---------------------------------------------------------------------------
// Reusable scenario builder
// ---------------------------------------------------------------------------

function happyPayoutRow(over: Partial<PayoutRow> = {}): PayoutRow {
  return {
    id: "payout-1",
    nanny_user_id: "nanny-1",
    parent_user_id: "parent-1",
    amount_aud_cents: 10_000,
    status: "pending",
    scheduled_release_at: PAST,
    paid_at: null,
    failed_at: null,
    failure_reason: null,
    sent_at: null,
    stripe_transfer_id: null,
    ...over,
  };
}

function happyNannyRow(over: Partial<NannyRow> = {}): NannyRow {
  return {
    user_id: "nanny-1",
    stripe_connect_account_id: "acct_test_123",
    payouts_enabled: true,
    payout_application_status: "verified",
    ...over,
  };
}

function makeSendTransfer(responses: Array<StripeResult<SendTransferOutput>>): {
  fn: (input: SendTransferInput) => Promise<StripeResult<SendTransferOutput>>;
  calls: SendTransferInput[];
} {
  const calls: SendTransferInput[] = [];
  let idx = 0;
  return {
    calls,
    fn: async (input) => {
      calls.push(input);
      const r = responses[Math.min(idx, responses.length - 1)] ?? successResp();
      idx += 1;
      return r;
    },
  };
}

function successResp(transferId = "tr_1"): StripeResult<SendTransferOutput> {
  return {
    success: true,
    data: {
      transferId,
      destination: "acct_test_123",
      amount: 10_000,
      currency: "aud",
    },
  };
}

function failureResp(
  error = "card_declined",
): StripeResult<SendTransferOutput> {
  return { success: false, error };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
});

describe("releasePayouts — happy path", () => {
  it("pays a due, verified, non-test-user nanny", async () => {
    const admin = createFakeAdmin({
      payouts: [happyPayoutRow()],
      nannies: [happyNannyRow()],
      profiles: [
        { user_id: "parent-1", is_test_user: false },
        { user_id: "nanny-1", is_test_user: false },
      ],
    });
    const { fn: sendTransfer, calls } = makeSendTransfer([successResp("tr_x")]);

    const result = await releasePayouts({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      admin: admin.client as any,
      sendTransfer,
      now: NOW,
    });

    expect(result.considered).toBe(1);
    expect(result.paid).toBe(1);
    expect(result.failed).toBe(0);
    expect(calls).toHaveLength(1);
    expect(calls[0].destinationAccountId).toBe("acct_test_123");
    expect(calls[0].amountCents).toBe(10_000);
    expect(calls[0].transferId).toBe("payout-1");

    // Row was flipped to `paid` with transfer id.
    const row = admin.state.payouts[0];
    expect(row.status).toBe("paid");
    expect(row.paid_at).toBe(NOW.toISOString());
    expect(row.stripe_transfer_id).toBe("tr_x");

    // payout_paid activity logged.
    expect(admin.state.activityLogs).toHaveLength(1);
    expect(admin.state.activityLogs[0].action_type).toBe("payout_paid");
  });

  it("processes multiple due rows in one pass", async () => {
    const admin = createFakeAdmin({
      payouts: [
        happyPayoutRow({ id: "p-1" }),
        happyPayoutRow({ id: "p-2", amount_aud_cents: 50_000 }),
        happyPayoutRow({ id: "p-3", amount_aud_cents: 30_000 }),
      ],
      nannies: [happyNannyRow()],
      profiles: [
        { user_id: "parent-1", is_test_user: false },
        { user_id: "nanny-1", is_test_user: false },
      ],
    });
    const { fn: sendTransfer, calls } = makeSendTransfer([
      successResp("tr_1"),
      successResp("tr_2"),
      successResp("tr_3"),
    ]);

    const result = await releasePayouts({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      admin: admin.client as any,
      sendTransfer,
      now: NOW,
    });

    expect(result.paid).toBe(3);
    expect(calls).toHaveLength(3);
  });
});

describe("releasePayouts — skip cases", () => {
  it("skips test-user parent", async () => {
    const admin = createFakeAdmin({
      payouts: [happyPayoutRow()],
      nannies: [happyNannyRow()],
      profiles: [
        { user_id: "parent-1", is_test_user: true },
        { user_id: "nanny-1", is_test_user: false },
      ],
    });
    const { fn: sendTransfer, calls } = makeSendTransfer([successResp()]);

    const result = await releasePayouts({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      admin: admin.client as any,
      sendTransfer,
      now: NOW,
    });

    expect(result.skipped_test_user).toBe(1);
    expect(result.paid).toBe(0);
    expect(calls).toHaveLength(0);
    expect(admin.state.payouts[0].status).toBe("pending");
  });

  it("skips test-user nanny", async () => {
    const admin = createFakeAdmin({
      payouts: [happyPayoutRow()],
      nannies: [happyNannyRow()],
      profiles: [
        { user_id: "parent-1", is_test_user: false },
        { user_id: "nanny-1", is_test_user: true },
      ],
    });
    const { fn: sendTransfer, calls } = makeSendTransfer([successResp()]);

    const result = await releasePayouts({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      admin: admin.client as any,
      sendTransfer,
      now: NOW,
    });

    expect(result.skipped_test_user).toBe(1);
    expect(calls).toHaveLength(0);
  });

  it("skips when stripe_connect_account_id is missing", async () => {
    const admin = createFakeAdmin({
      payouts: [happyPayoutRow()],
      nannies: [happyNannyRow({ stripe_connect_account_id: null })],
      profiles: [
        { user_id: "parent-1", is_test_user: false },
        { user_id: "nanny-1", is_test_user: false },
      ],
    });
    const { fn: sendTransfer, calls } = makeSendTransfer([successResp()]);

    const result = await releasePayouts({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      admin: admin.client as any,
      sendTransfer,
      now: NOW,
    });

    expect(result.skipped_no_account).toBe(1);
    expect(calls).toHaveLength(0);
  });

  it("skips when payouts_enabled is false", async () => {
    const admin = createFakeAdmin({
      payouts: [happyPayoutRow()],
      nannies: [happyNannyRow({ payouts_enabled: false })],
      profiles: [
        { user_id: "parent-1", is_test_user: false },
        { user_id: "nanny-1", is_test_user: false },
      ],
    });
    const { fn: sendTransfer, calls } = makeSendTransfer([successResp()]);

    const result = await releasePayouts({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      admin: admin.client as any,
      sendTransfer,
      now: NOW,
    });

    expect(result.skipped_not_ready).toBe(1);
    expect(calls).toHaveLength(0);
  });

  it("skips when payout_application_status is not verified/approved", async () => {
    const admin = createFakeAdmin({
      payouts: [happyPayoutRow()],
      nannies: [
        happyNannyRow({ payout_application_status: "requires_action" }),
      ],
      profiles: [
        { user_id: "parent-1", is_test_user: false },
        { user_id: "nanny-1", is_test_user: false },
      ],
    });
    const { fn: sendTransfer, calls } = makeSendTransfer([successResp()]);

    const result = await releasePayouts({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      admin: admin.client as any,
      sendTransfer,
      now: NOW,
    });

    expect(result.skipped_not_ready).toBe(1);
    expect(calls).toHaveLength(0);
  });

  it("does not pick up rows scheduled in the future", async () => {
    const admin = createFakeAdmin({
      payouts: [happyPayoutRow({ scheduled_release_at: FUTURE })],
      nannies: [happyNannyRow()],
      profiles: [
        { user_id: "parent-1", is_test_user: false },
        { user_id: "nanny-1", is_test_user: false },
      ],
    });
    const { fn: sendTransfer } = makeSendTransfer([successResp()]);

    const result = await releasePayouts({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      admin: admin.client as any,
      sendTransfer,
      now: NOW,
    });

    expect(result.considered).toBe(0);
  });

  it("does not pick up rows with status frozen, held, paid, etc.", async () => {
    const statuses: Status[] = [
      "held",
      "sending",
      "sent",
      "paid",
      "failed",
      "cancelled",
      "frozen",
    ];
    const admin = createFakeAdmin({
      payouts: statuses.map((s, i) =>
        happyPayoutRow({ id: `p-${i}`, status: s }),
      ),
      nannies: [happyNannyRow()],
      profiles: [
        { user_id: "parent-1", is_test_user: false },
        { user_id: "nanny-1", is_test_user: false },
      ],
    });
    const { fn: sendTransfer, calls } = makeSendTransfer([successResp()]);

    const result = await releasePayouts({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      admin: admin.client as any,
      sendTransfer,
      now: NOW,
    });

    expect(result.considered).toBe(0);
    expect(calls).toHaveLength(0);
  });
});

describe("releasePayouts — failure handling", () => {
  it("marks row as failed when Stripe transfer returns success=false", async () => {
    const admin = createFakeAdmin({
      payouts: [happyPayoutRow()],
      nannies: [happyNannyRow()],
      profiles: [
        { user_id: "parent-1", is_test_user: false },
        { user_id: "nanny-1", is_test_user: false },
      ],
    });
    const { fn: sendTransfer } = makeSendTransfer([
      failureResp("balance_insufficient"),
    ]);

    const result = await releasePayouts({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      admin: admin.client as any,
      sendTransfer,
      now: NOW,
    });

    expect(result.paid).toBe(0);
    expect(result.failed).toBe(1);
    expect(result.errors[0].reason).toBe("balance_insufficient");

    const row = admin.state.payouts[0];
    expect(row.status).toBe("failed");
    expect(row.failed_at).toBe(NOW.toISOString());
    expect(row.failure_reason).toBe("balance_insufficient");

    // payout_failed activity logged.
    const logs = admin.state.activityLogs;
    expect(logs.some((l) => l.action_type === "payout_failed")).toBe(true);
  });

  it("catches per-row exceptions without poisoning the rest of the run", async () => {
    const admin = createFakeAdmin({
      payouts: [happyPayoutRow({ id: "p-1" }), happyPayoutRow({ id: "p-2" })],
      nannies: [happyNannyRow()],
      profiles: [
        { user_id: "parent-1", is_test_user: false },
        { user_id: "nanny-1", is_test_user: false },
      ],
    });
    const callCount = { n: 0 };
    const sendTransfer = async (
      input: SendTransferInput,
    ): Promise<StripeResult<SendTransferOutput>> => {
      callCount.n += 1;
      if (input.transferId === "p-1") {
        throw new Error("network blip");
      }
      return successResp("tr_x");
    };

    const result = await releasePayouts({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      admin: admin.client as any,
      sendTransfer,
      now: NOW,
    });

    expect(result.considered).toBe(2);
    expect(result.failed).toBe(1);
    expect(result.paid).toBe(1);
    expect(callCount.n).toBe(2);
  });
});

describe("releasePayouts — concurrency / idempotency", () => {
  it("claims the row by flipping status='pending'→'sending' before transferring", async () => {
    const admin = createFakeAdmin({
      payouts: [happyPayoutRow()],
      nannies: [happyNannyRow()],
      profiles: [
        { user_id: "parent-1", is_test_user: false },
        { user_id: "nanny-1", is_test_user: false },
      ],
    });
    // Spy: when sendTransfer is called, the row should already be 'sending'.
    let statusAtTransferTime: string | undefined;
    const sendTransfer = async (
      _input: SendTransferInput,
    ): Promise<StripeResult<SendTransferOutput>> => {
      statusAtTransferTime = admin.state.payouts[0].status;
      return successResp("tr_x");
    };

    await releasePayouts({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      admin: admin.client as any,
      sendTransfer,
      now: NOW,
    });

    expect(statusAtTransferTime).toBe("sending");
    expect(admin.state.payouts[0].status).toBe("paid");
  });

  it("passes the BB payout id as transferId so Stripe's idempotency key is stable", async () => {
    const admin = createFakeAdmin({
      payouts: [happyPayoutRow({ id: "payout-XYZ" })],
      nannies: [happyNannyRow()],
      profiles: [
        { user_id: "parent-1", is_test_user: false },
        { user_id: "nanny-1", is_test_user: false },
      ],
    });
    const { fn: sendTransfer, calls } = makeSendTransfer([successResp()]);

    await releasePayouts({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      admin: admin.client as any,
      sendTransfer,
      now: NOW,
    });

    // sendTransfer derives idempotencyKey from transferId by default,
    // so passing the BB row id makes the key stable across retries.
    expect(calls[0].transferId).toBe("payout-XYZ");
  });
});

describe("releasePayouts — mixed scenarios", () => {
  it("handles a mix: pay one, skip test user, fail one, skip not-ready", async () => {
    const admin = createFakeAdmin({
      payouts: [
        happyPayoutRow({ id: "p-pay", nanny_user_id: "nanny-ok" }),
        happyPayoutRow({ id: "p-test", nanny_user_id: "nanny-test" }),
        happyPayoutRow({ id: "p-fail", nanny_user_id: "nanny-failing" }),
        happyPayoutRow({ id: "p-notready", nanny_user_id: "nanny-disabled" }),
      ],
      nannies: [
        happyNannyRow({ user_id: "nanny-ok" }),
        happyNannyRow({ user_id: "nanny-test" }),
        happyNannyRow({ user_id: "nanny-failing" }),
        happyNannyRow({
          user_id: "nanny-disabled",
          payouts_enabled: false,
        }),
      ],
      profiles: [
        { user_id: "parent-1", is_test_user: false },
        { user_id: "nanny-ok", is_test_user: false },
        { user_id: "nanny-test", is_test_user: true },
        { user_id: "nanny-failing", is_test_user: false },
        { user_id: "nanny-disabled", is_test_user: false },
      ],
    });
    const sendTransfer = async (
      input: SendTransferInput,
    ): Promise<StripeResult<SendTransferOutput>> => {
      if (input.transferId === "p-fail") {
        return failureResp("card_declined");
      }
      return successResp(`tr_${input.transferId}`);
    };

    const result = await releasePayouts({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      admin: admin.client as any,
      sendTransfer,
      now: NOW,
    });

    expect(result.considered).toBe(4);
    expect(result.paid).toBe(1);
    expect(result.skipped_test_user).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.skipped_not_ready).toBe(1);
  });
});
