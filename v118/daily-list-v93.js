/* ==========================================================================
   NAPI FUVARLISTA (V96)

   Egy képernyőn mind a három sofőr adott napi FELRAKÓI. A nézet célja a
   sorrend gyors belövése, ezért minden felrakó CSAK EGYSZER szerepel, akkor
   is, ha több rendelés tartozik hozzá – a soron az látszik, hány rendelés és
   hány tétel van összesen.

   A sor húzásával a felrakó ÖSSZES rendelése együtt mozog: fel-le az
   oszlopon belül, vagy át másik sofőrhöz.

   V96 JAVÍTÁS – MIÉRT NEM LÁTSZOTT A SORSZÁM

   A fogópont a ".drag" osztályt viselte, amire a program régi buborékaiban
   egy position:absolute szabály vonatkozik. A sorszám így kiugrott a sorból,
   és sem látszani, sem megfogni nem lehetett. A CSS-ben már kétszer
   javítottuk ezt osztályonként; most a fogópont SAJÁT osztálynevet kapott
   (v96-grip), amire semmilyen régi szabály nem vonatkozik.
   ========================================================================== */
(function (global) {
  'use strict';

  const $ = selector => document.querySelector(selector);
  const $$ = selector => [...document.querySelectorAll(selector)];
  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const norm96 = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

  const containerId = vehicleId => 'v94-route-' + vehicleId;
  const groupKey = order => `${norm96(order.pickupName)}|${norm96(order.pickupAddress)}`;

  /* A nap fuvarjai felrakónként összevonva. A csoport sorrendjét a benne lévő
     legkisebb sorszám adja, hogy a meglévő sorrend ne boruljon fel. */
  function pickupGroups(vehicleId) {
    const orders = (typeof dayOrders === 'function' ? dayOrders(vehicleId) : []).slice()
      .sort((a, b) => (+a.sequence || 999) - (+b.sequence || 999));
    const groups = new Map();
    for (const order of orders) {
      const key = groupKey(order);
      if (!groups.has(key)) {
        groups.set(key, {
          key, name: order.pickupName || '(nincs felrakó)', address: order.pickupAddress || '',
          orders: [], items: 0, seq: +order.sequence || 999, done: true
        });
      }
      const group = groups.get(key);
      group.orders.push(order);
      group.items += (order.items || []).length;
      group.seq = Math.min(group.seq, +order.sequence || 999);
      const resolved = typeof isResolvedBacklogOrder === 'function' && isResolvedBacklogOrder(order);
      if (!order.completed && !resolved) group.done = false;
    }
    return [...groups.values()].sort((a, b) => a.seq - b.seq);
  }

  function rowHtml(group, index) {
    const counts = [
      group.orders.length > 1 ? `${group.orders.length} rendelés` : '',
      group.items ? `${group.items} tétel` : ''
    ].filter(Boolean).join(' · ');
    const meta = [group.address, counts].filter(Boolean).join(' · ');
    const ids = group.orders.map(order => order.id).join(',');
    return `<article class="v93-row${group.done ? ' v93-done' : ''}" data-ids="${esc(ids)}">
      <span class="v96-grip" title="Húzd fel-le, vagy át másik sofőrhöz">${index + 1}</span>
      <span class="v93-main">
        <span class="v93-name">${esc(group.name)}</span>
        <span class="v93-meta">${esc(group.done ? 'Kész · ' + meta : meta)}</span>
      </span>
    </article>`;
  }

  function columnHtml(vehicle) {
    const groups = pickupGroups(vehicle.id);
    const orders = groups.reduce((sum, group) => sum + group.orders.length, 0);
    const items = groups.reduce((sum, group) => sum + group.items, 0);
    const driver = typeof v24DriverKey === 'function' ? v24DriverKey(vehicle) : '';
    return `<section class="v93-col" data-driver="${esc(driver)}">
      <header class="v93-col-head">
        <b>${esc(vehicle.driverName || vehicle.name || 'Sofőr')}</b>
        <span>${esc(vehicle.name || '')}</span>
        <em>${groups.length} felrakó · ${orders} rendelés · ${items} tétel</em>
      </header>
      <div class="v93-list" id="${containerId(vehicle.id)}">${groups.map(rowHtml).join('')}</div>
    </section>`;
  }

  /* Újraszámozás a képernyőn látható sorrend szerint. Egy soron több rendelés
     is lehet – azok egymás után kapják a sorszámot, hogy a főoldali
     buborékok sorrendje is stimmeljen. */
  function renumberV94() {
    const vehicles = typeof activeVehicles === 'function' ? activeVehicles() : [];
    for (const vehicle of vehicles) {
      let sequence = 0;
      for (const row of $$('#' + containerId(vehicle.id) + ' .v93-row')) {
        const ids = String(row.dataset.ids || '').split(',').filter(Boolean);
        for (const id of ids) {
          const order = (state.orders || []).find(item => item.id === id);
          if (order) order.sequence = ++sequence;
        }
        const grip = row.querySelector('.v96-grip');
        if (grip) grip.textContent = String([...row.parentElement.children].indexOf(row) + 1);
      }
    }
  }

  function bindSortablesV94() {
    if (typeof Sortable === 'undefined') return;
    const vehicles = typeof activeVehicles === 'function' ? activeVehicles() : [];
    for (const vehicle of vehicles) {
      const element = document.getElementById(containerId(vehicle.id));
      if (!element || element.dataset.v94bound === '1') continue;
      element.dataset.v94bound = '1';
      new Sortable(element, {
        group: 'v94-daily', animation: 180, handle: '.v96-grip',
        scroll: true, bubbleScroll: true, scrollSensitivity: 120, scrollSpeed: 20,
        fallbackOnBody: true, delayOnTouchOnly: true, delay: 120, touchStartThreshold: 4,
        onEnd: event => {
          const target = String(event.to.id || '').replace('v94-route-', '');
          // a felrakó ÖSSZES rendelése együtt mozog
          for (const id of String(event.item.dataset.ids || '').split(',').filter(Boolean)) {
            const order = (state.orders || []).find(item => item.id === id);
            if (order && target) order.vehicleId = target;
          }
          renumberV94();
          if (typeof save === 'function') save(false);
          if (typeof renderRoutes === 'function') setTimeout(renderRoutes, 0);
          setTimeout(renderDailyListV93, 80);
        }
      });
    }
  }

  function renderDailyListV93() {
    const host = $('#v93Board');
    if (!host) return;
    const vehicles = typeof activeVehicles === 'function' ? activeVehicles() : [];
    const label = $('#v94Date');
    if (label && typeof selectedDate === 'function') label.textContent = selectedDate();
    if (!vehicles.length) {
      host.innerHTML = '<div class="v93-empty">Nincs aktív jármű erre a napra.</div>';
      return;
    }
    host.style.gridTemplateColumns = `repeat(${vehicles.length}, minmax(0, 1fr))`;
    host.innerHTML = vehicles.map(columnHtml).join('');
    setTimeout(bindSortablesV94, 20);
  }

  /* A napléptető ugyanazt a #workDate mezőt állítja, amit a főoldal használ,
     ezért a két nézet mindig ugyanazt a napot mutatja. */
  function stepDayV94(direction) {
    const field = $('#workDate');
    if (!field) return;
    field.value = typeof shiftWorkday === 'function'
      ? shiftWorkday(selectedDate(), direction)
      : selectedDate();
    const picker = $('#v94Picker');
    if (picker) picker.value = field.value;
    if (typeof render === 'function') render();
    renderDailyListV93();
  }

  function bindDayControlsV94() {
    const prev = $('#v94Prev'), next = $('#v94Next'), picker = $('#v94Picker');
    if (prev) prev.onclick = () => stepDayV94(-1);
    if (next) next.onclick = () => stepDayV94(1);
    if (picker) picker.onchange = () => {
      const field = $('#workDate');
      if (field && picker.value) { field.value = picker.value; if (typeof render === 'function') render(); }
      renderDailyListV93();
    };
  }

  global.renderDailyListV93 = renderDailyListV93;
  global.stepDayV94 = stepDayV94;
  global.bindDayControlsV94 = bindDayControlsV94;
  global.renumberV94 = renumberV94;
  global.pickupGroupsV96 = pickupGroups;
})(window);
