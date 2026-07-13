import assert from 'node:assert/strict';

import { getLeadJobsByServiceDate } from '../lib/leads/getLeadJobsByServiceDate.js';
import { normalizeServiceDateYmd } from '../lib/leads/normalizeServiceDateYmd.js';
import { buildSingaporeDateTimeUtc } from '../lib/utils/singaporeDateTime.js';

function makeQueryChain(resultPromise) {
  const chain = {
    select() {
      return chain;
    },
    eq() {
      return chain;
    },
    is() {
      return chain;
    },
    then(onFulfilled, onRejected) {
      return resultPromise.then(onFulfilled, onRejected);
    },
    catch(onRejected) {
      return resultPromise.catch(onRejected);
    },
  };
  return chain;
}

function createMockSupabase(jobs) {
  return {
    from(table) {
      if (table === 'jobs') {
        return makeQueryChain(Promise.resolve({ data: jobs, error: null }));
      }
      return {
        select() {
          return this;
        },
        eq() {
          return this;
        },
        is() {
          return this;
        },
        maybeSingle() {
          return Promise.resolve({ data: { id: 'loc-1' }, error: null });
        },
      };
    },
  };
}

function createMockSupabaseWithLocationFallback(locationJobs, customerJobs) {
  let jobsQueryCount = 0;
  return {
    from(table) {
      if (table === 'jobs') {
        jobsQueryCount += 1;
        const data = jobsQueryCount === 1 ? locationJobs : customerJobs;
        return makeQueryChain(Promise.resolve({ data, error: null }));
      }
      return {
        select() {
          return this;
        },
        eq() {
          return this;
        },
        is() {
          return this;
        },
        maybeSingle() {
          return Promise.resolve({ data: { id: 'loc-1' }, error: null });
        },
      };
    },
  };
}

const lead = {
  customer_id: 'cust-1',
  first_service_date: '2026-07-02',
  second_service_date: null,
  third_service_date: null,
  fourth_service_date: null,
  block: '1',
  unit: '01',
  address: 'Test Street',
};

// Jul 2 2026 9:30am SGT
const morningJobStart = buildSingaporeDateTimeUtc('2026-07-02', 9, 30).toISOString();
// Jul 2 2026 1:00am SGT — UTC date would be previous calendar day
const earlyMorningJobStart = buildSingaporeDateTimeUtc('2026-07-02', 1, 0).toISOString();

const morningUtcDate = new Date(morningJobStart).toISOString().split('T')[0];
const earlyMorningUtcDate = new Date(earlyMorningJobStart).toISOString().split('T')[0];

assert.equal(morningUtcDate, '2026-07-02', 'morning job UTC date is still Jul 2');
assert.equal(earlyMorningUtcDate, '2026-07-01', 'early morning SGT job UTC date is Jul 1');

const morningResult = await getLeadJobsByServiceDate(lead, {
  supabase: createMockSupabase([
    { id: 'job-morning', job_number: '2026-000001', scheduled_start: morningJobStart },
  ]),
  customerId: 'cust-1',
  locationId: 'loc-1',
});

assert.deepEqual(morningResult.first, { id: 'job-morning', job_number: '2026-000001' });
assert.equal(morningResult.second, undefined);

const earlyMorningResult = await getLeadJobsByServiceDate(lead, {
  supabase: createMockSupabase([
    { id: 'job-early', job_number: '2026-000002', scheduled_start: earlyMorningJobStart },
  ]),
  customerId: 'cust-1',
  locationId: 'loc-1',
});

assert.deepEqual(
  earlyMorningResult.first,
  { id: 'job-early', job_number: '2026-000002' },
  '1:00am SGT on Jul 2 matches lead first_service_date via Singapore YMD'
);

// ISO lead date stored as midnight UTC should still normalize to YYYY-MM-DD
const isoLead = {
  ...lead,
  first_service_date: '2026-07-02T00:00:00.000Z',
};

const isoLeadResult = await getLeadJobsByServiceDate(isoLead, {
  supabase: createMockSupabase([
    { id: 'job-iso', job_number: '2026-000003', scheduled_start: morningJobStart },
  ]),
  customerId: 'cust-1',
  locationId: 'loc-1',
});

assert.deepEqual(isoLeadResult.first, { id: 'job-iso', job_number: '2026-000003' });

// Slash-formatted lead dates (M/D/YYYY) should match jobs
const slashLead = {
  ...lead,
  first_service_date: '7/2/2026',
};

assert.equal(normalizeServiceDateYmd('7/2/2026'), '2026-07-02');

const slashLeadResult = await getLeadJobsByServiceDate(slashLead, {
  supabase: createMockSupabase([
    { id: 'job-slash', job_number: '2026-000004', scheduled_start: morningJobStart },
  ]),
  customerId: 'cust-1',
  locationId: 'loc-1',
});

assert.deepEqual(slashLeadResult.first, { id: 'job-slash', job_number: '2026-000004' });

// Location-filter mismatch: retry without location_id when location-scoped query finds no date matches
const fallbackResult = await getLeadJobsByServiceDate(lead, {
  supabase: createMockSupabaseWithLocationFallback(
    [{ id: 'wrong-loc', job_number: '2026-000099', scheduled_start: '2026-08-01T01:00:00.000Z' }],
    [{ id: 'job-fallback', job_number: '2026-000005', scheduled_start: morningJobStart }]
  ),
  customerId: 'cust-1',
  locationId: 'loc-1',
});

assert.deepEqual(
  fallbackResult.first,
  { id: 'job-fallback', job_number: '2026-000005' },
  'falls back to customer-wide job lookup when location filter misses service dates'
);

console.log('getLeadJobsByServiceDate tests passed');
