const STORAGE_KEY='fuvarszervezo_v4';
const $=s=>document.querySelector(s), $$=s=>document.querySelectorAll(s);
const DRIVERS={
  mario:{name:'Márió',color:'#103a56',homeName:'Vác',home:[47.7759,19.1361]},
  patrik:{name:'Patrik',color:'#197c98',homeName:'Kispest',home:[47.4552,19.1490]},
  martin:{name:'Martin',color:'#76469a',homeName:'Felcsút',home:[47.4555,18.5845]}
};
const APPROVED_HEADERS={
  documentNo:['bizonylatszám'],
  topicName:['témaszám név'],
  productCode:['termék kód','termékkód'],
  productName:['termék név','terméknév'],
  customerWarehouse:['ügyfél/raktár','ügyfél/raktár név'],
  quantity:['tétel mennyiség'],
  unit:['m.e.','me'],
  requestedDeadline:['kért szállítási határidő'],
  scheduleDate:['dátum'],
  driver:['autó','auto'],
  note:['megjegyzés']
};
let state={
  projects:[],suppliers:[],recipients:[],orders:[],
  settings:{
    baseAddress:'2310 Szigetszentmiklós, Kereskedő utca',
    marioVehicle:'Dobozos 1',patrikVehicle:'Dobozos 2',martinVehicle:'Ponyvás'
  },
  geoCache:{},
  projectAliases:{}
};
let importRows=[], importSourceRows=[], importHeaderMap={}, masterType='projects';
let maps={}, routeLayers={}, installPrompt=null;
let mediaRecorder=null,audioChunks=[],audioBlob=null,feedbackPhotos=[];

