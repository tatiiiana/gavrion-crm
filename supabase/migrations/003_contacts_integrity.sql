-- Integridad para evitar contactos duplicados dentro de una empresa.
create unique index if not exists contacts_tenant_email_unique
  on public.contacts (tenant_id, lower(btrim(email)))
  where email is not null and btrim(email) <> '';

create unique index if not exists contacts_tenant_phone_unique
  on public.contacts (tenant_id, btrim(phone))
  where phone is not null and btrim(phone) <> '';

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists contacts_set_updated_at on public.contacts;
create trigger contacts_set_updated_at
  before update on public.contacts
  for each row execute procedure public.set_updated_at();

drop trigger if exists deals_set_updated_at on public.deals;
create trigger deals_set_updated_at
  before update on public.deals
  for each row execute procedure public.set_updated_at();
