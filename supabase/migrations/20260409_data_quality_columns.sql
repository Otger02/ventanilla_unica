alter table public.invoices
  add column if not exists data_quality_status text not null default 'ok';

alter table public.invoices
  add column if not exists data_quality_flags jsonb;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'invoices_data_quality_status_check'
      and conrelid = 'public.invoices'::regclass
  ) then
    alter table public.invoices
      add constraint invoices_data_quality_status_check
      check (data_quality_status in ('ok', 'suspect', 'incomplete'));
  end if;
end
$$;

create index if not exists idx_invoices_user_data_quality_status
  on public.invoices(user_id, data_quality_status);
