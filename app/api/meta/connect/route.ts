import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { createServerSupabase } from "@/lib/supabase/server";
import { graphVersion } from "@/lib/meta/client";

export async function GET(request: Request) {
  const appId = process.env.META_APP_ID;
  if (!appId) return NextResponse.json({ error: "Falta META_APP_ID" }, { status: 503 });
  const supabase = await createServerSupabase();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.redirect(new URL("/login", request.url));
  const { data: membership } = await supabase.from("memberships").select("tenant_id, role").eq("user_id", auth.user.id).limit(1).maybeSingle();
  if (!membership || !["owner","admin"].includes(membership.role)) return NextResponse.json({ error: "Solo administradores" }, { status: 403 });
  const state = randomUUID();
  const admin = createAdminSupabase();
  await admin.from("meta_oauth_states").insert({ state, tenant_id: membership.tenant_id, user_id: auth.user.id, expires_at: new Date(Date.now() + 10 * 60_000).toISOString() });
  const redirectUri = process.env.META_REDIRECT_URI || `${new URL(request.url).origin}/api/meta/callback`;
  // Instagram Login usa un flujo y permisos distintos. Este OAuth es solo
  // para Facebook Pages/Messenger; incluir permisos de Instagram aquí hace
  // que Meta rechace toda la autorización como "Invalid Scopes".
  const scopes = ["pages_show_list","pages_messaging","pages_manage_metadata","business_management"].join(",");
  const dialog = new URL(`https://www.facebook.com/${graphVersion}/dialog/oauth`);
  dialog.searchParams.set("client_id", appId); dialog.searchParams.set("redirect_uri", redirectUri); dialog.searchParams.set("state", state); dialog.searchParams.set("scope", scopes); dialog.searchParams.set("response_type", "code");
  if (new URL(request.url).searchParams.get("mode") === "json") return NextResponse.json({ url: dialog.toString() });
  return NextResponse.redirect(dialog);
}
