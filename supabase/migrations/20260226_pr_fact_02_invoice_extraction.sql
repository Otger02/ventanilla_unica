alter table public.invoices
  add column if not exists extracted_at timestamptz,
  add column if not exists extraction_confidence jsonb,
  add column if not exists extraction_raw jsonb;
