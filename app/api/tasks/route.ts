import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";

export async function POST(request: Request) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return NextResponse.json({ demo: true }, { status: 202 });
  const supabase = await createServerSupabase();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const { data: membership } = await supabase.from("memberships").select("tenant_id").eq("user_id", auth.user.id).limit(1).single();
  if (!membership) return NextResponse.json({ error: "Usuario sin empresa" }, { status: 403 });
  const body = await request.json();
  const { data, error } = await supabase.from("tasks").insert({ tenant_id: membership.tenant_id, title: body.title, due_at: body.due_at, assigned_to: auth.user.id }).select().single();
  return error ? NextResponse.json({ error: error.message }, { status: 400 }) : NextResponse.json(data, { status: 201 });
}
