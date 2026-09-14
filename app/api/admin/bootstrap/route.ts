import { NextResponse } from "next/server";
import { createAdminSupabase } from "@/lib/supabase/admin";

/** One-time bootstrap: it refuses to run once any platform administrator exists. */
export async function POST(request: Request) {
  const configuredSecret = process.env.SUPERADMIN_BOOTSTRAP_SECRET;
  if (!configuredSecret) return NextResponse.json({ error:"SUPERADMIN_BOOTSTRAP_SECRET no está configurado." }, { status:503 });
  const body = await request.json().catch(() => ({}));
  if (String(body.secret || "") !== configuredSecret) return NextResponse.json({ error:"Secreto de bootstrap inválido." }, { status:401 });
  const email = String(body.email || "").trim().toLowerCase();
  const fullName = String(body.fullName || "Administrador Gavrion").trim().slice(0,120);
  if (!/^\S+@\S+\.\S+$/.test(email)) return NextResponse.json({ error:"Indica un correo válido para el superadministrador." }, { status:400 });
  const admin = createAdminSupabase();
  const existingAdmins = await admin.from("platform_admins").select("user_id").limit(1);
  if (existingAdmins.error) return NextResponse.json({ error:existingAdmins.error.message }, { status:500 });
  if ((existingAdmins.data || []).length) return NextResponse.json({ error:"El superadministrador inicial ya fue creado. Usa la sección Equipo interno." }, { status:409 });
  let user = (await admin.auth.admin.listUsers({ page:1, perPage:1000 })).data.users.find(item => item.email?.toLowerCase() === email);
  let invited = false;
  if (!user) {
    const result = await admin.auth.admin.inviteUserByEmail(email, { redirectTo:`${new URL(request.url).origin}/invite`, data:{ full_name:fullName, platform_role:"superadmin" } });
    if (result.error || !result.data.user) return NextResponse.json({ error:result.error?.message || "No se pudo enviar la invitación." }, { status:400 });
    user = result.data.user; invited = true;
  }
  const platformAdmin = await admin.from("platform_admins").insert({ user_id:user.id });
  if (platformAdmin.error) return NextResponse.json({ error:platformAdmin.error.message }, { status:400 });
  const staff = await admin.from("platform_staff").upsert({ user_id:user.id, role:"superadmin", active:true });
  if (staff.error) return NextResponse.json({ error:staff.error.message }, { status:400 });
  await admin.from("platform_audit_logs").insert({ actor_user_id:user.id, action:"create", entity_type:"platform_admin", entity_id:user.id, changes:{ email, invited } });
  return NextResponse.json({ ok:true, userId:user.id, email, invited, message:invited ? "Superadministrador creado y se envió la invitación." : "Usuario existente promovido a superadministrador." }, { status:201 });
}
