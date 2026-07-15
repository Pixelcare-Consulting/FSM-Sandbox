/**
 * AIFM schedule time + customer display helpers
 * Run: node tests/test-aifm-schedule-times.js
 */

import {
  parseAifmDateTime,
  parseAifmEstimatedDurationMinutes,
  computeAifmWorkEndIso,
  aifmDurationDecimalHours,
  sortAifmJobsForJobNumberAssignment,
} from '../lib/utils/aifmJobScheduleTimes.js';
import { jobDisplayCustomerName, parseEmbeddedCustomerName } from '../lib/utils/embeddedCustomerName.js';

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (e) {
    console.log(`  ✗ ${name}: ${e.message}`);
    failed++;
  }
}

function assertEquals(a, b, msg) {
  if (a !== b) throw new Error(msg || `Expected ${b}, got ${a}`);
}

test('parseAifmEstimatedDurationMinutes — 2h', () => {
  assertEquals(
    parseAifmEstimatedDurationMinutes({ estimated_duration_hrs: 2, estimated_duration_minutes: 0 }),
    120
  );
});

test('computeAifmWorkEndIso — appointment end wins over duration (AIFM 235912-style)', () => {
  const job = {
    job_start_date: '2026-05-18',
    job_start_time: '15:00',
    job_end_date: '2026-05-18',
    job_end_time: '17:00',
    estimated_duration_hrs: 1,
    estimated_duration_minutes: 0,
  };
  const start = new Date(parseAifmDateTime(job.job_start_date, job.job_start_time));
  const end = new Date(computeAifmWorkEndIso(job));
  const diffHrs = (end - start) / (60 * 60 * 1000);
  if (Math.abs(diffHrs - 2) > 0.01) {
    throw new Error(`Expected 2h appointment window (3pm–5pm), got ${diffHrs}h`);
  }
});

test('computeAifmWorkEndIso — no end time uses duration', () => {
  const job = {
    job_start_date: '2026-05-18',
    job_start_time: '15:00',
    job_end_date: null,
    job_end_time: null,
    estimated_duration_hrs: 2,
    estimated_duration_minutes: 0,
  };
  const start = new Date(parseAifmDateTime(job.job_start_date, job.job_start_time));
  const end = new Date(computeAifmWorkEndIso(job));
  const diffHrs = (end - start) / (60 * 60 * 1000);
  if (Math.abs(diffHrs - 2) > 0.01) {
    throw new Error(`Expected 2h from duration fallback, got ${diffHrs}h`);
  }
});

test('computeAifmWorkEndIso — zero duration uses AIFM end', () => {
  const job = {
    job_start_date: '2026-05-18',
    job_start_time: '15:00',
    job_end_date: '2026-05-18',
    job_end_time: '17:00',
    estimated_duration_hrs: 0,
    estimated_duration_minutes: 0,
  };
  const end = new Date(computeAifmWorkEndIso(job));
  const start = new Date(parseAifmDateTime(job.job_start_date, job.job_start_time));
  const diffHrs = (end - start) / (60 * 60 * 1000);
  if (Math.abs(diffHrs - 2) > 0.01) {
    throw new Error(`Expected 2h from end fields, got ${diffHrs}h`);
  }
});

test('aifmDurationDecimalHours', () => {
  assertEquals(
    aifmDurationDecimalHours({ estimated_duration_hrs: 2, estimated_duration_minutes: 30 }),
    '2.50'
  );
});

test('jobDisplayCustomerName — prefers embedded over linked', () => {
  const job = {
    customer: { customer_name: 'TAN' },
    description: '[AIFM:235912]\n[CUSTOMER:TAN SOCK TING]\nWork',
  };
  assertEquals(jobDisplayCustomerName(job), 'TAN SOCK TING');
});

test('jobDisplayCustomerName — linked when no tag', () => {
  assertEquals(
    jobDisplayCustomerName({ customer: { customer_name: 'ACME PTE LTD' }, description: '[AIFM:1]' }),
    'ACME PTE LTD'
  );
});

test('jobDisplayCustomerName — polluted tag with card-code prefix uses linked name', () => {
  const job = {
    customer_id: 42,
    customer: { customer_code: 'L004466', customer_name: 'HOR GUOYONG' },
    description: '[AIFM:235912]\n[CUSTOMER:L004466 HOR GUOYONG]\nWork',
  };
  assertEquals(jobDisplayCustomerName(job), 'HOR GUOYONG');
});

test('jobDisplayCustomerName — decodes HTML ampersand entities', () => {
  assertEquals(
    jobDisplayCustomerName({
      description: '[CUSTOMER:PANASONIC R &amp; D CENTER SINGAPORE]',
    }),
    'PANASONIC R & D CENTER SINGAPORE'
  );
  assertEquals(
    jobDisplayCustomerName({
      customer: { customer_name: 'POLLEN &AMP; BLEU' },
      description: '[AIFM:1]',
    }),
    'POLLEN & BLEU'
  );
});

test('sortAifmJobsForJobNumberAssignment — by scheduled_start not AIFM id', () => {
  const jobs = [
    { id: 235578, job_start_date: '2026-06-13', job_start_time: '02:30' },
    { id: 235559, job_start_date: '2026-07-05', job_start_time: '00:00' },
    { id: 235546, job_start_date: '2026-06-07', job_start_time: '00:00' },
  ];
  const sorted = sortAifmJobsForJobNumberAssignment(jobs);
  assertEquals(sorted.map((j) => j.id).join(','), '235546,235578,235559');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
