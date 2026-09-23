export type MenuOption={id:string;name:string;price:number};
export type MenuItem = { id:string; category:string; name:string; description:string; price:number; imageUrl:string; gallery:string[]; active:boolean; availability:{days:string[];start:string;end:string};sizes:MenuOption[];extras:MenuOption[];promotion:{enabled:boolean;label:string;price:number} };
export type PropertyListing = { id:string; title:string; location:string; operation:"venta"|"alquiler"; status:string; price:number; currency:string; bedrooms:number|string; bathrooms:number|string; area:number|string; imageUrl:string };
export type SiteSection = { id:string; label:string; visible:boolean };
export type GastronomySiteConfig = {
  template:string;
  brand:{name:string;shortName:string;logoUrl:string;primaryColor:string;secondaryColor:string;backgroundColor:string;surfaceColor:string};
  seo:{title:string;description:string};
  hero:{eyebrow:string;title:string;description:string;imageUrl:string;stamp:string};
  experience:{eyebrow:string;title:string;description:string};
  menu:{title:string;currency:string;currencySymbol:string;categories:string[];items:MenuItem[]};
  properties:PropertyListing[];
  contact:{phone:string;whatsapp:string;email:string;address:string;schedule:string;mapUrl:string;latitude:string;longitude:string};
  social:{facebook:string;instagram:string;tiktok:string};
  gallery:string[];
  features:{orders:boolean;reservations:boolean;tableQr:boolean;kitchenPreview:boolean};
  integrations:{crmBaseUrl:string;tenantKey:string;useRealChatbox:boolean;useLiveCatalog:boolean};
  layout:{sections:SiteSection[]};
};

export const defaultSiteSections:SiteSection[]=[
  {id:"inicio",label:"Portada",visible:true},{id:"experiencia",label:"Experiencia",visible:true},{id:"nosotros",label:"Experiencia",visible:true},{id:"propiedades",label:"Catálogo",visible:true},{id:"menu",label:"Menú",visible:true},{id:"operaciones",label:"Operaciones",visible:true},{id:"proof",label:"Beneficios",visible:true},{id:"contacto",label:"Contacto",visible:true},
];

export const gastronomyDefaultConfig:GastronomySiteConfig={
  template:"gastronomia-a",
  brand:{name:"Brasa & Olivo",shortName:"BO",logoUrl:"",primaryColor:"#b45336",secondaryColor:"#343a2b",backgroundColor:"#f5f0e7",surfaceColor:"#fffdf8"},
  seo:{title:"Brasa & Olivo | Restaurante",description:"Cocina de temporada, fuego vivo y una mesa pensada para compartir."},
  hero:{eyebrow:"COCINA DE FUEGO · CENTRO HISTÓRICO",title:"Sabores que se quedan.",description:"Cocina de temporada, fuego vivo y una mesa pensada para compartir sin prisa.",imageUrl:"https://images.unsplash.com/photo-1515003197210-e0cd71810b5f?auto=format&fit=crop&w=1800&q=85",stamp:"HECHO AL MOMENTO"},
  experience:{eyebrow:"UNA EXPERIENCIA QUE EMPIEZA ANTES DE LLEGAR",title:"La atención correcta, en el momento correcto.",description:"Nuestro menú digital, asistente y equipo trabajan juntos para darte una atención rápida y ordenada."},
  menu:{title:"Elige tu antojo",currency:"HNL",currencySymbol:"L",categories:["Favoritos","Entradas","Principales","Postres"],items:[
    menuItem("pulpo","Favoritos","Pulpo a las brasas","papas confitadas · alioli de chile seco",285,"https://images.unsplash.com/photo-1547592180-85f173990554?auto=format&fit=crop&w=900&q=85"),
    menuItem("risotto","Principales","Risotto de hongos","parmesano añejo · aceite de trufa",240,"https://images.unsplash.com/photo-1476124369491-e7addf5db371?auto=format&fit=crop&w=900&q=85"),
    menuItem("costilla","Favoritos","Costilla glaseada","puré rústico · cebolla encurtida",320,"https://images.unsplash.com/photo-1544025162-d76694265947?auto=format&fit=crop&w=900&q=85")
  ]},
  properties:[],
  contact:{phone:"+504 0000-0000",whatsapp:"50400000000",email:"reservas@empresa.com",address:"Centro Histórico",schedule:"12:00 p. m. a 10:30 p. m.",mapUrl:"",latitude:"",longitude:""},
  social:{facebook:"",instagram:"",tiktok:""},
  gallery:[],
  features:{orders:true,reservations:true,tableQr:true,kitchenPreview:true},
  integrations:{crmBaseUrl:"https://gavrion-crm.vercel.app",tenantKey:"",useRealChatbox:false,useLiveCatalog:false},
  layout:{sections:defaultSiteSections}
};

