const KEY='fuvarszervezo_v11';const APP_VERSION='V23';const $=s=>document.querySelector(s),$$=s=>document.querySelectorAll(s);
const VEHICLE_TYPES=['3.5 T dobozos autó','3.5 T plató autó','7.5 tonnás dobozos autó','7.5 tonnás platós autó','7.5 tonnás emelőhátfalas autó','7.5 tonnás KCR-es autó','12 tonnás dobozos autó','12 tonnás platós autó','12 tonnás emelőhátfalas autó','12 tonnás KCR-es autó','24 tonnás kamion'];
let state={projects:[],suppliers:[],recipients:[],vehicles:[],orders:[],backlog:[],settings:{baseAddress:'2310 Szigetszentmiklós, Kereskedő utca 2.'},aliases:{projects:{},suppliers:{}},geo:{}};
let maps={},masterType='projects',currentItemsOrderId='',mediaRecorder=null,audioChunks=[],audioBlob=null,importOrders=[],reviewQueue=[],reviewIndex=0,deferredPrompt=null;
const localISO=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;const today=()=>localISO(new Date()),tomorrow=()=>{const d=new Date();d.setDate(d.getDate()+1);return localISO(d)},uid=()=>crypto.randomUUID?crypto.randomUUID():Date.now()+'-'+Math.random();
function esc(v=''){return String(v).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]))}
function norm(s=''){return String(s).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[_.,;:()[\]{}\/\\-]+/g,' ').replace(/\s+/g,' ').trim()}
function last5(v=''){const d=String(v).replace(/\D/g,'');return d.slice(-5).padStart(5,'0')}
function dateVal(v){if(v===null||v===undefined||v==='')return'';if(v instanceof Date&&!isNaN(v))return localISO(v);if(typeof v==='number'){const d=XLSX.SSF.parse_date_code(v);return d?`${d.y}-${String(d.m).padStart(2,'0')}-${String(d.d).padStart(2,'0')}`:''}const t=String(v).trim();let m=t.match(/^(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})(?:\D|$)/);if(m)return`${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`;m=t.match(/^(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{4})(?:\D|$)/);if(m)return`${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;return''}
function setDateParts(prefix,value=''){const m=String(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);$('#'+prefix+'Year').value=m?.[1]||'';$('#'+prefix+'Month').value=m?.[2]||'';$('#'+prefix+'Day').value=m?.[3]||'';const hidden=$('#'+(prefix==='schedule'?'scheduleDate':'deadline'));if(hidden)hidden.value=m?value:''}
function syncDateParts(prefix,required=false){const y=$('#'+prefix+'Year').value.replace(/\D/g,'').slice(0,4),m=$('#'+prefix+'Month').value.replace(/\D/g,'').slice(0,2),d=$('#'+prefix+'Day').value.replace(/\D/g,'').slice(0,2);$('#'+prefix+'Year').value=y;$('#'+prefix+'Month').value=m;$('#'+prefix+'Day').value=d;const hidden=$('#'+(prefix==='schedule'?'scheduleDate':'deadline'));if(!y&&!m&&!d){if(hidden)hidden.value='';return !required}if(y.length!==4||!m||!d)return false;const value=`${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`,dt=new Date(value+'T12:00:00');if(isNaN(dt)||localISO(dt)!==value)return false;if(hidden)hidden.value=value;return true}
function setScheduleParts(value=''){setDateParts('schedule',value)}
function syncScheduleDate(){return syncDateParts('schedule',true)}
function bindDateParts(prefix){const y=$('#'+prefix+'Year'),m=$('#'+prefix+'Month'),d=$('#'+prefix+'Day');[[y,4,m],[m,2,d],[d,2,null]].forEach(([el,max,next])=>{if(!el)return;el.addEventListener('input',()=>{el.value=el.value.replace(/\D/g,'').slice(0,max);if(el.value.length===max&&next){next.focus();next.select()}});el.addEventListener('keydown',e=>{if(e.key==='Backspace'&&!el.value){const prev=el===d?m:el===m?y:null;if(prev){e.preventDefault();prev.focus();prev.setSelectionRange(prev.value.length,prev.value.length)}}})})}
function defaultVehicles(){return[{id:'v-mario',driverName:'Márió',name:'Dobozos 1',type:'3.5 T dobozos autó',homeCity:'Vác',active:true},{id:'v-patrik',driverName:'Patrik',name:'Dobozos 2',type:'3.5 T dobozos autó',homeCity:'Kispest',active:true},{id:'v-martin',driverName:'Martin',name:'Ponyvás',type:'3.5 T plató autó',homeCity:'Felcsút',active:true}]}
function refreshMasterData(){if(state.masterDataVersion==='v14-20260717'||state.masterDataVersion==='v22-excel')return;state.recipients=(state.recipients?.length?state.recipients:(SEED_DATA.recipients||[]).map((x,i)=>({...x,id:'r'+i})));state.projects=(SEED_DATA.projects||[]).map((x,i)=>({...x,id:'p'+i,defaultRecipientId:''}));state.suppliers=(SEED_DATA.suppliers||[]).map((x,i)=>({...x,id:'s'+i,isCentral:!!x.site&&norm(x.site)==='kozpont',pickupNote:x.note||''}));state.projects.forEach(p=>{const r=state.recipients.find(x=>norm(x.project)===norm(p.name))||state.recipients.find(x=>norm(x.name)===norm(p.receiver));p.defaultRecipientId=r?.id||''});(state.orders||[]).forEach(o=>{const p=state.projects.find(x=>norm(x.name)===norm(o.projectName));if(p)o.projectId=p.id;const matches=state.suppliers.filter(x=>norm(x.name)===norm(o.pickupName));if(matches.length===1)o.supplierId=matches[0].id});state.aliases={projects:{},suppliers:{}};state.masterDataVersion='v14-20260717'}function load(){const raw=localStorage.getItem(KEY);if(raw){state=JSON.parse(raw);state.aliases=state.aliases||{projects:{},suppliers:{}};state.vehicles=state.vehicles||defaultVehicles();state.orders=state.orders||[];state.backlog=state.backlog||[];refreshMasterData();save(false);return}state.recipients=(SEED_DATA.recipients||[]).map((x,i)=>({...x,id:'r'+i}));state.vehicles=defaultVehicles();state.orders=[];refreshMasterData();save(false)}
function save(renderNow=true){localStorage.setItem(KEY,JSON.stringify(state));if(renderNow)render()}
function activeVehicles(){return state.vehicles.filter(v=>v.active)}
function marioVehicle(){return activeVehicles().find(v=>norm(v.driverName).includes('mario'))||state.vehicles.find(v=>norm(v.driverName).includes('mario'))||null}
function selectedDate(){return $('#workDate').value||today()}
function dayOrders(vehicleId=null,date=selectedDate()){return state.orders.filter(o=>o.scheduleDate===date&&(!vehicleId||o.vehicleId===vehicleId))}
function option(v,t,sel=''){return`<option value="${esc(v)}" ${String(v)===String(sel)?'selected':''}>${esc(t)}</option>`}
function showPage(id){$$('.page').forEach(p=>p.classList.toggle('active',p.id===id));function restoreFile(file){const r=new FileReader();r.onload=()=>{try{const incoming=JSON.parse(r.result),mode=confirm('OK = összevonás, Mégse = teljes csere')?'merge':'replace';if(mode==='replace')state=incoming;else{state.orders=[...state.orders,...(incoming.orders||[]).filter(x=>!state.orders.some(y=>y.id===x.id))];state.projects=[...state.projects,...(incoming.projects||[]).filter(x=>!state.projects.some(y=>norm(y.name)===norm(x.name)))];state.suppliers=[...state.suppliers,...(incoming.suppliers||[]).filter(x=>!state.suppliers.some(y=>norm(y.name)===norm(x.name)&&norm(y.address)===norm(x.address)))];state.recipients=[...state.recipients,...(incoming.recipients||[]).filter(x=>!state.recipients.some(y=>norm(y.name)===norm(x.name)&&norm(y.project)===norm(x.project)))]}save();alert('Adatok betöltve.')}catch(e){alert('Hibás mentési fájl.')}};r.readAsText(file)}
$('#recordStart').onclick=async()=>{try{const stream=await navigator.mediaDevices.getUserMedia({audio:true});audioChunks=[];mediaRecorder=new MediaRecorder(stream);mediaRecorder.ondataavailable=e=>e.data.size&&audioChunks.push(e.data);mediaRecorder.onstop=()=>{audioBlob=new Blob(audioChunks,{type:mediaRecorder.mimeType||'audio/webm'});$('#audioPreview').src=URL.createObjectURL(audioBlob);$('#audioPreview').classList.remove('hidden');$('#recordStatus').textContent='Felvétel elkészült.';stream.getTracks().forEach(t=>t.stop())};mediaRecorder.start();$('#recordStart').disabled=true;$('#recordStop').disabled=false;$('#recordStatus').textContent='Felvétel folyamatban…'}catch(e){alert(e.message)}};
$('#recordStop').onclick=()=>{if(mediaRecorder&&mediaRecorder.state!=='inactive')mediaRecorder.stop();$('#recordStart').disabled=false;$('#recordStop').disabled=true};
$$('.nav').forEach(n=>n.classList.toggle('active',n.dataset.page===id));scrollTo(0,0);render()}
function render(){applyAfterFourRule();renderRoutes();renderOrders();renderBacklog();renderMasters();renderVehicles();renderDriver();fillSelectors();$('#baseAddress').value=state.settings.baseAddress}
function longReason(name=''){const n=norm(name);let m=n.match(/(?:^|[^0-9])([456])\s*(?:m|meter)(?:es|eres)?\b/);if(m)return`${m[1]} méteres szálanyag`;m=n.match(/\b(4000|5000|6000)\s*mm\b/);if(m&&/(szal|cso|acel|rud|profil)/.test(n))return`${+m[1]/1000} méteres szálanyag`;return''}
function canCarryLong(v){return/(plato|kcr|kamion)/.test(norm(v.type))}
function centralSupplier(name){const group=state.suppliers.filter(s=>norm(s.name)===norm(name));return group.find(s=>s.isCentral)||group[0]||null}
function renderRoutes(){const vehicles=activeVehicles();$('#routes').innerHTML=vehicles.map(v=>{const list=dayOrders(v.id).sort((a,b)=>(+a.sequence||999)-(+b.sequence||999));return`<section class="route"><header class="route-head"><h2><input value="${esc(v.driverName)}" onchange="renameDriver('${v.id}',this.value)"></h2><small>${esc(v.name)} · ${esc(v.type)} · ${list.length} fuvar</small><div class="route-summary" id="summary-${v.id}"></div></header><div id="map-${v.id}" class="map"></div><div id="route-${v.id}" class="route-list">${bubbles(list)}</div></section>`}).join('')||'<div class="notice">Nincs aktív jármű.</div>';setTimeout(initMaps,30);setTimeout(initSortables,40);setTimeout(updateSummaries,60)}
function itemNoteValue(it={}){return String(it.itemNote??it.itemRemark??it.tetelMegjegyzes??'')}function itemNoteSummary(o){return(o.items||[]).map((it,i)=>itemNoteValue(it)?`<p class="item-note-preview"><b>${i+1}. tétel megjegyzés:</b> ${esc(itemNoteValue(it))}</p>`:'').join('')}
function bubbles(list){if(!list.length)return'<div class="notice">Nincs fuvar.</div>';return list.map((o,i)=>`<article class="bubble ${o.completed?'done':''}" data-id="${o.id}"><span class="drag">☷</span><h3>${i+1}. ${esc(o.orderNo)} · ${esc(o.projectName||'Egyedi úticél')}</h3><p><b>Felrakó:</b> ${esc(o.pickupName||'Nincs megadva')} · ${esc(o.pickupAddress||'')}</p><p><b>Lerakó:</b> ${esc(o.dropAddress||'Nincs megadva')}</p>${o.pickupNote?`<p><b>Felrakói megj.:</b> ${esc(o.pickupNote)}</p>`:''}${o.note?`<p><b>Fuvar megjegyzés:</b> ${esc(o.note)}</p>`:''}${itemNoteSummary(o)}<div class="tags"><span class="tag">${o.items?.length||0} tétel</span>${o.longMaterialReason?`<span class="tag long">${esc(o.longMaterialReason)}</span>`:''}${o.requestedDeadline?`<span class="tag ${o.scheduleDate>o.requestedDeadline?'warn':''}">${o.requestedDeadline}</span>`:''}</div><div class="bubble-actions"><button onclick="editOrder('${o.id}')">Szerkesztés</button><button onclick="openItems('${o.id}')">Tételek</button><button onclick="openCamera('${o.id}')">📷 Kamera</button></div><button class="complete-button ${o.completed?'done':''}" onclick="toggleComplete('${o.id}')">${o.completed?'✓':'○'}</button><button class="trash" onclick="deleteOne('${o.id}')">🗑</button></article>`).join('')}
window.renameDriver=(id,name)=>{const v=state.vehicles.find(x=>x.id===id);if(v){v.driverName=name.trim()||v.driverName;save()}};
function initSortables(){activeVehicles().forEach(v=>{const el=$('#route-'+v.id);if(!el)return;new Sortable(el,{group:'vehicles',animation:180,handle:'.drag',onEnd:e=>{const o=state.orders.find(x=>x.id===e.item.dataset.id);if(o)o.vehicleId=e.to.id.replace('route-','');activeVehicles().forEach(x=>{$$('#route-'+x.id+' .bubble').forEach((n,i)=>{const r=state.orders.find(o=>o.id===n.dataset.id);if(r)r.sequence=i+1})});save()}})})}
async function geo(addr){if(!addr)return null;if(state.geo[addr])return state.geo[addr];try{const r=await fetch('https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=hu&q='+encodeURIComponent(addr));const j=await r.json();if(j[0]){state.geo[addr]=[+j[0].lat,+j[0].lon];save(false);await new Promise(r=>setTimeout(r,1050));return state.geo[addr]}}catch{}return null}
function initMaps(){activeVehicles().forEach(v=>{if(maps[v.id])maps[v.id].remove();maps[v.id]=L.map('map-'+v.id).setView([47.45,19.04],9);L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© OpenStreetMap'}).addTo(maps[v.id]);drawMap(v.id)})}
async function roadRoute(pts){if(pts.length<2)return null;try{const c=pts.map(p=>`${p[1]},${p[0]}`).join(';');const r=await fetch(`https://router.project-osrm.org/route/v1/driving/${c}?overview=full&geometries=geojson`);const j=await r.json();return j.routes?.[0]||null}catch{return null}}
async function drawMap(id){const map=maps[id],pts=[];const base=await geo(state.settings.baseAddress);if(base)pts.push(base);for(const o of dayOrders(id).sort((a,b)=>(+a.sequence||999)-(+b.sequence||999))){const p=await geo(o.dropAddress);if(p){pts.push(p);L.marker(p).addTo(map).bindPopup(`<b>${esc(o.orderNo)} · ${esc(o.projectName||'Egyedi úticél')}</b><br>${esc(o.dropAddress||'')}${o.recipientName?`<br>Átvevő: ${esc(o.recipientName)}`:''}${o.note?`<br>Megjegyzés: ${esc(o.note)}`:''}${itemNoteSummary(o).replaceAll('<p class="item-note-preview">','<br>').replaceAll('</p>','')}`)}}if(pts.length){const rr=await roadRoute(pts);const coords=rr?rr.geometry.coordinates.map(c=>[c[1],c[0]]):pts;const line=L.polyline(coords,{weight:4}).addTo(map);map.fitBounds(line.getBounds(),{padding:[20,20]})}}
async function vehicleHome(v){const known={vac:'Vác',kispest:'1191 Budapest, Kispest',felcsut:'Felcsút'};return await geo(known[norm(v.homeCity)]||v.homeCity||state.settings.baseAddress)||await geo(state.settings.baseAddress)}
function dist(a,b){if(!a||!b)return 999;const R=6371,r=Math.PI/180,d1=(b[0]-a[0])*r,d2=(b[1]-a[1])*r,x=Math.sin(d1/2)**2+Math.cos(a[0]*r)*Math.cos(b[0]*r)*Math.sin(d2/2)**2;return R*2*Math.atan2(Math.sqrt(x),Math.sqrt(1-x))}
async function balance(){const active=activeVehicles();if(!active.length)return alert('Nincs aktív jármű.');const orders=state.orders.filter(o=>o.scheduleDate===selectedDate()),longCars=active.filter(canCarryLong);for(const o of orders){if(o.longMaterialReason){const target=longCars.find(v=>norm(v.driverName).includes('martin'))||longCars[0];if(target)o.vehicleId=target.id}}
const homes={};for(const v of active)homes[v.id]=await vehicleHome(v);const loads=Object.fromEntries(active.map(v=>[v.id,orders.filter(o=>o.vehicleId===v.id&&o.longMaterialReason).length*2]));for(const o of orders.filter(o=>!o.longMaterialReason)){const p=await geo(o.pickupAddress||o.dropAddress);const ranked=active.map(v=>({v,score:(loads[v.id]||0)*12+dist(homes[v.id],p)})).sort((a,b)=>a.score-b.score);o.vehicleId=ranked[0].v.id;loads[o.vehicleId]=(loads[o.vehicleId]||0)+2}active.forEach(v=>dayOrders(v.id).forEach((o,i)=>o.sequence=i+1));save();alert('A fuvarokat az aktív autók, a sofőrök indulási helye és a terhelés alapján szétosztottam.')}
async function optimizeAll(){for(const v of activeVehicles()){const orders=dayOrders(v.id);let current=await geo(state.settings.baseAddress),left=[];for(const o of orders)left.push({o,p:await geo(o.dropAddress)});const ordered=[];while(left.length){left.sort((a,b)=>dist(current,a.p)-dist(current,b.p));const n=left.shift();ordered.push(n.o);if(n.p)current=n.p}ordered.forEach((o,i)=>o.sequence=i+1)}save()}
async function updateSummaries(){for(const v of activeVehicles()){const orders=dayOrders(v.id),pick=new Set(orders.map(o=>norm(o.pickupAddress)).filter(Boolean)),drop=new Set(orders.map(o=>norm(o.dropAddress)).filter(Boolean));const el=$('#summary-'+v.id);if(el)el.textContent=`${pick.size} felrakó · ${drop.size} lerakó · kb. ${Math.max(0,orders.length*35)} perc rakodás`}}
function toggleComplete(id){const o=state.orders.find(x=>x.id===id);if(!o)return;o.completed=!o.completed;o.completedAt=o.completed?new Date().toISOString():'';(o.items||[]).forEach(i=>i.received=o.completed);save()}
function applyAfterFourRule(){const now=new Date();if(now.getHours()<16)return;const d=today(),next=new Date();next.setDate(next.getDate()+1);const nd=next.toISOString().slice(0,10);let changed=false;state.orders.forEach(o=>{if(o.scheduleDate===d&&!o.completed&&!o.carriedAfter16){o.scheduleDate=nd;o.carriedAfter16=true;changed=true}});if(changed){localStorage.setItem(KEY,JSON.stringify(state));$('#dayWarning').classList.remove('hidden');$('#dayWarning').textContent='A 16:00 után nem teljesített mai fuvarokat a program áthelyezte a következő napra.'}}
function searchableOrderText(o){return norm(JSON.stringify(o)+' '+(o.items||[]).map(i=>Object.values(i).join(' ')).join(' '))}function renderOrders(){const q=norm($('#orderSearch').value),vf=$('#orderVehicleFilter').value;const rows=state.orders.filter(o=>(!q||searchableOrderText(o).includes(q))&&(!vf||o.vehicleId===vf)).sort((a,b)=>a.scheduleDate.localeCompare(b.scheduleDate));$('#orderList').innerHTML=rows.map(o=>`<article class="card search-result" onclick="openSearchResult('${o.id}')"><h3>${esc(o.orderNo)} · ${esc(o.projectName||'Egyedi úticél')}</h3><p>${o.scheduleDate} · ${esc(state.vehicles.find(v=>v.id===o.vehicleId)?.driverName||'Nincs kiosztva')}</p><p>${esc(o.pickupName||'')} → ${esc(o.dropAddress||'')}</p><div class="card-actions"><button onclick="event.stopPropagation();openSearchResult('${o.id}')">Megnyitás</button><button onclick="event.stopPropagation();editOrder('${o.id}')">Szerkesztés</button><button onclick="event.stopPropagation();openItems('${o.id}')">Tételek</button><button onclick="event.stopPropagation();deleteOne('${o.id}')">Törlés</button></div></article>`).join('')||'<div class="notice">Nincs találat.</div>'}window.openSearchResult=id=>{const o=state.orders.find(x=>x.id===id);if(!o)return;$('#workDate').value=o.scheduleDate;showPage('planner');render();setTimeout(()=>{const el=document.querySelector(`.bubble[data-id="${id}"]`);if(el){el.classList.add('search-highlight');el.scrollIntoView({behavior:'smooth',block:'center'});setTimeout(()=>el.classList.remove('search-highlight'),7000)}},180)}
function renderVehicles(){$('#vehicleList').innerHTML=state.vehicles.map(v=>`<article class="card vehicle-card ${v.active?'':'inactive'}"><div><h3>${esc(v.driverName)} · ${esc(v.name)}</h3><p>${esc(v.type)} · ${esc(v.homeCity||'')}</p><div class="card-actions"><button onclick="editVehicle('${v.id}')">Szerkesztés</button></div></div><label class="switch"><input type="checkbox" ${v.active?'checked':''} onchange="toggleVehicle('${v.id}',this.checked)"> Aktív</label></article>`).join('')}
window.toggleVehicle=(id,val)=>{const v=state.vehicles.find(x=>x.id===id);if(v){v.active=val;if(!val){const active=state.vehicles.filter(x=>x.active);state.orders.filter(o=>o.vehicleId===id).forEach(o=>o.vehicleId=active[0]?.id||'')}save()}};
function renderDriver(){const vid=$('#driverVehicleSelect').value||activeVehicles()[0]?.id,date=$('#driverDate').value||selectedDate();const rows=dayOrders(vid,date).sort((a,b)=>(+a.sequence||999)-(+b.sequence||999));$('#driverTasks').innerHTML=rows.map((o,i)=>`<article class="driver-task ${o.completed?'done':''}"><h3>${i+1}. ${esc(o.orderNo)} · ${esc(o.projectName||o.dropAddress)}</h3><p><b>Felrakó:</b> ${esc(o.pickupName)} · ${esc(o.pickupAddress)}</p><p><b>Lerakó:</b> ${esc(o.dropAddress)}</p>${o.note?`<p><b>Megjegyzés:</b> ${esc(o.note)}</p>`:''}<button onclick="toggleComplete('${o.id}')">${o.completed?'✓ Minden tétel rendben':'○ Átvétel rendben'}</button><button class="secondary" onclick="openItems('${o.id}')">Tételek külön pipálása</button><button class="secondary" onclick="openCamera('${o.id}')">📷 Szállítólevél fotózása</button></article>`).join('')||'<div class="notice">Nincs feladat.</div>'}
function fillSelectors(){const vehicleOpts='<option value="">Nincs kiosztva</option>'+state.vehicles.map(v=>option(v.id,`${v.driverName} · ${v.name}${v.active?'':' (kikapcsolva)'}`)).join('');$('#vehicleId').innerHTML=vehicleOpts;$('#orderVehicleFilter').innerHTML='<option value="">Minden autó</option>'+state.vehicles.map(v=>option(v.id,v.driverName)).join('');$('#driverVehicleSelect').innerHTML=activeVehicles().map(v=>option(v.id,`${v.driverName} · ${v.name}`,$('#driverVehicleSelect').value)).join('');if(!$('#driverDate').value)$('#driverDate').value=selectedDate()}
function renderMasters(){const q=norm($('#masterSearch').value),arr=state[masterType].filter(x=>!q||norm(Object.values(x).join(' ')).includes(q));$('#masterList').innerHTML=arr.map(x=>`<article class="card"><h3>${esc(x.name)}</h3><p>${esc(x.address||x.project||'')} ${esc(x.phone||'')}</p>${masterType==='suppliers'?`<p>${x.isCentral?'★ Központi telephely':''}</p>`:''}<div class="card-actions"><button onclick="editMaster('${x.id}')">Szerkesztés</button><button onclick="deleteMaster('${x.id}')">Törlés</button></div></article>`).join('')||'<div class="notice">Nincs találat.</div>'}
function supplierOptions(sel=''){return'<option value="">Egyedi / nincs kiválasztva</option>'+state.suppliers.sort((a,b)=>a.name.localeCompare(b.name,'hu')).map(s=>option(s.id,`${s.name}${s.isCentral?' ★ központ':''} · ${s.address}`,sel)).join('')}
function projectOptions(sel=''){return'<option value="">Egyedi úticél</option>'+state.projects.sort((a,b)=>a.name.localeCompare(b.name,'hu')).map(p=>option(p.id,p.name,sel)).join('')}
function recipientOptions(project,sel=''){return'<option value="">Nincs átvevő</option>'+state.recipients.filter(r=>!project||norm(r.project)===norm(project)).map(r=>option(r.id,`${r.name} · ${r.phone||''}`,sel)).join('')}
function supplierDisplay(s){return s?`${s.name} · ${s.address}`:''}function findSupplierByInput(v){const n=norm(v);return state.suppliers.find(s=>norm(supplierDisplay(s))===n)||state.suppliers.find(s=>norm(s.name)===n)||null}function findProjectByInput(v){const n=norm(v);return state.projects.find(p=>norm(p.name)===n)||null}
function fillSearchableMasters(){const sv=$('#supplierSearch')?.value||'',pv=$('#projectSearch')?.value||'';$('#supplierList').innerHTML=state.suppliers.slice().sort((a,b)=>a.name.localeCompare(b.name,'hu')).map(s=>`<option value="${esc(supplierDisplay(s))}"></option>`).join('');$('#projectList').innerHTML=state.projects.slice().sort((a,b)=>a.name.localeCompare(b.name,'hu')).map(p=>`<option value="${esc(p.name)}"></option>`).join('');if($('#supplierSearch'))$('#supplierSearch').value=sv;if($('#projectSearch'))$('#projectSearch').value=pv}
function setCustomProjectMode(custom){$('#recipientSelectWrap').classList.toggle('hidden',custom)}
function openOrder(o={}){$('#orderId').value=o.id||'';$('#orderTitle').textContent=o.id?'Fuvar szerkesztése':'Új fuvar';setScheduleParts(o.scheduleDate||selectedDate());setDateParts('deadline',o.requestedDeadline||'');fillSelectors();fillSearchableMasters();$('#vehicleId').value=o.vehicleId||'';$('#orderNo').value=o.orderNo||'';const s=state.suppliers.find(x=>x.id===o.supplierId);$('#supplierId').value=o.supplierId||'';$('#supplierSearch').value=s?supplierDisplay(s):(o.pickupName||'');$('#pickupAddress').value=o.pickupAddress||'';$('#pickupNote').value=o.pickupNote||'';const p=state.projects.find(x=>x.id===o.projectId);$('#projectId').value=o.projectId||'';$('#projectSearch').value=p?.name||o.projectName||'';$('#dropAddress').value=o.dropAddress||'';$('#recipientId').innerHTML=recipientOptions(o.projectName,o.recipientId);$('#recipientName').value=o.recipientName||'';$('#recipientPhone').value=o.recipientPhone||'';$('#recipientEmail').value=o.recipientEmail||'';setCustomProjectMode(!p);$('#pickupFrom').value=o.pickupFrom||'';$('#pickupTo').value=o.pickupTo||'';$('#dropFrom').value=o.dropFrom||'';$('#dropTo').value=o.dropTo||'';$('#orderNote').value=o.note||'';$('#orderDialog').showModal();setTimeout(()=>$('#scheduleYear').focus(),30)}
window.editOrder=id=>openOrder(state.orders.find(x=>x.id===id));
$('#orderForm').onsubmit=e=>{e.preventDefault();if(!syncScheduleDate())return alert('Adj meg érvényes szállítási dátumot.');if(!syncDateParts('deadline',false))return alert('Adj meg érvényes kért szállítási határidőt, vagy hagyd üresen.');const old=state.orders.find(x=>x.id===$('#orderId').value),s=findSupplierByInput($('#supplierSearch').value),p=findProjectByInput($('#projectSearch').value),r=state.recipients.find(x=>x.id===$('#recipientId').value);const o={...old,id:old?.id||uid(),scheduleDate:$('#scheduleDate').value,vehicleId:$('#vehicleId').value||marioVehicle()?.id||'',orderNo:last5($('#orderNo').value),requestedDeadline:$('#deadline').value,supplierId:s?.id||'',pickupName:s?.name||$('#supplierSearch').value.trim()||old?.pickupName||'',pickupAddress:$('#pickupAddress').value,pickupNote:$('#pickupNote').value,projectId:p?.id||'',projectName:p?.name||$('#projectSearch').value.trim()||'Egyedi úticél',dropAddress:$('#dropAddress').value,recipientId:p?(r?.id||''):'',recipientName:$('#recipientName').value.trim()||r?.name||'',recipientPhone:$('#recipientPhone').value,recipientEmail:$('#recipientEmail').value,pickupFrom:$('#pickupFrom').value,pickupTo:$('#pickupTo').value,dropFrom:$('#dropFrom').value,dropTo:$('#dropTo').value,note:$('#orderNote').value,items:old?.items||[],completed:old?.completed||false,sequence:old?.sequence||999};const i=state.orders.findIndex(x=>x.id===o.id);if(i>=0)state.orders[i]=o;else state.orders.push(o);$('#orderDialog').close();save()}
$('#supplierSearch').oninput=()=>{const s=findSupplierByInput($('#supplierSearch').value);$('#supplierId').value=s?.id||'';if(s){$('#pickupAddress').value=s.address||'';$('#pickupNote').value=s.pickupNote||''}};
$('#projectSearch').oninput=()=>{const p=findProjectByInput($('#projectSearch').value);$('#projectId').value=p?.id||'';setCustomProjectMode(!p);if(p){$('#dropAddress').value=p.address||'';$('#recipientId').innerHTML=recipientOptions(p.name,p.defaultRecipientId);const r=state.recipients.find(x=>x.id===p.defaultRecipientId);$('#recipientName').value=r?.name||'';$('#recipientPhone').value=r?.phone||p.phone||'';$('#recipientEmail').value=r?.email||''}else{$('#recipientId').innerHTML='<option value="">Egyedi átvevő</option>'}};
$('#recipientId').onchange=()=>{const r=state.recipients.find(x=>x.id===$('#recipientId').value);$('#recipientName').value=r?.name||$('#recipientName').value||'';$('#recipientPhone').value=r?.phone||'';$('#recipientEmail').value=r?.email||''};
function deleteOne(id){const o=state.orders.find(x=>x.id===id);if(o&&confirm(`Törlöd ezt a fuvart?\n${o.orderNo} · ${o.projectName||o.dropAddress}`)){state.orders=state.orders.filter(x=>x.id!==id);save()}}
function deleteAll(){const date=selectedDate(),count=state.orders.filter(o=>o.scheduleDate===date).length;if(!count)return alert('Az aktuális napon nincs törölhető fuvar.');if(confirm(`Biztosan törölni szeretnéd a(z) ${date} nap összes (${count}) fuvarját?`)&&prompt('Írd be: TÖRLÉS')?.toUpperCase()==='TÖRLÉS'){state.orders=state.orders.filter(o=>o.scheduleDate!==date);save()}}
function ensureItemId(it){if(!it._id)it._id=uid();return it._id}
function openItems(id){const o=state.orders.find(x=>x.id===id);if(!o)return;currentItemsOrderId=id;(o.items||[]).forEach(ensureItemId);$('#itemsTitle').textContent=`${o.orderNo} · tételek`;$('#itemMovePanel').innerHTML=`<p><b>Nem kipipált tételek áthelyezése másik napra</b><br>A teljes dátum megadása után a program megerősítést kér, majd automatikusan áthelyezi a tételeket.</p><div class="date-parts"><input id="moveYear" inputmode="numeric" maxlength="4" placeholder="ÉÉÉÉ" aria-label="Áthelyezés éve"><span>–</span><input id="moveMonth" inputmode="numeric" maxlength="2" placeholder="HH" aria-label="Áthelyezés hónapja"><span>–</span><input id="moveDay" inputmode="numeric" maxlength="2" placeholder="NN" aria-label="Áthelyezés napja"></div>`;$('#itemsBody').innerHTML=(o.items||[]).map((it,i)=>`<div class="item-row ${it.received?'done':''}"><input type="checkbox" ${it.received?'checked':''} onchange="toggleItem('${id}',${i},this.checked)"><div><b class="item-name">${esc(it.name)}</b><br>${esc(it.code)} · ${esc(it.qty)} ${esc(it.unit)} ${it.longMaterial?'· hosszú szál':''}<label class="item-note-edit">Tétel megjegyzés<textarea placeholder="Nincs megjegyzés" oninput="updateItemNote('${id}',${i},this.value)">${esc(itemNoteValue(it))}</textarea></label></div></div>`).join('')||'<div class="notice">Nincs tétel.</div>';bindMoveDateParts();if(!$('#itemsDialog').open)$('#itemsDialog').showModal()}
function bindMoveDateParts(){const y=$('#moveYear'),m=$('#moveMonth'),d=$('#moveDay');[[y,4,m],[m,2,d],[d,2,null]].forEach(([el,max,next])=>{el.addEventListener('input',()=>{el.value=el.value.replace(/\D/g,'').slice(0,max);if(el.value.length===max&&next){next.focus();next.select()}if(y.value.length===4&&m.value.length===2&&d.value.length===2)setTimeout(moveUncheckedItemsFromDialog,0)});el.addEventListener('change',()=>{if(y.value&&m.value&&d.value)moveUncheckedItemsFromDialog()})})}
function moveUncheckedItemsFromDialog(){const o=state.orders.find(x=>x.id===currentItemsOrderId);if(!o)return;const y=$('#moveYear')?.value,m=$('#moveMonth')?.value,d=$('#moveDay')?.value;if(!y||!m||!d)return;const target=`${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`,dt=new Date(target+'T12:00:00');if(isNaN(dt)||localISO(dt)!==target)return alert('Érvénytelen dátum.');if(target===o.scheduleDate)return alert('Az új dátum nem lehet az eredeti nappal azonos.');const moving=(o.items||[]).filter(i=>!i.received);if(!moving.length)return alert('Nincs áthelyezhető, kipipálatlan tétel.');if(!confirm(`${moving.length} kipipálatlan tétel áthelyezése erre a napra: ${target}?`))return;let targetOrder=state.orders.find(x=>x.scheduleDate===target&&x.orderNo===o.orderNo&&x.vehicleId===o.vehicleId&&x.projectName===o.projectName&&x.pickupName===o.pickupName);if(!targetOrder){targetOrder={...o,id:uid(),scheduleDate:target,items:[],completed:false,completedAt:'',sequence:999,movedFromOrderId:o.id};state.orders.push(targetOrder)}moving.forEach(it=>{ensureItemId(it);it.received=false;targetOrder.items.push(it);state.backlog.push({id:uid(),sourceOrderId:o.id,targetOrderId:targetOrder.id,itemId:it._id,orderNo:o.orderNo,supplier:o.pickupName,projectName:o.projectName,code:it.code,name:it.name,itemNote:itemNoteValue(it),movedToDate:target,movedAt:new Date().toISOString()})});o.items=(o.items||[]).filter(i=>i.received);o.completed=o.items.length>0&&o.items.every(i=>i.received);$('#itemsDialog').close();save();alert(`Az áthelyezés elkészült: ${moving.length} tétel → ${target}.`)}
window.openItems=openItems;window.toggleItem=(id,i,val)=>{const o=state.orders.find(x=>x.id===id);if(!o||!o.items?.[i])return;o.items[i].received=val;o.completed=(o.items||[]).length>0&&o.items.every(x=>x.received);save(false);openItems(id);renderRoutes();renderDriver()};window.updateItemNote=(id,i,val)=>{const o=state.orders.find(x=>x.id===id);if(!o||!o.items?.[i])return;o.items[i].itemNote=val;const itemId=ensureItemId(o.items[i]);state.backlog.filter(b=>b.itemId===itemId).forEach(b=>b.itemNote=val);save(false);renderRoutes();renderOrders();renderBacklog()};
function backlogRecordData(b){const o=state.orders.find(x=>x.id===b.targetOrderId),it=o?.items?.find(i=>i._id===b.itemId);return{...b,orderNo:o?.orderNo||b.orderNo,supplier:o?.pickupName||b.supplier,projectName:o?.projectName||b.projectName,code:it?.code||b.code,name:it?.name||b.name,itemNote:it?itemNoteValue(it):b.itemNote,movedToDate:o?.scheduleDate||b.movedToDate,targetOrderId:o?.id||b.targetOrderId}}
function renderBacklog(){const q=norm($('#backlogSearch')?.value||''),rows=(state.backlog||[]).map(backlogRecordData).filter(b=>!q||norm(Object.values(b).join(' ')).includes(q));if($('#backlogBody'))$('#backlogBody').innerHTML=rows.map(b=>`<tr class="backlog-row" onclick="openBacklogResult('${b.targetOrderId}','${b.movedToDate}')"><td>${esc(b.orderNo)}</td><td>${esc(b.supplier)}</td><td>${esc(b.projectName)}</td><td>${esc(b.code)}</td><td>${esc(b.name)}</td><td>${esc(b.itemNote)}</td><td>${esc(b.movedToDate)}</td></tr>`).join('')||'<tr><td colspan="7">Nincs találat.</td></tr>'}
window.openBacklogResult=(id,date)=>{const o=state.orders.find(x=>x.id===id);$('#workDate').value=o?.scheduleDate||date;showPage('planner');render();setTimeout(()=>{const el=document.querySelector(`.bubble[data-id="${id}"]`);if(el){el.classList.add('search-highlight');el.scrollIntoView({behavior:'smooth',block:'center'});setTimeout(()=>el.classList.remove('search-highlight'),7000)}},180)};
function openCamera(id){const o=state.orders.find(x=>x.id===id);$('#cameraOrderId').value=id;$('#cameraTitle').textContent=`${o.orderNo} · szállítólevél`;$('#cameraPreview').innerHTML='';$('#cameraNote').value='';$('#cameraInput').value='';$('#cameraDialog').showModal()}
window.openCamera=openCamera;$('#cameraInput').onchange=e=>{$('#cameraPreview').innerHTML=[...e.target.files].map(f=>`<img src="${URL.createObjectURL(f)}">`).join('')};$('#cameraForm').onsubmit=e=>{e.preventDefault();const o=state.orders.find(x=>x.id===$('#cameraOrderId').value);o.deliveryReports=o.deliveryReports||[];o.deliveryReports.push({at:new Date().toISOString(),note:$('#cameraNote').value,photoCount:$('#cameraInput').files.length,hasAudio:!!audioBlob});$('#cameraDialog').close();save();alert('A fotó és megjegyzés helyben rögzítve.')};
function editVehicle(id){const v=state.vehicles.find(x=>x.id===id)||{};$('#vehicleTitle').textContent=v.id?'Jármű szerkesztése':'Új jármű';$('#editVehicleId').value=v.id||'';$('#driverName').value=v.driverName||'';$('#vehicleName').value=v.name||'';$('#vehicleType').innerHTML=VEHICLE_TYPES.map(t=>option(t,t,v.type)).join('');$('#homeCity').value=v.homeCity||'';$('#vehicleActive').checked=v.active!==false;$('#vehicleDialog').showModal()}
window.editVehicle=editVehicle;$('#vehicleForm').onsubmit=e=>{e.preventDefault();const id=$('#editVehicleId').value,v={id:id||uid(),driverName:$('#driverName').value,name:$('#vehicleName').value,type:$('#vehicleType').value,homeCity:$('#homeCity').value,active:$('#vehicleActive').checked};const i=state.vehicles.findIndex(x=>x.id===id);if(i>=0)state.vehicles[i]=v;else state.vehicles.push(v);$('#vehicleDialog').close();save()}
function masterFields(){if(masterType==='projects')return[['name','Projekt neve'],['address','Cím'],['defaultRecipientId','Alap átvevő']];if(masterType==='suppliers')return[['name','Cégnév'],['site','Telephely'],['address','Cím'],['pickupNote','Felrakói megjegyzés'],['isCentral','Központi telephely']];return[['project','Projekt'],['name','Átvevő neve'],['phone','Telefon'],['email','E-mail']]}
function openMaster(x={}){$('#masterTitle').textContent=x.id?'Szerkesztés':'Új adat';$('#editMasterId').value=x.id||'';$('#masterFields').innerHTML=masterFields().map(([k,l])=>{if(k==='defaultRecipientId')return`<label>${l}<select data-mf="${k}"><option value="">Nincs</option>${state.recipients.map(r=>option(r.id,`${r.name} · ${r.project}`,x[k])).join('')}</select></label>`;if(k==='isCentral')return`<label class="check"><input data-mf="${k}" type="checkbox" ${x[k]?'checked':''}> ${l}</label>`;return`<label>${l}<input data-mf="${k}" value="${esc(x[k]||'')}"></label>`}).join('');$('#masterDialog').showModal()}
window.editMaster=id=>openMaster(state[masterType].find(x=>x.id===id));window.deleteMaster=id=>{if(confirm('Törlöd?')){state[masterType]=state[masterType].filter(x=>x.id!==id);save()}};
$('#masterForm').onsubmit=e=>{e.preventDefault();const id=$('#editMasterId').value,obj={id:id||uid(),active:true};$$('[data-mf]').forEach(x=>obj[x.dataset.mf]=x.type==='checkbox'?x.checked:x.value.trim());if(masterType==='suppliers'&&obj.isCentral)state.suppliers.filter(s=>norm(s.name)===norm(obj.name)).forEach(s=>s.isCentral=false);const i=state[masterType].findIndex(x=>x.id===id);if(i>=0)state[masterType][i]={...state[masterType][i],...obj};else state[masterType].push(obj);$('#masterDialog').close();save()}
function headerMap(headers){const normalized=headers.map(norm),find=names=>normalized.findIndex(h=>names.map(norm).includes(h)),findExact=name=>normalized.findIndex(h=>h===norm(name));const supplierName=findExact('Ügyfél/raktár név');const map={doc:find(['Bizonylatszám']),topic:findExact('Témaszám név'),code:find(['Termék kód','Termékkód']),product:find(['Termék név','Terméknév']),supplier:supplierName,qty:find(['Tétel mennyiség']),unit:find(['M.e.']),deadline:find(['Kért szállítási határidő']),note:find(['Megjegyzés']),itemNote:(()=>{let i=normalized.findIndex(h=>h.includes('tetel')&&h.includes('megjegy'));if(i<0)i=normalized.findIndex(h=>h.includes('termek')&&h.includes('megjegy'));return i})(),date:findExact('Dátum'),driver:find(['Sofőr','Gépkocsivezető','Járművezető'])};if(map.date<0&&headers.length>=2)map.date=headers.length-2;if(map.driver<0&&headers.length>=1)map.driver=headers.length-1;return map}
function similarity(a,b){a=norm(a);b=norm(b);if(a===b)return 1;const aw=a.split(' '),bw=b.split(' '),common=aw.filter(x=>bw.includes(x)).length;return common/Math.max(aw.length,bw.length)}
function projectMatch(topic){const alias=state.aliases.projects[norm(topic)];if(alias)return state.projects.find(p=>p.id===alias);const scores=state.projects.map(p=>({p,s:similarity(topic,p.name)})).sort((a,b)=>b.s-a.s);return scores[0]?.s>=.75&&(!scores[1]||scores[0].s-scores[1].s>.15)?scores[0].p:null}
function supplierMatch(name){const alias=state.aliases.suppliers[norm(name)];if(alias)return state.suppliers.find(s=>s.id===alias);const exact=state.suppliers.filter(s=>norm(s.name)===norm(name));if(exact.length===1)return exact[0];if(exact.length>1){const central=exact.filter(s=>s.isCentral);return central.length===1?central[0]:null}const companies=[...new Set(state.suppliers.map(s=>s.name))].filter(n=>norm(name).includes(norm(n))||norm(n).includes(norm(name)));if(companies.length!==1)return null;const matches=state.suppliers.filter(s=>norm(s.name)===norm(companies[0]));if(matches.length===1)return matches[0];const central=matches.filter(s=>s.isCentral);return central.length===1?central[0]:null}
async function readExcel(file){const wb=XLSX.read(await file.arrayBuffer(),{type:'array',cellDates:true}),ws=wb.Sheets[wb.SheetNames[0]],rows=XLSX.utils.sheet_to_json(ws,{header:1,defval:''}),h=headerMap(rows[0].map(String));if(h.topic<0||h.supplier<0)return alert('Hiányzó kötelező SERPA oszlop: Témaszám név vagy Ügyfél/raktár név.');if(h.date<0||norm(rows[0][h.date])!=='datum')return alert('Nem található a SERPA Dátum oszlopa.');const g={};for(const r of rows.slice(1)){const date=dateVal(r[h.date]);if(!date)continue;const no=last5(r[h.doc]),topic=String(r[h.topic]||''),sup=String(r[h.supplier]||''),key=[date,no,topic,sup].join('|'),lr=longReason(r[h.product]);if(!g[key])g[key]={id:uid(),scheduleDate:date,vehicleId:'',sequence:999,orderNo:no,topicName:topic,pickupName:sup,pickupAddress:'',pickupNote:'',projectName:'',dropAddress:'',recipientName:'',recipientPhone:'',recipientEmail:'',requestedDeadline:dateVal(r[h.deadline]),note:h.note>=0?String(r[h.note]||''):'',items:[],longMaterialReason:''};if(lr)g[key].longMaterialReason=lr;g[key].items.push({code:String(r[h.code]||''),name:String(r[h.product]||''),qty:r[h.qty],unit:String(r[h.unit]||''),itemNote:h.itemNote>=0?String(r[h.itemNote]||''):'',longMaterial:!!lr,received:false});if(h.driver>=0&&norm(r[h.driver]).includes('martin'))g[key].markedMartin=true}importOrders=Object.values(g);importOrders.forEach(o=>{const p=projectMatch(o.topicName),s=supplierMatch(o.pickupName);if(p){o.projectId=p.id;o.projectName=p.name;o.dropAddress=p.address;const rec=state.recipients.find(r=>r.id===p.defaultRecipientId);if(rec){o.recipientId=rec.id;o.recipientName=rec.name;o.recipientPhone=rec.phone;o.recipientEmail=rec.email}}if(s){o.supplierId=s.id;o.pickupAddress=s.address||'';o.pickupNote=s.pickupNote||''}const dropSupplier=exactSupplierMaster(o.topicName);if(!p&&dropSupplier){o.projectName=o.topicName;o.dropAddress=dropSupplier.address||''}});const longCars=activeVehicles().filter(canCarryLong),martin=longCars.find(v=>norm(v.driverName).includes('martin'))||longCars[0];importOrders.forEach(o=>{if(o.markedMartin||o.longMaterialReason)o.vehicleId=martin?.id||''});$('#importPreview').textContent=`${importOrders.length} összesített rendelés. Bizonytalan/hiányos: ${importOrders.filter(needsReview).length}.`;$('#startReviewBtn').disabled=false}
function needsReview(o){return!o.projectId||!o.supplierId||!o.pickupAddress||!o.dropAddress||!o.vehicleId}
function startReview(){reviewQueue=importOrders.filter(needsReview);reviewIndex=0;if(!reviewQueue.length){finalizeImport();return}showReview()}
function showReview(){const o=reviewQueue[reviewIndex];$('#reviewTitle').textContent=`${o.orderNo} · ${o.topicName||'Egyedi'}`;$('#reviewCounter').textContent=`${reviewIndex+1} / ${reviewQueue.length}`;$('#reviewFields').innerHTML=`<label>Projekt<select id="rvProject" onchange="reviewProjectChanged()" class="${o.projectId?'':'review-error'}">${projectOptions(o.projectId)}</select></label><label>Lerakó cím<input id="rvDrop" class="${o.dropAddress?'':'review-error'}" value="${esc(o.dropAddress||'')}"></label><label>Beszállító<select id="rvSupplier" onchange="reviewSupplierChanged()" class="${o.supplierId?'':'review-error'}">${supplierOptions(o.supplierId)}</select></label><label>Felrakó cím<input id="rvPickup" class="${o.pickupAddress?'':'review-error'}" value="${esc(o.pickupAddress||'')}"></label><label>Jármű<select id="rvVehicle" class="${o.vehicleId?'':'review-error'}"><option value="">Később osztom ki</option>${activeVehicles().map(v=>option(v.id,`${v.driverName} · ${v.name}`,o.vehicleId)).join('')}</select></label><label>Fuvar megjegyzés<textarea id="rvNote">${esc(o.note||'')}</textarea></label>`;$('#reviewDialog').showModal()}
function reviewProjectChanged(){const p=state.projects.find(x=>x.id===$('#rvProject').value);if(!p)return;$('#rvDrop').value=p.address||'';const rec=state.recipients.find(r=>r.id===p.defaultRecipientId);if(rec){if($('#rvRecipient'))$('#rvRecipient').value=rec.id;if($('#rvPhone'))$('#rvPhone').value=rec.phone||''}}
function reviewSupplierChanged(){const s=state.suppliers.find(x=>x.id===$('#rvSupplier').value);if(!s)return;const c=centralSupplier(s.name)||s;$('#rvPickup').value=c.address||''}
function saveReview(){const o=reviewQueue[reviewIndex],p=state.projects.find(x=>x.id===$('#rvProject').value),s=state.suppliers.find(x=>x.id===$('#rvSupplier').value);o.projectId=p?.id||'';o.projectName=p?.name||o.topicName||'';o.dropAddress=$('#rvDrop').value;o.supplierId=s?.id||'';o.pickupName=s?.name||o.pickupName;o.pickupAddress=$('#rvPickup').value;o.vehicleId=$('#rvVehicle').value||marioVehicle()?.id||'';o.note=$('#rvNote').value;if(p)state.aliases.projects[norm(o.topicName)]=p.id;if(s)state.aliases.suppliers[norm(o.pickupName)]=s.id;reviewIndex++;if(reviewIndex>=reviewQueue.length){$('#reviewDialog').close();finalizeImport()}else showReview()}
function finalizeImport(){state.orders.push(...importOrders);const unassigned=importOrders.filter(o=>!o.vehicleId).length;importOrders=[];$('#importDialog').close();save();alert(`Import beillesztve. ${unassigned} fuvar kiosztatlan maradt. A „Fuvar szétosztása” gombbal automatikusan, földrajzi és terhelési szempontok szerint szétosztható.`)}
function safeFilePart(v=''){return String(v).trim().replace(/[\\/:*?"<>|]/g,'_')}
function buildDriverWorkbook(rows){const wb=XLSX.utils.book_new(),main=[['Jármű','Sorrend','Rendelésszám','Felrakó','Felrakó cím','Projekt','Lerakó cím','Átvevő','Telefon','Időablak','Megjegyzés','Tétel megjegyzések']];rows.forEach(o=>main.push([state.vehicles.find(v=>v.id===o.vehicleId)?.driverName||'',o.sequence,o.orderNo,o.pickupName,o.pickupAddress,o.projectName,o.dropAddress,o.recipientName,o.recipientPhone,[o.pickupFrom&&`F ${o.pickupFrom}-${o.pickupTo}`,o.dropFrom&&`L ${o.dropFrom}-${o.dropTo}`].filter(Boolean).join('; '),o.note,(o.items||[]).map((i,n)=>itemNoteValue(i)?`${n+1}. ${itemNoteValue(i)}`:'').filter(Boolean).join(' | ')]));const items=[['Rendelésszám','Termékkód','Termék név','Mennyiség','M.e.','Tétel megjegyzés','Átvéve']];rows.forEach(o=>(o.items||[]).forEach(i=>items.push([o.orderNo,i.code,i.name,i.qty,i.unit,itemNoteValue(i),i.received?'Igen':'Nem'])));XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(main),'Fuvarok');XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(items),'Tételek');return wb}
function exportExcel(){const date=selectedDate(),groups=activeVehicles().map(v=>({v,rows:state.orders.filter(o=>o.scheduleDate===date&&o.vehicleId===v.id)})).filter(g=>g.rows.length);if(!groups.length)return alert('Az aktuális napon nincs exportálható fuvar.');groups.forEach((g,i)=>setTimeout(()=>XLSX.writeFile(buildDriverWorkbook(g.rows),`${date}_${safeFilePart(g.v.driverName)}.xlsx`),i*350))}
function exportPdf(){const date=selectedDate(),groups=activeVehicles().map(v=>({v,rows:state.orders.filter(o=>o.scheduleDate===date&&o.vehicleId===v.id)})).filter(g=>g.rows.length);if(!groups.length)return alert('Az aktuális napon nincs exportálható fuvar.');groups.forEach((g,i)=>setTimeout(()=>{const{jsPDF}=window.jspdf,doc=new jsPDF({orientation:'landscape'});doc.text(`${g.v.driverName} fuvarjai - ${date}`,14,14);doc.autoTable({startY:20,head:[['#','Rendelés','Felrakó','Lerakó','Átvevő','Megjegyzés','Tétel megjegyzések']],body:g.rows.map(o=>[o.sequence,o.orderNo,`${o.pickupName}\n${o.pickupAddress}`,`${o.projectName}\n${o.dropAddress}`,`${o.recipientName||''}\n${o.recipientPhone||''}`,o.note||'',(o.items||[]).map((it,n)=>itemNoteValue(it)?`${n+1}. ${itemNoteValue(it)}`:'').filter(Boolean).join('\n')]),styles:{fontSize:6.5}});doc.save(`${date}_${safeFilePart(g.v.driverName)}.pdf`)},i*350))}
function exportMenu(){const t=prompt('Export: excel vagy pdf','excel');if(norm(t).startsWith('p'))exportPdf();else exportExcel()}
function backup(){const blob=new Blob([JSON.stringify(state,null,2)],{type:'application/json'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='fuvarszervezo-v11-telefonra.json';a.click()}
function restoreFile(file){const r=new FileReader();r.onload=()=>{try{const incoming=JSON.parse(r.result),mode=confirm('OK = összevonás, Mégse = teljes csere')?'merge':'replace';if(mode==='replace')state=incoming;else{state.orders=[...state.orders,...(incoming.orders||[]).filter(x=>!state.orders.some(y=>y.id===x.id))];state.projects=[...state.projects,...(incoming.projects||[]).filter(x=>!state.projects.some(y=>norm(y.name)===norm(x.name)))];state.suppliers=[...state.suppliers,...(incoming.suppliers||[]).filter(x=>!state.suppliers.some(y=>norm(y.name)===norm(x.name)&&norm(y.address)===norm(x.address)))];state.recipients=[...state.recipients,...(incoming.recipients||[]).filter(x=>!state.recipients.some(y=>norm(y.name)===norm(x.name)&&norm(y.project)===norm(x.project)))]}save();alert('Adatok betöltve.')}catch(e){alert('Hibás mentési fájl.')}};r.readAsText(file)}
function resetToStartPage(){const d=tomorrow();$('#workDate').value=d;$('#orderSearch').value='';$('#globalSearch').value='';$('#clearGlobalSearch').classList.add('hidden');showPage('planner');render()}
function handleGlobalSearch(){const q=$('#globalSearch').value;$('#clearGlobalSearch').classList.toggle('hidden',!q);if(!q){resetToStartPage();return}$('#orderSearch').value=q;showPage('orders');renderOrders()}
$('#recordStart').onclick=async()=>{try{const stream=await navigator.mediaDevices.getUserMedia({audio:true});audioChunks=[];mediaRecorder=new MediaRecorder(stream);mediaRecorder.ondataavailable=e=>e.data.size&&audioChunks.push(e.data);mediaRecorder.onstop=()=>{audioBlob=new Blob(audioChunks,{type:mediaRecorder.mimeType||'audio/webm'});$('#audioPreview').src=URL.createObjectURL(audioBlob);$('#audioPreview').classList.remove('hidden');$('#recordStatus').textContent='Felvétel elkészült.';stream.getTracks().forEach(t=>t.stop())};mediaRecorder.start();$('#recordStart').disabled=true;$('#recordStop').disabled=false;$('#recordStatus').textContent='Felvétel folyamatban…'}catch(e){alert(e.message)}};
$('#recordStop').onclick=()=>{if(mediaRecorder&&mediaRecorder.state!=='inactive')mediaRecorder.stop();$('#recordStart').disabled=false;$('#recordStop').disabled=true};
$$('.nav').forEach(n=>n.onclick=()=>showPage(n.dataset.page));$$('[data-close]').forEach(b=>b.onclick=()=>$('#'+b.dataset.close).close());$$('[data-master]').forEach(b=>b.onclick=()=>{$$('[data-master]').forEach(x=>x.classList.toggle('active',x===b));masterType=b.dataset.master;renderMasters()});
$('#prevDay').onclick=()=>{const d=new Date(selectedDate()+'T12:00:00');d.setDate(d.getDate()-1);$('#workDate').value=d.toISOString().slice(0,10);render()};$('#nextDay').onclick=()=>{const d=new Date(selectedDate()+'T12:00:00');d.setDate(d.getDate()+1);$('#workDate').value=d.toISOString().slice(0,10);render()};$('#workDate').onchange=render;
$('#importBtn').onclick=()=>$('#importDialog').showModal();$('#excelInput').onchange=e=>readExcel(e.target.files[0]).catch(err=>alert(err.message));$('#startReviewBtn').onclick=startReview;$('#reviewForm').onsubmit=e=>{e.preventDefault();saveReview()};$('#reviewSkipBtn').onclick=saveReview;
$('#quickAddBtn').onclick=()=>openOrder({scheduleDate:selectedDate(),items:[]});$('#addOrderBtn').onclick=()=>openOrder({scheduleDate:selectedDate(),items:[]});$('#balanceBtn').onclick=balance;$('#optimizeBtn').onclick=optimizeAll;$('#exportBtn').onclick=exportMenu;$('#deleteAllBtn').onclick=deleteAll;
$('#orderSearch').oninput=renderOrders;$('#globalSearch').oninput=handleGlobalSearch;$('#clearGlobalSearch').onclick=resetToStartPage;$('#globalSearch').onkeydown=e=>{if(e.key==='Escape'){e.preventDefault();resetToStartPage()}};$('#orderVehicleFilter').onchange=renderOrders;$('#addVehicleBtn').onclick=()=>editVehicle();$('#saveBaseBtn').onclick=()=>{state.settings.baseAddress=$('#baseAddress').value;save()};$('#driverVehicleSelect').onchange=renderDriver;$('#driverDate').onchange=renderDriver;
$('#backlogSearch').oninput=()=>{$('#clearBacklogSearch').classList.toggle('hidden',!$('#backlogSearch').value);renderBacklog()};$('#clearBacklogSearch').onclick=()=>{$('#backlogSearch').value='';$('#clearBacklogSearch').classList.add('hidden');renderBacklog()};$('#addMasterBtn').onclick=()=>openMaster();$('#masterSearch').oninput=renderMasters;$('#backupBtn').onclick=backup;$('#restoreInput').onchange=e=>e.target.files[0]&&restoreFile(e.target.files[0]);
window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();deferredPrompt=e;$('#installBtn').classList.remove('hidden')});$('#installBtn').onclick=async()=>{deferredPrompt?.prompt();deferredPrompt=null};
bindDateParts('schedule');bindDateParts('deadline');if('serviceWorker'in navigator)navigator.serviceWorker.register('sw.js').then(r=>r.update());load();$('#workDate').value=tomorrow();$('#driverDate').value=tomorrow();render();
/* ==================== V20 PATCH ==================== */
const V20_VERSION='V20';
function load(){
  const raw=localStorage.getItem(KEY);
  if(raw){
    state=JSON.parse(raw);
    state.aliases=state.aliases||{projects:{},suppliers:{}};
    state.vehicles=state.vehicles||defaultVehicles();
    state.orders=state.orders||[];
    state.backlog=state.backlog||[];
    state.failedTrips=state.failedTrips||[];
    state.routeStats=state.routeStats||{};
    state.geo=state.geo||{};
    state.orders.forEach(o=>(o.items||[]).forEach(it=>{ensureItemId(it);if(it.missingQty===undefined)it.missingQty=''}));
    refreshMasterData();save(false);return;
  }
  state.recipients=(SEED_DATA.recipients||[]).map((x,i)=>({...x,id:'r'+i}));
  state.vehicles=defaultVehicles();state.orders=[];state.backlog=[];state.failedTrips=[];state.routeStats={};
  refreshMasterData();save(false)
}

function render(){applyAfterFourRule();renderRoutes();renderOrders();renderBacklog();renderReports();renderMasters();renderVehicles();renderDriver();fillSelectors();$('#baseAddress').value=state.settings.baseAddress}

function bubbles(list){
  if(!list.length)return'<div class="notice">Nincs fuvar.</div>';
  return list.map((o,i)=>`<article class="bubble ${o.completed?'done':''}" data-id="${o.id}"><span class="drag">☷</span><h3>${i+1}. ${esc(o.orderNo)} · ${esc(o.projectName||'Egyedi úticél')}</h3><p><b>Felrakó:</b> ${esc(o.pickupName||'Nincs megadva')} · ${esc(o.pickupAddress||'')}</p><p><b>Lerakó:</b> ${esc(o.dropAddress||'Nincs megadva')}</p>${o.pickupNote?`<p><b>Felrakói megj.:</b> ${esc(o.pickupNote)}</p>`:''}${o.note?`<p><b>Fuvar megjegyzés:</b> ${esc(o.note)}</p>`:''}${itemNoteSummary(o)}<div class="tags"><span class="tag">${o.items?.length||0} tétel</span>${o.longMaterialReason?`<span class="tag long">${esc(o.longMaterialReason)}</span>`:''}${o.requestedDeadline?`<span class="tag ${o.scheduleDate>o.requestedDeadline?'warn':''}">${o.requestedDeadline}</span>`:''}</div><div class="bubble-actions"><button onclick="editOrder('${o.id}')">Szerkesztés</button><button onclick="openItems('${o.id}')">Tételek</button><button onclick="openCamera('${o.id}')">📷 Kamera</button><button class="failed-button" onclick="failOrderToTomorrow('${o.id}')">Nem teljesült – holnapra</button></div><button class="complete-button ${o.completed?'done':''}" onclick="toggleComplete('${o.id}')">${o.completed?'✓':'○'}</button><button class="trash" onclick="deleteOne('${o.id}')">🗑</button></article>`).join('')
}

async function drawMap(id){
  const map=maps[id],pts=[],date=selectedDate();
  if(!map)return;
  const base=await geo(state.settings.baseAddress);if(base)pts.push(base);
  for(const o of dayOrders(id).sort((a,b)=>(+a.sequence||999)-(+b.sequence||999))){
    const pickup=await geo(o.pickupAddress);
    if(pickup){pts.push(pickup);L.marker(pickup).addTo(map).bindPopup(`<b>Felrakó · ${esc(o.orderNo)}</b><br>${esc(o.pickupName||'')}<br>${esc(o.pickupAddress||'')}`)}
    const drop=await geo(o.dropAddress);
    if(drop){pts.push(drop);L.marker(drop).addTo(map).bindPopup(`<b>Lerakó · ${esc(o.orderNo)} · ${esc(o.projectName||'Egyedi úticél')}</b><br>${esc(o.dropAddress||'')}${o.recipientName?`<br>Átvevő: ${esc(o.recipientName)}`:''}${o.note?`<br>Megjegyzés: ${esc(o.note)}`:''}${itemNoteSummary(o).replaceAll('<p class="item-note-preview">','<br>').replaceAll('</p>','')}`)}
  }
  if(pts.length){
    const rr=await roadRoute(pts),coords=rr?rr.geometry.coordinates.map(c=>[c[1],c[0]]):pts;
    const line=L.polyline(coords,{weight:4}).addTo(map);map.fitBounds(line.getBounds(),{padding:[20,20]});
    state.routeStats=state.routeStats||{};state.routeStats[date]=state.routeStats[date]||{};
    state.routeStats[date][id]={km:rr?Math.round(rr.distance/100)/10:0,updatedAt:new Date().toISOString()};
    localStorage.setItem(KEY,JSON.stringify(state));
    const el=$('#summary-'+id);if(el&&rr)el.textContent=(el.textContent?el.textContent+' · ':'')+`${Math.round(rr.distance/100)/10} km`;
  }
}

function numericQty(v){const n=parseFloat(String(v??'').replace(',','.').replace(/[^0-9.-]/g,''));return Number.isFinite(n)?n:0}
function formatQty(v){return Number.isInteger(v)?String(v):String(Math.round(v*1000)/1000).replace('.',',')}
function openItems(id){
  const o=state.orders.find(x=>x.id===id);if(!o)return;currentItemsOrderId=id;(o.items||[]).forEach(ensureItemId);
  $('#itemsTitle').textContent=`${o.orderNo} · tételek`;
  $('#itemMovePanel').innerHTML=`<p><b>Nem kipipált tételek áthelyezése másik napra</b><br>Írd be a következő felvétel dátumát. A hiányzó darabszám kerül át; üres mező esetén a teljes rendelt mennyiség.</p><div class="date-parts"><input id="moveYear" inputmode="numeric" maxlength="4" placeholder="ÉÉÉÉ"><span>–</span><input id="moveMonth" inputmode="numeric" maxlength="2" placeholder="HH"><span>–</span><input id="moveDay" inputmode="numeric" maxlength="2" placeholder="NN"></div>`;
  $('#itemsBody').innerHTML=(o.items||[]).map((it,i)=>`<div class="item-row ${it.received?'done':''}"><input type="checkbox" ${it.received?'checked':''} onchange="toggleItem('${id}',${i},this.checked)"><div><b class="item-name">${esc(it.name)}</b><br>${esc(it.code)} · ${esc(it.qty)} ${esc(it.unit)} ${it.longMaterial?'· hosszú szál':''}<div class="missing-qty-wrap ${it.received?'hidden':''}"><label>Nem kaptam meg – mennyiség<input type="number" min="0" step="any" placeholder="Üres = teljes mennyiség" value="${esc(it.missingQty||'')}" oninput="updateMissingQty('${id}',${i},this.value)"></label><small>Áthelyezéskor ez a mennyiség kerül a következő napra és a Hátralékba.</small></div><label class="item-note-edit">Tétel megjegyzés<textarea placeholder="Nincs megjegyzés" oninput="updateItemNote('${id}',${i},this.value)">${esc(itemNoteValue(it))}</textarea></label></div></div>`).join('')||'<div class="notice">Nincs tétel.</div>';
  bindMoveDateParts();if(!$('#itemsDialog').open)$('#itemsDialog').showModal()
}
window.updateMissingQty=(id,i,val)=>{const o=state.orders.find(x=>x.id===id);if(!o?.items?.[i])return;o.items[i].missingQty=val;save(false)};
window.toggleItem=(id,i,val)=>{const o=state.orders.find(x=>x.id===id);if(!o||!o.items?.[i])return;o.items[i].received=val;if(val)o.items[i].missingQty='';o.completed=(o.items||[]).length>0&&o.items.every(x=>x.received);save(false);openItems(id);renderRoutes();renderDriver()};

function moveUncheckedItemsFromDialog(){
  const o=state.orders.find(x=>x.id===currentItemsOrderId);if(!o)return;
  const y=$('#moveYear')?.value,m=$('#moveMonth')?.value,d=$('#moveDay')?.value;if(!y||!m||!d)return;
  const target=`${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`,dt=new Date(target+'T12:00:00');
  if(isNaN(dt)||localISO(dt)!==target)return alert('Érvénytelen dátum.');if(target===o.scheduleDate)return alert('Az új dátum nem lehet az eredeti nappal azonos.');
  const moving=(o.items||[]).filter(i=>!i.received);if(!moving.length)return alert('Nincs áthelyezhető, kipipálatlan tétel.');
  for(const it of moving){const total=numericQty(it.qty),missing=it.missingQty===''||it.missingQty==null?total:numericQty(it.missingQty);if(missing<=0)return alert(`A(z) ${it.name} hiányzó mennyisége legyen nagyobb nullánál.`);if(total>0&&missing>total)return alert(`A(z) ${it.name} hiányzó mennyisége nem lehet több a rendelt mennyiségnél (${it.qty}).`)}
  if(!confirm(`${moving.length} kipipálatlan tétel hiányzó mennyiségének áthelyezése erre a napra: ${target}?`))return;
  let targetOrder=state.orders.find(x=>x.scheduleDate===target&&x.orderNo===o.orderNo&&x.vehicleId===o.vehicleId&&x.projectName===o.projectName&&x.pickupName===o.pickupName);
  if(!targetOrder){targetOrder={...o,id:uid(),scheduleDate:target,items:[],completed:false,completedAt:'',sequence:999,movedFromOrderId:o.id};state.orders.push(targetOrder)}
  const keep=[];
  (o.items||[]).forEach(it=>{
    if(it.received){keep.push(it);return}
    ensureItemId(it);const total=numericQty(it.qty),moveQty=it.missingQty===''||it.missingQty==null?total:numericQty(it.missingQty);
    const moved={...it,_id:uid(),qty:formatQty(moveQty),received:false,missingQty:''};targetOrder.items.push(moved);
    state.backlog.push({id:uid(),sourceOrderId:o.id,targetOrderId:targetOrder.id,itemId:moved._id,orderNo:o.orderNo,supplier:o.pickupName,projectName:o.projectName,code:it.code,name:it.name,itemNote:itemNoteValue(it),quantity:formatQty(moveQty),unit:it.unit,movedToDate:target,movedAt:new Date().toISOString()});
    if(total>0&&moveQty<total){it.qty=formatQty(total-moveQty);it.received=true;it.missingQty='';keep.push(it)}
  });
  o.items=keep;o.completed=o.items.length>0&&o.items.every(i=>i.received);$('#itemsDialog').close();save();alert(`A hiányzó mennyiségek átkerültek erre a napra: ${target}.`)
}
function backlogRecordData(b){const o=state.orders.find(x=>x.id===b.targetOrderId),it=o?.items?.find(i=>i._id===b.itemId);return{...b,orderNo:o?.orderNo||b.orderNo,supplier:o?.pickupName||b.supplier,projectName:o?.projectName||b.projectName,code:it?.code||b.code,name:it?.name||b.name,itemNote:it?itemNoteValue(it):b.itemNote,quantity:it?.qty||b.quantity||'',unit:it?.unit||b.unit||'',movedToDate:o?.scheduleDate||b.movedToDate,targetOrderId:o?.id||b.targetOrderId}}
function renderBacklog(){const q=norm($('#backlogSearch')?.value||''),rows=(state.backlog||[]).map(backlogRecordData).filter(b=>!q||norm(Object.values(b).join(' ')).includes(q));if($('#backlogBody'))$('#backlogBody').innerHTML=rows.map(b=>`<tr class="backlog-row" onclick="openBacklogResult('${b.targetOrderId}','${b.movedToDate}')"><td>${esc(b.orderNo)}</td><td>${esc(b.supplier)}</td><td>${esc(b.projectName)}</td><td>${esc(b.code)}</td><td>${esc(b.name)}</td><td>${esc(b.itemNote)}</td><td>${esc(b.quantity)} ${esc(b.unit)}</td><td>${esc(b.movedToDate)}</td></tr>`).join('')||'<tr><td colspan="8">Nincs találat.</td></tr>'}

window.failOrderToTomorrow=id=>{
  const o=state.orders.find(x=>x.id===id);if(!o)return;
  const d=new Date(o.scheduleDate+'T12:00:00');d.setDate(d.getDate()+1);const target=localISO(d);
  if(!confirm(`Biztosan meghiúsultként rögzíted a ${o.orderNo} rendelést, és a teljes fuvart áthelyezed erre a napra: ${target}?`))return;
  state.failedTrips=state.failedTrips||[];
  state.failedTrips.push({id:uid(),sourceOrderId:o.id,orderNo:o.orderNo,vehicleId:o.vehicleId,driverName:state.vehicles.find(v=>v.id===o.vehicleId)?.driverName||'',originalDate:o.scheduleDate,movedToDate:target,createdAt:new Date().toISOString()});
  const moved={...o,id:uid(),scheduleDate:target,completed:false,completedAt:'',sequence:999,failedMovedFrom:o.id,items:(o.items||[]).map(it=>({...it,_id:uid(),received:false}))};
  state.orders=state.orders.filter(x=>x.id!==id);state.orders.push(moved);save();alert(`A fuvar meghiúsultként rögzítve és áthelyezve: ${target}.`)
};

function reportMonthDefault(){return today().slice(0,7)}
function renderReports(){
  if(!$('#reportBody'))return;const month=$('#reportMonth')?.value||reportMonthDefault();if($('#reportMonth')&&!$('#reportMonth').value)$('#reportMonth').value=month;
  const vehicles=state.vehicles.filter(v=>['mario','patrik','martin'].some(n=>norm(v.driverName).includes(n))||v.active);
  const rows=vehicles.map(v=>{
    const completed=state.orders.filter(o=>o.vehicleId===v.id&&o.scheduleDate.startsWith(month)&&o.completed);
    const pickupKeys=new Set(completed.map(o=>`${o.scheduleDate}|${norm(o.pickupAddress||o.pickupName)}`).filter(x=>x.split('|')[1]));
    const km=Object.entries(state.routeStats||{}).filter(([date])=>date.startsWith(month)).reduce((sum,[,byVehicle])=>sum+(+byVehicle?.[v.id]?.km||0),0);
    const failed=(state.failedTrips||[]).filter(f=>f.vehicleId===v.id&&f.originalDate?.startsWith(month)).length;
    return{driver:v.driverName,km:Math.round(km*10)/10,completed:completed.length,pickups:pickupKeys.size,failed}
  });
  const total=rows.reduce((a,r)=>({driver:'Havi összesen',km:a.km+r.km,completed:a.completed+r.completed,pickups:a.pickups+r.pickups,failed:a.failed+r.failed}),{km:0,completed:0,pickups:0,failed:0});
  $('#reportBody').innerHTML=[...rows,total].map((r,i)=>`<tr ${i===rows.length?'class="report-total"':''}><td><b>${esc(r.driver)}</b></td><td>${formatQty(Math.round(r.km*10)/10)} km</td><td>${r.completed}</td><td>${r.pickups}</td><td>${r.failed}</td></tr>`).join('')
}

(function installV20Handlers(){
  const oldSubmit=$('#orderForm').onsubmit;
  $('#orderForm').onsubmit=e=>{
    const id=$('#orderId').value,old=state.orders.find(x=>x.id===id),oldPickup=old?.pickupAddress||'',oldDrop=old?.dropAddress||'';
    oldSubmit(e);
    const saved=state.orders.find(x=>x.id===(id||state.orders[state.orders.length-1]?.id));
    if(oldPickup&&saved&&oldPickup!==saved.pickupAddress)delete state.geo[oldPickup];
    if(oldDrop&&saved&&oldDrop!==saved.dropAddress)delete state.geo[oldDrop];
    if(saved){delete state.geo[saved.pickupAddress];delete state.geo[saved.dropAddress]}
    localStorage.setItem(KEY,JSON.stringify(state));setTimeout(()=>{initMaps();renderReports()},50)
  };
  $('#brandHome').onclick=resetToStartPage;
  $('#reportMonth').onchange=renderReports;$('#refreshReportBtn').onclick=renderReports;
})();

/* ==================== V21 PATCH ==================== */
const V21_VERSION='V21';

function validMoveTargetFromInputs(prefix='move'){
  const y=$(`#${prefix}Year`)?.value||'',m=$(`#${prefix}Month`)?.value||'',d=$(`#${prefix}Day`)?.value||'';
  if(y.length!==4||m.length<1||d.length<1)return '';
  const target=`${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`,dt=new Date(target+'T12:00:00');
  return !isNaN(dt)&&localISO(dt)===target?target:'';
}
function bindV21MoveDateParts(){
  const y=$('#moveYear'),m=$('#moveMonth'),d=$('#moveDay'),btn=$('#moveItemsBtn');
  if(!y||!m||!d||!btn)return;
  const update=()=>{btn.disabled=!validMoveTargetFromInputs('move')};
  [[y,4,m],[m,2,d],[d,2,null]].forEach(([el,max,next])=>{
    el.addEventListener('input',()=>{el.value=el.value.replace(/\D/g,'').slice(0,max);if(el.value.length===max&&next){next.focus();next.select()}update()});
    el.addEventListener('change',update);
  });
  btn.onclick=moveUncheckedItemsFromDialog;
  update();
}
function openItems(id){
  const o=state.orders.find(x=>x.id===id);if(!o)return;currentItemsOrderId=id;(o.items||[]).forEach(ensureItemId);
  $('#itemsTitle').textContent=`${o.orderNo} · tételek`;
  $('#itemMovePanel').innerHTML=`<div class="move-controls"><div class="date-parts"><input id="moveYear" inputmode="numeric" maxlength="4" placeholder="ÉÉÉÉ" aria-label="Áthelyezés éve"><span>–</span><input id="moveMonth" inputmode="numeric" maxlength="2" placeholder="HH" aria-label="Áthelyezés hónapja"><span>–</span><input id="moveDay" inputmode="numeric" maxlength="2" placeholder="NN" aria-label="Áthelyezés napja"></div><button id="moveItemsBtn" class="move-items-btn" type="button" disabled>Áthelyezés</button></div>`;
  $('#itemsBody').innerHTML=(o.items||[]).map((it,i)=>`<div class="item-row ${it.received?'done':''}"><input type="checkbox" ${it.received?'checked':''} onchange="toggleItem('${id}',${i},this.checked)"><div><b class="item-name">${esc(it.name)}</b><br>${esc(it.code)} · ${esc(it.qty)} ${esc(it.unit)} ${it.longMaterial?'· hosszú szál':''}<div class="missing-qty-wrap ${it.received?'hidden':''}"><input class="missing-qty-input" type="number" min="0" step="any" aria-label="Nem kapott mennyiség" value="${esc(it.missingQty||'')}" oninput="updateMissingQty('${id}',${i},this.value)"></div><label class="item-note-edit">Tétel megjegyzés<textarea placeholder="Nincs megjegyzés" oninput="updateItemNote('${id}',${i},this.value)">${esc(itemNoteValue(it))}</textarea></label></div></div>`).join('')||'<div class="notice">Nincs tétel.</div>';
  bindV21MoveDateParts();if(!$('#itemsDialog').open)$('#itemsDialog').showModal()
}
window.openItems=openItems;

function moveUncheckedItemsFromDialog(){
  const o=state.orders.find(x=>x.id===currentItemsOrderId);if(!o)return;
  const target=validMoveTargetFromInputs('move');if(!target)return alert('Előbb adj meg érvényes áthelyezési dátumot az ablak fejlécében.');
  if(target===o.scheduleDate)return alert('Az új dátum nem lehet az eredeti nappal azonos.');
  const moving=(o.items||[]).filter(i=>!i.received);if(!moving.length)return alert('Nincs áthelyezhető, kipipálatlan tétel.');
  for(const it of moving){const total=numericQty(it.qty),missing=it.missingQty===''||it.missingQty==null?total:numericQty(it.missingQty);if(missing<=0)return alert(`A(z) ${it.name} hiányzó mennyisége legyen nagyobb nullánál.`);if(total>0&&missing>total)return alert(`A(z) ${it.name} hiányzó mennyisége nem lehet több a rendelt mennyiségnél (${it.qty}).`)}
  if(!confirm(`${moving.length} kipipálatlan tétel hiányzó mennyiségének áthelyezése erre a napra: ${target}?`))return;
  let targetOrder=state.orders.find(x=>x.scheduleDate===target&&x.orderNo===o.orderNo&&x.vehicleId===o.vehicleId&&x.projectName===o.projectName&&x.pickupName===o.pickupName&&x.movedFromOrderId===o.id);
  if(!targetOrder){targetOrder={...o,id:uid(),scheduleDate:target,items:[],completed:false,completedAt:'',sequence:999,movedFromOrderId:o.id};state.orders.push(targetOrder)}
  const keep=[];
  (o.items||[]).forEach(it=>{
    if(it.received){keep.push(it);return}
    ensureItemId(it);const total=numericQty(it.qty),moveQty=it.missingQty===''||it.missingQty==null?total:numericQty(it.missingQty);
    const moved={...it,_id:uid(),qty:formatQty(moveQty),received:false,missingQty:''};targetOrder.items.push(moved);
    state.backlog.push({id:uid(),sourceOrderId:o.id,targetOrderId:targetOrder.id,itemId:moved._id,orderNo:o.orderNo,supplier:o.pickupName,projectName:o.projectName,code:it.code,name:it.name,itemNote:itemNoteValue(it),quantity:formatQty(moveQty),unit:it.unit,movedToDate:target,movedAt:new Date().toISOString()});
    if(total>0&&moveQty<total){it.qty=formatQty(total-moveQty);it.received=true;it.missingQty='';keep.push(it)}
  });
  o.items=keep;o.completed=o.items.length>0&&o.items.every(i=>i.received);$('#itemsDialog').close();save();alert(`A hiányzó mennyiségek átkerültek a(z) ${target} napra és a Hátralék menübe.`)
}

function backlogDateEditor(b){
  const [y,m,d]=(b.movedToDate||'---').split('-');
  return `<div class="backlog-date-editor" onclick="event.stopPropagation()"><input id="by-${b.id}" inputmode="numeric" maxlength="4" value="${esc(y||'')}" placeholder="ÉÉÉÉ"><input id="bm-${b.id}" inputmode="numeric" maxlength="2" value="${esc(m||'')}" placeholder="HH"><input id="bd-${b.id}" inputmode="numeric" maxlength="2" value="${esc(d||'')}" placeholder="NN"><button type="button" onclick="rescheduleBacklog('${b.id}')">Ütemezés</button></div>`;
}
function renderBacklog(){
  const q=norm($('#backlogSearch')?.value||''),rows=(state.backlog||[]).map(backlogRecordData).filter(b=>!q||norm(Object.values(b).join(' ')).includes(q));
  if($('#backlogBody'))$('#backlogBody').innerHTML=rows.map(b=>`<tr class="backlog-row" onclick="openBacklogResult('${b.targetOrderId}','${b.movedToDate}')"><td>${esc(b.orderNo)}</td><td>${esc(b.supplier)}</td><td>${esc(b.projectName)}</td><td>${esc(b.code)}</td><td>${esc(b.name)}</td><td>${esc(b.itemNote)}</td><td>${esc(b.quantity)} ${esc(b.unit)}</td><td>${backlogDateEditor(b)}</td></tr>`).join('')||'<tr><td colspan="8">Nincs találat.</td></tr>';
  rows.forEach(b=>bindBacklogDateInputs(b.id));
}
function bindBacklogDateInputs(id){
  const y=$(`#by-${id}`),m=$(`#bm-${id}`),d=$(`#bd-${id}`);if(!y||!m||!d)return;
  [[y,4,m],[m,2,d],[d,2,null]].forEach(([el,max,next])=>el.addEventListener('input',()=>{el.value=el.value.replace(/\D/g,'').slice(0,max);if(el.value.length===max&&next){next.focus();next.select()}}));
}
window.rescheduleBacklog=id=>{
  const b=state.backlog.find(x=>x.id===id);if(!b)return;
  const y=$(`#by-${id}`)?.value||'',m=$(`#bm-${id}`)?.value||'',d=$(`#bd-${id}`)?.value||'';
  const target=`${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`,dt=new Date(target+'T12:00:00');
  if(y.length!==4||!m||!d||isNaN(dt)||localISO(dt)!==target)return alert('Adj meg érvényes dátumot ÉÉÉÉ–HH–NN formában.');
  const o=state.orders.find(x=>x.id===b.targetOrderId);if(!o)return alert('A hátralékhoz tartozó fuvar nem található.');
  if(o.scheduleDate===target)return alert('A fuvar már ezen a napon szerepel.');
  if(!confirm(`A teljes kapcsolódó fuvar áthelyezése erre a napra: ${target}?`))return;
  o.scheduleDate=target;
  (state.backlog||[]).filter(x=>x.targetOrderId===o.id).forEach(x=>x.movedToDate=target);
  save();renderBacklog();alert(`A hátralék és a hozzá tartozó fuvarbuborék átkerült a(z) ${target} napra.`)
};

function deleteEveryOrder(){
  const count=(state.orders||[]).length;if(!count)return alert('Nincs törölhető fuvar.');
  if(!confirm(`Biztosan törölni szeretnéd az összes, minden napon szereplő ${count} fuvart?`))return;
  if(prompt('Ez nem vonható vissza. Írd be pontosan: TÖRLÉS')?.trim().toUpperCase()!=='TÖRLÉS')return alert('A törlés megszakadt.');
  state.orders=[];state.backlog=[];state.failedTrips=[];state.routeStats={};state.geo={};
  save();alert('Minden fuvar, hátralék és meghiúsult fuvar törölve. A törzsadatok megmaradtak.')
}
(function installV21Handlers(){
  const btn=$('#deleteEveryOrderBtn');if(btn)btn.onclick=deleteEveryOrder;
  renderBacklog();
})();

/* ==================== V22 PATCH ==================== */
const V22_VERSION='V22';

function masterHeaderKey(v=''){return norm(v).replace(/\s+/g,' ')}
function sheetRowsByNames(wb,names){
  const target=wb.SheetNames.find(n=>names.some(x=>norm(n)===norm(x)))||wb.SheetNames.find(n=>names.some(x=>norm(n).includes(norm(x))));
  return target?XLSX.utils.sheet_to_json(wb.Sheets[target],{defval:''}):[];
}
function valueByHeaders(row,names){
  const entries=Object.entries(row);for(const name of names){const hit=entries.find(([k])=>masterHeaderKey(k)===masterHeaderKey(name));if(hit)return String(hit[1]??'').trim()}
  return '';
}
function exportMasterDataExcel(){
  const wb=XLSX.utils.book_new();
  const projects=[['Projekt neve','Cím','Alapértelmezett átvevő']];
  (state.projects||[]).slice().sort((a,b)=>String(a.name).localeCompare(String(b.name),'hu')).forEach(p=>projects.push([p.name||'',p.address||'',state.recipients.find(r=>r.id===p.defaultRecipientId)?.name||p.receiver||'']));
  const suppliers=[['Cégnév','Cím','Felrakói megjegyzés','Központi telephely']];
  (state.suppliers||[]).slice().sort((a,b)=>String(a.name).localeCompare(String(b.name),'hu')).forEach(s=>suppliers.push([s.name||'',s.address||'',s.pickupNote||'',s.isCentral?'Igen':'Nem']));
  const recipients=[['Név','Projekt','Telefon','E-mail']];
  (state.recipients||[]).slice().sort((a,b)=>String(a.name).localeCompare(String(b.name),'hu')).forEach(r=>recipients.push([r.name||'',r.project||'',r.phone||'',r.email||'']));
  const vehicles=[['Sofőr neve','Jármű neve / rendszám','Járműtípus','Indulási település','Aktív']];
  (state.vehicles||[]).forEach(v=>vehicles.push([v.driverName||'',v.name||'',v.type||'',v.homeCity||'',v.active!==false?'Igen':'Nem']));
  XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(projects),'Projektek');
  XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(suppliers),'Beszállítók');
  XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(recipients),'Átvevők');
  XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(vehicles),'Autók');
  XLSX.writeFile(wb,`torzsadatok_${today()}.xlsx`);
}
function upsertByName(list,name,create,update){
  const existing=list.find(x=>norm(x.name)===norm(name));
  if(existing){update(existing);return 'updated'}list.push(create());return 'created';
}
async function importMasterDataExcel(file){
  try{
    const wb=XLSX.read(await file.arrayBuffer(),{type:'array',cellDates:true});
    const counts={created:0,updated:0,skipped:0};
    const suppliers=sheetRowsByNames(wb,['Beszállítók','Beszállítók törzs','Suppliers']);
    for(const row of suppliers){
      const name=valueByHeaders(row,['Cégnév','Cég neve','Beszállító','Név']);const address=valueByHeaders(row,['Cím','Telephely címe','Szállítási cím']);
      if(!name){counts.skipped++;continue}
      const result=upsertByName(state.suppliers,name,()=>({id:uid(),name,address,pickupNote:valueByHeaders(row,['Felrakói megjegyzés','Megjegyzés']),isCentral:/^(igen|i|true|1)$/i.test(valueByHeaders(row,['Központi telephely','Központi']))}),s=>{s.address=address;s.pickupNote=valueByHeaders(row,['Felrakói megjegyzés','Megjegyzés'])||s.pickupNote||'';const c=valueByHeaders(row,['Központi telephely','Központi']);if(c)s.isCentral=/^(igen|i|true|1)$/i.test(c)});counts[result]++;
    }
    const projects=sheetRowsByNames(wb,['Projektek','Projects']);
    for(const row of projects){
      const name=valueByHeaders(row,['Projekt neve','Projekt','Név']);if(!name){counts.skipped++;continue}const address=valueByHeaders(row,['Cím','Projekt címe']);const receiver=valueByHeaders(row,['Alapértelmezett átvevő','Átvevő']);
      const result=upsertByName(state.projects,name,()=>({id:uid(),name,address,defaultRecipientId:state.recipients.find(r=>norm(r.name)===norm(receiver))?.id||''}),p=>{p.address=address;if(receiver)p.defaultRecipientId=state.recipients.find(r=>norm(r.name)===norm(receiver))?.id||p.defaultRecipientId||''});counts[result]++;
    }
    const recipients=sheetRowsByNames(wb,['Átvevők','Recipients']);
    for(const row of recipients){
      const name=valueByHeaders(row,['Név','Átvevő neve']);const project=valueByHeaders(row,['Projekt','Projekt neve']);if(!name){counts.skipped++;continue}
      let r=state.recipients.find(x=>norm(x.name)===norm(name)&&norm(x.project||'')===norm(project||''));
      if(r){r.phone=valueByHeaders(row,['Telefon','Telefonszám']);r.email=valueByHeaders(row,['E-mail','Email']);counts.updated++}else{state.recipients.push({id:uid(),name,project,phone:valueByHeaders(row,['Telefon','Telefonszám']),email:valueByHeaders(row,['E-mail','Email'])});counts.created++}
    }
    const vehicles=sheetRowsByNames(wb,['Autók','Járművek','Vehicles']);
    for(const row of vehicles){
      const driverName=valueByHeaders(row,['Sofőr neve','Fuvaros neve','Sofőr']);const vehicleName=valueByHeaders(row,['Jármű neve / rendszám','Jármű neve','Rendszám']);if(!driverName&&!vehicleName){counts.skipped++;continue}
      let v=state.vehicles.find(x=>(vehicleName&&norm(x.name)===norm(vehicleName))||(!vehicleName&&norm(x.driverName)===norm(driverName)));
      const activeText=valueByHeaders(row,['Aktív']);const active=activeText?/^(igen|i|true|1)$/i.test(activeText):true;
      if(v){v.driverName=driverName||v.driverName;v.name=vehicleName||v.name;v.type=valueByHeaders(row,['Járműtípus','Típus'])||v.type;v.homeCity=valueByHeaders(row,['Indulási település','Település'])||v.homeCity;v.active=active;counts.updated++}else{state.vehicles.push({id:uid(),driverName,name:vehicleName||driverName,type:valueByHeaders(row,['Járműtípus','Típus'])||VEHICLE_TYPES[0],homeCity:valueByHeaders(row,['Indulási település','Település']),active});counts.created++}
    }
    state.masterDataVersion='v22-excel';state.aliases=state.aliases||{projects:{},suppliers:{}};
    save();alert(`Törzsadat import kész. Új: ${counts.created}, frissítve: ${counts.updated}, kihagyva: ${counts.skipped}.`)
  }catch(e){console.error(e);alert('A törzsadat Excel nem olvasható. Ellenőrizd a munkalapok és oszlopok nevét.')}
}

