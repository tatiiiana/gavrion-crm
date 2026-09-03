"use client";

import { FormEvent, useEffect, useState } from "react";
import { createClientSupabase } from "@/lib/supabase/client";

export default function AcceptInvitationPage() {
  const [ready, setReady] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const supabase = createClientSupabase();
    if (!supabase) { setMessage("Supabase no está configurado."); return; }
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) setReady(true);
      else setMessage("La invitación no es válida o ya expiró. Solicita una nueva invitación a Gavrion.");
    });
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault(); setMessage("");
    if (password.length < 8 || !/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/.test(password)) { setMessage("Usa al menos 8 caracteres, una mayúscula, una minúscula y un número."); return; }
    if (password !== confirmation) { setMessage("Las contraseñas no coinciden."); return; }
    const supabase = createClientSupabase();
    if (!supabase) return;
    setSaving(true);
    const { error } = await supabase.auth.updateUser({ password });
    if (error) { setMessage(error.message); setSaving(false); return; }
    window.location.replace("/dashboard");
  }

  return <main className="auth-shell"><section className="auth-card">
    <div className="brand auth-brand"><span className="brand-mark">G</span><span>Gavrion</span></div>
    <p className="eyebrow">INVITACIÓN AL CRM</p><h1>Configura tu acceso</h1>
    <p>Establece una contraseña para ingresar al espacio preparado para tu empresa.</p>
    {message&&<div className="auth-message error" role="status">{message}</div>}
    {ready&&<form className="auth-form" onSubmit={submit}>
      <label>Nueva contraseña<input required type="password" value={password} onChange={event=>setPassword(event.target.value)} autoComplete="new-password" /><small className="password-hint">8 caracteres, mayúscula, minúscula y número.</small></label>
      <label>Confirmar contraseña<input required type="password" value={confirmation} onChange={event=>setConfirmation(event.target.value)} autoComplete="new-password" /></label>
      <button disabled={saving} className="primary-button auth-submit">{saving?"Guardando…":"Activar mi cuenta"}</button>
    </form>}
  </section></main>;
}
