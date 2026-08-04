const fs = require('fs');
const vm = require('vm');
let passed = 0, failed = 0;
function test(name, fn) { try { fn(); console.log('✓', name); passed++; } catch (e) { console.error('✗', name, '\n ', e.message); failed++; } }
function eq(actual, expected) { if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`várt: ${JSON.stringify(expected)}, kapott: ${JSON.stringify(actual)}`); }

global.state = {
  orders: [],
  suppliers: [
    { id:'s-larex', name:'Larex Trade Kft', address:'1108 Budapest, Maglódi utca 123' },
    { id:'s-szat', name:'Szatmári Kft – Késmárk', address:'1158 Budapest, Késmárk utca 9.' }
  ],
  projects: [
    { id:'p-m76', name:'Budapest_M76', address:'1095 Budapest, Mester u. 76.' },
    { id:'p-k6', name:'Budapest_Kincsem_K6', address:'1106 Budapest, Gyógyszergyári utca 14.' }
  ],
  recipients: [], vehicles:[{id:'v-martin',driverName:'Martin'}]
};
global.activeVehicles = () => global.state.vehicles;
global.selectedDate = () => '2026-08-05';
global.norm = v => String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[_.,;:()[\]{}\/\\-]+/g,' ').replace(/\s+/g,' ').trim();
global.uid = (()=>{let i=0;return()=>`t${++i}`})();
vm.runInThisContext(fs.readFileSync(__dirname + '/planner-v38.js','utf8'), {filename:'planner-v38.js'});
const V = global.V38OutlookImport;

test('perjel utáni rendelésazonosító', () => eq(V.extractOrderNo('2025-SR0/003141'), '003141'));
test('fájlnévből a második számsor a rendelés', () => eq(V.extractOrderNo('Megrendelés_Kincsem_K6_260803_004911_PE-HD.pdf'), '004911'));
test('Kincsem projekt-hint fájlnévből', () => eq(V.inferProjectHint('Megrendelés_Kincsem_K6_260803_004911_PE-HD.pdf'), 'Kincsem K6'));
test('Szatmári + Késmárk felrakó', () => eq(V.supplierSpecial('Szatmáriból, Késmárkról kell felvenni').address, '1158 Budapest, Késmárk utca 9.'));
test('Fogarasi + Hunyadi összekapcsolása', () => eq(V.supplierSpecial('Hunyadi üzlet, melléklet: Fogarasi').name, 'Fogarasi – Hunyadi úti üzlet'));
test('Larex felrakó', () => eq(V.supplierSpecial('Szállító: Larex Trade Kft').address, '1108 Budapest, Maglódi utca 123'));
test('PDF tételsorok felismerése', () => {
  const items = V.parsePdfItemsFromLines(['1 . OSB025 OSB lap 25mm (2500x1250 - 3,125m2/tábla) 6,25m2','2 . EG010 Fenyő fűrészárú 30m']);
  eq(items.length,2); eq(items[0].code,'OSB025'); eq(items[1].longMaterial,true);
});
test('M76 projekt a törzsadatból kap címet', () => {
  const p = V.bestProject('Projekt név Budapest_M76','M76');
  eq(p.address,'1095 Budapest, Mester u. 76.');
});
test('Kincsem projekt a törzsadatból kap címet', () => {
  const p = V.bestProject('Megrendelés_Kincsem_K6_260803_004911','Kincsem K6');
  eq(p.name,'Budapest_Kincsem_K6');
});
test('Martin import fix Martin kategória', () => {
  const o = V.entryToOrder({category:'martin',scheduleDate:'2026-08-05',orderNo:'004911',pickupName:'Szatmári Kft – Késmárk',pickupAddress:'1158 Budapest, Késmárk utca 9.',projectName:'Budapest_Kincsem_K6',dropAddress:'1106 Budapest, Gyógyszergyári utca 14.',items:[],sourceName:'x.msg'});
  eq(o.vehicleId,'v-martin'); eq(o.importVehicleLocked,true); eq(o.importVehicleCategory,'martin');
});
test('Dobozos import kiosztatlan Dobozos kategória', () => {
  const o = V.entryToOrder({category:'dobozos',scheduleDate:'2026-08-05',orderNo:'003141',pickupName:'Larex Trade Kft',pickupAddress:'1108 Budapest, Maglódi utca 123',projectName:'Budapest_M76',dropAddress:'1095 Budapest, Mester u. 76.',items:[],sourceName:'x.msg'});
  eq(o.vehicleId,''); eq(o.importVehicleLocked,false); eq(o.importVehicleCategory,'dobozos');
});
console.log(`\nV38 teszt: ${passed}/${passed+failed} sikeres.`);
if (failed) process.exit(1);
