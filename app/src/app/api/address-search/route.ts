import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { SITE_NAME, SITE_URL } from "@/lib/constants";
import { toServedPrefix } from "@/lib/uk-contact";

// Photon (OpenStreetMap-backed geocoder, hosted by Komoot) replaces the
// previous `api.addressr.io` upstream, which began rejecting our serverless
// IPs ("no-origin not permitted from <ip>") and effectively blocked signup
// + verification flows. Photon is free, key-free, GB-supported, and has
// reasonable terms. We adapt the response into the `AddressResult` shape
// (`sla` legible all-caps line + `ssla` + `pid` + `score`) that the existing
// consumers parse via `parseUkAddress` — so the line carries no state or
// county token, only `line1, [line2, ]TOWN POSTCODE` (12.01).

interface PhotonFeature {
  properties?: {
    housenumber?: string;
    street?: string;
    suburb?: string;
    /** A sub-neighbourhood: "Myatt's Fields", "East Marylebone". */
    locality?: string;
    /** A neighbourhood: "Soho", "Oval", "Clapham". Often, not always, a district. */
    district?: string;
    /** "London" for the whole metro, or the local authority elsewhere. */
    city?: string;
    postcode?: string;
    country?: string;
    countrycode?: string;
    osm_id?: number;
    osm_type?: string;
  };
}

interface AddressResult {
  sla: string;
  ssla?: string;
  pid: string;
  score: number;
}

/** Central London. Photon ranks by importance mixed with proximity to this. */
const LONDON_BIAS = { lat: "51.51", lon: "-0.13" } as const;

/**
 * The served geography, as this route needs it: every district name, and the
 * district to fall back to for each prefix. Loaded once per server instance —
 * it is seed-only reference data that changes by data migration, and the route
 * is called once per keystroke-debounce, so a per-request read is pure waste.
 */
interface ServedGeography {
  /** lower-cased district name -> canonical district name */
  names: Map<string, string>;
  /** prefix -> canonical district name */
  byPrefix: Map<string, string>;
}

let servedPromise: Promise<ServedGeography> | null = null;

async function loadServedGeography(): Promise<ServedGeography> {
  const names = new Map<string, string>();
  const byPrefix = new Map<string, string>();
  try {
    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from("london_districts")
      .select("district, prefix");
    if (error || !data) {
      // Fail open here, fail closed at the consumer's service-area gate: an
      // unreachable database must not silently empty every autocomplete.
      console.warn("[address-search] district lookup failed", error);
      return { names, byPrefix };
    }
    for (const row of data as Array<{ district: string; prefix: string }>) {
      names.set(row.district.toLowerCase(), row.district);
      // A prefix can carry several districts (SW1 is Westminster, Victoria and
      // Belgravia). They share one centroid, so any of them is correct; keep
      // the first by name so the choice is deterministic.
      const existing = byPrefix.get(row.prefix);
      if (!existing || row.district < existing) {
        byPrefix.set(row.prefix, row.district);
      }
    }
  } catch (err) {
    console.warn("[address-search] district lookup threw", err);
  }
  return { names, byPrefix };
}

function servedGeography(): Promise<ServedGeography> {
  servedPromise ??= loadServedGeography();
  return servedPromise;
}

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q");
  if (!q || q.trim().length < 4) {
    return NextResponse.json([]);
  }

  // Users commonly type flat numbers as "Flat 4, 12 Baker Street" (and the
  // "4/12" form arrives from habit too). Photon's OSM-backed dataset rarely
  // indexes the flat segment, so we split it off before querying and stitch it
  // back onto every result's SLA. Without this, the whole query matches
  // nothing.
  const { unit, baseQuery } = splitUnitPrefix(q);

  try {
    const upstream = await fetch(
      `https://photon.komoot.io/api/?q=${encodeURIComponent(baseQuery)}` +
        `&lang=en&limit=50&lat=${LONDON_BIAS.lat}&lon=${LONDON_BIAS.lon}`,
      {
        headers: {
          // No PII in this UA — third-party access logs would otherwise
          // accumulate the admin contact email indefinitely.
          "User-Agent": `${SITE_NAME.toLowerCase()}-address-search/1.0 (+${SITE_URL})`,
        },
        signal: AbortSignal.timeout(5000),
      },
    );

    if (!upstream.ok) {
      console.warn(
        `[address-search] upstream ${upstream.status} ${upstream.statusText}`,
      );
      return NextResponse.json([]);
    }

    const data: unknown = await upstream.json();
    if (!isPhotonResponse(data)) {
      console.warn("[address-search] upstream returned unexpected shape");
      return NextResponse.json([]);
    }

    const served = await servedGeography();
    const gbFeatures = data.features.filter(
      (f) => f.properties?.countrycode === "GB",
    );
    const results = gbFeatures
      .map((f, i) => mapToAddressResult(f, i, gbFeatures, unit, served))
      .filter((r): r is AddressResult => r !== null);

    return NextResponse.json(results);
  } catch (err) {
    console.error("[address-search] fetch failed", err);
    return NextResponse.json([]);
  }
}

