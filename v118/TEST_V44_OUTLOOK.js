const fs=require('fs'),vm=require('vm'),assert=require('assert');
function norm(s=''){return String(s).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[_.,;:()[\]{}\/\\-]+/g,' ').replace(/\s+/g,' ').trim()}
const ctx={console,Math,Date,Set,Map,Array,Object,String,Number,Boolean,RegExp,JSON,Promise,Error,Intl,document:undefined,window:undefined,globalThis:null,norm};ctx.globalThis=ctx;
ctx.state={suppliers:[
  {id:'ket',name:'Két Kör Kft.',address:'1111 Budapest, Másik utca 1.'},
  {id:'nic',name:'NICZUK Kft.',address:'1222 Budapest, Gyár utca 15'}
],projects:[{id:'p',name:'Budapest_Kincsem_K6',address:'1106 Budapest, Gyógyszergyári utca 14.'}],recipients:[],orders:[],vehicles:[],settings:{},aliases:{projects:{},suppliers:{}}};
ctx.alert=()=>{};ctx.confirm=()=>true;ctx.uid=()=>Math.random().toString(16);ctx.selectedDate=()=> '2026-08-06';ctx.save=()=>{};ctx.render=()=>{};
vm.createContext(ctx);vm.runInContext(fs.readFileSync(__dirname+'/planner-v41.js','utf8'),ctx,{filename:'planner-v41.js'});
const V=ctx.V41OutlookImport;
const header=[
  'Szállító rendelés','2026-SR0/004963','Stand 98 Kft. NICZUK Kft.','Vevő: Szállító:','1239 Budapest, Láva utca 7. 1222 Budapest, Gyár utca 15',
  'Projekt név Budapest_Kincsem_K6','A levél korábbi részében Két Kör Kft. ajánlata is szerepelt'
];
const supplier=V.supplierFromPdfHeader(header.join('\n'),header);
assert.equal(supplier.name,'NICZUK Kft.');assert.equal(supplier.address,'1222 Budapest, Gyár utca 15');
const entry=V.buildExtractedEntry({category:'dobozos',sourceName:'m.msg',subject:'Megrendelés Kincsem 004963',body:'Két Kör Kft. korábbi ajánlata',pdfName:'rendeles.pdf',pdfText:header.join('\n'),pdfLines:header,attachmentNames:['rendeles.pdf'],forcedRefs:[{year:'2026',type:'SR0',no:'004963',full:'2026-SR0/004963'}]});
assert.equal(entry.pickupName,'NICZUK Kft.');assert.equal(entry.pickupAddress,'1222 Budapest, Gyár utca 15');assert.equal(entry.projectName,'Budapest_Kincsem_K6');assert.equal(entry.dropAddress,'1106 Budapest, Gyógyszergyári utca 14.');
console.log('Sikeres V44 Outlook tesztek: 2/2');
