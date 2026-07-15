const KEY='fuvarszervezo_v11';const $=s=>document.querySelector(s),$$=s=>document.querySelectorAll(s);
const VEHICLE_TYPES=['3.5 T dobozos autó','3.5 T plató autó','7.5 tonnás dobozos autó','7.5 tonnás platós autó','7.5 tonnás emelőhátfalas autó','7.5 tonnás KCR-es autó','12 tonnás dobozos autó','12 tonnás platós autó','12 tonnás emelőhátfalas autó','12 tonnás KCR-es autó','24 tonnás kamion'];
let state={projects:[],suppliers:[],recipients:[],vehicles:[],orders:[],settings:{baseAddress:'2310 Szigetszentmiklós, Kereskedő utca 2.',role:'admin'},aliases:{projects:{},suppliers:{}},geo:{},history:[]};
let maps={},masterType='projects',mediaRecorder=null,audioChunks=[],audioBlob=null,importOrders=[],reviewQueue=[],reviewIndex=0,deferredPrompt=null;
const today=()=>new Date().toISOString().slice(0,10),uid=()=>crypto.randomUUID?crypto.randomUUID():Date.now()+'-'+Math.random();
function esc(v=''){return String(v).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]))}
function norm(s=''){return String(s).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[_.,;:()[\]{}\/\\-]+/g,' ').replace(/\s+/g,' ').trim()}
function last5(v=''){const d=String(v).replace(/\D/g,'');return d.slice(-5).padStart(5,'0')}
function dateVal(v){if(!v)return'';if(v instanceof Date)return v.toISOString().slice(0,10);if(typeof v==='number'){const d=XLSX.SSF.parse_date_code(v);return d?`${d.y}-${String(d.m).padStart(2,'0')}-${String(d.d).padStart(2,'0')}`:''}const m=String(v).match(/(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})/);return m?`${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`:''}
function defaultVehicles(){return[{id:'v-mario',driverName:'Márió',name:'Dobozos 1',type:'3.5 T dobozos autó',homeCity:'Vác',active:true},{id:'v-patrik',driverName:'Patrik',name:'Dobozos 2',type:'3.5 T dobozos autó',homeCity:'Kispest',active:true},{id:'v-martin',driverName:'Martin',name:'Ponyvás',type:'3.5 T plató autó',homeCity:'Felcsút',active:true}]}
function load(){const raw=localStorage.getItem(KEY);if(raw){state=JSON.parse(raw);state.aliases=state.aliases||{projects:{},suppliers:{}};state.history=state.history||[];state.settings=state.settings||{};state.settings.role=state.settings.role||'admin';state.vehicles=(state.vehicles||[]).map(v=>({...v,licensePlate:v.licensePlate||''}));return}state.projects=(SEED_DATA.projects||[]).map((x,i)=>({...x,id:'p'+i,defaultRecipientId:''}));state.suppliers=(SEED_DATA.suppliers||[]).map((x,i)=>({...x,id:'s'+i,isCentral:!!x.site&&norm(x.site)==='kozpont',pickupNote:x.note||''}));state.recipients=(SEED_DATA.recipients||[]).map((x,i)=>({...x,id:'r'+i}));state.projects.forEach(p=>{const r=state.recipients.find(x=>norm(x.project)===norm(p.name))||state.recipients.find(x=>norm(x.name)===norm(p.receiver));p.defaultRecipientId=r?.id||''});state.vehicles=defaultVehicles().map(v=>({...v,licensePlate:''}));state.history=[];save(false)}
function save(renderNow=true){localStorage.setItem(KEY,JSON.stringify(state));if(renderNow)render()}
function activeVehicles(){return state.vehicles.filter(v=>v.active)}
function selectedDate(){return $('#workDate').value||today()}
function dayOrders(vehicleId=null,date=selectedDate()){return state.orders.filter(o=>o.scheduleDate===date&&(!vehicleId||o.vehicleId===vehicleId))}
function option(v,t,sel=''){return`<option value="${esc(v)}" ${String(v)===String(sel)?'selected':''}>${esc(t)}</option>`}
function showPage(id){$$('.page').forEach(p=>p.classList.toggle('active',p.id===id));function restoreFile(file){const r=new FileReader();r.onload=()=>{try{const incoming=JSON.parse(r.result),mode=confirm('OK = összevonás, Mégse = teljes csere')?'merge':'replace';if(mode==='replace')state=incoming;else{state.orders=[...state.orders,...(incoming.orders||[]).filter(x=>!state.orders.some(y=>y.id===x.id))];state.projects=[...state.projects,...(incoming.projects||[]).filter(x=>!state.projects.some(y=>norm(y.name)===norm(x.name)))];state.suppliers=[...state.suppliers,...(incoming.suppliers||[]).filter(x=>!state.suppliers.some(y=>norm(y.name)===norm(x.name)&&norm(y.address)===norm(x.address)))];state.recipients=[...state.recipients,...(incoming.recipients||[]).filter(x=>!state.recipients.some(y=>norm(y.name)===norm(x.name)&&norm(y.project)===norm(x.project)))]}save();alert('Adatok betöltve.')}catch(e){alert('Hibás mentési fájl.')}};r.readAsText(file)}
$('#recordStart').onclick=async()=>{try{const stream=await navigator.mediaDevices.getUserMedia({audio:true});audioChunks=[];mediaRecorder=new MediaRecorder(stream);mediaRecorder.ondataavailable=e=>e.data.size&&audioChunks.push(e.data);mediaRecorder.onstop=()=>{audioBlob=new Blob(audioChunks,{type:mediaRecorder.mimeType||'audio/webm'});$('#audioPreview').src=URL.createObjectURL(audioBlob);$('#audioPreview').classList.remove('hidden');$('#recordStatus').textContent='Felvétel elkészült.';stream.getTracks().forEach(t=>t.stop())};mediaRecorder.start();$('#recordStart').disabled=true;$('#recordStop').disabled=false;$('#recordStatus').textContent='Felvétel folyamatban…'}catch(e){alert(e.message)}};
$('#recordStop').onclick=()=>{if(mediaRecorder&&mediaRecorder.state!=='inactive')mediaRecorder.stop();$('#recordStart').disabled=false;$('#recordStop').disabled=true};

function deleteVehicle(id){
 const v=state.vehicles.find(x=>x.id===id);if(!v)return;
 if(state.orders.some(o=>o.vehicleId===id)){alert('Ehhez a járműhöz fuvar tartozik. Előbb helyezd át vagy töröld ezeket a fuvarokat.');return}
 if(confirm(`Törlöd ezt a járművet?\n${v.driverName} · ${v.name}`)){state.vehicles=state.vehicles.filter(x=>x.id!==id);$('#vehicleDialog').close();save()}
}
window.deleteVehicle=deleteVehicle;

function syncSerpaNames(topicNames,supplierNames){
 const uniqueTopics=[...new Set(topicNames.filter(Boolean))];
 uniqueTopics.forEach(name=>{
   if(state.projects.some(p=>norm(p.name)===norm(name)))return;
   const candidates=state.projects.map(p=>({p,s:similarity(name,p.name)})).sort((a,b)=>b.s-a.s);
   if(candidates[0]?.s>=.55){
     const old=candidates[0].p.name;candidates[0].p.name=name;
     state.recipients.filter(r=>norm(r.project)===norm(old)).forEach(r=>r.project=name);
     state.orders.filter(o=>norm(o.projectName)===norm(old)).forEach(o=>o.projectName=name);
   }else state.projects.push({id:uid(),name,address:'',receiver:'',phone:'',type:'lerakó',active:true,defaultRecipientId:''});
 });
 const uniqueSuppliers=[...new Set(supplierNames.filter(Boolean))];
 uniqueSuppliers.forEach(name=>{
   if(state.suppliers.some(s=>norm(s.name)===norm(name)))return;
   const groups=[...new Set(state.suppliers.map(s=>s.name))].map(n=>({name:n,s:similarity(name,n)})).sort((a,b)=>b.s-a.s);
   if(groups[0]?.s>=.45){
     const old=groups[0].name;state.suppliers.filter(s=>s.name===old).forEach(s=>s.name=name);
     state.orders.filter(o=>norm(o.pickupName)===norm(old)).forEach(o=>o.pickupName=name);
   }else state.suppliers.push({id:uid(),name,site:'Központ',address:'',pickupNote:'',isCentral:true,active:true});
 });
 save(false);
}

function masterTemplateHeaders(type){
 if(type==='projects')return['Projekt neve','Cím','Alap átvevő neve','Aktív'];
 if(type==='suppliers')return['Beszállító neve','Telephely','Cím','Központ','Felrakói megjegyzés','Aktív'];
 if(type==='recipients')return['Projekt','Átvevő neve','Telefon','E-mail','Beosztás','Cég','Megjegyzés','Aktív'];
 return['Sofőr neve','Jármű neve','Rendszám','Járműtípus','Indulási település','Aktív'];
}
function downloadMasterTemplate(){
 const headers=masterTemplateHeaders(masterType),example=masterType==='projects'
 ?['Minta projekt','1234 Budapest, Minta utca 1.','Minta Átvevő','Igen']
 :masterType==='suppliers'?['Minta Kft.','Központ','1234 Budapest, Raktár utca 1.','Igen','Hátsó kapu','Igen']
 :masterType==='recipients'?['Minta projekt','Minta Átvevő','701234567','atvevo@pelda.hu','projektvezető','Minta Kft.','','Igen']
 :['Minta Sofőr','Dobozos 3','ABC-123','3.5 T dobozos autó','Budapest','Igen'];
 const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([headers,example]),'Import');
 XLSX.writeFile(wb,`${masterType}_import_sablon.xlsx`);
}
async function importMasterFile(file){
 const wb=XLSX.read(await file.arrayBuffer(),{type:'array'}),ws=wb.Sheets[wb.SheetNames[0]],rows=XLSX.utils.sheet_to_json(ws,{defval:''});
 const yes=v=>['igen','true','1','x'].includes(norm(v));
 let added=0,updated=0;
 rows.forEach(r=>{
   if(masterType==='projects'){
     const name=r['Projekt neve'];if(!name)return;let x=state.projects.find(p=>norm(p.name)===norm(name));
     const rec=state.recipients.find(z=>norm(z.name)===norm(r['Alap átvevő neve'])&&(!z.project||norm(z.project)===norm(name)));
     const obj={name,address:r['Cím']||'',defaultRecipientId:rec?.id||'',active:r['Aktív']===''?true:yes(r['Aktív'])};
     if(x){Object.assign(x,obj);updated++}else{state.projects.push({id:uid(),...obj});added++}
   }else if(masterType==='suppliers'){
     const name=r['Beszállító neve'];if(!name)return;const address=r['Cím']||'';let x=state.suppliers.find(s=>norm(s.name)===norm(name)&&norm(s.address)===norm(address));
     const obj={name,site:r['Telephely']||'',address,isCentral:yes(r['Központ']),pickupNote:r['Felrakói megjegyzés']||'',active:r['Aktív']===''?true:yes(r['Aktív'])};
     if(obj.isCentral)state.suppliers.filter(s=>norm(s.name)===norm(name)).forEach(s=>s.isCentral=false);
     if(x){Object.assign(x,obj);updated++}else{state.suppliers.push({id:uid(),...obj});added++}
   }else if(masterType==='recipients'){
     const name=r['Átvevő neve'];if(!name)return;const project=r['Projekt']||'';let x=state.recipients.find(z=>norm(z.name)===norm(name)&&norm(z.project)===norm(project));
     const obj={project,name,phone:r['Telefon']||'',email:r['E-mail']||'',role:r['Beosztás']||'',company:r['Cég']||'',note:r['Megjegyzés']||'',active:r['Aktív']===''?true:yes(r['Aktív'])};
     if(x){Object.assign(x,obj);updated++}else{state.recipients.push({id:uid(),...obj});added++}
   }else{
     const name=r['Jármű neve'];if(!name)return;const plate=r['Rendszám']||'';let x=state.vehicles.find(v=>(plate&&norm(v.licensePlate)===norm(plate))||norm(v.name)===norm(name));
     const obj={driverName:r['Sofőr neve']||'',name,licensePlate:plate,type:r['Járműtípus']||'3.5 T dobozos autó',homeCity:r['Indulási település']||'',active:r['Aktív']===''?true:yes(r['Aktív'])};
     if(x){Object.assign(x,obj);updated++}else{state.vehicles.push({id:uid(),...obj});added++}
   }
 });
 save();alert(`Import kész: ${added} új, ${updated} frissített rekord.`);
}

