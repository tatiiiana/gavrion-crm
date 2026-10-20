/**
 * Módulos del CRM permitidos por rubro. Esta lista es la fuente de verdad
 * compartida por el alta de empresas, la aplicación de plantillas y el menú.
 */
export const moduleLabels: Record<string, string> = {
  dashboard: "Inicio", conversations: "Conversaciones", contacts: "Contactos", pipeline: "Pipeline",
  tasks: "Tareas", team: "Equipo", automations: "Automatizaciones", reports: "Reportes",
  assistant: "Asistente IA", widget: "Chatbox", properties: "Propiedades", inquiries: "Interesados",
  visits: "Visitas", reservations: "Reservaciones", orders: "Pedidos", appointments: "Citas",
  quotes: "Cotizaciones", products: "Productos"
};

export const sharedCrmModules = [
  "dashboard", "conversations", "contacts", "pipeline", "tasks", "team", "automations", "reports", "assistant", "widget"
] as const;

export const businessModuleAddons = {
  generic: [],
  real_estate: ["properties", "inquiries", "visits"],
  restaurant: ["reservations", "orders", "products"],
  hospitality: ["reservations"],
  services: ["appointments", "quotes"],
  commerce: ["products", "orders"]
} as const;

export type BusinessType = keyof typeof businessModuleAddons;

export function normalizeBusinessType(value: unknown): BusinessType {
  return typeof value === "string" && value in businessModuleAddons ? value as BusinessType : "generic";
}

export function modulesForBusiness(value: unknown): string[] {
  return [...sharedCrmModules, ...businessModuleAddons[normalizeBusinessType(value)]];
}

/** Keeps only known modules compatible with the selected business type. */
export function restrictModulesToBusiness(value: unknown, businessType: unknown): string[] {
  const allowed = new Set(modulesForBusiness(businessType));
  const requested = Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  return [...new Set(requested.filter(item => allowed.has(item)))];
}

export function configuredModulesForBusiness(value: unknown, businessType: unknown): string[] {
  const compatible = restrictModulesToBusiness(value, businessType);
  return compatible.length ? compatible : modulesForBusiness(businessType);
}
