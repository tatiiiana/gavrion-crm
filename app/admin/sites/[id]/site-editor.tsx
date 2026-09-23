"use client";

import { useEffect, useMemo, useState } from "react";
import {
  sanitizeSiteConfig,
  validateSiteForPublication,
  type GastronomySiteConfig,
  type MenuItem,
  type MenuOption,
  type PropertyListing,
} from "@/lib/site-builder";
import { getSiteTemplate } from "@/lib/site-templates/catalog";
import "./site-editor.css";
import "./image-upload.css";
import "./advanced-editor.css";

type Project = {
  id: string;
  name: string;
  slug: string;
  status: string;
  template_key: string;
  configuration: GastronomySiteConfig;
  published_url?: string | null;
  custom_domain?: string | null;
  domain_status?: string | null;
  deployment_status?: string | null;
  deployment_error?: string | null;
  published_version?: number | null;
  tenant?: { name: string } | null;
};
type Version = { id: string; version: number; configuration: GastronomySiteConfig; created_at: string };
type Tab = "visual" | "design" | "content" | "menu" | "properties" | "location" | "integrations" | "history";

export default function SiteEditor({ id }: { id: string }) {
  const [project, setProject] = useState<Project | null>(null);
  const [config, setConfig] = useState<GastronomySiteConfig | null>(null);
  const [savedConfig, setSavedConfig] = useState<GastronomySiteConfig | null>(null);
  const [versions, setVersions] = useState<Version[]>([]);
  const [validation, setValidation] = useState<{ valid: boolean; errors: string[]; warnings: string[] } | null>(null);
  const [tab, setTab] = useState<Tab>("design");
  const [device, setDevice] = useState<"desktop" | "tablet" | "mobile">("desktop");
  const [assets, setAssets] = useState({ html: "", css: "", js: "" });
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState("");
  const [canApprove, setCanApprove] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [customDomain, setCustomDomain] = useState("");
  const [draggedSection, setDraggedSection] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [projectsResponse, historyResponse, accessResponse] = await Promise.all([
          fetch("/api/admin/sites", { cache: "no-store" }),
          fetch(`/api/admin/sites/${id}/versions`, { cache: "no-store" }),
          fetch("/api/admin/access", { cache: "no-store" }),
        ]);
        const projects = await projectsResponse.json();
        if (!projectsResponse.ok) throw new Error(projects.error || "No fue posible cargar el proyecto.");
        const found = (projects as Project[]).find((item) => item.id === id);
        if (!found) throw new Error("No se encontró el proyecto o fue eliminado.");
        const templateDir = getSiteTemplate(found.template_key)?.key === "inmobiliaria-a" ? "inmobiliaria-a" : "gastronomia-a";
        const [htmlResponse, cssResponse, jsResponse] = await Promise.all([
          fetch(`/templates/${templateDir}/index.html`),
          fetch(`/templates/${templateDir}/styles.css`),
          fetch(`/templates/${templateDir}/app.js`),
        ]);
        if (!htmlResponse.ok || !cssResponse.ok || !jsResponse.ok) throw new Error(`No se encontraron los archivos de la plantilla ${templateDir}.`);
        const [html, css, js] = await Promise.all([htmlResponse.text(), cssResponse.text(), jsResponse.text()]);
        if (cancelled) return;
        const normalized = { ...found, configuration: sanitizeSiteConfig(found.configuration) };
        setProject(normalized);
        setCustomDomain(normalized.custom_domain || "");
        setConfig(normalized.configuration);
        setSavedConfig(structuredClone(normalized.configuration));
        setVersions(historyResponse.ok ? await historyResponse.json() : []);
        const access = accessResponse.ok ? await accessResponse.json() : {};
        setCanApprove(["superadmin", "implementer"].includes(String(access.role || "")));
        setAssets({ html, css, js });
      } catch (error) {
        if (!cancelled) setNotice(error instanceof Error ? error.message : "No fue posible abrir el editor.");
      }
    })();
    return () => { cancelled = true; };
  }, [id]);

  const preview = useMemo(() => {
    if (!config || !assets.html) return "";
    const safe = JSON.stringify(config).replace(/<\//g, "<\\/");
    return assets.html
      .replace(/<link[^>]*styles\.css[^>]*>/i, `<style>${assets.css}</style>`)
      .replace(/<script[^>]*site-config\.js[^>]*><\/script>/i, "")
      .replace(/<script[^>]*app\.js[^>]*><\/script>/i, `<script>window.GAVRION_SITE=${safe};</script><script>${assets.js}</script>`);
  }, [assets, config]);

  function setValue(path: string, value: unknown) {
    setConfig((current) => {
      if (!current) return current;
      const next = structuredClone(current) as Record<string, unknown>;
      const parts = path.split(".");
      let target = next;
      for (const key of parts.slice(0, -1)) target = target[key] as Record<string, unknown>;
      target[parts.at(-1)!] = value;
      return next as unknown as GastronomySiteConfig;
    });
  }

  function updateItem(index: number, patch: Partial<MenuItem>) {
    setConfig((current) => current ? { ...current, menu: { ...current.menu, items: current.menu.items.map((item, i) => i === index ? { ...item, ...patch } : item) } } : current);
  }
  function updateProperty(index: number, patch: Partial<PropertyListing>) {
    setConfig((current) => current ? { ...current, properties: current.properties.map((item, i) => i === index ? { ...item, ...patch } : item) } : current);
  }
  function addProperty() {
    setConfig((current) => current ? { ...current, properties: [...current.properties, { id: crypto.randomUUID(), title: "Nueva propiedad", location: "Ciudad · Zona", operation: "venta", status: "Disponible", price: 0, currency: "USD", bedrooms: 0, bathrooms: 0, area: 0, imageUrl: "" }] } : current);
  }
  function addItem() {
    setConfig((current) => current ? { ...current, menu: { ...current.menu, items: [...current.menu.items, { id: crypto.randomUUID(), category: current.menu.categories[0] || "Menú", name: "Nuevo platillo", description: "Descripción del platillo", price: 0, imageUrl: "", gallery: [], active: true, availability: { days: ["lun", "mar", "mié", "jue", "vie", "sáb", "dom"], start: "00:00", end: "23:59" }, sizes: [], extras: [], promotion: { enabled: false, label: "", price: 0 } }] } } : current);
  }
  function renameCategory(index: number, name: string) {
    setConfig((current) => {
      if (!current) return current;
      const previous = current.menu.categories[index];
      return { ...current, menu: { ...current.menu, categories: current.menu.categories.map((item, i) => i === index ? name : item), items: current.menu.items.map((item) => item.category === previous ? { ...item, category: name } : item) } };
    });
  }
  function toggleSection(sectionId: string) {
    setConfig((current) => current ? { ...current, layout: { ...current.layout, sections: current.layout.sections.map((section) => section.id === sectionId ? { ...section, visible: !section.visible } : section) } } : current);
  }
  function reorderSections(sectionIds: string[]) {
    setConfig((current) => {
      if (!current) return current;
      const byId = new Map(current.layout.sections.map((section) => [section.id, section]));
      const reordered = sectionIds.map((sectionId) => byId.get(sectionId)).filter(Boolean) as typeof current.layout.sections;
      const untouched = current.layout.sections.filter((section) => !sectionIds.includes(section.id));
      return { ...current, layout: { ...current.layout, sections: [...reordered, ...untouched] } };
    });
  }

  async function uploadImage(file: File, kind: string, onUploaded: (url: string) => void) {
    setUploading(kind); setNotice("");
    try {
      const optimized = await optimizeImage(file);
      const body = new FormData(); body.append("file", optimized); body.append("kind", kind);
      const response = await fetch(`/api/admin/sites/${id}/images`, { method: "POST", body });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No fue posible subir la imagen.");
      onUploaded(data.url); setNotice(`Imagen cargada (${Math.round(optimized.size / 1024)} KB). Guarda los cambios.`);
    } catch (error) { setNotice(error instanceof Error ? error.message : "No fue posible subir la imagen."); }
    finally { setUploading(""); }
  }
  async function save() {
    if (!project || !config) return;
    setSaving(true); setNotice("");
    try {
      const response = await fetch("/api/admin/sites", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: project.id, name: project.name, status: project.status, configuration: config }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || "No fue posible guardar.");
      setProject({ ...project, ...data }); setSavedConfig(structuredClone(config));
      const history = await fetch(`/api/admin/sites/${id}/versions`, { cache: "no-store" }).then((response) => response.json());
      setVersions(Array.isArray(history) ? history : []); setNotice("Cambios guardados en Supabase.");
    } catch (error) { setNotice(error instanceof Error ? error.message : "No fue posible guardar."); }
    finally { setSaving(false); }
  }
  async function restore(versionId: string) {
    if (!confirm("¿Restaurar esta versión? Los cambios sin guardar se perderán.")) return;
    const response = await fetch(`/api/admin/sites/${id}/versions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ versionId }) });
    const data = await response.json();
    if (!response.ok) { setNotice(data.error || "No se pudo restaurar."); return; }
    setConfig(data.configuration); setSavedConfig(structuredClone(data.configuration)); setProject((current) => current ? { ...current, status: "draft", configuration: data.configuration } : current); setNotice(`Versión ${data.restoredVersion} restaurada.`);
  }
  async function rollback(versionId: string) {
    if (!confirm("¿Restaurar y publicar inmediatamente esta versión?")) return;
    setPublishing(true); setNotice("");
    try {
      const response = await fetch(`/api/admin/sites/${id}/rollback`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ versionId }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || "No se pudo hacer rollback.");
      setProject((current) => current ? { ...current, ...data } : current); setConfig(sanitizeSiteConfig(data.configuration)); setSavedConfig(sanitizeSiteConfig(data.configuration)); setNotice(`Rollback a la versión ${data.restoredVersion} publicado.`);
    } catch (error) { setNotice(error instanceof Error ? error.message : "No se pudo hacer rollback."); }
    finally { setPublishing(false); }
  }
  function review() { if (!config) return; setValidation(validateSiteForPublication(config)); setTab("history"); }
  async function exportProject() {
    setNotice(""); const response = await fetch(`/api/admin/sites/${id}/export`);
    if (!response.ok) { const data = await response.json(); if (data.validation) setValidation(data.validation); setTab("history"); setNotice(data.error || "No se pudo generar el proyecto."); return; }
    const blob = await response.blob(); const url = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = `${project?.slug || "sitio-gavrion"}.zip`; anchor.click(); URL.revokeObjectURL(url); setNotice("Proyecto validado y generado correctamente.");
  }
  async function publishProject() {
    if (!canApprove) return;
    setPublishing(true); setNotice("");
    try {
      const response = await fetch(`/api/admin/sites/${id}/publish`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ customDomain }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No se pudo publicar.");
      setProject((current) => current ? { ...current, ...data } : current);
      setNotice(data.published_url ? `Publicado correctamente: ${data.published_url}` : "Publicación iniciada correctamente.");
    } catch (error) { setNotice(error instanceof Error ? error.message : "No se pudo publicar."); }
    finally { setPublishing(false); }
  }

  if (!project || !config) return <main className="site-editor-loading"><div><strong>{notice || "Cargando editor…"}</strong>{notice && <a href="/admin">← Volver al panel</a>}</div></main>;
  const isRealEstate = project.template_key === "inmobiliaria-a";
  const sectionIds = isRealEstate ? ["inicio", "nosotros", "propiedades", "proof", "contacto"] : ["inicio", "experiencia", "menu", "operaciones", "proof", "contacto"];
  const visualSections = sectionIds.map((sectionId) => config.layout.sections.find((section) => section.id === sectionId) || { id: sectionId, label: sectionId, visible: true });
  const tabs: [Tab, string][] = [["visual", "Constructor visual"], ["design", "Diseño"], ["content", "Contenido"], ...(isRealEstate ? [["properties", "Catálogo"] as [Tab, string]] : [["menu", "Menú"] as [Tab, string]]), ["location", "Ubicación"], ["integrations", "CRM y chatbox"], ["history", "Publicación"]];

  return <main className="site-editor-shell">
    <header><div><a href="/admin">← Proyectos</a><p>EDITOR DE SITIO · {getSiteTemplate(project.template_key)?.name || project.template_key}</p><h1>{project.name}</h1></div><div className="editor-actions"><select value={project.status} onChange={(event) => setProject({ ...project, status: event.target.value })}><option value="draft">Borrador</option><option value="review">En revisión</option><option value="ready" disabled={!canApprove}>Listo (aprobación)</option><option value="exported" disabled={!canApprove}>Exportado</option></select><button className="secondary" onClick={() => savedConfig && setConfig(structuredClone(savedConfig))} disabled={!savedConfig}>Deshacer</button><button onClick={() => void save()} disabled={saving}>{saving ? "Guardando…" : "Guardar"}</button><button onClick={review}>Revisar</button><button onClick={() => void exportProject()}>Generar proyecto ↓</button></div></header>
    {notice && <div className="editor-notice">{notice}<button onClick={() => setNotice("")}>×</button></div>}
    {tab === "visual" && <div className="visual-builder-panel"><VisualBuilder sections={visualSections} draggedSection={draggedSection} setDraggedSection={setDraggedSection} onToggle={toggleSection} onReorder={reorderSections} /></div>}
    <div className="site-editor-workspace"><aside><nav>{tabs.map(([key, label]) => <button key={key} className={tab === key ? "active" : ""} onClick={() => setTab(key)}>{label}</button>)}</nav>
      {tab === "design" && <section><h2>Identidad visual</h2><Field label="Nombre" value={config.brand.name} onChange={(value) => setValue("brand.name", value)} /><Field label="Nombre corto" value={config.brand.shortName} onChange={(value) => setValue("brand.shortName", value)} /><ImageUpload label="Logo" value={config.brand.logoUrl} busy={uploading === "logo"} onSelect={(file) => void uploadImage(file, "logo", (url) => setValue("brand.logoUrl", url))} /><ImageUpload label="Imagen principal" value={config.hero.imageUrl} busy={uploading === "hero"} onSelect={(file) => void uploadImage(file, "hero", (url) => setValue("hero.imageUrl", url))} /><Color label="Color principal" value={config.brand.primaryColor} onChange={(value) => setValue("brand.primaryColor", value)} /><Color label="Color secundario" value={config.brand.secondaryColor} onChange={(value) => setValue("brand.secondaryColor", value)} /><Color label="Fondo" value={config.brand.backgroundColor} onChange={(value) => setValue("brand.backgroundColor", value)} /><Color label="Superficie de tarjetas" value={config.brand.surfaceColor} onChange={(value) => setValue("brand.surfaceColor", value)} /></section>}
      {tab === "content" && <section><h2>Contenido y contacto</h2><h3>Portada</h3><Field label="Frase superior" value={config.hero.eyebrow} onChange={(value) => setValue("hero.eyebrow", value)} /><Field label="Título principal" value={config.hero.title} onChange={(value) => setValue("hero.title", value)} /><Area label="Descripción" value={config.hero.description} onChange={(value) => setValue("hero.description", value)} /><Field label="Sello de portada" value={config.hero.stamp} onChange={(value) => setValue("hero.stamp", value)} /><h3>Sección de experiencia</h3><Field label="Etiqueta" value={config.experience.eyebrow} onChange={(value) => setValue("experience.eyebrow", value)} /><Field label="Título" value={config.experience.title} onChange={(value) => setValue("experience.title", value)} /><Area label="Descripción" value={config.experience.description} onChange={(value) => setValue("experience.description", value)} /><h3>SEO</h3><Field label="Título del navegador" value={config.seo.title} onChange={(value) => setValue("seo.title", value)} /><Area label="Descripción para buscadores" value={config.seo.description} onChange={(value) => setValue("seo.description", value)} /><h3>Contacto</h3><Field label="Teléfono" value={config.contact.phone} onChange={(value) => setValue("contact.phone", value)} /><Field label="WhatsApp" value={config.contact.whatsapp} onChange={(value) => setValue("contact.whatsapp", value)} /><Field label="Correo" value={config.contact.email} onChange={(value) => setValue("contact.email", value)} /><Field label="Dirección" value={config.contact.address} onChange={(value) => setValue("contact.address", value)} /><Field label="Horario" value={config.contact.schedule} onChange={(value) => setValue("contact.schedule", value)} /></section>}
      {tab === "properties" && isRealEstate && <section><div className="editor-section-title"><div><h2>Catálogo inmobiliario</h2><p className="editor-help">Estas propiedades son contenido de la web de la empresa. Las consultas se envían al CRM.</p></div><button onClick={addProperty}>＋ Propiedad</button></div>{config.properties.map((item, index) => <article className="menu-editor-item" key={item.id}><div className="drag-handle">Propiedad {index + 1}</div><Field label="Título" value={item.title} onChange={(value) => updateProperty(index, { title: value })} /><Field label="Ubicación" value={item.location} onChange={(value) => updateProperty(index, { location: value })} /><div className="time-grid"><label className="editor-field">Operación<select value={item.operation} onChange={(event) => updateProperty(index, { operation: event.target.value as PropertyListing["operation"] })}><option value="venta">Venta</option><option value="alquiler">Alquiler</option></select></label><Field label="Estado" value={item.status} onChange={(value) => updateProperty(index, { status: value })} /></div><div className="time-grid"><Field label="Precio" type="number" value={String(item.price)} onChange={(value) => updateProperty(index, { price: Number(value) })} /><Field label="Moneda" value={item.currency} onChange={(value) => updateProperty(index, { currency: value })} /></div><div className="time-grid"><Field label="Habitaciones" type="number" value={String(item.bedrooms)} onChange={(value) => updateProperty(index, { bedrooms: Number(value) })} /><Field label="Baños" type="number" value={String(item.bathrooms)} onChange={(value) => updateProperty(index, { bathrooms: Number(value) })} /></div><Field label="Área (m²)" type="number" value={String(item.area)} onChange={(value) => updateProperty(index, { area: Number(value) })} /><ImageUpload label="Imagen de propiedad" value={item.imageUrl} busy={uploading === `property-${item.id}`} onSelect={(file) => void uploadImage(file, `property-${item.id}`, (url) => updateProperty(index, { imageUrl: url }))} /><div className="menu-item-actions"><button onClick={() => setValue("properties", config.properties.filter((_, i) => i !== index))}>Eliminar propiedad</button></div></article>)}{!config.properties.length && <p className="editor-help">Aún no hay propiedades. Añade la primera para verla en la vista previa.</p>}</section>}
      {tab === "menu" && <section><div className="editor-section-title"><h2>Menú</h2><button onClick={addItem}>＋ Platillo</button></div><Field label="Título del menú" value={config.menu.title} onChange={(value) => setValue("menu.title", value)} /><div className="time-grid"><Field label="Código de moneda" value={config.menu.currency} onChange={(value) => setValue("menu.currency", value)} /><Field label="Símbolo de moneda" value={config.menu.currencySymbol} onChange={(value) => setValue("menu.currencySymbol", value)} /></div><h3>Categorías</h3><div className="category-list">{config.menu.categories.map((category, index) => <div key={`${category}-${index}`}><input value={category} onChange={(event) => renameCategory(index, event.target.value)} /><button disabled={config.menu.categories.length === 1} onClick={() => setValue("menu.categories", config.menu.categories.filter((_, i) => i !== index))}>×</button></div>)}<button onClick={() => setValue("menu.categories", [...config.menu.categories, `Categoría ${config.menu.categories.length + 1}`])}>＋ Añadir categoría</button></div><h3>Platillos</h3>{config.menu.items.map((item, index) => <article className="menu-editor-item" key={item.id}><div className="drag-handle">Platillo {index + 1}</div><Field label="Nombre" value={item.name} onChange={(value) => updateItem(index, { name: value })} /><label className="editor-field">Categoría<select value={item.category} onChange={(event) => updateItem(index, { category: event.target.value })}>{config.menu.categories.map((category) => <option key={category}>{category}</option>)}</select></label><Field label="Precio" type="number" value={String(item.price)} onChange={(value) => updateItem(index, { price: Number(value) })} /><ImageUpload label="Fotografía" value={item.imageUrl} busy={uploading === `dish-${item.id}`} onSelect={(file) => void uploadImage(file, `dish-${item.id}`, (url) => updateItem(index, { imageUrl: url }))} /><Area label="Descripción" value={item.description} onChange={(value) => updateItem(index, { description: value })} /><div className="menu-item-actions"><label><input type="checkbox" checked={item.active} onChange={(event) => updateItem(index, { active: event.target.checked })} /> Visible</label><button onClick={() => setValue("menu.items", config.menu.items.filter((_, i) => i !== index))}>Eliminar</button></div></article>)}</section>}
      {tab === "location" && <section><h2>Ubicación y redes</h2><Field label="Dirección" value={config.contact.address} onChange={(value) => setValue("contact.address", value)} /><Field label="Enlace de Google Maps" value={config.contact.mapUrl} onChange={(value) => setValue("contact.mapUrl", value)} /><div className="time-grid"><Field label="Latitud" value={config.contact.latitude} onChange={(value) => setValue("contact.latitude", value)} /><Field label="Longitud" value={config.contact.longitude} onChange={(value) => setValue("contact.longitude", value)} /></div><h3>Redes sociales</h3><Field label="Facebook" value={config.social.facebook} onChange={(value) => setValue("social.facebook", value)} /><Field label="Instagram" value={config.social.instagram} onChange={(value) => setValue("social.instagram", value)} /><Field label="TikTok" value={config.social.tiktok} onChange={(value) => setValue("social.tiktok", value)} /><h3>Galería</h3><div className="gallery-grid">{config.gallery.map((url, index) => <div key={url}><img src={url} alt="Galería" /><button onClick={() => setValue("gallery", config.gallery.filter((_, i) => i !== index))}>×</button></div>)}</div><ImageUpload label="Añadir a la galería" value="" busy={uploading === "gallery"} onSelect={(file) => void uploadImage(file, "gallery", (url) => setValue("gallery", [...config.gallery, url]))} /></section>}
      {tab === "integrations" && <section><h2>CRM y chatbox</h2><p className="editor-help">La empresa queda vinculada mediante su identificador público. Las claves privadas nunca se agregan al sitio.</p><Field label="URL del CRM" value={config.integrations.crmBaseUrl} onChange={(value) => setValue("integrations.crmBaseUrl", value)} /><Field label="Identificador del chatbox" value={config.integrations.tenantKey} onChange={(value) => setValue("integrations.tenantKey", value)} /><label className="editor-check"><input type="checkbox" checked={config.integrations.useRealChatbox} onChange={(event) => setValue("integrations.useRealChatbox", event.target.checked)} /> Usar chatbox real</label><h3>Funciones visibles</h3>{Object.entries(config.features).map(([key, value]) => <label className="editor-check" key={key}><input type="checkbox" checked={value} onChange={(event) => setValue(`features.${key}`, event.target.checked)} />{({ orders: "Pedidos", reservations: "Reservaciones", tableQr: "Menú QR", kitchenPreview: "Vista de cocina" } as Record<string, string>)[key] || key}</label>)}</section>}
      {tab === "history" && <section><h2>Publicación segura</h2><button className="review-button" onClick={review}>Ejecutar revisión</button>{validation && <div className={`validation ${validation.valid ? "valid" : "invalid"}`}><strong>{validation.valid ? "✓ Listo para publicar" : "Faltan requisitos"}</strong>{validation.errors.map((error) => <p key={error}>● {error}</p>)}{validation.warnings.map((warning) => <p className="warning" key={warning}>⚠ {warning}</p>)}</div>}<div className="publication-card"><h3>Despliegue</h3><p className="editor-help">Estado: <strong>{project.deployment_status === "ready" ? "Publicado" : project.deployment_status === "building" ? "Publicando…" : project.deployment_status === "error" ? "Error" : "No publicado"}</strong></p><Field label="Dominio personalizado (opcional)" value={customDomain} onChange={setCustomDomain} /><button onClick={() => void publishProject()} disabled={!canApprove || publishing || !["ready", "published", "exported"].includes(project.status)}>{publishing ? "Publicando…" : "Publicar en Vercel"}</button>{project.published_url && <p><a href={project.custom_domain ? `https://${project.custom_domain}` : project.published_url} target="_blank" rel="noreferrer">Abrir sitio publicado ↗</a></p>}{project.deployment_error && <p className="editor-error">{project.deployment_error}</p>}<small>Las credenciales privadas nunca se incluyen en el despliegue.</small></div><h3>Historial</h3><p className="editor-help">Cada guardado crea una versión recuperable.</p><div className="version-list">{versions.length ? versions.map((version) => <article key={version.id}><div><strong>Versión {version.version}</strong><small>{new Date(version.created_at).toLocaleString("es-HN")}</small></div><button onClick={() => void restore(version.id)}>Restaurar</button></article>) : <p>Aún no hay versiones guardadas.</p>}</div></section>}
    </aside><section className="preview-panel"><div className="preview-toolbar"><span>Vista previa</span><div><button className={device === "desktop" ? "active" : ""} onClick={() => setDevice("desktop")}>Escritorio</button><button className={device === "tablet" ? "active" : ""} onClick={() => setDevice("tablet")}>Tablet</button><button className={device === "mobile" ? "active" : ""} onClick={() => setDevice("mobile")}>Móvil</button></div></div><div className={`preview-stage ${device}`}><iframe title="Vista previa del sitio" srcDoc={preview} /></div></section></div>
  </main>;
}

function VisualBuilder({ sections, draggedSection, setDraggedSection, onToggle, onReorder }: { sections: { id: string; label: string; visible: boolean }[]; draggedSection: string; setDraggedSection: (id: string) => void; onToggle: (id: string) => void; onReorder: (ids: string[]) => void }) {
  function move(targetId: string) {
    if (!draggedSection || draggedSection === targetId) return;
    const ids = sections.map((section) => section.id);
    const from = ids.indexOf(draggedSection); const to = ids.indexOf(targetId);
    if (from < 0 || to < 0) return;
    ids.splice(from, 1); ids.splice(to, 0, draggedSection); onReorder(ids); setDraggedSection("");
  }
  return <section className="visual-builder"><div className="visual-builder-heading"><div><p className="editor-kicker">CONSTRUCTOR VISUAL</p><h2>Ordena tu página</h2><p className="editor-help">Arrastra las secciones para cambiar su orden. Usa el ojo para ocultar una sección sin eliminar su contenido.</p></div><span>{sections.filter((section) => section.visible).length} activas</span></div><div className="visual-builder-list">{sections.map((section, index) => <article key={section.id} draggable onDragStart={() => setDraggedSection(section.id)} onDragOver={(event) => event.preventDefault()} onDrop={() => move(section.id)} className={`visual-builder-item ${draggedSection === section.id ? "dragging" : ""} ${section.visible ? "" : "disabled"}`}><button className="drag-grip" title="Arrastrar sección" aria-label={`Arrastrar ${section.label}`}>⠿</button><div className="visual-builder-index">{String(index + 1).padStart(2, "0")}</div><div className="visual-builder-copy"><strong>{section.label}</strong><small>{section.visible ? "Visible en el sitio" : "Oculta en el sitio"}</small></div><button className="visibility-toggle" onClick={() => onToggle(section.id)} aria-label={section.visible ? `Ocultar ${section.label}` : `Mostrar ${section.label}`}>{section.visible ? "◉" : "○"}</button></article>)}</div><div className="visual-builder-tip">Los cambios se reflejan en la vista previa y se guardan junto con una nueva versión.</div></section>;
}

function Field({ label, value, onChange, type = "text" }: { label: string; value: string; onChange: (value: string) => void; type?: string }) { return <label className="editor-field">{label}<input type={type} value={value} onChange={(event) => onChange(event.target.value)} /></label>; }
function Area({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) { return <label className="editor-field">{label}<textarea value={value} onChange={(event) => onChange(event.target.value)} /></label>; }
function Color({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) { return <label className="editor-field">{label}<span className="editor-color"><input type="color" value={value} onChange={(event) => onChange(event.target.value)} /><input value={value} onChange={(event) => onChange(event.target.value)} /></span></label>; }
function ImageUpload({ label, value, busy, onSelect }: { label: string; value: string; busy: boolean; onSelect: (file: File) => void }) { return <div className="image-upload"><span>{label}</span>{value ? <img src={value} alt={`Vista previa: ${label}`} /> : <div className="image-upload-empty">Sin imagen</div>}<label className={busy ? "busy" : ""}><input type="file" accept="image/jpeg,image/png,image/webp,image/gif" disabled={busy} onChange={(event) => { const file = event.target.files?.[0]; if (file) onSelect(file); event.target.value = ""; }} />{busy ? "Subiendo…" : "Seleccionar imagen"}</label><small>JPG, PNG, WEBP o GIF · máximo 5 MB</small></div>; }
function OptionList({ title, options, onChange }: { title: string; options: MenuOption[]; onChange: (items: MenuOption[]) => void }) { return <div className="option-list"><h4>{title}</h4>{options.map((option, index) => <div key={option.id}><input aria-label="Nombre" value={option.name} onChange={(event) => onChange(options.map((item, i) => i === index ? { ...item, name: event.target.value } : item))} /><input aria-label="Precio adicional" type="number" value={option.price} onChange={(event) => onChange(options.map((item, i) => i === index ? { ...item, price: Number(event.target.value) } : item))} /><button onClick={() => onChange(options.filter((_, i) => i !== index))}>×</button></div>)}<button onClick={() => onChange([...options, { id: crypto.randomUUID(), name: "Nueva opción", price: 0 }])}>＋ Añadir</button></div>; }
async function optimizeImage(file: File) { if (file.type === "image/gif" || file.size < 180000) return file; const bitmap = await createImageBitmap(file); const scale = Math.min(1, 1920 / Math.max(bitmap.width, bitmap.height)); const canvas = document.createElement("canvas"); canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale)); canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height); bitmap.close(); const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error("No se pudo optimizar la imagen.")), "image/webp", .82)); return new File([blob], file.name.replace(/\.[^.]+$/, "") + ".webp", { type: "image/webp" }); }
