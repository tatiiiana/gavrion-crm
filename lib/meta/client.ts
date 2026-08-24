import { createAdminSupabase } from "@/lib/supabase/admin";

export const graphVersion = process.env.META_GRAPH_VERSION || "v23.0";
export const graphBase = `https://graph.facebook.com/${graphVersion}`;

export async function getMetaConnection(tenantId: string, provider: string) {
  const supabase = createAdminSupabase();
  const { data: connection } = await supabase.from("channel_connections").select("id, tenant_id, provider, external_account_id, settings, status").eq("tenant_id", tenantId).eq("provider", provider).eq("status", "active").maybeSingle();
  if (!connection) return null;
  const { data: credential } = await supabase.from("meta_channel_credentials").select("access_token, expires_at").eq("connection_id", connection.id).maybeSingle();
  return credential ? { ...connection, accessToken: credential.access_token, expiresAt: credential.expires_at } : null;
}

export async function findMetaConnection(provider: string, externalAccountId: string) {
  const supabase = createAdminSupabase();
  const { data: connection } = await supabase.from("channel_connections").select("id, tenant_id, provider, external_account_id, settings, status").eq("provider", provider).eq("external_account_id", externalAccountId).eq("status", "active").maybeSingle();
  if (!connection) return null;
  const { data: credential } = await supabase.from("meta_channel_credentials").select("access_token").eq("connection_id", connection.id).maybeSingle();
  return credential ? { ...connection, accessToken: credential.access_token } : null;
}

export async function getMetaConnectionById(tenantId: string, connectionId: string) {
  const supabase = createAdminSupabase();
  const { data: connection } = await supabase.from("channel_connections").select("id, tenant_id, provider, external_account_id, settings, status").eq("id", connectionId).eq("tenant_id", tenantId).eq("status", "active").maybeSingle();
  if (!connection) return null;
  const { data: credential } = await supabase.from("meta_channel_credentials").select("access_token, expires_at").eq("connection_id", connection.id).maybeSingle();
  return credential ? { ...connection, accessToken: credential.access_token, expiresAt: credential.expires_at } : null;
}

export async function graphRequest(path: string, accessToken: string, init?: RequestInit) {
  const separator = path.includes("?") ? "&" : "?";
  const response = await fetch(`${graphBase}/${path}${separator}access_token=${encodeURIComponent(accessToken)}`, init);
  const result = await response.json();
  if (!response.ok) throw new Error(result.error?.message || "Meta rechazó la solicitud");
  return result;
}
