/**
 * notify.ts (plan A7): an injectable sender with a no-op default until 04b's templates land. A sender that fails
 * is logged and swallowed — an email failure never undoes or fails a booking.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { notifyCall, sendCallNotice, type CallNotice } from "./notify";

const NOTICE: CallNotice = {
  kind: "booked",
  parentUserId: "b0400000-0000-4000-8000-000000000001",
  bookingId: "c0400000-0000-4000-8000-000000000001",
  startsAt: "2027-02-09T14:00:00.000Z",
  actorKind: "parent",
};

afterEach(() => vi.restoreAllMocks());

describe("notifyCall", () => {
  it("hands the notice to the sender", async () => {
    const send = vi.fn(async () => {});
    await notifyCall(NOTICE, send);
    expect(send).toHaveBeenCalledWith(NOTICE);
  });

  it("logs and swallows a sender that throws — the error's name and code only, never its message", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const failure = Object.assign(new Error("invalid to address jane@example.com"), { name: "ResendError", code: "validation_error" });
    await expect(
      notifyCall(NOTICE, async () => {
        throw failure;
      }),
    ).resolves.toBeUndefined();
    expect(log).toHaveBeenCalledWith("[calls/notify] booked notice failed", {
      bookingId: NOTICE.bookingId,
      name: "ResendError",
      code: "validation_error",
    });
    expect(JSON.stringify(log.mock.calls)).not.toContain("jane@example.com");
  });

  it("logs a thrown non-error by its type", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    await notifyCall(NOTICE, async () => {
      throw "jane@example.com bounced";
    });
    expect(log).toHaveBeenCalledWith("[calls/notify] booked notice failed", { bookingId: NOTICE.bookingId, name: "string", code: undefined });
  });

  it("the default sender sends nothing yet (04b adds the templates)", async () => {
    await expect(sendCallNotice(NOTICE)).resolves.toBeUndefined();
  });
});