/* A SERPA cégnévhez kizárólag a törzsben tárolt címet rendeljük hozzá; a SERPA név változatlan marad. */
function exactSupplierMaster(name){
  const matches=(state.suppliers||[]).filter(s=>norm(s.name)===norm(name));
  if(matches.length===1)return matches[0];
  return matches.find(s=>s.isCentral)||matches.find(s=>s.address)||null;
}
supplierMatch=exactSupplierMaster;

(function installV22Handlers(){
  const exportBtn=$('#exportMastersBtn'),input=$('#masterExcelInput');
  if(exportBtn)exportBtn.onclick=exportMasterDataExcel;
  if(input)input.onchange=async()=>{const file=input.files?.[0];if(file)await importMasterDataExcel(file);input.value=''};
})();

/* ==================== V23 PATCH ==================== */
const V23_VERSION='V23';

function supplierLocations(name=''){
  return (state.suppliers||[]).filter(s=>norm(s.name)===norm(name)).sort((a,b)=>(b.isCentral?1:0)-(a.isCentral?1:0)||String(a.address||'').localeCompare(String(b.address||''),'hu'));
}
function preferredSupplierLocation(name=''){
  const list=supplierLocations(name);
  return list.find(s=>s.isCentral)||list.find(s=>norm(s.pickupNote).includes('kozpont'))||list[0]||null;
}
function exactProjectMaster(name=''){
  return (state.projects||[]).find(p=>norm(p.name)===norm(name))||null;
}
function syncOrderFromMasters(o,{forceSupplier=false,forceProject=false}={}){
  if(!o)return {supplier:false,project:false};
  const supplierName=o.pickupName||'';
  const supplierList=supplierLocations(supplierName);
  let supplier=supplierList.find(s=>s.id===o.supplierId)||null;
  if(!supplier||forceSupplier){
    const currentStillExists=supplierList.find(s=>norm(s.address)===norm(o.pickupAddress));
    supplier=currentStillExists||preferredSupplierLocation(supplierName);
  }
  if(supplier){
    o.supplierId=supplier.id;
    o.pickupAddress=supplier.address||'';
    o.pickupNote=supplier.pickupNote||'';
    o.missingSupplierMaster=false;
  }else{
    o.missingSupplierMaster=true;
    if(forceSupplier)o.pickupAddress='';
  }
  const projectName=o.projectName&&o.projectName!=='Egyedi úticél'?o.projectName:(o.topicName||'');
  const project=exactProjectMaster(projectName);
  if(project){
    o.projectId=project.id;
    o.projectName=project.name;
    o.dropAddress=project.address||'';
    o.missingProjectMaster=false;
  }else{
    o.missingProjectMaster=true;
    if(forceProject&&o.projectName!=='Egyedi úticél')o.dropAddress='';
  }
  return {supplier:!!supplier,project:!!project};
}
async function resyncAllMasterData(showMessage=true){
  let supplierMissing=0,projectMissing=0,changed=0;
  for(const o of state.orders||[]){
    const before=[o.supplierId,o.pickupAddress,o.projectId,o.dropAddress].join('|');
    const result=syncOrderFromMasters(o,{forceSupplier:true,forceProject:true});
    if(!result.supplier)supplierMissing++;
    if(!result.project)projectMissing++;
    const after=[o.supplierId,o.pickupAddress,o.projectId,o.dropAddress].join('|');
    if(before!==after)changed++;
  }
  state.geo={};
  localStorage.setItem(KEY,JSON.stringify(state));
  render();
  if(showMessage)alert(`Újraszinkronizálás kész. Frissített fuvarok: ${changed}. Hiányzó beszállítói cím: ${supplierMissing}. Hiányzó projektcím: ${projectMissing}.`);
}
window.resyncAllMasterData=resyncAllMasterData;

