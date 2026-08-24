-- Conexiones Meta productivas y credenciales privadas por empresa.
create unique index if not exists channel_connections_tenant_provider_account_unique
  on public.channel_connections(tenant_id, provider, external_account_id);
alter table public.conversations add column if not exists channel_connection_id uuid references public.channel_connections(id) on delete set null;
create index if not exists conversations_channel_connection_idx on public.conversations(channel_connection_id);

create table if not exists public.meta_channel_credentials (
  connection_id uuid primary key references public.channel_connections(id) on delete cascade,
  access_token text not null,
  token_type text not null default 'bearer',
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.meta_channel_credentials enable row level security;
-- Sin políticas para usuarios: solo service_role puede leer tokens.

create table if not exists public.meta_oauth_states (
  state text primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.meta_oauth_states enable row level security;

drop trigger if exists meta_credentials_set_updated_at on public.meta_channel_credentials;
create trigger meta_credentials_set_updated_at before update on public.meta_channel_credentials
for each row execute procedure public.set_updated_at();