function menuItem(id:string,category:string,name:string,description:string,price:number,imageUrl:string):MenuItem{return{id,category,name,description,price,imageUrl,gallery:[],active:true,availability:{days:["lun","mar","mié","jue","vie","sáb","dom"],start:"00:00",end:"23:59"},sizes:[],extras:[],promotion:{enabled:false,label:"",price:0}}}

export function cleanSiteSlug(value:string){return value.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"").slice(0,55)||"sitio"}

export function siteConfigForTemplate(key:string,company:string):GastronomySiteConfig{const base=structuredClone(gastronomyDefaultConfig);base.template=key;base.brand.name=company;base.brand.shortName=company.split(/\s+/).map(x=>x[0]).join("").slice(0,3).toUpperCase();const variants:Record<string,Partial<GastronomySiteConfig>>={"gastronomia-b":{brand:{...base.brand,primaryColor:"#d97706",secondaryColor:"#1f2937",backgroundColor:"#fff7ed",surfaceColor:"#ffffff"},hero:{...base.hero,title:"Una mesa para recordar.",eyebrow:"COCINA CONTEMPORÁNEA"}},"inmobiliaria-a":{brand:{...base.brand,primaryColor:"#506600",secondaryColor:"#343a2b",backgroundColor:"#f8f9fa",surfaceColor:"#ffffff"},hero:{...base.hero,title:"Encuentra un lugar que se sienta tuyo.",eyebrow:"PROPIEDADES SELECCIONADAS",description:"Compra, alquila o agenda una visita con acompañamiento profesional."},experience:{...base.experience,eyebrow:"ACOMPAÑAMIENTO DE PRINCIPIO A FIN",title:"Decisiones importantes, con la información correcta.",description:"La web, el chatbox y el CRM trabajan juntos para que cada consulta tenga seguimiento y cada visita avance con claridad."},menu:{...base.menu,title:"Propiedades destacadas",categories:["Venta","Alquiler","Proyectos"],items:[]},properties:[{id:"p1",title:"Casa moderna en zona residencial",location:"Tegucigalpa · Lomas del Guijarro",operation:"venta",status:"Destacada",price:285000,currency:"USD",bedrooms:3,bathrooms:2,area:240,imageUrl:"https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=1000&q=85"},{id:"p2",title:"Apartamento con vista a la ciudad",location:"San Pedro Sula · Río de Piedras",operation:"alquiler",status:"Disponible",price:1200,currency:"USD",bedrooms:2,bathrooms:2,area:118,imageUrl:"https://images.unsplash.com/photo-1600607687920-4e2a09cf159d?auto=format&fit=crop&w=1000&q=85"},{id:"p3",title:"Terreno para proyecto residencial",location:"Valle de Ángeles · Francisco Morazán",operation:"venta",status:"Nuevo",price:95000,currency:"USD",bedrooms:0,bathrooms:0,area:640,imageUrl:"https://images.unsplash.com/photo-1500382017468-9049fed747ef?auto=format&fit=crop&w=1000&q=85"}],features:{...base.features,orders:false,tableQr:false,kitchenPreview:false}},"servicios-a":{brand:{...base.brand,primaryColor:"#2563eb",secondaryColor:"#172554",backgroundColor:"#eff6ff",surfaceColor:"#ffffff"},hero:{...base.hero,title:"Experiencia que impulsa resultados.",eyebrow:"SERVICIOS PROFESIONALES"},menu:{...base.menu,title:"Nuestros servicios",categories:["Servicios","Soluciones"],items:[]}},"comercio-a":{brand:{...base.brand,primaryColor:"#7c3aed",secondaryColor:"#2e1065",backgroundColor:"#faf5ff",surfaceColor:"#ffffff"},hero:{...base.hero,title:"Todo lo que buscas, más cerca.",eyebrow:"CATÁLOGO Y COMPRA"},menu:{...base.menu,title:"Productos destacados",categories:["Novedades","Ofertas","Productos"],items:[]}},"hoteles-a":{brand:{...base.brand,primaryColor:"#0f766e",secondaryColor:"#134e4a",backgroundColor:"#f0fdfa",surfaceColor:"#ffffff"},hero:{...base.hero,title:"Tu próxima experiencia comienza aquí.",eyebrow:"HOSPITALIDAD Y DESTINOS"},menu:{...base.menu,title:"Habitaciones y experiencias",categories:["Habitaciones","Experiencias","Paquetes"],items:[]}}};return sanitizeSiteConfig({...base,...variants[key],seo:{...base.seo,title:`${company} | Sitio oficial`}})}

