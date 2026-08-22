-- Identidad visual independiente para cada empresa.
alter table public.tenants
  add column if not exists logo_url text;

drop policy if exists "Tenant owners can update branding" on public.tenants;
create policy "Tenant owners can update branding"
on public.tenants
for update
to authenticated
using (
  exists (
    select 1 from public.memberships
    where memberships.tenant_id = tenants.id
      and memberships.user_id = auth.uid()
      and memberships.role in ('owner', 'admin')
  )
)
with check (
  exists (
    select 1 from public.memberships
    where memberships.tenant_id = tenants.id
      and memberships.user_id = auth.uid()
      and memberships.role in ('owner', 'admin')
  )
);
