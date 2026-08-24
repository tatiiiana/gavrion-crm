import { createAdminSupabase } from "@/lib/supabase/admin";

type AutomationEvent = { tenantId: string; event: "message_received" | "contact_created" | "deal_won" | "conversation_handoff"; payload: Record<string, unknown> };
type Condition = { field?: string; operator?: string; value?: string };
type Action = { type?: string; value?: string };

function matches(payload: Record<string, unknown>, conditions: Condition[]) {
  return conditions.every(condition => {
    const actual = String(payload[condition.field || ""] ?? "").toLowerCase();
    const expected = String(condition.value || "").toLowerCase();
    if (condition.operator === "equals") return actual === expected;
    if (condition.operator === "contains") return actual.includes(expected);
    if (condition.operator === "not_equals") return actual !== expected;
    return true;
  });
}

export async function runAutomations(input: AutomationEvent) {
  const supabase = createAdminSupabase();
  const { data: flows } = await supabase.from("automation_flows").select("id, conditions, actions").eq("tenant_id", input.tenantId).eq("trigger_event", input.event).eq("enabled", true);
  for (const flow of flows || []) {
    const conditions = Array.isArray(flow.conditions) ? flow.conditions as Condition[] : [];
    if (!matches(input.payload, conditions)) {
      await supabase.from("automation_runs").insert({ tenant_id: input.tenantId, flow_id: flow.id, event_type: input.event, status: "skipped", input: input.payload, output: { reason: "conditions" } });
      continue;
    }
    try {
      const results: Record<string, unknown>[] = [];
      for (const action of (Array.isArray(flow.actions) ? flow.actions as Action[] : [])) {
        if (action.type === "create_task") {
          const due = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
          const result = await supabase.from("tasks").insert({ tenant_id: input.tenantId, title: action.value || `Dar seguimiento a ${input.payload.contactName || "nuevo contacto"}`, due_at: due, assigned_to: input.payload.assignedTo || null }).select("id").single();
          if (result.error) throw result.error; results.push({ action: action.type, id: result.data.id });
        } else if (action.type === "change_contact_status" && input.payload.contactId) {
          const result = await supabase.from("contacts").update({ status: action.value || "lead" }).eq("id", input.payload.contactId).eq("tenant_id", input.tenantId);
          if (result.error) throw result.error; results.push({ action: action.type });
        } else if (action.type === "assign_conversation" && input.payload.conversationId) {
          const result = await supabase.from("conversations").update({ assigned_to: action.value || null, handling_mode: action.value ? "human" : "bot" }).eq("id", input.payload.conversationId).eq("tenant_id", input.tenantId);
          if (result.error) throw result.error; results.push({ action: action.type });
        }
      }
      await supabase.from("automation_runs").insert({ tenant_id: input.tenantId, flow_id: flow.id, event_type: input.event, status: "success", input: input.payload, output: { actions: results } });
    } catch (error) {
      await supabase.from("automation_runs").insert({ tenant_id: input.tenantId, flow_id: flow.id, event_type: input.event, status: "error", input: input.payload, error_message: error instanceof Error ? error.message : "Error desconocido" });
    }
  }
}

