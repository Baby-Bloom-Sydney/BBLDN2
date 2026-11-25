"use client";

/**
 * The deposit block in the family's Done-for-you panel (plan 03 row B3; brief 03 §3 Admin 1–7, §0.1, §0.4, §0.7,
 * §0.8, §0.10; D10, D15). Rendered by `DfyPanel` under the cohort line only while the switch is on (the page read
 * `readDepositPanel`); it replaces the Deposit preset there.
 *
 * - A failed read: one line, no controls. Otherwise the state, pre-booked, link and warning lines (`copy.ts`).
 * - While nothing is paid: the target choice (goodwill only when offered), Email (asks before a second send; the
 *   server's `confirm_resend` asks too), Copy, Take payment now (D15: a new tab, `noopener,noreferrer`, no email),
 *   Cancel while a link is open (its question never promises to close a payment page already open), Mark paid.
 *   Once paid they're hidden (B2 refuses them too); Record refund shows for a bank-transfer deposit.
 * - `target_differs`: the open link's target is named, and nothing happens until BAI picks "as is" or "cancel and
 *   make a new one". Refusals are plain amber `role="alert"` lines; after any write the page refreshes.
 *
 * BB-wave2-231126/03-build, 2026-11-25.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  depositActionErrorLine, depositStateLine, depositWarningLines, linkLine, PANEL_ACTION_COPY, PANEL_COPY, prebookedLine,
  sendAgainQuestion, sendAgainQuestionAt, targetDiffersLine,
} from "@/lib/deposit/copy";
import type { DepositPanel, DepositPanelResult } from "@/lib/deposit/panel";
import type { DepositTarget } from "@/lib/deposit/types";
import { BankRefundDialog } from "./BankRefundDialog";
import { cancelDepositLink, copyDepositLink, sendDepositLink, takeDepositPaymentNow, type TargetDiffersChoice } from "./deposit-actions";
import { AlertLine, BUTTON, CopyableUrl, goodwillNext, QUIET_BUTTON, TargetChoice, useOneAtATime } from "./DepositParts";
import { MarkPaidDialog } from "./MarkPaidDialog";

interface SendOptions { readonly confirmResend?: boolean; readonly onTargetDiffers?: TargetDiffersChoice }
type Prompt =
  | { readonly kind: "resend"; readonly question: string; readonly options: SendOptions }
  | { readonly kind: "differs"; readonly action: "send" | "copy"; readonly line: string; readonly options: SendOptions }
  | { readonly kind: "cancel" };
type Shown = { readonly kind: "link" | "pay"; readonly url: string };
type Choice = readonly [label: string, act: () => void];

export function DepositBlock({ parentUserId, deposit }: { readonly parentUserId: string; readonly deposit: DepositPanelResult }) {
  if (!deposit.ok) return <AlertLine text={PANEL_COPY.unavailable} />;
  return <DepositControls parentUserId={parentUserId} panel={deposit.value} />;
}

/** The screen state, and the send / copy steps (each may stop at a prompt). */
function useDepositFlow(parentUserId: string, panel: DepositPanel) {
  const router = useRouter();
  const { pending, run } = useOneAtATime();
  const [choice, setChoice] = useState<DepositTarget>("current");
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  const [shown, setShown] = useState<Shown | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const target: DepositTarget = goodwillNext(panel.cohorts) === null ? "current" : choice;
  const ask = (next: Prompt) => {
    setMessage(null);
    setShown(null);
    setPrompt(next);
  };
  const start = (task: () => Promise<void>) => {
    setPrompt(null);
    setMessage(null);
    setShown(null);
    return run(task, () => setMessage(PANEL_ACTION_COPY.genericError));
  };
  const fail = (code: string) => setMessage(depositActionErrorLine(code));
  const differs = (action: "send" | "copy", options: SendOptions, open: { openTarget: DepositTarget; openGoodwillStartDate: string | null }) =>
    setPrompt({ kind: "differs", action, options, line: targetDiffersLine(open.openTarget, open.openGoodwillStartDate) });

  const send = (options: SendOptions) =>
    start(async () => {
      const res = await sendDepositLink(parentUserId, { target, ...options });
      if (res.ok) return router.refresh();
      if (res.error === "confirm_resend") return setPrompt({ kind: "resend", question: sendAgainQuestionAt(res.sentAt, panel.today), options });
      if (res.error === "target_differs") return differs("send", options, res);
      if (res.error === "email_failed") {
        setShown({ kind: "link", url: res.url }); // the link may be new: its line refreshes, the URL stays here
        router.refresh();
      }
      fail(res.error);
    });
  const copy = (options: SendOptions) =>
    start(async () => {
      const res = await copyDepositLink(parentUserId, { target, ...options });
      if (!res.ok) return res.error === "target_differs" ? differs("copy", options, res) : fail(res.error);
      setShown({ kind: "link", url: res.url });
      router.refresh();
    });
  const flow = { pending, start, ask, fail, setShown, setMessage, refresh: () => router.refresh(), dismiss: () => setPrompt(null) };
  return { ...flow, choice, setChoice, prompt, shown, message, send, copy };
}

type Flow = ReturnType<typeof useDepositFlow>;

