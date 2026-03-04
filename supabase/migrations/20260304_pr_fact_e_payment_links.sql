alter table public.invoices
  add column if not exists payment_url text,
  add column if not exists supplier_portal_url text,
  add column if not exists last_payment_opened_at timestamptz;

create index if not exists idx_invoices_user_last_payment_opened_at
  on public.invoices(user_id, last_payment_opened_at desc);
