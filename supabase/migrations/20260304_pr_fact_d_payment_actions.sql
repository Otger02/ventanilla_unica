alter table public.invoices
  add column if not exists scheduled_payment_date date,
  add column if not exists paid_at timestamptz,
  add column if not exists payment_method text,
  add column if not exists payment_notes text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'invoices_payment_method_check'
      and conrelid = 'public.invoices'::regclass
  ) then
    alter table public.invoices
      add constraint invoices_payment_method_check
      check (payment_method in ('transfer', 'pse', 'cash', 'other') or payment_method is null);
  end if;
end
$$;

create index if not exists idx_invoices_user_payment_status_scheduled_payment_date
  on public.invoices(user_id, payment_status, scheduled_payment_date);

create index if not exists idx_invoices_user_paid_at
  on public.invoices(user_id, paid_at);
