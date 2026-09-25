import { Card, CardContent } from "@/components/ui/card";
import { AlertCircle } from "lucide-react";
import { getParentBabysittingRequests, getLondonDistricts } from "@/lib/actions/babysitting";
import { ParentBabysittingClient } from "./ParentBabysittingClient";

export default async function ParentBabysittingPage() {
  const [{ data: requests, error }, districts] = await Promise.all([
    getParentBabysittingRequests(),
    getLondonDistricts(),
  ]);

  if (error) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Babysitting</h1>
          <p className="mt-1 text-slate-500">Request one-time babysitting help</p>
        </div>
        <Card>
          <CardContent className="flex items-center gap-3 py-6">
            <AlertCircle className="h-5 w-5 text-red-500" />
            <p className="text-red-600">{error}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return <ParentBabysittingClient requests={requests} districts={districts} />;
}
