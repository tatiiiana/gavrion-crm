-- Ejecuta primero el esquema base del prototipo y luego esta migración.
create table if not exists public.webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  external_id text not null,
  payload jsonb not null,
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  unique(provider, external_id)
);

alter table public.webhook_events enable row level security;
-- Sin políticas públicas: solo funciones de servidor con service role acceden aquí.
