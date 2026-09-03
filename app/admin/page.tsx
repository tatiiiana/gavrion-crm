"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import "./superadmin.css";

type Owner = { id: string; name: string; email: string } | null;
type Implementation = { id: string; name: string; slug: string; plan: string; template_key: string; implementation_template_id:string|null; implementation_status: string; settings: { modules?: string[] }; created_at: string; owner: Owner };
type ImplementationTemplate = { id:string; key:string; name:string; description:string; business_type:string; configuration:{ modules?:string[]; knowledge?:unknown[]; automations?:unknown[] }; source_tenant_id:string|null; is_system:boolean; created_at:string };

const moduleOptions = [
  ["dashboard","Inicio"],["conversations","Conversaciones"],["contacts","Contactos"],["pipeline","Pipeline"],
  ["tasks","Tareas"],["team","Equipo"],["automations","Automatizaciones"],["reports","Reportes"],
  ["assistant","Asistente IA"],["widget","Chatbox"],["properties","Propiedades"],["inquiries","Interesados"],
  ["visits","Visitas"],["reservations","Reservaciones"],["orders","Pedidos"],["appointments","Citas"],
  ["quotes","Cotizaciones"],["products","Productos"]
];

const statusLabels: Record<string, string> = { draft:"Borrador", configuring:"Configuración", testing:"Pruebas", ready:"Lista para entregar", production:"Producción", suspended:"Suspendida", archived:"Archivada" };

