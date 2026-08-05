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
  ctx.selectedDate=()=> '2026-08-06';ctx.activeVehicles=()=>ctx.state.vehicles.filter(v=>v.active!==false);ctx.dayOrders=id=>ctx.state.orders.filter(o=>o.scheduleDate===ctx.selectedDate()&&o.vehicleId===id);
  ctx.geoMap={
    '2310 Szigetszentmiklós, Kereskedő utca 2.':[47.3434,19.0437],
    'Vác, Magyarország':[47.7759,19.136],
    'Felcsút, Magyarország':[47.455,18.586],
    '1158 Budapest, Késmárk utca 9.':[47.56,19.17],
    '1106 Budapest, Maglódi út 14/B':[47.49,19.16],
    '1108 Budapest, Ezerker út 1.':[47.44,19.18],
    '1222 Budapest, Gyár utca 15.':[47.39,19.01],
    '2045 Törökbálint, Kinizsi utca 28.':[47.43,18.91],
    '2060 Bicske, Ipari út 1.':[47.49,18.64],
    DROP:[47.5,19.08]
  };
  ctx.geo=async address=>ctx.geoMap[address]||null;ctx.vehicleHome=async v=>v.homePoint||ctx.geoMap['2310 Szigetszentmiklós, Kereskedő utca 2.'];ctx.orderGeoProfile=async o=>({pickup:ctx.geoMap[o.pickupAddress]||o._point||null,drop:ctx.geoMap[o.dropAddress]||null});
  ctx.save=()=>{};ctx.alert=()=>{};ctx.render=()=>{};
  vm.createContext(ctx);
  for(const file of ['planner-v32.js','planner-v33.js','planner-v34.js','planner-v35.js','planner-v37.js','planner-v44.js'])vm.runInContext(fs.readFileSync(__dirname+'/'+file,'utf8'),ctx,{filename:file});
  return ctx;
}
function vehicle(id,name){return{id,driverName:name,type:name==='Martin'?'3.5 T ponyvás autó':'3.5 T dobozos autó',active:true}}
function order(id,name,address,extra={}){return{id,scheduleDate:'2026-08-06',vehicleId:'',sequence:999,orderNo:id,pickupName:name,pickupAddress:address,projectName:'Projekt',dropAddress:'DROP',items:[{_id:'i'+id,name:'anyag',qty:1,unit:'db',received:false}],importVehicleCategory:'dobozos',...extra}}

