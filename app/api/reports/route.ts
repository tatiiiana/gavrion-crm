import { NextResponse } from "next/server";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { createServerSupabase } from "@/lib/supabase/server";
import { getActiveTenantIdFromCookie, resolveTenantMembership } from "@/lib/tenant-access";
import { hasTenantPermission } from "@/lib/permissions";

type Row = Record<string, any>;
type Range = { start: Date; end: Date; days: number };
type RangeData = {
  conversations: Row[];
  messages: Row[];
  deals: Row[];
  contacts: Row[];
  forms: Row[];
  reservations: Row[];
  orders: Row[];
  appointments: Row[];
  quotes: Row[];
  inquiries: Row[];
  visits: Row[];
};

async function optionalRows<T extends Row = Row>(request: PromiseLike<{ data: T[] | null; error: { message?: string } | null }>) {
  const result = await request;
  return result.error ? [] : result.data || [];
}

function rangeFromParams(params: URLSearchParams): Range {
  const fromParam = params.get("from");
  const toParam = params.get("to");
  if (fromParam && toParam) {
    const start = new Date(`${fromParam}T00:00:00-06:00`);
    const end = new Date(`${toParam}T23:59:59.999-06:00`);
    if (Number.isFinite(start.getTime()) && Number.isFinite(end.getTime()) && end >= start) {
      const days = Math.min(366, Math.max(1, Math.ceil((end.getTime() - start.getTime()) / 86400000)));
      return { start, end, days };
    }
  }
  const requested = params.get("period");
  const days = requested === "7d" ? 7 : requested === "90d" ? 90 : requested === "365d" ? 365 : 30;
  const end = new Date();
  const start = new Date(end.getTime() - days * 86400000);
  return { start, end, days };
}

function previousRange(current: Range): Range {
  const duration = current.end.getTime() - current.start.getTime();
  return { start: new Date(current.start.getTime() - duration), end: new Date(current.start.getTime() - 1), days: current.days };
}

function dateKey(value: string | Date) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Tegucigalpa", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(value));
  const get = (type: string) => parts.find(part => part.type === type)?.value || "00";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function percentChange(current: number, previous: number) {
  if (previous === 0) return current === 0 ? 0 : 100;
  return Number((((current - previous) / Math.abs(previous)) * 100).toFixed(1));
}

function responseStats(messages: Row[]) {
  const pending = new Map<string, number[]>();
  const intervals: number[] = [];
  const sorted = [...messages].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  for (const item of sorted) {
    const conversationId = String(item.conversation_id || "");
    if (!conversationId) continue;
    const timestamp = new Date(item.created_at).getTime();
    if (!Number.isFinite(timestamp)) continue;
    if (item.direction === "inbound") {
      const queue = pending.get(conversationId) || [];
      queue.push(timestamp);
      pending.set(conversationId, queue);
    } else if (item.direction === "outbound") {
      const queue = pending.get(conversationId) || [];
      const inbound = queue.shift();
      if (inbound !== undefined) {
        const minutes = (timestamp - inbound) / 60000;
        if (minutes >= 0 && minutes <= 7 * 24 * 60) intervals.push(minutes);
      }
      if (queue.length) pending.set(conversationId, queue); else pending.delete(conversationId);
    }
  }
  return { average: intervals.length ? Number((intervals.reduce((sum, value) => sum + value, 0) / intervals.length).toFixed(1)) : null, count: intervals.length };
}

