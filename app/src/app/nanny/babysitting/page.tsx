import { getNannyBabysittingJobs } from "@/lib/actions/babysitting";
import { NannyBabysittingClient } from "./NannyBabysittingClient";
import { AlertCircle } from "lucide-react";
import { babysittingEnabled } from "@/lib/features/flags";
import { BabysittingComingSoon } from "@/components/babysitting/BabysittingComingSoon";

export default async function NannyBabysittingPage() {
  // 5c (P-23): hidden while BABYSITTING_ENABLED is off — the page stays and says "Coming soon." before any read.
  if (!babysittingEnabled()) return <BabysittingComingSoon withHeading />;

  const { data: jobs, error, banned, banUntil } = await getNannyBabysittingJobs();

  if (error) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Babysitting Jobs</h1>
          <p className="mt-1 text-slate-500">
            View and respond to one-time babysitting opportunities
          </p>
        </div>
        <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-center">
          <AlertCircle className="mx-auto h-8 w-8 text-red-400" />
          <p className="mt-2 text-sm text-red-700">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <NannyBabysittingClient
      jobs={jobs}
      banned={banned}
      banUntil={banUntil}
    />
  );
}
