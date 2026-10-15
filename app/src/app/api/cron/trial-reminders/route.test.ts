/**
 * Cron `trial-reminders` route — auth-guard tests.
 *
 * The route's main job is sending T-5 trial-expiry emails (covered
 * via end-to-end smoke). These unit tests cover only the auth guard
 * — specifically the C1 fail-CLOSED fix: a missing CRON_SECRET env
 * var MUST result in a 503 refusal, not silent acceptance of any
 * caller.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// Module-scope state so the mocks inside `vi.hoisted` and the test
// bodies share the same handles.
const state = vi.hoisted(() => ({
  candidates: [] as Array<{
    id: string;
    parent_user_id: string;
    trial_ends_at: string;
  }>,
  readErr: null as null | { message: string },
  sendCalls: [] as unknown[],
  eqCalls: [] as Array<[string, unknown]>,
}));

beforeEach(() => {
  state.candidates = [];
  state.readErr = null;
  state.sendCalls = [];
  state.eqCalls = [];
  vi.resetModules();
});

vi.mock("@/lib/supabase/admin", () => ({
  /* eslint-disable @typescript-eslint/no-explicit-any */
  createAdminClient: () => ({
    from: (_table: string) => ({
      select: () => ({
        eq: (column: string, value: unknown) => (
          state.eqCalls.push([column, value]),
          {
            is: () => ({
              gte: () => ({
                lte: () => ({
                  returns: () => ({
                    data: state.candidates,
                    error: state.readErr,
                  }),
                }),
              }),
            }),
          }
        ),
      }),
      update: () => ({ eq: async () => ({ data: null, error: null }) }),
      insert: async () => ({ data: null, error: null }),
    }),
  }),
  /* eslint-enable @typescript-eslint/no-explicit-any */
}));

vi.mock("@/lib/email/resend", () => ({
  sendEmail: async (payload: unknown) => {
    state.sendCalls.push(payload);
    return { success: true } as const;
  },
}));

vi.mock("@/lib/email/templates/trial-expiry-reminder", () => ({
  buildTrialExpiryReminderEmail: () => ({
    subject: "Your Baby Bloom trial ends in 5 days",
    html: "<p>...</p>",
  }),
}));

async function callRoute(headers: Record<string, string>) {
  const { GET } = await import("./route");
  const req = new NextRequest("http://localhost/api/cron/trial-reminders", {
    headers,
  });
  return GET(req);
}

describe("cron/trial-reminders GET — auth guard", () => {
  it("fails CLOSED when CRON_SECRET env var is absent — 503", async () => {
    // C1: previously the guard was "if (cronSecret) check" which
    // allowed ANY caller through when CRON_SECRET was unset. A
    // misconfigured deploy would have exposed marketing-email sends
    // to the open internet.
    const original = process.env.CRON_SECRET;
    delete process.env.CRON_SECRET;
    try {
      const r = await callRoute({});
      expect(r.status).toBe(503);
      const body = (await r.json()) as { error: string };
      expect(body.error).toBe("cron_secret_not_configured");
    } finally {
      if (original !== undefined) process.env.CRON_SECRET = original;
    }
  });

  it("returns 401 when CRON_SECRET is set but no auth header", async () => {
    const original = process.env.CRON_SECRET;
    process.env.CRON_SECRET = "test-secret";
    try {
      const r = await callRoute({});
      expect(r.status).toBe(401);
    } finally {
      if (original === undefined) delete process.env.CRON_SECRET;
      else process.env.CRON_SECRET = original;
    }
  });

  it("returns 401 when bearer token does not match CRON_SECRET", async () => {
    const original = process.env.CRON_SECRET;
    process.env.CRON_SECRET = "test-secret";
    try {
      const r = await callRoute({ authorization: "Bearer wrong-value" });
      expect(r.status).toBe(401);
    } finally {
      if (original === undefined) delete process.env.CRON_SECRET;
      else process.env.CRON_SECRET = original;
    }
  });

  it("proceeds when bearer token matches CRON_SECRET — 200 with no candidates", async () => {
    const original = process.env.CRON_SECRET;
    process.env.CRON_SECRET = "test-secret";
    try {
      const r = await callRoute({ authorization: "Bearer test-secret" });
      expect(r.status).toBe(200);
      const body = (await r.json()) as { reminded: number; errors: number };
      expect(body.reminded).toBe(0);
      expect(body.errors).toBe(0);
      // Sanity — no email send happened with empty candidates.
      expect(state.sendCalls).toHaveLength(0);
    } finally {
      if (original === undefined) delete process.env.CRON_SECRET;
      else process.env.CRON_SECRET = original;
    }
  });
});

// 4g: the email goes to self-serve families only — the candidate query reads `status = 'trial'`, and a done-for-you
// row is never `trial` (no DFY trial: ADR-093, amendment 14, 4c). No send is added.
describe("cron/trial-reminders GET — recipients", () => {
  it("selects only rows in trial", async () => {
    const original = process.env.CRON_SECRET;
    process.env.CRON_SECRET = "test-secret";
    try {
      const r = await callRoute({ authorization: "Bearer test-secret" });
      expect(r.status).toBe(200);
      expect(state.eqCalls).toEqual([["status", "trial"]]);
    } finally {
      if (original === undefined) delete process.env.CRON_SECRET;
      else process.env.CRON_SECRET = original;
    }
  });
});
