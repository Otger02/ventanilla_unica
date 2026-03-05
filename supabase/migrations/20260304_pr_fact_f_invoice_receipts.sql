insert into storage.buckets (id, name, public)
values ('invoice_receipts', 'invoice_receipts', false)
on conflict (id) do nothing;

create table if not exists public.invoice_receipts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  sha256 text not null,
  storage_path text not null,
  original_filename text,
  created_at timestamptz not null default now(),
  unique (user_id, sha256)
);

create index if not exists idx_invoice_receipts_user_invoice_created_at
  on public.invoice_receipts(user_id, invoice_id, created_at desc);

alter table public.invoice_receipts enable row level security;

drop policy if exists invoice_receipts_select_owner on public.invoice_receipts;
drop policy if exists invoice_receipts_insert_owner on public.invoice_receipts;
drop policy if exists invoice_receipts_update_owner on public.invoice_receipts;
drop policy if exists invoice_receipts_delete_owner on public.invoice_receipts;

create policy invoice_receipts_select_owner
  on public.invoice_receipts for select
  using (
    user_id = auth.uid()
    and exists (
      select 1
      from public.invoices i
      where i.id = invoice_receipts.invoice_id
        and i.user_id = auth.uid()
    )
  );

create policy invoice_receipts_insert_owner
  on public.invoice_receipts for insert
  with check (
    user_id = auth.uid()
    and exists (
      select 1
      from public.invoices i
      where i.id = invoice_receipts.invoice_id
        and i.user_id = auth.uid()
    )
  );

create policy invoice_receipts_update_owner
  on public.invoice_receipts for update
  using (
    user_id = auth.uid()
    and exists (
      select 1
      from public.invoices i
      where i.id = invoice_receipts.invoice_id
        and i.user_id = auth.uid()
    )
  )
  with check (
    user_id = auth.uid()
    and exists (
      select 1
      from public.invoices i
      where i.id = invoice_receipts.invoice_id
        and i.user_id = auth.uid()
    )
  );

create policy invoice_receipts_delete_owner
  on public.invoice_receipts for delete
  using (
    user_id = auth.uid()
    and exists (
      select 1
      from public.invoices i
      where i.id = invoice_receipts.invoice_id
        and i.user_id = auth.uid()
    )
  );

drop policy if exists storage_invoice_receipts_select_owner on storage.objects;
drop policy if exists storage_invoice_receipts_insert_owner on storage.objects;
drop policy if exists storage_invoice_receipts_update_owner on storage.objects;
drop policy if exists storage_invoice_receipts_delete_owner on storage.objects;

create policy storage_invoice_receipts_select_owner
  on storage.objects for select
  using (
    bucket_id = 'invoice_receipts'
    and (storage.foldername(name))[1] = 'invoice_receipts'
    and (storage.foldername(name))[2] = auth.uid()::text
  );

create policy storage_invoice_receipts_insert_owner
  on storage.objects for insert
  with check (
    bucket_id = 'invoice_receipts'
    and (storage.foldername(name))[1] = 'invoice_receipts'
    and (storage.foldername(name))[2] = auth.uid()::text
  );

create policy storage_invoice_receipts_update_owner
  on storage.objects for update
  using (
    bucket_id = 'invoice_receipts'
    and (storage.foldername(name))[1] = 'invoice_receipts'
    and (storage.foldername(name))[2] = auth.uid()::text
  )
  with check (
    bucket_id = 'invoice_receipts'
    and (storage.foldername(name))[1] = 'invoice_receipts'
    and (storage.foldername(name))[2] = auth.uid()::text
  );

create policy storage_invoice_receipts_delete_owner
  on storage.objects for delete
  using (
    bucket_id = 'invoice_receipts'
    and (storage.foldername(name))[1] = 'invoice_receipts'
    and (storage.foldername(name))[2] = auth.uid()::text
  );
