"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { ExternalLink, UserCog, Baby, Copy } from "lucide-react";
import { PRICES } from "@/config/prices";
import { PAYMENT_LINK_PRESETS, type PaymentLinkPreset } from "@/config/offer";
import { APP_LOCALE } from "@/lib/constants";
import { formatAuDate } from "@/lib/format/date";
import { balanceAfterWeek1Pence } from "@/lib/payments/dfy-access";
import {
  createDfyPaymentLink,
  setFamilyAccess,
} from "@/lib/actions/admin/dfy";
import { UserDetailDrawer } from "@/app/admin/users/UserDetailDrawer";
import type { UserData } from "@/app/admin/users/page";
import type { ParentSubscriptionRow } from "./page";

interface Props {
  parentUserData: UserData | null;
  parentIsTestUser: boolean;
  nannyUserData: UserData | null;
  sub: ParentSubscriptionRow | null;
  /** 4c — first week's wages from the placement snapshot, the balance preview's default. */
  placementWagesPence?: number | null;
}

/** Top-of-page parent + nanny tiles with quick-access drawer buttons
 *  that open the same UserDetailDrawer used on `/admin/users` —
 *  inline, NOT a redirect. Bailey 2026-05-14. */
export function SubscriptionDetailHeader({
  parentUserData,
  parentIsTestUser,
  nannyUserData,
  sub,
  placementWagesPence = null,
}: Props) {
  const [drawerUser, setDrawerUser] = useState<UserData | null>(null);

  const parentName = parentUserData
    ? [parentUserData.first_name, parentUserData.last_name]
        .filter(Boolean)
        .join(" ") ||
      parentUserData.email ||
      parentUserData.user_id.slice(0, 8)
    : "—";
  const nannyName = nannyUserData
    ? [nannyUserData.first_name, nannyUserData.last_name]
        .filter(Boolean)
        .join(" ") ||
      nannyUserData.email ||
      nannyUserData.user_id.slice(0, 8)
    : null;

  return (
    <>
      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        <PartyCard
          kind="parent"
          name={parentName}
          email={parentUserData?.email ?? null}
          phone={parentUserData?.mobile_number ?? null}
          isTestUser={parentIsTestUser}
          onOpenProfile={() => parentUserData && setDrawerUser(parentUserData)}
          stripeCustomerHref={
            sub?.stripe_customer_id
              ? `https://dashboard.stripe.com/test/customers/${sub.stripe_customer_id}`
              : null
          }
        />
        {nannyUserData && nannyName ? (
          <PartyCard
            kind="nanny"
            name={nannyName}
            email={nannyUserData.email}
            phone={nannyUserData.mobile_number}
            isTestUser={false}
            onOpenProfile={() => setDrawerUser(nannyUserData)}
            stripeCustomerHref={null}
          />
        ) : (
          <Card className="border-dashed bg-slate-50/50">
            <CardContent className="flex flex-col items-center justify-center gap-1 py-8 text-center">
              <Baby className="h-5 w-5 text-slate-400" aria-hidden="true" />
              <p className="text-sm font-medium text-slate-600">
                No nanny linked yet
              </p>
              <p className="text-xs text-slate-500">
                Parent hasn&apos;t connected any nanny via the child invite
                flow.
              </p>
            </CardContent>
          </Card>
        )}
      </div>

      {parentUserData && (
        <DfyPanel
          parentUserId={parentUserData.user_id}
          sub={sub}
          placementWagesPence={placementWagesPence}
        />
      )}

      <UserDetailDrawer
        user={drawerUser}
        open={drawerUser !== null}
        onOpenChange={(o) => {
          if (!o) setDrawerUser(null);
        }}
      />
    </>
  );
}

interface PartyCardProps {
  kind: "parent" | "nanny";
  name: string;
  email: string | null;
  phone: string | null;
  isTestUser: boolean;
  onOpenProfile: () => void;
  stripeCustomerHref: string | null;
}

