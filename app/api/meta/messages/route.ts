import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const supabase = await createServerSupabase();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const { data: membership } = await supabase.from("memberships").select("role").eq("user_id", auth.user.id).limit(1).maybeSingle();
  if (!membership || membership.role === "viewer") return NextResponse.json({ error: "Tu rol es únicamente de consulta" }, { status: 403 });
  const { conversationId, text } = await request.json();
  if (!conversationId || !String(text || "").trim()) return NextResponse.json({ error: "Mensaje inválido" }, { status: 400 });
  const { data: conversation } = await supabase.from("conversations").select("id, tenant_id, channel, external_thread_id").eq("id", conversationId).single();
  if (!conversation || conversation.channel !== "whatsapp") return NextResponse.json({ error: "Conversación no disponible" }, { status: 404 });
  const phoneNumberId = process.env.META_PHONE_NUMBER_ID;
  const accessToken = process.env.META_ACCESS_TOKEN;
  const graphVersion = process.env.META_GRAPH_VERSION;
  if (!phoneNumberId || !accessToken || !graphVersion) return NextResponse.json({ error: "Meta no está configurado" }, { status: 503 });
  const metaResponse = await fetch(`https://graph.facebook.com/${graphVersion}/${phoneNumberId}/messages`, { method: "POST", headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" }, body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", to: conversation.external_thread_id, type: "text", text: { preview_url: false, body: String(text).trim() } }) });
  const result = await metaResponse.json();
  if (!metaResponse.ok) return NextResponse.json({ error: result.error?.message || "Meta rechazó el mensaje" }, { status: 502 });
  const externalId = result.messages?.[0]?.id;
  const { data: saved, error } = await supabase.from("messages").insert({ tenant_id: conversation.tenant_id, conversation_id: conversation.id, direction: "outbound", sender_type: "agent", sender_id: auth.user.id, body: String(text).trim(), external_message_id: externalId, metadata: { provider: "meta", delivery_status: "accepted" } }).select("id, body, direction, created_at").single();
  return error ? NextResponse.json({ error: error.message }, { status: 400 }) : NextResponse.json(saved, { status: 201 });
}
