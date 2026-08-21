import { NextResponse, type NextRequest } from "next/server";

export async function middleware(request: NextRequest) {
  // La sesión se valida en el cliente que la creó. Las operaciones de datos
  // continúan protegidas por Supabase Auth y las políticas RLS.
  return NextResponse.next({ request });
}

export const config = { matcher: ["/dashboard/:path*", "/login"] };
