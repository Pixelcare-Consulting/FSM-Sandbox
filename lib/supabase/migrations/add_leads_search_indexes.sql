-- pg_trgm indexes for leads + sap_lead address search (global-masterlist).
-- Apply via Supabase SQL editor or migration pipeline.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_leads_full_name_trgm
  ON public.leads USING gin (full_name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_leads_email_trgm
  ON public.leads USING gin (email gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_leads_handphone_trgm
  ON public.leads USING gin (handphone gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_leads_address_trgm
  ON public.leads USING gin (address gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_leads_block_trgm
  ON public.leads USING gin (block gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_leads_unit_trgm
  ON public.leads USING gin (unit gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_leads_building_trgm
  ON public.leads USING gin (building gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_leads_street_trgm
  ON public.leads USING gin (street gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_leads_postcode_trgm
  ON public.leads USING gin (postcode gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_sap_lead_code_trgm
  ON public.sap_lead USING gin (lead_code gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_sap_lead_name_trgm
  ON public.sap_lead USING gin (lead_name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_sap_lead_phone_trgm
  ON public.sap_lead USING gin (phone_number gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_sap_lead_email_trgm
  ON public.sap_lead USING gin (email gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_sap_lead_address_trgm
  ON public.sap_lead USING gin (lead_address gin_trgm_ops);