function supplierAddressSelect(o){
  const list=supplierLocations(o.pickupName);
  if(list.length<=1)return `<span class="master-address-value">${esc(o.pickupAddress||'Nincs megadva')}</span>`;
  const opts=list.map(s=>option(s.id,`${s.isCentral||norm(s.pickupNote).includes('kozpont')?'★ Központ · ':''}${s.address||'Cím nélkül'}${s.pickupNote?` · ${s.pickupNote}`:''}`,o.supplierId)).join('');
  return `<select class="supplier-location-select" onchange="changeSupplierLocation('${o.id}',this.value)">${opts}</select>`;
}
window.changeSupplierLocation=(orderId,supplierId)=>{
  const o=state.orders.find(x=>x.id===orderId),s=state.suppliers.find(x=>x.id===supplierId);if(!o||!s)return;
  const old=o.pickupAddress;o.supplierId=s.id;o.pickupName=s.name;o.pickupAddress=s.address||'';o.pickupNote=s.pickupNote||'';o.missingSupplierMaster=false;
  if(old)delete state.geo[old];delete state.geo[o.pickupAddress];save();setTimeout(initMaps,50);
};
function masterWarnings(o){
  const w=[];
  if(o.missingSupplierMaster||!o.pickupAddress)w.push('<div class="master-warning">⚠ Hiányzó beszállítói cím – állítsd be manuálisan.</div>');
  if(o.missingProjectMaster||!o.dropAddress)w.push('<div class="master-warning">⚠ Hiányzó projektcím – állítsd be manuálisan.</div>');
  return w.join('');
}
function bubbles(list){
  if(!list.length)return'<div class="notice">Nincs fuvar.</div>';
  return list.map((o,i)=>`<article class="bubble ${o.completed?'done':''}" data-id="${o.id}"><span class="drag">☷</span><h3>${i+1}. ${esc(o.orderNo)} · ${esc(o.projectName||'Egyedi úticél')}</h3>${masterWarnings(o)}<div class="master-highlight"><b>Felrakó:</b> ${esc(o.pickupName||'Nincs megadva')}<br>${supplierAddressSelect(o)}</div><div class="master-highlight drop-highlight"><b>Lerakó:</b> ${esc(o.projectName||'Egyedi úticél')}<br><span class="master-address-value">${esc(o.dropAddress||'Nincs megadva')}</span></div>${o.pickupNote?`<p><b>Felrakói megj.:</b> ${esc(o.pickupNote)}</p>`:''}${o.note?`<p><b>Fuvar megjegyzés:</b> ${esc(o.note)}</p>`:''}${itemNoteSummary(o)}<div class="tags"><span class="tag">${o.items?.length||0} tétel</span>${o.longMaterialReason?`<span class="tag long">${esc(o.longMaterialReason)}</span>`:''}${o.requestedDeadline?`<span class="tag ${o.scheduleDate>o.requestedDeadline?'warn':''}">${o.requestedDeadline}</span>`:''}</div><div class="bubble-actions"><button onclick="editOrder('${o.id}')">Szerkesztés</button><button onclick="openItems('${o.id}')">Tételek</button><button onclick="openCamera('${o.id}')">📷 Kamera</button><button class="failed-button" onclick="failOrderToTomorrow('${o.id}')">Nem teljesült – holnapra</button></div><button class="complete-button ${o.completed?'done':''}" onclick="toggleComplete('${o.id}')">${o.completed?'✓':'○'}</button><button class="trash" onclick="deleteOne('${o.id}')">🗑</button></article>`).join('');
}

