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
import { hasTenantPermission, tenantPermissionLabels, type TenantPermission } from "@/lib/permissions";
type CalendarEventKind = "task" | "reservation" | "appointment" | "property_visit" | "external";
type CalendarEvent = { id: string; kind: CalendarEventKind; title: string; start: string; end?: string | null; detail?: string; status?: string | null; sourceId?: string; editable?: boolean };

const periodLabels: Record<Period, string> = { week: "esta semana", "30d": "últimos 30 días", year: "este año" };
const dealStages: { id: DealStage; label: string }[] = [{ id: "new", label: "Nuevo" }, { id: "proposal", label: "Propuesta" }, { id: "negotiation", label: "Negociación" }, { id: "won", label: "Ganado" }];
type ChatMessage = { id: string; text: string; direction: "inbound" | "outbound"; createdAt: string };
type Thread = { id: string; name: string; channel: string; preview: string; contactId: string; externalThreadId: string; handlingMode: "bot" | "waiting_agent" | "human"; assignedTo: string; unread: number; messages: ChatMessage[] };
type TeamMember = { id: string; name: string; email: string; role: "owner" | "admin" | "agent" | "viewer"; permissions?: Partial<Record<TenantPermission, boolean>>; active?:boolean; invitationStatus?:string; invitedAt?: string | null; lastSeenAt?: string | null; online?: boolean; workload?:{conversations:number;tasks:number;deals:number} };
type Property = { id: string; reference: string; title: string; property_type: string; operation: "sale" | "rent"; price: number; currency: string; city: string; zone: string | null; bedrooms: number | null; status: "available" | "reserved" | "sold" | "rented" | "inactive" };
type PropertyInquiry = { id: string; customer_name: string; phone: string; intent: "buy" | "rent" | "sell"; property_type: string | null; city: string | null; zone: string | null; budget_max: number | null; bedrooms: number | null; notes: string | null; status: "new" | "contacted" | "qualified" | "closed" | "discarded" };
type PropertyVisit = { id: string; property_reference: string; customer_name: string; phone: string; requested_date: string; requested_time: string; party_size: number; notes: string | null; status: "pending" | "confirmed" | "completed" | "cancelled" }; type Reservation = { id: string; customer_name: string; reservation_date: string; reservation_time: string; party_size: number; status: string }; type Appointment = { id: string; customer_name: string; service: string; scheduled_at: string; status: string };
type SettingsTab = "control" | "empresa" | "canales" | "asistente";
type TaskViewFilter = "mine" | "team" | "today" | "overdue" | "followups" | "conversations" | "forms";
type DashboardGoals = { revenue: number; leads: number; responseMinutes: number };
const defaultDashboardGoals: DashboardGoals = { revenue: 0, leads: 0, responseMinutes: 30 };
const teamPermissionOptions: TenantPermission[] = ["sales.view", "sales.edit", "contacts.export", "reports.financial", "automations.manage", "integrations.manage"];
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
  const [savingPermission, setSavingPermission] = useState<string | null>(null);
  const [tenantId, setTenantId] = useState("");
  const [tenantOptions, setTenantOptions] = useState<Array<{ id: string; name: string; role: string }>>([]);
  const [tenantSelectionRequired, setTenantSelectionRequired] = useState(false);
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
  const [dashboardMetrics, setDashboardMetrics] = useState({ contacts: 0, conversations: 0, deals: 0, won: 0, pipeline: 0, wonValue: 0 });
  const [dashboardGoals, setDashboardGoals] = useState<DashboardGoals>(defaultDashboardGoals);
  const [tenantSettings, setTenantSettings] = useState<Record<string, unknown>>({});
  const [savingDashboardGoals, setSavingDashboardGoals] = useState(false);
  const [activity, setActivity] = useState<number[]>([0, 0, 0, 0, 0, 0, 0]);
  const [metricsVersion, setMetricsVersion] = useState(0);
  const [tasks, setTasks] = useState<Task[]>([]);  const [calendarEvents, setCalendarEvents] = useState<CalendarEvent[]>([]);
  const [filter, setFilter] = useState<"all" | "pending" | "done">("all");
  const [taskViewFilter, setTaskViewFilter] = useState<TaskViewFilter>("mine");
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const [time, setTime] = useState("15:00");
  const visible = useMemo(() => tasks.filter(t => filter === "all" || (filter === "done" ? t.completed_at : !t.completed_at)), [tasks, filter]);
  const completed = tasks.filter(t => t.completed_at).length;
  const isClientAdmin = !supportMode && hasTenantPermission(currentRole, "settings.manage");
  const canOperateSales = supportMode || hasTenantPermission(currentRole, "sales.edit");
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
  function exportContacts() { if (!hasTenantPermission(currentRole, "contacts.export") && !supportMode) { showNotice("error", "No tienes permiso para exportar contactos."); return; } downloadCsv("contactos", filteredContacts, [{ key: "name", label: "Nombre", value: contact => contact.name }, { key: "email", label: "Correo", value: contact => contact.email }, { key: "phone", label: "Teléfono", value: contact => contact.phone }, { key: "company", label: "Empresa", value: contact => contact.company }, { key: "status", label: "Estado", value: contact => contact.status }]); }
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
  const [conversationPage, setConversationPage] = useState(1);
  const [hasMoreConversations, setHasMoreConversations] = useState(false);
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
        const { data: activeMemberships } = await supabase.from("memberships").select("tenant_id, role, active").eq("user_id", user.id).eq("active", true).order("tenant_id", { ascending: true });
        const membershipRows = activeMemberships || [];
        const tenantIds = membershipRows.map(row => row.tenant_id).filter(Boolean);
        const { data: tenantRows } = tenantIds.length ? await supabase.from("tenants").select("id, name").in("id", tenantIds) : { data: [] as Array<{ id: string; name: string }> };
        const tenantNames = new Map((tenantRows || []).map(row => [row.id, row.name || row.id]));
        const options = membershipRows.map(row => ({ id: row.tenant_id, name: tenantNames.get(row.tenant_id) || row.tenant_id, role: row.role }));
        setTenantOptions(options);
        const supportTenant = new URLSearchParams(window.location.search).get("supportTenant");
        if (!supportTenant) {
          const platformResponse = await fetch("/api/admin/access", { cache: "no-store" }).catch(() => null);
          const platformAccess = platformResponse?.ok ? await platformResponse.json().catch(() => null) : null;
          if (platformAccess?.isPlatformStaff) { window.location.replace("/admin"); return; }
        }
        const queryTenant = new URLSearchParams(window.location.search).get("tenantId");
        const cookieTenant = document.cookie.split(";").map(value => value.trim()).find(value => value.startsWith("gavrion_active_tenant="))?.split("=")[1] || "";
        const requestedTenant = queryTenant || cookieTenant || "";
        let membership = membershipRows.find(row => row.tenant_id === requestedTenant) || (membershipRows.length === 1 ? membershipRows[0] : null);
        if (!membership && options.length > 1 && !supportTenant) {
          setTenantSelectionRequired(true);
          setAccount({ name, email, initials: name.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join("").toUpperCase() || "U", role: "Selecciona una empresa", company: "" });
          setDataLoading(false);
          setAuthReady(true);
          return;
        }
        if (membership?.tenant_id) document.cookie = `gavrion_active_tenant=${encodeURIComponent(membership.tenant_id)};path=/;max-age=2592000;samesite=lax`;
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
          const loadedSettings = tenant?.settings && typeof tenant.settings === "object" ? tenant.settings as Record<string, unknown> : {};
          setTenantSettings(loadedSettings);
          const storedGoals = loadedSettings.dashboard_goals;
          if (storedGoals && typeof storedGoals === "object") {
            const values = storedGoals as Record<string, unknown>;
            const asGoal = (value: unknown, fallback: number) => typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : fallback;
            setDashboardGoals({
              revenue: asGoal(values.revenue, 0),
              leads: asGoal(values.leads, 0),
              responseMinutes: asGoal(values.responseMinutes, defaultDashboardGoals.responseMinutes)
            });
          }

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

          const [contactsResult, tasksResult, dealsResult, conversationsResult, messagesResult, propertiesResult, inquiriesResult, visitsResult, formTasksResult, inquiryTasksResult, reservationsResult, appointmentsResult] = await Promise.all([
            supabase.from("contacts").select("id, full_name, email, phone, company, status").eq("tenant_id", membership.tenant_id).order("updated_at", { ascending: false }).range(0, 199),
            supabase.from("tasks").select("id, title, due_at, completed_at, assigned_to").eq("tenant_id", membership.tenant_id).order("due_at", { ascending: true, nullsFirst: false }).range(0, 199),
            supabase.from("deals").select("id, title, stage, value, currency, contact_id, expected_close_date").eq("tenant_id", membership.tenant_id).order("updated_at", { ascending: false }).range(0, 199),
            supabase.from("conversations").select("id, contact_id, channel, external_thread_id, status, handling_mode, assigned_to, last_message_at").eq("tenant_id", membership.tenant_id).order("last_message_at", { ascending: false }).range(0, 99),
            supabase.from("messages").select("id, conversation_id, direction, body, created_at").eq("tenant_id", membership.tenant_id).order("created_at", { ascending: true }).range(0, 4999),
            supabase.from("properties").select("id, reference, title, property_type, operation, price, currency, city, zone, bedrooms, status").eq("tenant_id", membership.tenant_id).order("created_at", { ascending: false }).range(0, 499),
            supabase.from("property_inquiries").select("id, customer_name, phone, intent, property_type, city, zone, budget_max, bedrooms, notes, status").eq("tenant_id", membership.tenant_id).order("created_at", { ascending: false }).range(0, 499),
            supabase.from("property_visits").select("id, property_reference, customer_name, phone, requested_date, requested_time, party_size, notes, status").eq("tenant_id", membership.tenant_id).order("requested_date", { ascending: true }).range(0, 499),
            supabase.from("site_form_submissions").select("task_id, conversation_id").eq("tenant_id", membership.tenant_id).not("task_id", "is", null).limit(5000),
            supabase.from("property_inquiries").select("follow_up_task_id, conversation_id").eq("tenant_id", membership.tenant_id).not("follow_up_task_id", "is", null).limit(5000),
            supabase.from("reservations").select("id, customer_name, reservation_date, reservation_time, party_size, status").eq("tenant_id", membership.tenant_id).order("reservation_date", { ascending: true }).limit(1000),
            supabase.from("appointments").select("id, customer_name, service, scheduled_at, status").eq("tenant_id", membership.tenant_id).order("scheduled_at", { ascending: true }).limit(1000)
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

            const operationalEvents: CalendarEvent[] = [
              ...(reservationsResult.data || []).map(item => ({ id: "reservation-" + item.id, kind: "reservation" as const, title: "Reserva · " + item.customer_name, start: String(item.reservation_date) + "T" + String(item.reservation_time).slice(0, 8), detail: String(item.party_size) + " personas", status: item.status, sourceId: item.id, editable: false })),
              ...(appointmentsResult.data || []).map(item => ({ id: "appointment-" + item.id, kind: "appointment" as const, title: "Cita · " + item.customer_name, start: item.scheduled_at, detail: item.service, status: item.status, sourceId: item.id, editable: false })),
              ...(visitsResult.data || []).map(item => ({ id: "visit-" + item.id, kind: "property_visit" as const, title: "Visita · " + item.customer_name, start: String(item.requested_date) + "T" + String(item.requested_time).slice(0, 8), detail: item.property_reference || "Propiedad", status: item.status, sourceId: item.id, editable: false }))
            ];
            setCalendarEvents(operationalEvents);            setDeals((dealsResult.data || []).map(item => ({ id: item.id, title: item.title, stage: (dealStages.some(stage => stage.id === item.stage) ? item.stage : "new") as DealStage, value: Number(item.value || 0), currency: item.currency || "HNL", contactId: item.contact_id || "", contactName: loadedContacts.find(contact => contact.id === item.contact_id)?.name || "Sin contacto", expectedCloseDate: item.expected_close_date || "" })));
            const allMessages = messagesResult.data || [];
            const channelLabels: Record<string, string> = { whatsapp: "WhatsApp", instagram: "Instagram", facebook: "Facebook", web: "Chat web" };
            setThreads((conversationsResult.data || []).map(conversation => {
              const conversationMessages: ChatMessage[] = allMessages.filter(item => item.conversation_id === conversation.id).map(item => ({ id: item.id, text: item.body || "[Mensaje multimedia]", direction: item.direction as "inbound" | "outbound", createdAt: item.created_at }));
              const contact = loadedContacts.find(item => item.id === conversation.contact_id);
              return { id: conversation.id, name: contact?.name || conversation.external_thread_id || "Contacto", channel: channelLabels[conversation.channel] || conversation.channel, preview: conversationMessages.at(-1)?.text || "Sin mensajes", contactId: conversation.contact_id || "", externalThreadId: conversation.external_thread_id || "", handlingMode: (conversation.handling_mode || "bot") as Thread["handlingMode"], assignedTo: conversation.assigned_to || "", unread: 0, messages: conversationMessages };
            }));
          }
        } else if (!supportTenant) {
          setNotice({ type: "error", text: "Tu usuario no tiene acceso activo a una empresa lista para operar. Si necesitas ayuda, comunícate con el administrador de tu empresa." });
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
        client.from("contacts").select("id, full_name").eq("tenant_id", tenantId).range(0, 499),
        client.from("conversations").select("id, contact_id, channel, external_thread_id, handling_mode, assigned_to, last_message_at", { count: "exact" }).eq("tenant_id", tenantId).order("last_message_at", { ascending: false }).range(0, 99),
        client.from("messages").select("id, conversation_id, direction, body, created_at").eq("tenant_id", tenantId).order("created_at", { ascending: true }).range(0, 4999),
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
      setHasMoreConversations((conversationsResult.count || 0) > nextThreads.length);
      setConversationPage(1);
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
      supabase.from("conversations").select("id, created_at", { count: "exact" }).eq("tenant_id", tenantId).gte("created_at", from.toISOString()).range(0, 4999),
      supabase.from("deals").select("id, value, stage, created_at").eq("tenant_id", tenantId).gte("created_at", from.toISOString()).range(0, 4999)
    ]).then(([contactResult, conversationResult, dealResult]) => {
      if (contactResult.error || conversationResult.error || dealResult.error) {
        setNotice({ type: "error", text: contactResult.error?.message || conversationResult.error?.message || dealResult.error?.message || "No se pudieron actualizar las métricas." });
        return;
      }
      const dealRows = dealResult.data || [];
      const openDeals = dealRows.filter(deal => deal.stage !== "won");
      const wonDeals = dealRows.filter(deal => deal.stage === "won");
      setDashboardMetrics({ contacts: contactResult.count || 0, conversations: conversationResult.count || 0, deals: dealRows.length, won: wonDeals.length, pipeline: openDeals.reduce((total, deal) => total + Number(deal.value || 0), 0), wonValue: wonDeals.reduce((total, deal) => total + Number(deal.value || 0), 0) });
      const sevenDays = Array.from({ length: 7 }, (_, index) => {
        const day = new Date(); day.setHours(0, 0, 0, 0); day.setDate(day.getDate() - (6 - index));
        return day.toISOString().slice(0, 10);
      });
      const counts = sevenDays.map(day => (conversationResult.data || []).filter(item => item.created_at?.slice(0, 10) === day).length + dealRows.filter(item => item.created_at?.slice(0, 10) === day).length);
      const max = Math.max(...counts, 1);
      setActivity(counts.map(count => count === 0 ? 0 : Math.max(12, Math.round(count / max * 100))));
    });
  }, [tenantId, period, metricsVersion]);

  async function addTask(taskTitle: string, taskTime: string, taskDate = localDateKey(new Date())) {
    if (!taskTitle.trim() || !tenantId) return;
    const supabase = createClientSupabase();
    if (!supabase) return;
    const dueAt = localDateTimeToIso(taskDate, taskTime);
    const { data, error } = await supabase.from("tasks").insert({ tenant_id: tenantId, title: taskTitle.trim(), due_at: dueAt, assigned_to: userId || null }).select("id, title, due_at, completed_at, assigned_to").single();
    if (error) { showNotice("error", "No se pudo crear la tarea. Inténtalo de nuevo."); return; }
    setTasks(current => [{ ...(data as Task), source: "manual" }, ...current]);
    showNotice("success", "Tarea creada.");
  }

  async function updateTask(taskId: string, taskTitle: string, dueAt: string) {
    if (!taskTitle.trim() || !tenantId) return;
    const supabase = createClientSupabase();
    if (!supabase) return;
    const previous = tasks.find(task => task.id === taskId);
    setTasks(current => current.map(task => task.id === taskId ? { ...task, title: taskTitle.trim(), due_at: dueAt } : task));
    const { error } = await supabase.from("tasks").update({ title: taskTitle.trim(), due_at: dueAt }).eq("id", taskId).eq("tenant_id", tenantId);
    if (error) {
      if (previous) setTasks(current => current.map(task => task.id === taskId ? previous : task));
      showNotice("error", "No se pudo actualizar la tarea. Inténtalo de nuevo.");
    } else showNotice("success", "Tarea actualizada.");
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
    if (error) { setTasks(current => current.map(item => item.id === task.id ? { ...item, completed_at: previous } : item)); showNotice("error", "No se pudo cambiar el estado de la tarea. Inténtalo de nuevo."); }
  }

  async function deleteTask(id: string) {
    const supabase = createClientSupabase();
    if (!supabase) return;
    const { error } = await supabase.from("tasks").delete().eq("id", id).eq("tenant_id", tenantId);
    if (error) showNotice("error", "No se pudo eliminar la tarea. Inténtalo de nuevo.");
    else { setTasks(current => current.filter(task => task.id !== id)); showNotice("success", "Tarea eliminada."); }
  }

  async function assignTask(taskId: string, assignedTo: string) {
    if (!tenantId) return;
    const supabase = createClientSupabase();
    if (!supabase) return;
    const previous = tasks.find(task => task.id === taskId)?.assigned_to ?? null;
    const next = assignedTo || null;
    setTasks(current => current.map(task => task.id === taskId ? { ...task, assigned_to: next } : task));
    const { error } = await supabase.from("tasks").update({ assigned_to: next }).eq("id", taskId).eq("tenant_id", tenantId);
    if (error) {
      setTasks(current => current.map(task => task.id === taskId ? { ...task, assigned_to: previous } : task));
      showNotice("error", "No se pudo asignar la tarea. Inténtalo de nuevo.");
      return;
    }
    showNotice("success", next ? "Tarea asignada al integrante." : "Tarea dejada sin asignar.");
  }
  async function saveDashboardGoals(nextGoals: DashboardGoals) {
    if (!tenantId || !isClientAdmin) return false;
    const supabase = createClientSupabase();
    if (!supabase) return false;
    setSavingDashboardGoals(true);
    const nextSettings = { ...tenantSettings, dashboard_goals: nextGoals };
    const { error } = await supabase.from("tenants").update({ settings: nextSettings }).eq("id", tenantId);
    setSavingDashboardGoals(false);
    if (error) {
      showNotice("error", "No se pudieron guardar las metas. Inténtalo de nuevo.");
      return false;
    }
    setTenantSettings(nextSettings);
    setDashboardGoals(nextGoals);
    showNotice("success", "Metas ejecutivas actualizadas.");
    return true;
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
    showNotice("success", editingContactId ? "Contacto actualizado." : "Contacto creado.");
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

  async function updateMemberPermission(member: TeamMember, permission: TenantPermission, value: boolean) {
    if (!tenantId || member.role === "owner") return;
    const permissions = { ...(member.permissions || {}), [permission]: value };
    setSavingPermission(`${member.id}:${permission}`);
    const response = await fetch("/api/team", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId: member.id, permissions }) });
    const body = await response.json().catch(() => ({}));
    setSavingPermission(null);
    if (!response.ok) { showNotice("error", body.error || "No se pudo actualizar el permiso."); return; }
    setTeamMembers(current => current.map(item => item.id === member.id ? { ...item, permissions } : item));
    showNotice("success", "Permiso actualizado.");
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
    showNotice("success", "Inmueble creado.");
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
  const labels: Record<string, string> = { inicio: `${greeting}, ${account.name.split(" ")[0]}`, conversaciones: "Conversaciones", contactos: "Contactos", pipeline: "Ventas y oportunidades", pipeline_v2: "Ventas y oportunidades", tareas: "Tareas", calendario: "Calendario", inmobiliaria: "Gestión inmobiliaria", reservaciones:"Reservaciones", pedidos:"Pedidos", citas:"Citas", cotizaciones:"Cotizaciones", productos:"Productos", campos:"Campos personalizados", equipo: "Equipo y cuenta", automatizaciones: "Automatizaciones", reportes: "Reportes", auditoria: "Auditoría", configuracion: "Configuración" };
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

  async function loadMoreConversations() {
    if (!tenantId || !hasMoreConversations) return;
    const client = createClientSupabase();
    if (!client) return;
    const from = conversationPage * 100;
    const conversationsResult = await client.from("conversations").select("id, contact_id, channel, external_thread_id, handling_mode, assigned_to, last_message_at").eq("tenant_id", tenantId).order("last_message_at", { ascending: false }).range(from, from + 99);
    if (conversationsResult.error || !conversationsResult.data?.length) { setHasMoreConversations(false); return; }
    const rows = conversationsResult.data;
    const contactIds = rows.map(row => row.contact_id).filter(Boolean);
    const ids = rows.map(row => row.id);
    const [contactsResult, messagesResult, readsResult] = await Promise.all([
      contactIds.length ? client.from("contacts").select("id, full_name").in("id", contactIds).eq("tenant_id", tenantId) : Promise.resolve({ data: [] as Array<{ id: string; full_name: string | null }> }),
      client.from("messages").select("id, conversation_id, direction, body, created_at").eq("tenant_id", tenantId).in("conversation_id", ids).order("created_at", { ascending: true }),
      client.from("conversation_reads").select("conversation_id, last_read_at").eq("tenant_id", tenantId).eq("user_id", userId).in("conversation_id", ids)
    ]);
    const names = new Map((contactsResult.data || []).map(contact => [contact.id, contact.full_name]));
    const allMessages = messagesResult.data || [];
    const reads = new Map((readsResult.data || []).map(item => [item.conversation_id, item.last_read_at]));
    const channelLabels: Record<string, string> = { whatsapp: "WhatsApp", instagram: "Instagram", facebook: "Facebook", web: "Chat web" };
    const extraThreads: Thread[] = rows.map(conversation => {
      const conversationMessages: ChatMessage[] = allMessages.filter(item => item.conversation_id === conversation.id).map(item => ({ id: item.id, text: item.body || "[Mensaje multimedia]", direction: item.direction as "inbound" | "outbound", createdAt: item.created_at }));
      return { id: conversation.id, name: names.get(conversation.contact_id) || conversation.external_thread_id || "Contacto", channel: channelLabels[conversation.channel] || conversation.channel, preview: conversationMessages.at(-1)?.text || "Sin mensajes", contactId: conversation.contact_id || "", externalThreadId: conversation.external_thread_id || "", handlingMode: (conversation.handling_mode || "bot") as Thread["handlingMode"], assignedTo: conversation.assigned_to || "", unread: conversationMessages.filter(item => item.direction === "inbound" && new Date(item.createdAt) > new Date(reads.get(conversation.id) || 0)).length, messages: conversationMessages };
    });
    setThreads(current => [...current, ...extraThreads]);
    setConversationPage(page => page + 1);
    setHasMoreConversations(extraThreads.length === 100);
  }
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
          ["pipeline_v2", "◇", "Ventas y oportunidades", "pipeline"],
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
      <header className="topbar"><div><p className="eyebrow">GAVRION CRM</p><h1>{labels[view]}</h1></div><div className="topbar-actions">{tenantOptions.length > 1 && <label className="tenant-switcher"><span>Empresa activa</span><select value={tenantId} onChange={event => { const next = event.target.value; document.cookie = `gavrion_active_tenant=${encodeURIComponent(next)};path=/;max-age=2592000;samesite=lax`; const params = new URLSearchParams(window.location.search); params.set("tenantId", next); window.location.assign(`${window.location.pathname}?${params.toString()}`); }}>{tenantOptions.map(option => <option value={option.id} key={option.id}>{option.name}</option>)}</select></label>}<div className="global-search-wrap"><label className="search">⌕ <input value={globalQuery} onChange={e=>{setGlobalQuery(e.target.value);setSearchOpen(true)}} onFocus={()=>setSearchOpen(true)} onKeyDown={e=>{if(e.key==="Escape")setSearchOpen(false)}} placeholder="Buscar clientes, mensajes..." /></label>{searchOpen&&globalQuery.trim()&&<div className="search-results open" role="listbox">{globalResults.length ? globalResults.map(result=><button type="button" className="search-result" key={result.id} onMouseDown={event=>event.preventDefault()} onClick={()=>openSearchResult(result)}><span className="search-result-icon">{result.type[0]}</span><div><strong>{result.title}</strong><small>{result.detail}</small></div><span className="search-result-type">{result.type}</span></button>) : <div className="search-empty">No encontramos resultados para “{globalQuery}”.</div>}</div>}</div>{isClientAdmin&&<NotificationBell refreshKey={bellRefresh} onOpen={openOwnerNotification} onSeeAll={()=>openSettings("control")} />}</div></header>
      {view === "inicio" && <ExecutiveDashboard
        metrics={dashboardMetrics}
        activity={activity}
        threads={threads}
        tasks={tasks}
        teamMembers={teamMembers}
        deals={deals}
        period={period}
        goals={dashboardGoals}
        canConfigure={isClientAdmin}
        savingGoals={savingDashboardGoals}
        onPeriodChange={setPeriod}
        onSaveGoals={saveDashboardGoals}
        onNavigate={navigate}
      />}

