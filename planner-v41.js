/* Fuvarszervező V41
   Outlook (.msg) + PDF rendelésimport.

   - Két külön tömeges import: Dobozos és Martin / Platós.
   - A levél tárgya/törzse és minden PDF melléklet együtt kerül elemzésre.
   - A rendelésazonosító mindig a perjel utáni rész (pl. 2026-SR0/004911 -> 004911).
   - A felrakó és projekt címét elsősorban a törzsadat adja; a PDF vevői címe nem írja felül a projektcímet.
   - Az import teljesen helyben, a böngészőben történik.
*/
(function (global) {
  'use strict';

  const VERSION = '41';
  const PDF_WORKER_URL = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  const LEGAL_WORDS = new Set(['kft', 'zrt', 'bt', 'nyrt', 'trade', 'hungary', 'magyarorszag', 'es', 'the', 'partner']);
  const PROJECT_NOISE = new Set(['budapest', 'garancia', 'terv', 'projekt', 'utem', 'epulet', 'tarsashaz', 'hotel', 'pr']);
  let pending = [];
  let processing = false;

  const nrm = value => {
    if (typeof norm === 'function') return norm(value || '');
    return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[_.,;:()[\]{}\/\\-]+/g, ' ').replace(/\s+/g, ' ').trim();
  };
  const htmlEsc = value => typeof esc === 'function'
    ? esc(value ?? '')
    : String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const id = () => typeof uid === 'function' ? uid() : `v41-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const localISO = date => { const d = new Date(date); const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0'); return `${y}-${m}-${day}`; };
  const tomorrowISO = () => { const d = new Date(); d.setDate(d.getDate() + 1); return localISO(d); };
  const selectedImportDate = () => ((typeof document !== 'undefined' ? document.getElementById('v38ImportDate')?.value : '') || tomorrowISO());
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

  function extractOrderRefsDetailed(...sources) {
    const text = sources.filter(Boolean).join('\n');
    const refs = [];
    for (const match of text.matchAll(/\b(20\d{2})\s*-\s*(SR0|KRPR|PRPR)\s*\/\s*([0-9]{4,12})\b/gi)) {
      const ref = { year: match[1], type: match[2].toUpperCase(), no: match[3], full: `${match[1]}-${match[2].toUpperCase()}/${match[3]}`, index: match.index ?? -1 };
      if (!refs.some(existing => existing.full === ref.full)) refs.push(ref);
    }
    return refs;
  }

  function extractOrderRefs(...sources) {
    return extractOrderRefsDetailed(...sources).map(({ index, ...ref }) => ref);
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

  function matchingOutlookOrders(numbers = [], orderType = 'SR0', isReturn = false) {
    const wanted = new Set(numbers.map(String));
    return (typeof state !== 'undefined' ? state.orders || [] : []).filter(order => {
      if (!order.outlookImport) return false;
      const sameType = (isReturn || orderType === 'VISSZARU') ? !!order.isReturn : !order.isReturn && String(order.orderType || 'SR0') === String(orderType || 'SR0');
      return sameType && orderNumbersOf(order).some(number => wanted.has(String(number)));
    });
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
    const projectMatchText = text.match(/projekt\s*n[eé]v\s*[:\-]\s*([A-Za-zÁÉÍÓÖŐÚÜŰáéíóöőúüű0-9_.\/-]{2,80})/i);
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
    let score = project?.address ? 3 : 0;
    if (sourceNorm.includes(name)) score += 35;
    if (hintNorm && (name.includes(hintNorm) || hintNorm.includes(name))) score += 30;
    for (const token of tokens) {
      if (sourceNorm.includes(token)) score += token.length >= 5 ? 8 : 5;
      if (hintNorm.includes(token)) score += 6;
    }
    if (tokens.length && tokens.every(token => sourceNorm.includes(token) || hintNorm.includes(token))) score += 12;
    if (name.includes('terv') && !sourceNorm.includes('terv') && !hintNorm.includes('terv')) score -= 28;
    if (name.includes('garancia') && !sourceNorm.includes('garancia') && !hintNorm.includes('garancia')) score -= 24;
    return score;
  }

  function bestProject(sourceText, hint = '') {
    const sourceNorm = nrm(sourceText), hintNorm = nrm(hint);
    const projects = typeof state !== 'undefined' ? state.projects || [] : [];
    const candidates = projects.map(project => ({ project, score: projectScore(project, sourceNorm, hintNorm) }))
      .sort((a, b) => b.score - a.score || Number(Boolean(b.project.address)) - Number(Boolean(a.project.address)));
    if (!candidates.length || candidates[0].score < 8) {
      return hint ? { id: '', name: hint, address: '', reason: 'projekt a fájlnévből; törzsadat-egyezés nincs' } : null;
    }
    const winner = candidates[0].project;
    return { id: winner.id || '', name: winner.name || hint, address: winner.address || '', defaultRecipientId: winner.defaultRecipientId || '', reason: `projekt törzsadat-egyezés (${candidates[0].score})` };
  }

  /*
    KRPR célraktár-cím pótlás.
    A raktárközi bizonylaton gyakran csak a célraktár/projekt neve szerepel.
    Ilyenkor kizárólag olyan projekt-törzsadatból pótolunk, amelyhez tényleges cím tartozik.
    A névazonos, aliasos és token-alapú egyezéseknél is a címmel rendelkező projekt élvez elsőbbséget.
  */
  function projectWithAddressFromMaster(target = {}, sourceText = '') {
    const projects = typeof state !== 'undefined' ? state.projects || [] : [];
    const targetName = typeof target === 'string' ? target : (target?.name || '');
    const targetId = typeof target === 'object' ? (target?.id || '') : '';
    const targetNorm = nrm(targetName);
    const sourceNorm = nrm(`${sourceText || ''} ${targetName || ''}`);
    const aliases = (typeof state !== 'undefined' && state.aliases?.projects) || {};
    const aliasId = aliases[targetNorm] || '';
    const targetTokens = significantTokens(targetName, PROJECT_NOISE);

    const candidates = projects
      .filter(project => String(project?.address || '').trim())
      .map(project => {
        const nameNorm = nrm(project.name || '');
        let score = projectScore(project, sourceNorm, targetNorm);
        if (targetId && project.id === targetId) score += 1000;
        if (aliasId && project.id === aliasId) score += 900;
        if (targetNorm && nameNorm === targetNorm) score += 500;
        if (targetNorm && (nameNorm.includes(targetNorm) || targetNorm.includes(nameNorm))) score += 120;
        const projectTokens = significantTokens(project.name, PROJECT_NOISE);
        const overlap = targetTokens.filter(token => projectTokens.includes(token)).length;
        score += overlap * 20;
        if (targetTokens.length && overlap === targetTokens.length) score += 40;
        if (/\b(?:terv|garancia)\b/.test(nameNorm) && !/\b(?:terv|garancia)\b/.test(targetNorm)) score -= 35;
        return { project, score };
      })
      .sort((a, b) => b.score - a.score);

    if (!candidates.length || candidates[0].score < 8) return null;
    const winner = candidates[0].project;
    return {
      id: winner.id || '',
      name: winner.name || targetName,
      address: winner.address || '',
      defaultRecipientId: winner.defaultRecipientId || '',
      reason: `KRPR célraktár címe a projekttörzsből (${candidates[0].score})`
    };
  }

  function stripSignature(text = '') {
    const value = cleanText(text);
    const markers = [/\n\s*[uü]dv[oö]zlettel\s*:/i, /\n\s*k[oö]sz[oö]n[oö]m\s*!?\s*\n/i];
    let cut = value.length;
    for (const marker of markers) {
      const match = marker.exec(value);
      if (match && match.index > 20) cut = Math.min(cut, match.index);
    }
    return value.slice(0, cut).trim() || value;
  }

  function projectMasterByIdentity(location) {
    if (!location || typeof state === 'undefined') return location || null;
    const projects = state.projects || [];
    const byId = location.id ? projects.find(item => item.id === location.id) : null;
    const byName = projects.find(item => nrm(item.name) === nrm(location.name));
    const byLooseName = projects.find(item => {
      const a = significantTokens(item.name, PROJECT_NOISE), b = significantTokens(location.name, PROJECT_NOISE);
      return a.length && b.length && (a.every(token => b.includes(token)) || b.every(token => a.includes(token)));
    });
    const master = byId || byName || byLooseName;
    return master ? { ...location, id: master.id || location.id || '', name: master.name || location.name || '', address: master.address || location.address || '', defaultRecipientId: master.defaultRecipientId || location.defaultRecipientId || '', reason: `${location.reason || ''}${location.reason ? ' · ' : ''}cím a projekttörzsből` } : location;
  }

  function projectLabelWindow(pdfText = '', pdfLines = [], mode = 'SR0') {
    const lines = (pdfLines?.length ? pdfLines : linesOf(pdfText));
    const target = mode === 'KRPR' || mode === 'PRPR'
      ? /c[eé]l\s*rakt[aá]r/i
      : /projekt\s*n[eé]v|(?:^|\s)rakt[aá]r\s*:/i;
    const found = [];
    for (let i = 0; i < lines.length; i++) {
      if (!target.test(lines[i])) continue;
      found.push(lines.slice(i, i + 3).join(' '));
    }
    return found.join('\n');
  }

  function projectFromPdfMaster(pdfText = '', pdfLines = [], hint = '', mode = 'SR0') {
    const labelText = projectLabelWindow(pdfText, pdfLines, mode);
    let project = labelText ? bestProject(labelText, labelText) : null;
    if (!project || !project.name) project = bestProject(pdfText, hint);
    return projectMasterByIdentity(project);
  }

  function inferReturnProjectHint(subject = '', body = '') {
    const cleanSubject = cleanText(subject).replace(/\.(?:msg|pdf)$/i, '');
    const direct = cleanSubject.match(/vissz[aá]ru\s*[-–:]\s*(.+)$/i);
    if (direct) return direct[1].replace(/[_-]+/g, ' ').trim();
    const projects = typeof state !== 'undefined' ? state.projects || [] : [];
    const source = nrm(`${cleanSubject} ${stripSignature(body)}`);
    const ranked = projects.map(project => ({ project, score: projectScore(project, source, source) })).sort((a, b) => b.score - a.score);
    return ranked[0]?.score >= 8 ? ranked[0].project.name : cleanSubject;
  }

  function resolveReturnSupplier(subject = '', body = '', combined = '') {
    const core = stripSignature(body);
    const special = supplierSpecial(`${subject}\n${core}`);
    if (special) {
      const master = (typeof state !== 'undefined' ? state.suppliers || [] : []).find(item => nrm(item.address) === nrm(special.address) || significantTokens(special.name).every(token => nrm(item.name).includes(token)));
      return { ...special, id: master?.id || '', pickupNote: master?.pickupNote || master?.note || '', autoMaster: !master };
    }
    const supplier = bestSupplier(`${subject}\n${core}`) || bestSupplier(combined);
    if (supplier && /k[oö]zponti\s+rakt[aá]r/i.test(supplier.name || '') && !/k[oö]zponti\s+rakt[aá]r(?:ba|hoz|nak|b[oő]l)/i.test(core)) return null;
    return supplier;
  }

  function classifyPdfDocument(pdf = {}) {
    const head = nrm((pdf.lines || []).slice(0, 30).join(' ') || String(pdf.text || '').slice(0, 2500));
    const refs = extractOrderRefs(pdf.text || '', pdf.name || '');
    const supplierOrder = /szallito\s+rendeles/.test(head);
    const warehouseTransfer = /raktarkozi/.test(head) || refs.some(ref => ref.type === 'KRPR' || ref.type === 'PRPR');
    const confirmation = /visszaigazolas|rendeles\s+visszaigazolas|megrendeles\s+visszaigazolasa|ajanlat/.test(head) && !supplierOrder && !warehouseTransfer;
    return { primary: supplierOrder || warehouseTransfer, supplierOrder, warehouseTransfer, confirmation, refs };
  }

  function splitPdfDocumentByOrders(pdf = {}) {
    const refs = extractOrderRefs(pdf.text || '', pdf.name || '');
    if (refs.length <= 1) return [pdf];
    const textRefs = extractOrderRefsDetailed(pdf.text || '').filter(ref => ref.index >= 0);
    if (textRefs.length <= 1) return refs.map(ref => ({ ...pdf, forcedRefs: [ref] }));
    const result = [];
    for (let i = 0; i < textRefs.length; i++) {
      const ref = textRefs[i];
      const next = textRefs[i + 1];
      const previousHeader = Math.max(0, (pdf.text || '').lastIndexOf('Szállító rendelés', ref.index));
      const start = i === 0 ? previousHeader : ref.index;
      const end = next ? next.index : (pdf.text || '').length;
      const text = (pdf.text || '').slice(start, end);
      result.push({ ...pdf, text, lines: linesOf(text), forcedRefs: [ref] });
    }
    return result;
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
    const Reader = global.LocalMsgReader;
    if (typeof Reader !== 'function') {
      throw new Error('A beépített Outlook MSG-olvasó nem indult el. Ellenőrizd, hogy az ole-msg-reader.js fájl is felkerült-e a GitHubra, majd frissíts Ctrl+F5-tel.');
    }
    return Reader;
  }

  function getPdfLib() {
    const lib = global.pdfjsLib;
    if (!lib) throw new Error('A PDF-feldolgozó nem töltődött be. Frissítsd az oldalt internetkapcsolattal.');
    lib.GlobalWorkerOptions.workerSrc = PDF_WORKER_URL;
    return lib;
  }

  async function pdfTextAndLines(bytes) {
    const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    if (typeof global.V41PdfTextExtractor === 'function') return await global.V41PdfTextExtractor(data);
    if (typeof global.V40PdfTextExtractor === 'function') return await global.V40PdfTextExtractor(data);
    const pdfjs = getPdfLib();
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

  function buildExtractedEntry({ category, sourceName, subject, body, pdfName = '', pdfText = '', pdfLines = [], attachmentNames = [], forcedRefs = [] }) {
    const combined = [subject, body, pdfName, pdfText, ...attachmentNames].filter(Boolean).join('\n');
    const refs = forcedRefs.length ? forcedRefs : extractOrderRefs(pdfText, pdfName, subject, sourceName, body);
    const returnMode = isReturnText(subject, body, pdfName, pdfText);
    const orderType = returnMode ? 'VISSZARU' : (refs[0]?.type || 'SR0');
    const sourceOrderNos = refs.length ? unique(refs.map(ref => ref.no)) : unique([extractOrderNo(pdfText, pdfName, subject, sourceName, body)]);
    const orderNo = sourceOrderNos.join(', ');
    const hint = inferProjectHint(pdfName, subject, sourceName, pdfText);
    let supplier = null, project = null, pickup = null, drop = null, pickupRole = 'supplier', dropRole = 'project';
    let items = parsePdfItemsFromLines(pdfLines);
    if (!items.length) items = parseBodyItems(body);
    const reasons = [];

    if (orderType === 'KRPR') {
      pickup = { ...CENTRAL_WAREHOUSE, reason: 'KRPR: felrakó mindig a szigetszentmiklósi központi raktár' };
      project = projectFromPdfMaster(pdfText || combined, pdfLines, hint, 'KRPR') || bestProject(combined, hint);
      project = projectMasterByIdentity(project);
      drop = project;
      pickupRole = 'warehouse'; dropRole = 'project';
    } else if (orderType === 'PRPR') {
      const transfer = extractTransferWarehouses(pdfText || body || combined);
      pickup = transfer.source;
      drop = transfer.target;
      if (pickup?.kind === 'project') pickup = projectMasterByIdentity(pickup);
      if (drop?.kind === 'project' || (drop && (state.projects || []).some(item => nrm(item.name) === nrm(drop.name)))) drop = projectMasterByIdentity(drop);
      pickupRole = 'warehouse'; dropRole = 'warehouse';
    } else if (returnMode) {
      const returnHint = inferReturnProjectHint(subject, body);
      project = projectMasterByIdentity(bestProject(`${subject}\n${stripSignature(body)}`, returnHint) || bestProject(combined, returnHint));
      supplier = resolveReturnSupplier(subject, body, combined);
      pickup = project;
      drop = supplier;
      pickupRole = 'project'; dropRole = 'supplier';
    } else {
      supplier = bestSupplier(combined);
      project = projectFromPdfMaster(pdfText || combined, pdfLines, hint, 'SR0') || bestProject(combined, hint);
      project = projectMasterByIdentity(project);
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
    const existingOrderNos = unique(matchingOutlookOrders(sourceOrderNos, orderType, returnMode).flatMap(orderNumbersOf));
    const requested = extractRequestedDate(pdfText);
    const scheduleDate = selectedImportDate() || requested || tomorrowISO();
    return {
      _id: id(), approved: true, category, sourceName, subject: subject || '', pdfName, attachmentNames,
      scheduleDate, scheduleDateManual: false, requestedDate: requested, orderNo, sourceOrderNos, fullOrderRefs: refs.map(ref => ref.full), orderType, isReturn: returnMode,
      pickupName: pickup?.name || '', pickupAddress: pickup?.address || '', supplierId: pickupRole === 'supplier' ? (pickup?.id || '') : '', pickupNote: pickup?.pickupNote || '', pickupRole,
      projectName: drop?.name || hint || '', projectId: dropRole === 'project' ? (drop?.id || '') : '', dropAddress: drop?.address || '', dropRole,
      returnSourceProjectId: returnMode ? (project?.id || '') : '', returnDestinationSupplierId: returnMode ? (supplier?.id || '') : '',
      newSupplierData: supplier?.autoMaster ? { name: supplier.name, address: supplier.address, phone: supplier.phone || '', email: supplier.email || '', pickupNote: supplier.pickupNote || '', autoCreatedFromOutlook: true } : null,
      ...recipientFromProject(dropRole === 'project' ? drop : null), items, warnings, duplicate: false, existingOrderNos,
      extractionReason: unique(reasons).join(' · '), sourceBody: body || '', sourcePdfText: pdfText || ''
    };
  }

  function entriesFromPdfDocument({ category, sourceName, subject, body, pdf, attachmentNames = [] }) {
    return splitPdfDocumentByOrders(pdf).map(part => buildExtractedEntry({
      category, sourceName, subject, body, pdfName: part.name, pdfText: part.text, pdfLines: part.lines, attachmentNames, forcedRefs: part.forcedRefs || []
    }));
  }

  function entriesFromMessageBody({ category, sourceName, subject, body, attachmentNames = [] }) {
    const refs = extractOrderRefs(subject, sourceName, body);
    const returnMode = isReturnText(subject, body);
    if (!returnMode && refs.length > 1) {
      return refs.map(ref => buildExtractedEntry({ category, sourceName, subject, body, attachmentNames, forcedRefs: [ref] }));
    }
    return [buildExtractedEntry({ category, sourceName, subject, body, attachmentNames })];
  }

  async function parsePdfFile(file, category) {
    const parsed = await pdfTextAndLines(await file.arrayBuffer());
    const pdf = { name: file.name, ...parsed };
    return entriesFromPdfDocument({ category, sourceName: file.name, subject: file.name, body: '', pdf, attachmentNames: [file.name] });
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
        console.warn('[V41] PDF melléklet hiba', attachmentName, error);
      }
    }
    if (!pdfs.length) return entriesFromMessageBody({ category, sourceName: file.name, subject, body, attachmentNames: names });

    const classified = pdfs.map(pdf => ({ pdf, info: classifyPdfDocument(pdf) }));
    const primary = classified.filter(item => item.info.primary);
    const candidates = primary.length
      ? primary
      : classified.filter(item => !item.info.confirmation && item.info.refs.length);
    if (!candidates.length) return entriesFromMessageBody({ category, sourceName: file.name, subject, body, attachmentNames: names });

    const selected = [];
    const seenRefs = new Set();
    for (const item of candidates) {
      const refKey = item.info.refs.map(ref => ref.full).sort().join('|');
      if (refKey && [...item.info.refs].every(ref => seenRefs.has(ref.full))) continue;
      item.info.refs.forEach(ref => seenRefs.add(ref.full));
      selected.push(item.pdf);
    }
    return selected.flatMap(pdf => entriesFromPdfDocument({ category, sourceName: file.name, subject, body, pdf, attachmentNames: names }));
  }

  async function parseDroppedFile(file, category) {
    if (/\.pdf$/i.test(file.name)) return parsePdfFile(file, category);
    if (/\.msg$/i.test(file.name)) return parseMsgFile(file, category);
    throw new Error('Csak .msg vagy teszteléshez .pdf fájl fogadható.');
  }

  function statusText(entry) {
    if (entry.existingOrderNos?.length) return 'Újraimportálás – meglévő frissítése';
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

  function emptyPreviewText(category) {
    return `<div class="v41-empty-preview">Még nincs ${category === 'martin' ? 'Martin / Platós' : 'Dobozos'} rendelés feldolgozva.</div>`;
  }

  function renderPending() {
    if (typeof document === 'undefined') return;
    const boxContainer = document.getElementById('v41BoxPreview');
    const martinContainer = document.getElementById('v41MartinPreview');
    const summary = document.getElementById('v38ImportSummary');
    const commit = document.getElementById('v38CommitImport');
    const boxEntries = pending.filter(entry => entry.category === 'dobozos');
    const martinEntries = pending.filter(entry => entry.category === 'martin');
    if (boxContainer) boxContainer.innerHTML = boxEntries.length ? boxEntries.map(entryCard).join('') : emptyPreviewText('dobozos');
    if (martinContainer) martinContainer.innerHTML = martinEntries.length ? martinEntries.map(entryCard).join('') : emptyPreviewText('martin');
    const approved = pending.filter(entry => entry.approved).length;
    const warnings = pending.filter(entry => entry.warnings.length).length;
    const reimports = pending.filter(entry => entry.existingOrderNos?.length).length;
    if (summary) summary.textContent = `${pending.length} rendelés az előnézetben · Dobozos: ${boxEntries.length} · Martin / Platós: ${martinEntries.length} · Jóváhagyva: ${approved} · Ellenőrzendő: ${warnings}${reimports ? ` · Újraimportálás: ${reimports}` : ''}`;
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
        if (input.dataset.field === 'scheduleDate') entry.scheduleDateManual = true;
        entry.sourceOrderNos = orderNumbersOf(entry.orderNo);
        entry.existingOrderNos = duplicateOrderNumbers(entry.sourceOrderNos);
        entry.duplicate = false;
        entry.warnings = entry.warnings.filter(warning => !/Rendelésszám|Felrakó|Projekt címe|Lerakó\/projekt|már szerepel|duplik/i.test(warning));
        if (!entry.orderNo) entry.warnings.push('Rendelésszám nem található');
        if (!entry.pickupName) entry.warnings.push('Felrakó nem azonosítható');
        if (!entry.pickupAddress) entry.warnings.push('Felrakó címe hiányzik');
        if (!entry.projectName) entry.warnings.push('Lerakó/projekt nem azonosítható');
        if (!entry.dropAddress) entry.warnings.push('Projekt címe hiányzik a törzsadatból');
        renderPending();
      }));
    });
  }

  function setDropStatus(category, text, kind = '') {
    if (typeof document === 'undefined') return;
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
        console.error('[V41] Outlook import hiba', file.name, error);
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

  function findMarioVehicle() {
    return (typeof activeVehicles === 'function' ? activeVehicles() : state.vehicles || []).find(vehicle => nrm(vehicle.driverName).includes('mario'))
      || (state.vehicles || []).find(vehicle => nrm(vehicle.driverName).includes('mario'))
      || (typeof activeVehicles === 'function' ? activeVehicles()[0] : (state.vehicles || []).find(vehicle => vehicle.active !== false));
  }

  function masterIdsForEntry(entry) {
    const supplier = (state.suppliers || []).find(item => nrm(item.name) === nrm(entry.pickupName) && (!entry.pickupAddress || nrm(item.address) === nrm(entry.pickupAddress)))
      || (state.suppliers || []).find(item => nrm(item.address) === nrm(entry.pickupAddress));
    const exactProjects = (state.projects || []).filter(item => nrm(item.name) === nrm(entry.projectName));
    let project = (state.projects || []).find(item => entry.projectId && item.id === entry.projectId)
      || exactProjects.find(item => String(item.address || '').trim())
      || exactProjects[0]
      || (state.projects || []).find(item => entry.dropAddress && nrm(item.address) === nrm(entry.dropAddress));
    if (entry.orderType === 'KRPR' && (!project?.address || !entry.dropAddress)) {
      project = projectWithAddressFromMaster(project || { id: entry.projectId || '', name: entry.projectName || '' }, `${entry.sourcePdfText || ''}
${entry.sourceBody || ''}
${entry.subject || ''}`) || project;
    }
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
    if (entry.orderType === 'KRPR' && project?.address && !entry.dropAddress) {
      entry.projectId = project.id || entry.projectId || '';
      entry.projectName = project.name || entry.projectName || '';
      entry.dropAddress = project.address;
      entry.warnings = (entry.warnings || []).filter(warning => !/Lerakó címe|Projekt címe/i.test(warning));
    }
    const martin = findMartinVehicle();
    const mario = findMarioVehicle();
    const isMartin = entry.category === 'martin';
    const recipient = project?.defaultRecipientId ? (state.recipients || []).find(item => item.id === project.defaultRecipientId) : null;
    const sourceNos = entry.sourceOrderNos?.length ? entry.sourceOrderNos : orderNumbersOf(entry);
    return {
      id: id(), scheduleDate: entry.scheduleDate || selectedImportDate() || tomorrowISO(), vehicleId: isMartin ? (martin?.id || '') : (mario?.id || ''), sequence: 999,
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

  function importIdentity(entry) {
    const numbers = (entry.sourceOrderNos?.length ? entry.sourceOrderNos : orderNumbersOf(entry)).map(String).sort();
    return `${entry.isReturn ? 'VISSZARU' : (entry.orderType || 'SR0')}|${numbers.join(',') || entry._id}`;
  }

  function commitImport() {
    const approved = pending.filter(entry => entry.approved);
    if (!approved.length) return alert('Nincs jóváhagyott rendelés.');

    const latestByIdentity = new Map();
    approved.forEach(entry => latestByIdentity.set(importIdentity(entry), entry));
    const selected = [...latestByIdentity.values()];
    const acceptedEntries = [], skipped = [];
    for (const entry of selected) {
      const numbers = entry.sourceOrderNos?.length ? entry.sourceOrderNos : orderNumbersOf(entry);
      if (!numbers.length || !entry.pickupName || !entry.projectName) {
        skipped.push(`${entry.sourceName}: hiányzó kötelező adat`);
        continue;
      }
      entry.sourceOrderNos = numbers;
      entry.scheduleDate = entry.scheduleDate || selectedImportDate() || tomorrowISO();
      acceptedEntries.push(entry);
    }
    if (!acceptedEntries.length) return alert(`Nem került be rendelés.\n${skipped.join('\n')}`);

    const replaceIds = new Set();
    for (const entry of acceptedEntries) {
      matchingOutlookOrders(entry.sourceOrderNos, entry.orderType, entry.isReturn).forEach(order => replaceIds.add(order.id));
    }
    const replacementCount = replaceIds.size;
    if (replaceIds.size) {
      state.orders = (state.orders || []).filter(order => !replaceIds.has(order.id));
      state.backlog = (state.backlog || []).filter(record => !replaceIds.has(record.sourceOrderId) && !replaceIds.has(record.targetOrderId));
      state.resolvedBacklog = (state.resolvedBacklog || []).filter(record => !replaceIds.has(record.sourceOrderId) && !replaceIds.has(record.targetOrderId));
    }

    const accepted = acceptedEntries.map(entryToOrder);
    state.orders = state.orders || [];
    state.orders.push(...accepted);
    state.routePlans = state.routePlans || {};
    for (const order of accepted) state.routePlans[order.scheduleDate] = {};
    if (typeof save === 'function') save(false);

    const acceptedIds = new Set(acceptedEntries.map(entry => entry._id));
    pending = pending.filter(entry => !acceptedIds.has(entry._id));
    renderPending();

    const firstDate = accepted[0]?.scheduleDate || tomorrowISO();
    const workDate = typeof document !== 'undefined' ? document.getElementById('workDate') : null;
    const driverDate = typeof document !== 'undefined' ? document.getElementById('driverDate') : null;
    if (workDate) workDate.value = firstDate;
    if (driverDate) driverDate.value = firstDate;
    if (typeof showPage === 'function') showPage('planner');
    if (typeof render === 'function') render();
    else {
      if (typeof renderRoutes === 'function') renderRoutes();
      if (typeof renderOrders === 'function') renderOrders();
    }

    const martinCount = accepted.filter(order => order.importVehicleCategory === 'martin').length;
    const boxCount = accepted.filter(order => order.importVehicleCategory === 'dobozos').length;
    alert(`${accepted.length} Outlook-rendelés importálva a(z) ${firstDate} napra. Martin / Platós: ${martinCount}, Dobozos: ${boxCount}.${replacementCount ? `\nFrissített korábbi Outlook-import: ${replacementCount}` : ''}${skipped.length ? `\nKihagyva: ${skipped.length}` : ''}\nA Dobozos fuvarok ideiglenesen Máriónál látszanak, a „Fuvar szétosztása” gomb újraosztja őket.`);
  }

  function clearPreview() {
    if (pending.length && !confirm('Törlöd az Outlook-import teljes előnézetét?')) return;
    pending = [];
    renderPending();
    setDropStatus('dobozos', 'Még nincs fájl.');
    setDropStatus('martin', 'Még nincs fájl.');
  }

  function clearAllImports() {
    const imported = (state.orders || []).filter(order => order.outlookImport);
    const message = `Törlöd az összes Outlook-importot?\n\nElőnézet: ${pending.length} rendelés\nKorábban jóváhagyott, autóknál látható import: ${imported.length} fuvar\n\nA kézzel rögzített és Excelből importált fuvarok megmaradnak.`;
    if (!confirm(message)) return;
    const ids = new Set(imported.map(order => order.id));
    pending = [];
    state.orders = (state.orders || []).filter(order => !ids.has(order.id));
    state.backlog = (state.backlog || []).filter(record => !ids.has(record.sourceOrderId) && !ids.has(record.targetOrderId));
    state.resolvedBacklog = (state.resolvedBacklog || []).filter(record => !ids.has(record.sourceOrderId) && !ids.has(record.targetOrderId));
    state.failedTrips = (state.failedTrips || []).filter(record => !ids.has(record.orderId));
    state.routePlans = {};
    state.routeStats = {};
    delete state.outlookImportHistory;
    delete state.outlookImportCache;
    delete state.outlookRecognizedOrders;
    if (typeof save === 'function') save(false);
    renderPending();
    setDropStatus('dobozos', 'Még nincs fájl.');
    setDropStatus('martin', 'Még nincs fájl.');
    if (typeof render === 'function') render();
    alert(`${imported.length} korábbi Outlook-import és a teljes előnézet törölve.`);
  }

  function bindDropZone(zoneId, inputId, category) {
    const zone = document.getElementById(zoneId), input = document.getElementById(inputId);
    if (!zone || !input) return;
    ['dragenter', 'dragover'].forEach(type => zone.addEventListener(type, event => { event.preventDefault(); zone.classList.add('dragover'); }));
    ['dragleave', 'drop'].forEach(type => zone.addEventListener(type, event => { event.preventDefault(); zone.classList.remove('dragover'); }));
    zone.addEventListener('drop', event => processFiles(event.dataTransfer.files, category));
    input.addEventListener('change', event => { processFiles(event.target.files, category); input.value = ''; });
  }

  function migrateV41MasterData() {
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

  function bindV41() {
    migrateV41MasterData();
    installBacklogPatch();
    const dateInput = document.getElementById('v38ImportDate');
    if (dateInput && !dateInput.value) dateInput.value = tomorrowISO();
    dateInput?.addEventListener('change', () => {
      const date = dateInput.value || tomorrowISO();
      pending.forEach(entry => { if (!entry.scheduleDateManual) entry.scheduleDate = date; });
      renderPending();
    });
    bindDropZone('v38BoxDrop', 'v38BoxInput', 'dobozos');
    bindDropZone('v38MartinDrop', 'v38MartinInput', 'martin');
    document.getElementById('v38ClearPreview')?.addEventListener('click', clearPreview);
    document.getElementById('v41ClearAllImports')?.addEventListener('click', clearAllImports);
    document.getElementById('v38CommitImport')?.addEventListener('click', commitImport);
    renderPending();
    global.FUVARSZERVEZO_VERSION = VERSION;
    const previousDiagnostics = global.getFuvarszervezoDiagnostics;
    global.getFuvarszervezoDiagnostics = () => ({ ...(typeof previousDiagnostics === 'function' ? previousDiagnostics() : {}), version: VERSION, outlookImport: true, outlookImportCategories: ['Dobozos', 'Martin / Platós'], outlookOrderNoRule: 'csak a / utáni rész', outlookPdfAttachments: true, outlookMsgReader: 'beépített helyi CFB parser', krprRule: true, prprRule: true, returnRule: true, autoSupplierMaster: true, itemLevelBacklog: true });
  }

  const V41_API = {
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
    projectWithAddressFromMaster,
    buildExtractedEntry,
    entryToOrder,
    ensureSupplierMaster,
    migrateV41MasterData,
    syncBacklogItemState,
    parseDroppedFile,
    processFiles,
    commitImport,
    clearPreview,
    clearAllImports,
    classifyPdfDocument,
    splitPdfDocumentByOrders,
    projectFromPdfMaster,
    projectMasterByIdentity,
    matchingOutlookOrders,
    tomorrowISO,
    getPending: () => pending.slice(),
    setPending: value => { pending = Array.isArray(value) ? value : []; if (typeof document !== 'undefined') renderPending(); }
  };
  global.V41OutlookImport = V41_API;
  global.V40OutlookImport = V41_API;

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bindV41, { once: true });
    else bindV41();
  }
})(typeof window !== 'undefined' ? window : globalThis);
