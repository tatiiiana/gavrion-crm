"use client";

import { FormEvent, useEffect, useRef, useState } from "react";

type Connection = { id:string; provider:string; external_account_id:string; status:string; settings:{display_name?:string} };
type EmbeddedSession = { wabaId:string; phoneNumberId:string; businessId:string };
type FacebookLoginResponse = { authResponse?:{code?:string}; status?:string };
declare global { interface Window { FB?: { init:(options:Record<string,unknown>)=>void; login:(callback:(response:FacebookLoginResponse)=>void,options:Record<string,unknown>)=>void } } }
const labels:Record<string,string> = { whatsapp:"WhatsApp", facebook:"Facebook Messenger", instagram:"Instagram" };

async function readJson(response:Response) {
  const contentType=response.headers.get("content-type")||"";
  if(!contentType.includes("application/json")) throw new Error(response.status===404
    ? "Las rutas de Meta todavía no están publicadas en Vercel. Sube la carpeta app/api/meta completa y vuelve a desplegar."
    : `El servidor respondió con un formato inesperado (${response.status}).`);
  return response.json();
}

export function MetaConnections(){
  const[connections,setConnections]=useState<Connection[]>([]);
  const[showWhatsapp,setShowWhatsapp]=useState(false);
  const[embeddedReady,setEmbeddedReady]=useState(false);
  const[connectingWhatsapp,setConnectingWhatsapp]=useState(false);
  const embeddedSession=useRef<EmbeddedSession|null>(null);
  const[form,setForm]=useState({displayName:"",phoneNumberId:"",businessAccountId:"",accessToken:""});
  const[message,setMessage]=useState("");
  const[messageType,setMessageType]=useState<"success"|"error">("error");
  const[loading,setLoading]=useState(false);
  const[connectingMeta,setConnectingMeta]=useState(false);

  async function load(){
    try{
      const response=await fetch("/api/meta/connections",{cache:"no-store"});
      const body=await readJson(response);
      if(!response.ok)throw new Error(body.error||"No fue posible cargar las conexiones.");
      setConnections(Array.isArray(body)?body:[]);
    }catch(error){setMessageType("error");setMessage(error instanceof Error?error.message:"No fue posible cargar las conexiones.");}
  }
  useEffect(()=>{load();},[]);
  useEffect(()=>{
    function sessionInfo(event:MessageEvent){
      if(!["https://www.facebook.com","https://web.facebook.com"].includes(event.origin))return;
      let payload=event.data;
      try{if(typeof payload==="string")payload=JSON.parse(payload);}catch{return;}
      if(payload?.type!=="WA_EMBEDDED_SIGNUP")return;
      if(payload.event==="FINISH")embeddedSession.current={wabaId:String(payload.data?.waba_id||""),phoneNumberId:String(payload.data?.phone_number_id||""),businessId:String(payload.data?.business_id||"")};
      if(payload.event==="CANCEL")setConnectingWhatsapp(false);
    }
    window.addEventListener("message",sessionInfo);
    return()=>window.removeEventListener("message",sessionInfo);
  },[]);
  useEffect(()=>{
    const params=new URLSearchParams(window.location.search);const status=params.get("meta");
    if(!status)return;
    if(status==="connected"){setMessageType("success");setMessage("Facebook Messenger quedó conectado y suscrito correctamente.");load();}
    else{setMessageType("error");setMessage(`Meta no pudo completar la conexión: ${status}`);}
    params.delete("meta");params.delete("view");
    window.history.replaceState({},"",`${window.location.pathname}${params.size?`?${params.toString()}`:""}`);
  },[]);

  async function connectMeta(){
    setConnectingMeta(true);setMessage("");
    try{
      const response=await fetch("/api/meta/connect?mode=json",{headers:{Accept:"application/json"},cache:"no-store"});
      const body=await readJson(response);
      if(!response.ok||!body.url)throw new Error(body.error||"No fue posible iniciar la conexión con Meta.");
      window.location.assign(body.url);
    }catch(error){setMessageType("error");setMessage(error instanceof Error?error.message:"No fue posible iniciar la conexión con Meta.");setConnectingMeta(false);}
  }

  async function waitForEmbeddedSession(){
    for(let attempt=0;attempt<25;attempt++){if(embeddedSession.current?.wabaId)return embeddedSession.current;await new Promise(resolve=>setTimeout(resolve,200));}
    return embeddedSession.current;
  }

  async function connectWhatsapp(){
    setConnectingWhatsapp(true);setMessage("");embeddedSession.current=null;
    try{
      const configResponse=await fetch("/api/meta/embedded-signup/config",{cache:"no-store"});
      const config=await readJson(configResponse);if(!configResponse.ok)throw new Error(config.error||"No se pudo preparar Meta.");
      if(!document.querySelector("script[data-meta-sdk]")){
        await new Promise<void>((resolve,reject)=>{const script=document.createElement("script");script.src="https://connect.facebook.net/es_LA/sdk.js";script.async=true;script.defer=true;script.dataset.metaSdk="true";script.onload=()=>resolve();script.onerror=()=>reject(new Error("No se pudo cargar el acceso de Meta"));document.body.appendChild(script);});
      }
      if(!window.FB)throw new Error("Meta no inicializó el acceso. Desactiva el bloqueo de ventanas y vuelve a intentarlo.");
      window.FB.init({appId:config.appId,cookie:true,xfbml:false,version:config.graphVersion});setEmbeddedReady(true);
      let callbackFinished=false;
      const timeout=window.setTimeout(()=>{if(!callbackFinished){setConnectingWhatsapp(false);setMessageType("error");setMessage("Meta no abrió la ventana de autorización. Permite las ventanas emergentes para gavrion-crm.vercel.app y vuelve a intentarlo.");}},45000);
      window.FB.login(async response=>{
        try{
          const code=response.authResponse?.code;if(!code)throw new Error("La autorización fue cancelada o Meta no devolvió el código.");
          const session=await waitForEmbeddedSession();if(!session?.wabaId)throw new Error("Meta no devolvió la cuenta de WhatsApp seleccionada.");
          const completed=await fetch("/api/meta/embedded-signup/complete",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({code,wabaId:session.wabaId,phoneNumberId:session.phoneNumberId,businessId:session.businessId})});
          const result=await readJson(completed);if(!completed.ok)throw new Error(result.error||"No se pudo guardar la conexión.");
          setMessageType("success");setMessage("WhatsApp quedó conectado, verificado y suscrito al webhook.");await load();
        }catch(error){setMessageType("error");setMessage(error instanceof Error?error.message:"No se pudo conectar WhatsApp.");}
        finally{callbackFinished=true;window.clearTimeout(timeout);setConnectingWhatsapp(false);}
      },{config_id:config.configId,response_type:"code",override_default_response_type:true,redirect_uri:`${window.location.origin}/dashboard`,extras:{setup:{}}});
    }catch(error){setMessageType("error");setMessage(error instanceof Error?error.message:"No se pudo conectar WhatsApp.");setConnectingWhatsapp(false);}
  }

  async function saveWhatsapp(event:FormEvent){
    event.preventDefault();setLoading(true);setMessage("");
    try{
      const response=await fetch("/api/meta/connections",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({provider:"whatsapp",...form})});
      const body=await readJson(response);
      if(!response.ok)throw new Error(body.error||"No fue posible conectar WhatsApp.");
      setMessageType("success");setMessage("WhatsApp conectado correctamente.");setShowWhatsapp(false);
      setForm({displayName:"",phoneNumberId:"",businessAccountId:"",accessToken:""});await load();
    }catch(error){setMessageType("error");setMessage(error instanceof Error?error.message:"No fue posible conectar WhatsApp.");}
    finally{setLoading(false);}
  }

  async function disconnect(id:string){
    if(!confirm("¿Desconectar este canal?"))return;
    try{
      const response=await fetch(`/api/meta/connections?id=${id}`,{method:"DELETE"});const body=await readJson(response);
      if(!response.ok)throw new Error(body.error||"No fue posible desconectar el canal.");await load();
    }catch(error){setMessageType("error");setMessage(error instanceof Error?error.message:"No fue posible desconectar el canal.");}
  }

  return <article className="panel meta-connections">
    <div className="meta-connections-head">
      <div className="meta-heading"><span className="meta-symbol">M</span><div><p className="eyebrow">META EN PRODUCCIÓN</p><h3>Canales de mensajería</h3><p>Conecta las cuentas propias de esta empresa. Los tokens se cifran antes de guardarse y nunca se muestran nuevamente.</p></div></div>
      <div className="meta-connect-actions">
        <button type="button" className="primary-button" onClick={connectMeta} disabled={connectingMeta}>{connectingMeta?"Abriendo Meta…":"Conectar Facebook Messenger"}</button>
        <button type="button" className="secondary-button" onClick={connectWhatsapp} disabled={connectingWhatsapp}>{connectingWhatsapp?"Conectando WhatsApp…":"Conectar WhatsApp"}</button>
        <button type="button" className="ghost-button" onClick={()=>setShowWhatsapp(value=>!value)}>{showWhatsapp?"Cerrar conexión manual":"Conexión manual avanzada"}</button>
      </div>
    </div>
    {message&&<div className={`auth-message ${messageType}`}>{message}</div>}
    {embeddedReady&&connectingWhatsapp&&<div className="meta-progress">Completa la selección en la ventana segura de Meta.</div>}
    {showWhatsapp&&<form className="whatsapp-connect" onSubmit={saveWhatsapp}>
      <label><span>Nombre visible</span><input required value={form.displayName} onChange={event=>setForm(value=>({...value,displayName:event.target.value}))} placeholder="WhatsApp de la empresa"/></label>
      <label><span>Phone Number ID</span><input required inputMode="numeric" value={form.phoneNumberId} onChange={event=>setForm(value=>({...value,phoneNumberId:event.target.value}))} placeholder="Ej. 1270090499526634"/></label>
      <label><span>WhatsApp Business Account ID</span><input inputMode="numeric" value={form.businessAccountId} onChange={event=>setForm(value=>({...value,businessAccountId:event.target.value}))} placeholder="Ej. 3540045776153616"/></label>
      <label><span>Token permanente</span><input required type="password" autoComplete="new-password" value={form.accessToken} onChange={event=>setForm(value=>({...value,accessToken:event.target.value}))} placeholder="••••••••••••••••"/><small>Se cifrará al guardar.</small></label>
      <div className="whatsapp-actions"><button className="primary-button" disabled={loading}>{loading?"Conectando…":"Guardar conexión"}</button><button type="button" className="ghost-button" onClick={()=>setShowWhatsapp(false)}>Cancelar</button></div>
    </form>}
    <div className="connection-list">{connections.length?connections.map(item=><div className="connection-row" key={item.id}>
      <span className={`channel-logo ${item.provider}`}>{item.provider==="whatsapp"?"W":item.provider==="instagram"?"◎":"f"}</span>
      <div><strong>{item.settings?.display_name||labels[item.provider]}</strong><small>{labels[item.provider]} · {item.external_account_id}</small></div>
      <span className="connection-active">Conectado</span><button className="danger-button" onClick={()=>disconnect(item.id)}>Desconectar</button>
    </div>):<div className="meta-empty"><span>↗</span><strong>Sin canales conectados</strong><p>Conecta Facebook, Instagram o WhatsApp para recibir sus mensajes en la bandeja unificada.</p></div>}</div>
    <div className="meta-webhook"><span>Webhook</span><code>{typeof window==="undefined"?"":`${window.location.origin}/api/webhooks/meta`}</code><small>Verificado en Meta · suscribe los eventos de mensajes antes de publicar.</small></div>
  </article>;
}
