/* Fuvarszervező V38
   Outlook (.msg) + PDF rendelésimport.

   - Két külön tömeges import: Dobozos és Martin / Platós.
   - A levél tárgya/törzse és minden PDF melléklet együtt kerül elemzésre.
   - A rendelésazonosító mindig a perjel utáni rész (pl. 2026-SR0/004911 -> 004911).
   - A felrakó és projekt címét elsősorban a törzsadat adja; a PDF vevői címe nem írja felül a projektcímet.
   - Az import teljesen helyben, a böngészőben történik.
*/
(function (global) {
  'use strict';

  const VERSION = '38';
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
  const id = () => typeof uid === 'function' ? uid() : `v38-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const selectedImportDate = () => ((typeof document !== 'undefined' ? document.getElementById('v38ImportDate')?.value : '') || (typeof selectedDate === 'function' ? selectedDate() : new Date().toISOString().slice(0, 10)));
  const cleanText = value => String(value || '').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/\r/g, '').replace(/[ \t]+/g, ' ').replace(/\n\s*\n\s*\n+/g, '\n\n').trim();
  const unique = values => [...new Set(values.filter(Boolean))];
  const significantTokens = (value, noise = LEGAL_WORDS) => nrm(value).split(' ').filter(token => token.length >= 3 && !noise.has(token) && !/^\d+$/.test(token));

  function extractOrderNo(...sources) {
    const text = sources.filter(Boolean).join('\n');
    const slash = [...text.matchAll(/\/\s*([0-9]{4,12})(?=\D|$)/g)].map(match => match[1]);
    if (slash.length) return slash[slash.length - 1];
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
    if (normalized.includes('larex')) {
      return { name: 'Larex Trade Kft', address: '1108 Budapest, Maglódi utca 123', reason: 'PDF: Larex' };
    }
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
    const special = supplierSpecial(sourceText);
    if (special) {
      const master = (typeof state !== 'undefined' ? state.suppliers || [] : []).find(supplier => {
        const combined = nrm(`${supplier.name || ''} ${supplier.address || ''} ${supplier.site || ''}`);
        return special.name.startsWith('Szatmári') ? combined.includes('kesmark') : special.name.startsWith('Fogarasi') ? combined.includes('hunyadi') : combined.includes('larex');
      });
      return { ...special, id: master?.id || '', pickupNote: master?.pickupNote || master?.note || '' };
    }
    const sourceNorm = nrm(sourceText);
    const candidates = (typeof state !== 'undefined' ? state.suppliers || [] : []).map(supplier => ({ supplier, score: supplierScore(supplier, sourceNorm) })).sort((a, b) => b.score - a.score);
    if (!candidates.length || candidates[0].score < 10) return null;
    const winner = candidates[0].supplier;
    return { id: winner.id || '', name: winner.name || '', address: winner.address || '', pickupNote: winner.pickupNote || winner.note || '', reason: `törzsadat-egyezés (${candidates[0].score})` };
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
      if (!line || /egys[eé]g[aá]r|engedm[eé]ny|nett[oó]|[oö]sszesen/i.test(line)) continue;
      let match = line.match(/^\s*(\d+)\s*\.\s*([A-Z0-9._\/-]+)\s+(.+?)\s+(\d+(?:[.,]\d+)?)\s*(m2|m²|m3|m³|fm|m|db|kg|csomag|tekercs|klt|p[aá]r)\b/i);
      if (!match) match = line.match(/^\s*(\d+)\s+([A-Z0-9._\/-]{3,})\s+(.+?)\s+(\d+(?:[.,]\d+)?)\s*(m2|m²|m3|m³|fm|m|db|kg|csomag|tekercs|klt|p[aá]r)\b/i);
      if (!match) continue;
      const [, , code, name, qty, unit] = match;
      if (/^huf$/i.test(code) || name.length < 3) continue;
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
    const orderNo = extractOrderNo(pdfText, pdfName, subject, sourceName, body);
    const hint = inferProjectHint(pdfName, subject, sourceName, pdfText);
    const supplier = bestSupplier(combined);
    const project = bestProject(combined, hint);
    const items = parsePdfItemsFromLines(pdfLines);
    const warnings = [];
    if (!orderNo) warnings.push('Rendelésszám nem található');
    if (!supplier?.name) warnings.push('Felrakó nem azonosítható');
    if (!supplier?.address) warnings.push('Felrakó címe hiányzik');
    if (!project?.name) warnings.push('Lerakó/projekt nem azonosítható');
    if (!project?.address) warnings.push('Projekt címe hiányzik a törzsadatból');
    if (!items.length) warnings.push('Tételek nem olvashatók automatikusan');
    const duplicate = !!orderNo && typeof state !== 'undefined' && (state.orders || []).some(order => String(order.orderNo || '') === String(orderNo));
    if (duplicate) warnings.push('Ez a rendelésszám már szerepel a programban');
    return {
      _id: id(), approved: !duplicate, category, sourceName, subject: subject || '', pdfName, attachmentNames,
      scheduleDate: selectedImportDate(), orderNo, pickupName: supplier?.name || '', pickupAddress: supplier?.address || '', supplierId: supplier?.id || '', pickupNote: supplier?.pickupNote || '',
      projectName: project?.name || hint || '', projectId: project?.id || '', dropAddress: project?.address || '',
      ...recipientFromProject(project), items, warnings, duplicate,
      extractionReason: unique([supplier?.reason, project?.reason]).join(' · '),
      sourceBody: body || '', sourcePdfText: pdfText || ''
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
        console.warn('[V38] PDF melléklet hiba', attachmentName, error);
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
      <div class="v38-source"><b>${htmlEsc(entry.sourceName)}</b>${entry.pdfName && entry.pdfName !== entry.sourceName ? `<span>PDF: ${htmlEsc(entry.pdfName)}</span>` : ''}<span class="v38-status ${entry.warnings.length ? 'warn' : 'ok'}">${htmlEsc(statusText(entry))}</span></div>
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
        entry.duplicate = !!entry.orderNo && (state.orders || []).some(order => String(order.orderNo || '') === String(entry.orderNo));
        entry.warnings = entry.warnings.filter(warning => !/Rendelésszám|Felrakó|Projekt címe|Lerakó\/projekt|már szerepel/.test(warning));
        if (!entry.orderNo) entry.warnings.push('Rendelésszám nem található');
        if (!entry.pickupName) entry.warnings.push('Felrakó nem azonosítható');
        if (!entry.pickupAddress) entry.warnings.push('Felrakó címe hiányzik');
        if (!entry.projectName) entry.warnings.push('Lerakó/projekt nem azonosítható');
        if (!entry.dropAddress) entry.warnings.push('Projekt címe hiányzik a törzsadatból');
        if (entry.duplicate) { entry.warnings.push('Ez a rendelésszám már szerepel a programban'); entry.approved = false; }
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
        console.error('[V38] Outlook import hiba', file.name, error);
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

  function entryToOrder(entry) {
    const { supplier, project } = masterIdsForEntry(entry);
    const martin = findMartinVehicle();
    const isMartin = entry.category === 'martin';
    const recipient = project?.defaultRecipientId ? (state.recipients || []).find(item => item.id === project.defaultRecipientId) : null;
    return {
      id: id(), scheduleDate: entry.scheduleDate || selectedImportDate(), vehicleId: isMartin ? (martin?.id || '') : '', sequence: 999,
      orderNo: entry.orderNo, topicName: entry.projectName, pickupName: entry.pickupName, pickupAddress: entry.pickupAddress, pickupNote: supplier?.pickupNote || supplier?.note || entry.pickupNote || '', supplierId: supplier?.id || entry.supplierId || '',
      projectName: entry.projectName, projectId: project?.id || entry.projectId || '', dropAddress: entry.dropAddress,
      recipientId: recipient?.id || entry.recipientId || '', recipientName: recipient?.name || entry.recipientName || '', recipientPhone: recipient?.phone || entry.recipientPhone || '', recipientEmail: recipient?.email || entry.recipientEmail || '',
      requestedDeadline: '', note: `Outlook import · ${entry.sourceName}${entry.pdfName ? ` · ${entry.pdfName}` : ''}`,
      items: (entry.items || []).map(item => ({ ...item, received: false })),
      longMaterialReason: isMartin ? ((entry.items || []).find(item => item.longMaterial)?.name || 'Martin / Platós Outlook import') : '',
      markedMartin: isMartin, importVehicleCategory: isMartin ? 'martin' : 'dobozos', importAutoRaw: isMartin ? 'Martin' : 'Dobozos', importVehicleLocked: isMartin,
      outlookImport: true, outlookSourceFile: entry.sourceName, outlookPdfFile: entry.pdfName || '', outlookImportedAt: new Date().toISOString(), completed: false
    };
  }

  function commitImport() {
    const approved = pending.filter(entry => entry.approved);
    if (!approved.length) return alert('Nincs jóváhagyott rendelés.');
    const existing = new Set((state.orders || []).map(order => String(order.orderNo || '')));
    const withinBatch = new Set();
    const accepted = [], skipped = [];
    for (const entry of approved) {
      if (!entry.orderNo || !entry.pickupName || !entry.projectName) { skipped.push(`${entry.sourceName}: hiányzó kötelező adat`); continue; }
      if (existing.has(String(entry.orderNo)) || withinBatch.has(String(entry.orderNo))) { skipped.push(`${entry.orderNo}: már létezik`); continue; }
      withinBatch.add(String(entry.orderNo));
      accepted.push(entryToOrder(entry));
    }
    if (!accepted.length) return alert(`Nem került be rendelés.\n${skipped.join('\n')}`);
    state.orders.push(...accepted);
    state.routePlans = state.routePlans || {};
    for (const order of accepted) state.routePlans[order.scheduleDate] = {};
    if (typeof save === 'function') save();
    pending = pending.filter(entry => !approved.includes(entry) || skipped.some(text => text.startsWith(entry.orderNo || entry.sourceName)));
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

  function bindV38() {
    const dateInput = document.getElementById('v38ImportDate');
    if (dateInput && !dateInput.value) dateInput.value = typeof selectedDate === 'function' ? selectedDate() : new Date().toISOString().slice(0, 10);
    bindDropZone('v38BoxDrop', 'v38BoxInput', 'dobozos');
    bindDropZone('v38MartinDrop', 'v38MartinInput', 'martin');
    document.getElementById('v38ClearPreview')?.addEventListener('click', () => { if (!pending.length || confirm('Törlöd az Outlook-import teljes előnézetét?')) { pending = []; renderPending(); } });
    document.getElementById('v38CommitImport')?.addEventListener('click', commitImport);
    renderPending();
    global.FUVARSZERVEZO_VERSION = VERSION;
    const previousDiagnostics = global.getFuvarszervezoDiagnostics;
    global.getFuvarszervezoDiagnostics = () => ({ ...(typeof previousDiagnostics === 'function' ? previousDiagnostics() : {}), version: VERSION, outlookImport: true, outlookImportCategories: ['Dobozos', 'Martin / Platós'], outlookOrderNoRule: 'csak a / utáni rész', outlookPdfAttachments: true });
  }

  global.V38OutlookImport = {
    version: VERSION,
    extractOrderNo,
    inferProjectHint,
    supplierSpecial,
    parsePdfItemsFromLines,
    bestSupplier,
    bestProject,
    buildExtractedEntry,
    entryToOrder,
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
