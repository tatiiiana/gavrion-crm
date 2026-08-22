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
  if (explicitHandoff) return { reply: input.handoffMessage, handoff: true };
  if (!process.env.OPENAI_API_KEY) return { reply: input.handoffMessage, handoff: true };

  const knowledge = input.knowledge.length
    ? input.knowledge.map(item => `## ${item.title}\n${item.content}`).join("\n\n")
    : "No hay información empresarial cargada.";
  const history = input.history.slice(-10).map(item => `${item.direction === "inbound" ? "Cliente" : "Asistente"}: ${item.body || ""}`).join("\n");
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
      store: false,
      safety_identifier: input.visitorId.slice(0, 64),
      instructions: `Eres ${input.assistantName}, asistente de ${input.company}. ${input.instructions}\nResponde únicamente usando la base de conocimiento. No inventes precios, disponibilidad, políticas ni datos. Si la información no alcanza, si el cliente pide una persona o si el caso requiere decisión humana, activa la transferencia. Responde en español, con tono natural y en máximo 90 palabras.`,
      input: `BASE DE CONOCIMIENTO:\n${knowledge}\n\nCONVERSACIÓN RECIENTE:\n${history}\n\nNUEVO MENSAJE:\n${input.message}`,
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
  try {
    const parsed = JSON.parse(result.output_text || "{}");
    return { reply: String(parsed.reply || input.handoffMessage), handoff: Boolean(parsed.handoff) };
  } catch {
    return { reply: input.handoffMessage, handoff: true };
  }
}

