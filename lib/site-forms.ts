/**
 * Formularios públicos del sitio web por rubro.
 * Esta es la fuente de verdad: el endpoint público entrega estas definiciones al script
 * `site-forms.js` para dibujarlas, y el servidor valida cada envío contra ellas.
 */
import { configuredModulesForBusiness, normalizeBusinessType, type BusinessType } from "@/lib/business-modules";

export type FormFieldType = "text" | "tel" | "email" | "date" | "time" | "number" | "select" | "textarea";
export type FormOption = { value: string; label: string };
export type FormField = {
  name: string;
  label: string;
  type: FormFieldType;
  required?: boolean;
  placeholder?: string;
  options?: FormOption[];
  /** Opciones dinámicas que el servidor completa con datos públicos de la empresa. */
  optionsFrom?: "properties" | "products";
  min?: number;
  max?: number;
  maxLength?: number;
  /** Muestra (y exige) el campo solo cuando otro campo tiene cierto valor. */
  showIf?: { field: string; equals: string };
  defaultValue?: string;
};
export type FormType =
  | "advisory" | "property_inquiry" | "property_visit"
  | "reservation" | "order"
  | "appointment" | "quote"
  | "product_inquiry"
  | "availability" | "lodging_reservation"
  | "contact";
export type FormDefinition = {
  type: FormType;
  title: string;
  cta: string;
  description: string;
  submitLabel: string;
  successMessage: string;
  /** Módulo del CRM que debe estar activo para ofrecer el formulario. */
  module?: string;
  fields: FormField[];
};

const name: FormField = { name: "full_name", label: "Nombre completo", type: "text", required: true, maxLength: 100, placeholder: "Tu nombre" };
const phone: FormField = { name: "phone", label: "Teléfono / WhatsApp", type: "tel", required: true, maxLength: 30, placeholder: "+504 9999-9999" };
const email: FormField = { name: "email", label: "Correo electrónico", type: "email", maxLength: 254, placeholder: "Opcional" };
const notes = (label = "Comentarios", required = false): FormField => ({ name: "notes", label, type: "textarea", required, maxLength: 1500 });
const fulfillment: FormField = { name: "fulfillment", label: "Entrega", type: "select", required: true, options: [{ value: "pickup", label: "Recoger en el local" }, { value: "delivery", label: "Entrega a domicilio" }], defaultValue: "pickup" };
const address: FormField = { name: "address", label: "Dirección de entrega", type: "text", required: true, maxLength: 300, showIf: { field: "fulfillment", equals: "delivery" } };
const items: FormField = { name: "items", label: "Detalle del pedido", type: "textarea", required: true, maxLength: 2000, placeholder: "Producto, cantidad y especificaciones" };
const lodgingFields: FormField[] = [
  name, phone, email,
  { name: "check_in", label: "Llegada", type: "date", required: true },
  { name: "check_out", label: "Salida", type: "date", required: true },
  { name: "guests", label: "Huéspedes", type: "number", required: true, min: 1, max: 100, defaultValue: "2" },
  { name: "room_type", label: "Tipo de habitación", type: "text", maxLength: 80, placeholder: "Opcional" }
];

