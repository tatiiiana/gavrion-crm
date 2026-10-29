import { NextResponse } from "next/server";
import { requirePlatformPermission } from "@/lib/platform-access";
import { cleanSiteSlug, sanitizeSiteConfig,siteConfigForTemplate } from "@/lib/site-builder";
import {getSiteTemplate} from "@/lib/site-templates/catalog";

function compatibleBusinessType(value:string){
  return value === "gastronomy" ? "restaurant" : value;
}

export async function GET(){
  const access=await requirePlatformPermission("sites.read");
  if(!access)return NextResponse.json({error:"No tienes permiso para ver proyectos de sitios."},{status:403});
  let query=access.admin.from("site_projects").select("id,tenant_id,template_key,name,slug,status,configuration,published_url,custom_domain,domain_status,deployment_status,deployment_error,vercel_project_id,vercel_deployment_id,published_version,published_at,created_at,updated_at").is("archived_at",null).order("updated_at",{ascending:false});if(access.tenantIds)query=query.in("tenant_id",access.tenantIds.length?access.tenantIds:["00000000-0000-0000-0000-000000000000"]);
  const {data,error}=await query;
  if(error){const missingOneSiteColumn=error.code==="42703"&&/archived_at/i.test(error.message);return NextResponse.json({error:error.code==="42P01"?"Falta instalar la migración 019_site_builder.sql en Supabase.":missingOneSiteColumn?"Falta instalar la migración 027_one_site_per_company.sql en Supabase.":error.message,code:error.code},{status:error.code==="42P01"||missingOneSiteColumn?503:400})}
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
  const {data:tenant}=await access.admin.from("tenants").select("id,name,slug,widget_key,template_key,implementation_template_id").eq("id",tenantId).maybeSingle();
  if(!tenant)return NextResponse.json({error:"La empresa no existe."},{status:404});
  const {data:crmTemplate}=tenant.implementation_template_id
    ? await access.admin.from("implementation_templates").select("business_type").eq("id",tenant.implementation_template_id).maybeSingle()
    : {data:null};
  const tenantBusiness=compatibleBusinessType(String(crmTemplate?.business_type || tenant.template_key || "generic"));
  const siteBusiness=compatibleBusinessType(String(getSiteTemplate(templateKey)?.businessType || "generic"));
  if(tenantBusiness !== "generic" && siteBusiness !== tenantBusiness){
    return NextResponse.json({error:"La plantilla del sitio no corresponde al rubro configurado para esta empresa."},{status:409});
  }
  const existing=await access.admin.from("site_projects").select("*").eq("tenant_id",tenantId).is("archived_at",null).order("updated_at",{ascending:false}).limit(1).maybeSingle();
  if(existing.error)return NextResponse.json({error:existing.error.message},{status:400});
  if(existing.data?.template_key===templateKey)return NextResponse.json(existing.data);
  const configuration=sanitizeSiteConfig({...siteConfigForTemplate(templateKey,tenant.name),integrations:{...siteConfigForTemplate(templateKey,tenant.name).integrations,tenantKey:tenant.widget_key||"",useRealChatbox:Boolean(tenant.widget_key)}});
  if(existing.data){
    const current=await access.admin.from("site_project_versions").select("version").eq("site_project_id",existing.data.id).order("version",{ascending:false}).limit(1).maybeSingle();
    const version=(current.data?.version||0)+1;
    const {error:versionError}=await access.admin.from("site_project_versions").insert({site_project_id:existing.data.id,version,configuration:existing.data.configuration,created_by:access.user.id});
    if(versionError)return NextResponse.json({error:versionError.message},{status:400});
    const {data,error}=await access.admin.from("site_projects").update({template_key:templateKey,configuration,status:"draft",name:`Sitio de ${tenant.name}`,slug:cleanSiteSlug(tenant.slug||tenant.name)}).eq("id",existing.data.id).select().single();
    return error?NextResponse.json({error:error.message},{status:400}):NextResponse.json({...data,templateChanged:true});
  }
  const {data,error}=await access.admin.from("site_projects").insert({tenant_id:tenantId,template_key:templateKey,name:`Sitio de ${tenant.name}`,slug:cleanSiteSlug(tenant.slug||tenant.name),configuration,created_by:access.user.id}).select().single();
  return error?NextResponse.json({error:error.message},{status:400}):NextResponse.json(data,{status:201});
}

export async function PATCH(request:Request){
  const body=await request.json();const id=String(body.id||"");const status=String(body.status||"draft");
  if(!id||!["draft","review","ready","exported","published"].includes(status))return NextResponse.json({error:"Datos inválidos."},{status:400});
  const lookupAdmin=(await requirePlatformPermission("sites.read"))?.admin;if(!lookupAdmin)return NextResponse.json({error:"Acceso denegado."},{status:403});const project=await lookupAdmin.from("site_projects").select("tenant_id").eq("id",id).maybeSingle();if(!project.data)return NextResponse.json({error:"Proyecto inexistente."},{status:404});const access=await requirePlatformPermission("sites.write",project.data.tenant_id);if(!access)return NextResponse.json({error:"No tienes permiso para editar este proyecto."},{status:403});
  if(status==="ready"&&!(["superadmin","implementer"] as string[]).includes(access.role))return NextResponse.json({error:"El vendedor debe enviar el sitio a revisión; la aprobación corresponde al Superadmin o Implementador."},{status:403});
  const configuration=sanitizeSiteConfig(body.configuration);
  const current=await access.admin.from("site_project_versions").select("version").eq("site_project_id",id).order("version",{ascending:false}).limit(1).maybeSingle();
  const version=(current.data?.version||0)+1;
  const {data,error}=await access.admin.from("site_projects").update({configuration,status,name:String(body.name||"Sitio").trim().slice(0,120)}).eq("id",id).select().single();
  if(error)return NextResponse.json({error:error.message},{status:400});
  await access.admin.from("site_project_versions").insert({site_project_id:id,version,configuration,created_by:access.user.id});
  return NextResponse.json({...data,version});
}
