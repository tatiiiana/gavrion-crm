import { NextResponse } from "next/server";
import { requirePlatformPermission } from "@/lib/platform-access";

export async function GET(request: Request) {
  const access = await requirePlatformPermission("templates.read");
  if (!access) return NextResponse.json({ error: "Acceso exclusivo para personal autorizado." }, { status: 403 });
  const url = new URL(request.url);
  let query = access.admin.from("platform_audit_logs").select("id,actor_user_id,target_tenant_id,action,entity_type,entity_id,changes,created_at").order("created_at", { ascending:false }).limit(300);
  const entity = url.searchParams.get("entity");
  if (entity) query = query.eq("entity_type", entity);
  const { data, error } = await query;
  return error ? NextResponse.json({ error:error.message }, { status:400 }) : NextResponse.json(data || []);
}