function orderKm(o){return Number(o.estimatedKm||0)}
function reportPeriodOrders(){
 const type=$('#reportType')?.value||'daily';
 if(type==='daily')return state.orders.filter(o=>o.scheduleDate===$('#reportDate').value);
 if(type==='monthly'){const m=$('#reportMonth').value;return state.orders.filter(o=>o.scheduleDate?.startsWith(m))}
 return state.orders;
}
function distinctCount(rows,key){return new Set(rows.map(x=>norm(x[key])).filter(Boolean)).size}
function renderReports(){
 if(!$('#reportTable'))return;
 const type=$('#reportType').value,rows=reportPeriodOrders();
 let table=[],headers=[];
 if(type==='projects'){
   headers=['Projekt','Teljesített rendelések','Beszállítók','Hiányos kiszolgálások','Nem teljesített első napi fuvarok'];
   const projects=[...new Set(rows.map(o=>o.projectName||'Egyedi úticél'))];
   table=projects.map(p=>{const pr=rows.filter(o=>(o.projectName||'Egyedi úticél')===p);return[p,pr.filter(o=>o.completed).length,distinctCount(pr,'pickupName'),pr.filter(o=>(o.items||[]).some(i=>!i.received)).length,state.history.filter(h=>h.type==='not_completed'&&h.projectName===p).length]});
 }else{
   headers=['Autó / sofőr','Felrakók','Lerakók','Megtett km','Teljesített rendelések','Nem teljesített'];
   table=state.vehicles.map(v=>{const vr=rows.filter(o=>o.vehicleId===v.id);return[`${v.driverName} · ${v.name}`,distinctCount(vr,'pickupAddress'),distinctCount(vr,'dropAddress'),Math.round(vr.reduce((a,o)=>a+orderKm(o),0)),vr.filter(o=>o.completed).length,vr.filter(o=>!o.completed).length]});
 }
 $('#reportSummary').innerHTML=`<div class="kpi">Fuvarok<b>${rows.length}</b></div><div class="kpi">Teljesített<b>${rows.filter(o=>o.completed).length}</b></div><div class="kpi">Hiányos<b>${rows.filter(o=>(o.items||[]).some(i=>!i.received)).length}</b></div><div class="kpi">Becsült km<b>${Math.round(rows.reduce((a,o)=>a+orderKm(o),0))}</b></div>`;
 $('#reportTable').innerHTML=`<div class="panel"><table class="report-table"><thead><tr>${headers.map(h=>`<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${table.map(r=>`<tr>${r.map(c=>`<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
 window.__report={headers,table,type};
}
function exportReport(){
 const r=window.__report||{headers:[],table:[],type:'daily'};
 const title=`Stand 98 - ${r.type==='monthly'?'havi':r.type==='daily'?'napi':'projekt'} fuvar kimutatás`;
 const format=norm(prompt('Formátum: excel, pdf vagy word','excel')||'excel');
 if(format.startsWith('p')){
   const {jsPDF}=window.jspdf,doc=new jsPDF({orientation:'landscape'});doc.setFontSize(15);doc.text(title,14,14);
   doc.autoTable({startY:20,head:[r.headers],body:r.table,styles:{fontSize:8}});doc.save(`${title.replaceAll(' ','_')}.pdf`);return;
 }
 if(format.startsWith('w')){
   const rows=r.table.map(row=>`<tr>${row.map(c=>`<td>${esc(c)}</td>`).join('')}</tr>`).join('');
   const body=`<!doctype html><meta charset="utf-8"><style>body{font-family:Arial}table{border-collapse:collapse;width:100%}th,td{border:1px solid #999;padding:6px}th{background:#103a56;color:#fff}</style><h1>${esc(title)}</h1><table><tr>${r.headers.map(h=>`<th>${esc(h)}</th>`).join('')}</tr>${rows}</table>`;
   const a=document.createElement('a');a.href=URL.createObjectURL(new Blob(['\ufeff'+body],{type:'application/msword'}));a.download=`${title.replaceAll(' ','_')}.doc`;a.click();return;
 }
 const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([[title],[],r.headers,...r.table]),'Kimutatás');XLSX.writeFile(wb,`${title.replaceAll(' ','_')}.xlsx`);
}
function backlogRows(){
 const events=[];
 state.orders.forEach(o=>(o.items||[]).forEach(i=>events.push({date:o.completedAt?.slice(0,10)||o.scheduleDate,project:o.projectName||'Egyedi',supplier:o.pickupName||'',code:i.code,name:i.name,qty:Number(i.qty)||0,unit:i.unit,received:!!i.received,orderNo:o.orderNo,first:o.firstScheduledDate||o.scheduleDate})));
 events.sort((a,b)=>a.date.localeCompare(b.date));
 const map=new Map();
 events.forEach(e=>{
   const key=[e.project,e.supplier,e.code,e.name].map(norm).join('|');
   if(!map.has(key))map.set(key,{project:e.project,supplier:e.supplier,code:e.code,name:e.name,qty:0,unit:e.unit,orders:new Set(),oldest:e.first});
   const x=map.get(key);
   if(e.received)x.qty=Math.max(0,x.qty-e.qty);else{x.qty+=e.qty;x.orders.add(e.orderNo);if(e.first<x.oldest)x.oldest=e.first}
 });
 return[...map.values()].filter(x=>x.qty>0);
}
function renderBacklog(){
 if(!$('#backlogList'))return;const rows=backlogRows();
 $('#backlogList').innerHTML=rows.map(x=>`<article class="backlog-card"><h3>${esc(x.project)} · ${esc(x.name)}</h3><p><b>Beszállító:</b> ${esc(x.supplier)} · <b>Hiány:</b> ${esc(x.qty)} ${esc(x.unit)}</p><p><b>Rendelések:</b> ${esc([...x.orders].join(', '))} · <b>Legrégebbi:</b> ${esc(x.oldest)}</p></article>`).join('')||'<div class="notice">Nincs aktuális hátralék.</div>';
}
function exportBacklog(){
 const rows=backlogRows(),wb=XLSX.utils.book_new(),data=[['Projekt','Beszállító','Termékkód','Termék neve','Hiányzó mennyiség','M.e.','Rendelések','Legrégebbi dátum'],...rows.map(x=>[x.project,x.supplier,x.code,x.name,x.qty,x.unit,[...x.orders].join(', '),x.oldest])];
 XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(data),'Hátralék');XLSX.writeFile(wb,'Stand_98_hátralék.xlsx');
}
function universalSearch(){
 const q=norm($('#globalSearch').value);if(!q)return;
 const groups=[];
 const orders=state.orders.filter(o=>norm(JSON.stringify(o)).includes(q)).slice(0,30);
 const projects=state.projects.filter(o=>norm(JSON.stringify(o)).includes(q)).slice(0,20);
 const suppliers=state.suppliers.filter(o=>norm(JSON.stringify(o)).includes(q)).slice(0,20);
 const recipients=state.recipients.filter(o=>norm(JSON.stringify(o)).includes(q)).slice(0,20);
 if(orders.length)groups.push(['Fuvarok',orders.map(o=>`<button class="search-hit" onclick="searchOpenOrder('${o.id}')">${esc(o.orderNo)} · ${esc(o.projectName||o.dropAddress)} · ${esc(o.scheduleDate)}</button>`).join('')]);
 if(projects.length)groups.push(['Projektek',projects.map(o=>`<button class="search-hit" onclick="searchOpenMaster('projects','${o.id}')">${esc(o.name)} · ${esc(o.address||'')}</button>`).join('')]);
 if(suppliers.length)groups.push(['Beszállítók',suppliers.map(o=>`<button class="search-hit" onclick="searchOpenMaster('suppliers','${o.id}')">${esc(o.name)} · ${esc(o.address||'')}</button>`).join('')]);
 if(recipients.length)groups.push(['Átvevők',recipients.map(o=>`<button class="search-hit" onclick="searchOpenMaster('recipients','${o.id}')">${esc(o.name)} · ${esc(o.project||'')}</button>`).join('')]);
 $('#searchResults').innerHTML=groups.map(g=>`<div class="search-group"><h4>${g[0]}</h4>${g[1]}</div>`).join('')||'<div class="notice">Nincs találat.</div>';$('#searchDialog').showModal();
}
window.searchOpenOrder=id=>{$('#searchDialog').close();showPage('orders');editOrder(id)};
window.searchOpenMaster=(type,id)=>{$('#searchDialog').close();masterType=type;showPage('masters');editMaster(id)};

