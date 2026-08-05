const fs = require('fs');
const vm = require('vm');
let passed = 0, failed = 0;
function test(name, fn) { try { fn(); console.log('✓', name); passed++; } catch (e) { console.error('✗', name, '\n ', e.stack || e.message); failed++; } }
function eq(actual, expected) { if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`várt: ${JSON.stringify(expected)}, kapott: ${JSON.stringify(actual)}`); }
function ok(value, message='feltétel nem teljesült'){ if(!value) throw new Error(message); }

global.state = {
  orders: [], backlog: [], resolvedBacklog: [], settings: { baseAddress: '2310 Szigetszentmiklós, Kereskedő utca 2.' }, routePlans:{}, routeStats:{},
  suppliers: [
    { id:'s-larex', name:'Larex Trade Kft', address:'1108 Budapest, Maglódi utca 123' },
    { id:'s-szat', name:'Szatmári Kft. – Késmárk', address:'1158 Budapest, Késmárk utca 9.' },
    { id:'s-sebok', name:'Sebők és Társa Kft', address:'2045 Törökbálint, Kinizsi utca 28.' },
    { id:'s-merkapt', name:'Merkapt Zrt.', address:'1106 Budapest, Maglódi út 14/B' },
    { id:'s-szer', name:'Szerelvénybolt Kft.', address:'1182 Budapest, Üllői út 800.' }
  ],
  projects: [
    { id:'p-m76', name:'Budapest_M76', address:'1095 Budapest, Mester u. 76.' },
    { id:'p-k6', name:'Budapest_Kincsem_K6', address:'1106 Budapest, Gyógyszergyári utca 14.' },
    { id:'p-cp2', name:'Budapest_City_pearl_II.ütem', address:'1095 Budapest, Soroksári út 58.' },
    { id:'p-lj', name:'Budapest_LeJardin_II_felépítmény', address:'1134 Budapest, Rozsnyai utca 14–18.' },
    { id:'p-cosmo', name:'Budapest_Cosmo_Residence', address:'1133 Budapest, Hegedűs Gyula utca 53.' },
    { id:'p-central', name:'Központi raktár', address:'2310 Szigetszentmiklós, Kereskedő utca' }
  ],
  recipients: [], vehicles:[{id:'v-martin',driverName:'Martin'}]
};
global.activeVehicles = () => global.state.vehicles;
global.selectedDate = () => '2026-08-05';
global.norm = v => String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[_.,;:()[\]{}\/\\-]+/g,' ').replace(/\s+/g,' ').trim();
global.uid = (()=>{let i=0;return()=>`t${++i}`})();
vm.runInThisContext(fs.readFileSync(__dirname + '/planner-v41.js','utf8'), {filename:'planner-v41.js'});
const V = global.V41OutlookImport;

const cityPdf = `Szállító rendelés\n2026-SR0/004932\nRaktár: Budapest City Pearl II.\nProjekt név Budapest_City_pearl_II.ütem\nFelvétel címe:\nGali SwimTex Kft.\nTörök Zsuzsanna +3670 385 74 10\nSzékhely;Telephely:2142 Nagytarcsa, Gránit utca 15\n1 . PVCUGCS110HP PVC NYOMÓ d110 GÖMBCSAP HOLLANDIS 1db`;
const cityBody = `Melléklet szerinti tételt megrendelem, holnap felvesszük Önöknél.\nFelvétel címe:\nGali SwimTex Kft.\nTörök Zsuzsanna +3670 385 74 10\nSzékhely;Telephely:2142 Nagytarcsa, Gránit utca 15\ntorok.zsuzsa@gali-group.com`;
const krprPdf = `Raktárközi\n2026-KRPR/000745\nForrás raktár: Cél raktár:\nStand 98 Kft. Budapest_LeJardin_II_felépítmény\nÚj Központi Raktár\n1239 Budapest Láva u 7.\n1 . GK0100 Gumikompenzátor, Pn10/16- Karimás, EPDM, DN100 6db`;
const returnBody = `Kekelit visszáru - Cosmo\nTo: kratochwil.balazs@szatmari.hu\nSzeretném visszáruzni az alábbi tételeket. Gondolom, megfelel ha hozzátok bevisszük a Késmárkba?\n7521324 - Ke Kelit KELOX Plus-cső 90°C - 10bar, 4 mm-es csőszigeteléssel, 32x3 – 400m összesen\nMegrendelés számok, mennyiségek:\n2026-SR0/002226 – 200m\n2026-SR0/001998 – 175m\n2026-SR0/001832 – 25m`;

