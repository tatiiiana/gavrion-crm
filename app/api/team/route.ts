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
  const { data: memberships, error } = await admin.from("memberships").select("user_id, role").eq("tenant_id", access.membership.tenant_id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  const { data: users, error: usersError } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (usersError) return NextResponse.json({ error: usersError.message }, { status: 400 });
  const userMap = new Map(users.users.map(user => [user.id, user]));
  return NextResponse.json((memberships || []).map(member => {
    const user = userMap.get(member.user_id);
    return { id: member.user_id, email: user?.email || "Sin correo", name: String(user?.user_metadata?.full_name || user?.email?.split("@")[0] || "Usuario"), role: member.role };
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
  const { error } = await admin.from("memberships").upsert({ tenant_id: access.membership.tenant_id, user_id: invited.id, role }, { onConflict: "tenant_id,user_id" });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ id: invited.id, email: cleanEmail, name: String(invited.user_metadata?.full_name || cleanEmail.split("@")[0]), role });
}

export async function PATCH(request: Request) {
  const access = await authorize();
  if (!access) return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  const { userId, role } = await request.json();
  if (!userId || !["admin", "agent", "viewer"].includes(role)) return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });
  const admin = createAdminSupabase();
  const { error } = await admin.from("memberships").update({ role }).eq("tenant_id", access.membership.tenant_id).eq("user_id", userId).neq("role", "owner");
  return error ? NextResponse.json({ error: error.message }, { status: 400 }) : NextResponse.json({ ok: true });
}
