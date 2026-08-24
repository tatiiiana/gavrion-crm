import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const supabase = await createServerSupabase();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const { data: membership } = await supabase.from("memberships").select("tenant_id").eq("user_id", auth.user.id).limit(1).maybeSingle();
  if (!membership) return NextResponse.json({ error: "Sin empresa" }, { status: 403 });
  const period = new URL(request.url).searchParams.get("period") || "30d";
  const days = period === "7d" ? 7 : period === "90d" ? 90 : 30;
  const from = new Date(Date.now() - days * 86400000).toISOString();
  const [conversations, messages, deals, contacts] = await Promise.all([
    supabase.from("conversations").select("id, channel, created_at").eq("tenant_id", membership.tenant_id).gte("created_at", from),
    supabase.from("messages").select("conversation_id, direction, sender_id, created_at").eq("tenant_id", membership.tenant_id).gte("created_at", from).order("created_at"),
    supabase.from("deals").select("id, stage, value, created_at").eq("tenant_id", membership.tenant_id).gte("created_at", from),
    supabase.from("contacts").select("id, created_at").eq("tenant_id", membership.tenant_id).gte("created_at", from)
  ]);
  const error = conversations.error || messages.error || deals.error || contacts.error;
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  const messageRows = messages.data || []; const dealRows = deals.data || [];
  const responseTimes: number[] = [];
  for (const inbound of messageRows.filter(item => item.direction === "inbound")) {
    const reply = messageRows.find(item => item.conversation_id === inbound.conversation_id && item.direction === "outbound" && new Date(item.created_at) > new Date(inbound.created_at));
    if (reply) responseTimes.push((new Date(reply.created_at).getTime() - new Date(inbound.created_at).getTime()) / 60000);
  }
  const won = dealRows.filter(deal => deal.stage === "won");
  const channels = Object.entries((conversations.data || []).reduce<Record<string,number>>((acc,item)=>{acc[item.channel]=(acc[item.channel]||0)+1;return acc;},{})).map(([name,value])=>({name,value}));
  const daily = Array.from({length:days},(_,index)=>{const date=new Date(Date.now()-(days-1-index)*86400000).toISOString().slice(0,10);return {date, conversations:(conversations.data||[]).filter(item=>item.created_at.slice(0,10)===date).length, contacts:(contacts.data||[]).filter(item=>item.created_at.slice(0,10)===date).length};});
  const agents = Object.entries(messageRows.filter(item=>item.direction==="outbound"&&item.sender_id).reduce<Record<string,number>>((acc,item)=>{acc[item.sender_id]=(acc[item.sender_id]||0)+1;return acc;},{})).map(([id,replies])=>({id,replies})).sort((a,b)=>b.replies-a.replies);
  return NextResponse.json({ period:days, metrics:{ conversations:(conversations.data||[]).length, contacts:(contacts.data||[]).length, conversion:dealRows.length?won.length/dealRows.length*100:0, averageResponseMinutes:responseTimes.length?responseTimes.reduce((a,b)=>a+b,0)/responseTimes.length:0, wonDeals:won.length, salesValue:won.reduce((sum,item)=>sum+Number(item.value||0),0) }, channels, daily, agents });
}
