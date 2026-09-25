import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// 12.01 / ADR-188: Photon is biased to London, filtered to GB, and every
// result is emitted in the UK address shape `line1, [line2, ]TOWN POSTCODE`
// that `parseUkAddress` accepts — no state token anywhere.

// The route reads the served district names so Photon's neighbourhood fields
// can be resolved to a district a family is actually filed under. Mocked here
// so the suite stays offline.
const districtRows = [
  { district: "Westminster", prefix: "SW1" },
  { district: "Covent Garden", prefix: "WC2" },
  { district: "Soho", prefix: "W1" },
  { district: "Stockwell", prefix: "SW9" },
  { district: "Clapham", prefix: "SW4" },
];
let districtResult: { data: typeof districtRows | null; error: unknown } = {
  data: districtRows,
  error: null,
};
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({ select: () => Promise.resolve(districtResult) }),
  }),
}));

// Mock global fetch BEFORE importing the route under test
const fetchMock = vi.fn();
beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  districtResult = { data: districtRows, error: null };
  vi.resetModules(); // the route memoises the district list per module instance
});
afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

async function callRoute(q: string | null) {
  const { GET } = await import("./route");
  const url =
    q === null
      ? "http://localhost/api/address-search"
      : `http://localhost/api/address-search?q=${encodeURIComponent(q)}`;
  const req = new NextRequest(url);
  return GET(req);
}

function photonFeature(props: Record<string, string | number>) {
  return {
    type: "Feature",
    geometry: { type: "Point", coordinates: [-0.13, 51.51] },
    properties: props,
  };
}

