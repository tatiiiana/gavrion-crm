import type { SupabaseClient } from "@supabase/supabase-js";
import { sanitizeSiteConfig, type GastronomySiteConfig } from "@/lib/site-builder";

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
  const template = String(config.template || "");
  const useLiveCatalog = ["gastronomia-a", "comercio-a", "hoteles-a"].includes(template) || integrations.useLiveCatalog === true;
  return { config: { ...config, integrations: { ...integrations, crmBaseUrl, tenantKey: String(data.widget_key), useLiveCatalog } } };
}

type CompanySettingsForSite = {
  companyName?: string;
  logoUrl?: string;
  widgetColor?: string;
  customDomain?: string;
  legalAddress?: string;
  phone?: string;
  publicEmail?: string;
  website?: string;
  businessHours?: Record<string, { open?: string; close?: string; closed?: boolean }>;
};

const scheduleLabels: Record<string, string> = {
  monday: "Lun", tuesday: "Mar", wednesday: "Mié", thursday: "Jue",
  friday: "Vie", saturday: "Sáb", sunday: "Dom",
};

function scheduleFromHours(hours?: CompanySettingsForSite["businessHours"]) {
  if (!hours || typeof hours !== "object") return "";
  return Object.entries(scheduleLabels)
    .map(([day, label]) => ({ label, value: hours[day] }))
    .filter(({ value }) => value && !value.closed && value.open && value.close)
    .map(({ label, value }) => `${label} ${value!.open}–${value!.close}`)
    .join(" · ");
}

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).map((part) => part[0]).join("").slice(0, 3).toUpperCase() || "G";
}

/** Propaga datos públicos de Empresa y widget al único sitio activo de la empresa. */
export async function syncAssignedSiteFromCompanySettings(
  admin: SupabaseClient,
  tenantId: string,
  input: CompanySettingsForSite,
  actorId?: string,
) {
  let lookup = await admin.from("site_projects")
    .select("id,tenant_id,name,template_key,configuration,status,vercel_project_id,custom_domain")
    .eq("tenant_id", tenantId)
    .is("archived_at", null)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (lookup.error?.code === "42703") {
    lookup = await admin.from("site_projects")
      .select("id,tenant_id,name,template_key,configuration,status")
      .eq("tenant_id", tenantId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
  }
  if (lookup.error) throw new Error(lookup.error.message);
  if (!lookup.data) return { updated: false, reason: "no_site" as const };

  const current = sanitizeSiteConfig({
    ...((lookup.data.configuration as Record<string, unknown>) || {}),
    template: lookup.data.template_key,
  });
  const schedule = scheduleFromHours(input.businessHours);
  const next: GastronomySiteConfig = sanitizeSiteConfig({
    ...current,
    brand: {
      ...current.brand,
      ...(input.companyName !== undefined ? { name: String(input.companyName).trim(), shortName: initials(String(input.companyName).trim()) } : {}),
      ...(input.logoUrl !== undefined ? { logoUrl: String(input.logoUrl || "").trim() } : {}),
      ...(input.widgetColor !== undefined ? { primaryColor: String(input.widgetColor) } : {}),
    },
    seo: input.companyName !== undefined
      ? { ...current.seo, title: `${String(input.companyName).trim()} | Sitio oficial` }
      : current.seo,
    contact: {
      ...current.contact,
      ...(input.phone !== undefined ? { phone: String(input.phone || "").trim() } : {}),
      ...(input.publicEmail !== undefined ? { email: String(input.publicEmail || "").trim() } : {}),
      ...(input.legalAddress !== undefined ? { address: String(input.legalAddress || "").trim() } : {}),
      ...(schedule ? { schedule } : {}),
    },
  });

  const nextDomain = input.customDomain !== undefined ? String(input.customDomain || "").trim() || null : lookup.data.custom_domain || null;
  const domainChanged = input.customDomain !== undefined && nextDomain !== (lookup.data.custom_domain || null);
  const configChanged = JSON.stringify(current) !== JSON.stringify(next);
  if (!configChanged && !domainChanged) return { updated: false, reason: "unchanged" as const };
  const latest = await admin.from("site_project_versions")
    .select("version")
    .eq("site_project_id", lookup.data.id)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (latest.error) throw new Error(latest.error.message);
  const version = (latest.data?.version || 0) + 1;
  const versionInsert = await admin.from("site_project_versions").insert({
    site_project_id: lookup.data.id,
    version,
    configuration: current,
    created_by: actorId || null,
  });
  if (versionInsert.error) throw new Error(versionInsert.error.message);
  const projectPatch: Record<string, unknown> = { configuration: next };
  if (input.customDomain !== undefined) {
    projectPatch.custom_domain = nextDomain;
    projectPatch.domain_status = input.customDomain ? "pending" : "not_configured";
  }
  let update = await admin.from("site_projects").update(projectPatch).eq("id", lookup.data.id);
  if (update.error?.code === "42703" && input.customDomain !== undefined) {
    update = await admin.from("site_projects").update({ configuration: next }).eq("id", lookup.data.id);
  }
  if (update.error) throw new Error(update.error.message);
  return { updated: true, siteProjectId: lookup.data.id, version: configChanged ? version : undefined, siteProject: { id: lookup.data.id, tenant_id: tenantId, name: String((lookup.data as { name?: string }).name || "Sitio"), template_key: lookup.data.template_key, configuration: next as unknown as Record<string, unknown>, status: lookup.data.status, vercel_project_id: (lookup.data as { vercel_project_id?: string | null }).vercel_project_id || null, custom_domain: nextDomain } };
}
