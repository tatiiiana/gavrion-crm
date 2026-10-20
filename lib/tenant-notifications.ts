import { createAdminSupabase } from "@/lib/supabase/admin";

export type TenantNotificationType =
  | "message" | "unanswered" | "inquiry" | "reservation" | "order" | "appointment"
  | "integration_error" | "site_returned" | "site_published" | "automation_error" | "system";

export const notificationTypeLabels: Record<TenantNotificationType, string> = {
  message: "Mensajes nuevos",
  unanswered: "Conversaciones sin responder",
  inquiry: "Nuevos interesados",
  reservation: "Reservas",
  order: "Pedidos",
  appointment: "Citas y visitas",
  integration_error: "Errores de WhatsApp y canales",
  site_returned: "Sitio devuelto por el implementador",
  site_published: "Sitio publicado",
  automation_error: "Automatizaciones con error",
  system: "Avisos del sistema"
};

/**
 * Envía una notificación privada a cada dueño/administrador activo de la empresa.
 * Respeta las preferencias personales (alertas desactivadas o tipos silenciados).
 * Con dedupeMinutes no repite la alerta de la misma entidad mientras siga sin leer.
 * Nunca lanza errores: una alerta fallida no debe romper el flujo principal.
 */
export async function notifyTenantAdmins(input: {
  tenantId: string;
  type: TenantNotificationType;
  title: string;
  body?: string;
  entityType?: string;
  entityId?: string | null;
  dedupeMinutes?: number;
  excludeUserId?: string | null;
}) {
  try {
    const admin = createAdminSupabase();
    const { error } = await admin.rpc("notify_tenant_admins", {
      p_tenant: input.tenantId,
      p_type: input.type,
      p_title: input.title,
      p_body: input.body || "",
      p_entity_type: input.entityType || null,
      p_entity_id: input.entityId || null,
      p_dedupe_minutes: input.dedupeMinutes || 0,
      p_exclude_user: input.excludeUserId || null
    });
    if (error) console.error("[notifications] No se pudo registrar la alerta", error.message);
  } catch (error) {
    console.error("[notifications] No se pudo registrar la alerta", error);
  }
}

/** Registra un fallo de un canal (WhatsApp, Messenger, Instagram) y avisa a los administradores. */
export async function reportChannelError(input: { tenantId: string; connectionId?: string | null; provider: string; message: string }) {
  try {
    const admin = createAdminSupabase();
    if (input.connectionId) {
      await admin.from("channel_connections")
        .update({ last_error: input.message.slice(0, 500), last_error_at: new Date().toISOString() })
        .eq("id", input.connectionId).eq("tenant_id", input.tenantId);
    }
    const label = input.provider === "whatsapp" ? "WhatsApp" : input.provider === "instagram" ? "Instagram" : "Facebook Messenger";
    await notifyTenantAdmins({
      tenantId: input.tenantId,
      type: "integration_error",
      title: `Error de conexión con ${label}`,
      body: input.message,
      entityType: "channel_connection",
      entityId: input.connectionId || null,
      dedupeMinutes: 60
    });
  } catch (error) {
    console.error("[channel-health] No se pudo registrar el error del canal", error);
  }
}

/** Marca un canal como operativo después de un envío correcto. */
export async function reportChannelOk(input: { tenantId: string; connectionId?: string | null }) {
  if (!input.connectionId) return;
  try {
    await createAdminSupabase().from("channel_connections")
      .update({ last_ok_at: new Date().toISOString() })
      .eq("id", input.connectionId).eq("tenant_id", input.tenantId);
  } catch { /* No bloquea el envío. */ }
}