async function drawMap(id){
  const map=maps[id],pts=[],date=selectedDate();if(!map)return;
  const v=state.vehicles.find(x=>x.id===id),home=await vehicleHome(v||{});if(home)pts.push(home);
  for(const o of dayOrders(id).sort((a,b)=>(+a.sequence||999)-(+b.sequence||999))){
    const pickup=await geo(o.pickupAddress),drop=await geo(o.dropAddress);
    if(pickup){pts.push(pickup);L.marker(pickup,{title:`Felrakó: ${o.pickupName||''}`}).addTo(map).bindPopup(`<b>Felrakó · ${esc(o.orderNo)}</b><br>${esc(o.pickupName||'')}<br>${esc(o.pickupAddress||'')}`)}
    if(drop){pts.push(drop);L.marker(drop,{title:`Lerakó: ${o.projectName||''}`}).addTo(map).bindPopup(`<b>Lerakó · ${esc(o.orderNo)} · ${esc(o.projectName||'Egyedi úticél')}</b><br>${esc(o.dropAddress||'')}${o.recipientName?`<br>Átvevő: ${esc(o.recipientName)}`:''}`)}
  }
  if(home)pts.push(home);
  if(pts.length){const rr=await roadRoute(pts),coords=rr?rr.geometry.coordinates.map(c=>[c[1],c[0]]):pts;const line=L.polyline(coords,{weight:4}).addTo(map);map.fitBounds(line.getBounds(),{padding:[20,20]});state.routeStats=state.routeStats||{};state.routeStats[date]=state.routeStats[date]||{};state.routeStats[date][id]={km:rr?rr.distance/1000:coords.slice(1).reduce((s,p,i)=>s+dist(coords[i],p),0),minutes:rr?rr.duration/60:0};localStorage.setItem(KEY,JSON.stringify(state))}
}

