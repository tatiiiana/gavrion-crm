import { NextResponse } from "next/server";
import { requirePlatformPermission } from "@/lib/platform-access";
import { applyTemplateConfiguration, normalizeConfiguration, recordPlatformAudit } from "@/lib/template-management";

async function accessFor(capability: "customizations.write" | "templates.write", tenantId?: string) {
  return await requirePlatformPermission(capability, tenantId);
}

export async function GET() {
  const access = await requirePlatformPermission("companies.read");
  if (!access) return NextResponse.json({ error:"Acceso exclusivo para personal autorizado." }, { status:403 });
  let query = access.admin.from("implementation_customizations").select("id,tenant_id,template_id,template_version,status,overrides,created_by,reviewed_by,review_note,reviewed_at,applied_at,created_at,updated_at").order("updated_at", { ascending:false });
  if (access.tenantIds) query = query.in("tenant_id", access.tenantIds.length ? access.tenantIds : ["00000000-0000-0000-0000-000000000000"]);
  const { data, error } = await query;
  if (error) return NextResponse.json({ error:error.message }, { status:400 });
  const rows = data || [];
  const tenantIds = [...new Set(rows.map(item => item.tenant_id))];
  const templateIds = [...new Set(rows.map(item => item.template_id))];
  const [{ data: tenants }, { data: templates }] = await Promise.all([
    tenantIds.length ? access.admin.from("tenants").select("id,name,slug").in("id", tenantIds) : Promise.resolve({ data:[] }),
    templateIds.length ? access.admin.from("implementation_templates").select("id,name,business_type,current_version").in("id", templateIds) : Promise.resolve({ data:[] })
  ]);
  return NextResponse.json(rows.map(item => ({ ...item, tenant:tenants?.find(tenant => tenant.id===item.tenant_id) || null, template:templates?.find(template => template.id===item.template_id) || null })));
}

export async function POST(request: Request) {
  const body = await request.json();
  const tenantId = String(body.tenantId || "");
  const templateId = String(body.templateId || "");
  if (!tenantId || !templateId) return NextResponse.json({ error:"Selecciona una empresa y una plantilla." }, { status:400 });
  const access = await accessFor("customizations.write", tenantId) || await accessFor("templates.write", tenantId);
  if (!access) return NextResponse.json({ error:"No tienes permisos para personalizar esta empresa." }, { status:403 });
  const [{ data: template, error: templateError }, { data: tenant, error: tenantError }] = await Promise.all([
    access.admin.from("implementation_templates").select("id,name,current_version,configuration,active").eq("id", templateId).eq("active", true).maybeSingle(),
    access.admin.from("tenants").select("id,name").eq("id", tenantId).maybeSingle()
  ]);
  if (templateError || !template) return NextResponse.json({ error:templateError?.message || "Plantilla no encontrada." }, { status:404 });
  if (tenantError || !tenant) return NextResponse.json({ error:tenantError?.message || "Empresa no encontrada." }, { status:404 });
  const existing = await access.admin.from("implementation_customizations").select("id").eq("tenant_id", tenantId).maybeSingle();
  if (existing.data?.id) return NextResponse.json({ error:"Esta empresa ya tiene una personalización. Ábrela desde Personalizaciones." }, { status:409 });
  const overrides = normalizeConfiguration(template.configuration);
  const { data, error } = await access.admin.from("implementation_customizations").insert({ tenant_id:tenantId, template_id:templateId, template_version:template.current_version || 1, status:"draft", overrides, created_by:access.user.id }).select().single();
  if (error || !data) return NextResponse.json({ error:error?.message || "No se pudo crear el borrador." }, { status:400 });
  const audit = await recordPlatformAudit(access.admin, { actorUserId:access.user.id, targetTenantId:tenantId, action:"create", entityType:"implementation_customization", entityId:data.id, changes:{ templateId, templateVersion:template.current_version || 1 } });
  if (audit) return NextResponse.json({ error:audit.message }, { status:500 });
  return NextResponse.json({ ...data, tenant, template }, { status:201 });
}

