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

export async function createCompanyReply(input: AssistantInput) {
  const explicitHandoff = /\b(humano|persona|asesor|agente|encargado|queja|reclamo)\b/i.test(input.message);
  if (explicitHandoff) return { reply: input.handoffMessage, handoff: true, provider: "rule" };

  const knowledge = input.knowledge.length
    ? input.knowledge.map(item => `## ${item.title}\n${item.content}`).join("\n\n")
    : "No hay información empresarial cargada.";
  const history = input.history.slice(-10).map(item => `${item.direction === "inbound" ? "Cliente" : "Asistente"}: ${item.body || ""}`).join("\n");
  const instructions = `Eres ${input.assistantName}, asistente de ${input.company}. ${input.instructions}\nResponde únicamente usando la base de conocimiento. No inventes precios, disponibilidad, políticas ni datos. Si la información no alcanza, si el cliente pide una persona o si el caso requiere decisión humana, activa la transferencia. Responde en español, con tono natural y en máximo 90 palabras.`;
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
        maxOutputTokens: 220,
        responseMimeType: "application/json",
        responseSchema: {
          type: "OBJECT",
          properties: { reply: { type: "STRING" }, handoff: { type: "BOOLEAN" } },
          required: ["reply", "handoff"]
        }
      }
    })
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error?.message || "Gemini no pudo responder");
  const outputText = result.candidates?.[0]?.content?.parts?.map((part: { text?: string }) => part.text || "").join("");
  if (!outputText) throw new Error("Gemini devolvió una respuesta sin texto");
  const parsed = JSON.parse(outputText);
  return { reply: String(parsed.reply || ""), handoff: Boolean(parsed.handoff) };
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
      max_output_tokens: 220,
      text: {
        format: {
          type: "json_schema",
          name: "company_assistant_reply",
          strict: true,
          schema: {
            type: "object",
            properties: { reply: { type: "string" }, handoff: { type: "boolean" } },
            required: ["reply", "handoff"],
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
    return { reply: String(parsed.reply || input.handoffMessage), handoff: Boolean(parsed.handoff) };
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : "No se pudo interpretar la respuesta de OpenAI");
  }
}
