import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { createAdminSupabase } from "@/lib/supabase/admin";

export async function GET(){
  const server=await createServerSupabase();
  const {data:auth}=await server.auth.getUser();
  if(!auth.user)return NextResponse.json({allowed:false,status:"unauthenticated"},{status:401});
  const admin=createAdminSupabase();
  const {data:membership}=await admin.from("memberships").select("tenant_id,role").eq("user_id",auth.user.id).limit(1).maybeSingle();
  if(!membership)return NextResponse.json({allowed:false,status:"no_company"});
  const {data:tenant}=await admin.from("tenants").select("name,implementation_status,status_reason").eq("id",membership.tenant_id).maybeSingle();
  const allowed=Boolean(tenant&&["ready","production"].includes(tenant.implementation_status));
  return NextResponse.json({allowed,status:tenant?.implementation_status||"unknown",company:tenant?.name||"",reason:tenant?.status_reason||""});
}
