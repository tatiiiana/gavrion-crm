import { NextResponse } from "next/server";
import { createAdminSupabase } from "@/lib/supabase/admin";

// Catálogo público mínimo: nunca devuelve contactos, notas, dirección privada ni credenciales.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ tenantKey: string }> },
) {
  const tenantKey = decodeURIComponent((await params).tenantKey || "").trim();
  if (!tenantKey) return NextResponse.json({ error: "Identificador inválido." }, { status: 400 });
  try {
    const admin = createAdminSupabase();
    const { data: tenant, error: tenantError } = await admin
      .from("tenants")
      .select("id,implementation_status")
      .eq("widget_key", tenantKey)
      .maybeSingle();
    if (tenantError) return NextResponse.json({ error: tenantError.message }, { status: 500 });
    if (!tenant || !["ready", "production"].includes(String(tenant.implementation_status))) {
      return NextResponse.json({ error: "Catálogo no disponible." }, { status: 404 });
    }
    const { data, error } = await admin
      .from("properties")
      .select("id,reference,title,property_type,operation,price,currency,city,zone,bedrooms,bathrooms,area_sqm,description,image_url,status,updated_at")
      .eq("tenant_id", tenant.id)
      .in("status", ["available", "reserved"])
      .order("updated_at", { ascending: false });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    const response = NextResponse.json({ properties: (data || []).map((item) => ({
      id: item.id,
      reference: item.reference,
      title: item.title,
      location: [item.city, item.zone].filter(Boolean).join(" · "),
      operation: item.operation === "rent" ? "alquiler" : "venta",
      status: item.status === "reserved" ? "Reservada" : "Disponible",
      price: Number(item.price || 0),
      currency: item.currency || "HNL",
      bedrooms: item.bedrooms ?? 0,
      bathrooms: item.bathrooms ?? 0,
      area: item.area_sqm ?? 0,
      imageUrl: item.image_url || "",
      description: item.description || "",
      propertyType: item.property_type,
    })) });
    response.headers.set("Cache-Control", "no-store, max-age=0");
    response.headers.set("Access-Control-Allow-Origin", "*");
    return response;
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo cargar el catálogo." }, { status: 500 });
  }
}
