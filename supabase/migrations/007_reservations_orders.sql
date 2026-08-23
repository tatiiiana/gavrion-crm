-- Solicitudes comerciales creadas por el asistente y administradas desde el CRM.
create table if not exists public.reservations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  conversation_id uuid not null unique references public.conversations(id) on delete cascade,
  contact_id uuid references public.contacts(id) on delete set null,
  customer_name text not null,
  phone text not null,
  reservation_date date not null,
  reservation_time time not null,
  party_size integer not null check (party_size > 0 and party_size <= 100),
  notes text,
  status text not null default 'pending' check (status in ('pending','confirmed','completed','cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  conversation_id uuid not null unique references public.conversations(id) on delete cascade,
  contact_id uuid references public.contacts(id) on delete set null,
  customer_name text not null,
  phone text not null,
  items text not null,
  fulfillment text not null default 'pickup' check (fulfillment in ('pickup','delivery')),
  requested_date date,
  requested_time time,
  address text,
  notes text,
  status text not null default 'pending' check (status in ('pending','confirmed','preparing','ready','completed','cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists reservations_tenant_status_idx on public.reservations(tenant_id, status, reservation_date);
create index if not exists orders_tenant_status_idx on public.orders(tenant_id, status, created_at desc);

alter table public.reservations enable row level security;
alter table public.orders enable row level security;

drop policy if exists reservations_member_all on public.reservations;
create policy reservations_member_all on public.reservations for all
using (public.is_tenant_member(tenant_id)) with check (public.is_tenant_member(tenant_id));

drop policy if exists orders_member_all on public.orders;
create policy orders_member_all on public.orders for all
using (public.is_tenant_member(tenant_id)) with check (public.is_tenant_member(tenant_id));

drop trigger if exists reservations_set_updated_at on public.reservations;
create trigger reservations_set_updated_at before update on public.reservations
for each row execute procedure public.set_updated_at();

drop trigger if exists orders_set_updated_at on public.orders;
create trigger orders_set_updated_at before update on public.orders
for each row execute procedure public.set_updated_at();
