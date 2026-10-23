"use client";
import { useEffect, useMemo, useState } from "react";
import { downloadCsv } from "./export-utils";

type Report = {
  metrics: { conversations: number; contacts: number; conversion: number; averageResponseMinutes: number; wonDeals: number; salesValue: number };
  channels: { name: string; value: number }[];
  daily: { date: string; conversations: number; contacts: number }[];
  agents: { id: string; replies: number }[];
};
type ReportRow = {
  type: string;
  date: string;
  channel: string;
  conversations: number | string;
  contacts: number | string;
  conversion: number | string;
  responseMinutes: number | string;
  wonDeals: number | string;
  salesValue: number | string;
};

function number(value: number) { return value.toLocaleString("es-HN"); }
function currency(value: number) { return new Intl.NumberFormat("es-HN", { style: "currency", currency: "HNL", maximumFractionDigits: 0 }).format(value); }
function responseLabel(value: number) { return value < 1 ? "< 1 min" : `${value.toFixed(1)} min`; }

export function ReportsView() {
  const [period, setPeriod] = useState("30d");
  const [data, setData] = useState<Report | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    setError("");
    fetch(`/api/reports?period=${period}`).then(async response => {
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      setData(body);
    }).catch(cause => setError(cause instanceof Error ? cause.message : "No se pudo cargar el reporte."));
  }, [period]);

  const insights = useMemo(() => {
    if (!data) return null;
    const bestChannel = data.channels.reduce((best, current) => current.value > (best?.value || 0) ? current : best, data.channels[0]);
    const bestDay = data.daily.reduce((best, current) => (current.conversations + current.contacts) > (best?.conversations || 0) ? { date: current.date, conversations: current.conversations + current.contacts } : best, null as { date: string; conversations: number } | null);
    const qualified = data.metrics.contacts > 0 ? Math.round((data.metrics.wonDeals / data.metrics.contacts) * 100) : 0;
    const priority = data.metrics.averageResponseMinutes > 30
      ? "Prioriza reducir el tiempo de respuesta para recuperar oportunidades que hoy se enfrían."
      : data.metrics.conversion < 10
        ? "Revisa el seguimiento de los nuevos contactos: hay margen para convertir más conversaciones en oportunidades."
        : "El embudo está saludable: concentra el esfuerzo en el canal que más conversaciones genera.";
    return { bestChannel, bestDay, qualified, priority };
  }, [data]);

  function exportReport() {
    if (!data) return;
    const rows: ReportRow[] = [
      { type: "Resumen", date: "", channel: "Todos", conversations: data.metrics.conversations, contacts: data.metrics.contacts, conversion: data.metrics.conversion.toFixed(1), responseMinutes: data.metrics.averageResponseMinutes.toFixed(1), wonDeals: data.metrics.wonDeals, salesValue: data.metrics.salesValue },
      ...data.daily.map(item => ({ type: "Actividad diaria", date: item.date, channel: "", conversations: item.conversations, contacts: item.contacts, conversion: "", responseMinutes: "", wonDeals: "", salesValue: "" })),
      ...data.channels.map(item => ({ type: "Canal", date: "", channel: item.name, conversations: item.value, contacts: "", conversion: "", responseMinutes: "", wonDeals: "", salesValue: "" }))
    ];
    downloadCsv(`reporte-${period}`, rows, [
      { key: "type", label: "Tipo", value: row => row.type },
      { key: "date", label: "Fecha", value: row => row.date },
      { key: "channel", label: "Canal", value: row => row.channel },
      { key: "conversations", label: "Conversaciones", value: row => row.conversations },
      { key: "contacts", label: "Contactos", value: row => row.contacts },
      { key: "conversion", label: "Conversión (%)", value: row => row.conversion },
      { key: "responseMinutes", label: "Respuesta (min)", value: row => row.responseMinutes },
      { key: "wonDeals", label: "Ventas ganadas", value: row => row.wonDeals },
      { key: "salesValue", label: "Valor vendido", value: row => row.salesValue }
    ]);
  }

  const max = Math.max(...(data?.daily.map(item => item.conversations + item.contacts) || [1]), 1);
  return <section className="view active">
    <div className="section-heading"><div><p className="eyebrow">INTELIGENCIA COMERCIAL</p><h2>Reportes para decidir</h2><p>Convierte la actividad del sitio y del CRM en prioridades concretas para tu empresa.</p></div><div className="section-actions"><button className="secondary-button" disabled={!data} onClick={exportReport}>Descargar reporte CSV</button><select className="select" value={period} onChange={event => setPeriod(event.target.value)} aria-label="Periodo del reporte"><option value="7d">Últimos 7 días</option><option value="30d">Últimos 30 días</option><option value="90d">Últimos 90 días</option></select></div></div>
    {error && <div className="auth-message error">{error}</div>}
    {!data ? <div className="panel report-loading">Calculando indicadores…</div> : <>
      <article className="panel report-executive"><div><p className="eyebrow">RESUMEN EJECUTIVO · {period === "7d" ? "7 DÍAS" : period === "90d" ? "90 DÍAS" : "30 DÍAS"}</p><h3>{insights?.priority}</h3><p>La lectura combina captación, atención y resultados comerciales. Usa estas señales para decidir dónde invertir tiempo hoy.</p></div><div className="report-executive-score"><span>Salud comercial</span><strong>{data.metrics.conversion >= 20 && data.metrics.averageResponseMinutes <= 30 ? "Fuerte" : data.metrics.conversion >= 10 ? "En desarrollo" : "Requiere atención"}</strong><small>{data.metrics.wonDeals} ventas ganadas en el periodo</small></div></article>
      <div className="report-decision-grid"><article className="panel decision-card"><span className="decision-icon acquisition">◎</span><div><small>Adquisición</small><strong>{number(data.metrics.contacts)} contactos</strong><p>{insights?.bestChannel ? `El canal líder es ${insights.bestChannel.name} (${number(insights.bestChannel.value)} conversaciones).` : "Aún no hay un canal dominante."}</p></div></article><article className="panel decision-card"><span className="decision-icon conversion">↗</span><div><small>Conversión</small><strong>{data.metrics.conversion.toFixed(1)}%</strong><p>{number(data.metrics.wonDeals)} ventas ganadas · {insights?.qualified || 0}% de contactos llegaron a cierre.</p></div></article><article className="panel decision-card"><span className="decision-icon speed">◷</span><div><small>Velocidad de atención</small><strong>{responseLabel(data.metrics.averageResponseMinutes)}</strong><p>{insights?.bestDay ? `Mayor actividad el ${new Date(`${insights.bestDay.date}T00:00:00`).toLocaleDateString("es-HN", { day: "numeric", month: "short" })}.` : "Sin actividad suficiente para comparar."}</p></div></article></div>
      <div className="metrics-grid report-metrics">{[["Conversaciones", number(data.metrics.conversations)], ["Contactos nuevos", number(data.metrics.contacts)], ["Conversión", `${data.metrics.conversion.toFixed(1)}%`], ["Ventas ganadas", number(data.metrics.wonDeals)], ["Valor vendido", currency(data.metrics.salesValue)], ["Respuesta promedio", responseLabel(data.metrics.averageResponseMinutes)]].map(([label, value]) => <article className="metric-card" key={label}><span>{label}</span><strong>{value}</strong><small>Datos reales del periodo</small></article>)}</div>
      <div className="reports-layout"><article className="panel"><div className="panel-header"><div><p className="eyebrow">TENDENCIA</p><h3>Actividad diaria</h3><p>Conversaciones y contactos captados</p></div></div><div className="report-chart">{data.daily.length ? data.daily.map(item => <div className="report-bar-wrap" key={item.date}><span className="report-bar" style={{ height: `${Math.max(4, (item.conversations + item.contacts) / max * 100)}%` }} title={`${item.conversations} conversaciones · ${item.contacts} contactos`} /><small>{new Date(`${item.date}T00:00:00`).toLocaleDateString("es-HN", { day: "2-digit", month: "2-digit" })}</small></div>) : <p className="table-empty">Sin actividad en el periodo.</p>}</div></article><article className="panel"><div className="panel-header"><div><p className="eyebrow">CANALES</p><h3>Origen de conversaciones</h3><p>Identifica dónde funciona mejor tu captación.</p></div></div><div className="channel-report">{data.channels.length ? data.channels.map(channel => <div key={channel.name}><span>{channel.name}</span><strong>{number(channel.value)}</strong></div>) : <p className="table-empty">Sin conversaciones en el periodo.</p>}</div><div className="panel-header agent-heading"><div><p className="eyebrow">EQUIPO</p><h3>Rendimiento de atención</h3><p>Respuestas enviadas por agente.</p></div></div><div className="channel-report">{data.agents.length ? data.agents.map((agent, index) => <div key={agent.id}><span>Agente {index + 1}</span><strong>{number(agent.replies)}</strong></div>) : <p className="table-empty">Todavía no hay respuestas humanas.</p>}</div></article></div>
    </>}
  </section>;
}