import 'dotenv/config';
import express from 'express';
import cookieParser from 'cookie-parser';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import multer from 'multer';
import nodemailer from 'nodemailer';
import OpenAI from 'openai';
import {Server} from 'socket.io';
import {createServer} from 'node:http';
import fs from 'node:fs/promises';
import fssync from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const app=express();
const httpServer=createServer(app);
const io=new Server(httpServer);
const PORT=Number(process.env.PORT||3000);
const JWT_SECRET=process.env.JWT_SECRET||'dev-secret-change-me';
const DB_PATH=path.resolve('data/store.json');
const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:25*1024*1024,files:12}});

app.use(express.json({limit:'5mb'}));
app.use(cookieParser());
app.use(express.static(path.resolve('public')));

async function ensureDb(){
  await fs.mkdir(path.dirname(DB_PATH),{recursive:true});
  if(!fssync.existsSync(DB_PATH)){
    const hash=await bcrypt.hash(process.env.ADMIN_PASSWORD||'ChangeMe123!',12);
    const db={
      users:[{
        id:'admin-1',name:'Szabó Sándor',email:(process.env.ADMIN_EMAIL||'szabo.sandor@stand98.hu').toLowerCase(),
        passwordHash:hash,role:'admin',driverKey:'',active:true,createdAt:new Date().toISOString()
      }],
      state:{projects:[],suppliers:[],recipients:[],orders:[],settings:{
        baseAddress:'2310 Szigetszentmiklós, Kereskedő utca',
        marioVehicle:'Dobozos 1',patrikVehicle:'Dobozos 2',martinVehicle:'Ponyvás'
      },geoCache:{},projectAliases:{}},
      transfers:[],reports:[]
    };
    await fs.writeFile(DB_PATH,JSON.stringify(db,null,2));
  }
}
async function readDb(){await ensureDb();return JSON.parse(await fs.readFile(DB_PATH,'utf8'))}
async function writeDb(db){await fs.writeFile(DB_PATH,JSON.stringify(db,null,2))}
function sign(user){return jwt.sign({id:user.id,role:user.role,driverKey:user.driverKey||'',email:user.email,name:user.name},JWT_SECRET,{expiresIn:'12h'})}
function auth(req,res,next){
  try{req.user=jwt.verify(req.cookies.fuvar_token||'',JWT_SECRET);next()}
  catch{res.status(401).json({error:'Nincs bejelentkezve.'})}
}
function admin(req,res,next){if(req.user.role!=='admin')return res.status(403).json({error:'Nincs jogosultság.'});next()}
function safeUser(u){return{id:u.id,name:u.name,email:u.email,role:u.role,driverKey:u.driverKey||'',active:u.active!==false,createdAt:u.createdAt}}

app.post('/api/login',async(req,res)=>{
  const db=await readDb(),email=String(req.body.email||'').toLowerCase().trim();
  const user=db.users.find(u=>u.email===email&&u.active!==false);
  if(!user||!(await bcrypt.compare(String(req.body.password||''),user.passwordHash)))return res.status(401).json({error:'Hibás e-mail-cím vagy jelszó.'});
  res.cookie('fuvar_token',sign(user),{httpOnly:true,sameSite:'lax',secure:process.env.NODE_ENV==='production',maxAge:12*60*60*1000});
  res.json({user:safeUser(user),redirect:user.role==='admin'?'/admin.html':'/driver.html'});
});
app.post('/api/logout',(req,res)=>{res.clearCookie('fuvar_token');res.json({ok:true})});
app.get('/api/me',auth,(req,res)=>res.json({user:req.user}));

