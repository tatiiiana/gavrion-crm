export type SiteTemplate = {
  key: string;
  name: string;
  businessType: "gastronomy" | "real_estate" | "services" | "commerce" | "hospitality";
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
  },
  {key:"gastronomia-b",name:"Gastronomía B",businessType:"gastronomy",description:"Restaurante contemporáneo, reservas, carta visual y promociones.",previewPath:"/templates/gastronomia-a/index.html",configPath:"/templates/gastronomia-a/site-config.js",modules:["reservations","orders","products","widget"],editableAreas:["brand","hero","menu","contact","integrations"]},
  {key:"inmobiliaria-a",name:"Inmobiliaria",businessType:"real_estate",description:"Propiedades, asesores, interesados y solicitudes de visita.",previewPath:"/templates/gastronomia-a/index.html",configPath:"/templates/gastronomia-a/site-config.js",modules:["properties","inquiries","visits","widget"],editableAreas:["brand","hero","menu","contact","integrations"]},
  {key:"servicios-a",name:"Servicios profesionales",businessType:"services",description:"Servicios, equipo, cotizaciones y agenda de citas.",previewPath:"/templates/gastronomia-a/index.html",configPath:"/templates/gastronomia-a/site-config.js",modules:["appointments","quotes","pipeline","widget"],editableAreas:["brand","hero","menu","contact","integrations"]},
  {key:"comercio-a",name:"Comercio",businessType:"commerce",description:"Catálogo, promociones, pedidos y atención comercial.",previewPath:"/templates/gastronomia-a/index.html",configPath:"/templates/gastronomia-a/site-config.js",modules:["products","orders","pipeline","widget"],editableAreas:["brand","hero","menu","contact","integrations"]},
  {key:"hoteles-a",name:"Hoteles y turismo",businessType:"hospitality",description:"Habitaciones, experiencias, disponibilidad y reservaciones.",previewPath:"/templates/gastronomia-a/index.html",configPath:"/templates/gastronomia-a/site-config.js",modules:["reservations","products","pipeline","widget"],editableAreas:["brand","hero","menu","contact","integrations"]}
];

export function getSiteTemplate(key: string) {
  return siteTemplates.find(template => template.key === key) || null;
}
