import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { isIP } from "node:net";

const allowedEvents = new Set(["login", "heartbeat", "logout"]);

/** Registra un acceso sin exponer datos de autenticación al navegador. */
export async function POST(request: Request) {
  const supabase = await createServerSupabase();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const eventType = String(body.eventType || "login");
  if (!allowedEvents.has(eventType)) return NextResponse.json({ error: "Evento inválido" }, { status: 400 });

  const { data: memberships, error: membershipError } = await supabase
    .from("memberships")
    .select("tenant_id")
    .eq("user_id", auth.user.id)
    .eq("active", true);
  if (membershipError) return NextResponse.json({ error: membershipError.message }, { status: 400 });
  if (!memberships?.length) return NextResponse.json({ ok: true });

  const candidateIp = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "";
  const ip = isIP(candidateIp) ? candidateIp : null;
  const userAgent = request.headers.get("user-agent")?.slice(0, 500) || null;
  const { error } = await supabase.from("account_access_logs").insert(
    memberships.map(member => ({
      tenant_id: member.tenant_id,
      user_id: auth.user.id,
      event_type: eventType,
      ip_address: ip,
      user_agent: userAgent
    }))
  );
  return error ? NextResponse.json({ error: error.message }, { status: 400 }) : NextResponse.json({ ok: true });
}
