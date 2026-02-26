create extension if not exists "pgcrypto";

insert into storage.buckets (id, name, public)
values ('invoices', 'invoices', false)
on conflict (id) do nothing;

create table if not exists public.invoices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  status text not null default 'pending' check (status in ('pending', 'scheduled', 'paid', 'disputed')),
  supplier_name text,
  supplier_tax_id text,
  invoice_number text,
  issue_date date,
  due_date date,
  subtotal_cop bigint,
  iva_cop bigint,
  total_cop bigint,
  currency text not null default 'COP',
  source text not null default 'upload'
);

create table if not exists public.invoice_files (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  storage_bucket text not null default 'invoices',
  storage_path text not null,
  mime_type text not null,
  size_bytes bigint not null,
  sha256 text not null,
  unique (user_id, sha256)
);

create index if not exists idx_invoices_user_id_created_at
  on public.invoices(user_id, created_at desc);

create index if not exists idx_invoice_files_user_id_created_at
  on public.invoice_files(user_id, created_at desc);

create index if not exists idx_invoice_files_invoice_id
  on public.invoice_files(invoice_id);

alter table public.invoices enable row level security;
alter table public.invoice_files enable row level security;

drop policy if exists invoices_select_owner on public.invoices;
drop policy if exists invoices_insert_owner on public.invoices;
drop policy if exists invoices_update_owner on public.invoices;
drop policy if exists invoices_delete_owner on public.invoices;

create policy invoices_select_owner
  on public.invoices for select
  using (user_id = auth.uid());

create policy invoices_insert_owner
  on public.invoices for insert
  with check (user_id = auth.uid());

create policy invoices_update_owner
  on public.invoices for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy invoices_delete_owner
  on public.invoices for delete
  using (user_id = auth.uid());

drop policy if exists invoice_files_select_owner on public.invoice_files;
drop policy if exists invoice_files_insert_owner on public.invoice_files;
drop policy if exists invoice_files_update_owner on public.invoice_files;
drop policy if exists invoice_files_delete_owner on public.invoice_files;

create policy invoice_files_select_owner
  on public.invoice_files for select
  using (
    user_id = auth.uid()
    and exists (
      select 1
      from public.invoices i
      where i.id = invoice_files.invoice_id
        and i.user_id = auth.uid()
    )
  );

create policy invoice_files_insert_owner
  on public.invoice_files for insert
  with check (
    user_id = auth.uid()
    and exists (
      select 1
      from public.invoices i
      where i.id = invoice_files.invoice_id
        and i.user_id = auth.uid()
    )
  );

create policy invoice_files_update_owner
  on public.invoice_files for update
  using (
    user_id = auth.uid()
    and exists (
      select 1
      from public.invoices i
      where i.id = invoice_files.invoice_id
        and i.user_id = auth.uid()
    )
  )
  with check (
    user_id = auth.uid()
    and exists (
      select 1
      from public.invoices i
      where i.id = invoice_files.invoice_id
        and i.user_id = auth.uid()
    )
  );

create policy invoice_files_delete_owner
  on public.invoice_files for delete
  using (
    user_id = auth.uid()
    and exists (
      select 1
      from public.invoices i
      where i.id = invoice_files.invoice_id
        and i.user_id = auth.uid()
    )
  );

drop policy if exists storage_invoices_select_owner on storage.objects;
drop policy if exists storage_invoices_insert_owner on storage.objects;
drop policy if exists storage_invoices_update_owner on storage.objects;
drop policy if exists storage_invoices_delete_owner on storage.objects;

create policy storage_invoices_select_owner
  on storage.objects for select
  using (
    bucket_id = 'invoices'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy storage_invoices_insert_owner
  on storage.objects for insert
  with check (
    bucket_id = 'invoices'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy storage_invoices_update_owner
  on storage.objects for update
  using (
    bucket_id = 'invoices'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'invoices'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy storage_invoices_delete_owner
  on storage.objects for delete
  using (
    bucket_id = 'invoices'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