export function sanitizeSiteConfig(input:unknown):GastronomySiteConfig{
  const value=(input&&typeof input==="object"?input:{}) as Partial<GastronomySiteConfig>;
  const menu=value.menu||gastronomyDefaultConfig.menu;
  return {
    ...gastronomyDefaultConfig,...value,
    brand:{...gastronomyDefaultConfig.brand,...value.brand},seo:{...gastronomyDefaultConfig.seo,...value.seo},
    hero:{...gastronomyDefaultConfig.hero,...value.hero},experience:{...gastronomyDefaultConfig.experience,...value.experience},
    contact:{...gastronomyDefaultConfig.contact,...value.contact},social:{...gastronomyDefaultConfig.social,...value.social},gallery:Array.isArray(value.gallery)?value.gallery.map(String).slice(0,12):[],features:{...gastronomyDefaultConfig.features,...value.features},
    integrations:{crmBaseUrl:String(value.integrations?.crmBaseUrl||gastronomyDefaultConfig.integrations.crmBaseUrl).slice(0,300),tenantKey:String(value.integrations?.tenantKey||"").slice(0,120),useRealChatbox:value.integrations?.useRealChatbox===true,useLiveCatalog:value.integrations?.useLiveCatalog===true},
    layout:{sections:Array.isArray(value.layout?.sections)?value.layout.sections.map((raw)=>{const item=raw as Partial<SiteSection>;return{id:String(item.id||""),label:String(item.label||item.id||"Sección").slice(0,60),visible:item.visible!==false}}).filter(item=>item.id).slice(0,20):defaultSiteSections},
    properties:Array.isArray(value.properties)?value.properties.slice(0,60).map(raw=>{const item=raw as Partial<PropertyListing>;return{id:String(item.id||crypto.randomUUID()),title:String(item.title||"Propiedad").slice(0,140),location:String(item.location||"").slice(0,180),operation:item.operation==="alquiler"?"alquiler":"venta",status:String(item.status||"Disponible").slice(0,40),price:Math.max(0,Number(item.price||0)),currency:String(item.currency||"USD").slice(0,8),bedrooms:typeof item.bedrooms==="number"||typeof item.bedrooms==="string"?item.bedrooms:0,bathrooms:typeof item.bathrooms==="number"||typeof item.bathrooms==="string"?item.bathrooms:0,area:typeof item.area==="number"||typeof item.area==="string"?item.area:0,imageUrl:String(item.imageUrl||"").slice(0,2000)}}):[],
    menu:{...gastronomyDefaultConfig.menu,...menu,categories:Array.isArray(menu.categories)?menu.categories.map(String).filter(Boolean).slice(0,20):gastronomyDefaultConfig.menu.categories,items:Array.isArray(menu.items)?menu.items.slice(0,200).map(raw=>{const item=raw as Partial<MenuItem>;return {...menuItem("","Menú","","",0,""),...item,id:String(item.id||crypto.randomUUID()),category:String(item.category||"Menú").slice(0,80),name:String(item.name||"").slice(0,120),description:String(item.description||"").slice(0,500),price:Math.max(0,Number(item.price||0)),imageUrl:String(item.imageUrl||""),gallery:Array.isArray(item.gallery)?item.gallery.map(String).slice(0,8):[],availability:{days:Array.isArray(item.availability?.days)?item.availability.days.map(String).slice(0,7):["lun","mar","mié","jue","vie","sáb","dom"],start:String(item.availability?.start||"00:00"),end:String(item.availability?.end||"23:59")},sizes:sanitizeOptions(item.sizes),extras:sanitizeOptions(item.extras),promotion:{enabled:item.promotion?.enabled===true,label:String(item.promotion?.label||"").slice(0,80),price:Math.max(0,Number(item.promotion?.price||0))},active:item.active!==false}}):gastronomyDefaultConfig.menu.items}
  };
}