/** Take payment now (D15), Cancel, and Email's own question before a second send. */
function depositActions(parentUserId: string, panel: DepositPanel, flow: Flow) {
  const email = () => {
    const question = sendAgainQuestion(panel);
    return question === null ? flow.send({}) : flow.ask({ kind: "resend", question, options: {} });
  };
  const takePayment = () =>
    flow.start(async () => {
      const res = await takeDepositPaymentNow(parentUserId);
      if (!res.ok) return flow.fail(res.error);
      window.open(res.url, "_blank", "noopener,noreferrer"); // returns null with noopener: never read as a failure
      flow.setShown({ kind: "pay", url: res.url });
      flow.refresh();
    });
  const cancel = () =>
    flow.start(async () => {
      const res = await cancelDepositLink(parentUserId);
      if (!res.ok) return flow.fail(res.error);
      if (!res.cancelled) flow.setMessage(PANEL_ACTION_COPY.noOpenLink);
      flow.refresh();
    });
  return { email, takePayment, askCancel: () => flow.ask({ kind: "cancel" }), cancel };
}

type Actions = ReturnType<typeof depositActions>;

/** A prompt's question and its choices ("Not now" is always added). */
function promptView(prompt: Prompt, flow: Flow, actions: Actions): { text: string; choices: readonly Choice[] } {
  if (prompt.kind === "cancel") return { text: PANEL_ACTION_COPY.cancelQuestion, choices: [[PANEL_ACTION_COPY.cancelConfirm, actions.cancel]] };
  if (prompt.kind === "resend") {
    return { text: prompt.question, choices: [[PANEL_ACTION_COPY.sendAgain, () => flow.send({ ...prompt.options, confirmResend: true })]] };
  }
  const pick = (onTargetDiffers: TargetDiffersChoice) =>
    prompt.action === "send" ? flow.send({ ...prompt.options, onTargetDiffers }) : flow.copy({ onTargetDiffers });
  const [asIs, replace] = prompt.action === "send"
    ? [PANEL_ACTION_COPY.sendAsIs, PANEL_ACTION_COPY.replaceAndSend]
    : [PANEL_ACTION_COPY.copyAsIs, PANEL_ACTION_COPY.replaceAndCopy];
  return { text: prompt.line, choices: [[asIs, () => pick("send_as_is")], [replace, () => pick("replace")]] };
}

function PromptBox({ flow, actions }: { readonly flow: Flow; readonly actions: Actions }) {
  if (flow.prompt === null) return null;
  const { text, choices } = promptView(flow.prompt, flow, actions);
  return (
    <div aria-live="polite" className="space-y-2 rounded-md bg-slate-50 p-2">
      <p className="break-words text-sm text-slate-700">{text}</p>
      <div className="flex flex-wrap gap-2">
        {choices.map(([label, act]) => (
          <button key={label} type="button" onClick={act} disabled={flow.pending} className={BUTTON}>
            {label}
          </button>
        ))}
        <button type="button" onClick={flow.dismiss} disabled={flow.pending} className={QUIET_BUTTON}>
          {PANEL_ACTION_COPY.notNow}
        </button>
      </div>
    </div>
  );
}

function DepositLines({ panel }: { readonly panel: DepositPanel }) {
  const prebooked = prebookedLine(panel);
  return (
    <>
      <p data-testid="deposit-state-line" className="break-words text-sm text-slate-900">{depositStateLine(panel)}</p>
      {prebooked && <p className="text-sm text-slate-600">{prebooked}</p>}
      {panel.canTakeDeposit && <p data-testid="deposit-link-line" className="break-words text-sm text-slate-600">{linkLine(panel)}</p>}
      {depositWarningLines(panel).map((line) => <AlertLine key={line} text={line} />)}
    </>
  );
}

function ActionButtons({ parentUserId, panel, flow, actions }: { readonly parentUserId: string; readonly panel: DepositPanel; readonly flow: Flow; readonly actions: Actions }) {
  const buttons: readonly Choice[] = [
    [PANEL_COPY.emailButton, actions.email],
    [PANEL_COPY.copyButton, () => flow.copy({})],
    [PANEL_COPY.takePaymentButton, actions.takePayment],
    ...(panel.link === null ? [] : [[PANEL_COPY.cancelButton, actions.askCancel] as const]),
  ];
  return (
    <div className="flex flex-wrap gap-2">
      {buttons.map(([label, act]) => (
        <button key={label} type="button" onClick={act} disabled={flow.pending} className={BUTTON}>
          {label}
        </button>
      ))}
      <MarkPaidDialog parentUserId={parentUserId} cohorts={panel.cohorts} disabled={flow.pending} />
    </div>
  );
}

function DepositControls({ parentUserId, panel }: { readonly parentUserId: string; readonly panel: DepositPanel }) {
  const flow = useDepositFlow(parentUserId, panel);
  const actions = depositActions(parentUserId, panel, flow);
  return (
    <div className="space-y-2" data-testid="deposit-block">
      <p className="text-sm font-medium text-slate-900">{PANEL_ACTION_COPY.heading}</p>
      <DepositLines panel={panel} />
      {panel.canTakeDeposit && (
        <>
          <TargetChoice cohorts={panel.cohorts} value={flow.choice} onChange={flow.setChoice} disabled={flow.pending} />
          <ActionButtons parentUserId={parentUserId} panel={panel} flow={flow} actions={actions} />
        </>
      )}
      {panel.canRecordBankRefund && <BankRefundDialog parentUserId={parentUserId} disabled={flow.pending} />}
      <PromptBox flow={flow} actions={actions} />
      {flow.shown && <CopyableUrl url={flow.shown.url} />}
      {flow.shown?.kind === "pay" && (
        <a href={flow.shown.url} target="_blank" rel="noopener noreferrer" className="inline-block text-sm text-violet-700 hover:underline">
          {PANEL_ACTION_COPY.openPaymentPage}
        </a>
      )}
      {flow.message && <AlertLine text={flow.message} />}
    </div>
  );
}
