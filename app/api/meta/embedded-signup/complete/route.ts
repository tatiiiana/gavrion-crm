import { NextResponse } from "next/server";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { createServerSupabase } from "@/lib/supabase/server";
import { graphBase, graphRequest } from "@/lib/meta/client";
import { encryptCredential } from "@/lib/security/credentials";
import { reportServerError } from "@/lib/monitoring";

const cleanEnv = (value?: string) => value?.trim().replace(/^['"]|['"]$/g, "") || "";
const numericId = (value: unknown) => /^\d+$/.test(String(value || "").trim()) ? String(value).trim() : "";

export async function POST(request: Request) {
  const supabase = await createServerSupabase();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const { data: membership } = await supabase.from("memberships").select("tenant_id, role").eq("user_id", auth.user.id).limit(1).maybeSingle();
  if (!membership || !["owner", "admin"].includes(membership.role)) return NextResponse.json({ error: "Solo administradores" }, { status: 403 });

  const body = await request.json().catch(() => ({}));
  const code = String(body.code || "").trim();
  const wabaId = numericId(body.wabaId);
  const requestedPhoneId = numericId(body.phoneNumberId);
  const businessId = numericId(body.businessId);
  if (!code || !wabaId) return NextResponse.json({ error: "Meta no devolvió el código o la cuenta de WhatsApp" }, { status: 400 });

  const appId = cleanEnv(process.env.META_APP_ID);
  const secret = cleanEnv(process.env.META_APP_SECRET);
  if (!appId || !secret) return NextResponse.json({ error: "Faltan las credenciales de la aplicación Meta" }, { status: 503 });

  try {
    const tokenUrl = new URL(`${graphBase}/oauth/access_token`);
    tokenUrl.searchParams.set("client_id", appId);
    tokenUrl.searchParams.set("client_secret", secret);
    tokenUrl.searchParams.set("code", code);
    const tokenResponse = await fetch(tokenUrl, { method: "GET", cache: "no-store" });
    const tokenResult = await tokenResponse.json();
    if (!tokenResponse.ok || !tokenResult.access_token) throw new Error(tokenResult.error?.message || "No se pudo intercambiar el código de Meta");
    const accessToken = String(tokenResult.access_token);

    // These reads both discover the selected assets and prove that the issued
    // token has access to them. Never trust IDs sent by the browser alone.
    const waba = await graphRequest(`${wabaId}?fields=id,name,owner_business_info`, accessToken);
    const phoneResult = await graphRequest(`${wabaId}/phone_numbers?fields=id,verified_name,display_phone_number,quality_rating,code_verification_status,status&limit=100`, accessToken);
    const phones = Array.isArray(phoneResult.data) ? phoneResult.data : [];
    const selectedPhones = requestedPhoneId ? phones.filter((phone: { id?: string }) => String(phone.id) === requestedPhoneId) : phones;
    if (!selectedPhones.length) throw new Error("No se encontró el número seleccionado dentro de la cuenta de WhatsApp autorizada");

    await graphRequest(`${wabaId}/subscribed_apps`, accessToken, { method: "POST" });
    const admin = createAdminSupabase();
    const saved = [];
    for (const phone of selectedPhones) {
      const phoneId = numericId(phone.id);
      if (!phoneId) continue;
      const connection = await admin.from("channel_connections").upsert({
        tenant_id: membership.tenant_id,
        provider: "whatsapp",
        external_account_id: phoneId,
        status: "active",
        settings: {
          source: "embedded_signup",
          business_id: businessId || numericId(waba.owner_business_info?.id),
          business_name: waba.owner_business_info?.name || "",
          business_account_id: wabaId,
          waba_id: wabaId,
          waba_name: waba.name || "",
          display_name: phone.verified_name || phone.display_phone_number || "WhatsApp",
          display_phone_number: phone.display_phone_number || "",
          quality_rating: phone.quality_rating || "UNKNOWN",
          verification_status: phone.code_verification_status || "UNKNOWN",
          number_status: phone.status || "UNKNOWN",
          connected_by: auth.user.id,
          connected_at: new Date().toISOString()
        }
      }, { onConflict: "tenant_id,provider,external_account_id" }).select("id").single();
      if (connection.error || !connection.data) throw new Error(connection.error?.message || "No se pudo guardar el número");
      const credential = await admin.from("meta_channel_credentials").upsert({
        connection_id: connection.data.id,
        access_token: encryptCredential(accessToken),
        expires_at: tokenResult.expires_in ? new Date(Date.now() + Number(tokenResult.expires_in) * 1000).toISOString() : null
      });
      if (credential.error) throw new Error(credential.error.message);
      saved.push({ id: connection.data.id, phoneNumberId: phoneId, displayName: phone.verified_name || phone.display_phone_number });
    }
    return NextResponse.json({ ok: true, wabaId, businessId: businessId || numericId(waba.owner_business_info?.id), connections: saved });
  } catch (error) {
    reportServerError("meta.embedded_signup", error, { tenantId: membership.tenant_id });
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo completar la conexión" }, { status: 400 });
  }
}
