-- User operating preferences: presentation/ordering customization per user
create table if not exists public.user_operating_preferences (
  user_id                    uuid primary key references auth.users(id) on delete cascade,
  preferred_action_style     text not null default 'balanced'
    check (preferred_action_style in ('conservative', 'balanced', 'aggressive')),
  preferred_weekly_focus     text default null
    check (preferred_weekly_focus is null or preferred_weekly_focus in ('cash', 'compliance', 'cleanup')),
  preferred_schedule_day     text default null
    check (preferred_schedule_day is null or preferred_schedule_day in ('lunes','martes','miercoles','jueves','viernes')),
  max_weekly_execution_count integer default null
    check (max_weekly_execution_count is null or (max_weekly_execution_count >= 1 and max_weekly_execution_count <= 50)),
  notes                      text default null,
  updated_at                 timestamptz not null default now()
);

-- RLS owner-only (full CRUD)
alter table public.user_operating_preferences enable row level security;

drop policy if exists user_operating_preferences_select_owner on public.user_operating_preferences;
drop policy if exists user_operating_preferences_insert_owner on public.user_operating_preferences;
drop policy if exists user_operating_preferences_update_owner on public.user_operating_preferences;
drop policy if exists user_operating_preferences_delete_owner on public.user_operating_preferences;

create policy user_operating_preferences_select_owner on public.user_operating_preferences for select using (user_id = auth.uid());
create policy user_operating_preferences_insert_owner on public.user_operating_preferences for insert with check (user_id = auth.uid());
create policy user_operating_preferences_update_owner on public.user_operating_preferences for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy user_operating_preferences_delete_owner on public.user_operating_preferences for delete using (user_id = auth.uid());

-- Additive: view mode column
alter table public.user_operating_preferences
  add column if not exists preferred_view_mode text not null default 'owner';

-- Check constraint (idempotent via DO block)
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'user_operating_preferences_view_mode_check'
  ) then
    alter table public.user_operating_preferences
      add constraint user_operating_preferences_view_mode_check
      check (preferred_view_mode in ('owner', 'advisor'));
  end if;
end $$;
