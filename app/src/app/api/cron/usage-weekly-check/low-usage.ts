/**
 * usage-weekly-check — the pure core (4e brief step 3; offer §7.4, runbook SOP 16 / M11, O-18). BB-LDN-4e-151026.
 *
 * - `hasUsageAccess`: the families the check looks at — status placed / trial / active_monthly / active_upfront, or
 *   the admin toggle on. The toggle wins both ways, as in the access gate (4c): a family toggled off is not checked.
 * - `findLowFamilies`: a family is low when ANY of its linked children has fewer active posts in the window than
 *   `USAGE_LOW_THRESHOLD_PER_CHILD_PER_WEEK`. A family with no linked child is not low (no child to measure).
 */
import { USAGE_LOW_THRESHOLD_PER_CHILD_PER_WEEK } from "@/config/offer";

const ACCESS_STATUSES: readonly string[] = ["placed", "trial", "active_monthly", "active_upfront"];

export function hasUsageAccess(row: { status: string; access_toggled_on: boolean | null }): boolean {
  if (row.access_toggled_on !== null) return row.access_toggled_on;
  return ACCESS_STATUSES.includes(row.status);
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