$$('.nav').forEach(n=>n.classList.toggle('active',n.dataset.page===id));scrollTo(0,0);render()}
function render(){applyAfterFourRule();renderRoutes();renderOrders();renderMasters();renderVehicles();renderDriver();renderReports();renderBacklog();fillSelectors();$('#baseAddress').value=state.settings.baseAddress}
function longReason(name=''){const n=norm(name);let m=n.match(/(?:^|[^0-9])([456])\s*(?:m|meter)(?:es|eres)?\b/);if(m)return`${m[1]} méteres szálanyag`;m=n.match(/\b(4000|5000|6000)\s*mm\b/);if(m&&/(szal|cso|acel|rud|profil)/.test(n))return`${+m[1]/1000} méteres szálanyag`;return''}
function canCarryLong(v){return/(plato|kcr|kamion)/.test(norm(v.type))}
function centralSupplier(name){const group=state.suppliers.filter(s=>norm(s.name)===norm(name));return group.find(s=>s.isCentral)||group[0]||null}
function renderRoutes(){const vehicles=activeVehicles();$('#routes').innerHTML=vehicles.map(v=>{const list=dayOrders(v.id).sort((a,b)=>(+a.sequence||999)-(+b.sequence||999));return`<section class="route"><header class="route-head"><h2><input value="${esc(v.driverName)}" onchange="renameDriver('${v.id}',this.value)"></h2><small>${esc(v.name)} · ${esc(v.type)} · ${list.length} fuvar</small><div class="route-summary" id="summary-${v.id}"></div></header><div id="map-${v.id}" class="map"></div><div id="route-${v.id}" class="route-list">${bubbles(list)}</div></section>`}).join('')||'<div class="notice">Nincs aktív jármű.</div>';setTimeout(initMaps,30);setTimeout(initSortables,40);setTimeout(updateSummaries,60)}
function bubbles(list){if(!list.length)return'<div class="notice">Nincs fuvar.</div>';return list.map((o,i)=>`<article class="bubble ${o.completed?'done':''}" data-id="${o.id}"><span class="drag">☷</span><h3>${i+1}. ${esc(o.orderNo)} · ${esc(o.projectName||'Egyedi úticél')}</h3><p class="pickup-prominent">Felrakó: ${esc(o.pickupName||'Nincs megadva')}</p><p>${esc(o.pickupAddress||'')}</p><p><b>Lerakó:</b> ${esc(o.dropAddress||'Nincs megadva')}</p>${o.pickupNote?`<p><b>Felrakói megj.:</b> ${esc(o.pickupNote)}</p>`:''}<div class="tags"><span class="tag">${o.items?.length||0} tétel</span>${o.longMaterialReason?`<span class="tag long">${esc(o.longMaterialReason)}</span>`:''}${o.requestedDeadline?`<span class="tag ${o.scheduleDate>o.requestedDeadline?'warn':''}">${o.requestedDeadline}</span>`:''}</div><div class="bubble-actions"><button onclick="editOrder('${o.id}')">Szerkesztés</button><button onclick="openItems('${o.id}')">Tételek</button><button onclick="openCamera('${o.id}')">📷 Kamera</button></div><button class="complete-button ${o.completed?'done':''}" onclick="toggleComplete('${o.id}')">${o.completed?'✓':'○'}</button><button class="trash" onclick="deleteOne('${o.id}')">🗑</button></article>`).join('')}
window.renameDriver=(id,name)=>{const v=state.vehicles.find(x=>x.id===id);if(v){v.driverName=name.trim()||v.driverName;save()}};
function initSortables(){activeVehicles().forEach(v=>{const el=$('#route-'+v.id);if(!el)return;new Sortable(el,{group:'vehicles',animation:180,handle:'.drag',onEnd:e=>{const o=state.orders.find(x=>x.id===e.item.dataset.id);if(o)o.vehicleId=e.to.id.replace('route-','');activeVehicles().forEach(x=>{$$('#route-'+x.id+' .bubble').forEach((n,i)=>{const r=state.orders.find(o=>o.id===n.dataset.id);if(r)r.sequence=i+1})});save()}})})}
async function geo(addr){if(!addr)return null;if(state.geo[addr])return state.geo[addr];try{const r=await fetch('https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=hu&q='+encodeURIComponent(addr));const j=await r.json();if(j[0]){state.geo[addr]=[+j[0].lat,+j[0].lon];save(false);await new Promise(r=>setTimeout(r,1050));return state.geo[addr]}}catch{}return null}
function initMaps(){activeVehicles().forEach(v=>{if(maps[v.id])maps[v.id].remove();maps[v.id]=L.map('map-'+v.id).setView([47.45,19.04],9);L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© OpenStreetMap'}).addTo(maps[v.id]);drawMap(v.id)})}
async function roadRoute(pts){if(pts.length<2)return null;try{const c=pts.map(p=>`${p[1]},${p[0]}`).join(';');const r=await fetch(`https://router.project-osrm.org/route/v1/driving/${c}?overview=full&geometries=geojson`);const j=await r.json();return j.routes?.[0]||null}catch{return null}}
async function drawMap(id){const map=maps[id],pts=[];const base=await geo(state.settings.baseAddress);if(base)pts.push(base);for(const o of dayOrders(id).sort((a,b)=>(+a.sequence||999)-(+b.sequence||999))){const p=await geo(o.dropAddress);if(p){pts.push(p);L.marker(p).addTo(map).bindPopup(`${esc(o.orderNo)} · ${esc(o.projectName||o.dropAddress)}`)}}if(pts.length){const rr=await roadRoute(pts);const coords=rr?rr.geometry.coordinates.map(c=>[c[1],c[0]]):pts;const line=L.polyline(coords,{weight:4}).addTo(map);map.fitBounds(line.getBounds(),{padding:[20,20]})}}
async function vehicleHome(v){const known={vac:'Vác',kispest:'1191 Budapest, Kispest',felcsut:'Felcsút'};return await geo(known[norm(v.homeCity)]||v.homeCity||state.settings.baseAddress)||await geo(state.settings.baseAddress)}
function dist(a,b){if(!a||!b)return 999;const R=6371,r=Math.PI/180,d1=(b[0]-a[0])*r,d2=(b[1]-a[1])*r,x=Math.sin(d1/2)**2+Math.cos(a[0]*r)*Math.cos(b[0]*r)*Math.sin(d2/2)**2;return R*2*Math.atan2(Math.sqrt(x),Math.sqrt(1-x))}
async function balance(){const active=activeVehicles();if(!active.length)return alert('Nincs aktív jármű.');const orders=state.orders.filter(o=>o.scheduleDate===selectedDate()),longCars=active.filter(canCarryLong);for(const o of orders){if(o.longMaterialReason){const target=longCars.find(v=>norm(v.driverName).includes('martin'))||longCars[0];if(target)o.vehicleId=target.id}}
const homes={};for(const v of active)homes[v.id]=await vehicleHome(v);const loads=Object.fromEntries(active.map(v=>[v.id,orders.filter(o=>o.vehicleId===v.id&&o.longMaterialReason).length*2]));for(const o of orders.filter(o=>!o.longMaterialReason)){const p=await geo(o.pickupAddress||o.dropAddress);const ranked=active.map(v=>({v,score:(loads[v.id]||0)*12+dist(homes[v.id],p)})).sort((a,b)=>a.score-b.score);o.vehicleId=ranked[0].v.id;loads[o.vehicleId]=(loads[o.vehicleId]||0)+2}active.forEach(v=>dayOrders(v.id).forEach((o,i)=>o.sequence=i+1));save();alert('A fuvarokat az aktív autók, a sofőrök indulási helye és a terhelés alapján szétosztottam.')}
async function optimizeAll(){
 for(const v of activeVehicles()){
   const orders=dayOrders(v.id),start=await geo(state.settings.baseAddress);let current=start,left=[];
   for(const o of orders)left.push({o,p:await geo(o.dropAddress)});
   const ordered=[];
   while(left.length){left.sort((a,b)=>dist(current,a.p)-dist(current,b.p));const n=left.shift();n.o.estimatedKm=n.p&&current?Math.round(dist(current,n.p)*1.22*10)/10:0;ordered.push(n.o);if(n.p)current=n.p}
   ordered.forEach((o,i)=>o.sequence=i+1)
 }
 save();alert('Az útvonalak sorrendjét optimalizáltam, és a becsült kilométereket frissítettem.')
}
async function updateSummaries(){for(const v of activeVehicles()){const orders=dayOrders(v.id),pick=new Set(orders.map(o=>norm(o.pickupAddress)).filter(Boolean)),drop=new Set(orders.map(o=>norm(o.dropAddress)).filter(Boolean));const el=$('#summary-'+v.id);if(el)el.textContent=`${pick.size} felrakó · ${drop.size} lerakó · kb. ${Math.max(0,orders.length*35)} perc rakodás`}}
function toggleComplete(id){const o=state.orders.find(x=>x.id===id);if(!o)return;o.completed=!o.completed;o.completedAt=o.completed?new Date().toISOString():'';if(o.completed)(o.items||[]).forEach(i=>i.received=true);save()}
function applyAfterFourRule(){
 const now=new Date();if(now.getHours()<16)return;
 const d=today(),next=new Date();next.setDate(next.getDate()+1);const nd=next.toISOString().slice(0,10);let changed=false;
 state.orders.forEach(o=>{
   if(o.scheduleDate===d&&!o.completed&&!o.carriedDates?.includes(d)){
     o.firstScheduledDate=o.firstScheduledDate||d;o.carriedDates=o.carriedDates||[];o.carriedDates.push(d);
     if((o.firstScheduledDate||d)===d)state.history.push({type:'not_completed',orderId:o.id,orderNo:o.orderNo,projectName:o.projectName,date:d,vehicleId:o.vehicleId,reason:'első napi fuvar nem teljesült'});
     o.scheduleDate=nd;changed=true;
   }
 });
 if(changed){localStorage.setItem(KEY,JSON.stringify(state));$('#dayWarning').classList.remove('hidden');$('#dayWarning').textContent='A 16:00 után nem teljesített mai fuvarokat a program áthelyezte a következő napra.'}
}
function renderOrders(){const q=norm($('#orderSearch').value),vf=$('#orderVehicleFilter').value;const rows=state.orders.filter(o=>(!q||norm(Object.values(o).join(' ')).includes(q))&&(!vf||o.vehicleId===vf)).sort((a,b)=>a.scheduleDate.localeCompare(b.scheduleDate));$('#orderList').innerHTML=rows.map(o=>`<article class="card"><h3>${esc(o.orderNo)} · ${esc(o.projectName||'Egyedi úticél')}</h3><p>${o.scheduleDate} · ${esc(state.vehicles.find(v=>v.id===o.vehicleId)?.driverName||'Nincs kiosztva')}</p><p>${esc(o.pickupName||'')} → ${esc(o.dropAddress||'')}</p><div class="card-actions"><button onclick="editOrder('${o.id}')">Szerkesztés</button><button onclick="openItems('${o.id}')">Tételek</button><button onclick="deleteOne('${o.id}')">Törlés</button></div></article>`).join('')||'<div class="notice">Nincs találat.</div>'}
function renderVehicles(){$('#vehicleList').innerHTML=state.vehicles.map(v=>`<article class="card vehicle-card ${v.active?'':'inactive'}"><div><h3>${esc(v.driverName)} · ${esc(v.name)}</h3><p>${esc(v.type)} · ${esc(v.homeCity||'')} ${v.licensePlate?'· '+esc(v.licensePlate):'· nincs rendszám'}</p><div class="card-actions"><button onclick="editVehicle('${v.id}')">Szerkesztés</button><button onclick="deleteVehicle('${v.id}')">Törlés</button></div></div><label class="switch"><input type="checkbox" ${v.active?'checked':''} onchange="toggleVehicle('${v.id}',this.checked)"> Aktív</label></article>`).join('')}
window.toggleVehicle=(id,val)=>{const v=state.vehicles.find(x=>x.id===id);if(v){v.active=val;if(!val){const active=state.vehicles.filter(x=>x.active);state.orders.filter(o=>o.vehicleId===id).forEach(o=>o.vehicleId=active[0]?.id||'')}save()}};
function renderDriver(){const vid=$('#driverVehicleSelect').value||activeVehicles()[0]?.id,date=$('#driverDate').value||selectedDate();const rows=dayOrders(vid,date).sort((a,b)=>(+a.sequence||999)-(+b.sequence||999));$('#driverTasks').innerHTML=rows.map((o,i)=>`<article class="driver-task ${o.completed?'done':''}"><h3>${i+1}. ${esc(o.orderNo)} · ${esc(o.projectName||o.dropAddress)}</h3><p><b>Felrakó:</b> ${esc(o.pickupName)} · ${esc(o.pickupAddress)}</p><p><b>Lerakó:</b> ${esc(o.dropAddress)}</p><button onclick="toggleComplete('${o.id}')">${o.completed?'✓ Minden tétel rendben':'○ Átvétel rendben'}</button><button class="secondary" onclick="openItems('${o.id}')">Tételek külön pipálása</button><button class="secondary" onclick="openCamera('${o.id}')">📷 Szállítólevél fotózása</button></article>`).join('')||'<div class="notice">Nincs feladat.</div>'}
function fillSelectors(){const vehicleOpts='<option value="">Nincs kiosztva</option>'+state.vehicles.map(v=>option(v.id,`${v.driverName} · ${v.name}${v.active?'':' (kikapcsolva)'}`)).join('');$('#vehicleId').innerHTML=vehicleOpts;$('#orderVehicleFilter').innerHTML='<option value="">Minden autó</option>'+state.vehicles.map(v=>option(v.id,v.driverName)).join('');$('#driverVehicleSelect').innerHTML=activeVehicles().map(v=>option(v.id,`${v.driverName} · ${v.name}`,$('#driverVehicleSelect').value)).join('');if(!$('#driverDate').value)$('#driverDate').value=selectedDate()}
function renderMasters(){
 const q=norm($('#masterSearch').value);
 if(masterType==='vehicles'){
   const arr=state.vehicles.filter(x=>!q||norm(Object.values(x).join(' ')).includes(q));
   $('#masterList').innerHTML=arr.map(v=>`<article class="card"><h3>${esc(v.driverName)} · ${esc(v.name)}</h3><p>${esc(v.type)} · ${esc(v.licensePlate||'nincs rendszám')} · ${v.active?'aktív':'kikapcsolva'}</p><div class="card-actions"><button onclick="editVehicle('${v.id}')">Szerkesztés</button><button onclick="deleteVehicle('${v.id}')">Törlés</button></div></article>`).join('')||'<div class="notice">Nincs találat.</div>';return;
 }
 const arr=state[masterType].filter(x=>!q||norm(Object.values(x).join(' ')).includes(q));
 $('#masterList').innerHTML=arr.map(x=>`<article class="card"><h3>${esc(x.name)}</h3><p>${esc(x.address||x.project||'')} ${esc(x.phone||'')}</p>${masterType==='suppliers'?`<p>${x.isCentral?'★ Központi telephely':''}</p>`:''}<div class="card-actions"><button onclick="editMaster('${x.id}')">Szerkesztés</button><button onclick="deleteMaster('${x.id}')">Törlés</button></div></article>`).join('')||'<div class="notice">Nincs találat.</div>';
}
function supplierOptions(sel=''){return'<option value="">Egyedi / nincs kiválasztva</option>'+state.suppliers.sort((a,b)=>a.name.localeCompare(b.name,'hu')).map(s=>option(s.id,`${s.name}${s.isCentral?' ★ központ':''} · ${s.address}`,sel)).join('')}
function projectOptions(sel=''){return'<option value="">Egyedi úticél</option>'+state.projects.sort((a,b)=>a.name.localeCompare(b.name,'hu')).map(p=>option(p.id,p.name,sel)).join('')}
function recipientOptions(project,sel=''){return'<option value="">Nincs átvevő</option>'+state.recipients.filter(r=>!project||norm(r.project)===norm(project)).map(r=>option(r.id,`${r.name} · ${r.phone||''}`,sel)).join('')}
function openOrder(o={}){$('#orderId').value=o.id||'';$('#orderTitle').textContent=o.id?'Fuvar szerkesztése':'Új fuvar';$('#scheduleDate').value=o.scheduleDate||selectedDate();fillSelectors();$('#vehicleId').value=o.vehicleId||'';$('#orderNo').value=o.orderNo||'';$('#deadline').value=o.requestedDeadline||'';$('#supplierId').innerHTML=supplierOptions(o.supplierId);$('#pickupAddress').value=o.pickupAddress||'';$('#pickupNote').value=o.pickupNote||'';$('#projectId').innerHTML=projectOptions(o.projectId);$('#dropAddress').value=o.dropAddress||'';$('#recipientId').innerHTML=recipientOptions(o.projectName,o.recipientId);$('#recipientPhone').value=o.recipientPhone||'';$('#recipientEmail').value=o.recipientEmail||'';$('#pickupFrom').value=o.pickupFrom||'';$('#pickupTo').value=o.pickupTo||'';$('#dropFrom').value=o.dropFrom||'';$('#dropTo').value=o.dropTo||'';$('#orderNote').value=o.note||'';$('#orderDialog').showModal()}
window.editOrder=id=>openOrder(state.orders.find(x=>x.id===id));
$('#orderForm').onsubmit=e=>{e.preventDefault();const old=state.orders.find(x=>x.id===$('#orderId').value),s=state.suppliers.find(x=>x.id===$('#supplierId').value),p=state.projects.find(x=>x.id===$('#projectId').value),r=state.recipients.find(x=>x.id===$('#recipientId').value);const o={...old,id:old?.id||uid(),scheduleDate:$('#scheduleDate').value,vehicleId:$('#vehicleId').value,orderNo:last5($('#orderNo').value),requestedDeadline:$('#deadline').value,supplierId:s?.id||'',pickupName:s?.name||old?.pickupName||'',pickupAddress:$('#pickupAddress').value,pickupNote:$('#pickupNote').value,projectId:p?.id||'',projectName:p?.name||old?.projectName||'',dropAddress:$('#dropAddress').value,recipientId:r?.id||'',recipientName:r?.name||'',recipientPhone:$('#recipientPhone').value,recipientEmail:$('#recipientEmail').value,pickupFrom:$('#pickupFrom').value,pickupTo:$('#pickupTo').value,dropFrom:$('#dropFrom').value,dropTo:$('#dropTo').value,note:$('#orderNote').value,items:old?.items||[],completed:old?.completed||false,sequence:old?.sequence||999,firstScheduledDate:old?.firstScheduledDate||$('#scheduleDate').value};const i=state.orders.findIndex(x=>x.id===o.id);if(i>=0)state.orders[i]=o;else state.orders.push(o);$('#orderDialog').close();save()}
$('#supplierId').onchange=()=>{const s=state.suppliers.find(x=>x.id===$('#supplierId').value),c=s?(centralSupplier(s.name)||s):null;$('#pickupAddress').value=c?.address||'';$('#pickupNote').value=c?.pickupNote||''};
$('#projectId').onchange=()=>{const p=state.projects.find(x=>x.id===$('#projectId').value);$('#dropAddress').value=p?.address||'';$('#recipientId').innerHTML=recipientOptions(p?.name,p?.defaultRecipientId);const r=state.recipients.find(x=>x.id===p?.defaultRecipientId);$('#recipientPhone').value=r?.phone||p?.phone||'';$('#recipientEmail').value=r?.email||''};
$('#recipientId').onchange=()=>{const r=state.recipients.find(x=>x.id===$('#recipientId').value);$('#recipientPhone').value=r?.phone||'';$('#recipientEmail').value=r?.email||''};
function deleteOne(id){const o=state.orders.find(x=>x.id===id);if(o&&confirm(`Törlöd ezt a fuvart?\n${o.orderNo} · ${o.projectName||o.dropAddress}`)){state.orders=state.orders.filter(x=>x.id!==id);save()}}
function deleteAll(){if(!state.orders.length)return alert('Nincs törölhető fuvar.');if(confirm(`${state.orders.length} fuvar törlődik. Folytatod?`)&&prompt('Írd be: TÖRLÉS')?.toUpperCase()==='TÖRLÉS'){state.orders=[];save()}}
function openItems(id){const o=state.orders.find(x=>x.id===id);$('#itemsTitle').textContent=`${o.orderNo} · tételek`;$('#itemsBody').innerHTML=(o.items||[]).map((it,i)=>`<label class="item-row ${it.received?'done':''}"><input type="checkbox" ${it.received?'checked':''} onchange="toggleItem('${id}',${i},this.checked)"><span><b class="item-name">${esc(it.name)}</b><br>${esc(it.code)} · ${esc(it.qty)} ${esc(it.unit)} ${it.longMaterial?'· hosszú szál':''}</span></label>`).join('')||'<div class="notice">Nincs tétel.</div>';$('#itemsDialog').showModal()}
window.openItems=openItems;window.toggleItem=(id,i,val)=>{const o=state.orders.find(x=>x.id===id);o.items[i].received=val;o.completed=(o.items||[]).length>0&&o.items.every(x=>x.received);save(false);openItems(id)};
function openCamera(id){const o=state.orders.find(x=>x.id===id);$('#cameraOrderId').value=id;$('#cameraTitle').textContent=`${o.orderNo} · szállítólevél`;$('#cameraPreview').innerHTML='';$('#cameraNote').value='';$('#cameraInput').value='';$('#cameraDialog').showModal()}
window.openCamera=openCamera;$('#cameraInput').onchange=e=>{$('#cameraPreview').innerHTML=[...e.target.files].map(f=>`<img src="${URL.createObjectURL(f)}">`).join('')};$('#cameraForm').onsubmit=e=>{e.preventDefault();const o=state.orders.find(x=>x.id===$('#cameraOrderId').value);o.deliveryReports=o.deliveryReports||[];o.deliveryReports.push({at:new Date().toISOString(),note:$('#cameraNote').value,photoCount:$('#cameraInput').files.length,hasAudio:!!audioBlob});$('#cameraDialog').close();save();alert('A fotó és megjegyzés helyben rögzítve.')};
function editVehicle(id){const v=state.vehicles.find(x=>x.id===id)||{};$('#vehicleTitle').textContent=v.id?'Jármű szerkesztése':'Új jármű';$('#editVehicleId').value=v.id||'';$('#driverName').value=v.driverName||'';$('#vehicleName').value=v.name||'';$('#licensePlate').value=v.licensePlate||'';$('#deleteVehicleDialogBtn').classList.toggle('hidden',!v.id);$('#vehicleType').innerHTML=VEHICLE_TYPES.map(t=>option(t,t,v.type)).join('');$('#homeCity').value=v.homeCity||'';$('#vehicleActive').checked=v.active!==false;$('#vehicleDialog').showModal()}
window.editVehicle=editVehicle;$('#vehicleForm').onsubmit=e=>{e.preventDefault();const id=$('#editVehicleId').value,v={id:id||uid(),driverName:$('#driverName').value,name:$('#vehicleName').value,licensePlate:$('#licensePlate').value.trim(),type:$('#vehicleType').value,homeCity:$('#homeCity').value,active:$('#vehicleActive').checked};const i=state.vehicles.findIndex(x=>x.id===id);if(i>=0)state.vehicles[i]=v;else state.vehicles.push(v);$('#vehicleDialog').close();save()}
function masterFields(){if(masterType==='projects')return[['name','Projekt neve'],['address','Cím'],['defaultRecipientId','Alap átvevő']];if(masterType==='suppliers')return[['name','Cégnév'],['site','Telephely'],['address','Cím'],['pickupNote','Felrakói megjegyzés'],['isCentral','Központi telephely']];return[['project','Projekt'],['name','Átvevő neve'],['phone','Telefon'],['email','E-mail']]}
function openMaster(x={}){$('#masterTitle').textContent=x.id?'Szerkesztés':'Új adat';$('#editMasterId').value=x.id||'';$('#masterFields').innerHTML=masterFields().map(([k,l])=>{if(k==='defaultRecipientId')return`<label>${l}<select data-mf="${k}"><option value="">Nincs</option>${state.recipients.map(r=>option(r.id,`${r.name} · ${r.project}`,x[k])).join('')}</select></label>`;if(k==='isCentral')return`<label class="check"><input data-mf="${k}" type="checkbox" ${x[k]?'checked':''}> ${l}</label>`;return`<label>${l}<input data-mf="${k}" value="${esc(x[k]||'')}"></label>`}).join('');$('#masterDialog').showModal()}
window.editMaster=id=>openMaster(state[masterType].find(x=>x.id===id));window.deleteMaster=id=>{if(confirm('Törlöd?')){state[masterType]=state[masterType].filter(x=>x.id!==id);save()}};
$('#masterForm').onsubmit=e=>{e.preventDefault();const id=$('#editMasterId').value,obj={id:id||uid(),active:true};$$('[data-mf]').forEach(x=>obj[x.dataset.mf]=x.type==='checkbox'?x.checked:x.value.trim());if(masterType==='suppliers'&&obj.isCentral)state.suppliers.filter(s=>norm(s.name)===norm(obj.name)).forEach(s=>s.isCentral=false);const i=state[masterType].findIndex(x=>x.id===id);if(i>=0)state[masterType][i]={...state[masterType][i],...obj};else state[masterType].push(obj);$('#masterDialog').close();save()}
function headerMap(headers){const find=names=>headers.map(norm).findIndex(h=>names.map(norm).includes(h));const map={doc:find(['Bizonylatszám']),topic:find(['Témaszám név']),code:find(['Termék kód','Termékkód']),product:find(['Termék név','Terméknév']),supplier:find(['Ügyfél/raktár','Ügyfél/raktár név']),qty:find(['Tétel mennyiség']),unit:find(['M.e.']),deadline:find(['Kért szállítási határidő']),note:find(['Megjegyzés'])};map.date=headers.length-2;map.driver=headers.length-1;return map}
function similarity(a,b){a=norm(a);b=norm(b);if(a===b)return 1;const aw=a.split(' '),bw=b.split(' '),common=aw.filter(x=>bw.includes(x)).length;return common/Math.max(aw.length,bw.length)}
function projectMatch(topic){const alias=state.aliases.projects[norm(topic)];if(alias)return state.projects.find(p=>p.id===alias);const scores=state.projects.map(p=>({p,s:similarity(topic,p.name)})).sort((a,b)=>b.s-a.s);return scores[0]?.s>=.75&&(!scores[1]||scores[0].s-scores[1].s>.15)?scores[0].p:null}
function supplierMatch(name){const alias=state.aliases.suppliers[norm(name)];if(alias)return state.suppliers.find(s=>s.id===alias);const exact=centralSupplier(name);if(exact)return exact;const companies=[...new Set(state.suppliers.map(s=>s.name))].filter(n=>norm(name).includes(norm(n))||norm(n).includes(norm(name)));return companies.length===1?centralSupplier(companies[0]):null}
async function readExcel(file){const wb=XLSX.read(await file.arrayBuffer(),{type:'array',cellDates:true}),ws=wb.Sheets[wb.SheetNames[0]],rows=XLSX.utils.sheet_to_json(ws,{header:1,defval:''}),h=headerMap(rows[0].map(String));if(norm(rows[0][h.date])!=='datum')return alert('Az utolsó előtti oszlop neve nem Dátum.');const g={};for(const r of rows.slice(1)){const date=dateVal(r[h.date]);if(!date)continue;const no=last5(r[h.doc]),topic=String(r[h.topic]||''),sup=String(r[h.supplier]||''),key=[date,no,topic,sup].join('|'),lr=longReason(r[h.product]);if(!g[key])g[key]={id:uid(),scheduleDate:date,vehicleId:'',sequence:999,orderNo:no,topicName:topic,pickupName:sup,pickupAddress:'',pickupNote:'',projectName:'',dropAddress:'',recipientName:'',recipientPhone:'',recipientEmail:'',requestedDeadline:dateVal(r[h.deadline]),note:h.note>=0?String(r[h.note]||''):'',items:[],longMaterialReason:'',firstScheduledDate:date};if(lr)g[key].longMaterialReason=lr;g[key].items.push({code:String(r[h.code]||''),name:String(r[h.product]||''),qty:r[h.qty],unit:String(r[h.unit]||''),longMaterial:!!lr,received:false});if(norm(r[h.driver]).includes('martin'))g[key].markedMartin=true}importOrders=Object.values(g);syncSerpaNames(importOrders.map(o=>o.topicName),importOrders.map(o=>o.pickupName));importOrders.forEach(o=>{const p=projectMatch(o.topicName),s=supplierMatch(o.pickupName);if(p){o.projectId=p.id;o.projectName=p.name;o.dropAddress=p.address;const rec=state.recipients.find(r=>r.id===p.defaultRecipientId);if(rec){o.recipientId=rec.id;o.recipientName=rec.name;o.recipientPhone=rec.phone;o.recipientEmail=rec.email}}if(s){o.supplierId=s.id;o.pickupName=s.name;o.pickupAddress=s.address;o.pickupNote=s.pickupNote||''}});const longCars=activeVehicles().filter(canCarryLong),martin=longCars.find(v=>norm(v.driverName).includes('martin'))||longCars[0];importOrders.forEach(o=>{if(o.markedMartin||o.longMaterialReason)o.vehicleId=martin?.id||''});$('#importPreview').textContent=`${importOrders.length} összesített rendelés. Bizonytalan/hiányos: ${importOrders.filter(needsReview).length}.`;$('#startReviewBtn').disabled=false}
function needsReview(o){return!o.projectId||!o.supplierId||!o.dropAddress||!o.vehicleId}
function startReview(){reviewQueue=importOrders.filter(needsReview);reviewIndex=0;if(!reviewQueue.length){finalizeImport();return}showReview()}
function showReview(){const o=reviewQueue[reviewIndex];$('#reviewTitle').textContent=`${o.orderNo} · ${o.topicName||'Egyedi'}`;$('#reviewCounter').textContent=`${reviewIndex+1} / ${reviewQueue.length}`;$('#reviewFields').innerHTML=`<label>Projekt<select id="rvProject" onchange="reviewProjectChanged()" class="${o.projectId?'':'review-error'}">${projectOptions(o.projectId)}</select></label><label>Lerakó cím<input id="rvDrop" class="${o.dropAddress?'':'review-error'}" value="${esc(o.dropAddress||'')}"></label><label>Beszállító<select id="rvSupplier" onchange="reviewSupplierChanged()" class="${o.supplierId?'':'review-error'}">${supplierOptions(o.supplierId)}</select></label><label>Felrakó cím<input id="rvPickup" class="${o.pickupAddress?'':'review-error'}" value="${esc(o.pickupAddress||'')}"></label><label>Jármű<select id="rvVehicle" class="${o.vehicleId?'':'review-error'}"><option value="">Később osztom ki</option>${activeVehicles().map(v=>option(v.id,`${v.driverName} · ${v.name}`,o.vehicleId)).join('')}</select></label><label>Fuvar megjegyzés<textarea id="rvNote">${esc(o.note||'')}</textarea></label>`;$('#reviewDialog').showModal()}
function reviewProjectChanged(){const p=state.projects.find(x=>x.id===$('#rvProject').value);if(!p)return;$('#rvDrop').value=p.address||'';const rec=state.recipients.find(r=>r.id===p.defaultRecipientId);if(rec){if($('#rvRecipient'))$('#rvRecipient').value=rec.id;if($('#rvPhone'))$('#rvPhone').value=rec.phone||''}}
function reviewSupplierChanged(){const s=state.suppliers.find(x=>x.id===$('#rvSupplier').value);if(!s)return;const c=centralSupplier(s.name)||s;$('#rvPickup').value=c.address||''}
function saveReview(){const o=reviewQueue[reviewIndex],p=state.projects.find(x=>x.id===$('#rvProject').value),s=state.suppliers.find(x=>x.id===$('#rvSupplier').value);o.projectId=p?.id||'';o.projectName=p?.name||o.topicName||'';o.dropAddress=$('#rvDrop').value;o.supplierId=s?.id||'';o.pickupName=s?.name||o.pickupName;o.pickupAddress=$('#rvPickup').value;o.vehicleId=$('#rvVehicle').value;o.note=$('#rvNote').value;if(p)state.aliases.projects[norm(o.topicName)]=p.id;if(s)state.aliases.suppliers[norm(o.pickupName)]=s.id;reviewIndex++;if(reviewIndex>=reviewQueue.length){$('#reviewDialog').close();finalizeImport()}else showReview()}
function finalizeImport(){state.orders.push(...importOrders);importOrders=[];balance();$('#importDialog').close();save();alert('Import beillesztve. Az üresen hagyott mezők később is szerkeszthetők.')}
function exportExcel(){const rows=state.orders.filter(o=>o.scheduleDate===selectedDate());const wb=XLSX.utils.book_new(),main=[['Jármű','Sorrend','Rendelésszám','Felrakó','Felrakó cím','Projekt','Lerakó cím','Átvevő','Telefon','Időablak','Megjegyzés']];rows.forEach(o=>main.push([state.vehicles.find(v=>v.id===o.vehicleId)?.driverName||'',o.sequence,o.orderNo,o.pickupName,o.pickupAddress,o.projectName,o.dropAddress,o.recipientName,o.recipientPhone,[o.pickupFrom&&`F ${o.pickupFrom}-${o.pickupTo}`,o.dropFrom&&`L ${o.dropFrom}-${o.dropTo}`].filter(Boolean).join('; '),o.note]));const items=[['Rendelésszám','Termékkód','Termék név','Mennyiség','M.e.','Átvéve']];rows.forEach(o=>(o.items||[]).forEach(i=>items.push([o.orderNo,i.code,i.name,i.qty,i.unit,i.received?'Igen':'Nem'])));XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(main),'Fuvarok');XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(items),'Tételek');XLSX.writeFile(wb,`${selectedDate()}_fuvarok.xlsx`)}
function exportPdf(){const rows=state.orders.filter(o=>o.scheduleDate===selectedDate()),{jsPDF}=window.jspdf,doc=new jsPDF({orientation:'landscape'});doc.text(`Fuvarok - ${selectedDate()}`,14,14);doc.autoTable({startY:20,head:[['Jármű','#','Rendelés','Felrakó','Lerakó','Átvevő','Megjegyzés']],body:rows.map(o=>[state.vehicles.find(v=>v.id===o.vehicleId)?.driverName||'',o.sequence,o.orderNo,`${o.pickupName}\n${o.pickupAddress}`,`${o.projectName}\n${o.dropAddress}`,`${o.recipientName||''}\n${o.recipientPhone||''}`,o.note||'']),styles:{fontSize:7}});doc.save(`${selectedDate()}_fuvarok.pdf`)}
function exportMenu(){const t=prompt('Export: excel vagy pdf','excel');if(norm(t).startsWith('p'))exportPdf();else exportExcel()}
function backup(){const blob=new Blob([JSON.stringify(state,null,2)],{type:'application/json'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='fuvarszervezo-v11-telefonra.json';a.click()}
function restoreFile(file){const r=new FileReader();r.onload=()=>{try{const incoming=JSON.parse(r.result),mode=confirm('OK = összevonás, Mégse = teljes csere')?'merge':'replace';if(mode==='replace')state=incoming;else{state.orders=[...state.orders,...(incoming.orders||[]).filter(x=>!state.orders.some(y=>y.id===x.id))];state.projects=[...state.projects,...(incoming.projects||[]).filter(x=>!state.projects.some(y=>norm(y.name)===norm(x.name)))];state.suppliers=[...state.suppliers,...(incoming.suppliers||[]).filter(x=>!state.suppliers.some(y=>norm(y.name)===norm(x.name)&&norm(y.address)===norm(x.address)))];state.recipients=[...state.recipients,...(incoming.recipients||[]).filter(x=>!state.recipients.some(y=>norm(y.name)===norm(x.name)&&norm(y.project)===norm(x.project)))]}save();alert('Adatok betöltve.')}catch(e){alert('Hibás mentési fájl.')}};r.readAsText(file)}
$('#recordStart').onclick=async()=>{try{const stream=await navigator.mediaDevices.getUserMedia({audio:true});audioChunks=[];mediaRecorder=new MediaRecorder(stream);mediaRecorder.ondataavailable=e=>e.data.size&&audioChunks.push(e.data);mediaRecorder.onstop=()=>{audioBlob=new Blob(audioChunks,{type:mediaRecorder.mimeType||'audio/webm'});$('#audioPreview').src=URL.createObjectURL(audioBlob);$('#audioPreview').classList.remove('hidden');$('#recordStatus').textContent='Felvétel elkészült.';stream.getTracks().forEach(t=>t.stop())};mediaRecorder.start();$('#recordStart').disabled=true;$('#recordStop').disabled=false;$('#recordStatus').textContent='Felvétel folyamatban…'}catch(e){alert(e.message)}};
$('#recordStop').onclick=()=>{if(mediaRecorder&&mediaRecorder.state!=='inactive')mediaRecorder.stop();$('#recordStart').disabled=false;$('#recordStop').disabled=true};

function deleteVehicle(id){
 const v=state.vehicles.find(x=>x.id===id);if(!v)return;
 if(state.orders.some(o=>o.vehicleId===id)){alert('Ehhez a járműhöz fuvar tartozik. Előbb helyezd át vagy töröld ezeket a fuvarokat.');return}
 if(confirm(`Törlöd ezt a járművet?\n${v.driverName} · ${v.name}`)){state.vehicles=state.vehicles.filter(x=>x.id!==id);$('#vehicleDialog').close();save()}
}
window.deleteVehicle=deleteVehicle;

function syncSerpaNames(topicNames,supplierNames){
 const uniqueTopics=[...new Set(topicNames.filter(Boolean))];
 uniqueTopics.forEach(name=>{
   if(state.projects.some(p=>norm(p.name)===norm(name)))return;
   const candidates=state.projects.map(p=>({p,s:similarity(name,p.name)})).sort((a,b)=>b.s-a.s);
   if(candidates[0]?.s>=.55){
     const old=candidates[0].p.name;candidates[0].p.name=name;
     state.recipients.filter(r=>norm(r.project)===norm(old)).forEach(r=>r.project=name);
     state.orders.filter(o=>norm(o.projectName)===norm(old)).forEach(o=>o.projectName=name);
   }else state.projects.push({id:uid(),name,address:'',receiver:'',phone:'',type:'lerakó',active:true,defaultRecipientId:''});
 });
 const uniqueSuppliers=[...new Set(supplierNames.filter(Boolean))];
 uniqueSuppliers.forEach(name=>{
   if(state.suppliers.some(s=>norm(s.name)===norm(name)))return;
   const groups=[...new Set(state.suppliers.map(s=>s.name))].map(n=>({name:n,s:similarity(name,n)})).sort((a,b)=>b.s-a.s);
   if(groups[0]?.s>=.45){
     const old=groups[0].name;state.suppliers.filter(s=>s.name===old).forEach(s=>s.name=name);
     state.orders.filter(o=>norm(o.pickupName)===norm(old)).forEach(o=>o.pickupName=name);
   }else state.suppliers.push({id:uid(),name,site:'Központ',address:'',pickupNote:'',isCentral:true,active:true});
 });
 save(false);
}

function masterTemplateHeaders(type){
 if(type==='projects')return['Projekt neve','Cím','Alap átvevő neve','Aktív'];
 if(type==='suppliers')return['Beszállító neve','Telephely','Cím','Központ','Felrakói megjegyzés','Aktív'];
 if(type==='recipients')return['Projekt','Átvevő neve','Telefon','E-mail','Beosztás','Cég','Megjegyzés','Aktív'];
 return['Sofőr neve','Jármű neve','Rendszám','Járműtípus','Indulási település','Aktív'];
}
function downloadMasterTemplate(){
 const headers=masterTemplateHeaders(masterType),example=masterType==='projects'
 ?['Minta projekt','1234 Budapest, Minta utca 1.','Minta Átvevő','Igen']
 :masterType==='suppliers'?['Minta Kft.','Központ','1234 Budapest, Raktár utca 1.','Igen','Hátsó kapu','Igen']
 :masterType==='recipients'?['Minta projekt','Minta Átvevő','701234567','atvevo@pelda.hu','projektvezető','Minta Kft.','','Igen']
 :['Minta Sofőr','Dobozos 3','ABC-123','3.5 T dobozos autó','Budapest','Igen'];
 const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([headers,example]),'Import');
 XLSX.writeFile(wb,`${masterType}_import_sablon.xlsx`);
}
async function importMasterFile(file){
 const wb=XLSX.read(await file.arrayBuffer(),{type:'array'}),ws=wb.Sheets[wb.SheetNames[0]],rows=XLSX.utils.sheet_to_json(ws,{defval:''});
 const yes=v=>['igen','true','1','x'].includes(norm(v));
 let added=0,updated=0;
 rows.forEach(r=>{
   if(masterType==='projects'){
     const name=r['Projekt neve'];if(!name)return;let x=state.projects.find(p=>norm(p.name)===norm(name));
     const rec=state.recipients.find(z=>norm(z.name)===norm(r['Alap átvevő neve'])&&(!z.project||norm(z.project)===norm(name)));
     const obj={name,address:r['Cím']||'',defaultRecipientId:rec?.id||'',active:r['Aktív']===''?true:yes(r['Aktív'])};
     if(x){Object.assign(x,obj);updated++}else{state.projects.push({id:uid(),...obj});added++}
   }else if(masterType==='suppliers'){
     const name=r['Beszállító neve'];if(!name)return;const address=r['Cím']||'';let x=state.suppliers.find(s=>norm(s.name)===norm(name)&&norm(s.address)===norm(address));
     const obj={name,site:r['Telephely']||'',address,isCentral:yes(r['Központ']),pickupNote:r['Felrakói megjegyzés']||'',active:r['Aktív']===''?true:yes(r['Aktív'])};
     if(obj.isCentral)state.suppliers.filter(s=>norm(s.name)===norm(name)).forEach(s=>s.isCentral=false);
     if(x){Object.assign(x,obj);updated++}else{state.suppliers.push({id:uid(),...obj});added++}
   }else if(masterType==='recipients'){
     const name=r['Átvevő neve'];if(!name)return;const project=r['Projekt']||'';let x=state.recipients.find(z=>norm(z.name)===norm(name)&&norm(z.project)===norm(project));
     const obj={project,name,phone:r['Telefon']||'',email:r['E-mail']||'',role:r['Beosztás']||'',company:r['Cég']||'',note:r['Megjegyzés']||'',active:r['Aktív']===''?true:yes(r['Aktív'])};
     if(x){Object.assign(x,obj);updated++}else{state.recipients.push({id:uid(),...obj});added++}
   }else{
     const name=r['Jármű neve'];if(!name)return;const plate=r['Rendszám']||'';let x=state.vehicles.find(v=>(plate&&norm(v.licensePlate)===norm(plate))||norm(v.name)===norm(name));
     const obj={driverName:r['Sofőr neve']||'',name,licensePlate:plate,type:r['Járműtípus']||'3.5 T dobozos autó',homeCity:r['Indulási település']||'',active:r['Aktív']===''?true:yes(r['Aktív'])};
     if(x){Object.assign(x,obj);updated++}else{state.vehicles.push({id:uid(),...obj});added++}
   }
 });
 save();alert(`Import kész: ${added} új, ${updated} frissített rekord.`);
}

function orderKm(o){return Number(o.estimatedKm||0)}
function reportPeriodOrders(){
 const type=$('#reportType')?.value||'daily';
 if(type==='daily')return state.orders.filter(o=>o.scheduleDate===$('#reportDate').value);
 if(type==='monthly'){const m=$('#reportMonth').value;return state.orders.filter(o=>o.scheduleDate?.startsWith(m))}
 return state.orders;
}
function distinctCount(rows,key){return new Set(rows.map(x=>norm(x[key])).filter(Boolean)).size}
function renderReports(){
 if(!$('#reportTable'))return;
 const type=$('#reportType').value,rows=reportPeriodOrders();
 let table=[],headers=[];
 if(type==='projects'){
   headers=['Projekt','Teljesített rendelések','Beszállítók','Hiányos kiszolgálások','Nem teljesített első napi fuvarok'];
   const projects=[...new Set(rows.map(o=>o.projectName||'Egyedi úticél'))];
   table=projects.map(p=>{const pr=rows.filter(o=>(o.projectName||'Egyedi úticél')===p);return[p,pr.filter(o=>o.completed).length,distinctCount(pr,'pickupName'),pr.filter(o=>(o.items||[]).some(i=>!i.received)).length,state.history.filter(h=>h.type==='not_completed'&&h.projectName===p).length]});
 }else{
   headers=['Autó / sofőr','Felrakók','Lerakók','Megtett km','Teljesített rendelések','Nem teljesített'];
   table=state.vehicles.map(v=>{const vr=rows.filter(o=>o.vehicleId===v.id);return[`${v.driverName} · ${v.name}`,distinctCount(vr,'pickupAddress'),distinctCount(vr,'dropAddress'),Math.round(vr.reduce((a,o)=>a+orderKm(o),0)),vr.filter(o=>o.completed).length,vr.filter(o=>!o.completed).length]});
 }
 $('#reportSummary').innerHTML=`<div class="kpi">Fuvarok<b>${rows.length}</b></div><div class="kpi">Teljesített<b>${rows.filter(o=>o.completed).length}</b></div><div class="kpi">Hiányos<b>${rows.filter(o=>(o.items||[]).some(i=>!i.received)).length}</b></div><div class="kpi">Becsült km<b>${Math.round(rows.reduce((a,o)=>a+orderKm(o),0))}</b></div>`;
 $('#reportTable').innerHTML=`<div class="panel"><table class="report-table"><thead><tr>${headers.map(h=>`<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${table.map(r=>`<tr>${r.map(c=>`<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
 window.__report={headers,table,type};
}
function exportReport(){
 const r=window.__report||{headers:[],table:[]},wb=XLSX.utils.book_new(),title=`Stand 98 - ${r.type==='monthly'?'havi':r.type==='daily'?'napi':'projekt'} fuvar kimutatás`;
 XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([[title],[],r.headers,...r.table]),'Kimutatás');
 XLSX.writeFile(wb,`${title.replaceAll(' ','_')}.xlsx`);
}
function backlogRows(){
 const map=new Map();
 state.orders.forEach(o=>(o.items||[]).forEach(i=>{if(i.received)return;const key=[o.projectName,o.pickupName,i.code,i.name].map(norm).join('|');if(!map.has(key))map.set(key,{project:o.projectName||'Egyedi',supplier:o.pickupName||'',code:i.code,name:i.name,qty:0,unit:i.unit,orders:new Set(),oldest:o.firstScheduledDate||o.scheduleDate});const x=map.get(key);x.qty+=Number(i.qty)||0;x.orders.add(o.orderNo);if((o.firstScheduledDate||o.scheduleDate)<x.oldest)x.oldest=o.firstScheduledDate||o.scheduleDate}));return[...map.values()];
}
function renderBacklog(){
 if(!$('#backlogList'))return;const rows=backlogRows();
 $('#backlogList').innerHTML=rows.map(x=>`<article class="backlog-card"><h3>${esc(x.project)} · ${esc(x.name)}</h3><p><b>Beszállító:</b> ${esc(x.supplier)} · <b>Hiány:</b> ${esc(x.qty)} ${esc(x.unit)}</p><p><b>Rendelések:</b> ${esc([...x.orders].join(', '))} · <b>Legrégebbi:</b> ${esc(x.oldest)}</p></article>`).join('')||'<div class="notice">Nincs aktuális hátralék.</div>';
}
function exportBacklog(){
 const rows=backlogRows(),wb=XLSX.utils.book_new(),data=[['Projekt','Beszállító','Termékkód','Termék neve','Hiányzó mennyiség','M.e.','Rendelések','Legrégebbi dátum'],...rows.map(x=>[x.project,x.supplier,x.code,x.name,x.qty,x.unit,[...x.orders].join(', '),x.oldest])];
 XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(data),'Hátralék');XLSX.writeFile(wb,'Stand_98_hátralék.xlsx');
}
function universalSearch(){
 const q=norm($('#globalSearch').value);if(!q)return;
 const groups=[];
 const orders=state.orders.filter(o=>norm(JSON.stringify(o)).includes(q)).slice(0,30);
 const projects=state.projects.filter(o=>norm(JSON.stringify(o)).includes(q)).slice(0,20);
 const suppliers=state.suppliers.filter(o=>norm(JSON.stringify(o)).includes(q)).slice(0,20);
 const recipients=state.recipients.filter(o=>norm(JSON.stringify(o)).includes(q)).slice(0,20);
 if(orders.length)groups.push(['Fuvarok',orders.map(o=>`<button class="search-hit" onclick="searchOpenOrder('${o.id}')">${esc(o.orderNo)} · ${esc(o.projectName||o.dropAddress)} · ${esc(o.scheduleDate)}</button>`).join('')]);
 if(projects.length)groups.push(['Projektek',projects.map(o=>`<button class="search-hit" onclick="searchOpenMaster('projects','${o.id}')">${esc(o.name)} · ${esc(o.address||'')}</button>`).join('')]);
 if(suppliers.length)groups.push(['Beszállítók',suppliers.map(o=>`<button class="search-hit" onclick="searchOpenMaster('suppliers','${o.id}')">${esc(o.name)} · ${esc(o.address||'')}</button>`).join('')]);
 if(recipients.length)groups.push(['Átvevők',recipients.map(o=>`<button class="search-hit" onclick="searchOpenMaster('recipients','${o.id}')">${esc(o.name)} · ${esc(o.project||'')}</button>`).join('')]);
 $('#searchResults').innerHTML=groups.map(g=>`<div class="search-group"><h4>${g[0]}</h4>${g[1]}</div>`).join('')||'<div class="notice">Nincs találat.</div>';$('#searchDialog').showModal();
}
window.searchOpenOrder=id=>{$('#searchDialog').close();showPage('orders');editOrder(id)};
window.searchOpenMaster=(type,id)=>{$('#searchDialog').close();masterType=type;showPage('masters');editMaster(id)};

$$('.nav').forEach(n=>n.onclick=()=>showPage(n.dataset.page));$$('[data-close]').forEach(b=>b.onclick=()=>$('#'+b.dataset.close).close());$$('[data-master]').forEach(b=>b.onclick=()=>{$$('[data-master]').forEach(x=>x.classList.toggle('active',x===b));masterType=b.dataset.master;renderMasters()});
$('#prevDay').onclick=()=>{const d=new Date(selectedDate()+'T12:00:00');d.setDate(d.getDate()-1);$('#workDate').value=d.toISOString().slice(0,10);render()};$('#nextDay').onclick=()=>{const d=new Date(selectedDate()+'T12:00:00');d.setDate(d.getDate()+1);$('#workDate').value=d.toISOString().slice(0,10);render()};$('#workDate').onchange=render;
$('#importBtn').onclick=()=>$('#importDialog').showModal();$('#excelInput').onchange=e=>readExcel(e.target.files[0]).catch(err=>alert(err.message));$('#startReviewBtn').onclick=startReview;$('#reviewForm').onsubmit=e=>{e.preventDefault();saveReview()};$('#reviewSkipBtn').onclick=saveReview;
$('#quickAddBtn').onclick=()=>openOrder({scheduleDate:selectedDate(),items:[]});$('#addOrderBtn').onclick=()=>openOrder({scheduleDate:selectedDate(),items:[]});$('#balanceBtn').onclick=balance;$('#optimizeBtn').onclick=optimizeAll;$('#exportBtn').onclick=exportMenu;$('#deleteAllBtn').onclick=deleteAll;$('#deleteVehicleDialogBtn').onclick=()=>deleteVehicle($('#editVehicleId').value);
$('#orderSearch').oninput=renderOrders;$('#orderVehicleFilter').onchange=renderOrders;$('#addVehicleBtn').onclick=()=>editVehicle();$('#saveBaseBtn').onclick=()=>{state.settings.baseAddress=$('#baseAddress').value;save()};$('#driverVehicleSelect').onchange=renderDriver;$('#driverDate').onchange=renderDriver;
$('#addMasterBtn').onclick=()=>masterType==='vehicles'?editVehicle():openMaster();$('#masterSearch').oninput=renderMasters;$('#downloadMasterTemplateBtn').onclick=downloadMasterTemplate;$('#masterImportInput').onchange=e=>e.target.files[0]&&importMasterFile(e.target.files[0]);$('#backupBtn').onclick=backup;$('#globalSearchBtn').onclick=universalSearch;$('#globalSearch').onkeydown=e=>{if(e.key==='Enter')universalSearch()};document.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){e.preventDefault();$('#globalSearch').focus()}});$('#reportType').onchange=renderReports;$('#reportDate').onchange=renderReports;$('#reportMonth').onchange=renderReports;$('#exportReportBtn').onclick=exportReport;$('#exportBacklogBtn').onclick=exportBacklog;$('#restoreInput').onchange=e=>e.target.files[0]&&restoreFile(e.target.files[0]);
window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();deferredPrompt=e;$('#installBtn').classList.remove('hidden')});$('#installBtn').onclick=async()=>{deferredPrompt?.prompt();deferredPrompt=null};
if('serviceWorker'in navigator)navigator.serviceWorker.register('sw.js');load();$('#workDate').value=today();$('#driverDate').value=today();$('#reportDate').value=today();$('#reportMonth').value=today().slice(0,7);render();