import { NextResponse } from "next/server";
import { requirePlatformPermission } from "@/lib/platform-access";
import { applyTemplateConfiguration, captureTemplateConfiguration, normalizeConfiguration, recordPlatformAudit, type TemplateConfiguration } from "@/lib/template-management";

function templateKey(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 55);
}
function arrayOf(value: unknown) { return Array.isArray(value) ? value : []; }

async function saveVersion(admin: any, template: any, configuration: TemplateConfiguration, userId: string, changeSummary: string, version?: number) {
  const nextVersion = version || Math.max(Number(template.current_version || 0) + 1, 1);
  const { error } = await admin.from("implementation_template_versions").insert({ template_id: template.id, version: nextVersion, name: template.name, description: template.description, business_type: template.business_type, configuration, change_summary: changeSummary, created_by: userId });
  if (error) return { error };
  const update = await admin.from("implementation_templates").update({ current_version: nextVersion }).eq("id", template.id);
  return { error: update.error };
}

async function targetSnapshot(admin: any, tenantId: string) {
  const captured = await captureTemplateConfiguration(admin, tenantId);
  return captured.error ? null : captured.configuration;
}

async function applyConfigurationLegacy(admin: any, template: TemplateConfiguration, tenantId: string, userId: string, replace = false) {
  const summary = { modules: 0, assistant: 0, knowledge: 0, automations: 0, pipelineStages: 0, customFields: 0, catalog: 0 };
  const { data: target, error: targetError } = await admin.from("tenants").select("id,settings,logo_url").eq("id", tenantId).maybeSingle();
  if (targetError || !target) throw new Error(targetError?.message || "Empresa destino no encontrada.");
  const currentSettings = target.settings && typeof target.settings === "object" ? target.settings : {};
  const nextSettings = { ...currentSettings, ...(template.tenant_settings || {}) } as Record<string, unknown>;
  if (Array.isArray(template.modules) && template.modules.length) { nextSettings.modules = template.modules; summary.modules = template.modules.length; }
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
  const knowledge = arrayOf(template.knowledge).filter(item => typeof (item as any)?.title === "string" && typeof (item as any)?.content === "string");
  if (knowledge.length) {
    const existing = await admin.from("knowledge_documents").select("title").eq("tenant_id", tenantId);
    const existingTitles = new Set((existing.data || []).map((item: any) => item.title));
    const docs = knowledge.filter((item: any) => replace || !existingTitles.has(item.title)).map((item: any) => ({ tenant_id: tenantId, title: item.title, content: item.content, active: item.active !== false }));
    if (docs.length) { const result = await admin.from("knowledge_documents").insert(docs); if (result.error) throw new Error(result.error.message); summary.knowledge = docs.length; }
  }
  if (replace) await admin.from("automation_flows").delete().eq("tenant_id", tenantId);
  const automations = arrayOf(template.automations).filter(item => typeof (item as any)?.name === "string" && typeof (item as any)?.trigger_event === "string");
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
  const fields = arrayOf(template.custom_fields).filter(item => typeof (item as any)?.entity_type === "string" && typeof (item as any)?.field_key === "string" && typeof (item as any)?.label === "string");
  if (fields.length) { const result = await admin.from("custom_field_definitions").upsert(fields.map((item: any, index: number) => ({ tenant_id: tenantId, entity_type: item.entity_type, label: item.label, field_key: item.field_key, field_type: item.field_type || "text", options: item.options || [], required: Boolean(item.required), active: item.active !== false, position: Number(item.position ?? index) })), { onConflict: "tenant_id,entity_type,field_key" }); if (result.error) throw new Error(result.error.message); summary.customFields = fields.length; }
  const catalog = arrayOf(template.catalog).filter(item => typeof (item as any)?.name === "string");
  if (catalog.length) {
    const existing = await admin.from("products").select("sku,name").eq("tenant_id", tenantId);
    const keys = new Set((existing.data || []).map((item: any) => `${item.sku || ""}|${item.name}`));
    const products = catalog.filter((item: any) => !keys.has(`${item.sku || ""}|${item.name}`)).map((item: any) => ({ tenant_id: tenantId, sku: item.sku || null, name: item.name, description: item.description || null, price: Number(item.price || 0), currency: item.currency || "HNL", stock: 0, status: item.status === "inactive" ? "inactive" : "active" }));
    if (products.length) { const result = await admin.from("products").insert(products); if (result.error) throw new Error(result.error.message); summary.catalog = products.length; }
  }
  return summary;
}

