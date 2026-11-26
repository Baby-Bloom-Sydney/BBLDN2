"use client";

/**
 * The parent's deposit page, drawn (plan 03 row C1, §3 "Page state", "Pay"; brief 03 §0.2, §3 parent 1–9, §7).
 * Mobile first, in the subscribe page's look: the violet card, the violet-600 full-width button, the violet-50 strip.
 *
 * - bookable: "Your place in the cohort starting Monday 1 February", the intro (her first name), the consent strip,
 *   **Pay <amount>** and the footnote. The amount only ever comes from the formatter (`PRICES`, never written).
 * - paid: "Your deposit is paid. Thank you." — no Pay. full / being paid: the line and Pre-book (`PrebookPanel`).
 * - invalid: the one invalid page.
 *
 * Pay sends the code (the server works out everything else) and stays disabled while pending, so a double tap is one
 * request (03a also gives a second press the same session). A session → a full navigation, but only to Stripe's
 * Checkout or this site's own done page (anything else → "Try again."); a state → that state; anything else → its
 * line, and Pay again.
 *
 * 03c review fixes: a new state from the server (a refresh, e.g. after Pre-book answered `not_offered`) replaces what
 * the page shows (H1); a page restored from the browser's cache after leaving for Stripe gets Pay back (H2,
 * `pageshow` with `persisted`); after a change of state, focus goes to the new heading (M3).
 *
 * Test ids for the proofs: `deposit-state` (its `data-state` is the state's kind), `deposit-pay`, and the panel's
 * `deposit-prebook*`. BB-wave2-231126/03-build, 2026-11-25.
 */

import { useEffect, useRef, useState, type RefObject } from "react";
import { CheckCircle2, Loader2, Lock, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SITE_URL } from "@/lib/constants";
import { bookableIntro, PAGE_COPY, payButtonLabel, placeHeading } from "@/lib/deposit/copy";
import type { DepositPageState } from "@/lib/deposit/types";
import { DepositShell, InvalidDepositLink } from "../InvalidDepositLink";
import { payDeposit, type PayDepositResult } from "./actions";
import { PrebookPanel } from "./PrebookPanel";

export interface DepositClientProps {
  readonly code: string;
  readonly initialState: DepositPageState;
  readonly firstName: string | null;
  /** She has an open pre-booking already: the panel opens at once (D8). */
  readonly prebooked: boolean;
}

type Bookable = Extract<DepositPageState, { kind: "bookable" }>;
type Prebookable = Extract<DepositPageState, { kind: "full" | "being_paid" }>;

const INVALID: DepositPageState = Object.freeze({ kind: "invalid" });
const HEADING = "text-xl font-semibold leading-snug text-slate-900 focus:outline-none sm:text-2xl";
/** Where Pay may send her: Stripe's Checkout page, or (a session already complete) this site's done page. */
const STRIPE_CHECKOUT = "https://checkout.stripe.com/";
const isPayDestination = (url: string): boolean => url.startsWith(STRIPE_CHECKOUT) || url.startsWith(`${SITE_URL}/deposit/`);

/** A throw (the network) is "try again", never an unhandled rejection or a stuck button. */
async function settled(run: () => Promise<PayDepositResult>): Promise<PayDepositResult> {
  try {
    return await run();
  } catch {
    return { ok: false, error: "try_again" };
  }
}

/** Pay's own state: pending (a ref too, so a second tap in the same tick is refused) and its last line. */
function usePay(code: string, show: (state: DepositPageState) => void) {
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const inFlight = useRef(false);
  // Back from Stripe through the browser's cache (Safari, Firefox): the page comes back as it was left, pending.
  useEffect(() => {
    const onShow = (event: PageTransitionEvent) => {
      if (!event.persisted) return;
      inFlight.current = false;
      setPending(false);
      setMessage(null);
    };
    window.addEventListener("pageshow", onShow);
    return () => window.removeEventListener("pageshow", onShow);
  }, []);
  const pay = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setMessage(null);
    const result = await settled(() => payDeposit(code));
    const leaving = result.ok && result.kind === "redirect" && isPayDestination(result.url);
    if (leaving) return window.location.assign(result.url); // stays pending: she is leaving for Stripe
    inFlight.current = false;
    setPending(false);
    if (result.ok && result.kind === "state") return show(result.state);
    if (!result.ok && (result.error === "invalid" || result.error === "deposit_disabled")) return show(INVALID);
    setMessage(!result.ok && result.error === "try_again_soon" ? PAGE_COPY.tryAgainSoon : PAGE_COPY.tryAgain);
  };
  return { pending, message, pay };
}

