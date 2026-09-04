"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import "./superadmin.css";
import "./site-catalog.css";
import "./staff.css";
import { createClientSupabase } from "@/lib/supabase/client";
import {siteTemplates} from "@/lib/site-templates/catalog";

type Owner = { id: string; name: string; email: string } | null;
type Implementation = { id: string; name: string; slug: string; plan: string; template_key: string; implementation_template_id:string|null; implementation_status: string; settings: { modules?: string[] }; created_at: string; owner: Owner };
type ImplementationTemplate = { id:string; key:string; name:string; description:string; business_type:string; configuration:{ modules?:string[]; knowledge?:unknown[]; automations?:unknown[] }; source_tenant_id:string|null; is_system:boolean; created_at:string };
type SiteProject = { id:string; tenant_id:string; template_key:string; name:string; slug:string; status:string; updated_at:string; tenant:{id:string;name:string}|null };
type PlatformStaff={user_id:string;email:string;role:string;active:boolean;tenant_ids:string[]};

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
  const [sites, setSites] = useState<SiteProject[]>([]);
  const [section, setSection] = useState<"companies"|"templates"|"sites"|"team">("companies");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [showCloneForm, setShowCloneForm] = useState(false);
  const [query, setQuery] = useState("");
  const [notice, setNotice] = useState<{ kind:"success"|"error"; text:string } | null>(null);
  const [formError, setFormError] = useState("");
  const [statusSaving, setStatusSaving] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [ownerEmail, setOwnerEmail] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [modules, setModules] = useState<string[]>([]);
  const [cloneSourceId, setCloneSourceId] = useState("");
  const [cloneName, setCloneName] = useState("");
  const [cloneDescription, setCloneDescription] = useState("");
  const [siteTemplateKey,setSiteTemplateKey]=useState("gastronomia-a");
  const [capabilities,setCapabilities]=useState<string[]>([]);
  const [staff,setStaff]=useState<PlatformStaff[]>([]);const [staffEmail,setStaffEmail]=useState("");const [staffRole,setStaffRole]=useState("designer");const [staffTenants,setStaffTenants]=useState<string[]>([]);

  async function load() {
    setLoading(true);
    try {
      const [companiesResponse, templatesResponse, sitesResponse,accessResponse] = await Promise.all([fetch("/api/admin/implementations", { cache:"no-store" }),fetch("/api/admin/templates", { cache:"no-store" }),fetch("/api/admin/sites",{cache:"no-store"}),fetch("/api/admin/access",{cache:"no-store"})]);
      const [companiesData, templatesData, sitesData,accessData] = await Promise.all([companiesResponse.json(),templatesResponse.json(),sitesResponse.json(),accessResponse.json()]);
      if (!companiesResponse.ok) throw new Error(companiesData.error || "No fue posible cargar las empresas.");
      if (!templatesResponse.ok) throw new Error(templatesData.error || "No fue posible cargar las plantillas.");
      setItems(companiesData); setTemplates(templatesData); setSites(sitesResponse.ok&&Array.isArray(sitesData)?sitesData:[]);
      setCapabilities(accessData.capabilities||[]);
      if((accessData.capabilities||[]).includes("staff.manage")){const response=await fetch("/api/admin/staff",{cache:"no-store"});if(response.ok)setStaff(await response.json())}
      if(!sitesResponse.ok)setNotice({kind:"error",text:sitesData.error||"El constructor de sitios todavía no está habilitado en Supabase."});
      if (templatesData.length) { setTemplateId((current:string)=>current || templatesData[0].id); setModules((current:string[])=>current.length ? current : (templatesData[0].configuration?.modules || [])); }
    } catch (error) { setNotice({ kind:"error", text:error instanceof Error ? error.message : "No fue posible cargar." }); }
    finally { setLoading(false); }
  }

  useEffect(() => { void load(); }, []);
  const filtered = useMemo(() => items.filter(item => `${item.name} ${item.owner?.email || ""}`.toLowerCase().includes(query.toLowerCase())), [items, query]);

  function selectTemplate(id: string) { const selected=templates.find(item=>item.id===id); setTemplateId(id); setModules(selected?.configuration?.modules || []); }
  function toggleModule(key: string) { setModules(current => current.includes(key) ? current.filter(item => item !== key) : [...current, key]); }
  function closeForm() { setShowForm(false); setFormError(""); setName(""); setOwnerName(""); setOwnerEmail(""); if(templates[0])selectTemplate(templates[0].id); }

  async function createImplementation(event: FormEvent) {
    event.preventDefault();
    if(saving)return;
    setFormError(""); setNotice(null);
    if(name.trim().length<2){setFormError("Escribe el nombre de la empresa.");return}
    if(ownerName.trim().length<3){setFormError("Escribe el nombre completo del propietario.");return}
    if(!/^\S+@\S+\.\S+$/.test(ownerEmail.trim())){setFormError("Escribe un correo válido para el propietario.");return}
    if(!templateId){setFormError("Selecciona una plantilla.");return}
    if(!modules.length){setFormError("Activa al menos un módulo.");return}
    setSaving(true);
    try {
      const response = await fetch("/api/admin/implementations", { method:"POST", headers:{ "Content-Type":"application/json" }, body:JSON.stringify({ name, ownerName, ownerEmail, templateId, modules }) });
      const raw=await response.text();
      const data=raw?JSON.parse(raw):{};
      if (!response.ok) throw new Error(data.error || "No se pudo crear la implementación.");
      setItems(current => [data, ...current]); closeForm();
      setNotice({ kind:"success", text:`${data.name} fue creada y se envió la invitación a ${ownerEmail}.` });
    } catch (error) { setFormError(error instanceof Error ? error.message : "No se pudo crear la empresa ni enviar la invitación."); }
    finally { setSaving(false); }
  }

  async function changeStatus(tenantId: string, status: string) {
    if(statusSaving)return;
    const previous=items.find(item=>item.id===tenantId)?.implementation_status||"draft";
    let reason="";
    if(["suspended","archived"].includes(status)){reason=window.prompt(status==="suspended"?"Indica el motivo de la suspensión:":"Indica el motivo del archivo:")?.trim()||"";if(!reason){setNotice({kind:"error",text:"El cambio fue cancelado porque el motivo es obligatorio."});return;}}
    setStatusSaving(tenantId); setNotice(null);
    setItems(current=>current.map(item=>item.id===tenantId?{...item,implementation_status:status}:item));
    try{const response = await fetch("/api/admin/implementations", { method:"PATCH", headers:{ "Content-Type":"application/json" }, body:JSON.stringify({ tenantId, status, reason }) });const raw=await response.text();const data=raw?JSON.parse(raw):{};if (!response.ok) throw new Error(data.error||"No se pudo actualizar el estado.");setNotice({kind:"success",text:`Estado actualizado a ${statusLabels[status]}.`});}
    catch(error){setItems(current=>current.map(item=>item.id===tenantId?{...item,implementation_status:previous}:item));setNotice({kind:"error",text:error instanceof Error?error.message:"No se pudo actualizar el estado."})}
    finally{setStatusSaving(null)}
  }

  async function cloneTemplate(event:FormEvent){event.preventDefault();setSaving(true);setNotice(null);try{const response=await fetch("/api/admin/templates",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({sourceTenantId:cloneSourceId,name:cloneName,description:cloneDescription})});const data=await response.json();if(!response.ok)throw new Error(data.error||"No se pudo crear la plantilla.");setTemplates(current=>[data,...current]);setShowCloneForm(false);setCloneSourceId("");setCloneName("");setCloneDescription("");setNotice({kind:"success",text:`La plantilla ${data.name} quedó lista para reutilizar.`});}catch(error){setNotice({kind:"error",text:error instanceof Error?error.message:"No se pudo clonar."});}finally{setSaving(false)}}
  async function archiveTemplate(id:string){if(!window.confirm("¿Archivar esta plantilla personalizada?"))return;const response=await fetch("/api/admin/templates",{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({id,action:"archive"})});const data=await response.json();if(!response.ok){setNotice({kind:"error",text:data.error||"No se pudo archivar."});return}setTemplates(current=>current.filter(item=>item.id!==id));setNotice({kind:"success",text:"Plantilla archivada."})}
  async function createSite(tenantId:string,templateKey=siteTemplateKey){setSaving(true);setNotice(null);try{const response=await fetch("/api/admin/sites",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({tenantId,templateKey})});const data=await response.json();if(!response.ok)throw new Error(data.error||"No se pudo preparar el sitio.");window.location.href=`/admin/sites/${data.id}`}catch(error){setNotice({kind:"error",text:error instanceof Error?error.message:"No se pudo preparar el sitio."});setSaving(false)}}
  async function inviteStaff(event:FormEvent){event.preventDefault();setSaving(true);const response=await fetch("/api/admin/staff",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email:staffEmail,role:staffRole,tenantIds:staffTenants})});const data=await response.json();if(!response.ok){setNotice({kind:"error",text:data.error||"No se pudo invitar."});setSaving(false);return}setStaffEmail("");setStaffTenants([]);const refreshed=await fetch("/api/admin/staff",{cache:"no-store"});if(refreshed.ok)setStaff(await refreshed.json());setNotice({kind:"success",text:"Integrante invitado y permisos asignados."});setSaving(false)}
  async function logout(){if(loggingOut)return;setLoggingOut(true);const supabase=createClientSupabase();if(supabase)await supabase.auth.signOut({scope:"local"});window.location.replace("/login")}

  return <main className="superadmin-shell">
    <aside className="superadmin-sidebar">
      <div className="superadmin-brand"><span>G</span><div><strong>Gavrion</strong><small>Control de implementaciones</small></div></div>
      <nav><button className={section==="companies"?"active":""} onClick={()=>setSection("companies")}>▦ Empresas</button><button className={section==="templates"?"active":""} onClick={()=>setSection("templates")}>◇ Plantillas</button><button className={section==="sites"?"active":""} onClick={()=>setSection("sites")}>▤ Sitios web</button>{capabilities.includes("staff.manage")&&<button className={section==="team"?"active":""} onClick={()=>setSection("team")}>♙ Equipo interno</button>}<a href="/dashboard">⌂ Mi CRM</a></nav>
      <div className="superadmin-session"><div className="superadmin-identity"><span>SA</span><div><strong>Superadministrador</strong><small>Acceso interno Gavrion</small></div></div><button className="superadmin-logout" disabled={loggingOut} onClick={()=>void logout()}><span>↪</span>{loggingOut?"Cerrando sesión…":"Cerrar sesión"}</button></div>
    </aside>
    <section className="superadmin-main">
      <header><div><p>PLATAFORMA GAVRION</p><h1>{section==="companies"?"Implementaciones":section==="templates"?"Plantillas de CRM":"Editor de sitios"}</h1></div>{section==="companies"&&capabilities.includes("companies.create")&&<button className="admin-primary" onClick={()=>setShowForm(true)}>＋ Nueva implementación</button>}{section==="templates"&&capabilities.includes("templates.write")&&<button className="admin-primary" onClick={()=>setShowCloneForm(true)}>＋ Crear desde una empresa</button>}</header>
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
              <td><select disabled={statusSaving===item.id} value={item.implementation_status} onChange={event=>void changeStatus(item.id,event.target.value)}><option value="draft">Borrador</option><option value="configuring">Configuración</option><option value="testing">Pruebas</option><option value="ready">Lista para entregar</option><option value="production">Producción</option><option value="suspended">Suspendida</option><option value="archived">Archivada</option></select>{statusSaving===item.id&&<small className="status-progress">Guardando…</small>}<small className={`implementation-status status-${item.implementation_status}`}>{statusLabels[item.implementation_status]}</small></td>
              <td>{capabilities.includes("support.open")?<a className="support-button" title="Abrir el CRM de esta empresa en modo soporte" href={`/dashboard?supportTenant=${item.id}`} target="_blank" rel="noreferrer">Abrir en soporte ↗</a>:<span>—</span>}</td>
            </tr>):<tr><td colSpan={6} className="admin-empty">No hay empresas que coincidan.</td></tr>}
          </tbody></table></div>
        </section></>}
        {section==="templates"&&<section className="templates-library"><div className="templates-intro"><div><h2>Biblioteca de plantillas</h2><p>Cada plantilla conserva módulos, configuración del asistente, conocimiento, automatizaciones, horario y ajustes reutilizables.</p></div><span>{templates.length} disponibles</span></div><div className="template-library-grid">{templates.map(template=><article key={template.id}><div className="template-card-top"><span>{template.business_type.slice(0,2).toUpperCase()}</span>{template.is_system&&<i>Base Gavrion</i>}</div><h3>{template.name}</h3><p>{template.description||"Plantilla personalizada creada desde una implementación."}</p><div className="template-summary"><span>{template.configuration.modules?.length||0} módulos</span><span>{template.configuration.knowledge?.length||0} documentos</span><span>{template.configuration.automations?.length||0} flujos</span></div><div className="template-card-actions"><button onClick={()=>{selectTemplate(template.id);setSection("companies");setShowForm(true)}}>Usar plantilla</button>{!template.is_system&&<button className="archive-template" onClick={()=>void archiveTemplate(template.id)}>Archivar</button>}</div></article>)}</div></section>}
        {section==="sites"&&<section className="templates-library"><div className="templates-intro"><div><h2>Catálogo de sitios</h2><p>Selecciona un modelo y crea una implementación independiente usando el mismo editor, vista previa y publicación.</p></div><span>{sites.length} proyectos</span></div><div className="site-template-picker">{siteTemplates.map(template=><button key={template.key} className={siteTemplateKey===template.key?"selected":""} onClick={()=>setSiteTemplateKey(template.key)}><strong>{template.name}</strong><small>{template.description}</small></button>)}</div><div className="site-project-grid">{items.map(company=>{const site=sites.find(item=>item.tenant_id===company.id&&item.template_key===siteTemplateKey),template=siteTemplates.find(item=>item.key===siteTemplateKey)!;return <article key={company.id}><div className="site-project-preview"><span>{template.name.toUpperCase()}</span><strong>{site?.name||company.name}</strong></div><div><h3>{company.name}</h3><p>{site?`Última edición: ${new Date(site.updated_at).toLocaleDateString("es-HN")}`:`Todavía no utiliza ${template.name}.`}</p><span className={`site-status ${site?.status||"new"}`}>{site?({draft:"Borrador",review:"En revisión",ready:"Listo",exported:"Exportado"} as Record<string,string>)[site.status]||site.status:"Nuevo"}</span><button disabled={saving} onClick={()=>site?window.location.assign(`/admin/sites/${site.id}`):void createSite(company.id,template.key)}>{site?"Abrir editor":`Crear con ${template.name}`}</button></div></article>})}</div></section>}
        {section==="team"&&<section className="admin-panel internal-team"><div className="admin-panel-head"><div><h2>Equipo interno Gavrion</h2><p>Asigna una función y limita a cada persona a las empresas que debe operar.</p></div></div><form onSubmit={inviteStaff}><label>Correo<input type="email" required value={staffEmail} onChange={e=>setStaffEmail(e.target.value)} placeholder="persona@gavrionsystems.com"/></label><label>Rol<select value={staffRole} onChange={e=>setStaffRole(e.target.value)}><option value="designer">Diseñador</option><option value="sales">Vendedor</option><option value="implementer">Implementador</option><option value="support">Soporte</option></select></label><fieldset><legend>Empresas asignadas</legend>{items.map(company=><label key={company.id}><input type="checkbox" checked={staffTenants.includes(company.id)} onChange={e=>setStaffTenants(current=>e.target.checked?[...current,company.id]:current.filter(id=>id!==company.id))}/>{company.name}</label>)}</fieldset><button className="admin-primary" disabled={saving}>{saving?"Guardando…":"Invitar y asignar"}</button></form><div className="staff-list">{staff.map(person=><article key={person.user_id}><div><strong>{person.email||"Usuario"}</strong><small>{({superadmin:"Superadministrador",designer:"Diseñador",sales:"Vendedor",implementer:"Implementador",support:"Soporte"} as Record<string,string>)[person.role]}</small></div><span>{person.role==="superadmin"?"Todas las empresas":`${person.tenant_ids.length} empresas`}</span><i className={person.active?"active":""}>{person.active?"Activo":"Desactivado"}</i></article>)}</div></section>}
      </div>
    </section>
    {showForm&&<div className="implementation-modal" role="dialog" aria-modal="true"><form onSubmit={createImplementation} noValidate>
      <div className="modal-title"><div><p>NUEVO CLIENTE</p><h2>Nueva implementación</h2></div><button type="button" onClick={closeForm}>×</button></div>
      <div className="admin-form-grid"><label>Nombre de la empresa<input required minLength={2} value={name} onChange={event=>setName(event.target.value)} placeholder="Ej. Metro Inmobiliaria" /></label><label>Nombre del propietario<input required minLength={3} value={ownerName} onChange={event=>setOwnerName(event.target.value)} placeholder="Nombre completo" /></label><label className="wide">Correo del propietario<input required type="email" value={ownerEmail} onChange={event=>setOwnerEmail(event.target.value)} placeholder="propietario@empresa.com" /><small>Recibirá una invitación para establecer su acceso.</small></label></div>
      <fieldset><legend>Selecciona una plantilla</legend><div className="template-grid">{templates.map(option=><button type="button" key={option.id} className={templateId===option.id?"selected":""} onClick={()=>selectTemplate(option.id)}><strong>{option.name}</strong><small>{option.description}</small></button>)}</div></fieldset>
      <fieldset><legend>Activa los módulos</legend><div className="module-grid">{moduleOptions.map(([key,label])=><label key={key}><input type="checkbox" checked={modules.includes(key)} onChange={()=>toggleModule(key)} /><span>{label}</span></label>)}</div></fieldset>
      {formError&&<div className="implementation-form-error" role="alert"><strong>No se pudo completar la implementación</strong><span>{formError}</span>{/rate|limit|email|correo|mail/i.test(formError)&&<small>Si Supabase limitó los correos, espera antes de volver a intentarlo o configura un servidor SMTP propio.</small>}</div>}
      <div className="admin-modal-actions"><button type="button" className="admin-secondary" onClick={closeForm}>Cancelar</button><button disabled={saving} className="admin-primary">{saving?"Creando…":"Crear e invitar propietario"}</button></div>
    </form></div>}
    {showCloneForm&&<div className="implementation-modal" role="dialog" aria-modal="true"><form onSubmit={cloneTemplate} className="clone-template-form"><div className="modal-title"><div><p>CLONADOR</p><h2>Crear plantilla desde una empresa</h2></div><button type="button" onClick={()=>setShowCloneForm(false)}>×</button></div><p className="clone-help">Se copiarán únicamente configuraciones reutilizables. No se copiarán contactos, conversaciones, credenciales, usuarios, propiedades, pedidos ni datos legales.</p><div className="admin-form-grid"><label className="wide">Empresa de origen<select required value={cloneSourceId} onChange={event=>setCloneSourceId(event.target.value)}><option value="">Selecciona una empresa configurada</option>{items.map(item=><option value={item.id} key={item.id}>{item.name}</option>)}</select></label><label>Nombre de la plantilla<input required minLength={3} value={cloneName} onChange={event=>setCloneName(event.target.value)} placeholder="Ej. Inmobiliaria premium" /></label><label>Descripción<input value={cloneDescription} onChange={event=>setCloneDescription(event.target.value)} placeholder="Qué incluye y cuándo utilizarla" /></label></div><div className="clone-includes"><strong>Se incluye</strong><span>✓ Módulos activados</span><span>✓ Instrucciones de IA</span><span>✓ Base de conocimiento</span><span>✓ Automatizaciones</span><span>✓ Widget y horarios</span></div><div className="admin-modal-actions"><button type="button" className="admin-secondary" onClick={()=>setShowCloneForm(false)}>Cancelar</button><button disabled={saving} className="admin-primary">{saving?"Clonando…":"Guardar como plantilla"}</button></div></form></div>}
  </main>;
}
