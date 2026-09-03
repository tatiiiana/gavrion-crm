import { NextResponse } from "next/server";
import { requirePlatformAdmin } from "@/lib/platform-admin";

export async function GET() {
  const access = await requirePlatformAdmin();
  return NextResponse.json({ isPlatformAdmin: Boolean(access) });
}
