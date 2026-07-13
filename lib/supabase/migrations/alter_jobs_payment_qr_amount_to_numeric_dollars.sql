-- Migration: Store payment_qr_amount as SGD dollars (NUMERIC) instead of integer cents
-- Date: 2026-07-13
-- Description: Convert jobs.payment_qr_amount from INTEGER cents → NUMERIC(12,2) dollars
--   Existing row 120 (cents) becomes 1.20 (dollars). Convert to cents only at mark-paid / DBS.

ALTER TABLE jobs
  ALTER COLUMN payment_qr_amount TYPE NUMERIC(12, 2)
  USING (payment_qr_amount::numeric / 100);

COMMENT ON COLUMN jobs.payment_qr_amount IS 'Payment amount in SGD dollars for Paynow QR code';
