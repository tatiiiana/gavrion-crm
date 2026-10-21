"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import "./owner-center.css";
import { createClientSupabase } from "@/lib/supabase/client";

export type OwnerNotification = { id: string; type: string; title: string; body: string; entity_type: string | null; entity_id: string | null; read_at: string | null; created_at: string };
type HealthItem = { key: string; label: string; status: string; detail: string; settingsTab?: string };
type DataRequest = { id: string; request_type: "deletion" | "account_closure"; reason: string | null; status: string; created_at: string; resolved_at: string | null };
type Preferences = { in_app: boolean; browser: boolean; email_digest: boolean; muted_types: string[] };
type Data = {
  role: "owner" | "admin";
  account: { email: string; fullName: string; phone: string; lastSignInAt: string | null };
  health: HealthItem[];
  site: { published_url?: string | null } | null;
  notifications: OwnerNotification[];
  notificationTypes: Array<{ type: string; label: string }>;
  preferences: Preferences;
  automationErrors: Array<{ id: string; error_message: string | null; created_at: string }>;
  dataRequests: DataRequest[];
  accessHistory: Array<{ id: number; event_type: string; ip_address: string | null; user_agent: string | null; created_at: string }>;
};
type ActivityRow = { id: number; action: string; entity_type: string; created_at: string; by_me: boolean; by_system: boolean; name: string; changedFields: string[] };
type Section = "resumen" | "alertas" | "actividad" | "cuenta" | "datos";

const statusLabels: Record<string, string> = { connected: "Conectado", active: "Activo", inactive: "Inactivo", installed: "Instalado", pending: "Pendiente", published: "Publicado", unpublished: "Sin publicar", verified: "Verificado", error: "Error" };
const goodStatuses = ["connected", "active", "installed", "published", "verified"];
const typeIcons: Record<string, string> = { message: "✉", unanswered: "⏱", inquiry: "★", reservation: "▦", order: "▤", appointment: "◷", integration_error: "⚠", site_returned: "↩", site_published: "✓", automation_error: "⚙", system: "ℹ" };
const actionLabels: Record<string, string> = { insert: "Creó", update: "Actualizó", delete: "Eliminó" };
const entityLabels: Record<string, string> = { contacts: "Contacto", deals: "Oportunidad", tasks: "Tarea", conversations: "Conversación", memberships: "Equipo", tenants: "Empresa", company_profiles: "Perfil de empresa", properties: "Propiedad", property_inquiries: "Interesado", property_visits: "Visita", automation_flows: "Automatización", tenant_data_requests: "Solicitud de datos", account: "Mi cuenta" };
const requestLabels: Record<string, string> = { deletion: "Eliminación de datos", account_closure: "Baja de la empresa" };
const requestStatus: Record<string, string> = { pending: "Pendiente", in_review: "En revisión", completed: "Completada", cancelled: "Cancelada" };

export function timeAgo(value: string) {
  const minutes = Math.round((Date.now() - new Date(value).getTime()) / 60000);
  if (minutes < 1) return "ahora";
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `hace ${hours} h`;
  const days = Math.round(hours / 24);
  return days < 7 ? `hace ${days} d` : new Date(value).toLocaleDateString("es-HN");
}

export function notificationIcon(type: string) { return typeIcons[type] || "•"; }

