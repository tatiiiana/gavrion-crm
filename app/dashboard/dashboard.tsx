"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import type { Contact, Deal, DealStage, Period, Task } from "@/types/crm";
import { createClientSupabase } from "@/lib/supabase/client";
import { AutomationsView } from "./automations";
import { ReportsView } from "./reports";
import { CompanySettings } from "./company-settings";
import { AuditView } from "./audit";
import { MetaConnections } from "./meta-connections";
import { OperationalModule } from "./operational-module";
import { PipelineWorkspace } from "./pipeline-workspace";
import { CustomFields } from "./custom-fields";
import { AccountTab, OwnerCenter, type OwnerNotification } from "./owner-center";
import { NotificationBell } from "./notification-bell";
import { downloadCsv } from "./export-utils";
import { configuredModulesForBusiness } from "@/lib/business-modules";

const periodLabels: Record<Period, string> = { week: "esta semana", "30d": "últimos 30 días", year: "este año" };
const dealStages: { id: DealStage; label: string }[] = [{ id: "new", label: "Nuevo" }, { id: "proposal", label: "Propuesta" }, { id: "negotiation", label: "Negociación" }, { id: "won", label: "Ganado" }];
type ChatMessage = { id: string; text: string; direction: "inbound" | "outbound"; createdAt: string };
type Thread = { id: string; name: string; channel: string; preview: string; contactId: string; externalThreadId: string; handlingMode: "bot" | "waiting_agent" | "human"; assignedTo: string; unread: number; messages: ChatMessage[] };
type TeamMember = { id: string; name: string; email: string; role: "owner" | "admin" | "agent" | "viewer"; active?:boolean; invitationStatus?:string; invitedAt?: string | null; lastSeenAt?: string | null; online?: boolean; workload?:{conversations:number;tasks:number;deals:number} };
type Property = { id: string; reference: string; title: string; property_type: string; operation: "sale" | "rent"; price: number; currency: string; city: string; zone: string | null; bedrooms: number | null; status: "available" | "reserved" | "sold" | "rented" | "inactive" };
type PropertyInquiry = { id: string; customer_name: string; phone: string; intent: "buy" | "rent" | "sell"; property_type: string | null; city: string | null; zone: string | null; budget_max: number | null; bedrooms: number | null; notes: string | null; status: "new" | "contacted" | "qualified" | "closed" | "discarded" };
type PropertyVisit = { id: string; property_reference: string; customer_name: string; phone: string; requested_date: string; requested_time: string; party_size: number; notes: string | null; status: "pending" | "confirmed" | "completed" | "cancelled" };
type SettingsTab = "control" | "empresa" | "canales" | "asistente";
type TaskViewFilter = "mine" | "team" | "today" | "overdue" | "followups" | "conversations" | "forms";
const setupTabs: SettingsTab[] = ["empresa", "canales", "asistente"];

function classifyTask(title: string): Task["source"] {
  const value = title.toLowerCase();
  if (value.includes("mensaje") || value.includes("conversación") || value.includes("conversacion")) return "conversation";
  if (value.includes("formulario") || value.includes("reserva") || value.includes("reservación") || value.includes("reservacion") || value.includes("pedido") || value.includes("cita") || value.includes("visita") || value.includes("cotización") || value.includes("cotizacion")) return "form";
  if (value.includes("contactar") || value.includes("seguimiento") || value.includes("follow-up")) return "followup";
  return "manual";
}