{view === "tareas" && <TasksView tasks={tasks} teamMembers={teamMembers} userId={userId} filter={taskViewFilter} onFilterChange={setTaskViewFilter} onToggle={toggleTask} onDelete={deleteTask} onCreate={addTask} onAssign={assignTask} canAssign={isClientAdmin || supportMode} />}
      {view === "calendario" && <CalendarView tasks={tasks} events={calendarEvents} enabledModules={enabledModules} onToggle={toggleTask} onDelete={deleteTask} onCreate={addTask} onUpdate={updateTask} />}
      {view === "conversaciones" && <section className="view active">
        <div className="section-heading"><div><h2>Bandeja unificada</h2><p>{totalUnread ? `${totalUnread} mensaje${totalUnread===1?"":"s"} sin leer` : "Todas las conversaciones están al día"}.</p></div><div className="section-actions"><button className="secondary-button" onClick={exportConversations}>Descargar CSV</button><button className="secondary-button" onClick={enableNotifications}>Activar notificaciones</button></div></div>
        {currentThread ? <div className="inbox-layout">
          <aside className="thread-list">{threads.map((thread,index)=><button key={thread.id} className={`thread ${selectedThread===index?"active":""}`} onClick={()=>setSelectedThread(index)}><span className="avatar">{thread.name.split(" ").map(x=>x[0]).slice(0,2).join("")}</span><span className="thread-info"><h4>{thread.name}</h4><p>{thread.preview}</p></span>{thread.unread>0?<i className="unread-badge">{thread.unread}</i>:<time>{thread.handlingMode==="waiting_agent"?"Requiere agente":thread.handlingMode==="human"?"Humano":"IA"}</time>}</button>)}{hasMoreConversations && <button type="button" className="load-more" onClick={()=>void loadMoreConversations()}>Cargar más conversaciones</button>}</aside>
          <article className="chat-panel"><div className="chat-header"><span className="avatar">{currentThread.name[0]}</span><div><strong>{currentThread.name}</strong><small>{currentThread.channel} · {currentThread.handlingMode==="waiting_agent"?"esperando agente":currentThread.handlingMode==="human"?"atención humana":"asistente activo"}</small></div></div><div className="messages" ref={messagesRef}>{hasOlderMessages&&<button type="button" className="load-older" onClick={loadOlderMessages}>Cargar 50 mensajes anteriores</button>}{visibleMessages.map((item,index)=>{const currentDate=new Date(item.createdAt).toLocaleDateString("es-HN",{day:"numeric",month:"long",year:"numeric"});const previousDate=index?new Date(visibleMessages[index-1].createdAt).toLocaleDateString("es-HN",{day:"numeric",month:"long",year:"numeric"}):"";return <span className="message-group" key={item.id}>{currentDate!==previousDate&&<span className="message-date">{currentDate}</span>}<span className={`message ${item.direction==="outbound"?"out":"in"}`}>{item.text}<time>{new Date(item.createdAt).toLocaleTimeString("es-HN",{hour:"2-digit",minute:"2-digit"})}</time></span></span>})}</div><form className="composer" onSubmit={sendMessage}><input value={message} onChange={e=>setMessage(e.target.value)} placeholder="Escribe un mensaje..."/><button className="send-button" aria-label="Enviar">➤</button></form></article>
          <aside className="contact-panel"><div className="contact-hero"><span className="avatar">{currentThread.name[0]}</span><h3>{currentThread.name}</h3><p>{currentThread.externalThreadId}</p></div><div className="detail-group"><h4>Atención</h4><span className={`tag handling-${currentThread.handlingMode}`}>{currentThread.handlingMode==="waiting_agent"?"Requiere agente":currentThread.handlingMode==="human"?"Atención humana":"Asistente activo"}</span><div className="handoff-actions">{canOperateSales&&currentThread.handlingMode!=="human"&&<button className="primary-button" onClick={()=>setConversationMode("human")}>Tomar conversación</button>}{canOperateSales&&currentThread.handlingMode!=="bot"&&<button className="secondary-button" onClick={()=>setConversationMode("bot")}>Devolver al asistente</button>}</div></div><div className="detail-group"><h4>Responsable</h4><select disabled={!canOperateSales} className="select assignment-select" value={currentThread.assignedTo} onChange={event=>assignConversation(event.target.value)}><option value="">Asistente automático</option>{teamMembers.filter(member=>member.role!=="viewer").map(member=><option key={member.id} value={member.id}>{member.name}</option>)}</select></div><div className="detail-group"><h4>Canal</h4><span className="tag">{currentThread.channel}</span><span className="tag">Conversación real</span></div></aside>
        </div> : <div className="empty-feature"><div className="feature-visual">◫</div><h3>Aún no hay conversaciones</h3><p>Cuando llegue el primer mensaje aparecerá automáticamente en esta bandeja.</p></div>}
      </section>}

      {view === "equipo" && isClientAdmin && <section className="view active">
        <div className="section-heading"><div><h2>Equipo y permisos</h2><p>Gestiona quién accede al CRM y qué conversaciones atiende.</p></div></div>
        <div className="team-tabs" role="tablist" aria-label="Equipo y cuenta"><button type="button" className={teamTab === "members" ? "active" : ""} onClick={() => setTeamTab("members")}>Integrantes</button><button type="button" className={teamTab === "account" ? "active" : ""} onClick={() => setTeamTab("account")}>Mi cuenta</button></div>
        {teamTab === "members" && <div className="team-tab-content"><div className="team-workload-grid">{teamMembers.map(member=>{const workload=(member.workload?.conversations||0)+(member.workload?.tasks||0)+(member.workload?.deals||0);const targets=teamMembers.filter(candidate=>candidate.id!==member.id&&candidate.active!==false);return <article className={`panel member-workload ${member.active===false?"member-inactive":""}`} key={`work-${member.id}`}><div><strong>{member.name}</strong><span className={`status ${member.invitationStatus==="pending"?"lead":member.online?"online":"client"}`}>{member.invitationStatus==="pending"?"Invitación pendiente":member.active===false?"Sin acceso":member.online?"Conectado":"Activo"}</span></div><p><b>{member.workload?.conversations||0}</b> conversaciones · <b>{member.workload?.tasks||0}</b> tareas · <b>{member.workload?.deals||0}</b> oportunidades</p>{member.lastSeenAt&&<small className="member-last-seen">Último acceso: {new Date(member.lastSeenAt).toLocaleString("es-HN")}</small>}{member.role!=="owner"&&["owner","admin"].includes(currentRole)&&member.active!==false&&<div className="member-reassign"><select className="select" value={reassignTargets[member.id]||""} onChange={event=>setReassignTargets(current=>({...current,[member.id]:event.target.value}))}><option value="">Reasignar trabajo…</option>{targets.map(target=><option key={target.id} value={target.id}>{target.name}</option>)}</select><button type="button" className="ghost-button" disabled={!workload} onClick={()=>void reassignMember(member)}>Reasignar</button></div>}{member.role!=="owner"&&["owner","admin"].includes(currentRole)&&<button className={member.active===false?"ghost-button":"danger-button"} onClick={()=>void toggleMember(member)}>{member.active===false?"Reactivar acceso":workload?"Desactivar y reasignar":"Desactivar acceso"}</button>}{member.role!=="owner"&&["owner","admin"].includes(currentRole)&&<details className="member-permissions"><summary>Permisos específicos</summary><div className="member-permission-list">{teamPermissionOptions.map(permission=><label key={permission}><input type="checkbox" checked={member.permissions?.[permission] ?? hasTenantPermission(member.role, permission)} disabled={savingPermission===`${member.id}:${permission}`} onChange={event=>void updateMemberPermission(member, permission, event.target.checked)} />{tenantPermissionLabels[permission]}</label>)}</div></details>}</article>})}</div>
        {["owner","admin"].includes(currentRole) && <form className="team-invite panel" onSubmit={inviteMember}><label>Correo del integrante<input required type="email" value={inviteEmail} onChange={event=>setInviteEmail(event.target.value)} placeholder="asesor@empresa.com" /></label><label>Rol<select className="select" value={inviteRole} onChange={event=>setInviteRole(event.target.value as TeamMember["role"])}><option value="admin">Administrador</option><option value="agent">Agente</option><option value="viewer">Consulta</option></select></label><button className="primary-button" disabled={inviting}>{inviting?"Enviando…":"Invitar integrante"}</button></form>}
        <article className="panel table-panel team-table"><div className="panel-header"><div><h3>Integrantes</h3><p>{teamMembers.length} usuario{teamMembers.length===1?"":"s"} en esta empresa</p></div></div><div className="table-scroll"><table><thead><tr><th>Integrante</th><th>Correo</th><th>Rol</th></tr></thead><tbody>{teamMembers.map(member=><tr key={member.id}><td><div className="contact-cell"><span className="avatar">{member.name.charAt(0).toUpperCase()}</span><span><strong>{member.name}</strong>{member.id===userId&&<small>Tu cuenta</small>}</span></div></td><td>{member.email}</td><td>{member.role==="owner"?<span className="status client">Propietario</span>:<select className="select team-role" value={member.role} disabled={!(["owner","admin"].includes(currentRole))} onChange={event=>changeMemberRole(member,event.target.value as TeamMember["role"])}><option value="admin">Administrador</option><option value="agent">Agente</option><option value="viewer">Consulta</option></select>}</td></tr>)}</tbody></table></div></article></div>}
        {teamTab === "account" && <AccountTab />}
      </section>}

      {view === "inmobiliaria" && <section className="view active"><div className="section-heading"><div><h2>Gestión inmobiliaria</h2><p>Inventario, clientes interesados y visitas registradas por el asistente.</p></div><button className="primary-button" onClick={()=>setShowPropertyForm(true)}>＋ Nuevo inmueble</button></div>{showPropertyForm&&<form className="inline-create property-create" onSubmit={saveProperty}><input required autoFocus value={propertyReference} onChange={e=>setPropertyReference(e.target.value)} placeholder="Referencia: MET-001"/><input required value={propertyTitle} onChange={e=>setPropertyTitle(e.target.value)} placeholder="Título del inmueble"/><select className="select" value={propertyType} onChange={e=>setPropertyType(e.target.value)}><option value="house">Casa</option><option value="apartment">Apartamento</option><option value="land">Terreno</option><option value="commercial">Local comercial</option><option value="office">Oficina</option><option value="other">Otro</option></select><select className="select" value={propertyOperation} onChange={e=>setPropertyOperation(e.target.value as "sale"|"rent")}><option value="sale">Venta</option><option value="rent">Alquiler</option></select><input required type="number" min="0" value={propertyPrice} onChange={e=>setPropertyPrice(e.target.value)} placeholder="Precio HNL"/><input required value={propertyCity} onChange={e=>setPropertyCity(e.target.value)} placeholder="Ciudad"/><input value={propertyZone} onChange={e=>setPropertyZone(e.target.value)} placeholder="Zona o colonia"/><input type="number" min="0" value={propertyBedrooms} onChange={e=>setPropertyBedrooms(e.target.value)} placeholder="Habitaciones"/><button className="primary-button">Guardar</button><button type="button" className="ghost-button" onClick={()=>setShowPropertyForm(false)}>Cancelar</button></form>}<div className="requests-grid"><article className="panel table-panel"><div className="panel-header"><div><h3>Propiedades</h3><p>{properties.filter(item=>item.status==="available").length} disponibles</p></div><button className="secondary-button" onClick={exportProperties}>Descargar CSV</button></div><div className="table-scroll"><table><thead><tr><th>Inmueble</th><th>Ubicación</th><th>Precio</th><th>Estado</th></tr><tr className="column-filters"><th><input placeholder="Filtrar" value={propertyFilters.reference} onChange={e=>setPropertyFilters(x=>({...x,reference:e.target.value}))}/></th><th><input placeholder="Filtrar" value={propertyFilters.location} onChange={e=>setPropertyFilters(x=>({...x,location:e.target.value}))}/></th><th></th><th><select value={propertyFilters.status} onChange={e=>setPropertyFilters(x=>({...x,status:e.target.value}))}><option value="">Todos</option><option value="available">Disponible</option><option value="reserved">Reservada</option><option value="sold">Vendida</option><option value="rented">Alquilada</option><option value="inactive">Inactiva</option></select></th></tr></thead><tbody>{filteredProperties.length?filteredProperties.map(item=><tr key={item.id}><td><strong>{item.reference} · {item.title}</strong><small>{item.property_type} · {item.operation==="sale"?"Venta":"Alquiler"}</small></td><td>{item.city}{item.zone&&<small>{item.zone}</small>}</td><td>{new Intl.NumberFormat("es-HN",{style:"currency",currency:item.currency||"HNL",maximumFractionDigits:0}).format(item.price)}</td><td><select className="select request-status" value={item.status} onChange={e=>updateRealEstateStatus("property",item.id,e.target.value)}><option value="available">Disponible</option><option value="reserved">Reservada</option><option value="sold">Vendida</option><option value="rented">Alquilada</option><option value="inactive">Inactiva</option></select></td></tr>):<tr><td colSpan={4} className="table-empty">Aún no hay inmuebles registrados.</td></tr>}</tbody></table></div></article><article className="panel table-panel"><div className="panel-header"><div><h3>Clientes interesados</h3><p>{propertyInquiries.filter(item=>item.status==="new").length} nuevos</p></div><button className="secondary-button" onClick={exportInquiries}>Descargar CSV</button></div><div className="table-scroll"><table><thead><tr><th>Cliente</th><th>Búsqueda</th><th>Presupuesto</th><th>Estado</th></tr><tr className="column-filters"><th><input placeholder="Filtrar" value={inquiryFilters.customer} onChange={e=>setInquiryFilters(x=>({...x,customer:e.target.value}))}/></th><th><input placeholder="Filtrar" value={inquiryFilters.location} onChange={e=>setInquiryFilters(x=>({...x,location:e.target.value}))}/></th><th></th><th><select value={inquiryFilters.status} onChange={e=>setInquiryFilters(x=>({...x,status:e.target.value}))}><option value="">Todos</option><option value="new">Nuevo</option><option value="contacted">Contactado</option><option value="qualified">Calificado</option><option value="closed">Cerrado</option><option value="discarded">Descartado</option></select></th></tr></thead><tbody>{filteredInquiries.length?filteredInquiries.map(item=><tr key={item.id}><td><strong>{item.customer_name}</strong><small>{item.phone}</small></td><td>{item.intent==="buy"?"Compra":item.intent==="rent"?"Alquiler":"Venta"} · {item.property_type||"Inmueble"}<small>{[item.city,item.zone].filter(Boolean).join(" · ")||"Sin ubicación"}{item.bedrooms?` · ${item.bedrooms} hab.`:""}</small></td><td>{item.budget_max?new Intl.NumberFormat("es-HN",{style:"currency",currency:"HNL",maximumFractionDigits:0}).format(item.budget_max):"Por definir"}{item.notes&&<small>{item.notes}</small>}</td><td><select className="select request-status" value={item.status} onChange={e=>updateRealEstateStatus("inquiry",item.id,e.target.value)}><option value="new">Nuevo</option><option value="contacted">Contactado</option><option value="qualified">Calificado</option><option value="closed">Cerrado</option><option value="discarded">Descartado</option></select></td></tr>):<tr><td colSpan={4} className="table-empty">Aún no hay interesados.</td></tr>}</tbody></table></div></article><article className="panel table-panel"><div className="panel-header"><div><h3>Solicitudes de visita</h3><p>{propertyVisits.filter(item=>item.status==="pending").length} pendientes</p></div><button className="secondary-button" onClick={exportVisits}>Descargar CSV</button></div><div className="table-scroll"><table><thead><tr><th>Cliente</th><th>Propiedad</th><th>Fecha</th><th>Estado</th></tr><tr className="column-filters"><th><input placeholder="Filtrar" value={visitFilters.customer} onChange={e=>setVisitFilters(x=>({...x,customer:e.target.value}))}/></th><th><input placeholder="Filtrar" value={visitFilters.property} onChange={e=>setVisitFilters(x=>({...x,property:e.target.value}))}/></th><th></th><th><select value={visitFilters.status} onChange={e=>setVisitFilters(x=>({...x,status:e.target.value}))}><option value="">Todos</option><option value="pending">Pendiente</option><option value="confirmed">Confirmada</option><option value="completed">Completada</option><option value="cancelled">Cancelada</option></select></th></tr></thead><tbody>{filteredVisits.length?filteredVisits.map(item=><tr key={item.id}><td><strong>{item.customer_name}</strong><small>{item.phone}</small></td><td>{item.property_reference}<small>{item.party_size} visitante{item.party_size===1?"":"s"}</small></td><td>{new Date(`${item.requested_date}T00:00:00`).toLocaleDateString("es-HN")} · {item.requested_time.slice(0,5)}</td><td><select className="select request-status" value={item.status} onChange={e=>updateRealEstateStatus("visit",item.id,e.target.value)}><option value="pending">Pendiente</option><option value="confirmed">Confirmada</option><option value="completed">Completada</option><option value="cancelled">Cancelada</option></select></td></tr>):<tr><td colSpan={4} className="table-empty">Aún no hay visitas solicitadas.</td></tr>}</tbody></table></div></article></div></section>}
      {view === "reservaciones" && tenantId && <OperationalModule tenantId={tenantId} module="reservations" />}
      {view === "pipeline_v2" && tenantId && <PipelineWorkspace tenantId={tenantId} contacts={contacts} userId={userId} canConfigure={["owner","admin"].includes(currentRole)} />}
      {view === "campos" && isClientAdmin && tenantId && <CustomFields tenantId={tenantId} enabledModules={enabledModules} />}
      {view === "pedidos" && tenantId && <OperationalModule tenantId={tenantId} module="orders" />}
      {view === "citas" && tenantId && <OperationalModule tenantId={tenantId} module="appointments" />}
      {view === "cotizaciones" && tenantId && <OperationalModule tenantId={tenantId} module="quotes" />}
      {view === "productos" && tenantId && <OperationalModule tenantId={tenantId} module="products" />}

      {view === "contactos" && <section className="view active"><div className="section-heading"><div><h2>Contactos</h2><p>Clientes y prospectos de tu empresa.</p></div><div className="section-actions"><button className="secondary-button" onClick={exportContacts}>Descargar CSV</button><button className="primary-button" onClick={openNewContact}>＋ Nuevo contacto</button></div></div>{showContactForm&&<form className="inline-create contact-create" onSubmit={saveContact}><input autoFocus required value={contactName} onChange={e=>setContactName(e.target.value)} placeholder="Nombre completo"/><input type="email" value={contactEmail} onChange={e=>setContactEmail(e.target.value)} placeholder="Correo"/><input value={contactPhone} onChange={e=>setContactPhone(e.target.value)} placeholder="Teléfono"/><input value={contactCompany} onChange={e=>setContactCompany(e.target.value)} placeholder="Empresa"/><select className="select" value={contactStatus} onChange={e=>setContactStatus(e.target.value as Contact["status"])} aria-label="Estado del contacto"><option>Prospecto</option><option>Cliente</option><option>Inactivo</option></select><button className="primary-button">{editingContactId ? "Actualizar" : "Guardar"}</button><button type="button" className="ghost-button" onClick={closeContactForm}>Cancelar</button></form>}<article className="panel table-panel"><div className="table-tools"><label className="search">⌕ <input value={contactQuery} onChange={e=>setContactQuery(e.target.value)} placeholder="Buscar contacto..."/></label></div><div className="table-scroll"><table><thead><tr><th>Contacto</th><th>Empresa</th><th>Teléfono</th><th>Estado</th><th>Acciones</th></tr><tr className="column-filters"><th><input aria-label="Filtrar por contacto" value={contactFilters.name} onChange={e=>setContactFilters(c=>({...c,name:e.target.value}))} placeholder="Filtrar" /></th><th><input aria-label="Filtrar por empresa" value={contactFilters.company} onChange={e=>setContactFilters(c=>({...c,company:e.target.value}))} placeholder="Filtrar" /></th><th><input aria-label="Filtrar por teléfono" value={contactFilters.phone} onChange={e=>setContactFilters(c=>({...c,phone:e.target.value}))} placeholder="Filtrar" /></th><th><select value={contactFilters.status} onChange={e=>setContactFilters(c=>({...c,status:e.target.value}))}><option value="">Todos</option><option>Prospecto</option><option>Cliente</option><option>Inactivo</option></select></th><th><button type="button" className="ghost-button" onClick={()=>setContactFilters({name:"",company:"",phone:"",status:""})}>Limpiar</button></th></tr></thead><tbody>{dataLoading ? <tr><td colSpan={5} className="table-empty">Cargando contactos…</td></tr> : filteredContacts.map(contact=><tr key={contact.id}><td><div className="contact-cell"><span className="avatar">{contact.name[0]}</span><span><strong>{contact.name}</strong><small>{contact.email || "Sin correo"}</small></span></div></td><td>{contact.company || "—"}</td><td>{contact.phone || "—"}</td><td><span className={`status ${contact.status==="Cliente"?"client":contact.status==="Inactivo"?"inactive":"lead"}`}>{contact.status}</span></td><td><div className="row-actions"><button className="ghost-button" onClick={()=>editContact(contact)}>Editar</button><button className="ghost-button" onClick={()=>navigate("conversaciones")}>Contactar</button><button className="danger-button" onClick={()=>deleteContact(contact.id)}>Eliminar</button></div></td></tr>)}</tbody></table></div></article></section>}

      {view === "pipeline" && <section className="view active"><div className="section-heading"><div><h2>Ventas y oportunidades</h2><p>Oportunidades persistentes vinculadas a tus contactos.</p></div><button className="primary-button" onClick={openNewDeal}>＋ Nueva oportunidad</button></div>{showDealForm&&<form className="inline-create deal-create" onSubmit={saveDeal}><input required autoFocus value={dealTitle} onChange={e=>setDealTitle(e.target.value)} placeholder="Título de la oportunidad"/><select className="select" value={dealContactId} onChange={e=>setDealContactId(e.target.value)} aria-label="Contacto relacionado"><option value="">Sin contacto</option>{contacts.map(contact=><option value={contact.id} key={contact.id}>{contact.name}</option>)}</select><input required type="number" min="0" step="0.01" value={dealValue} onChange={e=>setDealValue(e.target.value)} placeholder="Valor en HNL"/><select className="select" value={dealStage} onChange={e=>setDealStage(e.target.value as DealStage)} aria-label="Etapa">{dealStages.map(stage=><option key={stage.id} value={stage.id}>{stage.label}</option>)}</select><input type="date" value={dealCloseDate} onChange={e=>setDealCloseDate(e.target.value)} aria-label="Fecha estimada de cierre"/><button className="primary-button">{editingDealId ? "Actualizar" : "Guardar"}</button><button type="button" className="ghost-button" onClick={closeDealForm}>Cancelar</button></form>}<div className="kanban">{dealStages.map(stage=><div className="kanban-column" key={stage.id}><div className="kanban-title">{stage.label}<span>{deals.filter(deal=>deal.stage===stage.id).length}</span></div>{deals.filter(deal=>deal.stage===stage.id).map(deal=><article className="deal-card" key={deal.id}><h4>{deal.title}</h4><p>{deal.contactName}</p>{deal.expectedCloseDate&&<small>Cierre: {new Date(`${deal.expectedCloseDate}T00:00:00`).toLocaleDateString("es-HN")}</small>}<div className="deal-footer"><strong>{new Intl.NumberFormat("es-HN", { style: "currency", currency: "HNL", maximumFractionDigits: 0 }).format(deal.value)}</strong><div className="deal-actions"><button className="ghost-button" onClick={()=>editDeal(deal)}>Editar</button>{stage.id!=="won"&&<button className="ghost-button" onClick={()=>moveDeal(deal)}>Avanzar →</button>}<button className="danger-button" onClick={()=>deleteDeal(deal.id)}>×</button></div></div></article>)}{!dataLoading&&!deals.some(deal=>deal.stage===stage.id)&&<p className="kanban-empty">Sin oportunidades</p>}</div>)}</div></section>}

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

