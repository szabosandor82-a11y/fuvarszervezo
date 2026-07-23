const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

function norm(s=''){return String(s).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[_.,;:()[\]{}\/\\-]+/g,' ').replace(/\s+/g,' ').trim()}
function createContext(){
  const ctx={console,Math,Date,Set,Map,Array,Object,String,Number,Boolean,RegExp,JSON,Promise,Error,Infinity,NaN,Intl,fetch:undefined,document:undefined,window:undefined,globalThis:null};
  ctx.globalThis=ctx;
  ctx.norm=norm;
  ctx.v29Km=(a,b)=>{if(!a||!b)return 40;const dx=(a[0]-b[0])*111,dy=(a[1]-b[1])*75;return Math.sqrt(dx*dx+dy*dy)};
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
  ctx.geoMap={KRPR:[47.34,19.04]};
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(__dirname+'/planner-v32.js','utf8'),ctx,{filename:'planner-v32.js'});
  vm.runInContext(fs.readFileSync(__dirname+'/planner-v33.js','utf8'),ctx,{filename:'planner-v33.js'});
  vm.runInContext(fs.readFileSync(__dirname+'/planner-v34.js','utf8'),ctx,{filename:'planner-v34.js'});
  return ctx;
}

function vehicle(id,name,type='3.5 T dobozos autó',home=[47.5,19.1]){return{id,driverName:name,type,homePoint:home,active:true}}
function order(id,pickupName,pickupAddress,projectName,dropAddress,extra={}){return{id,scheduleDate:'2026-07-24',vehicleId:'',sequence:999,orderNo:id,pickupName,pickupAddress,projectName,dropAddress,items:[{name:'anyag',qty:1,unit:'db'}],...extra}}
function drivers(){return[vehicle('m','Márió'),vehicle('p','Patrik'),vehicle('t','Martin','3.5 T plató autó',[47.62,18.88])]}

