-- Align supabase_realtime with portal Realtime consumers.
-- Drop unused tables; add followups for the follow-ups page (keep publication).
ALTER PUBLICATION supabase_realtime DROP TABLE public.locations;
ALTER PUBLICATION supabase_realtime DROP TABLE public.customer_address_details;
ALTER PUBLICATION supabase_realtime ADD TABLE public.followups;
