import { NextResponse } from "next/server";
import { requirePlatformAdmin } from "@/lib/platform-admin";

function templateKey(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 55);
}

export async function GET() {
  const access = await requirePlatformAdmin();
  if (!access) return NextResponse.json({ error:"Acceso exclusivo para Superadministradores." }, { status:403 });
  const { data, error } = await access.admin.from("implementation_templates").select("id,key,name,description,business_type,configuration,source_tenant_id,is_system,active,created_at,updated_at").eq("active", true).order("is_system", { ascending:false }).order("created_at", { ascending:false });
  return error ? NextResponse.json({ error:error.message }, { status:400 }) : NextResponse.json(data || []);
}

export async function POST(request: Request) {
  const access = await requirePlatformAdmin();
  if (!access) return NextResponse.json({ error:"Acceso exclusivo para Superadministradores." }, { status:403 });
  const body = await request.json();
  const sourceTenantId = String(body.sourceTenantId || "");
  const name = String(body.name || "").trim();
  const description = String(body.description || "").trim().slice(0, 280);
  if (!sourceTenantId || name.length < 3) return NextResponse.json({ error:"Selecciona una empresa y escribe un nombre para la plantilla." }, { status:400 });

  const { admin, user } = access;
  const [tenant, assistant, knowledge, automations, profile] = await Promise.all([
    admin.from("tenants").select("id,template_key,settings").eq("id", sourceTenantId).maybeSingle(),
    admin.from("assistant_settings").select("enabled,instructions,handoff_message").eq("tenant_id", sourceTenantId).maybeSingle(),
    admin.from("knowledge_documents").select("title,content,active").eq("tenant_id", sourceTenantId).order("created_at"),
    admin.from("automation_flows").select("name,trigger_event,conditions,actions,enabled").eq("tenant_id", sourceTenantId).order("created_at"),
    admin.from("company_profiles").select("timezone,business_hours").eq("tenant_id", sourceTenantId).maybeSingle()
  ]);
  if (tenant.error || !tenant.data) return NextResponse.json({ error:tenant.error?.message || "Empresa de origen no encontrada." }, { status:404 });

  const sourceSettings = tenant.data.settings && typeof tenant.data.settings === "object" ? tenant.data.settings as Record<string, unknown> : {};
  const { onboarding: _onboarding, ...reusableSettings } = sourceSettings;
  const configuration = {
    modules: Array.isArray(sourceSettings.modules) ? sourceSettings.modules : [],
    tenant_settings: reusableSettings,
    assistant: assistant.data || {},
    knowledge: knowledge.data || [],
    automations: automations.data || [],
    company_profile: profile.data || {}
  };
  const baseKey = templateKey(name) || `plantilla-${crypto.randomUUID().slice(0,6)}`;
  const key = `${baseKey}-${crypto.randomUUID().slice(0,6)}`;
  const businessType = ["generic","real_estate","restaurant","services","commerce"].includes(tenant.data.template_key) ? tenant.data.template_key : "generic";
  const { data, error } = await admin.from("implementation_templates").insert({ key, name, description, business_type:businessType, configuration, source_tenant_id:sourceTenantId, created_by:user.id }).select().single();
  return error ? NextResponse.json({ error:error.message }, { status:400 }) : NextResponse.json(data, { status:201 });
}

export async function PATCH(request: Request) {
  const access = await requirePlatformAdmin();
  if (!access) return NextResponse.json({ error:"Acceso exclusivo para Superadministradores." }, { status:403 });
  const body = await request.json();
  const id = String(body.id || "");
  if (!id) return NextResponse.json({ error:"Plantilla inválida." }, { status:400 });
  if (body.action === "archive") {
    const { data: current } = await access.admin.from("implementation_templates").select("is_system").eq("id", id).maybeSingle();
    if (current?.is_system) return NextResponse.json({ error:"Las plantillas base no pueden archivarse." }, { status:400 });
    const { error } = await access.admin.from("implementation_templates").update({ active:false }).eq("id", id);
    return error ? NextResponse.json({ error:error.message }, { status:400 }) : NextResponse.json({ ok:true });
  }
  return NextResponse.json({ error:"Acción no admitida." }, { status:400 });
}
