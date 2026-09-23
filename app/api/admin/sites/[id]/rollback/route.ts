import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { requireSitePermission } from "@/lib/site-access";
import { removePrivateConfigKeys, sanitizeSiteConfig } from "@/lib/site-builder";
import { getSiteTemplate } from "@/lib/site-templates/catalog";
import { deployVercelSite } from "@/lib/vercel";
import { reportServerError } from "@/lib/monitoring";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = (await params).id;
  const access = await requireSitePermission("sites.export", id);
  if (!access || !["superadmin", "implementer"].includes(access.role)) return NextResponse.json({ error: "Solo Superadmin o Implementador puede hacer rollback." }, { status: 403 });
  const body = await request.json().catch(() => ({}));
  const { data: version } = await access.admin.from("site_project_versions").select("configuration,version").eq("site_project_id", id).eq("id", String(body.versionId || "")).maybeSingle();
  if (!version) return NextResponse.json({ error: "La versión no existe." }, { status: 404 });
  const { data: project } = await access.admin.from("site_projects").select("id,name,template_key,vercel_project_id").eq("id", id).maybeSingle();
  if (!project) return NextResponse.json({ error: "El proyecto no existe." }, { status: 404 });
  const configuration = removePrivateConfigKeys(sanitizeSiteConfig(version.configuration));
  const templateDir = getSiteTemplate(project.template_key)?.key === "inmobiliaria-a" ? "inmobiliaria-a" : "gastronomia-a";
  const source = path.join(process.cwd(), "public", "templates", templateDir);
  try {
    const [html, css, app] = await Promise.all(["index.html", "styles.css", "app.js"].map((file) => readFile(path.join(source, file), "utf8")));
    const deployment = await deployVercelSite({ name: project.name, projectId: project.vercel_project_id, files: [{ file: "index.html", data: html }, { file: "styles.css", data: css }, { file: "app.js", data: app }, { file: "site-config.js", data: `window.GAVRION_SITE = ${JSON.stringify(configuration)};` }, { file: "vercel.json", data: JSON.stringify({ cleanUrls: true, trailingSlash: false }) }] });
    const { data, error } = await access.admin.from("site_projects").update({ configuration, status: "published", deployment_status: "ready", deployment_error: null, vercel_project_id: deployment.projectId, vercel_deployment_id: deployment.deploymentId, published_url: deployment.url, published_version: version.version, published_at: new Date().toISOString() }).eq("id", id).select().single();
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ ...data, restoredVersion: version.version, deployment });
  } catch (error) {
    reportServerError("site.rollback", error, { siteId: id });
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo hacer rollback." }, { status: 502 });
  }
}
