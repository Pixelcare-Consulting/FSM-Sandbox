import DOMPurify from 'isomorphic-dompurify';

/** Tags produced by the memo Quill toolbar + safe structure */
const MEMO_SANITIZE = {
  ALLOWED_TAGS: [
    'p',
    'br',
    'strong',
    'b',
    'em',
    'i',
    'u',
    's',
    'strike',
    'h1',
    'h2',
    'h3',
    'ol',
    'ul',
    'li',
    'a',
    'span',
    'blockquote',
    'img',
    'div',
    'pre',
    'code',
  ],
  ALLOWED_ATTR: ['href', 'target', 'rel', 'class', 'src', 'alt', 'style', 'width', 'height'],
  ALLOW_DATA_ATTR: false,
};

const ALLOWED_INLINE_STYLE_PROPS = new Set([
  'color',
  'background-color',
  'width',
  'height',
]);

const IMG_DIMENSION_ATTR_RE = /^\d{1,4}$/;
const IMG_DIMENSION_STYLE_RE = /^\d{1,4}px$/;

/**
 * @param {string | null | undefined} value
 */
function sanitizeImgDimensionAttr(value) {
  if (!value || typeof value !== 'string') return '';
  const trimmed = value.trim();
  return IMG_DIMENSION_ATTR_RE.test(trimmed) ? trimmed : '';
}

/**
 * @param {string} prop
 * @param {string} value
 */
function sanitizeImgDimensionStyle(prop, value) {
  const trimmed = value.trim();
  if (prop !== 'width' && prop !== 'height') return '';
  return IMG_DIMENSION_STYLE_RE.test(trimmed) ? trimmed : '';
}

/**
 * @returns {string}
 */
function supabaseProjectHost() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  if (!url) return '';
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
}

/**
 * @param {string | null | undefined} src
 */
export function isAllowedMemoImageSrc(src) {
  if (!src || typeof src !== 'string') return false;
  const trimmed = src.trim();
  if (!trimmed || trimmed.startsWith('data:') || /^javascript:/i.test(trimmed)) {
    return false;
  }

  try {
    const parsed = new URL(trimmed, 'https://placeholder.local');
    const host = supabaseProjectHost();
    const hostOk = host
      ? parsed.host === host
      : parsed.hostname.endsWith('.supabase.co');
    return (
      hostOk &&
      parsed.pathname.includes('/storage/v1/object/public/') &&
      parsed.pathname.includes('/company/')
    );
  } catch {
    return false;
  }
}

/**
 * @param {string | null | undefined} style
 */
function sanitizeMemoInlineStyle(style) {
  if (!style || typeof style !== 'string') return '';
  const kept = [];
  for (const chunk of style.split(';')) {
    const colon = chunk.indexOf(':');
    if (colon === -1) continue;
    const prop = chunk.slice(0, colon).trim().toLowerCase();
    const value = chunk.slice(colon + 1).trim();
    if (!prop || !value) continue;
    if (ALLOWED_INLINE_STYLE_PROPS.has(prop)) {
      const safeValue =
        prop === 'width' || prop === 'height'
          ? sanitizeImgDimensionStyle(prop, value)
          : value;
      if (safeValue) kept.push(`${prop}: ${safeValue}`);
    }
  }
  return kept.join('; ');
}

/**
 * @param {string} tag
 */
function sanitizeImgTagAttributes(tag) {
  const srcMatch = tag.match(/\ssrc=["']([^"']+)["']/i);
  if (!srcMatch || !isAllowedMemoImageSrc(srcMatch[1])) return '';

  let out = tag;
  for (const attr of ['width', 'height']) {
    const re = new RegExp(`\\s${attr}=["']([^"']*)["']`, 'i');
    const match = out.match(re);
    if (!match) continue;
    const safe = sanitizeImgDimensionAttr(match[1]);
    out = safe
      ? out.replace(re, ` ${attr}="${safe}"`)
      : out.replace(re, '');
  }
  return out;
}

/**
 * @param {string} html
 */
