export type ClientRole = "owner" | "admin" | "agent" | "viewer";

export type TenantPermission =
  | "sales.view"
  | "sales.edit"
  | "contacts.export"
  | "reports.financial"
  | "automations.manage"
  | "integrations.manage"
  | "team.manage"
  | "settings.manage"
  | "audit.view";

const rolePermissions: Record<ClientRole, readonly TenantPermission[]> = {
  owner: [
    "sales.view", "sales.edit", "contacts.export", "reports.financial",
    "automations.manage", "integrations.manage", "team.manage", "settings.manage", "audit.view"
  ],
  admin: [
    "sales.view", "sales.edit", "contacts.export", "reports.financial",
    "automations.manage", "integrations.manage", "team.manage", "settings.manage", "audit.view"
  ],
  agent: ["sales.view", "sales.edit", "contacts.export"],
  viewer: ["sales.view"]
};

export type PermissionOverrides = Partial<Record<TenantPermission, boolean>> | null | undefined;

export function hasTenantPermission(role: string, permission: TenantPermission, overrides?: PermissionOverrides) {
  const override = overrides?.[permission];
  if (typeof override === "boolean") return override;
  return (rolePermissions[role as ClientRole] || []).includes(permission);
}

export function permissionsForRole(role: string, overrides?: PermissionOverrides) {
  const allPermissions = Object.values(rolePermissions).flat().filter((value, index, array) => array.indexOf(value) === index);
  return allPermissions.filter(permission => hasTenantPermission(role, permission, overrides));
}

export const tenantPermissionLabels: Record<TenantPermission, string> = {
  "sales.view": "Ver ventas y oportunidades",
  "sales.edit": "Editar ventas y oportunidades",
  "contacts.export": "Exportar contactos",
  "reports.financial": "Ver reportes financieros",
  "automations.manage": "Administrar automatizaciones",
  "integrations.manage": "Gestionar integraciones",
  "team.manage": "Gestionar equipo",
  "settings.manage": "Gestionar configuración",
  "audit.view": "Consultar auditoría"
};