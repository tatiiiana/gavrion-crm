"use client";

import { FormEvent, useEffect, useState } from "react";
import { createClientSupabase } from "@/lib/supabase/client";

type FieldErrors = { email?: string; password?: string; company?: string; fullName?: string };

function friendlyError(message: string) {
  const normalized = message.toLowerCase();
  if (normalized.includes("invalid login credentials")) return "El correo o la contraseña son incorrectos.";
  if (normalized.includes("email not confirmed")) return "Debes confirmar tu correo antes de ingresar.";
  if (normalized.includes("already registered") || normalized.includes("already been registered")) return "Este correo ya tiene una cuenta. Intenta iniciar sesión.";
  if (normalized.includes("rate limit")) return "Demasiados intentos. Espera unos minutos y vuelve a intentarlo.";
  if (normalized.includes("fetch failed") || normalized.includes("failed to fetch")) return "No fue posible conectar con Supabase. Verifica tu conexión e inténtalo nuevamente.";
  return message || "Ocurrió un error inesperado. Inténtalo nuevamente.";
}

export default function LoginPage() {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [company, setCompany] = useState("Gavrion");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [message, setMessage] = useState<{ type: "error" | "success"; text: string } | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const clearPassword = () => setPassword("");
    clearPassword();
    window.addEventListener("pageshow", clearPassword);
    return () => window.removeEventListener("pageshow", clearPassword);
  }, []);

  function validate() {
    const next: FieldErrors = {};
    if (!email.trim()) next.email = "Ingresa tu correo.";
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) next.email = "Ingresa un correo válido.";
    if (!password) next.password = "Ingresa tu contraseña.";
    else if (password.length < 8) next.password = "Debe contener al menos 8 caracteres.";
    else if (mode === "signup" && !/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/.test(password)) next.password = "Incluye una mayúscula, una minúscula y un número.";
    if (mode === "signup" && fullName.trim().length < 3) next.fullName = "Ingresa tu nombre completo.";
    if (mode === "signup" && company.trim().length < 2) next.company = "Ingresa el nombre de la empresa.";
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setMessage(null);
    if (!validate()) return;
    const supabase = createClientSupabase();
    if (!supabase) { setMessage({ type: "error", text: "Supabase todavía no está configurado." }); return; }
    setLoading(true);
    try {
      if (mode === "login") {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (error) throw error;
        setPassword("");
        window.location.replace("/dashboard");
      } else {
        const { data, error } = await supabase.auth.signUp({ email: email.trim(), password, options: { data: { full_name: fullName.trim(), company_name: company.trim() } } });
        if (error) throw error;
        if (data.user?.identities?.length === 0) throw new Error("Este correo ya tiene una cuenta. Intenta iniciar sesión.");
        if (data.session) { setPassword(""); window.location.replace("/dashboard"); }
        else setMessage({ type: "success", text: "Cuenta creada. Revisa tu correo y confirma el registro antes de ingresar." });
      }
    } catch (error) {
      setMessage({ type: "error", text: friendlyError(error instanceof Error ? error.message : "") });
    } finally { setPassword(""); setLoading(false); }
  }

  function changeMode(next: "login" | "signup") { setMode(next); setErrors({}); setMessage(null); }

  return <main className="auth-shell">
    <section className="auth-card">
      <div className="brand auth-brand"><span className="brand-mark">G</span><span>Gavrion</span></div>
      <p className="eyebrow">GAVRION CRM</p>
      <h1>{mode === "login" ? "Bienvenido de nuevo" : "Crea tu cuenta"}</h1>
      <p>{mode === "login" ? "Administra conversaciones, clientes y oportunidades desde un solo lugar." : "Configura el espacio de trabajo de tu empresa."}</p>
      <div className="auth-tabs" role="tablist"><button type="button" className={mode === "login" ? "active" : ""} onClick={()=>changeMode("login")}>Ingresar</button><button type="button" className={mode === "signup" ? "active" : ""} onClick={()=>changeMode("signup")}>Crear cuenta</button></div>
      <form className="auth-form" onSubmit={submit} noValidate autoComplete="off">
        {mode === "signup" && <label>Nombre completo<input value={fullName} onChange={e=>setFullName(e.target.value)} aria-invalid={Boolean(errors.fullName)} autoComplete="name" placeholder="Ej. María Rodríguez" />{errors.fullName&&<small className="field-error">{errors.fullName}</small>}</label>}
        {mode === "signup" && <label>Empresa<input value={company} onChange={e=>setCompany(e.target.value)} aria-invalid={Boolean(errors.company)} autoComplete="organization" />{errors.company&&<small className="field-error">{errors.company}</small>}</label>}
        <label>Correo<input value={email} onChange={e=>setEmail(e.target.value)} type="email" aria-invalid={Boolean(errors.email)} autoComplete="email" placeholder="tu@empresa.com" />{errors.email&&<small className="field-error">{errors.email}</small>}</label>
        <label>Contraseña<input name="gavrion-access-key" value={password} onChange={e=>setPassword(e.target.value)} type="password" aria-invalid={Boolean(errors.password)} autoComplete="new-password" data-form-type="other" data-lpignore="true" data-1p-ignore="true" spellCheck={false} />{errors.password&&<small className="field-error">{errors.password}</small>}{mode === "signup"&&!errors.password&&<small className="password-hint">8 caracteres, mayúscula, minúscula y número.</small>}</label>
        {message&&<div className={`auth-message ${message.type}`} role="status">{message.text}</div>}
        <button disabled={loading} className="primary-button auth-submit">{loading ? "Procesando…" : mode === "login" ? "Ingresar" : "Crear cuenta"}</button>
      </form>
    </section>
  </main>;
}
