import { NextResponse } from "next/server";
import { requirePlatformPermission } from "@/lib/platform-access";
import { applyTemplateConfiguration, recordPlatformAudit, type TemplateConfiguration } from "@/lib/template-management";
import { configuredModulesForBusiness, normalizeBusinessType } from "@/lib/business-modules";
import { getSiteTemplate } from "@/lib/site-templates/catalog";
import { cleanSiteSlug, sanitizeSiteConfig, siteConfigForTemplate } from "@/lib/site-builder";

function cleanSlug(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 45);
}

function compatibleBusinessType(value: string) {
  return value === "gastronomy" ? "restaurant" : value;
}

async function safeTenantCount(admin: ReturnType<typeof import("@/lib/supabase/admin").createAdminSupabase>, table: string, tenantId: string, filter?: (query: any) => any) {
  let query = admin.from(table).select("id", { count: "exact", head: true }).eq("tenant_id", tenantId);
  if (filter) query = filter(query);
  const result = await query;
  return result.error ? null : Number(result.count || 0);
}

export async function GET(request: Request) {
  const access = await requirePlatformPermission("companies.read");
  if (!access) return NextResponse.json({ error: "Acceso exclusivo para Superadministradores." }, { status: 403 });
  const { admin } = access;
  const detailTenantId = new URL(request.url).searchParams.get("tenantId");
  if (detailTenantId) {
    if (access.tenantIds && !access.tenantIds.includes(detailTenantId)) return NextResponse.json({ error: "No tienes esta empresa asignada." }, { status: 403 });
    const [tenantResult, ownerResult, teamResult, profileResult, siteResult, customizationResult, auditResult, platformAuditResult, channelsResult, calendarsResult, assistantResult] = await Promise.all([
      admin.from("tenants").select("id,name,slug,plan,logo_url,widget_key,custom_domain,settings,template_key,implementation_template_id,implementation_status,status_reason,production_at,suspended_at,archived_at,created_at").eq("id", detailTenantId).maybeSingle(),
      admin.from("memberships").select("user_id,role,active").eq("tenant_id", detailTenantId).eq("role", "owner").maybeSingle(),
      admin.from("memberships").select("user_id,role,active,invitation_status").eq("tenant_id", detailTenantId).order("role"),
      admin.from("company_profiles").select("legal_name,tax_id,legal_address,phone,public_email,website,timezone,business_hours,updated_at").eq("tenant_id", detailTenantId).maybeSingle(),
      admin.from("site_projects").select("id,tenant_id,template_key,name,slug,status,published_url,custom_domain,domain_status,deployment_status,deployment_error,published_version,published_at,created_at,updated_at,configuration").eq("tenant_id", detailTenantId).is("archived_at", null).order("updated_at", { ascending: false }).limit(1).maybeSingle(),
      admin.from("implementation_customizations").select("id,template_id,template_version,status,review_note,reviewed_at,applied_at,updated_at").eq("tenant_id", detailTenantId).order("updated_at", { ascending: false }).limit(1).maybeSingle(),
      admin.from("audit_logs").select("id,actor_user_id,action,entity_type,entity_id,changes,created_at").eq("tenant_id", detailTenantId).order("created_at", { ascending: false }).limit(12),
      admin.from("platform_audit_logs").select("id,actor_user_id,action,entity_type,entity_id,changes,created_at").eq("target_tenant_id", detailTenantId).order("created_at", { ascending: false }).limit(12),
      admin.from("channel_connections").select("provider,status,last_error,last_error_at,last_ok_at,created_at").eq("tenant_id", detailTenantId),
      admin.from("calendar_connections").select("provider,status,last_error,updated_at").eq("tenant_id", detailTenantId),
      admin.from("assistant_settings").select("enabled,updated_at").eq("tenant_id", detailTenantId).maybeSingle()
    ]);
    if (tenantResult.error || !tenantResult.data) return NextResponse.json({ error: tenantResult.error?.message || "La empresa no existe." }, { status: 404 });
    const [{ data: users }, { data: template }] = await Promise.all([
      admin.auth.admin.listUsers({ page: 1, perPage: 1000 }),
      tenantResult.data.implementation_template_id ? admin.from("implementation_templates").select("id,name,business_type,current_version").eq("id", tenantResult.data.implementation_template_id).maybeSingle() : Promise.resolve({ data: null })
    ]);
    const userMap = new Map((users?.users || []).map(user => [user.id, user]));
    const settings = tenantResult.data.settings && typeof tenantResult.data.settings === "object" ? tenantResult.data.settings as Record<string, unknown> : {};
    const onboarding = settings.onboarding && typeof settings.onboarding === "object" ? settings.onboarding as Record<string, unknown> : {};
    const pendingOwner = onboarding.pending_owner && typeof onboarding.pending_owner === "object" ? onboarding.pending_owner as Record<string, unknown> : null;
    const ownerUser = ownerResult.data?.user_id ? userMap.get(ownerResult.data.user_id) : null;
    const owner = ownerUser ? { id: ownerUser.id, name: String(ownerUser.user_metadata?.full_name || ownerUser.email?.split("@")[0] || "Propietario"), email: ownerUser.email || "", invitationStatus: "active" } : pendingOwner ? { id: "pending", name: String(pendingOwner.name || "Propietario"), email: String(pendingOwner.email || ""), invitationStatus: "pending" } : null;
    const team = (teamResult.data || []).map(member => { const memberUser = userMap.get(member.user_id); return { id: member.user_id, name: String(memberUser?.user_metadata?.full_name || memberUser?.email?.split("@")[0] || "Usuario"), email: memberUser?.email || "", role: member.role, active: member.active !== false, invitationStatus: String(member.invitation_status || (member.active === false ? "revoked" : "accepted")) }; });
    const countEntries = await Promise.all([
      ["contacts", safeTenantCount(admin, "contacts", detailTenantId)],
      ["conversations", safeTenantCount(admin, "conversations", detailTenantId)],
      ["deals", safeTenantCount(admin, "deals", detailTenantId)],
      ["pendingTasks", safeTenantCount(admin, "tasks", detailTenantId, query => query.is("completed_at", null))],
      ["forms", safeTenantCount(admin, "site_form_submissions", detailTenantId)],
      ["reservations", safeTenantCount(admin, "reservations", detailTenantId)],
      ["orders", safeTenantCount(admin, "orders", detailTenantId)],
      ["appointments", safeTenantCount(admin, "appointments", detailTenantId)],
      ["properties", safeTenantCount(admin, "properties", detailTenantId)],
      ["propertyInquiries", safeTenantCount(admin, "property_inquiries", detailTenantId)],
      ["propertyVisits", safeTenantCount(admin, "property_visits", detailTenantId)],
      ["quotes", safeTenantCount(admin, "quotes", detailTenantId)],
      ["products", safeTenantCount(admin, "products", detailTenantId)]
    ]);
    const health = Object.fromEntries(countEntries);
    const site = siteResult.data || null;
    const channelRows = channelsResult.data || [];
    const calendarRows = calendarsResult.data || [];
    const connectionStatus = (row: { status?: string; last_error?: string|null } | undefined) => !row ? "pending" : row.status === "active" || row.status === "connected" ? "connected" : "error";
    const hasChatbox = Boolean(tenantResult.data.widget_key && site && (site.configuration as Record<string, unknown> | null)?.integrations && ((site.configuration as Record<string, unknown>).integrations as Record<string, unknown>).useRealChatbox !== false);
    const integrations = [
      { key: "whatsapp", label: "WhatsApp", status: connectionStatus(channelRows.find(row => row.provider === "whatsapp")), detail: channelRows.find(row => row.provider === "whatsapp")?.last_error || "" },
      { key: "facebook", label: "Facebook Messenger", status: connectionStatus(channelRows.find(row => row.provider === "facebook")), detail: channelRows.find(row => row.provider === "facebook")?.last_error || "" },
      { key: "google", label: "Google Calendar", status: connectionStatus(calendarRows.find(row => row.provider === "google")), detail: calendarRows.find(row => row.provider === "google")?.last_error || "" },
      { key: "assistant", label: "Asistente IA", status: assistantResult.data ? (assistantResult.data.enabled ? "connected" : "pending") : "pending", detail: "" },
      { key: "chatbox", label: "Chatbox", status: hasChatbox ? "connected" : "pending", detail: "" },
      { key: "site", label: "Sitio web", status: site?.status === "published" ? "connected" : "pending", detail: site?.status || "" },
      { key: "domain", label: "Dominio", status: site?.custom_domain && site.domain_status === "verified" ? "connected" : "pending", detail: site?.custom_domain || "" }
    ];
    const actorName = (actorId: string|null) => { const actor = actorId ? userMap.get(actorId) : null; return actor?.user_metadata?.full_name || actor?.email || "Sistema"; };
    const audit = [...(platformAuditResult.data || []).map(event => ({ id: `platform-${event.id}`, scope: "Plataforma", actor: actorName(event.actor_user_id), action: event.action, entityType: event.entity_type, createdAt: event.created_at, changeKeys: Object.keys(event.changes || {}) })), ...(auditResult.data || []).map(event => ({ id: `tenant-${event.id}`, scope: "Operación", actor: actorName(event.actor_user_id), action: event.action, entityType: event.entity_type, createdAt: event.created_at, changeKeys: Object.keys(event.changes || {}) }))].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, 16);
    return NextResponse.json({ company: tenantResult.data, owner, team, profile: profileResult.data || null, template: template || null, site, customization: customizationResult.data || null, health, integrations, audit, lastActivityAt: audit[0]?.createdAt || tenantResult.data.created_at });
  }
  let tenantQuery=admin.from("tenants").select("id,name,slug,plan,logo_url,settings,template_key,implementation_template_id,implementation_status,status_reason,production_at,suspended_at,archived_at,created_at").order("created_at", { ascending: false });if(access.tenantIds)tenantQuery=tenantQuery.in("id",access.tenantIds.length?access.tenantIds:["00000000-0000-0000-0000-000000000000"]);
  const [{ data: tenants, error }, { data: memberships }, { data: users }] = await Promise.all([
    tenantQuery,
    admin.from("memberships").select("tenant_id,user_id,role").eq("role", "owner"),
    admin.auth.admin.listUsers({ page: 1, perPage: 1000 })
  ]);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  const userMap = new Map(users?.users.map(user => [user.id, user]));
  const ownerMap = new Map((memberships || []).map(member => {
    const user = userMap.get(member.user_id);
    return [member.tenant_id, { id: member.user_id, email: user?.email || "", name: String(user?.user_metadata?.full_name || user?.email?.split("@")[0] || "Propietario") }];
  }));
  return NextResponse.json((tenants || []).map(tenant => {
    const existing = ownerMap.get(tenant.id);
    if (existing) return { ...tenant, owner: existing };
    const settings = tenant.settings && typeof tenant.settings === "object" ? tenant.settings as Record<string, unknown> : {};
    const onboarding = settings.onboarding && typeof settings.onboarding === "object" ? settings.onboarding as Record<string, unknown> : {};
    const pending = onboarding.pending_owner && typeof onboarding.pending_owner === "object" ? onboarding.pending_owner as Record<string, unknown> : null;
    return { ...tenant, owner: pending ? { id: "pending", email: String(pending.email || ""), name: String(pending.name || "Propietario"), invitationStatus: "pending" } : null };
  }));
}

