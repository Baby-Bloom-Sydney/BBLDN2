"use client";

/**
 * "Run DBS check now" for a level-4 nanny, in the admin user drawer's Enhanced DBS row (3d follow-up, finding 1;
 * BAI 2026-10-14: the simplest UI entry point for P-8). A status-40 nanny is in no DBS list (A–D), so `DBSCheckModal`
 * cannot reach her; this is the only place the admin can re-check her on demand.
 *
 * Rulings: P-8 (a level-4 NEW_INFO / NO_MATCH = a failed re-check → 23 / 26, level 2), #12, #33. All of that is the
 * existing server action `adminRunDbsCheck` (`lib/actions/admin-dbs.ts`; pinned by D7e / RC1–RC4) — nothing is decided here.
 * Input: the nanny's `verifications.id`. Output: one `adminRunDbsCheck` call after a two-step inline confirm (the
 * `DBSCheckModal` style), the result or error shown inline, then `router.refresh()`.
 * Never: calls the action without the confirm, writes anything itself, or shows anything beyond the action's reply.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Loader2, RefreshCw } from "lucide-react";
import { adminRunDbsCheck } from "@/lib/actions/admin-dbs";

// copy: 3g pins
const CONFIRM_TEXT =
  "Run the DBS check now? If the Update Service reports new information or no match, she drops to level 2.";

export function DrawerRunDbsCheck({ verificationId }: { verificationId: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function run() {
    setRunning(true);
    setMessage(null);
    try {
      const r = await adminRunDbsCheck(verificationId);
      const text = r.success ? `Update Service: ${r.result ?? "checked"}` : (r.error ?? "The check failed");
      setMessage(r.warning ? `${text} · ${r.warning}` : text);
      router.refresh();
    } catch (err) {
      setMessage(`Error: ${err instanceof Error ? err.message : "the check failed"}`);
    } finally {
      setRunning(false);
      setConfirming(false);
    }
  }

  return (
    <div className="space-y-1 pt-1">
      {confirming ? (
        <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 p-2">
          <span className="flex-1 text-xs text-amber-800">{CONFIRM_TEXT}</span>
          <Button size="sm" variant="outline" disabled={running} onClick={run}>
            {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Yes, run check"}
          </Button>
          <Button size="sm" variant="ghost" disabled={running} onClick={() => setConfirming(false)}>
            Cancel
          </Button>
        </div>
      ) : (
        <Button size="sm" variant="outline" className="w-full gap-2" disabled={running} onClick={() => setConfirming(true)}>
          <RefreshCw className="h-3.5 w-3.5" />
          Run DBS check now
        </Button>
      )}
      {message && <p role="status" className="text-xs text-slate-700">{message}</p>}
    </div>
  );
}
