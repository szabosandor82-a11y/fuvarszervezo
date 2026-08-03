/* Fuvarszervező V36
   Felület- és munkafolyamat-javítások a V35 stabil motorjára építve.

   - Sofőrönként eltérő útvonalirány: Patrik a központból kifelé és vissza,
     Martin/Márió a lakhely felől befelé.
   - A teljesített hátralékok kikerülnek a Hátralékból, a napi nézetben
     szürke „Elintézve” állapotban maradnak és nem vesznek részt az optimalizálásban.
   - Sofőrönként külön, nagy „Nézet” ablak saját térképpel és teljes kezelhetőséggel.
   - Megbízható automatikus fel/le görgetés buborékhúzás közben.
   - Ryng törzsadat javítása: 1173 Budapest, Flamingó köz 4.
*/
(function (global) {
  'use strict';

  const VERSION = '36';
  const RYNG_ADDRESS = '1173 Budapest, Flamingó köz 4.';
  const BAD_RYNG_RE = /(tatab[aá]nya|hal[aá]sztelek|banyi\s*j[aá]nos|korbuly)/i;
  let focusVehicleId = '';
  let focusMap = null;
  let focusSortable = null;
  let dragScrollFrame = 0;
  let dragPointerY = null;
  let dragScrollContainer = null;
  let dragActive = false;

  const nrm = value => {
    if (typeof norm === 'function') return norm(value || '');
    return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[_.,;:()[\]{}\/\\-]+/g, ' ').replace(/\s+/g, ' ').trim();
  };
  const escHtml = value => typeof esc === 'function'
    ? esc(value ?? '')
    : String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const driverKey = vehicle => {
    const text = nrm(vehicle?.driverName || '');
    if (text.includes('patrik')) return 'patrik';
    if (text.includes('mario')) return 'mario';
    if (text.includes('martin')) return 'martin';
    return 'other';
  };
  const finitePoint = point => Array.isArray(point) && Number.isFinite(+point[0]) && Number.isFinite(+point[1]);
  const canonicalStop = stop => global.V35Planner?.canonicalStop
    ? global.V35Planner.canonicalStop(stop)
    : (() => {
        const text = nrm(`${stop?.name || ''} ${stop?.address || ''}`);
        if (/kozponti raktar|kereskedo utca|szigetszentmiklos|\bkrpr\b/.test(text)) return 'central';
        if (/niczuk/.test(text)) return 'niczuk';
        if (/cairox/.test(text)) return 'cairox';
        if (/sebok/.test(text)) return 'sebok';
        if (/lambda/.test(text)) return 'lambda';
        return text;
      })();
  const isFullLoadOrder = order => global.V33Planner?.isFullLoadOrder?.(order) || false;
  const bubbleGroups = orders => global.V33Planner?.orderedBubbleGroups?.(orders) || [];

  function applyDirectionalRules(stops, driver) {
    const full = stops.filter(stop => stop.fullLoad);
    const normal = stops.filter(stop => !stop.fullLoad);
    const keys = new Set(normal.map(canonicalStop));
    const constraints = [];
    if (driver === 'patrik') {
      constraints.push(['central', 'niczuk'], ['niczuk', 'cairox'], ['cairox', 'sebok'], ['sebok', 'lambda']);
    } else if ((driver === 'martin' || driver === 'mario') && keys.has('cairox')) {
      constraints.push(['cairox', 'sebok'], ['sebok', 'central'], ['central', 'niczuk'], ['niczuk', 'lambda']);
    }
    if (!constraints.length) return stops.slice();

    const originalIndex = new Map(normal.map((stop, index) => [stop, index]));
    const incoming = new Map(normal.map(stop => [stop, 0]));
    const outgoing = new Map(normal.map(stop => [stop, []]));
    for (const [before, after] of constraints) {
      const from = normal.filter(stop => canonicalStop(stop) === before);
      const to = normal.filter(stop => canonicalStop(stop) === after);
      for (const a of from) for (const b of to) {
        outgoing.get(a).push(b);
        incoming.set(b, incoming.get(b) + 1);
      }
    }
    const ready = normal.filter(stop => incoming.get(stop) === 0).sort((a, b) => originalIndex.get(a) - originalIndex.get(b));
    const result = [];
    while (ready.length) {
      const next = ready.shift();
      result.push(next);
      for (const target of outgoing.get(next)) {
        incoming.set(target, incoming.get(target) - 1);
        if (incoming.get(target) === 0) {
          ready.push(target);
          ready.sort((a, b) => originalIndex.get(a) - originalIndex.get(b));
        }
      }
    }
    return result.length === normal.length ? [...full, ...result] : stops.slice();
  }

  function isBacklogOrder(order) {
    if (!order) return false;
    return !!order.movedFromOrderId
      || (state.backlog || []).some(record => record.targetOrderId === order.id)
      || (state.resolvedBacklog || []).some(record => record.targetOrderId === order.id);
  }

  function syncBacklogForOrder(order) {
    if (!order || !isBacklogOrder(order)) return;
    state.backlog = state.backlog || [];
    state.resolvedBacklog = state.resolvedBacklog || [];
    const receivedIds = new Set((order.items || []).filter(item => item.received).map(item => item._id).filter(Boolean));
    const openIds = new Set((order.items || []).filter(item => !item.received).map(item => item._id).filter(Boolean));

    const stillOpen = [];
    for (const record of state.backlog) {
      if (record.targetOrderId === order.id && (!record.itemId || receivedIds.has(record.itemId))) {
        state.resolvedBacklog.push({ ...record, resolvedAt: new Date().toISOString() });
      } else stillOpen.push(record);
    }
    state.backlog = stillOpen;

    const stillResolved = [];
    for (const record of state.resolvedBacklog) {
      if (record.targetOrderId === order.id && record.itemId && openIds.has(record.itemId)) {
        const restored = { ...record };
        delete restored.resolvedAt;
        state.backlog.push(restored);
      } else stillResolved.push(record);
    }
    state.resolvedBacklog = stillResolved;

    const allReceived = (order.items || []).length > 0 && order.items.every(item => item.received);
    order.completed = allReceived;
    order.backlogResolved = allReceived && isBacklogOrder(order);
    if (order.backlogResolved) {
      order.completedAt = order.completedAt || new Date().toISOString();
      order.resolvedBacklogAt = order.resolvedBacklogAt || new Date().toISOString();
    } else {
      order.resolvedBacklogAt = '';
      if (!order.completed) order.completedAt = '';
    }
  }

  function syncAllBacklogStatuses() {
    state.resolvedBacklog = state.resolvedBacklog || [];
    for (const order of state.orders || []) if (isBacklogOrder(order)) syncBacklogForOrder(order);
  }

  function isResolvedBacklogOrder(order) {
    return !!(order?.backlogResolved && order?.completed);
  }

  function migrateRyngAddress() {
    let changed = false;
    for (const supplier of state.suppliers || []) {
      if (!/\bryng\b/i.test(supplier.name || '')) continue;
      if (!supplier.address || BAD_RYNG_RE.test(supplier.address) || nrm(supplier.address) === nrm(RYNG_ADDRESS)) {
        if (supplier.address !== RYNG_ADDRESS) changed = true;
        supplier.address = RYNG_ADDRESS;
        supplier.manualOverride = true;
        supplier.manualEditedAt = supplier.manualEditedAt || new Date().toISOString();
      }
    }
    for (const order of state.orders || []) {
      if (!/\bryng\b/i.test(order.pickupName || '')) continue;
      if (!order.pickupAddress || BAD_RYNG_RE.test(order.pickupAddress) || nrm(order.pickupAddress) === nrm(RYNG_ADDRESS)) {
        if (order.pickupAddress !== RYNG_ADDRESS) changed = true;
        order.pickupAddress = RYNG_ADDRESS;
      }
    }
    if (changed) {
      state.routePlans = {};
      state.routeStats = {};
      for (const key of Object.keys(state.geo || {})) if (BAD_RYNG_RE.test(key) || /ryng/i.test(key)) delete state.geo[key];
      localStorage.setItem(KEY, JSON.stringify(state));
    }
    return changed;
  }

  async function profilesFor(orders) {
    const profiles = {};
    for (const order of orders) {
      if (typeof syncOrderFromMasters === 'function') syncOrderFromMasters(order);
      profiles[order.id] = typeof orderGeoProfile === 'function'
        ? await orderGeoProfile(order)
        : { pickup: await geo(order.pickupAddress), drop: await geo(order.dropAddress) };
    }
    profiles.__base = await geo(state.settings?.baseAddress || '');
    return profiles;
  }

  function placeFixedGroups(orderedActive, allGroups, vehicleId) {
    const slots = new Array(allGroups.length).fill(null);
    const fixed = allGroups.filter(group => group.pinned || group.orders.every(isResolvedBacklogOrder));
    const fixedKeys = new Set(fixed.map(group => group.key));
    const free = orderedActive.filter(group => !fixedKeys.has(group.key));
    const nearestEmpty = wanted => {
      for (let delta = 0; delta < slots.length; delta++) {
        const right = wanted + delta, left = wanted - delta;
        if (right < slots.length && !slots[right]) return right;
        if (left >= 0 && !slots[left]) return left;
      }
      return -1;
    };
    fixed.sort((a, b) => a.sequence - b.sequence).forEach(group => {
      const pinnedPosition = group.pinned ? group.pinnedPosition : group.sequence;
      const wanted = Math.max(0, Math.min(slots.length - 1, (+pinnedPosition || 1) - 1));
      const index = nearestEmpty(wanted);
      if (index >= 0) slots[index] = group;
    });
    let cursor = 0;
    for (let index = 0; index < slots.length; index++) {
      if (slots[index]) continue;
      slots[index] = free[cursor++] || allGroups.find(group => !slots.includes(group));
    }
    return slots.filter(Boolean);
  }

  async function v36BuildRoutePlan(vehicleId, suppliedProfiles = null) {
    const vehicle = state.vehicles.find(item => item.id === vehicleId);
    const allOrders = dayOrders(vehicleId).slice().sort((a, b) => (+a.sequence || 999) - (+b.sequence || 999));
    const activeOrders = allOrders.filter(order => !isResolvedBacklogOrder(order));
    state.routePlans = state.routePlans || {};
    state.routePlans[selectedDate()] = state.routePlans[selectedDate()] || {};
    if (!activeOrders.length) {
      state.routePlans[selectedDate()][vehicleId] = [];
      return [];
    }

    const profiles = suppliedProfiles || await profilesFor(activeOrders);
    let stops = await global.V35Planner.planPickupStops(vehicle, activeOrders, profiles);
    stops = applyDirectionalRules(stops, driverKey(vehicle));

    const activeGroups = bubbleGroups(activeOrders);
    const rank = new Map();
    stops.forEach((stop, index) => stop.orders.forEach(order => {
      const group = activeGroups.find(item => item.orders.some(candidate => candidate.id === order.id));
      if (group && !rank.has(group.key)) rank.set(group.key, index);
    }));
    const orderedActive = activeGroups.slice().sort((a, b) => (rank.get(a.key) ?? 999) - (rank.get(b.key) ?? 999) || a.sequence - b.sequence);
    const allGroups = bubbleGroups(allOrders);
    const finalGroups = placeFixedGroups(orderedActive, allGroups, vehicleId);
    let sequence = 1;
    finalGroups.forEach((group, index) => group.orders.forEach(order => {
      order.vehicleId = vehicleId;
      order.sequence = sequence++;
      if (order.routePinned) {
        order.pinnedPosition = index + 1;
        order.pinnedVehicleId = vehicleId;
      }
    }));

    const events = [];
    for (const stop of stops) {
      events.push({ type: 'pickup', key: stop.key, name: stop.name, address: stop.address, orders: stop.orders.map(order => order.id), point: stop.point });
      if (stop.fullLoad) {
        const fullOrders = stop.orders.filter(isFullLoadOrder);
        events.push({
          type: 'drop', key: `full-drop||${stop.key}`, name: stop.dropName || fullOrders[0]?.projectName || 'Kötelező lerakó',
          address: stop.dropAddress || fullOrders[0]?.dropAddress || '', orders: fullOrders.map(order => order.id),
          point: stop.exitPoint, fullLoad: true
        });
      }
    }
    state.routePlans[selectedDate()][vehicleId] = events;
    return events;
  }

  async function v36OptimizeAction() {
    try {
      const before = new Map(state.orders.filter(order => order.scheduleDate === selectedDate()).map(order => [order.id, order.vehicleId]));
      syncAllBacklogStatuses();
      for (const vehicle of activeVehicles()) await v36BuildRoutePlan(vehicle.id);
      const changed = state.orders.filter(order => order.scheduleDate === selectedDate() && before.get(order.id) !== order.vehicleId);
      if (changed.length) throw new Error('Az optimalizálás sofőrt változtatott, ezért a művelet vissza lett utasítva.');
      save();
      alert('Felrakási sorrend optimalizálva a sofőr indulási iránya alapján. A szürke, elintézett hátralékok és a rögzített buborékok a helyükön maradtak.');
      return true;
    } catch (error) {
      console.error('[V36] Optimalizálási hiba', error);
      alert(`Az optimalizálás közben hiba történt: ${error?.message || error}`);
      return false;
    }
  }

  function groupIds(group) { return group.orders.map(order => order.id).join(','); }

  function renderGroupBubble(group, index, vehicleId, focus = false) {
    const ids = groupIds(group);
    const orderNos = [...new Set(group.orders.map(order => order.orderNo).filter(Boolean))];
    const itemCount = group.orders.reduce((sum, order) => sum + (order.items?.length || 0), 0);
    const longReasons = [...new Set(group.orders.map(order => order.longMaterialReason).filter(Boolean))];
    const complete = group.orders.every(order => order.completed);
    const resolved = group.orders.every(isResolvedBacklogOrder);
    const pinned = group.orders.some(order => order.routePinned);
    const fullLoad = group.fullLoad;
    const first = group.orders[0];
    const warnings = typeof masterWarnings === 'function' ? group.orders.map(masterWarnings).filter(Boolean).join('') : '';
    return `<div class="route-block ${pinned ? 'pinned-block' : ''} ${fullLoad ? 'full-load-block' : ''} ${resolved ? 'resolved-backlog-block' : ''}" data-group-key="${escHtml(group.key)}" data-order-ids="${escHtml(ids)}" data-vehicle-id="${escHtml(vehicleId)}">
      <article class="bubble grouped-bubble ${complete ? 'done' : ''} ${resolved ? 'resolved-backlog' : ''}" data-id="${escHtml(first.id)}">
        <span class="drag" title="${resolved ? 'Elintézett rendelés – nem mozgatható' : 'Húzás'}">${resolved ? '✓' : '☷'}</span>
        <div class="bubble-control-row">
          <button type="button" class="pin-button ${pinned ? 'active' : ''}" onclick="event.stopPropagation();v36TogglePin('${escHtml(ids)}','${escHtml(vehicleId)}')" title="${pinned ? 'Rögzítés feloldása' : 'Pozíció rögzítése'}">⚑</button>
          <button type="button" class="full-load-button ${fullLoad ? 'active' : ''}" onclick="event.stopPropagation();v33ToggleFullLoad('${escHtml(ids)}')" title="Teljes autós rakomány">🚚</button>
        </div>
        <h3>${index + 1}. ${escHtml(group.pickupName)}</h3>
        ${warnings}
        <div class="bubble-main-line"><b>Felrakó:</b><span>${escHtml(group.pickupName)}${group.pickupAddress ? ` · ${escHtml(group.pickupAddress)}` : ''}</span></div>
        <div class="bubble-main-line"><b>Lerakó:</b><span>${escHtml(group.projectName)}${group.dropAddress ? ` · ${escHtml(group.dropAddress)}` : ''}</span></div>
        <div class="bubble-main-line order-number-line"><b>Rendelésszám:</b><span>${escHtml(orderNos.join(', ') || 'Nincs megadva')}</span></div>
        <div class="tags"><span class="tag">${group.orders.length} rendelés</span><span class="tag">${itemCount} tétel</span>${longReasons.map(reason => `<span class="tag long">${escHtml(reason)}</span>`).join('')}${pinned ? '<span class="tag pin-tag">Rögzítve</span>' : ''}${fullLoad ? '<span class="tag full-load-tag">Teljes autó</span>' : ''}${resolved ? '<span class="tag resolved-tag">✓ Elintézve</span>' : ''}</div>
        <div class="bubble-actions"><button onclick="editOrder('${escHtml(first.id)}')">Szerkesztés</button><button onclick="v33OpenGroupItems('${escHtml(ids)}')">Tételek</button><button onclick="openCamera('${escHtml(first.id)}')">📷 Kamera</button></div>
        <button class="complete-button ${complete ? 'done' : ''}" onclick="v36ToggleGroupComplete('${escHtml(ids)}')">${complete ? '✓' : '○'}</button>
        <button class="trash" onclick="v33DeleteGroup('${escHtml(ids)}')">🗑</button>
      </article>
      ${fullLoad ? `<article class="bubble forced-drop-bubble"><div class="forced-drop-icon">↓</div><h3>Kötelező azonnali lerakás</h3><div class="bubble-main-line"><b>Lerakó:</b><span>${escHtml(group.projectName)}${group.dropAddress ? ` · ${escHtml(group.dropAddress)}` : ''}</span></div><div class="bubble-main-line"><b>Rendelésszám:</b><span>${escHtml(orderNos.join(', '))}</span></div><p>A sofőr csak ezután vehet fel újabb anyagot.</p></article>` : ''}
    </div>`;
  }

  function groupedBubbles(list, vehicleId, focus = false) {
    const groups = bubbleGroups(list);
    if (!groups.length) return '<div class="notice">Nincs fuvar.</div>';
    return groups.map((group, index) => renderGroupBubble(group, index, vehicleId, focus)).join('');
  }

  function ensureFocusDialog() {
    if (document.getElementById('v36DriverViewDialog')) return;
    const dialog = document.createElement('dialog');
    dialog.id = 'v36DriverViewDialog';
    dialog.className = 'driver-focus-dialog';
    dialog.innerHTML = `<div class="driver-focus-shell">
      <header class="driver-focus-head"><div><small>EGY SOFŐR NÉZETE</small><h2 id="v36FocusTitle">Sofőr</h2><p id="v36FocusSummary"></p></div><button type="button" class="driver-focus-close" aria-label="Bezárás">×</button></header>
      <div class="driver-focus-content"><div id="v36FocusMap" class="map driver-focus-map"></div><div id="v36FocusRoute" class="route-list driver-focus-route"></div></div>
    </div>`;
    document.body.appendChild(dialog);
    dialog.querySelector('.driver-focus-close').addEventListener('click', closeDriverView);
    dialog.addEventListener('cancel', event => { event.preventDefault(); closeDriverView(); });
    dialog.addEventListener('close', () => {
      focusVehicleId = '';
      if (focusMap) { focusMap.remove(); focusMap = null; }
      if (focusSortable) { focusSortable.destroy(); focusSortable = null; }
      renderRoutes();
    });
  }

  async function drawFocusMap(vehicleId) {
    const element = document.getElementById('v36FocusMap');
    if (!element || typeof L === 'undefined') return;
    if (focusMap) focusMap.remove();
    focusMap = L.map(element, { zoomControl: true }).setView([47.45, 19.04], 9);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(focusMap);
    let events = state.routePlans?.[selectedDate()]?.[vehicleId] || [];
    let pickups = events.filter(event => event.type === 'pickup');
    if (!pickups.length) {
      const seen = new Set(); pickups = [];
      for (const group of bubbleGroups(dayOrders(vehicleId))) {
        if (group.orders.every(isResolvedBacklogOrder) || seen.has(group.pickupKey)) continue;
        seen.add(group.pickupKey);
        pickups.push({ name: group.pickupName, address: group.pickupAddress, point: await geo(group.pickupAddress) });
      }
    } else {
      for (const event of pickups) if (!finitePoint(event.point)) event.point = await geo(event.address);
    }
    const points = [];
    pickups.filter(event => finitePoint(event.point)).forEach((event, index) => {
      points.push(event.point);
      const icon = L.divIcon({ className: 'v36-numbered-marker', html: `<span>${index + 1}</span>`, iconSize: [30, 30], iconAnchor: [15, 15] });
      L.marker(event.point, { icon, title: `${index + 1}. ${event.name}` }).addTo(focusMap).bindPopup(`<b>${index + 1}. Felrakó</b><br>${escHtml(event.name)}<br>${escHtml(event.address || '')}`);
    });
    if (points.length === 1) focusMap.setView(points[0], 13);
    if (points.length > 1) {
      const route = await roadRoute(points);
      const coords = route ? route.geometry.coordinates.map(coord => [coord[1], coord[0]]) : points;
      const line = L.polyline(coords, { weight: 5, opacity: 0.82 }).addTo(focusMap);
      focusMap.fitBounds(line.getBounds(), { padding: [28, 28] });
    }
    setTimeout(() => focusMap?.invalidateSize(), 80);
  }

  function updateSequencesFromContainer(container, vehicleId) {
    let sequence = 1;
    container.querySelectorAll('.route-block').forEach((block, index) => {
      const ids = String(block.dataset.orderIds || '').split(',').filter(Boolean);
      ids.forEach(id => {
        const order = state.orders.find(item => item.id === id);
        if (!order) return;
        order.vehicleId = vehicleId;
        order.sequence = sequence++;
        if (order.routePinned) {
          order.pinnedPosition = index + 1;
          order.pinnedVehicleId = vehicleId;
        }
      });
    });
  }

  function trackPointer(event) {
    const touch = event?.touches?.[0] || event?.changedTouches?.[0];
    const y = touch?.clientY ?? event?.clientY;
    if (Number.isFinite(y)) dragPointerY = y;
  }

  function autoScrollLoop() {
    if (!dragActive) { dragScrollFrame = 0; return; }
    const y = dragPointerY;
    if (Number.isFinite(y)) {
      const threshold = Math.min(190, window.innerHeight * 0.24);
      let amount = 0;
      if (y < threshold) amount = -Math.ceil(((threshold - y) / threshold) * 28);
      else if (y > window.innerHeight - threshold) amount = Math.ceil(((y - (window.innerHeight - threshold)) / threshold) * 28);
      if (amount) {
        if (dragScrollContainer && dragScrollContainer !== document.scrollingElement && dragScrollContainer !== document.documentElement) dragScrollContainer.scrollTop += amount;
        else window.scrollBy(0, amount);
      }
    }
    dragScrollFrame = requestAnimationFrame(autoScrollLoop);
  }

  function startDragScroll(event, container = null) {
    dragActive = true;
    dragScrollContainer = container || document.scrollingElement;
    trackPointer(event);
    if (!dragScrollFrame) dragScrollFrame = requestAnimationFrame(autoScrollLoop);
  }

  function stopDragScroll() {
    dragActive = false;
    dragPointerY = null;
    dragScrollContainer = null;
    if (dragScrollFrame) cancelAnimationFrame(dragScrollFrame);
    dragScrollFrame = 0;
  }

  if (typeof document !== 'undefined') {
    document.addEventListener('pointermove', event => dragActive && trackPointer(event), { passive: true, capture: true });
    document.addEventListener('touchmove', event => dragActive && trackPointer(event), { passive: true, capture: true });
  }

  function createSortable(element, vehicleId, focus = false) {
    if (!element || typeof Sortable === 'undefined') return null;
    return new Sortable(element, {
      group: focus ? `focus-${vehicleId}` : 'vehicles-v36',
      animation: 180,
      handle: '.drag',
      draggable: '.route-block:not(.resolved-backlog-block)',
      filter: '.resolved-backlog-block',
      scroll: true,
      bubbleScroll: true,
      forceAutoScrollFallback: true,
      scrollSensitivity: 170,
      scrollSpeed: 24,
      fallbackOnBody: true,
      delayOnTouchOnly: true,
      delay: 100,
      touchStartThreshold: 4,
      onStart: event => startDragScroll(event.originalEvent || event, focus ? document.querySelector('#v36DriverViewDialog .driver-focus-content') : document.scrollingElement),
      onMove: event => { trackPointer(event.originalEvent || event); return !event.related?.classList?.contains('resolved-backlog-block'); },
      onEnd: event => {
        stopDragScroll();
        if (focus) updateSequencesFromContainer(element, vehicleId);
        else {
          activeVehicles().forEach(vehicle => {
            const container = document.getElementById(`route-${vehicle.id}`);
            if (container) updateSequencesFromContainer(container, vehicle.id);
          });
        }
        state.routePlans = state.routePlans || {}; state.routePlans[selectedDate()] = {};
        save();
      }
    });
  }

  function v36InitSortables() {
    activeVehicles().forEach(vehicle => createSortable(document.getElementById(`route-${vehicle.id}`), vehicle.id, false));
  }

  function renderFocusView() {
    if (!focusVehicleId) return;
    const dialog = document.getElementById('v36DriverViewDialog');
    if (!dialog?.open) return;
    const vehicle = state.vehicles.find(item => item.id === focusVehicleId);
    const list = dayOrders(focusVehicleId).sort((a, b) => (+a.sequence || 999) - (+b.sequence || 999));
    document.getElementById('v36FocusTitle').textContent = vehicle?.driverName || 'Sofőr';
    document.getElementById('v36FocusSummary').textContent = `${vehicle?.name || ''} · ${bubbleGroups(list).length} fuvar · ${list.length} rendelés`;
    const container = document.getElementById('v36FocusRoute');
    container.innerHTML = groupedBubbles(list, focusVehicleId, true);
    if (focusSortable) focusSortable.destroy();
    focusSortable = createSortable(container, focusVehicleId, true);
    drawFocusMap(focusVehicleId);
  }

  function openDriverView(vehicleId) {
    ensureFocusDialog();
    focusVehicleId = vehicleId;
    const dialog = document.getElementById('v36DriverViewDialog');
    if (!dialog.open) dialog.showModal();
    renderFocusView();
  }

  function closeDriverView() {
    const dialog = document.getElementById('v36DriverViewDialog');
    if (dialog?.open) dialog.close();
  }

  function v36RenderRoutes() {
    syncAllBacklogStatuses();
    ensureFocusDialog();
    const vehicles = activeVehicles();
    document.querySelector('#routes').innerHTML = vehicles.map(vehicle => {
      const list = dayOrders(vehicle.id).sort((a, b) => (+a.sequence || 999) - (+b.sequence || 999));
      const groupCount = bubbleGroups(list).length;
      return `<section class="route" data-driver="${driverKey(vehicle)}"><header class="route-head"><div class="route-head-main"><div><h2><input value="${escHtml(vehicle.driverName)}" onchange="renameDriver('${escHtml(vehicle.id)}',this.value)"></h2><small>${escHtml(vehicle.name)} · ${escHtml(vehicle.type)} · ${groupCount} fuvar · ${list.length} rendelés</small></div><div class="route-view-actions"><button type="button" class="dropoff-button" onclick="v33OpenDropoffs('${escHtml(vehicle.id)}')">Lerakók</button><button type="button" class="driver-view-button" onclick="v36OpenDriverView('${escHtml(vehicle.id)}')">Nézet</button></div></div><div class="route-summary" id="summary-${escHtml(vehicle.id)}"></div></header><div id="map-${escHtml(vehicle.id)}" class="map"></div><div id="route-${escHtml(vehicle.id)}" class="route-list">${groupedBubbles(list, vehicle.id)}</div></section>`;
    }).join('') || '<div class="notice">Nincs aktív jármű.</div>';
    setTimeout(initMaps, 30);
    setTimeout(v36InitSortables, 40);
    setTimeout(updateSummaries, 60);
    setTimeout(renderFocusView, 80);
  }

  function v36TogglePin(idsCsv, vehicleId) {
    const ids = idsCsv.split(',').filter(Boolean);
    const orders = ids.map(id => state.orders.find(order => order.id === id)).filter(Boolean);
    const shouldPin = !orders.every(order => order.routePinned);
    const focusBlock = focusVehicleId === vehicleId
      ? document.querySelector(`#v36FocusRoute .route-block[data-order-ids="${CSS.escape(idsCsv)}"]`)
      : null;
    const block = focusBlock || document.querySelector(`#route-${CSS.escape(vehicleId)} .route-block[data-order-ids="${CSS.escape(idsCsv)}"]`);
    const position = block ? [...block.parentElement.querySelectorAll('.route-block')].indexOf(block) + 1 : Math.min(...orders.map(order => +order.sequence || 999));
    orders.forEach(order => {
      order.routePinned = shouldPin;
      order.pinnedPosition = shouldPin ? position : null;
      order.pinnedVehicleId = shouldPin ? vehicleId : '';
    });
    save();
  }

  function v36ToggleGroupComplete(idsCsv) {
    const orders = idsCsv.split(',').map(id => state.orders.find(order => order.id === id)).filter(Boolean);
    const complete = orders.every(order => order.completed);
    orders.forEach(order => {
      order.completed = !complete;
      order.completedAt = !complete ? new Date().toISOString() : '';
      (order.items || []).forEach(item => { item.received = !complete; if (!complete) item.missingQty = ''; });
      syncBacklogForOrder(order);
    });
    state.routePlans = state.routePlans || {}; state.routePlans[selectedDate()] = {};
    save();
  }

  function patchCompletionFunctions() {
    const oldToggleItem = global.toggleItem;
    global.toggleItem = (id, index, value) => {
      const order = state.orders.find(item => item.id === id);
      if (!order?.items?.[index]) return;
      order.items[index].received = !!value;
      if (value) order.items[index].missingQty = '';
      order.completed = order.items.length > 0 && order.items.every(item => item.received);
      syncBacklogForOrder(order);
      save(false);
      if (document.getElementById('itemsDialog')?.open) openItems(id);
      renderRoutes(); renderDriver(); renderBacklog();
    };
    const oldToggleComplete = global.toggleComplete || (typeof toggleComplete === 'function' ? toggleComplete : null);
    const replacement = id => {
      const order = state.orders.find(item => item.id === id);
      if (!order) return;
      order.completed = !order.completed;
      order.completedAt = order.completed ? new Date().toISOString() : '';
      (order.items || []).forEach(item => { item.received = order.completed; if (order.completed) item.missingQty = ''; });
      syncBacklogForOrder(order);
      state.routePlans = state.routePlans || {}; state.routePlans[selectedDate()] = {};
      save();
    };
    global.toggleComplete = replacement;
    try { toggleComplete = replacement; } catch (_) { /* globális függvény nem írható egyes tesztkörnyezetekben */ }
    return { oldToggleItem, oldToggleComplete };
  }

  function bindV36() {
    migrateRyngAddress();
    syncAllBacklogStatuses();
    ensureFocusDialog();
    patchCompletionFunctions();
    const optimizeButton = document.getElementById('optimizeBtn');
    if (optimizeButton) {
      optimizeButton.onclick = event => { event.preventDefault(); return v36OptimizeAction(); };
      optimizeButton.dataset.algorithmVersion = VERSION;
      optimizeButton.title = '2. lépés: felrakási sorrend optimalizálása sofőrönként eltérő útvonaliránnyal';
    }
    global.FUVARSZERVEZO_VERSION = VERSION;
    global.getFuvarszervezoDiagnostics = () => ({
      version: VERSION,
      optimizeHandler: optimizeButton?.dataset.algorithmVersion || null,
      routeDirection: 'Patrik: központból; Martin/Márió: lakhely felől',
      mapMode: 'csak felrakók',
      driverFocusView: true,
      resolvedBacklogExcluded: true,
      ryngAddress: RYNG_ADDRESS
    });
    render();
  }

  if (typeof renderRoutes !== 'undefined') renderRoutes = v36RenderRoutes;
  if (typeof initSortables !== 'undefined') initSortables = v36InitSortables;
  if (typeof optimizeAll !== 'undefined') optimizeAll = v36OptimizeAction;
  if (global.V35Planner) global.V35Planner.v35BuildRoutePlan = v36BuildRoutePlan;

  global.v36OpenDriverView = openDriverView;
  global.v36CloseDriverView = closeDriverView;
  global.v36TogglePin = v36TogglePin;
  global.v36ToggleGroupComplete = v36ToggleGroupComplete;
  global.V36Planner = {
    version: VERSION,
    RYNG_ADDRESS,
    applyDirectionalRules,
    isBacklogOrder,
    isResolvedBacklogOrder,
    syncBacklogForOrder,
    migrateRyngAddress,
    v36BuildRoutePlan,
    v36OptimizeAction
  };

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bindV36, { once: true });
    else bindV36();
  }
})(typeof window !== 'undefined' ? window : globalThis);