async function loadRange(supabase: any, tenantId: string, range: Range): Promise<RangeData> {
  const from = range.start.toISOString();
  const to = range.end.toISOString();
  const [conversationsResult, messagesResult, dealsResult, contactsResult, forms, reservations, orders, appointments, quotes, inquiries, visits] = await Promise.all([
    supabase.from("conversations").select("id,channel,status,assigned_to,created_at,last_message_at").eq("tenant_id", tenantId).gte("created_at", from).lte("created_at", to).range(0, 4999),
    supabase.from("messages").select("conversation_id,direction,sender_id,sender_type,created_at").eq("tenant_id", tenantId).gte("created_at", from).lte("created_at", to).order("created_at", { ascending: true }).range(0, 9999),
    supabase.from("deals").select("id,stage,stage_id,value,created_at,updated_at,owner_id").eq("tenant_id", tenantId).gte("created_at", from).lte("created_at", to).range(0, 4999),
    supabase.from("contacts").select("id,created_at").eq("tenant_id", tenantId).gte("created_at", from).lte("created_at", to).range(0, 4999),
    optionalRows(supabase.from("site_form_submissions").select("id,form_type,status,created_at").eq("tenant_id", tenantId).gte("created_at", from).lte("created_at", to).range(0, 4999)),
    optionalRows(supabase.from("reservations").select("id,status,created_at").eq("tenant_id", tenantId).gte("created_at", from).lte("created_at", to).range(0, 4999)),
    optionalRows(supabase.from("orders").select("id,status,estimated_total,created_at").eq("tenant_id", tenantId).gte("created_at", from).lte("created_at", to).range(0, 4999)),
    optionalRows(supabase.from("appointments").select("id,status,created_at").eq("tenant_id", tenantId).gte("created_at", from).lte("created_at", to).range(0, 4999)),
    optionalRows(supabase.from("quotes").select("id,status,amount,created_at").eq("tenant_id", tenantId).gte("created_at", from).lte("created_at", to).range(0, 4999)),
    optionalRows(supabase.from("property_inquiries").select("id,created_at").eq("tenant_id", tenantId).gte("created_at", from).lte("created_at", to).range(0, 4999)),
    optionalRows(supabase.from("property_visits").select("id,created_at").eq("tenant_id", tenantId).gte("created_at", from).lte("created_at", to))
  ]);
  const error = conversationsResult.error || messagesResult.error || dealsResult.error || contactsResult.error;
  if (error) throw new Error(error.message || "No se pudieron cargar los datos del reporte.");
  return {
    conversations: conversationsResult.data || [], messages: messagesResult.data || [], deals: dealsResult.data || [], contacts: contactsResult.data || [],
    forms, reservations, orders, appointments, quotes, inquiries, visits
  };
}

function buildMetrics(data: RangeData) {
  const wonDeals = data.deals.filter(deal => String(deal.stage || "").toLowerCase() === "won");
  const response = responseStats(data.messages);
  const opportunities = data.deals.length;
  return {
    conversations: data.conversations.length,
    contacts: data.contacts.length,
    opportunities,
    wonDeals: wonDeals.length,
    salesValue: wonDeals.reduce((sum, deal) => sum + Number(deal.value || 0), 0),
    conversion: data.contacts.length ? Number(((wonDeals.length / data.contacts.length) * 100).toFixed(1)) : 0,
    opportunityRate: data.contacts.length ? Number(((opportunities / data.contacts.length) * 100).toFixed(1)) : 0,
    averageResponseMinutes: response.average,
    responseCount: response.count,
    forms: data.forms.length,
    reservations: data.reservations.length,
    orders: data.orders.length,
    appointments: data.appointments.length,
    quotes: data.quotes.length,
    inquiries: data.inquiries.length,
    visits: data.visits.length
  };
}

function buildDaily(data: RangeData, range: Range) {
  const days = Array.from({ length: range.days }, (_, index) => {
    const date = new Date(range.start.getTime() + index * 86400000);
    const key = dateKey(date);
    return {
      date: key,
      conversations: data.conversations.filter(item => dateKey(item.created_at) === key).length,
      contacts: data.contacts.filter(item => dateKey(item.created_at) === key).length,
      opportunities: data.deals.filter(item => dateKey(item.created_at) === key).length,
      wonDeals: data.deals.filter(item => dateKey(item.created_at) === key && String(item.stage || "").toLowerCase() === "won").length
    };
  });
  return days;
}

function buildFunnel(data: RangeData) {
  const won = data.deals.filter(deal => String(deal.stage || "").toLowerCase() === "won");
  return [
    { key: "contacts", label: "Contactos", count: data.contacts.length, value: 0, color: "#514bb7" },
    { key: "opportunities", label: "Oportunidades", count: data.deals.length, value: data.deals.reduce((sum, deal) => sum + Number(deal.value || 0), 0), color: "#2f80ed" },
    { key: "won", label: "Ventas ganadas", count: won.length, value: won.reduce((sum, deal) => sum + Number(deal.value || 0), 0), color: "#11866f" }
  ];
}

function buildOperational(data: RangeData) {
  return [
    { key: "forms", label: "Formularios del sitio", value: data.forms.length, detail: "Solicitudes recibidas", color: "#514bb7" },
    { key: "reservations", label: "Reservas", value: data.reservations.length, detail: "Solicitudes registradas", color: "#c7821c" },
    { key: "orders", label: "Pedidos", value: data.orders.length, detail: "Pedidos recibidos", color: "#2f80ed" },
    { key: "appointments", label: "Citas", value: data.appointments.length, detail: "Citas agendadas", color: "#a04db8" },
    { key: "inquiries", label: "Consultas inmobiliarias", value: data.inquiries.length, detail: "Interesados registrados", color: "#0e9077" },
    { key: "visits", label: "Visitas", value: data.visits.length, detail: "Visitas solicitadas", color: "#6a7c90" }
  ].filter(item => item.value > 0 || ["forms", "reservations", "orders", "appointments"].includes(item.key));
}

