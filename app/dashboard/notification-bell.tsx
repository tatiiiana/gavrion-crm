"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { NotificationList, type OwnerNotification } from "./owner-center";

const POLL_MS = 60_000;

/** Campana del encabezado: muestra alertas sin leer del dueño/administrador y avisa por el navegador. */
export function NotificationBell({ onOpen, onSeeAll, refreshKey = 0 }: { onOpen: (item: OwnerNotification) => void; onSeeAll: () => void; refreshKey?: number }) {
  const [unread, setUnread] = useState(0);
  const [items, setItems] = useState<OwnerNotification[]>([]);
  const [open, setOpen] = useState(false);
  const seen = useRef<Set<string> | null>(null);
  const wrapper = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/owner/center?summary=1", { cache: "no-store" });
      if (!response.ok) return;
      const body = await response.json() as { unread: number; notifications: OwnerNotification[]; browser: boolean };
      setUnread(body.unread); setItems(body.notifications);
      // La primera carga solo registra lo existente; después se avisa únicamente lo nuevo.
      if (seen.current === null) { seen.current = new Set(body.notifications.map(item => item.id)); return; }
      const fresh = body.notifications.filter(item => !item.read_at && !seen.current!.has(item.id));
      fresh.forEach(item => seen.current!.add(item.id));
      if (fresh.length && body.browser && document.hidden && "Notification" in window && Notification.permission === "granted") {
        const first = fresh[0];
        new Notification(fresh.length > 1 ? `${fresh.length} alertas nuevas en Gavrion` : first.title, { body: fresh.length > 1 ? first.title : first.body, tag: "gavrion-owner" });
      }
    } catch { /* Sin conexión: se reintenta en el siguiente ciclo. */ }
  }, []);

  useEffect(() => { void load(); const timer = window.setInterval(load, POLL_MS); const onFocus = () => void load(); window.addEventListener("focus", onFocus); return () => { window.clearInterval(timer); window.removeEventListener("focus", onFocus); }; }, [load]);
  useEffect(() => { if (refreshKey) void load(); }, [refreshKey, load]);
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => { if (!wrapper.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", close); document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", escape); };
  }, [open]);

  async function markRead(id?: string) {
    await fetch("/api/owner/center", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "read", ...(id ? { id } : {}) }) }).catch(() => undefined);
    void load();
  }

  return <div className="notification-bell" ref={wrapper}>
    <button type="button" className="bell-button" aria-label={unread ? `${unread} notificaciones sin leer` : "Notificaciones"} aria-expanded={open} onClick={() => setOpen(value => !value)}>
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M12 22a2.5 2.5 0 0 0 2.45-2h-4.9A2.5 2.5 0 0 0 12 22Zm7-6V11a7 7 0 0 0-5.5-6.84V3.5a1.5 1.5 0 0 0-3 0v.66A7 7 0 0 0 5 11v5l-2 2v1h18v-1l-2-2Z" /></svg>
      {unread > 0 && <b>{unread > 99 ? "99+" : unread}</b>}
    </button>
    {open && <div className="bell-panel" role="dialog" aria-label="Notificaciones">
      <div className="bell-head"><strong>Notificaciones</strong>{unread > 0 && <button type="button" className="ghost-button" onClick={() => markRead()}>Marcar leídas</button>}</div>
      <NotificationList compact items={items} onOpen={item => { if (!item.read_at) void markRead(item.id); setOpen(false); onOpen(item); }} />
      <button type="button" className="bell-all" onClick={() => { setOpen(false); onSeeAll(); }}>Ver centro de control →</button>
    </div>}
  </div>;
}