export async function GET(request: Request) {
  const access = await requirePlatformPermission("templates.read");
  if (!access) return NextResponse.json({ error: "Acceso exclusivo para Superadministradores." }, { status: 403 });
  const url = new URL(request.url);
  const templateId = url.searchParams.get("templateId");
  if (templateId && url.searchParams.get("versions") === "1") {
    const { data, error } = await access.admin.from("implementation_template_versions").select("id,template_id,version,name,description,business_type,configuration,change_summary,created_by,created_at").eq("template_id", templateId).order("version", { ascending: false });
    return error ? NextResponse.json({ error: error.message }, { status: 400 }) : NextResponse.json(data || []);
  }
  const { data, error } = await access.admin.from("implementation_templates").select("id,key,name,description,business_type,configuration,source_tenant_id,is_system,active,current_version,created_at,updated_at").eq("active", true).order("is_system", { ascending:false }).order("created_at", { ascending:false });
  return error ? NextResponse.json({ error:error.message }, { status:400 }) : NextResponse.json(data || []);
}

export async function POST(request: Request) {
  const access = await requirePlatformPermission("templates.write");
  if (!access) return NextResponse.json({ error:"Acceso exclusivo para Superadministradores." }, { status:403 });
  const body = await request.json();
  const sourceTenantId = String(body.sourceTenantId || "");
  const name = String(body.name || "").trim();
  const description = String(body.description || "").trim().slice(0, 280);
  if (!sourceTenantId || name.length < 3) return NextResponse.json({ error:"Selecciona una empresa y escribe un nombre para la plantilla." }, { status:400 });
  if (access.tenantIds && !access.tenantIds.includes(sourceTenantId)) return NextResponse.json({ error:"No tienes esta empresa asignada para crear una plantilla." }, { status:403 });
  const captured = await captureTemplateConfiguration(access.admin, sourceTenantId);
  if (captured.error) return NextResponse.json({ error: captured.error }, { status:404 });
  const key = `${templateKey(name) || `plantilla-${crypto.randomUUID().slice(0,6)}`}-${crypto.randomUUID().slice(0,6)}`;
  const { data, error } = await access.admin.from("implementation_templates").insert({ key, name, description, business_type:captured.businessType, configuration:captured.configuration, source_tenant_id:sourceTenantId, created_by:access.user.id }).select().single();
  if (error || !data) return NextResponse.json({ error:error?.message || "No se pudo crear la plantilla." }, { status:400 });
  const version = await saveVersion(access.admin, { ...data, current_version:1 }, captured.configuration, access.user.id, "Versión inicial", 1);
  if (version.error) return NextResponse.json({ error:version.error.message }, { status:400 });
  const audit = await recordPlatformAudit(access.admin, { actorUserId:access.user.id, action:"create", entityType:"implementation_template", entityId:data.id, changes:{ name, sourceTenantId, version:1 } });
  if (audit) return NextResponse.json({ error:audit.message }, { status:500 });
  return NextResponse.json({ ...data, current_version:1 }, { status:201 });
}