export async function GET(request: Request) {
  const supabase = await createServerSupabase();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const params = new URL(request.url).searchParams;
  const requestedTenantId = params.get("tenantId") || await getActiveTenantIdFromCookie();
  const { membership } = await resolveTenantMembership(supabase, auth.user.id, requestedTenantId);
  if (!membership) return NextResponse.json({ error: requestedTenantId ? "No tienes acceso a esa empresa." : "Selecciona una empresa activa antes de consultar el reporte." }, { status: requestedTenantId ? 403 : 409 });
  const range = rangeFromParams(params);
  const previous = previousRange(range);
  try {
    const [currentData, previousData, stageResult, tenantResult, memberResult, usersResult] = await Promise.all([
      loadRange(supabase, membership.tenant_id, range),
      loadRange(supabase, membership.tenant_id, previous),
      optionalRows(supabase.from("pipeline_stages").select("id,name,stage_key,color,position,probability,is_won,is_lost").eq("tenant_id", membership.tenant_id).order("position")),
      supabase.from("tenants").select("settings").eq("id", membership.tenant_id).maybeSingle(),
      supabase.from("memberships").select("user_id,role,active").eq("tenant_id", membership.tenant_id).eq("active", true),
      createAdminSupabase().auth.admin.listUsers({ page: 1, perPage: 1000 })
    ]);
    const metrics = buildMetrics(currentData);
    const previousMetrics = buildMetrics(previousData);
    const stageRows = stageResult || [];
    const stageMap = new Map(stageRows.map(stage => [stage.id, stage]));
    const byStage = new Map<string, { key: string; label: string; count: number; value: number; color: string; position: number; probability: number }>();
    for (const stage of stageRows) byStage.set(stage.id, { key: stage.stage_key, label: stage.name, count: 0, value: 0, color: stage.color || "#514bb7", position: stage.position || 0, probability: Number(stage.probability || 0) });
    for (const deal of currentData.deals) {
      const stage = deal.stage_id ? stageMap.get(deal.stage_id) : null;
      const key = stage?.id || String(deal.stage || "unknown");
      const current = byStage.get(key) || { key: String(deal.stage || "unknown"), label: String(deal.stage || "Sin etapa"), count: 0, value: 0, color: "#7d8791", position: 999, probability: 0 };
      current.count += 1;
      current.value += Number(deal.value || 0);
      byStage.set(key, current);
    }
    const userMap = new Map((usersResult.data?.users || []).map(user => [user.id, user]));
    const memberIds = new Set((memberResult.data || []).map(member => member.user_id));
    const agentIds = new Set<string>();
    for (const row of currentData.messages) if (row.direction === "outbound" && row.sender_id) agentIds.add(row.sender_id);
    for (const row of currentData.conversations) if (row.assigned_to) agentIds.add(row.assigned_to);
    for (const row of currentData.deals) if (row.owner_id) agentIds.add(row.owner_id);
    const agents = Array.from(agentIds).filter(id => memberIds.has(id)).map(id => {
      const user = userMap.get(id);
      const replies = currentData.messages.filter(row => row.direction === "outbound" && row.sender_id === id).length;
      const assignedConversations = currentData.conversations.filter(row => row.assigned_to === id).length;
      const wonDeals = currentData.deals.filter(row => row.owner_id === id && String(row.stage || "").toLowerCase() === "won");
      return { id, name: String(user?.user_metadata?.full_name || user?.email?.split("@")[0] || "Miembro del equipo"), email: user?.email || "", replies, assignedConversations, wonDeals: wonDeals.length, salesValue: wonDeals.reduce((sum, deal) => sum + Number(deal.value || 0), 0) };
    }).sort((a, b) => b.replies - a.replies);
    const latestDirection = new Map<string, string>();
    for (const message of currentData.messages) latestDirection.set(String(message.conversation_id), String(message.direction));
    const unanswered = currentData.conversations.filter(conversation => ["open", "pending"].includes(String(conversation.status || "open")) && latestDirection.get(conversation.id) === "inbound").length;
    const staleCutoff = Date.now() - 7 * 86400000;
    const staleDeals = currentData.deals.filter(deal => !["won", "lost"].includes(String(deal.stage || "").toLowerCase()) && new Date(deal.updated_at || deal.created_at).getTime() < staleCutoff).length;
    const canViewFinancial = hasTenantPermission(membership.role, "reports.financial", membership.permissions);
    const settings = (tenantResult.data?.settings || {}) as Row;
    const savedGoals = settings.report_goals || {};
    const goals = { contacts: Number(savedGoals.contacts || 0), sales: Number(savedGoals.sales || 0), responseMinutes: Number(savedGoals.responseMinutes || 30) };
    const changes = Object.fromEntries(["conversations", "contacts", "opportunities", "wonDeals", "salesValue", "conversion", "averageResponseMinutes"].map(key => [key, percentChange(Number((metrics as any)[key] || 0), Number((previousMetrics as any)[key] || 0))]));
    const alerts = [
      unanswered > 0 ? { key: "unanswered", severity: unanswered >= 5 ? "critical" : "warning", title: `${unanswered} conversación${unanswered === 1 ? "" : "es"} sin responder`, detail: "Revisa la bandeja y asigna un responsable antes de que se enfríen.", action: "Abrir conversaciones" } : null,
      metrics.averageResponseMinutes !== null && metrics.averageResponseMinutes > goals.responseMinutes ? { key: "response", severity: "warning", title: "Tiempo de respuesta por encima de la meta", detail: `Promedio de ${metrics.averageResponseMinutes} min frente a una meta de ${goals.responseMinutes} min.`, action: "Revisar equipo" } : null,
      changes.conversion < -10 ? { key: "conversion", severity: "critical", title: "La conversión está cayendo", detail: `La conversión cambió ${changes.conversion}% frente al periodo anterior.`, action: "Revisar embudo" } : null,
      staleDeals > 0 ? { key: "stale", severity: "warning", title: `${staleDeals} oportunidad${staleDeals === 1 ? "" : "es"} estancada${staleDeals === 1 ? "" : "s"}`, detail: "No han tenido actividad reciente y necesitan una próxima acción.", action: "Revisar ventas" } : null
    ].filter(Boolean);
    const changeFor = (key: string) => Number(changes[key] || 0);
    return NextResponse.json({
      period: range.days, range: { from: range.start.toISOString().slice(0, 10), to: range.end.toISOString().slice(0, 10) }, role: membership.role,
      metrics: { ...(canViewFinancial ? metrics : { ...metrics, wonDeals: 0, salesValue: 0 }), unanswered, staleDeals }, previousMetrics: canViewFinancial ? previousMetrics : { ...previousMetrics, wonDeals: 0, salesValue: 0 }, changes: { ...changes, salesValue: canViewFinancial ? changes.salesValue : 0, unanswered: changeFor("unanswered") }, permissions: { financial: canViewFinancial }, goals: canViewFinancial ? goals : { ...goals, sales: 0 },
      daily: buildDaily(currentData, range), channels: Object.entries(currentData.conversations.reduce<Record<string, number>>((acc, item) => { const key = String(item.channel || "Otro"); acc[key] = (acc[key] || 0) + 1; return acc; }, {})).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value),
      funnel: canViewFinancial ? buildFunnel(currentData) : buildFunnel(currentData).map(item => ({ ...item, value: 0 })), stages: (canViewFinancial ? Array.from(byStage.values()) : Array.from(byStage.values()).map(item => ({ ...item, value: 0 }))).sort((a, b) => a.position - b.position), operational: buildOperational(currentData), agents: canViewFinancial ? agents : agents.map(item => ({ ...item, wonDeals: 0, salesValue: 0 })), alerts
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo calcular el reporte." }, { status: 400 });
  }
}

export async function POST(request: Request) {
  const supabase = await createServerSupabase();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const requestedTenantId = await getActiveTenantIdFromCookie();
  const { membership } = await resolveTenantMembership(supabase, auth.user.id, requestedTenantId);
  if (!membership || !["owner", "admin"].includes(membership.role) || !hasTenantPermission(membership.role, "settings.manage", membership.permissions)) return NextResponse.json({ error: "No tienes permiso para configurar metas." }, { status: 403 });
  const body = await request.json().catch(() => ({}));
  const contacts = Math.max(0, Math.round(Number(body.goals?.contacts || 0)));
  const sales = Math.max(0, Math.round(Number(body.goals?.sales || 0)));
  const responseMinutes = Math.max(1, Math.round(Number(body.goals?.responseMinutes || 30)));
  const { data: current } = await supabase.from("tenants").select("settings").eq("id", membership.tenant_id).single();
  const settings = (current?.settings || {}) as Row;
  const { error } = await supabase.from("tenants").update({ settings: { ...settings, report_goals: { contacts, sales, responseMinutes } } }).eq("id", membership.tenant_id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true, goals: { contacts, sales, responseMinutes } });
}