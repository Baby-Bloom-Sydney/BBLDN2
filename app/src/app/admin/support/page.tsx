import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/admin/require-admin";
import { Card, CardContent } from "@/components/ui/card";

/**
 * `/admin/support` — Contact Us inbox (S14).
 *
 * Spec: `system/APP/PAYMENTS/FRONTEND/03-build-spec.md` §S14.
 *
 * Lists contact_messages, unread-first then newest. Each row links
 * to /admin/support/[messageId] for the detail + reply form.
 */
export default async function AdminSupportInboxPage({
  searchParams,
}: {
  searchParams: { status?: string; category?: string };
}) {
  await requireAdmin();
  const admin = createAdminClient();

  let query = admin
    .from("contact_messages")
    .select(
      "id, sender_email, sender_name, subject, category, status, created_at, replied_at",
    )
    .order("created_at", { ascending: false })
    .limit(100);

  if (searchParams.status) query = query.eq("status", searchParams.status);
  if (searchParams.category)
    query = query.eq("category", searchParams.category);

  const { data: messages } = await query.returns<
    Array<{
      id: string;
      sender_email: string;
      sender_name: string | null;
      subject: string;
      category: string;
      status: string;
      created_at: string;
      replied_at: string | null;
    }>
  >();

  // Counters
  const [unread, replied, closed] = await Promise.all([
    countByStatus(admin, "unread"),
    countByStatus(admin, "replied"),
    countByStatus(admin, "closed"),
  ]);

  return (
    <div className="mx-auto max-w-5xl px-4 py-12">
      <h1 className="text-2xl font-bold text-slate-900">Support inbox</h1>
      <p className="mt-1 text-sm text-slate-500">
        Every Contact Us submission lands here.
      </p>

      <div className="mt-6 grid grid-cols-3 gap-3">
        <SmallTile label="Unread" value={unread} tone="warn" />
        <SmallTile label="Replied" value={replied} />
        <SmallTile label="Closed" value={closed} tone="muted" />
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-2 text-sm">
        <span className="text-slate-500">Status:</span>
        <Chip current={searchParams.status} value={undefined} label="All" />
        <Chip current={searchParams.status} value="unread" label="Unread" />
        <Chip current={searchParams.status} value="replied" label="Replied" />
        <Chip current={searchParams.status} value="closed" label="Closed" />
        <span className="ml-3 text-slate-500">Category:</span>
        <Chip
          current={searchParams.category}
          value={undefined}
          label="All"
          param="category"
        />
        <Chip
          current={searchParams.category}
          value="refund"
          label="Refund"
          param="category"
        />
        <Chip
          current={searchParams.category}
          value="billing"
          label="Billing"
          param="category"
        />
        <Chip
          current={searchParams.category}
          value="technical"
          label="Technical"
          param="category"
        />
        <Chip
          current={searchParams.category}
          value="general"
          label="General"
          param="category"
        />
      </div>

      <Card className="mt-3">
        <CardContent className="p-0">
          {!messages || messages.length === 0 ? (
            <p className="p-6 text-sm text-slate-600">No matching messages.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {messages.map((m) => (
                <li key={m.id}>
                  <Link
                    href={`/admin/support/${m.id}`}
                    className="block px-5 py-4 hover:bg-slate-50"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          {m.status === "unread" && (
                            <span className="h-2 w-2 shrink-0 rounded-full bg-violet-500" />
                          )}
                          <p className="truncate text-sm font-medium text-slate-900">
                            {m.subject}
                          </p>
                        </div>
                        <p className="mt-1 text-xs text-slate-500">
                          {m.sender_name ? `${m.sender_name} · ` : ""}
                          {m.sender_email} · {m.category}
                        </p>
                      </div>
                      <p className="shrink-0 text-xs text-slate-400">
                        {formatRelative(m.created_at)}
                      </p>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

async function countByStatus(
  admin: ReturnType<typeof createAdminClient>,
  status: string,
): Promise<number> {
  const { count } = await admin
    .from("contact_messages")
    .select("id", { count: "exact", head: true })
    .eq("status", status);
  return count ?? 0;
}

function SmallTile({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "warn" | "muted";
}) {
  const valueTone =
    tone === "warn"
      ? "text-amber-700"
      : tone === "muted"
        ? "text-slate-500"
        : "text-slate-900";
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
          {label}
        </p>
        <p className={`mt-1 text-2xl font-bold ${valueTone}`}>{value}</p>
      </CardContent>
    </Card>
  );
}

function Chip({
  current,
  value,
  label,
  param = "status",
}: {
  current: string | undefined;
  value: string | undefined;
  label: string;
  param?: string;
}) {
  const active = current === value || (!current && !value);
  const href = value ? `?${param}=${value}` : `?`;
  return (
    <Link
      href={href}
      className={`rounded-full px-3 py-1 text-xs font-medium ${
        active
          ? "bg-violet-600 text-white"
          : "border border-slate-200 text-slate-600 hover:border-violet-300"
      }`}
    >
      {label}
    </Link>
  );
}

function formatRelative(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const diffMs = Date.now() - d.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return `${diffDay}d ago`;
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}