async function orderGeoProfile(o){return{pickup:await geo(o.pickupAddress),drop:await geo(o.dropAddress)}}
async function balance(){
  const active=activeVehicles();if(!active.length)return alert('Nincs aktív jármű.');
  const orders=state.orders.filter(o=>o.scheduleDate===selectedDate()),longCars=active.filter(canCarryLong),profiles={};
  for(const o of orders){syncOrderFromMasters(o);profiles[o.id]=await orderGeoProfile(o);if(o.longMaterialReason){const target=longCars.find(v=>norm(v.driverName).includes('martin'))||longCars[0];if(target)o.vehicleId=target.id}}
  const homes={};for(const v of active)homes[v.id]=await vehicleHome(v);
  const load=Object.fromEntries(active.map(v=>[v.id,{orders:0,pickups:new Set(),drops:new Set(),km:0}]));
  for(const o of orders.filter(o=>o.longMaterialReason&&o.vehicleId)){const l=load[o.vehicleId];l.orders++;l.pickups.add(norm(o.pickupAddress));l.drops.add(norm(o.dropAddress))}
  for(const o of orders.filter(o=>!o.longMaterialReason)){
    const p=profiles[o.id];
    const ranked=active.map(v=>{const l=load[v.id],travel=dist(homes[v.id],p.pickup)+dist(p.pickup,p.drop);const score=l.orders*18+l.pickups.size*7+l.drops.size*8+l.km*.35+travel;return{v,score,travel}}).sort((a,b)=>a.score-b.score);
    const best=ranked[0];o.vehicleId=best.v.id;const l=load[o.vehicleId];l.orders++;l.pickups.add(norm(o.pickupAddress));l.drops.add(norm(o.dropAddress));l.km+=best.travel;
  }
  active.forEach(v=>dayOrders(v.id).forEach((o,i)=>o.sequence=i+1));save();alert('A fuvarokat a felrakók, lerakók, várható kilométer és a kiegyensúlyozott terhelés alapján szétosztottam.');
}
async function optimizeAll(){
  for(const v of activeVehicles()){
    const orders=dayOrders(v.id),home=await vehicleHome(v);let current=home,left=[];
    for(const o of orders)left.push({o,pickup:await geo(o.pickupAddress),drop:await geo(o.dropAddress)});
    const ordered=[];while(left.length){left.sort((a,b)=>(dist(current,a.pickup)+dist(a.pickup,a.drop))-(dist(current,b.pickup)+dist(b.pickup,b.drop)));const n=left.shift();ordered.push(n.o);current=n.drop||n.pickup||current}ordered.forEach((o,i)=>o.sequence=i+1)
  }save();
}