export async function POST(request: Request) {
  const access = await requirePlatformPermission("companies.create");
  if (!access) return NextResponse.json({ error: "Acceso exclusivo para Superadministradores." }, { status: 403 });
  const { admin, user } = access;
  const body = await request.json();
  const name = String(body.name || "").trim();
  const ownerName = String(body.ownerName || "").trim();
  const ownerEmail = String(body.ownerEmail || "").trim().toLowerCase();
  const requestedTemplateId = String(body.templateId || "");
  const requestedSiteTemplateKey = String(body.siteTemplateKey || "");
  let templateQuery = admin.from("implementation_templates").select("id,key,business_type,configuration").eq("active", true);
  templateQuery = requestedTemplateId ? templateQuery.eq("id", requestedTemplateId) : templateQuery.eq("key", String(body.templateKey || "generic"));
  const { data: selectedTemplate, error: selectedTemplateError } = await templateQuery.maybeSingle();
  if (selectedTemplateError || !selectedTemplate) return NextResponse.json({ error:selectedTemplateError?.message || "La plantilla seleccionada ya no está disponible." }, { status:400 });
  const configuration = (selectedTemplate.configuration || {}) as TemplateConfiguration;
  const templateKey = normalizeBusinessType(selectedTemplate.business_type);
  const siteTemplate = getSiteTemplate(requestedSiteTemplateKey);
  if (!siteTemplate) return NextResponse.json({ error: "Selecciona una plantilla web válida antes de crear la empresa." }, { status: 400 });
  if (compatibleBusinessType(selectedTemplate.business_type) !== "generic" && compatibleBusinessType(siteTemplate.businessType) !== compatibleBusinessType(selectedTemplate.business_type)) {
    return NextResponse.json({ error: "La plantilla web no corresponde al rubro seleccionado para el CRM." }, { status: 409 });
  }
  const modules = configuredModulesForBusiness(Array.isArray(body.modules) ? body.modules : configuration.modules, templateKey);
  if (name.length < 2 || ownerName.length < 3 || !/^\S+@\S+\.\S+$/.test(ownerEmail)) {
    return NextResponse.json({ error: "Completa correctamente empresa, propietario, correo y plantilla." }, { status: 400 });
  }
  const slug = `${cleanSlug(name) || "empresa"}-${crypto.randomUUID().slice(0, 6)}`;
  const { data: tenant, error: tenantError } = await admin.from("tenants").insert({
    name, slug, template_key: templateKey, implementation_template_id:selectedTemplate.id, implementation_status: "draft",
    settings: { ...(configuration.tenant_settings || {}), modules, onboarding: { created_by: user.id, created_at: new Date().toISOString(), template_id:selectedTemplate.id, site_template_key:requestedSiteTemplateKey || null, pending_owner: { name: ownerName, email: ownerEmail, status: "pending" } } }
  }).select("id,name,slug,widget_key,template_key,implementation_status,settings,created_at").single();
  if (tenantError || !tenant) return NextResponse.json({ error: tenantError?.message || "No se pudo crear la empresa." }, { status: 400 });
  if(access.role!=="superadmin")await admin.from("platform_staff_tenants").upsert({user_id:user.id,tenant_id:tenant.id});

  try { await applyTemplateConfiguration(admin, { ...configuration, modules } as TemplateConfiguration, tenant.id, user.id, false); }
  catch (error) {
    await admin.from("tenants").delete().eq("id", tenant.id);
    return NextResponse.json({ error:error instanceof Error ? error.message : "No se pudo aplicar la configuración del CRM." }, { status:400 });
  }

  const baseSiteConfiguration = siteConfigForTemplate(requestedSiteTemplateKey, tenant.name);
  const siteConfiguration = sanitizeSiteConfig({
    ...baseSiteConfiguration,
    integrations: { ...baseSiteConfiguration.integrations, tenantKey:String(tenant.widget_key || ""), useRealChatbox:Boolean(tenant.widget_key) }
  });
  const { data: site, error: siteError } = await admin.from("site_projects").insert({
    tenant_id:tenant.id,
    template_key:requestedSiteTemplateKey,
    name:`Sitio de ${tenant.name}`,
    slug:cleanSiteSlug(tenant.slug || tenant.name),
    configuration:siteConfiguration,
    created_by:user.id
  }).select("id,tenant_id,template_key,name,slug,status,updated_at,created_at").single();
  if (siteError || !site) {
    await admin.from("tenants").delete().eq("id", tenant.id);
    return NextResponse.json({ error:siteError?.message || "No se pudo preparar el sitio web." }, { status:400 });
  }

  const audit = await recordPlatformAudit(admin, { actorUserId:user.id, targetTenantId:tenant.id, action:"create", entityType:"implementation", entityId:tenant.id, changes:{ templateId:selectedTemplate.id, siteTemplateKey:requestedSiteTemplateKey, siteProjectId:site.id, modules } });
  if (audit) return NextResponse.json({ error:audit.message }, { status:500 });
  return NextResponse.json({ ...tenant, owner: { id: "pending", email: ownerEmail, name: ownerName, invitationStatus: "pending" }, site }, { status: 201 });
}

