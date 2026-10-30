(function(){
  const config=window.GAVRION_SITE||{};
  const q=(selector)=>document.querySelector(selector);
  const qa=(selector)=>Array.from(document.querySelectorAll(selector));
  const base=String(config.integrations?.crmBaseUrl||'').replace(/\/$/,'');
  const key=String(config.integrations?.tenantKey||'');
  let products=Array.isArray(config.menu?.items)?config.menu.items:[];
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
    const map={inicio:document.querySelector('.hero'),catalogo:document.querySelector('#catalogo'),bloques:document.querySelector('#custom-blocks'),contacto:document.querySelector('#contacto')};
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
    script.dataset.color=config.brand?.primaryColor||'#7c3aed';
    document.body.append(script);
  }
  function open(type,values){
    const forms=window.GavrionForms;
    if(forms&&forms.has(type)){forms.open(type,values||{});return;}
    window.alert('El formulario todavía está cargando. Intenta de nuevo en un momento.');
  }
  function render(){
    const brand=config.brand||{},hero=config.hero||{},contact=config.contact||{};
    document.title=config.seo?.title||brand.name||document.title;
    q('#brandName').textContent=brand.name||'Comercio';
    q('#brandMark').textContent=brand.shortName||'C';
    q('#heroEyebrow').textContent=hero.eyebrow||'CATÁLOGO Y COMPRA';
    q('#heroTitle').textContent=hero.title||'Todo lo que buscas, más cerca.';
    q('#heroDescription').textContent=hero.description||'';
    q('#catalogTitle').textContent=config.menu?.title||'Productos destacados';
    q('#contactDetail').textContent=[contact.address,contact.phone].filter(Boolean).join(' · ')||'Escríbenos y te orientaremos.';
    q('#footerName').textContent=brand.name||'Comercio';
    q('#footerContact').textContent=contact.email||'Compra con confianza';
    document.documentElement.style.setProperty('--primary',brand.primaryColor||'#7c3aed');
    document.documentElement.style.setProperty('--secondary',brand.secondaryColor||'#2e1065');
    q('#catalogStatus').textContent=`${products.length} productos disponibles`;
    q('#productGrid').innerHTML=products.slice(0,24).map((item,index)=>`<article class="product-card"><div class="product-art">${escapeHtml(String(item.name||'P').slice(0,1).toUpperCase())}</div><div class="product-body"><h3>${escapeHtml(item.name||'Producto')}</h3><p>${escapeHtml(item.description||'Consulta disponibilidad, características y formas de entrega.')}</p><div class="price"><span>${escapeHtml(item.currency||'HNL')} ${Number(item.price||0).toLocaleString('es-HN')}</span><button class="small-button" data-product="${escapeHtml(item.name||'')}">Consultar</button></div></div></article>`).join('');
    qa('[data-product]').forEach((button)=>button.addEventListener('click',()=>open('product_inquiry',{product:button.dataset.product})));
    qa('[data-form]').forEach((button)=>button.addEventListener('click',()=>open(button.dataset.form)));
    qa('[data-scroll]').forEach((button)=>button.addEventListener('click',()=>document.querySelector(button.dataset.scroll)?.scrollIntoView({behavior:'smooth'})));
  }
  async function loadCatalog(){
    if(!base||!key)return;
    try{
      const response=await fetch(`${base}/api/public/catalog/${encodeURIComponent(key)}`,{cache:'no-store'});
      const data=await response.json();
      if(response.ok&&Array.isArray(data.products)){products=data.products;render();applyLayout();}
    }catch(error){console.warn('No se pudo sincronizar el catálogo',error)}
  }
  render();
  renderBlocks();
  applyLayout();
  loadForms();
  void loadCatalog();
})();