function renderReports(){
  const month=$('#reportMonth')?.value||today().slice(0,7),vehicles=state.vehicles;
  const rows=vehicles.map(v=>{const completed=(state.orders||[]).filter(o=>o.vehicleId===v.id&&o.scheduleDate?.startsWith(month)&&o.completed);const pickupKeys=new Set(completed.map(o=>`${o.scheduleDate}|${norm(o.pickupAddress||o.pickupName)}`).filter(x=>x.split('|')[1]));const dropKeys=new Set(completed.map(o=>`${o.scheduleDate}|${norm(o.dropAddress||o.projectName)}`).filter(x=>x.split('|')[1]));const km=Object.entries(state.routeStats||{}).filter(([date])=>date.startsWith(month)).reduce((sum,[,byVehicle])=>sum+(+byVehicle?.[v.id]?.km||0),0);const failed=(state.failedTrips||[]).filter(f=>f.vehicleId===v.id&&f.originalDate?.startsWith(month)).length;return{driver:v.driverName,km:Math.round(km*10)/10,completed:completed.length,pickups:pickupKeys.size,drops:dropKeys.size,failed}});
  const total=rows.reduce((a,r)=>({driver:'Havi összesen',km:a.km+r.km,completed:a.completed+r.completed,pickups:a.pickups+r.pickups,drops:a.drops+r.drops,failed:a.failed+r.failed}),{km:0,completed:0,pickups:0,drops:0,failed:0});
  $('#reportBody').innerHTML=[...rows,total].map((r,i)=>`<tr ${i===rows.length?'class="report-total"':''}><td><b>${esc(r.driver)}</b></td><td>${formatQty(Math.round(r.km*10)/10)} km</td><td>${r.completed}</td><td>${r.pickups}</td><td>${r.drops}</td><td>${r.failed}</td></tr>`).join('');
}

async function importMasterDataExcelV23(file){
  try{
    const wb=XLSX.read(await file.arrayBuffer(),{type:'array',cellDates:true}),counts={created:0,updated:0,skipped:0};
    const suppliers=sheetRowsByNames(wb,['Beszállítók','Beszállítók törzs','Suppliers']);
    for(const row of suppliers){const name=valueByHeaders(row,['Cégnév','Cég neve','Beszállító','Név']),address=valueByHeaders(row,['Cím','Telephely címe','Szállítási cím']);if(!name){counts.skipped++;continue}let s=state.suppliers.find(x=>norm(x.name)===norm(name)&&norm(x.address)===norm(address));if(!s){s={id:uid(),name,address};state.suppliers.push(s);counts.created++}else counts.updated++;s.pickupNote=valueByHeaders(row,['Felrakói megjegyzés','Megjegyzés'])||'';const c=valueByHeaders(row,['Központi telephely','Központi']);s.isCentral=/^(igen|i|true|1)$/i.test(c)||norm(s.pickupNote).includes('kozpont')}
    const projects=sheetRowsByNames(wb,['Projektek','Projects']);for(const row of projects){const name=valueByHeaders(row,['Projekt neve','Projekt','Név']);if(!name){counts.skipped++;continue}const address=valueByHeaders(row,['Cím','Projekt címe']),receiver=valueByHeaders(row,['Alapértelmezett átvevő','Átvevő']);let p=state.projects.find(x=>norm(x.name)===norm(name));if(!p){p={id:uid(),name,address,defaultRecipientId:''};state.projects.push(p);counts.created++}else counts.updated++;p.address=address;if(receiver)p.defaultRecipientId=state.recipients.find(r=>norm(r.name)===norm(receiver))?.id||p.defaultRecipientId||''}
    const recipients=sheetRowsByNames(wb,['Átvevők','Recipients']);for(const row of recipients){const name=valueByHeaders(row,['Név','Átvevő neve']),project=valueByHeaders(row,['Projekt','Projekt neve']);if(!name){counts.skipped++;continue}let r=state.recipients.find(x=>norm(x.name)===norm(name)&&norm(x.project||'')===norm(project||''));if(!r){r={id:uid(),name,project};state.recipients.push(r);counts.created++}else counts.updated++;r.phone=valueByHeaders(row,['Telefon','Telefonszám']);r.email=valueByHeaders(row,['E-mail','Email'])}
    const vehicles=sheetRowsByNames(wb,['Autók','Járművek','Vehicles']);for(const row of vehicles){const driverName=valueByHeaders(row,['Sofőr neve','Fuvaros neve','Sofőr']),vehicleName=valueByHeaders(row,['Jármű neve / rendszám','Jármű neve','Rendszám']);if(!driverName&&!vehicleName){counts.skipped++;continue}let v=state.vehicles.find(x=>(vehicleName&&norm(x.name)===norm(vehicleName))||(!vehicleName&&norm(x.driverName)===norm(driverName)));if(!v){v={id:uid(),driverName,name:vehicleName||driverName,type:VEHICLE_TYPES[0],active:true};state.vehicles.push(v);counts.created++}else counts.updated++;v.driverName=driverName||v.driverName;v.name=vehicleName||v.name;v.type=valueByHeaders(row,['Járműtípus','Típus'])||v.type;v.homeAddress=valueByHeaders(row,['Indulási / lakóhely címe','Lakóhely címe','Indulási cím','Indulási település','Település'])||v.homeAddress||v.homeCity||'';v.homeCity=v.homeAddress;const activeText=valueByHeaders(row,['Aktív']);if(activeText)v.active=/^(igen|i|true|1)$/i.test(activeText)}
    state.masterDataVersion='v23-excel';await resyncAllMasterData(false);alert(`Törzsadat import és visszamenőleges újraszinkronizálás kész. Új: ${counts.created}, frissítve: ${counts.updated}, kihagyva: ${counts.skipped}.`)
  }catch(e){console.error(e);alert('A törzsadat Excel nem olvasható. Ellenőrizd a munkalapok és oszlopok nevét.')}
}
function exportMasterDataExcel(){
  const wb=XLSX.utils.book_new(),projects=[['Projekt neve','Cím','Alapértelmezett átvevő']],suppliers=[['Cégnév','Cím','Felrakói megjegyzés','Központi telephely']],recipients=[['Név','Projekt','Telefon','E-mail']],vehicles=[['Sofőr neve','Jármű neve / rendszám','Járműtípus','Indulási / lakóhely címe','Aktív']];
  (state.projects||[]).slice().sort((a,b)=>String(a.name).localeCompare(String(b.name),'hu')).forEach(p=>projects.push([p.name||'',p.address||'',state.recipients.find(r=>r.id===p.defaultRecipientId)?.name||p.receiver||'']));
  (state.suppliers||[]).slice().sort((a,b)=>String(a.name).localeCompare(String(b.name),'hu')||String(a.address).localeCompare(String(b.address),'hu')).forEach(s=>suppliers.push([s.name||'',s.address||'',s.pickupNote||'',s.isCentral?'Igen':'Nem']));
  (state.recipients||[]).forEach(r=>recipients.push([r.name||'',r.project||'',r.phone||'',r.email||'']));(state.vehicles||[]).forEach(v=>vehicles.push([v.driverName||'',v.name||'',v.type||'',v.homeAddress||v.homeCity||'',v.active!==false?'Igen':'Nem']));
  [['Projektek',projects],['Beszállítók',suppliers],['Átvevők',recipients],['Autók',vehicles]].forEach(([n,d])=>XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(d),n));XLSX.writeFile(wb,`torzsadatok_${today()}.xlsx`);
}
async function vehicleHome(v){return await geo(v?.homeAddress||v?.homeCity||state.settings.baseAddress)||await geo(state.settings.baseAddress)}

(function installV23Handlers(){
  const input=$('#masterExcelInput'),exportBtn=$('#exportMastersBtn'),syncBtn=$('#resyncMastersBtn');if(input)input.onchange=async()=>{const file=input.files?.[0];if(file)await importMasterDataExcelV23(file);input.value=''};if(exportBtn)exportBtn.onclick=exportMasterDataExcel;if(syncBtn)syncBtn.onclick=()=>resyncAllMasterData(true);
  const oldEdit=window.editVehicle||editVehicle;window.editVehicle=id=>{oldEdit(id);const v=state.vehicles.find(x=>x.id===id)||{};if($('#homeCity'))$('#homeCity').value=v.homeAddress||v.homeCity||''};
  const vf=$('#vehicleForm');if(vf)vf.onsubmit=e=>{e.preventDefault();const id=$('#editVehicleId').value,v={...(state.vehicles.find(x=>x.id===id)||{}),id:id||uid(),driverName:$('#driverName').value,name:$('#vehicleName').value,type:$('#vehicleType').value,homeAddress:$('#homeCity').value,homeCity:$('#homeCity').value,active:$('#vehicleActive').checked};const i=state.vehicles.findIndex(x=>x.id===id);if(i>=0)state.vehicles[i]=v;else state.vehicles.push(v);$('#vehicleDialog').close();save()};
  state.orders.forEach(o=>syncOrderFromMasters(o));localStorage.setItem(KEY,JSON.stringify(state));
})();

