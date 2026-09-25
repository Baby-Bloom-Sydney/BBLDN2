/**
 * notifyParentOfFeedPost — email the linked parent that a new tile landed
 * on their child's feed.
 *
 * Called from every `bapp_logs` INSERT site (manual actions in
 * `lib/actions/bapp/*` + Katie writes in `lib/chat/modules/*`). Non-fatal:
 * never throws. Email failures are logged via `email_logs` (auto-written by
 * `sendEmail`) and the server console; the action's success path never
 * depends on this helper's outcome.
 *
 * Skip rules (return early WITHOUT calling sendEmail). Numbering matches
 * `system/APP/Notifications/FeedPosts/01-spec.md` §3 + the implementation
 * map. Evaluation order is cheapest-first so 3/4 fire pre-DB:
 *   1. `child_client.parent_user_id IS NULL`        — no linked parent
 *   2. `authorId === child_client.parent_user_id`   — self-post
 *   3. `logType === 'insight'`                      — auto-generated tile
 *   4. `logContext !== 'adhoc'`                     — sub-tile inside a
 *                                                     multi-insert flow
 *                                                     (e.g. submitReport →
 *                                                     report + progress +
 *                                                     observation; only the
 *                                                     head `adhoc` row
 *                                                     surfaces in the feed)
 *
 * Defensive skips (also early-return, console.warn for visibility):
 *   - `getUserEmailInfo(parent_user_id)` returns null
 *   - resolved parent email is empty
 *
 * See `system/APP/Notifications/FeedPosts/01-spec.md` for the full spec.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { getUserEmailInfo } from "./helpers";
import { sendEmail } from "./resend";
import { buildFeedPostNotificationEmail } from "./templates/feed-post-notification";
import type { BAppLogType, BAppLogContext } from "@/types/bapp";
import { SITE_URL } from "@/lib/constants";

export const FEED_POST_NOTIFICATION_EMAIL_TYPE = "feed_post_notification";

// Canonical production domain — used as the fallback when
// `NEXT_PUBLIC_APP_URL` is unset (dev / mis-configured deploy). Production
// MUST set `NEXT_PUBLIC_APP_URL` to the production origin per
// `feedback_vercel_app_project` memory; the fallback exists so emails
// degrade to a working canonical link rather than the Vercel preview URL.
const DEFAULT_APP_URL = SITE_URL;

export interface NotifyParentOfFeedPostArgs {
  /** `child_client.id` — identifies the child whose feed received the tile. */
  childId: string;
  /** `bapp_logs.author_id` — the user who created the tile. For Katie writes
   *  this is still the nanny's user_id (Katie writes on behalf of the nanny). */
  authorId: string;
  /** `bapp_logs.type` — used by the insight skip rule. */
  logType: BAppLogType;
  /** `bapp_logs.context` — only `adhoc` tiles surface in the parent feed view;
   *  `activity` + `assessment` tiles are hidden from "All", so only `adhoc`
   *  merits an email. */
  logContext: BAppLogContext;
}

export async function notifyParentOfFeedPost(
  args: NotifyParentOfFeedPostArgs,
): Promise<void> {
  try {
    // ── Cheap skips first — no DB / network needed (spec rules 3 + 4) ──
    if (args.logType === "insight") return;
    if (args.logContext !== "adhoc") return;

    // ── Look up the child + recipient ──
    const admin = createAdminClient();
    const { data: child, error: childErr } = await admin
      .from("child_client")
      .select("parent_user_id, first_name")
      .eq("id", args.childId)
      .single();

    if (childErr || !child) {
      // Child lookup failed — log + skip. Not expected in practice (the
      // calling action just inserted against this child_id), but we don't
      // propagate. `error` log level — the DB hiccup signals an
      // infrastructure issue rather than a data state.
      console.error(
        `[FeedPostNotification] child_client lookup failed for child_id=${args.childId}; skipping`,
        childErr ?? "no row returned",
      );
      return;
    }

    if (!child.parent_user_id) return;
    if (child.parent_user_id === args.authorId) return;

    // Resolve parent + author profiles in parallel via allSettled so an
    // author-lookup failure doesn't kill the parent path (author name is
    // cosmetic — template degrades to nanny-NULL wording). Per-slot
    // rejection reason is preserved for forensics.
    const [parentResult, authorResult] = await Promise.allSettled([
      getUserEmailInfo(child.parent_user_id),
      getUserEmailInfo(args.authorId),
    ]);
    const parentInfo =
      parentResult.status === "fulfilled" ? parentResult.value : null;
    const authorInfo =
      authorResult.status === "fulfilled" ? authorResult.value : null;
    if (parentResult.status === "rejected") {
      console.error(
        `[FeedPostNotification] parent profile lookup threw for parent_user_id=${child.parent_user_id}:`,
        parentResult.reason,
      );
    }
    if (authorResult.status === "rejected") {
      console.warn(
        `[FeedPostNotification] author profile lookup threw for author_id=${args.authorId}; continuing with nanny-NULL fallback:`,
        authorResult.reason,
      );
    }

    if (!parentInfo || !parentInfo.email) {
      console.warn(
        `[FeedPostNotification] no usable email for parent user_id=${child.parent_user_id}; skipping`,
      );
      return;
    }

    // Author / child name may legitimately be absent → template degrades.
    // Trim once, store, then null-coerce empty strings. The control-char
    // strip is defence-in-depth against email header injection via the
    // subject line. Covers: CR + LF (standard header terminators), NUL
    // (handled inconsistently by some parsers), VT + FF (treated as
    // whitespace by some parsers), and Unicode LINE / PARAGRAPH SEPARATOR
    // (U+2028 / U+2029 — some SMTP layers soft-fold on these). We don't
    // depend on Resend's normalisation.
    const stripControlChars = (s: string): string =>
      s.replace(/[\r\n\x00\x0B\x0C\u2028\u2029]/gu, " ");
    const trimmedAuthor = authorInfo?.firstName
      ? stripControlChars(authorInfo.firstName).trim()
      : "";
    const trimmedChild = child.first_name
      ? stripControlChars(child.first_name).trim()
      : "";
    const nannyFirstName = trimmedAuthor.length > 0 ? trimmedAuthor : null;
    const childFirstName = trimmedChild.length > 0 ? trimmedChild : null;

    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? DEFAULT_APP_URL;

    const { subject, html, text } = buildFeedPostNotificationEmail({
      nannyFirstName,
      childFirstName,
      childId: args.childId,
      appUrl,
    });

    // `authorInfo.email` is intentionally NOT consumed — author isn't a
    // recipient, only their first name is cosmetic for the subject/body.
    await sendEmail({
      to: parentInfo.email,
      subject,
      html,
      text,
      emailType: FEED_POST_NOTIFICATION_EMAIL_TYPE,
      recipientUserId: child.parent_user_id,
    });
  } catch (err) {
    // Belt-and-suspenders catch — sendEmail already absorbs its own errors,
    // but anything else (DB lookup throw, env weirdness, future regression)
    // must not propagate. Resend outages / DB hiccups are NOT supposed to
    // block a feed-tile insert. Stack-trace lands in console.error for
    // forensic correlation.
    console.error("[FeedPostNotification] Unexpected error:", err);
  }
}
