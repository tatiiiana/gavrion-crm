import { NextResponse } from "next/server";
import { requirePlatformPermission } from "@/lib/platform-access";
import { cleanSiteSlug, sanitizeSiteConfig,siteConfigForTemplate } from "@/lib/site-builder";
import {getSiteTemplate} from "@/lib/site-templates/catalog";

export async function GET(){
  const access=await requirePlatformPermission("sites.read");
  if(!access)return NextResponse.json({error:"No tienes permiso para ver proyectos de sitios."},{status:403});
  let query=access.admin.from("site_projects").select("id,tenant_id,template_key,name,slug,status,configuration,created_at,updated_at").order("updated_at",{ascending:false});if(access.tenantIds)query=query.in("tenant_id",access.tenantIds.length?access.tenantIds:["00000000-0000-0000-0000-000000000000"]);
  const {data,error}=await query;
  if(error)return NextResponse.json({error:error.code==="42P01"?"Falta instalar la migración 019_site_builder.sql en Supabase.":error.message,code:error.code},{status:error.code==="42P01"?503:400});
  const tenantIds=[...new Set((data||[]).map(item=>item.tenant_id))];
  const tenants=tenantIds.length?(await access.admin.from("tenants").select("id,name,widget_key").in("id",tenantIds)).data||[]:[];
  const tenantMap=new Map(tenants.map(tenant=>[tenant.id,tenant]));
  return NextResponse.json((data||[]).map(item=>({...item,tenant:tenantMap.get(item.tenant_id)||null})));
}

export async function POST(request:Request){
  const body=await request.json();const tenantId=String(body.tenantId||"");const templateKey=String(body.templateKey||"gastronomia-a");
  const access=await requirePlatformPermission("sites.write",tenantId);
  if(!access)return NextResponse.json({error:"No tienes permiso para crear sitios para esta empresa."},{status:403});
  if(!tenantId||!getSiteTemplate(templateKey))return NextResponse.json({error:"Empresa o plantilla inválida."},{status:400});
  const {data:tenant}=await access.admin.from("tenants").select("id,name,slug,widget_key").eq("id",tenantId).maybeSingle();
  if(!tenant)return NextResponse.json({error:"La empresa no existe."},{status:404});
  const existing=await access.admin.from("site_projects").select("*").eq("tenant_id",tenantId).eq("template_key",templateKey).maybeSingle();
  if(existing.data)return NextResponse.json(existing.data);
  const configuration=sanitizeSiteConfig({...siteConfigForTemplate(templateKey,tenant.name),integrations:{...siteConfigForTemplate(templateKey,tenant.name).integrations,tenantKey:tenant.widget_key||"",useRealChatbox:Boolean(tenant.widget_key)}});
  const {data,error}=await access.admin.from("site_projects").insert({tenant_id:tenantId,template_key:templateKey,name:`Sitio de ${tenant.name}`,slug:cleanSiteSlug(tenant.slug||tenant.name),configuration,created_by:access.user.id}).select().single();
  return error?NextResponse.json({error:error.message},{status:400}):NextResponse.json(data,{status:201});
}

export async function PATCH(request:Request){
  const body=await request.json();const id=String(body.id||"");const status=String(body.status||"draft");
  if(!id||!["draft","review","ready","exported"].includes(status))return NextResponse.json({error:"Datos inválidos."},{status:400});
  const lookupAdmin=(await requirePlatformPermission("sites.read"))?.admin;if(!lookupAdmin)return NextResponse.json({error:"Acceso denegado."},{status:403});const project=await lookupAdmin.from("site_projects").select("tenant_id").eq("id",id).maybeSingle();if(!project.data)return NextResponse.json({error:"Proyecto inexistente."},{status:404});const access=await requirePlatformPermission("sites.write",project.data.tenant_id);if(!access)return NextResponse.json({error:"No tienes permiso para editar este proyecto."},{status:403});
  const configuration=sanitizeSiteConfig(body.configuration);
  const current=await access.admin.from("site_project_versions").select("version").eq("site_project_id",id).order("version",{ascending:false}).limit(1).maybeSingle();
  const version=(current.data?.version||0)+1;
  const {data,error}=await access.admin.from("site_projects").update({configuration,status,name:String(body.name||"Sitio").trim().slice(0,120)}).eq("id",id).select().single();
  if(error)return NextResponse.json({error:error.message},{status:400});
  await access.admin.from("site_project_versions").insert({site_project_id:id,version,configuration,created_by:access.user.id});
  return NextResponse.json({...data,version});
}
