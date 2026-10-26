import { NextResponse } from "next/server";
import { requireTenantCapability } from "@/lib/tenant-access";

export async function GET() {
  const access = await requireTenantCapability("settings");
  if (!access) return NextResponse.json({ error: "Solo administradores" }, { status: 403 });
  const { data, error } = await access.supabase.from("calendar_connections").select("provider,status,last_error,token_expires_at,external_calendar_id,updated_at").eq("tenant_id", access.membership.tenant_id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ connections: data || [] });
}