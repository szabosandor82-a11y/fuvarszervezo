const $=s=>document.querySelector(s);
const DRIVERS={mario:'Márió',patrik:'Patrik',martin:'Martin'};
let me=null,tasks=[],audioBlob=null,recorder=null,chunks=[],photos=[];
const socket=io();

async function api(url,options={}){
 const r=await fetch(url,options);const j=await r.json().catch(()=>({}));
 if(r.status===401){location.href='/';throw new Error('Lejárt a munkamenet.')}
 if(!r.ok)throw new Error(j.error||'Hiba történt.');return j;
}
async function init(){
 const m=await api('/api/me');me=m.user;
 if(me.role!=='driver'){location.href='/admin.html';return}
 $('#driverName').textContent=me.name;
 await loadTasks();
}
async function loadTasks(){
 const j=await api('/api/driver/today');tasks=j.orders||[];
 $('#todayInfo').innerHTML=`<b>${j.date}</b> · ${DRIVERS[j.driverKey]||j.driverKey}<br>Csak a saját, mai feladataid láthatók.`;
 $('#transferInfo').innerHTML=(j.transfers||[]).slice(-5).reverse().map(t=>`<div class="transfer-log">${new Date(t.at).toLocaleTimeString('hu-HU',{hour:'2-digit',minute:'2-digit'})}: ${t.orderNo} · ${DRIVERS[t.from]} → ${DRIVERS[t.to]} ${t.warning?'⚠️ ponyvás figyelmeztetés':''}</div>`).join('');
 renderTasks();
}
function esc(v=''){return String(v).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]))}
function renderTasks(){
 $('#taskList').innerHTML=tasks.length?tasks.map((o,i)=>`<article class="driver-task ${o.status==='teljesítve'?'done':''}">
 <div class="order-top"><div><h2>${i+1}. ${esc(o.orderNo)} · ${esc(o.projectName||o.dropAddress||'Nincs projekt')}</h2>
 <p><b>Felrakó:</b> ${esc(o.pickupName||'')}<br>${esc(o.pickupAddress||'')}</p>
 <p><b>Lerakó:</b> ${esc(o.dropAddress||'')}</p>
 <p><b>Átvevő:</b> ${esc(o.recipientName||'')} ${esc(o.recipientPhone||'')}</p>
 ${o.note?`<p><b>Megjegyzés:</b> ${esc(o.note)}</p>`:''}</div><span class="badge">${o.status==='teljesítve'?'Teljesítve':'Mai feladat'}</span></div>
 <button class="primary-large" onclick="openMap('${o.id}')">Navigáció</button>
 <div class="task-actions"><button onclick="openReport('${o.id}')">📷 🎤 Jelentés</button><button class="secondary" onclick="openTransfer('${o.id}')">Átadás másik autónak</button></div>
 </article>`).join(''):'<div class="notice">Mára nincs kiosztott feladatod.</div>';
}
window.openMap=id=>{const o=tasks.find(x=>x.id===id);window.open('https://www.google.com/maps/dir/?api=1&destination='+encodeURIComponent(o.dropAddress),'_blank')};
window.openTransfer=id=>{
 const o=tasks.find(x=>x.id===id);$('#transferTaskId').value=id;
 $('#transferTo').innerHTML=Object.entries(DRIVERS).filter(([k])=>k!==me.driverKey).map(([k,n])=>`<option value="${k}">${n}</option>`).join('');
 $('#transferWarning').classList.toggle('hidden',!(o.vehicleNeed==='tarp'||o.longMaterialReason));
 $('#transferWarning').textContent=(o.vehicleNeed==='tarp'||o.longMaterialReason)?'Ez hosszú szálanyagos rendelés. Nem ponyvás autóra átadva figyelmeztetés jelenik meg az adminnál.':'';
 transferDialog.showModal();
};
$('#transferForm').onsubmit=async e=>{
 e.preventDefault();const id=$('#transferTaskId').value,to=$('#transferTo').value;
 const j=await api(`/api/tasks/${id}/transfer`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({to})});
 transferDialog.close();alert(j.warning?'Átadva, de ponyvás figyelmeztetéssel.':'Feladat átadva.');await loadTasks();
};
window.openReport=id=>{
 const o=tasks.find(x=>x.id===id);$('#reportTaskId').value=id;$('#reportTitle').textContent=`${o.orderNo} · ${o.projectName||o.dropAddress}`;
 $('#note').value='';$('#transcript').value='';$('#completed').checked=false;$('#photos').value='';$('#photosPreview').innerHTML='';
 photos=[];audioBlob=null;chunks=[];$('#audio').classList.add('hidden');
 $('#recordStatus').textContent=(navigator.mediaDevices&&window.MediaRecorder)?'Nincs felvétel.':'A mikrofon csak HTTPS-en és támogatott böngészőben működik.';
 $('#recordStart').disabled=!(navigator.mediaDevices&&window.MediaRecorder);
 $('#dictateBtn').disabled=!(window.SpeechRecognition||window.webkitSpeechRecognition);
 reportDialog.showModal();
};
$('#photos').onchange=e=>{photos=[...e.target.files];$('#photosPreview').innerHTML=photos.map(f=>`<img src="${URL.createObjectURL(f)}">`).join('')};
$('#recordStart').onclick=async()=>{
 try{
  const stream=await navigator.mediaDevices.getUserMedia({audio:true});chunks=[];recorder=new MediaRecorder(stream);
  recorder.ondataavailable=e=>e.data.size&&chunks.push(e.data);
  recorder.onstop=()=>{audioBlob=new Blob(chunks,{type:recorder.mimeType||'audio/webm'});$('#audio').src=URL.createObjectURL(audioBlob);$('#audio').classList.remove('hidden');$('#recordStatus').textContent=`Felvétel kész (${Math.round(audioBlob.size/1024)} KB)`;stream.getTracks().forEach(t=>t.stop())};
  recorder.start();$('#recordStart').disabled=true;$('#recordStop').disabled=false;$('#recordStatus').textContent='Felvétel folyamatban…';
 }catch(e){alert(e.message)}
};
$('#recordStop').onclick=()=>{if(recorder&&recorder.state!=='inactive')recorder.stop();$('#recordStart').disabled=false;$('#recordStop').disabled=true};
$('#dictateBtn').onclick=()=>{
 const SR=window.SpeechRecognition||window.webkitSpeechRecognition;if(!SR)return;
 const r=new SR();r.lang='hu-HU';r.continuous=true;r.interimResults=true;let final=$('#transcript').value;
 r.onresult=e=>{let interim='';for(let i=e.resultIndex;i<e.results.length;i++){const t=e.results[i][0].transcript;if(e.results[i].isFinal)final+=' '+t;else interim+=t}$('#transcript').value=(final+' '+interim).trim()};
 r.start();$('#recordStatus').textContent='Diktálás folyamatban…';setTimeout(()=>{try{r.stop()}catch{}},60000);
};
$('#reportForm').onsubmit=async e=>{
 e.preventDefault();const id=$('#reportTaskId').value,fd=new FormData();
 fd.append('note',$('#note').value);fd.append('transcript',$('#transcript').value);fd.append('completed',$('#completed').checked?'true':'false');
 photos.forEach((f,i)=>fd.append('photos',f,f.name||`szallitolevel_${i+1}.jpg`));
 if(audioBlob)fd.append('audio',audioBlob,`${id}_hang.webm`);
 const j=await api(`/api/tasks/${id}/report`,{method:'POST',body:fd});reportDialog.close();
 alert(j.emailed?'A jelentés és a csatolmányok e-mailben elküldve.':'A jelentés elmentve. SMTP beállítás után automatikusan e-mailben is elküldhető.');
 await loadTasks();
};
$('#logoutBtn').onclick=async()=>{await fetch('/api/logout',{method:'POST'});location.href='/'};
socket.on('state-changed',loadTasks);
init().catch(e=>alert(e.message));
