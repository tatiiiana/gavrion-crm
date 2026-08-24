import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";

async function context(admin = false) {
  const supabase = await createServerSupabase();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return null;
  const { data: membership } = await supabase.from("memberships").select("tenant_id, role").eq("user_id", auth.user.id).limit(1).maybeSingle();
  if (!membership || (admin && !["owner","admin"].includes(membership.role))) return null;
  return { supabase, user: auth.user, membership };
}

export async function GET() {
  const ctx = await context(); if (!ctx) return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  const [flows, runs] = await Promise.all([
    ctx.supabase.from("automation_flows").select("id, name, trigger_event, conditions, actions, enabled, created_at").eq("tenant_id", ctx.membership.tenant_id).order("created_at", { ascending: false }),
    ctx.supabase.from("automation_runs").select("id, flow_id, event_type, status, error_message, created_at").eq("tenant_id", ctx.membership.tenant_id).order("created_at", { ascending: false }).limit(50)
  ]);
  if (flows.error || runs.error) return NextResponse.json({ error: flows.error?.message || runs.error?.message }, { status: 400 });
  return NextResponse.json({ flows: flows.data, runs: runs.data });
}

export async function POST(request: Request) {
  const ctx = await context(true); if (!ctx) return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  const body = await request.json();
  if (!body.name || !["message_received","contact_created","deal_won","conversation_handoff"].includes(body.triggerEvent)) return NextResponse.json({ error: "Flujo inválido" }, { status: 400 });
  const { data, error } = await ctx.supabase.from("automation_flows").insert({ tenant_id: ctx.membership.tenant_id, name: String(body.name).trim(), trigger_event: body.triggerEvent, conditions: body.conditions || [], actions: body.actions || [], enabled: true, created_by: ctx.user.id }).select().single();
  return error ? NextResponse.json({ error: error.message }, { status: 400 }) : NextResponse.json(data, { status: 201 });
}

export async function PATCH(request: Request) {
  const ctx = await context(true); if (!ctx) return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  const { id, enabled } = await request.json();
  const { data, error } = await ctx.supabase.from("automation_flows").update({ enabled: Boolean(enabled) }).eq("id", id).eq("tenant_id", ctx.membership.tenant_id).select().single();
  return error ? NextResponse.json({ error: error.message }, { status: 400 }) : NextResponse.json(data);
}

