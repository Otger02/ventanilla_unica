create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  nit text,
  nombre_razon_social text,
  impuesto_sobre_la_renta boolean default false,
  retencion_en_la_fuente boolean default false,
  autorretenedor boolean default false,
  responsable_de_iva boolean default false,
  regimen_simple boolean default false,
  gran_contribuyente boolean default false,
  responsabilidades_raw jsonb default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists profiles_select_owner on public.profiles;
drop policy if exists profiles_insert_owner on public.profiles;
drop policy if exists profiles_update_owner on public.profiles;

create policy profiles_select_owner
  on public.profiles for select
  using (user_id = auth.uid());

create policy profiles_insert_owner
  on public.profiles for insert
  with check (user_id = auth.uid());

create policy profiles_update_owner
  on public.profiles for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

