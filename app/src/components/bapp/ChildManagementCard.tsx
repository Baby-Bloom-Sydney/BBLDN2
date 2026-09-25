"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Loader2, AlertTriangle } from "lucide-react";
import {
  removeNannyFromChild,
  nannyLeaveChild,
  deleteChild,
} from "@/lib/actions/bapp/child-clients";
import type { ChildClient } from "@/types/bapp";

interface ChildManagementCardProps {
  /**
   * The list of children the caller is linked to (parent_user_id or
   * nanny_user_id matches `auth.uid()`). Empty list → component
   * renders nothing. Named `items` (not `children`) to avoid colliding
   * with React's reserved `children` prop and the lint rule that
   * forbids passing it as a named attribute.
   */
  items: ChildClient[];
  role: "nanny" | "parent";
}

type Action = "remove_nanny" | "delete_child" | "leave_child";

interface PendingConfirm {
  childId: string;
  action: Action;
}

const ACTION_LABEL: Record<Action, string> = {
  remove_nanny: "Remove",
  delete_child: "Delete",
  leave_child: "Leave",
};

const ACTION_BLURB: Record<Action, string> = {
  remove_nanny:
    "The nanny will lose access to this child. The placement ends if they share no other children with you.",
  delete_child:
    "This permanently deletes the child profile and all logs. This cannot be undone.",
  leave_child:
    "You will lose access to this child. The placement ends if you share no other children with this parent.",
};

export function ChildManagementCard({ items, role }: ChildManagementCardProps) {
  const router = useRouter();
  const [pending, setPending] = useState<PendingConfirm | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Synchronous guard against double-firing the destructive action on
  // rapid double-clicks. `disabled={busy}` only kicks in after React
  // commits the state change, leaving a small window where a second
  // click can land. The ref blocks before the first await.
  const inFlightRef = useRef(false);

  if (items.length === 0) return null;

  // Centralised pending-state setter — clears any stale error so an
  // error from row A doesn't leak into the confirmation dialog opened
  // on row B (security review).
  function openConfirm(next: PendingConfirm | null) {
    setError(null);
    setPending(next);
  }

  async function execute(childId: string, action: Action) {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setBusy(true);
    setError(null);
    try {
      let result: { success: boolean; error: string | null };
      if (action === "remove_nanny") {
        result = await removeNannyFromChild(childId);
      } else if (action === "delete_child") {
        result = await deleteChild(childId);
      } else {
        result = await nannyLeaveChild(childId);
      }
      if (!result.success) {
        setError(genericErrorFor(result.error));
        // Leave `pending` open so the user can retry from the same dialog.
        return;
      }
      setPending(null);
      router.refresh();
    } finally {
      setBusy(false);
      inFlightRef.current = false;
    }
  }

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        {items.map((child) => {
          const showRemoveNanny =
            role === "parent" && child.nanny_user_id !== null;
          const showDelete = role === "parent";
          const showLeave = role === "nanny" && child.nanny_user_id !== null;
          // Skip rows with nothing actionable for this role.
          if (!showRemoveNanny && !showDelete && !showLeave) return null;

          const isPending = pending?.childId === child.id;

          return (
            <div
              key={child.id}
              data-testid="child-row"
              className="rounded-xl border border-slate-200 bg-white p-3"
            >
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-slate-900">
                    {child.first_name ?? "Unnamed child"}
                  </p>
                  {child.date_of_birth && (
                    <p className="text-xs text-slate-500">
                      Born {new Date(child.date_of_birth).toLocaleDateString("en-GB")}
                    </p>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {showRemoveNanny && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        openConfirm({
                          childId: child.id,
                          action: "remove_nanny",
                        })
                      }
                      disabled={busy}
                    >
                      Remove nanny
                    </Button>
                  )}
                  {showLeave && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        openConfirm({
                          childId: child.id,
                          action: "leave_child",
                        })
                      }
                      disabled={busy}
                    >
                      Leave child
                    </Button>
                  )}
                  {showDelete && (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="text-red-600 hover:text-red-700"
                      onClick={() =>
                        openConfirm({
                          childId: child.id,
                          action: "delete_child",
                        })
                      }
                      disabled={busy}
                    >
                      Delete child
                    </Button>
                  )}
                </div>
              </div>
              {/* Inline confirmation appears only on the active row so
                  the user's context stays anchored to the child being
                  acted on. Same a11y pattern as InviteBanner P5. */}
              {isPending && pending && (
                <div
                  className="mt-3 flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2"
                  role="alertdialog"
                  aria-labelledby={`confirm-${child.id}`}
                >
                  <AlertTriangle
                    className="mt-0.5 h-4 w-4 shrink-0 text-red-600"
                    aria-hidden="true"
                  />
                  <div className="flex-1">
                    <p
                      id={`confirm-${child.id}`}
                      className="text-xs text-red-800"
                    >
                      {ACTION_BLURB[pending.action]}
                    </p>
                    <div className="mt-2 flex gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => openConfirm(null)}
                        disabled={busy}
                      >
                        Cancel
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="destructive"
                        onClick={() => execute(child.id, pending.action)}
                        disabled={busy}
                      >
                        {busy ? (
                          <>
                            <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                            Working...
                          </>
                        ) : (
                          ACTION_LABEL[pending.action]
                        )}
                      </Button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
      {error && (
        // role="alert" already implies aria-live="assertive" — adding
        // an explicit aria-live="polite" downgrades the announcement.
        <p className="text-xs text-red-600" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

function genericErrorFor(code: string | null): string {
  if (code === "not_parent" || code === "not_nanny") {
    return "You don't have permission for that action.";
  }
  if (code === "child_not_found") {
    return "That child no longer exists.";
  }
  return "Something went wrong. Please try again.";
}
