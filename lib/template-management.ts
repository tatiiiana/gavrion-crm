import type { SupabaseClient } from "@supabase/supabase-js";

export type TemplateConfiguration = {
  modules?: string[];
  tenant_settings?: Record<string, unknown>;
  branding?: { logo_url?: string | null };
  assistant?: Record<string, unknown>;
  knowledge?: Array<Record<string, unknown>>;
  automations?: Array<Record<string, unknown>>;
  company_profile?: Record<string, unknown>;
  pipeline?: { name?: string; stages?: Array<Record<string, unknown>> };
  custom_fields?: Array<Record<string, unknown>>;
  catalog?: Array<Record<string, unknown>>;
  quick_replies?: Array<Record<string, unknown>>;
  notifications?: Record<string, unknown>;
};

const sensitiveKey = /token|secret|password|credential|authorization|access[_-]?key|private[_-]?key|api[_-]?key|onboarding/i;

export async function recordPlatformAudit(admin: SupabaseClient, input: {
  actorUserId?: string | null;
  targetTenantId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  changes?: Record<string, unknown>;
}) {
  const { error } = await admin.from("platform_audit_logs").insert({
    actor_user_id: input.actorUserId || null,
    target_tenant_id: input.targetTenantId || null,
    action: input.action,
    entity_type: input.entityType,
    entity_id: input.entityId || null,
    changes: input.changes || {}
  });
  return error;
}

/** Removes secrets and tenant-specific connection data while preserving safe UI settings. */
export function sanitizeReusableSettings(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (sensitiveKey.test(key)) continue;
    if (key.toLowerCase().includes("channel") || key.toLowerCase().includes("integration")) continue;
    if (key === "onboarding") continue;
    if (Array.isArray(entry)) result[key] = entry.map(item => item && typeof item === "object" ? sanitizeReusableSettings(item) : item);
    else if (entry && typeof entry === "object") result[key] = sanitizeReusableSettings(entry);
    else result[key] = entry;
  }
  return result;
}

function rows<T>(result: { data: T[] | null; error: { message: string } | null }) {
  return result.error ? [] : (result.data || []);
}

export async function captureTemplateConfiguration(admin: SupabaseClient, tenantId: string): Promise<{ configuration: TemplateConfiguration; businessType: string; error?: string }> {
  const [tenant, assistant, knowledge, automations, profile, pipeline, fields, catalog] = await Promise.all([
    admin.from("tenants").select("id,template_key,settings,logo_url").eq("id", tenantId).maybeSingle(),
    admin.from("assistant_settings").select("enabled,assistant_name,instructions,handoff_message").eq("tenant_id", tenantId).maybeSingle(),
    admin.from("knowledge_documents").select("title,content,active").eq("tenant_id", tenantId).order("created_at"),
    admin.from("automation_flows").select("name,trigger_event,conditions,actions,enabled").eq("tenant_id", tenantId).order("created_at"),
    admin.from("company_profiles").select("timezone,business_hours").eq("tenant_id", tenantId).maybeSingle(),
    admin.from("pipelines").select("id,name,is_default,active").eq("tenant_id", tenantId).eq("is_default", true).maybeSingle(),
    admin.from("custom_field_definitions").select("entity_type,label,field_key,field_type,options,required,active,position").eq("tenant_id", tenantId).eq("active", true).order("position"),
    admin.from("products").select("sku,name,description,price,currency,status").eq("tenant_id", tenantId).order("created_at")
  ]);
  if (tenant.error || !tenant.data) return { configuration: {}, businessType: "generic", error: tenant.error?.message || "Empresa de origen no encontrada." };
  let stages: Array<Record<string, unknown>> = [];
  if (pipeline.data) {
    const stageResult = await admin.from("pipeline_stages").select("name,stage_key,color,position,probability,is_won,is_lost").eq("pipeline_id", pipeline.data.id).order("position");
    stages = rows(stageResult);
  }
  const sourceSettings = tenant.data.settings && typeof tenant.data.settings === "object" ? tenant.data.settings : {};
  const safeSettings = sanitizeReusableSettings(sourceSettings);
  const businessType = ["generic", "real_estate", "restaurant", "services", "commerce"].includes(tenant.data.template_key) ? tenant.data.template_key : "generic";
  return {
    businessType,
    configuration: {
      modules: Array.isArray((sourceSettings as Record<string, unknown>).modules) ? (sourceSettings as Record<string, unknown>).modules as string[] : [],
      tenant_settings: safeSettings,
      branding: { logo_url: tenant.data.logo_url || null },
      assistant: assistant.data || {},
      knowledge: rows(knowledge),
      automations: rows(automations),
      company_profile: profile.data || {},
      pipeline: pipeline.data ? { name: pipeline.data.name, stages } : undefined,
      custom_fields: rows(fields),
      catalog: rows(catalog),
      quick_replies: Array.isArray((sourceSettings as Record<string, unknown>).quick_replies) ? (sourceSettings as Record<string, unknown>).quick_replies as Array<Record<string, unknown>> : [],
      notifications: (sourceSettings as Record<string, unknown>).notifications && typeof (sourceSettings as Record<string, unknown>).notifications === "object" ? (sourceSettings as Record<string, unknown>).notifications as Record<string, unknown> : {}
    }
  };
}

