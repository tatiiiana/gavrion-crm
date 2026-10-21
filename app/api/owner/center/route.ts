import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createServerSupabase } from "@/lib/supabase/server";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { notificationTypeLabels, type TenantNotificationType } from "@/lib/tenant-notifications";

const UNANSWERED_MINUTES = 15;
const notificationTypes = Object.keys(notificationTypeLabels) as TenantNotificationType[];

async function context() {
  const supabase = await createServerSupabase();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return null;
  const { data: membership } = await supabase.from("memberships").select("tenant_id,role").eq("user_id", auth.user.id).eq("active", true).limit(1).maybeSingle();
  if (!membership || !["owner", "admin"].includes(membership.role)) return null;
  return { supabase, admin: createAdminSupabase(), user: auth.user, tenantId: membership.tenant_id as string, role: membership.role as "owner" | "admin" };
}
type Ctx = NonNullable<Awaited<ReturnType<typeof context>>>;

const forbidden = () => NextResponse.json({ error: "Solo administradores de la empresa." }, { status: 403 });

// ---------- Utilidades ----------

function csv(rows: Array<Record<string, unknown>>, columns: Array<[string, string]>) {
  const escape = (value: unknown) => {
    const text = value === null || value === undefined ? "" : typeof value === "object" ? JSON.stringify(value) : String(value);
    return /[",;\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const header = columns.map(([, label]) => escape(label)).join(",");
  const body = rows.map(row => columns.map(([key]) => escape(row[key])).join(",")).join("\r\n");
  // BOM para que Excel abra correctamente tildes y eñes.
  return `﻿${header}\r\n${body}`;
}

function fileResponse(content: string, name: string, format: "csv" | "json") {
  const date = new Date().toISOString().slice(0, 10);
  return new Response(content, {
    headers: {
      "Content-Type": format === "csv" ? "text/csv; charset=utf-8" : "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="gavrion-${name}-${date}.${format}"`,
      "Cache-Control": "no-store"
    }
  });
}

function activityQuery(ctx: Ctx, params: URLSearchParams, limit: number, offset = 0) {
  let query = ctx.supabase.from("audit_logs")
    .select("id,action,entity_type,entity_id,actor_user_id,changes,created_at", { count: "exact" })
    .eq("tenant_id", ctx.tenantId);
  const from = params.get("from"); const to = params.get("to");
  const action = params.get("action"); const entity = params.get("entity");
  if (from && /^\d{4}-\d{2}-\d{2}$/.test(from)) query = query.gte("created_at", `${from}T00:00:00`);
  if (to && /^\d{4}-\d{2}-\d{2}$/.test(to)) query = query.lte("created_at", `${to}T23:59:59.999`);
  if (action && ["insert", "update", "delete"].includes(action)) query = query.eq("action", action);
  if (entity && /^[a-z_]{2,60}$/.test(entity)) query = query.eq("entity_type", entity);
  if (params.get("mine") === "1") query = query.eq("actor_user_id", ctx.user.id);
  return query.order("created_at", { ascending: false }).range(offset, offset + limit - 1);
}

/** Resume un registro de auditoría en datos legibles para el dueño. */
function describeActivity(row: { entity_type: string; changes: unknown }) {
  const changes = (row.changes || {}) as { after?: Record<string, unknown>; before?: Record<string, unknown> };
  const after = changes.after || {}; const before = changes.before || {};
  const name = after.full_name || after.title || after.name || after.customer_name || after.reference || before.full_name || before.title || before.name || "";
  const changed = Object.keys(before).length
    ? Object.keys(after).filter(key => !["updated_at", "created_at"].includes(key) && JSON.stringify(after[key]) !== JSON.stringify(before[key]))
    : [];
  return { name: String(name || ""), changedFields: changed.slice(0, 6) };
}

async function runUnansweredCheck(ctx: Ctx) {
  const { error } = await ctx.admin.rpc("queue_unanswered_notifications", { p_tenant: ctx.tenantId, p_minutes: UNANSWERED_MINUTES });
  if (error) console.error("[owner-center] No se pudo revisar conversaciones sin responder", error.message);
}

type HealthStatus = "connected" | "pending" | "error" | "active" | "inactive" | "installed" | "published" | "unpublished" | "verified";
type HealthItem = { key: string; label: string; status: HealthStatus; detail: string; settingsTab?: string };
type ConnectionRow = { provider: string; status: string; external_account_id: string | null; settings: { display_name?: string } | null; last_error: string | null; last_error_at: string | null; last_ok_at: string | null };

function channelHealth(rows: ConnectionRow[], provider: string, label: string): HealthItem {
  const list = rows.filter(row => row.provider === provider);
  if (!list.length) return { key: provider, label, status: "pending", detail: "Aún no está conectado.", settingsTab: "canales" };
  const active = list.filter(row => row.status === "active");
  const recentError = active.find(row => row.last_error_at && (!row.last_ok_at || new Date(row.last_error_at) > new Date(row.last_ok_at)) && Date.now() - new Date(row.last_error_at).getTime() < 7 * 86400000);
  if (recentError) return { key: provider, label, status: "error", detail: recentError.last_error || "La última operación con Meta falló.", settingsTab: "canales" };
  if (active.length) {
    const name = active[0].settings?.display_name || active[0].external_account_id || "";
    return { key: provider, label, status: "connected", detail: name ? `Cuenta: ${name}` : "Conectado y recibiendo mensajes.", settingsTab: "canales" };
  }
  if (list.some(row => ["error", "revoked", "expired", "disconnected"].includes(row.status))) return { key: provider, label, status: "error", detail: "La conexión fue desactivada o el permiso expiró. Vuelve a conectarla.", settingsTab: "canales" };
  return { key: provider, label, status: "pending", detail: "Conexión en proceso de activación.", settingsTab: "canales" };
}

async function buildHealth(ctx: Ctx): Promise<{ items: HealthItem[]; site: Record<string, string | null> | null }> {
  const [tenantResult, connectionsResult, assistantResult, knowledgeResult, siteResult, webActivity, formsProcessed, formsFailed] = await Promise.all([
    ctx.admin.from("tenants").select("widget_key,custom_domain").eq("id", ctx.tenantId).maybeSingle(),
    ctx.admin.from("channel_connections").select("provider,status,external_account_id,settings,last_error,last_error_at,last_ok_at").eq("tenant_id", ctx.tenantId).in("provider", ["whatsapp", "facebook"]),
    ctx.admin.from("assistant_settings").select("enabled").eq("tenant_id", ctx.tenantId).maybeSingle(),
    ctx.admin.from("knowledge_documents").select("id", { count: "exact", head: true }).eq("tenant_id", ctx.tenantId).eq("active", true),
    ctx.admin.from("site_projects").select("status,published_url,custom_domain,domain_status,deployment_status,updated_at").eq("tenant_id", ctx.tenantId).is("archived_at", null).maybeSingle(),
    ctx.admin.from("conversations").select("id,last_message_at").eq("tenant_id", ctx.tenantId).eq("channel", "web").order("last_message_at", { ascending: false }).limit(1),
    ctx.admin.from("site_form_submissions").select("id", { count: "exact", head: true }).eq("tenant_id", ctx.tenantId).eq("status", "processed").gte("created_at", new Date(Date.now() - 30 * 86400000).toISOString()),
    ctx.admin.from("site_form_submissions").select("id", { count: "exact", head: true }).eq("tenant_id", ctx.tenantId).eq("status", "failed").gte("created_at", new Date(Date.now() - 7 * 86400000).toISOString())
  ]);
  const rows = (connectionsResult.data || []) as ConnectionRow[];
  const site = siteResult.data as Record<string, string | null> | null;
  const assistantEnabled = Boolean(assistantResult.data?.enabled);
  const hasKnowledge = (knowledgeResult.count || 0) > 0;
  const widgetKey = tenantResult.data?.widget_key;
  const lastWeb = webActivity.data?.[0]?.last_message_at as string | undefined;
  const domain = site?.custom_domain || tenantResult.data?.custom_domain || "";
  const published = site?.status === "published" || (site?.deployment_status === "ready" && Boolean(site?.published_url));

  const items: HealthItem[] = [
    channelHealth(rows, "whatsapp", "WhatsApp"),
    channelHealth(rows, "facebook", "Facebook Messenger"),
    {
      key: "assistant", label: "Asistente IA",
      status: assistantEnabled ? "active" : "inactive",
      detail: assistantEnabled ? (hasKnowledge ? "Respondiendo automáticamente." : "Activo, pero sin información de la empresa cargada.") : "Las respuestas automáticas están apagadas.",
      settingsTab: "asistente"
    },
    {
      key: "chatbox", label: "Chatbox",
      status: lastWeb ? "installed" : "pending",
      detail: lastWeb ? `Última conversación: ${new Date(lastWeb).toLocaleDateString("es-HN")}` : widgetKey ? "Código generado; aún no se reciben mensajes desde la web." : "Guarda la configuración de la empresa para generar el código.",
      settingsTab: "chatbox"
    },
    {
      key: "forms", label: "Formularios del sitio",
      status: (formsFailed.count || 0) > 0 ? "error" : (formsProcessed.count || 0) > 0 ? "active" : "pending",
      detail: (formsFailed.count || 0) > 0 ? `${formsFailed.count} solicitud(es) sin procesar esta semana; revisa las notificaciones.` : (formsProcessed.count || 0) > 0 ? `${formsProcessed.count} solicitud(es) recibidas en 30 días.` : "Aún no se reciben solicitudes desde el sitio."
    },
    {
      key: "site", label: "Sitio web",
      status: published ? "published" : site?.deployment_status === "error" ? "error" : "unpublished",
      detail: published ? (site?.published_url || "Publicado") : site?.deployment_status === "error" ? "La última publicación falló." : site ? "En preparación por el implementador." : "Todavía no hay un sitio asignado."
    },
    {
      key: "domain", label: "Dominio",
      status: site?.domain_status === "verified" ? "verified" : site?.domain_status === "error" ? "error" : "pending",
      detail: !domain ? "Sin dominio propio configurado." : site?.domain_status === "verified" ? domain : site?.domain_status === "error" ? `${domain}: revisa los registros DNS.` : `${domain}: verificación pendiente.`
    }
  ];
  return { items, site };
}

// ---------- GET ----------

export async function GET(request: Request) {
  const ctx = await context();
  if (!ctx) return forbidden();
  const params = new URL(request.url).searchParams;

  // Exportaciones (CSV por defecto, JSON opcional).
  const exportType = params.get("export");
  if (exportType) {
    const format = params.get("format") === "json" ? "json" : "csv";
    const asJson = (rows: unknown, extra: Record<string, unknown> = {}) => JSON.stringify({ exportedAt: new Date().toISOString(), ...extra, rows }, null, 2);
    if (exportType === "contacts") {
      const { data, error } = await ctx.supabase.from("contacts").select("id,full_name,email,phone,company,status,source,created_at").eq("tenant_id", ctx.tenantId).order("created_at", { ascending: false }).limit(10000);
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
      const rows = data || [];
      return fileResponse(format === "json" ? asJson(rows) : csv(rows, [["full_name", "Nombre"], ["email", "Correo"], ["phone", "Teléfono"], ["company", "Empresa"], ["status", "Estado"], ["source", "Origen"], ["created_at", "Creado"], ["id", "ID"]]), "contactos", format);
    }
    if (exportType === "opportunities") {
      const [deals, contacts] = await Promise.all([
        ctx.supabase.from("deals").select("id,title,stage,value,currency,contact_id,expected_close_date,created_at").eq("tenant_id", ctx.tenantId).order("created_at", { ascending: false }).limit(10000),
        ctx.supabase.from("contacts").select("id,full_name").eq("tenant_id", ctx.tenantId).limit(10000)
      ]);
      if (deals.error) return NextResponse.json({ error: deals.error.message }, { status: 400 });
      const names = new Map((contacts.data || []).map(item => [item.id, item.full_name]));
      const rows = (deals.data || []).map(item => ({ ...item, contact_name: names.get(item.contact_id) || "" }));
      return fileResponse(format === "json" ? asJson(rows) : csv(rows, [["title", "Oportunidad"], ["contact_name", "Contacto"], ["stage", "Etapa"], ["value", "Valor"], ["currency", "Moneda"], ["expected_close_date", "Cierre estimado"], ["created_at", "Creada"], ["id", "ID"]]), "oportunidades", format);
    }
    if (exportType === "activity") {
      const { data, error } = await activityQuery(ctx, params, 10000);
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
      const rows = (data || []).map(row => { const info = describeActivity(row); return { ...row, name: info.name, fields: info.changedFields.join(" | ") }; });
      return fileResponse(format === "json" ? asJson(rows) : csv(rows, [["created_at", "Fecha"], ["action", "Acción"], ["entity_type", "Módulo"], ["name", "Registro"], ["fields", "Campos modificados"], ["actor_user_id", "Usuario"], ["entity_id", "ID"]]), "actividad", format);
    }
    if (exportType === "report") {
      const days = [7, 30, 90, 365].includes(Number(params.get("days"))) ? Number(params.get("days")) : 30;
      const from = new Date(Date.now() - days * 86400000).toISOString();
      const [conversations, contacts, deals] = await Promise.all([
        ctx.supabase.from("conversations").select("channel").eq("tenant_id", ctx.tenantId).gte("created_at", from),
        ctx.supabase.from("contacts").select("id", { count: "exact", head: true }).eq("tenant_id", ctx.tenantId).gte("created_at", from),
        ctx.supabase.from("deals").select("stage,value").eq("tenant_id", ctx.tenantId).gte("created_at", from)
      ]);
      const error = conversations.error || contacts.error || deals.error;
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
      const rows: Array<Record<string, unknown>> = [
        { section: "Resumen", metric: "Periodo (días)", value: days },
        { section: "Resumen", metric: "Conversaciones nuevas", value: (conversations.data || []).length },
        { section: "Resumen", metric: "Contactos nuevos", value: contacts.count || 0 },
        { section: "Resumen", metric: "Oportunidades creadas", value: (deals.data || []).length }
      ];
      const byChannel = (conversations.data || []).reduce<Record<string, number>>((acc, item) => { acc[item.channel] = (acc[item.channel] || 0) + 1; return acc; }, {});
      for (const [channel, total] of Object.entries(byChannel)) rows.push({ section: "Conversaciones por canal", metric: channel, value: total });
      const byStage = (deals.data || []).reduce<Record<string, { count: number; value: number }>>((acc, item) => { const entry = acc[item.stage] || { count: 0, value: 0 }; entry.count += 1; entry.value += Number(item.value || 0); acc[item.stage] = entry; return acc; }, {});
      for (const [stage, info] of Object.entries(byStage)) rows.push({ section: "Oportunidades por etapa", metric: stage, value: info.count, amount: info.value });
      return fileResponse(format === "json" ? asJson(rows, { days }) : csv(rows, [["section", "Sección"], ["metric", "Métrica"], ["value", "Cantidad"], ["amount", "Monto (HNL)"]]), "reporte", format);
    }
    return NextResponse.json({ error: "Exportación no admitida." }, { status: 400 });
  }

  // Actividad con filtros y paginación.
  if (params.get("activity") === "1") {
    const page = Math.max(0, Math.floor(Number(params.get("page") || 0)) || 0);
    const { data, error, count } = await activityQuery(ctx, params, 25, page * 25);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({
      total: count || 0, page,
      rows: (data || []).map(row => ({ id: row.id, action: row.action, entity_type: row.entity_type, created_at: row.created_at, by_me: row.actor_user_id === ctx.user.id, by_system: !row.actor_user_id, ...describeActivity(row) }))
    });
  }

  // Resumen ligero para la campana de notificaciones.
  if (params.get("summary") === "1") {
    await runUnansweredCheck(ctx);
    const [unread, latest, preferences] = await Promise.all([
      ctx.admin.from("tenant_notifications").select("id", { count: "exact", head: true }).eq("tenant_id", ctx.tenantId).eq("user_id", ctx.user.id).is("read_at", null),
      ctx.admin.from("tenant_notifications").select("id,type,title,body,entity_type,entity_id,read_at,created_at").eq("tenant_id", ctx.tenantId).eq("user_id", ctx.user.id).order("created_at", { ascending: false }).limit(6),
      ctx.admin.from("notification_preferences").select("browser").eq("user_id", ctx.user.id).maybeSingle()
    ]);
    return NextResponse.json({ unread: unread.count || 0, notifications: latest.data || [], browser: preferences.data?.browser !== false });
  }

  // Vista completa del centro de control.
  await runUnansweredCheck(ctx);
  const [health, notificationsResult, preferencesResult, automationErrorsResult, requestsResult, accessHistoryResult] = await Promise.all([
    buildHealth(ctx),
    ctx.admin.from("tenant_notifications").select("id,type,title,body,entity_type,entity_id,read_at,created_at").eq("tenant_id", ctx.tenantId).eq("user_id", ctx.user.id).order("created_at", { ascending: false }).limit(100),
    ctx.admin.from("notification_preferences").select("in_app,browser,email_digest,muted_types").eq("user_id", ctx.user.id).maybeSingle(),
    ctx.admin.from("automation_runs").select("id,flow_id,error_message,created_at").eq("tenant_id", ctx.tenantId).eq("status", "error").gte("created_at", new Date(Date.now() - 14 * 86400000).toISOString()).order("created_at", { ascending: false }).limit(10),
    ctx.admin.from("tenant_data_requests").select("id,request_type,reason,status,created_at,resolved_at").eq("tenant_id", ctx.tenantId).order("created_at", { ascending: false }).limit(10),
    ctx.admin.from("account_access_logs").select("id,event_type,ip_address,user_agent,created_at").eq("tenant_id", ctx.tenantId).eq("user_id", ctx.user.id).neq("event_type", "heartbeat").order("created_at", { ascending: false }).limit(20)
  ]);
  return NextResponse.json({
    role: ctx.role,
    account: { email: ctx.user.email || "", fullName: String(ctx.user.user_metadata?.full_name || ""), phone: String(ctx.user.user_metadata?.phone || ""), lastSignInAt: ctx.user.last_sign_in_at || null },
    health: health.items,
    site: health.site,
    notifications: notificationsResult.data || [],
    notificationTypes: notificationTypes.map(type => ({ type, label: notificationTypeLabels[type] })),
    preferences: { in_app: true, browser: true, email_digest: false, muted_types: [], ...(preferencesResult.data || {}) },
    automationErrors: automationErrorsResult.data || [],
    dataRequests: requestsResult.data || [],
    accessHistory: accessHistoryResult.data || []
  });
}

// ---------- PATCH ----------

export async function PATCH(request: Request) {
  const ctx = await context();
  if (!ctx) return forbidden();
  const body = await request.json().catch(() => ({}));

  if (body.action === "read") {
    let query = ctx.admin.from("tenant_notifications").update({ read_at: new Date().toISOString() }).eq("tenant_id", ctx.tenantId).eq("user_id", ctx.user.id).is("read_at", null);
    if (body.id) query = query.eq("id", String(body.id));
    const { error } = await query;
    return error ? NextResponse.json({ error: error.message }, { status: 400 }) : NextResponse.json({ ok: true });
  }

  if (body.action === "preferences") {
    const muted: string[] = Array.isArray(body.mutedTypes) ? body.mutedTypes.map(String).filter((type: string) => notificationTypes.includes(type as TenantNotificationType)) : [];
    const { error } = await ctx.admin.from("notification_preferences").upsert({
      user_id: ctx.user.id, in_app: body.inApp !== false, browser: body.browser !== false, email_digest: body.emailDigest === true,
      muted_types: Array.from(new Set(muted)), updated_at: new Date().toISOString()
    }, { onConflict: "user_id" });
    return error ? NextResponse.json({ error: error.message }, { status: 400 }) : NextResponse.json({ ok: true });
  }

  if (body.action === "account") {
    const fullName = String(body.fullName || "").trim().slice(0, 120);
    const phone = String(body.phone || "").trim().slice(0, 30);
    const email = String(body.email || ctx.user.email || "").trim().toLowerCase();
    const emailChanged = email !== String(ctx.user.email || "").trim().toLowerCase();
    const password = String(body.password || "");
    const currentPassword = String(body.currentPassword || "");
    if (!fullName) return NextResponse.json({ error: "Escribe tu nombre." }, { status: 400 });
    if (!/^\S+@\S+\.\S+$/.test(email)) return NextResponse.json({ error: "El correo no es válido." }, { status: 400 });
    if (phone && !/^[+\d\s()-]{7,30}$/.test(phone)) return NextResponse.json({ error: "El teléfono no es válido." }, { status: 400 });
    if (password || emailChanged) {
      if (password && (password.length < 8 || !/[A-Za-z]/.test(password) || !/\d/.test(password))) return NextResponse.json({ error: "La nueva contraseña debe tener al menos 8 caracteres, con letras y números." }, { status: 400 });
      if (!currentPassword) return NextResponse.json({ error: "Escribe tu contraseña actual para cambiarla." }, { status: 400 });
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL; const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
      if (!url || !anon || !ctx.user.email) return NextResponse.json({ error: "No se pudo verificar la contraseña actual." }, { status: 503 });
      // Cliente aislado: verifica la contraseña sin tocar las cookies de la sesión actual.
      const verifier = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
      const { error: verifyError } = await verifier.auth.signInWithPassword({ email: ctx.user.email, password: currentPassword });
      if (verifyError) return NextResponse.json({ error: "La contraseña actual no es correcta." }, { status: 400 });
      await verifier.auth.signOut({ scope: "local" }).catch(() => undefined);
    }
    const { error } = await ctx.supabase.auth.updateUser({ ...(password ? { password } : {}), ...(emailChanged ? { email } : {}), data: { full_name: fullName, phone } });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    await ctx.admin.from("audit_logs").insert({ tenant_id: ctx.tenantId, actor_user_id: ctx.user.id, action: "update", entity_type: "account", entity_id: ctx.user.id, changes: { after: { full_name: fullName, phone, email_changed: emailChanged, password_changed: Boolean(password) } } });
    if (password || emailChanged) {
      const events = [];
      if (password) events.push({ tenant_id: ctx.tenantId, user_id: ctx.user.id, event_type: "password_change" });
      if (emailChanged) events.push({ tenant_id: ctx.tenantId, user_id: ctx.user.id, event_type: "email_change" });
      await ctx.admin.from("account_access_logs").insert(events);
    }
    return NextResponse.json({ ok: true, passwordChanged: Boolean(password), emailChangeRequested: emailChanged });
  }

  if (body.action === "session_revoke") {
    await ctx.admin.from("account_access_logs").insert({ tenant_id: ctx.tenantId, user_id: ctx.user.id, event_type: "session_revoked" });
    return NextResponse.json({ ok: true });
  }

  if (body.action === "security_event" && ["mfa_enabled", "mfa_disabled"].includes(String(body.eventType))) {
    const eventType = String(body.eventType);
    await ctx.admin.from("account_access_logs").insert({ tenant_id: ctx.tenantId, user_id: ctx.user.id, event_type: eventType });
    return NextResponse.json({ ok: true });
  }

  if (body.action === "cancel_request") {
    if (ctx.role !== "owner") return NextResponse.json({ error: "Solo el propietario puede gestionar estas solicitudes." }, { status: 403 });
    const { error } = await ctx.admin.from("tenant_data_requests").update({ status: "cancelled", resolved_at: new Date().toISOString() }).eq("id", String(body.id || "")).eq("tenant_id", ctx.tenantId).eq("status", "pending");
    return error ? NextResponse.json({ error: error.message }, { status: 400 }) : NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Acción no admitida." }, { status: 400 });
}

// ---------- POST: solicitud de eliminación de datos o baja de la empresa ----------

export async function POST(request: Request) {
  const ctx = await context();
  if (!ctx) return forbidden();
  if (ctx.role !== "owner") return NextResponse.json({ error: "Solo el propietario de la empresa puede solicitar la eliminación o baja." }, { status: 403 });
  const body = await request.json().catch(() => ({}));
  const type = body.type === "deletion" ? "deletion" : "account_closure";
  const reason = String(body.reason || "").trim().slice(0, 500);
  if (reason.length < 8) return NextResponse.json({ error: "Indica un motivo de al menos 8 caracteres." }, { status: 400 });
  if (body.confirm !== true) return NextResponse.json({ error: "Confirma que entiendes las consecuencias de la solicitud." }, { status: 400 });
  const { error } = await ctx.admin.from("tenant_data_requests").insert({ tenant_id: ctx.tenantId, requested_by: ctx.user.id, request_type: type, reason });
  if (error?.code === "23505") return NextResponse.json({ error: "Ya tienes una solicitud de este tipo en revisión." }, { status: 409 });
  return error ? NextResponse.json({ error: error.message }, { status: 400 }) : NextResponse.json({ ok: true });
}
