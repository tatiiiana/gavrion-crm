import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const supabase = await createServerSupabase();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!process.env.OPENAI_API_KEY) return NextResponse.json({ error: "OpenAI no está configurado" }, { status: 503 });
  const { message, context = [] } = await request.json();
  const response = await fetch("https://api.openai.com/v1/responses", { method: "POST", headers: { "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: process.env.OPENAI_MODEL || "gpt-4.1-mini", instructions: "Eres un asistente comercial profesional. No inventes precios, existencias ni políticas. Responde en español con claridad.", input: [...context, { role: "user", content: message }] }) });
  const result = await response.json();
  if (!response.ok) return NextResponse.json({ error: "No se pudo generar la respuesta" }, { status: 502 });
  return NextResponse.json({ reply: result.output_text, response_id: result.id });
}
