export type SiteTemplate = {
  key: string;
  name: string;
  businessType: "gastronomy" | "real_estate" | "services" | "commerce";
  description: string;
  previewPath: string;
  configPath: string;
  modules: string[];
  editableAreas: string[];
};

export const siteTemplates: SiteTemplate[] = [
  {
    key: "gastronomia-a",
    name: "Gastronomía A",
    businessType: "gastronomy",
    description: "Restaurante editorial con menú digital, pedidos, reservaciones y QR por mesa.",
    previewPath: "/templates/gastronomia-a/index.html",
    configPath: "/templates/gastronomia-a/site-config.js",
    modules: [
      "dashboard",
      "conversations",
      "contacts",
      "tasks",
      "team",
      "automations",
      "reports",
      "assistant",
      "widget",
      "reservations",
      "orders",
      "products"
    ],
    editableAreas: ["brand", "seo", "hero", "experience", "menu", "contact", "features", "integrations"]
  }
];

export function getSiteTemplate(key: string) {
  return siteTemplates.find(template => template.key === key) || null;
}
