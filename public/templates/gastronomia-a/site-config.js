/* Configuración portable. El constructor de Gavrion reemplazará este objeto por cliente. */
window.GAVRION_SITE = {
  template: "gastronomia-a",
  brand: { name:"Brasa & Olivo", shortName:"BO", logoUrl:"", primaryColor:"#b45336", secondaryColor:"#343a2b", backgroundColor:"#f5f0e7", surfaceColor:"#fffdf8" },
  seo: { title:"Brasa & Olivo | Restaurante", description:"Cocina de temporada, fuego vivo y una mesa pensada para compartir." },
  hero: { eyebrow:"COCINA DE FUEGO · CENTRO HISTÓRICO", title:"Sabores que se quedan.", description:"Cocina de temporada, fuego vivo y una mesa pensada para compartir sin prisa.", imageUrl:"https://images.unsplash.com/photo-1515003197210-e0cd71810b5f?auto=format&fit=crop&w=1800&q=85", stamp:"HECHO AL MOMENTO" },
  experience: { eyebrow:"UNA EXPERIENCIA QUE EMPIEZA ANTES DE LLEGAR", title:"La atención correcta, en el momento correcto.", description:"Nuestro menú digital, asistente y equipo trabajan juntos para darte una atención rápida y ordenada." },
  menu: {
    title:"Elige tu antojo", currency:"HNL", currencySymbol:"L", categories:["Favoritos","Entradas","Principales","Postres"],
    items:[
      {id:"pulpo",category:"Favoritos",name:"Pulpo a las brasas",description:"papas confitadas · alioli de chile seco",price:285,imageUrl:"https://images.unsplash.com/photo-1547592180-85f173990554?auto=format&fit=crop&w=900&q=85",active:true},
      {id:"risotto",category:"Principales",name:"Risotto de hongos",description:"parmesano añejo · aceite de trufa",price:240,imageUrl:"https://images.unsplash.com/photo-1476124369491-e7addf5db371?auto=format&fit=crop&w=900&q=85",active:true},
      {id:"costilla",category:"Favoritos",name:"Costilla glaseada",description:"puré rústico · cebolla encurtida",price:320,imageUrl:"https://images.unsplash.com/photo-1544025162-d76694265947?auto=format&fit=crop&w=900&q=85",active:true}
    ]
  },
  contact: { phone:"+504 0000-0000", whatsapp:"50400000000", email:"reservas@empresa.com", address:"Centro Histórico", schedule:"12:00 p. m. a 10:30 p. m." },
  features: { orders:true, reservations:true, tableQr:true, kitchenPreview:true },
  integrations: { crmBaseUrl:"https://gavrion-crm.vercel.app", tenantKey:"", useRealChatbox:false }
};
