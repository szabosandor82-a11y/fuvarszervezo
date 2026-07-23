const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

function norm(s=''){return String(s).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[_.,;:()[\]{}\/\\-]+/g,' ').replace(/\s+/g,' ').trim()}
function createContext(){
  const ctx={console,Math,Date,Set,Map,Array,Object,String,Number,Boolean,RegExp,JSON,Promise,Error,Infinity,NaN,Intl,fetch:undefined,document:undefined,window:undefined,globalThis:null};
  ctx.globalThis=ctx; ctx.norm=norm;
  ctx.v29Km=(a,b)=>{if(!a||!b)return 35;const dx=(a[0]-b[0])*111,dy=(a[1]-b[1])*75;return Math.sqrt(dx*dx+dy*dy)};
  ctx.canCarryLong=v=>/plato|plató|ponyv/.test(norm(v.type));
  ctx.syncOrderFromMasters=()=>{};
  ctx.state={settings:{baseAddress:'KRPR'},vehicles:[],orders:[],routePlans:{},routeStats:{},projects:[],suppliers:[],recipients:[],aliases:{projects:{},suppliers:{}}};
  ctx.selectedDate=()=> '2026-07-24';
  ctx.activeVehicles=()=>ctx.state.vehicles.filter(v=>v.active!==false);
  ctx.dayOrders=id=>ctx.state.orders.filter(o=>o.scheduleDate===ctx.selectedDate()&&o.vehicleId===id);
  ctx.geoMap={KRPR:[47.34,19.04]};
  ctx.geo=async address=>ctx.geoMap[address]||null;
  ctx.vehicleHome=async v=>v.homePoint||ctx.geoMap[v.homeCity]||ctx.geoMap.KRPR;
  ctx.orderGeoProfile=async o=>({pickup:ctx.geoMap[o.pickupAddress]||null,drop:ctx.geoMap[o.dropAddress]||null});
  ctx.save=()=>{}; ctx.alert=()=>{};
  vm.createContext(ctx);
  for(const file of ['planner-v32.js','planner-v33.js','planner-v34.js','planner-v35.js']){
    vm.runInContext(fs.readFileSync(__dirname+'/'+file,'utf8'),ctx,{filename:file});
  }
  return ctx;
}
function vehicle(id,name,type='3.5 T dobozos autó',home=[47.5,19.1]){return{id,driverName:name,type,homePoint:home,active:true}}
function drivers(){return[
  vehicle('m','Márió','3.5 T dobozos autó',[47.78,19.13]),
  vehicle('p','Patrik','3.5 T dobozos autó',[47.45,19.15]),
  vehicle('t','Martin','3.5 T ponyvás autó',[47.45,18.59])
]}
function order(id,pickupName,pickupAddress,projectName='Projekt',dropAddress='DROP',extra={}){
  return{id,scheduleDate:'2026-07-24',vehicleId:'',sequence:999,orderNo:id,pickupName,pickupAddress,projectName,dropAddress,items:[{name:'anyag',qty:1,unit:'db'}],importVehicleCategory:'dobozos',...extra};
}
function points(c){
  Object.assign(c.geoMap,{
    'SEBOK':[47.44,18.91], 'EGRO':[47.36,18.91], 'NICZUK':[47.38,19.01], 'CAIROX':[47.42,18.91],
    'GIENGER':[47.41,18.93], 'ATTA':[47.40,19.08], 'MERKAPT':[47.49,19.14], 'DT':[47.46,19.22],
    'EMPACK':[47.44,19.05], 'LAMBDA_H':[47.46,19.05], 'SZATMARI':[47.57,19.16], 'LAREX':[47.53,19.10],
    'EZERKER':[47.48,19.16], 'FOGARASI':[47.45,19.13], 'SZOGKER':[47.43,19.14], 'SZERELVENY':[47.42,19.18],
    'NEBER':[47.62,19.14], 'RYNG':[47.36,19.08], 'LAMBDA_A':[47.49,19.17], 'LEJARDIN':[47.54,19.07],
    'DROP':[47.50,19.08], 'DROP2':[47.51,19.09]
  });
}
function names(stops){return stops.map(s=>s.name)}

