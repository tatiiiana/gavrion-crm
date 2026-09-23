import { randomUUID } from "node:crypto";

function safeText(value: unknown, limit = 600) {
  return String(value instanceof Error ? value.message : value || "Error desconocido").replace(/[\r\n]+/g, " ").slice(0, limit);
}

export function reportServerError(scope: string, error: unknown, metadata: Record<string, unknown> = {}) {
  const event = { id: randomUUID(), scope: safeText(scope, 120), message: safeText(error), metadata: Object.fromEntries(Object.entries(metadata).filter(([key]) => !/(token|secret|password|credential|authorization)/i.test(key))), at: new Date().toISOString() };
  console.error("[gavrion:error]", JSON.stringify(event));
  return event.id;
}