(async()=>{
  let passed=0;
  const test=async(name,fn)=>{try{await fn();console.log('OK',name);passed++}catch(e){console.error('HIBA',name,e);process.exitCode=1}};

  await test('Autó kategóriák felismerése',async()=>{
    const c=createContext();
    assert.equal(c.V34Planner.classifyAutoValue('Patrik'),'patrik');
    assert.equal(c.V34Planner.classifyAutoValue('Márió'),'mario');
    assert.equal(c.V34Planner.classifyAutoValue('Martin'),'martin');
    assert.equal(c.V34Planner.classifyAutoValue('Dobozos'),'dobozos');
    assert.equal(c.V34Planner.classifyAutoValue(''),'invalid');
  });

  await test('Névre jelölt fuvarok fixen a megadott sofőrhöz kerülnek',async()=>{
    const c=createContext(); c.state.vehicles=drivers();
    c.geoMap.PEST=[47.49,19.15]; c.geoMap.BUDA=[47.49,18.98]; c.geoMap.CENTRAL=[47.34,19.04]; c.geoMap.D=[47.5,19.1];
    const list=[
      order('1','Pesti pont','PEST','A','D',{importVehicleCategory:'patrik',importVehicleLocked:true}),
      order('2','Budai pont','BUDA','B','D',{importVehicleCategory:'mario',importVehicleLocked:true}),
      order('3','Központ','CENTRAL','C','D',{importVehicleCategory:'martin',importVehicleLocked:true})
    ];
    await c.V34Planner.distributeOrderSet(list);
    assert.equal(list[0].vehicleId,'p');
    assert.equal(list[1].vehicleId,'m');
    assert.equal(list[2].vehicleId,'t');
  });

  await test('Dobozos: Buda Patrik, Pest Márió',async()=>{
    const c=createContext(); c.state.vehicles=drivers();
    c.geoMap.BUDA=[47.49,18.99]; c.geoMap.PEST=[47.49,19.12]; c.geoMap.D1=[47.5,19.1]; c.geoMap.D2=[47.5,19.11];
    const list=[
      order('b','Niczuk','BUDA','X','D1',{importVehicleCategory:'dobozos'}),
      order('p','Ezerker','PEST','Y','D2',{importVehicleCategory:'dobozos'})
    ];
    await c.V34Planner.distributeOrderSet(list);
    assert.equal(list[0].vehicleId,'p');
    assert.equal(list[1].vehicleId,'m');
  });

  await test('Kevés martini fix fuvarnál Martin is kap Dobozos terhelést',async()=>{
    const c=createContext(); c.state.vehicles=drivers();
    c.geoMap.MF=[47.55,19.03]; c.geoMap.MD=[47.5,19.1];
    const list=[order('mf','Martin fix','MF','Fix','MD',{importVehicleCategory:'martin',importVehicleLocked:true})];
    for(let i=0;i<6;i++){
      c.geoMap['B'+i]=[47.45+i*.003,18.96+i*.002]; c.geoMap['BD'+i]=[47.5,19.1];
      list.push(order('b'+i,'Budai '+i,'B'+i,'BP'+i,'BD'+i,{importVehicleCategory:'dobozos'}));
    }
    for(let i=0;i<6;i++){
      c.geoMap['P'+i]=[47.45+i*.003,19.12+i*.002]; c.geoMap['PD'+i]=[47.5,19.1];
      list.push(order('p'+i,'Pesti '+i,'P'+i,'PP'+i,'PD'+i,{importVehicleCategory:'dobozos'}));
    }
    await c.V34Planner.distributeOrderSet(list);
    const martinBox=list.filter(o=>o.vehicleId==='t'&&o.importVehicleCategory==='dobozos').length;
    assert.ok(martinBox>0,'Martin nem kapott Dobozos fuvarokat');
  });

  await test('Sok martini szálas tehernél Martin nem kap Dobozos fuvart',async()=>{
    const c=createContext(); c.state.vehicles=drivers();
    const list=[];
    for(let i=0;i<6;i++){
      c.geoMap['L'+i]=[47.45,19.02+i*.002]; c.geoMap['LD'+i]=[47.5,19.1];
      list.push(order('l'+i,'Hosszú '+i,'L'+i,'LP'+i,'LD'+i,{importVehicleCategory:'martin',importVehicleLocked:true,longMaterialReason:'6 méteres szálanyag'}));
    }
    for(let i=0;i<5;i++){
      c.geoMap['B'+i]=[47.45,18.96+i*.002]; c.geoMap['BD'+i]=[47.5,19.1];
      list.push(order('b'+i,'Budai '+i,'B'+i,'BP'+i,'BD'+i,{importVehicleCategory:'dobozos'}));
    }
    for(let i=0;i<5;i++){
      c.geoMap['P'+i]=[47.45,19.13+i*.002]; c.geoMap['PD'+i]=[47.5,19.1];
      list.push(order('p'+i,'Pesti '+i,'P'+i,'PP'+i,'PD'+i,{importVehicleCategory:'dobozos'}));
    }
    await c.V34Planner.distributeOrderSet(list);
    assert.equal(list.filter(o=>o.vehicleId==='t'&&o.importVehicleCategory==='dobozos').length,0);
  });

  await test('Azonos felrakó+lerakó, eltérő névre jelölés nem húzza át egymást',async()=>{
    const c=createContext(); c.state.vehicles=drivers();
    c.geoMap.X=[47.5,19.1]; c.geoMap.D=[47.51,19.11];
    const list=[
      order('1','Azonos','X','Azonos projekt','D',{importVehicleCategory:'patrik',importVehicleLocked:true}),
      order('2','Azonos','X','Azonos projekt','D',{importVehicleCategory:'mario',importVehicleLocked:true})
    ];
    await c.V34Planner.distributeOrderSet(list);
    assert.equal(list[0].vehicleId,'p');
    assert.equal(list[1].vehicleId,'m');
  });

  await test('Központi Dobozos fuvarok közel igazságosan oszlanak',async()=>{
    const c=createContext(); c.state.vehicles=drivers();
    const list=[];
    for(let i=0;i<9;i++){
      c.geoMap['K'+i]=[47.34,19.04]; c.geoMap['D'+i]=[47.45+i*.002,19.08];
      list.push(order('k'+i,'Központi raktár','K'+i,'P'+i,'D'+i,{importVehicleCategory:'dobozos'}));
    }
    await c.V34Planner.distributeOrderSet(list);
    const counts=Object.fromEntries(['m','p','t'].map(id=>[id,list.filter(o=>o.vehicleId===id).length]));
    const spread=Math.max(...Object.values(counts))-Math.min(...Object.values(counts));
    assert.ok(spread<=1,JSON.stringify(counts));
  });

  await test('Az optimalizálás nem változtatja meg a kiosztott sofőrt',async()=>{
    const c=createContext(); c.state.vehicles=drivers();
    c.geoMap.KRPR=[47.34,19.04]; c.geoMap.A=[47.42,19.07]; c.geoMap.D1=[47.5,19.1]; c.geoMap.D2=[47.51,19.11];
    c.state.orders=[
      order('1','Központi raktár','KRPR','A','D1',{vehicleId:'p',importVehicleCategory:'patrik',importVehicleLocked:true}),
      order('2','Attacső','A','B','D2',{vehicleId:'p',importVehicleCategory:'dobozos'})
    ];
    const before=c.state.orders.map(o=>o.vehicleId);
    await c.V34Planner.v34OptimizeAction();
    assert.deepEqual(c.state.orders.map(o=>o.vehicleId),before);
  });

  if(!process.exitCode)console.log(`\nSikeres tesztek: ${passed}/8`);
})();
