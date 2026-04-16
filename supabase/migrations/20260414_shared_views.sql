-- Shared view links: lightweight collaboration without multi-tenant auth
create table if not exists public.shared_views (
  id               uuid primary key default gen_random_uuid(),
  owner_user_id    uuid not null references auth.users(id) on delete cascade,
  shared_with_email text not null,
  access_mode      text not null
    check (access_mode in ('read_only', 'advisor_limited')),
  token            text unique not null,
  is_active        boolean not null default true,
  created_at       timestamptz not null default now(),
  expires_at       timestamptz default null
);

create unique index if not exists shared_views_token_idx on public.shared_views(token);
create index if not exists shared_views_owner_idx on public.shared_views(owner_user_id);

-- RLS: owner-only management
alter table public.shared_views enable row level security;

drop policy if exists shared_views_select_owner on public.shared_views;
drop policy if exists shared_views_insert_owner on public.shared_views;
drop policy if exists shared_views_update_owner on public.shared_views;
drop policy if exists shared_views_delete_owner on public.shared_views;

create policy shared_views_select_owner on public.shared_views for select
  using (owner_user_id = auth.uid());
create policy shared_views_insert_owner on public.shared_views for insert
  with check (owner_user_id = auth.uid());
create policy shared_views_update_owner on public.shared_views for update
  using (owner_user_id = auth.uid()) with check (owner_user_id = auth.uid());
create policy shared_views_delete_owner on public.shared_views for delete
  using (owner_user_id = auth.uid());
