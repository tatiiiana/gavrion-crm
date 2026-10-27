import { NextResponse } from "next/server";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { decryptCredential, encryptCredential } from "@/lib/security/credentials";
import { requireTenantCapability } from "@/lib/tenant-access";

type Connection = { id: string; provider: "google"; access_token: string; refresh_token: string | null; token_expires_at: string | null; external_calendar_id: string };
type ExternalEvent = { id: string; title: string; start: string; end?: string | null; detail?: string; status?: string | null; sourceId: string; editable: false; kind: "external" };

async function refresh(connection: Connection) {
  if (!connection.token_expires_at || new Date(connection.token_expires_at).getTime() > Date.now() + 60_000) return { token: decryptCredential(connection.access_token), refreshToken: connection.refresh_token };
  if (!connection.refresh_token) throw new Error("La conexión no tiene refresh token; vuelve a conectarla.");
  const clientId = process.env.GOOGLE_CALENDAR_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CALENDAR_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("Faltan las credenciales OAuth de Google Calendar.");
  const body = new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: decryptCredential(connection.refresh_token), grant_type: "refresh_token" });
  const response = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token) throw new Error(String(data.error_description || data.error || "No se pudo renovar el token de Google Calendar."));
  const admin = createAdminSupabase();
  await admin.from("calendar_connections").update({ access_token: encryptCredential(String(data.access_token)), token_expires_at: new Date(Date.now() + Number(data.expires_in || 3600) * 1000).toISOString(), status: "connected", last_error: null }).eq("id", connection.id);
  return { token: String(data.access_token), refreshToken: connection.refresh_token };
}

async function readProvider(connection: Connection, token: string, timeMin: string, timeMax: string) {
  const url = new URL(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(connection.external_calendar_id || "primary")}/events`);
  url.searchParams.set("singleEvents", "true"); url.searchParams.set("orderBy", "startTime"); url.searchParams.set("timeMin", timeMin); url.searchParams.set("timeMax", timeMax); url.searchParams.set("maxResults", "250");
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(String(data.error?.message || "Google Calendar rechazó la consulta."));
  return (data.items || []).filter((item: any) => item.status !== "cancelled").map((item: any) => ({ id: String(item.id), title: String(item.summary || "Evento de Google Calendar"), start: item.start?.dateTime || `${item.start?.date}T00:00:00`, end: item.end?.dateTime || (item.end?.date ? `${item.end.date}T00:00:00` : null), detail: item.location || item.description || "Google Calendar", status: item.status || "confirmed" }));
}

export async function POST() {
  const access = await requireTenantCapability("settings");
  if (!access) return NextResponse.json({ error: "Solo administradores" }, { status: 403 });
  const admin = createAdminSupabase();
  const { data: connections, error } = await admin.from("calendar_connections").select("id,provider,access_token,refresh_token,token_expires_at,external_calendar_id").eq("tenant_id", access.membership.tenant_id).eq("provider", "google").in("status", ["connected", "error"]);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  const timeMin = new Date(Date.now() - 30 * 86400000).toISOString();
  const timeMax = new Date(Date.now() + 180 * 86400000).toISOString();
  const externalEvents: ExternalEvent[] = [];
  for (const connection of (connections || []) as Connection[]) {
    try {
      const refreshed = await refresh(connection);
      const rows = await readProvider(connection, refreshed.token, timeMin, timeMax);
      for (const row of rows) {
        await admin.from("calendar_external_events").upsert({ connection_id: connection.id, external_id: row.id, title: row.title, starts_at: new Date(row.start).toISOString(), ends_at: row.end ? new Date(row.end).toISOString() : null, detail: row.detail || null, status: row.status || null, payload: row }, { onConflict: "connection_id,external_id" });
        externalEvents.push({ id: `external-google-${row.id}`, kind: "external", title: row.title, start: row.start, end: row.end, detail: row.detail, status: row.status, sourceId: connection.id, editable: false });
      }
      await admin.from("calendar_connections").update({ status: "connected", last_error: null }).eq("id", connection.id);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "No se pudo sincronizar";
      await admin.from("calendar_connections").update({ status: "error", last_error: message }).eq("id", connection.id);
    }
  }
  return NextResponse.json({ events: externalEvents, syncedAt: new Date().toISOString() });
}