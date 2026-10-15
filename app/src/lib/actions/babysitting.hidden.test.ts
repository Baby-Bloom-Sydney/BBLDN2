/**
 * Unit 5c (BB-LDN-5c-151026) — `babysitting.ts` is a `"use server"` module imported by client components, so its
 * exports stay callable by action id after the pages are hidden. While `BABYSITTING_ENABLED` is off, every exported
 * writer refuses with "babysitting_disabled" and every exported reader returns empty — all before any Supabase
 * client is created, any email is sent or any lazy expiry / reminder sweep runs. `getLondonDistricts()` is London
 * geography, not babysitting, and stays live.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const touched = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    touched("admin");
    return {
      from: () => {
        throw new Error("DB_TOUCHED");
      },
    };
  },
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: () => {
    touched("server");
    return {
      auth: {
        getUser: async () => {
          throw new Error("DB_TOUCHED");
        },
      },
    };
  },
}));
vi.mock("./parent", () => ({
  getParentId: async () => {
    touched("getParentId");
    return null;
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/email/resend", () => ({
  sendEmail: () => touched("sendEmail"),
  sendBatchEmails: () => touched("sendBatchEmails"),
}));
vi.mock("@/lib/chat/proactive/action-triggered", () => ({
  dispatchActionTriggeredInBackground: () => touched("dispatch"),
}));

import * as bsr from "./babysitting";

beforeEach(() => touched.mockReset());
afterEach(() => vi.unstubAllEnvs());

const ID = "11111111-1111-1111-1111-111111111111";
const DISABLED = { success: false, error: "babysitting_disabled" };

const WRITERS: Array<[string, () => Promise<unknown>]> = [
  [
    "createBabysittingRequest",
    () =>
      bsr.createBabysittingRequest({
        timeSlots: [],
        children: [],
        suburb: "Clapham",
        postcode: "SW4",
        hourlyRate: 20,
      }),
  ],
  ["activateBsr", () => bsr.activateBsr(ID)],
  ["requestBabysittingJob", () => bsr.requestBabysittingJob(ID)],
  ["parentAcceptNanny", () => bsr.parentAcceptNanny(ID, ID)],
  ["parentDeclineNanny", () => bsr.parentDeclineNanny(ID, ID)],
  ["declineBabysittingRequest", () => bsr.declineBabysittingRequest(ID)],
  ["cancelBabysittingRequest", () => bsr.cancelBabysittingRequest(ID)],
  ["nannyCancelBabysittingRequest", () => bsr.nannyCancelBabysittingRequest(ID)],
];

describe("babysitting server actions — refuse while BABYSITTING_ENABLED is off", () => {
  it.each(WRITERS)("%s → babysitting_disabled, nothing touched", async (_name, call) => {
    vi.stubEnv("BABYSITTING_ENABLED", "");
    await expect(call()).resolves.toEqual(DISABLED);
    expect(touched).not.toHaveBeenCalled();
  });

  it("applyToBsrPublic → error babysitting_disabled, nothing touched", async () => {
    vi.stubEnv("BABYSITTING_ENABLED", "");
    await expect(bsr.applyToBsrPublic(ID)).resolves.toEqual({ status: "error", error: "babysitting_disabled" });
    expect(touched).not.toHaveBeenCalled();
  });

  it("getPublicBsrProfile → null, nothing touched", async () => {
    vi.stubEnv("BABYSITTING_ENABLED", "");
    await expect(bsr.getPublicBsrProfile(ID)).resolves.toEqual({ data: null, error: null });
    expect(touched).not.toHaveBeenCalled();
  });

  it("getParentBabysittingRequests → [], no lazy sweep", async () => {
    vi.stubEnv("BABYSITTING_ENABLED", "");
    await expect(bsr.getParentBabysittingRequests()).resolves.toEqual({ data: [], error: null });
    expect(touched).not.toHaveBeenCalled();
  });

  it("getNannyBabysittingJobs → [], not banned, no lazy sweep", async () => {
    vi.stubEnv("BABYSITTING_ENABLED", "");
    await expect(bsr.getNannyBabysittingJobs()).resolves.toEqual({
      data: [],
      error: null,
      banned: false,
      banUntil: null,
    });
    expect(touched).not.toHaveBeenCalled();
  });
});

describe("babysitting server actions — reopen with BABYSITTING_ENABLED=true", () => {
  it.each(WRITERS)("%s → proceeds past the switch", async (_name, call) => {
    vi.stubEnv("BABYSITTING_ENABLED", "true");
    await call().catch(() => undefined);
    expect(touched).toHaveBeenCalled();
  });

  it("getParentBabysittingRequests → reaches its auth lookup", async () => {
    vi.stubEnv("BABYSITTING_ENABLED", "true");
    await bsr.getParentBabysittingRequests().catch(() => undefined);
    expect(touched).toHaveBeenCalled();
  });
});

describe("getLondonDistricts — not babysitting, never gated", () => {
  it("still reaches the database with the flag off", async () => {
    vi.stubEnv("BABYSITTING_ENABLED", "");
    await bsr.getLondonDistricts().catch(() => undefined);
    expect(touched).toHaveBeenCalled();
  });
});
