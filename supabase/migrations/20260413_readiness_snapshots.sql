-- Readiness snapshots: periodic portfolio health scores per user
create table if not exists public.readiness_snapshots (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  portfolio_score integer not null,
  healthy_count   integer not null,
  warning_count   integer not null,
  critical_count  integer not null,
  created_at      timestamptz not null default now()
);

-- Index for fast user history lookups
create index if not exists idx_readiness_snapshots_user
  on public.readiness_snapshots(user_id, created_at desc);

-- RLS: owner-only
alter table public.readiness_snapshots enable row level security;

create policy "Users can view own snapshots"
  on public.readiness_snapshots for select
  using (user_id = auth.uid());

create policy "Users can insert own snapshots"
  on public.readiness_snapshots for insert
  with check (user_id = auth.uid());
