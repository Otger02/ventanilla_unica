alter table public.invoices
  add column if not exists payment_status text not null default 'unpaid';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'invoices_payment_status_check'
      and conrelid = 'public.invoices'::regclass
  ) then
    alter table public.invoices
      add constraint invoices_payment_status_check
      check (payment_status in ('unpaid', 'scheduled', 'paid'));
  end if;
end
$$;

create index if not exists idx_invoices_user_payment_status_due_date
  on public.invoices(user_id, payment_status, due_date);
