const q = (s) => document.querySelector(s);
const qa = (s) => [...document.querySelectorAll(s)];
let cart = [];
const money = (n) => `L ${n.toLocaleString('es-HN')}`;
const table = new URLSearchParams(location.search).get('mesa') || '08';
const menuUrl = `${location.origin}${location.pathname}?mesa=${encodeURIComponent(table)}#menu`;
let stream;
let detector;
const config = window.GAVRION_SITE || {};

function applySiteConfig(){
  const brand=config.brand||{}, hero=config.hero||{}, experience=config.experience||{}, menu=config.menu||{};
  document.title=config.seo?.title||brand.name||document.title;
  let description=document.querySelector('meta[name="description"]');
  if(!description){description=document.createElement('meta');description.name='description';document.head.append(description);}
  description.content=config.seo?.description||hero.description||'';
  const root=document.documentElement;
  if(brand.primaryColor)root.style.setProperty('--rust',brand.primaryColor);
  if(brand.secondaryColor)root.style.setProperty('--olive',brand.secondaryColor);
  if(brand.backgroundColor)root.style.setProperty('--paper',brand.backgroundColor);
  if(brand.surfaceColor)root.style.setProperty('--cream',brand.surfaceColor);
  const brandLabel=String(brand.name||'Brasa & Olivo');
  q('.brand').textContent=brandLabel; q('footer>span').textContent=brandLabel.toUpperCase();
  if(hero.imageUrl)q('.hero').style.backgroundImage=`linear-gradient(115deg,rgba(20,25,18,.88),rgba(25,29,21,.25)),url('${hero.imageUrl}')`;
  q('.hero-content .eyebrow').textContent=hero.eyebrow||'';
  q('.hero-content h1').innerHTML=String(hero.title||'').replace(/\s+([^\s]+)$/,'<br><em>$1</em>');
  q('.hero-copy').textContent=hero.description||''; q('.hero-stamp').innerHTML=String(hero.stamp||'').replaceAll(' ','<br>');
  q('.intro>.eyebrow').textContent=experience.eyebrow||'';q('.intro-grid h2').textContent=experience.title||'';q('.intro-grid p').textContent=experience.description||'';
  q('.menu-section .section-heading h2').textContent=menu.title||'Menú';
  q('.menu-tabs').innerHTML=(menu.categories||[]).map((name,index)=>`<button class="${index===0?'active':''}" data-category="${name}">${name}</button>`).join('');
  renderMenuItems(menu.items||[]);
  const integrations=config.integrations||{};
  if(integrations.useRealChatbox&&integrations.tenantKey){
    q('#chat').hidden=true;q('#openChat').hidden=true;
    const script=document.createElement('script');script.src=`${String(integrations.crmBaseUrl||'').replace(/\/$/,'')}/widget.js`;script.dataset.tenant=integrations.tenantKey;script.defer=true;document.body.append(script);
  }
}
function renderMenuItems(items){
  const symbol=config.menu?.currencySymbol||'L';
  q('.menu-grid').innerHTML=items.filter(item=>item.active!==false).map((item,index)=>`<article class="dish" data-category="${item.category||''}"><div class="dish-photo" style="background-image:linear-gradient(#0002,#0002),url('${item.imageUrl||''}')"><span>${String(index+1).padStart(2,'0')}</span></div><div class="dish-info"><div><h3>${item.name}</h3><p>${item.description||''}</p></div><strong>${symbol} ${Number(item.price||0).toLocaleString('es-HN')}</strong></div><button class="add" data-item="${item.name}" data-price="${Number(item.price||0)}">Agregar <span>+</span></button></article>`).join('');
  qa('.menu-tabs button').forEach(button=>button.onclick=()=>{qa('.menu-tabs button').forEach(x=>x.classList.remove('active'));button.classList.add('active');const category=button.dataset.category;qa('.dish').forEach(dish=>dish.hidden=category!=='Favoritos'&&dish.dataset.category!==category)});
}

applySiteConfig();

q('#tableLabel').textContent = `MENÚ DIGITAL · MESA ${table}`;
q('#cartTableLabel').textContent = `MESA ${table} · PEDIDO DIGITAL`;
q('#qrTable').textContent = table;
q('#qrUrl').textContent = menuUrl;
q('#qrImage').src = `https://api.qrserver.com/v1/create-qr-code/?size=320x320&data=${encodeURIComponent(menuUrl)}`;

