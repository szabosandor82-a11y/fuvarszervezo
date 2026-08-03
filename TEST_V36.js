const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

function norm(s=''){return String(s).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[_.,;:()[\]{}\/\\-]+/g,' ').replace(/\s+/g,' ').trim()}
function createContext(){
  const ctx={console,Math,Date,Set,Map,Array,Object,String,Number,Boolean,RegExp,JSON,Promise,Error,Infinity,NaN,Intl,fetch:undefined,document:undefined,window:undefined,globalThis:null};
  ctx.globalThis=ctx;ctx.norm=norm;ctx.localStorage={setItem(){},getItem(){return null}};ctx.KEY='test';
  ctx.v29Km=(a,b)=>{if(!a||!b)return 35;const dx=(a[0]-b[0])*111,dy=(a[1]-b[1])*75;return Math.sqrt(dx*dx+dy*dy)};
  ctx.canCarryLong=v=>/plato|plató|ponyv/.test(norm(v.type));ctx.syncOrderFromMasters=()=>{};
  ctx.state={settings:{baseAddress:'KRPR'},vehicles:[],orders:[],backlog:[],resolvedBacklog:[],routePlans:{},routeStats:{},geo:{},projects:[],suppliers:[],recipients:[],aliases:{projects:{},suppliers:{}}};
  ctx.selectedDate=()=> '2026-08-04';ctx.activeVehicles=()=>ctx.state.vehicles.filter(v=>v.active!==false);ctx.dayOrders=id=>ctx.state.orders.filter(o=>o.scheduleDate===ctx.selectedDate()&&o.vehicleId===id);
  ctx.geoMap={KRPR:[47.34,19.04],CAIROX:[47.42,18.91],SEBOK:[47.44,18.91],NICZUK:[47.38,19.01],LAMBDA:[47.46,19.05],DROP:[47.50,19.08]};
  ctx.geo=async address=>ctx.geoMap[address]||null;ctx.vehicleHome=async v=>v.homePoint||ctx.geoMap.KRPR;ctx.orderGeoProfile=async o=>({pickup:ctx.geoMap[o.pickupAddress]||null,drop:ctx.geoMap[o.dropAddress]||null});
  ctx.save=()=>{};ctx.alert=()=>{};
  vm.createContext(ctx);
  for(const file of ['planner-v32.js','planner-v33.js','planner-v34.js','planner-v35.js','planner-v36.js'])vm.runInContext(fs.readFileSync(__dirname+'/'+file,'utf8'),ctx,{filename:file});
  return ctx;
}
function vehicle(id,name,home=[47.5,19.1]){return{id,driverName:name,type:name==='Martin'?'3.5 T ponyvás autó':'3.5 T dobozos autó',homePoint:home,active:true}}
function order(id,pickupName,pickupAddress,vehicleId){return{id,scheduleDate:'2026-08-04',vehicleId,sequence:999,orderNo:id,pickupName,pickupAddress,projectName:'Projekt',dropAddress:'DROP',items:[{_id:'i'+id,name:'anyag',qty:1,unit:'db',received:false}],importVehicleCategory:'dobozos'}}
function stop(name,key){return{name,address:name,key,orders:[],point:[47.4,19],fullLoad:false}}
function names(stops){return stops.map(x=>x.name)}

