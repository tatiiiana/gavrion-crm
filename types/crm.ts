export type Task = { id: string; title: string; due_at: string | null; completed_at: string | null };
export type Contact = { id: string; name: string; email: string; phone: string; company: string; status: "Cliente" | "Prospecto" | "Inactivo" };
export type DealStage = "new" | "proposal" | "negotiation" | "won";
export type Deal = { id: string; title: string; stage: DealStage; value: number; currency: string; contactId: string; contactName: string; expectedCloseDate: string };
export type Period = "week" | "30d" | "year";
