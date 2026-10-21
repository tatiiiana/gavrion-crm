import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";

const areaEntities: Record<string, string[]> = {
  conversation: ["conversations", "messages", "conversation_reads"],
  contact: ["contacts"],
  configuration: ["tenants", "company_profiles", "memberships", "account", "assistant_settings", "knowledge_documents", "automation_flows"],
  integration: ["channel_connections", "meta_channel_credentials", "meta_oauth_states"],
  team: ["memberships"]
};

export async function GET(request: Request) {
  const supabase = await createServerSupabase();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const { data: membership } = await supabase.from("memberships").select("tenant_id, role").eq("user_id", auth.user.id).eq("active", true).limit(1).maybeSingle();
  if (!membership || !["owner", "admin"].includes(membership.role)) return NextResponse.json({ error: "Solo administradores" }, { status: 403 });

  const url = new URL(request.url);
  let query = supabase.from("audit_logs").select("id, actor_user_id, action, entity_type, entity_id, changes, created_at").eq("tenant_id", membership.tenant_id).order("created_at", { ascending: false }).limit(300);
  const entity = url.searchParams.get("entity");
  const area = url.searchParams.get("area");
  const actor = url.searchParams.get("actor");
  const action = url.searchParams.get("action");
  const record = url.searchParams.get("record");
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  if (entity && /^[a-z_]{2,60}$/.test(entity)) query = query.eq("entity_type", entity);
  else if (area && areaEntities[area]) query = query.in("entity_type", areaEntities[area]);
  if (actor && /^[0-9a-f-]{36}$/i.test(actor)) query = query.eq("actor_user_id", actor);
  if (action && ["insert", "update", "delete"].includes(action)) query = query.eq("action", action);
  if (record && /^[0-9a-z_-]{2,120}$/i.test(record)) query = query.ilike("entity_id", `%${record}%`);
  if (from && /^\d{4}-\d{2}-\d{2}$/.test(from)) query = query.gte("created_at", `${from}T00:00:00`);
  if (to && /^\d{4}-\d{2}-\d{2}$/.test(to)) query = query.lte("created_at", `${to}T23:59:59.999`);
  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(data || []);
}
