import assert from 'node:assert/strict';

import {
  parsePaymentQrDollarInput,
  paymentQrDollarsToCents,
  formatPaymentQrCentsForInput,
  paymentQrCentsToPaynowAmount,
} from '../lib/jobs/paymentQrDefaults.js';

assert.equal(paymentQrDollarsToCents(parsePaymentQrDollarInput('196.20')), 19620);
assert.equal(paymentQrDollarsToCents(parsePaymentQrDollarInput('196.2')), 19620);
assert.equal(formatPaymentQrCentsForInput(19620), '196.20');
assert.equal(paymentQrCentsToPaynowAmount(19620), 196.2);

assert.equal(parsePaymentQrDollarInput(''), null);
assert.equal(parsePaymentQrDollarInput(null), null);
assert.equal(parsePaymentQrDollarInput(undefined), null);
assert.equal(parsePaymentQrDollarInput('abc'), null);
assert.equal(parsePaymentQrDollarInput('  '), null);

console.log('paymentQrAmount.test.mjs: all tests passed');