app.get('/api/users',auth,admin,async(req,res)=>{const db=await readDb();res.json(db.users.map(safeUser))});
app.post('/api/users',auth,admin,async(req,res)=>{
  const db=await readDb(),email=String(req.body.email||'').toLowerCase().trim();
  if(!email||!req.body.password||!req.body.name)return res.status(400).json({error:'Név, e-mail és jelszó kötelező.'});
  if(db.users.some(u=>u.email===email))return res.status(409).json({error:'Ez az e-mail már létezik.'});
  const user={id:`u-${Date.now()}`,name:req.body.name,email,passwordHash:await bcrypt.hash(req.body.password,12),role:req.body.role||'driver',driverKey:req.body.driverKey||'',active:true,createdAt:new Date().toISOString()};
  db.users.push(user);await writeDb(db);io.emit('users-changed');res.json(safeUser(user));
});
app.put('/api/users/:id',auth,admin,async(req,res)=>{
  const db=await readDb(),u=db.users.find(x=>x.id===req.params.id);if(!u)return res.status(404).json({error:'Nincs ilyen felhasználó.'});
  if(req.body.name!==undefined)u.name=req.body.name;
  if(req.body.email!==undefined)u.email=String(req.body.email).toLowerCase().trim();
  if(req.body.role!==undefined)u.role=req.body.role;
  if(req.body.driverKey!==undefined)u.driverKey=req.body.driverKey;
  if(req.body.active!==undefined)u.active=!!req.body.active;
  if(req.body.password)u.passwordHash=await bcrypt.hash(req.body.password,12);
  await writeDb(db);io.emit('users-changed');res.json(safeUser(u));
});
app.delete('/api/users/:id',auth,admin,async(req,res)=>{
  const db=await readDb();const u=db.users.find(x=>x.id===req.params.id);
  if(!u)return res.status(404).json({error:'Nincs ilyen felhasználó.'});
  if(u.role==='admin'&&db.users.filter(x=>x.role==='admin'&&x.active!==false).length<=1)return res.status(400).json({error:'Az utolsó admin nem törölhető.'});
  db.users=db.users.filter(x=>x.id!==req.params.id);await writeDb(db);io.emit('users-changed');res.json({ok:true});
});

app.get('/api/state',auth,admin,async(req,res)=>{const db=await readDb();res.json(db.state)});
app.put('/api/state',auth,admin,async(req,res)=>{const db=await readDb();db.state=req.body;await writeDb(db);io.emit('state-changed');res.json({ok:true})});

app.get('/api/driver/today',auth,async(req,res)=>{
  if(req.user.role==='admin')return res.status(403).json({error:'Admin használja a főfelületet.'});
  const db=await readDb(),date=new Date().toISOString().slice(0,10);
  const orders=(db.state.orders||[]).filter(o=>o.scheduleDate===date&&o.driver===req.user.driverKey)
    .sort((a,b)=>(+a.sequence||999)-(+b.sequence||999));
  res.json({date,driverKey:req.user.driverKey,orders,transfers:db.transfers.filter(t=>t.date===date&&(t.from===req.user.driverKey||t.to===req.user.driverKey))});
});
app.post('/api/tasks/:id/transfer',auth,async(req,res)=>{
  if(req.user.role!=='driver')return res.status(403).json({error:'Csak sofőr adhat át feladatot.'});
  const to=String(req.body.to||'');if(!['mario','patrik','martin'].includes(to)||to===req.user.driverKey)return res.status(400).json({error:'Érvénytelen célsofőr.'});
  const db=await readDb(),o=(db.state.orders||[]).find(x=>x.id===req.params.id);
  if(!o||o.driver!==req.user.driverKey||o.scheduleDate!==new Date().toISOString().slice(0,10))return res.status(404).json({error:'A feladat nem adható át.'});
  const warning=(o.vehicleNeed==='tarp'||o.longMaterialReason)&&to!=='martin';
  const transfer={id:`t-${Date.now()}`,orderId:o.id,orderNo:o.orderNo,date:o.scheduleDate,from:req.user.driverKey,to,byUserId:req.user.id,byName:req.user.name,at:new Date().toISOString(),warning};
  o.driver=to;o.sequence=999;db.transfers.push(transfer);await writeDb(db);io.emit('state-changed',{type:'transfer',transfer});res.json({ok:true,transfer,warning});
});

