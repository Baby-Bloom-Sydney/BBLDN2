"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Loader2, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { submitContactSection } from "@/lib/actions/verification";
import type { VerificationData } from "@/lib/actions/verification";
import { BRAND } from "@/lib/constants";
import {
  formatAddressLine,
  normaliseUkMobile,
  parseUkAddress,
  toTitleCase,
  type ParsedAddress,
  toServedPrefix,
} from "@/lib/uk-contact";

interface AddressrResult {
  sla: string;
  ssla?: string;
  pid: string;
  score: number;
}

interface ContactSectionProps {
  verification: VerificationData | null;
  locked: boolean;
  onSaved: () => void;
}

export function ContactSection({
  verification,
  locked,
  onSaved,
}: ContactSectionProps) {
  const status = verification?.contact_status ?? "not_started";
  const isCompleted = status === "saved";

  const [editing, setEditing] = useState(status === "not_started");
  const [isSaving, setIsSaving] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [phone, setPhone] = useState(verification?.phone_number ?? "");

  // GNAF address autocomplete — single field
  const [addressQuery, setAddressQuery] = useState(
    verification?.address_line ?? "",
  );
  const [selectedAddress, setSelectedAddress] = useState<ParsedAddress | null>(
    verification?.address_line && verification?.city && verification?.postcode
      ? {
          line1: verification.address_line,
          line2: "",
          town: verification.city,
          postcode: verification.postcode,
        }
      : null,
  );
  const [addressResults, setAddressResults] = useState<AddressrResult[]>([]);
  const [showAddressDropdown, setShowAddressDropdown] = useState(false);
  const [addressLoading, setAddressLoading] = useState(false);
  const [notInArea, setNotInArea] = useState(false);
  const addressDropdownRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // london_districts for service area validation
  const [servedPrefixes, setServedPrefixes] = useState<Set<string>>(
    new Set(),
  );
  useEffect(() => {
    fetch("/api/london-districts")
      .then((res) => res.json())
      .then((data: { district: string; prefix: string; label: string }[]) => {
        setServedPrefixes(new Set(data.map((d) => d.prefix)));
      })
      .catch(() => {});
  }, []);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (
        addressDropdownRef.current &&
        !addressDropdownRef.current.contains(e.target as Node)
      ) {
        setShowAddressDropdown(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  // Address search — debounced, London-biased and GB-filtered upstream
  const searchAddress = useCallback((query: string) => {
    if (query.trim().length < 4) {
      setAddressResults([]);
      setShowAddressDropdown(false);
      return;
    }

    if (debounceRef.current) clearTimeout(debounceRef.current);

    debounceRef.current = setTimeout(async () => {
      setAddressLoading(true);
      try {
        const res = await fetch(
          `/api/address-search?q=${encodeURIComponent(query)}`,
        );
        if (!res.ok) {
          setAddressResults([]);
          setShowAddressDropdown(false);
          return;
        }
        const data: AddressrResult[] = await res.json();
        // The route already filters to GB and emits the UK address shape,
        // so there is nothing left to filter here (12.01).
        setAddressResults(data.slice(0, 8));
        setShowAddressDropdown(data.length > 0);
      } catch {
        setAddressResults([]);
        setShowAddressDropdown(false);
      } finally {
        setAddressLoading(false);
      }
    }, 180);
  }, []);

  function handleAddressChange(val: string) {
    setAddressQuery(val);
    setSelectedAddress(null);
    setNotInArea(false);
    searchAddress(val);
  }

  function handleAddressSelect(result: AddressrResult) {
    const parsed = parseUkAddress(result.ssla || result.sla);
    if (!parsed) {
      setShowAddressDropdown(false);
      return;
    }

    if (
      servedPrefixes.size > 0 &&
      toServedPrefix(parsed.postcode, servedPrefixes) === null
    ) {
      setNotInArea(true);
      setSelectedAddress(null);
      setAddressQuery(toTitleCase(result.ssla || result.sla));
      setShowAddressDropdown(false);
      return;
    }

    setAddressQuery(parsed.line1);
    setSelectedAddress(parsed);
    setShowAddressDropdown(false);
    setAddressResults([]);
    setNotInArea(false);
  }

  if (locked) {
    return (
      <div className="text-sm text-slate-500 py-4">
        Complete the WWCC section first to unlock residence verification.
      </div>
    );
  }

  const canSave = !!selectedAddress;

  async function handleSave() {
    setIsSaving(true);
    setError(null);

    try {
      const result = await Promise.race([
        submitContactSection({
          phone_number: normaliseUkMobile(phone),
          address_line: formatAddressLine(selectedAddress!),
          city: selectedAddress!.town,
          state: BRAND.region,
          postcode: selectedAddress!.postcode,
          country: BRAND.country,
        }),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error("Save timed out — please try again")),
            15000,
          ),
        ),
      ]);

      if (!result.success) {
        setError(result.error ?? "Failed to save");
        setIsSaving(false);
        return;
      }

      setIsSaving(false);
      setIsVerifying(true);
      await new Promise((resolve) => setTimeout(resolve, 1200));
      setIsVerifying(false);
      setEditing(false);
      onSaved();
    } catch (err) {
      setError(
        `Error: ${err instanceof Error ? err.message : "Unknown error"}`,
      );
      setIsSaving(false);
    }
  }

  const displayAddress = selectedAddress?.line1 ?? verification?.address_line;
  const displaySuburb = selectedAddress?.town ?? verification?.city;
  const displayPostcode = selectedAddress?.postcode ?? verification?.postcode;

  if (!editing && isCompleted) {
    return (
      <div className="space-y-4">
        <div className="space-y-1 text-sm text-green-700">
          {displayAddress && <p>{displayAddress}</p>}
          {displaySuburb && (
            <p>
              {displaySuburb}, {displayPostcode}
            </p>
          )}
        </div>
        <Button
          type="button"
          variant="outline"
          onClick={() => setEditing(true)}
          size="sm"
        >
          Edit
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {error && (
        <div className="rounded-lg bg-red-50 p-3 text-sm text-red-600">
          {error}
        </div>
      )}

      <div className="space-y-2">
        <div className="flex items-baseline justify-between">
          <Label
            htmlFor="address"
            className="text-sm font-medium text-slate-700"
          >
            Address
          </Label>
          <span className="text-xs text-slate-400">London only</span>
        </div>
        <div className="relative" ref={addressDropdownRef}>
          <div className="relative">
            <Input
              id="address"
              placeholder="Start typing your address..."
              value={addressQuery}
              onChange={(e) => handleAddressChange(e.target.value)}
              onFocus={() => {
                if (addressResults.length > 0) setShowAddressDropdown(true);
              }}
              disabled={isSaving}
              autoComplete="off"
            />
            {addressLoading && (
              <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-slate-400" />
            )}
          </div>
          {showAddressDropdown && (
            <div
              className={`absolute z-50 w-full max-h-48 overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg bottom-full mb-1`}
            >
              {addressResults.map((r) => (
                <button
                  key={r.pid}
                  type="button"
                  onClick={() => handleAddressSelect(r)}
                  className="w-full px-4 py-2.5 text-left text-sm text-slate-700 hover:bg-violet-50 hover:text-violet-700 cursor-pointer"
                >
                  {toTitleCase(r.ssla || r.sla)}
                </button>
              ))}
            </div>
          )}
          {selectedAddress && (
            <p className="text-xs text-green-600 font-medium mt-1.5 flex items-center gap-1">
              {selectedAddress.line1}, {selectedAddress.town}{" "}
              {selectedAddress.postcode}
              <Check className="h-3 w-3" />
            </p>
          )}
          {notInArea && (
            <p className="text-xs text-amber-600 mt-1.5">
              This address is outside our service area. We currently only
              operate in Greater London.
            </p>
          )}
        </div>
      </div>

      <Button
        type="button"
        onClick={handleSave}
        disabled={!canSave || isSaving || isVerifying}
        className="w-full bg-violet-600 hover:bg-violet-700 text-white"
      >
        {isSaving || isVerifying ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Verifying...
          </>
        ) : (
          "Verify Residence"
        )}
      </Button>
    </div>
  );
}
