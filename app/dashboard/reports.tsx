"use client";
import { useEffect, useMemo, useState } from "react";
import { downloadCsv } from "./export-utils";

type MetricSet = { conversations: number; contacts: number; opportunities: number; wonDeals: number; salesValue: number; conversion: number; opportunityRate: number; averageResponseMinutes: number | null; responseCount: number; forms: number; reservations: number; orders: number; appointments: number; quotes: number; inquiries: number; visits: number; unanswered: number; staleDeals: number };
type Agent = { id: string; name: string; email: string; replies: number; assignedConversations: number; wonDeals: number; salesValue: number };
type ReportData = {
  period: number; range: { from: string; to: string }; role: string; metrics: MetricSet; previousMetrics: MetricSet; changes: Record<string, number>;
  goals: { contacts: number; sales: number; responseMinutes: number };
  daily: Array<{ date: string; conversations: number; contacts: number; opportunities: number; wonDeals: number }>;
  channels: Array<{ name: string; value: number }>;
  funnel: Array<{ key: string; label: string; count: number; value: number; color: string }>;
  stages: Array<{ key: string; label: string; count: number; value: number; color: string; position: number; probability: number }>;
  operational: Array<{ key: string; label: string; value: number; detail: string; color: string }>;
  agents: Agent[];
  permissions?: { financial?: boolean };
  alerts: Array<{ key: string; severity: string; title: string; detail: string; action: string }>;
};

type ExportRow = { section: string; metric: string; value: number | string; detail: string };

function number(value: number) { return value.toLocaleString("es-HN"); }
function currency(value: number) { return new Intl.NumberFormat("es-HN", { style: "currency", currency: "HNL", maximumFractionDigits: 0 }).format(value); }
function responseLabel(value: number | null) { if (value === null) return "—"; return value < 1 ? "< 1 min" : value >= 60 ? `${Math.floor(value / 60)} h ${Math.round(value % 60)} min` : `${value.toFixed(1)} min`; }
function dateLabel(value: string) { return new Date(`${value}T12:00:00`).toLocaleDateString("es-HN", { day: "2-digit", month: "short" }).replace(".", ""); }
function percent(value: number) { return `${value > 0 ? "+" : ""}${value.toFixed(1)}%`; }
function changeTone(value: number, inverse = false) { const positive = inverse ? value < 0 : value > 0; return value === 0 ? "neutral" : positive ? "positive" : "negative"; }
function clamp(value: number, min: number, max: number) { return Math.min(max, Math.max(min, value)); }

function Delta({ value, inverse = false }: { value: number; inverse?: boolean }) {
  return <span className={`report-delta ${changeTone(value, inverse)}`}>{value === 0 ? "Sin cambio" : `${value > 0 ? "↑" : "↓"} ${percent(value)}`}<small>vs. periodo anterior</small></span>;
}

function Progress({ value, target, inverse = false }: { value: number; target: number; inverse?: boolean }) {
  if (!target) return <span className="goal-no-target">Sin meta configurada</span>;
  const progress = inverse ? (value <= target ? 100 : Math.max(0, (target / Math.max(value, 1)) * 100)) : Math.min(100, (value / target) * 100);
  return <span className="goal-progress"><i style={{ width: `${progress}%` }} /><small>{inverse ? `${value <= target ? "Dentro de meta" : `${responseLabel(value)} / ${responseLabel(target)}`}` : `${Math.round(progress)}% de la meta`}</small></span>;
}