function postProcessMemoHtml(html) {
  if (!html) return '';

  if (typeof document === 'undefined') {
    return html
      .replace(/<img\b[^>]*>/gi, (tag) => sanitizeImgTagAttributes(tag))
      .replace(/\sstyle=["']([^"']*)["']/gi, (match, styleValue) => {
        const clean = sanitizeMemoInlineStyle(styleValue);
        return clean ? ` style="${clean}"` : '';
      });
  }

  const root = document.createElement('div');
  root.innerHTML = html;

  root.querySelectorAll('img').forEach((img) => {
    if (!isAllowedMemoImageSrc(img.getAttribute('src'))) {
      img.remove();
      return;
    }
    const width = sanitizeImgDimensionAttr(img.getAttribute('width'));
    const height = sanitizeImgDimensionAttr(img.getAttribute('height'));
    if (width) img.setAttribute('width', width);
    else img.removeAttribute('width');
    if (height) img.setAttribute('height', height);
    else img.removeAttribute('height');
  });

  root.querySelectorAll('[style]').forEach((el) => {
    const clean = sanitizeMemoInlineStyle(el.getAttribute('style'));
    if (clean) el.setAttribute('style', clean);
    else el.removeAttribute('style');
  });

  return root.innerHTML;
}

/**
 * @param {string} str
 */
function decodeHtmlEntities(str) {
  if (!str) return '';
  if (typeof document !== 'undefined') {
    const ta = document.createElement('textarea');
    ta.innerHTML = str;
    return ta.value;
  }
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

/**
 * @param {string} t
 */
function looksLikeHtmlFragment(t) {
  return /<\s*(p|h[1-3]|ul|ol|li|strong|em|b|i|u|a|blockquote|img|div|pre|code)\b/i.test(
    t
  );
}

/**
 * Unwrap pasted raw HTML that Quill stored as a single paragraph of markup.
 * @param {string} raw
 */
function extractHtmlFragment(raw) {
  let t = raw.trim();
  if (!t) return '';

  if (/&lt;\/?[a-z]/i.test(t)) {
    t = decodeHtmlEntities(t);
  }

  const singleP = t.match(/^<p>([\s\S]*)<\/p>$/i);
  if (singleP) {
    const inner = singleP[1].replace(/<br\s*\/?>/gi, '');
    if (/<\s*(h[1-3]|ul|ol|li|blockquote|img|div)\b/i.test(inner)) {
      t = inner.trim();
    }
  }

  return t.trim();
}

/**
 * @param {string} t
 */
function plainTextToParagraphHtml(t) {
  const esc = t
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return `<p>${esc.replace(/\r\n|\r|\n/g, '<br />')}</p>`;
}

/**
 * HTML safe for rendering in the portal (sign-in modal, ticker detail, etc.).
 * @param {unknown} html
 * @returns {string}
 */
export function sanitizeMemoBodyForDisplay(html) {
  if (html == null || typeof html !== 'string') return '';
  const purified = DOMPurify.sanitize(html.trim(), MEMO_SANITIZE);
  return postProcessMemoHtml(purified);
}

/**
 * Normalized HTML for display surfaces (handles legacy plain / escaped HTML).
 * @param {unknown} raw
 * @returns {string}
 */
export function memoHtmlForDisplay(raw) {
  return sanitizeMemoBodyForDisplay(memoBodyForQuill(raw));
}

/**
 * Plain text for search, list previews, and title tooltips.
 * @param {unknown} html
 * @returns {string}
 */
export function memoBodyToPlainText(html) {
  if (html == null || typeof html !== 'string') return '';
  const normalized = memoBodyForQuill(html);
  const withoutTags = normalized.replace(/<[^>]+>/g, ' ');
  return withoutTags.replace(/\s+/g, ' ').trim();
}

/**
 * Persisted value: null if empty after sanitize, otherwise trimmed safe HTML.
 * @param {unknown} html
 * @returns {string | null}
 */
export function normalizeMemoBodyForSave(html) {
  if (html == null || typeof html !== 'string') return null;
  const prepared = memoBodyForQuill(html);
  const sanitized = sanitizeMemoBodyForDisplay(prepared);
  const plain = memoBodyToPlainText(sanitized);
  if (!plain) return null;
  return sanitized;
}

/**
 * Value for Quill: converts legacy plain text, escaped HTML, and pasted raw HTML.
 * @param {unknown} raw
 * @returns {string}
 */
export function memoBodyForQuill(raw) {
  if (raw == null || typeof raw !== 'string') return '';
  const fragment = extractHtmlFragment(raw);
  if (!fragment) return '';

  if (!looksLikeHtmlFragment(fragment)) {
    return plainTextToParagraphHtml(fragment);
  }

  return sanitizeMemoBodyForDisplay(fragment);
}
