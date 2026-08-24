import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";

export async function PATCH(request: Request) {
  const supabase = await createServerSupabase();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const { conversationId, assignedTo } = await request.json();
  const { data: membership } = await supabase.from("memberships").select("tenant_id, role").eq("user_id", auth.user.id).limit(1).maybeSingle();
  if (!membership || !conversationId) return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });
  if (membership.role === "viewer") return NextResponse.json({ error: "Tu rol es únicamente de consulta" }, { status: 403 });
  if (assignedTo) {
    const { data: target } = await supabase.from("memberships").select("user_id").eq("tenant_id", membership.tenant_id).eq("user_id", assignedTo).maybeSingle();
    if (!target) return NextResponse.json({ error: "El responsable no pertenece a esta empresa" }, { status: 400 });
  }
  const { data, error } = await supabase.from("conversations").update({ assigned_to: assignedTo || null, handling_mode: assignedTo ? "human" : "bot" }).eq("id", conversationId).eq("tenant_id", membership.tenant_id).select("id, assigned_to, handling_mode").single();
  return error ? NextResponse.json({ error: error.message }, { status: 400 }) : NextResponse.json(data);
}
