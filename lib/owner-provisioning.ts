import type { SupabaseClient } from "@supabase/supabase-js";

type PendingOwner = { name: string; email: string };
type OwnerResult = { id: string; name: string; email: string; invitationStatus: "pending" | "accepted" };

function cleanPendingOwner(value: unknown): PendingOwner | null {
  const item = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const name = String(item.name || "").trim().slice(0, 160);
  const email = String(item.email || "").trim().toLowerCase();
  return name.length >= 3 && /^\S+@\S+\.\S+$/.test(email) ? { name, email } : null;
}

/**
 * Envía la invitación solo cuando el sitio ya fue aprobado. Es idempotente:
 * si el usuario ya tiene la membresía de esta empresa, no vuelve a enviar nada.
 */
export async function provisionPendingOwner(admin: SupabaseClient, tenantId: string, requestUrl: string): Promise<OwnerResult | null> {
  const { data: tenant, error: tenantError } = await admin.from("tenants").select("id,name,settings").eq("id", tenantId).maybeSingle();
  if (tenantError) throw new Error(tenantError.message);
  if (!tenant) throw new Error("La empresa no existe.");
  const settings = tenant.settings && typeof tenant.settings === "object" ? tenant.settings as Record<string, unknown> : {};
  const onboarding = settings.onboarding && typeof settings.onboarding === "object" ? settings.onboarding as Record<string, unknown> : {};
  const pending = cleanPendingOwner(onboarding.pending_owner);
  if (!pending) return null;

  let owner = (await admin.auth.admin.listUsers({ page: 1, perPage: 1000 })).data.users.find(item => item.email?.toLowerCase() === pending.email);
  if (owner) {
    const { data: memberships, error: membershipsError } = await admin.from("memberships").select("tenant_id,role").eq("user_id", owner.id);
    if (membershipsError) throw new Error(membershipsError.message);
    const belongsElsewhere = (memberships || []).some(item => item.tenant_id !== tenantId);
    if (belongsElsewhere) throw new Error("El correo del propietario ya pertenece a otra empresa.");
    const sameMembership = (memberships || []).find(item => item.tenant_id === tenantId);
    if (sameMembership?.role === "owner") {
      const invitationStatus = owner.email_confirmed_at ? "accepted" : "pending";
      const { error: membershipError } = await admin.from("memberships").upsert({ tenant_id: tenantId, user_id: owner.id, role: "owner", active: true, invitation_status: invitationStatus, invited_at: new Date().toISOString(), deactivated_at: null }, { onConflict: "tenant_id,user_id" });
      if (membershipError) throw new Error(membershipError.message);
      await admin.from("tenants").update({ settings: { ...settings, onboarding: { ...onboarding, pending_owner: null, owner_user_id: owner.id, owner_invited_at: onboarding.owner_invited_at || new Date().toISOString() } } }).eq("id", tenantId);
      return { id: owner.id, name: String(owner.user_metadata?.full_name || pending.name), email: pending.email, invitationStatus };
    }
  }

  if (!owner) {
    const origin = new URL(requestUrl).origin;
    const invited = await admin.auth.admin.inviteUserByEmail(pending.email, { redirectTo: `${origin}/invite`, data: { full_name: pending.name, company_name: tenant.name, provisioned_by_gavrion: true } });
    if (invited.error || !invited.data.user) {
      const detail = invited.error?.message || "No se pudo enviar la invitación al propietario.";
      const limited = /rate|limit|too many|email rate/i.test(detail);
      throw new Error(limited ? "Supabase alcanzó el límite temporal de correos. Configura SMTP propio o inténtalo más tarde." : detail);
    }
    owner = invited.data.user;
    // El trigger de registro puede crear una empresa temporal: se limpia antes de asignar la real.
    const { data: generated } = await admin.from("memberships").select("tenant_id").eq("user_id", owner.id).neq("tenant_id", tenantId);
    await admin.from("memberships").delete().eq("user_id", owner.id);
    const generatedIds = (generated || []).map(item => item.tenant_id);
    if (generatedIds.length) await admin.from("tenants").delete().in("id", generatedIds);
  }

  const invitationStatus = owner.email_confirmed_at ? "accepted" : "pending";
  const { error: membershipError } = await admin.from("memberships").upsert({
    tenant_id: tenantId,
    user_id: owner.id,
    role: "owner",
    active: true,
    invitation_status: invitationStatus,
    invited_at: new Date().toISOString(),
    deactivated_at: null,
  }, { onConflict: "tenant_id,user_id" });
  if (membershipError) throw new Error(membershipError.message);

  await admin.from("tenants").update({
    settings: { ...settings, onboarding: { ...onboarding, pending_owner: null, owner_user_id: owner.id, owner_invited_at: new Date().toISOString() } }
  }).eq("id", tenantId);
  return { id: owner.id, name: pending.name, email: pending.email, invitationStatus };
}
