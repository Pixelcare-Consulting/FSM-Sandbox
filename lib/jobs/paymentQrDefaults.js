/** Parse user dollar input (e.g. "196.20") → number | null. Never use parseInt for money. */
export function parsePaymentQrDollarInput(input) {
  if (input === '' || input == null) return null;
  const parsed = parseFloat(String(input).trim());
  if (!Number.isFinite(parsed)) return null;
  return parsed;
}

/** Convert dollars to integer cents for payment boundaries (mark-paid / DBS). */
export function paymentQrDollarsToCents(dollars) {
  return Math.round(dollars * 100);
}

/** Format stored SGD dollars for form display (e.g. 196.2 → "196.20"). */
export function formatPaymentQrDollarsForInput(dollars) {
  if (dollars == null || dollars === '') return '';
  const num = Number(dollars);
  if (!Number.isFinite(num)) return '';
  return num.toFixed(2);
}

/** Returns YYYYMMDD for PayNow QR default expiry: today + 15 calendar days (local date). */
export function getDefaultPaymentQrExpiryYmd(date = new Date()) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 15);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}
