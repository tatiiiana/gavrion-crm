import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { getMetaConnectionById, graphBase } from "@/lib/meta/client";

export async function POST(request: Request) {
  const supabase = await createServerSupabase();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const { data: membership } = await supabase.from("memberships").select("role").eq("user_id", auth.user.id).limit(1).maybeSingle();
  if (!membership || membership.role === "viewer") return NextResponse.json({ error: "Tu rol es únicamente de consulta" }, { status: 403 });
  const { conversationId, text } = await request.json();
  if (!conversationId || !String(text || "").trim()) return NextResponse.json({ error: "Mensaje inválido" }, { status: 400 });
  const { data: conversation } = await supabase.from("conversations").select("id, tenant_id, channel, external_thread_id, channel_connection_id").eq("id", conversationId).single();
  if (!conversation || !["whatsapp","facebook","instagram"].includes(conversation.channel)) return NextResponse.json({ error: "Conversación no disponible" }, { status: 404 });
  const connection = conversation.channel_connection_id ? await getMetaConnectionById(conversation.tenant_id, conversation.channel_connection_id) : null;
  const accountId = connection?.external_account_id || (conversation.channel === "whatsapp" ? process.env.META_PHONE_NUMBER_ID : "");
  const accessToken = connection?.accessToken || (conversation.channel === "whatsapp" ? process.env.META_ACCESS_TOKEN : "");
  if (!accountId || !accessToken) return NextResponse.json({ error: `Conexión de ${conversation.channel} no configurada` }, { status: 503 });
  const payload = conversation.channel === "whatsapp"
    ? { messaging_product: "whatsapp", recipient_type: "individual", to: conversation.external_thread_id, type: "text", text: { preview_url: false, body: String(text).trim() } }
    : { recipient: { id: conversation.external_thread_id }, messaging_type: "RESPONSE", message: { text: String(text).trim() } };
  const metaResponse = await fetch(`${graphBase}/${accountId}/messages`, { method: "POST", headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  const result = await metaResponse.json();
  if (!metaResponse.ok) return NextResponse.json({ error: result.error?.message || "Meta rechazó el mensaje" }, { status: 502 });
  const externalId = result.messages?.[0]?.id || result.message_id;
  const { data: saved, error } = await supabase.from("messages").insert({ tenant_id: conversation.tenant_id, conversation_id: conversation.id, direction: "outbound", sender_type: "agent", sender_id: auth.user.id, body: String(text).trim(), external_message_id: externalId, metadata: { provider: "meta", delivery_status: "accepted" } }).select("id, body, direction, created_at").single();
  if (!error) await supabase.from("conversations").update({ last_message_at: new Date().toISOString(), handling_mode: "human", assigned_to: auth.user.id }).eq("id", conversation.id);
  return error ? NextResponse.json({ error: error.message }, { status: 400 }) : NextResponse.json(saved, { status: 201 });
}
