"use client";

/**
 * A connection that ran out of time, kept on the family's list: "Expired", the reason, and "Connect with NAME again",
 * which opens the same Connect form as her profile (a new request; the limit message at 5 open requests).
 */
import { useState } from "react";
import { MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConnectModal } from "@/components/ConnectModal";
import type { ExpiredConnection } from "@/lib/connections/expired-rows";

function reason(c: ExpiredConnection): string {
  return c.expiredBecause === "not_booked"
    ? "Your connection has expired: the meet and greet wasn't booked in time."
    : `Your connection has expired: ${c.nannyFirstName} didn't reply in time.`;
}

export function ExpiredConnectionCard({
  connection,
  pendingRequestCount,
}: {
  connection: ExpiredConnection;
  pendingRequestCount: number;
}) {
  const [connecting, setConnecting] = useState(false);
  const lastName = connection.nannyName.slice(connection.nannyFirstName.length).trim();
  return (
    <div className="rounded-lg border border-slate-100 bg-white p-3 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          {connection.nannyPhoto ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={connection.nannyPhoto} alt="" className="h-10 w-10 rounded-full object-cover opacity-75" />
          ) : (
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-100">
              <span className="text-sm font-semibold text-slate-500">{connection.nannyFirstName.charAt(0)}</span>
            </div>
          )}
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-slate-900">{connection.nannyName}</p>
            {connection.nannySuburb && (
              <p className="flex items-center gap-1 text-xs text-slate-500">
                <MapPin className="h-3 w-3" aria-hidden="true" />
                {connection.nannySuburb}
              </p>
            )}
          </div>
        </div>
        <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-800 whitespace-nowrap">
          Expired
        </span>
      </div>
      <p className="text-xs text-slate-500">{reason(connection)}</p>
      <Button size="sm" variant="outline" className="w-full text-xs" onClick={() => setConnecting(true)}>
        Connect with {connection.nannyFirstName} again
      </Button>
      <ConnectModal
        isOpen={connecting}
        onClose={() => setConnecting(false)}
        nanny={{
          id: connection.nannyId,
          first_name: connection.nannyFirstName,
          last_name: lastName,
          suburb: connection.nannySuburb,
          hourly_rate_min: null,
          profile_picture_url: connection.nannyPhoto,
        }}
        pendingRequestCount={pendingRequestCount}
      />
    </div>
  );
}
