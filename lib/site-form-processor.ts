import type { SupabaseClient } from "@supabase/supabase-js";
import { DEFAULT_TIMEZONE_OFFSET, normalizePhone, summarizeSubmission, type FormDefinition, type FormValues } from "@/lib/site-forms";
import { notifyTenantAdmins, type TenantNotificationType } from "@/lib/tenant-notifications";
import { runAutomations } from "@/lib/automations/engine";

type Tenant = { id: string; name: string };
type Result = { contactId: string; conversationId: string; entityType: string | null; entityId: string | null; dealId: string | null; taskId: string | null };

const HOUR = 3600_000;
const propertyTypes = new Set(["house", "apartment", "land", "commercial", "office", "other"]);

function fail(step: string, error: { message: string } | null | undefined): never {
  throw new Error(`${step}: ${error?.message || "error desconocido"}`);
}

/** Busca el contacto por teléfono, correo o visitante web; si no existe lo crea. */
async function upsertContact(admin: SupabaseClient, tenantId: string, values: FormValues, visitorId: string, origin: string | null) {
  const phone = normalizePhone(values.phone || "");
  const rawPhone = (values.phone || "").trim();
  const email = (values.email || "").trim().toLowerCase();
  const fullName = (values.full_name || "Cliente web").trim();

  const lookups: Array<() => PromiseLike<{ data: { id: string; full_name: string | null; email: string | null; phone: string | null } | null }>> = [];
  if (phone) lookups.push(() => admin.from("contacts").select("id,full_name,email,phone").eq("tenant_id", tenantId).in("phone", Array.from(new Set([phone, rawPhone, `+${phone}`]))).limit(1).maybeSingle());
  if (email) lookups.push(() => admin.from("contacts").select("id,full_name,email,phone").eq("tenant_id", tenantId).ilike("email", email).limit(1).maybeSingle());
  if (visitorId) lookups.push(() => admin.from("contacts").select("id,full_name,email,phone").eq("tenant_id", tenantId).eq("source", "web").contains("metadata", { web_visitor_id: visitorId }).limit(1).maybeSingle());

  for (const lookup of lookups) {
    const { data } = await lookup();
    if (data) {
      // Completa datos faltantes sin sobrescribir lo que el equipo ya registró.
      const patch: Record<string, string> = {};
      if (!data.phone && phone) patch.phone = phone;
      if (!data.email && email) patch.email = email;
      if ((!data.full_name || data.full_name === "Visitante web" || data.full_name === "Visitante") && fullName) patch.full_name = fullName;
      if (Object.keys(patch).length) await admin.from("contacts").update(patch).eq("id", data.id).eq("tenant_id", tenantId);
      return { id: data.id, created: false };
    }
  }

  const insert = await admin.from("contacts").insert({
    tenant_id: tenantId, full_name: fullName, phone: phone || null, email: email || null, source: "web", status: "lead",
    metadata: { ...(visitorId ? { web_visitor_id: visitorId } : {}), first_origin: origin, created_from: "site_form" }
  }).select("id").single();
  if (insert.error?.code === "23505") {
    // Otro envío simultáneo creó el contacto: se reutiliza.
    for (const lookup of lookups) { const { data } = await lookup(); if (data) return { id: data.id, created: false }; }
  }
  if (insert.error || !insert.data) fail("contacto", insert.error);
  return { id: insert.data.id as string, created: true };
}

async function createTask(admin: SupabaseClient, tenantId: string, title: string, hours: number) {
  const { data, error } = await admin.from("tasks").insert({ tenant_id: tenantId, title: title.slice(0, 200), due_at: new Date(Date.now() + hours * HOUR).toISOString() }).select("id").single();
  if (error || !data) fail("tarea", error);
  return data.id as string;
}

async function createDeal(admin: SupabaseClient, tenantId: string, contactId: string, title: string, value: number, currency = "HNL") {
  const { data, error } = await admin.from("deals").insert({ tenant_id: tenantId, contact_id: contactId, title: title.slice(0, 200), stage: "new", value: Math.max(0, value || 0), currency }).select("id").single();
  if (error || !data) fail("oportunidad", error);
  return data.id as string;
}

