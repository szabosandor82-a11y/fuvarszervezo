const DB_KEY='fuvarszervezo_v13_db';
const defaults={
  projects:[
    {name:'KRPR (központ)',address:'2310 Szigetszentmiklós, Kereskedő utca',receiver:''},
    {name:'Metrodome Beat',address:'1138 Budapest, Turóc utca 10.',receiver:''},
    {name:'Moxy VUC',address:'1056 Budapest, Molnár utca 36.',receiver:''},
    {name:'Cosmo',address:'1133 Budapest, Hegedűs Gyula utca 53.',receiver:''},
    {name:'Le Jardin',address:'1134 Budapest, Rozsnyai utca 14-18.',receiver:''}
  ],
  suppliers:[],receivers:[],
  vehicles:[
    {name:'Dobozos 1',type:'Dobozos',maxLength:'3 m'},
    {name:'Dobozos 2',type:'Dobozos',maxLength:'3 m'},
    {name:'Ponyvás',type:'Ponyvás',maxLength:'6 m'}
  ],orders:[]
};
let db=load();
function load(){try{return {...structuredClone(defaults),...JSON.parse(localStorage.getItem(DB_KEY)||'{}')}}catch{return structuredClone(defaults)}}
function save(){localStorage.setItem(DB_KEY,JSON.stringify(db));renderAll()}
function norm(s){return String(s??'').trim().toLocaleLowerCase('hu-HU').replace(/\s+/g,' ')}
function pick(row,names){for(const n of names){const k=Object.keys(row).find(x=>norm(x)===norm(n));if(k!==undefined)return row[k]}return ''}
function esc(s){return String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]))}

// tabs
document.querySelectorAll('nav button').forEach(b=>b.onclick=()=>{document.querySelectorAll('nav button,.tab').forEach(x=>x.classList.remove('active'));b.classList.add('active');document.getElementById(b.dataset.tab).classList.add('active')});

async function readSheet(file){const buf=await file.arrayBuffer();const wb=XLSX.read(buf,{type:'array'});return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]],{defval:''})}

document.getElementById('importBtn').onclick=async()=>{
  const file=document.getElementById('serpaFile').files[0];if(!file)return alert('Válassz ki egy SERPA fájlt.');
  const rows=await readSheet(file);let invalid=0;
  db.orders=rows.map((r,i)=>{
    const supplier=String(pick(r,['Ügyfél/raktár név'])).trim();
    const pickup=String(pick(r,['Szállítási cím','Szállítási cím név'])).trim();
    const project=String(pick(r,['Témaszám név'])).trim();
    const p=db.projects.find(x=>norm(x.name)===norm(project));
    const dropoff=p?.address||'';const needsReview=!dropoff;
    if(needsReview)invalid++;
    return {id:Date.now()+i,supplier,pickupAddress:pickup,project,dropoffAddress:dropoff,needsReview,note:needsReview?'Importellenőrzés szükséges':''};
  });
  save();document.getElementById('importSummary').textContent=`${rows.length} tétel importálva, ${invalid} ellenőrzendő.`;
};
document.getElementById('clearOrdersBtn').onclick=()=>{if(confirm('Biztosan törlöd az összes rendelést?')){db.orders=[];save()}};
document.getElementById('exportOrdersBtn').onclick=()=>exportXlsx(db.orders,'Fuvarszervezo_V13_export.xlsx','Rendelések');

