import { createAdminSupabase } from "@/lib/supabase/admin";
import { createCompanyReply } from "@/lib/ai/company-assistant";
import { getMetaConnectionById, graphBase } from "@/lib/meta/client";

type MetaChannel = "whatsapp" | "facebook" | "instagram";

export async function respondToMetaConversation(input: {
  tenantId: string;
  tenantName: string;
  conversationId: string;
  connectionId: string;
  channel: MetaChannel;
  recipientId: string;
  text: string;
}) {
  const supabase = createAdminSupabase();
  const { data: conversation } = await supabase.from("conversations").select("handling_mode").eq("id", input.conversationId).eq("tenant_id", input.tenantId).maybeSingle();
  if (conversation?.handling_mode !== "bot") return null;

  const [{ data: assistant }, { data: documents }, { data: history }] = await Promise.all([
    supabase.from("assistant_settings").select("enabled, assistant_name, instructions, handoff_message").eq("tenant_id", input.tenantId).maybeSingle(),
    supabase.from("knowledge_documents").select("title, content").eq("tenant_id", input.tenantId).eq("active", true).limit(20),
    supabase.from("messages").select("direction, body").eq("conversation_id", input.conversationId).order("created_at", { ascending: false }).limit(10)
  ]);
  if (assistant?.enabled === false) return null;

  const handoffMessage = assistant?.handoff_message || "Voy a transferir esta conversación a una persona del equipo para ayudarte mejor.";
  const generated = await createCompanyReply({
    company: input.tenantName,
    assistantName: assistant?.assistant_name || "Asistente virtual",
    instructions: assistant?.instructions || "Responde con amabilidad, brevedad y únicamente con información confirmada.",
    handoffMessage,
    knowledge: documents || [],
    history: (history || []).reverse(),
    message: input.text,
    visitorId: input.recipientId
  });

  const connection = await getMetaConnectionById(input.tenantId, input.connectionId);
  if (!connection) throw new Error(`No existe una conexión activa para ${input.channel}`);
  const payload = input.channel === "whatsapp"
    ? { messaging_product: "whatsapp", recipient_type: "individual", to: input.recipientId, type: "text", text: { preview_url: false, body: generated.reply } }
    : { recipient: { id: input.recipientId }, messaging_type: "RESPONSE", message: { text: generated.reply } };
  const response = await fetch(`${graphBase}/${connection.external_account_id}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${connection.accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error?.message || "Meta rechazó la respuesta automática");

  await supabase.from("messages").insert({
    tenant_id: input.tenantId,
    conversation_id: input.conversationId,
    direction: "outbound",
    sender_type: "bot",
    body: generated.reply,
    external_message_id: result.messages?.[0]?.id || result.message_id || null,
    metadata: { source: "ai_assistant", provider: generated.provider || "unknown", channel: input.channel, handoff: generated.handoff, delivery_status: "accepted" }
  });
  await supabase.from("conversations").update({
    last_message_at: new Date().toISOString(),
    ...(generated.handoff ? { handling_mode: "waiting_agent", status: "pending" } : {})
  }).eq("id", input.conversationId).eq("tenant_id", input.tenantId);
  return generated;
}
