-- Módulo inmobiliario multiempresa: propiedades, interesados y visitas.
create table if not exists public.properties (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  reference text,
  title text not null,
  property_type text not null check (property_type in ('house','apartment','land','commercial','office','other')),
  operation text not null check (operation in ('sale','rent')),
  price numeric(14,2) not null default 0 check (price >= 0),
  currency text not null default 'HNL',
  city text,
  zone text,
  address text,
  bedrooms integer check (bedrooms is null or bedrooms >= 0),
  bathrooms numeric(4,1) check (bathrooms is null or bathrooms >= 0),
  area_sqm numeric(12,2) check (area_sqm is null or area_sqm >= 0),
  description text,
  image_url text,
  status text not null default 'available' check (status in ('available','reserved','sold','rented','inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, reference)
);

create table if not exists public.property_inquiries (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  conversation_id uuid not null unique references public.conversations(id) on delete cascade,
  contact_id uuid references public.contacts(id) on delete set null,
  property_id uuid references public.properties(id) on delete set null,
  customer_name text not null,
  phone text not null,
  email text,
  intent text not null check (intent in ('buy','rent','sell')),
  property_type text,
  city text,
  zone text,
  budget_min numeric(14,2),
  budget_max numeric(14,2),
  bedrooms integer,
  notes text,
  status text not null default 'new' check (status in ('new','contacted','qualified','closed','discarded')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.property_visits (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  conversation_id uuid not null unique references public.conversations(id) on delete cascade,
  contact_id uuid references public.contacts(id) on delete set null,
  property_id uuid references public.properties(id) on delete set null,
  property_reference text,
  customer_name text not null,
  phone text not null,
  requested_date date not null,
  requested_time time not null,
  party_size integer not null default 1 check (party_size > 0 and party_size <= 30),
  notes text,
  status text not null default 'pending' check (status in ('pending','confirmed','completed','cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists properties_tenant_search_idx on public.properties(tenant_id, status, operation, property_type);
create index if not exists property_inquiries_tenant_status_idx on public.property_inquiries(tenant_id, status, created_at desc);
create index if not exists property_visits_tenant_status_idx on public.property_visits(tenant_id, status, requested_date);

alter table public.properties enable row level security;
alter table public.property_inquiries enable row level security;
alter table public.property_visits enable row level security;

drop policy if exists properties_member_all on public.properties;
create policy properties_member_all on public.properties for all using (public.is_tenant_member(tenant_id)) with check (public.is_tenant_member(tenant_id));
drop policy if exists property_inquiries_member_all on public.property_inquiries;
create policy property_inquiries_member_all on public.property_inquiries for all using (public.is_tenant_member(tenant_id)) with check (public.is_tenant_member(tenant_id));
drop policy if exists property_visits_member_all on public.property_visits;
create policy property_visits_member_all on public.property_visits for all using (public.is_tenant_member(tenant_id)) with check (public.is_tenant_member(tenant_id));

drop trigger if exists properties_set_updated_at on public.properties;
create trigger properties_set_updated_at before update on public.properties for each row execute procedure public.set_updated_at();
drop trigger if exists property_inquiries_set_updated_at on public.property_inquiries;
create trigger property_inquiries_set_updated_at before update on public.property_inquiries for each row execute procedure public.set_updated_at();
drop trigger if exists property_visits_set_updated_at on public.property_visits;
create trigger property_visits_set_updated_at before update on public.property_visits for each row execute procedure public.set_updated_at();
