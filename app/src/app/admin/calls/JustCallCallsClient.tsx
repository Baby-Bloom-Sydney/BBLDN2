"use client";

/**
 * /admin/calls with JustCall on (plan 05 §5 B6, C11; D1, D2, D6). BB-wave2-231126/05-build.
 *
 * 04's `CallsClient`, unchanged, with brief 05's slots filled — a server page can't pass a function across to the
 * client, so this small client wrapper makes them. `page.tsx` renders it when either JustCall switch is on; with both
 * off, `CallsClient` exactly as today.
 *
 * Logging on (05a-2): the Unmatched JustCall calls after the Calls tab's sections, and JustCall's lines and
 * **Add outcome** under each past attempt in her drawer.
 *
 * Dialer on (05b): **Call next** at the top; the dialer panel on the right at `lg`+ (on a phone, one line instead);
 * each Call control fills the dialer and opens her drawer; her drawer opens beside the dialer, not over it; while a call
 * is live her links open in a new tab; and once the call it dialled ends, her outcome form carries the JustCall line,
 * saves with the call's sid and offers **Save and call next** (with logging on, whose save it is).
 *
 * A dismiss, an attach or a save refreshes the page (the server re-reads).
 */

import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { CallLiveContext } from "@/components/calls/call-live-context";
import { JustCallAttemptAction } from "@/components/calls/justcall/AddOutcome";
import { CallNextButton } from "@/components/calls/justcall/CallNextButton";
import { DialerPanel, isInDialer, useDialerScreen } from "@/components/calls/justcall/DialerPanel";
import { renderJustCallControl } from "@/components/calls/justcall/JustCallCallButton";
import { UnmatchedCalls } from "@/components/calls/justcall/UnmatchedCalls";
import { DialerFlowContext, useDialerFlow, type DialerFlow } from "@/components/calls/justcall/use-dialer-flow";
import type { UnmatchedList } from "@/lib/justcall/types";
import { CallsClient, type CallsClientProps, type DrawerBeside } from "./CallsClient";

export interface JustCallCallsClientProps extends Omit<CallsClientProps, "callsTabExtra" | "renderAttemptAction" | "renderCallControl" | "afterCall" | "drawerBeside"> {
  /** Null: the Unmatched list couldn't be read (its section says so). */
  readonly unmatched?: UnmatchedList | null;
  /** The logging switch (05a): the Unmatched list, JustCall's lines in her drawer, the after-call save. On unless said. */
  readonly logging?: boolean;
  /** The dialer switch (05b): the dialer, Call, Call next, the after-call form. Off unless said. */
  readonly dialer?: boolean;
}

const BESIDE: DrawerBeside = { ignoreOutside: isInDialer };

/**
 * The dialer around the page: the flow for the controls, "live" for the links, Call next, and the panel — after the
 * page's content when wide (it is fixed on the right; keyboard order reaches the list first), the phone line before it
 * when narrow, nothing until the width is known.
 */
function WithDialer({ flow, screen, children }: { readonly flow: DialerFlow; readonly screen: boolean | null; readonly children: ReactNode }) {
  const wide = flow.wide;
  return (
    <DialerFlowContext.Provider value={flow}>
      <CallLiveContext.Provider value={flow.live}>
        <CallNextButton />
        {!wide && <DialerPanel wide={screen} state={flow.dialer.state} />}
        <div className={wide ? "lg:pr-[380px]" : undefined}>{children}</div>
        {wide && <DialerPanel wide state={flow.dialer.state} />}
      </CallLiveContext.Provider>
    </DialerFlowContext.Provider>
  );
}

export function JustCallCallsClient({ unmatched = null, logging = true, dialer = false, ...props }: JustCallCallsClientProps) {
  const router = useRouter();
  const refresh = () => router.refresh();
  const screen = useDialerScreen();
  const flow = useDialerFlow({ enabled: dialer, wide: screen === true, logging });
  const client = (
    <CallsClient
      {...props}
      callsTabExtra={logging ? <UnmatchedCalls list={unmatched} onChanged={refresh} /> : undefined}
      renderAttemptAction={logging ? (attempt, family) => <JustCallAttemptAction attempt={attempt} family={family} onSaved={refresh} /> : undefined}
      renderCallControl={dialer ? renderJustCallControl : undefined}
      afterCall={dialer ? flow.afterCall : undefined}
      drawerBeside={dialer && flow.wide ? BESIDE : undefined}
    />
  );
  if (!dialer) return client;
  return (
    <WithDialer flow={flow} screen={screen}>
      {client}
    </WithDialer>
  );
}
