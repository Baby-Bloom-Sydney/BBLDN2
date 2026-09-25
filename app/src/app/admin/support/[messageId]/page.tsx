import Link from "next/link";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/admin/require-admin";
import { Card, CardContent } from "@/components/ui/card";
import { ReplyForm } from "./ReplyForm";

/**
 * `/admin/support/[messageId]` — Contact-message detail + reply (S14).
 *
 * Server component: auth gate, load message + user info, render
 * detail card + reply form.
 *
 * Spec: `system/APP/PAYMENTS/FRONTEND/03-build-spec.md` §S14.
 */
export default async function AdminSupportMessagePage({
  params,
}: {
  params: { messageId: string };
}) {
  await requireAdmin();
  const admin = createAdminClient();

  const { data: msg } = await admin
    .from("contact_messages")
    .select("*")
    .eq("id", params.messageId)
    .maybeSingle();
  if (!msg) redirect("/admin/support");

  // Optional: pull user profile if user_id present.
  let profile: {
    first_name: string | null;
    last_name: string | null;
  } | null = null;
  if (msg.user_id) {
    const { data } = await admin
      .from("user_profiles")
      .select("first_name, last_name")
      .eq("user_id", msg.user_id)
      .maybeSingle<{ first_name: string | null; last_name: string | null }>();
    profile = data;
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-12">
      <Link
        href="/admin/support"
        className="text-sm text-slate-500 hover:text-slate-700"
      >
        ← Back to inbox
      </Link>

      <h1 className="mt-4 text-2xl font-bold text-slate-900">{msg.subject}</h1>
      <p className="mt-1 text-sm text-slate-500">
        From{" "}
        {msg.sender_name || profile
          ? `${msg.sender_name ?? [profile?.first_name, profile?.last_name].filter(Boolean).join(" ")} · `
          : ""}
        <a
          href={`mailto:${msg.sender_email}`}
          className="text-violet-700 hover:underline"
        >
          {msg.sender_email}
        </a>
        {" · "}
        {msg.category}
        {" · "}
        {msg.status}
        {msg.user_id && (
          <>
            {" · "}
            <Link
              href={`/admin/users/${msg.user_id}/subscription`}
              className="text-violet-700 hover:underline"
            >
              View user
            </Link>
          </>
        )}
      </p>

      <Card className="mt-6">
        <CardContent className="p-5">
          <p className="whitespace-pre-wrap text-sm text-slate-800">
            {msg.body}
          </p>
        </CardContent>
      </Card>

      {msg.replied_at && msg.reply_body && (
        <div className="mt-6">
          <h2 className="text-sm font-medium uppercase tracking-wide text-slate-500">
            Your reply ({formatDate(msg.replied_at)})
          </h2>
          <Card className="mt-2 border-violet-200 bg-violet-50/50">
            <CardContent className="space-y-2 p-5">
              {msg.reply_subject && (
                <p className="text-sm font-semibold text-slate-900">
                  {msg.reply_subject}
                </p>
              )}
              <p className="whitespace-pre-wrap text-sm text-slate-800">
                {msg.reply_body}
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      <div className="mt-8">
        <h2 className="text-sm font-medium uppercase tracking-wide text-slate-500">
          {msg.replied_at ? "Follow up" : "Reply"}
        </h2>
        <ReplyForm messageId={msg.id} defaultSubject={`Re: ${msg.subject}`} />
      </div>
    </div>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
