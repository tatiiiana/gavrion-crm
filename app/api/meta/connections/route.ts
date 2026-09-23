import { NextResponse } from "next/server";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { createServerSupabase } from "@/lib/supabase/server";
import { encryptCredential } from "@/lib/security/credentials";

async function adminContext() {
  const supabase = await createServerSupabase();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return null;
  const { data: membership } = await supabase.from("memberships").select("tenant_id, role").eq("user_id", auth.user.id).eq("active", true).limit(1).maybeSingle();
  if (!membership || !["owner", "admin"].includes(membership.role)) return null;
  return { supabase, membership };
}

export async function GET() {
  const ctx = await adminContext();
  if (!ctx) return NextResponse.json({ error: "Solo administradores" }, { status: 403 });
  const { data, error } = await ctx.supabase.from("channel_connections").select("id, provider, external_account_id, status, settings, created_at").eq("tenant_id", ctx.membership.tenant_id).in("provider", ["whatsapp", "facebook", "instagram"]).order("created_at");
  return error ? NextResponse.json({ error: error.message }, { status: 400 }) : NextResponse.json(data || []);
}

export async function POST(request: Request) {
  const ctx = await adminContext();
  if (!ctx) return NextResponse.json({ error: "Solo administradores" }, { status: 403 });
  const body = await request.json().catch(() => ({}));
  if (body.provider !== "whatsapp" || !body.phoneNumberId || !body.accessToken) return NextResponse.json({ error: "Completa Phone Number ID y token permanente" }, { status: 400 });
  const admin = createAdminSupabase();
  const { data: connection, error } = await admin.from("channel_connections").upsert({ tenant_id: ctx.membership.tenant_id, provider: "whatsapp", external_account_id: String(body.phoneNumberId).trim(), status: "active", settings: { display_name: String(body.displayName || "WhatsApp"), business_account_id: String(body.businessAccountId || "") } }, { onConflict: "tenant_id,provider,external_account_id" }).select("id").single();
  if (error || !connection) return NextResponse.json({ error: error?.message || "No se pudo guardar la conexión" }, { status: 400 });
  try {
    const accessToken = encryptCredential(String(body.accessToken));
    const credential = await admin.from("meta_channel_credentials").upsert({ connection_id: connection.id, access_token: accessToken });
    return credential.error ? NextResponse.json({ error: credential.error.message }, { status: 400 }) : NextResponse.json({ ok: true });
  } catch (cause) {
    return NextResponse.json({ error: cause instanceof Error ? cause.message : "No se pudo cifrar el token" }, { status: 503 });
  }
}

export async function DELETE(request: Request) {
  const ctx = await adminContext();
  if (!ctx) return NextResponse.json({ error: "Solo administradores" }, { status: 403 });
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Falta conexión" }, { status: 400 });
  const { error } = await ctx.supabase.from("channel_connections").delete().eq("id", id).eq("tenant_id", ctx.membership.tenant_id);
  return error ? NextResponse.json({ error: error.message }, { status: 400 }) : NextResponse.json({ ok: true });
}
