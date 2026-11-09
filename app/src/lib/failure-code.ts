/**
 * A failed call's code for a log line — never its message or details, which can repeat the row it was writing.
 * `Error` when it has none.
 *
 * BB-wave1-041126, 2026-11-09.
 */
export function failureCode(error: unknown): string {
  const code = typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
  return typeof code === "string" && code !== "" ? code : "Error";
}
