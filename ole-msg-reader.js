/* Fuvarszervező V41 - local Outlook MSG reader
   Standalone browser/Node parser for Microsoft Compound File Binary (.msg).
   No dynamic import and no external MSG service.
*/
(function(root, factory){
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.LocalMsgReader = api.MsgReader;
  root.LocalCfbReader = api.CfbReader;
})(typeof globalThis !== 'undefined' ? globalThis : this, function(){
  'use strict';
  const FREE = 0xFFFFFFFF, END = 0xFFFFFFFE, FAT = 0xFFFFFFFD, DIF = 0xFFFFFFFC;

  function asU8(input){
    if (input instanceof Uint8Array) return input;
    if (input instanceof ArrayBuffer) return new Uint8Array(input);
    if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
    throw new TypeError('A fájltartalom nem ArrayBuffer/Uint8Array.');
  }
  function u16(dv, o){ return dv.getUint16(o, true); }
  function u32(dv, o){ return dv.getUint32(o, true); }
  function u64safe(dv, o){
    const lo = dv.getUint32(o, true), hi = dv.getUint32(o+4, true);
    const n = hi * 4294967296 + lo;
    return Number.isSafeInteger(n) ? n : Number.MAX_SAFE_INTEGER;
  }
  function decodeUtf16(bytes){
    if (!bytes || !bytes.length) return '';
    let end = bytes.length;
    while (end >= 2 && bytes[end-1] === 0 && bytes[end-2] === 0) end -= 2;
    try { return new TextDecoder('utf-16le').decode(bytes.subarray(0,end)); }
    catch (_) {
      let s=''; for(let i=0;i+1<end;i+=2) s += String.fromCharCode(bytes[i] | bytes[i+1]<<8); return s;
    }
  }
  function decodeAnsi(bytes){
    if (!bytes || !bytes.length) return '';
    let end = bytes.length; while(end && bytes[end-1]===0) end--;
    try { return new TextDecoder('windows-1252').decode(bytes.subarray(0,end)); }
    catch (_) { let s=''; for(let i=0;i<end;i++) s += String.fromCharCode(bytes[i]); return s; }
  }
  function decodeHtml(bytes){
    if (!bytes || !bytes.length) return '';
    if (bytes.length >= 2 && bytes[0] === 0xFF && bytes[1] === 0xFE) return decodeUtf16(bytes.subarray(2));
    if (bytes.length >= 2 && bytes[0] === 0xFE && bytes[1] === 0xFF) {
      const swapped = new Uint8Array(bytes.length-2); for(let i=2;i+1<bytes.length;i+=2){ swapped[i-2]=bytes[i+1]; swapped[i-1]=bytes[i]; }
      return decodeUtf16(swapped);
    }
    try { return new TextDecoder('utf-8').decode(bytes); } catch (_) { return decodeAnsi(bytes); }
  }
  function stripHtml(html){
    return String(html||'').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<script[\s\S]*?<\/script>/gi,' ')
      .replace(/<br\s*\/?>/gi,'\n').replace(/<\/p\s*>/gi,'\n').replace(/<\/div\s*>/gi,'\n')
      .replace(/<[^>]+>/g,' ').replace(/&nbsp;/gi,' ').replace(/&amp;/gi,'&').replace(/&lt;/gi,'<').replace(/&gt;/gi,'>')
      .replace(/&#39;/g,"'").replace(/&quot;/gi,'"').replace(/\r/g,'').replace(/[ \t]+/g,' ').replace(/\n\s*\n\s*\n+/g,'\n\n').trim();
  }

  class CfbReader {
    constructor(input){
      this.bytes = asU8(input);
      if (this.bytes.length < 512) throw new Error('A fájl túl rövid ahhoz, hogy Outlook MSG legyen.');
      this.dv = new DataView(this.bytes.buffer, this.bytes.byteOffset, this.bytes.byteLength);
      const sig = [0xD0,0xCF,0x11,0xE0,0xA1,0xB1,0x1A,0xE1];
      for(let i=0;i<8;i++) if(this.bytes[i]!==sig[i]) throw new Error('Nem érvényes Outlook MSG/CFB fájl (hibás fejléc).');
      this.major = u16(this.dv, 0x1A);
      this.sectorSize = 1 << u16(this.dv, 0x1E);
      this.miniSectorSize = 1 << u16(this.dv, 0x20);
      if (![512,4096].includes(this.sectorSize)) throw new Error(`Nem támogatott MSG szektorméret: ${this.sectorSize}`);
      this.numFat = u32(this.dv,0x2C);
      this.firstDir = u32(this.dv,0x30);
      this.miniCutoff = u32(this.dv,0x38);
      this.firstMiniFat = u32(this.dv,0x3C);
      this.numMiniFat = u32(this.dv,0x40);
      this.firstDifat = u32(this.dv,0x44);
      this.numDifat = u32(this.dv,0x48);
      this.fatSectors = this._readDifat();
      this.fat = this._readFat();
      this.entries = this._readDirectory();
      this.rootEntry = this.entries.find(e=>e.type===5) || this.entries[0];
      this.miniFat = this._readMiniFat();
      this.rootMiniStream = this.rootEntry ? this._readRegularStream(this.rootEntry.startSector, this.rootEntry.size) : new Uint8Array();
      this.paths = new Map();
      this._buildPaths();
    }
    _sector(sid){
      if (sid >= 0xFFFFFFF0) throw new Error(`Érvénytelen szektorazonosító: ${sid.toString(16)}`);
      const start = (sid + 1) * this.sectorSize, end = start + this.sectorSize;
      if (start < 0 || end > this.bytes.length) throw new Error(`Az MSG sérült: a ${sid}. szektor túlnyúlik a fájlon.`);
      return this.bytes.subarray(start,end);
    }
    _readDifat(){
      const out=[];
      for(let i=0;i<109;i++){ const sid=u32(this.dv,0x4C+i*4); if(sid!==FREE) out.push(sid); }
      let sid=this.firstDifat, guard=0;
      const per=this.sectorSize/4-1;
      while(sid!==END && sid!==FREE && guard++ < this.numDifat+4){
        const sec=this._sector(sid), dv=new DataView(sec.buffer,sec.byteOffset,sec.byteLength);
        for(let i=0;i<per;i++){ const x=u32(dv,i*4); if(x!==FREE) out.push(x); }
        sid=u32(dv,this.sectorSize-4);
      }
      return out.slice(0,this.numFat);
    }
    _readFat(){
      const out=[];
      for(const sid of this.fatSectors){
        const sec=this._sector(sid), dv=new DataView(sec.buffer,sec.byteOffset,sec.byteLength);
        for(let i=0;i<this.sectorSize;i+=4) out.push(u32(dv,i));
      }
      return out;
    }
    _chain(start, table=this.fat, maxHint=100000){
      const out=[]; let sid=start, guard=0; const seen=new Set();
      while(sid!==END && sid!==FREE && sid!==FAT && sid!==DIF){
        if(!Number.isInteger(sid) || sid<0 || sid>=table.length) throw new Error(`Az MSG sérült: hibás szektorlánc (${sid}).`);
        if(seen.has(sid)) throw new Error('Az MSG sérült: körkörös szektorlánc.');
        seen.add(sid); out.push(sid);
        sid=table[sid];
        if(++guard>maxHint) throw new Error('Az MSG sérült: túl hosszú szektorlánc.');
      }
      return out;
    }
    _concat(chunks, size){
      const total = size == null ? chunks.reduce((n,c)=>n+c.length,0) : Math.max(0,Math.min(size,chunks.reduce((n,c)=>n+c.length,0)));
      const out=new Uint8Array(total); let at=0;
      for(const c of chunks){ if(at>=total) break; const take=Math.min(c.length,total-at); out.set(c.subarray(0,take),at); at+=take; }
      return out;
    }
    _readRegularStream(start,size){
      if(size===0 || start===END || start===FREE) return new Uint8Array();
      const chain=this._chain(start,this.fat,Math.ceil(size/this.sectorSize)+8);
      return this._concat(chain.map(s=>this._sector(s)),size);
    }
    _readMiniFat(){
      if(!this.numMiniFat || this.firstMiniFat===END || this.firstMiniFat===FREE) return [];
      const bytes=this._readRegularStream(this.firstMiniFat,this.numMiniFat*this.sectorSize);
      const dv=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength), out=[];
      for(let i=0;i+3<bytes.length;i+=4) out.push(u32(dv,i));
      return out;
    }
    _readDirectory(){
      const bytes=this._readRegularStream(this.firstDir, undefined);
      const entries=[];
      for(let off=0,index=0;off+127<bytes.length;off+=128,index++){
        const dv=new DataView(bytes.buffer,bytes.byteOffset+off,128);
        const nameLen=u16(dv,64);
        const name=nameLen>=2 ? decodeUtf16(bytes.subarray(off,off+Math.min(64,nameLen-2))) : '';
        const type=bytes[off+66];
        const left=u32(dv,68), right=u32(dv,72), child=u32(dv,76);
        const startSector=u32(dv,116);
        const size=this.major===3 ? u32(dv,120) : u64safe(dv,120);
        entries.push({index,name,type,left,right,child,startSector,size,path:''});
      }
      return entries;
    }
    _readMiniStream(start,size){
      if(size===0 || start===END || start===FREE) return new Uint8Array();
      if(!this.rootMiniStream || !this.miniFat.length) return new Uint8Array();
      const chain=this._chain(start,this.miniFat,Math.ceil(size/this.miniSectorSize)+8);
      const chunks=[];
      for(const sid of chain){
        const at=sid*this.miniSectorSize;
        if(at>=this.rootMiniStream.length) throw new Error('Az MSG sérült: hibás mini szektor.');
        chunks.push(this.rootMiniStream.subarray(at,Math.min(at+this.miniSectorSize,this.rootMiniStream.length)));
      }
      return this._concat(chunks,size);
    }
    stream(entryOrIndex){
      const e=typeof entryOrIndex==='number'?this.entries[entryOrIndex]:entryOrIndex;
      if(!e || e.type!==2) return new Uint8Array();
      return e.size < this.miniCutoff ? this._readMiniStream(e.startSector,e.size) : this._readRegularStream(e.startSector,e.size);
    }
    _siblings(rootIndex, visited=new Set()){
      const out=[];
      const walk=(idx)=>{
        if(idx===FREE || idx===END || idx>=this.entries.length || visited.has(idx)) return;
        visited.add(idx); const e=this.entries[idx]; if(!e) return;
        walk(e.left); out.push(idx); walk(e.right);
      };
      walk(rootIndex); return out;
    }
    _buildPaths(){
      const assign=(storage,prefix,depth)=>{
        if(!storage || depth>64) return;
        for(const idx of this._siblings(storage.child,new Set())){
          const e=this.entries[idx]; if(!e || !e.name) continue;
          e.path = prefix ? `${prefix}/${e.name}` : e.name;
          this.paths.set(e.path,e);
          if(e.type===1 || e.type===5) assign(e,e.path,depth+1);
        }
      };
      if(this.rootEntry){ this.rootEntry.path=''; assign(this.rootEntry,'',0); }
    }
    find(path){ return this.paths.get(path) || null; }
    children(prefix=''){
      const normalized=prefix.replace(/\/$/,'');
      return this.entries.filter(e=>e.path && (normalized ? e.path.startsWith(normalized+'/') && !e.path.slice(normalized.length+1).includes('/') : !e.path.includes('/')));
    }
  }

  class MsgReader {
    constructor(input){ this.cfb=new CfbReader(input); this._data=null; }
    _prop(basePath,tag,type){
      const suffix=`__substg1.0_${tag}${type}`.toUpperCase();
      const e=this.cfb.entries.find(x=>x.type===2 && x.path.toUpperCase()===(basePath?`${basePath}/${suffix}`:suffix).toUpperCase());
      return e?this.cfb.stream(e):null;
    }
    _textProp(basePath,tag){
      const uni=this._prop(basePath,tag,'001F'); if(uni) return decodeUtf16(uni).replace(/\0+$/,'');
      const ansi=this._prop(basePath,tag,'001E'); if(ansi) return decodeAnsi(ansi).replace(/\0+$/,'');
      return '';
    }
    getFileData(){
      if(this._data) return this._data;
      const subject=this._textProp('','0037');
      let body=this._textProp('','1000');
      const htmlBytes=this._prop('','1013','0102');
      const bodyHTML=htmlBytes?decodeHtml(htmlBytes):'';
      if(!body && bodyHTML) body=stripHtml(bodyHTML);
      const senderName=this._textProp('','0C1A') || this._textProp('','0042');
      const senderEmail=this._textProp('','0C1F') || this._textProp('','0065');
      const attachments=[];
      for(const e of this.cfb.entries){
        if(e.type!==1 || !/^__attach_version1\.0_#/i.test(e.name)) continue;
        const base=e.path;
        const fileName=this._textProp(base,'3707') || this._textProp(base,'3704') || this._textProp(base,'3001') || `melleklet-${attachments.length+1}`;
        const dataEntry=this.cfb.entries.find(x=>x.type===2 && x.path.toUpperCase()===`${base}/__substg1.0_37010102`.toUpperCase());
        attachments.push({dataId:e.index,fileName,fileNameShort:this._textProp(base,'3704')||fileName,contentLength:dataEntry?.size||0,_basePath:base,_dataEntryIndex:dataEntry?.index});
      }
      this._data={dataType:'msg',subject,body,bodyHTML,senderName,senderEmail,headers:this._textProp('','007D'),attachments};
      return this._data;
    }
    getAttachment(attOrIndex){
      const info=this.getFileData();
      const att=typeof attOrIndex==='number'?info.attachments[attOrIndex]:attOrIndex;
      if(!att) throw new Error('A melléklet nem található.');
      const e=this.cfb.entries[att._dataEntryIndex];
      if(!e) throw new Error(`A(z) ${att.fileName||'melléklet'} tartalma nem található.`);
      return {fileName:att.fileName,content:this.cfb.stream(e)};
    }
  }
  return {CfbReader,MsgReader,decodeUtf16,decodeAnsi,stripHtml};
});
