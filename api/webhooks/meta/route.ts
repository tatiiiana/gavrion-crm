import { createHash, createHmac, timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";
import { createAdminSupabase } from "@/lib/supabase/admin";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const valid = url.searchParams.get("hub.mode") === "subscribe" && url.searchParams.get("hub.verify_token") === process.env.META_VERIFY_TOKEN;
  return valid ? new Response(url.searchParams.get("hub.challenge") || "", { status: 200 }) : new Response("Forbidden", { status: 403 });
}

function verifySignature(raw: string, signature: string) {
  const secret = process.env.META_APP_SECRET;
  if (!secret || !signature.startsWith("sha256=")) return false;
  const expected = "sha256=" + createHmac("sha256", secret).update(raw).digest("hex");
  return signature.length === expected.length && timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

function messageText(message: Record<string, any>) {
  return message.text?.body || message.button?.text || message.interactive?.button_reply?.title || message.interactive?.list_reply?.title || message.image?.caption || message.document?.caption || `[${message.type || "mensaje"}]`;
}

export async function POST(request: Request) {
  const raw = await request.text();
  if (!verifySignature(raw, request.headers.get("x-hub-signature-256") || "")) return new Response("Invalid signature", { status: 401 });
  const payload = JSON.parse(raw);
  const supabase = createAdminSupabase();
  const eventId = createHash("sha256").update(raw).digest("hex");
  const { data: existing } = await supabase.from("webhook_events").select("id").eq("provider", "meta").eq("external_id", eventId).maybeSingle();
  if (existing) return NextResponse.json({ received: true, duplicate: true });
  await supabase.from("webhook_events").insert({ provider: "meta", external_id: eventId, payload });

  for (const entry of payload.entry || []) {
    for (const change of entry.changes || []) {
      const value = change.value || {};
      const phoneNumberId = value.metadata?.phone_number_id;
      if (!phoneNumberId) continue;
      const { data: connection } = await supabase.from("channel_connections").select("tenant_id").eq("provider", "whatsapp").eq("external_account_id", phoneNumberId).eq("status", "active").maybeSingle();
      if (!connection) continue;
      const tenantId = connection.tenant_id;

      for (const status of value.statuses || []) {
        const { data: sentMessage } = await supabase.from("messages").select("id, metadata").eq("tenant_id", tenantId).eq("external_message_id", status.id).maybeSingle();
        if (sentMessage) await supabase.from("messages").update({ metadata: { ...(sentMessage.metadata || {}), delivery_status: status.status, status_timestamp: status.timestamp } }).eq("id", sentMessage.id);
      }

      for (const incoming of value.messages || []) {
        const { data: duplicate } = await supabase.from("messages").select("id").eq("tenant_id", tenantId).eq("external_message_id", incoming.id).maybeSingle();
        if (duplicate) continue;
        const phone = incoming.from;
        const profile = (value.contacts || []).find((contact: any) => contact.wa_id === phone)?.profile?.name || phone;
        let { data: contact } = await supabase.from("contacts").select("id").eq("tenant_id", tenantId).eq("phone", phone).maybeSingle();
        if (!contact) {
          const created = await supabase.from("contacts").insert({ tenant_id: tenantId, full_name: profile, phone, source: "whatsapp", status: "lead" }).select("id").single();
          contact = created.data;
        }
        if (!contact) continue;
        const { data: conversation } = await supabase.from("conversations").upsert({ tenant_id: tenantId, contact_id: contact.id, channel: "whatsapp", external_thread_id: phone, status: "open", last_message_at: new Date(Number(incoming.timestamp || 0) * 1000 || Date.now()).toISOString() }, { onConflict: "tenant_id,channel,external_thread_id" }).select("id").single();
        if (!conversation) continue;
        await supabase.from("messages").insert({ tenant_id: tenantId, conversation_id: conversation.id, direction: "inbound", sender_type: "contact", body: messageText(incoming), external_message_id: incoming.id, metadata: { type: incoming.type, raw: incoming } });
      }
    }
  }
  await supabase.from("webhook_events").update({ processed_at: new Date().toISOString() }).eq("provider", "meta").eq("external_id", eventId);
  return NextResponse.json({ received: true });
}
