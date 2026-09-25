/* ==========================================================================
   NAPI FUVARLISTA (V94)

   Egy képernyőn mind a három sofőr adott napi felrakói, Nézet-stílusú
   sorokban. A sorok szabadon mozgathatók: fel-le az oszlopon belül, és át a
   másik sofőrhöz.

   V94 JAVÍTÁS – MIÉRT NEM MŰKÖDÖTT A HÚZÁS

   A V93-ban a konténerek ugyanazt az azonosítót kapták, mint a főoldali
   oszlopok (route-m, route-p, route-t). Az oldalon így KÉT elem viselte
   ugyanazt az azonosítót, és a mozgatólogika a FŐOLDALI elemre kötött rá –
   az új nézetben semmi nem mozdult. Az újraszámozás ráadásul a főoldali
   buborékokat kereste, nem ezeket a sorokat.

   Ezért itt saját azonosító (v94-route-…) és saját bekötés van. A csoport
   neve közös, így az oszlopok között át lehet húzni.

   Az admin felületen a MÚLTBELI napok fuvarjai is mozgathatók, mert utólag
   is javítani kell tudni, ki mit vitt. A sofőri felület változatlan: ott a
   korábbi napok csak megtekinthetők.
   ========================================================================== */
(function (global) {
  'use strict';

  const $ = selector => document.querySelector(selector);
  const $$ = selector => [...document.querySelectorAll(selector)];
  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

  const containerId = vehicleId => 'v94-route-' + vehicleId;

  /* A sor: kerek sorszám mint fogópont, mellette a cégnév, alatta a cím és a
     tételszám. A kész fuvar szürke, de MOZGATHATÓ – utólag is javítható, ki
     vitte el valójában. */
  function rowHtml(order, index) {
    const items = (order.items || []).length;
    const resolved = typeof isResolvedBacklogOrder === 'function' && isResolvedBacklogOrder(order);
    const done = !!order.completed || resolved;
    const meta = [order.pickupAddress || '', items ? `${items} tétel` : ''].filter(Boolean).join(' · ');
    return `<article class="v93-row route-block${done ? ' v93-done' : ''}" data-id="${esc(order.id)}">
      <span class="v56-index drag" title="Húzd fel-le, vagy át másik sofőrhöz">${index + 1}</span>
      <span class="v93-main">
        <span class="v93-name">${esc(order.pickupName || '(nincs felrakó)')}</span>
        <span class="v93-meta">${esc(done ? 'Kész · ' + meta : meta)}</span>
      </span>
    </article>`;
  }

  function columnHtml(vehicle) {
    const orders = (typeof dayOrders === 'function' ? dayOrders(vehicle.id) : [])
      .slice().sort((a, b) => (+a.sequence || 999) - (+b.sequence || 999));
    const items = orders.reduce((sum, order) => sum + ((order.items || []).length), 0);
    const driver = typeof v24DriverKey === 'function' ? v24DriverKey(vehicle) : '';
    return `<section class="v93-col" data-driver="${esc(driver)}">
      <header class="v93-col-head">
        <b>${esc(vehicle.driverName || vehicle.name || 'Sofőr')}</b>
        <span>${esc(vehicle.name || '')}</span>
        <em>${orders.length} fuvar · ${items} tétel</em>
      </header>
      <div class="v93-list" id="${containerId(vehicle.id)}">${orders.map(rowHtml).join('')}</div>
    </section>`;
  }

  /* A sorszámok újraszámozása MINDEN oszlopban, a képernyőn látható sorrend
     szerint – ugyanaz a szabály, mint a főoldalon. */
  function renumberV94() {
    const vehicles = typeof activeVehicles === 'function' ? activeVehicles() : [];
    for (const vehicle of vehicles) {
      const rows = $$('#' + containerId(vehicle.id) + ' .v93-row');
      rows.forEach((row, index) => {
        const order = (state.orders || []).find(item => item.id === row.dataset.id);
        if (order) order.sequence = index + 1;
        const badge = row.querySelector('.v56-index');
        if (badge) badge.textContent = String(index + 1);
      });
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
        group: 'v94-daily', animation: 180, handle: '.drag',
        scroll: true, bubbleScroll: true, scrollSensitivity: 120, scrollSpeed: 20,
        fallbackOnBody: true, delayOnTouchOnly: true, delay: 120, touchStartThreshold: 4,
        onEnd: event => {
          const order = (state.orders || []).find(item => item.id === event.item.dataset.id);
          if (order) order.vehicleId = String(event.to.id || '').replace('v94-route-', '');
          renumberV94();
          if (typeof save === 'function') save(false);
          // a főoldal, a térkép és az útvonalterv is kövesse
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
})(window);
