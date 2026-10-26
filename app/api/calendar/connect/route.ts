import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { requireTenantCapability } from "@/lib/tenant-access";

function config(provider: string) {
  if (provider === "google") return { clientId: process.env.GOOGLE_CALENDAR_CLIENT_ID, redirect: process.env.GOOGLE_CALENDAR_REDIRECT_URI, authorization: "https://accounts.google.com/o/oauth2/v2/auth", scope: "https://www.googleapis.com/auth/calendar.events" };
  return { clientId: process.env.MICROSOFT_CALENDAR_CLIENT_ID, redirect: process.env.MICROSOFT_CALENDAR_REDIRECT_URI, authorization: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize", scope: "offline_access Calendars.ReadWrite User.Read" };
}

export async function GET(request: Request) {
  const access = await requireTenantCapability("settings");
  if (!access) return NextResponse.json({ error: "Solo administradores" }, { status: 403 });
  const provider = new URL(request.url).searchParams.get("provider") || "";
  if (!["google", "microsoft"].includes(provider)) return NextResponse.json({ error: "Proveedor inválido" }, { status: 400 });
  const settings = config(provider);
  if (!settings.clientId || !settings.redirect) return NextResponse.json({ error: `Configura las variables OAuth de ${provider} en Vercel antes de conectar.` }, { status: 503 });
  const state = randomUUID();
  const admin = createAdminSupabase();
  const result = await admin.from("calendar_oauth_states").insert({ state, tenant_id: access.membership.tenant_id, user_id: access.user.id, provider, expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString() });
  if (result.error) return NextResponse.json({ error: result.error.message }, { status: 400 });
  const origin = new URL(request.url).origin;
  const redirectUri = settings.redirect || `${origin}/api/calendar/callback`;
  const params = new URLSearchParams({ client_id: settings.clientId, redirect_uri: redirectUri, response_type: "code", scope: settings.scope, state });
  if (provider === "google") { params.set("access_type", "offline"); params.set("prompt", "consent"); }
  else params.set("response_mode", "query");
  return NextResponse.redirect(`${settings.authorization}?${params.toString()}`);
}