export async function PATCH(request: Request) {
  const access = await requirePlatformPermission("companies.create");
  if (!access) return NextResponse.json({ error: "Acceso exclusivo para Superadministradores." }, { status: 403 });
  const body = await request.json();
  const tenantId = String(body.tenantId || "");
  if (body.action === "update_details") {
    if (!tenantId) return NextResponse.json({ error: "Empresa inválida." }, { status: 400 });
    const name = String(body.name || "").trim();
    const slug = cleanSlug(String(body.slug || name));
    const plan = String(body.plan || "starter").trim().slice(0, 40) || "starter";
    const ownerName = String(body.ownerName || "").trim();
    const ownerEmail = String(body.ownerEmail || "").trim().toLowerCase();
    if (name.length < 2) return NextResponse.json({ error: "El nombre de la empresa debe tener al menos 2 caracteres." }, { status: 400 });
    if (slug.length < 2) return NextResponse.json({ error: "El identificador de la empresa no es válido." }, { status: 400 });
    if (ownerEmail && !/^\S+@\S+\.\S+$/.test(ownerEmail)) return NextResponse.json({ error: "El correo del propietario no es válido." }, { status: 400 });
    const { data: current, error: currentError } = await access.admin.from("tenants").select("id,name,slug,plan,settings").eq("id", tenantId).maybeSingle();
    if (currentError || !current) return NextResponse.json({ error: currentError?.message || "La empresa no existe." }, { status: 404 });
    const { data: duplicate } = await access.admin.from("tenants").select("id").eq("slug", slug).neq("id", tenantId).maybeSingle();
    if (duplicate) return NextResponse.json({ error: "Ese identificador ya está siendo utilizado por otra empresa." }, { status: 409 });
    const settings = current.settings && typeof current.settings === "object" ? { ...(current.settings as Record<string, unknown>) } : {};
    const onboarding = settings.onboarding && typeof settings.onboarding === "object" ? { ...(settings.onboarding as Record<string, unknown>) } : {};
    const pendingOwner = onboarding.pending_owner && typeof onboarding.pending_owner === "object" ? { ...(onboarding.pending_owner as Record<string, unknown>) } : null;
    if (pendingOwner && (ownerName || ownerEmail)) {
      onboarding.pending_owner = { ...pendingOwner, ...(ownerName ? { name: ownerName } : {}), ...(ownerEmail ? { email: ownerEmail } : {}) };
      settings.onboarding = onboarding;
    }
    const { data, error } = await access.admin.from("tenants").update({ name, slug, plan, settings }).eq("id", tenantId).select("id,name,slug,plan,logo_url,settings,template_key,implementation_template_id,implementation_status,status_reason,production_at,suspended_at,archived_at,created_at").single();
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    const { data: ownerMembership } = await access.admin.from("memberships").select("user_id").eq("tenant_id", tenantId).eq("role", "owner").maybeSingle();
    if (ownerMembership?.user_id && ownerName) {
      const existingUser = await access.admin.auth.admin.getUserById(ownerMembership.user_id);
      const metadata = existingUser.data.user?.user_metadata && typeof existingUser.data.user.user_metadata === "object" ? existingUser.data.user.user_metadata : {};
      await access.admin.auth.admin.updateUserById(ownerMembership.user_id, { user_metadata: { ...metadata, full_name: ownerName } });
    }
    const audit = await recordPlatformAudit(access.admin, { actorUserId:access.user.id, targetTenantId:tenantId, action:"update", entityType:"implementation", entityId:tenantId, changes:{ name, slug, plan, ownerUpdated:Boolean(ownerName || ownerEmail) } });
    if (audit) return NextResponse.json({ error:audit.message }, { status:500 });
    const { data: users } = await access.admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    const { data: owner } = await access.admin.from("memberships").select("user_id").eq("tenant_id", tenantId).eq("role", "owner").maybeSingle();
    const ownerUser = owner?.user_id ? users?.users.find(user => user.id === owner.user_id) : null;
    const fallbackPending = onboarding.pending_owner && typeof onboarding.pending_owner === "object" ? onboarding.pending_owner as Record<string, unknown> : null;
    return NextResponse.json({ ...data, owner: ownerUser ? { id: ownerUser.id, email: ownerUser.email || "", name: String(ownerUser.user_metadata?.full_name || ownerUser.email?.split("@")[0] || "Propietario") } : fallbackPending ? { id:"pending", email:String(fallbackPending.email || ""), name:String(fallbackPending.name || "Propietario"), invitationStatus:"pending" } : null });
  }
  const status = String(body.status || "");
  const reason = String(body.reason || "").trim().slice(0, 500);
  const allowed = ["draft","configuring","testing","ready","production","suspended","archived"];
  if (!tenantId || !allowed.includes(status)) return NextResponse.json({ error: "Estado inválido." }, { status: 400 });
  if (["suspended","archived"].includes(status) && reason.length < 3) return NextResponse.json({ error:"Debes indicar el motivo de este estado." }, { status:400 });
  const now = new Date().toISOString();
  const lifecycle: Record<string, unknown> = { implementation_status:status, status_reason:reason || null };
  if (status === "production") lifecycle.production_at = now;
  if (status === "suspended") lifecycle.suspended_at = now;
  if (status === "archived") lifecycle.archived_at = now;
  const { data, error } = await access.admin.from("tenants").update(lifecycle).eq("id", tenantId).select("id,implementation_status,status_reason,production_at,suspended_at,archived_at").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  const audit = await recordPlatformAudit(access.admin, { actorUserId:access.user.id, targetTenantId:tenantId, action:"update", entityType:"implementation", entityId:tenantId, changes:{ status, reason:reason || null } });
  return audit ? NextResponse.json({ error:audit.message }, { status:500 }) : NextResponse.json(data);
}