function exportXlsx(rows,name,sheet){const ws=XLSX.utils.json_to_sheet(rows);const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,sheet);XLSX.writeFile(wb,name)}
function renderOrders(){
  const cols=['Beszállító','Felrakó címe','Projekt','Lerakó címe','Megjegyzés'];
  const rows=db.orders.map(o=>`<tr class="${o.needsReview?'invalid':''}"><td>${esc(o.supplier)}</td><td>${editInput(o.id,'pickupAddress',o.pickupAddress)}</td><td>${projectSelect(o)}</td><td>${editInput(o.id,'dropoffAddress',o.dropoffAddress)}</td><td>${esc(o.note)}</td></tr>`).join('');
  document.getElementById('ordersTable').innerHTML=`<thead><tr>${cols.map(c=>`<th>${c}</th>`).join('')}</tr></thead><tbody>${rows}</tbody>`;
  document.getElementById('validationTable').innerHTML=`<thead><tr>${cols.map(c=>`<th>${c}</th>`).join('')}</tr></thead><tbody>${db.orders.filter(o=>o.needsReview).map(o=>`<tr class="invalid"><td>${esc(o.supplier)}</td><td>${esc(o.pickupAddress)}</td><td>${esc(o.project)}</td><td>${esc(o.dropoffAddress)}</td><td>${esc(o.note)}</td></tr>`).join('')}</tbody>`;
}
function editInput(id,field,value){return `<input value="${esc(value)}" onchange="updateOrder(${id},'${field}',this.value)">`}
function projectSelect(o){return `<select onchange="changeProject(${o.id},this.value)"><option value="${esc(o.project)}">${esc(o.project||'– válassz –')}</option>${db.projects.filter(p=>norm(p.name)!==norm(o.project)).map(p=>`<option>${esc(p.name)}</option>`).join('')}</select>`}
window.updateOrder=(id,field,value)=>{const o=db.orders.find(x=>x.id===id);o[field]=value;if(field==='dropoffAddress'){o.needsReview=!value.trim();o.note=o.needsReview?'Importellenőrzés szükséges':''}save()}
window.changeProject=(id,name)=>{const o=db.orders.find(x=>x.id===id);o.project=name;const p=db.projects.find(x=>norm(x.name)===norm(name));if(p?.address){o.dropoffAddress=p.address;o.needsReview=false;o.note=''}else{o.needsReview=true;o.note='Importellenőrzés szükséges'}save()}

const config={
 projects:{title:'projekt',fields:[['name','Projekt neve'],['address','Lerakó címe'],['receiver','Átvevő']]},
 suppliers:{title:'beszállító',fields:[['name','Beszállító neve'],['address','Felrakó címe']]},
 receivers:{title:'átvevő',fields:[['name','Név'],['phone','Telefon'],['email','E-mail'],['project','Projekt']]},
 vehicles:{title:'autó',fields:[['name','Autó neve'],['type','Típus'],['maxLength','Max. szálhossz']]}
};
function renderMaster(type){const c=config[type],data=db[type];const table=document.getElementById(type+'Table');table.innerHTML=`<thead><tr>${c.fields.map(f=>`<th>${f[1]}</th>`).join('')}<th>Művelet</th></tr></thead><tbody>${data.map((r,i)=>`<tr>${c.fields.map(f=>`<td>${esc(r[f[0]])}</td>`).join('')}<td><button class="icon-btn edit" onclick="openEdit('${type}',${i})">Szerkesztés</button> <button class="icon-btn delete" onclick="removeItem('${type}',${i})">Törlés</button></td></tr>`).join('')}</tbody>`}
window.removeItem=(type,i)=>{if(confirm('Biztosan törlöd?')){db[type].splice(i,1);save()}};
let editState=null;
window.openEdit=(type,index=null)=>{editState={type,index};const c=config[type],item=index===null?{}:db[type][index];document.getElementById('dialogTitle').textContent=index===null?`Új ${c.title}`:`${c.title} szerkesztése`;document.getElementById('dialogFields').innerHTML=c.fields.map(([k,l])=>`<div class="field"><label>${l}</label><input name="${k}" value="${esc(item[k]||'')}"></div>`).join('');document.getElementById('editDialog').showModal()};
document.getElementById('editForm').addEventListener('submit',e=>{if(e.submitter?.value==='cancel')return; e.preventDefault();const fd=new FormData(e.target),obj=Object.fromEntries(fd);if(editState.index===null)db[editState.type].push(obj);else db[editState.type][editState.index]=obj;document.getElementById('editDialog').close();save()});
document.querySelectorAll('[data-add]').forEach(b=>b.onclick=()=>openEdit(b.dataset.add));

document.querySelectorAll('[data-template]').forEach(b=>b.onclick=()=>{const type=b.dataset.template,c=config[type];const obj=Object.fromEntries(c.fields.map(([k,l])=>[l,'']));exportXlsx([obj],`${type}_import_sablon.xlsx`,'Import')});
document.querySelectorAll('[data-import]').forEach(b=>b.onclick=()=>document.getElementById(b.dataset.import+'File').click());
['projects','suppliers','receivers'].forEach(type=>document.getElementById(type+'File').onchange=async e=>{const rows=await readSheet(e.target.files[0]);const c=config[type];db[type]=rows.map(r=>Object.fromEntries(c.fields.map(([k,l])=>[k,pick(r,[l,k])])));save();e.target.value=''});

function renderAll(){renderOrders();Object.keys(config).forEach(renderMaster)}
renderAll();
