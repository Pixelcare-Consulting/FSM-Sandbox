import assert from 'node:assert/strict';

import {
  buildSapStatusIndex,
  resolveLegacyJobStatusToSap,
  resolveLegacyStatusToSapId,
} from '../lib/jobs/resolveLegacyJobStatusToSap.js';
import { resolvePortalJobStatusToSap } from '../lib/utils/sapJobStatusResolver.js';

const sapJobStatuses = [
  { U_JobStatusID: '554', U_JobStatus: 'Unconfirmed' },
  { U_JobStatusID: '555', U_JobStatus: 'Confirmed' },
  { U_JobStatusID: '-5', U_JobStatus: 'Cancelled' },
  { U_JobStatusID: '572', U_JobStatus: 'Completed' },
  { U_JobStatusID: '556', U_JobStatus: 'In Progress' },
];

// Numeric pass-through
const passThrough = resolvePortalJobStatusToSap('554', sapJobStatuses);
assert.equal(passThrough.jobStatusId, '554');
assert.equal(passThrough.jobStatusLabel, 'Unconfirmed');

// CREATED → Unconfirmed (554)
const created = resolvePortalJobStatusToSap('CREATED', sapJobStatuses);
assert.equal(created.jobStatusId, '554');
assert.equal(created.jobStatusLabel, 'Unconfirmed');

// CONFIRMED → 555
const confirmed = resolvePortalJobStatusToSap('CONFIRMED', sapJobStatuses);
assert.equal(confirmed.jobStatusId, '555');
assert.equal(confirmed.jobStatusLabel, 'Confirmed');

// COMPLETED → completed SAP ID
const completed = resolvePortalJobStatusToSap('COMPLETED', sapJobStatuses);
assert.equal(completed.jobStatusId, '572');
assert.equal(completed.jobStatusLabel, 'Completed');

// IN_PROGRESS with only "In Progress" in SAP → resolves correctly
const inProgressOnly = resolvePortalJobStatusToSap('IN_PROGRESS', sapJobStatuses);
assert.equal(inProgressOnly.jobStatusId, '556');
assert.equal(inProgressOnly.jobStatusLabel, 'In Progress');

// Unknown status throws
assert.throws(
  () => resolvePortalJobStatusToSap('TOTALLY_UNKNOWN_X', sapJobStatuses),
  /Cannot resolve jobs\.status 'TOTALLY_UNKNOWN_X'/
);

// Unknown numeric ID throws
assert.throws(
  () => resolvePortalJobStatusToSap('99999', sapJobStatuses),
  /Unknown SAP jobStatusId '99999'/
);

// --- Regression: Quotation in Progress must never win for portal IN_PROGRESS ---

const sapWithQuotationOnly = [
  { U_JobStatusID: '554', U_JobStatus: 'Unconfirmed' },
  { U_JobStatusID: '600', U_JobStatus: 'Quotation in Progress' },
];

const quotationOnlyLegacy = resolveLegacyJobStatusToSap('IN_PROGRESS', sapWithQuotationOnly);
assert.equal(quotationOnlyLegacy, null, 'IN_PROGRESS must not resolve to Quotation in Progress');

const quotationOnlyDetail = resolveLegacyStatusToSapId(
  'IN_PROGRESS',
  buildSapStatusIndex(sapWithQuotationOnly)
);
assert.equal(quotationOnlyDetail.kind, 'unknown');

assert.throws(
  () => resolvePortalJobStatusToSap('IN_PROGRESS', sapWithQuotationOnly),
  /Cannot resolve jobs\.status 'IN_PROGRESS'/
);

const sapWithBothProgress = [
  { U_JobStatusID: '554', U_JobStatus: 'Unconfirmed' },
  { U_JobStatusID: '556', U_JobStatus: 'In Progress' },
  { U_JobStatusID: '600', U_JobStatus: 'Quotation in Progress' },
];

const bothProgress = resolvePortalJobStatusToSap('IN_PROGRESS', sapWithBothProgress);
assert.equal(bothProgress.jobStatusId, '556');
assert.equal(bothProgress.jobStatusLabel, 'In Progress');

const bothProgressLegacy = resolveLegacyJobStatusToSap('IN_PROGRESS', sapWithBothProgress);
assert.equal(bothProgressLegacy.jobStatusId, '556');
assert.equal(bothProgressLegacy.jobStatusLabel, 'In Progress');

const sapInProgressOnly = [
  { U_JobStatusID: '556', U_JobStatus: 'In Progress' },
];
const inProgressLegacyOnly = resolveLegacyJobStatusToSap('IN_PROGRESS', sapInProgressOnly);
assert.equal(inProgressLegacyOnly.jobStatusId, '556');
assert.equal(inProgressLegacyOnly.jobStatusLabel, 'In Progress');

console.log('sapJobStatusResolver.test.mjs: ok');