async function findProperty(admin: SupabaseClient, tenantId: string, reference: string) {
  if (!reference) return null;
  const byReference = await admin.from("properties").select("id,reference,title,operation,price,currency").eq("tenant_id", tenantId).ilike("reference", reference).maybeSingle();
  if (byReference.data) return byReference.data;
  const byTitle = await admin.from("properties").select("id,reference,title,operation,price,currency").eq("tenant_id", tenantId).ilike("title", reference).limit(1).maybeSingle();
  return byTitle.data || null;
}

/**
 * Registra un formulario del sitio como contacto + conversación + entidad operativa (+ oportunidad y tarea).
 * Reservas, pedidos y citas avisan al dueño mediante disparadores de la base de datos;
 * el resto de formularios avisa desde aquí.
 */
export async function processSiteForm(admin: SupabaseClient, input: {
  tenant: Tenant; form: FormDefinition; values: FormValues; submissionId: string; visitorId: string; origin: string | null; pageUrl: string | null;
}): Promise<Result> {
  const { tenant, form, values, submissionId } = input;
  const tenantId = tenant.id;
  const customer = values.full_name;
  const phone = normalizePhone(values.phone || "") || values.phone;

  const contact = await upsertContact(admin, tenantId, values, input.visitorId, input.origin);
  const now = new Date().toISOString();

  // Cada formulario tiene su propia conversación: reservas, pedidos, interesados y visitas
  // admiten un solo registro por conversación.
  const conversation = await admin.from("conversations").insert({
    tenant_id: tenantId, contact_id: contact.id, channel: "web", external_thread_id: `form:${submissionId}`,
    status: "open", handling_mode: "human", last_message_at: now
  }).select("id").single();
  if (conversation.error || !conversation.data) fail("conversación", conversation.error);
  const conversationId = conversation.data.id as string;

  const message = await admin.from("messages").insert({
    tenant_id: tenantId, conversation_id: conversationId, direction: "inbound", sender_type: "contact",
    body: summarizeSubmission(form, values),
    metadata: { source: "site_form", form_type: form.type, submission_id: submissionId, page_url: input.pageUrl, origin: input.origin }
  });
  if (message.error) fail("mensaje", message.error);

  let entityType: string | null = null;
  let entityId: string | null = null;
  let dealId: string | null = null;
  let taskId: string | null = null;
  let notify: { type: TenantNotificationType; title: string; body: string } | null = null;
  const base = { tenant_id: tenantId, conversation_id: conversationId, contact_id: contact.id, source: "web_form" };

  switch (form.type) {
    case "advisory":
    case "property_inquiry": {
      const property = form.type === "property_inquiry" ? await findProperty(admin, tenantId, values.property_reference) : null;
      const intent = form.type === "advisory" ? values.intent : property?.operation === "rent" ? "rent" : "buy";
      const subject = property ? `${property.reference || ""} ${property.title}`.trim() : values.property_reference || (values.property_type ? values.property_type : "asesoría");
      const budget = Number(values.budget || 0) || Number(property?.price || 0);
      dealId = await createDeal(admin, tenantId, contact.id, `${intent === "sell" ? "Captación" : "Interés"}: ${subject} · ${customer}`, budget, property?.currency || "HNL");
      taskId = await createTask(admin, tenantId, `Contactar a ${customer} (${phone}) por ${subject}`, 24);
      const saved = await admin.from("property_inquiries").insert({
        ...base, property_id: property?.id || null, customer_name: customer, phone, email: values.email || null, intent,
        property_type: propertyTypes.has(values.property_type) ? values.property_type : null, city: values.city || null,
        budget_max: values.budget ? Number(values.budget) : null,
        notes: [values.property_reference && !property ? `Referencia: ${values.property_reference}` : "", values.notes].filter(Boolean).join(" · ") || null,
        status: "new", deal_id: dealId, follow_up_task_id: taskId
      }).select("id").single();
      if (saved.error || !saved.data) fail("interesado", saved.error);
      entityType = "property_inquiry"; entityId = saved.data.id;
      notify = { type: "inquiry", title: form.type === "advisory" ? "Nueva solicitud de asesoría" : "Nueva consulta de propiedad", body: `${customer} · ${subject}` };
      break;
    }
    case "property_visit": {
      const property = await findProperty(admin, tenantId, values.property_reference);
      const reference = property?.reference || values.property_reference;
      const saved = await admin.from("property_visits").insert({
        ...base, property_id: property?.id || null, property_reference: reference, customer_name: customer, phone,
        requested_date: values.date, requested_time: values.time, party_size: Number(values.party_size || 1), notes: values.notes || null, status: "pending"
      }).select("id").single();
      if (saved.error || !saved.data) fail("visita", saved.error);
      entityType = "property_visit"; entityId = saved.data.id;
      taskId = await createTask(admin, tenantId, `Confirmar visita de ${customer} a ${reference} (${values.date} ${values.time})`, 2);
      notify = { type: "appointment", title: "Nueva solicitud de visita", body: `${customer} · ${reference} · ${values.date} ${values.time}` };
      break;
    }
    case "reservation": {
      const saved = await admin.from("reservations").insert({
        ...base, customer_name: customer, phone, reservation_date: values.date, reservation_time: values.time,
        party_size: Number(values.party_size || 1), notes: values.notes || null, status: "pending", reservation_kind: "table"
      }).select("id").single();
      if (saved.error || !saved.data) fail("reserva", saved.error);
      entityType = "reservations"; entityId = saved.data.id;
      taskId = await createTask(admin, tenantId, `Confirmar reserva de ${customer}: ${values.date} ${values.time}, ${values.party_size} personas`, 2);
      break;
    }
    case "lodging_reservation": {
      const saved = await admin.from("reservations").insert({
        ...base, customer_name: customer, phone, reservation_date: values.check_in, reservation_time: "15:00", check_out_date: values.check_out,
        party_size: Number(values.guests || 1), room_type: values.room_type || null, notes: values.notes || null, status: "pending", reservation_kind: "lodging"
      }).select("id").single();
      if (saved.error || !saved.data) fail("reservación", saved.error);
      entityType = "reservations"; entityId = saved.data.id;
      taskId = await createTask(admin, tenantId, `Confirmar reservación de ${customer}: ${values.check_in} → ${values.check_out}`, 4);
      break;
    }
    case "order": {
      const delivery = values.fulfillment === "delivery";
      let detail: unknown[] = [];
      let estimated: number | null = null;
      try {
        const parsed = JSON.parse(values.items_json || "[]");
        if (Array.isArray(parsed)) {
          detail = parsed.slice(0, 100).map(item => ({ name: String(item?.name || "").slice(0, 120), quantity: Math.max(1, Math.floor(Number(item?.quantity || 1))), price: Math.max(0, Number(item?.price || 0)) })).filter(item => item.name);
          estimated = (detail as Array<{ quantity: number; price: number }>).reduce((sum, item) => sum + item.quantity * item.price, 0) || null;
        }
      } catch { detail = []; }
      const saved = await admin.from("orders").insert({
        ...base, customer_name: customer, phone, items: values.items, fulfillment: delivery ? "delivery" : "pickup",
        address: delivery ? values.address : null, requested_date: values.date || null, requested_time: values.time || null,
        notes: values.notes || null, status: "pending", items_detail: detail, estimated_total: estimated
      }).select("id").single();
      if (saved.error || !saved.data) fail("pedido", saved.error);
      entityType = "orders"; entityId = saved.data.id;
      taskId = await createTask(admin, tenantId, `Confirmar pedido de ${customer} (${delivery ? "domicilio" : "recoger"})`, 1);
      break;
    }
    case "appointment": {
      const scheduledAt = `${values.date}T${values.time}:00${DEFAULT_TIMEZONE_OFFSET}`;
      const saved = await admin.from("appointments").insert({
        ...base, customer_name: customer, phone, service: values.service, scheduled_at: scheduledAt, notes: values.notes || null, status: "pending"
      }).select("id").single();
      if (saved.error || !saved.data) fail("cita", saved.error);
      entityType = "appointments"; entityId = saved.data.id;
      taskId = await createTask(admin, tenantId, `Confirmar cita de ${customer}: ${values.service}, ${values.date} ${values.time}`, 2);
      break;
    }
    case "quote": {
      const amount = Number(values.budget || 0);
      dealId = await createDeal(admin, tenantId, contact.id, `Cotización: ${values.service} · ${customer}`, amount);
      const saved = await admin.from("quotes").insert({
        ...base, customer_name: values.company ? `${customer} (${values.company})` : customer, title: values.service,
        details: [values.details, values.date ? `Fecha requerida: ${values.date}` : "", values.budget ? `Presupuesto del cliente: ${values.budget}` : ""].filter(Boolean).join("\n"),
        amount: 0, currency: "HNL", status: "draft"
      }).select("id").single();
      if (saved.error || !saved.data) fail("cotización", saved.error);
      entityType = "quotes"; entityId = saved.data.id;
      taskId = await createTask(admin, tenantId, `Preparar cotización para ${customer}: ${values.service}`, 24);
      notify = { type: "inquiry", title: "Nueva solicitud de cotización", body: `${customer} · ${values.service}` };
      break;
    }
    case "product_inquiry": {
      const product = values.product ? (await admin.from("products").select("id,name,price,currency").eq("tenant_id", tenantId).eq("name", values.product).limit(1).maybeSingle()).data : null;
      const quantity = Math.max(1, Number(values.quantity || 1));
      const subject = values.product || "producto";
      dealId = await createDeal(admin, tenantId, contact.id, `Consulta: ${subject} · ${customer}`, Number(product?.price || 0) * quantity, product?.currency || "HNL");
      taskId = await createTask(admin, tenantId, `Responder consulta de ${customer} sobre ${subject}`, 24);
      entityType = "deals"; entityId = dealId;
      notify = { type: "inquiry", title: "Nueva consulta de producto", body: `${customer} · ${subject}${quantity > 1 ? ` × ${quantity}` : ""}` };
      break;
    }
    case "availability": {
      dealId = await createDeal(admin, tenantId, contact.id, `Disponibilidad ${values.check_in} → ${values.check_out} · ${customer}`, 0);
      taskId = await createTask(admin, tenantId, `Enviar disponibilidad a ${customer}: ${values.check_in} → ${values.check_out}, ${values.guests} huésped(es)`, 4);
      entityType = "deals"; entityId = dealId;
      notify = { type: "inquiry", title: "Nueva consulta de disponibilidad", body: `${customer} · ${values.check_in} → ${values.check_out} · ${values.guests} huésped(es)` };
      break;
    }
    case "contact": {
      taskId = await createTask(admin, tenantId, `Responder mensaje de ${customer} (${phone})`, 24);
      notify = { type: "message", title: "Nuevo mensaje desde el formulario web", body: `${customer}: ${(values.notes || "").slice(0, 200)}` };
      break;
    }
  }

  if (notify) {
    const ownEntity = Boolean(entityType && entityId && entityType !== "deals");
    await notifyTenantAdmins({ tenantId, type: notify.type, title: notify.title, body: notify.body, entityType: ownEntity ? entityType! : "conversation", entityId: ownEntity ? entityId : conversationId });
  }

  // Automatizaciones: no deben impedir que el envío quede registrado.
  try {
    if (contact.created) await runAutomations({ tenantId, event: "contact_created", payload: { contactId: contact.id, contactName: customer, channel: "web_form", formType: form.type } });
    await runAutomations({ tenantId, event: "message_received", payload: { conversationId, contactId: contact.id, contactName: customer, channel: "web_form", formType: form.type, text: values.notes || "" } });
  } catch (error) { console.error("[site-forms] Automatizaciones con error", error); }

  return { contactId: contact.id, conversationId, entityType, entityId, dealId, taskId };
}
