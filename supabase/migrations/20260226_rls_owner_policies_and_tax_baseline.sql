create extension if not exists "pgcrypto";

create table if not exists public.user_tax_profile_co (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  persona_type text not null default 'unknown',
  activity_type text not null default 'unknown',
  regimen text not null default 'unknown',
  vat_responsible text not null default 'unknown',
  provision_style text not null default 'balanced',
  taxpayer_type text not null default 'unknown',
  legal_type text not null default 'unknown',
  vat_periodicity text not null default 'unknown',
  monthly_fixed_costs_cop numeric not null default 0,
  monthly_payroll_cop numeric not null default 0,
  monthly_debt_payments_cop numeric not null default 0,
  municipality text,
  start_date date
);

alter table public.user_tax_profile_co
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists persona_type text not null default 'unknown',
  add column if not exists activity_type text not null default 'unknown',
  add column if not exists regimen text not null default 'unknown',
  add column if not exists vat_responsible text not null default 'unknown',
  add column if not exists provision_style text not null default 'balanced',
  add column if not exists taxpayer_type text not null default 'unknown',
  add column if not exists legal_type text not null default 'unknown',
  add column if not exists vat_periodicity text not null default 'unknown',
  add column if not exists monthly_fixed_costs_cop numeric not null default 0,
  add column if not exists monthly_payroll_cop numeric not null default 0,
  add column if not exists monthly_debt_payments_cop numeric not null default 0,
  add column if not exists municipality text,
  add column if not exists start_date date;

create table if not exists public.monthly_tax_inputs_co (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  year integer not null,
  month integer not null,
  income_cop numeric not null default 0,
  deductible_expenses_cop numeric not null default 0,
  withholdings_cop numeric not null default 0,
  vat_collected_cop numeric not null default 0,
  notes text,
  created_at timestamptz not null default now(),
  unique (user_id, year, month)
);

alter table public.monthly_tax_inputs_co
  add column if not exists id uuid default gen_random_uuid(),
  add column if not exists user_id uuid,
  add column if not exists year integer,
  add column if not exists month integer,
  add column if not exists income_cop numeric not null default 0,
  add column if not exists deductible_expenses_cop numeric not null default 0,
  add column if not exists withholdings_cop numeric not null default 0,
  add column if not exists vat_collected_cop numeric not null default 0,
  add column if not exists notes text,
  add column if not exists created_at timestamptz not null default now();

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'monthly_tax_inputs_co_user_id_year_month_key'
      and conrelid = 'public.monthly_tax_inputs_co'::regclass
  ) then
    alter table public.monthly_tax_inputs_co
      add constraint monthly_tax_inputs_co_user_id_year_month_key unique (user_id, year, month);
  end if;
end $$;

create index if not exists idx_conversations_user_id_created_at
  on public.conversations(user_id, created_at desc);

create index if not exists idx_messages_user_id_created_at
  on public.messages(user_id, created_at desc);

create index if not exists idx_documents_user_id_created_at
  on public.documents(user_id, created_at desc);

create index if not exists idx_user_tax_profile_co_user_id_created_at
  on public.user_tax_profile_co(user_id, created_at desc);

create index if not exists idx_monthly_tax_inputs_co_user_id_created_at
  on public.monthly_tax_inputs_co(user_id, created_at desc);

alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.documents enable row level security;
alter table public.user_tax_profile_co enable row level security;
alter table public.monthly_tax_inputs_co enable row level security;

drop policy if exists conversations_select_owner on public.conversations;
drop policy if exists conversations_insert_owner on public.conversations;
drop policy if exists conversations_update_owner on public.conversations;
drop policy if exists conversations_delete_owner on public.conversations;

create policy conversations_select_owner
  on public.conversations for select
  using (user_id = auth.uid());

create policy conversations_insert_owner
  on public.conversations for insert
  with check (user_id = auth.uid());

create policy conversations_update_owner
  on public.conversations for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy conversations_delete_owner
  on public.conversations for delete
  using (user_id = auth.uid());

drop policy if exists messages_select_owner on public.messages;
drop policy if exists messages_insert_owner on public.messages;
drop policy if exists messages_update_owner on public.messages;
drop policy if exists messages_delete_owner on public.messages;

create policy messages_select_owner
  on public.messages for select
  using (
    user_id = auth.uid()
    and exists (
      select 1
      from public.conversations c
      where c.id = messages.conversation_id
        and c.user_id = auth.uid()
    )
  );

create policy messages_insert_owner
  on public.messages for insert
  with check (
    user_id = auth.uid()
    and exists (
      select 1
      from public.conversations c
      where c.id = messages.conversation_id
        and c.user_id = auth.uid()
    )
  );

create policy messages_update_owner
  on public.messages for update
  using (
    user_id = auth.uid()
    and exists (
      select 1
      from public.conversations c
      where c.id = messages.conversation_id
        and c.user_id = auth.uid()
    )
  )
  with check (
    user_id = auth.uid()
    and exists (
      select 1
      from public.conversations c
      where c.id = messages.conversation_id
        and c.user_id = auth.uid()
    )
  );

create policy messages_delete_owner
  on public.messages for delete
  using (
    user_id = auth.uid()
    and exists (
      select 1
      from public.conversations c
      where c.id = messages.conversation_id
        and c.user_id = auth.uid()
    )
  );

drop policy if exists documents_select_owner on public.documents;
drop policy if exists documents_insert_owner on public.documents;
drop policy if exists documents_update_owner on public.documents;
drop policy if exists documents_delete_owner on public.documents;

create policy documents_select_owner
  on public.documents for select
  using (user_id = auth.uid());

create policy documents_insert_owner
  on public.documents for insert
  with check (user_id = auth.uid());

create policy documents_update_owner
  on public.documents for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy documents_delete_owner
  on public.documents for delete
  using (user_id = auth.uid());

drop policy if exists user_tax_profile_co_select_owner on public.user_tax_profile_co;
drop policy if exists user_tax_profile_co_insert_owner on public.user_tax_profile_co;
drop policy if exists user_tax_profile_co_update_owner on public.user_tax_profile_co;
drop policy if exists user_tax_profile_co_delete_owner on public.user_tax_profile_co;

create policy user_tax_profile_co_select_owner
  on public.user_tax_profile_co for select
  using (user_id = auth.uid());

create policy user_tax_profile_co_insert_owner
  on public.user_tax_profile_co for insert
  with check (user_id = auth.uid());

create policy user_tax_profile_co_update_owner
  on public.user_tax_profile_co for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy user_tax_profile_co_delete_owner
  on public.user_tax_profile_co for delete
  using (user_id = auth.uid());

drop policy if exists monthly_tax_inputs_co_select_owner on public.monthly_tax_inputs_co;
drop policy if exists monthly_tax_inputs_co_insert_owner on public.monthly_tax_inputs_co;
drop policy if exists monthly_tax_inputs_co_update_owner on public.monthly_tax_inputs_co;
drop policy if exists monthly_tax_inputs_co_delete_owner on public.monthly_tax_inputs_co;

create policy monthly_tax_inputs_co_select_owner
  on public.monthly_tax_inputs_co for select
  using (user_id = auth.uid());

create policy monthly_tax_inputs_co_insert_owner
  on public.monthly_tax_inputs_co for insert
  with check (user_id = auth.uid());

create policy monthly_tax_inputs_co_update_owner
  on public.monthly_tax_inputs_co for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy monthly_tax_inputs_co_delete_owner
  on public.monthly_tax_inputs_co for delete
  using (user_id = auth.uid());
