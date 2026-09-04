import { NextResponse } from "next/server";
import { requirePlatformAdmin } from "@/lib/platform-admin";
import { sanitizeSiteConfig,validateSiteForPublication } from "@/lib/site-builder";

export async function GET(_:Request,{params}:{params:Promise<{id:string}>}){const access=await requirePlatformAdmin();if(!access)return NextResponse.json({error:"Acceso denegado."},{status:403});const {id}=await params;const {data,error}=await access.admin.from("site_projects").select("configuration").eq("id",id).maybeSingle();if(error||!data)return NextResponse.json({error:error?.message||"El proyecto no existe."},{status:404});return NextResponse.json(validateSiteForPublication(sanitizeSiteConfig(data.configuration)))}
