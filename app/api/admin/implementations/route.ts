import { NextResponse } from "next/server";
import { requirePlatformAdmin } from "@/lib/platform-admin";

const templates: Record<string, string[]> = {
  generic: ["dashboard", "conversations", "contacts", "pipeline", "tasks", "team", "automations", "reports", "assistant", "widget"],
  real_estate: ["dashboard", "conversations", "contacts", "pipeline", "tasks", "team", "automations", "reports", "assistant", "widget", "properties", "inquiries", "visits"],
  restaurant: ["dashboard", "conversations", "contacts", "tasks", "team", "automations", "reports", "assistant", "widget", "reservations", "orders"],
  services: ["dashboard", "conversations", "contacts", "pipeline", "tasks", "team", "automations", "reports", "assistant", "widget", "appointments", "quotes"],
  commerce: ["dashboard", "conversations", "contacts", "pipeline", "tasks", "team", "automations", "reports", "assistant", "widget", "products", "orders"]
};

type TemplateConfiguration = {
  modules?: string[];
  tenant_settings?: Record<string, unknown>;
  assistant?: { enabled?: boolean; instructions?: string; handoff_message?: string };
  knowledge?: { title:string; content:string; active:boolean }[];
  automations?: { name:string; trigger_event:string; conditions:unknown[]; actions:unknown[]; enabled:boolean }[];
  company_profile?: { timezone?:string; business_hours?:Record<string, unknown> };
};

function cleanSlug(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 45);
}

export async function GET() {
  const access = await requirePlatformAdmin();
  if (!access) return NextResponse.json({ error: "Acceso exclusivo para Superadministradores." }, { status: 403 });
  const { admin } = access;
  const [{ data: tenants, error }, { data: memberships }, { data: users }] = await Promise.all([
    admin.from("tenants").select("id,name,slug,plan,logo_url,settings,template_key,implementation_template_id,implementation_status,created_at").order("created_at", { ascending: false }),
    admin.from("memberships").select("tenant_id,user_id,role").eq("role", "owner"),
    admin.auth.admin.listUsers({ page: 1, perPage: 1000 })
  ]);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  const userMap = new Map(users?.users.map(user => [user.id, user]));
  const ownerMap = new Map((memberships || []).map(member => {
    const user = userMap.get(member.user_id);
    return [member.tenant_id, { id: member.user_id, email: user?.email || "", name: String(user?.user_metadata?.full_name || user?.email?.split("@")[0] || "Propietario") }];
  }));
  return NextResponse.json((tenants || []).map(tenant => ({ ...tenant, owner: ownerMap.get(tenant.id) || null })));
}