export function normalizeConfiguration(input: unknown): TemplateConfiguration {
  const source = input && typeof input === "object" ? input as Record<string, unknown> : {};
  const safeArray = (value: unknown) => Array.isArray(value) ? value.filter(item => item && typeof item === "object").map(item => sanitizeReusableSettings(item)) : [];
  const configuration: TemplateConfiguration = {
    modules: Array.isArray(source.modules) ? source.modules.filter((item): item is string => typeof item === "string") : [],
    tenant_settings: sanitizeReusableSettings(source.tenant_settings),
    branding: source.branding && typeof source.branding === "object" ? { logo_url: typeof (source.branding as Record<string, unknown>).logo_url === "string" ? (source.branding as Record<string, unknown>).logo_url as string : null } : {},
    assistant: source.assistant && typeof source.assistant === "object" ? sanitizeReusableSettings(source.assistant) : {},
    knowledge: safeArray(source.knowledge) as Array<Record<string, unknown>>,
    automations: safeArray(source.automations) as Array<Record<string, unknown>>,
    company_profile: source.company_profile && typeof source.company_profile === "object" ? sanitizeReusableSettings(source.company_profile) : {},
    pipeline: source.pipeline && typeof source.pipeline === "object" ? sanitizeReusableSettings(source.pipeline) as TemplateConfiguration["pipeline"] : undefined,
    custom_fields: safeArray(source.custom_fields) as Array<Record<string, unknown>>,
    catalog: safeArray(source.catalog) as Array<Record<string, unknown>>,
    quick_replies: safeArray(source.quick_replies) as Array<Record<string, unknown>>,
    notifications: source.notifications && typeof source.notifications === "object" ? sanitizeReusableSettings(source.notifications) : {}
  };
  return configuration;
}

const list = (value: unknown) => Array.isArray(value) ? value : [];