export async function PATCH(request: Request) {
  const access = await requirePlatformPermission("templates.write");
  if (!access) return NextResponse.json({ error:"Acceso exclusivo para Superadministradores." }, { status:403 });
  const body = await request.json();
  const id = String(body.id || "");
  if (!id) return NextResponse.json({ error:"Plantilla inválida." }, { status:400 });
  const { data: current, error: currentError } = await access.admin.from("implementation_templates").select("*").eq("id", id).maybeSingle();
  if (currentError || !current) return NextResponse.json({ error:currentError?.message || "Plantilla no encontrada." }, { status:404 });
  if (body.action === "archive") {
    if (current.is_system) return NextResponse.json({ error:"Las plantillas base no pueden archivarse." }, { status:400 });
    const { error } = await access.admin.from("implementation_templates").update({ active:false }).eq("id", id);
    if (error) return NextResponse.json({ error:error.message }, { status:400 });
    const audit = await recordPlatformAudit(access.admin, { actorUserId:access.user.id, action:"archive", entityType:"implementation_template", entityId:id });
    return audit ? NextResponse.json({ error:audit.message }, { status:500 }) : NextResponse.json({ ok:true });
  }
  if (body.action === "update" || body.action === "restore_version") {
    const incoming = body.action === "restore_version" ? (await access.admin.from("implementation_template_versions").select("name,description,business_type,configuration").eq("id", String(body.versionId || "")).eq("template_id", id).maybeSingle()).data : body;
    if (!incoming) return NextResponse.json({ error:"Versión no encontrada." }, { status:404 });
    const configuration = normalizeConfiguration(incoming.configuration || current.configuration);
    const next = { name: String(incoming.name || current.name).trim().slice(0,120), description: String(incoming.description ?? current.description).trim().slice(0,280), business_type: ["generic","real_estate","restaurant","services","commerce"].includes(incoming.business_type) ? incoming.business_type : current.business_type, configuration };
    if (next.name.length < 3) return NextResponse.json({ error:"El nombre debe tener al menos 3 caracteres." }, { status:400 });
    const update = await access.admin.from("implementation_templates").update(next).eq("id", id).select().single();
    if (update.error || !update.data) return NextResponse.json({ error:update.error?.message || "No se pudo guardar la plantilla." }, { status:400 });
    const version = await saveVersion(access.admin, update.data, configuration, access.user.id, body.action === "restore_version" ? `Restaurada desde la versión ${body.versionNumber || "anterior"}` : String(body.changeSummary || "Edición manual"));
    if (version.error) return NextResponse.json({ error:version.error.message }, { status:400 });
    const audit = await recordPlatformAudit(access.admin, { actorUserId:access.user.id, action:body.action === "restore_version" ? "restore" : "update", entityType:"implementation_template", entityId:id, changes:{ version:update.data.current_version, sourceVersion:body.versionNumber || null } });
    if (audit) return NextResponse.json({ error:audit.message }, { status:500 });
    return NextResponse.json({ ...update.data, current_version: Math.max(Number(current.current_version || 0) + 1, 1) });
  }
  if (body.action === "preview" || body.action === "apply") {
    const tenantId = String(body.tenantId || "");
    if (!tenantId) return NextResponse.json({ error:"Selecciona una empresa destino." }, { status:400 });
    if (access.tenantIds && !access.tenantIds.includes(tenantId)) return NextResponse.json({ error:"No tienes este tenant asignado para aplicar plantillas." }, { status:403 });
    const configuration = normalizeConfiguration(current.configuration);
    if (body.action === "preview") {
      const existing = await targetSnapshot(access.admin, tenantId);
      if (!existing) return NextResponse.json({ error:"Empresa destino no encontrada." }, { status:404 });
      const names = (value: unknown, keys: string[]) => arrayOf(value).map((item: any) => keys.map(key => item?.[key]).find(item => typeof item === "string") || String(item)).slice(0, 12);
      const sections = [
        ["Módulos", configuration.modules?.length || 0, existing.modules?.length || 0, names(configuration.modules, ["name"] )],
        ["Documentos", configuration.knowledge?.length || 0, existing.knowledge?.length || 0, names(configuration.knowledge, ["title"] )],
        ["Automatizaciones", configuration.automations?.length || 0, existing.automations?.length || 0, names(configuration.automations, ["name"] )],
        ["Etapas del pipeline", configuration.pipeline?.stages?.length || 0, existing.pipeline?.stages?.length || 0, names(configuration.pipeline?.stages, ["name"] )],
        ["Campos personalizados", configuration.custom_fields?.length || 0, existing.custom_fields?.length || 0, names(configuration.custom_fields, ["label", "field_key"] )],
        ["Productos / catálogo", configuration.catalog?.length || 0, existing.catalog?.length || 0, names(configuration.catalog, ["name"] )],
        ["Respuestas rápidas", configuration.quick_replies?.length || 0, existing.quick_replies?.length || 0, names(configuration.quick_replies, ["title", "label", "shortcut", "text"] )],
        ["Notificaciones", configuration.notifications && Object.keys(configuration.notifications).length ? 1 : 0, existing.notifications && Object.keys(existing.notifications || {}).length ? 1 : 0, []]
      ].map(([label, incoming, currentCount, detail]) => ({ label, incoming, current: currentCount, changed: incoming !== currentCount, detail }));
      return NextResponse.json({ template:{ id:current.id, name:current.name, version:current.current_version || 1 }, tenantId, sections, warning:"Nunca se modifican credenciales, tokens, usuarios, contactos, conversaciones ni datos privados." });
    }
    try { const summary = await applyTemplateConfiguration(access.admin, configuration, tenantId, access.user.id, Boolean(body.replace)); const audit = await recordPlatformAudit(access.admin, { actorUserId:access.user.id, targetTenantId:tenantId, action:"apply", entityType:"implementation_template", entityId:id, changes:{ replace:Boolean(body.replace), summary } }); if (audit) return NextResponse.json({ error:audit.message }, { status:500 }); return NextResponse.json({ ok:true, summary, warning:"La plantilla se aplicó sin tocar credenciales ni datos privados." }); }
    catch (error) { return NextResponse.json({ error:error instanceof Error ? error.message : "No se pudo aplicar la plantilla." }, { status:400 }); }
  }
  return NextResponse.json({ error:"Acción no admitida." }, { status:400 });
}
