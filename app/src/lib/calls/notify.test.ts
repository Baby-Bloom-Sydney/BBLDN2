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

  it("logs and swallows a sender that throws", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      notifyCall(NOTICE, async () => {
        throw new Error("resend down");
      }),
    ).resolves.toBeUndefined();
    expect(log).toHaveBeenCalledWith("[calls/notify] booked notice failed", {
      bookingId: NOTICE.bookingId,
      message: "resend down",
    });
  });

  it("the default sender sends nothing yet (04b adds the templates)", async () => {
    await expect(sendCallNotice(NOTICE)).resolves.toBeUndefined();
  });
});