async function request<T = unknown>(input: string, init?: RequestInit): Promise<T> {
  const response = await fetch(input, { cache: "no-store", ...init, headers: { "Content-Type": "application/json", ...(init?.headers || {}) } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || "No se pudo completar la acción.");
  return body as T;
}

export function OwnerCenter({ onNavigateSettings, onOpenNotification, onChanged }: {
  onNavigateSettings?: (tab: string) => void;
  onOpenNotification?: (item: OwnerNotification) => void;
  onChanged?: () => void;
}) {
  const [data, setData] = useState<Data | null>(null);
  const [section, setSection] = useState<Section>("resumen");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try { setData(await request<Data>("/api/owner/center")); setError(""); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo cargar el centro de control."); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (!success) return; const timer = window.setTimeout(() => setSuccess(""), 4000); return () => window.clearTimeout(timer); }, [success]);

  async function patch(body: Record<string, unknown>, message?: string) {
    setSaving(true); setError("");
    try { await request("/api/owner/center", { method: "PATCH", body: JSON.stringify(body) }); if (message) setSuccess(message); await load(); onChanged?.(); return true; }
    catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo guardar."); return false; }
    finally { setSaving(false); }
  }
  const open = (item: OwnerNotification) => { if (!item.read_at) void patch({ action: "read", id: item.id }); onOpenNotification?.(item); };

  if (!data && !error) return <article className="panel"><p>Cargando centro de control…</p></article>;
  const unread = data?.notifications.filter(item => !item.read_at).length || 0;
  const issues = data?.health.filter(item => item.status === "error").length || 0;
  const tabs: Array<[Section, string, number]> = [["resumen", "Resumen", issues], ["alertas", "Notificaciones", unread], ["actividad", "Actividad", 0], ["cuenta", "Mi cuenta", 0], ["datos", "Datos y privacidad", 0]];

  return <section className="owner-center">
    {error && <div className="owner-alert error" role="alert">{error}</div>}
    {success && <div className="owner-alert success" role="status">{success}</div>}
    <nav className="owner-tabs" aria-label="Secciones del centro de control">
      {tabs.map(([key, label, count]) => <button key={key} type="button" className={section === key ? "active" : ""} onClick={() => setSection(key)}>{label}{count > 0 && <b>{count}</b>}</button>)}
    </nav>
    {data && section === "resumen" && <Summary data={data} unread={unread} onNavigateSettings={onNavigateSettings} onSeeAlerts={() => setSection("alertas")} onOpen={open} />}
    {data && section === "alertas" && <Notifications data={data} saving={saving} patch={patch} onOpen={open} />}
    {section === "actividad" && <Activity />}
    {data && section === "cuenta" && <Account data={data} saving={saving} patch={patch} />}
    {data && section === "datos" && <DataControls data={data} onError={setError} onSuccess={setSuccess} reload={load} />}
  </section>;
}

// ---------- Resumen: salud de integraciones + últimas alertas ----------

function Summary({ data, unread, onNavigateSettings, onSeeAlerts, onOpen }: { data: Data; unread: number; onNavigateSettings?: (tab: string) => void; onSeeAlerts: () => void; onOpen: (item: OwnerNotification) => void }) {
  const healthy = data.health.filter(item => goodStatuses.includes(item.status)).length;
  return <div className="owner-center-grid">
    <article className="panel owner-health">
      <div className="panel-header"><div><p className="eyebrow">SALUD DE INTEGRACIONES</p><h3>Servicios de tu empresa</h3><p>{healthy} de {data.health.length} funcionando correctamente.</p></div></div>
      <ul className="health-list">
        {data.health.map(item => <li key={item.key} className="health-row">
          <span className={`health-dot ${item.status}`} aria-hidden="true" />
          <div><strong>{item.label}</strong><small title={item.detail}>{item.detail}</small></div>
          <b className={`health-badge ${item.status}`}>{statusLabels[item.status] || item.status}</b>
          {item.settingsTab && onNavigateSettings && !goodStatuses.includes(item.status) ? <button type="button" className="ghost-button" onClick={() => onNavigateSettings(item.settingsTab!)}>Revisar</button> : <span />}
        </li>)}
      </ul>
      {data.site?.published_url && <a className="secondary-button owner-site-link" href={data.site.published_url} target="_blank" rel="noreferrer">Abrir sitio publicado ↗</a>}
    </article>
    <article className="panel">
      <div className="panel-header"><div><p className="eyebrow">CENTRO DE NOTIFICACIONES</p><h3>Alertas recientes</h3><p>{unread ? `${unread} sin leer` : "Estás al día."}</p></div><button type="button" className="ghost-button" onClick={onSeeAlerts}>Ver todas</button></div>
      <NotificationList items={data.notifications.slice(0, 6)} onOpen={onOpen} />
      {data.automationErrors.length > 0 && <div className="automation-errors"><strong>Automatizaciones con error (últimos 14 días)</strong>{data.automationErrors.slice(0, 3).map(item => <p key={item.id}>{item.error_message || "Error sin detalle"} · {timeAgo(item.created_at)}</p>)}</div>}
    </article>
  </div>;
}

export function NotificationList({ items, onOpen, compact = false }: { items: OwnerNotification[]; onOpen: (item: OwnerNotification) => void; compact?: boolean }) {
  if (!items.length) return <p className="task-empty">No hay alertas.</p>;
  return <ul className={`owner-notifications${compact ? " compact" : ""}`}>
    {items.map(item => <li key={item.id}><button type="button" className={item.read_at ? "read" : "unread"} onClick={() => onOpen(item)}>
      <span className={`notification-icon ${item.type}`} aria-hidden="true">{notificationIcon(item.type)}</span>
      <span className="notification-text"><strong>{item.title}</strong><span>{item.body || "Sin detalle"}</span></span>
      <small>{timeAgo(item.created_at)}</small>
    </button></li>)}
  </ul>;
}

// ---------- Notificaciones: lista completa + preferencias personales ----------

function Notifications({ data, saving, patch, onOpen }: { data: Data; saving: boolean; patch: (body: Record<string, unknown>, message?: string) => Promise<boolean>; onOpen: (item: OwnerNotification) => void }) {
  const [filter, setFilter] = useState("all");
  const [onlyUnread, setOnlyUnread] = useState(false);
  const [browserBlocked, setBrowserBlocked] = useState(false);
  useEffect(() => { setBrowserBlocked("Notification" in window && Notification.permission === "denied"); }, []);
  const prefs = data.preferences;
  const items = data.notifications.filter(item => (filter === "all" || item.type === filter) && (!onlyUnread || !item.read_at));
  const savePrefs = (next: Partial<Preferences>) => {
    const merged = { ...prefs, ...next };
    return patch({ action: "preferences", inApp: merged.in_app, browser: merged.browser, emailDigest: merged.email_digest, mutedTypes: merged.muted_types }, "Preferencias guardadas.");
  };
  async function toggleBrowser(checked: boolean) {
    if (checked && "Notification" in window && Notification.permission === "default") {
      const permission = await Notification.requestPermission();
      setBrowserBlocked(permission === "denied");
    }
    await savePrefs({ browser: checked });
  }

  return <div className="owner-center-grid wide-left">
    <article className="panel">
      <div className="panel-header"><div><p className="eyebrow">CENTRO DE NOTIFICACIONES</p><h3>Todas las alertas</h3></div><button type="button" className="ghost-button" disabled={saving || !data.notifications.some(item => !item.read_at)} onClick={() => patch({ action: "read" }, "Todas las alertas quedaron leídas.")}>Marcar todas leídas</button></div>
      <div className="owner-filters">
        <select className="select" value={filter} onChange={event => setFilter(event.target.value)} aria-label="Filtrar por tipo"><option value="all">Todos los tipos</option>{data.notificationTypes.map(item => <option key={item.type} value={item.type}>{item.label}</option>)}</select>
        <label className="owner-check"><input type="checkbox" checked={onlyUnread} onChange={event => setOnlyUnread(event.target.checked)} /> Solo sin leer</label>
      </div>
      <NotificationList items={items} onOpen={onOpen} />
    </article>
    <article className="panel">
      <div className="panel-header"><div><p className="eyebrow">MIS NOTIFICACIONES</p><h3>Cómo y qué recibir</h3><p>Estas preferencias son personales; no afectan a tu equipo.</p></div></div>
      <div className="owner-preferences">
        <label><input type="checkbox" disabled={saving} checked={prefs.in_app} onChange={event => savePrefs({ in_app: event.target.checked })} /> Alertas dentro de Gavrion</label>
        <label><input type="checkbox" disabled={saving} checked={prefs.browser} onChange={event => toggleBrowser(event.target.checked)} /> Notificaciones del navegador</label>
        {browserBlocked && <small className="owner-hint">Tu navegador bloqueó las notificaciones. Actívalas desde el candado de la barra de direcciones.</small>}
        <label><input type="checkbox" disabled={saving} checked={prefs.email_digest} onChange={event => savePrefs({ email_digest: event.target.checked })} /> Resumen diario por correo <em>(próximamente)</em></label>
      </div>
      <h4 className="owner-subtitle">Tipos de alerta</h4>
      <div className="owner-preferences types">
        {data.notificationTypes.map(item => <label key={item.type}><input type="checkbox" disabled={saving || !prefs.in_app} checked={!prefs.muted_types.includes(item.type)} onChange={event => savePrefs({ muted_types: event.target.checked ? prefs.muted_types.filter(type => type !== item.type) : [...prefs.muted_types, item.type] })} /> {item.label}</label>)}
      </div>
    </article>
  </div>;
}

// ---------- Actividad con filtros ----------

function Activity() {
  const [filters, setFilters] = useState({ from: "", to: "", action: "", entity: "", mine: false });
  const [page, setPage] = useState(0);
  const [rows, setRows] = useState<ActivityRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const query = useCallback((extra: Record<string, string> = {}) => {
    const params = new URLSearchParams();
    if (filters.from) params.set("from", filters.from);
    if (filters.to) params.set("to", filters.to);
    if (filters.action) params.set("action", filters.action);
    if (filters.entity) params.set("entity", filters.entity);
    if (filters.mine) params.set("mine", "1");
    for (const [key, value] of Object.entries(extra)) params.set(key, value);
    return params.toString();
  }, [filters]);
  useEffect(() => {
    let cancelled = false; setLoading(true); setError("");
    request<{ rows: ActivityRow[]; total: number }>(`/api/owner/center?${query({ activity: "1", page: String(page) })}`)
      .then(body => { if (!cancelled) { setRows(body.rows); setTotal(body.total); } })
      .catch(cause => { if (!cancelled) setError(cause instanceof Error ? cause.message : "No se pudo cargar la actividad."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [query, page]);
  const update = (next: Partial<typeof filters>) => { setPage(0); setFilters(current => ({ ...current, ...next })); };
  const pages = Math.max(1, Math.ceil(total / 25));
  const hasFilters = Boolean(filters.from || filters.to || filters.action || filters.entity || filters.mine);

  return <article className="panel">
    <div className="panel-header"><div><p className="eyebrow">ACTIVIDAD RECIENTE</p><h3>Auditoría de la empresa</h3><p>{total} registro{total === 1 ? "" : "s"}{hasFilters ? " con los filtros actuales" : ""}.</p></div><a className="secondary-button" href={`/api/owner/center?${query({ export: "activity" })}`}>Exportar CSV</a></div>
    <div className="owner-filters">
      <label>Desde<input type="date" value={filters.from} onChange={event => update({ from: event.target.value })} /></label>
      <label>Hasta<input type="date" value={filters.to} onChange={event => update({ to: event.target.value })} /></label>
      <label>Acción<select className="select" value={filters.action} onChange={event => update({ action: event.target.value })}><option value="">Todas</option><option value="insert">Creación</option><option value="update">Modificación</option><option value="delete">Eliminación</option></select></label>
      <label>Módulo<select className="select" value={filters.entity} onChange={event => update({ entity: event.target.value })}><option value="">Todos</option>{Object.entries(entityLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      <label className="owner-check"><input type="checkbox" checked={filters.mine} onChange={event => update({ mine: event.target.checked })} /> Solo mis acciones</label>
      {hasFilters && <button type="button" className="ghost-button" onClick={() => update({ from: "", to: "", action: "", entity: "", mine: false })}>Limpiar</button>}
    </div>
    {error && <div className="owner-alert error">{error}</div>}
    {loading ? <p className="task-empty">Cargando actividad…</p> : rows.length ? <div className="table-scroll"><table className="owner-activity-table"><thead><tr><th>Fecha</th><th>Acción</th><th>Registro</th><th>Responsable</th></tr></thead><tbody>
      {rows.map(row => <tr key={row.id}>
        <td>{new Date(row.created_at).toLocaleString("es-HN", { dateStyle: "short", timeStyle: "short" })}</td>
        <td><span className={`activity-action ${row.action}`}>{actionLabels[row.action] || row.action}</span> {entityLabels[row.entity_type] || row.entity_type}</td>
        <td><strong>{row.name || "—"}</strong>{row.changedFields.length > 0 && <small>Cambió: {row.changedFields.join(", ")}</small>}</td>
        <td>{row.by_me ? "Tú" : row.by_system ? "Sistema / asistente" : "Miembro del equipo"}</td>
      </tr>)}
    </tbody></table></div> : <p className="task-empty">No hay actividad con estos filtros.</p>}
    {pages > 1 && <div className="owner-pager"><button type="button" className="ghost-button" disabled={page === 0} onClick={() => setPage(value => value - 1)}>← Anterior</button><span>Página {page + 1} de {pages}</span><button type="button" className="ghost-button" disabled={page + 1 >= pages} onClick={() => setPage(value => value + 1)}>Siguiente →</button></div>}
  </article>;
}

// ---------- Mi cuenta ----------

function Account({ data, saving, patch }: { data: Data; saving: boolean; patch: (body: Record<string, unknown>, message?: string) => Promise<boolean> }) {
  const [fullName, setFullName] = useState(data.account.fullName);
  const [phone, setPhone] = useState(data.account.phone);
  const [email, setEmail] = useState(data.account.email);
  const [currentPassword, setCurrentPassword] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [localError, setLocalError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault(); setLocalError("");
    if (password && password !== confirm) { setLocalError("Las contraseñas nuevas no coinciden."); return; }
    const emailChanged = email.trim().toLowerCase() !== data.account.email.trim().toLowerCase();
    if ((password || emailChanged) && !currentPassword) { setLocalError("Escribe tu contraseña actual para cambiar el correo o la contraseña."); return; }
    const ok = await patch({ action: "account", fullName, phone, email, password, currentPassword }, emailChanged ? "Revisa el nuevo correo para confirmar el cambio." : password ? "Datos y contraseña actualizados." : "Datos actualizados.");
    if (ok) { setCurrentPassword(""); setPassword(""); setConfirm(""); }
  }
  return <div className="owner-account-grid">
  <form className="panel owner-account" onSubmit={submit}>
    <div className="panel-header"><div><p className="eyebrow">MI CUENTA</p><h3>Datos personales y contraseña</h3><p>Correo de acceso: <strong>{data.account.email}</strong></p></div></div>
    <div className="owner-form-grid">
      <label>Nombre completo<input required value={fullName} onChange={event => setFullName(event.target.value)} maxLength={120} /></label>
      <label>Teléfono<input value={phone} onChange={event => setPhone(event.target.value)} placeholder="+504 9999-9999" maxLength={30} /></label>
    </div>
    <label className="owner-account-email">Correo de acceso<input required type="email" value={email} onChange={event => setEmail(event.target.value)} maxLength={180} /><small>Al cambiarlo recibirás un enlace de confirmación en el nuevo correo.</small></label>
    <h4 className="owner-subtitle">Cambiar contraseña <small>(opcional)</small></h4>
    <div className="owner-form-grid three">
      <label>Contraseña actual<input type="password" autoComplete="current-password" value={currentPassword} onChange={event => setCurrentPassword(event.target.value)} /></label>
      <label>Nueva contraseña<input type="password" autoComplete="new-password" value={password} onChange={event => setPassword(event.target.value)} placeholder="Mínimo 8, con letras y números" /></label>
      <label>Confirmar nueva<input type="password" autoComplete="new-password" value={confirm} onChange={event => setConfirm(event.target.value)} /></label>
    </div>
    {localError && <div className="owner-alert error">{localError}</div>}
    <div className="owner-form-actions"><button className="primary-button" disabled={saving}>{saving ? "Guardando…" : "Guardar cambios"}</button></div>
  </form>
  <SecurityPanel data={data} />
  </div>;
}

type MfaFactor = { id: string; friendly_name?: string; factor_type: string; status: string };

function SecurityPanel({ data }: { data: Data }) {
  const [factors, setFactors] = useState<MfaFactor[]>([]);
  const [enrollment, setEnrollment] = useState<{ id: string; qr: string; secret: string } | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const supabase = createClientSupabase();

  const loadFactors = useCallback(async () => {
    if (!supabase) return;
    const result = await supabase.auth.mfa.listFactors();
    if (!result.error) setFactors((result.data?.all || []) as MfaFactor[]);
  }, [supabase]);
  useEffect(() => { void loadFactors(); }, [loadFactors]);

  async function beginEnrollment() {
    if (!supabase) return;
    setBusy(true); setError(""); setMessage("");
    const result = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: "Gavrion" });
    setBusy(false);
    if (result.error || !result.data?.id || result.data.type !== "totp") { setError(result.error?.message || "No se pudo iniciar la configuración de dos pasos."); return; }
    setEnrollment({ id: result.data.id, qr: result.data.totp.qr_code, secret: result.data.totp.secret });
  }

  async function verifyEnrollment(event: FormEvent) {
    event.preventDefault();
    if (!supabase || !enrollment || !/^\d{6}$/.test(code)) { setError("Escribe el código de 6 dígitos de tu aplicación."); return; }
    setBusy(true); setError("");
    const challenge = await supabase.auth.mfa.challenge({ factorId: enrollment.id });
    if (challenge.error) { setBusy(false); setError(challenge.error.message); return; }
    const verified = await supabase.auth.mfa.verify({ factorId: enrollment.id, challengeId: challenge.data.id, code });
    setBusy(false);
    if (verified.error) { setError(verified.error.message); return; }
    await request("/api/owner/center", { method: "PATCH", body: JSON.stringify({ action: "security_event", eventType: "mfa_enabled" }) }).catch(() => undefined);
    setEnrollment(null); setCode(""); setMessage("Autenticación de dos pasos activada."); await loadFactors();
  }

  async function removeFactor(factorId: string) {
    if (!supabase || !window.confirm("¿Desactivar la autenticación de dos pasos?")) return;
    setBusy(true); setError("");
    const result = await supabase.auth.mfa.unenroll({ factorId });
    setBusy(false);
    if (result.error) { setError(result.error.message); return; }
    await request("/api/owner/center", { method: "PATCH", body: JSON.stringify({ action: "security_event", eventType: "mfa_disabled" }) }).catch(() => undefined);
    setMessage("Autenticación de dos pasos desactivada."); await loadFactors();
  }

  async function closeAllSessions() {
    if (!supabase || !window.confirm("Se cerrarán todas las sesiones, incluida esta. ¿Continuar?")) return;
    setBusy(true); setError("");
    await request("/api/owner/center", { method: "PATCH", body: JSON.stringify({ action: "session_revoke" }) }).catch(() => undefined);
    await supabase.auth.signOut({ scope: "global" });
    window.location.replace("/login?session=revoked");
  }

  return <article className="panel owner-security">
    <div className="panel-header"><div><p className="eyebrow">SEGURIDAD</p><h3>Sesiones y acceso</h3><p>Último acceso: {data.account.lastSignInAt ? new Date(data.account.lastSignInAt).toLocaleString("es-HN") : "Sin registro"}.</p></div></div>
    <button type="button" className="secondary-button" disabled={busy} onClick={() => void closeAllSessions()}>Cerrar todas las sesiones</button>
    <h4 className="owner-subtitle">Autenticación de dos pasos</h4>
    {factors.filter(item => item.status === "verified").length ? <div className="owner-mfa-active"><span>✓</span><div><strong>Protección activa</strong><small>Aplicación autenticadora configurada.</small></div>{factors.filter(item => item.status === "verified").map(item => <button key={item.id} type="button" className="ghost-button" disabled={busy} onClick={() => void removeFactor(item.id)}>Desactivar</button>)}</div> : enrollment ? <form className="owner-mfa-enroll" onSubmit={verifyEnrollment}><p>Escanea el código QR con Google Authenticator, 1Password o una aplicación compatible.</p><img src={enrollment.qr} alt="Código QR para autenticación de dos pasos" /><small>Si no puedes escanearlo: <code>{enrollment.secret}</code></small><label>Código de verificación<input inputMode="numeric" pattern="[0-9]{6}" maxLength={6} value={code} onChange={event => setCode(event.target.value.replace(/\D/g, ""))} /></label>{error && <div className="owner-alert error">{error}</div>}<button className="primary-button" disabled={busy || code.length !== 6}>{busy ? "Verificando…" : "Activar protección"}</button></form> : <><p className="owner-hint">Añade una segunda comprobación al iniciar sesión.</p><button type="button" className="secondary-button" disabled={busy} onClick={() => void beginEnrollment()}>{busy ? "Preparando…" : "Configurar aplicación"}</button></>}
    {message && <div className="owner-alert success">{message}</div>}
    {error && !enrollment && <div className="owner-alert error">{error}</div>}
    <h4 className="owner-subtitle">Historial de accesos</h4>
    {data.accessHistory.length ? <ul className="access-history">{data.accessHistory.slice(0, 8).map(item => <li key={item.id}><span className="access-event-dot" /><div><strong>{item.event_type === "login" ? "Inicio de sesión" : item.event_type === "session_revoked" ? "Sesiones cerradas" : item.event_type === "password_change" ? "Contraseña cambiada" : item.event_type === "email_change" ? "Cambio de correo" : item.event_type === "mfa_enabled" ? "2FA activado" : item.event_type === "mfa_disabled" ? "2FA desactivado" : item.event_type}</strong><small>{new Date(item.created_at).toLocaleString("es-HN")}{item.ip_address ? ` · ${item.ip_address}` : ""}</small></div></li>)}</ul> : <p className="owner-hint">Aún no hay accesos registrados. Se guardarán a partir del siguiente inicio de sesión.</p>}
  </article>;
}

// ---------- Datos y privacidad ----------

function DataControls({ data, onError, onSuccess, reload }: { data: Data; onError: (message: string) => void; onSuccess: (message: string) => void; reload: () => Promise<void> }) {
  const [days, setDays] = useState("30");
  const [type, setType] = useState<"deletion" | "account_closure">("deletion");
  const [reason, setReason] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [sending, setSending] = useState(false);
  const isOwner = data.role === "owner";
  const openRequest = data.dataRequests.find(item => item.request_type === type && ["pending", "in_review"].includes(item.status));

  async function submit(event: FormEvent) {
    event.preventDefault(); setSending(true); onError("");
    try { await request("/api/owner/center", { method: "POST", body: JSON.stringify({ type, reason, confirm }) }); setReason(""); setConfirm(false); onSuccess("Solicitud registrada. El equipo Gavrion la revisará y te contactará antes de ejecutar cualquier acción."); await reload(); }
    catch (cause) { onError(cause instanceof Error ? cause.message : "No se pudo registrar la solicitud."); }
    finally { setSending(false); }
  }
  async function cancel(id: string) {
    setSending(true);
    try { await request("/api/owner/center", { method: "PATCH", body: JSON.stringify({ action: "cancel_request", id }) }); onSuccess("Solicitud cancelada."); await reload(); }
    catch (cause) { onError(cause instanceof Error ? cause.message : "No se pudo cancelar."); }
    finally { setSending(false); }
  }

  return <div className="owner-center-grid">
    <article className="panel">
      <div className="panel-header"><div><p className="eyebrow">EXPORTAR</p><h3>Descarga tu información</h3><p>Archivos CSV compatibles con Excel y Google Sheets.</p></div></div>
      <div className="owner-exports">
        <a className="owner-export" href="/api/owner/center?export=contacts"><strong>Contactos</strong><span>Clientes y prospectos con datos de contacto.</span></a>
        <a className="owner-export" href="/api/owner/center?export=opportunities"><strong>Oportunidades</strong><span>Pipeline comercial con etapa, valor y contacto.</span></a>
        <div className="owner-export"><strong>Reporte de resultados</strong><span>Conversaciones, contactos y ventas del periodo.</span><div className="owner-export-row"><select className="select" value={days} onChange={event => setDays(event.target.value)} aria-label="Periodo del reporte"><option value="7">Últimos 7 días</option><option value="30">Últimos 30 días</option><option value="90">Últimos 90 días</option><option value="365">Último año</option></select><a className="secondary-button" href={`/api/owner/center?export=report&days=${days}`}>Descargar</a></div></div>
        <a className="owner-export" href="/api/owner/center?export=activity"><strong>Actividad</strong><span>Registro de auditoría completo de la empresa.</span></a>
      </div>
    </article>
    <article className="panel owner-danger">
      <div className="panel-header"><div><p className="eyebrow">CONTROL DE LA EMPRESA</p><h3>Eliminación de datos o baja</h3><p>Las solicitudes se revisan manualmente. Nada se borra de forma automática.</p></div></div>
      {!isOwner ? <p className="owner-hint">Solo el propietario de la empresa puede enviar estas solicitudes.</p> : <form onSubmit={submit} className="owner-request-form">
        <label>Tipo de solicitud<select className="select" value={type} onChange={event => setType(event.target.value as typeof type)}><option value="deletion">Eliminar datos de clientes y conversaciones</option><option value="account_closure">Dar de baja la empresa en Gavrion</option></select></label>
        <label>Motivo<textarea required minLength={8} maxLength={500} rows={3} value={reason} onChange={event => setReason(event.target.value)} placeholder="Cuéntanos el motivo y, si aplica, qué datos deseas eliminar." /></label>
        <label className="owner-check"><input type="checkbox" checked={confirm} onChange={event => setConfirm(event.target.checked)} /> {type === "account_closure" ? "Entiendo que la baja desactiva el CRM, el chatbox y los canales conectados." : "Entiendo que los datos eliminados no podrán recuperarse."}</label>
        {openRequest && <p className="owner-hint">Ya tienes una solicitud de este tipo en revisión.</p>}
        <button className="danger-button" disabled={sending || !confirm || reason.trim().length < 8 || Boolean(openRequest)}>{sending ? "Enviando…" : "Enviar solicitud"}</button>
      </form>}
      {data.dataRequests.length > 0 && <ul className="owner-requests">
        {data.dataRequests.map(item => <li key={item.id}><div><strong>{requestLabels[item.request_type]}</strong><small>{new Date(item.created_at).toLocaleDateString("es-HN")} · {item.reason}</small></div><span className={`request-status-pill ${item.status}`}>{requestStatus[item.status] || item.status}</span>{isOwner && item.status === "pending" ? <button type="button" className="ghost-button" disabled={sending} onClick={() => cancel(item.id)}>Cancelar</button> : <span />}</li>)}
      </ul>}
    </article>
  </div>;
}
