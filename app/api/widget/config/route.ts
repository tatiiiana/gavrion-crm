import { NextResponse } from "next/server";
import { createAdminSupabase } from "@/lib/supabase/admin";

export const runtime = "nodejs";

function cors(origin: string | null) {
  return { "Access-Control-Allow-Origin": origin || "*", "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Allow-Headers": "Content-Type", Vary: "Origin" };
}

export async function OPTIONS(request: Request) {
  return new Response(null, { status: 204, headers: cors(request.headers.get("origin")) });
}

export async function GET(request: Request) {
  const origin = request.headers.get("origin");
  const key = new URL(request.url).searchParams.get("key");
  if (!key) return NextResponse.json({ error: "Falta la clave del widget" }, { status: 400, headers: cors(origin) });
  const supabase = createAdminSupabase();
  const { data: tenant } = await supabase.from("tenants").select("name, logo_url, settings").eq("widget_key", key).maybeSingle();
  if (!tenant) return NextResponse.json({ error: "Widget no disponible" }, { status: 404, headers: cors(origin) });
  const settings = tenant.settings || {};
  return NextResponse.json({
    company: tenant.name,
    logoUrl: tenant.logo_url || "",
    welcome: settings.widget_welcome || `Hola, ¿cómo podemos ayudarte en ${tenant.name}?`,
    color: settings.widget_color || "#087f69"
  }, { headers: cors(origin) });
}

