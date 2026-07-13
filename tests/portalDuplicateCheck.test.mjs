import assert from 'node:assert/strict';
import {
  normalizeContactEmail,
  normalizeContactPhoneDigits,
  phonesMatchLast8,
} from '../lib/customers/portalDuplicateCheck.js';

assert.equal(normalizeContactEmail('  Test@Example.COM '), 'test@example.com');
assert.equal(normalizeContactPhoneDigits('+65 9123-4567'), '6591234567');
assert.equal(phonesMatchLast8('6591234567', '91234567'), true);
assert.equal(phonesMatchLast8('123', '456'), false);

console.log('portalDuplicateCheck.test.mjs: ok');
