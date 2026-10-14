/**
 * In-memory Supabase stand-in for pipeline tests (unit 3c, BB-LDN-3c-061026).
 *
 * Supports the chained-builder calls the verification pipeline, the DBS mapper and the sync function make:
 * select / eq / neq / in / is / lt / lte / gt / gte / order / limit / single / maybeSingle / update / insert / delete
 * (delete added by unit 3d for the silent-hold release/cleanup paths),
 * plus `storage.from(bucket).createSignedUrl(path)`. Filters apply to updates, so the atomic claims
 * (`update(...).eq('cross_check_status','pending')`) behave as they do in Postgres.
 *
 * `checks` mirrors the London CHECK constraints a pipeline write can hit (LDN2/schema/04_constraints.sql +
 * amendment 10). A write that breaks one returns `{ error }` and changes nothing — as Postgres does.
 */
type Row = Record<string, unknown>;
type Filter = (row: Row) => boolean;

export interface MemoryDb {
  tables: Record<string, Row[]>;
  /** Every update/insert, in order: table + the payload (for "one UPDATE" assertions). */
  writes: { table: string; op: "update" | "insert" | "delete"; payload: Row }[];
  client: () => unknown;
}

const DBS_RESULTS = ["BLANK_NO_NEW_INFO", "NON_BLANK_NO_NEW_INFO", "NEW_INFO", "NO_MATCH_FOUND"];

/** The verifications CHECKs a pipeline write can break. Returns a message, or null when the row is valid. */
export function verificationsCheck(row: Row): string | null {
  const n = row.wwcc_number;
  if (n != null && !/^[0-9]{12}$/.test(String(n))) return "chk_wwcc_number_dbs";
  const r = row.ocg_result_status;
  if (r != null && !DBS_RESULTS.includes(String(r))) return "chk_ocg_result_status_dbs";
  if (row.verification_status === 40) {
    const ok =
      row.wwcc_verified === true &&
      row.wwcc_verified_by != null &&
      row.wwcc_verified_at != null &&
      r != null &&
      (r === "BLANK_NO_NEW_INFO" || r === "NON_BLANK_NO_NEW_INFO");
    if (!ok) return "chk_fully_verified_requires_admin_approval";
  }
  if (row.wwcc_status === "barred" && row.wwcc_verified === true) return "chk_barred_not_verified";
  return null;
}

export function createMemoryDb(seed: Record<string, Row[]> = {}): MemoryDb {
  const tables: Record<string, Row[]> = {};
  for (const [k, rows] of Object.entries(seed)) tables[k] = rows.map((r) => ({ ...r }));
  const writes: MemoryDb["writes"] = [];

  function table(name: string): Row[] {
    if (!tables[name]) tables[name] = [];
    return tables[name];
  }

  function builder(name: string) {
    const filters: Filter[] = [];
    let mode: "select" | "update" | "insert" | "delete" = "select";
    let payload: Row | Row[] | null = null;
    let returning = false;
    let limitN: number | null = null;
    let orderBy: { col: string; asc: boolean } | null = null;

    const run = (): { data: Row[] | null; error: { message: string; code?: string } | null } => {
      const rows = table(name);
      if (mode === "insert") {
        const list = Array.isArray(payload) ? payload : [payload as Row];
        for (const p of list) {
          rows.push({ id: p.id ?? `${name}-${rows.length + 1}`, ...p });
          writes.push({ table: name, op: "insert", payload: { ...p } });
        }
        return { data: list, error: null };
      }
      let matched = rows.filter((r) => filters.every((f) => f(r)));
      if (mode === "delete") {
        for (const r of matched) {
          rows.splice(rows.indexOf(r), 1);
          writes.push({ table: name, op: "delete", payload: { id: r.id } });
        }
        return { data: returning ? matched.map((r) => ({ ...r })) : null, error: null };
      }
      if (mode === "update") {
        const next = matched.map((r) => ({ ...r, ...(payload as Row) }));
        if (name === "verifications") {
          for (const n of next) {
            const broken = verificationsCheck(n);
            if (broken) return { data: null, error: { message: `violates check constraint "${broken}"`, code: "23514" } };
          }
        }
        writes.push({ table: name, op: "update", payload: { ...(payload as Row) } });
        matched.forEach((r, i) => Object.assign(r, next[i]));
        return { data: returning ? matched.map((r) => ({ ...r })) : null, error: null };
      }
      if (orderBy) {
        const { col, asc } = orderBy;
        matched = [...matched].sort((a, b) => (String(a[col]) < String(b[col]) ? -1 : 1) * (asc ? 1 : -1));
      }
      if (limitN != null) matched = matched.slice(0, limitN);
      return { data: matched.map((r) => ({ ...r })), error: null };
    };

    const b: Record<string, unknown> = {
      select: () => {
        if (mode !== "select") returning = true;
        return b;
      },
      update: (p: Row) => {
        mode = "update";
        payload = p;
        return b;
      },
      delete: () => {
        mode = "delete";
        return b;
      },
      insert: (p: Row | Row[]) => {
        mode = "insert";
        payload = p;
        return b;
      },
      eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), b),
      neq: (c: string, v: unknown) => (filters.push((r) => r[c] !== v), b),
      in: (c: string, vs: unknown[]) => (filters.push((r) => vs.includes(r[c])), b),
      is: (c: string, v: unknown) => (filters.push((r) => (r[c] ?? null) === v), b),
      lt: (c: string, v: string) => (filters.push((r) => String(r[c]) < v), b),
      lte: (c: string, v: string) => (filters.push((r) => String(r[c]) <= v), b),
      gt: (c: string, v: string) => (filters.push((r) => String(r[c]) > v), b),
      gte: (c: string, v: string) => (filters.push((r) => String(r[c]) >= v), b),
      not: () => b,
      order: (col: string, opts?: { ascending?: boolean }) => ((orderBy = { col, asc: opts?.ascending !== false }), b),
      limit: (n: number) => ((limitN = n), b),
      single: async () => {
        const { data, error } = run();
        if (error) return { data: null, error };
        if (!data || data.length !== 1) return { data: null, error: { message: "not one row", code: "PGRST116" } };
        return { data: data[0], error: null };
      },
      maybeSingle: async () => {
        const { data, error } = run();
        if (error) return { data: null, error };
        return { data: data && data.length > 0 ? data[0] : null, error: null };
      },
      then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
        Promise.resolve()
          .then(() => run())
          .then(resolve, reject),
    };
    return b;
  }

  const client = () => ({
    from: (name: string) => builder(name),
    storage: {
      from: () => ({
        createSignedUrl: async (path: string) => ({ data: { signedUrl: `https://storage.test/signed/${path}` }, error: null }),
      }),
    },
  });

  return { tables, writes, client };
}
