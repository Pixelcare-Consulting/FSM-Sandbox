import { toSingaporeYmd } from '../utils/singaporeDateTime.js';

/**
 * Normalize a lead service date to YYYY-MM-DD (Singapore calendar day when applicable).
 * Shared by createJobsFromLead and getLeadJobsByServiceDate.
 */
export function normalizeServiceDateYmd(dateValue) {
  if (!dateValue) return null;
  if (typeof dateValue === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateValue)) {
    return dateValue;
  }
  const mdyMatch = typeof dateValue === 'string' && dateValue.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (mdyMatch) {
    const [, month, day, year] = mdyMatch;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }
  const ymd = toSingaporeYmd(dateValue);
  return ymd || null;
}
