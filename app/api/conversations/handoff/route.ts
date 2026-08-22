import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";

export async function PATCH(request: Request) {
  const supabase = await createServerSupabase();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const { conversationId, mode } = await request.json();
  if (!conversationId || !["bot", "human"].includes(mode)) return NextResponse.json({ error: "Modo inválido" }, { status: 400 });
  const status = mode === "human" ? "open" : "open";
  const { data, error } = await supabase.from("conversations").update({ handling_mode: mode, status, assigned_to: mode === "human" ? auth.user.id : null }).eq("id", conversationId).select("id, handling_mode").single();
  return error ? NextResponse.json({ error: error.message }, { status: 400 }) : NextResponse.json(data);
}

