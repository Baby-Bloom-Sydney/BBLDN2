/**
 * usage-weekly-check — the pure core (4e brief step 3; offer §7.4, runbook SOP 16 / M11, O-18). BB-LDN-4e-151026.
 *
 * - `hasUsageAccess`: the families the check looks at — status placed / trial / active_monthly / active_upfront, or
 *   the admin toggle on. As in the access gate (4c): the toggle wins both ways (toggled off → not checked), and a
 *   trial or paid period whose end date has passed is not access even before a cron flips the status.
 * - `findLowFamilies`: a family is low when ANY of its linked children has fewer active posts in the window than
 *   `USAGE_LOW_THRESHOLD_PER_CHILD_PER_WEEK`. A family with no linked child is not low (no child to measure).
 */
import { USAGE_LOW_THRESHOLD_PER_CHILD_PER_WEEK } from "@/config/offer";

export interface AccessRow {
  status: string;
  access_toggled_on: boolean | null;
  trial_ends_at?: string | null;
  paid_period_ends_at?: string | null;
}

const runsPast = (iso: string | null | undefined, nowMs: number) => Boolean(iso) && Date.parse(iso as string) > nowMs;

export function hasUsageAccess(row: AccessRow, nowMs: number = Date.now()): boolean {
  if (row.access_toggled_on !== null) return row.access_toggled_on;
  switch (row.status) {
    case "placed":
      return true;
    case "trial":
      return runsPast(row.trial_ends_at, nowMs);
    case "active_monthly":
    case "active_upfront":
      return runsPast(row.paid_period_ends_at, nowMs);
    default:
      return false;
  }
}

export interface LinkedChild {
  id: string;
  parent_user_id: string;
  first_name: string | null;
}

export interface LowFamily {
  parentUserId: string;
  children: Array<{ childId: string; firstName: string | null; posts: number }>;
}

export function findLowFamilies(
  parentUserIds: readonly string[],
  children: readonly LinkedChild[],
  postsByChild: ReadonlyMap<string, number>,
): LowFamily[] {
  return parentUserIds.flatMap((parentUserId) => {
    const kids = children
      .filter((c) => c.parent_user_id === parentUserId)
      .map((c) => ({ childId: c.id, firstName: c.first_name, posts: postsByChild.get(c.id) ?? 0 }));
    const low = kids.some((k) => k.posts < USAGE_LOW_THRESHOLD_PER_CHILD_PER_WEEK);
    return low ? [{ parentUserId, children: kids }] : [];
  });
}
