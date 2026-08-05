/* Fuvarszervező V33
   - SERPA import utáni, felrakó-oldal alapú előbesorolás
   - Buda elsősorban Patrik, Pest elsősorban Márió, budai túlterhelésnél Martin besegít
   - rögzíthető buborékpozíciók
   - teljes autós, megszakíthatatlan felrakó -> lerakó blokk
   - az optimalizálás nem oszt át sofőrt
   - a térkép kizárólag felrakókat használ
*/
(function (global) {
  'use strict';

  const VERSION = '33';
  const CENTRAL_RE = /(\bkrpr\b|k[oö]zponti\s*rakt[aá]r|keresked[oő]\s*utca)/i;
  const FULL_LOAD_RE = /(teljes\s*(auto|autó|kocsi|kamion|rakom[aá]ny)|eg[eé]sz\s*(auto|autó|kocsi|kamion)|tele\s*(auto|autó|kocsi)|full\s*load|100\s*%\s*(kapacit[aá]s|rakom[aá]ny))/i;

  const nrm = value => {
    if (typeof norm === 'function') return norm(value || '');
    return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[_.,;:()[\]{}\/\\-]+/g, ' ').replace(/\s+/g, ' ').trim();
  };
  const escHtml = value => typeof esc === 'function' ? esc(value) : String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const finitePoint = point => Array.isArray(point) && Number.isFinite(+point[0]) && Number.isFinite(+point[1]);
  const km = (a, b) => {
    if (!finitePoint(a) || !finitePoint(b)) return 60;
    if (typeof v29Km === 'function') return v29Km(a, b);
    const R = 6371, rad = x => x * Math.PI / 180;
    const dLat = rad(b[0] - a[0]), dLon = rad(b[1] - a[1]);
    const q = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(q));
  };
  const driverKey = vehicle => {
    const value = nrm(vehicle?.driverName || '');
    if (value.includes('martin')) return 'martin';
    if (value.includes('mario')) return 'mario';
    if (value.includes('patrik')) return 'patrik';
    return 'other';
  };
  const supplierKey = order => nrm(order?.pickupName || order?.pickupAddress || 'ismeretlen felrako');
  const projectKey = order => nrm(order?.dropAddress || order?.projectName || 'ismeretlen lerako');
  const bubbleKey = order => `${supplierKey(order)}||${projectKey(order)}`;
  const isCentralOrder = order => CENTRAL_RE.test(`${order?.pickupName || ''} ${order?.pickupAddress || ''}`);
  const orderText = order => [
    order?.note, order?.pickupNote, order?.pickupName, order?.pickupAddress,
    ...(order?.items || []).flatMap(item => [item?.name, item?.itemNote, item?.itemRemark, item?.tetelMegjegyzes])
  ].filter(Boolean).join(' ');
  const isFullLoadOrder = order => {
    if (order?.fullLoadExplicit) return !!order.fullLoadManual;
    return !!order?.fullLoadManual || FULL_LOAD_RE.test(orderText(order));
  };
  const groupBy = (list, keyFn) => {
    const map = new Map();
    for (const item of list) {
      const key = keyFn(item);
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(item);
    }
    return map;
  };
  const groupWeight = group => {
    const itemCount = group.reduce((sum, order) => sum + (order.items?.length || 0), 0);
    const orderPart = 1 + Math.max(0, group.length - 1) * 0.35;
    const longPart = group.some(order => order.longMaterialReason) ? 2.6 : 0;
    const fullPart = group.some(isFullLoadOrder) ? 4.2 : 0;
    return orderPart + Math.min(1.5, itemCount * 0.05) + longPart + fullPart;
  };

  function ensureV33State() {
    if (typeof state === 'undefined') return;
    state.orders = state.orders || [];
    state.routePlans = state.routePlans || {};
    state.routeStats = state.routeStats || {};
    state.orders.forEach(order => {
      if (order.routePinned === undefined) order.routePinned = false;
      if (order.pinnedPosition === undefined) order.pinnedPosition = null;
      if (order.pinnedVehicleId === undefined) order.pinnedVehicleId = '';
      if (order.fullLoadManual === undefined) order.fullLoadManual = false;
      if (order.fullLoadExplicit === undefined) order.fullLoadExplicit = false;
    });
  }

  function pickupSideFromAddress(address = '') {
    const t = nrm(address);
    if (!t) return 'unknown';
    if (CENTRAL_RE.test(address) || t.includes('szigetszentmiklos') || t.includes('halasztelek')) return 'central';
    if (/(^|\s)(10[1-2]\d|11\d\d|122\d)(\s|$)/.test(t) || /budaors|torokbalint|budakeszi|biatorbagy|erd|budafok|nagyteteny|hengermalom|hunyadi janos/.test(t)) return 'buda';
    if (/(^|\s)(10[4-9]\d|11[3-9]\d|12[0-1]\d|123\d)(\s|$)/.test(t) || /kistarcsa|ullo|vecses|gyal|kispest|kobanya|rakospalota|kesmark|maglodi|kada|gyomroi|pesti hatar/.test(t)) return 'pest';
    return 'unknown';
  }

  function pickupSide(point, address = '') {
    if (finitePoint(point)) {
      const lat = +point[0], lng = +point[1];
      if (lat >= 47.25 && lat <= 47.75 && lng >= 18.70 && lng <= 19.45) return lng < 19.045 ? 'buda' : 'pest';
    }
    return pickupSideFromAddress(address);
  }

  function orderedBubbleGroups(orders) {
    return [...groupBy(orders, bubbleKey).entries()].map(([key, group]) => ({
      key,
      orders: group.slice().sort((a, b) => String(a.orderNo || '').localeCompare(String(b.orderNo || ''), 'hu')),
      pickupKey: supplierKey(group[0]),
      projectKey: projectKey(group[0]),
      pickupName: group[0]?.pickupName || 'Nincs megadva',
      pickupAddress: group[0]?.pickupAddress || '',
      projectName: group[0]?.projectName || 'Egyedi úticél',
      dropAddress: group[0]?.dropAddress || '',
      sequence: Math.min(...group.map(order => Number.isFinite(+order.sequence) ? +order.sequence : 999)),
      pinned: group.some(order => order.routePinned),
      pinnedPosition: Math.min(...group.map(order => Number.isFinite(+order.pinnedPosition) ? +order.pinnedPosition : 9999)),
      fullLoad: group.some(isFullLoadOrder)
    })).sort((a, b) => a.sequence - b.sequence || a.key.localeCompare(b.key, 'hu'));
  }

  function applyPinnedPositions(groups, vehicleId) {
    const count = groups.length;
    if (!count) return [];
    const slots = new Array(count).fill(null);
    const pinned = groups.filter(group => group.pinned && group.orders.some(order => !order.pinnedVehicleId || order.pinnedVehicleId === vehicleId));
    const free = groups.filter(group => !pinned.includes(group));
    const nearestEmpty = wanted => {
      if (!slots[wanted]) return wanted;
      for (let delta = 1; delta < count; delta++) {
        const right = wanted + delta, left = wanted - delta;
        if (right < count && !slots[right]) return right;
        if (left >= 0 && !slots[left]) return left;
      }
      return slots.findIndex(value => !value);
    };
    pinned.sort((a, b) => a.pinnedPosition - b.pinnedPosition || a.sequence - b.sequence).forEach(group => {
      const wanted = Math.max(0, Math.min(count - 1, (Number.isFinite(group.pinnedPosition) ? group.pinnedPosition : group.sequence) - 1));
      const slot = nearestEmpty(wanted);
      if (slot >= 0) slots[slot] = group;
    });
    let freeIndex = 0;
    for (let i = 0; i < count; i++) if (!slots[i]) slots[i] = free[freeIndex++];
    return slots.filter(Boolean);
  }

  function applyGroupSequence(groups, vehicleId) {
    let sequence = 1;
    groups.forEach((group, index) => {
      group.orders.forEach(order => {
        order.vehicleId = vehicleId;
        order.sequence = sequence++;
        if (order.routePinned) {
          order.pinnedPosition = index + 1;
          order.pinnedVehicleId = vehicleId;
        }
      });
    });
  }

  function unitPoint(group, profiles, type = 'pickup') {
    for (const order of group) {
      const point = profiles?.[order.id]?.[type];
      if (finitePoint(point)) return point;
    }
    return null;
  }

  async function profileOrders(orders) {
    const profiles = {};
    for (const order of orders) {
      if (typeof syncOrderFromMasters === 'function') syncOrderFromMasters(order);
      profiles[order.id] = typeof orderGeoProfile === 'function' ? await orderGeoProfile(order) : { pickup: await geo(order.pickupAddress), drop: await geo(order.dropAddress) };
    }
    return profiles;
  }

  function routeFitCost(vehicle, group, profiles, currentGroups) {
    const key = driverKey(vehicle);
    const pickup = unitPoint(group, profiles, 'pickup');
    const base = finitePoint(profiles.__base) ? profiles.__base : null;
    let anchor = null;
    if ((key === 'patrik' || key === 'martin') && base) anchor = base;
    const existing = currentGroups.flatMap(item => item);
    const samePickup = existing.some(order => supplierKey(order) === supplierKey(group[0])) ? -8 : 0;
    const sameProject = existing.some(order => projectKey(order) === projectKey(group[0])) ? -5 : 0;
    return km(anchor || pickup, pickup) + samePickup + sameProject;
  }

  async function distributeOrderSet(orders, options = {}) {
    const drivers = (options.drivers || activeVehicles()).slice();
    if (!drivers.length) throw new Error('Nincs aktív jármű.');
    const profiles = await profileOrders(orders);
    profiles.__base = typeof geo === 'function' ? await geo(state.settings.baseAddress) : null;
    const assigned = Object.fromEntries(drivers.map(vehicle => [vehicle.id, []]));
    const load = Object.fromEntries(drivers.map(vehicle => [vehicle.id, 0]));
    const mario = drivers.find(vehicle => driverKey(vehicle) === 'mario');
    const patrik = drivers.find(vehicle => driverKey(vehicle) === 'patrik');
    const martin = drivers.find(vehicle => driverKey(vehicle) === 'martin');
    const longVehicle = martin && typeof canCarryLong === 'function' && canCarryLong(martin) ? martin : drivers.find(vehicle => typeof canCarryLong !== 'function' || canCarryLong(vehicle));

    const groups = [...groupBy(orders, bubbleKey).values()].sort((a, b) => groupWeight(b) - groupWeight(a));
    const fixedGroups = [], budaGroups = [], pestGroups = [], neutralGroups = [];

    for (const group of groups) {
      const pinnedVehicleId = group.find(order => order.routePinned && order.pinnedVehicleId)?.pinnedVehicleId;
      const explicitlyLocked = group.find(order => order.importVehicleLocked && order.vehicleId)?.vehicleId;
      if (pinnedVehicleId || explicitlyLocked) {
        fixedGroups.push({ group, vehicleId: pinnedVehicleId || explicitlyLocked });
        continue;
      }
      if (group.some(order => order.longMaterialReason || order.markedMartin)) {
        fixedGroups.push({ group, vehicleId: longVehicle?.id || martin?.id || drivers[0].id });
        continue;
      }
      const point = unitPoint(group, profiles, 'pickup');
      const side = isCentralOrder(group[0]) ? 'central' : pickupSide(point, group[0]?.pickupAddress);
      if (side === 'buda') budaGroups.push(group);
      else if (side === 'pest') pestGroups.push(group);
      else neutralGroups.push(group);
    }

    const assignGroup = (group, vehicle) => {
      if (!vehicle) vehicle = drivers.slice().sort((a, b) => load[a.id] - load[b.id])[0];
      group.forEach(order => { order.vehicleId = vehicle.id; assigned[vehicle.id].push(order); });
      load[vehicle.id] += groupWeight(group);
    };

    fixedGroups.forEach(item => assignGroup(item.group, drivers.find(vehicle => vehicle.id === item.vehicleId) || drivers[0]));
    budaGroups.forEach(group => assignGroup(group, patrik || martin || drivers[0]));
    pestGroups.forEach(group => assignGroup(group, mario || drivers[0]));

    const totalWeight = groups.reduce((sum, group) => sum + groupWeight(group), 0);
    const target = totalWeight / Math.max(1, drivers.length);
    const martinLongWeight = martin ? [...groupBy(assigned[martin.id].filter(order => order.longMaterialReason), bubbleKey).values()].reduce((sum, group) => sum + groupWeight(group), 0) : Infinity;
    const martinCanHelp = !!martin && martinLongWeight <= target * 0.8;

    if (patrik && martinCanHelp) {
      const movable = budaGroups.filter(group => !group.some(order => order.routePinned || order.importVehicleLocked)).slice().sort((a, b) => {
        const aCost = routeFitCost(martin, a, profiles, assigned[martin.id]);
        const bCost = routeFitCost(martin, b, profiles, assigned[martin.id]);
        return aCost - bCost || groupWeight(a) - groupWeight(b);
      });
      while (movable.length && load[patrik.id] > Math.max(target * 1.25, load[martin.id] + 2.2)) {
        const group = movable.shift();
        const weight = groupWeight(group);
        group.forEach(order => {
          assigned[patrik.id] = assigned[patrik.id].filter(item => item.id !== order.id);
          order.vehicleId = martin.id;
          assigned[martin.id].push(order);
        });
        load[patrik.id] -= weight;
        load[martin.id] += weight;
      }
    }

    neutralGroups.sort((a, b) => groupWeight(b) - groupWeight(a)).forEach(group => {
      const eligible = drivers.filter(vehicle => !group.some(order => order.longMaterialReason) || (typeof canCarryLong !== 'function' || canCarryLong(vehicle)));
      const ranked = eligible.map(vehicle => ({
        vehicle,
        score: load[vehicle.id] + routeFitCost(vehicle, group, profiles, assigned[vehicle.id]) * 0.12
      })).sort((a, b) => a.score - b.score);
      assignGroup(group, ranked[0]?.vehicle);
    });

    Object.values(assigned).forEach(list => list.sort((a, b) => supplierKey(a).localeCompare(supplierKey(b), 'hu') || projectKey(a).localeCompare(projectKey(b), 'hu')).forEach((order, index) => { order.sequence = index + 1; }));
    return { assigned, load, profiles, target };
  }

  async function v33DistributeCurrentDay() {
    ensureV33State();
    const orders = state.orders.filter(order => order.scheduleDate === selectedDate());
    if (!orders.length) throw new Error('Nincs szétosztható fuvar az adott napon.');
    const result = await distributeOrderSet(orders);
    state.routePlans[selectedDate()] = {};
    state.routeStats[selectedDate()] = {};
    for (const vehicle of activeVehicles()) state.routePlans[selectedDate()][vehicle.id] = [];
    return result;
  }

  async function v33PreassignImportedOrders(orders) {
    ensureV33State();
    const byDate = groupBy(orders, order => order.scheduleDate || 'datum-nelkul');
    const results = [];
    for (const dateOrders of byDate.values()) results.push(await distributeOrderSet(dateOrders));
    return results;
  }

  function rebuildRouteEvents(vehicleId, groups, baseEvents) {
    const pickupBySupplier = new Map((baseEvents || []).filter(event => event.type === 'pickup').map(event => [event.key, event]));
    const dropByProject = new Map((baseEvents || []).filter(event => event.type === 'drop').map(event => [event.key, event]));
    const events = [], seenPickups = new Set(), immediateDrops = new Set();

    for (const group of groups) {
      const pickupKey = group.pickupKey;
      if (!seenPickups.has(pickupKey)) {
        const source = pickupBySupplier.get(pickupKey);
        events.push(source || {
          type: 'pickup', key: pickupKey, name: group.pickupName, address: group.pickupAddress,
          orders: group.orders.map(order => order.id), point: null
        });
        seenPickups.add(pickupKey);
      }
      if (group.fullLoad) {
        const source = dropByProject.get(group.projectKey);
        events.push({
          ...(source || {}), type: 'drop', key: group.projectKey, name: group.projectName,
          address: group.dropAddress, orders: group.orders.map(order => order.id), fullLoad: true,
          point: source?.point || null
        });
        immediateDrops.add(group.projectKey);
      }
    }
    for (const event of (baseEvents || []).filter(event => event.type === 'drop')) {
      if (!immediateDrops.has(event.key)) events.push(event);
    }
    state.routePlans[selectedDate()] = state.routePlans[selectedDate()] || {};
    state.routePlans[selectedDate()][vehicleId] = events;
    return events;
  }

  async function v33BuildRoutePlan(vehicleId) {
    ensureV33State();
    const orders = dayOrders(vehicleId).slice();
    if (!orders.length) {
      state.routePlans[selectedDate()] = state.routePlans[selectedDate()] || {};
      state.routePlans[selectedDate()][vehicleId] = [];
      return [];
    }
    const originals = new Map();
    orders.forEach(order => {
      originals.set(order.id, order.note || '');
      if (order.fullLoadManual && !FULL_LOAD_RE.test(order.note || '')) order.note = `${order.note || ''} teljes autónyi rakomány`.trim();
    });
    let baseEvents = [];
    try {
      if (!global.V32Planner?.v32BuildRoutePlan) throw new Error('A V32 útvonalmotor nem érhető el.');
      baseEvents = await global.V32Planner.v32BuildRoutePlan(vehicleId);
    } finally {
      orders.forEach(order => { order.note = originals.get(order.id) || ''; });
    }
    const groups = applyPinnedPositions(orderedBubbleGroups(orders), vehicleId);
    applyGroupSequence(groups, vehicleId);
    return rebuildRouteEvents(vehicleId, groups, baseEvents);
  }

  async function v33BalanceAction() {
    try {
      const result = await v33DistributeCurrentDay();
      save();
      const counts = activeVehicles().map(vehicle => {
        const groups = orderedBubbleGroups(dayOrders(vehicle.id));
        return `${vehicle.driverName}: ${groups.length} fuvar / ${dayOrders(vehicle.id).length} rendelés`;
      }).join(', ');
      alert(`Fuvarok szétosztva a felrakók oldala és a súlyozott terhelés alapján. ${counts}\nAz útvonal sorrendjéhez nyomd meg az „Útvonal optimalizálása” gombot.`);
      return result;
    } catch (error) {
      console.error('[V33] Szétosztási hiba', error);
      alert(`A fuvarok szétosztása közben hiba történt: ${error?.message || error}`);
      return null;
    }
  }

  async function v33OptimizeAction() {
    try {
      const before = new Map(state.orders.filter(order => order.scheduleDate === selectedDate()).map(order => [order.id, order.vehicleId]));
      for (const vehicle of activeVehicles()) await v33BuildRoutePlan(vehicle.id);
      const changed = state.orders.filter(order => order.scheduleDate === selectedDate() && before.get(order.id) !== order.vehicleId);
      if (changed.length) throw new Error('Az optimalizálás sofőrt változtatott, ezért a művelet vissza lett utasítva.');
      save();
      alert('Útvonal-optimalizálás befejezve. A rögzített buborékok a helyükön maradtak, a sofőrök kiosztása nem változott.');
      return true;
    } catch (error) {
      console.error('[V33] Optimalizálási hiba', error);
      alert(`Az optimalizálás közben hiba történt: ${error?.message || error}`);
      return false;
    }
  }

  function groupIdsAttribute(group) {
    return group.orders.map(order => order.id).join(',');
  }

  function renderGroupBubble(group, index, vehicleId) {
    const ids = groupIdsAttribute(group);
    const orderNos = [...new Set(group.orders.map(order => order.orderNo).filter(Boolean))];
    const itemCount = group.orders.reduce((sum, order) => sum + (order.items?.length || 0), 0);
    const longReasons = [...new Set(group.orders.map(order => order.longMaterialReason).filter(Boolean))];
    const complete = group.orders.every(order => order.completed);
    const pinned = group.orders.some(order => order.routePinned);
    const fullLoad = group.fullLoad;
    const first = group.orders[0];
    const warnings = typeof masterWarnings === 'function' ? group.orders.map(masterWarnings).filter(Boolean).join('') : '';
    return `<div class="route-block ${pinned ? 'pinned-block' : ''} ${fullLoad ? 'full-load-block' : ''}" data-group-key="${escHtml(group.key)}" data-order-ids="${escHtml(ids)}">
      <article class="bubble grouped-bubble ${complete ? 'done' : ''}" data-id="${escHtml(first.id)}">
        <span class="drag" title="Húzás">☷</span>
        <div class="bubble-control-row">
          <button type="button" class="pin-button ${pinned ? 'active' : ''}" onclick="event.stopPropagation();v33TogglePin('${escHtml(ids)}','${escHtml(vehicleId)}')" title="${pinned ? 'Rögzítés feloldása' : 'Pozíció rögzítése'}">⚑</button>
          <button type="button" class="full-load-button ${fullLoad ? 'active' : ''}" onclick="event.stopPropagation();v33ToggleFullLoad('${escHtml(ids)}')" title="Teljes autós rakomány">🚚</button>
        </div>
        <h3>${index + 1}. ${escHtml(group.pickupName)}</h3>
        ${warnings}
        <div class="bubble-main-line"><b>Felrakó:</b><span>${escHtml(group.pickupName)}${group.pickupAddress ? ` · ${escHtml(group.pickupAddress)}` : ''}</span></div>
        <div class="bubble-main-line"><b>Lerakó:</b><span>${escHtml(group.projectName)}${group.dropAddress ? ` · ${escHtml(group.dropAddress)}` : ''}</span></div>
        <div class="bubble-main-line order-number-line"><b>Rendelésszám:</b><span>${escHtml(orderNos.join(', ') || 'Nincs megadva')}</span></div>
        <div class="tags"><span class="tag">${group.orders.length} rendelés</span><span class="tag">${itemCount} tétel</span>${longReasons.map(reason => `<span class="tag long">${escHtml(reason)}</span>`).join('')}${pinned ? '<span class="tag pin-tag">Rögzítve</span>' : ''}${fullLoad ? '<span class="tag full-load-tag">Teljes autó</span>' : ''}</div>
        <div class="bubble-actions"><button onclick="editOrder('${escHtml(first.id)}')">Szerkesztés</button><button onclick="v33OpenGroupItems('${escHtml(ids)}')">Tételek</button><button onclick="openCamera('${escHtml(first.id)}')">📷 Kamera</button></div>
        <button class="complete-button ${complete ? 'done' : ''}" onclick="v33ToggleGroupComplete('${escHtml(ids)}')">${complete ? '✓' : '○'}</button>
        <button class="trash" onclick="v33DeleteGroup('${escHtml(ids)}')">🗑</button>
      </article>
      ${fullLoad ? `<article class="bubble forced-drop-bubble"><div class="forced-drop-icon">↓</div><h3>Kötelező azonnali lerakás</h3><div class="bubble-main-line"><b>Lerakó:</b><span>${escHtml(group.projectName)}${group.dropAddress ? ` · ${escHtml(group.dropAddress)}` : ''}</span></div><div class="bubble-main-line"><b>Rendelésszám:</b><span>${escHtml(orderNos.join(', '))}</span></div><p>A sofőr csak ezután vehet fel újabb anyagot.</p></article>` : ''}
    </div>`;
  }

  function groupedBubbles(list, vehicleId) {
    const groups = orderedBubbleGroups(list);
    if (!groups.length) return '<div class="notice">Nincs fuvar.</div>';
    return groups.map((group, index) => renderGroupBubble(group, index, vehicleId)).join('');
  }

  function ensureDropoffDialog() {
    if (typeof document === 'undefined' || document.getElementById('v33DropoffDialog')) return;
    const dialog = document.createElement('dialog');
    dialog.id = 'v33DropoffDialog';
    dialog.innerHTML = `<div class="dialog-body"><div class="dialog-head"><div><small>LERAKÓK</small><h3 id="v33DropoffTitle">Lerakási sorrend</h3></div><button type="button" class="close" onclick="document.getElementById('v33DropoffDialog').close()">×</button></div><div id="v33DropoffBody"></div></div>`;
    document.body.appendChild(dialog);
  }

  function v33RenderRoutes() {
    ensureV33State();
    ensureDropoffDialog();
    const vehicles = activeVehicles();
    document.querySelector('#routes').innerHTML = vehicles.map(vehicle => {
      const list = dayOrders(vehicle.id).sort((a, b) => (+a.sequence || 999) - (+b.sequence || 999));
      const groupCount = orderedBubbleGroups(list).length;
      return `<section class="route" data-driver="${driverKey(vehicle)}"><header class="route-head"><div class="route-head-main"><div><h2><input value="${escHtml(vehicle.driverName)}" onchange="renameDriver('${escHtml(vehicle.id)}',this.value)"></h2><small>${escHtml(vehicle.name)} · ${escHtml(vehicle.type)} · ${groupCount} fuvar · ${list.length} rendelés</small></div><button type="button" class="dropoff-button" onclick="v33OpenDropoffs('${escHtml(vehicle.id)}')">Lerakók</button></div><div class="route-summary" id="summary-${escHtml(vehicle.id)}"></div></header><div id="map-${escHtml(vehicle.id)}" class="map"></div><div id="route-${escHtml(vehicle.id)}" class="route-list">${groupedBubbles(list, vehicle.id)}</div></section>`;
    }).join('') || '<div class="notice">Nincs aktív jármű.</div>';
    setTimeout(initMaps, 30);
    setTimeout(initSortables, 40);
    setTimeout(updateSummaries, 60);
  }

  async function v33DrawMap(vehicleId) {
    const map = maps[vehicleId];
    if (!map) return;
    const date = selectedDate();
    let events = state.routePlans?.[date]?.[vehicleId] || [];
    let pickups = events.filter(event => event.type === 'pickup');
    if (!pickups.length) {
      const groups = orderedBubbleGroups(dayOrders(vehicleId));
      const seen = new Set();
      pickups = [];
      for (const group of groups) {
        if (seen.has(group.pickupKey)) continue;
        seen.add(group.pickupKey);
        const point = await geo(group.pickupAddress);
        pickups.push({ type: 'pickup', key: group.pickupKey, name: group.pickupName, address: group.pickupAddress, point, orders: group.orders.map(order => order.id) });
      }
    } else {
      for (const event of pickups) if (!finitePoint(event.point)) event.point = await geo(event.address);
    }
    const unique = [], seen = new Set();
    for (const event of pickups) {
      const key = nrm(event.address || event.name);
      if (seen.has(key) || !finitePoint(event.point)) continue;
      seen.add(key); unique.push(event);
    }
    const points = [];
    unique.forEach((event, index) => {
      points.push(event.point);
      L.marker(event.point, { title: `${index + 1}. Felrakó: ${event.name}` }).addTo(map).bindPopup(`<b>${index + 1}. Felrakó</b><br>${escHtml(event.name)}<br>${escHtml(event.address || '')}`);
    });
    if (points.length === 1) map.setView(points[0], 13);
    if (points.length > 1) {
      const route = await roadRoute(points);
      const coords = route ? route.geometry.coordinates.map(coord => [coord[1], coord[0]]) : points;
      const line = L.polyline(coords, { weight: 4 }).addTo(map);
      map.fitBounds(line.getBounds(), { padding: [20, 20] });
      state.routeStats = state.routeStats || {};
      state.routeStats[date] = state.routeStats[date] || {};
      state.routeStats[date][vehicleId] = { km: route ? route.distance / 1000 : 0, minutes: route ? route.duration / 60 : 0, pickupOnly: true };
      localStorage.setItem(KEY, JSON.stringify(state));
    }
  }

  function updateSequencesFromDom() {
    activeVehicles().forEach(vehicle => {
      let sequence = 1;
      document.querySelectorAll(`#route-${CSS.escape(vehicle.id)} .route-block`).forEach((block, index) => {
        const ids = String(block.dataset.orderIds || '').split(',').filter(Boolean);
        ids.forEach(id => {
          const order = state.orders.find(item => item.id === id);
          if (!order) return;
          order.vehicleId = vehicle.id;
          order.sequence = sequence++;
          if (order.routePinned) {
            order.pinnedPosition = index + 1;
            order.pinnedVehicleId = vehicle.id;
          }
        });
      });
    });
  }

  function v33InitSortables() {
    activeVehicles().forEach(vehicle => {
      const element = document.querySelector(`#route-${CSS.escape(vehicle.id)}`);
      if (!element) return;
      new Sortable(element, {
        group: 'vehicles-v33', animation: 180, handle: '.drag', draggable: '.route-block',
        scroll: true, bubbleScroll: true, scrollSensitivity: 120, scrollSpeed: 20,
        fallbackOnBody: true, delayOnTouchOnly: true, delay: 120, touchStartThreshold: 4,
        onStart: event => {
          if (typeof v25DragActive !== 'undefined') v25DragActive = true;
          if (typeof v25TrackPointer === 'function') v25TrackPointer(event.originalEvent || {});
          if (typeof v25ScrollFrame !== 'undefined' && !v25ScrollFrame && typeof v25AutoScrollLoop === 'function') v25ScrollFrame = requestAnimationFrame(v25AutoScrollLoop);
        },
        onMove: event => { if (typeof v25TrackPointer === 'function') v25TrackPointer(event.originalEvent || {}); return true; },
        onEnd: () => {
          if (typeof v25DragActive !== 'undefined') v25DragActive = false;
          if (typeof v25ScrollFrame !== 'undefined' && v25ScrollFrame) { cancelAnimationFrame(v25ScrollFrame); v25ScrollFrame = 0; }
          updateSequencesFromDom();
          state.routePlans[selectedDate()] = {};
          save();
        }
      });
    });
  }

  function v33OpenDropoffs(vehicleId) {
    ensureDropoffDialog();
    const vehicle = state.vehicles.find(item => item.id === vehicleId);
    const events = state.routePlans?.[selectedDate()]?.[vehicleId] || [];
    let drops = events.filter(event => event.type === 'drop');
    if (!drops.length) {
      drops = [...groupBy(dayOrders(vehicleId).sort((a, b) => (+a.sequence || 999) - (+b.sequence || 999)), projectKey).entries()].map(([key, orders]) => ({ key, name: orders[0]?.projectName || 'Lerakó', address: orders[0]?.dropAddress || '', orders: orders.map(order => order.id) }));
    }
    document.querySelector('#v33DropoffTitle').textContent = `${vehicle?.driverName || 'Sofőr'} · lerakók`;
    document.querySelector('#v33DropoffBody').innerHTML = drops.length ? `<div class="dropoff-summary-list">${drops.map((event, index) => {
      const orderNos = [...new Set((event.orders || []).map(id => state.orders.find(order => order.id === id)?.orderNo).filter(Boolean))];
      return `<div class="dropoff-stop"><b>${index + 1}. ${escHtml(event.name)}</b><span>${escHtml(event.address || '')}</span><span>Rendelés: ${escHtml(orderNos.join(', '))}</span>${event.fullLoad ? '<span class="full-load-panel-note">Teljes autós, azonnali lerakás</span>' : ''}</div>`;
    }).join('')}</div>` : '<div class="notice">Nincs lerakó az adott napon.</div>';
    document.querySelector('#v33DropoffDialog').showModal();
  }

  function v33TogglePin(idsCsv, vehicleId) {
    const ids = idsCsv.split(',').filter(Boolean), orders = ids.map(id => state.orders.find(order => order.id === id)).filter(Boolean);
    const shouldPin = !orders.every(order => order.routePinned);
    const block = document.querySelector(`.route-block[data-order-ids="${CSS.escape(idsCsv)}"]`);
    const position = block ? [...block.parentElement.querySelectorAll('.route-block')].indexOf(block) + 1 : Math.min(...orders.map(order => +order.sequence || 999));
    orders.forEach(order => {
      order.routePinned = shouldPin;
      order.pinnedPosition = shouldPin ? position : null;
      order.pinnedVehicleId = shouldPin ? (vehicleId || order.vehicleId) : '';
    });
    save();
  }

  function v33ToggleFullLoad(idsCsv) {
    const orders = idsCsv.split(',').map(id => state.orders.find(order => order.id === id)).filter(Boolean);
    const currentlyFull = orders.every(isFullLoadOrder);
    orders.forEach(order => { order.fullLoadExplicit = true; order.fullLoadManual = !currentlyFull; });
    state.routePlans[selectedDate()] = {};
    save();
  }

  function v33ToggleGroupComplete(idsCsv) {
    const orders = idsCsv.split(',').map(id => state.orders.find(order => order.id === id)).filter(Boolean);
    const complete = orders.every(order => order.completed);
    orders.forEach(order => {
      order.completed = !complete;
      (order.items || []).forEach(item => { item.received = !complete; });
    });
    save();
  }

  function v33DeleteGroup(idsCsv) {
    const ids = idsCsv.split(',').filter(Boolean);
    if (!confirm(`${ids.length} rendelés törlése ebből a fuvarbuborékból?`)) return;
    state.orders = state.orders.filter(order => !ids.includes(order.id));
    state.routePlans[selectedDate()] = {};
    save();
  }

  function v33OpenGroupItems(idsCsv) {
    const orders = idsCsv.split(',').map(id => state.orders.find(order => order.id === id)).filter(Boolean);
    if (!orders.length) return;
    currentItemsOrderId = orders[0].id;
    document.querySelector('#itemsTitle').textContent = `${orders.length} rendelés · tételek`;
    document.querySelector('#itemMovePanel').innerHTML = '<p>A tételek rendelési számonként elkülönítve láthatók. Dátumos áthelyezéshez nyisd meg az adott rendelést külön.</p>';
    document.querySelector('#itemsBody').innerHTML = orders.map(order => {
      (order.items || []).forEach(item => typeof ensureItemId === 'function' && ensureItemId(item));
      return `<section class="group-order-section"><div class="group-order-head"><div><b>Rendelés: ${escHtml(order.orderNo || 'Nincs szám')}</b><small>${escHtml(order.pickupName || '')} → ${escHtml(order.projectName || order.dropAddress || '')}</small></div><button type="button" class="secondary" onclick="openItems('${escHtml(order.id)}')">Megnyitás külön</button></div>${(order.items || []).map((item, index) => `<div class="item-row ${item.received ? 'done' : ''}"><input type="checkbox" ${item.received ? 'checked' : ''} onchange="toggleItem('${escHtml(order.id)}',${index},this.checked)"><div><b class="item-name">${escHtml(item.name)}</b><br>${escHtml(item.code)} · ${escHtml(item.qty)} ${escHtml(item.unit)} ${item.longMaterial ? '· hosszú szál' : ''}<div class="missing-qty-wrap ${item.received ? 'hidden' : ''}"><label>Nem kaptam meg – mennyiség<input class="missing-qty-input" type="number" min="0" step="any" value="${escHtml(item.missingQty || '')}" oninput="updateMissingQty('${escHtml(order.id)}',${index},this.value)"></label></div><label class="item-note-edit">Tétel megjegyzés<textarea placeholder="Nincs megjegyzés" oninput="updateItemNote('${escHtml(order.id)}',${index},this.value)">${escHtml(typeof itemNoteValue === 'function' ? itemNoteValue(item) : item.itemNote || '')}</textarea></label></div></div>`).join('') || '<div class="notice">Nincs tétel.</div>'}</section>`;
    }).join('');
    if (!document.querySelector('#itemsDialog').open) document.querySelector('#itemsDialog').showModal();
  }

  async function v33FinalizeImport() {
    try {
      if (!Array.isArray(importOrders) || !importOrders.length) return;
      await v33PreassignImportedOrders(importOrders);
      state.orders.push(...importOrders);
      const counts = activeVehicles().map(vehicle => `${vehicle.driverName}: ${importOrders.filter(order => order.vehicleId === vehicle.id).length}`).join(', ');
      importOrders = [];
      document.querySelector('#importDialog').close();
      save();
      alert(`Import beillesztve és előbesorolva a felrakók oldala alapján. ${counts}`);
    } catch (error) {
      console.error('[V33] Import besorolási hiba', error);
      alert(`Az import előbesorolása közben hiba történt: ${error?.message || error}`);
    }
  }

  function v33SaveReview() {
    const order = reviewQueue[reviewIndex];
    const project = state.projects.find(item => item.id === document.querySelector('#rvProject').value);
    const supplier = state.suppliers.find(item => item.id === document.querySelector('#rvSupplier').value);
    order.projectId = project?.id || '';
    order.projectName = project?.name || order.topicName || '';
    order.dropAddress = document.querySelector('#rvDrop').value;
    order.supplierId = supplier?.id || '';
    order.pickupName = supplier?.name || order.pickupName;
    order.pickupAddress = document.querySelector('#rvPickup').value;
    order.vehicleId = document.querySelector('#rvVehicle').value || '';
    order.importVehicleLocked = !!order.vehicleId;
    order.note = document.querySelector('#rvNote').value;
    if (project) state.aliases.projects[nrm(order.topicName)] = project.id;
    if (supplier) state.aliases.suppliers[nrm(order.pickupName)] = supplier.id;
    reviewIndex++;
    if (reviewIndex >= reviewQueue.length) {
      document.querySelector('#reviewDialog').close();
      v33FinalizeImport();
    } else showReview();
  }

  function bindV33() {
    ensureV33State();
    if (typeof document === 'undefined') return;
    ensureDropoffDialog();
    const balanceButton = document.getElementById('balanceBtn');
    const optimizeButton = document.getElementById('optimizeBtn');
    if (balanceButton) {
      balanceButton.onclick = event => { event.preventDefault(); return v33BalanceAction(); };
      balanceButton.dataset.algorithmVersion = VERSION;
      balanceButton.title = '1. lépés: felrakó-oldal és súlyozott terhelés szerinti szétosztás';
    }
    if (optimizeButton) {
      optimizeButton.onclick = event => { event.preventDefault(); return v33OptimizeAction(); };
      optimizeButton.dataset.algorithmVersion = VERSION;
      optimizeButton.title = '2. lépés: sorrend optimalizálása a rögzített buborékok megtartásával';
    }
    const help = document.querySelector('#importDialog .help');
    if (help) help.textContent = 'SERPA import után a program a felrakó helye alapján előbesorol: Buda elsősorban Patrik, Pest elsősorban Márió, hosszú/szálas anyag Martin. Budai túlterhelésnél Martin besegíthet, ha nincs sok szálas anyaga.';
    global.FUVARSZERVEZO_VERSION = VERSION;
    global.getFuvarszervezoDiagnostics = () => ({
      version: VERSION,
      balanceHandler: balanceButton?.dataset.algorithmVersion || null,
      optimizeHandler: optimizeButton?.dataset.algorithmVersion || null,
      mapMode: 'pickup-only',
      grouping: 'pickup+drop',
      pinning: true,
      fullLoadBlocks: true
    });
    setTimeout(() => render(), 0);
  }

  // Globális felülírások: a régi verziók kódja bent marad, de ezek a V33 belépési pontok futnak.
  if (typeof renderRoutes !== 'undefined') renderRoutes = v33RenderRoutes;
  if (typeof drawMap !== 'undefined') drawMap = v33DrawMap;
  if (typeof initSortables !== 'undefined') initSortables = v33InitSortables;
  if (typeof balance !== 'undefined') balance = v33BalanceAction;
  if (typeof optimizeAll !== 'undefined') optimizeAll = v33OptimizeAction;
  if (typeof needsReview !== 'undefined') needsReview = order => !order.projectId || !order.supplierId || !order.pickupAddress || !order.dropAddress;
  if (typeof finalizeImport !== 'undefined') finalizeImport = v33FinalizeImport;
  if (typeof saveReview !== 'undefined') saveReview = v33SaveReview;

  global.v33OpenDropoffs = v33OpenDropoffs;
  global.v33TogglePin = v33TogglePin;
  global.v33ToggleFullLoad = v33ToggleFullLoad;
  global.v33ToggleGroupComplete = v33ToggleGroupComplete;
  global.v33DeleteGroup = v33DeleteGroup;
  global.v33OpenGroupItems = v33OpenGroupItems;
  global.V33Planner = {
    version: VERSION,
    pickupSide,
    pickupSideFromAddress,
    isFullLoadOrder,
    groupWeight,
    orderedBubbleGroups,
    applyPinnedPositions,
    distributeOrderSet,
    v33DistributeCurrentDay,
    v33PreassignImportedOrders,
    v33BuildRoutePlan,
    v33BalanceAction,
    v33OptimizeAction
  };

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bindV33, { once: true });
    else bindV33();
  }
})(typeof window !== 'undefined' ? window : globalThis);