describe("GET /api/address-search", () => {
  it("returns [] when q is missing", async () => {
    const res = await callRoute(null);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns [] when q is shorter than 4 chars", async () => {
    const res = await callRoute("abc");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("maps a full Photon address into the UK AddressResult shape", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          features: [
            photonFeature({
              housenumber: "12",
              street: "Clapham High Street",
              district: "Clapham",
              city: "London",
              state: "England",
              postcode: "SW4 7UR",
              countrycode: "GB",
              osm_id: 999,
              osm_type: "N",
            }),
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    const res = await callRoute("12 clapham high street");
    expect(res.status).toBe(200);
    const data = (await res.json()) as Array<{
      sla: string;
      ssla?: string;
      pid: string;
      score: number;
    }>;
    expect(data).toHaveLength(1);
    expect(data[0].sla).toBe("12 CLAPHAM HIGH STREET, CLAPHAM SW4 7UR");
    // ssla matches sla so consumers using `r.ssla || r.sla` get the same legible form
    expect(data[0].ssla).toBe("12 CLAPHAM HIGH STREET, CLAPHAM SW4 7UR");
    // pid namespaces osm_id by osm_type to avoid cross-type collisions
    expect(data[0].pid).toBe("N/999");
    // first result keeps the highest score so consumers that sort on `score`
    // see Photon's relevance order intact
    expect(data[0].score).toBe(1);
  });

  it("emits an sla that parseUkAddress can parse — the whole point of the shape", async () => {
    const { parseUkAddress } = await import("@/lib/uk-contact");
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          features: [
            photonFeature({
              housenumber: "10",
              street: "Downing Street",
              locality: "Westminster",
              district: "Covent Garden",
              city: "London",
              postcode: "SW1A 2AA",
              countrycode: "GB",
            }),
          ],
        }),
        { status: 200 },
      ),
    );

    const res = await callRoute("10 downing street");
    const data = (await res.json()) as Array<{ sla: string }>;
    expect(parseUkAddress(data[0].sla)).toEqual({
      line1: "10 Downing Street",
      line2: "",
      town: "Westminster",
      postcode: "SW1A 2AA",
    });
  });

  it("filters out non-GB features", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          features: [
            photonFeature({
              // A non-GB feature. Deliberately not the country this platform
              // came from — writing that literal here to assert its absence
              // is itself a gate hit (LEDGER/2-0.md lesson 3).
              housenumber: "12",
              street: "Rue Clapham",
              city: "Paris",
              postcode: "75001",
              countrycode: "FR",
            }),
            photonFeature({
              housenumber: "12",
              street: "Clapham High Street",
              district: "Clapham",
              city: "London",
              postcode: "SW4 7UR",
              countrycode: "GB",
            }),
          ],
        }),
        { status: 200 },
      ),
    );

    const res = await callRoute("high street");
    const data = (await res.json()) as Array<{ sla: string }>;
    expect(data).toHaveLength(1);
    expect(data[0].sla).toBe("12 CLAPHAM HIGH STREET, CLAPHAM SW4 7UR");
  });

  it("carries no state or county token — the shape the UK parser refuses", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          features: [
            photonFeature({
              housenumber: "12",
              street: "Clapham High Street",
              district: "Clapham",
              city: "London",
              state: "England",
              county: "Greater London",
              postcode: "SW4 7UR",
              countrycode: "GB",
            }),
          ],
        }),
        { status: 200 },
      ),
    );

    const res = await callRoute("12 clapham high street");
    const data = (await res.json()) as Array<{ sla: string }>;
    expect(data[0].sla).not.toMatch(/ENGLAND|GREATER LONDON/);
  });

  // Photon's UK fields are not a single reliable source: `suburb` is never
  // populated, `locality` is a sub-neighbourhood ("Myatt's Fields"), `district`
  // is a neighbourhood that is sometimes a served district and sometimes not
  // ("Oval"), and `city` is "London" for the whole metro. So the candidates are
  // resolved against the served district names first (ADR-188).
  describe("resolving the town to a served district", () => {
    it("prefers the candidate that is a served district, not the most specific field", async () => {
      // `locality` "Westminster" is served; `district` "Covent Garden" is also
      // served but comes later in the precedence, and `city` "London" is not a
      // district at all.
      fetchMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            features: [
              photonFeature({
                housenumber: "10",
                street: "Downing Street",
                locality: "Westminster",
                district: "Covent Garden",
                city: "London",
                postcode: "SW1A 2AA",
                countrycode: "GB",
              }),
            ],
          }),
          { status: 200 },
        ),
      );

      const res = await callRoute("10 downing street");
      const data = (await res.json()) as Array<{ sla: string }>;
      expect(data[0].sla).toBe("10 DOWNING STREET, WESTMINSTER SW1A 2AA");
    });

    it("skips a neighbourhood that is not a served district and lets the prefix decide", async () => {
      // "Myatt's Fields" is a real Photon `locality` and is not a district.
      // "Oval" is a real Photon `district` and is not one either — SW9 is
      // filed under Stockwell.
      fetchMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            features: [
              photonFeature({
                housenumber: "50",
                street: "Brixton Road",
                locality: "Myatt's Fields",
                district: "Oval",
                city: "London",
                postcode: "SW9 6BT",
                countrycode: "GB",
              }),
            ],
          }),
          { status: 200 },
        ),
      );

      const res = await callRoute("50 brixton road");
      const data = (await res.json()) as Array<{ sla: string }>;
      expect(data[0].sla).toBe("50 BRIXTON ROAD, STOCKWELL SW9 6BT");
    });

    it("resolves a sub-district postcode to its parent prefix's district", async () => {
      // W1D is a sub-district of W1, which is never stored (ADR-188).
      fetchMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            features: [
              photonFeature({
                housenumber: "12",
                street: "Old Compton Street",
                district: "Unserved Neighbourhood",
                city: "London",
                postcode: "W1D 4TQ",
                countrycode: "GB",
              }),
            ],
          }),
          { status: 200 },
        ),
      );

      const res = await callRoute("12 old compton street");
      const data = (await res.json()) as Array<{ sla: string }>;
      expect(data[0].sla).toBe("12 OLD COMPTON STREET, SOHO W1D 4TQ");
    });

    it("falls back to the most specific Photon field when nothing is served", async () => {
      // Outside the served set entirely. The route does not drop it — the
      // consumer's service-area gate rejects it by prefix, which is the one
      // place that decision belongs.
      fetchMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            features: [
              photonFeature({
                housenumber: "12",
                street: "Baker Street",
                locality: "Sunnybank",
                district: "Potters Bar",
                city: "Hertsmere",
                postcode: "EN6 2EA",
                countrycode: "GB",
              }),
            ],
          }),
          { status: 200 },
        ),
      );

      const res = await callRoute("12 baker street");
      const data = (await res.json()) as Array<{ sla: string }>;
      expect(data[0].sla).toBe("12 BAKER STREET, SUNNYBANK EN6 2EA");
    });

    it("still returns results when the district lookup fails", async () => {
      // Fail-open here, fail-closed at the consumer's gate: an unreachable
      // database must not silently empty the autocomplete.
      districtResult = { data: null, error: new Error("db down") };
      fetchMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            features: [
              photonFeature({
                housenumber: "12",
                street: "Clapham High Street",
                district: "Clapham",
                city: "London",
                postcode: "SW4 7UR",
                countrycode: "GB",
              }),
            ],
          }),
          { status: 200 },
        ),
      );

      const res = await callRoute("12 clapham high street");
      const data = (await res.json()) as Array<{ sla: string }>;
      expect(data[0].sla).toBe("12 CLAPHAM HIGH STREET, CLAPHAM SW4 7UR");
    });
  });

  it("falls back to `city` when every finer field is missing", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          features: [
            photonFeature({
              housenumber: "1",
              street: "Some Street",
              city: "Norwich",
              postcode: "NR2 1AB",
              countrycode: "GB",
            }),
          ],
        }),
        { status: 200 },
      ),
    );

    const res = await callRoute("1 some street");
    const data = (await res.json()) as Array<{ sla: string }>;
    expect(data[0].sla).toBe("1 SOME STREET, NORWICH NR2 1AB");
  });

  it("uses `suburb` when present, even if the coarser fields are also set", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          features: [
            photonFeature({
              housenumber: "12",
              street: "Some Street",
              suburb: "Clapham",
              locality: "Different Locality",
              district: "Different District",
              city: "London",
              postcode: "SW4 7UR",
              countrycode: "GB",
            }),
          ],
        }),
        { status: 200 },
      ),
    );

    const res = await callRoute("12 some street");
    const data = (await res.json()) as Array<{ sla: string }>;
    expect(data[0].sla).toBe("12 SOME STREET, CLAPHAM SW4 7UR");
  });

  it("drops features without a street, town, or postcode", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          features: [
            photonFeature({
              district: "Clapham",
              postcode: "SW4 7UR",
              countrycode: "GB",
            }), // no street
            photonFeature({
              street: "Clapham High Street",
              district: "Clapham",
              countrycode: "GB",
            }), // no postcode
            photonFeature({
              street: "Some Street",
              postcode: "ZZ9 9ZZ",
              countrycode: "GB",
            }), // no town candidate and no served prefix to fall back to
          ],
        }),
        { status: 200 },
      ),
    );

    const res = await callRoute("clapham");
    expect(await res.json()).toEqual([]);
  });

  it("omits housenumber when not present (street-only matches)", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          features: [
            photonFeature({
              street: "Clapham High Street",
              district: "Clapham",
              city: "London",
              postcode: "SW4 7UR",
              countrycode: "GB",
              osm_id: 42,
            }),
          ],
        }),
        { status: 200 },
      ),
    );

    const res = await callRoute("clapham high street");
    const data = (await res.json()) as Array<{ sla: string }>;
    expect(data[0].sla).toBe("CLAPHAM HIGH STREET, CLAPHAM SW4 7UR");
  });

  it("returns [] (not 5xx) when upstream errors so the UI degrades gracefully", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response("upstream down", { status: 503 }),
    );
    const res = await callRoute("12 clapham high street");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  it("returns [] when fetch throws (network error)", async () => {
    fetchMock.mockRejectedValueOnce(new Error("network unreachable"));
    const res = await callRoute("12 clapham high street");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  it("splits 'Flat 4, 12 …' into unit + base query and re-prepends the unit", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          features: [
            photonFeature({
              housenumber: "12",
              street: "Old Compton Street",
              district: "Soho",
              city: "London",
              postcode: "W1D 4TQ",
              countrycode: "GB",
              osm_id: 999,
              osm_type: "N",
            }),
          ],
        }),
        { status: 200 },
      ),
    );

    const res = await callRoute("Flat 4, 12 Old Compton Street");
    expect(res.status).toBe(200);
    // Upstream is queried with the base address — Photon does not index
    // flat-level data.
    const upstreamUrl = fetchMock.mock.calls[0]?.[0] as string;
    expect(upstreamUrl).toContain("q=12%20Old%20Compton%20Street");
    const data = (await res.json()) as Array<{ sla: string; pid: string }>;
    expect(data[0].sla).toBe("4/12 OLD COMPTON STREET, SOHO W1D 4TQ");
    expect(data[0].pid).toBe("4/N/999");
  });

  it("splits the '4/12' flat form too — habit, and still unindexed upstream", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ features: [] }), { status: 200 }),
    );
    await callRoute("4/12 Old Compton Street");
    const upstreamUrl = fetchMock.mock.calls[0]?.[0] as string;
    expect(upstreamUrl).toContain("q=12%20Old%20Compton%20Street");
    expect(upstreamUrl).not.toContain("4%2F12");
  });

  it("biases Photon search toward London via lat/lon params", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ features: [] }), { status: 200 }),
    );
    await callRoute("12 clapham high street");
    const upstreamUrl = fetchMock.mock.calls[0]?.[0] as string;
    expect(upstreamUrl).toContain("lat=51.51");
    expect(upstreamUrl).toContain("lon=-0.13");
    expect(upstreamUrl).toContain("limit=50");
  });

  it("identifies itself to Photon from the brand constants, with no PII", async () => {
    const { SITE_URL } = await import("@/lib/constants");
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ features: [] }), { status: 200 }),
    );
    await callRoute("12 clapham high street");
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const ua = (init.headers as Record<string, string>)["User-Agent"];
    expect(ua).toContain(SITE_URL);
    expect(ua).not.toContain("@");
  });
});
