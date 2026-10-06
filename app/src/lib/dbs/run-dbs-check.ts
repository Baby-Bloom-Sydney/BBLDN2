/**
 * Fire the AI read of her certificate (unit 3b; brief change 4 "AI trigger"). Both screens call this after
 * the certificate write succeeds — there is no method branch any more. The phase name is 3c's route contract (D-4).
 * Fire-and-forget by design: if it fails, the verification page re-fires on its next visit and the status poll's
 * staleness net escalates a stuck row, so a failure is logged rather than shown.
 */
export function fireDbsCheck(verificationId: string): void {
  fetch("/api/run-verification", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ verificationId, phase: "wwcc" }),
  }).catch((err: unknown) => {
    console.error("[fireDbsCheck] could not start the certificate check:", err);
  });
}
