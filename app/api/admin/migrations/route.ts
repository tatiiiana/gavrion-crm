import { NextResponse } from "next/server";
import { requirePlatformPermission } from "@/lib/platform-access";

export async function GET() {
  const access = await requirePlatformPermission("templates.read");
  if (!access) return NextResponse.json({ error:"Acceso exclusivo para personal autorizado." }, { status:403 });
  const checks = [
    ["007_reservations_orders", "reservations", "id,tenant_id,status"],
    ["017_lifecycle_operational_modules", "appointments", "id,tenant_id,status"],
    ["015_superadmin_implementations", "platform_admins", "user_id"],
    ["016_template_cloner", "implementation_templates", "id,current_version"],
    ["021_platform_roles_site_catalog", "platform_staff", "user_id,role"],
    ["022_template_management", "implementation_template_versions", "id,template_id,version"],
    ["023_platform_template_audit_bootstrap", "platform_audit_logs", "id,action,created_at"],
    ["024_implementation_customizations", "implementation_customizations", "id,tenant_id,template_id,status"]
  ] as const;
  const results = await Promise.all(checks.map(async ([migration, table, columns]) => {
    const { error } = await access.admin.from(table).select(columns).limit(1);
    return { migration, table, applied:!error, error:error?.message || null };
  }));
  return NextResponse.json({ checkedAt:new Date().toISOString(), allApplied:results.every(item=>item.applied), migrations:results });
}
