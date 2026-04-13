-- Invoice Activity Log: timeline of actions per invoice
create table if not exists public.invoice_activity_log (
  id          uuid primary key default gen_random_uuid(),
  invoice_id  uuid not null references public.invoices(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  activity    text not null check (activity in (
    'uploaded',
    'processed',
    'quality_updated',
    'payment_opened',
    'scheduled',
    'rescheduled',
    'marked_paid',
    'receipt_uploaded',
    'manually_edited'
  )),
  metadata    jsonb default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

-- Index for fast lookups by invoice
create index if not exists idx_activity_log_invoice on public.invoice_activity_log(invoice_id, created_at desc);

-- RLS: owner-only
alter table public.invoice_activity_log enable row level security;

create policy "Users can view own activity"
  on public.invoice_activity_log for select
  using (user_id = auth.uid());

create policy "Users can insert own activity"
  on public.invoice_activity_log for insert
  with check (user_id = auth.uid());