const definitions: Record<FormType, FormDefinition> = {
  advisory: {
    type: "advisory", title: "Solicitar asesoría", cta: "Solicitar asesoría", module: "inquiries",
    description: "Cuéntanos qué buscas y un asesor te contactará con opciones confirmadas.",
    submitLabel: "Solicitar asesoría", successMessage: "Recibimos tu solicitud. Un asesor te contactará pronto.",
    fields: [name, phone, email,
      { name: "intent", label: "¿Qué deseas hacer?", type: "select", required: true, options: [{ value: "buy", label: "Comprar" }, { value: "rent", label: "Alquilar" }, { value: "sell", label: "Vender mi propiedad" }] },
      { name: "property_type", label: "Tipo de propiedad", type: "select", options: [{ value: "", label: "Cualquiera" }, { value: "house", label: "Casa" }, { value: "apartment", label: "Apartamento" }, { value: "land", label: "Terreno" }, { value: "commercial", label: "Local comercial" }, { value: "office", label: "Oficina" }] },
      { name: "city", label: "Ciudad o zona", type: "text", maxLength: 120 },
      { name: "budget", label: "Presupuesto aproximado", type: "number", min: 0, max: 1_000_000_000 },
      notes("¿Algo más que debamos saber?")]
  },
  property_inquiry: {
    type: "property_inquiry", title: "Consultar una propiedad", cta: "Solicitar información", module: "inquiries",
    description: "Pide información confirmada sobre una propiedad del catálogo.",
    submitLabel: "Enviar consulta", successMessage: "Recibimos tu consulta. Te enviaremos la información confirmada.",
    fields: [name, phone, email,
      { name: "property_reference", label: "Propiedad", type: "select", required: true, optionsFrom: "properties" },
      notes("¿Qué te gustaría saber?")]
  },
  property_visit: {
    type: "property_visit", title: "Agendar una visita", cta: "Agendar visita", module: "visits",
    description: "Elige la propiedad y el horario que prefieres. Confirmaremos la visita contigo.",
    submitLabel: "Solicitar visita", successMessage: "Recibimos tu solicitud de visita. Te confirmaremos el horario.",
    fields: [name, phone, email,
      { name: "property_reference", label: "Propiedad", type: "select", required: true, optionsFrom: "properties" },
      { name: "date", label: "Fecha", type: "date", required: true },
      { name: "time", label: "Hora", type: "time", required: true },
      { name: "party_size", label: "Personas", type: "number", required: true, min: 1, max: 30, defaultValue: "1" },
      notes()]
  },
  reservation: {
    type: "reservation", title: "Reservar mesa", cta: "Reservar mesa", module: "reservations",
    description: "Solicita tu reserva. El equipo la confirmará según disponibilidad.",
    submitLabel: "Solicitar reserva", successMessage: "Recibimos tu solicitud de reserva. Te confirmaremos la disponibilidad.",
    fields: [name, phone, email,
      { name: "date", label: "Fecha", type: "date", required: true },
      { name: "time", label: "Hora", type: "time", required: true },
      { name: "party_size", label: "Personas", type: "number", required: true, min: 1, max: 100, defaultValue: "2" },
      notes("Ocasión o requerimientos especiales")]
  },
  order: {
    type: "order", title: "Hacer un pedido", cta: "Hacer pedido", module: "orders",
    description: "Envía tu pedido y te confirmaremos el total y el tiempo de entrega.",
    submitLabel: "Enviar pedido", successMessage: "Recibimos tu pedido. Te confirmaremos el total y el tiempo de entrega.",
    fields: [name, phone, email, items, fulfillment, address,
      { name: "date", label: "Fecha deseada", type: "date" },
      { name: "time", label: "Hora deseada", type: "time" },
      notes()]
  },
  appointment: {
    type: "appointment", title: "Agendar una cita", cta: "Agendar cita", module: "appointments",
    description: "Elige el servicio y el horario que prefieres. Te confirmaremos la cita.",
    submitLabel: "Solicitar cita", successMessage: "Recibimos tu solicitud de cita. Te confirmaremos el horario.",
    fields: [name, phone, email,
      { name: "service", label: "Servicio", type: "text", required: true, maxLength: 160 },
      { name: "date", label: "Fecha", type: "date", required: true },
      { name: "time", label: "Hora", type: "time", required: true },
      notes()]
  },
  quote: {
    type: "quote", title: "Solicitar cotización", cta: "Solicitar cotización", module: "quotes",
    description: "Describe lo que necesitas y te enviaremos una propuesta.",
    submitLabel: "Solicitar cotización", successMessage: "Recibimos tu solicitud. Prepararemos tu cotización.",
    fields: [name, phone, email,
      { name: "company", label: "Empresa", type: "text", maxLength: 120, placeholder: "Opcional" },
      { name: "service", label: "Servicio o producto", type: "text", required: true, maxLength: 160 },
      { name: "details", label: "Detalle de lo que necesitas", type: "textarea", required: true, maxLength: 2000 },
      { name: "budget", label: "Presupuesto estimado", type: "number", min: 0, max: 1_000_000_000 },
      { name: "date", label: "¿Para cuándo lo necesitas?", type: "date" }]
  },
  product_inquiry: {
    type: "product_inquiry", title: "Consultar un producto", cta: "Consultar producto",
    description: "Pregunta por precio, disponibilidad o características.",
    submitLabel: "Enviar consulta", successMessage: "Recibimos tu consulta. Te responderemos pronto.",
    fields: [name, phone, email,
      { name: "product", label: "Producto", type: "select", optionsFrom: "products" },
      { name: "quantity", label: "Cantidad", type: "number", min: 1, max: 100000, defaultValue: "1" },
      notes("Tu consulta", true)]
  },
  availability: {
    type: "availability", title: "Consultar disponibilidad", cta: "Ver disponibilidad", module: "reservations",
    description: "Indica tus fechas y te confirmaremos habitaciones y tarifas disponibles.",
    submitLabel: "Consultar disponibilidad", successMessage: "Recibimos tu consulta. Te enviaremos la disponibilidad y tarifas.",
    fields: [...lodgingFields, notes()]
  },
  lodging_reservation: {
    type: "lodging_reservation", title: "Reservar hospedaje", cta: "Reservar", module: "reservations",
    description: "Solicita tu reservación. Te confirmaremos disponibilidad y forma de pago.",
    submitLabel: "Solicitar reservación", successMessage: "Recibimos tu solicitud de reservación. Te confirmaremos pronto.",
    fields: [...lodgingFields, notes("Requerimientos especiales")]
  },
  contact: {
    type: "contact", title: "Escríbenos", cta: "Contáctanos",
    description: "Déjanos tu mensaje y te responderemos lo antes posible.",
    submitLabel: "Enviar mensaje", successMessage: "Recibimos tu mensaje. Te responderemos pronto.",
    fields: [name, phone, email, notes("Mensaje", true)]
  }
};

