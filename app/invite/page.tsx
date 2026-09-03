"use client";

import { FormEvent, useEffect, useState } from "react";
import { createClientSupabase, createInviteSupabase } from "@/lib/supabase/client";

export default function AcceptInvitationPage() {
  const [ready, setReady] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [accountEmail, setAccountEmail] = useState("");

  useEffect(() => {
    const supabase = createInviteSupabase();
    if (!supabase) { setMessage("Supabase no está configurado."); return; }
    const client = supabase;
    let active = true;
    async function activateLink() {
      const query = new URLSearchParams(window.location.search);
      const fragment = new URLSearchParams(window.location.hash.replace(/^#/, ""));
      const code = query.get("code");
      const accessToken = fragment.get("access_token");
      const refreshToken = fragment.get("refresh_token");
      const linkType = fragment.get("type") || query.get("type") || (query.get("recovery") === "1" ? "recovery" : "");
      if (!code && (!accessToken || !refreshToken)) {
        if (active) setMessage("Abre esta página usando el enlace recibido por correo. No utilizaremos una sesión que ya estuviera abierta en el navegador.");
        return;
      }

      // exchangeCodeForSession/setSession reemplaza la sesión anterior con la
      // identidad incluida en el enlace, sin consumir o revocar antes el token.
      const result = code
        ? await client.auth.exchangeCodeForSession(code)
        : await client.auth.setSession({ access_token:accessToken!, refresh_token:refreshToken! });
      if (result.error) { if (active) setMessage("La invitación no es válida o ya expiró. Solicita un nuevo enlace de acceso."); return; }
      const { data:userData } = await client.auth.getUser();
      if (!userData.user || (linkType && !["invite","recovery","signup","magiclink"].includes(linkType))) {
        await client.auth.signOut({ scope:"local" });
        if (active) setMessage("El enlace no corresponde a una invitación válida.");
        return;
      }
      if (active) { setAccountEmail(userData.user.email || ""); setReady(true); }
    }
    void activateLink();
    return () => { active=false; };
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
    await supabase.auth.signOut({ scope:"local" });
    window.location.replace("/login?access=created");
  }

  return <main className="auth-shell"><section className="auth-card">
    <div className="brand auth-brand"><span className="brand-mark">G</span><span>Gavrion</span></div>
    <p className="eyebrow">INVITACIÓN AL CRM</p><h1>Configura tu acceso</h1>
    <p>Establece una contraseña para ingresar al espacio preparado para tu empresa.</p>
    {ready&&accountEmail&&<div className="auth-message success">Activando la cuenta: <strong>{accountEmail}</strong></div>}
    {message&&<div className="auth-message error" role="status">{message}</div>}
    {ready&&<form className="auth-form" onSubmit={submit}>
      <label>Nueva contraseña<input required type="password" value={password} onChange={event=>setPassword(event.target.value)} autoComplete="new-password" /><small className="password-hint">8 caracteres, mayúscula, minúscula y número.</small></label>
      <label>Confirmar contraseña<input required type="password" value={confirmation} onChange={event=>setConfirmation(event.target.value)} autoComplete="new-password" /></label>
      <button disabled={saving} className="primary-button auth-submit">{saving?"Guardando…":"Activar mi cuenta"}</button>
    </form>}
  </section></main>;
}
