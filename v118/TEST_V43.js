const fs = require('fs');
const vm = require('vm');
let passed = 0, failed = 0;
function test(name, fn) { Promise.resolve().then(fn).then(() => { console.log('✓', name); passed++; }).catch(error => { console.error('✗', name, '\n ', error.stack || error); failed++; }).finally(done); }
let pending = 0; function done(){ if(--pending===0){ console.log(`\nV43 teszt: ${passed}/${passed+failed} sikeres.`); if(failed)process.exitCode=1; } }
function run(name, fn){ pending++; test(name, fn); }
function ok(value, message='feltétel nem teljesült'){ if(!value) throw new Error(message); }
function eq(actual, expected){ if(JSON.stringify(actual)!==JSON.stringify(expected)) throw new Error(`várt: ${JSON.stringify(expected)}, kapott: ${JSON.stringify(actual)}`); }
const norm = value => String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[_.,;:()[\]{}\/\\-]+/g,' ').replace(/\s+/g,' ').trim();
global.norm = norm;
global.state = {
  projects:[
    {id:'p-cosmo',name:'Budapest_Cosmo_Residence',address:'1133 Budapest, Hegedűs Gyula utca 53.'},
    {id:'p-cp',name:'Budapest_City_pearl_II.ütem',address:'1095 Budapest, Soroksári út 58.'},
    {id:'p-central',name:'Központi raktár',address:'2310 Szigetszentmiklós, Kereskedő utca 2.'}
  ],
  suppliers:[{id:'s-head',name:'Szatmári Kft',address:'1089 Budapest, Reguly Antal utca 18.'}],
  recipients:[], orders:[], vehicles:[
    {id:'mario',driverName:'Márió',active:true,homeAddress:'Vác'},
    {id:'patrik',driverName:'Patrik',active:true,homeAddress:'Kispest'},
    {id:'martin',driverName:'Martin',active:true,homeAddress:'Felcsút'}
  ], settings:{baseAddress:'2310 Szigetszentmiklós, Kereskedő utca 2.'}, aliases:{projects:{},suppliers:{}}, routePlans:{}, routeStats:{}, geo:{}
};
global.SEED_DATA={projects:state.projects.map(x=>({...x})),suppliers:[]};
global.activeVehicles=()=>state.vehicles.filter(v=>v.active!==false);
global.selectedDate=()=> '2026-08-05';
global.dayOrders=id=>state.orders.filter(o=>o.scheduleDate==='2026-08-05'&&o.vehicleId===id);
global.save=()=>{}; global.render=()=>{}; global.alert=()=>{};
const coords = new Map();
function pt(address){ if(!coords.has(address)) coords.set(address,[47.3+coords.size*0.001,19+coords.size*0.001]); return coords.get(address); }
global.geo=async address=>{
  if(/Vác/i.test(address)) return [47.7759,19.136];
  if(/Felcsút/i.test(address)) return [47.455,18.586];
  if(/Szigetszentmiklós/i.test(address)) return [47.3434,19.0437];
  return pt(address);
};
global.orderGeoProfile=async order=>({pickup:order._point||pt(order.pickupAddress),drop:null});
global.V35Planner={
  categoryForOrder(order){
    if(order.importVehicleLocked&&order.vehicleId) return order.importVehicleCategory||`fixed:${order.vehicleId}`;
    return order.importVehicleCategory||'dobozos';
  },
  distributionUnitKey(order){ return `${order.pickupAddress}||${order.importVehicleLocked?order.vehicleId:'dobozos'}`; },
  physicalLoad(order){ return {long:order.longMaterialReason?1:0,bulky:0,full:0}; }
};
vm.runInThisContext(fs.readFileSync(__dirname+'/planner-v43.js','utf8'),{filename:'planner-v43.js'});
const V=global.V43Planner;
function order(id,address,side,extra={}){
  const point=side==='buda'?[47.48,18.98]:side==='pest'?[47.48,19.15]:[47.4,19.04];
  return {id,scheduleDate:'2026-08-05',pickupName:id,pickupAddress:address,projectName:'Projekt',dropAddress:'Cím',pickupRole:'supplier',dropRole:'project',items:[],importVehicleCategory:'dobozos',vehicleId:'',_point:point,...extra};
}
run('friss törzsadat összevonás hozzáadja a Késmárk, Merkapt és Sebők telephelyet',()=>{
  V.mergeSeedMasterData();
  ok(state.suppliers.some(s=>norm(s.address)===norm('1158 Budapest, Késmárk utca 9.')));
  ok(state.suppliers.some(s=>norm(s.address)===norm('1106 Budapest, Maglódi út 14/B')));
  ok(state.suppliers.some(s=>norm(s.address)===norm('2045 Törökbálint, Kinizsi utca 28.')));
});
run('visszárunál a projekt a felrakó, a beszállító a lerakó és nincs téves hiányjelzés',()=>{
  const o={id:'r',isReturn:true,pickupRole:'project',dropRole:'supplier',pickupName:'Budapest_Cosmo_Residence',pickupAddress:'',projectName:'Szatmári Kft. – Késmárk',dropAddress:'',returnSourceProjectId:'p-cosmo',items:[]};
  V.syncOrderFromMastersV43(o,{forceSupplier:true,forceProject:true});
  eq(o.pickupAddress,'1133 Budapest, Hegedűs Gyula utca 53.');
  eq(o.dropAddress,'1158 Budapest, Késmárk utca 9.');
  eq(V.masterWarningsV43(o),'');
});
run('Márió Vác, Martin Felcsút, Patrik a központi raktár felől indul',async()=>{
  eq(await V.vehicleHomeV43(state.vehicles[0]),[47.7759,19.136]);
  eq(await V.vehicleHomeV43(state.vehicles[1]),[47.3434,19.0437]);
  eq(await V.vehicleHomeV43(state.vehicles[2]),[47.455,18.586]);
});
run('névre rögzített fuvar automatikusan nem mozdul',async()=>{
  const fixed=order('fixed-buda','1117 Budapest, Buda 1','buda',{vehicleId:'mario',importVehicleCategory:'mario',importVehicleLocked:true});
  state.orders=[fixed];
  await V.distributeOrderSetV43(state.orders);
  eq(fixed.vehicleId,'mario');
});
run('Márió a pesti, Patrik a budai oldalt kapja; Martin igazságosan besegít',async()=>{
  const orders=[];
  for(let i=0;i<8;i++) orders.push(order(`b${i}`,`111${i%10} Budapest, Budai út ${i+1}.`,'buda'));
  for(let i=0;i<8;i++) orders.push(order(`p${i}`,`110${i%10} Budapest, Pesti út ${i+1}.`,'pest'));
  for(let i=0;i<4;i++) orders.push(order(`m${i}`,`206${i} Felcsút környéke ${i+1}.`,'neutral',{vehicleId:'martin',importVehicleCategory:'martin',importVehicleLocked:true,longMaterialReason:'6 méteres szálanyag'}));
  state.orders=orders;
  const result=await V.distributeOrderSetV43(orders);
  const counts=result.stopCounts;
  ok(Math.max(...Object.values(counts))-Math.min(...Object.values(counts))<=2,`nem igazságos: ${JSON.stringify(counts)}`);
  ok(orders.filter(o=>o.id.startsWith('b')&&o.vehicleId==='mario').length===0,'budai Dobozos került Márióhoz');
  ok(orders.filter(o=>o.id.startsWith('p')&&o.vehicleId==='patrik').length===0,'pesti Dobozos került Patrikhoz');
  ok(counts.martin>=6,`Martin csak ${counts.martin} címet kapott`);
  ok(orders.filter(o=>o.id.startsWith('m')).every(o=>o.vehicleId==='martin'),'Martin névre rögzített fuvar elmozdult');
});
