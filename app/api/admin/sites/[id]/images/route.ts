import { NextResponse } from "next/server";
import { requireSitePermission } from "@/lib/site-access";
import { reportServerError } from "@/lib/monitoring";

const allowed=new Map([["image/jpeg","jpg"],["image/png","png"],["image/webp","webp"],["image/gif","gif"]]);
const MAX_IMAGE_BYTES=5*1024*1024;

async function matchesSignature(file:File){
  const bytes=new Uint8Array(await file.slice(0,16).arrayBuffer());
  if(file.type==="image/jpeg")return bytes[0]===0xff&&bytes[1]===0xd8&&bytes[2]===0xff;
  if(file.type==="image/png")return bytes[0]===0x89&&bytes[1]===0x50&&bytes[2]===0x4e&&bytes[3]===0x47;
  if(file.type==="image/gif")return String.fromCharCode(...bytes.slice(0,6))==="GIF87a"||String.fromCharCode(...bytes.slice(0,6))==="GIF89a";
  if(file.type==="image/webp")return String.fromCharCode(...bytes.slice(0,4))==="RIFF"&&String.fromCharCode(...bytes.slice(8,12))==="WEBP";
  return false;
}

export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){
  const {id}=await params;
  const access=await requireSitePermission("sites.write",id);
  if(!access)return NextResponse.json({error:"No tienes permiso para cargar imágenes en este proyecto."},{status:403});
  const project=access.project;
  const form=await request.formData();const file=form.get("file");const kind=String(form.get("kind")||"image").replace(/[^a-z0-9-]/gi,"-").slice(0,32);
  if(!(file instanceof File))return NextResponse.json({error:"Selecciona una imagen."},{status:400});
  const extension=allowed.get(file.type);
  if(!extension)return NextResponse.json({error:"Formato no permitido. Utiliza JPG, PNG, WEBP o GIF."},{status:415});
  if(file.size>MAX_IMAGE_BYTES)return NextResponse.json({error:"La imagen supera el límite de 5 MB."},{status:413});
  if(file.size===0)return NextResponse.json({error:"La imagen está vacía."},{status:400});
  if(!(await matchesSignature(file)))return NextResponse.json({error:"El contenido de la imagen no coincide con su formato declarado."},{status:415});
  const objectPath=`${project.tenant_id}/${project.id}/${kind}-${crypto.randomUUID()}.${extension}`;
  let error;
  try { ({error}=await access.admin.storage.from("site-assets").upload(objectPath,await file.arrayBuffer(),{contentType:file.type,cacheControl:"31536000",upsert:false})); }
  catch(cause){ reportServerError("site.image_upload",cause,{siteId:id,kind}); return NextResponse.json({error:"No se pudo almacenar la imagen."},{status:502}); }
  if(error)return NextResponse.json({error:/bucket/i.test(error.message)?"Falta ejecutar la migración 020_site_assets_storage.sql en Supabase.":error.message},{status:400});
  const {data}=access.admin.storage.from("site-assets").getPublicUrl(objectPath);
  return NextResponse.json({url:data.publicUrl,path:objectPath});
}
