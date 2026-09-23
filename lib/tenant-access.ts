import { createServerSupabase } from "@/lib/supabase/server";

export type ClientRole = "owner" | "admin" | "agent" | "viewer";
export type TenantCapability = "settings" | "team" | "conversations" | "properties" | "sales" | "automations" | "audit";

const capabilityRoles: Record<TenantCapability, ClientRole[]> = {
  settings: ["owner", "admin"],
  team: ["owner", "admin"],
  conversations: ["owner", "admin", "agent"],
  properties: ["owner", "admin", "agent"],
  sales: ["owner", "admin", "agent"],
  automations: ["owner", "admin"],
  audit: ["owner", "admin"],
};

export async function requireTenantCapability(capability: TenantCapability, tenantId?: string) {
  const supabase = await createServerSupabase();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return null;
  let query = supabase.from("memberships").select("tenant_id,role,active,tenants!inner(implementation_status)").eq("user_id", auth.user.id).eq("active", true);
  if (tenantId) query = query.eq("tenant_id", tenantId);
  const { data: membership } = await query.limit(1).maybeSingle();
  if (!membership || !(capabilityRoles[capability] as string[]).includes(String(membership.role))) return null;
  const tenant = Array.isArray(membership.tenants) ? membership.tenants[0] : membership.tenants;
  if (!tenant || !["ready", "production"].includes(String(tenant.implementation_status))) return null;
  return { supabase, user: auth.user, membership: { tenant_id: membership.tenant_id, role: membership.role as ClientRole } };
}

export function clientRoleLabel(role: string) {
  return ({ owner: "Administrador del cliente", admin: "Administrador del cliente", agent: "Agente del cliente", viewer: "Solo lectura" } as Record<string, string>)[role] || role;
}
