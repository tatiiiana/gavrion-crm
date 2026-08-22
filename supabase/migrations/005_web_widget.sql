-- Clave pública y configuración del widget web para cada empresa.
alter table public.tenants
  add column if not exists widget_key uuid not null default gen_random_uuid();

create unique index if not exists tenants_widget_key_unique
  on public.tenants(widget_key);

create index if not exists contacts_web_visitor_idx
  on public.contacts(tenant_id, ((metadata ->> 'web_visitor_id')))
  where source = 'web';

