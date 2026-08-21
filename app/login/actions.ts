"use server";

import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";

function credentials(formData: FormData) {
  return { email: String(formData.get("email") || ""), password: String(formData.get("password") || "") };
}

export async function login(formData: FormData) {
  const supabase = await createServerSupabase();
  const { error } = await supabase.auth.signInWithPassword(credentials(formData));
  if (error) redirect(`/login?message=${encodeURIComponent(error.message)}`);
  redirect("/dashboard");
}

export async function signup(formData: FormData) {
  const supabase = await createServerSupabase();
  const { error } = await supabase.auth.signUp(credentials(formData));
  if (error) redirect(`/login?message=${encodeURIComponent(error.message)}`);
  redirect("/dashboard");
}
