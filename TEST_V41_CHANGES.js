const fs=require('fs'), vm=require('vm');
function norm(v){return String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[_.,;:()[\]{}\/\\-]+/g,' ').replace(/\s+/g,' ').trim()}
global.norm=norm;let seq=0;global.uid=()=>`id${++seq}`;global.alert=()=>{};global.confirm=()=>true;global.save=()=>{};global.render=()=>{};global.showPage=()=>{};
global.state={orders:[],backlog:[],resolvedBacklog:[],failedTrips:[],routePlans:{},routeStats:{},settings:{},suppliers:[
{id:'sz',name:'Szatmári Kft. – Késmárk',address:'1158 Budapest, Késmárk utca 9.'},
{id:'me',name:'Merkapt Zrt.',address:'1106 Budapest, Maglódi út 14/B'},
{id:'se',name:'Sebők és Társa Kft',address:'2045 Törökbálint, Kinizsi utca 28.'}
],projects:[
{id:'co',name:'Budapest_Cosmo_Residence',address:'1133 Budapest, Hegedűs Gyula utca 53.'},
{id:'lj',name:'Budapest_LeJardin_II_felépítmény',address:'1134 Budapest, Rozsnyai utca 14–18.'},
{id:'cp',name:'Budapest_City_pearl_II.ütem',address:'1095 Budapest, Soroksári út 58.'}
],recipients:[],vehicles:[{id:'mario',driverName:'Márió',active:true},{id:'patrik',driverName:'Patrik',active:true},{id:'martin',driverName:'Martin',active:true}]};
global.activeVehicles=()=>state.vehicles.filter(v=>v.active!==false);
vm.runInThisContext(fs.readFileSync('./planner-v41.js','utf8'),{filename:'planner-v41.js'});
const V=global.V41OutlookImport;
let pass=0,fail=0;async function test(name,fn){try{await fn();console.log('✓',name);pass++}catch(e){console.error('✗',name,'\n ',e.stack||e);fail++}}
function eq(a,b){if(JSON.stringify(a)!==JSON.stringify(b))throw Error(`várt ${JSON.stringify(b)}, kapott ${JSON.stringify(a)}`)}
function ok(v,m='feltétel nem teljesült'){if(!v)throw Error(m)}
function baseEntry(extra={}){return V.buildExtractedEntry({category:'dobozos',sourceName:'x.msg',subject:'Megrendelés_Cosmo_260804_004937',body:'holnap felvesszük',pdfName:'x.pdf',pdfText:'Szállító rendelés\n2026-SR0/004937\nProjekt név: Budapest_Cosmo_Residence\nSzállító: Merkapt Zrt.',pdfLines:['Szállító rendelés','2026-SR0/004937','Projekt név: Budapest_Cosmo_Residence','Szállító: Merkapt Zrt.'],...extra})}
(async()=>{
await test('SR0: a Projekt név mezőből a projekttörzs címe lesz a lerakó',()=>{const e=baseEntry();eq([e.projectName,e.dropAddress],['Budapest_Cosmo_Residence','1133 Budapest, Hegedűs Gyula utca 53.'])});
await test('KRPR: cím nélküli célraktárhoz a projekttörzs címe kerül',()=>{const e=V.buildExtractedEntry({category:'dobozos',sourceName:'k.msg',subject:'Raktárközi Lejardin',body:'Raktári tételt vigyétek ki',pdfName:'k.pdf',pdfText:'Raktárközi\n2026-KRPR/000745\nForrás raktár: Új Központi Raktár\nCél raktár: Budapest_LeJardin_II_felépítmény',pdfLines:['Raktárközi','2026-KRPR/000745','Forrás raktár: Új Központi Raktár Cél raktár: Budapest_LeJardin_II_felépítmény']});eq([e.pickupAddress,e.projectName,e.dropAddress],['2310 Szigetszentmiklós, Kereskedő utca 2.','Budapest_LeJardin_II_felépítmény','1134 Budapest, Rozsnyai utca 14–18.'])});
await test('Cosmo–Szatmári visszáru: projekt a felrakó, Késmárk a lerakó',()=>{const e=V.buildExtractedEntry({category:'martin',sourceName:'Kekelit visszáru - Cosmo.msg',subject:'Kekelit visszáru - Cosmo',body:'Szeretném visszáruzni. Gondolom megfelel, ha hozzátok bevisszük a Késmárkba?\n2026-SR0/002226 – 200m\n2026-SR0/001998 – 175m',pdfText:'',pdfLines:[]});eq([e.orderType,e.pickupName,e.pickupAddress,e.projectName,e.dropAddress],['VISSZARU','Budapest_Cosmo_Residence','1133 Budapest, Hegedűs Gyula utca 53.','Szatmári Kft. – Késmárk','1158 Budapest, Késmárk utca 9.'])});
await test('beszállítói visszaigazolás nem számít elsődleges rendelési PDF-nek',()=>{const a=V.classifyPdfDocument({text:'Szállító rendelés\n2026-SR0/000111',lines:['Szállító rendelés','2026-SR0/000111']});const b=V.classifyPdfDocument({text:'Rendelés visszaigazolás\n2026-SR0/000111',lines:['Rendelés visszaigazolás','2026-SR0/000111']});eq([a.primary,b.primary,b.confirmation],[true,false,true])});
await test('egy PDF-ben több SR0 külön dokumentumrészre válik',()=>{const parts=V.splitPdfDocumentByOrders({name:'ketto.pdf',text:'Szállító rendelés\n2026-SR0/000111\nA tétel\nSzállító rendelés\n2026-SR0/000112\nB tétel',lines:[]});eq(parts.map(x=>x.forcedRefs[0].no),['000111','000112'])});
await test('korábban importált rendelés újraimportálható és frissíti a régit',()=>{state.orders=[{id:'old',outlookImport:true,orderType:'SR0',isReturn:false,orderNo:'004937',sourceOrderNos:['004937'],scheduleDate:'2026-08-05',pickupName:'Régi',projectName:'Budapest_Cosmo_Residence'}];const e=baseEntry();e.scheduleDate='2026-08-05';V.setPending([e]);V.commitImport();const matches=state.orders.filter(o=>o.sourceOrderNos?.includes('004937'));eq(matches.length,1);eq([matches[0].pickupName,matches[0].vehicleId,matches[0].importVehicleLocked],['Merkapt Zrt.','mario',false])});
await test('Minden import törlése a nem látható, már autóknál lévő Outlook-importot is törli',()=>{state.orders=[{id:'out',outlookImport:true,orderNo:'1'},{id:'manual',outlookImport:false,orderNo:'2'}];state.backlog=[{id:'b',targetOrderId:'out'}];V.setPending([baseEntry()]);V.clearAllImports();eq(state.orders.map(o=>o.id),['manual']);eq(state.backlog.length,0);eq(V.getPending().length,0)});
await test('két elsődleges SR0 melléklet két külön importkártyát ad, a visszaigazolást kihagyja',async()=>{
 class FakeReader{constructor(){}getFileData(){return{subject:'Két rendelés',body:'Mellékletek szerint megrendelem.',attachments:[{fileName:'rend1.pdf',key:1},{fileName:'visszaig.pdf',key:2},{fileName:'rend2.pdf',key:3}]}}getAttachment(a){return{content:Buffer.from(String(a.key))}}}
 global.LocalMsgReader=FakeReader;
 global.V41PdfTextExtractor=async bytes=>{const key=Buffer.from(bytes).toString();const text=key==='1'?'Szállító rendelés\n2026-SR0/000111\nProjekt név: Budapest_Cosmo_Residence\nSzállító: Merkapt Zrt.':key==='2'?'Rendelés visszaigazolás\n2026-SR0/000111': 'Szállító rendelés\n2026-SR0/000112\nProjekt név: Budapest_LeJardin_II_felépítmény\nSzállító: Sebők és Társa Kft';return{text,lines:text.split('\n')}};
 const f={name:'ketto.msg',arrayBuffer:async()=>new ArrayBuffer(1)};const entries=await V.parseDroppedFile(f,'dobozos');eq(entries.map(e=>e.orderNo),['000111','000112']);
});
console.log(`\nV41 módosítási teszt: ${pass}/${pass+fail} sikeres.`);if(fail)process.exit(1);
})();
