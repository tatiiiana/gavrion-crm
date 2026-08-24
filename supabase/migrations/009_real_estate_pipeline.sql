-- Vincula cada interesado inmobiliario con su oportunidad y tarea de seguimiento.
alter table public.property_inquiries
  add column if not exists deal_id uuid references public.deals(id) on delete set null,
  add column if not exists follow_up_task_id uuid references public.tasks(id) on delete set null,
  add column if not exists qualified_at timestamptz;

create index if not exists property_inquiries_deal_idx
  on public.property_inquiries(tenant_id, deal_id)
  where deal_id is not null;

