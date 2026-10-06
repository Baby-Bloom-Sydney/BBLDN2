/**
 * Lead → account conversion writes the London funnel answers unchanged (unit 3e, BB-LDN-3e-061026).
 * Pins QUESTIONS.md E-1 / D-5 (the right-to-work key and boolean are stored as answered), E-2 (the ladder label is the
 * stored `qualification_type`) and BUILD-PLAN P-2 (one `certification_type` row per CERTIFICATE_OPTIONS label).
 * The database CHECKs (3a, amendment 07/08) are the guard behind these writes; the walk reads the rows back on bb-ldn.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CERTIFICATE_OPTIONS } from '@/lib/nanny-options';

type Row = Record<string, unknown>;
const h = vi.hoisted(() => ({
  inserts: [] as Array<{ table: string; row: Row }>,
  lead: {} as Row,
}));

function query(table: string) {
  const result = (data: unknown) => Promise.resolve({ data, error: null });
  const builder: Record<string, unknown> = {
    select: () => builder,
    eq: () => builder,
    update: () => builder,
    upsert: () => result(null),
    single: () => result(table === 'nanny_leads' ? h.lead : { id: 'nanny-1' }),
    insert: (row: Row) => {
      h.inserts.push({ table, row });
      return Object.assign(result(null), { select: () => ({ single: () => result({ id: 'nanny-1' }) }) });
    },
    then: (resolve: (v: unknown) => unknown) => resolve({ data: null, error: null }),
  };
  return builder;
}

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => query(table),
    auth: { admin: { createUser: async () => ({ data: { user: { id: 'user-1' } }, error: null }) } },
  }),
}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: () => ({ auth: { signInWithPassword: async () => ({ error: null }) } }),
}));
vi.mock('@/lib/email/resend', () => ({ sendEmail: vi.fn(async () => ({ success: true })) }));

import { convertLeadToAccount } from './nanny-leads';

const L3 = 'Level 3 early years educator (incl. NNEB / CACHE diploma)';

function leadWith(residency: Row, qualifications: Row): Row {
  return {
    id: 'lead-1',
    first_name: 'test',
    last_name: 'nanny',
    email: 'admin+3e@babybloomsydney.com.au',
    phone: null,
    residency: { nationality: 'Polish', sydney_resident: true, suburb: 'Camden', postcode: 'NW1', ...residency },
    qualifications,
  };
}
const insertsInto = (table: string) => h.inserts.filter((i) => i.table === table).map((i) => i.row);

beforeEach(() => {
  h.inserts.length = 0;
});

describe('convertLeadToAccount — London funnel answers', () => {
  it('writes residency_status=settled, right_to_work=true when the lead has settled', async () => {
    h.lead = leadWith({ residency_status: 'settled', right_to_work: true }, {});
    const res = await convertLeadToAccount('lead-1', 'pw-123456');
    expect(res.success).toBe(true);
    const [nanny] = insertsInto('nannies');
    expect(nanny.residency_status).toBe('settled');
    expect(nanny.right_to_work).toBe(true);
  });

  it('writes no_rtw with right_to_work=false — a "no" never blocks conversion (E-1)', async () => {
    h.lead = leadWith({ residency_status: 'no_rtw', right_to_work: false }, {});
    const res = await convertLeadToAccount('lead-1', 'pw-123456');
    expect(res.success).toBe(true);
    const [nanny] = insertsInto('nannies');
    expect(nanny.residency_status).toBe('no_rtw');
    expect(nanny.right_to_work).toBe(false);
  });

  it('writes the ladder label as qualification_type when the lead has a qualification', async () => {
    h.lead = leadWith(
      { residency_status: 'citizen', right_to_work: true },
      { has_qualifications: true, highest_qualification: L3, has_certificates: false, certificates: [] },
    );
    await convertLeadToAccount('lead-1', 'pw-123456');
    const quals = insertsInto('nanny_credentials').filter((r) => r.credential_category === 'qualification');
    expect(quals).toEqual([{ nanny_id: 'nanny-1', credential_category: 'qualification', qualification_type: L3 }]);
  });

  it('writes one certification_type row per CERTIFICATE_OPTIONS label', async () => {
    h.lead = leadWith(
      { residency_status: 'citizen', right_to_work: true },
      { has_qualifications: false, highest_qualification: null, has_certificates: true, certificates: [...CERTIFICATE_OPTIONS] },
    );
    await convertLeadToAccount('lead-1', 'pw-123456');
    const certs = insertsInto('nanny_credentials')
      .filter((r) => r.credential_category === 'certification')
      .map((r) => r.certification_type);
    expect(certs).toEqual([...CERTIFICATE_OPTIONS]);
  });
});