const formsByBusiness: Record<BusinessType, FormType[]> = {
  real_estate: ["advisory", "property_inquiry", "property_visit", "contact"],
  restaurant: ["reservation", "order", "contact"],
  services: ["appointment", "quote", "contact"],
  commerce: ["order", "product_inquiry", "contact"],
  hospitality: ["availability", "lodging_reservation", "contact"],
  generic: ["contact"]
};

export function formsForTenant(templateKey: unknown, settingsModules: unknown): FormDefinition[] {
  const businessType = normalizeBusinessType(templateKey);
  const modules = new Set(configuredModulesForBusiness(settingsModules, businessType));
  return formsByBusiness[businessType].map(type => definitions[type]).filter(form => !form.module || modules.has(form.module));
}

export function getFormDefinition(type: string): FormDefinition | null {
  return (definitions as Record<string, FormDefinition>)[type] || null;
}

// ---------- Validación ----------

export type FormValues = Record<string, string>;
export const DEFAULT_TIMEZONE_OFFSET = "-06:00"; // Honduras (sin horario de verano)

function todayInHonduras() {
  return new Date(Date.now() - 6 * 3600_000).toISOString().slice(0, 10);
}

/** Normaliza teléfonos al formato usado por WhatsApp (solo dígitos, con código de país). */
export function normalizePhone(value: string, countryCode = process.env.DEFAULT_PHONE_COUNTRY_CODE || "504") {
  const digits = value.replace(/\D/g, "");
  if (digits.length === 8) return `${countryCode}${digits}`;
  return digits;
}

export function validateForm(form: FormDefinition, raw: Record<string, unknown>, allowedOptions: Record<string, string[]> = {}): { values: FormValues; errors: Record<string, string> } {
  const values: FormValues = {};
  const errors: Record<string, string> = {};
  const today = todayInHonduras();
  const maxDate = new Date(Date.now() + 366 * 86400_000).toISOString().slice(0, 10);

  for (const field of form.fields) {
    const visible = !field.showIf || String(raw[field.showIf.field] ?? "") === field.showIf.equals;
    if (!visible) continue;
    const value = String(raw[field.name] ?? "").trim().slice(0, field.maxLength || 500);
    if (!value) { if (field.required) errors[field.name] = `${field.label} es obligatorio.`; continue; }
    switch (field.type) {
      case "email":
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value)) errors[field.name] = "Escribe un correo válido.";
        break;
      case "tel": {
        const digits = value.replace(/\D/g, "");
        if (digits.length < 8 || digits.length > 15) errors[field.name] = "Escribe un teléfono válido (al menos 8 dígitos).";
        break;
      }
      case "date":
        if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value))) errors[field.name] = "Fecha inválida.";
        else if (value < today) errors[field.name] = "La fecha no puede estar en el pasado.";
        else if (value > maxDate) errors[field.name] = "Elige una fecha dentro del próximo año.";
        break;
      case "time":
        if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value.slice(0, 5))) errors[field.name] = "Hora inválida.";
        break;
      case "number": {
        const number = Number(value);
        if (!Number.isFinite(number)) errors[field.name] = "Debe ser un número.";
        else if (field.min !== undefined && number < field.min) errors[field.name] = `El mínimo es ${field.min}.`;
        else if (field.max !== undefined && number > field.max) errors[field.name] = `El máximo es ${field.max}.`;
        break;
      }
      case "select": {
        const options = field.options?.map(option => option.value) || allowedOptions[field.name];
        if (options && options.length && !options.includes(value)) errors[field.name] = "Selecciona una opción válida.";
        break;
      }
    }
    values[field.name] = field.type === "time" ? value.slice(0, 5) : value;
  }

  // Reglas entre campos.
  if (values.check_in && values.check_out && !errors.check_in && !errors.check_out && values.check_out <= values.check_in) errors.check_out = "La salida debe ser posterior a la llegada.";
  if (values.date && values.time && !errors.date && !errors.time && values.date === today) {
    const nowTime = new Date(Date.now() - 6 * 3600_000).toISOString().slice(11, 16);
    if (values.time < nowTime) errors.time = "La hora ya pasó; elige un horario posterior.";
  }
  return { values, errors };
}

/** Resumen legible del envío, usado como primer mensaje de la conversación. */
export function summarizeSubmission(form: FormDefinition, values: FormValues) {
  const lines = form.fields
    .filter(field => values[field.name])
    .map(field => {
      const option = field.options?.find(item => item.value === values[field.name]);
      return `${field.label}: ${option?.label || values[field.name]}`;
    });
  return `📝 ${form.title} (formulario del sitio web)\n${lines.join("\n")}`;
}