interface BookableProps {
  readonly state: Bookable;
  readonly firstName: string | null;
  readonly code: string;
  readonly show: (state: DepositPageState) => void;
}

function BookableCard({ state, firstName, code, show }: BookableProps) {
  const { pending, message, pay } = usePay(code, show);
  return (
    <>
      <h1 tabIndex={-1} className={HEADING}>{placeHeading(state.start)}</h1>
      <p className="text-base leading-relaxed text-slate-600">{bookableIntro(firstName, state.start)}</p>
      <div className="flex items-start gap-3 rounded-lg border border-violet-200 bg-violet-50 px-4 py-3">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-violet-600" aria-hidden="true" />
        <p className="text-sm text-violet-900">{PAGE_COPY.consent}</p>
      </div>
      {message !== null && (
        <p role="alert" className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {message}
        </p>
      )}
      <Button
        type="button"
        size="lg"
        data-testid="deposit-pay"
        className="w-full bg-violet-600 text-base hover:bg-violet-700"
        disabled={pending}
        aria-busy={pending}
        onClick={pay}
      >
        {pending && <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />}
        {payButtonLabel()}
      </Button>
      <p className="flex items-start gap-2 text-xs text-slate-500">
        <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span>{PAGE_COPY.footnote}</span>
      </p>
    </>
  );
}

function PaidCard() {
  return (
    <>
      <CheckCircle2 className="h-7 w-7 text-green-600" aria-hidden="true" />
      <h1 tabIndex={-1} className={HEADING}>{PAGE_COPY.paid}</h1>
    </>
  );
}

interface PrebookCardProps {
  readonly state: Prebookable;
  readonly code: string;
  readonly prebooked: boolean;
  readonly onInvalid: () => void;
  readonly onFocusHeading: () => void;
}

function PrebookCard({ state, code, prebooked, onInvalid, onFocusHeading }: PrebookCardProps) {
  return (
    <>
      <h1 tabIndex={-1} className={HEADING}>{state.kind === "full" ? PAGE_COPY.full : PAGE_COPY.beingPaid}</h1>
      <PrebookPanel code={code} prebooked={prebooked} onInvalid={onInvalid} onFocusHeading={onFocusHeading} />
    </>
  );
}

interface BodyProps {
  readonly state: Exclude<DepositPageState, { kind: "invalid" }>;
  readonly props: DepositClientProps;
  readonly show: (state: DepositPageState) => void;
  readonly focusHeading: () => void;
}

function StateBody({ state, props, show, focusHeading }: BodyProps) {
  if (state.kind === "bookable") return <BookableCard state={state} firstName={props.firstName} code={props.code} show={show} />;
  if (state.kind === "paid") return <PaidCard />;
  return <PrebookCard state={state} code={props.code} prebooked={props.prebooked} onInvalid={() => show(INVALID)} onFocusHeading={focusHeading} />;
}

/**
 * The state shown: the server's (`initialState`), until Pay or Pre-book shows another. A NEW state object from the
 * server — the page rendered again, e.g. by `router.refresh()` — replaces it (React's "adjust state on a prop change";
 * every server render sends a new object, while a client re-render keeps the same one).
 */
function useShownState(initialState: DepositPageState) {
  const [state, setState] = useState<DepositPageState>(initialState);
  const [fromServer, setFromServer] = useState<DepositPageState>(initialState);
  if (fromServer !== initialState) {
    setFromServer(initialState);
    setState(initialState);
  }
  return [state, setState] as const;
}

/** After the state changes (never on the first render, nor strict mode's second effect): focus its heading. */
function useFocusOnChange(root: RefObject<HTMLDivElement>, state: DepositPageState) {
  const last = useRef(state);
  useEffect(() => {
    if (last.current === state) return;
    last.current = state;
    root.current?.querySelector<HTMLElement>("h1")?.focus();
  }, [root, state]);
}

export function DepositClient(props: DepositClientProps) {
  const [state, setState] = useShownState(props.initialState);
  const root = useRef<HTMLDivElement>(null);
  useFocusOnChange(root, state);
  const focusHeading = () => root.current?.querySelector<HTMLElement>("h1")?.focus();
  return (
    <div ref={root} className="contents">
      {state.kind === "invalid" ? (
        <InvalidDepositLink />
      ) : (
        <DepositShell>
          <div data-testid="deposit-state" data-state={state.kind} className="flex flex-col gap-5">
            <StateBody state={state} props={props} show={setState} focusHeading={focusHeading} />
          </div>
        </DepositShell>
      )}
    </div>
  );
}
