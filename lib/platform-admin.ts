import { createAdminSupabase } from "@/lib/supabase/admin";
import { createServerSupabase } from "@/lib/supabase/server";

export async function requirePlatformAdmin() {
  const server = await createServerSupabase();
  const { data: auth } = await server.auth.getUser();
  if (!auth.user) return null;
  const admin = createAdminSupabase();
  const { data } = await admin.from("platform_admins").select("user_id").eq("user_id", auth.user.id).maybeSingle();
  return data ? { user: auth.user, admin } : null;
}
