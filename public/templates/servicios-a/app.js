(function(){
  const config=window.GAVRION_SITE||{};
  const q=(selector)=>document.querySelector(selector);
  const qa=(selector)=>Array.from(document.querySelectorAll(selector));
  const base=String(config.integrations?.crmBaseUrl||'').replace(/\/$/,'');
  const key=String(config.integrations?.tenantKey||'');
  const defaultItems=[
    {name:'Consultoría estratégica',description:'Diagnóstico y plan de acción para que tu equipo avance con foco.'},
    {name:'Implementación',description:'Acompañamiento práctico para convertir ideas en resultados medibles.'},
    {name:'Soporte continuo',description:'Un equipo cercano para resolver, optimizar y crecer contigo.'},
  ];
  const escapeHtml=(value)=>String(value??'').replace(/[&<>"']/g,(char)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  function renderBlocks(){
    let container=q('#custom-blocks');
    if(!container){container=document.createElement('section');container.id='custom-blocks';const contact=q('#contacto');if(contact?.parentElement)contact.parentElement.insertBefore(container,contact);}
    if(!container)return;
    if(!document.getElementById('gavrion-block-styles')){const style=document.createElement('style');style.id='gavrion-block-styles';style.textContent='.custom-block{max-width:1180px;margin:0 auto;padding:54px 8%;border-top:1px solid var(--line);border-bottom:1px solid var(--line);background:var(--surface);}.custom-block h2{margin:8px 0 10px;font-size:clamp(28px,4vw,48px);line-height:1.08}.custom-block p{max-width:700px;color:var(--muted);font-size:17px}.custom-block-kicker{color:var(--primary);font-size:11px;font-weight:800;letter-spacing:2px}.custom-block-button{border:0;border-radius:10px;padding:13px 18px;background:var(--secondary);color:#fff;font-weight:750;cursor:pointer}@media(max-width:720px){.custom-block{padding:44px 6%}}';document.head.append(style)}
    const blocks=Array.isArray(config.layout?.blocks)?config.layout.blocks.filter((block)=>block.visible!==false&&block.title):[];
    container.innerHTML=blocks.map((block)=>`<article class="custom-block custom-block-${block.type}"><span class="custom-block-kicker">${block.type==='cta'?'SIGAMOS CONVERSANDO':'DESTACADO'}</span><h2>${escapeHtml(block.title)}</h2><p>${escapeHtml(block.body)}</p>${block.type==='cta'?`<button class="custom-block-button" data-form="contact">${escapeHtml(block.buttonLabel||'Hablar con el equipo')}</button>`:''}</article>`).join('');
    qa('#custom-blocks [data-form]').forEach((button)=>button.addEventListener('click',()=>open(button.dataset.form)));
  }
  function applyLayout(){
    const layout=config.layout?.sections||[];
    const main=document.querySelector('main');
    const map={inicio:document.querySelector('.hero'),experiencia:document.querySelector('.intro'),servicios:document.querySelector('#servicios'),bloques:document.querySelector('#custom-blocks'),contacto:document.querySelector('#contacto')};
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
    script.dataset.color=config.brand?.primaryColor||'#2563eb';
    document.body.append(script);
  }
  function open(type){
    const forms=window.GavrionForms;
    if(forms&&forms.has(type)){forms.open(type);return;}
    window.alert('El formulario todavía está cargando. Intenta de nuevo en un momento.');
  }
  function render(){
    const brand=config.brand||{},hero=config.hero||{},experience=config.experience||{},contact=config.contact||{};
    document.title=config.seo?.title||brand.name||document.title;
    q('#brandName').textContent=brand.name||'Servicios';
    q('#brandMark').textContent=brand.shortName||'G';
    q('#heroEyebrow').textContent=hero.eyebrow||'SERVICIOS PROFESIONALES';
    q('#heroTitle').textContent=hero.title||'Experiencia que impulsa resultados.';
    q('#heroDescription').textContent=hero.description||'';
    q('#experienceTitle').textContent=experience.title||'Lo importante es avanzar con confianza.';
    q('#experienceDescription').textContent=experience.description||'';
    q('#contactDetail').textContent=contact.address?[contact.address,contact.phone].filter(Boolean).join(' · '):'Nuestro equipo te responderá con claridad y sin rodeos.';
    q('#footerName').textContent=brand.name||'Servicios profesionales';
    q('#footerContact').textContent=contact.email||'Hablemos';
    document.documentElement.style.setProperty('--primary',brand.primaryColor||'#2563eb');
    document.documentElement.style.setProperty('--secondary',brand.secondaryColor||'#172554');
    const configured=Array.isArray(config.menu?.items)?config.menu.items.filter((item)=>item.active!==false&&item.name):[];
    const items=configured.length?configured:defaultItems;
    q('#serviceGrid').innerHTML=items.slice(0,6).map((item,index)=>`<article class="service-card"><i>0${index+1}</i><h3>${escapeHtml(item.name||'Servicio profesional')}</h3><p>${escapeHtml(item.description||'Una solución pensada para tu operación.')}</p></article>`).join('');
    qa('[data-form]').forEach((button)=>button.addEventListener('click',()=>open(button.dataset.form)));
  }
  render();
  renderBlocks();
  applyLayout();
  loadForms();
})();
