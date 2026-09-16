import {NextResponse} from "next/server";
import {requireSitePermission} from "@/lib/site-access";
import {sanitizeSiteConfig} from "@/lib/site-builder";

const reviewerRoles=["superadmin","implementer"];

export async function GET(_:Request,{params}:{params:Promise<{id:string}>}){
  const {id}=await params;
  const access=await requireSitePermission("sites.read",id);
  if(!access)return NextResponse.json({error:"Acceso denegado."},{status:403});
  const [{data:project,error:projectError},{data:versions,error:versionsError}]=await Promise.all([
    access.admin.from("site_projects").select("id,tenant_id,template_key,name,slug,status,configuration,review_note,reviewed_by,reviewed_at,created_at,updated_at").eq("id",id).maybeSingle(),
    access.admin.from("site_project_versions").select("id,version,configuration,created_at,created_by").eq("site_project_id",id).order("version",{ascending:false}).limit(30)
  ]);
  if(projectError)return NextResponse.json({error:projectError.code==="42703"?"Aplica la migración 025_site_review_workflow.sql en Supabase.":projectError.message},{status:400});
  if(!project)return NextResponse.json({error:"El proyecto no existe."},{status:404});
  if(versionsError)return NextResponse.json({error:versionsError.message},{status:400});
  const {data:tenant}=await access.admin.from("tenants").select("id,name").eq("id",project.tenant_id).maybeSingle();
  return NextResponse.json({project:{...project,configuration:sanitizeSiteConfig(project.configuration),tenant},versions:(versions||[]).map(version=>({...version,configuration:sanitizeSiteConfig(version.configuration)})),canReview:reviewerRoles.includes(access.role)});
}

export async function PATCH(request:Request,{params}:{params:Promise<{id:string}>}){
  const {id}=await params;
  const access=await requireSitePermission("sites.write",id);
  if(!access||!reviewerRoles.includes(access.role))return NextResponse.json({error:"Solo un superadmin o implementador puede aprobar sitios."},{status:403});
  const body=await request.json();
  const action=String(body.action||"");
  const reviewNote=String(body.reviewNote||"").trim().slice(0,1000);
  if(!["approve","reject"].includes(action))return NextResponse.json({error:"Acción de revisión inválida."},{status:400});
  if(action==="reject"&&!reviewNote)return NextResponse.json({error:"Escribe una observación para devolver el sitio al vendedor."},{status:400});
  const {data:current,error:currentError}=await access.admin.from("site_projects").select("status").eq("id",id).maybeSingle();
  if(currentError)return NextResponse.json({error:currentError.message},{status:400});
  if(!current)return NextResponse.json({error:"El proyecto no existe."},{status:404});
  if(current.status!=="review")return NextResponse.json({error:"El sitio solo puede aprobarse o devolverse cuando está en revisión."},{status:409});
  const status=action==="approve"?"ready":"draft";
  const {data,error}=await access.admin.from("site_projects").update({status,review_note:action==="approve"?null:reviewNote,reviewed_by:access.user.id,reviewed_at:new Date().toISOString()}).eq("id",id).select("id,status,review_note,reviewed_by,reviewed_at,updated_at").single();
  if(error)return NextResponse.json({error:error.code==="42703"?"Aplica la migración 025_site_review_workflow.sql en Supabase.":error.message},{status:400});
  return NextResponse.json(data);
}
