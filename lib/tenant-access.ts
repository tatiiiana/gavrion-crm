import { cookies } from "next/headers";
import { createServerSupabase } from "@/lib/supabase/server";
import { hasTenantPermission, type PermissionOverrides, type TenantPermission } from "@/lib/permissions";

export type ClientRole = "owner" | "admin" | "agent" | "viewer";
export type TenantCapability = "settings" | "team" | "conversations" | "properties" | "sales" | "automations" | "audit" | "reports" | "integrations" | "tasks";

type MembershipRow = {
  tenant_id: string;
  role: ClientRole;
  active?: boolean;
  permissions?: PermissionOverrides;
  tenants?: { implementation_status?: string } | Array<{ implementation_status?: string }> | null;
};

const capabilityPermissions: Partial<Record<TenantCapability, TenantPermission>> = { settings: "settings.manage", team: "team.manage", automations: "automations.manage", audit: "audit.view", integrations: "integrations.manage" };

const capabilityRoles: Record<TenantCapability, ClientRole[]> = {
  settings: ["owner", "admin"],
  team: ["owner", "admin"],
  conversations: ["owner", "admin", "agent", "viewer"],
  properties: ["owner", "admin", "agent", "viewer"],
  sales: ["owner", "admin", "agent", "viewer"],
  automations: ["owner", "admin"],
  audit: ["owner", "admin"],
  reports: ["owner", "admin", "agent", "viewer"],
  integrations: ["owner", "admin"],
  tasks: ["owner", "admin", "agent", "viewer"]
};

/**
 * Obtiene una membresía activa sin asumir que la primera fila es la empresa correcta.
 * La empresa elegida se toma del selector persistido en la cookie; si no existe,
 * solo se permite continuar cuando el usuario tiene una única empresa activa.
 */
export async function resolveTenantMembership(supabase: any, userId: string, requestedTenantId?: string | null) {
  const requested = String(requestedTenantId || "").trim();
  let query = supabase
    .from("memberships")
    .select("tenant_id,role,active,permissions,tenants!inner(implementation_status)")
    .eq("user_id", userId)
    .eq("active", true);
  if (requested) query = query.eq("tenant_id", requested);
  let { data, error } = await query.order("tenant_id", { ascending: true }).limit(requested ? 1 : 100);
  // Permite desplegar el código antes de aplicar la migración: los permisos personalizados quedan desactivados temporalmente, pero el aislamiento no.
  if (error && String(error.message || "").toLowerCase().includes("permissions")) {
    let fallback = supabase.from("memberships").select("tenant_id,role,active,tenants!inner(implementation_status)").eq("user_id", userId).eq("active", true);
    if (requested) fallback = fallback.eq("tenant_id", requested);
    const fallbackResult = await fallback.order("tenant_id", { ascending: true }).limit(requested ? 1 : 100);
    data = fallbackResult.data;
    error = fallbackResult.error;
  }
  if (error || !data?.length) return { membership: null as MembershipRow | null, memberships: [] as MembershipRow[], error };
  const rows = data as MembershipRow[];
  const membership = requested ? rows[0] || null : rows.length === 1 ? rows[0] : null;
  return { membership, memberships: rows, error: null };
}

export async function getActiveTenantIdFromCookie() {
  const store = await cookies();
  return store.get("gavrion_active_tenant")?.value || null;
}

export async function requireTenantPermission(permission: TenantPermission, requestedTenantId?: string | null) {
  const supabase = await createServerSupabase();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return null;
  const requested = requestedTenantId || await getActiveTenantIdFromCookie();
  const { membership } = await resolveTenantMembership(supabase, auth.user.id, requested);
  if (!membership || !hasTenantPermission(membership.role, permission, membership.permissions)) return null;
  const tenant = Array.isArray(membership.tenants) ? membership.tenants[0] : membership.tenants;
  if (!tenant || !["ready", "production"].includes(String(tenant.implementation_status))) return null;
  return { supabase, user: auth.user, membership };
}

export async function requireTenantCapability(capability: TenantCapability, tenantId?: string) {
  const supabase = await createServerSupabase();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return null;
  const requested = tenantId || await getActiveTenantIdFromCookie();
  const { membership } = await resolveTenantMembership(supabase, auth.user.id, requested);
  if (!membership || !(capabilityRoles[capability] as string[]).includes(String(membership.role))) return null;
  const requiredPermission = capabilityPermissions[capability];
  if (requiredPermission && !hasTenantPermission(membership.role, requiredPermission, membership.permissions)) return null;
  const tenant = Array.isArray(membership.tenants) ? membership.tenants[0] : membership.tenants;
  if (!tenant || !["ready", "production"].includes(String(tenant.implementation_status))) return null;
  return { supabase, user: auth.user, membership };
}

export function clientRoleLabel(role: string) {
  return ({ owner: "Administrador del cliente", admin: "Administrador del cliente", agent: "Agente del cliente", viewer: "Solo lectura" } as Record<string, string>)[role] || role;
}