function PartyCard({
  kind,
  name,
  email,
  phone,
  isTestUser,
  onOpenProfile,
  stripeCustomerHref,
}: PartyCardProps) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
              {kind === "parent" ? "Parent" : "Linked nanny"}
            </p>
            <h2 className="mt-1 truncate text-lg font-bold text-slate-900">
              {name}
            </h2>
            {email && (
              <p className="truncate text-sm text-slate-600">{email}</p>
            )}
            {phone && (
              <p className="truncate text-sm text-slate-500">{phone}</p>
            )}
          </div>
          {isTestUser && (
            <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
              Test
            </span>
          )}
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onOpenProfile}
            className="inline-flex items-center gap-1.5 rounded-md border border-violet-200 bg-violet-50 px-3 py-1.5 text-sm font-medium text-violet-700 hover:bg-violet-100"
          >
            <UserCog className="h-3.5 w-3.5" aria-hidden="true" />
            Open profile
          </button>
          {stripeCustomerHref && (
            <a
              href={stripeCustomerHref}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Stripe Dashboard
              <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
            </a>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// 4c — done-for-you state, preset payment links (card 5a) and the access toggle (card 7b).
// Amounts from `@/config/prices` / `@/config/offer` only; VAT wording here is "incl. VAT" only (M-1 1d).
// ---------------------------------------------------------------------------

const MONEY = new Intl.NumberFormat(APP_LOCALE, {
  style: "currency",
  currency: PRICES.currency.toUpperCase(),
});
const PENCE_PER_POUND = 100;
const fmt = (pence: number) => MONEY.format(pence / PENCE_PER_POUND);

const PRESET_LABEL: Record<PaymentLinkPreset, string> = {
  deposit: "Deposit",
  "balance-after-week-1": "Balance after week 1",
  custom: "Custom",
};

const ERROR_COPY: Record<string, string> = {
  deposit_already_paid: "The deposit is already paid — use Custom for anything else.",
  bill_already_paid: "The bill is already paid — use Custom for anything else.",
  payment_not_due: "Not due yet — the balance can be sent from the payment-due date.",
  wages_required: "Enter the first week's wages.",
  invalid_amount: "Enter an amount in pounds and pence.",
  no_subscription_row: "This family has no subscription row yet.",
  nothing_due: "Nothing is due after the deposit and first week's credit.",
  stripe_error: "Stripe could not create the link — try again.",
};

/** Pounds typed by the admin → whole pence, or null. */
function toPence(raw: string): number | null {
  const n = Number(raw.trim());
  if (!raw.trim() || !Number.isFinite(n) || n < 0) return null;
  return Math.round(n * PENCE_PER_POUND);
}

function DfyPanel({
  parentUserId,
  sub,
  placementWagesPence,
}: {
  parentUserId: string;
  sub: ParentSubscriptionRow | null;
  placementWagesPence: number | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [wages, setWages] = useState(
    placementWagesPence !== null
      ? String(placementWagesPence / PENCE_PER_POUND)
      : "",
  );
  const [custom, setCustom] = useState("");
  const [link, setLink] = useState<{ url: string; pence: number } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [reason, setReason] = useState("");

  const wagesPence = toPence(wages);
  const isDue =
    !!sub?.payment_due_at && Date.parse(sub.payment_due_at) <= Date.now();
  const preview: Record<PaymentLinkPreset, number | null> = {
    deposit: PRICES.dfy.depositPence,
    "balance-after-week-1":
      wagesPence === null
        ? null
        : balanceAfterWeek1Pence({
            depositPaid: !!sub?.deposit_paid_at,
            firstWeekWagesPence: wagesPence,
          }),
    custom: toPence(custom),
  };

  const mint = (preset: PaymentLinkPreset) =>
    startTransition(async () => {
      setMessage(null);
      setLink(null);
      const res = await createDfyPaymentLink(parentUserId, preset, {
        ...(preset === "balance-after-week-1" && wagesPence !== null
          ? { firstWeekWagesPence: wagesPence }
          : {}),
        ...(preset === "custom" && preview.custom !== null
          ? { customPence: preview.custom }
          : {}),
      });
      if (res.success) setLink(res.data);
      else setMessage(ERROR_COPY[res.error] ?? res.error);
    });

  const toggle = (on: boolean | null) =>
    startTransition(async () => {
      setMessage(null);
      const res = await setFamilyAccess(parentUserId, on, reason);
      if (res.success) {
        setReason("");
        router.refresh();
      } else setMessage(res.error);
    });

  const override = sub?.access_toggled_on ?? null;

  return (
    <Card className="mt-3">
      <CardContent className="space-y-4 p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
            Done for you
          </p>
          <p className="text-sm text-slate-600">
            {sub?.family_type === "dfy" ? "Done-for-you family" : "Self-serve"}
            {sub ? ` · ${sub.status.replace(/_/g, " ")}` : " · no subscription row"}
          </p>
        </div>

        {sub && (
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm md:grid-cols-4">
            <Fact label="Deposit paid" iso={sub.deposit_paid_at} />
            <Fact label="Placed" iso={sub.placed_at} />
            <Fact label="Payment due" iso={sub.payment_due_at} />
            <Fact label="Bill paid" iso={sub.bill_paid_at} />
          </dl>
        )}

        <div className="space-y-2" data-testid="dfy-links">
          <p className="text-sm font-medium text-slate-900">Payment links</p>
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-xs text-slate-600">
              First week&apos;s wages
              <input
                inputMode="decimal"
                value={wages}
                onChange={(e) => setWages(e.target.value)}
                className="mt-1 block w-28 rounded-md border border-slate-200 px-2 py-1 text-sm"
                aria-label="First week's wages in pounds"
              />
            </label>
            <label className="text-xs text-slate-600">
              Custom amount
              <input
                inputMode="decimal"
                value={custom}
                onChange={(e) => setCustom(e.target.value)}
                className="mt-1 block w-28 rounded-md border border-slate-200 px-2 py-1 text-sm"
                aria-label="Custom amount in pounds"
              />
            </label>
          </div>
          <div className="flex flex-wrap gap-2">
            {PAYMENT_LINK_PRESETS.map((preset) => {
              const pence = preview[preset];
              const blocked =
                pending ||
                pence === null ||
                pence <= 0 ||
                (preset === "balance-after-week-1" &&
                  (!isDue || !!sub?.bill_paid_at)) ||
                (preset === "deposit" && !!sub?.deposit_paid_at) ||
                (preset !== "deposit" && !sub);
              return (
                <button
                  key={preset}
                  type="button"
                  disabled={blocked}
                  onClick={() => mint(preset)}
                  className="rounded-md border border-violet-200 bg-violet-50 px-3 py-1.5 text-sm font-medium text-violet-700 hover:bg-violet-100 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {PRESET_LABEL[preset]}
                  {pence !== null && pence > 0 ? ` · ${fmt(pence)} incl. VAT` : ""}
                </button>
              );
            })}
          </div>
          {!isDue && sub?.payment_due_at && (
            <p className="text-xs text-slate-500">
              Balance can be sent from {formatAuDate(sub.payment_due_at)}.
            </p>
          )}
          {link && (
            <div className="flex items-center gap-2 rounded-md bg-slate-50 p-2 text-xs">
              <span className="font-medium text-slate-700">{fmt(link.pence)}</span>
              <input
                readOnly
                value={link.url}
                className="min-w-0 flex-1 bg-transparent text-slate-600"
                aria-label="Payment link to send"
                onFocus={(e) => e.currentTarget.select()}
              />
              <button
                type="button"
                onClick={() => navigator.clipboard?.writeText(link.url)}
                className="inline-flex items-center gap-1 text-violet-700 hover:underline"
              >
                <Copy className="h-3 w-3" aria-hidden="true" />
                Copy
              </button>
            </div>
          )}
        </div>

        <div className="space-y-2 border-t border-slate-100 pt-4" data-testid="access-toggle">
          <p className="text-sm font-medium text-slate-900">
            App access override:{" "}
            <span className="font-normal text-slate-600">
              {override === null ? "none" : override ? "on" : "off"}
              {sub?.access_toggle_reason ? ` — ${sub.access_toggle_reason}` : ""}
            </span>
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Reason (required)"
              maxLength={500}
              className="w-64 rounded-md border border-slate-200 px-2 py-1 text-sm"
              aria-label="Reason for the access change"
            />
            {(
              [
                [true, "Turn on"],
                [false, "Turn off"],
                [null, "Clear override"],
              ] as const
            ).map(([on, label]) => (
              <button
                key={label}
                type="button"
                disabled={pending || !sub || reason.trim().length < 3}
                onClick={() => toggle(on)}
                className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {message && (
          <p role="alert" className="text-sm text-amber-700">
            {message}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function Fact({ label, iso }: { label: string; iso?: string | null }) {
  return (
    <div>
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="text-slate-900">{iso ? formatAuDate(iso) : "—"}</dd>
    </div>
  );
}
