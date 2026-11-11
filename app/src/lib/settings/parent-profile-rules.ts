/**
 * The parent's Profile and Contact rules: today's rules, unchanged, with the same plain messages the nanny's Settings
 * shows. Her Settings pages check with these before Save calls the server, and `updateParentAccountSettings` checks
 * again with the same function, so both refuse the same things.
 *
 * - Each field is checked only when it is sent: a date of birth that was empty on file and left untouched is never
 *   sent, so it is never refused. Nothing new becomes required.
 * - Her name can't be blank. The nanny's length and plain-text rules are not applied: they exist because the nanny's
 *   name prints on her invoices, and a parent's doesn't.
 * - Her date of birth can't be cleared and must be a real date; her mobile is required and a UK mobile
 *   (`checkDateOfBirth`, `checkMobile`, shared with the nanny's rules).
 * - Her address (town and postcode) changes only by a pick from the search, so it has no rule here.
 * - Client-safe and zod-free: this runs in the Settings page's own bundle.
 */

import { checkDateOfBirth, checkMobile, PROFILE_MESSAGES as M } from "./nanny-profile-rules";

/** What her Profile and Contact details save (the action's input; snake_case as the profile row). */
export interface ParentProfileInput {
  readonly first_name?: string;
  readonly last_name?: string;
  readonly date_of_birth?: string | null;
  readonly mobile_number?: string | null;
  readonly suburb?: string;
  readonly postcode?: string;
}

/** Today's name rule: it can't be blank (a value that isn't text counts as blank). */
function checkBlank(value: unknown, missing: string): string | null {
  const text = typeof value === "string" ? value.trim() : "";
  return text === "" ? missing : null;
}

/** Each field sent, checked: field → message ({} when all is well). The page and the action run this same check. */
export function checkParentProfileInput(input: ParentProfileInput): Readonly<Record<string, string>> {
  const checks: ReadonlyArray<readonly [string, boolean, () => string | null]> = [
    ["firstName", "first_name" in input, () => checkBlank(input.first_name, M.firstName)],
    ["lastName", "last_name" in input, () => checkBlank(input.last_name, M.lastName)],
    ["dateOfBirth", "date_of_birth" in input, () => checkDateOfBirth(input.date_of_birth)],
    ["mobile", "mobile_number" in input, () => checkMobile(input.mobile_number)],
  ];
  return checks.reduce<Readonly<Record<string, string>>>((found, [field, sent, check]) => {
    const message = sent ? check() : null;
    return message === null ? found : { ...found, [field]: message };
  }, {});
}
