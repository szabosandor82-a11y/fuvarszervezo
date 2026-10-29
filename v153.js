/* ===== FUVARSZERVEZŐ V153 – EGY RENDELÉS TÖBB HELYEN =======================
   Egy rendelés egyszerre szerepelhet több napon, több sofőrnél, a hátralékban
   és a függő rendelések között. A pipák továbbadását (ugyanazon a napon
   bepipálódik, a későbbi helyeken levonódik) a szerver végzi
   (SUPABASE_V153.sql). Ez a fájl:
     - megmutatja, hol szerepel még ugyanaz a rendelés (függő rendelés kártyája,
       „Függő rendelésbe” ablak), és rákérdez importnál, „Megjött → fuvarok
       közé”-nél, ha máshol is szerepel;
     - a teljesített (zöld) buborékra kiírja a teljesítés idejét.
   A rendeléseket a teljes bizonylatszám (pl. 2026-SR0/007329) köti össze,
   ennek hiányában a rendelésszám a fuvar típusával – ugyanúgy, mint a
   szerveren. */
(function (global) {
  'use strict';
  const esc = v => String(v ?? '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
  const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const todayISO = () => iso(new Date());
  const fmt = v => { const m = String(v || '').match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${m[1]}.${m[2]}.${m[3]}.` : '—'; };
  const st = () => (typeof state !== 'undefined' ? state : (global.state || {}));

  function refsV153(o) {
    if (!o || typeof o !== 'object') return [];
    const pre = o.isReturn ? 'R:' : '';
    const typ = (String(o.orderType || '').trim().toUpperCase()) || 'SR0';
    const out = [];
    for (const r of Array.isArray(o.fullOrderRefs) ? o.fullOrderRefs : []) {
      const m = String(r).trim().toUpperCase().match(/^\d{4}-([A-Z0-9]+)\/0*(\d+)$/);
      if (m) out.push(`${pre}${m[1]}/${m[2]}`);
    }
    if (!out.length) {
      for (const r of [...(Array.isArray(o.sourceOrderNos) ? o.sourceOrderNos : []), o.orderNo || '']) {
        for (const m of String(r).matchAll(/0*(\d+)/g)) out.push(`${pre}${typ}/${m[1]}`);
      }
    }
    return [...new Set(out)].filter(x => !/\/0*$/.test(x));
  }
  const overlap = (a, b) => a.some(x => b.includes(x));
  function driverName(vehicleId) {
    const v = (st().vehicles || []).find(x => String(x.id) === String(vehicleId));
    return v ? (v.driverName || v.name || '') : '';
  }

  /* Hol szerepel még? A kizárt fuvarok (pl. maga a rendelés, vagy az import
     által frissített régi példány) nem számítanak. */
  function placesV153(order, { excludeOrderIds = [] } = {}) {
    const refs = refsV153(order);
    if (!refs.length) return [];
    const skip = new Set([String(order?.id || ''), ...excludeOrderIds.map(String)]);
    const horizon = (() => { const d = new Date(); d.setDate(d.getDate() - 14); return iso(d); })();
    const out = [];
    for (const o of st().orders || []) {
      if (skip.has(String(o.id))) continue;
      if (String(o.scheduleDate || '') < horizon) continue;
      if (!overlap(refsV153(o), refs)) continue;
      const nev = driverName(o.vehicleId);
      out.push({ kind: 'order', sort: String(o.scheduleDate || ''), text: `${fmt(o.scheduleDate)}${nev ? ` · ${nev}` : ''}${o.completed ? ' · teljesítve' : ''}` });
    }
    for (const rec of st().pendingOrdersV151 || []) {
      if ((rec.status || 'open') !== 'open') continue;
      if (rec.order && skip.has(String(rec.order.id))) continue;
      if (!overlap(refsV153(rec.order || { orderNo: rec.orderNo }), refs)) continue;
      out.push({ kind: 'pending', sort: `9-${rec.followupDate || ''}`, text: `Függő rendelések (rákérdezés: ${fmt(rec.followupDate)})` });
    }
    let undated = 0;
    for (const b of st().backlog || []) {
      if (!b.undatedV139 || b.targetOrderId) continue;
      if (!overlap(refsV153(b.orderHeaderV139 || { orderNo: b.orderNo }), refs)) continue;
      undated += 1;
    }
    if (undated) out.push({ kind: 'backlog', sort: '9-z', text: `Hátralék – dátum nélkül (${undated} tétel)` });
    return out.sort((a, b) => a.sort.localeCompare(b.sort));
  }

  function placesHtmlV153(order, opts = {}) {
    const list = placesV153(order, opts);
    if (!list.length) return '';
    return `<div class="v153-places"><b>${esc(opts.title || 'Már szerepel')}:</b> ${list.map(p => `<span class="v153-place v153-${p.kind}">${esc(p.text)}</span>`).join(' ')}</div>`;
  }

  function confirmPlacesV153(order, message, opts = {}) {
    const list = placesV153(order, opts);
    if (!list.length) return true;
    if (typeof global.confirm !== 'function') return true;
    return global.confirm(`${message}\n\nEz a rendelés máshol is szerepel:\n${list.map(p => `• ${p.text}`).join('\n')}\n\nFolytatod?`);
  }

  /* Outlook-import: a jóváhagyott rendelések közül melyik szerepel már máshol.
     Az ugyanarra a napra, ugyanahhoz a felrakóhoz (több sofőrnél: ugyanahhoz a
     sofőrhöz) tartozó példány frissül – ezt külön kiírjuk. */
  function importConfirmV153(entries, replaceIds) {
    const replaced = new Set([...(replaceIds || [])].map(String));
    const lines = [];
    for (const entry of entries || []) {
      const label = (entry.fullOrderRefs || [])[0] || entry.orderNo || (entry.sourceOrderNos || []).join(', ');
      const updated = (st().orders || []).filter(o => replaced.has(String(o.id)) && overlap(refsV153(o), refsV153(entry)));
      const others = placesV153(entry, { excludeOrderIds: [...replaced] });
      if (!others.length) continue;
      const parts = others.map(p => p.text);
      lines.push(`• ${label} → ${fmt(entry.scheduleDate)}\n   már szerepel: ${parts.join(' · ')}${updated.length ? `\n   frissül: ${updated.map(o => `${fmt(o.scheduleDate)} · ${driverName(o.vehicleId)}`).join(' · ')}` : ''}`);
    }
    if (!lines.length || typeof global.confirm !== 'function') return true;
    return global.confirm(`Ezek a rendelések máshol is szerepelnek. Ugyanarra a napra és felrakóhoz a meglévő frissül, máshol új példány kerül be (a régiek megmaradnak).\n\n${lines.join('\n')}\n\nBeimportálod?`);
  }

  /* ---------- a teljesített buborékon a teljesítés ideje ---------- */
  function doneTime(order) {
    const raw = order?.completedAtV111 || order?.completedAt || '';
    const d = raw ? new Date(raw) : null;
    if (!d || isNaN(d)) return '';
    return `${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}. ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }
  function decorate(root) {
    if (!root?.querySelectorAll) return;
    root.querySelectorAll('article.bubble[data-id], .mobile-user-row[data-id]').forEach(el => {
      const order = (st().orders || []).find(o => String(o.id) === String(el.dataset.id));
      const mark = el.querySelector(':scope > .v153-done-at');
      const text = order?.completed ? doneTime(order) : '';
      if (!text) { mark?.remove(); return; }
      const label = `✓ Teljesítve: ${text}`;
      if (mark) { if (mark.textContent !== label) mark.textContent = label; return; }
      const small = document.createElement('small');
      small.className = 'v153-done-at';
      small.textContent = label;
      el.appendChild(small);
    });
  }
  let pending = false;
  function schedule() {
    if (pending) return; pending = true;
    (global.requestAnimationFrame || (fn => setTimeout(fn, 16)))(() => { pending = false; decorate(document); });
  }

  function injectCss() {
    if (document.getElementById('v153Css')) return;
    const css = document.createElement('style');
    css.id = 'v153Css';
    css.textContent = `
      .v153-places{margin:6px 0;font-size:.86em;line-height:1.5}
      .v153-place{display:inline-block;margin:2px 4px 2px 0;padding:1px 8px;border-radius:999px;background:rgba(37,99,235,.12);color:inherit}
      .v153-place.v153-pending{background:rgba(234,179,8,.18)}
      .v153-place.v153-backlog{background:rgba(220,38,38,.12)}
      .v153-covered{margin:6px 0;padding:6px 10px;border-radius:8px;background:rgba(22,163,74,.14);font-weight:600}
      .v153-done-at{display:block;margin-top:4px;font-size:.8em;font-weight:600;color:#15803d}
      .v153-via{color:#15803d}
      .v153-ded{color:#b45309}
      .v153-tag{display:inline-block;padding:0 6px;border-radius:6px;background:rgba(22,163,74,.16);font-weight:600}`;
    document.head.appendChild(css);
  }

  function install() {
    if (typeof document === 'undefined') return;
    injectCss();
    decorate(document);
    try {
      new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
    } catch (_) {}
  }

  global.v153Refs = refsV153;
  global.v153Places = placesV153;
  global.v153PlacesHtml = placesHtmlV153;
  global.v153ConfirmPlaces = confirmPlacesV153;
  global.v153ImportConfirm = importConfirmV153;
  global.v153DecorateDone = decorate;
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install);
    else install();
  }
})(typeof window !== 'undefined' ? window : globalThis);
