-- IVA v1: conservative VAT classification per invoice
alter table public.invoices
  add column if not exists vat_status text not null default 'sin_iva'
    check (vat_status in ('iva_usable', 'iva_en_revision', 'iva_no_usable', 'sin_iva')),
  add column if not exists vat_reason text null,
  add column if not exists vat_amount_usable_cop bigint not null default 0,
  add column if not exists vat_amount_review_cop bigint not null default 0,
  add column if not exists vat_amount_blocked_cop bigint not null default 0;

-- Index for VAT summary queries
create index if not exists idx_invoices_user_vat_due
  on public.invoices(user_id, vat_status, due_date);