qa('.nav-book').forEach((button) => button.addEventListener('click', () => {
  q('#openChat').click();
  setTimeout(() => addBot('Con gusto. Para reservar, indícame fecha, hora y número de personas.'), 180);
}));
q('#openChat').onclick = () => q('#chat').classList.add('open');
q('#closeChat').onclick = () => q('#chat').classList.remove('open');
q('#showCrm').onclick = () => q('#crmModal').classList.add('open');
q('#openCart').onclick = () => q('#cartModal').classList.add('open');
q('#openQr').onclick = () => q('#qrModal').classList.add('open');
q('#openScanner').onclick = () => { q('#qrModal').classList.remove('open'); q('#scannerModal').classList.add('open'); };
qa('.modal-close').forEach((b) => b.onclick = () => b.closest('.modal').classList.remove('open'));
qa('.modal').forEach((m) => m.addEventListener('click', (e) => { if(e.target === m) { m.classList.remove('open'); if(m.id === 'scannerModal') stopScanner(); } }));
qa('.add').forEach((b) => b.onclick = () => { cart.push({name:b.dataset.item, price:+b.dataset.price}); renderCart(); q('#toast').textContent = `${b.dataset.item} agregado al pedido.`; flash(); });

function renderCart(){
  q('#cartCount').textContent = cart.length;
  q('#cartTotal').textContent = money(cart.reduce((a,x)=>a+x.price,0));
  q('#cartItems').innerHTML = cart.length ? cart.map((x,i)=>`<div class="cart-item"><span>${x.name}</span><strong>${money(x.price)}</strong></div>`).join('') : '<p class="empty">Aún no has agregado platos.</p>';
}
function flash(){ const t=q('#toast'); t.classList.add('show'); setTimeout(()=>t.classList.remove('show'),2800); }
function addBot(text){ const d=document.createElement('div'); d.className='bot'; d.textContent=text; q('#messages').append(d); q('#messages').scrollTop=9999; }
function respond(text){
  const lower=text.toLowerCase();
  if(lower.includes('horario')) return `Hoy atendemos de ${config.contact?.schedule||'12:00 p. m. a 10:30 p. m.'} ¿Quieres que revise disponibilidad?`;
  if(lower.includes('reserva')) return 'Perfecto. Para una reserva necesito fecha, hora y cantidad de personas. Un asesor confirmará la disponibilidad.';
  if(lower.includes('recom') || lower.includes('menú') || lower.includes('menu')) return 'Te recomiendo el Pulpo a las brasas si buscas algo para compartir, o el Risotto de hongos para una opción reconfortante.';
  return 'Gracias por tu mensaje. He registrado tu consulta para que nuestro equipo pueda ayudarte con información confirmada.';
}
q('#chatForm').onsubmit=(e)=>{e.preventDefault();const i=q('#chatInput'),text=i.value.trim();if(!text)return;const d=document.createElement('div');d.className='user';d.textContent=text;q('#messages').append(d);i.value='';setTimeout(()=>addBot(respond(text)),400)};
qa('.quick button').forEach((b)=>b.onclick=()=>{q('#chatInput').value=b.textContent;q('#chatForm').requestSubmit()});
q('#sendOrder').onclick=()=>{ if(!cart.length){q('#toast').textContent='Agrega al menos un plato para enviar el pedido.'; flash();return;} q('#cartModal').classList.remove('open');q('#toast').textContent='Pedido enviado a cocina y registrado para seguimiento.';flash();cart=[];renderCart(); };

q('#copyQrLink').onclick = async () => { try { await navigator.clipboard.writeText(menuUrl); q('#toast').textContent='Enlace del menú copiado.'; } catch { q('#toast').textContent='Copia el enlace mostrado debajo del código QR.'; } flash(); };
q('#startScanner').onclick = startScanner;
q('#stopScanner').onclick = () => { q('#scannerModal').classList.remove('open'); stopScanner(); };
async function startScanner(){
  const status = q('#scannerStatus');
  if(!('BarcodeDetector' in window)){ status.textContent='Este navegador no incluye lector QR. Usa la cámara del teléfono para escanear el código mostrado.'; return; }
  try {
    detector = new BarcodeDetector({formats:['qr_code']});
    stream = await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'}}});
    const video=q('#scannerVideo'); video.srcObject=stream; await video.play(); video.classList.add('active'); q('.scanner-frame').classList.add('scanning'); status.textContent='Buscando un código QR...'; scanFrame();
  } catch(e) { status.textContent='No fue posible abrir la cámara. Revisa el permiso del navegador e inténtalo de nuevo.'; }
}
async function scanFrame(){
  const video=q('#scannerVideo');
  if(!stream || video.readyState < 2) return requestAnimationFrame(scanFrame);
  try { const codes = await detector.detect(video); if(codes[0]?.rawValue){ const found=codes[0].rawValue; stopScanner(); if(found.includes('mesa=')){ location.href=found; } else { q('#scannerStatus').textContent='Código leído. No corresponde a un menú de mesa.'; } return; } } catch(e) {}
  if(stream) requestAnimationFrame(scanFrame);
}
function stopScanner(){ if(stream){ stream.getTracks().forEach(t=>t.stop()); stream=undefined; } q('#scannerVideo').classList.remove('active'); q('.scanner-frame').classList.remove('scanning'); }
