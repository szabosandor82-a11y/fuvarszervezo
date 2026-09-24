/* ==========================================================================
   NAPI FUVARLISTA (V93)

   Egy képernyőn mind a három sofőr aznapi felrakói, Nézet-stílusú sorokban,
   egymás mellé rendezve. A sorok szabadon áthúzhatók egyik autóról a másikra.

   Miért külön fájl: a főoldal buborékos nézete érintetlen marad. Ez csak
   MÁSKÉNT mutatja ugyanazt az adatot – amit itt mozgatsz, az ugyanaz a
   mozgatás, mint a főoldalon, tehát a sorszámok, a térkép, az útvonalterv
   és a sofőri felület magától követi.

   A húzást a meglévő V37-es logika végzi: a konténerek ugyanazt a
   "route-<sofőr>" azonosítót viselik, amit az initSortables keres, ezért
   nem kellett új mozgatókód.
   ========================================================================== */
(function (global) {
  'use strict';

  const $ = selector => document.querySelector(selector);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

  /* A sor: ugyanaz a felépítés, mint a Nézetben – kerek sorszám mint
     fogópont, mellette a cégnév, alatta a cím és a tételszám. */
  function rowHtml(order, index) {
    const items = (order.items || []).length;
    const resolved = typeof isResolvedBacklogOrder === 'function' && isResolvedBacklogOrder(order);
    const done = !!order.completed || resolved;
    const address = order.pickupAddress || '';
    const meta = [address, items ? `${items} tétel` : ''].filter(Boolean).join(' · ');
    return `<article class="v93-row route-block${done ? ' v93-done' : ''}" data-id="${esc(order.id)}">
      <span class="v56-index drag" title="${done ? 'Kész fuvar – a helyén marad' : 'Húzd át másik sofőrhöz'}">${index + 1}</span>
      <span class="v93-main">
        <span class="v93-name">${esc(order.pickupName || '(nincs felrakó)')}</span>
        <span class="v93-meta">${esc(done ? 'Kész · a helyén marad' : meta)}</span>
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
      <div class="v93-list" id="route-${esc(vehicle.id)}">
        ${orders.map(rowHtml).join('')}
        <div class="v93-drop">ide húzhatod a fuvart</div>
      </div>
    </section>`;
  }

  function renderDailyListV93() {
    const host = $('#v93Board');
    if (!host) return;
    const vehicles = typeof activeVehicles === 'function' ? activeVehicles() : [];
    if (!vehicles.length) {
      host.innerHTML = '<div class="v93-empty">Nincs aktív jármű erre a napra.</div>';
      return;
    }
    host.style.gridTemplateColumns = `repeat(${vehicles.length}, minmax(0, 1fr))`;
    host.innerHTML = vehicles.map(columnHtml).join('');
    const dateLabel = $('#v93Date');
    if (dateLabel && typeof selectedDate === 'function') dateLabel.textContent = selectedDate();
    // ugyanaz a mozgatólogika, mint a főoldalon
    if (typeof initSortables === 'function') setTimeout(initSortables, 20);
  }

  global.renderDailyListV93 = renderDailyListV93;
})(window);