const today=()=>new Date().toISOString().slice(0,10);
const uid=()=>crypto.randomUUID?crypto.randomUUID():Date.now()+'-'+Math.random();
function esc(v=''){return String(v).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]))}
function norm(s=''){return String(s).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[_.,;:()[\]{}\/\\-]+/g,' ').replace(/\s+/g,' ').trim()}
function compactProjectName(s=''){return norm(s).replace(/\b(budapest|bp|utem|ii|iii|iv|projekt|project|epulet|haz)\b/g,' ').replace(/\s+/g,' ').trim()}
function driverFrom(v=''){const n=norm(v);if(n.includes('mario'))return'mario';if(n.includes('patrik'))return'patrik';if(n.includes('martin'))return'martin';return''}
function last5(v=''){const d=String(v).replace(/\D/g,'');return d.slice(-5).padStart(5,'0')}
function excelDate(v){
  if(v===''||v==null)return'';
  if(v instanceof Date)return v.toISOString().slice(0,10);
  if(typeof v==='number'){
    const d=XLSX.SSF.parse_date_code(v);
    return d?`${d.y}-${String(d.m).padStart(2,'0')}-${String(d.d).padStart(2,'0')}`:'';
  }
  const s=String(v).trim();
  let m=s.match(/(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})/);
  if(m)return`${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`;
  m=s.match(/(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{4})/);
  if(m)return`${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;
  return'';
}
function save(){
  localStorage.setItem(STORAGE_KEY,JSON.stringify(state));
  $('#saveState').textContent='Automatikusan mentve';
  render();
}
function load(){
  const raw=localStorage.getItem(STORAGE_KEY);
  if(raw){state=JSON.parse(raw);state.projectAliases=state.projectAliases||{};state.geoCache=state.geoCache||{};return}
  state.projects=(SEED_DATA.projects||[]).map((x,i)=>({...x,id:x.id||'p'+i,defaultRecipientId:x.defaultRecipientId||''}));
  state.suppliers=(SEED_DATA.suppliers||[]).map((x,i)=>({...x,id:x.id||'s'+i,pickupNote:x.pickupNote||x.note||''}));
  state.recipients=(SEED_DATA.recipients||[]).map((x,i)=>({...x,id:x.id||'r'+i}));
  state.projects.forEach(p=>{
    const r=state.recipients.find(x=>norm(x.project)===norm(p.name))||state.recipients.find(x=>norm(x.name)===norm(p.receiver));
    p.defaultRecipientId=r?.id||'';
  });
  localStorage.setItem(STORAGE_KEY,JSON.stringify(state));
}
function selectedDate(){return $('#workDate').value||today()}
function dayOrders(driver=null){return state.orders.filter(o=>o.scheduleDate===selectedDate()&&(!driver||o.driver===driver))}
function driverVehicle(k){return state.settings[k+'Vehicle']||DRIVERS[k].name}
function showPage(id){
  $$('.page').forEach(x=>x.classList.toggle('active',x.id===id));
  $$('.nav').forEach(x=>x.classList.toggle('active',x.dataset.page===id));
  scrollTo(0,0);render();
}
function render(){renderPlanner();renderOrders();renderMaster();fillSettings()}

function renderPlanner(){
  $('#routeGrid').innerHTML=Object.keys(DRIVERS).map(k=>{
    const list=dayOrders(k);
    return`<section class="route-column" data-driver="${k}">
      <header class="route-header">
        <div><h2>${esc(DRIVERS[k].name)} · ${esc(driverVehicle(k))}</h2>
          <small>${list.length} rendelés · ${list.reduce((a,o)=>a+(o.items?.length||0),0)} tétel</small>
          <div class="driver-home">Munkába indul: ${esc(DRIVERS[k].homeName)} · alap munkaidő 7:00–16:00</div>
          <div class="workload-card" id="workload-${k}">Terhelés számítása…</div>
          <div class="map-status" id="mapStatus-${k}"></div>
        </div>
        <div class="route-actions"><button onclick="optimizeRoute('${k}')">Optimalizálás</button><button onclick="exportMenu('${k}')">Export</button></div>
      </header>
      <div id="map-${k}" class="route-map"></div>
      <div id="list-${k}" class="route-list">${renderBubbles(list,k)}</div>
    </section>`;
  }).join('');
  setTimeout(initMaps,30);setTimeout(initSortables,40);setTimeout(updateWorkloadCards,60);
}
function projectOptions(selected=''){
  return '<option value="">Nincs projekt</option>'+state.projects.filter(x=>x.active!==false&&x.type!=='felrakó')
    .sort((a,b)=>a.name.localeCompare(b.name,'hu')).map(x=>option(x.id,x.name,selected)).join('');
}
function supplierOptions(selected=''){
  return '<option value="">Nincs beszállító</option>'+state.suppliers.filter(x=>x.active!==false)
    .sort((a,b)=>a.name.localeCompare(b.name,'hu')).map(x=>option(x.id,`${x.name}${x.site?' · '+x.site:''}`,selected)).join('');
}
function recipientOptions(projectName='',selected=''){
  return '<option value="">Nincs átvevő</option>'+state.recipients.filter(x=>x.active!==false&&(!projectName||norm(x.project)===norm(projectName)))
    .sort((a,b)=>a.name.localeCompare(b.name,'hu')).map(x=>option(x.id,x.name,selected)).join('');
}
function renderBubbles(list,driver){
  if(!list.length)return'<div class="empty-route">Erre a napra még nincs rendelés ennél a sofőrnél.</div>';
  return list.slice().sort((a,b)=>(+a.sequence||999)-(+b.sequence||999)).map((o,i)=>`
    <article class="stop-bubble" data-id="${o.id}">
      <span class="drag">☷</span>
      <div><span class="stop-number">${i+1}</span><span class="stop-title">${esc(o.orderNo)} · ${esc(o.projectName||'Projekt nincs kiválasztva')}</span></div>
      <p><b>Felrakó:</b> ${esc(o.pickupName||'Nincs kiválasztva')} ${o.pickupAddress?'· '+esc(o.pickupAddress):''}</p>
      <p><b>Lerakó:</b> ${esc(o.dropAddress||'Nincs kiválasztva')}</p>
      ${o.pickupNote?`<p><b>Felrakói megjegyzés:</b> ${esc(o.pickupNote)}</p>`:''}
      ${o.note?`<p><b>Fuvar megjegyzés:</b> ${esc(o.note)}</p>`:''}
      ${o.longMaterialReason?`<div class="long-reason">Ponyvásra téve: ${esc(o.longMaterialReason)}</div>`:''}
      <div class="stop-tags">
        <span class="tag">${o.items?.length||0} tétel</span>
        ${o.vehicleNeed==='tarp'?'<span class="tag tarp">csak ponyvás</span>':''}
        ${o.requestedDeadline?`<span class="tag ${o.scheduleDate>o.requestedDeadline?'warn':''}">határidő ${o.requestedDeadline}</span>`:''}
        ${o.pickupFrom?`<span class="tag warn">felvétel ${o.pickupFrom}-${o.pickupTo}</span>`:''}
        ${o.dropFrom?`<span class="tag warn">lerakás ${o.dropFrom}-${o.dropTo}</span>`:''}
      </div>
      <details class="inline-editor">
        <summary>Gyors szerkesztés ▾</summary>
        <div class="inline-grid">
          <label>Beszállító<select data-inline="supplierId" onchange="inlineChange('${o.id}',this)">${supplierOptions(o.supplierId)}</select></label>
          <label>Projekt<select data-inline="projectId" onchange="inlineChange('${o.id}',this)">${projectOptions(o.projectId)}</select></label>
          <label class="wide">Felrakó cím<input data-inline="pickupAddress" value="${esc(o.pickupAddress||'')}" onchange="inlineChange('${o.id}',this)"></label>
          <label class="wide">Lerakó cím<input data-inline="dropAddress" value="${esc(o.dropAddress||'')}" onchange="inlineChange('${o.id}',this)"></label>
          <label>Átvevő<select data-inline="recipientId" onchange="inlineChange('${o.id}',this)">${recipientOptions(o.projectName,o.recipientId)}</select></label>
          <label>Telefon<input data-inline="recipientPhone" value="${esc(o.recipientPhone||'')}" onchange="inlineChange('${o.id}',this)"></label>
          <label class="wide">Felrakói megjegyzés<textarea data-inline="pickupNote" onchange="inlineChange('${o.id}',this)">${esc(o.pickupNote||'')}</textarea></label>
          <label class="wide">Fuvar megjegyzés<textarea data-inline="note" onchange="inlineChange('${o.id}',this)">${esc(o.note||'')}</textarea></label>
        </div>
      </details>
      <div class="bubble-actions"><button onclick="editOrder('${o.id}')">Teljes szerkesztés</button><button onclick="showItems('${o.id}')">Tételek</button><button onclick="moveOrder('${o.id}')">Másik sofőr</button><button onclick="openNavigation('${o.id}')">Navigáció</button><button onclick="openFeedback('${o.id}')">Szállítólevél / jelentés${o.reports?.length?` <span class="report-count">${o.reports.length}</span>`:''}</button></div>
    </article>`).join('');
}
window.inlineChange=(id,el)=>{
  const o=state.orders.find(x=>x.id===id);if(!o)return;
  const f=el.dataset.inline,v=el.value;o[f]=v;
  if(f==='supplierId'){
    const s=state.suppliers.find(x=>x.id===v);o.pickupName=s?.name||'';o.pickupAddress=s?.address||o.pickupAddress;o.pickupNote=s?.pickupNote||s?.note||o.pickupNote||'';
  }
  if(f==='projectId'){
    const p=state.projects.find(x=>x.id===v);o.projectName=p?.name||'';o.dropAddress=p?.address||o.dropAddress;
    const r=state.recipients.find(x=>x.id===p?.defaultRecipientId);
    if(r){o.recipientId=r.id;o.recipientName=r.name;o.recipientPhone=r.phone||'';o.recipientEmail=r.email||''}
  }
  if(f==='recipientId'){
    const r=state.recipients.find(x=>x.id===v);o.recipientName=r?.name||'';o.recipientPhone=r?.phone||o.recipientPhone;o.recipientEmail=r?.email||'';
  }
  save();
};
function initSortables(){
  Object.keys(DRIVERS).forEach(k=>{
    const el=$('#list-'+k);if(!el)return;
    new Sortable(el,{animation:180,group:'routes',handle:'.drag',ghostClass:'sortable-ghost',onEnd:e=>{
      const movedId=e.item.dataset.id,newDriver=e.to.id.replace('list-','');
      const o=state.orders.find(x=>x.id===movedId);if(o)o.driver=newDriver;
      Object.keys(DRIVERS).forEach(d=>{$$('#list-'+d+' .stop-bubble').forEach((node,i)=>{const r=state.orders.find(x=>x.id===node.dataset.id);if(r)r.sequence=i+1})});
      save();
    }});
  });
}
async function geocode(address){
  if(!address)return null;if(state.geoCache[address])return state.geoCache[address];
  try{
    const u='https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=hu&q='+encodeURIComponent(address);
    const r=await fetch(u,{headers:{'Accept-Language':'hu'}}),j=await r.json();
    if(j[0]){
      const p=[+j[0].lat,+j[0].lon];state.geoCache[address]=p;localStorage.setItem(STORAGE_KEY,JSON.stringify(state));
      await new Promise(res=>setTimeout(res,1050));return p;
    }
  }catch(e){}return null;
}
function initMaps(){
  Object.keys(DRIVERS).forEach(k=>{
    if(maps[k])maps[k].remove();
    maps[k]=L.map('map-'+k,{zoomControl:true}).setView([47.45,19.04],9);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© OpenStreetMap'}).addTo(maps[k]);
    drawMap(k);
  });
}
async function roadGeometry(points){
  if(points.length<2)return null;
  try{
    const coords=points.map(p=>`${p[1]},${p[0]}`).join(';');
    const u=`https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson&steps=false`;
    const r=await fetch(u),j=await r.json();
    return j.routes?.[0]?.geometry?.coordinates?.map(c=>[c[1],c[0]])||null;
  }catch(e){return null}
}
async function drawMap(driver){
  const map=maps[driver];if(!map)return;
  $('#mapStatus-'+driver).textContent='Címek és útvonal betöltése…';
  (routeLayers[driver]||[]).forEach(x=>map.removeLayer(x));routeLayers[driver]=[];
  const orders=dayOrders(driver).slice().sort((a,b)=>(+a.sequence||999)-(+b.sequence||999)),points=[];
  const base=await geocode(state.settings.baseAddress);
  if(base)points.push({coord:base,label:'Indulás: '+state.settings.baseAddress,type:'base'});
  for(const o of orders){
    const p=await geocode(o.dropAddress);
    if(p)points.push({coord:p,label:`${o.orderNo} · ${o.projectName||o.dropAddress}`,type:'stop'});
  }
  points.forEach((p,i)=>{
    const marker=L.marker(p.coord).addTo(map).bindPopup(`<b>${esc(p.label)}</b><br>${i===0?'Indulás':`${i}. megálló`}`);
    routeLayers[driver].push(marker);
  });
  if(points.length){
    const road=await roadGeometry(points.map(p=>p.coord));
    const coords=road||points.map(p=>p.coord);
    const line=L.polyline(coords,{color:DRIVERS[driver].color,weight:5,opacity:.82}).addTo(map);
    routeLayers[driver].push(line);map.fitBounds(line.getBounds(),{padding:[25,25]});
    $('#mapStatus-'+driver).innerHTML=road?`<span class="tag route-real">Valós közúti útvonal · ${points.length-1} cím</span>`:`<span class="tag route-estimated">Becsült vonal · ${points.length-1} cím</span>`;
  }else $('#mapStatus-'+driver).textContent='Nincs geokódolható cím';
}
async function optimizeRoute(driver){
  const list=dayOrders(driver);if(list.length<2)return;
  $('#mapStatus-'+driver).textContent='Optimalizálás…';
  const base=await geocode(state.settings.baseAddress);
  if(!base){alert('Az indulási címet nem sikerült megtalálni.');return}
  const enriched=[];for(const o of list)enriched.push({o,p:await geocode(o.dropAddress)});
  let current=base,remaining=enriched.filter(x=>x.p),ordered=[];
  while(remaining.length){remaining.sort((a,b)=>distance(current,a.p)-distance(current,b.p));const n=remaining.shift();ordered.push(n.o);current=n.p}
  enriched.filter(x=>!x.p).forEach(x=>ordered.push(x.o));ordered.forEach((o,i)=>o.sequence=i+1);save();
}
function distance(a,b){const r=Math.PI/180,dLat=(b[0]-a[0])*r,dLon=(b[1]-a[1])*r,x=Math.sin(dLat/2)**2+Math.cos(a[0]*r)*Math.cos(b[0]*r)*Math.sin(dLon/2)**2;return 6371*2*Math.atan2(Math.sqrt(x),Math.sqrt(1-x))}
window.optimizeRoute=optimizeRoute;
window.openNavigation=id=>{const o=state.orders.find(x=>x.id===id);window.open('https://www.google.com/maps/dir/?api=1&destination='+encodeURIComponent(o.dropAddress),'_blank')};
window.moveOrder=id=>{const o=state.orders.find(x=>x.id===id),choice=prompt('Sofőr: Márió, Patrik vagy Martin',DRIVERS[o.driver]?.name||'');const d=driverFrom(choice);if(d){o.driver=d;o.sequence=dayOrders(d).length+1;save()}};
window.showItems=id=>{const o=state.orders.find(x=>x.id===id);$('#itemsTitle').textContent=`${o.orderNo} – ${o.items?.length||0} tétel`;$('#itemsBody').innerHTML=itemsTable(o.items||[]);$('#itemsDialog').showModal()};
function itemsTable(items){return`<table class="items-table"><thead><tr><th>Termék kód</th><th>Termék név</th><th>Mennyiség</th><th>M.e.</th><th>Hosszú?</th></tr></thead><tbody>${items.map(x=>`<tr><td>${esc(x.code)}</td><td>${esc(x.name)}</td><td>${esc(x.qty)}</td><td>${esc(x.unit)}</td><td>${x.longMaterial?'Igen':''}</td></tr>`).join('')}</tbody></table>`}

function renderOrders(){
  const q=norm($('#orderSearch').value),df=$('#orderDriverFilter').value;
  const rows=state.orders.filter(o=>(!q||norm([o.orderNo,o.projectName,o.pickupName,o.pickupAddress,o.dropAddress].join(' ')).includes(q))&&(!df||(df==='unassigned'?!o.driver:o.driver===df)))
    .sort((a,b)=>b.scheduleDate.localeCompare(a.scheduleDate)||(+a.sequence||999)-(+b.sequence||999));
  $('#ordersList').innerHTML=rows.length?rows.map(o=>`<article class="order-card ${o.vehicleNeed==='tarp'?'tarp':''}">
    <div class="order-top"><div><h3>${esc(o.orderNo)} · ${esc(o.projectName||'Nincs projekt')}</h3><p>${esc(o.scheduleDate)} · ${esc(o.pickupName||'Nincs beszállító')} → ${esc(o.dropAddress||'Nincs lerakócím')}</p></div><span class="badge">${o.driver?DRIVERS[o.driver].name:'Nincs sofőr'}</span></div>
    <p>${o.items?.length||0} tétel · ${esc(o.recipientName||'Nincs átvevő')} ${esc(o.recipientPhone||'')}</p>
    ${o.longMaterialReason?`<p class="long-reason">${esc(o.longMaterialReason)}</p>`:''}
    <div class="card-actions"><button onclick="editOrder('${o.id}')">Szerkesztés</button><button onclick="showItems('${o.id}')">Tételek</button><button onclick="openFeedback('${o.id}')">Szállítólevél / jelentés</button><button class="delete" onclick="deleteOrder('${o.id}')">Törlés</button></div>
  </article>`).join(''):'<div class="notice">Nincs találat.</div>';
}
function option(v,t,sel=''){return`<option value="${esc(v)}" ${String(v)===String(sel)?'selected':''}>${esc(t)}</option>`}
function fillSupplierOptions(sel=''){$('#supplierSelect').innerHTML=supplierOptions(sel)}
function fillProjectOptions(sel=''){$('#projectSelect').innerHTML=projectOptions(sel)}
function fillRecipientOptions(projectName='',sel=''){$('#recipientSelect').innerHTML=recipientOptions(projectName,sel)}
function openOrder(o={}){
  $('#orderDialogTitle').textContent=o.id?'Rendelés szerkesztése':'Új rendelés';$('#editOrderId').value=o.id||'';
  $('#orderDate').value=o.scheduleDate||selectedDate();$('#orderDriver').value=o.driver||'';$('#orderNo').value=o.orderNo||'';
  $('#vehicleNeed').value=o.vehicleNeed||'any';fillSupplierOptions(o.supplierId);$('#pickupAddress').value=o.pickupAddress||'';
  fillProjectOptions(o.projectId);$('#dropAddress').value=o.dropAddress||'';fillRecipientOptions(o.projectName||'',o.recipientId);
  $('#recipientPhone').value=o.recipientPhone||'';$('#recipientEmail').value=o.recipientEmail||'';
  $('#pickupWindowEnabled').checked=!!o.pickupFrom;$('#pickupWindowFields').classList.toggle('hidden',!o.pickupFrom);$('#pickupFrom').value=o.pickupFrom||'';$('#pickupTo').value=o.pickupTo||'';
  $('#dropWindowEnabled').checked=!!o.dropFrom;$('#dropWindowFields').classList.toggle('hidden',!o.dropFrom);$('#dropFrom').value=o.dropFrom||'';$('#dropTo').value=o.dropTo||'';
  $('#pickupNote').value=o.pickupNote||'';$('#orderNote').value=o.note||'';$('#orderDialog').showModal();
}
window.editOrder=id=>openOrder(state.orders.find(x=>x.id===id));
window.deleteOrder=id=>{if(confirm('Biztosan törlöd ezt a rendelést?')){state.orders=state.orders.filter(x=>x.id!==id);save()}};
$('#orderForm').onsubmit=e=>{
  e.preventDefault();
  const old=state.orders.find(x=>x.id===$('#editOrderId').value),supplier=state.suppliers.find(x=>x.id===$('#supplierSelect').value),project=state.projects.find(x=>x.id===$('#projectSelect').value),recipient=state.recipients.find(x=>x.id===$('#recipientSelect').value);
  const o={id:old?.id||uid(),scheduleDate:$('#orderDate').value,driver:$('#orderDriver').value,sequence:old?.sequence||999,orderNo:last5($('#orderNo').value),vehicleNeed:$('#vehicleNeed').value,
    supplierId:supplier?.id||'',pickupName:supplier?.name||'',pickupAddress:$('#pickupAddress').value,projectId:project?.id||'',projectName:project?.name||'',dropAddress:$('#dropAddress').value,
    recipientId:recipient?.id||'',recipientName:recipient?.name||'',recipientPhone:$('#recipientPhone').value,recipientEmail:$('#recipientEmail').value,
    pickupFrom:$('#pickupWindowEnabled').checked?$('#pickupFrom').value:'',pickupTo:$('#pickupWindowEnabled').checked?$('#pickupTo').value:'',
    dropFrom:$('#dropWindowEnabled').checked?$('#dropFrom').value:'',dropTo:$('#dropWindowEnabled').checked?$('#dropTo').value:'',
    pickupNote:$('#pickupNote').value,note:$('#orderNote').value,items:old?.items||[],requestedDeadline:old?.requestedDeadline||'',topicName:old?.topicName||'',longMaterialReason:old?.longMaterialReason||'',reports:old?.reports||[],status:old?.status||'tervezett'
  };
  const i=state.orders.findIndex(x=>x.id===o.id);if(i>=0)state.orders[i]=o;else state.orders.push(o);$('#orderDialog').close();save();
};
$('#supplierSelect').onchange=()=>{const x=state.suppliers.find(a=>a.id===$('#supplierSelect').value);$('#pickupAddress').value=x?.address||'';$('#pickupNote').value=x?.pickupNote||x?.note||''};
$('#projectSelect').onchange=()=>{
  const p=state.projects.find(a=>a.id===$('#projectSelect').value);$('#dropAddress').value=p?.address||'';fillRecipientOptions(p?.name||'',p?.defaultRecipientId||'');
  const r=state.recipients.find(x=>x.id===p?.defaultRecipientId);$('#recipientSelect').value=r?.id||'';$('#recipientPhone').value=r?.phone||p?.phone||'';$('#recipientEmail').value=r?.email||'';
};
$('#recipientSelect').onchange=()=>{const r=state.recipients.find(x=>x.id===$('#recipientSelect').value);$('#recipientPhone').value=r?.phone||'';$('#recipientEmail').value=r?.email||''};

function findHeader(headers,names){
  const normalized=headers.map(norm);
  for(const name of names){const idx=normalized.indexOf(norm(name));if(idx>=0)return idx}
  return -1;
}
function mapHeaders(headers){
  const map={};Object.entries(APPROVED_HEADERS).forEach(([k,names])=>map[k]=findHeader(headers,names));
  const required=['documentNo','topicName','productCode','productName','customerWarehouse','quantity','unit','requestedDeadline','scheduleDate','driver'];
  const missing=required.filter(k=>map[k]<0);
  return {map,missing};
}
function levenshtein(a,b){
  const m=a.length,n=b.length,d=Array.from({length:m+1},()=>Array(n+1).fill(0));
  for(let i=0;i<=m;i++)d[i][0]=i;for(let j=0;j<=n;j++)d[0][j]=j;
  for(let i=1;i<=m;i++)for(let j=1;j<=n;j++)d[i][j]=Math.min(d[i-1][j]+1,d[i][j-1]+1,d[i-1][j-1]+(a[i-1]===b[j-1]?0:1));
  return d[m][n];
}
function similarity(a,b){a=compactProjectName(a);b=compactProjectName(b);if(!a||!b)return 0;if(a===b)return 1;return 1-levenshtein(a,b)/Math.max(a.length,b.length)}
function safeProjectMatch(topic){
  const alias=state.projectAliases[norm(topic)];if(alias)return state.projects.find(p=>p.id===alias)||null;
  const scored=state.projects.map(p=>({p,score:similarity(topic,p.name)})).sort((a,b)=>b.score-a.score);
  if(scored[0]&&scored[0].score>=.82&&(!scored[1]||scored[0].score-scored[1].score>=.10))return scored[0].p;
  return null;
}
function safeSupplierMatch(name){
  const n=norm(name);const exact=state.suppliers.find(s=>norm(s.name)===n);if(exact)return exact;
  const candidates=state.suppliers.filter(s=>n.includes(norm(s.name))||norm(s.name).includes(n));
  return candidates.length===1?candidates[0]:null;
}
function detectLongMaterial(name=''){
  const n=norm(name);
  const direct=n.match(/(?:^|[^0-9])([456])\s*(?:m|meter)(?:es|eres)?\b/);
  if(direct)return`${direct[1]} méteres szálanyag: ${name}`;
  const mm=n.match(/\b(4000|5000|6000)\s*mm\b/);
  if(mm&&/(szal|cso|acel|rúd|rud|profil)/.test(n))return`${Number(mm[1])/1000} méteres szálanyag: ${name}`;
  return'';
}
function parseImportRows(rows,map){
  const grouped={};
  for(let i=1;i<rows.length;i++){
    const r=rows[i],date=excelDate(r[map.scheduleDate]);if(!date)continue;
    const driver=driverFrom(r[map.driver]),no=last5(r[map.documentNo]),topic=String(r[map.topicName]||'').trim(),supplierName=String(r[map.customerWarehouse]||'').trim();
    const note=map.note>=0?String(r[map.note]||'').trim():'',deadline=excelDate(r[map.requestedDeadline]);
    const productName=String(r[map.productName]||''),longReason=detectLongMaterial(productName),finalDriver=longReason?'martin':driver;
    const key=[date,no,supplierName,topic].join('|');
    if(!grouped[key]){
      grouped[key]={id:uid(),scheduleDate:date,driver:finalDriver,sequence:999,orderNo:no,vehicleNeed:longReason?'tarp':'any',
        supplierId:'',pickupName:supplierName,pickupAddress:'',projectId:'',projectName:'',dropAddress:'',recipientId:'',recipientName:'',recipientPhone:'',recipientEmail:'',
        pickupFrom:'',pickupTo:'',dropFrom:'',dropTo:'',pickupNote:'',note,items:[],requestedDeadline:deadline,topicName:topic,longMaterialReason:longReason};
    }
    if(longReason){grouped[key].driver='martin';grouped[key].vehicleNeed='tarp';grouped[key].longMaterialReason=grouped[key].longMaterialReason||longReason}
    if(note&&!grouped[key].note)grouped[key].note=note;
    grouped[key].items.push({code:String(r[map.productCode]||''),name:productName,qty:r[map.quantity],unit:String(r[map.unit]||''),longMaterial:!!longReason});
  }
  return Object.values(grouped);
}
async function readSerpa(file){
  const buf=await file.arrayBuffer(),wb=XLSX.read(buf,{type:'array',cellDates:true}),ws=wb.Sheets[wb.SheetNames[0]],rows=XLSX.utils.sheet_to_json(ws,{header:1,defval:''});
  importSourceRows=rows;const hm=mapHeaders(rows[0].map(String));importHeaderMap=hm.map;
  if(hm.missing.length){$('#importPreview').innerHTML=`<div class="notice">Hiányzó kötelező oszlopok: ${hm.missing.join(', ')}</div>`;$('#confirmImportBtn').disabled=true;return}
  importRows=parseImportRows(rows,hm.map);
  importRows.forEach(o=>{
    const s=safeSupplierMatch(o.pickupName);if(s){o.supplierId=s.id;o.pickupName=s.name;o.pickupAddress=s.address;o.pickupNote=s.pickupNote||s.note||''}
    const p=safeProjectMatch(o.topicName);if(p){
      o.projectId=p.id;o.projectName=p.name;o.dropAddress=p.address;
      state.projectAliases[norm(o.topicName)]=p.id;
      const rec=state.recipients.find(r=>r.id===p.defaultRecipientId);
      if(rec){o.recipientId=rec.id;o.recipientName=rec.name;o.recipientPhone=rec.phone||'';o.recipientEmail=rec.email||''}
    }
  });
  const c={mario:0,patrik:0,martin:0,unassigned:0,long:0};importRows.forEach(x=>{c[x.driver||'unassigned']++;if(x.vehicleNeed==='tarp')c.long++});
  $('#importPreview').innerHTML=`<div class="preview-row head"><span>Rendelés</span><span>Projekt / beszállító</span><span>Dátum / sofőr</span><span>Tétel</span></div>`+
    importRows.slice(0,250).map(x=>`<div class="preview-row"><span>${esc(x.orderNo)}</span><span>${esc(x.projectName||x.topicName||'Nincs biztos projekt')}<br>${esc(x.pickupName)}</span><span>${esc(x.scheduleDate)} · ${x.driver?DRIVERS[x.driver].name:'Nincs sofőr'}${x.vehicleNeed==='tarp'?'<br><b>Ponyvás</b>':''}</span><span>${x.items.length}</span></div>`).join('');
  $('#confirmImportBtn').disabled=!importRows.length;$('#importSummary').classList.remove('hidden');
  $('#importSummary').textContent=`Beolvasva: Márió ${c.mario}, Patrik ${c.patrik}, Martin ${c.martin}, sofőr nélkül ${c.unassigned}; hosszú szálanyag miatt ponyvás: ${c.long}.`;
}
$('#confirmImportBtn').onclick=()=>{
  importRows.forEach(o=>{
    const existing=state.orders.find(x=>x.scheduleDate===o.scheduleDate&&x.orderNo===o.orderNo&&norm(x.pickupName)===norm(o.pickupName));
    if(existing){
      existing.items=[...(existing.items||[]),...o.items];
      if(o.longMaterialReason){existing.driver='martin';existing.vehicleNeed='tarp';existing.longMaterialReason=o.longMaterialReason}
      if(o.note)existing.note=o.note;
    }else state.orders.push(o);
  });
  Object.keys(DRIVERS).forEach(d=>dayOrders(d).forEach((o,i)=>{if(!o.sequence||o.sequence===999)o.sequence=i+1}));
  $('#importDialog').close();save();alert(`${importRows.length} összesített rendelés importálva.`);importRows=[];
};


async function routeMetrics(driver){
  const orders=dayOrders(driver).slice().sort((a,b)=>(+a.sequence||999)-(+b.sequence||999));
  const points=[DRIVERS[driver].home];
  const base=await geocode(state.settings.baseAddress);
  if(base)points.push(base);
  const pickups=new Set(),drops=new Set();
  for(const o of orders){
    if(o.pickupAddress)pickups.add(norm(o.pickupAddress));
    if(o.dropAddress)drops.add(norm(o.dropAddress));
    const p=await geocode(o.dropAddress);if(p)points.push(p);
  }
  let km=0;for(let i=1;i<points.length;i++)km+=distance(points[i-1],points[i]);
  const stopCount=pickups.size+drops.size;
  const minutes=Math.round(km/38*60+stopCount*18+30);
  const overtime=Math.max(0,minutes-540);
  return{km:Math.round(km),stopCount,minutes,overtime,pickups:pickups.size,drops:drops.size};
}
function minutesText(m){const h=Math.floor(m/60),min=m%60;return`${h} ó ${String(min).padStart(2,'0')} p`}
async function updateWorkloadCards(){
  for(const d of Object.keys(DRIVERS)){
    const el=$('#workload-'+d);if(!el)continue;
    const m=await routeMetrics(d);
    el.innerHTML=`<b>${m.pickups} felrakó · ${m.drops} lerakó</b><br>kb. ${m.km} km · ${minutesText(m.minutes)} ${m.overtime?`<span class="overtime">· becsült túlóra ${minutesText(m.overtime)}</span>`:'<span class="balanced">· munkaidőn belül</span>'}`;
  }
}
async function balanceRoutes(){
  const all=state.orders.filter(o=>o.scheduleDate===selectedDate());
  if(!all.length)return;
  const locked=all.filter(o=>o.vehicleNeed==='tarp'||o.longMaterialReason);
  const normal=all.filter(o=>!locked.includes(o));
  locked.forEach(o=>o.driver='martin');
  const load={mario:0,patrik:0,martin:locked.length*2};
  const geo={};
  for(const o of normal){
    geo[o.id]=await geocode(o.pickupAddress||o.dropAddress);
  }
  normal.sort((a,b)=>{
    const aw=(a.pickupFrom||a.dropFrom)?1:0,bw=(b.pickupFrom||b.dropFrom)?1:0;
    return bw-aw;
  });
  for(const o of normal){
    const p=geo[o.id];
    const scores=Object.keys(DRIVERS).map(d=>{
      const homePenalty=p?distance(DRIVERS[d].home,p)/35:0;
      return{d,score:load[d]*3+homePenalty};
    }).sort((a,b)=>a.score-b.score);
    o.driver=scores[0].d;load[o.driver]+=2;
  }
  for(const d of Object.keys(DRIVERS)){
    const rows=dayOrders(d);rows.forEach((o,i)=>o.sequence=i+1);
  }
  save();
  for(const d of Object.keys(DRIVERS))await optimizeRoute(d);
}
window.openFeedback=id=>{
  const o=state.orders.find(x=>x.id===id);if(!o)return;
  $('#feedbackOrderId').value=id;
  $('#feedbackTitle').textContent=`${o.orderNo} · ${o.projectName||o.dropAddress||'Rendelés'}`;
  $('#feedbackOrderMeta').innerHTML=`<b>${esc(DRIVERS[o.driver]?.name||'Nincs sofőr')}</b> · ${esc(o.scheduleDate)}<br>${esc(o.pickupName)} → ${esc(o.projectName||o.dropAddress)}`;
  $('#feedbackNote').value='';$('#transcriptText').value='';$('#markCompleted').checked=false;
  $('#deliveryPhotos').value='';$('#photoPreview').innerHTML='';feedbackPhotos=[];audioBlob=null;audioChunks=[];
  $('#audioPreview').classList.add('hidden');$('#recordStatus').textContent='Nincs felvétel.';
  $('#feedbackDialog').showModal();
};
$('#deliveryPhotos').onchange=e=>{
  feedbackPhotos=[...e.target.files];
  $('#photoPreview').innerHTML=feedbackPhotos.map(f=>`<img src="${URL.createObjectURL(f)}" alt="Szállítólevél">`).join('');
};
$('#startRecordBtn').onclick=async()=>{
  try{
    const stream=await navigator.mediaDevices.getUserMedia({audio:true});
    audioChunks=[];mediaRecorder=new MediaRecorder(stream);
    mediaRecorder.ondataavailable=e=>{if(e.data.size)audioChunks.push(e.data)};
    mediaRecorder.onstop=()=>{
      audioBlob=new Blob(audioChunks,{type:mediaRecorder.mimeType||'audio/webm'});
      const a=$('#audioPreview');a.src=URL.createObjectURL(audioBlob);a.classList.remove('hidden');
      $('#recordStatus').textContent=`Felvétel elkészült (${Math.round(audioBlob.size/1024)} KB).`;
      stream.getTracks().forEach(t=>t.stop());
    };
    mediaRecorder.start();$('#startRecordBtn').disabled=true;$('#stopRecordBtn').disabled=false;$('#recordStatus').textContent='Felvétel folyamatban…';
  }catch(e){alert('A mikrofon nem érhető el: '+e.message)}
};
$('#stopRecordBtn').onclick=()=>{if(mediaRecorder&&mediaRecorder.state!=='inactive')mediaRecorder.stop();$('#startRecordBtn').disabled=false;$('#stopRecordBtn').disabled=true};
$('#speechToTextBtn').onclick=()=>{
  const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
  if(!SR){alert('Ebben a böngészőben a közvetlen diktálás nem támogatott. A hangfelvételt ettől még elküldheted.');return}
  const rec=new SR();rec.lang='hu-HU';rec.continuous=true;rec.interimResults=true;
  let finalText=$('#transcriptText').value;
  rec.onresult=e=>{let interim='';for(let i=e.resultIndex;i<e.results.length;i++){const t=e.results[i][0].transcript;if(e.results[i].isFinal)finalText+=' '+t;else interim+=t}$('#transcriptText').value=(finalText+' '+interim).trim()};
  rec.onerror=e=>alert('Diktálási hiba: '+e.error);rec.start();$('#recordStatus').textContent='Diktálás folyamatban – a telefon böngészője írja át a beszédet.';
  setTimeout(()=>{try{rec.stop()}catch(e){}},60000);
};
async function sendFeedback(formData,o){
  try{
    const response=await fetch('/api/send-report',{method:'POST',body:formData});
    if(response.ok)return{automatic:true};
  }catch(e){}
  const files=[...feedbackPhotos];
  if(audioBlob)files.push(new File([audioBlob],`${o.orderNo}_hangjegyzet.webm`,{type:audioBlob.type||'audio/webm'}));
  const subject=`${o.orderNo} - ${o.projectName||o.dropAddress} - ${DRIVERS[o.driver]?.name||''}`;
  const body=`Rendelésszám: ${o.orderNo}\nProjekt: ${o.projectName}\nSofőr: ${DRIVERS[o.driver]?.name||''}\nDátum: ${o.scheduleDate}\nFelrakó: ${o.pickupName}\nLerakó: ${o.dropAddress}\n\nKézi megjegyzés:\n${$('#feedbackNote').value}\n\nHangból átírt szöveg:\n${$('#transcriptText').value}`;
  if(navigator.canShare&&files.length&&navigator.canShare({files})){
    await navigator.share({title:subject,text:`Címzett: szabo.sandor@stand98.hu\n\n${body}`,files});
    return{automatic:false,shared:true};
  }
  window.location.href=`mailto:szabo.sandor@stand98.hu?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  files.forEach((f,i)=>downloadBlob(f,f.name||`${o.orderNo}_melleklet_${i+1}`));
  return{automatic:false,shared:false};
}
$('#feedbackForm').onsubmit=async e=>{
  e.preventDefault();
  const o=state.orders.find(x=>x.id===$('#feedbackOrderId').value);if(!o)return;
  const fd=new FormData();
  fd.append('to','szabo.sandor@stand98.hu');fd.append('order',JSON.stringify({orderNo:o.orderNo,project:o.projectName,driver:DRIVERS[o.driver]?.name,date:o.scheduleDate,pickup:o.pickupName,drop:o.dropAddress}));
  fd.append('note',$('#feedbackNote').value);fd.append('transcript',$('#transcriptText').value);
  feedbackPhotos.forEach((f,i)=>fd.append('photos',f,f.name||`szallitolevel_${i+1}.jpg`));
  if(audioBlob)fd.append('audio',audioBlob,`${o.orderNo}_hangjegyzet.webm`);
  const result=await sendFeedback(fd,o);
  o.reports=o.reports||[];o.reports.push({id:uid(),createdAt:new Date().toISOString(),note:$('#feedbackNote').value,transcript:$('#transcriptText').value,photoCount:feedbackPhotos.length,hasAudio:!!audioBlob,sentAutomatically:!!result.automatic});
  if($('#markCompleted').checked)o.status='teljesítve';
  $('#feedbackDialog').close();save();
  alert(result.automatic?'A jelentést automatikusan elküldtem e-mailben.':'A jelentés elkészült. A telefon megosztási/e-mail felületén fejezd be a küldést.');
};