type ExecutiveDashboardProps = {
  metrics: { contacts: number; conversations: number; deals: number; won: number; pipeline: number; wonValue: number };
  activity: number[];
  threads: Thread[];
  tasks: Task[];
  teamMembers: TeamMember[];
  deals: Deal[];
  period: Period;
  goals: DashboardGoals;
  canConfigure: boolean;
  savingGoals: boolean;
  onPeriodChange: (period: Period) => void;
  onSaveGoals: (goals: DashboardGoals) => Promise<boolean>;
  onNavigate: (view: string) => void;
};

function formatExecutiveCurrency(value: number) {
  return new Intl.NumberFormat("es-HN", { style: "currency", currency: "HNL", maximumFractionDigits: 0 }).format(value);
}

function percentOf(value: number, total: number) {
  return total > 0 ? Math.min(100, Math.round(value / total * 100)) : 0;
}

function ExecutiveDashboard({ metrics, activity, threads, tasks, teamMembers, deals, period, goals, canConfigure, savingGoals, onPeriodChange, onSaveGoals, onNavigate }: ExecutiveDashboardProps) {
  const [editingGoals, setEditingGoals] = useState(false);
  const [draftGoals, setDraftGoals] = useState({ revenue: String(goals.revenue || ""), leads: String(goals.leads || ""), responseMinutes: String(goals.responseMinutes || defaultDashboardGoals.responseMinutes) });

  useEffect(() => {
    setDraftGoals({ revenue: String(goals.revenue || ""), leads: String(goals.leads || ""), responseMinutes: String(goals.responseMinutes || defaultDashboardGoals.responseMinutes) });
  }, [goals]);

  const averageResponseMinutes = useMemo(() => {
    const responseTimes: number[] = [];
    threads.forEach(thread => {
      const messages = [...thread.messages].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
      messages.forEach((message, index) => {
        if (message.direction !== "inbound") return;
        const reply = messages.slice(index + 1).find(candidate => candidate.direction === "outbound");
        if (!reply) return;
        const minutes = (new Date(reply.createdAt).getTime() - new Date(message.createdAt).getTime()) / 60000;
        if (Number.isFinite(minutes) && minutes >= 0 && minutes <= 7 * 24 * 60) responseTimes.push(minutes);
      });
    });
    if (!responseTimes.length) return null;
    return Math.round(responseTimes.reduce((total, value) => total + value, 0) / responseTimes.length);
  }, [threads]);

  const channelPerformance = useMemo(() => {
    const values = new Map<string, { conversations: number; pending: number }>();
    threads.forEach(thread => {
      const item = values.get(thread.channel) || { conversations: 0, pending: 0 };
      item.conversations += 1;
      item.pending += thread.unread > 0 || thread.handlingMode === "waiting_agent" ? 1 : 0;
      values.set(thread.channel, item);
    });
    return Array.from(values.entries()).map(([channel, value]) => ({ channel, ...value })).sort((a, b) => b.conversations - a.conversations).slice(0, 4);
  }, [threads]);

  const openDeals = deals.filter(deal => deal.stage !== "won");
  const stageCount = (stage: DealStage) => deals.filter(deal => deal.stage === stage).length;
  const funnel = [
    { label: "Contactos", value: metrics.contacts, tone: "lead" },
    { label: "Conversaciones", value: metrics.conversations, tone: "conversation" },
    { label: "Nuevas", value: stageCount("new"), tone: "new" },
    { label: "Propuesta", value: stageCount("proposal"), tone: "proposal" },
    { label: "Ganadas", value: metrics.won, tone: "won" }
  ];
  const funnelPeak = Math.max(...funnel.map(item => item.value), 1);
  const overdueTasks = tasks.filter(task => !task.completed_at && task.due_at && new Date(task.due_at).getTime() < Date.now());
  const attentionThreads = threads.filter(thread => thread.unread > 0 || thread.handlingMode === "waiting_agent");
  const salesProgress = goals.revenue > 0 ? percentOf(metrics.wonValue, goals.revenue) : null;
  const leadsProgress = goals.leads > 0 ? percentOf(metrics.contacts, goals.leads) : null;
  const responseOnTarget = averageResponseMinutes === null ? null : averageResponseMinutes <= goals.responseMinutes;
  const completedTasks = tasks.filter(task => task.completed_at).length;
  const taskProgress = tasks.length ? percentOf(completedTasks, tasks.length) : 0;
  const weekdayLabels = ["L", "M", "X", "J", "V", "S", "D"];
  const activeTeam = teamMembers.filter(member => member.active !== false && member.invitationStatus !== "pending").slice(0, 4);
  const highestWorkload = Math.max(...activeTeam.map(member => (member.workload?.conversations || 0) + (member.workload?.tasks || 0) + (member.workload?.deals || 0)), 1);

  async function submitGoals(event: FormEvent) {
    event.preventDefault();
    const nextGoals: DashboardGoals = {
      revenue: Math.max(0, Number(draftGoals.revenue) || 0),
      leads: Math.max(0, Number(draftGoals.leads) || 0),
      responseMinutes: Math.max(1, Number(draftGoals.responseMinutes) || defaultDashboardGoals.responseMinutes)
    };
    if (await onSaveGoals(nextGoals)) setEditingGoals(false);
  }

  const decisionAlerts = [
    attentionThreads.length ? { tone: "urgent", eyebrow: "Atención comercial", title: `${attentionThreads.length} conversación${attentionThreads.length === 1 ? " requiere" : "es requieren"} respuesta`, description: "Prioriza los mensajes con un agente para no perder oportunidades.", action: "Abrir conversaciones", target: "conversaciones" } : null,
    overdueTasks.length ? { tone: "warning", eyebrow: "Seguimientos", title: `${overdueTasks.length} tarea${overdueTasks.length === 1 ? " vencida" : "s vencidas"}`, description: "Reasigna o completa las tareas atrasadas para recuperar el ritmo comercial.", action: "Ver tareas", target: "tareas" } : null,
    salesProgress !== null && salesProgress < 60 ? { tone: "warning", eyebrow: "Meta de ventas", title: `Vas en ${salesProgress}% de la meta`, description: `Faltan ${formatExecutiveCurrency(Math.max(0, goals.revenue - metrics.wonValue))} para alcanzar el objetivo definido.`, action: "Revisar ventas", target: "pipeline_v2" } : null,
    responseOnTarget === false ? { tone: "warning", eyebrow: "Tiempo de respuesta", title: `Promedio de ${averageResponseMinutes} min`, description: `Supera la meta de ${goals.responseMinutes} min. Revisa asignaciones y automatizaciones.`, action: "Ver conversaciones", target: "conversaciones" } : null
  ].filter(Boolean) as { tone: string; eyebrow: string; title: string; description: string; action: string; target: string }[];

  return <section className="view active executive-dashboard">
    <div className="executive-hero">
      <div className="executive-hero-copy">
        <span className="executive-kicker"><i /> PANEL EJECUTIVO</span>
        <h2>Decisiones claras para hacer crecer {" "}<em>tu empresa.</em></h2>
        <p>Una lectura estratégica de ventas, demanda, servicio y ritmo operativo con datos reales de {periodLabels[period]}.</p>
      </div>
      <div className="executive-hero-actions">
        <label className="executive-period"><span>Periodo</span><select value={period} onChange={event => onPeriodChange(event.target.value as Period)}><option value="30d">Últimos 30 días</option><option value="week">Esta semana</option><option value="year">Este año</option></select></label>
        {canConfigure && <button type="button" className="executive-goal-button" onClick={() => setEditingGoals(true)}>◎ Configurar metas</button>}
      </div>
    </div>

    {editingGoals && canConfigure && <form className="executive-goal-form" onSubmit={submitGoals}>
      <div><span className="eyebrow">METAS DEL PERIODO</span><h3>Define la referencia para tomar decisiones</h3><p>Estas metas pertenecen solamente a tu empresa y permiten medir el avance real del panel.</p></div>
      <label>Meta de ventas (HNL)<input type="number" min="0" step="100" value={draftGoals.revenue} onChange={event => setDraftGoals(current => ({ ...current, revenue: event.target.value }))} placeholder="Ej. 250000" /></label>
      <label>Meta de nuevos contactos<input type="number" min="0" step="1" value={draftGoals.leads} onChange={event => setDraftGoals(current => ({ ...current, leads: event.target.value }))} placeholder="Ej. 80" /></label>
      <label>Respuesta máxima (min)<input type="number" min="1" step="1" value={draftGoals.responseMinutes} onChange={event => setDraftGoals(current => ({ ...current, responseMinutes: event.target.value }))} /></label>
      <div className="executive-goal-actions"><button className="primary-button" disabled={savingGoals}>{savingGoals ? "Guardando…" : "Guardar metas"}</button><button type="button" className="ghost-button" onClick={() => setEditingGoals(false)}>Cancelar</button></div>
    </form>}

    <div className="executive-metric-grid">
      <article className="executive-metric-card revenue"><span className="executive-card-icon">↗</span><div><p>Ventas cerradas</p><strong>{formatExecutiveCurrency(metrics.wonValue)}</strong><small>{metrics.won} ganada{metrics.won === 1 ? "" : "s"} · {periodLabels[period]}</small></div><button type="button" onClick={() => onNavigate("pipeline_v2")}>Ver ventas →</button></article>
      <article className="executive-metric-card pipeline"><span className="executive-card-icon">◇</span><div><p>Pipeline activo</p><strong>{formatExecutiveCurrency(metrics.pipeline)}</strong><small>{openDeals.length} venta{openDeals.length === 1 ? "" : "s"} en curso</small></div><button type="button" onClick={() => onNavigate("pipeline_v2")}>Gestionar →</button></article>
      <article className="executive-metric-card demand"><span className="executive-card-icon">◌</span><div><p>Demanda captada</p><strong>{metrics.contacts.toLocaleString("es-HN")}</strong><small>{metrics.conversations} conversaciones iniciadas</small></div><button type="button" onClick={() => onNavigate("contactos")}>Ver contactos →</button></article>
      <article className="executive-metric-card service"><span className="executive-card-icon">◷</span><div><p>Tiempo de respuesta</p><strong>{averageResponseMinutes === null ? "Sin datos" : `${averageResponseMinutes} min`}</strong><small>{averageResponseMinutes === null ? "Se medirá al responder mensajes" : responseOnTarget ? "Dentro de la meta" : "Requiere atención"}</small></div><button type="button" onClick={() => onNavigate("conversaciones")}>Ver bandeja →</button></article>
    </div>

    <div className="executive-goals-grid">
      <article className="executive-goal-card"><div className="executive-goal-top"><span>Meta de ventas</span><strong>{salesProgress === null ? "Sin definir" : `${salesProgress}%`}</strong></div><div className="executive-progress"><i style={{ width: `${salesProgress ?? 0}%` }} /></div><div className="executive-goal-detail"><span>{formatExecutiveCurrency(metrics.wonValue)} cerrados</span><span>{goals.revenue > 0 ? `de ${formatExecutiveCurrency(goals.revenue)}` : "Configura una meta"}</span></div></article>
      <article className="executive-goal-card"><div className="executive-goal-top"><span>Meta de nuevos contactos</span><strong>{leadsProgress === null ? "Sin definir" : `${leadsProgress}%`}</strong></div><div className="executive-progress violet"><i style={{ width: `${leadsProgress ?? 0}%` }} /></div><div className="executive-goal-detail"><span>{metrics.contacts} contactos captados</span><span>{goals.leads > 0 ? `de ${goals.leads}` : "Configura una meta"}</span></div></article>
      <article className="executive-goal-card"><div className="executive-goal-top"><span>Ritmo operativo</span><strong>{taskProgress}%</strong></div><div className="executive-progress amber"><i style={{ width: `${taskProgress}%` }} /></div><div className="executive-goal-detail"><span>{completedTasks} tareas completadas</span><span>{tasks.length} planificadas</span></div></article>
    </div>

    <div className="executive-insights-grid">
      <article className="panel executive-funnel-panel"><div className="executive-panel-header"><div><span className="eyebrow">CONVERSIÓN</span><h3>Embudo comercial actual</h3><p>Del interés inicial al cierre de una venta.</p></div><button type="button" className="text-action" onClick={() => onNavigate("pipeline_v2")}>Abrir ventas y oportunidades →</button></div><div className="executive-funnel">{funnel.map((step, index) => <div className="funnel-row" key={step.label}><div className="funnel-label"><span>{String(index + 1).padStart(2, "0")}</span><strong>{step.label}</strong><em>{step.value}</em></div><div className="funnel-track"><i className={step.tone} style={{ width: `${Math.max(step.value ? 12 : 0, percentOf(step.value, funnelPeak))}%` }} /></div></div>)}</div></article>
      <article className="panel executive-trend-panel"><div className="executive-panel-header"><div><span className="eyebrow">TENDENCIA</span><h3>Actividad de los últimos 7 días</h3><p>Mensajes y oportunidades generadas por día.</p></div><span className="executive-live"><i /> En seguimiento</span></div><div className="executive-trend-bars">{activity.map((height, index) => <div className="executive-trend-day" key={index}><div className="executive-bar-rail"><i style={{ height: `${height}%` }} /></div><span>{weekdayLabels[index]}</span></div>)}</div><div className="executive-trend-footer"><span>Usa esta tendencia para anticipar picos de atención.</span><button type="button" onClick={() => onNavigate("reportes")}>Ver reportes →</button></div></article>
    </div>

    <div className="executive-operations-grid">
      <article className="panel executive-channel-panel"><div className="executive-panel-header"><div><span className="eyebrow">CANALES</span><h3>Rendimiento por canal</h3></div><button type="button" className="text-action" onClick={() => onNavigate("conversaciones")}>Bandeja →</button></div>{channelPerformance.length ? <div className="executive-channel-list">{channelPerformance.map(item => <div key={item.channel}><span className="channel-initial">{item.channel.slice(0, 1)}</span><strong>{item.channel}</strong><span>{item.conversations} conversación{item.conversations === 1 ? "" : "es"}</span><em className={item.pending ? "needs-attention" : "on-track"}>{item.pending ? `${item.pending} pendiente${item.pending === 1 ? "" : "s"}` : "Al día"}</em></div>)}</div> : <div className="executive-empty-state"><span>◌</span><p>Aún no hay conversaciones registradas por canal.</p></div>}</article>
      <article className="panel executive-team-panel"><div className="executive-panel-header"><div><span className="eyebrow">EQUIPO</span><h3>Capacidad de atención</h3></div><button type="button" className="text-action" onClick={() => onNavigate("equipo")}>Ver equipo →</button></div>{activeTeam.length ? <div className="executive-team-list">{activeTeam.map(member => { const workload = (member.workload?.conversations || 0) + (member.workload?.tasks || 0) + (member.workload?.deals || 0); return <div className="executive-team-member" key={member.id}><span className={`avatar ${member.online ? "online" : ""}`}>{member.name.slice(0, 1).toUpperCase()}</span><div><strong>{member.name}</strong><small>{workload ? `${workload} elementos activos` : "Sin carga registrada"}</small><i><b style={{ width: `${percentOf(workload, highestWorkload)}%` }} /></i></div><em>{member.online ? "En línea" : member.role === "owner" ? "Propietario" : "Equipo"}</em></div>; })}</div> : <div className="executive-empty-state"><span>◌</span><p>Invita a tu equipo para medir la capacidad de atención.</p></div>}</article>
      <article className="panel executive-alerts-panel"><div className="executive-panel-header"><div><span className="eyebrow">DECISIONES</span><h3>Alertas que importan</h3></div><span className={`executive-alert-count ${decisionAlerts.length ? "active" : ""}`}>{decisionAlerts.length}</span></div>{decisionAlerts.length ? <div className="executive-alert-list">{decisionAlerts.slice(0, 3).map(alert => <article className={alert.tone} key={alert.title}><div><span>{alert.eyebrow}</span><strong>{alert.title}</strong><p>{alert.description}</p></div><button type="button" onClick={() => onNavigate(alert.target)}>{alert.action} →</button></article>)}</div> : <div className="executive-good-state"><span>✓</span><strong>Todo está encaminado</strong><p>No hay alertas prioritarias para este periodo.</p></div>}</article>
    </div>
  </section>;
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
  onAssign: (id: string, assignedTo: string) => Promise<void>;
  canAssign: boolean;
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

function parseCrmDate(value: string | null | undefined) {
  if (!value) return new Date(Number.NaN);
  const normalized = value.trim();
  // Supabase puede devolver timestamps antiguos sin zona; esos valores son hora local del CRM.
  if (/^\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?)?$/.test(normalized)) return new Date(normalized.replace(" ", "T"));
  return new Date(normalized);
}