export async function POST(request: Request) {
  const access = await requirePlatformAdmin();
  if (!access) return NextResponse.json({ error: "Acceso exclusivo para Superadministradores." }, { status: 403 });
  const { admin, user } = access;
  const body = await request.json();
  const name = String(body.name || "").trim();
  const ownerName = String(body.ownerName || "").trim();
  const ownerEmail = String(body.ownerEmail || "").trim().toLowerCase();
  const requestedTemplateId = String(body.templateId || "");
  let templateQuery = admin.from("implementation_templates").select("id,key,business_type,configuration").eq("active", true);
  templateQuery = requestedTemplateId ? templateQuery.eq("id", requestedTemplateId) : templateQuery.eq("key", String(body.templateKey || "generic"));
  const { data: selectedTemplate, error: selectedTemplateError } = await templateQuery.maybeSingle();
  if (selectedTemplateError || !selectedTemplate) return NextResponse.json({ error:selectedTemplateError?.message || "La plantilla seleccionada ya no está disponible." }, { status:400 });
  const configuration = (selectedTemplate.configuration || {}) as TemplateConfiguration;
  const templateKey = selectedTemplate.business_type || "generic";
  const modules = Array.isArray(body.modules) ? body.modules.filter((item: unknown): item is string => typeof item === "string") : (configuration.modules || templates[templateKey] || templates.generic);
  if (name.length < 2 || ownerName.length < 3 || !/^\S+@\S+\.\S+$/.test(ownerEmail)) {
    return NextResponse.json({ error: "Completa correctamente empresa, propietario, correo y plantilla." }, { status: 400 });
  }
  const slug = `${cleanSlug(name) || "empresa"}-${crypto.randomUUID().slice(0, 6)}`;
  const { data: tenant, error: tenantError } = await admin.from("tenants").insert({
    name, slug, template_key: templateKey, implementation_template_id:selectedTemplate.id, implementation_status: "draft",
    settings: { ...(configuration.tenant_settings || {}), modules, onboarding: { created_by: user.id, created_at: new Date().toISOString(), template_id:selectedTemplate.id } }
  }).select("id,name,slug,template_key,implementation_status,settings,created_at").single();
  if (tenantError || !tenant) return NextResponse.json({ error: tenantError?.message || "No se pudo crear la empresa." }, { status: 400 });

  let owner = (await admin.auth.admin.listUsers({ page: 1, perPage: 1000 })).data.users.find(item => item.email?.toLowerCase() === ownerEmail);
  if (owner) {
    const { data: existingMemberships } = await admin.from("memberships").select("tenant_id").eq("user_id", owner.id);
    if ((existingMemberships || []).length) {
      await admin.from("tenants").delete().eq("id", tenant.id);
      return NextResponse.json({ error: "Ese correo ya pertenece a otra empresa. Usa un correo distinto para el propietario." }, { status: 409 });
    }
  }
  if (!owner) {
    const origin = new URL(request.url).origin;
    const invited = await admin.auth.admin.inviteUserByEmail(ownerEmail, { redirectTo: `${origin}/invite`, data: { full_name: ownerName, company_name: name, provisioned_by_gavrion: true } });
    if (invited.error || !invited.data.user) {
      await admin.from("tenants").delete().eq("id", tenant.id);
      const detail=invited.error?.message || "No se pudo invitar al propietario.";
      const limited=/rate|limit|too many|email rate/i.test(detail);
      return NextResponse.json({ error:limited?"Supabase alcanzó el límite temporal de correos de invitación. Espera antes de intentar nuevamente o configura SMTP propio.":`No se pudo enviar la invitación: ${detail}` }, { status: limited?429:400 });
    }
    owner = invited.data.user;
    // El trigger de registro crea un tenant temporal; se elimina al reasignar al usuario.
    const { data: generated } = await admin.from("memberships").select("tenant_id").eq("user_id", owner.id).neq("tenant_id", tenant.id);
    await admin.from("memberships").delete().eq("user_id", owner.id);
    const generatedIds = (generated || []).map(item => item.tenant_id);
    if (generatedIds.length) await admin.from("tenants").delete().in("id", generatedIds);
  }
  const { error: membershipError } = await admin.from("memberships").upsert({ tenant_id: tenant.id, user_id: owner.id, role: "owner" }, { onConflict: "tenant_id,user_id" });
  if (membershipError) return NextResponse.json({ error: membershipError.message }, { status: 400 });
  const assistantSettings = configuration.assistant || {};
  await Promise.all([
    admin.from("assistant_settings").upsert({ tenant_id:tenant.id, assistant_name:`Asistente de ${name}`, enabled:assistantSettings.enabled ?? true, instructions:assistantSettings.instructions || "Responde con amabilidad, brevedad y únicamente con información confirmada.", handoff_message:assistantSettings.handoff_message || "Voy a transferir esta conversación a una persona del equipo para ayudarte mejor." }, { onConflict:"tenant_id" }),
    admin.from("company_profiles").upsert({ tenant_id:tenant.id, timezone:configuration.company_profile?.timezone || "America/Tegucigalpa", business_hours:configuration.company_profile?.business_hours || {} }, { onConflict:"tenant_id" })
  ]);
  if (configuration.knowledge?.length) await admin.from("knowledge_documents").insert(configuration.knowledge.map(item => ({ tenant_id:tenant.id, title:item.title, content:item.content, active:item.active })));
  if (configuration.automations?.length) await admin.from("automation_flows").insert(configuration.automations.map(item => ({ tenant_id:tenant.id, name:item.name, trigger_event:item.trigger_event, conditions:item.conditions || [], actions:item.actions || [], enabled:item.enabled, created_by:user.id })));
  return NextResponse.json({ ...tenant, owner: { id: owner.id, email: ownerEmail, name: ownerName } }, { status: 201 });
}

export async function PATCH(request: Request) {
  const access = await requirePlatformAdmin();
  if (!access) return NextResponse.json({ error: "Acceso exclusivo para Superadministradores." }, { status: 403 });
  const body = await request.json();
  const tenantId = String(body.tenantId || "");
  const status = String(body.status || "");
  const allowed = ["draft","configuring","testing","ready","production","suspended","archived"];
  if (!tenantId || !allowed.includes(status)) return NextResponse.json({ error: "Estado inválido." }, { status: 400 });
  const { data, error } = await access.admin.from("tenants").update({ implementation_status: status }).eq("id", tenantId).select("id,implementation_status").single();
  return error ? NextResponse.json({ error: error.message }, { status: 400 }) : NextResponse.json(data);
}
