-- Crea automáticamente un tenant y su membresía al registrarse un usuario.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  new_tenant_id uuid;
  company_name text;
begin
  company_name := coalesce(nullif(new.raw_user_meta_data ->> 'company_name', ''), 'Gavrion');

  insert into public.tenants (name, slug)
  values (company_name, lower(regexp_replace(company_name, '[^a-zA-Z0-9]+', '-', 'g')) || '-' || left(new.id::text, 8))
  returning id into new_tenant_id;

  insert into public.memberships (tenant_id, user_id, role)
  values (new_tenant_id, new.id, 'owner');

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
