import { NextResponse } from "next/server";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { createServerSupabase } from "@/lib/supabase/server";
import { getActiveTenantIdFromCookie, resolveTenantMembership, requireTenantCapability } from "@/lib/tenant-access";

async function authorize(requireAdmin = true) {
  if (requireAdmin) {
    const access = await requireTenantCapability("team");
    if (!access) return null;
    return { user: access.user, membership: access.membership };
  }
  const server = await createServerSupabase();
  const { data: auth } = await server.auth.getUser();
  if (!auth.user) return null;
  const { membership } = await resolveTenantMembership(server, auth.user.id, await getActiveTenantIdFromCookie());
  return membership ? { user: auth.user, membership } : null;
}

export async function GET() {
  const access = await authorize(false);
  if (!access) return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  const admin = createAdminSupabase();
  const tenantId = access.membership.tenant_id;
  const { data: memberships, error } = await admin.from("memberships").select("user_id, role, active, permissions, invitation_status, invited_at, deactivated_at").eq("tenant_id", tenantId);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  const { data: users, error: usersError } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (usersError) return NextResponse.json({ error: usersError.message }, { status: 400 });
  const userMap = new Map(users.users.map(user => [user.id, user]));
  const [{ data: conversations }, { data: tasks }, { data: deals }, { data: accessLogs }] = await Promise.all([
    admin.from("conversations").select("assigned_to").eq("tenant_id", tenantId).in("status", ["open", "pending"]),
    admin.from("tasks").select("assigned_to").eq("tenant_id", tenantId).is("completed_at", null),
    admin.from("deals").select("owner_id").eq("tenant_id", tenantId).not("stage", "eq", "won"),
    admin.from("account_access_logs").select("user_id,created_at").eq("tenant_id", tenantId).in("event_type", ["login", "heartbeat"]).order("created_at", { ascending: false }).limit(1000)
  ]);
  const lastAccess = new Map<string, string>();
  for (const row of accessLogs || []) if (!lastAccess.has(row.user_id)) lastAccess.set(row.user_id, row.created_at);
  return NextResponse.json((memberships || []).map(member => {
    const user = userMap.get(member.user_id);
    const lastSeenAt = lastAccess.get(member.user_id) || user?.last_sign_in_at || null;
    const online = Boolean(lastSeenAt && Date.now() - new Date(lastSeenAt).getTime() < 15 * 60 * 1000);
    return { id: member.user_id, email: user?.email || "Sin correo", name: String(user?.user_metadata?.full_name || user?.email?.split("@")[0] || "Usuario"), role: member.role,
      active: member.active !== false, permissions: member.permissions || {}, invitationStatus: member.invitation_status || (user?.email_confirmed_at ? "accepted" : "pending"), invitedAt: member.invited_at,
      lastSeenAt, online,
      workload: { conversations:(conversations||[]).filter(x=>x.assigned_to===member.user_id).length, tasks:(tasks||[]).filter(x=>x.assigned_to===member.user_id).length, deals:(deals||[]).filter(x=>x.owner_id===member.user_id).length }
    };
  }));
}

export async function POST(request: Request) {
  const access = await authorize();
  if (!access) return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  const { email, role } = await request.json();
  const cleanEmail = String(email || "").trim().toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(cleanEmail) || !["admin", "agent", "viewer"].includes(role)) return NextResponse.json({ error: "Correo o rol inválido" }, { status: 400 });
  const admin = createAdminSupabase();
  const { data: listed, error: listError } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (listError) return NextResponse.json({ error: listError.message }, { status: 400 });
  let invited = listed.users.find(user => user.email?.toLowerCase() === cleanEmail);
  if (!invited) {
    const origin = new URL(request.url).origin;
    const result = await admin.auth.admin.inviteUserByEmail(cleanEmail, { redirectTo: `${origin}/invite` });
    if (result.error || !result.data.user) return NextResponse.json({ error: result.error?.message || "No se pudo invitar" }, { status: 400 });
    invited = result.data.user;
    const { data: generated } = await admin.from("memberships").select("tenant_id").eq("user_id", invited.id);
    const generatedTenantIds = (generated || []).map(item => item.tenant_id).filter(id => id !== access.membership.tenant_id);
    await admin.from("memberships").delete().eq("user_id", invited.id);
    if (generatedTenantIds.length) await admin.from("tenants").delete().in("id", generatedTenantIds);
  }
  const invitationStatus = invited.email_confirmed_at ? "accepted" : "pending";
  const { error } = await admin.from("memberships").upsert({ tenant_id: access.membership.tenant_id, user_id: invited.id, role, active:true, invitation_status:invitationStatus, invited_at:new Date().toISOString(), deactivated_at:null }, { onConflict: "tenant_id,user_id" });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ id: invited.id, email: cleanEmail, name: String(invited.user_metadata?.full_name || cleanEmail.split("@")[0]), role, active:true, invitationStatus, workload:{conversations:0,tasks:0,deals:0} });
}

