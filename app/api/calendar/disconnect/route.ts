import { NextResponse } from "next/server";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { requireTenantCapability } from "@/lib/tenant-access";

/** Desvincula el calendario de Google de la empresa actual. */
export async function DELETE() {
  const access = await requireTenantCapability("settings");
  if (!access) return NextResponse.json({ error: "Solo los administradores pueden gestionar esta conexión." }, { status: 403 });

  const admin = createAdminSupabase();
  const tenantId = access.membership.tenant_id;
  const { data: connection } = await admin
    .from("calendar_connections")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("provider", "google")
    .maybeSingle();

  const { error } = await admin
    .from("calendar_connections")
    .delete()
    .eq("tenant_id", tenantId)
    .eq("provider", "google");
  if (error) return NextResponse.json({ error: "No se pudo desvincular Google Calendar." }, { status: 400 });

  await admin.from("audit_logs").insert({
    tenant_id: tenantId,
    actor_user_id: access.user.id,
    action: "disconnect",
    entity_type: "calendar_connection",
    entity_id: connection?.id || tenantId,
    changes: { provider: "google" }
  });

  return NextResponse.json({ ok: true });
}