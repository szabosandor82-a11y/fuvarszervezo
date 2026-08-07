const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

function norm(s=''){return String(s).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[_.,;:()[\]{}\/\\-]+/g,' ').replace(/\s+/g,' ').trim()}
function createContext(){
  const ctx={console,Math,Date,Set,Map,Array,Object,String,Number,Boolean,RegExp,JSON,Promise,Error,Infinity,NaN,Intl,fetch:undefined,document:undefined,window:undefined,globalThis:null};
  ctx.globalThis=ctx;ctx.norm=norm;ctx.localStorage={setItem(){},getItem(){return null}};ctx.KEY='test';ctx.confirm=()=>true;
  ctx.v29Km=(a,b)=>{if(!a||!b)return 35;const dx=(a[0]-b[0])*111,dy=(a[1]-b[1])*75;return Math.sqrt(dx*dx+dy*dy)};
  ctx.dist=ctx.v29Km;ctx.canCarryLong=v=>/plato|plató|ponyv/.test(norm(v.type));ctx.syncOrderFromMasters=()=>{};
  ctx.state={settings:{baseAddress:'2310 Szigetszentmiklós, Kereskedő utca 2.'},vehicles:[],orders:[],backlog:[],resolvedBacklog:[],routePlans:{},routeStats:{},geo:{},projects:[],suppliers:[],recipients:[],aliases:{projects:{},suppliers:{}}};
  ctx.SEED_DATA={projects:[],suppliers:[],recipients:[]};
  ctx.selectedDate=()=> '2026-08-07';ctx.activeVehicles=()=>ctx.state.vehicles.filter(v=>v.active!==false);ctx.dayOrders=id=>ctx.state.orders.filter(o=>o.scheduleDate===ctx.selectedDate()&&o.vehicleId===id);
  ctx.geoMap={
    '2310 Szigetszentmiklós, Kereskedő utca 2.':[47.3434,19.0437],
    'Vác, Magyarország':[47.7759,19.136], 'Felcsút, Magyarország':[47.455,18.586],
    '2045 Törökbálint, Kinizsi Pál utca 28.':[47.431,18.913],
    '1211 Budapest, II. Rákóczi Ferenc út 175/D':[47.427,19.071],
    '1182 Budapest, Üllői út 807/B':[47.414,19.202],
    '1158 Budapest, Késmárk utca 9.':[47.558,19.178],
    '1106 Budapest, Maglódi út 14/B':[47.489,19.158],
    '1106 Budapest, Kada utca 149.':[47.474,19.169],
    '1205 Budapest, Jókai Mór utca 82.':[47.445,19.106],
    '2310 Szigetszentmiklós, Sáméhegyi út 1-3.':[47.348,19.035],
    '1225 Budapest, Dűlő utca 31-35.':[47.407,19.020],
    '2040 Budaörs, Gyár utca 2.':[47.462,18.946],
    '1117 Budapest, Hengermalom út 47/A':[47.462,19.050],
    '1138 Budapest, Turóc utca 10.':[47.543,19.070],
    '1133 Budapest, Hegedűs Gyula utca 53.':[47.521,19.057],
    '1033 Budapest, Folyamőr utca 9-11.':[47.548,19.040],
    '1134 Budapest, Rozsnyai utca 14-18.':[47.538,19.074],
    '1056 Budapest, Molnár utca 36.':[47.489,19.056],
    '1106 Budapest, Gyógyszergyári utca 14.':[47.486,19.153]
  };
  ctx.geo=async address=>ctx.geoMap[address]||null;
  ctx.vehicleHome=async v=>v.homePoint||ctx.geoMap['2310 Szigetszentmiklós, Kereskedő utca 2.'];
  ctx.orderGeoProfile=async o=>({pickup:ctx.geoMap[o.pickupAddress]||o._point||null,drop:ctx.geoMap[o.dropAddress]||o._dropPoint||null});
  ctx.save=()=>{};ctx.alert=()=>{};ctx.renderCount=0;ctx.render=()=>{ctx.renderCount++};
  vm.createContext(ctx);
  for(const file of ['planner-v32.js','planner-v33.js','planner-v34.js','planner-v35.js','planner-v37.js','planner-v44.js'])vm.runInContext(fs.readFileSync(__dirname+'/'+file,'utf8'),ctx,{filename:file});
  return ctx;
}
function vehicle(id,name){return{id,driverName:name,type:name==='Martin'?'3.5 T ponyvás autó':'3.5 T dobozos autó',active:true}}
function order(id,name,pickupAddress,projectName,dropAddress,extra={}){return{id,scheduleDate:'2026-08-07',vehicleId:'',sequence:999,orderNo:id,pickupName:name,pickupAddress,projectName,dropAddress,items:[{_id:'i'+id,name:'anyag',qty:1,unit:'db',received:false}],importVehicleCategory:'dobozos',...extra}}