/* ==================== V24 ==================== */
function v24DriverKey(v){const n=norm(v?.driverName||'');return n.includes('martin')?'martin':n.includes('mario')?'mario':n.includes('patrik')?'patrik':'other'}
function v24FinitePoint(p){return Array.isArray(p)&&Number.isFinite(+p[0])&&Number.isFinite(+p[1])}
function v24BudapestSide(point){
  if(!v24FinitePoint(point))return 'unknown';
  const lat=+point[0],lng=+point[1];
  // Budapest és közvetlen agglomeráció: a Duna közelítő választóvonala.
  if(lat>=47.30&&lat<=47.70&&lng>=18.75&&lng<=19.35)return lng<19.045?'buda':'pest';
  return 'outside';
}
function v24DropoffSummary(list){
  if(!list.length)return '<aside class="dropoff-summary"><h3>Lerakók</h3><div class="dropoff-empty">Nincs lerakó az adott napon.</div></aside>';
  const groups=[];
  for(const o of list.slice().sort((a,b)=>(+a.sequence||999)-(+b.sequence||999))){
    const key=norm(o.projectName||o.dropAddress||'Egyedi úticél');
    let g=groups.find(x=>x.key===key);
    if(!g){g={key,name:o.projectName||o.dropAddress||'Egyedi úticél',address:o.dropAddress||'',orders:[]};groups.push(g)}
    if(o.orderNo&&!g.orders.includes(o.orderNo))g.orders.push(o.orderNo);
  }
  return `<aside class="dropoff-summary"><h3>Lerakók · optimalizált sorrend</h3><div class="dropoff-summary-list">${groups.map((g,i)=>`<div class="dropoff-stop"><b>${i+1}. ${esc(g.name)}</b><span>${esc(g.orders.join(', '))}</span>${g.address?`<span>${esc(g.address)}</span>`:''}</div>`).join('')}</div></aside>`;
}
function renderRoutes(){
  const vehicles=activeVehicles();
  $('#routes').innerHTML=vehicles.map(v=>{const list=dayOrders(v.id).sort((a,b)=>(+a.sequence||999)-(+b.sequence||999));return`<section class="route" data-driver="${v24DriverKey(v)}"><header class="route-head"><h2><input value="${esc(v.driverName)}" onchange="renameDriver('${v.id}',this.value)"></h2><small>${esc(v.name)} · ${esc(v.type)} · ${list.length} fuvar</small><div class="route-summary" id="summary-${v.id}"></div></header><div id="map-${v.id}" class="map"></div><div id="route-${v.id}" class="route-list">${bubbles(list)}</div>${v24DropoffSummary(list)}</section>`}).join('')||'<div class="notice">Nincs aktív jármű.</div>';
  setTimeout(initMaps,30);setTimeout(initSortables,40);setTimeout(updateSummaries,60)
}
async function drawMap(id){
  const map=maps[id],pts=[],date=selectedDate();if(!map)return;
  const v=state.vehicles.find(x=>x.id===id),home=await vehicleHome(v||{});if(home)pts.push(home);
  for(const o of dayOrders(id).sort((a,b)=>(+a.sequence||999)-(+b.sequence||999))){
    const pickup=await geo(o.pickupAddress),drop=await geo(o.dropAddress);
    if(pickup){pts.push(pickup);L.marker(pickup,{title:`Felrakó: ${o.pickupName||''}`}).addTo(map).bindPopup(`<b>Felrakó · ${esc(o.orderNo)}</b><br>${esc(o.pickupName||'')}<br>${esc(o.pickupAddress||'')}`)}
    // A lerakó az útvonalban szerepel, de külön térképi marker nélkül.
    if(drop)pts.push(drop);
  }
  if(home)pts.push(home);
  if(pts.length){const rr=await roadRoute(pts),coords=rr?rr.geometry.coordinates.map(c=>[c[1],c[0]]):pts;const line=L.polyline(coords,{weight:4}).addTo(map);map.fitBounds(line.getBounds(),{padding:[20,20]});state.routeStats=state.routeStats||{};state.routeStats[date]=state.routeStats[date]||{};state.routeStats[date][id]={km:rr?rr.distance/1000:coords.slice(1).reduce((s,p,i)=>s+dist(coords[i],p),0),minutes:rr?rr.duration/60:0};localStorage.setItem(KEY,JSON.stringify(state))}
}
async function v25InsertionCost(order, targetOrders, profiles, home){
  const p=profiles[order.id]||{},pickup=p.pickup,drop=p.drop;
  if(!pickup&&!drop)return 999;
  const start=pickup||drop,end=drop||pickup;
  const anchors=[home];
  for(const x of targetOrders){const xp=profiles[x.id]||{};if(xp.pickup)anchors.push(xp.pickup);if(xp.drop)anchors.push(xp.drop)}
  let nearest=999;
  for(const a of anchors)nearest=Math.min(nearest,dist(a,start));
  return nearest+dist(start,end);
}
async function v25MergeLonelyProjects(mario,patrik,orders,profiles,homes){
  if(!mario||!patrik)return 0;
  let moved=0,changed=true,guard=0;
  while(changed&&guard++<8){
    changed=false;
    for(const source of [mario,patrik]){
      const target=source.id===mario.id?patrik:mario;
      const sourceOrders=orders.filter(o=>o.vehicleId===source.id&&!o.longMaterialReason);
      const targetOrders=orders.filter(o=>o.vehicleId===target.id&&!o.longMaterialReason);
      const groups=new Map();
      for(const o of sourceOrders){const k=norm(o.projectName||o.dropAddress||'');if(!groups.has(k))groups.set(k,[]);groups.get(k).push(o)}
      const lonely=[...groups.values()].filter(g=>g.length===1).map(g=>g[0]);
      for(const o of lonely){
        const key=norm(o.projectName||o.dropAddress||'');
        const targetAlreadyGoes=targetOrders.some(x=>norm(x.projectName||x.dropAddress||'')===key);
        const sourceWithout=sourceOrders.filter(x=>x.id!==o.id);
        const sourceCost=await v25InsertionCost(o,sourceWithout,profiles,homes[source.id]);
        const targetCost=await v25InsertionCost(o,targetOrders,profiles,homes[target.id]);
        // Azonos projekt esetén szinte mindig összevonjuk. Egyébként csak kis kerülőnél,
        // és akkor, ha ténylegesen csökkenti az egyetlen rendelés miatti külön kitérőt.
        const acceptable=targetAlreadyGoes || (targetCost<=10 && targetCost+2<sourceCost);
        if(!acceptable)continue;
        // Ne borítsa fel durván az igazságos elosztást; Márió legfeljebb kettővel kaphat többet.
        const afterTarget=targetOrders.length+1,afterSource=sourceOrders.length-1;
        if(target.id===mario.id && afterTarget-afterSource>2 && !targetAlreadyGoes)continue;
        if(target.id===patrik.id && afterTarget-afterSource>1 && !targetAlreadyGoes)continue;
        o.vehicleId=target.id;moved++;changed=true;break;
      }
      if(changed)break;
    }
  }
  return moved;
}
async function balance(){
  const active=activeVehicles();if(!active.length)return alert('Nincs aktív jármű.');
  const orders=state.orders.filter(o=>o.scheduleDate===selectedDate());
  const martin=active.find(v=>v24DriverKey(v)==='martin');
  const mario=active.find(v=>v24DriverKey(v)==='mario');
  const patrik=active.find(v=>v24DriverKey(v)==='patrik');
  const profiles={};
  for(const o of orders){syncOrderFromMasters(o);profiles[o.id]=await orderGeoProfile(o)}
  for(const o of orders.filter(x=>x.longMaterialReason)){
    const target=(martin&&canCarryLong(martin))?martin:active.filter(canCarryLong)[0];
    if(target)o.vehicleId=target.id;
  }
  const remaining=orders.filter(o=>!o.longMaterialReason);
  let merged=0;
  if(!mario||!patrik){
    const candidates=[mario,patrik].filter(Boolean);
    remaining.forEach((o,i)=>o.vehicleId=(candidates[i%candidates.length]||active[i%active.length]).id);
  }else{
    const targetMario=Math.ceil(remaining.length/2),targetPatrik=Math.floor(remaining.length/2);
    const quota={[mario.id]:targetMario,[patrik.id]:targetPatrik},assigned={[mario.id]:0,[patrik.id]:0};
    const homes={[mario.id]:await vehicleHome(mario),[patrik.id]:await vehicleHome(patrik)};
    const load={[mario.id]:{pickups:new Set(),drops:new Set(),km:0},[patrik.id]:{pickups:new Set(),drops:new Set(),km:0}};
    const sorted=remaining.slice().sort((a,b)=>{const sa=v24BudapestSide(profiles[a.id]?.drop),sb=v24BudapestSide(profiles[b.id]?.drop);return (sa==='unknown'||sa==='outside'?1:0)-(sb==='unknown'||sb==='outside'?1:0)});
    for(const o of sorted){
      const p=profiles[o.id]||{},side=v24BudapestSide(p.drop),choices=[mario,patrik].filter(v=>assigned[v.id]<quota[v.id]);
      const available=choices.length?choices:[mario,patrik];
      const ranked=available.map(v=>{
        const key=v24DriverKey(v),l=load[v.id],travel=dist(homes[v.id],p.pickup)+dist(p.pickup,p.drop);
        let territoryPenalty=0;if(side==='pest'&&key==='patrik')territoryPenalty=45;if(side==='buda'&&key==='mario')territoryPenalty=45;
        const duplicateBonus=(l.pickups.has(norm(o.pickupAddress))?9:0)+(l.drops.has(norm(o.dropAddress))?12:0);
        const workload=l.km*.45+l.pickups.size*4+l.drops.size*5;
        return{v,score:travel+territoryPenalty+workload-duplicateBonus,travel};
      }).sort((a,b)=>a.score-b.score);
      const best=ranked[0];o.vehicleId=best.v.id;assigned[best.v.id]++;
      const l=load[best.v.id];l.km+=best.travel;l.pickups.add(norm(o.pickupAddress));l.drops.add(norm(o.dropAddress));
    }
    // V25: az egyetlen rendeléses, „magányos” projekteket kis kerülő esetén
    // átvisszük ahhoz a sofőrhöz, akinek az útvonalába jobban illeszkednek.
    merged=await v25MergeLonelyProjects(mario,patrik,remaining,profiles,homes);
  }
  await optimizeAll(false);save();
  alert(`Elosztás kész. Szálanyagok: Martin; Pest: elsősorban Márió; Buda: elsősorban Patrik. Magányos projektből ${merged} fuvar került kedvezőbb útvonalra.`);
}
async function optimizeAll(doSave=true){
  for(const v of activeVehicles()){
    const orders=dayOrders(v.id),home=await vehicleHome(v),left=[];let current=home;
    for(const o of orders)left.push({o,pickup:await geo(o.pickupAddress),drop:await geo(o.dropAddress)});
    const ordered=[];
    while(left.length){
      left.sort((a,b)=>{
        const ac=dist(current,a.pickup)+dist(a.pickup,a.drop),bc=dist(current,b.pickup)+dist(b.pickup,b.drop);
        const aNext=left.length>1?Math.min(...left.filter(x=>x!==a).map(x=>dist(a.drop||a.pickup,x.pickup))):dist(a.drop||a.pickup,home);
        const bNext=left.length>1?Math.min(...left.filter(x=>x!==b).map(x=>dist(b.drop||b.pickup,x.pickup))):dist(b.drop||b.pickup,home);
        return (ac+aNext*.35)-(bc+bNext*.35);
      });
      const n=left.shift();ordered.push(n.o);current=n.drop||n.pickup||current;
    }
    ordered.forEach((o,i)=>o.sequence=i+1);
  }
  if(doSave)save();
}


// V25 – húzás közbeni automatikus képernyőgörgetés
let v25DragActive=false,v25PointerY=0,v25ScrollFrame=0;
function v25AutoScrollLoop(){
  if(!v25DragActive){v25ScrollFrame=0;return}
  const edge=Math.min(140,Math.max(80,window.innerHeight*.16));
  let speed=0;
  if(v25PointerY<edge)speed=-Math.ceil((edge-v25PointerY)/edge*24);
  else if(v25PointerY>window.innerHeight-edge)speed=Math.ceil((v25PointerY-(window.innerHeight-edge))/edge*24);
  if(speed)window.scrollBy(0,speed);
  v25ScrollFrame=requestAnimationFrame(v25AutoScrollLoop);
}
function v25TrackPointer(e){
  const t=e.touches?.[0]||e.changedTouches?.[0]||e;
  if(Number.isFinite(t.clientY))v25PointerY=t.clientY;
}
if(!window.__v25DragScrollBound){
  window.__v25DragScrollBound=true;
  document.addEventListener('pointermove',v25TrackPointer,{passive:true});
  document.addEventListener('touchmove',v25TrackPointer,{passive:true});
}
function initSortables(){
  activeVehicles().forEach(v=>{
    const el=$('#route-'+v.id);if(!el)return;
    new Sortable(el,{
      group:'vehicles',animation:180,handle:'.drag',
      scroll:true,bubbleScroll:true,scrollSensitivity:120,scrollSpeed:20,
      fallbackOnBody:true,forceFallback:false,delayOnTouchOnly:true,delay:120,touchStartThreshold:4,
      onStart:e=>{v25DragActive=true;const r=e.originalEvent||{};v25TrackPointer(r);if(!v25ScrollFrame)v25ScrollFrame=requestAnimationFrame(v25AutoScrollLoop)},
      onMove:e=>{v25TrackPointer(e.originalEvent||{});return true},
      onEnd:e=>{
        v25DragActive=false;if(v25ScrollFrame){cancelAnimationFrame(v25ScrollFrame);v25ScrollFrame=0}
        const o=state.orders.find(x=>x.id===e.item.dataset.id);if(o)o.vehicleId=e.to.id.replace('route-','');
        activeVehicles().forEach(x=>{$$('#route-'+x.id+' .bubble').forEach((n,i)=>{const r=state.orders.find(o=>o.id===n.dataset.id);if(r)r.sequence=i+1})});save();
      }
    })
  })
}


