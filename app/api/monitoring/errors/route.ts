import { NextResponse } from "next/server";
import { reportServerError } from "@/lib/monitoring";
import { createServerSupabase } from "@/lib/supabase/server";

export async function POST(request: Request) {
  if (Number(request.headers.get("content-length") || 0) > 32_000) return NextResponse.json({ error: "Evento demasiado grande" }, { status: 413 });
  const supabase = await createServerSupabase();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  const eventId = reportServerError(`client:${String(body.route || "unknown").slice(0,120)}`, String(body.message || "Error del navegador"), { userId: auth.user.id, stack: String(body.stack || "").slice(0, 1000) });
  return NextResponse.json({ ok: true, eventId }, { status: 202 });
}
