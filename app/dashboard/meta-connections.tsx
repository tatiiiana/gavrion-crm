"use client";

import { FormEvent, useEffect, useState } from "react";

type Connection = { id:string; provider:string; external_account_id:string; status:string; settings:{display_name?:string} };
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

  async function connectMeta(){
    setConnectingMeta(true);setMessage("");
    try{
      const response=await fetch("/api/meta/connect?mode=json",{headers:{Accept:"application/json"},cache:"no-store"});
      const body=await readJson(response);
      if(!response.ok||!body.url)throw new Error(body.error||"No fue posible iniciar la conexión con Meta.");
      window.location.assign(body.url);
    }catch(error){setMessageType("error");setMessage(error instanceof Error?error.message:"No fue posible iniciar la conexión con Meta.");setConnectingMeta(false);}
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
      <div className="meta-heading"><span className="meta-symbol">M</span><div><p className="eyebrow">META EN PRODUCCIÓN</p><h3>Canales de mensajería</h3><p>Conecta las cuentas propias de esta empresa. Las credenciales permanecen protegidas en el servidor.</p></div></div>
      <div className="meta-connect-actions">
        <button type="button" className="primary-button" onClick={connectMeta} disabled={connectingMeta}>{connectingMeta?"Abriendo Meta…":"Conectar Facebook e Instagram"}</button>
        <button type="button" className="secondary-button" onClick={()=>setShowWhatsapp(value=>!value)}>{showWhatsapp?"Cerrar WhatsApp":"Conectar WhatsApp"}</button>
      </div>
    </div>
    {message&&<div className={`auth-message ${messageType}`}>{message}</div>}
    {showWhatsapp&&<form className="whatsapp-connect" onSubmit={saveWhatsapp}>
      <label>Nombre visible<input required value={form.displayName} onChange={event=>setForm(value=>({...value,displayName:event.target.value}))} placeholder="WhatsApp Metro"/></label>
      <label>Phone Number ID<input required value={form.phoneNumberId} onChange={event=>setForm(value=>({...value,phoneNumberId:event.target.value}))}/></label>
      <label>WhatsApp Business Account ID<input value={form.businessAccountId} onChange={event=>setForm(value=>({...value,businessAccountId:event.target.value}))}/></label>
      <label>Token permanente<input required type="password" autoComplete="new-password" value={form.accessToken} onChange={event=>setForm(value=>({...value,accessToken:event.target.value}))}/></label>
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