export default function SuperadminPage() {
  const [items, setItems] = useState<Implementation[]>([]);
  const [templates, setTemplates] = useState<ImplementationTemplate[]>([]);
  const [section, setSection] = useState<"companies"|"templates">("companies");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [showCloneForm, setShowCloneForm] = useState(false);
  const [query, setQuery] = useState("");
  const [notice, setNotice] = useState<{ kind:"success"|"error"; text:string } | null>(null);
  const [name, setName] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [ownerEmail, setOwnerEmail] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [modules, setModules] = useState<string[]>([]);
  const [cloneSourceId, setCloneSourceId] = useState("");
  const [cloneName, setCloneName] = useState("");
  const [cloneDescription, setCloneDescription] = useState("");

  async function load() {
    setLoading(true);
    try {
      const [companiesResponse, templatesResponse] = await Promise.all([fetch("/api/admin/implementations", { cache:"no-store" }),fetch("/api/admin/templates", { cache:"no-store" })]);
      const [companiesData, templatesData] = await Promise.all([companiesResponse.json(),templatesResponse.json()]);
      if (!companiesResponse.ok) throw new Error(companiesData.error || "No fue posible cargar las empresas.");
      if (!templatesResponse.ok) throw new Error(templatesData.error || "No fue posible cargar las plantillas.");
      setItems(companiesData); setTemplates(templatesData);
      if (templatesData.length) { setTemplateId((current:string)=>current || templatesData[0].id); setModules((current:string[])=>current.length ? current : (templatesData[0].configuration?.modules || [])); }
    } catch (error) { setNotice({ kind:"error", text:error instanceof Error ? error.message : "No fue posible cargar." }); }
    finally { setLoading(false); }
  }

  useEffect(() => { void load(); }, []);
  const filtered = useMemo(() => items.filter(item => `${item.name} ${item.owner?.email || ""}`.toLowerCase().includes(query.toLowerCase())), [items, query]);

  function selectTemplate(id: string) { const selected=templates.find(item=>item.id===id); setTemplateId(id); setModules(selected?.configuration?.modules || []); }
  function toggleModule(key: string) { setModules(current => current.includes(key) ? current.filter(item => item !== key) : [...current, key]); }
  function closeForm() { setShowForm(false); setName(""); setOwnerName(""); setOwnerEmail(""); if(templates[0])selectTemplate(templates[0].id); }

  async function createImplementation(event: FormEvent) {
    event.preventDefault(); setSaving(true); setNotice(null);
    try {
      const response = await fetch("/api/admin/implementations", { method:"POST", headers:{ "Content-Type":"application/json" }, body:JSON.stringify({ name, ownerName, ownerEmail, templateId, modules }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No se pudo crear la implementación.");
      setItems(current => [data, ...current]); closeForm();
      setNotice({ kind:"success", text:`${data.name} fue creada y se envió la invitación a ${ownerEmail}.` });
    } catch (error) { setNotice({ kind:"error", text:error instanceof Error ? error.message : "No se pudo crear." }); }
    finally { setSaving(false); }
  }

  async function changeStatus(tenantId: string, status: string) {
    const response = await fetch("/api/admin/implementations", { method:"PATCH", headers:{ "Content-Type":"application/json" }, body:JSON.stringify({ tenantId, status }) });
    const data = await response.json();
    if (!response.ok) { setNotice({ kind:"error", text:data.error || "No se pudo actualizar el estado." }); return; }
    setItems(current => current.map(item => item.id === tenantId ? { ...item, implementation_status:status } : item));
  }

  async function cloneTemplate(event:FormEvent){event.preventDefault();setSaving(true);setNotice(null);try{const response=await fetch("/api/admin/templates",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({sourceTenantId:cloneSourceId,name:cloneName,description:cloneDescription})});const data=await response.json();if(!response.ok)throw new Error(data.error||"No se pudo crear la plantilla.");setTemplates(current=>[data,...current]);setShowCloneForm(false);setCloneSourceId("");setCloneName("");setCloneDescription("");setNotice({kind:"success",text:`La plantilla ${data.name} quedó lista para reutilizar.`});}catch(error){setNotice({kind:"error",text:error instanceof Error?error.message:"No se pudo clonar."});}finally{setSaving(false)}}
  async function archiveTemplate(id:string){if(!window.confirm("¿Archivar esta plantilla personalizada?"))return;const response=await fetch("/api/admin/templates",{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({id,action:"archive"})});const data=await response.json();if(!response.ok){setNotice({kind:"error",text:data.error||"No se pudo archivar."});return}setTemplates(current=>current.filter(item=>item.id!==id));setNotice({kind:"success",text:"Plantilla archivada."})}

  return <main className="superadmin-shell">
    <aside className="superadmin-sidebar">
      <div className="superadmin-brand"><span>G</span><div><strong>Gavrion</strong><small>Control de implementaciones</small></div></div>
      <nav><button className={section==="companies"?"active":""} onClick={()=>setSection("companies")}>▦ Empresas</button><button className={section==="templates"?"active":""} onClick={()=>setSection("templates")}>◇ Plantillas</button><a href="/dashboard">⌂ Mi CRM</a></nav>
      <div className="superadmin-identity"><span>SA</span><div><strong>Superadministrador</strong><small>Acceso interno Gavrion</small></div></div>
    </aside>
    <section className="superadmin-main">
      <header><div><p>PLATAFORMA GAVRION</p><h1>{section==="companies"?"Implementaciones":"Plantillas de CRM"}</h1></div><button className="admin-primary" onClick={()=>section==="companies"?setShowForm(true):setShowCloneForm(true)}>＋ {section==="companies"?"Nueva implementación":"Crear desde una empresa"}</button></header>
      <div className="superadmin-content">
        {notice&&<div className={`admin-notice ${notice.kind}`}>{notice.text}<button onClick={()=>setNotice(null)}>×</button></div>}
        {section==="companies"&&<><section className="admin-stats">
          <article><span>Empresas</span><strong>{items.length}</strong><small>Total registradas</small></article>
          <article><span>En preparación</span><strong>{items.filter(item=>["draft","configuring","testing"].includes(item.implementation_status)).length}</strong><small>Pendientes de entrega</small></article>
          <article><span>En producción</span><strong>{items.filter(item=>item.implementation_status==="production").length}</strong><small>Clientes activos</small></article>
        </section>
        <section className="admin-panel">
          <div className="admin-panel-head"><div><h2>Empresas</h2><p>Construye, prueba y entrega cada CRM desde un solo lugar.</p></div><label>⌕ <input value={query} onChange={event=>setQuery(event.target.value)} placeholder="Buscar empresa o propietario" /></label></div>
          <div className="admin-table-wrap"><table><thead><tr><th>Empresa</th><th>Plantilla</th><th>Propietario</th><th>Módulos</th><th>Estado</th><th>Acciones</th></tr></thead><tbody>
            {loading?<tr><td colSpan={6} className="admin-empty">Cargando implementaciones…</td></tr>:filtered.length?filtered.map(item=><tr key={item.id}>
              <td><strong>{item.name}</strong><small>{item.slug}</small></td>
              <td>{templates.find(option=>option.id===item.implementation_template_id)?.name || item.template_key}</td>
              <td><strong>{item.owner?.name || "Sin propietario"}</strong><small>{item.owner?.email || "—"}</small></td>
              <td><span className="module-count">{item.settings?.modules?.length || 0} activos</span></td>
              <td><select value={item.implementation_status} onChange={event=>void changeStatus(item.id,event.target.value)}><option value="draft">Borrador</option><option value="configuring">Configuración</option><option value="testing">Pruebas</option><option value="ready">Lista para entregar</option><option value="production">Producción</option><option value="suspended">Suspendida</option><option value="archived">Archivada</option></select><small className={`implementation-status status-${item.implementation_status}`}>{statusLabels[item.implementation_status]}</small></td>
              <td><a className="support-button" href={`/dashboard?supportTenant=${item.id}`} target="_blank" rel="noreferrer">Abrir en soporte ↗</a></td>
            </tr>):<tr><td colSpan={6} className="admin-empty">No hay empresas que coincidan.</td></tr>}
          </tbody></table></div>
        </section></>}
        {section==="templates"&&<section className="templates-library"><div className="templates-intro"><div><h2>Biblioteca de plantillas</h2><p>Cada plantilla conserva módulos, configuración del asistente, conocimiento, automatizaciones, horario y ajustes reutilizables.</p></div><span>{templates.length} disponibles</span></div><div className="template-library-grid">{templates.map(template=><article key={template.id}><div className="template-card-top"><span>{template.business_type.slice(0,2).toUpperCase()}</span>{template.is_system&&<i>Base Gavrion</i>}</div><h3>{template.name}</h3><p>{template.description||"Plantilla personalizada creada desde una implementación."}</p><div className="template-summary"><span>{template.configuration.modules?.length||0} módulos</span><span>{template.configuration.knowledge?.length||0} documentos</span><span>{template.configuration.automations?.length||0} flujos</span></div><div className="template-card-actions"><button onClick={()=>{selectTemplate(template.id);setSection("companies");setShowForm(true)}}>Usar plantilla</button>{!template.is_system&&<button className="archive-template" onClick={()=>void archiveTemplate(template.id)}>Archivar</button>}</div></article>)}</div></section>}
      </div>
    </section>
    {showForm&&<div className="implementation-modal" role="dialog" aria-modal="true"><form onSubmit={createImplementation}>
      <div className="modal-title"><div><p>NUEVO CLIENTE</p><h2>Nueva implementación</h2></div><button type="button" onClick={closeForm}>×</button></div>
      <div className="admin-form-grid"><label>Nombre de la empresa<input required minLength={2} value={name} onChange={event=>setName(event.target.value)} placeholder="Ej. Metro Inmobiliaria" /></label><label>Nombre del propietario<input required minLength={3} value={ownerName} onChange={event=>setOwnerName(event.target.value)} placeholder="Nombre completo" /></label><label className="wide">Correo del propietario<input required type="email" value={ownerEmail} onChange={event=>setOwnerEmail(event.target.value)} placeholder="propietario@empresa.com" /><small>Recibirá una invitación para establecer su acceso.</small></label></div>
      <fieldset><legend>Selecciona una plantilla</legend><div className="template-grid">{templates.map(option=><button type="button" key={option.id} className={templateId===option.id?"selected":""} onClick={()=>selectTemplate(option.id)}><strong>{option.name}</strong><small>{option.description}</small></button>)}</div></fieldset>
      <fieldset><legend>Activa los módulos</legend><div className="module-grid">{moduleOptions.map(([key,label])=><label key={key}><input type="checkbox" checked={modules.includes(key)} onChange={()=>toggleModule(key)} /><span>{label}</span></label>)}</div></fieldset>
      <div className="admin-modal-actions"><button type="button" className="admin-secondary" onClick={closeForm}>Cancelar</button><button disabled={saving} className="admin-primary">{saving?"Creando…":"Crear e invitar propietario"}</button></div>
    </form></div>}
    {showCloneForm&&<div className="implementation-modal" role="dialog" aria-modal="true"><form onSubmit={cloneTemplate} className="clone-template-form"><div className="modal-title"><div><p>CLONADOR</p><h2>Crear plantilla desde una empresa</h2></div><button type="button" onClick={()=>setShowCloneForm(false)}>×</button></div><p className="clone-help">Se copiarán únicamente configuraciones reutilizables. No se copiarán contactos, conversaciones, credenciales, usuarios, propiedades, pedidos ni datos legales.</p><div className="admin-form-grid"><label className="wide">Empresa de origen<select required value={cloneSourceId} onChange={event=>setCloneSourceId(event.target.value)}><option value="">Selecciona una empresa configurada</option>{items.map(item=><option value={item.id} key={item.id}>{item.name}</option>)}</select></label><label>Nombre de la plantilla<input required minLength={3} value={cloneName} onChange={event=>setCloneName(event.target.value)} placeholder="Ej. Inmobiliaria premium" /></label><label>Descripción<input value={cloneDescription} onChange={event=>setCloneDescription(event.target.value)} placeholder="Qué incluye y cuándo utilizarla" /></label></div><div className="clone-includes"><strong>Se incluye</strong><span>✓ Módulos activados</span><span>✓ Instrucciones de IA</span><span>✓ Base de conocimiento</span><span>✓ Automatizaciones</span><span>✓ Widget y horarios</span></div><div className="admin-modal-actions"><button type="button" className="admin-secondary" onClick={()=>setShowCloneForm(false)}>Cancelar</button><button disabled={saving} className="admin-primary">{saving?"Clonando…":"Guardar como plantilla"}</button></div></form></div>}
  </main>;
}