export async function PATCH(request: Request) {
  const body = await request.json();
  const id = String(body.id || "");
  const action = String(body.action || "");
  if (!id) return NextResponse.json({ error:"Personalización inválida." }, { status:400 });
  const readAccess = await requirePlatformPermission("companies.read");
  if (!readAccess) return NextResponse.json({ error:"Acceso exclusivo para personal autorizado." }, { status:403 });
  const { data: customization, error } = await readAccess.admin.from("implementation_customizations").select("*").eq("id", id).maybeSingle();
  if (error || !customization) return NextResponse.json({ error:error?.message || "Personalización no encontrada." }, { status:404 });
  const tenantId = customization.tenant_id as string;
  if (readAccess.tenantIds && !readAccess.tenantIds.includes(tenantId)) return NextResponse.json({ error:"No tienes esta empresa asignada." }, { status:403 });
  const editable = action === "update" || action === "submit";
  if (editable) {
    const access = await accessFor("customizations.write", tenantId) || await accessFor("templates.write", tenantId);
    if (!access) return NextResponse.json({ error:"No tienes permisos para editar esta personalización." }, { status:403 });
    if (["applied","approved"].includes(customization.status) && action === "update") return NextResponse.json({ error:"Esta personalización ya fue aprobada. Crea una nueva revisión para modificarla." }, { status:409 });
    const overrides = body.overrides ? normalizeConfiguration(body.overrides) : normalizeConfiguration(customization.overrides);
    const status = action === "submit" ? "review" : "draft";
    const result = await access.admin.from("implementation_customizations").update({ overrides, status }).eq("id", id).select().single();
    if (result.error) return NextResponse.json({ error:result.error.message }, { status:400 });
    const audit = await recordPlatformAudit(access.admin, { actorUserId:access.user.id, targetTenantId:tenantId, action, entityType:"implementation_customization", entityId:id, changes:{ status } });
    return audit ? NextResponse.json({ error:audit.message }, { status:500 }) : NextResponse.json(result.data);
  }
  if (["approve","reject","apply"].includes(action)) {
    const access = await accessFor("templates.write", tenantId);
    if (!access) return NextResponse.json({ error:"Solo un implementador o superadmin puede aprobar y aplicar una personalización." }, { status:403 });
    if (action === "approve" || action === "reject") {
      const status = action === "approve" ? "approved" : "rejected";
      const result = await access.admin.from("implementation_customizations").update({ status, reviewed_by:access.user.id, review_note:String(body.reviewNote || "").trim().slice(0,500), reviewed_at:new Date().toISOString() }).eq("id", id).select().single();
      if (result.error) return NextResponse.json({ error:result.error.message }, { status:400 });
      const audit = await recordPlatformAudit(access.admin, { actorUserId:access.user.id, targetTenantId:tenantId, action, entityType:"implementation_customization", entityId:id, changes:{ status, reviewNote:body.reviewNote || "" } });
      return audit ? NextResponse.json({ error:audit.message }, { status:500 }) : NextResponse.json(result.data);
    }
    if (customization.status !== "approved") return NextResponse.json({ error:"La personalización debe estar aprobada antes de aplicarse." }, { status:409 });
    try {
      const summary = await applyTemplateConfiguration(access.admin, normalizeConfiguration(customization.overrides), tenantId, access.user.id, Boolean(body.replace));
      const result = await access.admin.from("implementation_customizations").update({ status:"applied", applied_at:new Date().toISOString(), reviewed_by:customization.reviewed_by || access.user.id }).eq("id", id).select().single();
      if (result.error) return NextResponse.json({ error:result.error.message }, { status:400 });
      const audit = await recordPlatformAudit(access.admin, { actorUserId:access.user.id, targetTenantId:tenantId, action:"apply", entityType:"implementation_customization", entityId:id, changes:{ replace:Boolean(body.replace), summary } });
      return audit ? NextResponse.json({ error:audit.message }, { status:500 }) : NextResponse.json({ ...result.data, summary });
    } catch (applyError) { return NextResponse.json({ error:applyError instanceof Error ? applyError.message : "No se pudo aplicar la personalización." }, { status:400 }); }
  }
  return NextResponse.json({ error:"Acción no admitida." }, { status:400 });
}
