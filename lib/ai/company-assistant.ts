type HistoryItem = { direction: string; body: string | null };

type AssistantInput = {
  company: string;
  assistantName: string;
  instructions: string;
  handoffMessage: string;
  knowledge: Array<{ title: string; content: string }>;
  history: HistoryItem[];
  message: string;
  visitorId: string;
};

export type AssistantRequest = {
  type: "none" | "property_inquiry" | "property_visit";
  ready: boolean;
  customer_name: string;
  phone: string;
  email: string;
  intent: "buy" | "rent" | "sell" | "";
  property_type: string;
  city: string;
  zone: string;
  budget_min: number;
  budget_max: number;
  bedrooms: number;
  property_reference: string;
  date: string;
  time: string;
  party_size: number;
  notes: string;
};

const emptyRequest: AssistantRequest = { type: "none", ready: false, customer_name: "", phone: "", email: "", intent: "", property_type: "", city: "", zone: "", budget_min: 0, budget_max: 0, bedrooms: 0, property_reference: "", date: "", time: "", party_size: 0, notes: "" };

export async function createCompanyReply(input: AssistantInput) {
  const explicitHandoff = /\b(humano|persona|asesor|agente|encargado|queja|reclamo)\b/i.test(input.message);
  if (explicitHandoff) return { reply: input.handoffMessage, handoff: true, provider: "rule", request: emptyRequest };

  const knowledge = input.knowledge.length
    ? input.knowledge.map(item => `## ${item.title}\n${item.content}`).join("\n\n")
    : "No hay información empresarial cargada.";
  const history = input.history.slice(-10).map(item => `${item.direction === "inbound" ? "Cliente" : "Asistente"}: ${item.body || ""}`).join("\n");
  const instructions = `Eres ${input.assistantName}, asistente inmobiliario de ${input.company}. ${input.instructions}\nResponde únicamente usando la base de conocimiento. No inventes precios, disponibilidad, características ni ubicaciones. Ayuda a comprar, alquilar o vender propiedades. Si existe una propiedad adecuada en la base, menciona su referencia. Recopila gradualmente los datos faltantes haciendo una o dos preguntas por turno. Para registrar un interesado necesitas nombre, teléfono, intención buy/rent/sell y criterios suficientes: referencia o tipo de inmueble y ubicación; presupuesto y habitaciones cuando correspondan. Para solicitar una visita necesitas nombre, teléfono, referencia de propiedad, fecha YYYY-MM-DD, hora HH:MM y cantidad de visitantes. Usa property_inquiry o property_visit según corresponda y marca request.ready=true únicamente cuando estén los datos mínimos. Si solo está consultando información, usa request.type=none. Transfiere únicamente si el cliente pide una persona, hay un reclamo o el caso requiere una decisión humana; no transfieras solo porque falte un dato, pregúntalo. Responde en español, con tono natural y en máximo 90 palabras.`;
  const prompt = `BASE DE CONOCIMIENTO:\n${knowledge}\n\nCONVERSACIÓN RECIENTE:\n${history}\n\nNUEVO MENSAJE:\n${input.message}`;

  const errors: string[] = [];
  if (process.env.GEMINI_API_KEY) {
    try {
      const result = await createGeminiReply(instructions, prompt);
      return { ...result, provider: "gemini" };
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Gemini no pudo responder";
      errors.push(`Gemini: ${detail}`);
      console.warn("[assistant-gemini] Falló el proveedor principal", detail);
    }
  }

  if (process.env.OPENAI_API_KEY) {
    try {
      const result = await createOpenAIReply(input, instructions, prompt);
      return { ...result, provider: "openai" };
    } catch (error) {
      const detail = error instanceof Error ? error.message : "OpenAI no pudo responder";
      errors.push(`OpenAI: ${detail}`);
      console.warn("[assistant-openai] Falló el proveedor de respaldo", detail);
    }
  }

  throw new Error(errors.join(" | ") || "No hay un proveedor de IA configurado");
}

