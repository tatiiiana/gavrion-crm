import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { requireSitePermission } from "@/lib/site-access";
import { removePrivateConfigKeys, sanitizeSiteConfig, validateSiteForPublication } from "@/lib/site-builder";
import { getSiteTemplate } from "@/lib/site-templates/catalog";
import { attachVercelDomain, deployVercelSite, readVercelDomain } from "@/lib/vercel";
import { reportServerError } from "@/lib/monitoring";

function validDomain(value: string) { return value.length <= 253 && /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i.test(value); }

async function bundle(project: { name: string; template_key: string; configuration: unknown }) {
  const templateDir = getSiteTemplate(project.template_key)?.key === "inmobiliaria-a" ? "inmobiliaria-a" : "gastronomia-a";
  const source = path.join(process.cwd(), "public", "templates", templateDir);
  const [html, css, app] = await Promise.all(["index.html", "styles.css", "app.js"].map((file) => readFile(path.join(source, file), "utf8")));
  const config = removePrivateConfigKeys(sanitizeSiteConfig(project.configuration));
  return { templateDir, config, files: [{ file: "index.html", data: html }, { file: "styles.css", data: css }, { file: "app.js", data: app }, { file: "site-config.js", data: `window.GAVRION_SITE = ${JSON.stringify(config)};` }, { file: "vercel.json", data: JSON.stringify({ cleanUrls: true, trailingSlash: false }) }] };
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = (await params).id;
  const access = await requireSitePermission("sites.export", id);
  if (!access || !["superadmin", "implementer"].includes(access.role)) return NextResponse.json({ error: "Solo Superadmin o Implementador puede publicar un sitio aprobado." }, { status: 403 });
  const body = await request.json().catch(() => ({}));
  const { data: project, error } = await access.admin.from("site_projects").select("id,name,template_key,configuration,status,vercel_project_id,custom_domain,domain_status").eq("id", id).maybeSingle();
  if (error || !project) return NextResponse.json({ error: error?.message || "El proyecto no existe." }, { status: 404 });
  if (!["ready", "published", "exported"].includes(project.status)) return NextResponse.json({ error: "El sitio debe estar aprobado antes de publicarlo." }, { status: 409 });
  const built = await bundle(project);
  const validation = validateSiteForPublication(built.config);
  if (!validation.valid) return NextResponse.json({ error: "El proyecto no superó la revisión.", validation }, { status: 422 });
  const customDomain = String(body.customDomain ?? project.custom_domain ?? "").trim().toLowerCase();
  if (customDomain && !validDomain(customDomain)) return NextResponse.json({ error: "El dominio personalizado no es válido." }, { status: 400 });
  await access.admin.from("site_projects").update({ deployment_status: "building", deployment_error: null }).eq("id", id);
  try {
    const deployment = await deployVercelSite({ name: project.name, projectId: project.vercel_project_id, files: built.files });
    let domainStatus = customDomain ? "pending" : "not_configured";
    if (customDomain) {
      await attachVercelDomain(deployment.projectId, customDomain);
      try { const domain = await readVercelDomain(deployment.projectId, customDomain); domainStatus = domain.verified ? "verified" : "pending"; } catch { domainStatus = "pending"; }
    }
    const { data: latest } = await access.admin.from("site_project_versions").select("version").eq("site_project_id", id).order("version", { ascending: false }).limit(1).maybeSingle();
    const update = { status: "published", deployment_status: "ready", deployment_error: null, published_url: deployment.url, custom_domain: customDomain || null, domain_status: domainStatus, vercel_project_id: deployment.projectId, vercel_deployment_id: deployment.deploymentId, published_version: latest?.version || null, published_at: new Date().toISOString() };
    const { data, error: updateError } = await access.admin.from("site_projects").update(update).eq("id", id).select().single();
    if (updateError) throw new Error(updateError.message);
    return NextResponse.json({ ...data, validation, deployment });
  } catch (cause) {
    reportServerError("site.publish", cause, { siteId: id });
    await access.admin.from("site_projects").update({ deployment_status: "error", deployment_error: cause instanceof Error ? cause.message : "No se pudo publicar." }).eq("id", id);
    return NextResponse.json({ error: cause instanceof Error ? cause.message : "No se pudo publicar." }, { status: 502 });
  }
}

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireSitePermission("sites.read", (await params).id);
  if (!access) return NextResponse.json({ error: "Acceso denegado." }, { status: 403 });
  const { data, error } = await access.admin.from("site_projects").select("status,published_url,custom_domain,domain_status,deployment_status,deployment_error,vercel_project_id,vercel_deployment_id,published_version,published_at").eq("id", (await params).id).maybeSingle();
  return error ? NextResponse.json({ error: error.message }, { status: 400 }) : NextResponse.json(data || {});
}
