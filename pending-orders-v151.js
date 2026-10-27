/* ===== FUVARSZERVEZŐ V151 – FÜGGŐ RENDELÉSEK ===============================
   A még vissza nem igazolt rendelések „előszobája”. Amíg itt vannak:
     - NEM a fuvarok között vannak (state.orders) – így egyik sofőr sem látja,
       és nem kerülnek az exportba, a kimutatásba, a szétosztásba, a naptárba;
     - a szerveren a pending_orders táblában tárolódnak (csak admin olvassa);
     - a rákérdezés napján: piros szám a menüben, belépéskor figyelmeztetés,
       reggel 8:00-kor push-értesítés (szerveroldali időzítő).
   Ha megjött: „Megjött → fuvarok közé” (nap + sofőr) – egy gombnyomással fuvar.
   Ha nem: „Nem jött meg → új dátum” – a rákérdezés naplózódik. */
(function (global) {
  'use strict';
  const PAGE = 'pendingOrders';
  const list = () => (state.pendingOrdersV151 = Array.isArray(state.pendingOrdersV151) ? state.pendingOrdersV151 : []);
  const open = () => list().filter(rec => (rec.status || 'open') === 'open');
  /* saját segédfüggvények – nem az app.js állandóira építünk */
  const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const todayISO = () => iso(new Date());
  const workdayAfter = n => {
    if (typeof global.shiftWorkday === 'function') return global.shiftWorkday(todayISO(), n);
    const d = new Date(); let left = n;
    while (left > 0) { d.setDate(d.getDate() + 1); if (d.getDay() !== 0 && d.getDay() !== 6) left--; }
    return iso(d);
  };
  const uid = () => (global.crypto?.randomUUID ? global.crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const esc = v => String(v ?? '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
  const me = () => String(global.V44Online?.getProfile?.()?.email || '').toLowerCase();
  const isAdmin = () => document.body.classList.contains('mode-admin') || global.V44Online?.getProfile?.()?.role === 'admin';
  const labelOf = rec => {
    const no = String(rec.orderNo || rec.order?.orderNo || '').trim();
    const full = rec.order && global.orderLabelV145 ? global.orderLabelV145(rec.order) : '';
    return full || no || 'Rendelésszám nélkül';
  };
  const fmt = iso => { const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${m[1]}.${m[2]}.${m[3]}.` : '—'; };
  const dueCount = () => open().filter(rec => rec.followupDate && rec.followupDate <= todayISO()).length;

  /* ---------- szerver ---------- */
  async function pushToServer(rec) {
    try { await global.V44Online?.savePendingOrderV151?.(rec); }
    catch (error) { console.warn('[V151] függő rendelés mentése a szerverre', error); }
  }
  async function loadFromServer() {
    if (!isAdmin() || !global.V44Online?.fetchPendingOrdersV151) return;
    try {
      const remote = await global.V44Online.fetchPendingOrdersV151();
      const local = new Map(list().map(rec => [String(rec.id), rec]));
      for (const rec of remote) {
        const mine = local.get(String(rec.id));
        if (!mine || String(rec.updatedAt || '') >= String(mine.updatedAt || '')) local.set(String(rec.id), rec);
      }
      /* ami helyben nyitott, de a szerveren nincs nyitottként (máshol lezárták) –
         csak akkor maradjon, ha még fel sem jutott (helyben újabb) */
      const remoteIds = new Set(remote.map(rec => String(rec.id)));
      state.pendingOrdersV151 = [...local.values()].filter(rec => remoteIds.has(String(rec.id)) || !rec.syncedV151 || (rec.status || 'open') !== 'open');
      for (const rec of state.pendingOrdersV151) if (!remoteIds.has(String(rec.id)) && !rec.syncedV151 && (rec.status || 'open') === 'open') { rec.syncedV151 = true; pushToServer(rec); }
      save(false); refresh();
    } catch (error) { console.warn('[V151] függő rendelések betöltése', error); }
  }
  function touch(rec) {
    rec.updatedAt = new Date().toISOString(); rec.updatedBy = me(); rec.syncedV151 = true;
    save(false); pushToServer(rec); refresh();
  }

  /* ---------- menü, jelvény, figyelmeztetés ---------- */
  function badge() {
    const btn = document.querySelector('.nav[data-page="' + PAGE + '"]');
    if (!btn) return;
    let b = btn.querySelector('.v151-badge');
    const n = dueCount();
    if (!n) { b?.remove(); return; }
    if (!b) { b = document.createElement('b'); b.className = 'v151-badge'; btn.appendChild(b); }
    b.textContent = String(n);
    b.title = `${n} függő rendelésre ma kell rákérdezni`;
  }
  function dailyReminder() {
    if (!isAdmin()) return;
    const n = dueCount(); if (!n) return;
    const key = `v151Reminder:${todayISO()}`;
    try { if (localStorage.getItem(key)) return; localStorage.setItem(key, '1'); } catch (_) {}
    let bar = document.getElementById('v151ReminderBar');
    if (!bar) { bar = document.createElement('div'); bar.id = 'v151ReminderBar'; bar.className = 'v151-reminder'; bar.setAttribute('role', 'status'); document.body.appendChild(bar); }
    bar.innerHTML = `<b>🔔 ${n} függő rendelésre ma kell rákérdezni.</b><button type="button" data-open>Megnyitás</button><button type="button" data-x aria-label="Bezárás">✕</button>`;
    bar.querySelector('[data-open]').onclick = () => { bar.remove(); showPage(PAGE); };
    bar.querySelector('[data-x]').onclick = () => bar.remove();
  }

  /* ---------- a lista ---------- */
  function card(rec) {
    const due = rec.followupDate && rec.followupDate <= todayISO();
    const overdue = rec.followupDate && rec.followupDate < todayISO();
    const log = Array.isArray(rec.log) ? rec.log : [];
    const id = esc(rec.id);
    return `<article class="v151-card${due ? ' due' : ''}" data-pending-id="${id}">
      <div class="v151-card-top"><b>${esc(labelOf(rec))}</b><span class="v151-chip${overdue ? ' late' : due ? ' today' : ''}">rákérdezés: ${esc(fmt(rec.followupDate))}${overdue ? ' · lejárt' : due ? ' · ma' : ''}</span></div>
      <div class="v151-route">${esc(rec.supplierName || rec.order?.pickupName || '—')} <span>→</span> ${esc(rec.projectName || rec.order?.projectName || '—')}</div>
      ${rec.note ? `<div class="v151-note">${esc(rec.note)}</div>` : ''}
      ${rec.itemsText ? `<div class="v151-items">${esc(rec.itemsText)}</div>` : ''}
      ${rec.order?.items?.length ? `<div class="v151-items">${rec.order.items.length} tétel a bizonylatról</div>` : ''}
      ${log.length ? `<details class="v151-log"><summary>Előzmények (${log.length})</summary><ul>${log.map(e => `<li><b>${esc(fmt(String(e.at).slice(0, 10)))}</b> ${esc(e.text || '')}${e.by ? ` <small>· ${esc(e.by)}</small>` : ''}</li>`).join('')}</ul></details>` : ''}
      <div class="v151-actions">
        <button type="button" class="v151-primary" onclick="v151Promote('${id}')">Megjött → fuvarok közé</button>
        <button type="button" onclick="v151Retry('${id}')">Nem jött meg → új dátum</button>
        <button type="button" onclick="v151EditPending('${id}')">Szerkesztés</button>
        <button type="button" class="v151-danger" onclick="v151DeletePending('${id}')">Törlés</button>
      </div>
    </article>`;
  }
  function renderPage() {
    const host = document.getElementById('v151PendingList'); if (!host) return;
    const items = open().slice().sort((a, b) => String(a.followupDate || '9999').localeCompare(String(b.followupDate || '9999')));
    const now = items.filter(rec => rec.followupDate && rec.followupDate <= todayISO());
    const later = items.filter(rec => !(rec.followupDate && rec.followupDate <= todayISO()));
    host.innerHTML = !items.length
      ? '<div class="v151-empty">Nincs függő rendelés. Az „+ Új függő rendelés” gombbal, az Outlook-import előnézetéből vagy egy fuvar szerkesztőjéből vehetsz fel.</div>'
      : `${now.length ? `<h3 class="v151-group">Esedékes – ma kell rákérdezni (${now.length})</h3>${now.map(card).join('')}` : ''}${later.length ? `<h3 class="v151-group">Később (${later.length})</h3>${later.map(card).join('')}` : ''}`;
  }
  function refresh() { badge(); renderPage(); }

  /* ---------- ablakok ---------- */
  function dlg(id) {
    let d = document.getElementById(id);
    if (!d) { d = document.createElement('dialog'); d.id = id; d.className = 'v147-dialog'; document.body.appendChild(d); }
    return d;
  }
  function options(listArr, current) {
    return listArr.filter(x => x && x.name && x.active !== false).sort((a, b) => a.name.localeCompare(b.name, 'hu'))
      .map(x => `<option value="${esc(x.name)}" ${x.name === current ? 'selected' : ''}>${esc(x.name)}</option>`).join('');
  }
  function editPending(id = '') {
    const rec = id ? list().find(r => String(r.id) === String(id)) : null;
    const d = dlg('v151PendingEdit');
    const def = rec?.followupDate || workdayAfter(2);
    d.innerHTML = `<form method="dialog" class="v150-form"><h3>${rec ? 'Függő rendelés szerkesztése' : 'Új függő rendelés'}</h3>
      <label>Rendelésszám<input name="orderNo" value="${esc(rec?.orderNo || rec?.order?.orderNo || '')}" placeholder="pl. 1234"></label>
      <label>Beszállító (felrakó)<select name="supplier"><option value="">– válassz –</option>${options(state.suppliers || [], rec?.supplierName || rec?.order?.pickupName)}</select></label>
      <label>Projekt (lerakó)<select name="project"><option value="">– válassz –</option>${options(state.projects || [], rec?.projectName || rec?.order?.projectName)}</select></label>
      <label>Mikor kérdezzek rá?<input type="date" name="date" value="${esc(def)}"></label>
      <label>Teendő / megjegyzés<textarea name="note" rows="2" placeholder="pl. rákérdezni, beérkezett-e a 125-ös cső">${esc(rec?.note || '')}</textarea></label>
      <label>Tételek (nem kötelező)<textarea name="items" rows="2" placeholder="pl. 4 tábla OSB, 2 zsák gipsz">${esc(rec?.itemsText || '')}</textarea></label>
      <p class="v150-move-warn" hidden></p>
      <div class="v147-actions"><button type="button" data-cancel>Mégse</button><button type="button" data-ok class="primary">${rec ? 'Mentés' : 'Felvétel'}</button></div></form>`;
    d.querySelector('[data-cancel]').onclick = () => d.close();
    d.querySelector('[data-ok]').onclick = () => {
      const v = n => (d.querySelector(`[name="${n}"]`) || {}).value || '';
      const warn = d.querySelector('.v150-move-warn');
      if (!v('orderNo').trim() && !v('supplier')) { warn.textContent = 'Add meg legalább a rendelésszámot vagy a beszállítót.'; warn.hidden = false; return; }
      if (!v('date')) { warn.textContent = 'Add meg, mikor kérdezzek rá.'; warn.hidden = false; return; }
      const target = rec || { id: uid(), status: 'open', createdAt: new Date().toISOString(), log: [] };
      Object.assign(target, { orderNo: v('orderNo').trim(), supplierName: v('supplier'), projectName: v('project'), followupDate: v('date'), note: v('note').trim(), itemsText: v('items').trim() });
      if (!rec) { list().push(target); target.log.push({ at: new Date().toISOString(), by: me(), text: `felvéve, rákérdezés: ${fmt(target.followupDate)}` }); }
      d.close(); touch(target);
      global.toastV147?.(rec ? 'Függő rendelés mentve.' : `Függő rendelés felvéve – rákérdezés: ${fmt(target.followupDate)}`);
    };
    if (!d.open) d.showModal();
  }
  function retry(id) {
    const rec = list().find(r => String(r.id) === String(id)); if (!rec) return;
    const d = dlg('v151PendingRetry');
    d.innerHTML = `<form method="dialog" class="v150-form"><h3>Nem jött meg – ${esc(labelOf(rec))}</h3>
      <label>Új rákérdezési nap<input type="date" name="date" value="${esc(workdayAfter(2))}"></label>
      <label>Mit mondtak? (nem kötelező)<textarea name="note" rows="2" placeholder="pl. jövő hét elejére ígérik"></textarea></label>
      <div class="v147-actions"><button type="button" data-cancel>Mégse</button><button type="button" data-ok class="primary">Új dátum mentése</button></div></form>`;
    d.querySelector('[data-cancel]').onclick = () => d.close();
    d.querySelector('[data-ok]').onclick = () => {
      const date = d.querySelector('[name="date"]').value; if (!date) return;
      const note = d.querySelector('[name="note"]').value.trim();
      rec.log = Array.isArray(rec.log) ? rec.log : [];
      rec.log.push({ at: new Date().toISOString(), by: me(), text: `nem jött meg, új dátum: ${fmt(date)}${note ? ` – ${note}` : ''}` });
      rec.followupDate = date;
      d.close(); touch(rec);
      global.toastV147?.(`Új rákérdezési nap: ${fmt(date)}`);
    };
    if (!d.open) d.showModal();
  }
  function busyOn(vehicle, day) {
    if (!vehicle || !day) return '';
    if (global.vehicleAbsenceV147?.(vehicle, day)) return 'szabadságon';
    const only = String(vehicle.dayOnly || '').trim();
    return only && only !== day ? `csak ${only} napon` : '';
  }
  function buildOrder(rec, date, vehicleId) {
    const supplier = (state.suppliers || []).find(s => s.name === (rec.supplierName || rec.order?.pickupName));
    const project = (state.projects || []).find(p => p.name === (rec.projectName || rec.order?.projectName));
    const base = rec.order ? { ...rec.order } : {
      id: uid(), orderNo: rec.orderNo || '', items: [], completed: false,
      pickupName: supplier?.name || rec.supplierName || '', pickupAddress: supplier?.address || '', supplierId: supplier?.id || '', pickupNote: supplier?.pickupNote || '',
      projectName: project?.name || rec.projectName || '', dropAddress: project?.address || '', projectId: project?.id || '',
      recipientName: project?.receiver || ''
    };
    if (rec.orderNo && !base.orderNo) base.orderNo = rec.orderNo;
    const notes = [rec.itemsText, base.manualItems].filter(Boolean);
    if (rec.itemsText && !String(base.manualItems || '').includes(rec.itemsText)) base.manualItems = notes.join(' · ');
    delete base.placementV148; delete base.pendingV151;
    const seq = (state.orders || []).filter(o => o.scheduleDate === date && o.vehicleId === vehicleId).reduce((m, o) => Math.max(m, +o.sequence || 0), 0);
    return Object.assign(base, { scheduleDate: date, vehicleId, sequence: seq + 1, fromPendingV151: { id: rec.id, at: new Date().toISOString() } });
  }
  function promote(id) {
    const rec = list().find(r => String(r.id) === String(id)); if (!rec) return;
    const d = dlg('v151PendingPromote');
    const vehicles = (state.vehicles || []).filter(v => v.active);
    const def = workdayAfter(1);
    d.innerHTML = `<form method="dialog" class="v150-form"><h3>Megjött – ${esc(labelOf(rec))}</h3>
      <p class="v147-hint">Fuvarként a kiválasztott napra kerül, minden adatával (tételek, levél, csatolmány).</p>
      <label>Szállítás napja<input type="date" name="date" value="${esc(def)}"></label>
      <label>Sofőr<select name="vehicle">${vehicles.map(v => `<option value="${esc(v.id)}">${esc(v.driverName || v.name)}</option>`).join('')}</select></label>
      <p class="v150-move-warn" hidden></p>
      <div class="v147-actions"><button type="button" data-cancel>Mégse</button><button type="button" data-ok class="primary">Fuvarok közé</button></div></form>`;
    const dateEl = d.querySelector('[name="date"]'), vehEl = d.querySelector('[name="vehicle"]'), warn = d.querySelector('.v150-move-warn');
    const refreshOpts = () => {
      [...vehEl.options].forEach(opt => { const v = vehicles.find(x => x.id === opt.value); const b = busyOn(v, dateEl.value); opt.disabled = !!b; opt.textContent = `${v.driverName || v.name}${b ? ` (${b})` : ''}`; });
      if (vehEl.selectedOptions[0]?.disabled) { const free = [...vehEl.options].find(o => !o.disabled); if (free) vehEl.value = free.value; }
    };
    dateEl.addEventListener('change', refreshOpts); refreshOpts();
    d.querySelector('[data-cancel]').onclick = () => d.close();
    d.querySelector('[data-ok]').onclick = () => {
      const date = dateEl.value, vehicleId = vehEl.value;
      const v = vehicles.find(x => x.id === vehicleId);
      if (!date || !vehicleId || busyOn(v, date)) { warn.textContent = 'Válassz napot és olyan sofőrt, aki aznap dolgozik.'; warn.hidden = false; return; }
      const order = buildOrder(rec, date, vehicleId);
      state.orders = state.orders || []; state.orders.push(order);
      state.routePlans = state.routePlans || {}; state.routePlans[date] = {};
      rec.status = 'done'; rec.promotedOrderId = order.id;
      rec.log = Array.isArray(rec.log) ? rec.log : [];
      rec.log.push({ at: new Date().toISOString(), by: me(), text: `megjött – fuvar: ${fmt(date)} · ${v.driverName || v.name}` });
      d.close(); touch(rec); save(); if (typeof render === 'function') render();
      global.toastV147?.(`${labelOf(rec)} a fuvarok közé került: ${fmt(date)} · ${v.driverName || v.name}`);
    };
    if (!d.open) d.showModal();
  }
  function remove(id) {
    const rec = list().find(r => String(r.id) === String(id)); if (!rec) return;
    if (!confirm(`Törlöd a függő rendelést (${labelOf(rec)})? Nem kerül a fuvarok közé.`)) return;
    rec.status = 'deleted';
    rec.log = Array.isArray(rec.log) ? rec.log : []; rec.log.push({ at: new Date().toISOString(), by: me(), text: 'törölve' });
    touch(rec);
  }
  /* egy meglévő fuvar → függő rendelés (a szerkesztőből) */
  function fromOrder(orderId) {
    const order = (state.orders || []).find(o => String(o.id) === String(orderId)); if (!order) return;
    const d = dlg('v151FromOrder');
    d.innerHTML = `<form method="dialog" class="v150-form"><h3>Függő rendelésbe – ${esc(global.orderLabelV145 ? global.orderLabelV145(order) : order.orderNo || '')}</h3>
      <p class="v147-hint">A fuvar kikerül a fuvarok közül (a sofőr sem látja), és a Függő rendelések között vár, amíg vissza nem teszed.</p>
      <label>Mikor kérdezzek rá?<input type="date" name="date" value="${esc(workdayAfter(2))}"></label>
      <label>Teendő / megjegyzés<textarea name="note" rows="2" placeholder="pl. visszaigazolásra vár"></textarea></label>
      <div class="v147-actions"><button type="button" data-cancel>Mégse</button><button type="button" data-ok class="primary">Függő rendelésbe</button></div></form>`;
    d.querySelector('[data-cancel]').onclick = () => d.close();
    d.querySelector('[data-ok]').onclick = () => {
      const date = d.querySelector('[name="date"]').value; if (!date) return;
      const { placementV148, localUpdatedAt, onlineUpdatedAt, ...copy } = order;
      const rec = { id: uid(), status: 'open', createdAt: new Date().toISOString(), orderNo: order.orderNo || '', orderLabel: global.orderLabelV145 ? global.orderLabelV145(order) : '', supplierName: order.pickupName || '', projectName: order.projectName || '', followupDate: date, note: d.querySelector('[name="note"]').value.trim(), order: copy,
        log: [{ at: new Date().toISOString(), by: me(), text: `fuvarból áttéve (${fmt(order.scheduleDate)}), rákérdezés: ${fmt(date)}` }] };
      list().push(rec);
      state.orders = (state.orders || []).filter(o => o !== order);
      d.close(); document.getElementById('orderDialog')?.close?.();
      touch(rec); save(); if (typeof render === 'function') render();
      global.toastV147?.('A fuvar a Függő rendelések közé került.');
    };
    if (!d.open) d.showModal();
  }
  /* az Outlook-import előnézetéből érkező (már kész) rendelések */
  function addFromImport(orders, entries) {
    orders.forEach((order, i) => {
      const entry = entries[i] || {};
      const { placementV148, localUpdatedAt, onlineUpdatedAt, ...copy } = order;
      list().push({ id: uid(), status: 'open', createdAt: new Date().toISOString(), orderNo: order.orderNo || '', orderLabel: global.orderLabelV145 ? global.orderLabelV145(order) : '', supplierName: order.pickupName || '', projectName: order.projectName || '', followupDate: entry.pendingV151?.date || workdayAfter(2), note: entry.pendingV151?.note || '', order: copy,
        log: [{ at: new Date().toISOString(), by: me(), text: `Outlook-importból felvéve, rákérdezés: ${fmt(entry.pendingV151?.date)}` }], updatedAt: new Date().toISOString(), syncedV151: true });
      pushToServer(list().at(-1));
    });
    save(false); refresh();
  }

  /* ---------- telepítés ---------- */
  function install() {
    if (!document.getElementById(PAGE)) return;
    document.getElementById('v151NewPending')?.addEventListener('click', () => editPending());
    refresh();
    /* a fuvar szerkesztőjében: „Függő rendelésbe” */
    const origEdit = global.editOrder;
    if (typeof origEdit === 'function' && !origEdit.__v151) {
      const wrapped = function (id) {
        const r = origEdit.apply(this, arguments);
        const head = document.querySelector('#orderDialog .dialog-head');
        if (head && isAdmin()) {
          let b = head.querySelector('.v151-to-pending');
          if (!b) { b = document.createElement('button'); b.type = 'button'; b.className = 'v148-history-btn v151-to-pending'; b.textContent = 'Függő rendelésbe'; b.onclick = () => fromOrder(document.getElementById('orderId').value); head.insertBefore(b, head.querySelector('.v148-history-btn') || head.lastElementChild); }
          b.classList.toggle('hidden', !id);
        }
        return r;
      };
      wrapped.__v151 = true; global.editOrder = wrapped;
    }
    /* értesítésre koppintva / ?page=pending */
    global.navigator?.serviceWorker?.addEventListener?.('message', e => { if (e.data?.type === 'open-page' && e.data.page === 'pending') showPage(PAGE); });
    try { if (new URLSearchParams(location.search).get('page') === 'pending') setTimeout(() => showPage(PAGE), 400); } catch (_) {}
    setInterval(badge, 10 * 60 * 1000);
    const origShow = global.showPage;
    if (typeof origShow === 'function' && !origShow.__v151) {
      const w = function (id) { const r = origShow.apply(this, arguments); if (id === PAGE) { refresh(); loadFromServer(); } return r; };
      w.__v151 = true; global.showPage = w;
    }
  }
  global.v151EditPending = editPending;
  global.v151Retry = retry;
  global.v151Promote = promote;
  global.v151DeletePending = remove;
  global.v151FromOrder = fromOrder;
  global.v151AddFromImport = addFromImport;
  global.v151LoadPending = loadFromServer;
  global.v151RenderPending = refresh;
  global.v151DailyReminder = dailyReminder;
  global.V151Pending = { list, open, dueCount, buildOrder, renderPage, badge };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true }); else install();
})(window);