(async()=>{
  let passed=0;
  async function test(name,fn){try{await fn();console.log('OK',name);passed++;}catch(e){console.error('HIBA',name,e);process.exitCode=1}}

  await test('Márió, Patrik és Martin névre rögzített fuvar nem mozdul',async()=>{
    const c=createContext();c.state.vehicles=[vehicle('m','Márió'),vehicle('p','Patrik'),vehicle('t','Martin')];
    const a=order('A','Niczuk','1222 Budapest, Gyár utca 15.',{vehicleId:'m',importVehicleCategory:'mario',importVehicleLocked:true});
    const b=order('B','Merkapt','1106 Budapest, Maglódi út 14/B',{vehicleId:'p',importVehicleCategory:'patrik',importVehicleLocked:true});
    const d=order('D','Ezerker','1108 Budapest, Ezerker út 1.',{vehicleId:'t',importVehicleCategory:'martin',importVehicleLocked:true});
    c.state.orders=[a,b,d];await c.V44Planner.distributeOrderSetV44(c.state.orders);
    assert.equal(a.vehicleId,'m');assert.equal(b.vehicleId,'p');assert.equal(d.vehicleId,'t');
  });

  await test('Pesti Dobozos Márióhoz, budai Dobozos Patrikhoz, nyugati folyosó Martinhoz kerül',async()=>{
    const c=createContext();c.state.vehicles=[vehicle('m','Márió'),vehicle('p','Patrik'),vehicle('t','Martin')];
    const pest=order('P','Szatmári','1158 Budapest, Késmárk utca 9.');
    const buda=order('B','Niczuk','1222 Budapest, Gyár utca 15.');
    const west=order('W','Bicskei telep','2060 Bicske, Ipari út 1.');
    c.state.orders=[pest,buda,west];await c.V44Planner.distributeOrderSetV44(c.state.orders);
    assert.equal(pest.vehicleId,'m');assert.equal(buda.vehicleId,'p');assert.equal(west.vehicleId,'t');
  });

  await test('Martin alulterhelés miatt sem kap pesti címet',async()=>{
    const c=createContext();c.state.vehicles=[vehicle('m','Márió'),vehicle('p','Patrik'),vehicle('t','Martin')];
    const orders=[];for(let i=0;i<8;i++)orders.push(order('P'+i,'Pesti '+i,`110${i%9} Budapest, Pesti út ${i+1}.`,{_point:[47.45+i*.002,19.12+i*.003]}));
    orders.push(order('W','Bicske','2060 Bicske, Ipari út 1.'));
    c.state.orders=orders;await c.V44Planner.distributeOrderSetV44(orders);
    assert.equal(orders.filter(o=>o.id.startsWith('P')&&o.vehicleId==='t').length,0);
  });

  await test('Azonos fizikai felrakóhely összes mozgatható rendelése egy sofőrhöz kerül',async()=>{
    const c=createContext();c.state.vehicles=[vehicle('m','Márió'),vehicle('p','Patrik'),vehicle('t','Martin')];
    const a=order('A','NICZUK Kft.','1222 Budapest, Gyár utca 15.');
    const b=order('B','Niczuk','1222 Budapest Gyár utca 15');
    const d=order('D','Más név','1222 Budapest, Gyár utca 15.');
    c.state.orders=[a,b,d];await c.V44Planner.distributeOrderSetV44(c.state.orders);
    assert.equal(new Set(c.state.orders.map(o=>o.vehicleId)).size,1);
    assert.equal(a.vehicleId,'p');
  });

  await test('A sofőrök indulási pontja fixen Vác, Felcsút és a központi raktár',async()=>{
    const c=createContext();c.state.vehicles=[vehicle('m','Márió'),vehicle('p','Patrik'),vehicle('t','Martin')];
    assert.deepEqual(await c.V44Planner.vehicleHomeV44(c.state.vehicles[0]),[47.7759,19.136]);
    assert.deepEqual(await c.V44Planner.vehicleHomeV44(c.state.vehicles[1]),[47.3434,19.0437]);
    assert.deepEqual(await c.V44Planner.vehicleHomeV44(c.state.vehicles[2]),[47.455,18.586]);
  });

  await test('Márió felrakási sorrendje Vác felől: Szatmári → Merkapt → Ezerker',async()=>{
    const c=createContext();c.state.vehicles=[vehicle('m','Márió'),vehicle('p','Patrik'),vehicle('t','Martin')];
    c.state.orders=[
      order('E','Ezerker','1108 Budapest, Ezerker út 1.'),
      order('M','Merkapt','1106 Budapest, Maglódi út 14/B'),
      order('S','Szatmári Késmárk','1158 Budapest, Késmárk utca 9.')
    ];
    const result=await c.V44Planner.distributeOrderSetV44(c.state.orders);
    await c.V44Planner.buildRoutePlansV44(result.profiles);
    const ordered=c.dayOrders('m').slice().sort((a,b)=>a.sequence-b.sequence).map(o=>o.pickupName);
    assert.deepEqual(ordered,['Szatmári Késmárk','Merkapt','Ezerker']);
  });

  await test('Az optimalizálás nem változtat sofőrt',async()=>{
    const c=createContext();c.state.vehicles=[vehicle('m','Márió'),vehicle('p','Patrik'),vehicle('t','Martin')];
    c.state.orders=[order('P','Szatmári','1158 Budapest, Késmárk utca 9.'),order('B','Niczuk','1222 Budapest, Gyár utca 15.')];
    const result=await c.V44Planner.distributeOrderSetV44(c.state.orders);const before=c.state.orders.map(o=>o.vehicleId);
    await c.V44Planner.buildRoutePlansV44(result.profiles);assert.deepEqual(c.state.orders.map(o=>o.vehicleId),before);
  });

  if(!process.exitCode)console.log(`\nSikeres V44 tesztek: ${passed}/7`);
})();
