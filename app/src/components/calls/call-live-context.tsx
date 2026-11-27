"use client";

/**
 * "A call is live" (plan 05 §5 PR 05b; brief 05 §3.3), 04-neutral: it holds no JustCall code, so 04's `LinksRow` can read
 * it. Brief 05's dialer sets it while a call rings or is on; then the family links open in a new tab, so the drawer and
 * the call stay where they are. With no provider (the dialer off) it is false and 04's links are today's.
 * BB-wave2-231126/05-build.
 */

import { createContext, useContext } from "react";

export const CallLiveContext = createContext(false);

export function useCallLive(): boolean {
  return useContext(CallLiveContext);
}
