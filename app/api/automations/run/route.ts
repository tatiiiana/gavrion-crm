import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { runAutomations } from "@/lib/automations/engine";

export async function POST(request: Request) {
  const supabase = await createServerSupabase();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const { data: membership } = await supabase.from("memberships").select("tenant_id, role").eq("user_id", auth.user.id).limit(1).maybeSingle();
  if (!membership || membership.role === "viewer") return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  const { event, payload } = await request.json();
  if (!["contact_created","deal_won","conversation_handoff"].includes(event)) return NextResponse.json({ error: "Evento inválido" }, { status: 400 });
  await runAutomations({ tenantId: membership.tenant_id, event, payload: payload || {} });
  return NextResponse.json({ ok: true });
}
