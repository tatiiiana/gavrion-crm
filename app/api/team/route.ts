import { NextResponse } from "next/server";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { createServerSupabase } from "@/lib/supabase/server";

async function authorize(requireAdmin = true) {
  const server = await createServerSupabase();
  const { data: auth } = await server.auth.getUser();
  if (!auth.user) return null;
  const { data: membership } = await server.from("memberships").select("tenant_id, role").eq("user_id", auth.user.id).limit(1).maybeSingle();
  if (!membership || (requireAdmin && !["owner", "admin"].includes(membership.role))) return null;
  return { user: auth.user, membership };
}

export async function GET() {
  const access = await authorize(false);
  if (!access) return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  const admin = createAdminSupabase();
  const tenantId = access.membership.tenant_id;
  const { data: memberships, error } = await admin.from("memberships").select("user_id, role, active, invitation_status, invited_at, deactivated_at").eq("tenant_id", tenantId);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  const { data: users, error: usersError } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (usersError) return NextResponse.json({ error: usersError.message }, { status: 400 });
  const userMap = new Map(users.users.map(user => [user.id, user]));
  const [{ data: conversations }, { data: tasks }, { data: deals }] = await Promise.all([
    admin.from("conversations").select("assigned_to").eq("tenant_id", tenantId).in("status", ["open", "pending"]),
    admin.from("tasks").select("assigned_to").eq("tenant_id", tenantId).is("completed_at", null),
    admin.from("deals").select("owner_id").eq("tenant_id", tenantId).not("stage", "eq", "won")
  ]);
  return NextResponse.json((memberships || []).map(member => {
    const user = userMap.get(member.user_id);
    return { id: member.user_id, email: user?.email || "Sin correo", name: String(user?.user_metadata?.full_name || user?.email?.split("@")[0] || "Usuario"), role: member.role,
      active: member.active !== false, invitationStatus: member.invitation_status || (user?.email_confirmed_at ? "accepted" : "pending"), invitedAt: member.invited_at,
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
  const { userId, role, active, reassignTo } = await request.json();
  if (!userId || (role !== undefined && !["admin", "agent", "viewer"].includes(role)) || (active !== undefined && typeof active !== "boolean")) return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });
  const admin = createAdminSupabase();
  if (active === false && reassignTo) {
    await Promise.all([
      admin.from("conversations").update({assigned_to:reassignTo}).eq("tenant_id",access.membership.tenant_id).eq("assigned_to",userId),
      admin.from("tasks").update({assigned_to:reassignTo}).eq("tenant_id",access.membership.tenant_id).eq("assigned_to",userId).is("completed_at",null),
      admin.from("deals").update({owner_id:reassignTo}).eq("tenant_id",access.membership.tenant_id).eq("owner_id",userId)
    ]);
  }
  const changes:Record<string,unknown>={};
  if(role!==undefined) changes.role=role;
  if(active!==undefined){changes.active=active;changes.deactivated_at=active?null:new Date().toISOString();changes.invitation_status=active?"accepted":"revoked";}
  const { error } = await admin.from("memberships").update(changes).eq("tenant_id", access.membership.tenant_id).eq("user_id", userId).neq("role", "owner");
  return error ? NextResponse.json({ error: error.message }, { status: 400 }) : NextResponse.json({ ok: true });
}