function localDateTimeToIso(date: string, time: string) {
  const local = new Date(`${date}T${time}:00`);
  return Number.isNaN(local.getTime()) ? `${date}T${time}:00` : local.toISOString();
}

function formatTaskDate(value: string | null) {
  if (!value) return "Sin fecha";
  return parseCrmDate(value).toLocaleString("es-HN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}


function localDateKey(value: Date) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

function TasksView({ tasks, teamMembers, userId, filter, onFilterChange, onToggle, onDelete, onCreate, onAssign, canAssign }: TaskCenterProps) {
  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newTime, setNewTime] = useState("15:00");
  const now = new Date();
  const todayKey = localDateKey(now);
  const filtered = tasks.filter(task => {
    const due = task.due_at ? parseCrmDate(task.due_at) : null;
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
    <article className="panel task-center-panel"><div className="panel-header"><div><h3>{taskFilterLabels[filter]}</h3><p>{pending} pendiente{pending === 1 ? "" : "s"} · {filtered.length} en este filtro</p></div><span className="task-center-count">{filtered.length}</span></div><div className="task-center-list">{filtered.length ? filtered.map(task => { const assignee = teamMembers.find(member => member.id === task.assigned_to); return <div className={`task-center-row ${task.completed_at ? "done" : ""}`} key={task.id}><input type="checkbox" checked={Boolean(task.completed_at)} onChange={() => void onToggle(task)} aria-label={`Completar ${task.title}`} /><div className="task-center-main"><strong>{task.title}</strong><small>{formatTaskDate(task.due_at)} · {assignee?.name || "Sin asignar"}</small></div><div className="task-row-meta"><span className={`task-source ${task.source || "manual"}`}>{taskSourceLabel(task.source)}</span>{canAssign && filter === "team" && <select className="task-assignee-select" aria-label={`Asignar ${task.title}`} value={task.assigned_to || ""} onChange={event => void onAssign(task.id, event.target.value)}><option value="">Sin asignar</option>{teamMembers.filter(member => member.active !== false && member.invitationStatus !== "pending" && member.role !== "viewer").map(member => <option key={member.id} value={member.id}>{member.name}</option>)}</select>}</div><button type="button" className="task-delete persistent" onClick={() => void onDelete(task.id)} aria-label={`Eliminar ${task.title}`}>×</button></div>; }) : <div className="task-center-empty"><span>✓</span><strong>No hay tareas en este filtro</strong><p>Cuando llegue una solicitud o crees un seguimiento, aparecerá aquí.</p></div>}</div></article>
  </section>;
}

function CalendarView({ tasks, events, enabledModules, onToggle, onDelete, onCreate, onUpdate }: { tasks: Task[]; events: CalendarEvent[]; enabledModules: string[] | null; onToggle: (task: Task) => Promise<void>; onDelete: (id: string) => Promise<void>; onCreate: (title: string, time: string, date?: string) => Promise<void>; onUpdate: (id: string, title: string, dueAt: string) => Promise<void> }) {
  const today = new Date();
  const todayKey = localDateKey(today);
  const [monthCursor, setMonthCursor] = useState(new Date(today.getFullYear(), today.getMonth(), 1));
  const [selectedDate, setSelectedDate] = useState(todayKey);
  const [creatingDate, setCreatingDate] = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState("");
  const [newTime, setNewTime] = useState("09:00");
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [externalEvents, setExternalEvents] = useState<CalendarEvent[]>([]);
  const [editTitle, setEditTitle] = useState("");
  const [editDate, setEditDate] = useState(todayKey);
  const [editTime, setEditTime] = useState("09:00");

  const daysInMonth = new Date(monthCursor.getFullYear(), monthCursor.getMonth() + 1, 0).getDate();
  const offset = (new Date(monthCursor.getFullYear(), monthCursor.getMonth(), 1).getDay() + 6) % 7;
  const cells: Array<Date | null> = Array.from({ length: offset + daysInMonth }, (_, index) => index < offset ? null : new Date(monthCursor.getFullYear(), monthCursor.getMonth(), index - offset + 1));
  const taskEvents: CalendarEvent[] = tasks.filter(task => Boolean(task.due_at)).map(task => ({ id: `task-${task.id}`, kind: "task", title: task.title, start: task.due_at as string, detail: task.completed_at ? "Completada" : "Pendiente", status: task.completed_at ? "completed" : "pending", sourceId: task.id, editable: true }));
  const eventModule: Record<string, string> = { reservation: "reservations", appointment: "appointments", property_visit: "visits" };
  const visibleEvents = events.filter(event => !enabledModules || event.kind === "external" || !eventModule[event.kind] || enabledModules.includes(eventModule[event.kind]));
  const allEvents = [...taskEvents, ...visibleEvents, ...externalEvents];
  const selectedEvents = allEvents.filter(event => localDateKey(parseCrmDate(event.start)) === selectedDate).sort((a, b) => parseCrmDate(a.start).getTime() - parseCrmDate(b.start).getTime());
  const pendingCount = tasks.filter(task => !task.completed_at).length;

  function eventsForDate(key: string) { return allEvents.filter(event => localDateKey(parseCrmDate(event.start)) === key); }
  function openDate(key: string) { setSelectedDate(key); setCreatingDate(key); const date = new Date(`${key}T12:00:00`); setMonthCursor(new Date(date.getFullYear(), date.getMonth(), 1)); }
  function moveMonth(delta: number) { const next = new Date(monthCursor.getFullYear(), monthCursor.getMonth() + delta, 1); setMonthCursor(next); setSelectedDate(localDateKey(next)); setCreatingDate(null); }
  function startEdit(task: Task) { const value = task.due_at ? parseCrmDate(task.due_at) : new Date(); setEditingTaskId(task.id); setEditTitle(task.title); setEditDate(localDateKey(value)); setEditTime(value.toTimeString().slice(0, 5)); setCreatingDate(null); }
  async function submitNew(event: FormEvent) { event.preventDefault(); if (!creatingDate || !newTitle.trim()) return; await onCreate(newTitle, newTime, creatingDate); setNewTitle(""); setCreatingDate(null); }
  async function submitEdit(event: FormEvent) { event.preventDefault(); if (!editingTaskId || !editTitle.trim()) return; await onUpdate(editingTaskId, editTitle, localDateTimeToIso(editDate, editTime)); setEditingTaskId(null); }

  return <section className="view active calendar-view">
    <div className="section-heading"><div><p className="eyebrow">PLANIFICACIÓN</p><h2>Calendario</h2><p>Coordina tareas, reservas, citas y visitas de tu empresa en un solo lugar.</p></div><div className="section-actions"><button type="button" className="secondary-button" onClick={() => { setMonthCursor(new Date(today.getFullYear(), today.getMonth(), 1)); setSelectedDate(todayKey); setCreatingDate(null); }}>Hoy</button><button type="button" className="primary-button" onClick={() => setCreatingDate(selectedDate)}>＋ Nueva tarea</button></div></div>
    <div className="calendar-layout">
      <article className="panel calendar-panel"><div className="calendar-heading"><div className="calendar-month-nav"><button type="button" className="icon-button" aria-label="Mes anterior" onClick={() => moveMonth(-1)}>‹</button><h3>{monthCursor.toLocaleDateString("es-HN", { month: "long", year: "numeric" })}</h3><button type="button" className="icon-button" aria-label="Mes siguiente" onClick={() => moveMonth(1)}>›</button></div><span>{pendingCount} pendiente{pendingCount === 1 ? "" : "s"}</span></div><div className="calendar-weekdays">{["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"].map(day => <span key={day}>{day}</span>)}</div><div className="calendar-grid">{cells.map((date, index) => { const key = date ? localDateKey(date) : `empty-${index}`; const dayEvents = date ? eventsForDate(key) : []; return date ? <button type="button" className={`calendar-day ${key === selectedDate ? "selected" : ""} ${key === todayKey ? "today" : ""}`} key={key} onClick={() => openDate(key)}><strong>{date.getDate()}</strong>{dayEvents.slice(0, 3).map(event => <span className={`calendar-event-chip ${event.kind} ${event.status === "completed" ? "done" : ""}`} key={event.id}>{event.title}</span>)}{dayEvents.length > 3 && <small>+{dayEvents.length - 3} más</small>}</button> : <span className="calendar-day empty" key={key} />; })}</div><div className="calendar-legend"><span><i className="task" />Tareas</span><span><i className="reservation" />Reservas</span><span><i className="appointment" />Citas</span><span><i className="property_visit" />Visitas</span></div></article>
      <aside className="panel calendar-agenda"><div className="panel-header"><div><p className="eyebrow">AGENDA</p><h3>{new Date(`${selectedDate}T12:00:00`).toLocaleDateString("es-HN", { weekday: "long", day: "numeric", month: "long" })}</h3><p>{selectedEvents.length} evento{selectedEvents.length === 1 ? "" : "s"}</p></div></div>{creatingDate && <form className="calendar-create" onSubmit={submitNew}><strong>Nueva tarea</strong><input required autoFocus value={newTitle} onChange={event => setNewTitle(event.target.value)} placeholder="Ej. Llamar a un interesado" /><div className="calendar-form-row"><input type="date" value={creatingDate} onChange={event => { setCreatingDate(event.target.value); setSelectedDate(event.target.value); }} /><input type="time" value={newTime} onChange={event => setNewTime(event.target.value)} /></div><div className="row-actions"><button className="primary-button">Crear</button><button type="button" className="ghost-button" onClick={() => setCreatingDate(null)}>Cancelar</button></div></form>}{selectedEvents.length ? selectedEvents.map(event => { const task = event.kind === "task" ? tasks.find(item => item.id === event.sourceId) : null; return <div className={`calendar-agenda-item ${event.kind}`} key={event.id}>{task && editingTaskId === task.id ? <form onSubmit={submitEdit} className="calendar-edit"><input required value={editTitle} onChange={e => setEditTitle(e.target.value)} /><div className="calendar-form-row"><input type="date" value={editDate} onChange={e => setEditDate(e.target.value)} /><input type="time" value={editTime} onChange={e => setEditTime(e.target.value)} /></div><div className="row-actions"><button className="primary-button">Guardar</button><button type="button" className="ghost-button" onClick={() => setEditingTaskId(null)}>Cancelar</button></div></form> : <><div className="calendar-agenda-main"><span className="calendar-kind-dot" /><div><strong>{event.title}</strong><small>{parseCrmDate(event.start).toLocaleTimeString("es-HN", { hour: "2-digit", minute: "2-digit" })}{event.detail ? ` · ${event.detail}` : ""}</small></div></div>{task ? <div className="calendar-item-actions"><label className="calendar-complete-toggle"><input type="checkbox" checked={Boolean(task.completed_at)} onChange={() => void onToggle(task)} /> <span>{task.completed_at ? "Completada" : "Marcar completa"}</span></label><div className="calendar-action-buttons"><button type="button" className="calendar-action-button" title="Editar fecha, hora o título" onClick={() => startEdit(task)}>Editar</button><button type="button" className="calendar-action-button danger" title="Eliminar tarea" onClick={() => void onDelete(task.id)}>Eliminar</button></div></div> : <small className="calendar-readonly">Evento recibido desde {event.kind === "reservation" ? "reservaciones" : event.kind === "appointment" ? "citas" : "visitas"} · solo lectura</small>}</>}</div>; }) : !creatingDate && <div className="calendar-empty"><span>◷</span><strong>No hay eventos este día</strong><p>Selecciona una fecha o crea una tarea para comenzar.</p><button type="button" className="secondary-button" onClick={() => setCreatingDate(selectedDate)}>Crear tarea aquí</button></div>}</aside>
    </div>
    <CalendarSyncPanel onSynced={synced => setExternalEvents(current => [...current.filter(event => event.kind !== "external"), ...synced])} onDisconnected={() => setExternalEvents([])} />
  </section>;
}

function CalendarSyncPanel({ onSynced, onDisconnected }: { onSynced: (events: CalendarEvent[]) => void; onDisconnected: () => void }) {
  const [connections, setConnections] = useState<Array<{ provider: string; status: string; last_error?: string | null }>>([]);
  const [syncing, setSyncing] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => { fetch("/api/calendar/connections").then(response => response.ok ? response.json() : { connections: [] }).then(data => setConnections(Array.isArray(data.connections) ? data.connections : [])).catch(() => undefined); }, []);
  async function sync() { setSyncing(true); setMessage(""); try { const response = await fetch("/api/calendar/sync", { method: "POST" }); const data = await response.json(); if (!response.ok) throw new Error(data.error || "No fue posible sincronizar"); onSynced((data.events || []) as CalendarEvent[]); setMessage(`Sincronizado: ${(data.events || []).length} eventos externos.`); } catch (error) { setMessage(error instanceof Error ? error.message : "No fue posible sincronizar"); } finally { setSyncing(false); } }
  async function disconnectGoogle(reconnect = false) {
    const prompt = reconnect ? "¿Cambiar la cuenta de Google Calendar? La cuenta actual se desvinculará antes de conectar la nueva." : "¿Desvincular esta cuenta de Google Calendar? Los eventos importados dejarán de mostrarse en Gavrion.";
    if (!window.confirm(prompt)) return;
    setDisconnecting(true); setMessage("");
    try {
      const response = await fetch("/api/calendar/disconnect", { method: "DELETE" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "No se pudo desvincular Google Calendar.");
      setConnections(current => current.filter(connection => connection.provider !== "google"));
      onDisconnected();
      if (reconnect) window.location.assign("/api/calendar/connect?provider=google");
      else setMessage("Cuenta de Google Calendar desvinculada.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "No se pudo desvincular Google Calendar."); }
    finally { setDisconnecting(false); }
  }
  const statusFor = (provider: string) => connections.find(item => item.provider === provider);
  const googleConnection = statusFor("google");
  const connected = googleConnection?.status === "connected";
  return <article className="panel calendar-sync"><div><p className="eyebrow">INTEGRACIÓN</p><h3>Google Calendar</h3><p>Importa los eventos de Google Calendar junto con la agenda del CRM. Tus credenciales permanecen cifradas y solo el administrador de la empresa puede conectarlas.</p></div><div className="calendar-sync-actions"><div className="calendar-provider"><div><strong>Google Calendar</strong><small>{connected ? "Conectado" : googleConnection?.last_error || "Sin conectar"}</small></div><div className="calendar-provider-actions">{!connected && <a className="secondary-button" href="/api/calendar/connect?provider=google">Conectar cuenta</a>}{connected && <button type="button" className="calendar-provider-button" onClick={() => void disconnectGoogle(true)} disabled={disconnecting}>Cambiar cuenta</button>}</div></div><button type="button" className="primary-button" onClick={() => void sync()} disabled={syncing || disconnecting}>{syncing ? "Sincronizando…" : "Sincronizar Google Calendar"}</button>{connected && <button type="button" className="calendar-unlink-button" onClick={() => void disconnectGoogle()} disabled={disconnecting}>{disconnecting ? "Desvinculando…" : "Desvincular cuenta"}</button>}</div>{message && <p className="calendar-sync-message">{message}</p>}</article>;
}
