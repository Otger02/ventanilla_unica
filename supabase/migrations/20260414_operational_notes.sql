-- Operational notes: lightweight per-invoice and per-block context
create table if not exists public.operational_notes (
  id               uuid primary key default gen_random_uuid(),
  owner_user_id    uuid not null references auth.users(id) on delete cascade,
  author_label     text not null default 'Propietario',
  target_type      text not null
    check (target_type in ('invoice', 'review_queue', 'weekly_plan', 'goal', 'dashboard')),
  target_id        text default null,
  content          text not null
    check (char_length(content) > 0 and char_length(content) <= 2000),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists operational_notes_owner_idx on public.operational_notes(owner_user_id);
create index if not exists operational_notes_target_idx on public.operational_notes(owner_user_id, target_type, target_id);

-- RLS: owner-only
alter table public.operational_notes enable row level security;

drop policy if exists operational_notes_select_owner on public.operational_notes;
drop policy if exists operational_notes_insert_owner on public.operational_notes;
drop policy if exists operational_notes_update_owner on public.operational_notes;
drop policy if exists operational_notes_delete_owner on public.operational_notes;

create policy operational_notes_select_owner on public.operational_notes for select
  using (owner_user_id = auth.uid());
create policy operational_notes_insert_owner on public.operational_notes for insert
  with check (owner_user_id = auth.uid());
create policy operational_notes_update_owner on public.operational_notes for update
  using (owner_user_id = auth.uid()) with check (owner_user_id = auth.uid());
create policy operational_notes_delete_owner on public.operational_notes for delete
  using (owner_user_id = auth.uid());
