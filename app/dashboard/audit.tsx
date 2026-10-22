"use client";

import { useEffect, useState } from "react";
import { downloadCsv } from "./export-utils";

type Log = { id: number; actor_user_id: string | null; action: string; entity_type: string; entity_id: string | null; changes: unknown; created_at: string };
type Member = { id: string; name: string; email: string };
const actions: Record<string, string> = { insert: "Creó", update: "Actualizó", delete: "Eliminó" };
const entities: Record<string, string> = { tenants: "empresa", company_profiles: "perfil empresarial", memberships: "integrante", contacts: "contacto", conversations: "conversación", messages: "mensaje", deals: "oportunidad", tasks: "tarea", properties: "propiedad", property_inquiries: "interesado", property_visits: "visita", automation_flows: "automatización", channel_connections: "integración", account: "cuenta" };

export function AuditView() {
  const [logs, setLogs] = useState<Log[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [filters, setFilters] = useState({ actor: "", from: "", to: "", action: "", area: "", record: "" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => { fetch("/api/team", { cache: "no-store" }).then(response => response.ok ? response.json() : []).then(data => setMembers(Array.isArray(data) ? data : [])).catch(() => undefined); }, []);
  useEffect(() => {
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => { if (value) params.set(key, value); });
    let cancelled = false; setLoading(true); setError("");
    fetch(`/api/audit?${params.toString()}`, { cache: "no-store" }).then(async response => { const body = await response.json(); if (!response.ok) throw Error(body.error); return body; }).then(data => { if (!cancelled) setLogs(Array.isArray(data) ? data : []); }).catch(cause => { if (!cancelled) setError(cause instanceof Error ? cause.message : "No se pudo cargar la auditoría."); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [filters]);

  function update(key: keyof typeof filters, value: string) { setFilters(current => ({ ...current, [key]: value })); }
  const hasFilters = Object.values(filters).some(Boolean);
  function exportAudit(){downloadCsv("auditoria",logs,[{key:"created_at",label:"Fecha",value:log=>new Date(log.created_at).toLocaleString("es-HN")},{key:"actor",label:"Usuario",value:log=>members.find(member=>member.id===log.actor_user_id)?.name||log.actor_user_id||"Sistema"},{key:"action",label:"Acción",value:log=>actions[log.action]||log.action},{key:"entity",label:"Área",value:log=>entities[log.entity_type]||log.entity_type},{key:"record",label:"Registro",value:log=>log.entity_id||"—"},{key:"changes",label:"Cambios",value:log=>JSON.stringify(log.changes)}]);}
  return <section className="view active"><div className="section-heading"><div><h2>Auditoría</h2><p>Registro de cambios realizados en esta empresa.</p></div><button className="secondary-button" onClick={exportAudit}>Descargar CSV</button></div>
    <article className="panel audit-filter-panel"><div className="audit-filters">
      <label>Usuario<select className="select" value={filters.actor} onChange={event => update("actor", event.target.value)}><option value="">Todos los usuarios</option>{members.map(member => <option key={member.id} value={member.id}>{member.name} · {member.email}</option>)}</select></label>
      <label>Desde<input type="date" value={filters.from} onChange={event => update("from", event.target.value)} /></label><label>Hasta<input type="date" value={filters.to} onChange={event => update("to", event.target.value)} /></label>
      <label>Tipo de acción<select className="select" value={filters.action} onChange={event => update("action", event.target.value)}><option value="">Todas</option><option value="insert">Creación</option><option value="update">Modificación</option><option value="delete">Eliminación</option></select></label>
      <label>Área<select className="select" value={filters.area} onChange={event => update("area", event.target.value)}><option value="">Todas las áreas</option><option value="conversation">Conversación</option><option value="contact">Contacto</option><option value="configuration">Configuración</option><option value="integration">Integración</option><option value="team">Equipo</option></select></label>
      <label>Conversación o contacto<input value={filters.record} onChange={event => update("record", event.target.value)} placeholder="ID del registro" /></label>
      {hasFilters && <button type="button" className="ghost-button" onClick={() => setFilters({ actor: "", from: "", to: "", action: "", area: "", record: "" })}>Limpiar</button>}
    </div></article>
    {error && <div className="auth-message error">{error}</div>}
    <article className="panel audit-list">{loading ? <p className="table-empty">Cargando auditoría…</p> : logs.length ? logs.map(log => <div className="audit-row" key={log.id}><span className={`audit-action ${log.action}`}>{log.action === "insert" ? "+" : log.action === "delete" ? "−" : "↻"}</span><div><strong>{actions[log.action] || log.action} {entities[log.entity_type] || log.entity_type}</strong><small>{new Date(log.created_at).toLocaleString("es-HN")} · Usuario: {members.find(member => member.id === log.actor_user_id)?.name || log.actor_user_id || "Sistema"} · Registro: {log.entity_id || "—"}</small></div><details><summary>Detalles</summary><pre>{JSON.stringify(log.changes, null, 2)}</pre></details></div>) : <p className="table-empty">No hay acciones con estos filtros.</p>}</article>
  </section>;
}
