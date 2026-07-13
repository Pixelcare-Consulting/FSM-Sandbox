export type ReleaseEntry = {
  version: string;
  date: string;
  title: string;
  notes: string[];
};

/**
 * Portal release log (newest first). Bump package.json version when adding an entry.
 */
export const releases: ReleaseEntry[] = [
  {
    version: '3.15.2',
    date: '2026-07-13',
    title: 'Store PayNow QR amount as SGD dollars',
    notes: [
      'jobs.payment_qr_amount is now NUMERIC(12,2) dollars (e.g. 1.20) instead of INTEGER cents.',
      'Autosave / Generate QR write dollars; form load formats dollars with two decimal places.',
      'Convert dollars → cents only at mark-paid and DBS inward-credit matching into job_payments.amount_cents.',
    ],
  },
  {
    version: '3.15.1',
    date: '2026-07-13',
    title: 'Fix In Progress → Quotation in Progress remap',
    notes: [
      'Legacy portal status IN_PROGRESS / "In Progress" now resolves only to the exact SAP label "In Progress".',
      'No longer fuzzy-matches any SAP label containing PROGRESS (e.g. "Quotation in Progress") during sync-to-SAP.',
      'Token fallback requires exact token-set equality so subset labels cannot win.',
    ],
  },
  {
    version: '3.15.0',
    date: '2026-07-01',
    title: 'Baseline',
    notes: ['Prior release baseline before In Progress remap fix.'],
  },
];

export default releases;
