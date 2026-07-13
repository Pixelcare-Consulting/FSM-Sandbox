import assert from 'node:assert/strict';
import {
  isAllowedMemoImageSrc,
  sanitizeMemoBodyForDisplay,
} from '../lib/utils/memoHtml.js';

const TEST_SUPABASE_HOST = 'testproject.supabase.co';
const GOOD_IMG =
  `https://${TEST_SUPABASE_HOST}/storage/v1/object/public/company/memos/user-1/1.png`;
const BAD_IMG = 'https://evil.example.com/steal.png';
const DATA_IMG = 'data:image/png;base64,abc';

process.env.NEXT_PUBLIC_SUPABASE_URL = `https://${TEST_SUPABASE_HOST}`;

// List HTML survives sanitize
const listHtml =
  '<p>Intro</p><ol><li>First</li><li>Second</li></ol><ul><li>Bullet</li></ul>';
const listOut = sanitizeMemoBodyForDisplay(listHtml);
assert.match(listOut, /<ol>/);
assert.match(listOut, /<li>First<\/li>/);
assert.match(listOut, /<ul>/);

// Color styles preserved; dangerous attrs stripped
const colorHtml =
  '<p style="color: rgb(255, 0, 0); background-color: yellow; position: absolute" onclick="alert(1)">Red</p>';
const colorOut = sanitizeMemoBodyForDisplay(colorHtml);
assert.match(colorOut, /color:\s*rgb\(255,\s*0,\s*0\)/i);
assert.match(colorOut, /background-color:\s*yellow/i);
assert.doesNotMatch(colorOut, /position/i);
assert.doesNotMatch(colorOut, /onclick/i);

// External and data image URLs stripped; allowed Supabase URL kept
assert.equal(isAllowedMemoImageSrc(GOOD_IMG), true);
assert.equal(isAllowedMemoImageSrc(BAD_IMG), false);
assert.equal(isAllowedMemoImageSrc(DATA_IMG), false);

const imgHtml = `<p>Photo</p><img src="${GOOD_IMG}" alt="ok" /><img src="${BAD_IMG}" /><img src="${DATA_IMG}" />`;
const imgOut = sanitizeMemoBodyForDisplay(imgHtml);
assert.match(imgOut, new RegExp(GOOD_IMG.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
assert.doesNotMatch(imgOut, /evil\.example\.com/);
assert.doesNotMatch(imgOut, /data:image/);

// Image width preserved; invalid dimensions stripped
const sizedImgHtml = `<p>Photo</p><img src="${GOOD_IMG}" width="320" height="99999" alt="ok" />`;
const sizedImgOut = sanitizeMemoBodyForDisplay(sizedImgHtml);
assert.match(sizedImgOut, /width="320"/);
assert.doesNotMatch(sizedImgOut, /height="99999"/);

// javascript: links removed
const linkOut = sanitizeMemoBodyForDisplay(
  '<a href="javascript:alert(1)">bad</a><a href="https://example.com">ok</a>'
);
assert.doesNotMatch(linkOut, /javascript:/i);
assert.match(linkOut, /href="https:\/\/example\.com"/);

console.log('memoHtml.test.mjs: ok');
