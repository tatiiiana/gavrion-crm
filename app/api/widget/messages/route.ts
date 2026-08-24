import { NextResponse } from "next/server";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { createCompanyReply, type AssistantRequest } from "@/lib/ai/company-assistant";

export const runtime = "nodejs";

function cors(origin: string | null) {
  return { "Access-Control-Allow-Origin": origin || "*", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type", Vary: "Origin" };
}

export async function OPTIONS(request: Request) {
  return new Response(null, { status: 204, headers: cors(request.headers.get("origin")) });
}

export async function GET(request: Request) {
  const origin = request.headers.get("origin");
  const url = new URL(request.url);
  const key = url.searchParams.get("key");
  const visitorId = url.searchParams.get("visitorId");
  const conversationId = url.searchParams.get("conversationId");
  if (!key || !visitorId || !conversationId) return NextResponse.json({ error: "Solicitud incompleta" }, { status: 400, headers: cors(origin) });
  const supabase = createAdminSupabase();
  const { data: tenant } = await supabase.from("tenants").select("id, name").eq("widget_key", key).maybeSingle();
  if (!tenant) return NextResponse.json({ error: "Widget no disponible" }, { status: 404, headers: cors(origin) });
  const { data: conversation } = await supabase.from("conversations").select("id").eq("id", conversationId).eq("tenant_id", tenant.id).eq("channel", "web").eq("external_thread_id", visitorId).maybeSingle();
  if (!conversation) return NextResponse.json({ error: "Conversación no encontrada" }, { status: 404, headers: cors(origin) });
  const { data, error } = await supabase.from("messages").select("id, direction, body, created_at").eq("conversation_id", conversation.id).order("created_at", { ascending: true }).limit(100);
  return error ? NextResponse.json({ error: error.message }, { status: 400, headers: cors(origin) }) : NextResponse.json({ messages: data || [] }, { headers: cors(origin) });
}

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  let input: Record<string, unknown>;
  try { input = await request.json(); } catch { return NextResponse.json({ error: "JSON inválido" }, { status: 400, headers: cors(origin) }); }
  const key = String(input.key || "");
  const visitorId = String(input.visitorId || "").slice(0, 100);
  const name = String(input.name || "Visitante").trim().slice(0, 100);
  const email = String(input.email || "").trim().toLowerCase().slice(0, 254);
  const text = String(input.text || "").trim().slice(0, 2000);
  if (!key || !visitorId || !text) return NextResponse.json({ error: "Completa el mensaje" }, { status: 400, headers: cors(origin) });
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return NextResponse.json({ error: "Correo inválido" }, { status: 400, headers: cors(origin) });

  const supabase = createAdminSupabase();
  const { data: tenant } = await supabase.from("tenants").select("id, name").eq("widget_key", key).maybeSingle();
  if (!tenant) return NextResponse.json({ error: "Widget no disponible" }, { status: 404, headers: cors(origin) });

  let { data: contact } = await supabase.from("contacts").select("id").eq("tenant_id", tenant.id).eq("source", "web").contains("metadata", { web_visitor_id: visitorId }).maybeSingle();
  if (!contact) {
    const created = await supabase.from("contacts").insert({ tenant_id: tenant.id, full_name: name || "Visitante web", email: email || null, source: "web", status: "lead", metadata: { web_visitor_id: visitorId, first_origin: origin || null } }).select("id").single();
    if (created.error) return NextResponse.json({ error: created.error.message }, { status: 400, headers: cors(origin) });
    contact = created.data;
  } else if (name !== "Visitante" || email) {
    await supabase.from("contacts").update({ full_name: name || "Visitante web", ...(email ? { email } : {}) }).eq("id", contact.id).eq("tenant_id", tenant.id);
  }

  const { data: conversation, error: conversationError } = await supabase.from("conversations").upsert({ tenant_id: tenant.id, contact_id: contact.id, channel: "web", external_thread_id: visitorId, status: "open", last_message_at: new Date().toISOString() }, { onConflict: "tenant_id,channel,external_thread_id" }).select("id, handling_mode").single();
  if (conversationError || !conversation) return NextResponse.json({ error: conversationError?.message || "No se pudo crear la conversación" }, { status: 400, headers: cors(origin) });
  const { data: message, error } = await supabase.from("messages").insert({ tenant_id: tenant.id, conversation_id: conversation.id, direction: "inbound", sender_type: "contact", body: text, metadata: { source: "web_widget", origin } }).select("id, direction, body, created_at").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400, headers: cors(origin) });
  let botMessage = null;
  if (conversation.handling_mode === "bot") {
    const [{ data: assistant }, { data: documents }, { data: history }, { data: properties }] = await Promise.all([
      supabase.from("assistant_settings").select("enabled, assistant_name, instructions, handoff_message").eq("tenant_id", tenant.id).maybeSingle(),
      supabase.from("knowledge_documents").select("title, content").eq("tenant_id", tenant.id).eq("active", true).limit(20),
      supabase.from("messages").select("direction, body").eq("conversation_id", conversation.id).order("created_at", { ascending: false }).limit(10),
      supabase.from("properties").select("reference, title, property_type, operation, price, currency, city, zone, address, bedrooms, bathrooms, area_sqm, description, status").eq("tenant_id", tenant.id).eq("status", "available").limit(100)
    ]);
    if (assistant?.enabled !== false) {
      const handoffMessage = assistant?.handoff_message || "Voy a transferir esta conversación a una persona del equipo para ayudarte mejor.";
      let generated: { reply: string; handoff: boolean; provider?: string; request?: AssistantRequest };
      const inventory = (properties || []).map(property => `${property.reference || "Sin referencia"}: ${property.title}; ${property.property_type}; ${property.operation === "sale" ? "venta" : "alquiler"}; ${property.price} ${property.currency}; ${[property.city, property.zone, property.address].filter(Boolean).join(", ")}; ${property.bedrooms ?? "-"} habitaciones; ${property.bathrooms ?? "-"} baños; ${property.area_sqm ?? "-"} m². ${property.description || ""}`).join("\n");
      const knowledge = [...(documents || []), ...(inventory ? [{ title: "Inventario inmobiliario disponible", content: inventory }] : [])];
      try {
        generated = await createCompanyReply({ company: tenant.name, assistantName: assistant?.assistant_name || "Asistente virtual", instructions: assistant?.instructions || "Responde con amabilidad y brevedad.", handoffMessage, knowledge, history: (history || []).reverse(), message: text, visitorId });
      } catch (error) {
        console.error("[widget-ai] No se pudo generar la respuesta", error);
        const available = properties || [];
        const matching = available.filter(property => {
          const search = `${property.title} ${property.property_type} ${property.operation} ${property.city} ${property.zone || ""}`.toLowerCase();
          return text.toLowerCase().split(/\s+/).some(term => term.length > 3 && search.includes(term));
        }).slice(0, 3);
        const options = (matching.length ? matching : available.slice(0, 3)).map(property => `${property.reference || "Sin referencia"}: ${property.title}, ${property.operation === "sale" ? "venta" : "alquiler"} por ${property.price} ${property.currency}`).join("; ");
        generated = { reply: options ? `Estas son algunas opciones disponibles: ${options}. ¿Cuál te interesa o qué ciudad, presupuesto y tipo de propiedad buscas?` : "Con gusto te ayudo a encontrar una propiedad. ¿Deseas comprar o alquilar, en qué ciudad y cuál es tu presupuesto aproximado?", handoff: false, provider: "catalog_fallback" };
      }
      const serviceRequest = generated.request;
      if (serviceRequest?.ready) {
        let requestError: { message: string } | null = null;
        let propertyId: string | null = null;
        if (serviceRequest.property_reference) {
          const { data: property } = await supabase.from("properties").select("id").eq("tenant_id", tenant.id).ilike("reference", serviceRequest.property_reference).maybeSingle();
          propertyId = property?.id || null;
        }
        if (serviceRequest.type === "property_inquiry" && serviceRequest.customer_name && serviceRequest.phone && serviceRequest.intent && (serviceRequest.property_reference || serviceRequest.property_type)) {
          const saved = await supabase.from("property_inquiries").upsert({ tenant_id: tenant.id, conversation_id: conversation.id, contact_id: contact.id, property_id: propertyId, customer_name: serviceRequest.customer_name, phone: serviceRequest.phone, email: serviceRequest.email || null, intent: serviceRequest.intent, property_type: serviceRequest.property_type || null, city: serviceRequest.city || null, zone: serviceRequest.zone || null, budget_min: serviceRequest.budget_min || null, budget_max: serviceRequest.budget_max || null, bedrooms: serviceRequest.bedrooms || null, notes: [serviceRequest.property_reference ? `Referencia: ${serviceRequest.property_reference}` : "", serviceRequest.notes].filter(Boolean).join(" · ") || null, status: "new" }, { onConflict: "conversation_id" });
          requestError = saved.error;
        } else if (serviceRequest.type === "property_visit" && serviceRequest.customer_name && serviceRequest.phone && serviceRequest.property_reference && /^\d{4}-\d{2}-\d{2}$/.test(serviceRequest.date) && /^\d{2}:\d{2}/.test(serviceRequest.time) && serviceRequest.party_size > 0) {
          const saved = await supabase.from("property_visits").upsert({ tenant_id: tenant.id, conversation_id: conversation.id, contact_id: contact.id, property_id: propertyId, property_reference: serviceRequest.property_reference, customer_name: serviceRequest.customer_name, phone: serviceRequest.phone, requested_date: serviceRequest.date, requested_time: serviceRequest.time.slice(0, 5), party_size: serviceRequest.party_size, notes: serviceRequest.notes || null, status: "pending" }, { onConflict: "conversation_id" });
          requestError = saved.error;
        }
        if (requestError) {
          console.error("[widget-request] No se pudo guardar la solicitud", requestError);
          generated.reply = "Recibí tus datos, pero no pude registrar la solicitud en este momento. Por favor, intenta nuevamente o solicita atención del equipo.";
        }
      }
      const inserted = await supabase.from("messages").insert({ tenant_id: tenant.id, conversation_id: conversation.id, direction: "outbound", sender_type: "bot", body: generated.reply, metadata: { source: "ai_assistant", provider: generated.provider || "unknown", handoff: generated.handoff, request_type: generated.request?.type || "none" } }).select("id, direction, body, created_at").single();
      botMessage = inserted.data;
      if (generated.handoff) await supabase.from("conversations").update({ handling_mode: "waiting_agent", status: "pending", last_message_at: new Date().toISOString() }).eq("id", conversation.id);
    }
  }
  return NextResponse.json({ conversationId: conversation.id, message, botMessage }, { status: 201, headers: cors(origin) });
}