/**
 * Strips a flat/unit prefix from a free-text address query so the remaining
 * street-level portion can be sent to Photon, then returns the prefix in
 * canonical "X/" form to be re-prepended to every result.
 *
 * Recognised patterns (case-insensitive):
 *   "Flat 4, 12 Baker St"     → unit "4/",  base "12 Baker St"
 *   "Flat 4 12 Baker St"      → unit "4/",  base "12 Baker St"
 *   "Apt 4 - 12 Baker St"     → unit "4/",  base "12 Baker St"
 *   "4/12 Baker St"           → unit "4/",  base "12 Baker St"
 *
 * Otherwise returns the query unchanged with an empty unit.
 */
function splitUnitPrefix(q: string): { unit: string; baseQuery: string } {
  const trimmed = q.trim();

  // "4/12 Baker St" form
  const slashMatch = trimmed.match(/^(\d+[a-zA-Z]?)\s*\/\s*(\d+.*)$/);
  if (slashMatch) {
    return {
      unit: `${slashMatch[1].toUpperCase()}/`,
      baseQuery: slashMatch[2].trim(),
    };
  }

  // "Flat 4, 12 Baker St" / "Unit 4, 12 Baker St" / "Apt 4 12 Baker St" form
  const wordMatch = trimmed.match(
    /^(?:unit|flat|apt|apartment)\s+(\d+[a-zA-Z]?)\s*[,\-/]?\s*(\d+.*)$/i,
  );
  if (wordMatch) {
    return {
      unit: `${wordMatch[1].toUpperCase()}/`,
      baseQuery: wordMatch[2].trim(),
    };
  }

  return { unit: "", baseQuery: trimmed };
}

function isPhotonResponse(d: unknown): d is { features: PhotonFeature[] } {
  if (!d || typeof d !== "object") return false;
  const obj = d as Record<string, unknown>;
  return Array.isArray(obj.features);
}

/**
 * Pick the town segment of the SLA.
 *
 * None of Photon's UK fields is a reliable district on its own: `suburb` is
 * almost never populated, `locality` is a sub-neighbourhood ("Myatt's Fields"),
 * `district` is a neighbourhood that is sometimes a served district and
 * sometimes not ("Oval"), and `city` is "London" for the whole metro. So the
 * candidates are checked against the served district names first, then the
 * postcode prefix decides, and only then do we fall back to the most specific
 * field Photon gave us (ADR-188).
 *
 * A feature outside the served set keeps its Photon name and is still
 * returned — the consumer's service-area gate is the one place that decision
 * belongs.
 */
function resolveTown(
  p: NonNullable<PhotonFeature["properties"]>,
  postcode: string,
  served: ServedGeography,
): string {
  const candidates = [p.suburb, p.locality, p.district, p.city]
    .map((c) => (c ?? "").trim())
    .filter((c) => c.length > 0);

  for (const candidate of candidates) {
    const canonical = served.names.get(candidate.toLowerCase());
    if (canonical) return canonical;
  }

  const prefix = toServedPrefix(postcode, new Set(served.byPrefix.keys()));
  const byPrefix = prefix ? served.byPrefix.get(prefix) : undefined;
  if (byPrefix) return byPrefix;

  return candidates[0] ?? "";
}

function mapToAddressResult(
  f: PhotonFeature,
  index: number,
  all: ReadonlyArray<PhotonFeature>,
  unit: string,
  served: ServedGeography,
): AddressResult | null {
  const p = f.properties;
  if (!p) return null;

  const street = (p.street ?? "").trim().toUpperCase();
  const postcode = (p.postcode ?? "").trim().toUpperCase();
  const town = resolveTown(p, postcode, served).toUpperCase();

  if (!street || !town || !postcode) return null;

  // `unit` is "4/" or "" — Photon doesn't typically index flat-level data so
  // we pre-stripped it from the query (see splitUnitPrefix) and we paste it
  // back here as a literal prefix on the street segment.
  const housePrefix = p.housenumber
    ? `${unit}${p.housenumber.trim()} `
    : unit
      ? `${unit}`
      : "";
  // No state or county token: `parseUkAddress` takes the last comma segment as
  // the town and the trailing UK postcode, and returns null for anything else.
  const sla = `${housePrefix}${street}, ${town} ${postcode}`;

  // `osm_id` is scoped per feature type in OSM (a node + way + relation can
  // share an integer id), so include `osm_type` to keep `pid` collision-free.
  // Unit is also part of the identity — two flats at the same street have
  // distinct `pid`s.
  const pid =
    p.osm_id !== undefined ? `${unit}${p.osm_type ?? "?"}/${p.osm_id}` : sla;

  return {
    sla,
    ssla: sla,
    pid,
    // Preserve Photon's upstream ordering by emitting a descending score so
    // consumers that sort on `score` still see the best match first.
    score: all.length - index,
  };
}
