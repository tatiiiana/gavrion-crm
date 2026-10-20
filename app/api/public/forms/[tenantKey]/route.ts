import { createHash } from "crypto";
import { NextResponse } from "next/server";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { formsForTenant, getFormDefinition, validateForm, type FormDefinition } from "@/lib/site-forms";
import { processSiteForm } from "@/lib/site-form-processor";
import { notifyTenantAdmins } from "@/lib/tenant-notifications";
import { reportServerError } from "@/lib/monitoring";

export const runtime = "nodejs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RATE_WINDOW_MINUTES = 10;
const RATE_MAX_SUBMISSIONS = 6;
const MIN_FILL_MS = 2500;

function cors(origin: string | null) {
  return { "Access-Control-Allow-Origin": origin || "*", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Max-Age": "86400", Vary: "Origin" };
}
const json = (body: unknown, status: number, origin: string | null) => NextResponse.json(body, { status, headers: { ...cors(origin), "Cache-Control": "no-store" } });

async function loadTenant(tenantKey: string) {
  if (!UUID.test(tenantKey)) return null;
  const admin = createAdminSupabase();
  const { data } = await admin.from("tenants").select("id,name,template_key,settings,implementation_status").eq("widget_key", tenantKey).maybeSingle();
  if (!data || !["testing", "ready", "production"].includes(String(data.implementation_status || "draft"))) return null;
  return { admin, tenant: data as { id: string; name: string; template_key: string | null; settings: Record<string, unknown> | null } };
}

/** Opciones públicas (propiedades, productos) para completar los formularios. */
async function dynamicOptions(admin: ReturnType<typeof createAdminSupabase>, tenantId: string, forms: FormDefinition[]) {
  const needs = new Set(forms.flatMap(form => form.fields.map(field => field.optionsFrom).filter(Boolean)));
  const options: Record<string, Array<{ value: string; label: string }>> = {};
  if (needs.has("properties")) {
    const { data } = await admin.from("properties").select("reference,title,city,operation").eq("tenant_id", tenantId).in("status", ["available", "reserved"]).order("updated_at", { ascending: false }).limit(200);
    options.properties = (data || []).map(item => ({ value: String(item.reference || item.title), label: [item.reference, item.title, item.city].filter(Boolean).join(" · ") }));
  }
  if (needs.has("products")) {
    const { data } = await admin.from("products").select("name,price,currency").eq("tenant_id", tenantId).eq("status", "active").order("name").limit(300);
    options.products = (data || []).map(item => ({ value: String(item.name), label: `${item.name}${Number(item.price) ? ` · ${item.currency || "HNL"} ${Number(item.price).toLocaleString("es-HN")}` : ""}` }));
  }
  return options;
}

export async function OPTIONS(request: Request) {
  return new Response(null, { status: 204, headers: cors(request.headers.get("origin")) });
}

export async function GET(request: Request, { params }: { params: Promise<{ tenantKey: string }> }) {
  const origin = request.headers.get("origin");
  const loaded = await loadTenant(decodeURIComponent((await params).tenantKey || "").trim());
  if (!loaded) return json({ error: "Formularios no disponibles." }, 404, origin);
  const forms = formsForTenant(loaded.tenant.template_key, loaded.tenant.settings?.modules);
  const options = await dynamicOptions(loaded.admin, loaded.tenant.id, forms);
  return json({
    company: loaded.tenant.name,
    forms: forms.map(form => ({
      ...form,
      module: undefined,
      fields: form.fields.map(field => field.optionsFrom ? { ...field, options: options[field.optionsFrom] || [], optionsFrom: undefined } : field)
    }))
  }, 200, origin);
}

export async function POST(request: Request, { params }: { params: Promise<{ tenantKey: string }> }) {
  const origin = request.headers.get("origin");
  const tenantKey = decodeURIComponent((await params).tenantKey || "").trim();
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return json({ error: "Solicitud inválida." }, 400, origin); }

  const loaded = await loadTenant(tenantKey);
  if (!loaded) return json({ error: "Formularios no disponibles." }, 404, origin);
  const { admin, tenant } = loaded;

  const offered = formsForTenant(tenant.template_key, tenant.settings?.modules);
  const form = offered.find(item => item.type === String(body.form || "")) || null;
  if (!form || !getFormDefinition(form.type)) return json({ error: "Este formulario no está disponible para la empresa." }, 400, origin);

  // Antispam: campo trampa invisible y tiempo mínimo de llenado. Se responde "ok" para no dar pistas.
  const startedAt = Number(body.startedAt || 0);
  if (String(body.website || "").trim() || (startedAt && Date.now() - startedAt < MIN_FILL_MS)) return json({ ok: true, reference: "—", message: form.successMessage }, 200, origin);

  const ip = (request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip") || "").split(",")[0].trim();
  const ipHash = ip ? createHash("sha256").update(`${ip}|${tenant.id}|${process.env.FORM_IP_SALT || process.env.SUPABASE_SERVICE_ROLE_KEY?.slice(-16) || "gavrion"}`).digest("hex").slice(0, 32) : null;
  if (ipHash) {
    const since = new Date(Date.now() - RATE_WINDOW_MINUTES * 60_000).toISOString();
    const { count } = await admin.from("site_form_submissions").select("id", { count: "exact", head: true }).eq("tenant_id", tenant.id).eq("ip_hash", ipHash).gte("created_at", since);
    if ((count || 0) >= RATE_MAX_SUBMISSIONS) return json({ error: "Recibimos varias solicitudes seguidas. Espera unos minutos e inténtalo de nuevo." }, 429, origin);
  }

  const rawValues = body.values && typeof body.values === "object" ? body.values as Record<string, unknown> : {};
  const allowed: Record<string, string[]> = {};
  const options = await dynamicOptions(admin, tenant.id, [form]);
  for (const field of form.fields) if (field.optionsFrom && options[field.optionsFrom]?.length) allowed[field.name] = options[field.optionsFrom].map(option => option.value);
  // Una propiedad o producto preseleccionado desde el sitio puede no estar en el catálogo vivo; se acepta como texto.
  for (const key of Object.keys(allowed)) if (rawValues[key] && !allowed[key].includes(String(rawValues[key]))) allowed[key].push(String(rawValues[key]).slice(0, 160));
  const { values, errors } = validateForm(form, rawValues, allowed);
  if (Object.keys(errors).length) return json({ error: "Revisa los campos marcados.", fields: errors }, 422, origin);
  if (form.type === "order" && typeof rawValues.items_json === "string") values.items_json = rawValues.items_json.slice(0, 20000);

  const visitorId = String(body.visitorId || "").slice(0, 100);
  const pageUrl = String(body.pageUrl || "").slice(0, 500) || null;

  // 1) Se registra el envío ANTES de procesarlo: ninguna solicitud se pierde aunque falle un paso posterior.
  const submission = await admin.from("site_form_submissions").insert({
    tenant_id: tenant.id, form_type: form.type, status: "received", payload: values, origin, page_url: pageUrl, ip_hash: ipHash
  }).select("id").single();
  if (submission.error || !submission.data) {
    reportServerError("site-forms.submission", submission.error, { tenantId: tenant.id, form: form.type });
    return json({ error: "No pudimos registrar tu solicitud. Inténtalo de nuevo en unos minutos." }, 503, origin);
  }
  const submissionId = submission.data.id as string;
  const reference = submissionId.slice(0, 8).toUpperCase();

  // 2) Se convierte en contacto + conversación + entidad operativa + tarea.
  try {
    const result = await processSiteForm(admin, { tenant, form, values, submissionId, visitorId, origin, pageUrl });
    await admin.from("site_form_submissions").update({
      status: "processed", processed_at: new Date().toISOString(), contact_id: result.contactId, conversation_id: result.conversationId,
      entity_type: result.entityType, entity_id: result.entityId, deal_id: result.dealId, task_id: result.taskId
    }).eq("id", submissionId);
    return json({ ok: true, reference, message: form.successMessage }, 201, origin);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "Error desconocido";
    reportServerError("site-forms.process", cause, { tenantId: tenant.id, form: form.type, submissionId });
    await admin.from("site_form_submissions").update({ status: "failed", error: message.slice(0, 500) }).eq("id", submissionId);
    // El dueño recibe los datos completos para atender manualmente.
    const detail = form.fields.filter(field => values[field.name]).map(field => `${field.label}: ${values[field.name]}`).join(" · ");
    await notifyTenantAdmins({ tenantId: tenant.id, type: "system", title: `Solicitud del sitio sin procesar: ${form.title}`, body: `${detail} (ref. ${reference})`, entityType: "site_form_submission", entityId: submissionId });
    // Para el visitante la solicitud sí quedó registrada.
    return json({ ok: true, reference, message: form.successMessage }, 202, origin);
  }
}
