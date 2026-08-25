import { NextResponse } from "next/server";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { graphBase, graphRequest } from "@/lib/meta/client";

export async function GET(request: Request) {
  const url = new URL(request.url); const code = url.searchParams.get("code"); const state = url.searchParams.get("state"); const errorMessage = url.searchParams.get("error_description");
  const finish = (status: string) => NextResponse.redirect(new URL(`/dashboard?meta=${encodeURIComponent(status)}`, url.origin));
  if (errorMessage) return finish(errorMessage); if (!code || !state) return finish("respuesta-invalida");
  const admin = createAdminSupabase();
  const { data: oauth } = await admin.from("meta_oauth_states").select("tenant_id, user_id, expires_at, used_at").eq("state", state).maybeSingle();
  if (!oauth || oauth.used_at || new Date(oauth.expires_at) < new Date()) return finish("estado-invalido");
  await admin.from("meta_oauth_states").update({ used_at: new Date().toISOString() }).eq("state", state);
  try {
    const appId = process.env.META_APP_ID!; const secret = process.env.META_APP_SECRET!; const redirectUri = process.env.META_REDIRECT_URI || `${url.origin}/api/meta/callback`;
    const tokenResponse = await fetch(`${graphBase}/oauth/access_token?client_id=${encodeURIComponent(appId)}&client_secret=${encodeURIComponent(secret)}&redirect_uri=${encodeURIComponent(redirectUri)}&code=${encodeURIComponent(code)}`);
    const token = await tokenResponse.json(); if (!tokenResponse.ok) throw new Error(token.error?.message || "No se obtuvo el token");
    let userToken = token.access_token as string; let expiresIn = Number(token.expires_in || 3600);
    try { const long = await graphRequest(`oauth/access_token?grant_type=fb_exchange_token&client_id=${encodeURIComponent(appId)}&client_secret=${encodeURIComponent(secret)}&fb_exchange_token=${encodeURIComponent(userToken)}`, userToken); userToken = long.access_token || userToken; expiresIn = Number(long.expires_in || expiresIn); } catch { /* Algunas cuentas ya entregan token extendido. */ }
    const accounts = await graphRequest("me/accounts?fields=id,name,access_token,instagram_business_account{id,username,name,profile_picture_url}&limit=100", userToken);
    for (const page of accounts.data || []) {
      const pageConnection = await admin.from("channel_connections").upsert({ tenant_id: oauth.tenant_id, provider: "facebook", external_account_id: page.id, status: "active", settings: { display_name: page.name } }, { onConflict: "tenant_id,provider,external_account_id" }).select("id").single();
      if (pageConnection.data) await admin.from("meta_channel_credentials").upsert({ connection_id: pageConnection.data.id, access_token: page.access_token, expires_at: new Date(Date.now() + expiresIn * 1000).toISOString() });
      await graphRequest(`${page.id}/subscribed_apps?subscribed_fields=messages,messaging_postbacks,message_deliveries,message_reads`, page.access_token, { method: "POST" });
      const ig = page.instagram_business_account;
      if (ig?.id) { const igConnection = await admin.from("channel_connections").upsert({ tenant_id: oauth.tenant_id, provider: "instagram", external_account_id: ig.id, status: "active", settings: { display_name: ig.username || ig.name || "Instagram", page_id: page.id } }, { onConflict: "tenant_id,provider,external_account_id" }).select("id").single(); if (igConnection.data) await admin.from("meta_channel_credentials").upsert({ connection_id: igConnection.data.id, access_token: page.access_token, expires_at: new Date(Date.now() + expiresIn * 1000).toISOString() }); }
    }
    return finish("connected");
  } catch (error) { return finish(error instanceof Error ? error.message : "error"); }
}

