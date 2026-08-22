import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const supabase = await createServerSupabase();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const { conversationId, text } = await request.json();
  const body = String(text || "").trim().slice(0, 2000);
  if (!conversationId || !body) return NextResponse.json({ error: "Mensaje inválido" }, { status: 400 });
  const { data: conversation } = await supabase.from("conversations").select("id, tenant_id, channel").eq("id", conversationId).single();
  if (!conversation || conversation.channel !== "web") return NextResponse.json({ error: "Conversación no disponible" }, { status: 404 });
  const { data, error } = await supabase.from("messages").insert({ tenant_id: conversation.tenant_id, conversation_id: conversation.id, direction: "outbound", sender_type: "agent", sender_id: auth.user.id, body, metadata: { source: "crm" } }).select("id, body, direction, created_at").single();
  if (!error) await supabase.from("conversations").update({ last_message_at: new Date().toISOString() }).eq("id", conversation.id);
  return error ? NextResponse.json({ error: error.message }, { status: 400 }) : NextResponse.json(data, { status: 201 });
}

