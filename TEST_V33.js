const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

function norm(s=''){return String(s).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[_.,;:()[\]{}\/\\-]+/g,' ').replace(/\s+/g,' ').trim()}
function createContext(){
  const ctx={console,Math,Date,Set,Map,Array,Object,String,Number,Boolean,RegExp,JSON,Promise,Error,Infinity,NaN,Intl,fetch:undefined,document:undefined,window:undefined,globalThis:null};
  ctx.globalThis=ctx;
  ctx.norm=norm;
  ctx.v29Km=(a,b)=>{if(!a||!b)return 60;const dx=(a[0]-b[0])*111,dy=(a[1]-b[1])*75;return Math.sqrt(dx*dx+dy*dy)};
  ctx.canCarryLong=v=>/plato|plató|kcr|kamion/.test(norm(v.type));
  ctx.syncOrderFromMasters=()=>{};
  ctx.state={settings:{baseAddress:'KRPR'},vehicles:[],orders:[],routePlans:{},routeStats:{}};
  ctx.selectedDate=()=> '2026-07-24';
  ctx.activeVehicles=()=>ctx.state.vehicles.filter(v=>v.active!==false);
  ctx.dayOrders=(id)=>ctx.state.orders.filter(o=>o.scheduleDate===ctx.selectedDate()&&o.vehicleId===id);
  ctx.vehicleHome=async v=>v.homePoint;
  ctx.geo=async address=>ctx.geoMap[address]||null;
  ctx.orderGeoProfile=async o=>({pickup:ctx.geoMap[o.pickupAddress]||null,drop:ctx.geoMap[o.dropAddress]||null});
  ctx.save=()=>{};
  ctx.alert=()=>{};
  ctx.KEY='test';
  ctx.localStorage={setItem(){}};
  ctx.geoMap={KRPR:[47.34,19.04]};
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(__dirname+'/planner-v32.js','utf8'),ctx,{filename:'planner-v32.js'});
  vm.runInContext(fs.readFileSync(__dirname+'/planner-v33.js','utf8'),ctx,{filename:'planner-v33.js'});
  return ctx;
}

function vehicle(id,name,type='3.5 T dobozos autó',home=[47.5,19.1]){return{id,driverName:name,type,homePoint:home,active:true}}
function order(id,pickupName,pickupAddress,projectName,dropAddress,extra={}){return{id,scheduleDate:'2026-07-24',vehicleId:'',sequence:999,orderNo:id,pickupName,pickupAddress,projectName,dropAddress,items:[{name:'anyag',qty:1,unit:'db'}],...extra}}

