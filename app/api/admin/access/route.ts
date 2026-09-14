import { NextResponse } from "next/server";
import { platformRoleLabels, requirePlatformPermission } from "@/lib/platform-access";

export async function GET() {
  const access = await requirePlatformPermission("companies.read");
  return NextResponse.json({ isPlatformAdmin: access?.role==="superadmin", isPlatformStaff:Boolean(access),role:access?.role||null,roleLabel:access?.role ? platformRoleLabels[access.role] : null,capabilities:access?.capabilities||[] });
}
