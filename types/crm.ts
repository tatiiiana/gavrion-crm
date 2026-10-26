export type Task = { id: string; title: string; due_at: string | null; completed_at: string | null; assigned_to?: string | null; source?: "manual" | "conversation" | "form" | "followup" | string };
export type Contact = { id: string; name: string; email: string; phone: string; company: string; status: "Cliente" | "Prospecto" | "Inactivo" };
export type DealStage = "new" | "proposal" | "negotiation" | "won";
export type Deal = { id: string; title: string; stage: DealStage; value: number; currency: string; contactId: string; contactName: string; expectedCloseDate: string };
export type Period = "week" | "30d" | "year";


export type CalendarEventKind = "task" | "reservation" | "appointment" | "property_visit" | "external";
export type CalendarEvent = { id: string; kind: CalendarEventKind; title: string; start: string; end?: string | null; detail?: string; status?: string | null; sourceId?: string; editable?: boolean };