(async()=>{
  let passed=0;
  const test=async(name,fn)=>{try{await fn();console.log('OK',name);passed++}catch(e){console.error('HIBA',name,e);process.exitCode=1}};

  await test('Azonos felrakó+lerakó egy buborék',async()=>{
    const c=createContext();
    const list=[order('1','KRPR','KRPR','Metro','D1'),order('2','KRPR','KRPR','Metro','D1'),order('3','KRPR','KRPR','Más','D2')];
    const groups=c.V33Planner.orderedBubbleGroups(list);
    assert.equal(groups.length,2);
    assert.equal(groups.find(g=>g.dropAddress==='D1').orders.length,2);
  });

  await test('Rögzített buborék megőrzi a pozícióját',async()=>{
    const c=createContext();
    const groups=[
      {key:'a',sequence:1,pinned:false,orders:[{}]},
      {key:'b',sequence:2,pinned:true,pinnedPosition:3,orders:[{pinnedVehicleId:'v1'}]},
      {key:'c',sequence:3,pinned:false,orders:[{}]}
    ];
    const result=c.V33Planner.applyPinnedPositions(groups,'v1');
    assert.equal(result[2].key,'b');
  });

  await test('Kézi teljes autó jelölés felismerése',async()=>{
    const c=createContext();
    const o=order('1','Lambda','A','Le Jardin','D',{fullLoadExplicit:true,fullLoadManual:true,note:''});
    assert.equal(c.V33Planner.isFullLoadOrder(o),true);
    o.fullLoadManual=false;
    assert.equal(c.V33Planner.isFullLoadOrder(o),false);
  });

  await test('Buda Patrikhoz, Pest Márióhoz kerül',async()=>{
    const c=createContext();
    c.state.vehicles=[vehicle('m','Márió'),vehicle('p','Patrik'),vehicle('t','Martin','3.5 T plató autó')];
    c.geoMap.BUDA=[47.49,19.00]; c.geoMap.PEST=[47.49,19.10]; c.geoMap.D1=[47.50,19.11]; c.geoMap.D2=[47.48,19.12];
    const orders=[order('b','Niczuk','BUDA','X','D1'),order('e','Ezerker','PEST','Y','D2')];
    await c.V33Planner.distributeOrderSet(orders);
    assert.equal(orders.find(o=>o.id==='b').vehicleId,'p');
    assert.equal(orders.find(o=>o.id==='e').vehicleId,'m');
  });

  await test('Budai túlterhelésnél Martin besegít, ha nincs sok szálas anyag',async()=>{
    const c=createContext();
    c.state.vehicles=[vehicle('m','Márió'),vehicle('p','Patrik'),vehicle('t','Martin','3.5 T plató autó')];
    const orders=[];
    for(let i=0;i<10;i++){c.geoMap['B'+i]=[47.45+i*.002,18.96+i*.002];c.geoMap['D'+i]=[47.5,19.1];orders.push(order('b'+i,'Budai '+i,'B'+i,'P'+i,'D'+i));}
    c.geoMap.PEST=[47.5,19.15];c.geoMap.DP=[47.51,19.16];orders.push(order('p1','Pesti','PEST','PP','DP'));
    await c.V33Planner.distributeOrderSet(orders);
    const martinBuda=orders.filter(o=>o.vehicleId==='t'&&o.id.startsWith('b')).length;
    assert.ok(martinBuda>0,'Martin nem kapott budai tehermentesítést');
  });

  await test('Sok szálas anyagnál Martin nem kap további budai túlterhelést',async()=>{
    const c=createContext();
    c.state.vehicles=[vehicle('m','Márió'),vehicle('p','Patrik'),vehicle('t','Martin','3.5 T plató autó')];
    const orders=[];
    for(let i=0;i<6;i++){c.geoMap['L'+i]=[47.44,19.05+i*.002];c.geoMap['LD'+i]=[47.5,19.15];orders.push(order('l'+i,'Hosszú '+i,'L'+i,'LP'+i,'LD'+i,{longMaterialReason:'6 méteres szálanyag'}));}
    for(let i=0;i<8;i++){c.geoMap['B'+i]=[47.45+i*.002,18.96+i*.002];c.geoMap['BD'+i]=[47.5,19.1];orders.push(order('b'+i,'Budai '+i,'B'+i,'BP'+i,'BD'+i));}
    await c.V33Planner.distributeOrderSet(orders);
    const martinExtra=orders.filter(o=>o.vehicleId==='t'&&o.id.startsWith('b')).length;
    assert.equal(martinExtra,0);
  });

  await test('Optimalizálás nem változtat sofőrt és tiszteletben tartja a rögzített első helyet',async()=>{
    const c=createContext();
    c.state.vehicles=[vehicle('t','Martin','3.5 T plató autó',[47.62,18.88])];
    c.geoMap.KRPR=[47.34,19.04]; c.geoMap.ATTA=[47.42,19.07]; c.geoMap.MERK=[47.48,19.14];
    c.geoMap.D1=[47.50,19.10];c.geoMap.D2=[47.51,19.11];c.geoMap.D3=[47.52,19.12];
    c.state.orders=[
      order('1','Központi raktár','KRPR','A','D1',{vehicleId:'t'}),
      order('2','Attacső','ATTA','B','D2',{vehicleId:'t'}),
      order('3','Merkapt','MERK','C','D3',{vehicleId:'t',routePinned:true,pinnedPosition:1,pinnedVehicleId:'t'})
    ];
    await c.V33Planner.v33BuildRoutePlan('t');
    const groups=c.V33Planner.orderedBubbleGroups(c.state.orders);
    assert.equal(groups[0].pickupName,'Merkapt');
    assert.ok(c.state.orders.every(o=>o.vehicleId==='t'));
  });

  await test('Teljes autós blokkban a lerakó közvetlenül a felrakó után következik',async()=>{
    const c=createContext();
    c.state.vehicles=[vehicle('m','Márió')];
    c.geoMap.LAMBDA=[47.49,19.16];c.geoMap.LEJ=[47.54,19.07];c.geoMap.EZER=[47.45,19.13];c.geoMap.K6=[47.49,19.17];
    c.state.orders=[
      order('1','Lambda Akna utca','LAMBDA','Le Jardin','LEJ',{vehicleId:'m',fullLoadExplicit:true,fullLoadManual:true}),
      order('2','Ezerker','EZER','Kincsem','K6',{vehicleId:'m'})
    ];
    const events=await c.V33Planner.v33BuildRoutePlan('m');
    const i=events.findIndex(e=>e.type==='pickup'&&norm(e.name).includes('lambda'));
    assert.ok(i>=0);
    assert.equal(events[i+1]?.type,'drop');
    assert.ok(norm(events[i+1]?.name).includes('le jardin'));
  });

  if(!process.exitCode)console.log(`\nSikeres tesztek: ${passed}/8`);
})();
