import { createAdminSupabase } from "@/lib/supabase/admin";
import { decryptCredential, encryptCredential, isEncryptedCredential } from "@/lib/security/credentials";

export const graphVersion = process.env.META_GRAPH_VERSION || "v23.0";
export const graphBase = `https://graph.facebook.com/${graphVersion}`;

async function readCredential(supabase: ReturnType<typeof createAdminSupabase>, connectionId: string, withExpiry = false) {
  const { data } = withExpiry
    ? await supabase.from("meta_channel_credentials").select("access_token, expires_at").eq("connection_id", connectionId).maybeSingle()
    : await supabase.from("meta_channel_credentials").select("access_token").eq("connection_id", connectionId).maybeSingle();
  if (!data?.access_token) return null;
  const stored = String(data.access_token);
  const accessToken = decryptCredential(stored);
  if (!isEncryptedCredential(stored) && process.env.META_CREDENTIAL_ENCRYPTION_KEY) {
    await supabase.from("meta_channel_credentials").update({ access_token: encryptCredential(accessToken) }).eq("connection_id", connectionId);
  }
  return { accessToken, expiresAt: "expires_at" in data ? data.expires_at : null };
}

export async function getMetaConnection(tenantId: string, provider: string) {
  const supabase = createAdminSupabase();
  const { data: connection } = await supabase.from("channel_connections").select("id, tenant_id, provider, external_account_id, settings, status").eq("tenant_id", tenantId).eq("provider", provider).eq("status", "active").maybeSingle();
  if (!connection) return null;
  const credential = await readCredential(supabase, connection.id, true);
  return credential ? { ...connection, ...credential } : null;
}

export async function findMetaConnection(provider: string, externalAccountId: string) {
  const supabase = createAdminSupabase();
  const { data: connection } = await supabase.from("channel_connections").select("id, tenant_id, provider, external_account_id, settings, status").eq("provider", provider).eq("external_account_id", externalAccountId).eq("status", "active").maybeSingle();
  if (!connection) return null;
  const credential = await readCredential(supabase, connection.id);
  return credential ? { ...connection, accessToken: credential.accessToken } : null;
}

export async function getMetaConnectionById(tenantId: string, connectionId: string) {
  const supabase = createAdminSupabase();
  const { data: connection } = await supabase.from("channel_connections").select("id, tenant_id, provider, external_account_id, settings, status").eq("id", connectionId).eq("tenant_id", tenantId).eq("status", "active").maybeSingle();
  if (!connection) return null;
  const credential = await readCredential(supabase, connection.id, true);
  return credential ? { ...connection, ...credential } : null;
}

export async function graphRequest(path: string, accessToken: string, init?: RequestInit) {
  const separator = path.includes("?") ? "&" : "?";
  const response = await fetch(`${graphBase}/${path}${separator}access_token=${encodeURIComponent(accessToken)}`, init);
  const result = await response.json();
  if (!response.ok) throw new Error(result.error?.message || "Meta rechazó la solicitud");
  return result;
}
