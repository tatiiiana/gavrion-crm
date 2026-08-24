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
  const { data: tenant } = await supabase.from("tenants").select("id, name, logo_url, settings").eq("widget_key", key).maybeSingle();
  if (!tenant) return NextResponse.json({ error: "Widget no disponible" }, { status: 404, headers: cors(origin) });
  const { data: profile } = await supabase.from("company_profiles").select("timezone, business_hours").eq("tenant_id", tenant.id).maybeSingle();
  const settings = tenant.settings || {};
  const timezone = profile?.timezone || "America/Tegucigalpa";
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, weekday: "long", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date());
  const day = parts.find(part => part.type === "weekday")?.value.toLowerCase() || "monday";
  const currentTime = `${parts.find(part => part.type === "hour")?.value || "00"}:${parts.find(part => part.type === "minute")?.value || "00"}`;
  const hours = profile?.business_hours?.[day];
  const isOpen = !hours || (!hours.closed && currentTime >= hours.open && currentTime <= hours.close);
  return NextResponse.json({
    company: tenant.name,
    logoUrl: tenant.logo_url || "",
    welcome: settings.widget_welcome || `Hola, ¿cómo podemos ayudarte en ${tenant.name}?`,
    color: settings.widget_color || "#087f69",
    statusMessage: isOpen ? (settings.widget_status_message || "Normalmente respondemos pronto") : (settings.widget_offline_message || "Estamos fuera de horario. Déjanos tu mensaje."),
    position: settings.widget_position === "left" ? "left" : "right",
    launcher: settings.widget_launcher || "✦",
    isOpen
  }, { headers: cors(origin) });
}
