import assert from 'node:assert/strict';

import { resolveCustomerJobIdsForSearch } from '../lib/jobs/customerJobHistorySearch.js';
import {
  parseSearchDateToken,
  partitionSearchTokens,
} from '../lib/jobs/searchDateTokens.js';
import { getSingaporeUtcDayRange } from '../lib/utils/singaporeDateTime.js';

function makeQueryChain(resultPromise, { onOr, onGte, onLte, onEq, onIn } = {}) {
  const chain = {
    select() {
      return chain;
    },
    is() {
      return chain;
    },
    eq(column, value) {
      onEq?.(column, value);
      return chain;
    },
    in(column, values) {
      onIn?.(column, values);
      return chain;
    },
    gte(column, value) {
      onGte?.(column, value);
      return chain;
    },
    lte(column, value) {
      onLte?.(column, value);
      return chain;
    },
    or(arg) {
      onOr?.(arg);
      return chain;
    },
    limit() {
      return resultPromise;
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

function createMockSupabase(handlers = {}) {
  const defaults = {
    jobs: () => ({ data: [], error: null }),
    locations: () => ({ data: [], error: null }),
    job_schedule: () => ({ data: [], error: null }),
    technicians: () => ({ data: [], error: null }),
    technician_jobs: () => ({ data: [], error: null }),
  };

  return {
    from(table) {
      const handler = handlers[table] || defaults[table];
      if (!handler) {
        throw new Error(`Unexpected table: ${table}`);
      }
      return handler();
    },
  };
}

const CUSTOMER_ID = 'cust-abc';

// Date token parsing.
assert.equal(parseSearchDateToken('26/05/2026'), '2026-05-26', 'parses DD/MM/YYYY');
assert.equal(parseSearchDateToken('26-05-2026'), '2026-05-26', 'parses DD-MM-YYYY');
assert.equal(parseSearchDateToken('26.05.2026'), '2026-05-26', 'parses DD.MM.YYYY');
assert.equal(parseSearchDateToken('2026-05-26'), '2026-05-26', 'parses YYYY-MM-DD');
assert.equal(parseSearchDateToken('william'), null, 'non-date token returns null');

const partitioned = partitionSearchTokens(['26/05/2026', 'william']);
assert.deepEqual(partitioned.dateTokens, ['2026-05-26'], 'partitions date tokens');
assert.deepEqual(partitioned.textTokens, ['william'], 'partitions text tokens');

// Empty search returns null.
const emptyResult = await resolveCustomerJobIdsForSearch(createMockSupabase(), CUSTOMER_ID, '   ');
assert.equal(emptyResult, null, 'empty search returns null');

// Date-only search uses Singapore day range on scheduled_start.
const { start, end } = getSingaporeUtcDayRange('2026-05-26');
let dateGteValue;
let dateLteValue;
const dateSupabase = createMockSupabase({
  jobs: () =>
    makeQueryChain(Promise.resolve({ data: [{ id: 'job-date-1' }], error: null }), {
      onEq: (column, value) => {
        assert.equal(column, 'customer_id');
        assert.equal(value, CUSTOMER_ID);
      },
      onGte: (column, value) => {
        assert.equal(column, 'scheduled_start');
        dateGteValue = value;
      },
      onLte: (column, value) => {
        assert.equal(column, 'scheduled_start');
        dateLteValue = value;
      },
    }),
  locations: () => makeQueryChain(Promise.resolve({ data: [], error: null })),
  job_schedule: () => makeQueryChain(Promise.resolve({ data: [], error: null })),
  technicians: () => makeQueryChain(Promise.resolve({ data: [], error: null })),
  technician_jobs: () => makeQueryChain(Promise.resolve({ data: [], error: null })),
});

const dateIds = await resolveCustomerJobIdsForSearch(dateSupabase, CUSTOMER_ID, '26/05/2026');
assert.deepEqual(dateIds, ['job-date-1'], 'date-only search returns matching job id');
assert.equal(dateGteValue, start.toISOString(), 'uses Singapore day start');
assert.equal(dateLteValue, end.toISOString(), 'uses Singapore day end');

// Technician name search resolves via technicians -> technician_jobs -> customer jobs.
const technicianSupabase = createMockSupabase({
  jobs: () => {
    let customerScoped = false;
    const chain = {
      select() {
        return chain;
      },
      is() {
        return chain;
      },
      eq(column, value) {
        if (column === 'customer_id' && value === CUSTOMER_ID) {
          customerScoped = true;
        }
        return chain;
      },
      in() {
        return chain;
      },
      or() {
        return chain;
      },
      gte() {
        return chain;
      },
      lte() {
        return chain;
      },
      limit() {
        return Promise.resolve({
          data: customerScoped ? [{ id: 'job-tech-1' }] : [],
          error: null,
        });
      },
      then(onFulfilled, onRejected) {
        return this.limit().then(onFulfilled, onRejected);
      },
      catch(onRejected) {
        return this.limit().catch(onRejected);
      },
    };
    return chain;
  },
  locations: () => makeQueryChain(Promise.resolve({ data: [], error: null })),
  job_schedule: () => makeQueryChain(Promise.resolve({ data: [], error: null })),
  technicians: () =>
    makeQueryChain(Promise.resolve({ data: [{ id: 'tech-1' }], error: null }), {
      onOr: (arg) => {
        assert.match(arg, /full_name\.ilike\.%william%/);
        assert.match(arg, /sap_tech_code\.ilike\.%william%/);
      },
    }),
  technician_jobs: () =>
    makeQueryChain(Promise.resolve({ data: [{ job_id: 'job-tech-1' }], error: null })),
});

const techIds = await resolveCustomerJobIdsForSearch(technicianSupabase, CUSTOMER_ID, 'William');
assert.deepEqual(techIds, ['job-tech-1'], 'technician search resolves to customer job id');

// Mixed date + text intersects results.
const mixedSupabase = createMockSupabase({
  jobs: () => {
    let mode = 'unknown';
    const chain = {
      select() {
        return chain;
      },
      is() {
        return chain;
      },
      eq(column, value) {
        if (column === 'customer_id' && value === CUSTOMER_ID) {
          mode = 'customer';
        }
        return chain;
      },
      in(column, values) {
        if (column === 'id' && values.includes('job-tech-1')) {
          mode = 'text';
        }
        return chain;
      },
      or() {
        return chain;
      },
      gte() {
        mode = 'date';
        return chain;
      },
      lte() {
        return chain;
      },
      limit() {
        if (mode === 'date') {
          return Promise.resolve({
            data: [{ id: 'job-tech-1' }, { id: 'job-other' }],
            error: null,
          });
        }
        if (mode === 'text') {
          return Promise.resolve({ data: [{ id: 'job-tech-1' }], error: null });
        }
        if (mode === 'customer') {
          return Promise.resolve({ data: [], error: null });
        }
        return Promise.resolve({ data: [], error: null });
      },
      then(onFulfilled, onRejected) {
        return this.limit().then(onFulfilled, onRejected);
      },
      catch(onRejected) {
        return this.limit().catch(onRejected);
      },
    };
    return chain;
  },
  locations: () => makeQueryChain(Promise.resolve({ data: [], error: null })),
  job_schedule: () => makeQueryChain(Promise.resolve({ data: [], error: null })),
  technicians: () =>
    makeQueryChain(Promise.resolve({ data: [{ id: 'tech-1' }], error: null })),
  technician_jobs: () =>
    makeQueryChain(Promise.resolve({ data: [{ job_id: 'job-tech-1' }], error: null })),
});

const mixedIds = await resolveCustomerJobIdsForSearch(
  mixedSupabase,
  CUSTOMER_ID,
  '26/05/2026 William'
);
assert.deepEqual(mixedIds, ['job-tech-1'], 'mixed date + text intersects to shared job id');

// No-match search returns [].
const noMatchSupabase = createMockSupabase({
  jobs: () => makeQueryChain(Promise.resolve({ data: [], error: null })),
  locations: () => makeQueryChain(Promise.resolve({ data: [], error: null })),
  job_schedule: () => makeQueryChain(Promise.resolve({ data: [], error: null })),
  technicians: () => makeQueryChain(Promise.resolve({ data: [], error: null })),
  technician_jobs: () => makeQueryChain(Promise.resolve({ data: [], error: null })),
});

const noMatch = await resolveCustomerJobIdsForSearch(noMatchSupabase, CUSTOMER_ID, 'nomatch');
assert.deepEqual(noMatch, [], 'no-match search returns []');

console.log('customerJobHistorySearch tests passed');