export async function applyTemplateConfiguration(admin: SupabaseClient, template: TemplateConfiguration, tenantId: string, userId: string, replace = false) {
  const summary = { modules: 0, assistant: 0, knowledge: 0, automations: 0, pipelineStages: 0, customFields: 0, catalog: 0 };
  const { data: target, error: targetError } = await admin.from("tenants").select("id,settings,logo_url").eq("id", tenantId).maybeSingle();
  if (targetError || !target) throw new Error(targetError?.message || "Empresa destino no encontrada.");
  const currentSettings = target.settings && typeof target.settings === "object" ? target.settings : {};
  const nextSettings = { ...currentSettings, ...(template.tenant_settings || {}) } as Record<string, unknown>;
  if (Array.isArray(template.quick_replies)) nextSettings.quick_replies = template.quick_replies;
  if (template.notifications && typeof template.notifications === "object") nextSettings.notifications = template.notifications;
  if (Array.isArray(template.modules)) { nextSettings.modules = template.modules; summary.modules = template.modules.length; }
  const tenantUpdate: Record<string, unknown> = { settings: nextSettings };
  if (typeof template.branding?.logo_url === "string" && template.branding.logo_url) tenantUpdate.logo_url = template.branding.logo_url;
  const tenantResult = await admin.from("tenants").update(tenantUpdate).eq("id", tenantId);
  if (tenantResult.error) throw new Error(tenantResult.error.message);
  const assistant = template.assistant || {};
  if (Object.keys(assistant).length) {
    const result = await admin.from("assistant_settings").upsert({ tenant_id: tenantId, enabled: assistant.enabled ?? true, assistant_name: assistant.assistant_name || "Asistente virtual", instructions: assistant.instructions || "Responde con amabilidad, brevedad y únicamente con información confirmada.", handoff_message: assistant.handoff_message || "Voy a transferir esta conversación a una persona del equipo para ayudarte mejor." }, { onConflict: "tenant_id" });
    if (result.error) throw new Error(result.error.message); summary.assistant = 1;
  }
  const profile = template.company_profile || {};
  if (Object.keys(profile).length) {
    const result = await admin.from("company_profiles").upsert({ tenant_id: tenantId, timezone: profile.timezone || "America/Tegucigalpa", business_hours: profile.business_hours || {} }, { onConflict: "tenant_id" });
    if (result.error) throw new Error(result.error.message);
  }
  if (replace) await admin.from("knowledge_documents").delete().eq("tenant_id", tenantId);
  const knowledge = list(template.knowledge).filter(item => typeof (item as any)?.title === "string" && typeof (item as any)?.content === "string");
  if (knowledge.length) {
    const existing = await admin.from("knowledge_documents").select("title").eq("tenant_id", tenantId);
    const existingTitles = new Set((existing.data || []).map((item: any) => item.title));
    const docs = knowledge.filter((item: any) => replace || !existingTitles.has(item.title)).map((item: any) => ({ tenant_id: tenantId, title: item.title, content: item.content, active: item.active !== false }));
    if (docs.length) { const result = await admin.from("knowledge_documents").insert(docs); if (result.error) throw new Error(result.error.message); summary.knowledge = docs.length; }
  }
  if (replace) await admin.from("automation_flows").delete().eq("tenant_id", tenantId);
  const automations = list(template.automations).filter(item => typeof (item as any)?.name === "string" && typeof (item as any)?.trigger_event === "string");
  if (automations.length) {
    const existing = await admin.from("automation_flows").select("name").eq("tenant_id", tenantId);
    const existingNames = new Set((existing.data || []).map((item: any) => item.name));
    const flows = automations.filter((item: any) => replace || !existingNames.has(item.name)).map((item: any) => ({ tenant_id: tenantId, name: item.name, trigger_event: item.trigger_event, conditions: item.conditions || [], actions: item.actions || [], enabled: item.enabled !== false, created_by: userId }));
    if (flows.length) { const result = await admin.from("automation_flows").insert(flows); if (result.error) throw new Error(result.error.message); summary.automations = flows.length; }
  }
  const pipeline = template.pipeline;
  if (pipeline?.stages?.length) {
    const current = await admin.from("pipelines").select("id").eq("tenant_id", tenantId).eq("is_default", true).maybeSingle();
    let pipelineId = current.data?.id;
    if (!pipelineId) { const created = await admin.from("pipelines").insert({ tenant_id: tenantId, name: pipeline.name || "Pipeline comercial", is_default: true }).select("id").single(); if (created.error) throw new Error(created.error.message); pipelineId = created.data.id; }
    else { const updated = await admin.from("pipelines").update({ name: pipeline.name || "Pipeline comercial" }).eq("id", pipelineId); if (updated.error) throw new Error(updated.error.message); }
    const stages = pipeline.stages.map((item: any, index: number) => ({ tenant_id: tenantId, pipeline_id: pipelineId, name: String(item.name || `Etapa ${index + 1}`), stage_key: String(item.stage_key || item.key || `stage-${index + 1}`), color: String(item.color || "#514bb7"), position: Number(item.position ?? index), probability: Number(item.probability ?? 0), is_won: Boolean(item.is_won), is_lost: Boolean(item.is_lost) }));
    const result = await admin.from("pipeline_stages").upsert(stages, { onConflict: "pipeline_id,stage_key" }); if (result.error) throw new Error(result.error.message); summary.pipelineStages = stages.length;
  }
  const fields = list(template.custom_fields).filter(item => typeof (item as any)?.entity_type === "string" && typeof (item as any)?.field_key === "string" && typeof (item as any)?.label === "string");
  if (fields.length) { const result = await admin.from("custom_field_definitions").upsert(fields.map((item: any, index: number) => ({ tenant_id: tenantId, entity_type: item.entity_type, label: item.label, field_key: item.field_key, field_type: item.field_type || "text", options: item.options || [], required: Boolean(item.required), active: item.active !== false, position: Number(item.position ?? index) })), { onConflict: "tenant_id,entity_type,field_key" }); if (result.error) throw new Error(result.error.message); summary.customFields = fields.length; }
  const catalog = list(template.catalog).filter(item => typeof (item as any)?.name === "string");
  if (catalog.length) {
    const existing = await admin.from("products").select("sku,name").eq("tenant_id", tenantId);
    const keys = new Set((existing.data || []).map((item: any) => `${item.sku || ""}|${item.name}`));
    const products = catalog.filter((item: any) => !keys.has(`${item.sku || ""}|${item.name}`)).map((item: any) => ({ tenant_id: tenantId, sku: item.sku || null, name: item.name, description: item.description || null, price: Number(item.price || 0), currency: item.currency || "HNL", stock: 0, status: item.status === "inactive" ? "inactive" : "active" }));
    if (products.length) { const result = await admin.from("products").insert(products); if (result.error) throw new Error(result.error.message); summary.catalog = products.length; }
  }
  return summary;
}
