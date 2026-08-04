/* Fuvarszervező V39
   Outlook (.msg) + PDF rendelésimport.

   - Két külön tömeges import: Dobozos és Martin / Platós.
   - A levél tárgya/törzse és minden PDF melléklet együtt kerül elemzésre.
   - A rendelésazonosító mindig a perjel utáni rész (pl. 2026-SR0/004911 -> 004911).
   - A felrakó és projekt címét elsősorban a törzsadat adja; a PDF vevői címe nem írja felül a projektcímet.
   - Az import teljesen helyben, a böngészőben történik.
*/
(function (global) {
  'use strict';

  const VERSION = '39';
  const MSG_READER_URL = 'https://cdn.jsdelivr.net/npm/@kenjiuno/msgreader@1.28.0/+esm';
  const PDF_WORKER_URL = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  const LEGAL_WORDS = new Set(['kft', 'zrt', 'bt', 'nyrt', 'trade', 'hungary', 'magyarorszag', 'es', 'the', 'partner']);
  const PROJECT_NOISE = new Set(['budapest', 'garancia', 'terv', 'projekt', 'utem', 'epulet', 'tarsashaz', 'hotel', 'pr']);
  let msgReaderPromise = null;
  let pending = [];
  let processing = false;

  const nrm = value => {
    if (typeof norm === 'function') return norm(value || '');
    return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[_.,;:()[\]{}\/\\-]+/g, ' ').replace(/\s+/g, ' ').trim();
  };
  const htmlEsc = value => typeof esc === 'function'
    ? esc(value ?? '')
    : String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const id = () => typeof uid === 'function' ? uid() : `v39-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const selectedImportDate = () => ((typeof document !== 'undefined' ? document.getElementById('v38ImportDate')?.value : '') || (typeof selectedDate === 'function' ? selectedDate() : new Date().toISOString().slice(0, 10)));
  const cleanText = value => String(value || '').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/\r/g, '').replace(/[ \t]+/g, ' ').replace(/\n\s*\n\s*\n+/g, '\n\n').trim();
  const unique = values => [...new Set(values.filter(Boolean))];
  const significantTokens = (value, noise = LEGAL_WORDS) => nrm(value).split(' ').filter(token => token.length >= 3 && !noise.has(token) && !/^\d+$/.test(token));


  const CENTRAL_WAREHOUSE = { name: 'Szigetszentmiklósi Központi Raktár', address: '2310 Szigetszentmiklós, Kereskedő utca 2.' };
  const ADDRESS_RE = /\b(\d{4})\s+([A-ZÁÉÍÓÖŐÚÜŰa-záéíóöőúüű][^\n;]{2,90}?\b(?:utca|út|u\.|köz|tér|körút|sor|park|rakpart|útja)\s*\d+[A-Za-zÁÉÍÓÖŐÚÜŰáéíóöőúüű0-9.\/-]*)/i;

  function linesOf(...sources) {
    return cleanText(sources.filter(Boolean).join('\n')).split('\n').map(line => line.trim()).filter(Boolean);
  }

  function cleanAddress(value = '') {
    return String(value).replace(/^(?:sz[eé]khely\s*;?\s*telephely|telephely|felv[eé]tel(?:i)?\s*c[ií]me)\s*:\s*/i, '').replace(/\s+/g, ' ').trim().replace(/\s+Magyarorsz[aá]g$/i, '');
  }

  function addressFromText(value = '') {
    const cleaned = cleanAddress(value);
    const match = cleaned.match(ADDRESS_RE);
    return match ? `${match[1]} ${match[2]}`.replace(/\s+/g, ' ').trim() : '';
  }

  function extractOrderRefs(...sources) {
    const text = sources.filter(Boolean).join('\n');
    const refs = [];
    for (const match of text.matchAll(/\b(20\d{2})\s*-\s*(SR0|KRPR|PRPR)\s*\/\s*([0-9]{4,12})\b/gi)) {
      const ref = { year: match[1], type: match[2].toUpperCase(), no: match[3], full: `${match[1]}-${match[2].toUpperCase()}/${match[3]}` };
      if (!refs.some(existing => existing.full === ref.full)) refs.push(ref);
    }
    return refs;
  }

  function orderNumbersOf(value) {
    if (!value) return [];
    if (Array.isArray(value.sourceOrderNos)) return unique(value.sourceOrderNos.map(String));
    if (Array.isArray(value.orderNos)) return unique(value.orderNos.map(String));
    return unique(String(value.orderNo || value).split(/[,;\s]+/).map(part => part.replace(/\D/g, '')).filter(part => part.length >= 4));
  }

  function isReturnText(...sources) {
    const text = nrm(sources.filter(Boolean).join(' '));
    return /visszaru|vissza aru|visszavinni|vissza vinni|vissza tudjuk vinni|visszaszallitas/.test(text);
  }

  function findMasterProject(text = '') {
    return bestProject(text, text);
  }

  function findWarehouse(text = '') {
    const normalized = nrm(text);
    if (/uj kozponti raktar|kozponti raktar|szigetszentmiklos|\bkrpr\b/.test(normalized)) return { id: '', ...CENTRAL_WAREHOUSE, reason: 'központi raktár szabály' };
    const projects = typeof state !== 'undefined' ? state.projects || [] : [];
    const suppliers = typeof state !== 'undefined' ? state.suppliers || [] : [];
    const all = [...projects.map(item => ({ ...item, _kind: 'project' })), ...suppliers.map(item => ({ ...item, _kind: 'supplier' }))];
    const ranked = all.map(item => ({ item, score: significantTokens(item.name).reduce((score, token) => score + (normalized.includes(token) ? 8 : 0), 0) + (normalized.includes(nrm(item.name)) ? 30 : 0) })).sort((a, b) => b.score - a.score);
    if (!ranked.length || ranked[0].score < 8) return null;
    return { id: ranked[0].item.id || '', name: ranked[0].item.name || '', address: ranked[0].item.address || '', kind: ranked[0].item._kind, reason: `raktártörzs-egyezés (${ranked[0].score})` };
  }

  function extractExplicitPickup(...sources) {
    const lines = linesOf(...sources);
    const start = lines.findIndex(line => /felv[eé]tel(?:i)?\s*c[ií]me/i.test(line));
    if (start < 0) return null;
    const window = lines.slice(start + 1, start + 9);
    const company = window.find(line => /\b(?:kft\.?|zrt\.?|bt\.?|nyrt\.?)\b/i.test(line) && !/stand\s*98/i.test(line)) || '';
    const rawAddress = window.find(line => addressFromText(line)) || '';
    const address = addressFromText(rawAddress);
    const contactLine = window.find(line => /\+?36|\b(?:20|30|70)\s*\d{3}/.test(line)) || '';
    const phone = (contactLine.match(/(?:\+?36\s*)?(?:20|30|70)[\s\/-]*\d{3}[\s-]*\d{2}[\s-]*\d{2}/) || [])[0] || '';
    const email = (sources.filter(Boolean).join(' ').match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i) || [])[0] || '';
    if (!company && !address) return null;
    return { name: company.replace(/\s+/g, ' ').trim(), address, phone, email, pickupNote: [contactLine, phone].filter(Boolean)[0] || '', reason: 'levél/PDF külön Felvétel címe mező', autoMaster: true };
  }

  function extractRequestedDate(text = '') {
    const all = [...String(text || '').matchAll(/\b(\d{2})[.\/-](\d{2})[.\/-](\d{2,4})\b/g)];
    if (!all.length) return '';
    const match = /\bk[eé]rt\b/i.test(text) ? all.at(-1) : all[0];
    const yy = match[1], mm = match[2], dd = match[3];
    if (dd.length === 2) return `20${yy}-${mm}-${dd}`;
    return `${dd}-${mm}-${yy}`;
  }

  function parseBodyItems(text = '') {
    const items = [];
    for (const raw of linesOf(text)) {
      const line = raw.replace(/\s+/g, ' ').trim();
      let match = line.match(/^([A-Z0-9._\/-]{3,})\s*[-–]\s*(.+?)\s*[-–]\s*(\d+(?:[.,]\d+)?)\s*(m2|m²|m3|m³|fm|m|db|kg|csomag|tekercs|klt|p[aá]r)\b/i);
      if (!match) match = line.match(/^([A-Z0-9._\/-]{3,})\s+(.+?)\s+(\d+(?:[.,]\d+)?)\s*(m2|m²|m3|m³|fm|m|db|kg|csomag|tekercs|klt|p[aá]r)\s*(?:[oö]sszesen)?$/i);
      if (!match) continue;
      const [, code, name, qty, unit] = match;
      const materialSearch = nrm(`${name} ${qty}${unit}`);
      items.push({ code, name: name.trim(), qty: qty.replace(',', '.'), unit, itemNote: '', longMaterial: /cso|fureszaru|deszka|szal|tekercs/.test(materialSearch), received: false });
    }
    return items;
  }

  function extractTransferWarehouses(text = '') {
    const lines = linesOf(text);
    let sourceText = '', targetText = '';
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const sourceSame = line.match(/forr[aá]s\s*rakt[aá]r\s*:\s*(.+)$/i);
      const targetSame = line.match(/c[eé]l\s*rakt[aá]r\s*:\s*(.+)$/i);
      if (sourceSame && !/c[eé]l\s*rakt[aá]r/i.test(sourceSame[1])) sourceText = sourceSame[1];
      if (targetSame) targetText = targetSame[1];
      if (/^forr[aá]s\s*rakt[aá]r\s*:?$/i.test(line)) sourceText = lines[i + 1] || '';
      if (/^c[eé]l\s*rakt[aá]r\s*:?$/i.test(line)) targetText = lines[i + 1] || '';
    }
    const known = [];
    for (const project of (typeof state !== 'undefined' ? state.projects || [] : [])) if (nrm(text).includes(nrm(project.name))) known.push({ id: project.id || '', name: project.name, address: project.address || '', kind: 'project' });
    const source = findWarehouse(sourceText) || known[0] || null;
    const target = findWarehouse(targetText) || known.find(item => !source || item.id !== source.id) || known[1] || null;
    return { source, target };
  }

  function duplicateOrderNumbers(numbers = []) {
    const existing = new Set((typeof state !== 'undefined' ? state.orders || [] : []).flatMap(orderNumbersOf));
    return numbers.filter(number => existing.has(String(number)));
  }

  function extractOrderNo(...sources) {
    const refs = extractOrderRefs(...sources);
    if (refs.length) return refs[0].no;
    const text = sources.filter(Boolean).join('\n');
    const tokens = [...text.matchAll(/(?:^|[_\s.-])([0-9]{5,8})(?=$|[_\s.-])/g)].map(match => match[1]);
    if (!tokens.length) return '';
    const nonDate = tokens.filter(token => !/^(?:20)?\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])$/.test(token));
    return (nonDate.length ? nonDate : tokens).at(-1) || '';
  }

  function inferProjectHint(...sources) {
    const text = sources.filter(Boolean).join(' ');
    const fileMatch = text.match(/megrendel[eé]s[_\s-]+(.+?)(?:[_\s-]+\d{6}[_\s-]+\d{5,8}|\.pdf|\.msg|$)/i);
    if (fileMatch) return fileMatch[1].replace(/[_-]+/g, ' ').trim();
    const projectMatchText = text.match(/projekt\s*n[eé]v\s*[:\-]?\s*([A-Za-zÁÉÍÓÖŐÚÜŰáéíóöőúüű0-9_.\/-]{2,80})/i);
    return projectMatchText ? projectMatchText[1].replace(/[_-]+/g, ' ').trim() : '';
  }

  function supplierSpecial(text) {
    const normalized = nrm(text);
    if (normalized.includes('szatmari') && normalized.includes('kesmark')) {
      return { name: 'Szatmári Kft. – Késmárk', address: '1158 Budapest, Késmárk utca 9.', reason: 'levél/PDF: Szatmári + Késmárk' };
    }
    if (normalized.includes('fogarasi') && normalized.includes('hunyadi')) {
      return { name: 'Fogarasi – Hunyadi úti üzlet', address: '1116 Budapest, Hunyadi János út 15.', reason: 'levél/PDF: Fogarasi + Hunyadi' };
    }
    if (normalized.includes('larex')) return { name: 'Larex Trade Kft', address: '1108 Budapest, Maglódi utca 123', reason: 'PDF: Larex' };
    if (normalized.includes('szerelvenybolt') || (normalized.includes('ulloi') && normalized.includes('807'))) return { name: 'Szerelvénybolt Kft.', address: '1182 Budapest, Üllői út 807/B', reason: 'javított Szerelvénybolt törzsadat' };
    return null;
  }

  function supplierScore(supplier, sourceNorm) {
    const name = nrm(supplier?.name || '');
    if (!name || /stand\s*98/.test(name)) return -100;
    const nameTokens = significantTokens(supplier.name);
    const addressTokens = significantTokens(supplier.address, new Set(['budapest', 'utca', 'ut', 'ter', 'koz', 'kapu']));
    const siteTokens = significantTokens(supplier.site || supplier.pickupNote || '');
    let score = 0;
    if (name && sourceNorm.includes(name)) score += 30;
    for (const token of nameTokens) if (sourceNorm.includes(token)) score += token.length >= 6 ? 8 : 5;
    for (const token of siteTokens) if (sourceNorm.includes(token)) score += 6;
    for (const token of addressTokens) if (sourceNorm.includes(token)) score += token.length >= 6 ? 4 : 2;
    if (nameTokens.length && nameTokens.every(token => sourceNorm.includes(token))) score += 10;
    return score;
  }

  function bestSupplier(sourceText) {
    const explicit = extractExplicitPickup(sourceText);
    if (explicit?.name && explicit?.address) {
      const master = (typeof state !== 'undefined' ? state.suppliers || [] : []).find(item => nrm(item.name) === nrm(explicit.name) || nrm(item.address) === nrm(explicit.address));
      return { ...explicit, id: master?.id || '', pickupNote: explicit.pickupNote || master?.pickupNote || master?.note || '', autoMaster: !master };
    }
    const special = supplierSpecial(sourceText);
    if (special) {
      const master = (typeof state !== 'undefined' ? state.suppliers || [] : []).find(supplier => {
        const combined = nrm(`${supplier.name || ''} ${supplier.address || ''} ${supplier.site || ''}`);
        return special.name.startsWith('Szatmári') ? combined.includes('kesmark') : special.name.startsWith('Fogarasi') ? combined.includes('hunyadi') : special.name.startsWith('Szerelvénybolt') ? combined.includes('szerelvenybolt') : combined.includes('larex');
      });
      return { ...special, id: master?.id || '', pickupNote: master?.pickupNote || master?.note || '', autoMaster: !master };
    }
    const sourceNorm = nrm(sourceText);
    const candidates = (typeof state !== 'undefined' ? state.suppliers || [] : []).map(supplier => ({ supplier, score: supplierScore(supplier, sourceNorm) })).sort((a, b) => b.score - a.score);
    if (!candidates.length || candidates[0].score < 10) return null;
    const winner = candidates[0].supplier;
    return { id: winner.id || '', name: winner.name || '', address: winner.address || '', pickupNote: winner.pickupNote || winner.note || '', phone: winner.phone || '', email: winner.email || '', reason: `törzsadat-egyezés (${candidates[0].score})`, autoMaster: false };
  }

  function projectScore(project, sourceNorm, hintNorm) {
    const name = nrm(project?.name || '');
    if (!name) return -100;
    const tokens = significantTokens(project.name, PROJECT_NOISE);
    let score = 0;
    if (sourceNorm.includes(name)) score += 35;
    if (hintNorm && (name.includes(hintNorm) || hintNorm.includes(name))) score += 30;
    for (const token of tokens) {
      if (sourceNorm.includes(token)) score += token.length >= 5 ? 8 : 5;
      if (hintNorm.includes(token)) score += 6;
    }
    if (tokens.length && tokens.every(token => sourceNorm.includes(token) || hintNorm.includes(token))) score += 12;
    return score;
  }

  function bestProject(sourceText, hint = '') {
    const sourceNorm = nrm(sourceText), hintNorm = nrm(hint);
    const projects = typeof state !== 'undefined' ? state.projects || [] : [];
    const candidates = projects.map(project => ({ project, score: projectScore(project, sourceNorm, hintNorm) })).sort((a, b) => b.score - a.score);
    if (!candidates.length || candidates[0].score < 8) {
      return hint ? { id: '', name: hint, address: '', reason: 'projekt a fájlnévből; törzsadat-egyezés nincs' } : null;
    }
    const winner = candidates[0].project;
    return { id: winner.id || '', name: winner.name || hint, address: winner.address || '', defaultRecipientId: winner.defaultRecipientId || '', reason: `projekt törzsadat-egyezés (${candidates[0].score})` };
  }

  function parsePdfItemsFromLines(lines) {
    const items = [];
    for (let raw of lines || []) {
      const line = String(raw || '').replace(/\s+/g, ' ').trim();
      if (!line || /egys[eé]g[aá]r|engedm[eé]ny|nett[oó]|[oö]sszesen|alapbizonylat|rendel[eé]s\s*:/i.test(line)) continue;
      let code = '', name = '', qty = '', unit = '';
      let match = line.match(/^\s*\d+\s*\.\s*([A-Z0-9._\/-]+)\s+(.+?)\s+(\d+(?:[.,]\d+)?)\s*(m2|m²|m3|m³|fm|m|db|kg|csomag|tekercs|klt|p[aá]r)\b/i);
      if (match) [, code, name, qty, unit] = match;
      if (!match) {
        match = line.match(/^\s*\d+\s+([A-Z0-9._\/-]{3,})\s+(.+?)\s+(\d+(?:[.,]\d+)?)\s*(m2|m²|m3|m³|fm|m|db|kg|csomag|tekercs|klt|p[aá]r)\b/i);
        if (match) [, code, name, qty, unit] = match;
      }
      if (!match) {
        match = line.match(/^\s*([A-Z][A-Z0-9._\/-]{2,})\s+(.+?)\s+(\d+(?:[.,]\d+)?)\s*(m2|m²|m3|m³|fm|m|db|kg|csomag|tekercs|klt|p[aá]r)\b/i);
        if (match) [, code, name, qty, unit] = match;
      }
      if (!match || /^huf$/i.test(code) || name.length < 3) continue;
      const materialSearch = nrm(`${name} ${qty}${unit}`);
      items.push({ code: code.replace(/^\./, ''), name: name.trim(), qty: qty.replace(',', '.'), unit, itemNote: '', longMaterial: /(?:^|\s)(?:4|5|6)\s*m(?:\s|$)|cso|fureszaru|deszka|szal/.test(materialSearch), received: false });
    }
    return items;
  }

  async function loadMsgReader() {
    if (!msgReaderPromise) msgReaderPromise = import(MSG_READER_URL).then(module => module.default || module.MsgReader || module).catch(error => {
      msgReaderPromise = null;
      throw new Error(`Az Outlook-feldolgozó nem tölthető be. Ellenőrizd az internetkapcsolatot. (${error?.message || error})`);
    });
    return msgReaderPromise;
  }

  function getPdfLib() {
    const lib = global.pdfjsLib;
    if (!lib) throw new Error('A PDF-feldolgozó nem töltődött be. Frissítsd az oldalt internetkapcsolattal.');
    lib.GlobalWorkerOptions.workerSrc = PDF_WORKER_URL;
    return lib;
  }

  async function pdfTextAndLines(bytes) {
    const pdfjs = getPdfLib();
    const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const doc = await pdfjs.getDocument({ data }).promise;
    const allLines = [];
    for (let pageNo = 1; pageNo <= doc.numPages; pageNo++) {
      const page = await doc.getPage(pageNo);
      const content = await page.getTextContent();
      const rows = [];
      for (const item of content.items || []) {
        const str = String(item.str || '').trim();
        if (!str) continue;
        const y = +(item.transform?.[5] || 0), x = +(item.transform?.[4] || 0);
        let row = rows.find(candidate => Math.abs(candidate.y - y) < 2.2);
        if (!row) { row = { y, parts: [] }; rows.push(row); }
        row.parts.push({ x, str });
      }
      rows.sort((a, b) => b.y - a.y);
      for (const row of rows) allLines.push(row.parts.sort((a, b) => a.x - b.x).map(part => part.str).join(' ').replace(/\s+/g, ' ').trim());
    }
    return { lines: allLines, text: allLines.join('\n') };
  }

  function recipientFromProject(project) {
    if (!project?.defaultRecipientId || typeof state === 'undefined') return {};
    const recipient = (state.recipients || []).find(item => item.id === project.defaultRecipientId);
    return recipient ? { recipientId: recipient.id, recipientName: recipient.name || '', recipientPhone: recipient.phone || '', recipientEmail: recipient.email || '' } : {};
  }

  function buildExtractedEntry({ category, sourceName, subject, body, pdfName = '', pdfText = '', pdfLines = [], attachmentNames = [] }) {
    const combined = [subject, body, pdfName, pdfText, ...attachmentNames].filter(Boolean).join('\n');
    const refs = extractOrderRefs(pdfText, pdfName, subject, sourceName, body);
    const returnMode = isReturnText(subject, body, pdfName, pdfText);
    const orderType = returnMode ? 'VISSZARU' : (refs[0]?.type || 'SR0');
    const sourceOrderNos = refs.length ? refs.map(ref => ref.no) : unique([extractOrderNo(pdfText, pdfName, subject, sourceName, body)]);
    const orderNo = sourceOrderNos.join(', ');
    const hint = inferProjectHint(pdfName, subject, sourceName, pdfText);
    let supplier = null, project = null, pickup = null, drop = null, pickupRole = 'supplier', dropRole = 'project';
    let items = parsePdfItemsFromLines(pdfLines);
    if (!items.length) items = parseBodyItems(body);
    const reasons = [];

    if (orderType === 'KRPR') {
      pickup = { ...CENTRAL_WAREHOUSE, reason: 'KRPR: felrakó mindig a szigetszentmiklósi központi raktár' };
      project = bestProject(combined, hint);
      drop = project;
      pickupRole = 'warehouse'; dropRole = 'project';
    } else if (orderType === 'PRPR') {
      const transfer = extractTransferWarehouses(pdfText || body || combined);
      pickup = transfer.source;
      drop = transfer.target;
      pickupRole = 'warehouse'; dropRole = 'warehouse';
    } else if (returnMode) {
      project = bestProject(combined, hint || subject.replace(/.*?[-–]\s*/, ''));
      supplier = bestSupplier(combined);
      pickup = project;
      drop = supplier;
      pickupRole = 'project'; dropRole = 'supplier';
    } else {
      supplier = bestSupplier(combined);
      project = bestProject(combined, hint);
      pickup = supplier;
      drop = project;
    }

    reasons.push(pickup?.reason, drop?.reason);
    const warnings = [];
    if (!sourceOrderNos.length) warnings.push('Rendelésszám nem található');
    if (!pickup?.name) warnings.push('Felrakó nem azonosítható');
    if (!pickup?.address) warnings.push('Felrakó címe hiányzik');
    if (!drop?.name) warnings.push('Lerakó/projekt nem azonosítható');
    if (!drop?.address) warnings.push('Lerakó címe hiányzik a törzsadatból');
    if (!items.length) warnings.push('Tételek nem olvashatók automatikusan');
    const duplicateNos = duplicateOrderNumbers(sourceOrderNos);
    const duplicate = duplicateNos.length > 0;
    if (duplicate) warnings.push(`Már szereplő rendelésszám: ${duplicateNos.join(', ')}`);
    const requested = extractRequestedDate(pdfText);
    const scheduleDate = selectedImportDate() || requested;
    return {
      _id: id(), approved: !duplicate, category, sourceName, subject: subject || '', pdfName, attachmentNames,
      scheduleDate, requestedDate: requested, orderNo, sourceOrderNos, fullOrderRefs: refs.map(ref => ref.full), orderType, isReturn: returnMode,
      pickupName: pickup?.name || '', pickupAddress: pickup?.address || '', supplierId: pickupRole === 'supplier' ? (pickup?.id || '') : '', pickupNote: pickup?.pickupNote || '', pickupRole,
      projectName: drop?.name || hint || '', projectId: dropRole === 'project' ? (drop?.id || '') : '', dropAddress: drop?.address || '', dropRole,
      returnSourceProjectId: returnMode ? (project?.id || '') : '', returnDestinationSupplierId: returnMode ? (supplier?.id || '') : '',
      newSupplierData: supplier?.autoMaster ? { name: supplier.name, address: supplier.address, phone: supplier.phone || '', email: supplier.email || '', pickupNote: supplier.pickupNote || '', autoCreatedFromOutlook: true } : null,
      ...recipientFromProject(dropRole === 'project' ? drop : null), items, warnings, duplicate,
      extractionReason: unique(reasons).join(' · '), sourceBody: body || '', sourcePdfText: pdfText || ''
    };
  }

  async function parsePdfFile(file, category) {
    const parsed = await pdfTextAndLines(await file.arrayBuffer());
    return [buildExtractedEntry({ category, sourceName: file.name, subject: file.name, body: '', pdfName: file.name, pdfText: parsed.text, pdfLines: parsed.lines, attachmentNames: [file.name] })];
  }

  async function parseMsgFile(file, category) {
    const MsgReader = await loadMsgReader();
    const reader = new MsgReader(await file.arrayBuffer());
    const info = reader.getFileData() || {};
    const subject = cleanText(info.subject || file.name);
    const body = cleanText([info.body || '', info.bodyHTML || info.html || '', info.headers || ''].join('\n'));
    const attachments = info.attachments || [];
    const names = attachments.map(att => att.fileName || att.fileNameShort || '').filter(Boolean);
    const pdfs = [];
    for (const attachment of attachments) {
      const attachmentName = attachment.fileName || attachment.fileNameShort || '';
      if (!/\.pdf$/i.test(attachmentName)) continue;
      try {
        const extracted = reader.getAttachment(attachment);
        const content = extracted?.content || extracted?.data;
        if (!content) throw new Error('A PDF tartalma üres.');
        const parsed = await pdfTextAndLines(content);
        pdfs.push({ name: attachmentName, ...parsed });
      } catch (error) {
        console.warn('[V39] PDF melléklet hiba', attachmentName, error);
      }
    }
    if (!pdfs.length) return [buildExtractedEntry({ category, sourceName: file.name, subject, body, attachmentNames: names })];
    return pdfs.map(pdf => buildExtractedEntry({ category, sourceName: file.name, subject, body, pdfName: pdf.name, pdfText: pdf.text, pdfLines: pdf.lines, attachmentNames: names }));
  }

  async function parseDroppedFile(file, category) {
    if (/\.pdf$/i.test(file.name)) return parsePdfFile(file, category);
    if (/\.msg$/i.test(file.name)) return parseMsgFile(file, category);
    throw new Error('Csak .msg vagy teszteléshez .pdf fájl fogadható.');
  }

  function statusText(entry) {
    if (entry.duplicate) return 'Duplikált';
    if (!entry.warnings.length) return 'Felismerve';
    return `${entry.warnings.length} ellenőrzendő`;
  }

  function entryCard(entry, index) {
    const categoryLabel = entry.category === 'martin' ? 'Martin / Platós' : 'Dobozos';
    return `<article class="v38-preview-card ${entry.approved ? '' : 'disabled'}" data-entry-id="${htmlEsc(entry._id)}">
      <header><label class="check"><input class="v38-approved" type="checkbox" ${entry.approved ? 'checked' : ''}> Importálás</label><span class="v38-category ${entry.category}">${categoryLabel}</span><button class="v38-remove" type="button" title="Eltávolítás">×</button></header>
      <div class="v38-source"><b>${htmlEsc(entry.sourceName)}</b><span>${htmlEsc(entry.orderType || 'SR0')}${entry.isReturn ? ' · visszáru' : ''}</span>${entry.pdfName && entry.pdfName !== entry.sourceName ? `<span>PDF: ${htmlEsc(entry.pdfName)}</span>` : ''}<span class="v38-status ${entry.warnings.length ? 'warn' : 'ok'}">${htmlEsc(statusText(entry))}</span></div>
      <div class="v38-fields">
        <label>Felvétel dátuma<input data-field="scheduleDate" type="date" value="${htmlEsc(entry.scheduleDate)}"></label>
        <label>Rendelésszám<input data-field="orderNo" value="${htmlEsc(entry.orderNo)}" placeholder="pl. 004911"></label>
        <label>Felrakó<input data-field="pickupName" value="${htmlEsc(entry.pickupName)}"></label>
        <label>Felrakó címe<input data-field="pickupAddress" value="${htmlEsc(entry.pickupAddress)}"></label>
        <label>Lerakó / projekt<input data-field="projectName" value="${htmlEsc(entry.projectName)}"></label>
        <label>Lerakó címe<input data-field="dropAddress" value="${htmlEsc(entry.dropAddress)}"></label>
      </div>
      <details><summary>Tételek (${entry.items.length}) és felismerési adatok</summary>
        ${entry.items.length ? `<div class="v38-items">${entry.items.map(item => `<div><b>${htmlEsc(item.code)}</b><span>${htmlEsc(item.name)}</span><span>${htmlEsc(item.qty)} ${htmlEsc(item.unit)}</span></div>`).join('')}</div>` : '<p>Nincs automatikusan felismert tétel.</p>'}
        ${entry.extractionReason ? `<p><b>Felismerés:</b> ${htmlEsc(entry.extractionReason)}</p>` : ''}
        ${entry.warnings.length ? `<ul class="v38-warnings">${entry.warnings.map(warning => `<li>${htmlEsc(warning)}</li>`).join('')}</ul>` : '<p class="v38-ok">Minden kötelező adat felismerve.</p>'}
      </details>
    </article>`;
  }

  function renderPending() {
    const container = document.getElementById('v38ImportPreview');
    const summary = document.getElementById('v38ImportSummary');
    const commit = document.getElementById('v38CommitImport');
    if (!container) return;
    container.innerHTML = pending.length ? pending.map(entryCard).join('') : '<div class="notice">Még nincs feldolgozott Outlook-rendelés.</div>';
    const approved = pending.filter(entry => entry.approved).length;
    const box = pending.filter(entry => entry.category === 'dobozos').length;
    const martin = pending.filter(entry => entry.category === 'martin').length;
    const warnings = pending.filter(entry => entry.warnings.length).length;
    if (summary) summary.textContent = `${pending.length} rendelés az előnézetben · Dobozos: ${box} · Martin / Platós: ${martin} · Jóváhagyva: ${approved} · Ellenőrzendő: ${warnings}`;
    if (commit) commit.disabled = processing || !approved;
    bindPreviewEditors();
  }

  function bindPreviewEditors() {
    document.querySelectorAll('.v38-preview-card').forEach(card => {
      const entry = pending.find(item => item._id === card.dataset.entryId);
      if (!entry) return;
      card.querySelector('.v38-approved')?.addEventListener('change', event => { entry.approved = event.target.checked; renderPending(); });
      card.querySelector('.v38-remove')?.addEventListener('click', () => { pending = pending.filter(item => item !== entry); renderPending(); });
      card.querySelectorAll('[data-field]').forEach(input => input.addEventListener('change', () => {
        entry[input.dataset.field] = input.value.trim();
        entry.sourceOrderNos = orderNumbersOf(entry.orderNo); entry.duplicate = duplicateOrderNumbers(entry.sourceOrderNos).length > 0;
        entry.warnings = entry.warnings.filter(warning => !/Rendelésszám|Felrakó|Projekt címe|Lerakó\/projekt|már szerepel/.test(warning));
        if (!entry.orderNo) entry.warnings.push('Rendelésszám nem található');
        if (!entry.pickupName) entry.warnings.push('Felrakó nem azonosítható');
        if (!entry.pickupAddress) entry.warnings.push('Felrakó címe hiányzik');
        if (!entry.projectName) entry.warnings.push('Lerakó/projekt nem azonosítható');
        if (!entry.dropAddress) entry.warnings.push('Projekt címe hiányzik a törzsadatból');
        if (entry.duplicate) { entry.warnings.push('Egy vagy több rendelésszám már szerepel a programban'); entry.approved = false; }
        renderPending();
      }));
    });
  }

  function setDropStatus(category, text, kind = '') {
    const element = document.getElementById(category === 'martin' ? 'v38MartinStatus' : 'v38BoxStatus');
    if (element) { element.textContent = text; element.className = `v38-drop-status ${kind}`; }
  }

  async function processFiles(fileList, category) {
    if (processing) return;
    const files = [...fileList].filter(file => /\.(msg|pdf)$/i.test(file.name));
    if (!files.length) return alert('Nem található .msg fájl. Teszteléshez közvetlen .pdf is behúzható.');
    processing = true;
    setDropStatus(category, `Feldolgozás: 0 / ${files.length}`, 'busy');
    renderPending();
    let success = 0, failures = 0;
    for (let index = 0; index < files.length; index++) {
      const file = files[index];
      setDropStatus(category, `Feldolgozás: ${index + 1} / ${files.length} · ${file.name}`, 'busy');
      try {
        const entries = await parseDroppedFile(file, category);
        pending.push(...entries);
        success += entries.length;
      } catch (error) {
        failures++;
        console.error('[V39] Outlook import hiba', file.name, error);
        pending.push({
          _id: id(), approved: false, category, sourceName: file.name, subject: '', pdfName: '', attachmentNames: [], scheduleDate: selectedImportDate(), orderNo: '', pickupName: '', pickupAddress: '', projectName: '', dropAddress: '', items: [], warnings: [`Feldolgozási hiba: ${error?.message || error}`], duplicate: false, extractionReason: ''
        });
      }
      renderPending();
    }
    processing = false;
    setDropStatus(category, `${success} rendelés felismerve${failures ? ` · ${failures} fájl hibás` : ''}`, failures ? 'warn' : 'ok');
    renderPending();
  }

  function findMartinVehicle() {
    return (typeof activeVehicles === 'function' ? activeVehicles() : state.vehicles || []).find(vehicle => nrm(vehicle.driverName).includes('martin'))
      || (state.vehicles || []).find(vehicle => nrm(vehicle.driverName).includes('martin'));
  }

  function masterIdsForEntry(entry) {
    const supplier = (state.suppliers || []).find(item => nrm(item.name) === nrm(entry.pickupName) && (!entry.pickupAddress || nrm(item.address) === nrm(entry.pickupAddress)))
      || (state.suppliers || []).find(item => nrm(item.address) === nrm(entry.pickupAddress));
    const project = (state.projects || []).find(item => nrm(item.name) === nrm(entry.projectName))
      || (state.projects || []).find(item => entry.dropAddress && nrm(item.address) === nrm(entry.dropAddress));
    return { supplier, project };
  }

  function ensureSupplierMaster(entry) {
    const data = entry.newSupplierData;
    if (!data?.name || !data?.address) return null;
    let supplier = (state.suppliers || []).find(item => nrm(item.name) === nrm(data.name) && nrm(item.address) === nrm(data.address))
      || (state.suppliers || []).find(item => nrm(item.address) === nrm(data.address));
    if (supplier) return supplier;
    supplier = { id: id(), name: data.name, site: '', address: data.address, phone: data.phone || '', email: data.email || '', pickupNote: data.pickupNote || '', note: data.pickupNote || '', active: true, manualOverride: true, autoCreatedFromOutlook: true, createdAt: new Date().toISOString() };
    state.suppliers = state.suppliers || [];
    state.suppliers.push(supplier);
    entry.supplierId = supplier.id;
    if (entry.pickupRole === 'supplier') entry.pickupName = supplier.name;
    return supplier;
  }

  function entryToOrder(entry) {
    const createdSupplier = ensureSupplierMaster(entry);
    const { supplier, project } = masterIdsForEntry(entry);
    const martin = findMartinVehicle();
    const isMartin = entry.category === 'martin';
    const recipient = project?.defaultRecipientId ? (state.recipients || []).find(item => item.id === project.defaultRecipientId) : null;
    const sourceNos = entry.sourceOrderNos?.length ? entry.sourceOrderNos : orderNumbersOf(entry);
    return {
      id: id(), scheduleDate: entry.scheduleDate || selectedImportDate(), vehicleId: isMartin ? (martin?.id || '') : '', sequence: 999,
      orderNo: entry.orderNo || sourceNos.join(', '), sourceOrderNos: sourceNos, fullOrderRefs: entry.fullOrderRefs || [], orderType: entry.orderType || 'SR0', isReturn: !!entry.isReturn,
      topicName: entry.projectName, pickupName: entry.pickupName, pickupAddress: entry.pickupAddress, pickupNote: supplier?.pickupNote || supplier?.note || createdSupplier?.pickupNote || entry.pickupNote || '', supplierId: entry.pickupRole === 'supplier' ? (supplier?.id || createdSupplier?.id || entry.supplierId || '') : '',
      projectName: entry.projectName, projectId: entry.dropRole === 'project' ? (project?.id || entry.projectId || '') : '', dropAddress: entry.dropAddress,
      pickupRole: entry.pickupRole || 'supplier', dropRole: entry.dropRole || 'project', returnSourceProjectId: entry.returnSourceProjectId || '', returnDestinationSupplierId: entry.returnDestinationSupplierId || createdSupplier?.id || '',
      recipientId: recipient?.id || entry.recipientId || '', recipientName: recipient?.name || entry.recipientName || '', recipientPhone: recipient?.phone || entry.recipientPhone || '', recipientEmail: recipient?.email || entry.recipientEmail || '',
      requestedDeadline: entry.requestedDate || '', note: `Outlook import · ${entry.orderType || 'SR0'} · ${entry.sourceName}${entry.pdfName ? ` · ${entry.pdfName}` : ''}`,
      items: (entry.items || []).map(item => ({ ...item, _id: item._id || id(), received: false, missingQty: '' })),
      longMaterialReason: isMartin ? ((entry.items || []).find(item => item.longMaterial)?.name || 'Martin / Platós Outlook import') : '',
      markedMartin: isMartin, importVehicleCategory: isMartin ? 'martin' : 'dobozos', importAutoRaw: isMartin ? 'Martin' : 'Dobozos', importVehicleLocked: isMartin,
      outlookImport: true, outlookSourceFile: entry.sourceName, outlookPdfFile: entry.pdfName || '', outlookImportedAt: new Date().toISOString(), completed: false
    };
  }

  function commitImport() {
    const approved = pending.filter(entry => entry.approved);
    if (!approved.length) return alert('Nincs jóváhagyott rendelés.');
    const existing = new Set((state.orders || []).flatMap(orderNumbersOf));
    const withinBatch = new Set();
    const accepted = [], skipped = [];
    for (const entry of approved) {
      const numbers = entry.sourceOrderNos?.length ? entry.sourceOrderNos : orderNumbersOf(entry);
      if (!numbers.length || !entry.pickupName || !entry.projectName) { skipped.push(`${entry.sourceName}: hiányzó kötelező adat`); continue; }
      const duplicates = numbers.filter(number => existing.has(String(number)) || withinBatch.has(String(number)));
      if (duplicates.length) { skipped.push(`${duplicates.join(', ')}: már létezik`); continue; }
      numbers.forEach(number => withinBatch.add(String(number)));
      accepted.push(entryToOrder(entry));
    }
    if (!accepted.length) return alert(`Nem került be rendelés.\n${skipped.join('\n')}`);
    state.orders.push(...accepted);
    state.routePlans = state.routePlans || {};
    for (const order of accepted) state.routePlans[order.scheduleDate] = {};
    if (typeof save === 'function') save();
    pending = pending.filter(entry => !approved.includes(entry) || skipped.some(text => (entry.sourceOrderNos || []).some(number => text.startsWith(number)) || text.startsWith(entry.sourceName)));
    renderPending();
    const martinCount = accepted.filter(order => order.importVehicleCategory === 'martin').length;
    const boxCount = accepted.filter(order => order.importVehicleCategory === 'dobozos').length;
    alert(`${accepted.length} Outlook-rendelés importálva. Martin / Platós: ${martinCount}, Dobozos: ${boxCount}.${skipped.length ? `\nKihagyva: ${skipped.length}` : ''}\nA Dobozos fuvarokat a „Fuvar szétosztása” gomb osztja ki.`);
  }

  function bindDropZone(zoneId, inputId, category) {
    const zone = document.getElementById(zoneId), input = document.getElementById(inputId);
    if (!zone || !input) return;
    ['dragenter', 'dragover'].forEach(type => zone.addEventListener(type, event => { event.preventDefault(); zone.classList.add('dragover'); }));
    ['dragleave', 'drop'].forEach(type => zone.addEventListener(type, event => { event.preventDefault(); zone.classList.remove('dragover'); }));
    zone.addEventListener('drop', event => processFiles(event.dataTransfer.files, category));
    input.addEventListener('change', event => { processFiles(event.target.files, category); input.value = ''; });
  }

  function migrateV39MasterData() {
    let changed = false;
    for (const supplier of state.suppliers || []) {
      if (/szerelv[eé]nybolt/i.test(supplier.name || '') && nrm(supplier.address) !== nrm('1182 Budapest, Üllői út 807/B')) { supplier.address = '1182 Budapest, Üllői út 807/B'; supplier.manualOverride = true; changed = true; }
    }
    for (const order of state.orders || []) if (/szerelv[eé]nybolt/i.test(order.pickupName || '') && nrm(order.pickupAddress) !== nrm('1182 Budapest, Üllői út 807/B')) { order.pickupAddress = '1182 Budapest, Üllői út 807/B'; changed = true; }
    for (const project of state.projects || []) if (/^(k[oö]zponti rakt[aá]r|szigetszentmikl[oó]s_rakt[aá]r)$/i.test(project.name || '') && nrm(project.address) !== nrm(CENTRAL_WAREHOUSE.address)) { project.address = CENTRAL_WAREHOUSE.address; changed = true; }
    state.settings = state.settings || {};
    if (!state.settings.baseAddress || /keresked[oő] utca(?:\s*$|\s*2)/i.test(state.settings.baseAddress)) state.settings.baseAddress = CENTRAL_WAREHOUSE.address;
    if (changed) { state.routePlans = {}; state.routeStats = {}; if (typeof KEY !== 'undefined' && typeof localStorage !== 'undefined') localStorage.setItem(KEY, JSON.stringify(state)); }
    return changed;
  }

  function syncBacklogItemState(order) {
    if (!order) return;
    state.backlog = state.backlog || [];
    state.resolvedBacklog = state.resolvedBacklog || [];
    const received = new Set((order.items || []).filter(item => item.received).map(item => item._id).filter(Boolean));
    const open = [];
    for (const record of state.backlog) {
      if (record.targetOrderId === order.id && record.itemId && received.has(record.itemId)) state.resolvedBacklog.push({ ...record, resolvedAt: new Date().toISOString() });
      else open.push(record);
    }
    state.backlog = open;
    const openItemIds = new Set((order.items || []).filter(item => !item.received).map(item => item._id).filter(Boolean));
    const stillResolved = [];
    for (const record of state.resolvedBacklog) {
      if (record.targetOrderId === order.id && record.itemId && openItemIds.has(record.itemId)) {
        const restored = { ...record }; delete restored.resolvedAt; state.backlog.push(restored);
      } else stillResolved.push(record);
    }
    state.resolvedBacklog = stillResolved;
    order.completed = (order.items || []).length > 0 && order.items.every(item => item.received);
    order.backlogResolved = order.completed && ((state.resolvedBacklog || []).some(record => record.targetOrderId === order.id) || !!order.movedFromOrderId);
    if (order.backlogResolved) order.resolvedBacklogAt = order.resolvedBacklogAt || new Date().toISOString();
  }

  function installBacklogPatch() {
    global.toggleItem = (orderId, index, value) => {
      const order = state.orders.find(item => item.id === orderId);
      if (!order?.items?.[index]) return;
      order.items[index].received = !!value;
      if (value) order.items[index].missingQty = '';
      syncBacklogItemState(order);
      if (typeof save === 'function') save(false);
      if (typeof openItems === 'function' && document.getElementById('itemsDialog')?.open) openItems(orderId);
      if (typeof renderRoutes === 'function') renderRoutes();
      if (typeof renderDriver === 'function') renderDriver();
      if (typeof renderBacklog === 'function') renderBacklog();
    };
  }

  function bindV38() {
    migrateV39MasterData();
    installBacklogPatch();
    const dateInput = document.getElementById('v38ImportDate');
    if (dateInput && !dateInput.value) dateInput.value = typeof selectedDate === 'function' ? selectedDate() : new Date().toISOString().slice(0, 10);
    bindDropZone('v38BoxDrop', 'v38BoxInput', 'dobozos');
    bindDropZone('v38MartinDrop', 'v38MartinInput', 'martin');
    document.getElementById('v38ClearPreview')?.addEventListener('click', () => { if (!pending.length || confirm('Törlöd az Outlook-import teljes előnézetét?')) { pending = []; renderPending(); } });
    document.getElementById('v38CommitImport')?.addEventListener('click', commitImport);
    renderPending();
    global.FUVARSZERVEZO_VERSION = VERSION;
    const previousDiagnostics = global.getFuvarszervezoDiagnostics;
    global.getFuvarszervezoDiagnostics = () => ({ ...(typeof previousDiagnostics === 'function' ? previousDiagnostics() : {}), version: VERSION, outlookImport: true, outlookImportCategories: ['Dobozos', 'Martin / Platós'], outlookOrderNoRule: 'csak a / utáni rész', outlookPdfAttachments: true, krprRule: true, prprRule: true, returnRule: true, autoSupplierMaster: true, itemLevelBacklog: true });
  }

  global.V39OutlookImport = {
    version: VERSION,
    extractOrderNo,
    extractOrderRefs,
    orderNumbersOf,
    isReturnText,
    extractExplicitPickup,
    parseBodyItems,
    extractTransferWarehouses,
    duplicateOrderNumbers,
    inferProjectHint,
    supplierSpecial,
    parsePdfItemsFromLines,
    bestSupplier,
    bestProject,
    buildExtractedEntry,
    entryToOrder,
    ensureSupplierMaster,
    migrateV39MasterData,
    syncBacklogItemState,
    parseDroppedFile,
    processFiles,
    commitImport,
    getPending: () => pending.slice()
  };

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bindV38, { once: true });
    else bindV38();
  }
})(typeof window !== 'undefined' ? window : globalThis);