test('rendelésszám típussal és perjel utáni azonosítóval', () => eq(V.extractOrderRefs('2026-KRPR/000745'), [{year:'2026',type:'KRPR',no:'000745',full:'2026-KRPR/000745'}]));
test('visszáru három eredeti rendelésszámát megtartja', () => eq(V.extractOrderRefs(returnBody).map(x=>x.no), ['002226','001998','001832']));
test('ismeretlen cég Felvétel címe blokkból', () => {
  const x=V.extractExplicitPickup(cityBody); eq(x.name,'Gali SwimTex Kft.'); eq(x.address,'2142 Nagytarcsa, Gránit utca 15'); ok(x.autoMaster);
});
test('City Pearl import: Gali → City Pearl', () => {
  const e=V.buildExtractedEntry({category:'dobozos',sourceName:'Megrendelés_City Pearl_II_260804_004932.msg',subject:'Megrendelés_City Pearl_II_260804_004932',body:cityBody,pdfText:cityPdf,pdfLines:cityPdf.split('\n')});
  eq(e.orderNo,'004932'); eq(e.pickupName,'Gali SwimTex Kft.'); eq(e.pickupAddress,'2142 Nagytarcsa, Gránit utca 15'); eq(e.projectName,'Budapest_City_pearl_II.ütem'); eq(e.dropAddress,'1095 Budapest, Soroksári út 58.'); ok(e.newSupplierData);
});
test('KRPR: felrakó mindig a központi raktár', () => {
  const e=V.buildExtractedEntry({category:'dobozos',sourceName:'Raktárközi_Lejardin_000745.msg',subject:'Raktárközi_Lejardin_000745',body:'',pdfText:krprPdf,pdfLines:krprPdf.split('\n')});
  eq(e.orderType,'KRPR'); eq(e.orderNo,'000745'); eq(e.pickupAddress,'2310 Szigetszentmiklós, Kereskedő utca 2.'); eq(e.projectName,'Budapest_LeJardin_II_felépítmény'); eq(e.dropAddress,'1134 Budapest, Rozsnyai utca 14–18.');
});
test('KRPR: hiányzó célraktárcímet a projekttörzsből pótolja', () => {
  const p=V.projectWithAddressFromMaster({name:'Le Jardin'},'Cél raktár: Budapest_LeJardin_II_felépítmény');
  eq(p.id,'p-lj'); eq(p.address,'1134 Budapest, Rozsnyai utca 14–18.');
  const entry={category:'dobozos',scheduleDate:'2026-08-05',orderNo:'000746',sourceOrderNos:['000746'],orderType:'KRPR',pickupRole:'warehouse',dropRole:'project',pickupName:'Szigetszentmiklósi Központi Raktár',pickupAddress:'2310 Szigetszentmiklós, Kereskedő utca 2.',projectName:'Le Jardin',projectId:'',dropAddress:'',items:[],sourceName:'x.msg',sourcePdfText:'Cél raktár: Budapest_LeJardin_II_felépítmény',warnings:['Lerakó címe hiányzik a törzsadatból']};
  const o=V.entryToOrder(entry);
  eq(o.projectId,'p-lj'); eq(o.projectName,'Budapest_LeJardin_II_felépítmény'); eq(o.dropAddress,'1134 Budapest, Rozsnyai utca 14–18.');
});
test('PRPR: forrás raktár a felrakó, célraktár a lerakó', () => {
  const t='2026-PRPR/000999\nForrás raktár: Budapest_Cosmo_Residence\nCél raktár: Budapest_LeJardin_II_felépítmény';
  const e=V.buildExtractedEntry({category:'dobozos',sourceName:'x.msg',subject:'Raktárközi',body:'',pdfText:t,pdfLines:[]});
  eq(e.orderType,'PRPR'); eq(e.pickupName,'Budapest_Cosmo_Residence'); eq(e.pickupAddress,'1133 Budapest, Hegedűs Gyula utca 53.'); eq(e.projectName,'Budapest_LeJardin_II_felépítmény');
});
test('visszáru megfordítja az irányt és egy buborékban tartja a számokat', () => {
  const e=V.buildExtractedEntry({category:'dobozos',sourceName:'Kekelit visszáru - Cosmo.msg',subject:'Kekelit visszáru - Cosmo',body:returnBody,pdfText:'',pdfLines:[]});
  eq(e.orderType,'VISSZARU'); eq(e.pickupName,'Budapest_Cosmo_Residence'); eq(e.pickupAddress,'1133 Budapest, Hegedűs Gyula utca 53.'); eq(e.projectName,'Szatmári Kft. – Késmárk'); eq(e.dropAddress,'1158 Budapest, Késmárk utca 9.'); eq(e.orderNo,'002226, 001998, 001832'); eq(e.items[0].qty,'400');
});
test('új beszállító automatikusan bekerül a törzsbe', () => {
  const before=state.suppliers.length; const entry={newSupplierData:{name:'Új Teszt Kft.',address:'2222 Teszt, Próba utca 1.',phone:'123',email:'a@b.hu'},pickupRole:'supplier',pickupName:'Új Teszt Kft.'};
  const s=V.ensureSupplierMaster(entry); eq(state.suppliers.length,before+1); eq(s.address,'2222 Teszt, Próba utca 1.'); ok(s.autoCreatedFromOutlook);
});
test('Szerelvénybolt címmigráció', () => { V.migrateV41MasterData(); eq(state.suppliers.find(x=>x.id==='s-szer').address,'1182 Budapest, Üllői út 807/B'); });
test('hátralékból csak a leokézott tétel kerül ki', () => {
  const o={id:'bo1',movedFromOrderId:'src',items:[{_id:'i1',received:true},{_id:'i2',received:false}]}; state.backlog=[{id:'b1',targetOrderId:'bo1',itemId:'i1'},{id:'b2',targetOrderId:'bo1',itemId:'i2'}]; state.resolvedBacklog=[];
  V.syncBacklogItemState(o); eq(state.backlog.map(x=>x.id),['b2']); eq(state.resolvedBacklog.map(x=>x.id),['b1']); eq(o.completed,false);
});
test('Martin import fix Martin', () => {
  const o=V.entryToOrder({category:'martin',scheduleDate:'2026-08-05',orderNo:'004911',sourceOrderNos:['004911'],orderType:'SR0',pickupRole:'supplier',dropRole:'project',pickupName:'Szatmári Kft. – Késmárk',pickupAddress:'1158 Budapest, Késmárk utca 9.',projectName:'Budapest_Kincsem_K6',dropAddress:'1106 Budapest, Gyógyszergyári utca 14.',items:[],sourceName:'x.msg'});
  eq(o.vehicleId,'v-martin'); eq(o.importVehicleLocked,true);
});
console.log(`\nV41 teszt: ${passed}/${passed+failed} sikeres.`);
if (failed) process.exit(1);