export async function PATCH(request: Request) {
  const access = await authorize();
  if (!access) return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  const body = await request.json().catch(() => ({}));
  const { userId, role, active, reassignTo, permissions } = body;
  if (body.action === "reassign") {
    const sourceUserId = String(body.fromUserId || "");
    const targetUserId = String(body.toUserId || "");
    if (!sourceUserId || !targetUserId || sourceUserId === targetUserId) return NextResponse.json({ error: "Selecciona dos integrantes distintos." }, { status: 400 });
    const admin = createAdminSupabase();
    const { data: target } = await admin.from("memberships").select("user_id").eq("tenant_id", access.membership.tenant_id).eq("user_id", targetUserId).eq("active", true).maybeSingle();
    if (!target) return NextResponse.json({ error: "El integrante receptor no está activo en esta empresa." }, { status: 400 });
    const [conversations, tasks, deals] = await Promise.all([
      admin.from("conversations").update({ assigned_to: targetUserId }).eq("tenant_id", access.membership.tenant_id).eq("assigned_to", sourceUserId).select("id"),
      admin.from("tasks").update({ assigned_to: targetUserId }).eq("tenant_id", access.membership.tenant_id).eq("assigned_to", sourceUserId).is("completed_at", null).select("id"),
      admin.from("deals").update({ owner_id: targetUserId }).eq("tenant_id", access.membership.tenant_id).eq("owner_id", sourceUserId).not("stage", "eq", "won").select("id")
    ]);
    const error = conversations.error || tasks.error || deals.error;
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ ok: true, moved: { conversations: conversations.data?.length || 0, tasks: tasks.data?.length || 0, deals: deals.data?.length || 0 } });
  }
  if (!userId || (role !== undefined && !["admin", "agent", "viewer"].includes(role)) || (active !== undefined && typeof active !== "boolean")) return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });
  const admin = createAdminSupabase();
  if (active === false && reassignTo) {
    const { data: target } = await admin.from("memberships").select("user_id").eq("tenant_id", access.membership.tenant_id).eq("user_id", String(reassignTo)).eq("active", true).maybeSingle();
    if (!target) return NextResponse.json({ error: "El integrante receptor no está activo en esta empresa." }, { status: 400 });
  }
  if (active === false && reassignTo) {
    await Promise.all([
      admin.from("conversations").update({assigned_to:reassignTo}).eq("tenant_id",access.membership.tenant_id).eq("assigned_to",userId),
      admin.from("tasks").update({assigned_to:reassignTo}).eq("tenant_id",access.membership.tenant_id).eq("assigned_to",userId).is("completed_at",null),
      admin.from("deals").update({owner_id:reassignTo}).eq("tenant_id",access.membership.tenant_id).eq("owner_id",userId)
    ]);
  }
  const changes:Record<string,unknown> = {};
  if(role!==undefined) changes.role=role;
  if (permissions !== undefined) {
    if (!permissions || typeof permissions !== "object" || Array.isArray(permissions)) return NextResponse.json({ error: "Permisos inválidos" }, { status: 400 });
    const allowed = ["sales.view", "sales.edit", "contacts.export", "reports.financial", "automations.manage", "integrations.manage", "team.manage", "settings.manage", "audit.view"];
    changes.permissions = Object.fromEntries(Object.entries(permissions).filter(([key, value]) => allowed.includes(key) && typeof value === "boolean"));
  }
  if(active!==undefined){changes.active=active;changes.deactivated_at=active?null:new Date().toISOString();changes.invitation_status=active?"accepted":"revoked";}
  const { error } = await admin.from("memberships").update(changes).eq("tenant_id", access.membership.tenant_id).eq("user_id", userId).neq("role", "owner");
  return error ? NextResponse.json({ error: error.message }, { status: 400 }) : NextResponse.json({ ok: true });
}