export default function Dashboard() {
  const [authReady, setAuthReady] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [greeting, setGreeting] = useState("Hola");
  const [account, setAccount] = useState({ name: "Usuario", email: "", initials: "U", role: "Miembro", company: "" });
  const [currentRole, setCurrentRole] = useState("");
  const [supportMode, setSupportMode] = useState(false);
  const [enabledModules, setEnabledModules] = useState<string[] | null>(null);
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<TeamMember["role"]>("agent");
  const [inviting, setInviting] = useState(false);
  const [reassignTargets, setReassignTargets] = useState<Record<string, string>>({});
  const [tenantId, setTenantId] = useState("");
  const [tenantLogoUrl, setTenantLogoUrl] = useState("");
  const [brandingName, setBrandingName] = useState("");
  const [brandingLogoUrl, setBrandingLogoUrl] = useState("");
  const [savingBranding, setSavingBranding] = useState(false);
  const [logoFailed, setLogoFailed] = useState(false);
  const [assistantEnabled, setAssistantEnabled] = useState(true);
  const [assistantName, setAssistantName] = useState("Asistente virtual");
  const [assistantInstructions, setAssistantInstructions] = useState("Responde con amabilidad, brevedad y únicamente con información confirmada.");
  const [handoffMessage, setHandoffMessage] = useState("Voy a transferir esta conversación a una persona del equipo para ayudarte mejor.");
  const [knowledgeId, setKnowledgeId] = useState("");
  const [knowledgeContent, setKnowledgeContent] = useState("");
  const [savingAssistant, setSavingAssistant] = useState(false);
  const [userId, setUserId] = useState("");
  const [dataLoading, setDataLoading] = useState(true);
  const [notice, setNotice] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [view, setView] = useState(() => typeof window === "undefined" ? "inicio" : new URLSearchParams(window.location.search).get("view") || "inicio");
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("control");
  const [teamTab, setTeamTab] = useState<"members" | "account">("members");
  const [bellRefresh, setBellRefresh] = useState(0);
  const [settingsMenuOpen, setSettingsMenuOpen] = useState(false);
  const [period, setPeriod] = useState<Period>("30d");
  const [dashboardMetrics, setDashboardMetrics] = useState({ contacts: 0, conversations: 0, deals: 0, won: 0, pipeline: 0 });
  const [activity, setActivity] = useState<number[]>([0, 0, 0, 0, 0, 0, 0]);
  const [metricsVersion, setMetricsVersion] = useState(0);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [filter, setFilter] = useState<"all" | "pending" | "done">("all");
  const [taskViewFilter, setTaskViewFilter] = useState<TaskViewFilter>("mine");
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const [time, setTime] = useState("15:00");
  const visible = useMemo(() => tasks.filter(t => filter === "all" || (filter === "done" ? t.completed_at : !t.completed_at)), [tasks, filter]);
  const completed = tasks.filter(t => t.completed_at).length;
  const isClientAdmin = !supportMode && (currentRole === "owner" || currentRole === "admin");
  const canOperateSales = supportMode || currentRole === "owner" || currentRole === "admin" || currentRole === "agent";
  const roleAllowsModule = (viewId: string) => {
    if (supportMode) return !["equipo", "configuracion", "automatizaciones", "campos"].includes(viewId);
    if (currentRole === "viewer") return ["inicio", "conversaciones", "contactos", "tareas", "calendario", "reportes"].includes(viewId);
    if (isClientAdmin) return true;
    if (currentRole === "agent") return !["equipo", "campos", "automatizaciones", "auditoria", "configuracion"].includes(viewId);
    return true;
  };
  const [globalQuery, setGlobalQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [contactQuery, setContactQuery] = useState("");
  const [contactFilters, setContactFilters] = useState({ name: "", company: "", phone: "", status: "" });
  const [contacts, setContacts] = useState<Contact[]>([]);
  const filteredContacts = useMemo(() => contacts.filter(contact => {
    const query = contactQuery.trim().toLowerCase();
    const matchesQuery = !query || `${contact.name} ${contact.email} ${contact.company}`.toLowerCase().includes(query);
    return matchesQuery && (!contactFilters.name || contact.name.toLowerCase().includes(contactFilters.name.toLowerCase())) && (!contactFilters.company || contact.company.toLowerCase().includes(contactFilters.company.toLowerCase())) && (!contactFilters.phone || contact.phone.toLowerCase().includes(contactFilters.phone.toLowerCase())) && (!contactFilters.status || contact.status === contactFilters.status);
  }), [contacts, contactQuery, contactFilters]);
  function exportContacts() { downloadCsv("contactos", filteredContacts, [{ key: "name", label: "Nombre", value: contact => contact.name }, { key: "email", label: "Correo", value: contact => contact.email }, { key: "phone", label: "Teléfono", value: contact => contact.phone }, { key: "company", label: "Empresa", value: contact => contact.company }, { key: "status", label: "Estado", value: contact => contact.status }]); }
  function exportConversations() { downloadCsv("conversaciones", threads, [{ key: "name", label: "Contacto", value: thread => thread.name }, { key: "channel", label: "Canal", value: thread => thread.channel }, { key: "status", label: "Atención", value: thread => thread.handlingMode }, { key: "assigned", label: "Responsable", value: thread => thread.assignedTo }, { key: "preview", label: "Último mensaje", value: thread => thread.preview }]); }
  function exportProperties(){downloadCsv("propiedades",filteredProperties,[{key:"reference",label:"Referencia",value:item=>item.reference},{key:"title",label:"Título",value:item=>item.title},{key:"location",label:"Ubicación",value:item=>`${item.city} ${item.zone||""}`},{key:"price",label:"Precio",value:item=>item.price},{key:"status",label:"Estado",value:item=>item.status}]);}
  function exportInquiries(){downloadCsv("interesados",filteredInquiries,[{key:"customer",label:"Cliente",value:item=>item.customer_name},{key:"phone",label:"Teléfono",value:item=>item.phone},{key:"intent",label:"Interés",value:item=>item.intent},{key:"location",label:"Ubicación",value:item=>`${item.city||""} ${item.zone||""}`},{key:"status",label:"Estado",value:item=>item.status}]);}
  function exportVisits(){downloadCsv("visitas",filteredVisits,[{key:"customer",label:"Cliente",value:item=>item.customer_name},{key:"phone",label:"Teléfono",value:item=>item.phone},{key:"property",label:"Propiedad",value:item=>item.property_reference},{key:"date",label:"Fecha",value:item=>item.requested_date},{key:"status",label:"Estado",value:item=>item.status}]);}
  const [showContactForm, setShowContactForm] = useState(false);
  const [editingContactId, setEditingContactId] = useState<string | null>(null);
  const [contactName, setContactName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [contactCompany, setContactCompany] = useState("");
  const [contactStatus, setContactStatus] = useState<Contact["status"]>("Prospecto");
  const [selectedThread, setSelectedThread] = useState(0);
  const [message, setMessage] = useState("");
  const [threads, setThreads] = useState<Thread[]>([]);
  const [visibleMessageCount, setVisibleMessageCount] = useState(50);
  const messagesRef = useRef<HTMLDivElement | null>(null);
  const previousLastMessageRef = useRef("");
  const [properties, setProperties] = useState<Property[]>([]);
  const [propertyInquiries, setPropertyInquiries] = useState<PropertyInquiry[]>([]);
  const [propertyVisits, setPropertyVisits] = useState<PropertyVisit[]>([]);
  const [propertyFilters, setPropertyFilters] = useState({ reference: "", location: "", status: "" });
  const [inquiryFilters, setInquiryFilters] = useState({ customer: "", location: "", status: "" });
  const [visitFilters, setVisitFilters] = useState({ customer: "", property: "", status: "" });
  const filteredProperties = useMemo(() => properties.filter(item => (!propertyFilters.reference || `${item.reference} ${item.title}`.toLowerCase().includes(propertyFilters.reference.toLowerCase())) && (!propertyFilters.location || `${item.city} ${item.zone || ""}`.toLowerCase().includes(propertyFilters.location.toLowerCase())) && (!propertyFilters.status || item.status === propertyFilters.status)), [properties, propertyFilters]);
  const filteredInquiries = useMemo(() => propertyInquiries.filter(item => (!inquiryFilters.customer || `${item.customer_name} ${item.phone}`.toLowerCase().includes(inquiryFilters.customer.toLowerCase())) && (!inquiryFilters.location || `${item.city || ""} ${item.zone || ""}`.toLowerCase().includes(inquiryFilters.location.toLowerCase())) && (!inquiryFilters.status || item.status === inquiryFilters.status)), [propertyInquiries, inquiryFilters]);
  const filteredVisits = useMemo(() => propertyVisits.filter(item => (!visitFilters.customer || `${item.customer_name} ${item.phone}`.toLowerCase().includes(visitFilters.customer.toLowerCase())) && (!visitFilters.property || item.property_reference.toLowerCase().includes(visitFilters.property.toLowerCase())) && (!visitFilters.status || item.status === visitFilters.status)), [propertyVisits, visitFilters]);
  const [showPropertyForm, setShowPropertyForm] = useState(false);
  const [propertyReference, setPropertyReference] = useState("");
  const [propertyTitle, setPropertyTitle] = useState("");
  const [propertyType, setPropertyType] = useState("house");
  const [propertyOperation, setPropertyOperation] = useState<"sale" | "rent">("sale");
  const [propertyPrice, setPropertyPrice] = useState("");
  const [propertyCity, setPropertyCity] = useState("");
  const [propertyZone, setPropertyZone] = useState("");
  const [propertyBedrooms, setPropertyBedrooms] = useState("");
  const [deals, setDeals] = useState<Deal[]>([]);
  const [showDealForm, setShowDealForm] = useState(false);
  const [editingDealId, setEditingDealId] = useState<string | null>(null);
  const [dealTitle, setDealTitle] = useState("");
  const [dealContactId, setDealContactId] = useState("");
  const [dealValue, setDealValue] = useState("");
  const [dealStage, setDealStage] = useState<DealStage>("new");
  const [dealCloseDate, setDealCloseDate] = useState("");

  useEffect(() => {
    const supabase = createClientSupabase();
    if (!supabase) { setAuthReady(true); return; }
    supabase.auth.getSession().then(async ({ data }) => {
      if (!data.session) window.location.replace("/login");
      else {
        const user = data.session.user;
        setUserId(user.id);
        const email = user.email || "";
        const name = String(user.user_metadata?.full_name || email.split("@")[0] || "Usuario");
        let { data: membership } = await supabase.from("memberships").select("tenant_id, role").eq("user_id", user.id).limit(1).maybeSingle();
        const supportTenant = new URLSearchParams(window.location.search).get("supportTenant");
        let supportSession = false;
        if (supportTenant) {
          const response = await fetch(`/api/admin/support-context?tenantId=${encodeURIComponent(supportTenant)}`, { cache: "no-store" });
          if (response.ok) {
            membership = { tenant_id: supportTenant, role: "owner" };
            supportSession = true;
            setSupportMode(true);
          } else {
            setNotice({ type: "error", text: "No fue posible abrir esta empresa en modo soporte." });
          }
        }
        if (!supportTenant) {
          // El personal Gavrion trabaja en el panel de plataforma, incluso si
          // Supabase creó una membresía temporal durante la invitación.
          const platformResponse = await fetch("/api/admin/access", { cache: "no-store" }).catch(() => null);
          const platformAccess = platformResponse?.ok ? await platformResponse.json().catch(() => null) : null;
          if (platformAccess?.isPlatformStaff) {
            window.location.replace("/admin");
            return;
          }
        }
        setCurrentRole(membership?.role || "");
        let company = String(user.user_metadata?.company_name || "");
        if (membership?.tenant_id) {
          setTenantId(membership.tenant_id);
          const { data: tenant } = await supabase.from("tenants").select("name, logo_url, widget_key, settings, template_key").eq("id", membership.tenant_id).maybeSingle();
          if (tenant?.name) company = tenant.name;
          const logoUrl = String(tenant?.logo_url || "");
          setTenantLogoUrl(logoUrl);
          setBrandingName(company);
          setBrandingLogoUrl(logoUrl);
          // También corrige empresas creadas antes de esta regla: el menú jamás
          // debe mezclar módulos de otros rubros aunque estén guardados en settings.
          setEnabledModules(configuredModulesForBusiness(tenant?.settings?.modules, tenant?.template_key));

          const [assistantResult, knowledgeResult] = await Promise.all([
            supabase.from("assistant_settings").select("enabled, assistant_name, instructions, handoff_message").eq("tenant_id", membership.tenant_id).maybeSingle(),
            supabase.from("knowledge_documents").select("id, content").eq("tenant_id", membership.tenant_id).eq("active", true).order("updated_at", { ascending: false }).limit(1).maybeSingle()
          ]);
          if (assistantResult.data) {
            setAssistantEnabled(assistantResult.data.enabled);
            setAssistantName(assistantResult.data.assistant_name);
            setAssistantInstructions(assistantResult.data.instructions);
            setHandoffMessage(assistantResult.data.handoff_message);
          }
          if (knowledgeResult.data) { setKnowledgeId(knowledgeResult.data.id); setKnowledgeContent(knowledgeResult.data.content); }

          const [contactsResult, tasksResult, dealsResult, conversationsResult, messagesResult, propertiesResult, inquiriesResult, visitsResult, formTasksResult, inquiryTasksResult] = await Promise.all([
            supabase.from("contacts").select("id, full_name, email, phone, company, status").eq("tenant_id", membership.tenant_id).order("updated_at", { ascending: false }),
            supabase.from("tasks").select("id, title, due_at, completed_at, assigned_to").eq("tenant_id", membership.tenant_id).order("due_at", { ascending: true, nullsFirst: false }),
            supabase.from("deals").select("id, title, stage, value, currency, contact_id, expected_close_date").eq("tenant_id", membership.tenant_id).order("updated_at", { ascending: false }),
            supabase.from("conversations").select("id, contact_id, channel, external_thread_id, status, handling_mode, assigned_to, last_message_at").eq("tenant_id", membership.tenant_id).order("last_message_at", { ascending: false }),
            supabase.from("messages").select("id, conversation_id, direction, body, created_at").eq("tenant_id", membership.tenant_id).order("created_at", { ascending: true }),
            supabase.from("properties").select("id, reference, title, property_type, operation, price, currency, city, zone, bedrooms, status").eq("tenant_id", membership.tenant_id).order("created_at", { ascending: false }),
            supabase.from("property_inquiries").select("id, customer_name, phone, intent, property_type, city, zone, budget_max, bedrooms, notes, status").eq("tenant_id", membership.tenant_id).order("created_at", { ascending: false }),
            supabase.from("property_visits").select("id, property_reference, customer_name, phone, requested_date, requested_time, party_size, notes, status").eq("tenant_id", membership.tenant_id).order("requested_date", { ascending: true }),
            supabase.from("site_form_submissions").select("task_id, conversation_id").eq("tenant_id", membership.tenant_id).not("task_id", "is", null).limit(5000),
            supabase.from("property_inquiries").select("follow_up_task_id, conversation_id").eq("tenant_id", membership.tenant_id).not("follow_up_task_id", "is", null).limit(5000)
          ]);
          if (contactsResult.error || tasksResult.error || dealsResult.error || conversationsResult.error || messagesResult.error || propertiesResult.error || inquiriesResult.error || visitsResult.error) {
            setNotice({ type: "error", text: contactsResult.error?.message || tasksResult.error?.message || dealsResult.error?.message || conversationsResult.error?.message || messagesResult.error?.message || propertiesResult.error?.message || inquiriesResult.error?.message || visitsResult.error?.message || "No fue posible cargar los datos." });
          } else {
            const statusLabels: Record<string, Contact["status"]> = { customer: "Cliente", lead: "Prospecto", inactive: "Inactivo" };
            const loadedContacts: Contact[] = (contactsResult.data || []).map(item => ({ id: item.id, name: item.full_name, email: item.email || "", phone: item.phone || "", company: item.company || "", status: statusLabels[item.status] || "Prospecto" }));
            setContacts(loadedContacts);
const taskSources = new Map<string, Task["source"]>();
            for (const item of formTasksResult.data || []) if (item.task_id) taskSources.set(item.task_id, "form");
            for (const item of inquiryTasksResult.data || []) if (item.follow_up_task_id && !taskSources.has(item.follow_up_task_id)) taskSources.set(item.follow_up_task_id, "conversation");
            setTasks((tasksResult.data || []).map(item => ({ ...(item as Task), source: taskSources.get(item.id) || classifyTask(item.title) })));
            setProperties((propertiesResult.data || []).map(item => ({ ...item, price: Number(item.price || 0) })) as Property[]);
            setPropertyInquiries((inquiriesResult.data || []).map(item => ({ ...item, budget_max: item.budget_max == null ? null : Number(item.budget_max) })) as PropertyInquiry[]);
            setPropertyVisits((visitsResult.data || []) as PropertyVisit[]);
            setDeals((dealsResult.data || []).map(item => ({ id: item.id, title: item.title, stage: (dealStages.some(stage => stage.id === item.stage) ? item.stage : "new") as DealStage, value: Number(item.value || 0), currency: item.currency || "HNL", contactId: item.contact_id || "", contactName: loadedContacts.find(contact => contact.id === item.contact_id)?.name || "Sin contacto", expectedCloseDate: item.expected_close_date || "" })));
            const allMessages = messagesResult.data || [];
            const channelLabels: Record<string, string> = { whatsapp: "WhatsApp", instagram: "Instagram", facebook: "Facebook", web: "Chat web" };
            setThreads((conversationsResult.data || []).map(conversation => {
              const conversationMessages: ChatMessage[] = allMessages.filter(item => item.conversation_id === conversation.id).map(item => ({ id: item.id, text: item.body || "[Mensaje multimedia]", direction: item.direction as "inbound" | "outbound", createdAt: item.created_at }));
              const contact = loadedContacts.find(item => item.id === conversation.contact_id);
              return { id: conversation.id, name: contact?.name || conversation.external_thread_id || "Contacto", channel: channelLabels[conversation.channel] || conversation.channel, preview: conversationMessages.at(-1)?.text || "Sin mensajes", contactId: conversation.contact_id || "", externalThreadId: conversation.external_thread_id || "", handlingMode: (conversation.handling_mode || "bot") as Thread["handlingMode"], assignedTo: conversation.assigned_to || "", unread: 0, messages: conversationMessages };
            }));
          }
        } else if (!supportTenant) {
          setNotice({ type: "error", text: "Tu usuario no tiene una membresía activa en una empresa lista para operar. Si eres personal Gavrion, entra al panel de Administración; si eres cliente, revisa tu membresía en Supabase." });
        }
        const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join("").toUpperCase();
        const roleLabels: Record<string, string> = { owner: "Administrador del cliente", admin: "Administrador del cliente", agent: "Agente del cliente", viewer: "Consulta" };
        setAccount({ name, email, initials: initials || "U", role: supportSession ? "Soporte Gavrion" : roleLabels[membership?.role || ""] || "Miembro", company });
        fetch("/api/team").then(response => response.ok ? response.json() : []).then(data => setTeamMembers(Array.isArray(data) ? data : [])).catch(() => undefined);
        setDataLoading(false);
        setAuthReady(true);
      }
    });
  }, []);

  useEffect(() => {
    if (view === "configuracion") setSettingsMenuOpen(true);
  }, [view]);

  useEffect(() => {
    function updateGreeting() {
      const hour = new Date().getHours();
      setGreeting(hour >= 5 && hour < 12 ? "Buenos días" : hour >= 12 && hour < 19 ? "Buenas tardes" : "Buenas noches");
    }
    updateGreeting();
    const timer = window.setInterval(updateGreeting, 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!tenantId) return;
    const supabase = createClientSupabase();
    if (!supabase) return;
    const client = supabase;
    let active = true;

    async function refreshConversations() {
      const [contactsResult, conversationsResult, messagesResult, readsResult] = await Promise.all([
        client.from("contacts").select("id, full_name").eq("tenant_id", tenantId),
        client.from("conversations").select("id, contact_id, channel, external_thread_id, handling_mode, assigned_to, last_message_at").eq("tenant_id", tenantId).order("last_message_at", { ascending: false }),
        client.from("messages").select("id, conversation_id, direction, body, created_at").eq("tenant_id", tenantId).order("created_at", { ascending: true }),
        client.from("conversation_reads").select("conversation_id, last_read_at").eq("tenant_id", tenantId).eq("user_id", userId)
      ]);
      if (!active || contactsResult.error || conversationsResult.error || messagesResult.error) return;

      const names = new Map((contactsResult.data || []).map(contact => [contact.id, contact.full_name]));
      const allMessages = messagesResult.data || [];
      const reads = new Map((readsResult.data || []).map(item => [item.conversation_id, item.last_read_at]));
      const channelLabels: Record<string, string> = { whatsapp: "WhatsApp", instagram: "Instagram", facebook: "Facebook", web: "Chat web" };
      const nextThreads: Thread[] = (conversationsResult.data || []).map(conversation => {
        const conversationMessages: ChatMessage[] = allMessages
          .filter(item => item.conversation_id === conversation.id)
          .map(item => ({ id: item.id, text: item.body || "[Mensaje multimedia]", direction: item.direction as "inbound" | "outbound", createdAt: item.created_at }));
        return {
          id: conversation.id,
          name: names.get(conversation.contact_id) || conversation.external_thread_id || "Contacto",
          channel: channelLabels[conversation.channel] || conversation.channel,
          preview: conversationMessages.at(-1)?.text || "Sin mensajes",
          contactId: conversation.contact_id || "",
          externalThreadId: conversation.external_thread_id || "",
          handlingMode: (conversation.handling_mode || "bot") as Thread["handlingMode"],
          assignedTo: conversation.assigned_to || "",
          unread: conversationMessages.filter(item => item.direction === "inbound" && new Date(item.createdAt) > new Date(reads.get(conversation.id) || 0)).length,
          messages: conversationMessages
        };
      });
      setThreads(nextThreads);
      setSelectedThread(current => nextThreads.length ? Math.min(current, nextThreads.length - 1) : 0);
    }

    const realtime = client
      .channel(`crm-conversations-${tenantId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "conversations", filter: `tenant_id=eq.${tenantId}` }, refreshConversations)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages", filter: `tenant_id=eq.${tenantId}` }, payload => {
        const incoming = payload.new as { direction?: string; body?: string };
        if (incoming.direction === "inbound" && document.hidden && "Notification" in window && Notification.permission === "granted") new Notification("Nuevo mensaje en Gavrion", { body: incoming.body || "Tienes una conversación nueva." });
        void refreshConversations();
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "messages", filter: `tenant_id=eq.${tenantId}` }, refreshConversations)
      .on("postgres_changes", { event: "*", schema: "public", table: "conversation_reads", filter: `tenant_id=eq.${tenantId}` }, refreshConversations)
      .subscribe();
    void refreshConversations();
    const polling = window.setInterval(refreshConversations, 8_000);

    return () => {
      active = false;
      window.clearInterval(polling);
      void client.removeChannel(realtime);
    };
  }, [tenantId, userId]);

  useEffect(() => {
    if (!tenantId) return;
    const supabase = createClientSupabase();
    if (!supabase) return;
    const now = new Date();
    const from = period === "week" ? new Date(now.getTime() - 7 * 86400000) : period === "30d" ? new Date(now.getTime() - 30 * 86400000) : new Date(now.getFullYear(), 0, 1);
    Promise.all([
      supabase.from("contacts").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).neq("status", "inactive").gte("created_at", from.toISOString()),
      supabase.from("conversations").select("id, created_at", { count: "exact" }).eq("tenant_id", tenantId).gte("created_at", from.toISOString()),
      supabase.from("deals").select("id, value, stage, created_at").eq("tenant_id", tenantId).gte("created_at", from.toISOString())
    ]).then(([contactResult, conversationResult, dealResult]) => {
      if (contactResult.error || conversationResult.error || dealResult.error) {
        setNotice({ type: "error", text: contactResult.error?.message || conversationResult.error?.message || dealResult.error?.message || "No se pudieron actualizar las métricas." });
        return;
      }
      const dealRows = dealResult.data || [];
      const openDeals = dealRows.filter(deal => deal.stage !== "won");
      const wonDeals = dealRows.filter(deal => deal.stage === "won");
      setDashboardMetrics({ contacts: contactResult.count || 0, conversations: conversationResult.count || 0, deals: dealRows.length, won: wonDeals.length, pipeline: openDeals.reduce((total, deal) => total + Number(deal.value || 0), 0) });
      const sevenDays = Array.from({ length: 7 }, (_, index) => {
        const day = new Date(); day.setHours(0, 0, 0, 0); day.setDate(day.getDate() - (6 - index));
        return day.toISOString().slice(0, 10);
      });
      const counts = sevenDays.map(day => (conversationResult.data || []).filter(item => item.created_at?.slice(0, 10) === day).length + dealRows.filter(item => item.created_at?.slice(0, 10) === day).length);
      const max = Math.max(...counts, 1);
      setActivity(counts.map(count => count === 0 ? 3 : Math.max(12, Math.round(count / max * 100))));
    });
  }, [tenantId, period, metricsVersion]);

  async function addTask(taskTitle: string, taskTime: string) {
    if (!taskTitle.trim() || !tenantId) return;
    const supabase = createClientSupabase();
    if (!supabase) return;
    const dueAt = `${new Date().toISOString().slice(0, 10)}T${taskTime}:00`;
    const { data, error } = await supabase.from("tasks").insert({ tenant_id: tenantId, title: taskTitle.trim(), due_at: dueAt, assigned_to: userId || null }).select("id, title, due_at, completed_at, assigned_to").single();
    if (error) { showNotice("error", `No se pudo guardar la tarea: ${error.message}`); return; }
    setTasks(current => [{ ...(data as Task), source: "manual" }, ...current]);
    showNotice("success", "Tarea guardada en Supabase.");
  }

  async function createTask(event: FormEvent) {
    event.preventDefault();
    if (!title.trim()) return;
    await addTask(title, time);
    setTitle("");
    setCreating(false);
  }

  async function toggleTask(task: Task) {
    const completed_at = task.completed_at ? null : new Date().toISOString();
    const supabase = createClientSupabase();
    if (!supabase) return;
    const previous = task.completed_at;
    setTasks(current => current.map(item => item.id === task.id ? { ...item, completed_at } : item));
    const { error } = await supabase.from("tasks").update({ completed_at }).eq("id", task.id).eq("tenant_id", tenantId);
    if (error) { setTasks(current => current.map(item => item.id === task.id ? { ...item, completed_at: previous } : item)); showNotice("error", `No se pudo actualizar la tarea: ${error.message}`); }
  }

  async function deleteTask(id: string) {
    const supabase = createClientSupabase();
    if (!supabase) return;
    const { error } = await supabase.from("tasks").delete().eq("id", id).eq("tenant_id", tenantId);
    if (error) showNotice("error", `No se pudo eliminar la tarea: ${error.message}`);
    else { setTasks(current => current.filter(task => task.id !== id)); showNotice("success", "Tarea eliminada."); }
  }

  function navigate(next: string) { setView(next); if (next !== "configuracion") setSettingsMenuOpen(false); window.scrollTo({ top: 0, behavior: "smooth" }); }
  function openSettings(tab: SettingsTab) { setSettingsTab(tab); setSettingsMenuOpen(true); navigate("configuracion"); }
  // Lleva al módulo relacionado con cada alerta del centro de notificaciones.
  function openOwnerNotification(item: OwnerNotification) {
    setBellRefresh(value => value + 1);
    const target: Record<string, string> = { reservations: "reservaciones", orders: "pedidos", appointments: "citas", quotes: "cotizaciones", property_inquiry: "inmobiliaria", property_visit: "inmobiliaria", automation_flow: "automatizaciones" };
    if (item.entity_type === "conversation") {
      const index = threads.findIndex(thread => thread.id === item.entity_id);
      if (index >= 0) setSelectedThread(index);
      navigate("conversaciones"); return;
    }
    if (item.entity_type === "channel_connection") { openSettings("canales"); return; }
    const view = item.entity_type ? target[item.entity_type] : undefined;
    if (view && roleAllowsModule(view)) { navigate(view); return; }
    openSettings("control");
  }

  useEffect(() => {
    if (!enabledModules) return;
    const moduleByView: Record<string, string> = {
      inicio: "dashboard", conversaciones: "conversations", inmobiliaria: "properties",
      reservaciones: "reservations", pedidos: "orders", citas: "appointments", cotizaciones: "quotes",
      productos: "products", contactos: "contacts", pipeline_v2: "pipeline", tareas: "tasks", calendario: "tasks", campos: "pipeline",
      equipo: "team", automatizaciones: "automations", reportes: "reports"
    };
    const requiredModule = moduleByView[view];
    if (requiredModule && !enabledModules.includes(requiredModule)) {
      setView("inicio");
      setNotice({ type: "error", text: "Esta sección no está habilitada para el rubro de esta empresa." });
    }
  }, [enabledModules, view]);
  async function saveContact(event: FormEvent) {
    event.preventDefault(); if (!contactName.trim() || !tenantId) return;
    const supabase = createClientSupabase();
    if (!supabase) return;
    const email = contactEmail.trim().toLowerCase();
    const phone = contactPhone.trim();
    if (email) {
      let duplicateEmail = supabase.from("contacts").select("id").eq("tenant_id", tenantId).ilike("email", email).limit(1);
      if (editingContactId) duplicateEmail = duplicateEmail.neq("id", editingContactId);
      const { data } = await duplicateEmail;
      if (data?.length) { showNotice("error", "Ya existe un contacto con ese correo."); return; }
    }
    if (phone) {
      let duplicatePhone = supabase.from("contacts").select("id").eq("tenant_id", tenantId).eq("phone", phone).limit(1);
      if (editingContactId) duplicatePhone = duplicatePhone.neq("id", editingContactId);
      const { data } = await duplicatePhone;
      if (data?.length) { showNotice("error", "Ya existe un contacto con ese teléfono."); return; }
    }
    const statusValues: Record<Contact["status"], string> = { Cliente: "customer", Prospecto: "lead", Inactivo: "inactive" };
    const payload = { full_name: contactName.trim(), email: email || null, phone: phone || null, company: contactCompany.trim() || null, status: statusValues[contactStatus] };
    const request = editingContactId ? supabase.from("contacts").update(payload).eq("id", editingContactId).eq("tenant_id", tenantId) : supabase.from("contacts").insert({ ...payload, tenant_id: tenantId });
    const { data, error } = await request.select("id, full_name, email, phone, company, status").single();
    if (error) { showNotice("error", `No se pudo guardar el contacto: ${error.message}`); return; }
    const saved: Contact = { id: data.id, name: data.full_name, email: data.email || "", phone: data.phone || "", company: data.company || "", status: contactStatus };
    setContacts(current => editingContactId ? current.map(contact => contact.id === editingContactId ? saved : contact) : [saved, ...current]);
    if (!editingContactId) void fetch("/api/automations/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ event: "contact_created", payload: { contactId: saved.id, contactName: saved.name, status: data.status } }) });
    setMetricsVersion(version => version + 1);
    closeContactForm();
    showNotice("success", editingContactId ? "Contacto actualizado." : "Contacto guardado en Supabase.");
  }

  function openNewContact() { setEditingContactId(null); setContactName(""); setContactEmail(""); setContactPhone(""); setContactCompany(""); setContactStatus("Prospecto"); setShowContactForm(true); }
  function editContact(contact: Contact) { setEditingContactId(contact.id); setContactName(contact.name); setContactEmail(contact.email); setContactPhone(contact.phone); setContactCompany(contact.company); setContactStatus(contact.status); setShowContactForm(true); window.scrollTo({ top: 0, behavior: "smooth" }); }
  function closeContactForm() { setEditingContactId(null); setShowContactForm(false); setContactName(""); setContactEmail(""); setContactPhone(""); setContactCompany(""); setContactStatus("Prospecto"); }

  async function deleteContact(id: string) {
    if (!window.confirm("¿Eliminar este contacto?")) return;
    const supabase = createClientSupabase();
    if (!supabase) return;
    const { error } = await supabase.from("contacts").delete().eq("id", id).eq("tenant_id", tenantId);
    if (error) showNotice("error", `No se pudo eliminar el contacto: ${error.message}`);
    else { setContacts(current => current.filter(contact => contact.id !== id)); setMetricsVersion(version => version + 1); showNotice("success", "Contacto eliminado."); }
  }

  function openNewDeal() { setEditingDealId(null); setDealTitle(""); setDealContactId(contacts[0]?.id || ""); setDealValue(""); setDealStage("new"); setDealCloseDate(""); setShowDealForm(true); }
  function editDeal(deal: Deal) { setEditingDealId(deal.id); setDealTitle(deal.title); setDealContactId(deal.contactId); setDealValue(String(deal.value)); setDealStage(deal.stage); setDealCloseDate(deal.expectedCloseDate); setShowDealForm(true); window.scrollTo({ top: 0, behavior: "smooth" }); }
  function closeDealForm() { setEditingDealId(null); setShowDealForm(false); setDealTitle(""); setDealContactId(""); setDealValue(""); setDealStage("new"); setDealCloseDate(""); }

  async function saveDeal(event: FormEvent) {
    event.preventDefault();
    const numericValue = Number(dealValue);
    if (!dealTitle.trim() || !tenantId || !Number.isFinite(numericValue) || numericValue < 0) { showNotice("error", "Completa el título y utiliza un valor válido."); return; }
    const supabase = createClientSupabase();
    if (!supabase) return;
    const payload = { title: dealTitle.trim(), contact_id: dealContactId || null, stage: dealStage, value: numericValue, currency: "HNL", owner_id: userId || null, expected_close_date: dealCloseDate || null };
    const request = editingDealId ? supabase.from("deals").update(payload).eq("id", editingDealId).eq("tenant_id", tenantId) : supabase.from("deals").insert({ ...payload, tenant_id: tenantId });
    const { data, error } = await request.select("id, title, stage, value, currency, contact_id, expected_close_date").single();
    if (error) { showNotice("error", `No se pudo guardar la oportunidad: ${error.message}`); return; }
    const saved: Deal = { id: data.id, title: data.title, stage: data.stage as DealStage, value: Number(data.value || 0), currency: data.currency || "HNL", contactId: data.contact_id || "", contactName: contacts.find(contact => contact.id === data.contact_id)?.name || "Sin contacto", expectedCloseDate: data.expected_close_date || "" };
    setDeals(current => editingDealId ? current.map(deal => deal.id === editingDealId ? saved : deal) : [saved, ...current]);
    setMetricsVersion(version => version + 1); closeDealForm(); showNotice("success", editingDealId ? "Oportunidad actualizada." : "Oportunidad creada.");
  }

  async function moveDeal(deal: Deal) {
    const index = dealStages.findIndex(stage => stage.id === deal.stage);
    if (index < 0 || index === dealStages.length - 1) return;
    const nextStage = dealStages[index + 1].id;
    const supabase = createClientSupabase();
    if (!supabase) return;
    const { error } = await supabase.from("deals").update({ stage: nextStage }).eq("id", deal.id).eq("tenant_id", tenantId);
    if (error) showNotice("error", `No se pudo mover la oportunidad: ${error.message}`);
    else { setDeals(current => current.map(item => item.id === deal.id ? { ...item, stage: nextStage } : item)); if (nextStage === "won") void fetch("/api/automations/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ event: "deal_won", payload: { dealId: deal.id, contactId: deal.contactId, contactName: deal.contactName, value: deal.value } }) }); setMetricsVersion(version => version + 1); showNotice("success", `Movida a ${dealStages[index + 1].label}.`); }
  }

  async function deleteDeal(id: string) {
    if (!window.confirm("¿Eliminar esta oportunidad?")) return;
    const supabase = createClientSupabase();
    if (!supabase) return;
    const { error } = await supabase.from("deals").delete().eq("id", id).eq("tenant_id", tenantId);
    if (error) showNotice("error", `No se pudo eliminar la oportunidad: ${error.message}`);
    else { setDeals(current => current.filter(deal => deal.id !== id)); setMetricsVersion(version => version + 1); showNotice("success", "Oportunidad eliminada."); }
  }

  function showNotice(type: "success" | "error", text: string) {
    setNotice({ type, text });
    window.setTimeout(() => setNotice(null), 3500);
  }
  async function sendMessage(event: FormEvent) {
    event.preventDefault();
    const thread = threads[selectedThread];
    const body = message.trim();
    if (!body || !thread) return;
    const endpoint = thread.channel === "Chat web" ? "/api/conversations/messages" : "/api/meta/messages";
    const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ conversationId: thread.id, text: body }) });
    const result = await response.json();
    if (!response.ok) { showNotice("error", result.error || "No se pudo enviar el mensaje."); return; }
    const sent: ChatMessage = { id: result.id, text: result.body || body, direction: "outbound", createdAt: result.created_at || new Date().toISOString() };
    setThreads(current => current.map((item, index) => index === selectedThread ? { ...item, preview: sent.text, messages: [...item.messages, sent] } : item));
    setMessage(""); showNotice("success", thread.channel === "Chat web" ? "Respuesta enviada al chat web." : "Mensaje enviado por WhatsApp.");
  }

  async function setConversationMode(mode: "bot" | "human") {
    const thread = threads[selectedThread];
    if (!thread) return;
    const response = await fetch("/api/conversations/handoff", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ conversationId: thread.id, mode }) });
    const result = await response.json();
    if (!response.ok) { showNotice("error", result.error || "No se pudo cambiar la atención."); return; }
    setThreads(current => current.map((item, index) => index === selectedThread ? { ...item, handlingMode: result.handling_mode } : item));
    if (mode === "human") void fetch("/api/automations/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ event: "conversation_handoff", payload: { conversationId: thread.id, contactId: thread.contactId, contactName: thread.name, assignedTo: userId } }) });
    showNotice("success", mode === "human" ? "Ahora atiende una persona." : "El asistente automático fue reactivado.");
  }

  async function assignConversation(assignedTo: string) {
    const thread = threads[selectedThread];
    if (!thread) return;
    const response = await fetch("/api/conversations/assignment", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ conversationId: thread.id, assignedTo }) });
    const result = await response.json();
    if (!response.ok) { showNotice("error", result.error || "No se pudo asignar la conversación."); return; }
    setThreads(current => current.map(item => item.id === thread.id ? { ...item, assignedTo: result.assigned_to || "", handlingMode: result.handling_mode } : item));
    showNotice("success", assignedTo ? "Conversación asignada." : "Conversación devuelta al asistente.");
  }

  async function refreshTeamMembers() {
    const response = await fetch("/api/team", { cache: "no-store" });
    if (!response.ok) return;
    const result = await response.json();
    if (Array.isArray(result)) setTeamMembers(result);
  }

  async function inviteMember(event: FormEvent) {
    event.preventDefault();
    if (!inviteEmail.trim() || inviting) return;
    setInviting(true);
    const response = await fetch("/api/team", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: inviteEmail, role: inviteRole }) });
    const result = await response.json();
    setInviting(false);
    if (!response.ok) { showNotice("error", result.error || "No se pudo agregar el integrante."); return; }
    setTeamMembers(current => current.some(member => member.id === result.id) ? current.map(member => member.id === result.id ? result : member) : [...current, result]);
    setInviteEmail(""); showNotice("success", "Integrante agregado. Si es una cuenta nueva recibirá una invitación por correo.");
  }

  async function changeMemberRole(member: TeamMember, role: TeamMember["role"]) {
    const response = await fetch("/api/team", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId: member.id, role }) });
    const result = await response.json();
    if (!response.ok) { showNotice("error", result.error || "No se pudo cambiar el rol."); return; }
    setTeamMembers(current => current.map(item => item.id === member.id ? { ...item, role } : item));
    showNotice("success", "Rol actualizado.");
  }

  async function toggleMember(member: TeamMember) {
    const active = member.active === false;
    let reassignTo = "";
    const workload = (member.workload?.conversations || 0) + (member.workload?.tasks || 0) + (member.workload?.deals || 0);
    if (!active && workload) reassignTo = reassignTargets[member.id] || "";
    if (!active && workload && !reassignTo) { showNotice("error", "Selecciona un integrante activo para recibir sus conversaciones, tareas y oportunidades."); return; }
    const response = await fetch("/api/team", { method:"PATCH", headers:{"Content-Type":"application/json"}, body:JSON.stringify({ userId:member.id, active, reassignTo:reassignTo || null }) });
    const result = await response.json();
    if (!response.ok) { showNotice("error", result.error || "No se pudo actualizar el acceso."); return; }
    setTeamMembers(current => current.map(item => item.id === member.id ? { ...item, active, invitationStatus:active ? "accepted" : "revoked" } : item));
    await refreshTeamMembers();
    showNotice("success", active ? "Acceso reactivado." : "Integrante desactivado.");
  }

  async function reassignMember(member: TeamMember) {
    const target = reassignTargets[member.id];
    if (!target) { showNotice("error", "Selecciona el integrante que recibirá el trabajo."); return; }
    const response = await fetch("/api/team", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "reassign", fromUserId: member.id, toUserId: target }) });
    const result = await response.json();
    if (!response.ok) { showNotice("error", result.error || "No se pudo reasignar el trabajo."); return; }
    await refreshTeamMembers();
    showNotice("success", `Trabajo reasignado: ${result.moved?.conversations || 0} conversaciones, ${result.moved?.tasks || 0} tareas y ${result.moved?.deals || 0} oportunidades.`);
  }

  async function enableNotifications() {
    if (!("Notification" in window)) { showNotice("error", "Este navegador no admite notificaciones."); return; }
    const permission = await Notification.requestPermission();
    showNotice(permission === "granted" ? "success" : "error", permission === "granted" ? "Notificaciones activadas." : "El navegador no autorizó las notificaciones.");
  }
  async function saveProperty(event: FormEvent) {
    event.preventDefault();
    const price = Number(propertyPrice);
    if (!tenantId || !propertyReference.trim() || !propertyTitle.trim() || !propertyCity.trim() || !Number.isFinite(price) || price < 0) { showNotice("error", "Completa referencia, título, ciudad y un precio válido."); return; }
    const supabase = createClientSupabase();
    if (!supabase) return;
    const { data, error } = await supabase.from("properties").insert({ tenant_id: tenantId, reference: propertyReference.trim(), title: propertyTitle.trim(), property_type: propertyType, operation: propertyOperation, price, currency: "HNL", city: propertyCity.trim(), zone: propertyZone.trim() || null, bedrooms: propertyBedrooms ? Number(propertyBedrooms) : null, status: "available" }).select("id, reference, title, property_type, operation, price, currency, city, zone, bedrooms, status").single();
    if (error) { showNotice("error", `No se pudo guardar el inmueble: ${error.message}`); return; }
    setProperties(current => [{ ...data, price: Number(data.price || 0) } as Property, ...current]);
    setPropertyReference(""); setPropertyTitle(""); setPropertyPrice(""); setPropertyCity(""); setPropertyZone(""); setPropertyBedrooms(""); setShowPropertyForm(false);
    showNotice("success", "Inmueble guardado en Supabase.");
  }
  async function updateRealEstateStatus(kind: "property" | "inquiry" | "visit", id: string, status: string) {
    const supabase = createClientSupabase();
    if (!supabase || !tenantId) return;
    const table = kind === "property" ? "properties" : kind === "inquiry" ? "property_inquiries" : "property_visits";
    const { error } = await supabase.from(table).update({ status }).eq("id", id).eq("tenant_id", tenantId);
    if (error) { showNotice("error", error.message); return; }
    if (kind === "property") setProperties(current => current.map(item => item.id === id ? { ...item, status: status as Property["status"] } : item));
    else if (kind === "inquiry") setPropertyInquiries(current => current.map(item => item.id === id ? { ...item, status: status as PropertyInquiry["status"] } : item));
    else setPropertyVisits(current => current.map(item => item.id === id ? { ...item, status: status as PropertyVisit["status"] } : item));
    showNotice("success", "Estado actualizado.");
  }
  const labels: Record<string, string> = { inicio: `${greeting}, ${account.name.split(" ")[0]}`, conversaciones: "Conversaciones", contactos: "Contactos", pipeline: "Pipeline comercial", pipeline_v2: "Pipeline comercial", tareas: "Tareas", calendario: "Calendario", inmobiliaria: "Gestión inmobiliaria", reservaciones:"Reservaciones", pedidos:"Pedidos", citas:"Citas", cotizaciones:"Cotizaciones", productos:"Productos", campos:"Campos personalizados", equipo: "Equipo y cuenta", automatizaciones: "Automatizaciones", reportes: "Reportes", auditoria: "Auditoría", configuracion: "Configuración" };
  const globalResults = useMemo(() => {
    const query = globalQuery.trim().toLowerCase();
    if (!query) return [];
    return [
      ...contacts.map(contact => ({ id: contact.id, title: contact.name, detail: `${contact.company} · ${contact.email}`, type: "Contacto", target: "contactos" })),
      ...threads.map((thread, index) => ({ id: `thread-${index}`, title: thread.name, detail: `${thread.channel} · ${thread.preview}`, type: "Conversación", target: "conversaciones", threadIndex: index })),
      ...deals.map(deal => ({ id: `deal-${deal.id}`, title: deal.title, detail: `${deal.contactName} · ${new Intl.NumberFormat("es-HN", { style: "currency", currency: "HNL", maximumFractionDigits: 0 }).format(deal.value)}`, type: "Oportunidad", target: "pipeline" }))
    ].filter(item => `${item.title} ${item.detail} ${item.type}`.toLowerCase().includes(query)).slice(0, 7);
  }, [globalQuery, contacts, threads, deals]);

  function openSearchResult(result: (typeof globalResults)[number]) {
    if ("threadIndex" in result && typeof result.threadIndex === "number") setSelectedThread(result.threadIndex);
    if (result.target === "contactos") setContactQuery(result.title);
    navigate(result.target); setGlobalQuery(""); setSearchOpen(false);
  }

  async function logout() {
    if (loggingOut) return;
    setLoggingOut(true);
    const supabase = createClientSupabase();
    try {
      void fetch("/api/auth/access-log", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ eventType: "logout" }) });
      await supabase?.auth.signOut({ scope: "local" });
    } finally {
      window.location.replace("/login?logged_out=1");
    }
  }

  async function saveBranding(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const companyName = brandingName.trim();
    const logoUrl = brandingLogoUrl.trim();
    if (!companyName || !tenantId) return;
    if (logoUrl && !/^https:\/\//i.test(logoUrl)) {
      showNotice("error", "La URL del logo debe comenzar con https://");
      return;
    }
    const supabase = createClientSupabase();
    if (!supabase) return;
    setSavingBranding(true);
    const { error } = await supabase.from("tenants").update({ name: companyName, logo_url: logoUrl || null }).eq("id", tenantId);
    setSavingBranding(false);
    if (error) { showNotice("error", `No se pudo guardar la identidad: ${error.message}`); return; }
    setTenantLogoUrl(logoUrl);
    setLogoFailed(false);
    setAccount(current => ({ ...current, company: companyName }));
    showNotice("success", "Identidad de la empresa actualizada.");
  }

  async function saveAssistant(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!tenantId || !assistantName.trim() || !knowledgeContent.trim()) { showNotice("error", "Completa el nombre y la información de la empresa."); return; }
    const supabase = createClientSupabase();
    if (!supabase) return;
    setSavingAssistant(true);
    const settingsRequest = supabase.from("assistant_settings").upsert({ tenant_id: tenantId, enabled: assistantEnabled, assistant_name: assistantName.trim(), instructions: assistantInstructions.trim(), handoff_message: handoffMessage.trim(), updated_at: new Date().toISOString() });
    const knowledgePayload = { tenant_id: tenantId, title: "Información principal", content: knowledgeContent.trim(), active: true, updated_at: new Date().toISOString() };
    const knowledgeRequest = knowledgeId ? supabase.from("knowledge_documents").update(knowledgePayload).eq("id", knowledgeId).eq("tenant_id", tenantId).select("id").single() : supabase.from("knowledge_documents").insert(knowledgePayload).select("id").single();
    const [settingsResult, knowledgeResult] = await Promise.all([settingsRequest, knowledgeRequest]);
    setSavingAssistant(false);
    if (settingsResult.error || knowledgeResult.error) { showNotice("error", settingsResult.error?.message || knowledgeResult.error?.message || "No se pudo guardar el asistente."); return; }
    if (knowledgeResult.data?.id) setKnowledgeId(knowledgeResult.data.id);
    showNotice("success", "Asistente y conocimiento actualizados.");
  }

  const currentThread = threads[selectedThread] || null;
  const totalUnread = threads.reduce((total, thread) => total + thread.unread, 0);
  const visibleMessages = currentThread?.messages.slice(-visibleMessageCount) || [];
  const hasOlderMessages = Boolean(currentThread && currentThread.messages.length > visibleMessageCount);

  useEffect(() => {
    setVisibleMessageCount(50);
    previousLastMessageRef.current = "";
    window.requestAnimationFrame(() => {
      const container = messagesRef.current;
      if (container) container.scrollTop = container.scrollHeight;
    });
  }, [currentThread?.id]);

  useEffect(() => {
    const container = messagesRef.current;
    const lastMessageId = currentThread?.messages.at(-1)?.id || "";
    if (!container || !lastMessageId || previousLastMessageRef.current === lastMessageId) return;
    const wasNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 120;
    const firstRender = !previousLastMessageRef.current;
    previousLastMessageRef.current = lastMessageId;
    if (firstRender || wasNearBottom) window.requestAnimationFrame(() => { container.scrollTop = container.scrollHeight; });
  }, [currentThread?.messages]);

  useEffect(() => {
    if (view !== "conversaciones" || !currentThread?.id || !tenantId || !userId || currentThread.unread === 0) return;
    const supabase = createClientSupabase();
    if (!supabase) return;
    void supabase.from("conversation_reads").upsert({ tenant_id: tenantId, conversation_id: currentThread.id, user_id: userId, last_read_at: new Date().toISOString() }, { onConflict: "conversation_id,user_id" });
    setThreads(current => current.map(item => item.id === currentThread.id ? { ...item, unread: 0 } : item));
  }, [view, currentThread?.id, currentThread?.unread, tenantId, userId]);

  function loadOlderMessages() {
    const container = messagesRef.current;
    const previousHeight = container?.scrollHeight || 0;
    const previousTop = container?.scrollTop || 0;
    setVisibleMessageCount(count => Math.min(count + 50, currentThread?.messages.length || count));
    window.requestAnimationFrame(() => {
      if (container) container.scrollTop = previousTop + (container.scrollHeight - previousHeight);
    });
  }

  if (!authReady) return <main className="auth-shell"><div className="auth-loading"><span className="brand-mark">G</span><strong>Abriendo Gavrion CRM…</strong></div></main>;

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand gavrion-brand tenant-brand">{tenantLogoUrl && !logoFailed ? <img className="tenant-logo" src={tenantLogoUrl} alt={`Logo de ${account.company || "la empresa"}`} onError={()=>setLogoFailed(true)} /> : <span className="brand-mark">{(account.company || "E").charAt(0).toUpperCase()}</span>}<span>{account.company || "Mi empresa"}</span></div>
      <nav className="nav">
        {([
          ["inicio", "⌂", "Inicio", "dashboard"],
          ["conversaciones", "◫", "Conversaciones", "conversations"],
          ["contactos", "♙", "Contactos", "contacts"],
          ["pipeline_v2", "◇", "Ventas / Pipeline", "pipeline"],
          ["tareas", "✓", "Tareas", "tasks"],
          ["calendario", "◷", "Calendario", "tasks"],
          ["inmobiliaria", "▤", "Inmobiliaria", "properties"],
          ["reservaciones", "▣", "Reservaciones", "reservations"],
          ["pedidos", "▤", "Pedidos", "orders"],
          ["citas", "◷", "Citas", "appointments"],
          ["cotizaciones", "◇", "Cotizaciones", "quotes"],
          ["productos", "▦", "Productos", "products"],
          ["automatizaciones", "⌁", "Automatizaciones", "automations"],
          ["reportes", "⌗", "Reportes", "reports"]
        ] as const).filter(([id,,,module]) => roleAllowsModule(id) && (enabledModules === null || enabledModules.includes(module))).map(([id, icon, label]) => <button key={id} onClick={() => navigate(id)} className={`nav-item ${view === id ? "active" : ""}`}><span>{icon}</span>{label}{id === "conversaciones" && totalUnread > 0 && <i aria-label={`${totalUnread} mensajes sin leer`}>{totalUnread}</i>}{id === "inmobiliaria" && <i aria-label="Gestiones pendientes">{propertyInquiries.filter(item => item.status === "new").length + propertyVisits.filter(item => item.status === "pending").length}</i>}</button>)}
      </nav>
      {isClientAdmin&&<div className="settings-nav-entry"><button type="button" aria-expanded={settingsMenuOpen} onClick={()=>{if(view!=="configuracion"){setSettingsMenuOpen(true);navigate("configuracion")}else setSettingsMenuOpen(value=>!value)}} className={`nav-item settings-parent ${view==="configuracion"?"active":""}`}><span>⚙</span><span>Configuración</span><b className={`settings-chevron ${settingsMenuOpen?"open":""}`}>⌄</b></button>{settingsMenuOpen&&<nav className="settings-sidebar-menu" aria-label="Submenú de configuración"><button type="button" className={view==="configuracion"&&settingsTab==="control"?"active":""} onClick={()=>openSettings("control")}><span>◎</span>Centro de control</button><button type="button" className={view==="configuracion"&&settingsTab==="empresa"?"active":""} onClick={()=>{setSettingsTab("empresa");navigate("configuracion")}}><span>⌂</span>Empresa y widget</button><button type="button" className={view==="configuracion"&&settingsTab==="canales"?"active":""} onClick={()=>{setSettingsTab("canales");navigate("configuracion")}}><span>◉</span>Canales y conexiones</button><button type="button" className={view==="configuracion"&&settingsTab==="asistente"?"active":""} onClick={()=>{setSettingsTab("asistente");navigate("configuracion")}}><span>✦</span>Asistente IA</button><button type="button" className={view==="equipo"?"active":""} onClick={()=>navigate("equipo")}><span>♧</span>Equipo y cuenta</button><button type="button" className={view==="campos"?"active":""} onClick={()=>navigate("campos")}><span>＋</span>Campos personalizados</button></nav>}</div>}
      <div className="sidebar-bottom"><div className="profile"><span className="avatar purple">{account.initials}</span><div><strong>{account.name}</strong><small>{account.role}{account.company ? ` · ${account.company}` : ""}</small><span className="profile-email">{account.email}</span></div></div><button className="logout-button" onClick={logout} disabled={loggingOut}><span>↪</span>{loggingOut ? "Cerrando sesión…" : "Cerrar sesión"}</button></div>
    </aside>
    <main className="main">
      {supportMode&&<div className="support-mode-banner"><strong>Modo soporte:</strong> estás operando dentro de {account.company}. Todas las acciones quedan registradas.<a href="/admin">Volver al panel</a></div>}
      <header className="topbar"><div><p className="eyebrow">GAVRION CRM</p><h1>{labels[view]}</h1></div><div className="topbar-actions"><div className="global-search-wrap"><label className="search">⌕ <input value={globalQuery} onChange={e=>{setGlobalQuery(e.target.value);setSearchOpen(true)}} onFocus={()=>setSearchOpen(true)} onKeyDown={e=>{if(e.key==="Escape")setSearchOpen(false)}} placeholder="Buscar clientes, mensajes..." /></label>{searchOpen&&globalQuery.trim()&&<div className="search-results open" role="listbox">{globalResults.length ? globalResults.map(result=><button type="button" className="search-result" key={result.id} onMouseDown={event=>event.preventDefault()} onClick={()=>openSearchResult(result)}><span className="search-result-icon">{result.type[0]}</span><div><strong>{result.title}</strong><small>{result.detail}</small></div><span className="search-result-type">{result.type}</span></button>) : <div className="search-empty">No encontramos resultados para “{globalQuery}”.</div>}</div>}</div>{isClientAdmin&&<NotificationBell refreshKey={bellRefresh} onOpen={openOwnerNotification} onSeeAll={()=>openSettings("control")} />}</div></header>
      {view === "inicio" && <section className="view active">
        <div className="hero-row"><div><p className="eyebrow">PANEL EJECUTIVO</p><h2>Resumen de tu operación</h2><p>Objetivos, progreso y actividad de tu empresa en un solo lugar.</p></div><select className="select" aria-label="Filtrar periodo" value={period} onChange={e => setPeriod(e.target.value as Period)}><option value="30d">Últimos 30 días</option><option value="week">Esta semana</option><option value="year">Este año</option></select></div>
        <div className="metrics-grid">{[
          { label: "Contactos activos", value: dashboardMetrics.contacts.toLocaleString("es-HN"), detail: `Datos reales · ${periodLabels[period]}` },
          { label: "Conversaciones", value: dashboardMetrics.conversations.toLocaleString("es-HN"), detail: `Datos reales · ${periodLabels[period]}` },
          { label: "Oportunidades", value: dashboardMetrics.deals.toLocaleString("es-HN"), detail: `${dashboardMetrics.won} ganada${dashboardMetrics.won === 1 ? "" : "s"} · ${periodLabels[period]}` },
          { label: "Pipeline abierto", value: new Intl.NumberFormat("es-HN", { style: "currency", currency: "HNL", maximumFractionDigits: 0 }).format(dashboardMetrics.pipeline), detail: `Excluye negocios ganados · ${periodLabels[period]}` }
        ].map((metric, index) => <article className="metric-card" key={metric.label}><div className={`metric-icon ${["mint","blue","amber","rose"][index]}`}>{["♙","◫","◈","$"][index]}</div><span>{metric.label}</span><strong>{metric.value}</strong><small>{metric.detail}</small></article>)}</div>
        <div className="dashboard-grid lower">
          <article className="panel activity-placeholder"><div className="panel-header"><div><h3>Actividad comercial</h3><p>Conversaciones y oportunidades de los últimos 7 días</p></div></div><div className="bars">{activity.map((height,index)=><span key={index} style={{height:`${height}%`}} title={`${height <= 3 ? 0 : "Actividad registrada"}`} />)}</div></article>
          <article className="panel tasks-panel">
            <div className="panel-header"><div><h3>Tareas de hoy</h3><p>{tasks.length-completed} pendientes</p></div><button className="icon-button" aria-label="Agregar tarea" onClick={()=>setCreating(true)}>＋</button></div>
            <div className="task-progress"><span style={{width:`${tasks.length ? completed/tasks.length*100 : 0}%`}} /></div>
            {creating && <form className="quick-task-form" onSubmit={createTask}><input value={title} onChange={e=>setTitle(e.target.value)} autoFocus placeholder="Escribe una nueva tarea..."/><input type="time" value={time} onChange={e=>setTime(e.target.value)}/><button className="send-button">✓</button><button type="button" className="icon-button" onClick={()=>setCreating(false)}>×</button></form>}
            <div>{dataLoading ? <p className="task-empty">Cargando tareas…</p> : visible.length ? visible.map(task => <div className={`task ${task.completed_at ? "done" : ""}`} key={task.id}><input aria-label={`Completar ${task.title}`} type="checkbox" checked={Boolean(task.completed_at)} onChange={()=>toggleTask(task)}/><span><strong>{task.title}</strong><small>{task.due_at?.slice(11,16) || "Sin hora"}</small></span><button className="task-delete persistent" aria-label={`Eliminar ${task.title}`} onClick={()=>deleteTask(task.id)}>×</button></div>) : <p className="task-empty">No hay tareas en este filtro.</p>}</div>
            <div className="task-footer"><div className="task-filters">{(["all","pending","done"] as const).map(value=><button key={value} className={`task-filter ${filter===value?"active":""}`} onClick={()=>setFilter(value)}>{value==="all"?"Todas":value==="pending"?"Pendientes":"Completadas"}</button>)}</div><small>{completed} de {tasks.length} completadas</small></div>
          </article>
        </div>
      </section>}

{view === "tareas" && <TasksView tasks={tasks} teamMembers={teamMembers} userId={userId} filter={taskViewFilter} onFilterChange={setTaskViewFilter} onToggle={toggleTask} onDelete={deleteTask} onCreate={addTask} />}
      {view === "calendario" && <CalendarView tasks={tasks} onToggle={toggleTask} />}
      {view === "conversaciones" && <section className="view active">
        <div className="section-heading"><div><h2>Bandeja unificada</h2><p>{totalUnread ? `${totalUnread} mensaje${totalUnread===1?"":"s"} sin leer` : "Todas las conversaciones están al día"}.</p></div><div className="section-actions"><button className="secondary-button" onClick={exportConversations}>Descargar CSV</button><button className="secondary-button" onClick={enableNotifications}>Activar notificaciones</button></div></div>
        {currentThread ? <div className="inbox-layout">
          <aside className="thread-list">{threads.map((thread,index)=><button key={thread.id} className={`thread ${selectedThread===index?"active":""}`} onClick={()=>setSelectedThread(index)}><span className="avatar">{thread.name.split(" ").map(x=>x[0]).slice(0,2).join("")}</span><span className="thread-info"><h4>{thread.name}</h4><p>{thread.preview}</p></span>{thread.unread>0?<i className="unread-badge">{thread.unread}</i>:<time>{thread.handlingMode==="waiting_agent"?"Requiere agente":thread.handlingMode==="human"?"Humano":"IA"}</time>}</button>)}</aside>
          <article className="chat-panel"><div className="chat-header"><span className="avatar">{currentThread.name[0]}</span><div><strong>{currentThread.name}</strong><small>{currentThread.channel} · {currentThread.handlingMode==="waiting_agent"?"esperando agente":currentThread.handlingMode==="human"?"atención humana":"asistente activo"}</small></div></div><div className="messages" ref={messagesRef}>{hasOlderMessages&&<button type="button" className="load-older" onClick={loadOlderMessages}>Cargar 50 mensajes anteriores</button>}{visibleMessages.map((item,index)=>{const currentDate=new Date(item.createdAt).toLocaleDateString("es-HN",{day:"numeric",month:"long",year:"numeric"});const previousDate=index?new Date(visibleMessages[index-1].createdAt).toLocaleDateString("es-HN",{day:"numeric",month:"long",year:"numeric"}):"";return <span className="message-group" key={item.id}>{currentDate!==previousDate&&<span className="message-date">{currentDate}</span>}<span className={`message ${item.direction==="outbound"?"out":"in"}`}>{item.text}<time>{new Date(item.createdAt).toLocaleTimeString("es-HN",{hour:"2-digit",minute:"2-digit"})}</time></span></span>})}</div><form className="composer" onSubmit={sendMessage}><input value={message} onChange={e=>setMessage(e.target.value)} placeholder="Escribe un mensaje..."/><button className="send-button" aria-label="Enviar">➤</button></form></article>
          <aside className="contact-panel"><div className="contact-hero"><span className="avatar">{currentThread.name[0]}</span><h3>{currentThread.name}</h3><p>{currentThread.externalThreadId}</p></div><div className="detail-group"><h4>Atención</h4><span className={`tag handling-${currentThread.handlingMode}`}>{currentThread.handlingMode==="waiting_agent"?"Requiere agente":currentThread.handlingMode==="human"?"Atención humana":"Asistente activo"}</span><div className="handoff-actions">{canOperateSales&&currentThread.handlingMode!=="human"&&<button className="primary-button" onClick={()=>setConversationMode("human")}>Tomar conversación</button>}{canOperateSales&&currentThread.handlingMode!=="bot"&&<button className="secondary-button" onClick={()=>setConversationMode("bot")}>Devolver al asistente</button>}</div></div><div className="detail-group"><h4>Responsable</h4><select disabled={!canOperateSales} className="select assignment-select" value={currentThread.assignedTo} onChange={event=>assignConversation(event.target.value)}><option value="">Asistente automático</option>{teamMembers.filter(member=>member.role!=="viewer").map(member=><option key={member.id} value={member.id}>{member.name}</option>)}</select></div><div className="detail-group"><h4>Canal</h4><span className="tag">{currentThread.channel}</span><span className="tag">Conversación real</span></div></aside>
        </div> : <div className="empty-feature"><div className="feature-visual">◫</div><h3>Aún no hay conversaciones</h3><p>Cuando llegue el primer mensaje aparecerá automáticamente en esta bandeja.</p></div>}
      </section>}

      {view === "equipo" && isClientAdmin && <section className="view active">
        <div className="section-heading"><div><h2>Equipo y permisos</h2><p>Gestiona quién accede al CRM y qué conversaciones atiende.</p></div></div>
        <div className="team-tabs" role="tablist" aria-label="Equipo y cuenta"><button type="button" className={teamTab === "members" ? "active" : ""} onClick={() => setTeamTab("members")}>Integrantes</button><button type="button" className={teamTab === "account" ? "active" : ""} onClick={() => setTeamTab("account")}>Mi cuenta</button></div>
        {teamTab === "members" && <div className="team-tab-content"><div className="team-workload-grid">{teamMembers.map(member=>{const workload=(member.workload?.conversations||0)+(member.workload?.tasks||0)+(member.workload?.deals||0);const targets=teamMembers.filter(candidate=>candidate.id!==member.id&&candidate.active!==false);return <article className={`panel member-workload ${member.active===false?"member-inactive":""}`} key={`work-${member.id}`}><div><strong>{member.name}</strong><span className={`status ${member.invitationStatus==="pending"?"lead":member.online?"online":"client"}`}>{member.invitationStatus==="pending"?"Invitación pendiente":member.active===false?"Sin acceso":member.online?"Conectado":"Activo"}</span></div><p><b>{member.workload?.conversations||0}</b> conversaciones · <b>{member.workload?.tasks||0}</b> tareas · <b>{member.workload?.deals||0}</b> oportunidades</p>{member.lastSeenAt&&<small className="member-last-seen">Último acceso: {new Date(member.lastSeenAt).toLocaleString("es-HN")}</small>}{member.role!=="owner"&&["owner","admin"].includes(currentRole)&&member.active!==false&&<div className="member-reassign"><select className="select" value={reassignTargets[member.id]||""} onChange={event=>setReassignTargets(current=>({...current,[member.id]:event.target.value}))}><option value="">Reasignar trabajo…</option>{targets.map(target=><option key={target.id} value={target.id}>{target.name}</option>)}</select><button type="button" className="ghost-button" disabled={!workload} onClick={()=>void reassignMember(member)}>Reasignar</button></div>}{member.role!=="owner"&&["owner","admin"].includes(currentRole)&&<button className={member.active===false?"ghost-button":"danger-button"} onClick={()=>void toggleMember(member)}>{member.active===false?"Reactivar acceso":workload?"Desactivar y reasignar":"Desactivar acceso"}</button>}</article>})}</div>
        {["owner","admin"].includes(currentRole) && <form className="team-invite panel" onSubmit={inviteMember}><label>Correo del integrante<input required type="email" value={inviteEmail} onChange={event=>setInviteEmail(event.target.value)} placeholder="asesor@empresa.com" /></label><label>Rol<select className="select" value={inviteRole} onChange={event=>setInviteRole(event.target.value as TeamMember["role"])}><option value="admin">Administrador</option><option value="agent">Agente</option><option value="viewer">Consulta</option></select></label><button className="primary-button" disabled={inviting}>{inviting?"Enviando…":"Invitar integrante"}</button></form>}
        <article className="panel table-panel team-table"><div className="panel-header"><div><h3>Integrantes</h3><p>{teamMembers.length} usuario{teamMembers.length===1?"":"s"} en esta empresa</p></div></div><div className="table-scroll"><table><thead><tr><th>Integrante</th><th>Correo</th><th>Rol</th></tr></thead><tbody>{teamMembers.map(member=><tr key={member.id}><td><div className="contact-cell"><span className="avatar">{member.name.charAt(0).toUpperCase()}</span><span><strong>{member.name}</strong>{member.id===userId&&<small>Tu cuenta</small>}</span></div></td><td>{member.email}</td><td>{member.role==="owner"?<span className="status client">Propietario</span>:<select className="select team-role" value={member.role} disabled={!(["owner","admin"].includes(currentRole))} onChange={event=>changeMemberRole(member,event.target.value as TeamMember["role"])}><option value="admin">Administrador</option><option value="agent">Agente</option><option value="viewer">Consulta</option></select>}</td></tr>)}</tbody></table></div></article></div>}
        {teamTab === "account" && <AccountTab />}
      </section>}

      {view === "inmobiliaria" && <section className="view active"><div className="section-heading"><div><h2>Gestión inmobiliaria</h2><p>Inventario, clientes interesados y visitas registradas por el asistente.</p></div><button className="primary-button" onClick={()=>setShowPropertyForm(true)}>＋ Nuevo inmueble</button></div>{showPropertyForm&&<form className="inline-create property-create" onSubmit={saveProperty}><input required autoFocus value={propertyReference} onChange={e=>setPropertyReference(e.target.value)} placeholder="Referencia: MET-001"/><input required value={propertyTitle} onChange={e=>setPropertyTitle(e.target.value)} placeholder="Título del inmueble"/><select className="select" value={propertyType} onChange={e=>setPropertyType(e.target.value)}><option value="house">Casa</option><option value="apartment">Apartamento</option><option value="land">Terreno</option><option value="commercial">Local comercial</option><option value="office">Oficina</option><option value="other">Otro</option></select><select className="select" value={propertyOperation} onChange={e=>setPropertyOperation(e.target.value as "sale"|"rent")}><option value="sale">Venta</option><option value="rent">Alquiler</option></select><input required type="number" min="0" value={propertyPrice} onChange={e=>setPropertyPrice(e.target.value)} placeholder="Precio HNL"/><input required value={propertyCity} onChange={e=>setPropertyCity(e.target.value)} placeholder="Ciudad"/><input value={propertyZone} onChange={e=>setPropertyZone(e.target.value)} placeholder="Zona o colonia"/><input type="number" min="0" value={propertyBedrooms} onChange={e=>setPropertyBedrooms(e.target.value)} placeholder="Habitaciones"/><button className="primary-button">Guardar</button><button type="button" className="ghost-button" onClick={()=>setShowPropertyForm(false)}>Cancelar</button></form>}<div className="requests-grid"><article className="panel table-panel"><div className="panel-header"><div><h3>Propiedades</h3><p>{properties.filter(item=>item.status==="available").length} disponibles</p></div><button className="secondary-button" onClick={exportProperties}>Descargar CSV</button></div><div className="table-scroll"><table><thead><tr><th>Inmueble</th><th>Ubicación</th><th>Precio</th><th>Estado</th></tr><tr className="column-filters"><th><input placeholder="Filtrar" value={propertyFilters.reference} onChange={e=>setPropertyFilters(x=>({...x,reference:e.target.value}))}/></th><th><input placeholder="Filtrar" value={propertyFilters.location} onChange={e=>setPropertyFilters(x=>({...x,location:e.target.value}))}/></th><th></th><th><select value={propertyFilters.status} onChange={e=>setPropertyFilters(x=>({...x,status:e.target.value}))}><option value="">Todos</option><option value="available">Disponible</option><option value="reserved">Reservada</option><option value="sold">Vendida</option><option value="rented">Alquilada</option><option value="inactive">Inactiva</option></select></th></tr></thead><tbody>{filteredProperties.length?filteredProperties.map(item=><tr key={item.id}><td><strong>{item.reference} · {item.title}</strong><small>{item.property_type} · {item.operation==="sale"?"Venta":"Alquiler"}</small></td><td>{item.city}{item.zone&&<small>{item.zone}</small>}</td><td>{new Intl.NumberFormat("es-HN",{style:"currency",currency:item.currency||"HNL",maximumFractionDigits:0}).format(item.price)}</td><td><select className="select request-status" value={item.status} onChange={e=>updateRealEstateStatus("property",item.id,e.target.value)}><option value="available">Disponible</option><option value="reserved">Reservada</option><option value="sold">Vendida</option><option value="rented">Alquilada</option><option value="inactive">Inactiva</option></select></td></tr>):<tr><td colSpan={4} className="table-empty">Aún no hay inmuebles registrados.</td></tr>}</tbody></table></div></article><article className="panel table-panel"><div className="panel-header"><div><h3>Clientes interesados</h3><p>{propertyInquiries.filter(item=>item.status==="new").length} nuevos</p></div><button className="secondary-button" onClick={exportInquiries}>Descargar CSV</button></div><div className="table-scroll"><table><thead><tr><th>Cliente</th><th>Búsqueda</th><th>Presupuesto</th><th>Estado</th></tr><tr className="column-filters"><th><input placeholder="Filtrar" value={inquiryFilters.customer} onChange={e=>setInquiryFilters(x=>({...x,customer:e.target.value}))}/></th><th><input placeholder="Filtrar" value={inquiryFilters.location} onChange={e=>setInquiryFilters(x=>({...x,location:e.target.value}))}/></th><th></th><th><select value={inquiryFilters.status} onChange={e=>setInquiryFilters(x=>({...x,status:e.target.value}))}><option value="">Todos</option><option value="new">Nuevo</option><option value="contacted">Contactado</option><option value="qualified">Calificado</option><option value="closed">Cerrado</option><option value="discarded">Descartado</option></select></th></tr></thead><tbody>{filteredInquiries.length?filteredInquiries.map(item=><tr key={item.id}><td><strong>{item.customer_name}</strong><small>{item.phone}</small></td><td>{item.intent==="buy"?"Compra":item.intent==="rent"?"Alquiler":"Venta"} · {item.property_type||"Inmueble"}<small>{[item.city,item.zone].filter(Boolean).join(" · ")||"Sin ubicación"}{item.bedrooms?` · ${item.bedrooms} hab.`:""}</small></td><td>{item.budget_max?new Intl.NumberFormat("es-HN",{style:"currency",currency:"HNL",maximumFractionDigits:0}).format(item.budget_max):"Por definir"}{item.notes&&<small>{item.notes}</small>}</td><td><select className="select request-status" value={item.status} onChange={e=>updateRealEstateStatus("inquiry",item.id,e.target.value)}><option value="new">Nuevo</option><option value="contacted">Contactado</option><option value="qualified">Calificado</option><option value="closed">Cerrado</option><option value="discarded">Descartado</option></select></td></tr>):<tr><td colSpan={4} className="table-empty">Aún no hay interesados.</td></tr>}</tbody></table></div></article><article className="panel table-panel"><div className="panel-header"><div><h3>Solicitudes de visita</h3><p>{propertyVisits.filter(item=>item.status==="pending").length} pendientes</p></div><button className="secondary-button" onClick={exportVisits}>Descargar CSV</button></div><div className="table-scroll"><table><thead><tr><th>Cliente</th><th>Propiedad</th><th>Fecha</th><th>Estado</th></tr><tr className="column-filters"><th><input placeholder="Filtrar" value={visitFilters.customer} onChange={e=>setVisitFilters(x=>({...x,customer:e.target.value}))}/></th><th><input placeholder="Filtrar" value={visitFilters.property} onChange={e=>setVisitFilters(x=>({...x,property:e.target.value}))}/></th><th></th><th><select value={visitFilters.status} onChange={e=>setVisitFilters(x=>({...x,status:e.target.value}))}><option value="">Todos</option><option value="pending">Pendiente</option><option value="confirmed">Confirmada</option><option value="completed">Completada</option><option value="cancelled">Cancelada</option></select></th></tr></thead><tbody>{filteredVisits.length?filteredVisits.map(item=><tr key={item.id}><td><strong>{item.customer_name}</strong><small>{item.phone}</small></td><td>{item.property_reference}<small>{item.party_size} visitante{item.party_size===1?"":"s"}</small></td><td>{new Date(`${item.requested_date}T00:00:00`).toLocaleDateString("es-HN")} · {item.requested_time.slice(0,5)}</td><td><select className="select request-status" value={item.status} onChange={e=>updateRealEstateStatus("visit",item.id,e.target.value)}><option value="pending">Pendiente</option><option value="confirmed">Confirmada</option><option value="completed">Completada</option><option value="cancelled">Cancelada</option></select></td></tr>):<tr><td colSpan={4} className="table-empty">Aún no hay visitas solicitadas.</td></tr>}</tbody></table></div></article></div></section>}
      {view === "reservaciones" && tenantId && <OperationalModule tenantId={tenantId} module="reservations" />}
      {view === "pipeline_v2" && tenantId && <PipelineWorkspace tenantId={tenantId} contacts={contacts} userId={userId} canConfigure={["owner","admin"].includes(currentRole)} />}
      {view === "campos" && isClientAdmin && tenantId && <CustomFields tenantId={tenantId} />}
      {view === "pedidos" && tenantId && <OperationalModule tenantId={tenantId} module="orders" />}
      {view === "citas" && tenantId && <OperationalModule tenantId={tenantId} module="appointments" />}
      {view === "cotizaciones" && tenantId && <OperationalModule tenantId={tenantId} module="quotes" />}
      {view === "productos" && tenantId && <OperationalModule tenantId={tenantId} module="products" />}

      {view === "contactos" && <section className="view active"><div className="section-heading"><div><h2>Contactos</h2><p>Clientes y prospectos guardados en Supabase.</p></div><div className="section-actions"><button className="secondary-button" onClick={exportContacts}>Descargar CSV</button><button className="primary-button" onClick={openNewContact}>＋ Nuevo contacto</button></div></div>{showContactForm&&<form className="inline-create contact-create" onSubmit={saveContact}><input autoFocus required value={contactName} onChange={e=>setContactName(e.target.value)} placeholder="Nombre completo"/><input type="email" value={contactEmail} onChange={e=>setContactEmail(e.target.value)} placeholder="Correo"/><input value={contactPhone} onChange={e=>setContactPhone(e.target.value)} placeholder="Teléfono"/><input value={contactCompany} onChange={e=>setContactCompany(e.target.value)} placeholder="Empresa"/><select className="select" value={contactStatus} onChange={e=>setContactStatus(e.target.value as Contact["status"])} aria-label="Estado del contacto"><option>Prospecto</option><option>Cliente</option><option>Inactivo</option></select><button className="primary-button">{editingContactId ? "Actualizar" : "Guardar"}</button><button type="button" className="ghost-button" onClick={closeContactForm}>Cancelar</button></form>}<article className="panel table-panel"><div className="table-tools"><label className="search">⌕ <input value={contactQuery} onChange={e=>setContactQuery(e.target.value)} placeholder="Buscar contacto..."/></label></div><div className="table-scroll"><table><thead><tr><th>Contacto</th><th>Empresa</th><th>Teléfono</th><th>Estado</th><th>Acciones</th></tr><tr className="column-filters"><th><input aria-label="Filtrar por contacto" value={contactFilters.name} onChange={e=>setContactFilters(c=>({...c,name:e.target.value}))} placeholder="Filtrar" /></th><th><input aria-label="Filtrar por empresa" value={contactFilters.company} onChange={e=>setContactFilters(c=>({...c,company:e.target.value}))} placeholder="Filtrar" /></th><th><input aria-label="Filtrar por teléfono" value={contactFilters.phone} onChange={e=>setContactFilters(c=>({...c,phone:e.target.value}))} placeholder="Filtrar" /></th><th><select value={contactFilters.status} onChange={e=>setContactFilters(c=>({...c,status:e.target.value}))}><option value="">Todos</option><option>Prospecto</option><option>Cliente</option><option>Inactivo</option></select></th><th><button type="button" className="ghost-button" onClick={()=>setContactFilters({name:"",company:"",phone:"",status:""})}>Limpiar</button></th></tr></thead><tbody>{dataLoading ? <tr><td colSpan={5} className="table-empty">Cargando contactos…</td></tr> : filteredContacts.map(contact=><tr key={contact.id}><td><div className="contact-cell"><span className="avatar">{contact.name[0]}</span><span><strong>{contact.name}</strong><small>{contact.email || "Sin correo"}</small></span></div></td><td>{contact.company || "—"}</td><td>{contact.phone || "—"}</td><td><span className={`status ${contact.status==="Cliente"?"client":contact.status==="Inactivo"?"inactive":"lead"}`}>{contact.status}</span></td><td><div className="row-actions"><button className="ghost-button" onClick={()=>editContact(contact)}>Editar</button><button className="ghost-button" onClick={()=>navigate("conversaciones")}>Contactar</button><button className="danger-button" onClick={()=>deleteContact(contact.id)}>Eliminar</button></div></td></tr>)}</tbody></table></div></article></section>}

      {view === "pipeline" && <section className="view active"><div className="section-heading"><div><h2>Pipeline comercial</h2><p>Oportunidades persistentes vinculadas a tus contactos.</p></div><button className="primary-button" onClick={openNewDeal}>＋ Nueva oportunidad</button></div>{showDealForm&&<form className="inline-create deal-create" onSubmit={saveDeal}><input required autoFocus value={dealTitle} onChange={e=>setDealTitle(e.target.value)} placeholder="Título de la oportunidad"/><select className="select" value={dealContactId} onChange={e=>setDealContactId(e.target.value)} aria-label="Contacto relacionado"><option value="">Sin contacto</option>{contacts.map(contact=><option value={contact.id} key={contact.id}>{contact.name}</option>)}</select><input required type="number" min="0" step="0.01" value={dealValue} onChange={e=>setDealValue(e.target.value)} placeholder="Valor en HNL"/><select className="select" value={dealStage} onChange={e=>setDealStage(e.target.value as DealStage)} aria-label="Etapa">{dealStages.map(stage=><option key={stage.id} value={stage.id}>{stage.label}</option>)}</select><input type="date" value={dealCloseDate} onChange={e=>setDealCloseDate(e.target.value)} aria-label="Fecha estimada de cierre"/><button className="primary-button">{editingDealId ? "Actualizar" : "Guardar"}</button><button type="button" className="ghost-button" onClick={closeDealForm}>Cancelar</button></form>}<div className="kanban">{dealStages.map(stage=><div className="kanban-column" key={stage.id}><div className="kanban-title">{stage.label}<span>{deals.filter(deal=>deal.stage===stage.id).length}</span></div>{deals.filter(deal=>deal.stage===stage.id).map(deal=><article className="deal-card" key={deal.id}><h4>{deal.title}</h4><p>{deal.contactName}</p>{deal.expectedCloseDate&&<small>Cierre: {new Date(`${deal.expectedCloseDate}T00:00:00`).toLocaleDateString("es-HN")}</small>}<div className="deal-footer"><strong>{new Intl.NumberFormat("es-HN", { style: "currency", currency: "HNL", maximumFractionDigits: 0 }).format(deal.value)}</strong><div className="deal-actions"><button className="ghost-button" onClick={()=>editDeal(deal)}>Editar</button>{stage.id!=="won"&&<button className="ghost-button" onClick={()=>moveDeal(deal)}>Avanzar →</button>}<button className="danger-button" onClick={()=>deleteDeal(deal.id)}>×</button></div></div></article>)}{!dataLoading&&!deals.some(deal=>deal.stage===stage.id)&&<p className="kanban-empty">Sin oportunidades</p>}</div>)}</div></section>}

      {view === "automatizaciones" && isClientAdmin && <AutomationsView />}

      {view === "reportes" && <ReportsView />}
      {view === "auditoria" && isClientAdmin && <AuditView />}

      {view === "configuracion" && isClientAdmin && <section className="view active">
        <div className="section-heading"><div><h2>Configuración</h2><p>Administra la identidad y los servicios de esta empresa.</p></div></div>
        <div className="settings-tab-caption"><span>{settingsTab==="control"?"Alertas, salud de integraciones, actividad y control de tus datos":settingsTab==="empresa"?"Identidad y experiencia del cliente":settingsTab==="canales"?"Conecta y administra tus canales de mensajería":settingsTab==="asistente"?"Define cómo responde tu asistente automático":"Configura las respuestas y el conocimiento de tu empresa"}</span>{setupTabs.includes(settingsTab)&&<span className="settings-tab-step">{setupTabs.indexOf(settingsTab)+1} de {setupTabs.length}</span>}</div>
        {settingsTab==="control"&&<OwnerCenter onNavigateSettings={tab=>{if(setupTabs.includes(tab as SettingsTab))setSettingsTab(tab as SettingsTab)}} onOpenNotification={openOwnerNotification} onChanged={()=>setBellRefresh(value=>value+1)} />}
        {settingsTab==="empresa"&&<CompanySettings />}
        {settingsTab==="canales"&&<MetaConnections />}
        {settingsTab==="asistente"&&<form className="panel assistant-settings" onSubmit={saveAssistant}><div className="assistant-settings-head"><div><p className="eyebrow">ASISTENTE AUTOMÁTICO</p><h3>Conocimiento de la empresa</h3><p>Escribe información confirmada sobre servicios, horarios, ubicación, precios, políticas y preguntas frecuentes.</p></div><label className="assistant-switch"><input type="checkbox" checked={assistantEnabled} onChange={e=>setAssistantEnabled(e.target.checked)} /> Respuestas automáticas</label></div><div className="assistant-fields"><label>Nombre del asistente<input value={assistantName} onChange={e=>setAssistantName(e.target.value)} placeholder="Asistente virtual" /></label><label>Instrucciones de tono<input value={assistantInstructions} onChange={e=>setAssistantInstructions(e.target.value)} placeholder="Amable, breve y profesional" /></label></div><label>Información para responder<textarea required rows={10} value={knowledgeContent} onChange={e=>setKnowledgeContent(e.target.value)} placeholder={'Ejemplo:\nHorario: todos los días de 6:30 a. m. a 9:00 p. m.\nUbicación: CA-4, km 115.\nEspecialidades: sopa de gallina india, pescado frito...'} /></label><label>Mensaje de transferencia<input value={handoffMessage} onChange={e=>setHandoffMessage(e.target.value)} /></label><div className="assistant-save"><small>La IA transferirá cuando no encuentre una respuesta confirmada o el visitante pida una persona.</small><button className="primary-button" disabled={savingAssistant}>{savingAssistant?"Guardando…":"Guardar y activar"}</button></div></form>}
      </section>}
      {!["inicio","conversaciones","tareas","calendario","inmobiliaria","reservaciones","pedidos","citas","cotizaciones","productos","contactos","pipeline_v2","campos","equipo","automatizaciones","reportes","auditoria","configuracion","pipeline"].includes(view) || !roleAllowsModule(view) ? <section className="view active role-restricted"><div className="empty-feature"><div className="feature-visual">⛨</div><h3>Acceso limitado por rol</h3><p>Tu cuenta puede operar las conversaciones y ventas asignadas. Solicita a un administrador del cliente el acceso a esta sección.</p></div></section> : null}
      {notice&&<div className={`crm-notice ${notice.type}`} role="status">{notice.text}</div>}
    </main>
  </div>;
}

type TaskCenterProps = {
  tasks: Task[];
  teamMembers: TeamMember[];
  userId: string;
  filter: TaskViewFilter;
  onFilterChange: (filter: TaskViewFilter) => void;
  onToggle: (task: Task) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onCreate: (title: string, time: string) => Promise<void>;
};

const taskFilterLabels: Record<TaskViewFilter, string> = {
  mine: "Mis tareas",
  team: "Tareas del equipo",
  today: "Pendientes de hoy",
  overdue: "Vencidas",
  followups: "Próximos seguimientos",
  conversations: "Desde conversaciones",
  forms: "Desde formularios del sitio"
};

function taskSourceLabel(source: Task["source"]) {
  if (source === "conversation") return "Conversación";
  if (source === "form") return "Formulario del sitio";
  if (source === "followup") return "Seguimiento";
  return "Creada manualmente";
}

function formatTaskDate(value: string | null) {
  if (!value) return "Sin fecha";
  return new Date(value).toLocaleString("es-HN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

function localDateKey(value: Date) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

function TasksView({ tasks, teamMembers, userId, filter, onFilterChange, onToggle, onDelete, onCreate }: TaskCenterProps) {
  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newTime, setNewTime] = useState("15:00");
  const now = new Date();
  const todayKey = localDateKey(now);
  const filtered = tasks.filter(task => {
    const due = task.due_at ? new Date(task.due_at) : null;
    const dueKey = due && !Number.isNaN(due.getTime()) ? localDateKey(due) : "";
    if (filter === "mine") return task.assigned_to === userId;
    if (filter === "today") return dueKey === todayKey && !task.completed_at;
    if (filter === "overdue") return Boolean(due && due.getTime() < now.getTime() && !task.completed_at);
    if (filter === "followups") return task.source === "followup" && !task.completed_at;
    if (filter === "conversations") return task.source === "conversation";
    if (filter === "forms") return task.source === "form";
    return true;
  });
  const pending = filtered.filter(task => !task.completed_at).length;
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!newTitle.trim()) return;
    await onCreate(newTitle, newTime);
    setNewTitle("");
    setCreating(false);
  };
  return <section className="view active tasks-center-view">
    <div className="section-heading"><div><p className="eyebrow">OPERACIÓN DIARIA</p><h2>Tareas</h2><p>Organiza seguimientos, pendientes y acciones que nacen desde el CRM y tu sitio web.</p></div><button className="primary-button" onClick={() => setCreating(true)}>＋ Nueva tarea</button></div>
    {creating && <form className="panel task-center-create" onSubmit={submit}><input required autoFocus value={newTitle} onChange={event => setNewTitle(event.target.value)} placeholder="Ej. Dar seguimiento a un nuevo interesado" /><input type="time" value={newTime} onChange={event => setNewTime(event.target.value)} aria-label="Hora de la tarea" /><button className="primary-button">Crear tarea</button><button type="button" className="ghost-button" onClick={() => setCreating(false)}>Cancelar</button></form>}
    <div className="task-center-filters" role="tablist" aria-label="Filtros de tareas">{(Object.keys(taskFilterLabels) as TaskViewFilter[]).map(key => <button type="button" role="tab" aria-selected={filter === key} className={filter === key ? "active" : ""} key={key} onClick={() => onFilterChange(key)}>{taskFilterLabels[key]}</button>)}</div>
    <article className="panel task-center-panel"><div className="panel-header"><div><h3>{taskFilterLabels[filter]}</h3><p>{pending} pendiente{pending === 1 ? "" : "s"} · {filtered.length} en este filtro</p></div><span className="task-center-count">{filtered.length}</span></div><div className="task-center-list">{filtered.length ? filtered.map(task => { const assignee = teamMembers.find(member => member.id === task.assigned_to); return <div className={`task-center-row ${task.completed_at ? "done" : ""}`} key={task.id}><input type="checkbox" checked={Boolean(task.completed_at)} onChange={() => void onToggle(task)} aria-label={`Completar ${task.title}`} /><div className="task-center-main"><strong>{task.title}</strong><small>{formatTaskDate(task.due_at)} · {assignee?.name || "Sin asignar"}</small></div><span className={`task-source ${task.source || "manual"}`}>{taskSourceLabel(task.source)}</span><button type="button" className="task-delete persistent" onClick={() => void onDelete(task.id)} aria-label={`Eliminar ${task.title}`}>×</button></div>; }) : <div className="task-center-empty"><span>✓</span><strong>No hay tareas en este filtro</strong><p>Cuando llegue una solicitud o crees un seguimiento, aparecerá aquí.</p></div>}</div></article>
  </section>;
}

function CalendarView({ tasks, onToggle }: { tasks: Task[]; onToggle: (task: Task) => Promise<void> }) {
  const today = new Date();
  const [selectedDate, setSelectedDate] = useState(localDateKey(today));
  const first = new Date(today.getFullYear(), today.getMonth(), 1);
  const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
  const offset = (first.getDay() + 6) % 7;
  const cells: Array<Date | null> = Array.from({ length: offset + daysInMonth }, (_, index) => index < offset ? null : new Date(today.getFullYear(), today.getMonth(), index - offset + 1));
  const selectedTasks = tasks.filter(task => task.due_at && localDateKey(new Date(task.due_at)) === selectedDate);
  const upcoming = tasks.filter(task => task.due_at && !task.completed_at && new Date(task.due_at).getTime() >= Date.now()).sort((a, b) => new Date(a.due_at || 0).getTime() - new Date(b.due_at || 0).getTime()).slice(0, 8);
  return <section className="view active calendar-view">
    <div className="section-heading"><div><p className="eyebrow">PLANIFICACIÓN</p><h2>Calendario</h2><p>Visualiza vencimientos y próximos seguimientos en un solo lugar.</p></div></div>
    <div className="calendar-layout"><article className="panel calendar-panel"><div className="calendar-heading"><h3>{today.toLocaleDateString("es-HN", { month: "long", year: "numeric" })}</h3><span>{tasks.filter(task => !task.completed_at).length} pendientes</span></div><div className="calendar-weekdays">{["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"].map(day => <span key={day}>{day}</span>)}</div><div className="calendar-grid">{cells.map((date, index) => { const key = date ? localDateKey(date) : `empty-${index}`; const dayTasks = date ? tasks.filter(task => task.due_at && localDateKey(new Date(task.due_at)) === key) : []; return date ? <button type="button" className={`calendar-day ${key === selectedDate ? "selected" : ""} ${key === localDateKey(today) ? "today" : ""}`} key={key} onClick={() => setSelectedDate(key)}><strong>{date.getDate()}</strong>{dayTasks.slice(0, 3).map(task => <span className={task.completed_at ? "done" : ""} key={task.id}>{task.title}</span>)}{dayTasks.length > 3 && <small>+{dayTasks.length - 3} más</small>}</button> : <span className="calendar-day empty" key={key} />; })}</div></article><aside className="panel calendar-agenda"><div className="panel-header"><div><p className="eyebrow">AGENDA</p><h3>{selectedTasks.length ? "Tareas del día" : "Próximos seguimientos"}</h3></div></div>{selectedTasks.length ? selectedTasks.map(task => <label className={`calendar-task ${task.completed_at ? "done" : ""}`} key={task.id}><input type="checkbox" checked={Boolean(task.completed_at)} onChange={() => void onToggle(task)} /><span><strong>{task.title}</strong><small>{formatTaskDate(task.due_at)}</small></span></label>) : upcoming.map(task => <label className="calendar-task" key={task.id}><input type="checkbox" checked={Boolean(task.completed_at)} onChange={() => void onToggle(task)} /><span><strong>{task.title}</strong><small>{formatTaskDate(task.due_at)}</small></span></label>)}{!selectedTasks.length && !upcoming.length && <p className="task-empty">No hay tareas programadas.</p>}</aside></div>
  </section>;
}