-- Reemplaza YOUR_META_PHONE_NUMBER_ID antes de ejecutar.
-- Este identificador no es el teléfono; Meta lo muestra como Phone number ID.
insert into public.channel_connections (tenant_id, provider, external_account_id, status, settings)
select id, 'whatsapp', 'YOUR_META_PHONE_NUMBER_ID', 'active', jsonb_build_object('display_name', 'WhatsApp Gavrion')
from public.tenants
where name = 'Gavrion'
order by created_at asc
limit 1
on conflict (tenant_id, provider, external_account_id)
do update set status = 'active', settings = excluded.settings;
