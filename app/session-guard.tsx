"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { createClientSupabase } from "@/lib/supabase/client";

const idleMinutes = Math.max(5, Number(process.env.NEXT_PUBLIC_SESSION_IDLE_MINUTES || 30));
const maximumHours = Math.max(1, Number(process.env.NEXT_PUBLIC_SESSION_MAX_HOURS || 8));
const warningMilliseconds = 2 * 60 * 1000;

export default function SessionGuard() {
  const pathname = usePathname();
  const [remaining, setRemaining] = useState<number | null>(null);

  useEffect(() => {
    if (!pathname.startsWith("/dashboard") && !pathname.startsWith("/admin")) return;
    const supabase = createClientSupabase();
    if (!supabase) return;
    const client = supabase;
    let stopped = false;
    let lastActivityWrite = 0;
    let userId = "";
    let startedKey = "";
    let activityKey = "";

    async function expire(reason: "idle" | "maximum") {
      if (stopped) return;
      stopped = true;
      if (startedKey) localStorage.removeItem(startedKey);
      if (activityKey) localStorage.removeItem(activityKey);
      await client.auth.signOut({ scope:"local" });
      window.location.replace(`/login?session=${reason}`);
    }

    function recordActivity() {
      const now = Date.now();
      if (!activityKey || now-lastActivityWrite < 15_000) return;
      lastActivityWrite = now;
      localStorage.setItem(activityKey, String(now));
      setRemaining(null);
    }

    function evaluate() {
      if (!startedKey || !activityKey || stopped) return;
      const now = Date.now();
      const startedAt = Number(localStorage.getItem(startedKey) || now);
      const lastActivity = Number(localStorage.getItem(activityKey) || now);
      const idleRemaining = idleMinutes*60_000-(now-lastActivity);
      const maximumRemaining = maximumHours*60*60_000-(now-startedAt);
      const nextRemaining = Math.min(idleRemaining, maximumRemaining);
      if (nextRemaining <= 0) { void expire(idleRemaining <= maximumRemaining ? "idle" : "maximum"); return; }
      setRemaining(nextRemaining <= warningMilliseconds ? nextRemaining : null);
    }

    async function initialize() {
      const { data } = await client.auth.getSession();
      if (!data.session) { window.location.replace("/login"); return; }
      userId = data.session.user.id;
      startedKey = `gavrion.session.started.${userId}`;
      activityKey = `gavrion.session.activity.${userId}`;
      const now = Date.now();
      const signedInAt = Date.parse(data.session.user.last_sign_in_at || "") || now;
      const storedStart = Number(localStorage.getItem(startedKey) || 0);
      if (!storedStart || storedStart < signedInAt-1_000) {
        localStorage.setItem(startedKey, String(signedInAt));
        localStorage.setItem(activityKey, String(now));
      } else if (!localStorage.getItem(activityKey)) localStorage.setItem(activityKey, String(now));
      evaluate();
    }

    const events: (keyof WindowEventMap)[] = ["mousedown","keydown","touchstart","scroll"];
    events.forEach(event => window.addEventListener(event, recordActivity, { passive:true }));
    const onVisibility = () => { if (!document.hidden) evaluate(); };
    const onStorage = (event:StorageEvent) => { if (event.key===activityKey||event.key===startedKey) evaluate(); };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("storage", onStorage);
    const timer = window.setInterval(evaluate, 15_000);
    void initialize();
    return () => {
      stopped=true;
      events.forEach(event => window.removeEventListener(event, recordActivity));
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("storage", onStorage);
      window.clearInterval(timer);
    };
  }, [pathname]);

  if (remaining===null) return null;
  const minutes=Math.max(1,Math.ceil(remaining/60_000));
  return <div className="session-warning" role="alert"><div><strong>Tu sesión está por cerrarse</strong><span>Se cerrará en aproximadamente {minutes} minuto{minutes===1?"":"s"} si no hay actividad.</span></div><button onClick={()=>{window.dispatchEvent(new Event("mousedown"));setRemaining(null)}}>Continuar sesión</button></div>;
}
