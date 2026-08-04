const fs=require('fs'),vm=require('vm'),cp=require('child_process');
function pdf(path){return cp.execFileSync('pdftotext',['-layout',path,'-'],{encoding:'utf8'}).replace(/\f/g,'\n')}
function lines(text){return text.split(/\r?\n/).map(x=>x.replace(/\s+/g,' ').trim()).filter(Boolean)}
let pass=0,fail=0;function t(name,fn){try{fn();console.log('✓',name);pass++}catch(e){console.error('✗',name,e.message);fail++}}function eq(a,b){if(JSON.stringify(a)!==JSON.stringify(b))throw Error(`várt ${JSON.stringify(b)}, kapott ${JSON.stringify(a)}`)}
global.state={orders:[],backlog:[],resolvedBacklog:[],settings:{baseAddress:'2310 Szigetszentmiklós, Kereskedő utca 2.'},suppliers:[
{id:'l',name:'Larex Trade Kft',address:'1108 Budapest, Maglódi utca 123'},
{id:'sz',name:'Szatmári Kft. – Késmárk',address:'1158 Budapest, Késmárk utca 9.'},
{id:'se',name:'Sebők és Társa Kft',address:'2045 Törökbálint, Kinizsi utca 28.'},
{id:'me',name:'Merkapt Zrt.',address:'1106 Budapest, Maglódi út 14/B'}],projects:[
{id:'m',name:'Budapest_M76',address:'1095 Budapest, Mester u. 76.'},
{id:'k',name:'Budapest_Kincsem_K6',address:'1106 BUDAPEST Gyógyszergyári utca 14.'},
{id:'c',name:'Budapest_City_pearl_II.ütem',address:'1095 Budapest, Soroksári út 58.'},
{id:'l2',name:'Budapest_LeJardin_II_felépítmény',address:'1134 Budapest, Rozsnyai 14-18.'},
{id:'co',name:'Budapest_Cosmo_Residence',address:'1133 Budapest, Hegedűs Gyula utca 53.'}],recipients:[],vehicles:[{id:'martin',driverName:'Martin'}]};
global.activeVehicles=()=>state.vehicles;global.selectedDate=()=> '2026-08-05';global.norm=v=>String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[_.,;:()[\]{}\/\\-]+/g,' ').replace(/\s+/g,' ').trim();global.uid=(()=>{let i=0;return()=>`x${++i}`})();
vm.runInThisContext(fs.readFileSync(__dirname+'/planner-v39.js','utf8'));const V=global.V39OutlookImport;
function build(path,subject,body='',cat='dobozos'){const text=pdf(path);return V.buildExtractedEntry({category:cat,sourceName:subject+'.msg',subject,body,pdfName:'melléklet.pdf',pdfText:text,pdfLines:lines(text)})}
t('M76 PDF',()=>{const e=build('/mnt/data/Megrendelés_M76_250430_003141_osb_deszka.pdf','Megrendelés_M76_250430_003141_osb_deszka');eq([e.orderNo,e.pickupName,e.projectName,e.items.length],['003141','Larex Trade Kft','Budapest_M76',2])});
t('City Pearl valós PDF',()=>{const e=build('/mnt/data/CityPearl_004932_attachment.pdf','Megrendelés_City Pearl_II_260804_004932_PVC-U_golyóscsap','Felvétel címe:\nGali SwimTex Kft.\nTörök Zsuzsanna +3670 385 74 10\nSzékhely;Telephely:2142 Nagytarcsa, Gránit utca 15');eq([e.orderNo,e.pickupAddress,e.dropAddress,e.items.length],['004932','2142 Nagytarcsa, Gránit utca 15','1095 Budapest, Soroksári út 58.',1])});
t('LeJardin valós PDF',()=>{const e=build('/mnt/data/lejardin_attachment.pdf','Megrendelés_Lejardin_260804_004943_htpp_pdf');eq([e.orderNo,e.pickupName,e.projectName,e.items.length],['004943','Sebők és Társa Kft','Budapest_LeJardin_II_felépítmény',2])});
t('Cosmo valós PDF',()=>{const e=build('/mnt/data/extracted_cosmo_004937.pdf','Megrendelés_Cosmo_260803_004937_sitteszsák');eq([e.orderNo,e.pickupName,e.projectName,e.items[0]?.qty],['004937','Merkapt Zrt.','Budapest_Cosmo_Residence','100'])});
t('KRPR valós PDF',()=>{const e=build('/mnt/data/extracted_raktarkozi_lejardin_000745.pdf','Raktárközi_Lejardin_260804_000745_gumikomp');eq([e.orderNo,e.orderType,e.pickupAddress,e.projectName,e.items.length],['000745','KRPR','2310 Szigetszentmiklós, Kereskedő utca 2.','Budapest_LeJardin_II_felépítmény',1])});
console.log(`\nValós fájlteszt: ${pass}/${pass+fail} sikeres.`);if(fail)process.exit(1)