// V26 – háromsofőrös, földrajzi és terhelésalapú fuvarszétosztás
function v26Region(point){
  if(!v24FinitePoint(point))return 'unknown';
  const lat=+point[0],lng=+point[1];
  if(lat>=47.25&&lat<=47.75&&lng>=18.70&&lng<=19.45){
    if(lng<19.045)return 'buda';
    if(lat<47.47)return 'south-pest';
    return 'pest';
  }
  return 'outside';
}
function v26OrderDistance(profile){
  const p=profile?.pickup,d=profile?.drop;
  if(p&&d)return dist(p,d);
  return 0;
}
function v26UniqueCount(list,field){return new Set(list.map(o=>norm(o[field]||'')).filter(Boolean)).size}
function v26LoadMetric(list,profiles){
  const routeKm=list.reduce((sum,o)=>sum+v26OrderDistance(profiles[o.id]),0);
  return list.length*10+v26UniqueCount(list,'pickupAddress')*4+v26UniqueCount(list,'dropAddress')*5+routeKm*.35;
}
function v26TerritoryPenalty(driverKey,profile){
  const regions=[v26Region(profile?.pickup),v26Region(profile?.drop)];
  let penalty=0;
  for(const region of regions){
    if(driverKey==='mario'&&region==='buda')penalty+=18;
    if(driverKey==='patrik'&&(region==='pest'||region==='south-pest'))penalty+=18;
    // Martin joker: Buda és Dél-Pest csak enyhe előny, kizárólag közel azonos megoldásnál.
    if(driverKey==='martin'&&(region==='buda'||region==='south-pest'))penalty-=3;
  }
  return penalty;
}
function v26ApproxInsertion(order,list,profiles,home){
  const p=profiles[order.id]?.pickup,d=profiles[order.id]?.drop;
  if(!p&&!d)return 80;
  const start=p||d,end=d||p;
  const anchors=[home];
  for(const x of list){const xp=profiles[x.id]||{};if(xp.pickup)anchors.push(xp.pickup);if(xp.drop)anchors.push(xp.drop)}
  let nearest=60;
  for(const a of anchors)if(a)nearest=Math.min(nearest,dist(a,start));
  const duplicatePickup=list.some(x=>norm(x.pickupAddress)===norm(order.pickupAddress));
  const duplicateDrop=list.some(x=>norm(x.dropAddress)===norm(order.dropAddress));
  return nearest+dist(start,end)-(duplicatePickup?8:0)-(duplicateDrop?11:0);
}
function v26Targets(total,drivers,mandatory){
  const targets={};drivers.forEach(v=>targets[v.id]=Math.floor(total/drivers.length));
  let extra=total%drivers.length;
  // Páratlan/maradék esetben Márió kapjon először plusz egyet, majd Martin, majd Patrik.
  const order=drivers.slice().sort((a,b)=>({mario:0,martin:1,patrik:2}[v24DriverKey(a)]??9)-({mario:0,martin:1,patrik:2}[v24DriverKey(b)]??9));
  for(let i=0;i<extra;i++)targets[order[i%order.length].id]++;
  // Kötelező szálanyag esetén Martin célja legalább a kötelező darabszám.
  for(const v of drivers)targets[v.id]=Math.max(targets[v.id],mandatory[v.id]||0);
  // Ha emiatt a célösszeg túllépné az összes fuvart, a többiek célját arányosan csökkentjük.
  let over=Object.values(targets).reduce((a,b)=>a+b,0)-total;
  while(over>0){
    const reducible=drivers.filter(v=>targets[v.id]>(mandatory[v.id]||0)).sort((a,b)=>targets[b.id]-targets[a.id]);
    if(!reducible.length)break;
    targets[reducible[0].id]--;over--;
  }
  return targets;
}
async function v26MergeLonelyProjects(drivers,orders,profiles,homes,targets){
  let moved=0;
  for(let pass=0;pass<5;pass++){
    let changed=false;
    for(const source of drivers){
      const src=orders.filter(o=>o.vehicleId===source.id&&!o.longMaterialReason);
      const groups=new Map();
      src.forEach(o=>{const k=norm(o.projectName||o.dropAddress||'');if(!groups.has(k))groups.set(k,[]);groups.get(k).push(o)});
      for(const lone of [...groups.values()].filter(g=>g.length===1).map(g=>g[0])){
        const key=norm(lone.projectName||lone.dropAddress||'');
        let best=null;
        for(const target of drivers.filter(v=>v.id!==source.id)){
          const dst=orders.filter(o=>o.vehicleId===target.id&&!o.longMaterialReason);
          const sameProject=dst.some(o=>norm(o.projectName||o.dropAddress||'')===key);
          const add=v26ApproxInsertion(lone,dst,profiles,homes[target.id]);
          const stay=v26ApproxInsertion(lone,src.filter(o=>o.id!==lone.id),profiles,homes[source.id]);
          const imbalanceAfter=Math.abs((dst.length+1)-(targets[target.id]||0))+Math.abs((src.length-1)-(targets[source.id]||0));
          const acceptable=sameProject||(add<=9&&add+2<stay);
          if(acceptable&&(!best||add+imbalanceAfter*2<best.score))best={target,score:add+imbalanceAfter*2};
        }
        if(best){lone.vehicleId=best.target.id;moved++;changed=true;break}
      }
      if(changed)break;
    }
    if(!changed)break;
  }
  return moved;
}
async function balance(){
  try{
    const drivers=activeVehicles();if(!drivers.length)return alert('Nincs aktív jármű.');
    const orders=state.orders.filter(o=>o.scheduleDate===selectedDate());
    if(!orders.length)return alert('Nincs szétosztható fuvar az adott napon.');
    const martin=drivers.find(v=>v24DriverKey(v)==='martin');
    const profiles={},homes={},assigned={};
    for(const v of drivers){homes[v.id]=await vehicleHome(v);assigned[v.id]=[]}
    for(const o of orders){syncOrderFromMasters(o);profiles[o.id]=await orderGeoProfile(o);o.vehicleId='';o.sequence=999}
    const mandatory={};drivers.forEach(v=>mandatory[v.id]=0);
    // Csak a megfelelő hosszúanyag-szállító kaphat 4–6 m-es anyagot; Martin az elsődleges.
    for(const o of orders.filter(x=>x.longMaterialReason)){
      const target=(martin&&canCarryLong(martin))?martin:drivers.find(canCarryLong);
      if(target){o.vehicleId=target.id;assigned[target.id].push(o);mandatory[target.id]++}
    }
    const targets=v26Targets(orders.length,drivers,mandatory);
    const remaining=orders.filter(o=>!o.vehicleId).sort((a,b)=>v26OrderDistance(profiles[b.id])-v26OrderDistance(profiles[a.id]));
    for(const o of remaining){
      const eligible=drivers.filter(v=>!o.longMaterialReason||canCarryLong(v));
      const underTarget=eligible.filter(v=>assigned[v.id].length<(targets[v.id]??999));
      const candidates=underTarget.length?underTarget:eligible;
      const ranked=candidates.map(v=>{
        const key=v24DriverKey(v),list=assigned[v.id];
        const insertion=v26ApproxInsertion(o,list,profiles,homes[v.id]);
        const territory=v26TerritoryPenalty(key,profiles[o.id]);
        const load=v26LoadMetric(list,profiles)*.22;
        const targetPenalty=Math.max(0,list.length-(targets[v.id]||0))*25;
        return{v,score:insertion+territory+load+targetPenalty};
      }).sort((a,b)=>a.score-b.score);
      const best=ranked[0].v;o.vehicleId=best.id;assigned[best.id].push(o);
    }
    const merged=await v26MergeLonelyProjects(drivers,orders,profiles,homes,targets);
    await optimizeAll(false);save();
    alert(`Fuvarok szétosztva.\n\nMagányos projektből ${merged} fuvar került kedvezőbb útvonalra.`);
  }catch(err){console.error(err);alert('A fuvarok szétosztása közben hiba történt: '+(err?.message||err))}
}
async function optimizeAll(doSave=true){
  try{
    for(const v of activeVehicles()){
      const orders=dayOrders(v.id),home=await vehicleHome(v),left=[];let current=home;
      for(const o of orders)left.push({o,pickup:await geo(o.pickupAddress),drop:await geo(o.dropAddress)});
      const ordered=[];
      while(left.length){
        left.sort((a,b)=>{
          const ac=dist(current,a.pickup)+dist(a.pickup,a.drop),bc=dist(current,b.pickup)+dist(b.pickup,b.drop);
          const aEnd=a.drop||a.pickup,bEnd=b.drop||b.pickup;
          const aNext=left.length>1?Math.min(...left.filter(x=>x!==a).map(x=>dist(aEnd,x.pickup||x.drop))):dist(aEnd,home);
          const bNext=left.length>1?Math.min(...left.filter(x=>x!==b).map(x=>dist(bEnd,x.pickup||x.drop))):dist(bEnd,home);
          const aSame=ordered.length&&norm(ordered[ordered.length-1].pickupAddress)===norm(a.o.pickupAddress)?-7:0;
          const bSame=ordered.length&&norm(ordered[ordered.length-1].pickupAddress)===norm(b.o.pickupAddress)?-7:0;
          return (ac+aNext*.4+aSame)-(bc+bNext*.4+bSame);
        });
        const n=left.shift();ordered.push(n.o);current=n.drop||n.pickup||current;
      }
      ordered.forEach((o,i)=>o.sequence=i+1);
    }
    if(doSave){save();alert('Optimalizálás befejezve.');}
  }catch(err){console.error(err);alert('Az optimalizálás közben hiba történt: '+(err?.message||err))}
}

/* ==================== V27 ====================
   Szabályalapú fuvarszervezés:
   - beszállítói felrakási blokkok
   - ugyanahhoz a beszállítóhoz lehetőleg egyszer
   - útba eső, teljesen felvehető projekt lerakása
   - nincs pontozásos optimalizálás
*/
function v27SupplierKey(o){return norm(o.pickupAddress||o.pickupName||'ismeretlen-felrako')}
function v27ProjectKey(o){return norm(o.dropAddress||o.projectName||'ismeretlen-lerako')}
function v27GroupBy(list,keyFn){const m=new Map();for(const x of list){const k=keyFn(x);if(!m.has(k))m.set(k,[]);m.get(k).push(x)}return m}
function v27GroupPoint(group,profiles,type){for(const o of group){const p=profiles[o.id]?.[type];if(v24FinitePoint(p))return p}return null}
function v27GroupDistance(group,profiles){return group.reduce((s,o)=>s+v26OrderDistance(profiles[o.id]),0)}
function v27GroupRegions(group,profiles){return group.flatMap(o=>[v26Region(profiles[o.id]?.pickup),v26Region(profiles[o.id]?.drop)])}
function v27TerritoryFit(driver,group,profiles){
  const key=v24DriverKey(driver),regions=v27GroupRegions(group,profiles);
  if(key==='mario'&&regions.includes('buda'))return 14;
  if(key==='patrik'&&(regions.includes('pest')||regions.includes('south-pest')))return 14;
  if(key==='martin'&&(regions.includes('buda')||regions.includes('south-pest')))return -2;
  return 0;
}
function v27ProjectUnityBonus(driverId,group,assigned){
  const existing=new Set((assigned[driverId]||[]).map(v27ProjectKey));
  return group.reduce((s,o)=>s+(existing.has(v27ProjectKey(o))?7:0),0);
}
function v27SupplierInsertion(driverId,group,assigned,profiles,home){
  const pickup=v27GroupPoint(group,profiles,'pickup');
  if(!pickup)return 70;
  const anchors=[home];
  for(const o of assigned[driverId]||[]){const p=profiles[o.id];if(p?.pickup)anchors.push(p.pickup);if(p?.drop)anchors.push(p.drop)}
  let nearest=70;for(const a of anchors)if(a)nearest=Math.min(nearest,dist(a,pickup));
  const drops=group.map(o=>profiles[o.id]?.drop).filter(v24FinitePoint);
  const avgDrop=drops.length?drops.reduce((a,p)=>[a[0]+p[0]/drops.length,a[1]+p[1]/drops.length],[0,0]):pickup;
  return nearest+dist(pickup,avgDrop)*.45;
}
async function v27Distribute(){
  const drivers=activeVehicles();if(!drivers.length)throw new Error('Nincs aktív jármű.');
  const orders=state.orders.filter(o=>o.scheduleDate===selectedDate());if(!orders.length)throw new Error('Nincs szétosztható fuvar az adott napon.');
  const martin=drivers.find(v=>v24DriverKey(v)==='martin');
  const profiles={},homes={},assigned={};
  for(const v of drivers){homes[v.id]=await vehicleHome(v);assigned[v.id]=[]}
  for(const o of orders){syncOrderFromMasters(o);profiles[o.id]=await orderGeoProfile(o);o.vehicleId='';o.sequence=999}

  // Kötelező szálas rendelések Martin (vagy más hosszúanyag-képes jármű).
  for(const o of orders.filter(x=>x.longMaterialReason)){
    const target=(martin&&canCarryLong(martin))?martin:drivers.find(canCarryLong);
    if(target){o.vehicleId=target.id;assigned[target.id].push(o)}
  }

  // A maradékot beszállítói blokkokban osztjuk, így egy sofőr egy beszállítóhoz egyszer megy.
  const remaining=orders.filter(o=>!o.vehicleId);
  const supplierGroups=[...v27GroupBy(remaining,v27SupplierKey).values()]
    .sort((a,b)=>b.length-a.length||v27GroupDistance(b,profiles)-v27GroupDistance(a,profiles));
  const totalTarget=Math.ceil(orders.length/drivers.length);
  for(const group of supplierGroups){
    const ranked=drivers.map(v=>{
      const insertion=v27SupplierInsertion(v.id,group,assigned,profiles,homes[v.id]);
      const territory=v27TerritoryFit(v,group,profiles);
      const unity=v27ProjectUnityBonus(v.id,group,assigned);
      const loadOrders=assigned[v.id].length;
      const loadStops=v26UniqueCount(assigned[v.id],'pickupAddress')+v26UniqueCount(assigned[v.id],'dropAddress');
      const overload=Math.max(0,loadOrders-totalTarget)*16;
      return{v,value:insertion+territory+loadOrders*4+loadStops*2+overload-unity};
    }).sort((a,b)=>a.value-b.value);
    const best=ranked[0].v;
    for(const o of group){o.vehicleId=best.id;assigned[best.id].push(o)}
  }

  // Projekt-egységesítés: ha ugyanaz a projekt több sofőrnél van, és nincs szálas kényszer,
  // lehetőleg ahhoz kerül minden, akinél a legtöbb rendelése van és útvonalilag is reális.
  const projectGroups=v27GroupBy(orders,v27ProjectKey);
  for(const group of projectGroups.values()){
    const nonLong=group.filter(o=>!o.longMaterialReason);if(nonLong.length<2)continue;
    const counts=new Map();for(const o of group)counts.set(o.vehicleId,(counts.get(o.vehicleId)||0)+1);
    if(counts.size<=1)continue;
    const candidates=drivers.map(v=>({v,count:counts.get(v.id)||0,add:nonLong.reduce((s,o)=>s+v26ApproxInsertion(o,assigned[v.id],profiles,homes[v.id]),0)}))
      .sort((a,b)=>b.count-a.count||a.add-b.add);
    const target=candidates[0].v;
    for(const o of nonLong){if(o.vehicleId===target.id)continue;const old=o.vehicleId;assigned[old]=assigned[old].filter(x=>x.id!==o.id);o.vehicleId=target.id;assigned[target.id].push(o)}
  }
  return{orders,profiles,homes,assigned};
}

async function v27BuildRoutePlan(vehicleId,profiles=null){
  const vehicle=state.vehicles.find(v=>v.id===vehicleId),home=await vehicleHome(vehicle||{});
  const orders=dayOrders(vehicleId).slice();
  if(!profiles){profiles={};for(const o of orders)profiles[o.id]=await orderGeoProfile(o)}
  const supplierGroups=v27GroupBy(orders,v27SupplierKey),projectGroups=v27GroupBy(orders,v27ProjectKey);
  const unvisitedSuppliers=new Set(supplierGroups.keys()),picked=new Set(),delivered=new Set(),events=[];
  let current=home;
  const pointOfSupplier=k=>v27GroupPoint(supplierGroups.get(k)||[],profiles,'pickup');
  const pointOfProject=k=>v27GroupPoint(projectGroups.get(k)||[],profiles,'drop');
  const projectReady=k=>(projectGroups.get(k)||[]).every(o=>picked.has(o.id))&&!delivered.has(k);
  const readyProjects=()=>[...projectGroups.keys()].filter(projectReady);
  const nearestKey=(keys,pointFn)=>keys.slice().sort((a,b)=>dist(current,pointFn(a))-dist(current,pointFn(b)))[0];
  while(unvisitedSuppliers.size){
    const supplierKey=nearestKey([...unvisitedSuppliers],pointOfSupplier),supplierOrders=supplierGroups.get(supplierKey)||[],p=pointOfSupplier(supplierKey);
    events.push({type:'pickup',key:supplierKey,name:supplierOrders[0]?.pickupName||'Felrakó',address:supplierOrders[0]?.pickupAddress||'',orders:supplierOrders.map(o=>o.id),point:p});
    supplierOrders.forEach(o=>picked.add(o.id));unvisitedSuppliers.delete(supplierKey);if(p)current=p;

    // Csak olyan projektet rakunk le közben, amelynek az összes, ehhez a sofőrhöz tartozó
    // aznapi rendelése már az autón van, és kis kerülővel a következő felrakó útjába esik.
    let changed=true;
    while(changed){
      changed=false;const ready=readyProjects();if(!ready.length)break;
      const nextSupplier=unvisitedSuppliers.size?nearestKey([...unvisitedSuppliers],pointOfSupplier):null;
      const nextPoint=nextSupplier?pointOfSupplier(nextSupplier):home;
      const feasible=ready.map(k=>{const dp=pointOfProject(k);const direct=dist(current,nextPoint),via=dist(current,dp)+dist(dp,nextPoint);return{k,detour:via-direct,d:dist(current,dp)}})
        .filter(x=>!unvisitedSuppliers.size||x.detour<=5.5).sort((a,b)=>a.detour-b.detour||a.d-b.d);
      if(!feasible.length)break;
      const k=feasible[0].k,g=projectGroups.get(k)||[],dp=pointOfProject(k);
      events.push({type:'drop',key:k,name:g[0]?.projectName||'Lerakó',address:g[0]?.dropAddress||'',orders:g.map(o=>o.id),point:dp});
      delivered.add(k);if(dp)current=dp;changed=true;
    }
  }
  // Az összes felrakás után a még nyitott projekteket logikus, legközelebbi sorrendben zárjuk.
  while(readyProjects().length){
    const k=nearestKey(readyProjects(),pointOfProject),g=projectGroups.get(k)||[],dp=pointOfProject(k);
    events.push({type:'drop',key:k,name:g[0]?.projectName||'Lerakó',address:g[0]?.dropAddress||'',orders:g.map(o=>o.id),point:dp});
    delivered.add(k);if(dp)current=dp;
  }
  state.routePlans=state.routePlans||{};state.routePlans[selectedDate()]=state.routePlans[selectedDate()]||{};state.routePlans[selectedDate()][vehicleId]=events;
  // Buboréksorrend: felrakási blokk szerint, azon belül a lerakási sorrend alapján.
  const dropIndex=new Map(events.filter(e=>e.type==='drop').map((e,i)=>[e.key,i]));
  const pickupIndex=new Map(events.filter(e=>e.type==='pickup').map((e,i)=>[e.key,i]));
  orders.sort((a,b)=>(pickupIndex.get(v27SupplierKey(a))??999)-(pickupIndex.get(v27SupplierKey(b))??999)||(dropIndex.get(v27ProjectKey(a))??999)-(dropIndex.get(v27ProjectKey(b))??999));
  orders.forEach((o,i)=>o.sequence=i+1);
  return events;
}

balance=async function(){
  try{
    const result=await v27Distribute();
    for(const v of activeVehicles())await v27BuildRoutePlan(v.id,result.profiles);
    save();alert('Fuvarok szétosztva.');
  }catch(err){console.error(err);alert('A fuvarok szétosztása közben hiba történt: '+(err?.message||err))}
};
optimizeAll=async function(doSave=true){
  try{
    for(const v of activeVehicles())await v27BuildRoutePlan(v.id);
    if(doSave){save();alert('Optimalizálás befejezve.');}
  }catch(err){console.error(err);alert('Az optimalizálás közben hiba történt: '+(err?.message||err))}
};
v24DropoffSummary=function(list){
  const vehicleId=list[0]?.vehicleId,date=selectedDate(),events=state.routePlans?.[date]?.[vehicleId]||[];
  const drops=events.filter(e=>e.type==='drop');
  if(!drops.length)return '<aside class="dropoff-summary"><h3>Lerakók</h3><div class="dropoff-empty">Nincs lerakó az adott napon.</div></aside>';
  return `<aside class="dropoff-summary"><h3>Lerakók · útvonal szerinti sorrend</h3><div class="dropoff-summary-list">${drops.map((e,i)=>{const nos=e.orders.map(id=>state.orders.find(o=>o.id===id)?.orderNo).filter(Boolean);return`<div class="dropoff-stop"><b>${i+1}. ${esc(e.name)}</b><span>${esc([...new Set(nos)].join(', '))}</span>${e.address?`<span>${esc(e.address)}</span>`:''}</div>`}).join('')}</div></aside>`;
};
drawMap=async function(id){
  const map=maps[id],date=selectedDate();if(!map)return;
  const v=state.vehicles.find(x=>x.id===id),home=await vehicleHome(v||{}),events=(state.routePlans?.[date]?.[id]||await v27BuildRoutePlan(id));
  const pts=[];if(home)pts.push(home);
  for(const e of events){
    if(!e.point)continue;pts.push(e.point);
    if(e.type==='pickup')L.marker(e.point,{title:`Felrakó: ${e.name}`}).addTo(map).bindPopup(`<b>Felrakó</b><br>${esc(e.name)}<br>${esc(e.address||'')}`);
  }
  if(home)pts.push(home);
  if(pts.length>1){const rr=await roadRoute(pts),coords=rr?rr.geometry.coordinates.map(c=>[c[1],c[0]]):pts;const line=L.polyline(coords,{weight:4}).addTo(map);map.fitBounds(line.getBounds(),{padding:[20,20]});state.routeStats=state.routeStats||{};state.routeStats[date]=state.routeStats[date]||{};state.routeStats[date][id]={km:rr?rr.distance/1000:coords.slice(1).reduce((s,p,i)=>s+dist(coords[i],p),0),minutes:rr?rr.duration/60:0};localStorage.setItem(KEY,JSON.stringify(state))}
};
