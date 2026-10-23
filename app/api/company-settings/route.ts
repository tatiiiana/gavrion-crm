import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { syncAssignedSiteFromCompanySettings } from "@/lib/site-binding";
import { republishAssignedSite } from "@/lib/site-publisher";

async function context() {
  const supabase = await createServerSupabase();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return null;
  const { data: membership } = await supabase.from("memberships").select("tenant_id, role").eq("user_id", auth.user.id).eq("active", true).limit(1).maybeSingle();
  if (!membership || !["owner", "admin"].includes(membership.role)) return null;
  return { supabase, membership, userId: auth.user.id };
}

export async function GET() {
  const ctx = await context();
  if (!ctx) return NextResponse.json({ error: "Solo administradores" }, { status: 403 });
  const [tenant, profile] = await Promise.all([
    ctx.supabase.from("tenants").select("id, name, logo_url, custom_domain, settings").eq("id", ctx.membership.tenant_id).single(),
    ctx.supabase.from("company_profiles").select("tenant_id, legal_name, tax_id, legal_address, phone, public_email, website, timezone, business_hours, responsible_user_id, updated_at").eq("tenant_id", ctx.membership.tenant_id).maybeSingle(),
  ]);
  if (tenant.error) return NextResponse.json({ error: tenant.error.message }, { status: 400 });
  return NextResponse.json({ tenant: tenant.data, profile: profile.data || {} });
}

export async function PATCH(request: Request) {
  const ctx = await context();
  if (!ctx) return NextResponse.json({ error: "Solo administradores" }, { status: 403 });
  const body = await request.json().catch(() => ({}));
  const color = String(body.widgetColor || "#087f69");
  if (!/^#[0-9a-f]{6}$/i.test(color)) return NextResponse.json({ error: "Color hexadecimal inválido" }, { status: 400 });
  const domain = String(body.customDomain || "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/$/, "");
  if (domain && !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain)) return NextResponse.json({ error: "Dominio inválido" }, { status: 400 });
  if (body.responsibleUserId) {
    const { data: member } = await ctx.supabase.from("memberships").select("user_id").eq("tenant_id", ctx.membership.tenant_id).eq("user_id", body.responsibleUserId).maybeSingle();
    if (!member) return NextResponse.json({ error: "Responsable inválido" }, { status: 400 });
  }
  const { data: current } = await ctx.supabase.from("tenants").select("settings").eq("id", ctx.membership.tenant_id).single();
  const settings = { ...(current?.settings || {}), widget_color: color, widget_welcome: String(body.widgetWelcome || "").slice(0, 300), widget_status_message: String(body.widgetStatusMessage || "").slice(0, 120), widget_offline_message: String(body.widgetOfflineMessage || "").slice(0, 300), widget_position: body.widgetPosition === "left" ? "left" : "right", widget_launcher: String(body.widgetLauncher || "✦").slice(0, 4) };
  const tenant = await ctx.supabase.from("tenants").update({ name: String(body.companyName || "").trim(), logo_url: body.logoUrl || null, custom_domain: domain || null, settings }).eq("id", ctx.membership.tenant_id);
  if (tenant.error) return NextResponse.json({ error: tenant.error.message }, { status: 400 });
  const profile = await ctx.supabase.from("company_profiles").upsert({ tenant_id: ctx.membership.tenant_id, legal_name: body.legalName || null, tax_id: body.taxId || null, legal_address: body.legalAddress || null, phone: body.phone || null, public_email: body.publicEmail || null, website: body.website || null, timezone: body.timezone || "America/Tegucigalpa", business_hours: body.businessHours || {}, responsible_user_id: body.responsibleUserId || null }, { onConflict: "tenant_id" });
  if (profile.error) return NextResponse.json({ error: profile.error.message }, { status: 400 });

  // La configuración del dueño también actualiza el proyecto web único de su empresa.
  // El servicio se ejecuta con la clave privada solo en el servidor; nunca se expone al navegador.
  let siteSync: { updated: boolean; reason?: string; siteProjectId?: string; version?: number; siteProject?: { id: string; tenant_id: string; name: string; template_key: string; configuration: Record<string, unknown>; status?: string; vercel_project_id?: string | null; custom_domain?: string | null }; republished?: boolean } = { updated: false, reason: "not_attempted" };
  try {
    const admin = createAdminSupabase();
    siteSync = await syncAssignedSiteFromCompanySettings(
      admin,
      ctx.membership.tenant_id,
      {
        companyName: body.companyName,
        logoUrl: body.logoUrl,
        widgetColor: color,
        customDomain: domain,
        legalAddress: body.legalAddress,
        phone: body.phone,
        publicEmail: body.publicEmail,
        website: body.website,
        businessHours: body.businessHours || {},
      },
      ctx.userId,
    );
    if (siteSync.updated && siteSync.siteProject?.status === "published" && siteSync.siteProject.vercel_project_id) {
      try {
        await republishAssignedSite(admin, siteSync.siteProject, request.url);
        siteSync.republished = true;
      } catch (error) {
        console.error("company_settings_site_republish_failed", error);
        siteSync.republished = false;
        siteSync.reason = "republish_failed";
      }
    }
  } catch (error) {
    console.error("company_settings_site_sync_failed", error);
    siteSync = { updated: false, reason: "sync_failed" };
  }
  return NextResponse.json({ ok: true, siteSync });
}
