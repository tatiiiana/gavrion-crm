(function(){
  const config=window.GAVRION_SITE||{};
  const q=(selector)=>document.querySelector(selector);
  const qa=(selector)=>Array.from(document.querySelectorAll(selector));
  const base=String(config.integrations?.crmBaseUrl||'').replace(/\/$/,'');
  const key=String(config.integrations?.tenantKey||'');
  let rooms=Array.isArray(config.menu?.items)?config.menu.items:[];
  const escapeHtml=(value)=>String(value??'').replace(/[&<>"']/g,(char)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  function renderBlocks(){
    let container=q('#custom-blocks');
    if(!container){container=document.createElement('section');container.id='custom-blocks';const contact=q('#contacto');if(contact?.parentElement)contact.parentElement.insertBefore(container,contact);}
    if(!container)return;
    if(!document.getElementById('gavrion-block-styles')){const style=document.createElement('style');style.id='gavrion-block-styles';style.textContent='.custom-block{max-width:1250px;margin:0 auto;padding:54px 8%;border-top:1px solid var(--line);border-bottom:1px solid var(--line);background:var(--surface)}.custom-block h2{margin:8px 0 10px;font-size:clamp(28px,4vw,48px);line-height:1.08}.custom-block p{max-width:700px;color:var(--muted);font-size:17px}.custom-block-kicker{color:var(--primary);font-size:11px;font-weight:800;letter-spacing:2px}.custom-block-button{border:0;border-radius:10px;padding:13px 18px;background:var(--secondary);color:#fff;font-weight:750;cursor:pointer}@media(max-width:720px){.custom-block{padding:44px 6%}}';document.head.append(style)}
    const blocks=Array.isArray(config.layout?.blocks)?config.layout.blocks.filter((block)=>block.visible!==false&&block.title):[];
    container.innerHTML=blocks.map((block)=>`<article class="custom-block custom-block-${block.type}"><span class="custom-block-kicker">${block.type==='cta'?'SIGAMOS CONVERSANDO':'DESTACADO'}</span><h2>${escapeHtml(block.title)}</h2><p>${escapeHtml(block.body)}</p>${block.type==='cta'?`<button class="custom-block-button" data-form="contact">${escapeHtml(block.buttonLabel||'Hablar con el equipo')}</button>`:''}</article>`).join('');
    qa('#custom-blocks [data-form]').forEach((button)=>button.addEventListener('click',()=>open(button.dataset.form)));
  }
  function applyLayout(){
    const layout=config.layout?.sections||[];
    const main=document.querySelector('main');
    const map={inicio:document.querySelector('.hero'),experiencia:document.querySelector('#experiencia'),habitaciones:document.querySelector('#habitaciones'),bloques:document.querySelector('#custom-blocks'),contacto:document.querySelector('#contacto')};
    if(!main)return;
    layout.forEach((item)=>{
      const node=map[item.id];
      if(!node)return;
      node.hidden=item.visible===false;
      if(item.id!=="inicio"&&item.visible!==false&&node.parentElement===main)main.append(node);
    });
  }
  function loadForms(){
    if(!base||!key||document.getElementById('gavrion-forms-script'))return;
    const script=document.createElement('script');
    script.id='gavrion-forms-script';
    script.src=base+'/site-forms.js';
    script.dataset.tenant=key;
    script.dataset.color=config.brand?.primaryColor||'#0f766e';
    document.body.append(script);
  }
  function open(type,values){
    const forms=window.GavrionForms;
    if(forms&&forms.has(type)){forms.open(type,values||{});return;}
    window.alert('El formulario todavía está cargando. Intenta de nuevo en un momento.');
  }
  function render(){
    const brand=config.brand||{},hero=config.hero||{},experience=config.experience||{},contact=config.contact||{};
    document.title=config.seo?.title||brand.name||document.title;
    q('#brandName').textContent=brand.name||'Hotel';
    q('#brandMark').textContent=brand.shortName||'H';
    q('#heroEyebrow').textContent=hero.eyebrow||'HOSPITALIDAD Y DESTINOS';
    q('#heroTitle').textContent=hero.title||'Tu próxima experiencia comienza aquí.';
    q('#heroDescription').textContent=hero.description||'';
    q('#experienceTitle').textContent=experience.title||'Detalles que hacen la diferencia.';
    q('#experienceDescription').textContent=experience.description||'';
    q('#catalogTitle').textContent=config.menu?.title||'Elige cómo quieres vivirlo';
    q('#contactDetail').textContent=[contact.address,contact.phone].filter(Boolean).join(' · ')||'Estamos listos para ayudarte.';
    q('#footerName').textContent=brand.name||'Hotel';
    q('#footerContact').textContent=contact.email||'Una experiencia para recordar';
    document.documentElement.style.setProperty('--primary',brand.primaryColor||'#0f766e');
    document.documentElement.style.setProperty('--secondary',brand.secondaryColor||'#134e4a');
    q('#catalogStatus').textContent=`${rooms.length} opciones disponibles`;
    q('#roomGrid').innerHTML=rooms.slice(0,18).map((item)=>`<article class="room-card"><div class="room-art">${escapeHtml(String(item.name||'H').slice(0,1).toUpperCase())}</div><div class="room-body"><h3>${escapeHtml(item.name||'Habitación')}</h3><p>${escapeHtml(item.description||'Una estancia cómoda, cuidada y lista para recibirte.')}</p><div class="room-bottom"><span>${escapeHtml(item.currency||'HNL')} ${Number(item.price||0).toLocaleString('es-HN')}</span><button class="small-button" data-room="${escapeHtml(item.name||'')}">Reservar</button></div></div></article>`).join('');
    qa('[data-room]').forEach((button)=>button.addEventListener('click',()=>open('lodging_reservation',{room_type:button.dataset.room})));
    qa('[data-form]').forEach((button)=>button.addEventListener('click',()=>open(button.dataset.form)));
  }
  async function loadCatalog(){
    if(!base||!key)return;
    try{
      const response=await fetch(`${base}/api/public/catalog/${encodeURIComponent(key)}`,{cache:'no-store'});
      const data=await response.json();
      if(response.ok&&Array.isArray(data.products)){rooms=data.products;render();applyLayout();}
    }catch(error){console.warn('No se pudo sincronizar las habitaciones',error)}
  }
  render();
  renderBlocks();
  applyLayout();
  loadForms();
  void loadCatalog();
})();
