import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import Link from 'next/link';
import { Baby, UserCheck, ShieldCheck, Sparkles, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default async function NannyApplyPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();

  let userState: 'guest' | 'parent' | 'nanny_incomplete' | 'nanny_unverified' | 'nanny_complete' = 'guest';
  let ctaHref = '/signup/nanny';
  let ctaLabel = 'Create your account';

  if (user) {
    const admin = createAdminClient();

    const { data: role } = await admin
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id)
      .maybeSingle();

    if (role?.role === 'parent') {
      userState = 'parent';
    } else if (role?.role === 'nanny') {
      const { data: nanny } = await admin
        .from('nannies')
        .select('visible_in_bsr, identity_verified, wwcc_verified, total_experience_years, hourly_rate_min')
        .eq('user_id', user.id)
        .maybeSingle();

      if (nanny) {
        const profileComplete = nanny.total_experience_years !== null && nanny.hourly_rate_min !== null;

        if (!profileComplete) {
          userState = 'nanny_incomplete';
          ctaHref = '/apply';
          ctaLabel = 'Complete your profile';
        } else if (!nanny.identity_verified || !nanny.wwcc_verified) {
          userState = 'nanny_unverified';
          ctaHref = '/nanny/verification';
          ctaLabel = 'Start verification';
        } else {
          userState = 'nanny_complete';
          ctaHref = '/nanny/babysitting';
          ctaLabel = 'Browse opportunities';
        }
      }
    }
  }

  const steps = [
    {
      icon: Baby,
      title: 'Create your account',
      description: 'Sign up as a childcare professional and tell us about yourself.',
      active: userState === 'guest',
      done: userState !== 'guest' && userState !== 'parent',
    },
    {
      icon: UserCheck,
      title: 'Complete your profile',
      description: 'Add your experience, qualifications, availability, and rate.',
      active: userState === 'nanny_incomplete',
      done: userState === 'nanny_unverified' || userState === 'nanny_complete',
    },
    {
      icon: ShieldCheck,
      title: 'Get verified',
      description: 'Upload your WWCC and identity documents for verification.',
      active: userState === 'nanny_unverified',
      done: userState === 'nanny_complete',
    },
    {
      icon: Sparkles,
      title: 'Receive childcare opportunities',
      description: 'Once verified, you can receive and apply for childcare opportunities in your area.',
      active: userState === 'nanny_complete',
      done: false,
    },
  ];

  // Only show CTA button when not logged in or when steps are incomplete
  const showCta = userState === 'guest' || userState === 'nanny_incomplete' || userState === 'nanny_unverified';

  return (
    <>
    <style>{`footer { display: none !important; }`}</style>
    <div className="mx-auto max-w-sm px-4 py-8 space-y-6">
      <div className="text-center">
        <h1 className="text-xl font-bold text-slate-800">
          Apply to work with us!
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          To receive private childcare opportunities<br />complete the steps below
        </p>
      </div>

      {userState === 'parent' && (
        <div className="rounded-lg bg-amber-50 border border-amber-200 p-4 text-sm text-amber-800">
          You are currently signed in with a parent account. To apply as a babysitter, you need to create a separate childcare professional account.
        </div>
      )}

      <div className="relative space-y-0">
        {/* Vertical connector line */}
        <div className="absolute left-[19px] top-[28px] bottom-[28px] w-0.5 bg-slate-200" />

        {steps.map((step, i) => {
          const Icon = step.icon;
          return (
            <div key={i} className="relative flex items-start gap-3 py-3">
              {/* Step indicator */}
              <div className={`relative z-10 flex items-center justify-center h-10 w-10 rounded-full border-2 flex-shrink-0 ${
                step.done
                  ? 'border-green-400 bg-green-50'
                  : step.active
                    ? 'border-violet-400 bg-violet-50 ring-4 ring-violet-100'
                    : 'border-slate-200 bg-white'
              }`}>
                {step.done ? (
                  <Check className="h-5 w-5 text-green-600" />
                ) : (
                  <Icon className={`h-4 w-4 ${
                    step.active ? 'text-violet-600' : 'text-slate-400'
                  }`} />
                )}
              </div>

              <div className="pt-1">
                <p className={`text-sm font-medium ${
                  step.active ? 'text-violet-800' : step.done ? 'text-green-800' : 'text-slate-600'
                }`}>
                  {step.title}
                </p>
                <p className="text-xs text-slate-500 mt-0.5">{step.description}</p>
              </div>
            </div>
          );
        })}
      </div>

      {showCta && (
        <Link href={ctaHref}>
          <Button className="w-full bg-violet-600 hover:bg-violet-700 text-white h-11 mt-2">
            {ctaLabel}
          </Button>
        </Link>
      )}

      {userState === 'parent' && (
        <Link href="/signup/nanny">
          <Button className="w-full bg-violet-600 hover:bg-violet-700 text-white h-11 mt-2">
            Create a childcare account
          </Button>
        </Link>
      )}

      {userState === 'nanny_complete' && (
        <div className="rounded-lg bg-green-50 border border-green-200 p-4 text-sm text-green-800 text-center">
          You&apos;re all set! You can now receive and apply for childcare opportunities.
        </div>
      )}
    </div>
    </>
  );
}