function scenario(){
  const c=createContext();
  c.state.vehicles=[vehicle('m','Márió'),vehicle('p','Patrik'),vehicle('t','Martin')];
  const fixed={vehicleId:'t',importVehicleCategory:'martin',importVehicleLocked:true,longMaterialReason:'szálas/platós'};
  c.state.orders=[
    order('T-SEB','Sebők','2045 Törökbálint, Kinizsi Pál utca 28.','Metrodom Beat','1138 Budapest, Turóc utca 10.',fixed),
    order('T-HUN','Hungarokomplex','1211 Budapest, II. Rákóczi Ferenc út 175/D','Cosmo','1133 Budapest, Hegedűs Gyula utca 53.',fixed),
    order('T-SZE','Szerelvénybolt','1182 Budapest, Üllői út 807/B','Waterfront','1033 Budapest, Folyamőr utca 9-11.',fixed),
    order('B-SZE','Szerelvénybolt','1182 Budapest, Üllői út 807/B','Waterfront','1033 Budapest, Folyamőr utca 9-11.'),
    order('M-SZA','Szatmári','1158 Budapest, Késmárk utca 9.','LeJardin','1134 Budapest, Rozsnyai utca 14-18.'),
    order('M-MER','Merkapt','1106 Budapest, Maglódi út 14/B','Moxy VUC','1056 Budapest, Molnár utca 36.'),
    order('M-EZE','Ezerker','1106 Budapest, Kada utca 149.','Kincsem K6','1106 Budapest, Gyógyszergyári utca 14.'),
    order('M-SZO','Szögker','1205 Budapest, Jókai Mór utca 82.','Moxy VUC','1056 Budapest, Molnár utca 36.'),
    order('P-KRP','KRPR','2310 Szigetszentmiklós, Kereskedő utca 2.','Kincsem K6','1106 Budapest, Gyógyszergyári utca 14.'),
    order('P-NIC','Niczuk','2310 Szigetszentmiklós, Sáméhegyi út 1-3.','LeJardin','1134 Budapest, Rozsnyai utca 14-18.'),
    order('P-GIE','Gienger','1225 Budapest, Dűlő utca 31-35.','Moxy VUC','1056 Budapest, Molnár utca 36.'),
    order('P-CAI','Cairox','2040 Budaörs, Gyár utca 2.','LeJardin','1134 Budapest, Rozsnyai utca 14-18.'),
    order('P-LAM','Lambda','1117 Budapest, Hengermalom út 47/A','Kincsem K6','1106 Budapest, Gyógyszergyári utca 14.')
  ];
  return c;
}
function supplierSet(c,id){return [...new Set(c.state.orders.filter(o=>o.vehicleId===id).map(o=>o.pickupName))].sort((a,b)=>a.localeCompare(b,'hu'))}
function pickupNames(c,id){return (c.state.routePlans['2026-08-07']?.[id]||[]).filter(e=>e.type==='pickup').map(e=>e.name)}

(async()=>{
  let passed=0;
  async function test(name,fn){try{await fn();console.log('OK',name);passed++;}catch(e){console.error('HIBA',name,e);process.exitCode=1}}

  await test('A jóváhagyott nap 3/4/5 beszállítói blokkra oszlik',async()=>{
    const c=scenario();const result=await c.V49Planner.distributeOrderSetV44(c.state.orders);
    assert.deepEqual(supplierSet(c,'t'),['Hungarokomplex','Sebők','Szerelvénybolt']);
    assert.deepEqual(supplierSet(c,'m'),['Ezerker','Merkapt','Szatmári','Szögker']);
    assert.deepEqual(supplierSet(c,'p'),['Cairox','Gienger','KRPR','Lambda','Niczuk']);
    assert.deepEqual(result.stopCounts,{m:4,p:5,t:3});
  });

  await test('A két Szerelvénybolt-rendelés ugyanabban a Martin blokkban marad',async()=>{
    const c=scenario();await c.V49Planner.distributeOrderSetV44(c.state.orders);
    assert.deepEqual(c.state.orders.filter(o=>o.pickupName==='Szerelvénybolt').map(o=>o.vehicleId),['t','t']);
  });

  await test('A három sofőr felrakási sorrendje pontosan a jóváhagyott sorrend',async()=>{
    const c=scenario();const result=await c.V49Planner.distributeOrderSetV44(c.state.orders);await c.V49Planner.buildRoutePlansV44(result.profiles);
    assert.deepEqual(pickupNames(c,'t'),['Sebők','Hungarokomplex','Szerelvénybolt']);
    assert.deepEqual(pickupNames(c,'m'),['Szatmári','Merkapt','Ezerker','Szögker']);
    assert.deepEqual(pickupNames(c,'p'),['KRPR','Niczuk','Gienger','Cairox','Lambda']);
  });

  await test('A V49 útvonaltervben egyetlen lerakó sincs',async()=>{
    const c=scenario();const result=await c.V49Planner.distributeOrderSetV44(c.state.orders);await c.V49Planner.buildRoutePlansV44(result.profiles);
    for(const id of ['m','p','t']){
      const events=c.state.routePlans['2026-08-07'][id];
      assert.ok(events.length>0,id+' felrakási útvonala üres');
      assert.ok(events.every(e=>e.type==='pickup'),id+' útvonalába lerakó került');
    }
  });

  await test('Az optimalizálás egyetlen rendelés sofőrjét sem változtatja meg',async()=>{
    const c=scenario();const result=await c.V49Planner.distributeOrderSetV44(c.state.orders);const before=c.state.orders.map(o=>o.vehicleId);
    await c.V49Planner.buildRoutePlansV44(result.profiles);assert.deepEqual(c.state.orders.map(o=>o.vehicleId),before);
  });

  await test('A V49 térképi jelölőhöz tartozik buborékra görgető funkció',async()=>{
    const c=scenario();assert.equal(typeof c.V49Planner.scrollToEventBubbleV49,'function');
  });

  await test('Szétosztás és optimalizálás után azonnal újrarajzolódik a Fuvarok nézet',async()=>{
    const c=scenario();await c.V49Planner.balanceActionV44();assert.equal(c.renderCount,1);
    await c.V49Planner.optimizeActionV44();assert.equal(c.renderCount,2);
  });

  if(!process.exitCode)console.log(`\nV49 elfogadási teszt: ${passed}/7 sikeres.`);
})();
