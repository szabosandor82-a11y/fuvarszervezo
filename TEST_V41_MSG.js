const fs=require('fs'), vm=require('vm'), cp=require('child_process'), os=require('os'), path=require('path');
const {MsgReader}=require('./ole-msg-reader.js');
global.LocalMsgReader=MsgReader;
function norm(v){return String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[_.,;:()[\]{}\/\\-]+/g,' ').replace(/\s+/g,' ').trim()}
global.norm=norm; global.uid=(()=>{let i=0;return()=>`m${++i}`})(); global.selectedDate=()=> '2026-08-05';
global.state={orders:[],backlog:[],resolvedBacklog:[],settings:{baseAddress:'2310 Szigetszentmiklós, Kereskedő utca 2.'},routePlans:{},routeStats:{},suppliers:[
{id:'l',name:'Larex Trade Kft',address:'1108 Budapest, Maglódi utca 123'},
{id:'sz',name:'Szatmári Kft. – Késmárk',address:'1158 Budapest, Késmárk utca 9.'},
{id:'se',name:'Sebők és Társa Kft',address:'2045 Törökbálint, Kinizsi utca 28.'},
{id:'me',name:'Merkapt Zrt.',address:'1106 Budapest, Maglódi út 14/B'}],projects:[
{id:'m',name:'Budapest_M76',address:'1095 Budapest, Mester u. 76.'},
{id:'k',name:'Budapest_Kincsem_K6',address:'1106 Budapest, Gyógyszergyári utca 14.'},
{id:'c',name:'Budapest_City_pearl_II.ütem',address:'1095 Budapest, Soroksári út 58.'},
{id:'l2',name:'Budapest_LeJardin_II_felépítmény',address:'1134 Budapest, Rozsnyai utca 14–18.'},
{id:'co',name:'Budapest_Cosmo_Residence',address:'1133 Budapest, Hegedűs Gyula utca 53.'}],recipients:[],vehicles:[{id:'martin',driverName:'Martin'}]};
global.activeVehicles=()=>state.vehicles;
global.V41PdfTextExtractor=async bytes=>{
  const tmp=path.join(os.tmpdir(),`v41-${process.pid}-${Math.random().toString(16).slice(2)}.pdf`);
  fs.writeFileSync(tmp,Buffer.from(bytes));
  try{const text=cp.execFileSync('pdftotext',['-layout',tmp,'-'],{encoding:'utf8'}).replace(/\f/g,'\n'); return {text,lines:text.split(/\r?\n/).map(x=>x.replace(/\s+/g,' ').trim()).filter(Boolean)}}
  finally{try{fs.unlinkSync(tmp)}catch{}}
};
vm.runInThisContext(fs.readFileSync('./planner-v41.js','utf8'),{filename:'planner-v41.js'});
const V=global.V41OutlookImport;
function fileObj(fn){const b=fs.readFileSync(fn);return {name:path.basename(fn),arrayBuffer:async()=>b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength)}}
let pass=0,fail=0;function test(name,fn){return Promise.resolve().then(fn).then(()=>{console.log('✓',name);pass++}).catch(e=>{console.error('✗',name,'\n ',e.stack||e);fail++})}
function eq(a,b){if(JSON.stringify(a)!==JSON.stringify(b))throw Error(`várt ${JSON.stringify(b)}, kapott ${JSON.stringify(a)}`)}
function ok(v,m='feltétel nem teljesült'){if(!v)throw Error(m)}
(async()=>{
await test('helyi MSG parser: City Pearl tárgy, levél és PDF melléklet',async()=>{const r=new MsgReader(fs.readFileSync('/mnt/data/Megrendelés_City Pearl_II_260804_004932_PVC-U_golyóscsap(1).msg'));const d=r.getFileData();eq(d.subject,'Megrendelés_City Pearl_II_260804_004932_PVC-U_golyóscsap');ok(d.body.includes('Gali SwimTex Kft.'));const a=d.attachments.find(x=>/\.pdf$/i.test(x.fileName));ok(a);ok(r.getAttachment(a).content.length>100000)});
await test('MSG végponttól végpontig: City Pearl 004932',async()=>{const [e]=await V.parseDroppedFile(fileObj('/mnt/data/Megrendelés_City Pearl_II_260804_004932_PVC-U_golyóscsap(1).msg'),'dobozos');eq([e.orderNo,e.pickupName,e.pickupAddress,e.projectName,e.dropAddress,e.items.length],['004932','Gali SwimTex Kft.','2142 Nagytarcsa, Gránit utca 15','Budapest_City_pearl_II.ütem','1095 Budapest, Soroksári út 58.',1]);ok(e.newSupplierData)});
await test('MSG végponttól végpontig: Kincsem 004911',async()=>{const [e]=await V.parseDroppedFile(fileObj('/mnt/data/FW_ Megrendelés_Kincsem_K6_260803_004911_PE-HD.msg'),'martin');eq([e.orderNo,e.pickupName,e.pickupAddress,e.projectName,e.items.length],['004911','Szatmári Kft. – Késmárk','1158 Budapest, Késmárk utca 9.','Budapest_Kincsem_K6',3]);ok(e.items.some(x=>x.longMaterial))});
await test('MSG végponttól végpontig: Le Jardin 004943',async()=>{const [e]=await V.parseDroppedFile(fileObj('/mnt/data/Megrendelés_Lejardin_260804_004943_htpp_pdf.msg'),'dobozos');eq([e.orderNo,e.pickupName,e.projectName,e.items.length],['004943','Sebők és Társa Kft','Budapest_LeJardin_II_felépítmény',2])});
await test('MSG végponttól végpontig: Cosmo 004937',async()=>{const [e]=await V.parseDroppedFile(fileObj('/mnt/data/Megrendelés_Cosmo_260803_004937_sitteszsák.msg'),'dobozos');eq([e.orderNo,e.pickupName,e.projectName,e.items[0]?.qty],['004937','Merkapt Zrt.','Budapest_Cosmo_Residence','100'])});
await test('MSG végponttól végpontig: KRPR 000745',async()=>{const [e]=await V.parseDroppedFile(fileObj('/mnt/data/Raktárközi_Lejardin_260804_000745_gumikomp.msg'),'dobozos');eq([e.orderNo,e.orderType,e.pickupAddress,e.projectName,e.dropAddress,e.items.length],['000745','KRPR','2310 Szigetszentmiklós, Kereskedő utca 2.','Budapest_LeJardin_II_felépítmény','1134 Budapest, Rozsnyai utca 14–18.',1])});
await test('MSG levélszövegből: Kekelit visszáru',async()=>{const [e]=await V.parseDroppedFile(fileObj('/mnt/data/Kekelit visszáru - Cosmo.msg'),'martin');eq([e.orderType,e.pickupName,e.projectName,e.orderNo,e.items[0]?.qty],['VISSZARU','Budapest_Cosmo_Residence','Szatmári Kft. – Késmárk','002226, 001998, 001832','400'])});
console.log(`\nV41 teljes MSG teszt: ${pass}/${pass+fail} sikeres.`); if(fail)process.exit(1);
})();