// Evita que campos privados lleguen a site-config.js, ZIPs o despliegues públicos,
// incluso si una configuración antigua contiene claves no reconocidas.
export function removePrivateConfigKeys<T>(input:T):T {
  const forbidden=/(token|secret|password|credential|private.?key|access.?key|client.?secret|api.?key)/i;
  const clean=(value:unknown):unknown=>{
    if(Array.isArray(value))return value.map(clean);
    if(value&&typeof value==="object")return Object.fromEntries(Object.entries(value).filter(([key])=>!forbidden.test(key)).map(([key,item])=>[key,clean(item)]));
    return value;
  };
  return clean(input) as T;
}

function sanitizeOptions(input:unknown):MenuOption[]{return Array.isArray(input)?input.slice(0,20).map(raw=>{const item=raw as Partial<MenuOption>;return{id:String(item.id||crypto.randomUUID()),name:String(item.name||"").slice(0,80),price:Math.max(0,Number(item.price||0))}}).filter(item=>item.name):[]}

export function validateSiteForPublication(config:GastronomySiteConfig){const errors:string[]=[];const warnings:string[]=[];if(!config.brand.name.trim())errors.push("Falta el nombre comercial.");if(!config.brand.logoUrl)errors.push("Falta el logo.");if(!config.hero.imageUrl)errors.push("Falta la imagen principal.");if(!config.contact.phone.trim())errors.push("Falta el teléfono.");if(!config.contact.email.includes("@"))errors.push("El correo de contacto no es válido.");if(!config.contact.address.trim())errors.push("Falta la ubicación.");if(config.template==="inmobiliaria-a"){if(!config.properties.some(item=>item.title.trim()&&item.imageUrl.trim()))errors.push("Debes publicar al menos una propiedad con imagen.")}else{if(!config.menu.categories.length)errors.push("Debes crear al menos una categoría.");if(!config.menu.items.some(item=>item.active))errors.push("Debes publicar al menos un platillo.")}if(config.integrations.useRealChatbox&&!config.integrations.tenantKey)errors.push("El chatbox está activo pero no tiene identificador.");if(config.contact.phone.includes("0000"))warnings.push("El teléfono parece ser de demostración.");if(!config.contact.mapUrl&&!config.contact.latitude)warnings.push("No se configuró mapa o coordenadas.");if(!config.social.facebook&&!config.social.instagram&&!config.social.tiktok)warnings.push("No se agregaron redes sociales.");return{valid:errors.length===0,errors,warnings}}