(async()=>{
  let passed=0;
  async function test(name,fn){try{await fn();console.log('OK',name);passed++;}catch(error){console.error('HIBA',name,error);process.exitCode=1;}}

  await test('A Dobozos azonos külső felrakója egy sofőrnél marad',async()=>{
    const c=createContext(); c.state.vehicles=drivers(); points(c);
    const list=[
      order('1','Niczuk','NICZUK','Moxy','DROP'),
      order('2','Niczuk','NICZUK','Cosmo','DROP2'),
      order('3','Ezerker','EZERKER','Kincsem','DROP')
    ];
    await c.V35Planner.distributeOrderSet(list);
    assert.equal(list[0].vehicleId,list[1].vehicleId);
  });

  await test('Névre jelölt fuvar fix marad',async()=>{
    const c=createContext(); c.state.vehicles=drivers(); points(c);
    const list=[order('1','Ezerker','EZERKER','X','DROP',{importVehicleCategory:'patrik',importVehicleLocked:true})];
    await c.V35Planner.distributeOrderSet(list);
    assert.equal(list[0].vehicleId,'p');
  });

  await test('Terhelésnél a külön felrakók fontosabbak a rendelésdarabszámnál',async()=>{
    const c=createContext(); c.state.vehicles=drivers(); points(c);
    const list=[];
    for(let i=0;i<10;i++) list.push(order('same'+i,'Ezerker','EZERKER','P'+i,'DROP'));
    for(let i=0;i<5;i++){c.geoMap['B'+i]=[47.42+i*.004,18.92+i*.006];list.push(order('b'+i,'Budai '+i,'B'+i,'B'+i,'DROP'));}
    const result=await c.V35Planner.distributeOrderSet(list);
    const values=Object.values(result.workloads);
    assert.ok(Math.max(...values)-Math.min(...values)<5,JSON.stringify(result.workloads));
  });

  await test('Martin normál példája: Központi -> Attacső -> Merkapt -> DT Közmű',async()=>{
    const c=createContext(); c.state.vehicles=drivers(); points(c);
    const v=c.state.vehicles.find(x=>x.id==='t');
    const list=[
      order('k','Központi raktár','KRPR','A','DROP',{vehicleId:'t',importVehicleCategory:'martin',importVehicleLocked:true}),
      order('a','Attacső','ATTA','B','DROP',{vehicleId:'t',importVehicleCategory:'martin',importVehicleLocked:true}),
      order('m','Merkapt kp','MERKAPT','C','DROP',{vehicleId:'t',importVehicleCategory:'martin',importVehicleLocked:true}),
      order('d','DT Közmű','DT','D','DROP',{vehicleId:'t',importVehicleCategory:'martin',importVehicleLocked:true})
    ];
    const profiles=Object.fromEntries(list.map(o=>[o.id,{pickup:c.geoMap[o.pickupAddress],drop:c.geoMap[o.dropAddress]}]));profiles.__base=c.geoMap.KRPR;
    const seq=await c.V35Planner.planPickupStops(v,list,profiles);
    assert.deepEqual(names(seq),['Központi raktár','Attacső','Merkapt kp','DT Közmű']);
  });

  await test('Martin befelé szálas példája: Sebők -> Niczuk -> Központi -> Empack -> Lambda',async()=>{
    const c=createContext(); c.state.vehicles=drivers(); points(c);
    const v=c.state.vehicles.find(x=>x.id==='t');
    const special={vehicleId:'t',importVehicleCategory:'martin',importVehicleLocked:true,longMaterialReason:'6 méteres szálanyag',items:[{name:'6 m cső',longMaterial:true}]};
    const list=[
      order('s','Sebők és Társa kp','SEBOK','A','DROP',special),
      order('n','Niczuk','NICZUK','B','DROP',special),
      order('k','Központi raktár','KRPR','C','DROP',{vehicleId:'t',importVehicleCategory:'martin',importVehicleLocked:true}),
      order('e','Empack','EMPACK','D','DROP',{vehicleId:'t',importVehicleCategory:'martin',importVehicleLocked:true}),
      order('l','Lambda Hengermalom','LAMBDA_H','E','DROP',{vehicleId:'t',importVehicleCategory:'martin',importVehicleLocked:true})
    ];
    const profiles=Object.fromEntries(list.map(o=>[o.id,{pickup:c.geoMap[o.pickupAddress],drop:c.geoMap[o.dropAddress]}]));profiles.__base=c.geoMap.KRPR;
    const seq=await c.V35Planner.planPickupStops(v,list,profiles);
    assert.deepEqual(names(seq),['Sebők és Társa kp','Niczuk','Központi raktár','Empack','Lambda Hengermalom']);
  });

  await test('Márió lakhely felőli példa',async()=>{
    const c=createContext(); c.state.vehicles=drivers(); points(c);
    const v=c.state.vehicles.find(x=>x.id==='m');
    const list=[
      order('s','Szatmári Késmárk','SZATMARI'),order('l','Larex','LAREX'),order('e','Ezerker','EZERKER'),
      order('f','Fogarasi','FOGARASI'),order('a','Attacső','ATTA')
    ];
    const profiles=Object.fromEntries(list.map(o=>[o.id,{pickup:c.geoMap[o.pickupAddress],drop:c.geoMap[o.dropAddress]}]));profiles.__base=c.geoMap.KRPR;
    const seq=await c.V35Planner.planPickupStops(v,list,profiles);
    assert.deepEqual(names(seq),['Szatmári Késmárk','Larex','Ezerker','Fogarasi','Attacső']);
  });

  await test('Patrik példa: Központi -> Niczuk -> Cairox -> Sebők -> Fogarasi',async()=>{
    const c=createContext(); c.state.vehicles=drivers(); points(c);
    const v=c.state.vehicles.find(x=>x.id==='p');
    const list=[
      order('k','Központi raktár','KRPR'),order('n','Niczuk','NICZUK'),order('c','Cairox','CAIROX'),
      order('s','Sebők','SEBOK'),order('f','Fogarasi','FOGARASI')
    ];
    const profiles=Object.fromEntries(list.map(o=>[o.id,{pickup:c.geoMap[o.pickupAddress],drop:c.geoMap[o.dropAddress]}]));profiles.__base=c.geoMap.KRPR;
    const seq=await c.V35Planner.planPickupStops(v,list,profiles);
    assert.deepEqual(names(seq),['Központi raktár','Niczuk','Cairox','Sebők','Fogarasi']);
  });

  await test('Teljes autós blokk után azonnali lerakó esemény következik',async()=>{
    const c=createContext(); c.state.vehicles=drivers(); points(c);
    c.state.orders=[
      order('fl','Lambda Akna utca','LAMBDA_A','Le Jardin','LEJARDIN',{vehicleId:'m',fullLoadManual:true,fullLoadExplicit:true}),
      order('n','Néber','NEBER','X','DROP',{vehicleId:'m'}),
      order('s','Szatmári','SZATMARI','Y','DROP',{vehicleId:'m'}),
      order('k','Központi raktár','KRPR','Z','DROP',{vehicleId:'m'})
    ];
    const events=await c.V35Planner.v35BuildRoutePlan('m');
    const pickupIndex=events.findIndex(e=>e.type==='pickup'&&/lambda/i.test(e.name));
    assert.equal(events[pickupIndex+1].type,'drop');
    assert.equal(events[pickupIndex+1].fullLoad,true);
  });

  await test('Normál lerakók nem kerülnek bele az útvonaltervbe',async()=>{
    const c=createContext(); c.state.vehicles=drivers(); points(c);
    c.state.orders=[order('1','Ezerker','EZERKER','Moxy','DROP',{vehicleId:'m'}),order('2','Fogarasi','FOGARASI','Cosmo','DROP2',{vehicleId:'m'})];
    const events=await c.V35Planner.v35BuildRoutePlan('m');
    assert.equal(events.filter(e=>e.type==='drop').length,0);
  });


  await test('A jóváhagyott teljes autós Márió-minta sorrendje',async()=>{
    const c=createContext(); c.state.vehicles=drivers(); points(c);
    const v=c.state.vehicles.find(x=>x.id==='m');
    const list=[
      order('fl','Lambda Akna utca','LAMBDA_A','Le Jardin','LEJARDIN',{vehicleId:'m',fullLoadManual:true,fullLoadExplicit:true}),
      order('n','Néber','NEBER','X','DROP',{vehicleId:'m'}),
      order('s','Szatmári Késmárk','SZATMARI','Y','DROP',{vehicleId:'m'}),
      order('mk','Merkapt','MERKAPT','Z','DROP',{vehicleId:'m'}),
      order('e','Ezerker','EZERKER','Q','DROP',{vehicleId:'m'}),
      order('r','Ryng','RYNG','R','DROP',{vehicleId:'m'}),
      order('k','Központi raktár','KRPR','K','DROP',{vehicleId:'m'})
    ];
    const profiles=Object.fromEntries(list.map(o=>[o.id,{pickup:c.geoMap[o.pickupAddress],drop:c.geoMap[o.dropAddress]}]));profiles.__base=c.geoMap.KRPR;
    const seq=await c.V35Planner.planPickupStops(v,list,profiles);
    assert.deepEqual(names(seq),['Lambda Akna utca','Néber','Szatmári Késmárk','Merkapt','Ezerker','Ryng','Központi raktár']);
  });

  await test('A 2026.07.22-i három felrakási minta reprodukálható',async()=>{
    const c=createContext(); c.state.vehicles=drivers(); points(c);
    const martin=c.state.vehicles.find(x=>x.id==='t'), mario=c.state.vehicles.find(x=>x.id==='m'), patrik=c.state.vehicles.find(x=>x.id==='p');
    const sp={vehicleId:'t',importVehicleCategory:'martin',importVehicleLocked:true,longMaterialReason:'6 méteres szálanyag',items:[{name:'6 m cső',longMaterial:true}]};
    const martinList=[order('ms','Sebők','SEBOK','A','DROP',sp),order('me','Egrokorr','EGRO','B','DROP',sp),order('mk','Központi raktár','KRPR','C','DROP',{vehicleId:'t'}),order('ma','Attacső','ATTA','D','DROP',{vehicleId:'t'}),order('mm','Merkapt','MERKAPT','E','DROP',{vehicleId:'t'}),order('md','DT Közmű','DT','F','DROP',{vehicleId:'t'}),order('mki','Kincsem K6','DROP2','G','DROP',{vehicleId:'t'})];
    c.geoMap.DROP2=[47.48,19.17];
    const marioList=[order('as','Szatmári','SZATMARI'),order('ae','Ezerker','EZERKER'),order('av','Szerelvénybolt Üllő','SZERELVENY'),order('af','Fogarasi','FOGARASI'),order('ak','Központi raktár','KRPR')];
    const patrikList=[order('pk','Központi raktár','KRPR'),order('pn','Niczuk','NICZUK'),order('pg','Gienger','GIENGER'),order('pl','Lambda','LAMBDA_H'),order('pla','Larex','LAREX'),order('ps','Szögker','SZOGKER'),order('pe','Ezerker','EZERKER'),order('pc','Cosmo','DROP2')];
    async function planned(v,list){const profiles=Object.fromEntries(list.map(o=>[o.id,{pickup:c.geoMap[o.pickupAddress],drop:c.geoMap[o.dropAddress]}]));profiles.__base=c.geoMap.KRPR;return names(await c.V35Planner.planPickupStops(v,list,profiles));}
    assert.deepEqual(await planned(martin,martinList),['Sebők','Egrokorr','Központi raktár','Attacső','Merkapt','DT Közmű','Kincsem K6']);
    assert.deepEqual(await planned(mario,marioList),['Szatmári','Ezerker','Szerelvénybolt Üllő','Fogarasi','Központi raktár']);
    assert.deepEqual(await planned(patrik,patrikList),['Központi raktár','Niczuk','Gienger','Lambda','Larex','Szögker','Ezerker','Cosmo']);
  });

  if(!process.exitCode) console.log(`\nSikeres tesztek: ${passed}/11`);
})();
