-- Asistente híbrido por empresa: conocimiento, configuración y transferencia humana.
alter table public.conversations
  add column if not exists handling_mode text not null default 'bot'
  check (handling_mode in ('bot', 'waiting_agent', 'human'));

create table if not exists public.assistant_settings (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  enabled boolean not null default true,
  assistant_name text not null default 'Asistente virtual',
  instructions text not null default 'Responde con amabilidad, brevedad y únicamente con información confirmada.',
  handoff_message text not null default 'Voy a transferir esta conversación a una persona del equipo para ayudarte mejor.',
  updated_at timestamptz not null default now()
);

create table if not exists public.knowledge_documents (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  title text not null,
  content text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists knowledge_documents_tenant_idx
  on public.knowledge_documents(tenant_id, active);

alter table public.assistant_settings enable row level security;
alter table public.knowledge_documents enable row level security;

drop policy if exists assistant_settings_member_all on public.assistant_settings;
create policy assistant_settings_member_all on public.assistant_settings for all
using (public.is_tenant_member(tenant_id)) with check (public.is_tenant_member(tenant_id));

drop policy if exists knowledge_documents_member_all on public.knowledge_documents;
create policy knowledge_documents_member_all on public.knowledge_documents for all
using (public.is_tenant_member(tenant_id)) with check (public.is_tenant_member(tenant_id));

insert into public.assistant_settings (tenant_id)
select id from public.tenants
on conflict (tenant_id) do nothing;

