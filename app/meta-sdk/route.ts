export async function GET() {
  const upstream = await fetch("https://connect.facebook.net/es_LA/sdk.js", { cache: "no-store" });
  if (!upstream.ok) return new Response("No se pudo cargar el SDK de Meta", { status: 502 });
  const body = await upstream.text();
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      "Cache-Control": "public, max-age=300",
    },
  });
}
