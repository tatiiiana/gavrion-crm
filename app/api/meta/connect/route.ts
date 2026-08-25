import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { createServerSupabase } from "@/lib/supabase/server";
import { graphBase, graphVersion } from "@/lib/meta/client";

export async function GET(request: Request) {
  const cleanEnv = (value?: string) => value?.trim().replace(/^['"]|['"]$/g, "") || "";
  const appId = cleanEnv(process.env.META_APP_ID);
  const appSecret = cleanEnv(process.env.META_APP_SECRET);
  if (!appId) return NextResponse.json({ error: "Falta META_APP_ID" }, { status: 503 });
  if (!appSecret) return NextResponse.json({ error: "Falta META_APP_SECRET" }, { status: 503 });
  const supabase = await createServerSupabase();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.redirect(new URL("/login", request.url));
  const { data: membership } = await supabase.from("memberships").select("tenant_id, role").eq("user_id", auth.user.id).limit(1).maybeSingle();
  if (!membership || !["owner","admin"].includes(membership.role)) return NextResponse.json({ error: "Solo administradores" }, { status: 403 });
  const validationUrl = new URL(`${graphBase}/oauth/access_token`);
  validationUrl.searchParams.set("client_id", appId);
  validationUrl.searchParams.set("client_secret", appSecret);
  validationUrl.searchParams.set("grant_type", "client_credentials");
  const validationResponse = await fetch(validationUrl, { cache: "no-store" });
  if (!validationResponse.ok) {
    const validation = await validationResponse.json().catch(() => ({}));
    return NextResponse.json({ error: `Meta rechazó META_APP_ID/META_APP_SECRET: ${validation.error?.message || "credenciales inválidas"}. Revisa el entorno del último despliegue en Vercel.` }, { status: 503 });
  }
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
  dialog.searchParams.set("auth_type", "rerequest");
  dialog.searchParams.set("return_scopes", "true");
  if (new URL(request.url).searchParams.get("mode") === "json") return NextResponse.json({ url: dialog.toString() });
  return NextResponse.redirect(dialog);
}
