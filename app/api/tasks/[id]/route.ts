import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return NextResponse.json({ demo: true });
  const supabase = await createServerSupabase();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const { id } = await params;
  const body = await request.json();
  const { data, error } = await supabase.from("tasks").update({ completed_at: body.completed_at }).eq("id", id).select().single();
  return error ? NextResponse.json({ error: error.message }, { status: 400 }) : NextResponse.json(data);
}
