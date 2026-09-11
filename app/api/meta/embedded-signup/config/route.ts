import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";

const cleanEnv = (value?: string) => value?.trim().replace(/^['"]|['"]$/g, "") || "";

export async function GET() {
  const supabase = await createServerSupabase();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const { data: membership } = await supabase
    .from("memberships")
    .select("tenant_id, role")
    .eq("user_id", auth.user.id)
    .limit(1)
    .maybeSingle();
  if (!membership || !["owner", "admin"].includes(membership.role)) {
    return NextResponse.json({ error: "Solo propietarios y administradores pueden conectar WhatsApp" }, { status: 403 });
  }

  const appId = cleanEnv(process.env.META_APP_ID);
  const configId = cleanEnv(process.env.META_WHATSAPP_CONFIG_ID);
  if (!appId || !configId) {
    return NextResponse.json({
      error: "Falta configurar META_APP_ID o META_WHATSAPP_CONFIG_ID en Vercel."
    }, { status: 503 });
  }

  return NextResponse.json({ appId, configId, graphVersion: process.env.META_GRAPH_VERSION || "v23.0" });
}
