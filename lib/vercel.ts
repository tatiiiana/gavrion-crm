type VercelFile = { file: string; data: string };

function settings() {
  const token = process.env.VERCEL_API_TOKEN;
  if (!token) throw new Error("Falta configurar VERCEL_API_TOKEN en el servidor.");
  return { token, teamId: process.env.VERCEL_TEAM_ID || "" };
}

function scope(path: string, teamId: string) {
  return teamId ? `${path}${path.includes("?") ? "&" : "?"}teamId=${encodeURIComponent(teamId)}` : path;
}

async function vercelRequest(path: string, init: RequestInit = {}) {
  const { token, teamId } = settings();
  const response = await fetch(`https://api.vercel.com${scope(path, teamId)}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers || {}) },
    cache: "no-store",
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(String(body.error?.message || body.message || `Vercel respondió ${response.status}.`));
  return body;
}

export async function ensureVercelProject(name: string, projectId?: string | null) {
  if (projectId) return { id: projectId, name };
  const safeName = name.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || `gavrion-site-${Date.now()}`;
  return vercelRequest("/v9/projects", { method: "POST", body: JSON.stringify({ name: safeName, framework: "other" }) });
}

export async function deployVercelSite(args: { name: string; projectId?: string | null; files: VercelFile[] }) {
  const project = await ensureVercelProject(args.name, args.projectId);
  const body = await vercelRequest("/v13/deployments", {
    method: "POST",
    body: JSON.stringify({ name: project.name || args.name, project: project.id, target: "production", files: args.files }),
  });
  return { projectId: project.id, deploymentId: body.id, url: body.url ? `https://${body.url}` : body.alias?.[0] ? `https://${body.alias[0]}` : "", readyState: body.readyState || "BUILDING" };
}

export async function attachVercelDomain(projectId: string, domain: string) {
  return vercelRequest(`/v9/projects/${encodeURIComponent(projectId)}/domains`, { method: "POST", body: JSON.stringify({ name: domain }) });
}

export async function readVercelDomain(projectId: string, domain: string) {
  return vercelRequest(`/v9/projects/${encodeURIComponent(projectId)}/domains/${encodeURIComponent(domain)}`, { method: "GET" });
}
