alter table public.profiles 
add column if not exists nit_dv text,
add column if not exists actividad_economica text,
add column if not exists tipo_entidad text,
add column if not exists es_esal boolean default false;
