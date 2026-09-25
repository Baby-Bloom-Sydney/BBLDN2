import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { MapPin, ArrowRight, ShieldCheck, Car, Syringe } from "lucide-react";

export interface NannyCardData {
  id: string;
  user_id: string;
  first_name: string;
  last_name: string;
  suburb: string;
  profile_picture_url: string | null;
  hourly_rate_min: number | null;
  nanny_experience_years: number | null;
  total_experience_years: number | null;
  under_3_experience_years: number | null;
  newborn_experience_years: number | null;
  highest_qualification: string | null;
  verification_tier: string;
  verification_level: number | null;
  drivers_license: boolean | null;
  vaccination_status: boolean | null;
  languages: string[] | null;
  role_types_preferred: string[] | null;
  ai_headline?: string | null;
  date_of_birth?: string | null;
}

interface NannyCardProps {
  nanny: NannyCardData;
  showRequestButton?: boolean;
  onRequestInterview?: (nannyId: string) => void;
}

export function NannyCard({ nanny, showRequestButton = false, onRequestInterview }: NannyCardProps) {
  const initials = `${nanny.first_name[0]}${nanny.last_name[0]}`;
  const experienceYears = nanny.nanny_experience_years || nanny.total_experience_years;
  const isVerified = (nanny.verification_level ?? 0) >= 3;

  return (
    <Card className="group hover:shadow-lg transition-all hover:border-violet-200 overflow-hidden">
      <CardHeader className="p-0">
        <div className="h-48 bg-gradient-to-br from-violet-100 to-violet-200 relative">
          {nanny.profile_picture_url ? (
            <img
              src={nanny.profile_picture_url}
              alt={`${nanny.first_name} ${nanny.last_name}`}
              className="absolute inset-0 w-full h-full object-cover"
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="w-24 h-24 rounded-full bg-white shadow-md flex items-center justify-center">
                <span className="text-3xl font-semibold text-violet-500">{initials}</span>
              </div>
            </div>
          )}
          {isVerified && (
            <Badge className="absolute top-3 right-3 bg-green-500 hover:bg-green-500">
              <ShieldCheck className="mr-1 h-3 w-3" />
              Verified
            </Badge>
          )}
        </div>
      </CardHeader>

      <CardContent className="p-5">
        <div className="flex items-start justify-between">
          <div>
            <h3 className="font-semibold text-lg text-slate-900 group-hover:text-violet-600 transition-colors">
              {nanny.first_name.charAt(0).toUpperCase() + nanny.first_name.slice(1)}
            </h3>
            <div className="flex items-center gap-1 text-sm text-slate-500 mt-0.5">
              <MapPin className="w-3.5 h-3.5" />
              {nanny.suburb}
            </div>
          </div>
          {nanny.hourly_rate_min && (
            <div className="text-right">
              <div className="font-bold text-lg text-slate-900">£{nanny.hourly_rate_min}</div>
              <div className="text-xs text-slate-500">/hour</div>
            </div>
          )}
        </div>

        {experienceYears && (
          <p className="mt-3 text-sm text-slate-600">
            {experienceYears} year{experienceYears !== 1 ? "s" : ""} experience as a nanny
          </p>
        )}

        {nanny.ai_headline && (
          <p className="mt-2 text-xs text-slate-500 italic line-clamp-3">
            {nanny.ai_headline.replace(/<[^>]*>/g, "")}
          </p>
        )}

        <div className="mt-4 flex flex-wrap gap-1.5">
          {(nanny.verification_level ?? 0) >= 4 && (
            <Badge variant="secondary" className="text-xs bg-green-100 text-green-700">
              Fully Verified
            </Badge>
          )}
          {nanny.drivers_license && (
            <Badge variant="secondary" className="text-xs bg-slate-100 text-slate-600">
              <Car className="mr-1 h-3 w-3" />
              License
            </Badge>
          )}
          {nanny.vaccination_status && (
            <Badge variant="secondary" className="text-xs bg-slate-100 text-slate-600">
              <Syringe className="mr-1 h-3 w-3" />
              Vaccinated
            </Badge>
          )}
          {nanny.languages?.slice(0, 2).map((lang) => (
            <Badge key={lang} variant="secondary" className="text-xs bg-slate-100 text-slate-600">
              {lang}
            </Badge>
          ))}
        </div>

        <div className="mt-4 flex gap-2">
          <Button
            asChild
            variant="outline"
            className="flex-1 group-hover:bg-violet-50 transition-all"
          >
            <Link href={`/nannies/${nanny.id}`}>
              View Profile
              <ArrowRight className="ml-2 w-4 h-4" />
            </Link>
          </Button>
          {showRequestButton && onRequestInterview && (
            <Button
              onClick={() => onRequestInterview(nanny.id)}
              className="flex-1 bg-violet-500 hover:bg-violet-600"
            >
              Request Interview
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export function NannyCardSkeleton() {
  return (
    <Card className="overflow-hidden">
      <CardHeader className="p-0">
        <div className="h-48 bg-gradient-to-br from-slate-100 to-slate-200 animate-pulse" />
      </CardHeader>
      <CardContent className="p-5">
        <div className="space-y-3">
          <div className="h-5 w-2/3 animate-pulse rounded bg-slate-200" />
          <div className="h-4 w-1/3 animate-pulse rounded bg-slate-200" />
          <div className="h-4 w-full animate-pulse rounded bg-slate-200" />
          <div className="flex gap-2">
            <div className="h-6 w-16 animate-pulse rounded-full bg-slate-200" />
            <div className="h-6 w-20 animate-pulse rounded-full bg-slate-200" />
          </div>
          <div className="h-9 w-full animate-pulse rounded bg-slate-200" />
        </div>
      </CardContent>
    </Card>
  );
}

export function EmptyNannyState() {
  return (
    <Card className="col-span-full py-12">
      <CardContent className="text-center">
        <div className="mx-auto mb-4 h-16 w-16 rounded-full bg-violet-100 flex items-center justify-center">
          <ShieldCheck className="h-8 w-8 text-violet-500" />
        </div>
        <h3 className="text-lg font-semibold text-slate-900">No nannies found</h3>
        <p className="mt-2 text-sm text-slate-500">
          Check back soon as more verified nannies join our platform.
        </p>
      </CardContent>
    </Card>
  );
}