const transporter=nodemailer.createTransport({
  host:process.env.SMTP_HOST,port:Number(process.env.SMTP_PORT||587),secure:String(process.env.SMTP_SECURE||'false')==='true',
  auth:process.env.SMTP_USER?{user:process.env.SMTP_USER,pass:process.env.SMTP_PASS}:undefined
});
async function transcribe(file){
  if(!file||!process.env.OPENAI_API_KEY)return'';
  const temp=path.join(os.tmpdir(),`${Date.now()}-${file.originalname||'audio.webm'}`);
  await fs.writeFile(temp,file.buffer);
  try{
    const client=new OpenAI({apiKey:process.env.OPENAI_API_KEY});
    const out=await client.audio.transcriptions.create({file:fssync.createReadStream(temp),model:process.env.OPENAI_TRANSCRIBE_MODEL||'gpt-4o-mini-transcribe',language:'hu'});
    return out.text||'';
  }finally{await fs.unlink(temp).catch(()=>{})}
}
app.post('/api/tasks/:id/report',auth,upload.fields([{name:'photos',maxCount:10},{name:'audio',maxCount:1}]),async(req,res)=>{
  const db=await readDb(),o=(db.state.orders||[]).find(x=>x.id===req.params.id);
  if(!o)return res.status(404).json({error:'Nincs ilyen rendelés.'});
  if(req.user.role==='driver'&&(o.driver!==req.user.driverKey||o.scheduleDate!==new Date().toISOString().slice(0,10)))return res.status(403).json({error:'Nincs jogosultság ehhez a rendeléshez.'});
  const photos=req.files?.photos||[],audio=req.files?.audio?.[0],aiText=await transcribe(audio);
  const transcript=[req.body.transcript,aiText].filter(Boolean).join('\n\nAI-átirat:\n');
  const subject=`${o.orderNo} - ${o.projectName||o.dropAddress||''} - ${req.user.name}`;
  const body=[`Rendelésszám: ${o.orderNo}`,`Projekt: ${o.projectName||''}`,`Sofőr: ${req.user.name}`,`Dátum: ${o.scheduleDate}`,`Felrakó: ${o.pickupName||''}`,`Lerakó: ${o.dropAddress||''}`,'','Megjegyzés:',req.body.note||'','','Hangátirat:',transcript||''].join('\n');
  const attachments=[...photos.map((f,i)=>({filename:f.originalname||`szallitolevel_${i+1}.jpg`,content:f.buffer,contentType:f.mimetype})),...(audio?[{filename:audio.originalname||`${o.orderNo}_hang.webm`,content:audio.buffer,contentType:audio.mimetype}]:[])];
  let emailed=false;
  if(process.env.SMTP_HOST&&process.env.SMTP_USER){
    await transporter.sendMail({from:process.env.MAIL_FROM||process.env.SMTP_USER,to:process.env.REPORT_TO||'szabo.sandor@stand98.hu',subject,text:body,attachments});
    emailed=true;
  }
  const report={id:`r-${Date.now()}`,orderId:o.id,orderNo:o.orderNo,userId:req.user.id,userName:req.user.name,at:new Date().toISOString(),note:req.body.note||'',transcript,photoCount:photos.length,hasAudio:!!audio,emailed};
  db.reports.push(report);o.reports=o.reports||[];o.reports.push(report);if(req.body.completed==='true')o.status='teljesítve';
  await writeDb(db);io.emit('state-changed',{type:'report',report});res.json({ok:true,report,emailed,transcript});
});

app.get('/api/transfers',auth,admin,async(req,res)=>{const db=await readDb();res.json(db.transfers.slice(-500).reverse())});

app.get('/',(req,res)=>res.sendFile(path.resolve('public/login.html')));
io.on('connection',()=>{});
await ensureDb();
httpServer.listen(PORT,()=>console.log(`Fuvarszervező V8: http://localhost:${PORT}`));