function renderMaster(){
  const q=norm($('#masterSearch').value),arr=state[masterType].filter(x=>!q||norm(Object.values(x).join(' ')).includes(q));
  $('#masterList').innerHTML=arr.slice(0,350).map(x=>`<article class="master-card"><div class="master-top"><div><h3>${esc(x.name)}</h3><p>${esc(x.address||x.project||'')} ${esc(x.phone||'')}</p></div>${x.type?`<span class="badge">${esc(x.type)}</span>`:''}</div><div class="card-actions"><button onclick="editMaster('${x.id}')">Szerkesztés</button><button class="delete" onclick="deleteMaster('${x.id}')">Törlés</button></div></article>`).join('')||'<div class="notice">Nincs találat.</div>';
}
function masterFieldDefs(){
  if(masterType==='projects')return[['name','Projekt neve'],['address','Cím'],['type','Típus (felrakó / lerakó / mindkettő)'],['defaultRecipientId','Alap átvevő']];
  if(masterType==='suppliers')return[['name','Beszállító neve'],['site','Telephely'],['address','Cím'],['pickupNote','Alap felrakói megjegyzés']];
  return[['project','Projekt neve'],['name','Átvevő neve'],['phone','Telefon'],['email','E-mail'],['role','Beosztás'],['company','Cég'],['note','Megjegyzés']];
}
function openMaster(x={}){
  $('#masterDialogTitle').textContent=x.id?'Törzsadat szerkesztése':'Új törzsadat';$('#masterEditId').value=x.id||'';
  $('#masterFields').innerHTML=masterFieldDefs().map(([k,l])=>{
    if(k==='defaultRecipientId')return`<label>${l}<select data-master-field="${k}"><option value="">Nincs alap átvevő</option>${state.recipients.map(r=>option(r.id,`${r.name} · ${r.project||''}`,x[k])).join('')}</select></label>`;
    return`<label>${l}<input data-master-field="${k}" value="${esc(x[k]||'')}"></label>`;
  }).join('');$('#masterDialog').showModal();
}
window.editMaster=id=>openMaster(state[masterType].find(x=>x.id===id));
window.deleteMaster=id=>{if(confirm('Biztosan törlöd?')){state[masterType]=state[masterType].filter(x=>x.id!==id);save()}};
$('#masterForm').onsubmit=e=>{
  e.preventDefault();const id=$('#masterEditId').value,obj={id:id||uid(),active:true};
  $$('[data-master-field]').forEach(x=>obj[x.dataset.masterField]=x.value.trim());
  const i=state[masterType].findIndex(x=>x.id===id);if(i>=0)state[masterType][i]=obj;else state[masterType].push(obj);
  $('#masterDialog').close();save();
};
function fillSettings(){
  $('#baseAddress').value=state.settings.baseAddress;$('#marioVehicle').value=state.settings.marioVehicle;$('#patrikVehicle').value=state.settings.patrikVehicle;$('#martinVehicle').value=state.settings.martinVehicle;
}
function exportRows(driver){return dayOrders(driver).slice().sort((a,b)=>(+a.sequence||999)-(+b.sequence||999))}
function mainExportRows(rows){
  const data=[['Sorrend','Rendelésszám','Felrakó','Felrakó cím','Felrakói megjegyzés','Projekt','Lerakó cím','Átvevő','Telefon','Kért határidő','Időablak','Fuvar megjegyzés']];
  rows.forEach((o,i)=>data.push([i+1,o.orderNo,o.pickupName,o.pickupAddress,o.pickupNote,o.projectName,o.dropAddress,o.recipientName,o.recipientPhone,o.requestedDeadline,[o.pickupFrom&&`Felvétel ${o.pickupFrom}-${o.pickupTo}`,o.dropFrom&&`Lerakás ${o.dropFrom}-${o.dropTo}`].filter(Boolean).join('; '),o.note]));
  return data;
}
function itemExportRows(rows){
  const data=[['Rendelésszám','Termék kód','Termék név','Mennyiség','M.e.','Hosszú szálanyag']];
  rows.forEach(o=>(o.items||[]).forEach(it=>data.push([o.orderNo,it.code,it.name,it.qty,it.unit,it.longMaterial?'Igen':''])));
  return data;
}
function exportExcel(driver){
  const rows=exportRows(driver),wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(mainExportRows(rows)),'Fuvarjegyzék');
  XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(itemExportRows(rows)),'Tételmelléklet');
  XLSX.writeFile(wb,`${selectedDate()}_${DRIVERS[driver].name}_fuvar.xlsx`);
}
function exportImportWithNotes(){
  const headers=['Bizonylatszám','Témaszám név','Termék kód','Termék név','Ügyfél/raktár','Tétel mennyiség','M.e.','Kért szállítási határidő','Dátum','autó','Megjegyzés'];
  const rows=[headers];
  state.orders.slice().sort((a,b)=>a.scheduleDate.localeCompare(b.scheduleDate)).forEach(o=>{
    (o.items?.length?o.items:[{}]).forEach(it=>rows.push([o.orderNo,o.topicName||o.projectName,it.code||'',it.name||'',o.pickupName,it.qty||'',it.unit||'',o.requestedDeadline,o.scheduleDate,o.driver?DRIVERS[o.driver].name:'',o.note||'']));
  });
  const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(rows),'Import + megjegyzések');
  XLSX.writeFile(wb,`fuvarszervezo_import_megjegyzesek_${today()}.xlsx`);
}
function exportWord(driver){
  const rows=exportRows(driver),main=rows.map((o,i)=>`<tr><td>${i+1}</td><td>${esc(o.orderNo)}</td><td>${esc(o.pickupName)}<br>${esc(o.pickupAddress)}<br><b>${esc(o.pickupNote)}</b></td><td>${esc(o.projectName)}<br>${esc(o.dropAddress)}</td><td>${esc(o.recipientName)} ${esc(o.recipientPhone)}</td><td>${esc(o.note)}</td></tr>`).join('');
  const annex=rows.map(o=>`<h3>${esc(o.orderNo)} · ${esc(o.projectName)}</h3>${itemsTable(o.items||[])}`).join('');
  const html=`<!doctype html><html><head><meta charset="utf-8"><style>body{font-family:Arial}table{width:100%;border-collapse:collapse;font-size:10pt}th,td{border:1px solid #999;padding:6px}th{background:#dcecf5}h1{color:#103a56}.page{page-break-before:always}</style></head><body><h1>${DRIVERS[driver].name} – ${selectedDate()}</h1><p>Indulás: ${esc(state.settings.baseAddress)}</p><table><tr><th>#</th><th>Rendelés</th><th>Felrakó</th><th>Lerakó</th><th>Átvevő</th><th>Megjegyzés</th></tr>${main}</table><div class="page"><h2>Tételmelléklet</h2>${annex}</div></body></html>`;
  downloadBlob(new Blob(['\ufeff'+html],{type:'application/msword'}),`${selectedDate()}_${DRIVERS[driver].name}_fuvar.doc`);
}
function exportPdf(driver){
  const rows=exportRows(driver),{jsPDF}=window.jspdf,doc=new jsPDF({orientation:'landscape'});
  doc.setFontSize(16);doc.text(`${DRIVERS[driver].name} – ${selectedDate()}`,14,14);doc.setFontSize(9);doc.text(`Indulás: ${state.settings.baseAddress}`,14,20);
  doc.autoTable({startY:25,head:[['#','Rendelés','Felrakó','Felrakói megj.','Lerakó','Átvevő','Megjegyzés']],body:rows.map((o,i)=>[i+1,o.orderNo,`${o.pickupName}\n${o.pickupAddress}`,o.pickupNote,`${o.projectName}\n${o.dropAddress}`,`${o.recipientName}\n${o.recipientPhone}`,o.note]),styles:{fontSize:7,cellPadding:2},headStyles:{fillColor:[16,58,86]}});
  doc.addPage('a4','portrait');doc.setFontSize(15);doc.text('Tételmelléklet',14,14);let y=20;
  rows.forEach(o=>{if(y>250){doc.addPage();y=18}doc.setFontSize(11);doc.text(`${o.orderNo} · ${o.projectName||''}`,14,y);y+=4;doc.autoTable({startY:y,head:[['Termék kód','Termék név','Mennyiség','M.e.','Hosszú']],body:(o.items||[]).map(it=>[it.code,it.name,String(it.qty),it.unit,it.longMaterial?'Igen':'']),styles:{fontSize:7},margin:{left:14,right:14}});y=doc.lastAutoTable.finalY+8});
  doc.save(`${selectedDate()}_${DRIVERS[driver].name}_fuvar.pdf`);
}
function downloadBlob(blob,name){const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)}
window.exportMenu=driver=>{const t=prompt('Export formátum: excel, word vagy pdf','excel');if(!t)return;const n=norm(t);if(n.startsWith('e'))exportExcel(driver);else if(n.startsWith('w'))exportWord(driver);else if(n.startsWith('p'))exportPdf(driver)};
$('#exportAllBtn').onclick=()=>Object.keys(DRIVERS).forEach((d,i)=>setTimeout(()=>exportExcel(d),i*500));
$('#exportImportBtn').onclick=exportImportWithNotes;
$('#optimizeAllBtn').onclick=async()=>{for(const d of Object.keys(DRIVERS))await optimizeRoute(d)};
$('#balanceRoutesBtn').onclick=balanceRoutes;
$('#saveSettingsBtn').onclick=()=>{state.settings={baseAddress:$('#baseAddress').value,marioVehicle:$('#marioVehicle').value,patrikVehicle:$('#patrikVehicle').value,martinVehicle:$('#martinVehicle').value};save();alert('Beállítások mentve.')};
$('#backupDownloadBtn').onclick=()=>downloadBlob(new Blob([JSON.stringify(state,null,2)],{type:'application/json'}),'fuvarszervezo-v4-mentes.json');
$('#backupRestoreInput').onchange=e=>{const r=new FileReader();r.onload=()=>{state=JSON.parse(r.result);save();alert('Mentés visszatöltve.')};r.readAsText(e.target.files[0])};
$('#clearOrdersBtn').onclick=()=>{if(confirm('Minden rendelést törölsz?')){state.orders=[];save()}};
$$('.nav').forEach(x=>x.onclick=()=>showPage(x.dataset.page));
$$('[data-close]').forEach(x=>x.onclick=()=>$('#'+x.dataset.close).close());
$('#openImportBtn').onclick=()=>$('#importDialog').showModal();
$('#serpaFile').onchange=e=>readSerpa(e.target.files[0]).catch(err=>alert('Import hiba: '+err.message));
$('#newOrderBtn').onclick=()=>openOrder({scheduleDate:selectedDate(),items:[]});
$('#orderSearch').oninput=renderOrders;$('#orderDriverFilter').onchange=renderOrders;
$('#newMasterBtn').onclick=()=>openMaster();$('#masterSearch').oninput=renderMaster;
$$('[data-master]').forEach(x=>x.onclick=()=>{$$('[data-master]').forEach(y=>y.classList.remove('active'));x.classList.add('active');masterType=x.dataset.master;renderMaster()});
$('#pickupWindowEnabled').onchange=e=>$('#pickupWindowFields').classList.toggle('hidden',!e.target.checked);
$('#dropWindowEnabled').onchange=e=>$('#dropWindowFields').classList.toggle('hidden',!e.target.checked);
$('#workDate').onchange=render;
$('#prevDay').onclick=()=>{const d=new Date(selectedDate()+'T12:00:00');d.setDate(d.getDate()-1);$('#workDate').value=d.toISOString().slice(0,10);render()};
$('#nextDay').onclick=()=>{const d=new Date(selectedDate()+'T12:00:00');d.setDate(d.getDate()+1);$('#workDate').value=d.toISOString().slice(0,10);render()};
window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();installPrompt=e;$('#installBtn').classList.remove('hidden')});
$('#installBtn').onclick=async()=>{if(installPrompt){installPrompt.prompt();await installPrompt.userChoice;installPrompt=null}};
if('serviceWorker'in navigator)navigator.serviceWorker.register('sw.js');
load();$('#workDate').value=today();render();
