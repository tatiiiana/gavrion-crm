import { NextResponse } from "next/server";
import { requirePlatformPermission } from "@/lib/platform-access";

export async function GET(request: Request) {
  const tenantId = new URL(request.url).searchParams.get("tenantId");
  if (!tenantId) return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });
  const access = await requirePlatformPermission("support.open",tenantId);
  if (!access) return NextResponse.json({ error: "No tienes permiso de soporte para esta empresa." }, { status: 403 });
  const { data, error } = await access.admin.from("tenants").select("id,name,logo_url,widget_key,settings,template_key,implementation_status").eq("id", tenantId).maybeSingle();
  if (error || !data) return NextResponse.json({ error: error?.message || "Empresa no encontrada" }, { status: 404 });
  await access.admin.from("audit_logs").insert({ tenant_id: tenantId, actor_user_id: access.user.id, action: "support_access", entity_type: "tenant", entity_id: tenantId, changes: { mode: "platform_support", role:access.role } });
  return NextResponse.json(data);
}
