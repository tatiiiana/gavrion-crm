"use client";

import { useEffect } from "react";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    void fetch("/api/monitoring/errors", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ route: window.location.pathname, message: error.message, stack: error.stack }) }).catch(() => undefined);
  }, [error]);
  return <html><body style={{ fontFamily: "system-ui", margin: 0, padding: 32, background: "#f7f8fc", color: "#20244c" }}><main><h1>Algo salió mal</h1><p>El error fue registrado. Puedes intentar cargar la pantalla nuevamente.</p><button onClick={() => reset()} style={{ padding: "10px 16px", borderRadius: 8, border: 0, background: "#514bb7", color: "white", cursor: "pointer" }}>Intentar de nuevo</button></main></body></html>;
}