(async()=>{
  let passed=0;
  async function test(name,fn){try{await fn();console.log('OK',name);passed++;}catch(e){console.error('HIBA',name,e);process.exitCode=1}}

  await test('Patrik iránya: Központi -> Niczuk -> Cairox -> Sebők -> Lambda',async()=>{
    const c=createContext();
    const input=[stop('Sebők'),stop('Lambda'),stop('Cairox'),stop('Központi raktár'),stop('Niczuk')];
    assert.deepEqual(names(c.V36Planner.applyDirectionalRules(input,'patrik')),['Központi raktár','Niczuk','Cairox','Sebők','Lambda']);
  });

  await test('Martin és Márió iránya Cairox jelenlétében megfordul',async()=>{
    const c=createContext();
    const input=[stop('Niczuk'),stop('Lambda'),stop('Központi raktár'),stop('Sebők'),stop('Cairox')];
    const expected=['Cairox','Sebők','Központi raktár','Niczuk','Lambda'];
    assert.deepEqual(names(c.V36Planner.applyDirectionalRules(input,'martin')),expected);
    assert.deepEqual(names(c.V36Planner.applyDirectionalRules(input,'mario')),expected);
  });

  await test('Cairox nélkül a korábbi Martin-sorrend nem íródik felül',async()=>{
    const c=createContext();
    const input=[stop('Sebők'),stop('Niczuk'),stop('Központi raktár'),stop('Lambda')];
    assert.deepEqual(names(c.V36Planner.applyDirectionalRules(input,'martin')),names(input));
  });


  await test('A teljes V36 útvonalterv is a sofőr szerinti irányt adja',async()=>{
    const c=createContext();c.state.vehicles=[vehicle('p','Patrik'),vehicle('t','Martin',[47.45,18.59]),vehicle('m','Márió',[47.78,19.13])];
    const base=[
      ['K','Központi raktár','KRPR'],['N','Niczuk','NICZUK'],['C','Cairox','CAIROX'],['S','Sebők','SEBOK'],['L','Lambda','LAMBDA']
    ];
    for(const [driverId,prefix] of [['p','P'],['t','T'],['m','M']]) for(const [id,name,address] of base)c.state.orders.push(order(prefix+id,name,address,driverId));
    const patrik=await c.V36Planner.v36BuildRoutePlan('p');
    const martin=await c.V36Planner.v36BuildRoutePlan('t');
    const mario=await c.V36Planner.v36BuildRoutePlan('m');
    assert.deepEqual(patrik.filter(e=>e.type==='pickup').map(e=>e.name),['Központi raktár','Niczuk','Cairox','Sebők','Lambda']);
    const inbound=['Cairox','Sebők','Központi raktár','Niczuk','Lambda'];
    assert.deepEqual(martin.filter(e=>e.type==='pickup').map(e=>e.name),inbound);
    assert.deepEqual(mario.filter(e=>e.type==='pickup').map(e=>e.name),inbound);
  });

  await test('Kipipált hátralék kikerül a nyitott listából és elintézett lesz',async()=>{
    const c=createContext();
    const o=order('B1','Ezerker','NICZUK','m');o.movedFromOrderId='orig';o.items[0].received=true;
    c.state.orders=[o];c.state.backlog=[{id:'b',targetOrderId:o.id,itemId:o.items[0]._id,orderNo:o.orderNo}];
    c.V36Planner.syncBacklogForOrder(o);
    assert.equal(c.state.backlog.length,0);assert.equal(c.state.resolvedBacklog.length,1);assert.equal(o.backlogResolved,true);assert.equal(o.completed,true);
  });

  await test('Újranyitott hátraléktétel visszakerül a nyitott listába',async()=>{
    const c=createContext();
    const o=order('B2','Ezerker','NICZUK','m');o.movedFromOrderId='orig';o.items[0].received=false;
    c.state.orders=[o];c.state.resolvedBacklog=[{id:'b',targetOrderId:o.id,itemId:o.items[0]._id,orderNo:o.orderNo,resolvedAt:'x'}];
    c.V36Planner.syncBacklogForOrder(o);
    assert.equal(c.state.backlog.length,1);assert.equal(c.state.resolvedBacklog.length,0);assert.equal(o.backlogResolved,false);
  });

  await test('Elintézett hátralék nem kerül a felrakási útvonal eseményei közé',async()=>{
    const c=createContext();c.state.vehicles=[vehicle('m','Márió')];
    const done=order('D','Cairox','CAIROX','m');done.movedFromOrderId='orig';done.items[0].received=true;done.completed=true;done.backlogResolved=true;done.sequence=1;
    const active=order('A','Niczuk','NICZUK','m');active.sequence=2;c.state.orders=[done,active];
    const events=await c.V36Planner.v36BuildRoutePlan('m');
    assert.equal(events.some(e=>(e.orders||[]).includes('D')),false);assert.equal(events.some(e=>(e.orders||[]).includes('A')),true);assert.equal(done.sequence,1);
  });

  await test('Ryng hibás régi címe Flamingó közre javul',async()=>{
    const c=createContext();c.state.suppliers=[{name:'Ryng Kft.',address:'2314 Halásztelek, Korbuly u. 1.'}];c.state.orders=[order('R','Ryng Kft.','2800 Tatabánya, Banyi János utca 1.','m')];
    c.V36Planner.migrateRyngAddress();
    assert.equal(c.state.suppliers[0].address,'1173 Budapest, Flamingó köz 4.');assert.equal(c.state.orders[0].pickupAddress,'1173 Budapest, Flamingó köz 4.');
  });

  if(!process.exitCode)console.log(`\nSikeres tesztek: ${passed}/8`);
})();
