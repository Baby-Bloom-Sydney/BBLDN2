/**
 * Stripe Transfer wrapper — sends a commission payout to a connected
 * Express account.
 *
 * Spec: `system/APP/PAYMENTS/04-stripe-integration.md` §6d (Sending a
 * payout).
 *
 * Idempotency: `transfer-${transferId}` (where transferId is the BB-side
 * `nanny_payouts.id` UUID). CRITICAL — if the cron times out between the
 * Stripe API call and the DB UPDATE, the next run hits the same
 * idempotency key and Stripe returns the original transfer rather than
 * double-paying.
 *
 * Currency is London's (`PRICES.currency`, GBP — LDN2 4b). Test-user safeguards live one layer up.
 */

import { getStripeClient } from "./client";
import type { SendTransferInput, SendTransferOutput } from "./types";
import type { StripeResult } from "@/types/payments";
import { PRICES } from "@/config/prices";

function getErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  return "Unknown Stripe error";
}

export async function sendTransfer(
  input: SendTransferInput,
): Promise<StripeResult<SendTransferOutput>> {
  const {
    destinationAccountId,
    amountCents,
    transferId,
    metadata,
    idempotencyKey,
  } = input;

  if (!destinationAccountId || !transferId) {
    return {
      success: false,
      error: "sendTransfer requires destinationAccountId + transferId",
    };
  }
  if (!Number.isFinite(amountCents) || amountCents <= 0) {
    return {
      success: false,
      error: "sendTransfer: amountCents must be a positive integer",
    };
  }
  if (!Number.isInteger(amountCents)) {
    return {
      success: false,
      error: "sendTransfer: amountCents must be an integer (cents)",
    };
  }

  try {
    const stripe = getStripeClient();
    const transfer = await stripe.transfers.create(
      {
        amount: amountCents,
        currency: PRICES.currency,
        destination: destinationAccountId,
        transfer_group: transferId,
        metadata,
      },
      {
        idempotencyKey: idempotencyKey ?? `transfer-${transferId}`,
      },
    );

    const destinationId =
      typeof transfer.destination === "string"
        ? transfer.destination
        : (transfer.destination?.id ?? destinationAccountId);

    return {
      success: true,
      data: {
        transferId: transfer.id,
        destination: destinationId,
        amount: transfer.amount,
        currency: transfer.currency,
      },
    };
  } catch (err) {
    return {
      success: false,
      error: getErrorMessage(err),
    };
  }
}
