/**
 * Parse user-facing date tokens from search input and partition mixed search tokens.
 */

/**
 * Detect DD/MM/YYYY, DD-MM-YYYY, DD.MM.YYYY, or YYYY-MM-DD and return YYYY-MM-DD.
 * @param {string} token
 * @returns {string | null}
 */
export function parseSearchDateToken(token) {
  if (!token || typeof token !== 'string') return null;

  const trimmed = token.trim();
  if (!trimmed) return null;

  const isoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    return toValidYmd(isoMatch[1], isoMatch[2], isoMatch[3]);
  }

  const dmyMatch = trimmed.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (dmyMatch) {
    const day = dmyMatch[1].padStart(2, '0');
    const month = dmyMatch[2].padStart(2, '0');
    const year = dmyMatch[3];
    return toValidYmd(year, month, day);
  }

  return null;
}

function toValidYmd(year, month, day) {
  const y = parseInt(year, 10);
  const m = parseInt(month, 10);
  const d = parseInt(day, 10);
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/**
 * Split search tokens into parsed calendar dates (YYYY-MM-DD) and remaining text tokens.
 * @param {string[]} tokens
 * @returns {{ dateTokens: string[], textTokens: string[] }}
 */
export function partitionSearchTokens(tokens) {
  const dateTokens = [];
  const textTokens = [];

  for (const token of tokens || []) {
    const parsed = parseSearchDateToken(token);
    if (parsed) {
      dateTokens.push(parsed);
    } else {
      textTokens.push(token);
    }
  }

  return { dateTokens, textTokens };
}
