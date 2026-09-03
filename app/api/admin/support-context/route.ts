import { NextResponse } from "next/server";
import { requirePlatformAdmin } from "@/lib/platform-admin";

export async function GET(request: Request) {
  const access = await requirePlatformAdmin();
  if (!access) return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  const tenantId = new URL(request.url).searchParams.get("tenantId");
  if (!tenantId) return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });
  const { data, error } = await access.admin.from("tenants").select("id,name,logo_url,widget_key,settings,template_key,implementation_status").eq("id", tenantId).maybeSingle();
  if (error || !data) return NextResponse.json({ error: error?.message || "Empresa no encontrada" }, { status: 404 });
  await access.admin.from("audit_logs").insert({ tenant_id: tenantId, actor_user_id: access.user.id, action: "support_access", entity_type: "tenant", entity_id: tenantId, changes: { mode: "platform_admin" } });
  return NextResponse.json(data);
}