async function createGeminiReply(instructions: string, prompt: string) {
  const configuredModel = (process.env.GEMINI_MODEL || "gemini-3.5-flash-lite")
    .trim()
    .replace(/^models\//i, "")
    .replace(/^[`'\"]+|[`'\"]+$/g, "")
    .trim();
  const model = /^gemini-[a-z0-9.-]+$/i.test(configuredModel) ? configuredModel : "gemini-3.5-flash-lite";
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: "POST",
    headers: { "x-goog-api-key": process.env.GEMINI_API_KEY || "", "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: instructions }] },
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        maxOutputTokens: 520,
        responseMimeType: "application/json",
        responseSchema: {
          type: "OBJECT",
          properties: { reply: { type: "STRING" }, handoff: { type: "BOOLEAN" }, request: requestSchema("gemini") },
          required: ["reply", "handoff", "request"]
        }
      }
    })
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error?.message || "Gemini no pudo responder");
  const outputText = result.candidates?.[0]?.content?.parts?.map((part: { text?: string }) => part.text || "").join("");
  if (!outputText) throw new Error("Gemini devolvió una respuesta sin texto");
  const parsed = JSON.parse(outputText);
  return { reply: String(parsed.reply || ""), handoff: Boolean(parsed.handoff), request: normalizeRequest(parsed.request) };
}

async function createOpenAIReply(input: AssistantInput, instructions: string, prompt: string) {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
      store: false,
      safety_identifier: input.visitorId.slice(0, 64),
      instructions,
      input: prompt,
      max_output_tokens: 520,
      text: {
        format: {
          type: "json_schema",
          name: "company_assistant_reply",
          strict: true,
          schema: {
            type: "object",
            properties: { reply: { type: "string" }, handoff: { type: "boolean" }, request: requestSchema("openai") },
            required: ["reply", "handoff", "request"],
            additionalProperties: false
          }
        }
      }
    })
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error?.message || "OpenAI no pudo responder");

  const outputText = typeof result.output_text === "string"
    ? result.output_text
    : (result.output || [])
        .flatMap((item: { content?: Array<{ type?: string; text?: string }> }) => item.content || [])
        .find((item: { type?: string; text?: string }) => item.type === "output_text")
        ?.text;

  try {
    if (!outputText) throw new Error("OpenAI devolvió una respuesta sin texto");
    const parsed = JSON.parse(outputText);
    return { reply: String(parsed.reply || input.handoffMessage), handoff: Boolean(parsed.handoff), request: normalizeRequest(parsed.request) };
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : "No se pudo interpretar la respuesta de OpenAI");
  }
}

function requestSchema(provider: "gemini" | "openai") {
  const type = (value: string) => ({ type: provider === "gemini" ? value.toUpperCase() : value.toLowerCase() });
  return {
    ...type("object"),
    properties: {
      type: { ...type("string"), enum: ["none", "property_inquiry", "property_visit"] },
      ready: type("boolean"), customer_name: type("string"), phone: type("string"), email: type("string"),
      intent: { ...type("string"), enum: ["", "buy", "rent", "sell"] }, property_type: type("string"), city: type("string"), zone: type("string"),
      budget_min: type("number"), budget_max: type("number"), bedrooms: type("integer"), property_reference: type("string"),
      date: type("string"), time: type("string"), party_size: type("integer"), notes: type("string")
    },
    required: ["type", "ready", "customer_name", "phone", "email", "intent", "property_type", "city", "zone", "budget_min", "budget_max", "bedrooms", "property_reference", "date", "time", "party_size", "notes"],
    ...(provider === "openai" ? { additionalProperties: false } : {})
  };
}

function normalizeRequest(value: Partial<AssistantRequest> | undefined): AssistantRequest {
  const requestType = value?.type === "property_inquiry" || value?.type === "property_visit" ? value.type : "none";
  const intent = value?.intent === "buy" || value?.intent === "rent" || value?.intent === "sell" ? value.intent : "";
  return { type: requestType, ready: Boolean(value?.ready), customer_name: String(value?.customer_name || "").trim(), phone: String(value?.phone || "").trim(), email: String(value?.email || "").trim(), intent, property_type: String(value?.property_type || "").trim(), city: String(value?.city || "").trim(), zone: String(value?.zone || "").trim(), budget_min: Number(value?.budget_min || 0), budget_max: Number(value?.budget_max || 0), bedrooms: Number(value?.bedrooms || 0), property_reference: String(value?.property_reference || "").trim(), date: String(value?.date || "").trim(), time: String(value?.time || "").trim(), party_size: Number(value?.party_size || 0), notes: String(value?.notes || "").trim() };
}
