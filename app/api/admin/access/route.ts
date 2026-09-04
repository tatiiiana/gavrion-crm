import { NextResponse } from "next/server";
import { requirePlatformPermission } from "@/lib/platform-access";

export async function GET() {
  const access = await requirePlatformPermission("companies.read");
  return NextResponse.json({ isPlatformAdmin: access?.role==="superadmin", isPlatformStaff:Boolean(access),role:access?.role||null,capabilities:access?.capabilities||[] });
}
