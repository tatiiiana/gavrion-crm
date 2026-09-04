import { NextResponse } from "next/server";
import { requirePlatformAdmin } from "@/lib/platform-admin";
import { cleanSiteSlug, gastronomyDefaultConfig, sanitizeSiteConfig } from "@/lib/site-builder";

export async function GET(){
  const access=await requirePlatformAdmin();
  if(!access)return NextResponse.json({error:"Acceso exclusivo para Superadministradores."},{status:403});
  const {data,error}=await access.admin.from("site_projects").select("id,tenant_id,template_key,name,slug,status,configuration,created_at,updated_at").order("updated_at",{ascending:false});
  if(error)return NextResponse.json({error:error.message},{status:400});
  const tenantIds=[...new Set((data||[]).map(item=>item.tenant_id))];
  const tenants=tenantIds.length?(await access.admin.from("tenants").select("id,name,widget_key").in("id",tenantIds)).data||[]:[];
  const tenantMap=new Map(tenants.map(tenant=>[tenant.id,tenant]));
  return NextResponse.json((data||[]).map(item=>({...item,tenant:tenantMap.get(item.tenant_id)||null})));
}

export async function POST(request:Request){
  const access=await requirePlatformAdmin();
  if(!access)return NextResponse.json({error:"Acceso exclusivo para Superadministradores."},{status:403});
  const body=await request.json();const tenantId=String(body.tenantId||"");const templateKey=String(body.templateKey||"gastronomia-a");
  if(!tenantId||templateKey!=="gastronomia-a")return NextResponse.json({error:"Empresa o plantilla inválida."},{status:400});
  const {data:tenant}=await access.admin.from("tenants").select("id,name,slug,widget_key").eq("id",tenantId).maybeSingle();
  if(!tenant)return NextResponse.json({error:"La empresa no existe."},{status:404});
  const existing=await access.admin.from("site_projects").select("*").eq("tenant_id",tenantId).eq("template_key",templateKey).maybeSingle();
  if(existing.data)return NextResponse.json(existing.data);
  const configuration=sanitizeSiteConfig({...gastronomyDefaultConfig,brand:{...gastronomyDefaultConfig.brand,name:tenant.name,shortName:String(tenant.name).split(/\s+/).map((x:string)=>x[0]).join("").slice(0,3).toUpperCase()},seo:{...gastronomyDefaultConfig.seo,title:`${tenant.name} | Restaurante`},integrations:{...gastronomyDefaultConfig.integrations,tenantKey:tenant.widget_key||"",useRealChatbox:Boolean(tenant.widget_key)}});
  const {data,error}=await access.admin.from("site_projects").insert({tenant_id:tenantId,template_key:templateKey,name:`Sitio de ${tenant.name}`,slug:cleanSiteSlug(tenant.slug||tenant.name),configuration,created_by:access.user.id}).select().single();
  return error?NextResponse.json({error:error.message},{status:400}):NextResponse.json(data,{status:201});
}

export async function PATCH(request:Request){
  const access=await requirePlatformAdmin();
  if(!access)return NextResponse.json({error:"Acceso exclusivo para Superadministradores."},{status:403});
  const body=await request.json();const id=String(body.id||"");const status=String(body.status||"draft");
  if(!id||!["draft","review","ready","exported"].includes(status))return NextResponse.json({error:"Datos inválidos."},{status:400});
  const configuration=sanitizeSiteConfig(body.configuration);
  const current=await access.admin.from("site_project_versions").select("version").eq("site_project_id",id).order("version",{ascending:false}).limit(1).maybeSingle();
  const version=(current.data?.version||0)+1;
  const {data,error}=await access.admin.from("site_projects").update({configuration,status,name:String(body.name||"Sitio").trim().slice(0,120)}).eq("id",id).select().single();
  if(error)return NextResponse.json({error:error.message},{status:400});
  await access.admin.from("site_project_versions").insert({site_project_id:id,version,configuration,created_by:access.user.id});
  return NextResponse.json({...data,version});
}
