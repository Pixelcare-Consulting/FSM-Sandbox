import assert from 'node:assert/strict';

import {
  parsePaymentQrDollarInput,
  paymentQrDollarsToCents,
  formatPaymentQrDollarsForInput,
} from '../lib/jobs/paymentQrDefaults.js';

// Dollar storage: UI "196.20" → DB 196.2; cents only at payment boundaries
assert.equal(parsePaymentQrDollarInput('196.20'), 196.2);
assert.equal(parsePaymentQrDollarInput('196.2'), 196.2);
assert.equal(formatPaymentQrDollarsForInput(196.2), '196.20');
assert.equal(formatPaymentQrDollarsForInput(1.2), '1.20');
assert.equal(formatPaymentQrDollarsForInput(null), '');
assert.equal(formatPaymentQrDollarsForInput(''), '');

// Cents conversion only for mark-paid / DBS
assert.equal(paymentQrDollarsToCents(parsePaymentQrDollarInput('196.20')), 19620);
assert.equal(paymentQrDollarsToCents(1.2), 120);
assert.equal(paymentQrDollarsToCents(5003.1), 500310);

assert.equal(parsePaymentQrDollarInput(''), null);
assert.equal(parsePaymentQrDollarInput(null), null);
assert.equal(parsePaymentQrDollarInput(undefined), null);
assert.equal(parsePaymentQrDollarInput('abc'), null);
assert.equal(parsePaymentQrDollarInput('  '), null);

console.log('paymentQrAmount.test.mjs: all tests passed');