export function ReportsView() {
  const [rangeMode, setRangeMode] = useState("30d");
  const [customFrom, setCustomFrom] = useState(() => new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10));
  const [customTo, setCustomTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [data, setData] = useState<ReportData | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [savingGoals, setSavingGoals] = useState(false);
  const [showGoals, setShowGoals] = useState(false);
  const [goalDraft, setGoalDraft] = useState({ contacts: "", sales: "", responseMinutes: "30" });
  const requestKey = rangeMode === "custom" ? `${rangeMode}:${customFrom}:${customTo}` : rangeMode;

  useEffect(() => {
    if (rangeMode === "custom" && (!customFrom || !customTo)) return;
    let cancelled = false;
    setLoading(true); setError("");
    const params = new URLSearchParams();
    if (rangeMode === "custom") { params.set("from", customFrom); params.set("to", customTo); } else params.set("period", rangeMode);
    fetch(`/api/reports?${params.toString()}`, { cache: "no-store" }).then(async response => {
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "No se pudo cargar el reporte.");
      if (!cancelled) { setData(body as ReportData); setGoalDraft({ contacts: String(body.goals?.contacts || ""), sales: String(body.goals?.sales || ""), responseMinutes: String(body.goals?.responseMinutes || 30) }); }
    }).catch(cause => { if (!cancelled) setError(cause instanceof Error ? cause.message : "No se pudo cargar el reporte."); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [requestKey]);

  const periodLabel = rangeMode === "7d" ? "Últimos 7 días" : rangeMode === "90d" ? "Últimos 90 días" : rangeMode === "365d" ? "Último año" : rangeMode === "custom" ? `${customFrom} → ${customTo}` : "Últimos 30 días";
  const health = useMemo(() => {
    if (!data) return { score: 0, label: "Calculando" };
    const responseScore = data.metrics.averageResponseMinutes === null ? 55 : clamp(100 - (data.metrics.averageResponseMinutes / Math.max(data.goals.responseMinutes, 1) - 1) * 35, 15, 100);
    const conversionScore = clamp(data.metrics.conversion * 3, 0, 100);
    const activityScore = data.metrics.conversations || data.metrics.contacts ? 75 : 20;
    const score = Math.round((responseScore + conversionScore + activityScore) / 3);
    return { score, label: score >= 75 ? "Fuerte" : score >= 50 ? "En desarrollo" : "Requiere atención" };
  }, [data]);

  function exportReport() {
    if (!data) return;
    const rows: ExportRow[] = [
      { section: "Resumen", metric: "Conversaciones", value: data.metrics.conversations, detail: periodLabel },
      { section: "Resumen", metric: "Contactos", value: data.metrics.contacts, detail: periodLabel },
      { section: "Resumen", metric: "Oportunidades", value: data.metrics.opportunities, detail: periodLabel },
      ...(data.permissions?.financial !== false ? [
        { section: "Resumen", metric: "Ventas ganadas", value: data.metrics.wonDeals, detail: periodLabel },
        { section: "Resumen", metric: "Valor vendido", value: currency(data.metrics.salesValue), detail: periodLabel }
      ] : []),
      { section: "Resumen", metric: "Conversión", value: `${data.metrics.conversion}%`, detail: periodLabel },
      { section: "Resumen", metric: "Respuesta promedio", value: responseLabel(data.metrics.averageResponseMinutes), detail: periodLabel },
      ...data.operational.map(item => ({ section: "Operación", metric: item.label, value: item.value, detail: item.detail })),
      ...data.stages.map(item => ({ section: "Embudo por etapa", metric: item.label, value: item.count, detail: currency(item.value) })),
      ...data.agents.map(item => ({ section: "Equipo", metric: item.name, value: item.replies, detail: `${item.wonDeals} ventas · ${currency(item.salesValue)}` })),
      ...data.alerts.map(item => ({ section: "Alertas", metric: item.title, value: item.severity, detail: item.detail }))
    ];
    downloadCsv(`reporte-ejecutivo-${data.range.from}-${data.range.to}`, rows, [
      { key: "section", label: "Sección", value: row => row.section },
      { key: "metric", label: "Métrica", value: row => row.metric },
      { key: "value", label: "Valor", value: row => row.value },
      { key: "detail", label: "Detalle", value: row => row.detail }
    ]);
  }

  async function saveGoals() {
    setSavingGoals(true); setError("");
    try {
      const response = await fetch("/api/reports", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ goals: { contacts: Number(goalDraft.contacts || 0), sales: Number(goalDraft.sales || 0), responseMinutes: Number(goalDraft.responseMinutes || 30) } }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "No se pudieron guardar las metas.");
      setData(current => current ? { ...current, goals: body.goals } : current); setShowGoals(false);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudieron guardar las metas."); } finally { setSavingGoals(false); }
  }

  if (loading && !data) return <section className="view active"><div className="panel report-loading"><strong>Preparando tu reporte ejecutivo…</strong><p>Estamos consolidando actividad del sitio, CRM y equipo.</p></div></section>;
  if (!data) return <section className="view active"><div className="auth-message error">{error || "No se pudo cargar el reporte."}</div></section>;
  const maxTrend = Math.max(...data.daily.flatMap(item => [item.conversations, item.contacts, item.opportunities]), 1);
  const maxChannel = Math.max(...data.channels.map(item => item.value), 1);
  const maxStage = Math.max(...data.stages.map(item => item.count), 1);
  const maxFunnel = Math.max(...data.funnel.map(item => item.count), 1);
  const financialVisible = data.permissions?.financial !== false;
  const metricCards = [
    ["Conversaciones", number(data.metrics.conversations), data.changes.conversations, false],
    ["Contactos nuevos", number(data.metrics.contacts), data.changes.contacts, false],
    ["Oportunidades", number(data.metrics.opportunities), data.changes.opportunities, false],
    ...(financialVisible ? [["Ventas ganadas", number(data.metrics.wonDeals), data.changes.wonDeals, false], ["Valor vendido", currency(data.metrics.salesValue), data.changes.salesValue, false]] : []),
    ["Respuesta promedio", responseLabel(data.metrics.averageResponseMinutes), data.changes.averageResponseMinutes, true]
  ] as Array<[string, string, number, boolean]>;

  return <section className="view active reports-executive-view">
    <div className="section-heading report-heading"><div><p className="eyebrow">INTELIGENCIA COMERCIAL</p><h2>Reportes ejecutivos</h2><p>Una lectura clara de captación, operación, ventas y oportunidades de mejora.</p></div><div className="section-actions report-actions"><select className="select" value={rangeMode} onChange={event => setRangeMode(event.target.value)} aria-label="Periodo del reporte"><option value="7d">Últimos 7 días</option><option value="30d">Últimos 30 días</option><option value="90d">Últimos 90 días</option><option value="365d">Último año</option><option value="custom">Rango personalizado</option></select>{rangeMode === "custom" && <div className="report-date-range"><input type="date" value={customFrom} onChange={event => setCustomFrom(event.target.value)} aria-label="Fecha inicial" /><span>→</span><input type="date" value={customTo} onChange={event => setCustomTo(event.target.value)} aria-label="Fecha final" /></div>}<button className="secondary-button" disabled={loading} onClick={exportReport}>Descargar CSV</button></div></div>
    {error && <div className="auth-message error">{error}</div>}
    <article className="panel report-executive report-hero"><div><p className="eyebrow">RESUMEN EJECUTIVO · {periodLabel}</p><h3>{health.label === "Fuerte" ? "El negocio avanza con buen ritmo." : health.label === "En desarrollo" ? "Hay señales positivas y oportunidades para acelerar." : "Hay señales que requieren atención esta semana."}</h3><p>El panel combina datos del sitio, conversaciones, contactos y ventas para ayudarte a decidir dónde actuar primero.</p></div><div className="report-health-score"><span>Salud comercial</span><strong>{health.score}%</strong><small>{health.label}</small><Delta value={data.changes.conversion || 0} /></div></article>
    <div className="metrics-grid report-metrics report-metrics-six">{metricCards.map(([label, value, change, inverse]) => <article className="metric-card report-metric-card" key={String(label)}><span>{label}</span><strong>{value}</strong><Delta value={Number(change)} inverse={Boolean(inverse)} /></article>)}</div>
    <div className="report-main-grid"><article className="panel report-funnel-panel"><div className="panel-header"><div><p className="eyebrow">EMBUDO COMERCIAL</p><h3>Del contacto al cierre</h3><p>Identifica en qué punto se pierden oportunidades.</p></div></div><div className="report-funnel">{data.funnel.map((item, index) => <div className="funnel-row" key={item.key}><div className="funnel-label"><span style={{ background: item.color }} /> <strong>{item.label}</strong><b>{number(item.count)}</b></div><div className="funnel-track"><i style={{ width: `${Math.max(item.count ? 8 : 2, item.count / maxFunnel * 100)}%`, background: item.color }} /></div><small>{index === 0 ? "Base captada" : index === 1 ? `${data.metrics.opportunityRate}% de contactos` : `${data.metrics.conversion}% de contactos`}{financialVisible && item.value > 0 && ` · ${currency(item.value)}`}</small></div>)}</div></article><article className="panel report-alert-panel"><div className="panel-header"><div><p className="eyebrow">DECISIONES</p><h3>Alertas ejecutivas</h3><p>Señales que merecen una acción.</p></div><span className="report-alert-count">{data.alerts.length}</span></div>{data.alerts.length ? <div className="report-alert-list">{data.alerts.map(alert => <div className={`report-alert ${alert.severity}`} key={alert.key}><span>{alert.severity === "critical" ? "!" : "•"}</span><div><strong>{alert.title}</strong><p>{alert.detail}</p><small>{alert.action}</small></div></div>)}</div> : <div className="report-empty-state"><span>✓</span><strong>Todo bajo control</strong><p>No hay alertas críticas para este periodo.</p></div>}</article></div>
    <div className="report-main-grid report-main-grid-bottom"><article className="panel report-trend-panel"><div className="panel-header"><div><p className="eyebrow">TENDENCIA</p><h3>Actividad por día</h3><p>Separada por conversaciones, contactos y oportunidades.</p></div><div className="report-legend"><span><i className="conversation" />Conversaciones</span><span><i className="contact" />Contactos</span><span><i className="opportunity" />Oportunidades</span></div></div><div className="report-trend-chart">{data.daily.map((item, index) => <div className="trend-day" key={item.date}><div className="trend-bars"><i className="conversation" style={{ height: `${Math.max(item.conversations ? 6 : 2, item.conversations / maxTrend * 100)}%` }} title={`${item.conversations} conversaciones`} /><i className="contact" style={{ height: `${Math.max(item.contacts ? 6 : 2, item.contacts / maxTrend * 100)}%` }} title={`${item.contacts} contactos`} /><i className="opportunity" style={{ height: `${Math.max(item.opportunities ? 6 : 2, item.opportunities / maxTrend * 100)}%` }} title={`${item.opportunities} oportunidades`} /></div>{(data.daily.length <= 31 || index % Math.ceil(data.daily.length / 10) === 0) && <small>{dateLabel(item.date)}</small>}</div>)}</div></article><article className="panel report-channel-panel"><div className="panel-header"><div><p className="eyebrow">CAPTACIÓN</p><h3>Canales que generan demanda</h3><p>Prioriza los puntos de contacto que más conversaciones producen.</p></div></div>{data.channels.length ? <div className="report-channel-list">{data.channels.map(channel => <div key={channel.name}><span><b>{channel.name}</b><small>{number(channel.value)} conversaciones</small></span><i><strong style={{ width: `${Math.max(8, channel.value / maxChannel * 100)}%` }} /></i></div>)}</div> : <div className="report-empty-state"><strong>Sin conversaciones</strong><p>Cuando lleguen mensajes aparecerán aquí.</p></div>}</article></div>
    <div className="report-main-grid report-main-grid-bottom"><article className="panel report-stage-panel"><div className="panel-header"><div><p className="eyebrow">OPORTUNIDADES</p><h3>Valor por etapa</h3><p>Distribución actual de las oportunidades creadas en el periodo.</p></div></div>{data.stages.length ? <div className="report-stage-list">{data.stages.map(stage => <div className="report-stage-row" key={stage.key}><div className="stage-title"><span style={{ background: stage.color }} /><strong>{stage.label}</strong><b>{number(stage.count)}</b></div><div className="stage-track"><i style={{ width: `${Math.max(stage.count ? 6 : 2, stage.count / maxStage * 100)}%`, background: stage.color }} /></div><small>{financialVisible ? `${currency(stage.value)} · ` : ""}Probabilidad {stage.probability}%</small></div>)}</div> : <div className="report-empty-state"><strong>Sin oportunidades</strong><p>Crea oportunidades para ver el embudo por etapa.</p></div>}</article><article className="panel report-goals-panel"><div className="panel-header"><div><p className="eyebrow">GESTIÓN POR METAS</p><h3>Objetivos del periodo</h3><p>Define referencias simples para dirigir al equipo.</p></div><button type="button" className="ghost-button" onClick={() => setShowGoals(value => !value)}>{showGoals ? "Cerrar" : "Editar metas"}</button></div>{showGoals && <div className="report-goal-editor"><label>Contactos<input type="number" min="0" value={goalDraft.contacts} onChange={event => setGoalDraft(current => ({ ...current, contacts: event.target.value }))} /></label><label className={financialVisible ? "" : "hidden-field"}>Ventas ganadas<input type="number" min="0" value={goalDraft.sales} onChange={event => setGoalDraft(current => ({ ...current, sales: event.target.value }))} /></label><label>Respuesta máxima (min)<input type="number" min="1" value={goalDraft.responseMinutes} onChange={event => setGoalDraft(current => ({ ...current, responseMinutes: event.target.value }))} /></label><button type="button" className="primary-button" disabled={savingGoals} onClick={() => void saveGoals()}>{savingGoals ? "Guardando…" : "Guardar metas"}</button></div>}<div className="report-goal-list"><div><span><b>Contactos</b><small>{number(data.metrics.contacts)} de {data.goals.contacts || "sin meta"}</small></span><Progress value={data.metrics.contacts} target={data.goals.contacts} /></div>{financialVisible && <div><span><b>Ventas ganadas</b><small>{number(data.metrics.wonDeals)} de {data.goals.sales || "sin meta"}</small></span><Progress value={data.metrics.wonDeals} target={data.goals.sales} /></div>}<div><span><b>Respuesta</b><small>{responseLabel(data.metrics.averageResponseMinutes)} · objetivo {responseLabel(data.goals.responseMinutes)}</small></span><Progress value={data.metrics.averageResponseMinutes || 0} target={data.goals.responseMinutes} inverse /></div></div></article></div>
    <article className="panel report-operational-panel"><div className="panel-header"><div><p className="eyebrow">OPERACIÓN DEL RUBRO</p><h3>Solicitudes que alimentan el CRM</h3><p>Actividad originada desde formularios, conversaciones y módulos operativos.</p></div></div><div className="report-operational-grid">{data.operational.map(item => <div className="operational-card" key={item.key}><span style={{ background: `${item.color}18`, color: item.color }}>◈</span><div><strong>{number(item.value)}</strong><b>{item.label}</b><small>{item.detail}</small></div></div>)}</div></article>
    <article className="panel report-team-panel"><div className="panel-header"><div><p className="eyebrow">EQUIPO</p><h3>Rendimiento de atención</h3><p>Personas reales, actividad y resultados comerciales.</p></div></div>{data.agents.length ? <div className="table-scroll"><table className="report-team-table"><thead><tr><th>Responsable</th><th>Respuestas</th><th>Conversaciones</th><th>Ventas</th><th>Valor vendido</th></tr></thead><tbody>{data.agents.map(agent => <tr key={agent.id}><td><div className="report-agent"><span>{agent.name.charAt(0).toUpperCase()}</span><strong>{agent.name}<small>{agent.email}</small></strong></div></td><td>{number(agent.replies)}</td><td>{number(agent.assignedConversations)}</td><td>{number(agent.wonDeals)}</td><td>{currency(agent.salesValue)}</td></tr>)}</tbody></table></div> : <div className="report-empty-state"><strong>Aún no hay actividad de equipo</strong><p>Las respuestas y ventas asignadas aparecerán aquí.</p></div>}</article>
  </section>;
}