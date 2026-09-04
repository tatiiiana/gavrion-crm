import { NextResponse } from "next/server";
import { requireSitePermission } from "@/lib/site-access";

const allowed=new Map([["image/jpeg","jpg"],["image/png","png"],["image/webp","webp"],["image/gif","gif"]]);

export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){
  const {id}=await params;
  const access=await requireSitePermission("sites.write",id);
  if(!access)return NextResponse.json({error:"No tienes permiso para cargar imágenes en este proyecto."},{status:403});
  const project=access.project;
  const form=await request.formData();const file=form.get("file");const kind=String(form.get("kind")||"image").replace(/[^a-z0-9-]/gi,"-").slice(0,32);
  if(!(file instanceof File))return NextResponse.json({error:"Selecciona una imagen."},{status:400});
  const extension=allowed.get(file.type);
  if(!extension)return NextResponse.json({error:"Formato no permitido. Utiliza JPG, PNG, WEBP o GIF."},{status:415});
  if(file.size>5*1024*1024)return NextResponse.json({error:"La imagen supera el límite de 5 MB."},{status:413});
  if(file.size===0)return NextResponse.json({error:"La imagen está vacía."},{status:400});
  const objectPath=`${project.tenant_id}/${project.id}/${kind}-${crypto.randomUUID()}.${extension}`;
  const {error}=await access.admin.storage.from("site-assets").upload(objectPath,await file.arrayBuffer(),{contentType:file.type,cacheControl:"31536000",upsert:false});
  if(error)return NextResponse.json({error:/bucket/i.test(error.message)?"Falta ejecutar la migración 020_site_assets_storage.sql en Supabase.":error.message},{status:400});
  const {data}=access.admin.storage.from("site-assets").getPublicUrl(objectPath);
  return NextResponse.json({url:data.publicUrl,path:objectPath});
}
