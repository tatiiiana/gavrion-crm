"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { createClientSupabase } from "@/lib/supabase/client";

type Field = { id: string; entity_type: string; label: string; field_key: string; field_type: string; options: string[]; required: boolean; active: boolean };
type EntityOption = [string, string];

const entities: EntityOption[] = [
  ["contact", "Contactos"],
  ["deal", "Oportunidades"],
  ["property", "Propiedades"],
  ["order", "Pedidos"],
  ["reservation", "Reservaciones"],
  ["appointment", "Citas"],
  ["quote", "Cotizaciones"],
  ["product", "Productos"]
];
const entityModules: Record<string, string> = {
  contact: "contacts",
  deal: "pipeline",
  property: "properties",
  order: "orders",
  reservation: "reservations",
  appointment: "appointments",
  quote: "quotes",
  product: "products"
};
const defaultModules = ["contacts", "pipeline"];

export function CustomFields({ tenantId, enabledModules = defaultModules }: { tenantId: string; enabledModules?: string[] | null }) {
  const allowedModules = enabledModules?.length ? enabledModules : defaultModules;
  const visibleEntities = useMemo(() => entities.filter(([value]) => allowedModules.includes(entityModules[value])), [allowedModules.join("|")]);
  const firstEntity = visibleEntities[0]?.[0] || "contact";
  const [fields, setFields] = useState<Field[]>([]);
  const [entity, setEntity] = useState(firstEntity);
  const [label, setLabel] = useState("");
  const [type, setType] = useState("text");
  const [options, setOptions] = useState("");
  const [required, setRequired] = useState(false);
  const [error, setError] = useState("");
  const [recordEntity, setRecordEntity] = useState(firstEntity);
  const [records, setRecords] = useState<{ id: string; label: string }[]>([]);
  const [recordId, setRecordId] = useState("");
  const [values, setValues] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState("");

  useEffect(() => {
    if (!visibleEntities.some(([value]) => value === entity)) setEntity(firstEntity);
    if (!visibleEntities.some(([value]) => value === recordEntity)) setRecordEntity(firstEntity);
  }, [entity, recordEntity, firstEntity, visibleEntities]);

  useEffect(() => {
    const s = createClientSupabase();
    if (!s) return;
    s.from("custom_field_definitions").select("*").eq("tenant_id", tenantId).order("entity_type").order("position").then(result => {
      if (result.error) setError(result.error.message); else setFields((result.data || []) as Field[]);
    });
  }, [tenantId]);

  async function save(event: FormEvent) {
    event.preventDefault();
    const key = label.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
    if (!key || !visibleEntities.some(([value]) => value === entity)) return;
    const s = createClientSupabase();
    if (!s) return;
    const result = await s.from("custom_field_definitions").insert({ tenant_id: tenantId, entity_type: entity, label: label.trim(), field_key: key, field_type: type, options: type === "select" ? options.split(",").map(value => value.trim()).filter(Boolean) : [], required, position: fields.filter(item => item.entity_type === entity).length }).select().single();
    if (result.error) setError(result.error.message); else { setFields(current => [...current, result.data as Field]); setLabel(""); setOptions(""); setRequired(false); }
  }

  async function toggle(field: Field) {
    const s = createClientSupabase();
    if (!s) return;
    const active = !field.active;
    setFields(current => current.map(item => item.id === field.id ? { ...item, active } : item));
    const result = await s.from("custom_field_definitions").update({ active }).eq("id", field.id);
    if (result.error) { setError(result.error.message); setFields(current => current.map(item => item.id === field.id ? field : item)); }
  }

  async function remove(field: Field) {
    if (!confirm(`¿Eliminar el campo ${field.label} y sus valores?`)) return;
    const s = createClientSupabase();
    if (!s) return;
    const result = await s.from("custom_field_definitions").delete().eq("id", field.id);
    if (result.error) setError(result.error.message); else setFields(current => current.filter(item => item.id !== field.id));
  }

  useEffect(() => {
    const s = createClientSupabase();
    if (!s) return;
    const map: Record<string, [string, string]> = { contact: ["contacts", "full_name"], deal: ["deals", "title"], property: ["properties", "title"], order: ["orders", "customer_name"], reservation: ["reservations", "customer_name"], appointment: ["appointments", "customer_name"], quote: ["quotes", "title"], product: ["products", "name"] };
    const selected = map[recordEntity];
    if (!selected) { setRecords([]); return; }
    const [table, labelKey] = selected;
    s.from(table).select(`id,${labelKey}`).eq("tenant_id", tenantId).limit(200).then(result => {
      setRecords((result.data || []).map(row => ({ id: String(row.id), label: String((row as Record<string, unknown>)[labelKey] || row.id) })));
      setRecordId(""); setValues({});
    });
  }, [recordEntity, tenantId]);

  useEffect(() => {
    if (!recordId) { setValues({}); return; }
    const s = createClientSupabase();
    if (!s) return;
    s.from("custom_field_values").select("field_id,value").eq("tenant_id", tenantId).eq("entity_type", recordEntity).eq("entity_id", recordId).then(result => setValues(Object.fromEntries((result.data || []).map(item => [item.field_id, String(item.value ?? "")]))));
  }, [recordId, recordEntity, tenantId]);

  async function saveValues(event: FormEvent) {
    event.preventDefault();
    if (!recordId) return;
    const active = fields.filter(field => field.entity_type === recordEntity && field.active);
    if (active.some(field => field.required && !values[field.id])) { setError("Completa todos los campos obligatorios."); return; }
    const s = createClientSupabase();
    if (!s) return;
    const payload = active.map(field => ({ tenant_id: tenantId, field_id: field.id, entity_type: recordEntity, entity_id: recordId, value: values[field.id] ?? null }));
    const result = await s.from("custom_field_values").upsert(payload, { onConflict: "field_id,entity_id" });
    if (result.error) setError(result.error.message); else { setSaved("Campos guardados."); setTimeout(() => setSaved(""), 2500); }
  }

  const recordFields = fields.filter(field => field.entity_type === recordEntity && field.active);
  return <section className="view active"><div className="section-heading"><div><h2>Campos personalizados</h2><p>Solo se muestran los módulos habilitados para esta empresa.</p></div></div>{error && <div className="module-error">{error}<button onClick={() => setError("")}>×</button></div>}<form className="panel custom-field-form" onSubmit={save}><label>Módulo<select className="select" value={entity} onChange={event => setEntity(event.target.value)}>{visibleEntities.map(([value, name]) => <option value={value} key={value}>{name}</option>)}</select></label><label>Nombre<input required value={label} onChange={event => setLabel(event.target.value)} placeholder="Ej. Fuente del cliente" /></label><label>Tipo<select className="select" value={type} onChange={event => setType(event.target.value)}><option value="text">Texto</option><option value="textarea">Texto largo</option><option value="number">Número</option><option value="date">Fecha</option><option value="boolean">Sí / No</option><option value="select">Lista</option></select></label>{type === "select" && <label>Opciones<input required value={options} onChange={event => setOptions(event.target.value)} placeholder="Opción 1, Opción 2" /></label>}<label className="check-label"><input type="checkbox" checked={required} onChange={event => setRequired(event.target.checked)} /> Obligatorio</label><button className="primary-button">Crear campo</button></form><article className="panel custom-values"><div className="panel-header"><div><h3>Capturar datos personalizados</h3><p>Selecciona cualquier registro para completar sus campos.</p></div>{saved && <span className="status client">{saved}</span>}</div><form onSubmit={saveValues}><label>Tipo<select className="select" value={recordEntity} onChange={event => setRecordEntity(event.target.value)}>{visibleEntities.map(([value, name]) => <option value={value} key={value}>{name}</option>)}</select></label><label>Registro<select className="select" value={recordId} onChange={event => setRecordId(event.target.value)}><option value="">Selecciona un registro</option>{records.map(record => <option value={record.id} key={record.id}>{record.label}</option>)}</select></label>{recordId && recordFields.map(field => <label key={field.id}>{field.label}{field.field_type === "select" ? <select className="select" required={field.required} value={values[field.id] || ""} onChange={event => setValues(current => ({ ...current, [field.id]: event.target.value }))}><option value="">Selecciona</option>{field.options.map(option => <option key={option}>{option}</option>)}</select> : field.field_type === "textarea" ? <textarea required={field.required} value={values[field.id] || ""} onChange={event => setValues(current => ({ ...current, [field.id]: event.target.value }))} /> : field.field_type === "boolean" ? <input type="checkbox" checked={values[field.id] === "true"} onChange={event => setValues(current => ({ ...current, [field.id]: String(event.target.checked) }))} /> : <input required={field.required} type={field.field_type} value={values[field.id] || ""} onChange={event => setValues(current => ({ ...current, [field.id]: event.target.value }))} />}</label>)}{recordId && recordFields.length > 0 && <button className="primary-button">Guardar campos</button>}</form>{recordId && recordFields.length === 0 && <p className="table-empty">Este módulo aún no tiene campos activos.</p>}</article><div className="custom-fields-groups">{visibleEntities.map(([value, name]) => <article className="panel" key={value}><div className="panel-header"><h3>{name}</h3><span>{fields.filter(field => field.entity_type === value && field.active).length} activos</span></div>{fields.filter(field => field.entity_type === value).map(field => <div className="custom-field-row" key={field.id}><span><strong>{field.label}</strong><small>{field.field_type}{field.required ? " · obligatorio" : ""}</small></span><button className="ghost-button" onClick={() => void toggle(field)}>{field.active ? "Desactivar" : "Activar"}</button><button className="danger-button" onClick={() => void remove(field)}>Eliminar</button></div>)}{!fields.some(field => field.entity_type === value) && <p className="table-empty">Sin campos personalizados.</p>}</article>)}</div></section>;
}