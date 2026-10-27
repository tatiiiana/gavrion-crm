import { NextResponse } from "next/server";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { encryptCredential } from "@/lib/security/credentials";

function redirect(request: Request, params: Record<string, string>) {
  const url = new URL("/dashboard", request.url);
  url.searchParams.set("view", "calendario");
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
  return NextResponse.redirect(url);
}

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams;
  const code = query.get("code");
  const state = query.get("state");
  if (!code || !state) return redirect(request, { calendar: "error", message: "La autorización fue cancelada." });
  const admin = createAdminSupabase();
  const stateResult = await admin.from("calendar_oauth_states").select("id,tenant_id,user_id,provider,expires_at,used_at").eq("state", state).maybeSingle();
  const saved = stateResult.data;
  if (stateResult.error || !saved || saved.used_at || new Date(saved.expires_at).getTime() < Date.now()) return redirect(request, { calendar: "error", message: "El enlace de autorización expiró. Intenta conectar de nuevo." });
  const actualProvider = String(saved.provider);
  if (actualProvider !== "google") return redirect(request, { calendar: "error", message: "Solo Google Calendar está disponible." });
  const clientId = process.env.GOOGLE_CALENDAR_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CALENDAR_CLIENT_SECRET;
  const origin = new URL(request.url).origin;
  const redirectUri = process.env.GOOGLE_CALENDAR_REDIRECT_URI || `${origin}/api/calendar/callback`;
  if (!clientId || !clientSecret) return redirect(request, { calendar: "error", message: "Faltan las credenciales OAuth de Google Calendar." });
  const tokenUrl = "https://oauth2.googleapis.com/token";
  const body = new URLSearchParams({ client_id: clientId, client_secret: clientSecret, code, redirect_uri: redirectUri, grant_type: "authorization_code" });
  const tokenResponse = await fetch(tokenUrl, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
  const token = await tokenResponse.json().catch(() => ({}));
  if (!tokenResponse.ok || !token.access_token) {
    await admin.from("calendar_oauth_states").update({ used_at: new Date().toISOString() }).eq("id", saved.id);
    return redirect(request, { calendar: "error", message: String(token.error_description || token.error || "Google rechazó la conexión.") });
  }
  try {
    const accessToken = encryptCredential(String(token.access_token));
    const refreshToken = token.refresh_token ? encryptCredential(String(token.refresh_token)) : null;
    const connection = await admin.from("calendar_connections").upsert({ tenant_id: saved.tenant_id, provider: "google", access_token: accessToken, ...(refreshToken ? { refresh_token: refreshToken } : {}), token_expires_at: new Date(Date.now() + Number(token.expires_in || 3600) * 1000).toISOString(), status: "connected", last_error: null, connected_by: saved.user_id, external_calendar_id: "primary" }, { onConflict: "tenant_id,provider" });
    await admin.from("calendar_oauth_states").update({ used_at: new Date().toISOString() }).eq("id", saved.id);
    if (connection.error) return redirect(request, { calendar: "error", message: connection.error.message });
    return redirect(request, { calendar: "connected", provider: "google" });
  } catch (error) {
    await admin.from("calendar_oauth_states").update({ used_at: new Date().toISOString() }).eq("id", saved.id);
    return redirect(request, { calendar: "error", message: error instanceof Error ? error.message : "No se pudo guardar la conexión." });
  }
}