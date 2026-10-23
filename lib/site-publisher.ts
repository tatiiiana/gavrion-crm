import { readFile } from "node:fs/promises";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { bindSiteToTenant } from "@/lib/site-binding";
import { removePrivateConfigKeys, sanitizeSiteConfig, validateSiteForPublication } from "@/lib/site-builder";
import { getSiteTemplate } from "@/lib/site-templates/catalog";
import { attachVercelDomain, deployVercelSite, readVercelDomain } from "@/lib/vercel";

type PublishedSite = {
  id: string;
  tenant_id: string;
  name: string;
  template_key: string;
  configuration: Record<string, unknown>;
  vercel_project_id?: string | null;
  custom_domain?: string | null;
};

function validDomain(value: string) {
  return value.length <= 253 && /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i.test(value);
}

/** Regenera un sitio ya publicado con la configuración pública sincronizada. */
export async function republishAssignedSite(admin: SupabaseClient, project: PublishedSite, requestUrl: string) {
  const bound = await bindSiteToTenant(admin, project.tenant_id, project.configuration, requestUrl);
  if (bound.error) throw new Error(bound.error);
  const templateDir = getSiteTemplate(project.template_key)?.key === "inmobiliaria-a" ? "inmobiliaria-a" : "gastronomia-a";
  const source = path.join(process.cwd(), "public", "templates", templateDir);
  const [html, css, app] = await Promise.all(["index.html", "styles.css", "app.js"].map((file) => readFile(path.join(source, file), "utf8")));
  const config = removePrivateConfigKeys(sanitizeSiteConfig({ ...bound.config, template: project.template_key }));
  const validation = validateSiteForPublication(config);
  // El proyecto ya estaba publicado; la sincronización de marca/contacto no bloquea\n  // por requisitos editoriales que solo se revisan durante una publicación manual.
  const files = [
    { file: "index.html", data: html },
    { file: "styles.css", data: css },
    { file: "app.js", data: app },
    { file: "site-config.js", data: `window.GAVRION_SITE = ${JSON.stringify(config)};` },
    { file: "vercel.json", data: JSON.stringify({ cleanUrls: true, trailingSlash: false }) },
  ];
  await admin.from("site_projects").update({ deployment_status: "building", deployment_error: null }).eq("id", project.id);
  try {
    const deployment = await deployVercelSite({ name: project.name, projectId: project.vercel_project_id, files });
    const customDomain = String(project.custom_domain || "").trim().toLowerCase();
    if (customDomain && !validDomain(customDomain)) throw new Error("El dominio personalizado guardado no es válido.");
    let domainStatus = customDomain ? "pending" : "not_configured";
    if (customDomain) {
      await attachVercelDomain(deployment.projectId, customDomain);
      try {
        const domain = await readVercelDomain(deployment.projectId, customDomain);
        domainStatus = domain.verified ? "verified" : "pending";
      } catch { domainStatus = "pending"; }
    }
    const { data: latest } = await admin.from("site_project_versions").select("version").eq("site_project_id", project.id).order("version", { ascending: false }).limit(1).maybeSingle();
    const update = await admin.from("site_projects").update({
      deployment_status: "ready",
      deployment_error: null,
      published_url: deployment.url,
      domain_status: domainStatus,
      vercel_project_id: deployment.projectId,
      vercel_deployment_id: deployment.deploymentId,
      published_version: latest?.version || null,
      published_at: new Date().toISOString(),
    }).eq("id", project.id);
    if (update.error) throw new Error(update.error.message);
    return { deployment, validation, domainStatus };
  } catch (error) {
    await admin.from("site_projects").update({ deployment_status: "error", deployment_error: error instanceof Error ? error.message : "No se pudo sincronizar el sitio." }).eq("id", project.id);
    throw error;
  }
}