import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { requirePlatformAdmin } from "@/lib/platform-admin";
import { sanitizeSiteConfig } from "@/lib/site-builder";

function crc32(input:Buffer){let crc=0xffffffff;for(const byte of input){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0)}return (crc^0xffffffff)>>>0}
function zip(files:{name:string;content:Buffer}[]){const locals:Buffer[]=[];const centrals:Buffer[]=[];let offset=0;for(const file of files){const name=Buffer.from(file.name.replace(/\\/g,"/"));const crc=crc32(file.content);const local=Buffer.alloc(30);local.writeUInt32LE(0x04034b50,0);local.writeUInt16LE(20,4);local.writeUInt16LE(0,6);local.writeUInt16LE(0,8);local.writeUInt32LE(crc,14);local.writeUInt32LE(file.content.length,18);local.writeUInt32LE(file.content.length,22);local.writeUInt16LE(name.length,26);locals.push(local,name,file.content);const central=Buffer.alloc(46);central.writeUInt32LE(0x02014b50,0);central.writeUInt16LE(20,4);central.writeUInt16LE(20,6);central.writeUInt32LE(crc,16);central.writeUInt32LE(file.content.length,20);central.writeUInt32LE(file.content.length,24);central.writeUInt16LE(name.length,28);central.writeUInt32LE(offset,42);centrals.push(central,name);offset+=local.length+name.length+file.content.length}const centralSize=centrals.reduce((sum,item)=>sum+item.length,0);const end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(files.length,8);end.writeUInt16LE(files.length,10);end.writeUInt32LE(centralSize,12);end.writeUInt32LE(offset,16);return Buffer.concat([...locals,...centrals,end])}

export async function GET(_:Request,{params}:{params:Promise<{id:string}>}){
  const access=await requirePlatformAdmin();
  if(!access)return NextResponse.json({error:"Acceso exclusivo para Superadministradores."},{status:403});
  const {id}=await params;
  const {data,error}=await access.admin.from("site_projects").select("id,name,slug,configuration").eq("id",id).maybeSingle();
  if(error||!data)return NextResponse.json({error:error?.message||"El proyecto no existe."},{status:404});
  const source=path.join(process.cwd(),"public","templates","gastronomia-a");
  try{
    const [html,css,app]=await Promise.all([readFile(path.join(source,"index.html")),readFile(path.join(source,"styles.css")),readFile(path.join(source,"app.js"))]);
    const config=sanitizeSiteConfig(data.configuration);
    const readme=`# ${data.name}\n\nSitio independiente generado por Gavrion.\n\n## Publicación\n\n1. Sube esta carpeta a un repositorio del cliente.\n2. Importa el repositorio en Vercel.\n3. Verifica en site-config.js la URL del CRM y el identificador del chatbox.\n4. El CRM y Supabase deben pertenecer al cliente antes de la entrega final.\n`;
    const bundle=zip([{name:"index.html",content:html},{name:"styles.css",content:css},{name:"app.js",content:app},{name:"site-config.js",content:Buffer.from(`window.GAVRION_SITE = ${JSON.stringify(config,null,2)};\n`)},{name:"vercel.json",content:Buffer.from(JSON.stringify({cleanUrls:true,trailingSlash:false},null,2))},{name:"README.md",content:Buffer.from(readme)}]);
    await access.admin.from("site_projects").update({status:"exported"}).eq("id",id);
    return new Response(new Uint8Array(bundle),{headers:{"Content-Type":"application/zip","Content-Disposition":`attachment; filename=\"${data.slug||"sitio-gastronomico"}.zip\"`,"Cache-Control":"no-store"}});
  }catch(cause){return NextResponse.json({error:cause instanceof Error?cause.message:"No se pudo generar el proyecto."},{status:500})}
}
