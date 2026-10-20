import type { SupabaseClient } from "@supabase/supabase-js";

type Integrations = { crmBaseUrl?: string; tenantKey?: string; useRealChatbox?: boolean; useLiveCatalog?: boolean };

/**
 * Enlaza un sitio con la empresa a la que pertenece antes de exportarlo o publicarlo:
 * fuerza la clave pública (widget_key) de esa empresa y la URL del CRM para que
 * los formularios, el catálogo y el chatbox siempre envíen al CRM correcto.
 */
export async function bindSiteToTenant(admin: SupabaseClient, tenantId: string | null | undefined, config: Record<string, unknown>, requestUrl: string): Promise<{ config: Record<string, unknown>; error?: string }> {
  const integrations = (config.integrations || {}) as Integrations;
  if (!tenantId) return { config, error: "El sitio no está asignado a una empresa." };
  const { data, error } = await admin.from("tenants").select("widget_key").eq("id", tenantId).maybeSingle();
  if (error || !data?.widget_key) return { config, error: "La empresa no tiene una clave pública para conectar el sitio con el CRM." };
  const origin = new URL(requestUrl).origin;
  const configured = String(integrations.crmBaseUrl || "").replace(/\/$/, "");
  const isLocal = (url: string) => /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(url);
  const crmBaseUrl = (process.env.NEXT_PUBLIC_APP_URL || "").replace(/\/$/, "") || (configured && !isLocal(configured) ? configured : origin);
  return { config: { ...config, integrations: { ...integrations, crmBaseUrl, tenantKey: String(data.widget_key) } } };
}
