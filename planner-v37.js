/* Fuvarszervező V37
   Felület- és munkafolyamat-javítások a V35 stabil motorjára építve.

   - Sofőrönként eltérő útvonalirány: Patrik a központból kifelé és vissza,
     Martin/Márió a lakhely felől befelé.
   - A teljesített hátralékok kikerülnek a Hátralékból, a napi nézetben
     szürke „Elintézve” állapotban maradnak és nem vesznek részt az optimalizálásban.
   - Sofőrönként külön, nagy „Nézet” ablak saját, görgetéskor is látható térképpel.
   - Azonos felrakók alapból együtt mozgó blokkok; igény szerint bonthatók és újracsoportosíthatók.
   - Megbízható automatikus fel/le görgetés buborékhúzás közben.
   - Ryng törzsadat javítása: 1173 Budapest, Flamingó köz 4.
*/
(function (global) {
  'use strict';

  const VERSION = '37';
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
  /* V110: a kézzel feltöltött csatolmány is számít – enélkül a Csatolmány
     gomb csak az importált fuvaroknál jelent meg. */
  const hasOutlookSource = order => !!(order && (order.hasManualAttachV110 || order.sourceMail || order.outlookImport || order.outlookSourceFile || order.outlookPdfFile || /^outlook import/i.test(String(order.note || '')) || (order.deliveryReports || []).some(report => /^Outlook forrás/i.test(String(report.note || '')))));
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
  const pickupMoveKey = value => {
    const source = value?.orders?.[0] || value || {};
    const master = source?.supplierId && typeof state !== 'undefined'
      ? (state.suppliers || []).find(item => item.id === source.supplierId)
      : null;
    const name = master?.name || value?.pickupName || source.pickupName || '';
    /* V73: a CÍM is a kulcs része. Korábban üres címmel hívtuk a
       canonicalStop-ot, ezért a Szatmári késmárki és nagytétényi telephelye
       egyetlen egységbe került – pedig két külön helyre kell menni értük. */
    const address = master?.address || value?.pickupAddress || source.pickupAddress || '';
    if (name) {
      const canonical = global.V35Planner?.canonicalStop
        ? global.V35Planner.canonicalStop({ name, address })
        : `${nrm(name)}@@${nrm(address)}`;
      return `supplier:${canonical || nrm(name)}@@${nrm(address)}`;
    }
    return `address:${nrm(address || 'ismeretlen felrako')}`;
  };

  function ensureV37State() {
    for (const order of state.orders || []) {
      if (order.pickupMoveUngrouped === undefined) order.pickupMoveUngrouped = false;
    }
  }

  function focusPickupUnits(orders) {
    const groups = bubbleGroups(orders);
    const byPickup = new Map();
    for (const group of groups) {
      const key = pickupMoveKey(group);
      if (!byPickup.has(key)) byPickup.set(key, []);
      byPickup.get(key).push(group);
    }
    const units = [];
    for (const [key, pickupGroups] of byPickup.entries()) {
      pickupGroups.sort((a, b) => a.sequence - b.sequence || a.key.localeCompare(b.key, 'hu'));
      const allOrders = pickupGroups.flatMap(group => group.orders);
      // V47: egy beszállító az adott napon mindig egy mozgatási egység.
      const ungrouped = false;
      if (ungrouped) {
        allOrders.slice().sort((a, b) => (+a.sequence || 999) - (+b.sequence || 999) || String(a.orderNo || '').localeCompare(String(b.orderNo || ''), 'hu')).forEach((order, index) => {
          const singleGroup = bubbleGroups([order])[0];
          units.push({
            key: `${key}||order||${order.id}`, pickupKey: key, grouped: false, ungrouped: true,
            groups: [singleGroup], allPickupOrders: allOrders, sequence: +order.sequence || 999, pickupIndex: index
          });
        });
      } else if (allOrders.length === 1) {
        units.push({ key: `${key}||single||${pickupGroups[0].key}`, pickupKey: key, grouped: false, ungrouped: false, groups: [pickupGroups[0]], allPickupOrders: allOrders, sequence: pickupGroups[0].sequence, pickupIndex: 0 });
      } else {
        units.push({ key, pickupKey: key, grouped: true, ungrouped: false, groups: pickupGroups, allPickupOrders: allOrders, sequence: pickupGroups[0].sequence });
      }
    }
    return units.sort((a, b) => a.sequence - b.sequence || a.key.localeCompare(b.key, 'hu'));
  }

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

  async function v37BuildRoutePlan(vehicleId, suppliedProfiles = null, targetDate = selectedDate()) {
    const vehicle = state.vehicles.find(item => item.id === vehicleId);
    // A dátumot a hívó rögzítheti. Az útvonalépítés közben ne a dátummező
    // esetleges megváltozásától függjön, melyik napi rendelést módosítjuk.
    const allOrders = (state.orders || []).filter(order => order.scheduleDate === targetDate && order.vehicleId === vehicleId)
      .slice().sort((a, b) => (+a.sequence || 999) - (+b.sequence || 999));
    const activeOrders = allOrders.filter(order => !isResolvedBacklogOrder(order));
    state.routePlans = state.routePlans || {};
    state.routePlans[targetDate] = state.routePlans[targetDate] || {};
    if (!activeOrders.length) {
      state.routePlans[targetDate][vehicleId] = [];
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
    state.routePlans[targetDate][vehicleId] = events;
    return events;
  }

  async function v37OptimizeAction() {
    try {
      const targetDate = selectedDate();
      const before = new Map(state.orders.filter(order => order.scheduleDate === targetDate).map(order => [order.id, order.vehicleId]));
      syncAllBacklogStatuses();
      for (const vehicle of activeVehicles(targetDate)) await v37BuildRoutePlan(vehicle.id, null, targetDate);
      const changed = state.orders.filter(order => order.scheduleDate === targetDate && before.get(order.id) !== order.vehicleId);
      if (changed.length) throw new Error('Az optimalizálás sofőrt változtatott, ezért a művelet vissza lett utasítva.');
      save();
      alert('Felrakási sorrend optimalizálva a sofőr indulási iránya alapján. A szürke, elintézett hátralékok és a rögzített buborékok a helyükön maradtak.');
      return true;
    } catch (error) {
      console.error('[V37] Optimalizálási hiba', error);
      alert(`Az optimalizálás közben hiba történt: ${error?.message || error}`);
      return false;
    }
  }

  function groupIds(group) { return group.orders.map(order => order.id).join(','); }


  /*
    V56 – kompakt felrakósor a Nézet ablakhoz.

    Két sor: felül a felrakó neve és címe, alatta azonos betűmérettel a lerakó.
    A tételek külön gombbal nyithatók, a ritkábban használt műveletek a "..."
    mögé kerülnek. Így egy képernyőn tízszer annyi felrakó fér el, és
    kényelmesen rendezhető.
  */
  function projectSummaryV56(group) {
    const names = [...new Set((group.orders || []).map(order => order.projectName).filter(Boolean))];
    if (!names.length) return { main: 'Nincs projekt', extra: '' };
    return { main: names[0], extra: names.length > 1 ? `+${names.length - 1} projekt` : '' };
  }


  /*
    V56 – egy felrakó = egy sor a Nézetben.

    Ha ugyanarról a felrakóhelyről több projektre is viszünk, az nem külön
    sor: egyetlen sorban jelenik meg, és a nyíl nyitja le a lerakókat a
    hozzájuk tartozó tételekkel.
  */
  function renderCompactUnitV56(unit, index, vehicleId) {
    const groups = unit.groups || [];
    const first = groups[0] || {};
    const orders = unit.allPickupOrders || [];
    const ids = orders.map(order => order.id).join(',');
    const itemCount = orders.reduce((sum, order) => sum + (order.items?.length || 0), 0);
    const longReasons = [...new Set(orders.map(order => order.longMaterialReason).filter(Boolean))];
    const resolved = orders.length > 0 && orders.every(isResolvedBacklogOrder);
    const complete = orders.length > 0 && orders.every(order => order.completed);
    const pinned = orders.some(order => order.routePinned);
    const fullLoad = groups.some(group => group.fullLoad);
    const unreadComment = orders.some(order => global.userCommentClass?.(order));
    const rawName = String(first.pickupName || 'Felrakó').trim();
    const central = /\bkp\b|kozpont/.test(nrm(rawName));
    const displayName = rawName.replace(/\s*\bkp\.?\s*$/i, '').trim() || rawName;
    const address = first.pickupAddress || '';

    const manualNotes = [...new Set(orders.flatMap(order => [order.note, order.manualItems])
      .map(value => String(value || '').trim())
      .filter(value => value && !/^outlook import/i.test(value)))];
    const deliveryV134 = deliveryStateOfV134(orders);
    const deliveryPhotos = deliveryV134.marked;
    const projects = [...new Set(groups.map(group => group.projectName).filter(Boolean))];
    const dropCount = projects.length || 1;

    const hasSourceMail = orders.some(hasOutlookSource);
    const sourceOrder = orders.find(hasOutlookSource) || orders[0] || {};
    const manualBlock = manualNotes.length
      ? `<div class="v65-manual-note"><b>Megjegyzés:</b> ${manualNotes.map(escHtml).join(' · ')}</div>`
      : '';
    const detail = groups.map(group => {
      const rows = (group.orders || []).flatMap(order => (order.items || []).map(item =>
        `<div class="v56-item-row"><span><b class="v56-item-code">${escHtml(item.code || 'Cikkszám nélkül')}</b><span class="v56-item-description">${escHtml(item.description || item.productName || item.name || 'Tétel')}</span></span><span class="v56-item-qty">${escHtml(String(item.qty ?? ''))} ${escHtml(item.unit || '')}</span></div>`));
      const nos = [...new Set((group.orders || []).map(order => order.orderNo).filter(Boolean))];
      return `<div class="v56-drop-block">
        <div class="v56-drop-head"><b>${escHtml(group.projectName || 'Nincs projekt')}</b><span class="v56-drop-meta">${escHtml(nos.join(', '))}</span></div>
        ${rows.join('') || '<div class="v56-item-row v56-item-empty"><span>Nincs rögzített tétel.</span><span></span></div>'}
      </div>`;
    }).join('');

    return `<section class="pickup-move-block v56-row-block ${deliveryPhotos ? 'has-delivery' : ''} ${resolved ? 'resolved-pickup-block' : ''} ${pinned ? 'pinned-block' : ''} ${fullLoad ? 'full-load-block' : ''}" data-pickup-move-key="${escHtml(unit.pickupKey)}" data-order-ids="${escHtml(ids)}">
      <article class="v56-row ${complete ? 'done' : ''} ${resolved ? 'resolved-backlog' : ''} ${longReasons.length ? 'has-long' : ''}${unreadComment ? ' user-comment-unread' : ''}" data-id="${escHtml(first.id || ids.split(',')[0] || '')}">
        <span class="v56-index drag" title="${resolved ? 'Elintézett rendelés – nem mozgatható' : 'Fogd meg és told fel-le a sorrend átrendezéséhez'}" aria-label="Sorrend átrendezése">${escHtml(String(index + 1))}</span>
        <div class="v56-main">
          <div class="v56-line-top"><b>${escHtml(displayName)}</b>${central ? '<span class="v56-chip">kp</span>' : ''}${longReasons.length ? '<span class="v56-chip v56-chip-warn">szálas</span>' : ''}${sourceMissingChipV135(orders, true)}${deliveryPhotos ? `<span class="v56-chip v56-chip-ok" title="A sofőr feltöltötte a szállítólevelet">szállítólevél${deliveryV134.files ? ` ${deliveryV134.files}` : ''}${escHtml(deliveryV134.suffix)}</span>` : ''}<span class="v56-addr">${address ? '— ' + escHtml(address) : ''}</span></div>
        </div>
        <button type="button" class="v56-items-btn" onclick="event.stopPropagation();v56ToggleItems('${escHtml(ids)}',this)" title="Lerakók és tételek">${dropCount} lerakó · ${itemCount} tétel${manualNotes.length ? ' + kézi' : ''} <span class="v56-caret">▾</span></button>
        ${hasSourceMail ? `<button type="button" class="v56-mail-btn" title="Importált levél és csatolmány" onclick="event.stopPropagation();openSourceMail('${escHtml(sourceOrder.id || '')}')">Csatolmány</button>` : ''}
      </article>
      <div class="v56-items" data-items-for="${escHtml(ids)}" hidden>${manualBlock}${detail}<button type="button" class="v56-pdf-button secondary" onclick="event.stopPropagation();openOrderPdfAttachments('${escHtml(ids)}')">📎 Mellékletek megnyitása</button><div class="v56-pdf-status" id="v56-pdf-${escHtml(first.id || ids.split(',')[0] || '')}"></div></div>
      ${fullLoad ? '<div class="v56-forced-drop">Kötelező azonnali lerakás</div>' : ''}
    </section>`;
  }

  function renderCompactRowV56(group, ctx) {
    const { ids, orderNos, itemCount, longReasons, complete, resolved, pinned, fullLoad,
      first, warnings, displayNumber, vehicleId, pickupOrderIds, regroupButton, options } = ctx;
    const project = projectSummaryV56(group);
    // A "kp" utótag a cégnév része; külön jelölésként mutatjuk, hogy a név
    // ne duplázódjon ("Merkapt kp kp").
    const rawName = String(group.pickupName || '').trim();
    const central = /\bkp\b|kozpont/.test(nrm(rawName));
    const displayName = rawName.replace(/\s*\bkp\.?\s*$/i, '').trim() || rawName;
    const unreadComment = (group.orders || []).some(order => global.userCommentClass?.(order));
    const itemRows = (group.orders || []).flatMap(order => (order.items || []).map(item => ({ item, order })));
    const items = itemRows.length
      ? itemRows.map(({ item, order }) => `<div class="v56-item-row"><span><b class="v56-item-code">${escHtml(item.code || 'Cikkszám nélkül')}</b><span class="v56-item-description">${escHtml(item.description || item.productName || item.name || 'Tétel')}</span></span><span class="v56-item-qty">${escHtml(String(item.qty ?? ''))} ${escHtml(item.unit || '')}</span></div>`).join('')
      : '<div class="v56-item-row v56-item-empty"><span>Nincs rögzített tétel.</span><span></span></div>';

    return `<div class="route-block v56-row-block ${options.insidePickupGroup ? 'inside-pickup-group' : ''} ${pinned ? 'pinned-block' : ''} ${fullLoad ? 'full-load-block' : ''} ${resolved ? 'resolved-backlog-block' : ''}" data-order-ids="${escHtml(ids)}">
      <article class="v56-row ${complete ? 'done' : ''} ${resolved ? 'resolved-backlog' : ''} ${longReasons.length ? 'has-long' : ''}${unreadComment ? ' user-comment-unread' : ''}" data-id="${escHtml(first.id)}" data-order-ids="${escHtml(ids)}">
        <span class="v56-index drag" title="${resolved ? 'Elintézett rendelés – nem mozgatható' : 'Fogd meg és told fel-le'}" aria-label="Sorrend átrendezése">${escHtml(displayNumber)}</span>
        <div class="v56-main">
          <div class="v56-line-top">
            <b>${escHtml(displayName)}</b>${central ? '<span class="v56-chip">kp</span>' : ''}${longReasons.length ? '<span class="v56-chip v56-chip-warn">szálas</span>' : ''}${pinned ? '<span class="v56-chip">rögzített</span>' : ''}${fullLoad ? '<span class="v56-chip">teljes autó</span>' : ''}
            <span class="v56-addr">${group.pickupAddress ? '— ' + escHtml(group.pickupAddress) : ''}</span>
          </div>
          <div class="v56-line-drop">${escHtml(project.main)}${project.extra ? `<span class="v56-extra">${escHtml(project.extra)}</span>` : ''}</div>
          ${warnings || ''}
        </div>
        <button type="button" class="v56-items-btn" onclick="event.stopPropagation();v56ToggleItems('${escHtml(ids)}',this)" title="Felrakandó tételek">${itemCount} tétel <span class="v56-caret">▾</span></button>
      </article>
      <div class="v56-items" data-items-for="${escHtml(ids)}" hidden>${items}<button type="button" class="v56-pdf-button secondary" onclick="event.stopPropagation();openOrderPdfAttachments('${escHtml(ids)}')">📎 Mellékletek megnyitása</button></div>
      ${fullLoad ? '<div class="v56-forced-drop">Kötelező azonnali lerakás</div>' : ''}
    </div>`;
  }

  /* V65: az importnál kézzel felvitt tételszöveg. Akkor keletkezik, ha a
     bizonylatról nem sikerült tételt felismerni. Az admin és a sofőri
     felületen egyaránt látszik. */
  /* V71 – SZÁLLÍTÓLEVÉL-JELÖLÉS AZ ADMIN FELÜLETEN

     Eddig semmi nem mutatta, hogy a sofőr feltöltötte-e a szállítólevelet –
     a Mentett fotók gomb akkor is ott volt, ha egy kép sem érkezett. Így
     minden fuvart külön meg kellett nyitni az ellenőrzéshez.

     A deliveryReports mezőt CSAK a sofőr fotófeltöltése tölti (az
     Outlook-mellékletek nem), ezért ez megbízható jel. */
  /* V132: a fuvar jelölése mellett a feltöltött fájlok táblájából számolt
     érték is számít (deliveryPhotoCountV132, app.js). */
  function photoCountOfOrderV132(order) {
    if (typeof global.deliveryPhotoCountV132 === 'function') return global.deliveryPhotoCountV132(order);
    return (order?.deliveryReports || []).reduce((inner, report) => inner + (+report.photoCount || +report.fileCount || 1), 0);
  }
  /* V133: „· archiválva” felirat a Mentett fotók mögé (app.js). */
  function archiveSuffixV133(orders) {
    return typeof global.deliveryArchiveSuffixV133 === 'function' ? escHtml(global.deliveryArchiveSuffixV133(orders || [])) : '';
  }
  function deliveryPhotoCount(group) {
    return (group.orders || []).reduce((sum, order) => sum + photoCountOfOrderV132(order), 0);
  }
  /* V134: a gomb állapota (zöld, felirat) közös szabály szerint (app.js). */
  /* V135: ha egy rendelés levélmelléklete nem jutott fel a szerverre, a
     sofőr nem tudja megnyitni – ezt a buborék maradandóan jelzi. */
  function sourceMissingChipV135(orders, compact = false) {
    const hibas = (orders || []).filter(order => order?.sourceUploadFailedV135);
    /* V136: részleges feltöltés – a sofőr csak a mellékletek egy részét látja. */
    const reszleges = (orders || []).filter(order => !order?.sourceUploadFailedV135 && order?.sourceUploadPartialV136?.skipped?.length);
    if (!hibas.length && reszleges.length) {
      const nevek = reszleges.flatMap(order => order.sourceUploadPartialV136.skipped);
      const cim = `A tároló nem fogadta el: ${nevek.join(', ')}. Pótlás: Csatolmány → Kimaradtak feltöltése, vagy Beállítások.`;
      return compact
        ? `<span class="v56-chip v135-chip-missing" title="${escHtml(cim)}">melléklet részben fent</span>`
        : `<span class="tag v135-source-missing" title="${escHtml(cim)}">⚠ Melléklet részben jutott fel (${nevek.length} kimaradt)</span>`;
    }
    if (!hibas.length) return '';
    const cim = `A levél melléklete nem jutott fel a szerverre, a sofőr nem tudja megnyitni (${hibas.map(order => order.orderNo).filter(Boolean).join(', ')}). Pótlás: Csatolmány → Feltöltés a sofőrnek, vagy Beállítások.`;
    return compact
      ? `<span class="v56-chip v135-chip-missing" title="${escHtml(cim)}">melléklet nincs fent</span>`
      : `<span class="tag v135-source-missing" title="${escHtml(cim)}">⚠ Melléklet nem jutott fel a sofőrhöz</span>`;
  }
  function deliveryStateOfV134(orders) {
    if (typeof global.deliveryStateV134 === 'function') return global.deliveryStateV134(orders || []);
    const files = (orders || []).reduce((sum, order) => sum + photoCountOfOrderV132(order), 0);
    return { files, archived: 0, marked: files > 0, suffix: '', label: `Mentett fotók${files ? ` (${files})` : ''}` };
  }

  /* V73: a megjegyzés a fuvar note mezőjéből jön, mert azt az űrlapon
     szerkeszteni is lehet. A régi manualItems mezőt is figyeljük, hogy a
     korábban importált fuvarokon se tűnjön el a szöveg. */
  function manualItemsOfGroup(group) {
    const values = (group.orders || []).flatMap(order => [order.note, order.manualItems])
      .map(value => String(value || '').trim())
      .filter(value => value && !/^outlook import/i.test(value));
    return [...new Set(values)].join(' · ');
  }

  function renderGroupBubble(group, index, vehicleId, options = {}) {
    /* V126: a Stand Future fuvarok világos türkiz hátteret kapnak, hogy egy
       pillantásra elkülönüljenek. A színt NEM bízzuk magára: a címke
       nyomtatásban és színtévesztéssel is olvasható marad. */
    const cegKulcs = global.orderCompanyV126?.(group.orders?.[0]) || 'stand98';
    const cegJelzes = cegKulcs === 'future'
      ? '<span class="v126-badge">Future</span>' : '';
    /* V121: ha a sofőr mozgatta át a fuvart vagy a hátralékot, az a
       zászlósorban látszik – nevével és napjával együtt. */
    const mozgatas = (group.orders || []).map(order => order.movedByDriverV121).filter(Boolean)[0];
    const atmozgatottFuvar = (group.orders || []).find(order => order.movedFromOrderId || order.failedMovedFrom || order.movedByDriverV121?.targetDate);
    /* V125: AHONNAN áthozták – nem az a nap, ahol most van. A célnapot úgyis
       látod, hiszen azt a napot nézed; a forrásnap az, amit keresel. */
    const forrasFuvar = (group.orders || [])
      .map(order => (state.orders || []).find(x => String(x.id) === String(order.movedFromOrderId)))
      .find(Boolean);
    const mozgatasDatum = mozgatas?.fromDate || forrasFuvar?.scheduleDate || '';
    const mozgatasJelzes = mozgatas || mozgatasDatum
      ? `<span class="v121-moved" title="${escHtml(mozgatas?.by || '')}${mozgatas?.at ? ` · ${escHtml(String(mozgatas.at).slice(0, 16).replace('T', ' '))}` : ''}">Átmozgatva${mozgatasDatum ? ` · ${escHtml(mozgatasDatum)}` : ''}</span>`
      : '';
    /* V115: a fuvar üzenetszála. A gomb PIROSAN marad, amíg van olvasatlan
       sofőri üzenet – elolvasás után elhalványul, új üzenetnél újra piros. */
    const szalOsszes = global.groupThreadCountV117?.(group.orders) || 0;
    const szalOlvasatlan = global.groupThreadUnreadV117?.(group.orders) || false;
    const ids = groupIds(group);
    /* V145: a rendelésszám úgy, ahogy a bizonylaton áll */
    const orderNos = [...new Set(group.orders.map(order => (typeof global.orderLabelV145==='function'?global.orderLabelV145(order):order.orderNo)).filter(Boolean))];
    const itemCount = group.orders.reduce((sum, order) => sum + (order.items?.length || 0), 0);
    const longReasons = [...new Set(group.orders.map(order => order.longMaterialReason).filter(Boolean))];
    const complete = group.orders.every(order => order.completed);
    const resolved = group.orders.every(isResolvedBacklogOrder);
    const pinned = group.orders.some(order => order.routePinned);
    const fullLoad = group.fullLoad;
    const first = group.orders[0];
    const unreadComment = group.orders.some(order => global.userCommentClass?.(order));
    const warnings = typeof masterWarnings === 'function' ? group.orders.map(masterWarnings).filter(Boolean).join('') : '';
    const pickupOrderIds = options.allPickupOrders?.map(order => order.id).join(',') || ids;
    const regroupButton = options.focus && options.ungrouped && (options.samePickupCount || 0) > 1
      ? `<button type="button" class="group-toggle-button" onclick="event.stopPropagation();v37SetPickupGrouping('${escHtml(pickupOrderIds)}',false)" title="Az azonos felrakó rendeléseinek újracsoportosítása">🔗</button>`
      : '';
    const displayNumber = options.displayLabel || String(index + 1);
    if (options.focus && !options.unitRow) return renderCompactRowV56(group, {
      ids, orderNos, itemCount, longReasons, complete, resolved, pinned, fullLoad, first,
      warnings, displayNumber, vehicleId, pickupOrderIds, regroupButton, options
    });
    const deliveryV134 = deliveryStateOfV134(group.orders);
    return `<div class="route-block ${deliveryV134.marked ? 'has-delivery' : ''} ${options.insidePickupGroup ? 'inside-pickup-group' : ''} ${pinned ? 'pinned-block' : ''} ${fullLoad ? 'full-load-block' : ''} ${resolved ? 'resolved-backlog-block' : ''}" data-group-key="${escHtml(group.key)}" data-pickup-move-key="${escHtml(pickupMoveKey(group))}" data-order-ids="${escHtml(ids)}" data-vehicle-id="${escHtml(vehicleId)}">
      <article class="bubble grouped-bubble v126-${cegKulcs} ${complete ? 'done' : ''} ${resolved ? 'resolved-backlog' : ''}${unreadComment ? ' user-comment-unread' : ''}" data-id="${escHtml(first.id)}" data-order-ids="${escHtml(ids)}">
        <span class="drag ${options.insidePickupGroup ? 'drag-inner' : 'drag-outer'}" title="${resolved ? 'Elintézett rendelés – nem mozgatható' : options.insidePickupGroup ? 'Ennek a buboréknak a húzása (sorrend: a felrakó-csoport együtt mozog; másik sofőrhöz: csak ez megy át)' : 'Húzás'}">${resolved ? '✓' : '☷'}</span>
        <div class="bubble-control-row">
          <button type="button" class="pin-button ${pinned ? 'active' : ''}" onclick="event.stopPropagation();v37TogglePin('${escHtml(ids)}','${escHtml(vehicleId)}')" title="${pinned ? 'Rögzítés feloldása' : 'Pozíció rögzítése'}">⚑</button>
          <button type="button" class="full-load-button ${fullLoad ? 'active' : ''}" onclick="event.stopPropagation();v33ToggleFullLoad('${escHtml(ids)}')" title="Teljes autós rakomány">🚚</button>
          ${regroupButton}${mozgatasJelzes}${cegJelzes}
        </div>
        <h3>${escHtml(displayNumber)}. ${escHtml(group.pickupName)}</h3>
        ${warnings}
        <div class="bubble-main-line"><b>Felrakó:</b><span>${escHtml(group.pickupName)}${group.pickupAddress ? ` · ${escHtml(group.pickupAddress)}` : ''}</span></div>
        <div class="bubble-main-line"><b>Lerakó:</b><span>${escHtml(group.projectName)}${group.dropAddress ? ` · ${escHtml(group.dropAddress)}` : ''}</span></div>
        <div class="bubble-main-line order-number-line"><b>Rendelésszám:</b><span>${escHtml(orderNos.join(', ') || 'Nincs megadva')}</span></div>
        ${(group.orders || []).length > 1 && !options.focus ? renderOrderRowsV150(group.orders) : ''}
        <div class="tags">${sourceMissingChipV135(group.orders)}<span class="tag">${group.orders.length} rendelés</span><span class="tag">${itemCount} tétel</span>${deliveryV134.marked ? `<span class="tag delivery-tag" title="A sofőr feltöltötte a szállítólevelet">Szállítólevél${deliveryV134.files ? ` · ${deliveryV134.files}` : ''}${escHtml(deliveryV134.suffix)}</span>` : ''}${longReasons.map(reason => `<span class="tag long">${escHtml(reason)}</span>`).join('')}${pinned ? '<span class="tag pin-tag">Rögzítve</span>' : ''}${fullLoad ? '<span class="tag full-load-tag">Teljes autó</span>' : ''}${resolved ? '<span class="tag resolved-tag">✓ Elintézve</span>' : ''}${options.ungrouped && (options.samePickupCount || 0) > 1 ? '<span class="tag ungrouped-tag">Külön mozgatható</span>' : ''}</div>
        ${manualItemsOfGroup(group) ? `<div class="v65-manual-note"><b>Megjegyzés:</b> ${escHtml(manualItemsOfGroup(group))}</div>` : ''}
        <div class="bubble-actions"><button onclick="editOrder('${escHtml(first.id)}')">Szerkesztés</button><button class="secondary" title="Visszaszállítás: a projekt lesz a felrakó, a beszállító a lerakó" onclick="returnOrder('${escHtml(first.id)}')">↩ Visszáru</button><button onclick="v33OpenGroupItems('${escHtml(ids)}')">Tételek</button><button class="secondary v115-thread${szalOlvasatlan ? ' has-unread' : ''}" title="A fuvarhoz írt üzenetek" onclick="openThreadGroupV117('${escHtml(ids)}')">✉ Üzenetek${szalOsszes ? ` (${szalOsszes})` : ''}</button><button class="secondary v109-next-day" title="A fuvar átkerül ugyanehhez a sofőrhöz, a következő munkanapra" onclick="moveToNextWorkdayV109('${escHtml(ids)}')">→ Következő napra</button>${group.orders.some(hasOutlookSource) ? `<button onclick="openSourceMail('${escHtml((group.orders.find(hasOutlookSource) || first).id)}')">Csatolmány</button>` : ''}<button onclick="openCamera('${escHtml(first.id)}')">📷 Kamera</button><button class="secondary ${deliveryV134.marked ? 'has-photos' : ''}" title="${deliveryV134.files ? `${deliveryV134.files} feltöltött szállítólevél-fájl` : deliveryV134.archived ? 'A szállítólevelek archiválva' : 'Még nincs feltöltött fotó'}" onclick="openMediaGallery('${escHtml(ids)}')">📎 ${escHtml(deliveryV134.label)}</button></div>
        <button class="complete-button ${complete ? 'done' : ''}" onclick="v37ToggleGroupComplete('${escHtml(ids)}')">${complete ? '✓' : '○'}</button>
        <button class="trash" onclick="v33DeleteGroup('${escHtml(ids)}')">🗑</button>
      </article>
      ${fullLoad ? `<article class="bubble forced-drop-bubble"><div class="forced-drop-icon">↓</div><h3>Kötelező azonnali lerakás</h3><div class="bubble-main-line"><b>Lerakó:</b><span>${escHtml(group.projectName)}${group.dropAddress ? ` · ${escHtml(group.dropAddress)}` : ''}</span></div><div class="bubble-main-line"><b>Rendelésszám:</b><span>${escHtml(orderNos.join(', '))}</span></div><p>A sofőr csak ezután vehet fel újabb anyagot.</p></article>` : ''}
    </div>`;
  }

  function groupedBubbles(list, vehicleId, focus = false) {
    const units = focusPickupUnits(list);
    if (!units.length) return '<div class="notice">Nincs fuvar.</div>';
    // A Nézetben minden felrakó pontosan egyszer szerepel.
    if (focus) return units.map((unit, unitIndex) => renderCompactUnitV56(unit, unitIndex, vehicleId)).join('');
    return units.map((unit, unitIndex) => {
      /* V147: egyetlen (akár több rendeléses) buborék köré nem rajzolunk
         csoportkeretet – így áthúzáskor rákérdezhetünk, melyik rendelés
         menjen át. Az egység (együtt mozgás) ettől nem változik. */
      if (!unit.grouped || unit.groups.length === 1) {
        const group = unit.groups[0];
        return renderGroupBubble(group, unitIndex, vehicleId, {
          focus,
          ungrouped: false,
          samePickupCount: unit.allPickupOrders.length,
          allPickupOrders: unit.allPickupOrders,
          displayLabel: String(unitIndex + 1)
        });
      }
      const ids = unit.allPickupOrders.map(order => order.id).join(',');
      const pickupName = unit.groups[0]?.pickupName || 'Felrakó';
      const pickupAddress = unit.groups[0]?.pickupAddress || '';
      const orderCount = unit.allPickupOrders.length;
      const resolvedPickup = unit.allPickupOrders.every(isResolvedBacklogOrder);
      return `<section class="pickup-move-block ${resolvedPickup ? 'resolved-pickup-block' : ''}" data-pickup-move-key="${escHtml(unit.pickupKey)}" data-order-ids="${escHtml(ids)}" data-vehicle-id="${escHtml(vehicleId)}">
        <div class="v147-group-head"><span class="drag drag-outer drag-group" title="A teljes felrakó-csoport húzása (a zászlós rendelések a sofőrnél maradnak)">☷</span><b>${escHtml(pickupName)}</b><small>${orderCount} rendelés · felrakó-csoport</small></div>
        <div class="pickup-group-orders" data-vehicle-id="${escHtml(vehicleId)}">${unit.groups.map((group, subIndex) => renderGroupBubble(group, subIndex, vehicleId, {
          focus,
          insidePickupGroup: true,
          allPickupOrders: unit.allPickupOrders,
          samePickupCount: orderCount,
          displayLabel: `${unitIndex + 1}.${subIndex + 1}`
        })).join('')}</div>
      </section>`;
    }).join('');
  }

  function focusGroupedBubbles(list, vehicleId) { return groupedBubbles(list, vehicleId, true); }

  function ensureFocusDialog() {
    if (document.getElementById('v37DriverViewDialog')) return;
    const dialog = document.createElement('dialog');
    dialog.id = 'v37DriverViewDialog';
    dialog.className = 'driver-focus-dialog';
    dialog.innerHTML = `<div class="driver-focus-shell">
      <header class="driver-focus-head"><div><small>EGY SOFŐR NÉZETE</small><h2 id="v37FocusTitle">Sofőr</h2><p id="v37FocusSummary"></p></div><button type="button" class="driver-focus-close" aria-label="Bezárás">×</button></header>
      <div class="driver-focus-content"><div id="v37FocusMap" class="map driver-focus-map"></div><div id="v37FocusRoute" class="route-list driver-focus-route"></div></div>
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
    const element = document.getElementById('v37FocusMap');
    if (!element || typeof L === 'undefined') return;
    if (focusMap) focusMap.remove();
    focusMap = L.map(element, { zoomControl: true }).setView([47.45, 19.04], 9);
    const map = focusMap, date = selectedDate();
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(map);
    let events = state.routePlans?.[selectedDate()]?.[vehicleId] || [];
    const currentPlanner = global.V121Planner || global.V65Planner || global.V64Planner;
    const snapshot = currentPlanner?.mapRouteSnapshotV69?.(vehicleId, date);
    const isCurrent = () => focusMap === map && selectedDate() === date
      && snapshot === currentPlanner?.mapRouteSnapshotV69?.(vehicleId, date);
    let changed = false;
    if (currentPlanner?.routePlanNeedsRefreshV55?.(vehicleId, events)) {
      const vehicle = (state.vehicles || []).find(item => item.id === vehicleId);
      if (vehicle && typeof currentPlanner.buildManualRouteV55 === 'function') {
        events = await currentPlanner.buildManualRouteV55(vehicle, date);
        changed = true;
      }
    }
    if (!isCurrent()) return;
    let pickups = events.filter(event => event.type === 'pickup');
    if (!pickups.length) {
      const seen = new Set(); pickups = [];
      // A tartalék is a kézi sorrendet kövesse, ne a rendelések tárolási sorrendjét.
      const ordered = dayOrders(vehicleId).slice().sort((a, b) => (+a.sequence || 999) - (+b.sequence || 999));
      for (const group of bubbleGroups(ordered)) {
        if (group.orders.every(isResolvedBacklogOrder) || seen.has(group.pickupKey)) continue;
        seen.add(group.pickupKey);
        pickups.push({ name: group.pickupName, address: group.pickupAddress, point: await geo(group.pickupAddress) });
      }
    } else {
      if (currentPlanner?.refreshPickupEventsV55) {
        const refreshed = await currentPlanner.refreshPickupEventsV55(vehicleId, pickups);
        pickups = refreshed.events;
        changed = changed || refreshed.changed;
      } else {
        for (const event of pickups) if (!finitePoint(event.point)) event.point = await geo(event.address);
      }
    }
    if (!isCurrent()) return;
    if (changed) {
      state.routePlans = state.routePlans || {};
      state.routePlans[date] = state.routePlans[date] || {};
      state.routePlans[date][vehicleId] = pickups;
      save(false);
    }
    const points = [];
    const markers = currentPlanner?.mapMarkerLayoutV69 ? currentPlanner.mapMarkerLayoutV69(pickups)
      : pickups.filter(event => finitePoint(event.point)).map((event,index) => ({event,number:index + 1,iconAnchor:[15,15]}));
    markers.forEach(({event,number,iconAnchor}) => {
      points.push(event.point);
      const icon = L.divIcon({ className: 'v37-numbered-marker', html: `<span>${number}</span>`, iconSize: [30, 30], iconAnchor });
      const approximate = state.geoApprox?.[event.address] ? '<br><small>Becsült hely · a pontos címfeloldás még nem sikerült.</small>' : '';
      L.marker(event.point, { icon, title: `${number}. ${event.name}` }).addTo(map).bindPopup(`<b>${number}. Felrakó</b><br>${escHtml(event.name)}<br>${escHtml(event.address || '')}${approximate}`);
    });
    if (points.length === 1) map.setView(points[0], 13);
    if (points.length > 1) {
      let route = null;
      try { route = await roadRoute(points); } catch (_) {}
      if (!isCurrent()) return;
      const coords = route ? route.geometry.coordinates.map(coord => [coord[1], coord[0]]) : points;
      const line = L.polyline(coords, { weight: 5, opacity: 0.82 }).addTo(map);
      map.fitBounds(line.getBounds(), { padding: [28, 28] });
    }
    setTimeout(() => { if (isCurrent()) map.invalidateSize(); }, 80);
  }

  /* V60: a kompakt Nézet-sor maga a pickup-move-block, és a data-order-ids
     RAJTA van, nem egy belső .route-block elemen. Korábban ilyenkor üres
     listát kaptunk, ezért a húzás utáni sorszámozás elmaradt, és a fuvar
     visszaugrott az eredeti helyére. */
  function orderedRouteBlocks(container) {
    const result = [];
    for (const child of [...container.children]) {
      if (child.classList.contains('pickup-move-block')) {
        const inner = [...child.querySelectorAll(':scope > .pickup-group-orders > .route-block')];
        if (inner.length) result.push(...inner);
        else if (child.dataset.orderIds) result.push(child);
      } else if (child.classList.contains('route-block')) result.push(child);
    }
    return result;
  }

  /* V74 – A SORSZÁM AZONNAL KÖVETI A MOZGATÁST

     A főoldal a húzás után újrarajzolódik, a Nézet ablak viszont nem – ott a
     sorok a helyükre csúsznak, de a beléjük írt szám a régi maradt. Ezért a
     mozgatás végén azonnal újraszámozzuk őket, a képernyőn látható sorrend
     szerint. Így nem kell megvárni egy újranyitást. */
  function renumberFocusRowsV74(container) {
    if (!container?.children) return;
    let index = 0;
    for (const child of [...container.children]) {
      if (!child.classList?.contains('pickup-move-block') && !child.classList?.contains('route-block')) continue;
      index += 1;
      const badge = child.querySelector?.('.v56-index');
      if (badge) badge.textContent = String(index);
    }
  }

  function updateSequencesFromContainer(container, vehicleId) {
    let sequence = 1;
    orderedRouteBlocks(container).forEach((block, index) => {
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

  /* V92 – EGY BESZÁLLÍTÓ ÖSSZES AZNAPI FUVARA EGY SOFŐRHÖZ

     A húzás eddig is vitte magával az azonos TELEPHELYRŐL induló fuvarokat,
     de a cég másik telephelye külön maradt, és húzni kellett hozzá.

     Ez a művelet a CÉG összes aznapi fuvarát átteszi a választott sofőrhöz,
     telephelytől függetlenül – például minden Lambda-fuvart Martinhoz, akkor
     is, ha közben a Hengermalom Máriónál, az Akna utca Patriknál volt.

     Amit NEM mozgat: az elintézett hátralékokat és a már kész fuvarokat –
     azok a helyükön maradnak, mert ott már megtörtént a munka. */
  /* A sofőrválasztó: csak akkor jelenik meg, ha van hova mozgatni, és csak
     azokat a sofőröket kínálja, akiknél a cég NEM teljes egészében van már. */
  function companyMoveControl(group, currentVehicleId) {
    const seed = (group.orders || [])[0];
    if (!seed) return '';
    const related = companyOrdersOnDay(seed);
    if (related.length < 2) return '';                      // egy fuvarnál a húzás is elég
    const elsewhere = related.filter(order => order.vehicleId !== currentVehicleId).length;
    const drivers = activeVehicles().filter(vehicle => vehicle.id !== currentVehicleId);
    if (!drivers.length) return '';
    const ids = (group.orders || []).map(order => order.id).join(',');
    const label = elsewhere
      ? `Mind a ${related.length} ${seed.pickupName} fuvar ide` : `Mind a ${related.length} ${seed.pickupName} fuvar`;
    return `<select class="company-move" title="${escHtml(seed.pickupName)}: az aznapi összes fuvar áthelyezése egy sofőrhöz"
      onchange="if(this.value){moveCompanyOrdersToDriver('${escHtml(ids)}',this.value);this.value=''}">
      <option value="">${escHtml(label)} →</option>
      ${drivers.map(vehicle => `<option value="${escHtml(vehicle.id)}">${escHtml(vehicle.driverName || vehicle.name || 'sofőr')}</option>`).join('')}
    </select>`;
  }

  function companyOrdersOnDay(seedOrder) {
    if (!seedOrder) return [];
    const company = nrm(seedOrder.pickupName || '');
    if (!company) return [];
    return (state.orders || []).filter(order =>
      order.scheduleDate === seedOrder.scheduleDate
      && nrm(order.pickupName || '') === company
      && !order.completed
      && !isResolvedBacklogOrder(order));
  }

  function moveCompanyOrdersToDriver(seedIds, targetVehicleId) {
    const ids = Array.isArray(seedIds) ? seedIds.filter(Boolean) : String(seedIds || '').split(',').filter(Boolean);
    const seed = ids.map(id => (state.orders || []).find(order => order.id === id)).find(Boolean);
    if (!seed || !targetVehicleId) return 0;
    const related = companyOrdersOnDay(seed);
    if (!related.length) return 0;

    const date = seed.scheduleDate;
    const relatedIds = new Set(related.map(order => order.id));
    related.forEach(order => { order.vehicleId = targetVehicleId; });

    // a cég fuvarjai egymás mellé kerülnek, telephelyenként csoportosítva
    const ordered = related.slice().sort((a, b) =>
      String(a.pickupAddress || '').localeCompare(String(b.pickupAddress || ''), 'hu')
      || String(a.orderNo || '').localeCompare(String(b.orderNo || ''), 'hu'));
    const others = (state.orders || []).filter(order => order.scheduleDate === date
      && order.vehicleId === targetVehicleId && !relatedIds.has(order.id))
      .sort((a, b) => (+a.sequence || 999) - (+b.sequence || 999));
    others.push(...ordered);
    others.forEach((order, index) => { order.sequence = index + 1; });

    for (const vehicle of activeVehicles()) {
      if (vehicle.id === targetVehicleId) continue;
      (state.orders || []).filter(order => order.scheduleDate === date && order.vehicleId === vehicle.id)
        .sort((a, b) => (+a.sequence || 999) - (+b.sequence || 999))
        .forEach((order, index) => { order.sequence = index + 1; });
    }
    save();
    if (typeof renderRoutes === 'function') setTimeout(renderRoutes, 0);
    return related.length;
  }

  global.moveCompanyOrdersToDriver = (seedIds, vehicleId) => {
    const moved = moveCompanyOrdersToDriver(seedIds, vehicleId);
    if (!moved && typeof alert === 'function') alert('Nincs áthelyezhető fuvar ehhez a beszállítóhoz ezen a napon.');
    return moved;
  };
  global.companyOrdersOnDay = companyOrdersOnDay;

  function moveSupplierOrdersTogether(seedIds, targetVehicleId, anchorSequence = null) {
    const ids = Array.isArray(seedIds) ? seedIds.filter(Boolean) : String(seedIds || '').split(',').filter(Boolean);
    const seed = ids.map(id => state.orders.find(order => order.id === id)).find(Boolean);
    if (!seed || !targetVehicleId) return 0;
    const date = seed.scheduleDate;
    const key = pickupMoveKey(seed);
    /* V147: a felrakó-csoport csak UGYANANNÁL a sofőrnél mozog együtt (sorrend);
       másik sofőrnél lévő azonos felrakójú rendeléshez nem nyúlunk. */
    const movedSet = new Set(ids.map(String));
    const related = (state.orders || []).filter(order => order.scheduleDate === date && pickupMoveKey(order) === key && !isResolvedBacklogOrder(order) && (movedSet.has(String(order.id)) || order.vehicleId === targetVehicleId));
    if (!related.length) return 0;

    const relatedIds = new Set(related.map(order => order.id));
    const seedSequences = ids.map(id => state.orders.find(order => order.id === id)).filter(Boolean).map(order => +order.sequence || 999);
    const anchor = Number.isFinite(+anchorSequence) ? +anchorSequence : Math.min(...seedSequences, ...related.map(order => +order.sequence || 999));
    related.forEach(order => { order.vehicleId = targetVehicleId; });

    const targetOthers = (state.orders || []).filter(order => order.scheduleDate === date && order.vehicleId === targetVehicleId && !relatedIds.has(order.id))
      .slice().sort((a, b) => (+a.sequence || 999) - (+b.sequence || 999) || String(a.orderNo || '').localeCompare(String(b.orderNo || ''), 'hu'));
    const orderedRelated = related.slice().sort((a, b) => String(a.orderNo || '').localeCompare(String(b.orderNo || ''), 'hu'));
    const insertAt = Math.max(0, Math.min(targetOthers.length, Math.max(0, Math.round(anchor || 1) - 1)));
    targetOthers.splice(insertAt, 0, ...orderedRelated);
    targetOthers.forEach((order, index) => { order.sequence = index + 1; });

    for (const vehicle of activeVehicles()) {
      if (vehicle.id === targetVehicleId) continue;
      (state.orders || []).filter(order => order.scheduleDate === date && order.vehicleId === vehicle.id)
        .sort((a, b) => (+a.sequence || 999) - (+b.sequence || 999))
        .forEach((order, index) => { order.sequence = index + 1; });
    }
    return related.length;
  }

  function trackPointer(event) {
    const touch = event?.touches?.[0] || event?.changedTouches?.[0];
    const y = touch?.clientY ?? event?.clientY;
    const x = touch?.clientX ?? event?.clientX;
    if (Number.isFinite(y)) dragPointerY = y;
    /* V147: az elengedés helye – ebből derül ki, melyik sofőr listájára ejtették */
    if (Number.isFinite(x) && Number.isFinite(y) && (x || y)) global.__dropPointV147 = { x, y };
  }
  if (typeof document !== 'undefined' && document.addEventListener) {
    for (const type of ['dragover', 'pointermove', 'touchmove']) document.addEventListener(type, event => { if (dragActive) trackPointer(event); }, { capture: true, passive: true });
  }
  /* Ha a húzókönyvtár nem tudta eldönteni a helyet (egy magas elem közepére
     ejtették), az elengedés helyéből állapítjuk meg a célsofőrt és a helyet. */
  function dropTargetFromPointV147(fromVehicle) {
    const point = global.__dropPointV147;
    if (!point || typeof document.elementFromPoint !== 'function') return null;
    const under = document.elementFromPoint(point.x, point.y);
    const list = under?.closest?.('.route-list[id]');
    const vehicle = list ? String(list.id).replace(/^route-/, '') : '';
    if (!vehicle || vehicle === fromVehicle) return null;
    const before = new Set();
    for (const block of orderedRouteBlocks(list)) {
      const rect = block.getBoundingClientRect();
      if (rect.top + rect.height / 2 < point.y) for (const id of String(block.dataset.orderIds || '').split(',').filter(Boolean)) before.add(id);
    }
    return { vehicle, before };
  }

  function autoScrollLoop() {
    if (!dragActive) { dragScrollFrame = 0; return; }
    const y = dragPointerY;
    if (Number.isFinite(y)) {
      const localScroll = dragScrollContainer && dragScrollContainer !== document.scrollingElement && dragScrollContainer !== document.documentElement;
      const bounds = localScroll ? dragScrollContainer.getBoundingClientRect() : { top: 0, bottom: window.innerHeight, height: window.innerHeight };
      const height = Math.max(1, bounds.height || (bounds.bottom - bounds.top));
      const threshold = Math.min(95, height * 0.18);
      let amount = 0;
      if (y < bounds.top + threshold) amount = -Math.ceil(((bounds.top + threshold - y) / threshold) * 7);
      else if (y > bounds.bottom - threshold) amount = Math.ceil(((y - (bounds.bottom - threshold)) / threshold) * 7);
      if (amount) {
        if (localScroll) dragScrollContainer.scrollTop += amount;
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

  /* ===== V150 – TÖBB RENDELÉSES BUBORÉK: A RENDELÉSEK TAGOLTAN ==========
     Rendelésenként: szám, tételszám, zászló, 📎, megjegyzés (koppintásra
     szerkeszthető), Szerkesztés (a teljes szerkesztő), Tételek, Áthelyezés…
     Sok rendelésnél (4-től) összecsukva indul. */
  function renderOrderRowsV150(orders) {
    const sorted = [...orders].sort((a, b) => (+a.sequence || 999) - (+b.sequence || 999));
    const rows = sorted.map(order => {
      const id = escHtml(order.id);
      const label = (global.orderLabelV145 ? global.orderLabelV145(order) : order.orderNo) || 'Rendelésszám nélkül';
      const n = (order.items || []).length;
      const note = String(order.manualItems || '').trim();
      const clip = hasOutlookSource(order) ? `<button type="button" class="v150-clip" title="A rendelés csatolmánya" onclick="event.stopPropagation();openSourceMail('${id}')">📎</button>` : '';
      const pin = order.routePinned ? '<span class="v150-pin" title="Zászlóval rögzítve">⚑</span>' : '';
      return `<div class="v150-order-row" data-order-id="${id}">
        <div class="v150-order-top"><b>${escHtml(label)}</b><span>${n} tétel</span>${pin}${clip}</div>
        <button type="button" class="v150-order-note${note ? '' : ' empty'}" onclick="event.stopPropagation();v150EditNote('${id}')">${note ? escHtml(note) : 'Megjegyzés hozzáadása'}</button>
        <div class="v150-order-actions"><button type="button" onclick="event.stopPropagation();editOrder('${id}')">Szerkesztés</button><button type="button" onclick="event.stopPropagation();openItems('${id}')">Tételek</button><button type="button" onclick="event.stopPropagation();v150MoveOrder('${id}')">Áthelyezés…</button></div>
      </div>`;
    }).join('');
    return `<details class="v150-orders"${sorted.length <= 3 ? ' open' : ''}><summary>Rendelések (${sorted.length})</summary>${rows}</details>`;
  }
  function dialogV150(id) {
    let d = document.getElementById(id);
    if (!d) { d = document.createElement('dialog'); d.id = id; d.className = 'v147-dialog'; document.body.appendChild(d); }
    return d;
  }
  function labelV150(order) { return (global.orderLabelV145 ? global.orderLabelV145(order) : order.orderNo) || 'Rendelés'; }
  /* megjegyzés egy rendeléshez */
  function editNoteV150(orderId) {
    const order = (state.orders || []).find(o => String(o.id) === String(orderId)); if (!order) return;
    const d = dialogV150('v150NoteDialog');
    d.innerHTML = `<form method="dialog" class="v150-form"><h3>Megjegyzés – ${escHtml(labelV150(order))}</h3>
      <label>A sofőr ennél a rendelésnél látja<textarea name="note" rows="4">${escHtml(order.manualItems || '')}</textarea></label>
      <div class="v147-actions"><button type="button" data-cancel>Mégse</button><button type="button" data-ok class="primary">Megjegyzés mentése</button></div></form>`;
    d.querySelector('[data-cancel]').onclick = () => d.close();
    d.querySelector('[data-ok]').onclick = () => {
      order.manualItems = d.querySelector('[name="note"]').value.trim();
      save(); d.close(); if (typeof renderRoutes === 'function') renderRoutes();
      global.toastV147?.(`Megjegyzés mentve: ${labelV150(order)}`);
    };
    if (!d.open) d.showModal();
    setTimeout(() => d.querySelector('textarea')?.focus(), 50);
  }
  /* egy rendelés áthelyezése másik napra / sofőrhöz (csak ez az egy) */
  function busyOnV150(vehicle, day) {
    if (!vehicle || !day) return '';
    const absence = global.vehicleAbsenceV147?.(vehicle, day);
    if (absence) return 'szabadságon';
    const only = String(vehicle.dayOnly || '').trim();
    if (only && only !== day) return `csak ${only} napon`;
    return '';
  }
  function moveOrderV150(orderId, date, vehicleId) {
    const order = (state.orders || []).find(o => String(o.id) === String(orderId));
    if (!order || !date || !vehicleId) return false;
    const fromDate = order.scheduleDate, fromVehicle = order.vehicleId;
    const key = pickupMoveKey(order);
    const bySeq = (a, b) => (+a.sequence || 999) - (+b.sequence || 999);
    const target = (state.orders || []).filter(o => o !== order && o.scheduleDate === date && o.vehicleId === vehicleId).sort(bySeq);
    let lastSame = -1;
    target.forEach((o, i) => { if (pickupMoveKey(o) === key) lastSame = i; });
    order.scheduleDate = date; order.vehicleId = vehicleId;
    if (order.routePinned) order.pinnedVehicleId = vehicleId;
    target.splice(lastSame >= 0 ? lastSame + 1 : target.length, 0, order);
    target.forEach((o, i) => { o.sequence = i + 1; });
    (state.orders || []).filter(o => o.scheduleDate === fromDate && o.vehicleId === fromVehicle).sort(bySeq).forEach((o, i) => { o.sequence = i + 1; });
    state.routePlans = state.routePlans || {}; state.routePlans[fromDate] = {}; state.routePlans[date] = {};
    save();
    if (typeof renderRoutes === 'function') renderRoutes();
    return true;
  }
  function moveDialogV150(orderId) {
    const order = (state.orders || []).find(o => String(o.id) === String(orderId)); if (!order) return;
    const d = dialogV150('v150MoveOrderDialog');
    const vehicles = (state.vehicles || []).filter(v => v.active);
    d.innerHTML = `<form method="dialog" class="v150-form"><h3>Áthelyezés – ${escHtml(labelV150(order))}</h3>
      <p class="v147-hint">Csak ez a rendelés kerül át; a buborék többi rendelése a helyén marad.</p>
      <label>Nap<input type="date" name="date" value="${escHtml(order.scheduleDate || '')}"></label>
      <label>Sofőr<select name="vehicle">${vehicles.map(v => `<option value="${escHtml(v.id)}" ${v.id === order.vehicleId ? 'selected' : ''}>${escHtml(v.driverName || v.name)}</option>`).join('')}</select></label>
      <p class="v150-move-warn" hidden></p>
      <div class="v147-actions"><button type="button" data-cancel>Mégse</button><button type="button" data-ok class="primary">Áthelyezés</button></div></form>`;
    const dateEl = d.querySelector('[name="date"]'), vehEl = d.querySelector('[name="vehicle"]'), warn = d.querySelector('.v150-move-warn');
    const refresh = () => {
      [...vehEl.options].forEach(opt => { const v = vehicles.find(x => x.id === opt.value); const busy = busyOnV150(v, dateEl.value); opt.disabled = !!busy; opt.textContent = `${v.driverName || v.name}${busy ? ` (${busy})` : ''}`; });
      if (vehEl.selectedOptions[0]?.disabled) { const free = [...vehEl.options].find(o => !o.disabled); if (free) vehEl.value = free.value; }
      warn.hidden = true;
    };
    dateEl.addEventListener('change', refresh); refresh();
    d.querySelector('[data-cancel]').onclick = () => d.close();
    d.querySelector('[data-ok]').onclick = () => {
      const date = dateEl.value, vehicleId = vehEl.value;
      if (!date) { warn.textContent = 'Add meg a napot.'; warn.hidden = false; return; }
      const v = vehicles.find(x => x.id === vehicleId); const busy = busyOnV150(v, date);
      if (!vehicleId || busy) { warn.textContent = `${v ? (v.driverName || v.name) : 'A sofőr'} ezen a napon nem dolgozik (${busy || 'nincs választva'}) – válassz másik sofőrt.`; warn.hidden = false; return; }
      if (date === order.scheduleDate && vehicleId === order.vehicleId) { d.close(); return; }
      moveOrderV150(orderId, date, vehicleId); d.close();
      global.toastV147?.(`${labelV150(order)} áthelyezve: ${date} · ${v.driverName || v.name}`);
    };
    if (!d.open) d.showModal();
  }
  global.v150EditNote = editNoteV150;
  global.v150MoveOrder = moveDialogV150;
  global.moveOrderV150 = moveOrderV150;
  global.renderOrderRowsV150 = renderOrderRowsV150;

  /* ===== V147 – ÁTHÚZÁS MÁSIK SOFŐRHÖZ ============================== */
  function vehicleOfContainerV147(element) {
    const list = element?.closest?.('.route-list[id]');
    return list ? String(list.id).replace(/^route-/, '') : '';
  }
  /* A célsofőr azon rendelései, amelyek az ejtés helye ELŐTT állnak. */
  function idsBeforeDropV147(target, item, movedIds) {
    const list = target?.closest?.('.route-list[id]') || target;
    const moved = new Set(movedIds);
    const before = new Set();
    for (const block of orderedRouteBlocks(list)) {
      if (block === item || item.contains?.(block)) break;
      for (const id of String(block.dataset.orderIds || '').split(',').filter(Boolean)) if (!moved.has(id)) before.add(id);
    }
    return before;
  }
  function driverNameV147(vehicleId) {
    const v = (state.vehicles || []).find(item => item.id === vehicleId);
    return v?.driverName || v?.name || 'a sofőr';
  }
  function labelOfV147(order) {
    return typeof global.orderLabelV145 === 'function' ? global.orderLabelV145(order) : (order.orderNo || '');
  }
  function rerenderRoutesV147() { if (typeof renderRoutes === 'function') setTimeout(renderRoutes, 0); }
  function crossDriverMoveV147(ids, targetVehicleId, beforeIds, groupFrame) {
    const orders = ids.map(id => state.orders.find(order => order.id === id)).filter(Boolean).filter(order => !isResolvedBacklogOrder(order));
    if (!orders.length) return rerenderRoutesV147();
    const pinned = orders.filter(order => order.routePinned);
    const movable = orders.filter(order => !order.routePinned);
    const sourceName = driverNameV147(orders[0].vehicleId);
    if (!movable.length) {
      global.toastV147?.(`🚩 Zászlóval rögzített rendelés – ${sourceName} sofőrnél marad. A zászló levétele után vihető át.`);
      return rerenderRoutesV147();
    }
    const finish = selected => {
      if (!selected.length) return rerenderRoutesV147();
      applyCrossMoveV147(selected, targetVehicleId, beforeIds);
      const kept = pinned.length ? ` ${pinned.length} zászlós rendelés ${sourceName} sofőrnél maradt: ${pinned.map(labelOfV147).join(', ')}.` : '';
      global.toastV147?.(`${selected.length} rendelés átkerült ${driverNameV147(targetVehicleId)} sofőrhöz.${kept}`);
    };
    if (!groupFrame && orders.length > 1) return chooseOrdersV147(orders, targetVehicleId, finish);
    finish(movable.map(order => order.id));
  }
  /* Több rendeléses buborék: melyik rendelés menjen át? */
  function chooseOrdersV147(orders, targetVehicleId, done) {
    let dialog = document.getElementById('v147MoveDialog');
    if (!dialog) { dialog = document.createElement('dialog'); dialog.id = 'v147MoveDialog'; dialog.className = 'v147-dialog'; document.body.appendChild(dialog); }
    const rows = orders.map(order => {
      const items = (order.items || []);
      const first = items[0]?.name ? ` · ${items[0].name}${items.length > 1 ? ' …' : ''}` : '';
      const pin = order.routePinned;
      return `<label class="v147-move-row${pin ? ' pinned' : ''}"><input type="checkbox" value="${escHtml(order.id)}" ${pin ? 'disabled' : 'checked'}><span><b>${escHtml(labelOfV147(order) || 'Rendelésszám nélkül')}</b> · ${items.length} tétel${escHtml(first)}${pin ? ' <em>🚩 rögzítve – marad</em>' : ''}</span></label>`;
    }).join('');
    dialog.innerHTML = `<form method="dialog" class="v147-move">
      <h3>Melyik rendelést vigyem át ${escHtml(driverNameV147(targetVehicleId))} sofőrhöz?</h3>
      <label class="v147-move-all"><input type="checkbox" data-all checked> Mind</label>
      <div class="v147-move-list">${rows}</div>
      <div class="v147-actions"><button type="button" data-cancel>Mégse</button><button type="button" data-ok class="primary">Átvitel</button></div>
    </form>`;
    const boxes = () => [...dialog.querySelectorAll('.v147-move-list input:not([disabled])')];
    dialog.querySelector('[data-all]').onchange = event => boxes().forEach(box => { box.checked = event.target.checked; });
    boxes().forEach(box => box.onchange = () => { dialog.querySelector('[data-all]').checked = boxes().every(item => item.checked); });
    dialog.querySelector('[data-cancel]').onclick = () => { dialog.close(); rerenderRoutesV147(); };
    dialog.querySelector('[data-ok]').onclick = () => { const selected = boxes().filter(box => box.checked).map(box => box.value); dialog.close(); done(selected); };
    if (!dialog.open) dialog.showModal();
  }
  /* A kijelölt rendelések áthelyezése: ha a célsofőrnél van azonos felrakó,
     annak UTOLSÓ rendelése alá kerülnek, egyébként az ejtés helyére. */
  function applyCrossMoveV147(ids, targetVehicleId, beforeIds = new Set()) {
    const moving = ids.map(id => state.orders.find(order => order.id === id)).filter(order => order && !order.routePinned)
      .sort((a, b) => (+a.sequence || 999) - (+b.sequence || 999));
    if (!moving.length) { rerenderRoutesV147(); return 0; }
    const date = moving[0].scheduleDate;
    const sourceIds = new Set(moving.map(order => order.vehicleId));
    const movingIds = new Set(moving.map(order => order.id));
    const target = (state.orders || []).filter(order => order.scheduleDate === date && order.vehicleId === targetVehicleId && !movingIds.has(order.id))
      .sort((a, b) => (+a.sequence || 999) - (+b.sequence || 999));
    const key = pickupMoveKey(moving[0]);
    let lastSame = -1;
    target.forEach((order, index) => { if (pickupMoveKey(order) === key) lastSame = index; });
    const insertAt = lastSame >= 0 ? lastSame + 1 : target.filter(order => beforeIds.has(order.id)).length;
    moving.forEach(order => { order.vehicleId = targetVehicleId; });
    target.splice(insertAt, 0, ...moving);
    target.forEach((order, index) => { order.sequence = index + 1; });
    for (const vehicleIdLeft of sourceIds) {
      (state.orders || []).filter(order => order.scheduleDate === date && order.vehicleId === vehicleIdLeft)
        .sort((a, b) => (+a.sequence || 999) - (+b.sequence || 999))
        .forEach((order, index) => { order.sequence = index + 1; });
    }
    state.routePlans = state.routePlans || {}; state.routePlans[date] = {};
    save();
    if (typeof renderRoutes === 'function') setTimeout(renderRoutes, 0);
    if (typeof global.renderDailyListV93 === 'function' && document.getElementById('dailylist')?.classList.contains('active')) setTimeout(global.renderDailyListV93, 60);
    const buildManual = global.V121Planner?.buildManualRouteV55 || global.V55Planner?.buildManualRouteV55;
    setTimeout(async () => {
      if (typeof buildManual === 'function') { try { for (const vehicle of visibleVehiclesV147()) await buildManual(vehicle); } catch (_) {} }
      if (typeof initMaps === 'function') initMaps();
    }, 40);
    return moving.length;
  }
  global.applyCrossMoveV147 = applyCrossMoveV147;
  global.crossDriverMoveV147 = crossDriverMoveV147;

  function createSortable(element, vehicleId, focus = false, inner = false) {
    if (!element || typeof Sortable === 'undefined') return null;
    return new Sortable(element, {
      /* V147: a felrakó-csoport belsejébe csak a SAJÁT buborékai rendezhetők –
         kívülről semmi nem ejthető bele, különben a csoport szétszakadna. */
      group: focus ? `focus-${vehicleId}` : (inner
        ? { name: 'vehicles-v37', pull: true, put: (to, from) => to.el === from.el }
        : 'vehicles-v37'),
      animation: 180,
      /* V147: a csoport keretét a saját fogantyúja, a buborékot a sajátja mozgatja */
      handle: focus ? '.drag' : (inner ? '.drag-inner' : '.drag-outer'),
      draggable: inner ? '.route-block.inside-pickup-group:not(.resolved-backlog-block)' : '.pickup-move-block:not(.resolved-pickup-block), .route-block:not(.inside-pickup-group):not(.resolved-backlog-block)',
      filter: '.resolved-backlog-block, .resolved-pickup-block',
      scroll: false,
      fallbackOnBody: true,
      delayOnTouchOnly: true,
      delay: 100,
      touchStartThreshold: 4,
      onStart: event => startDragScroll(event.originalEvent || event, focus ? document.querySelector('#v37DriverViewDialog .driver-focus-content') : element),
      onMove: event => {
        trackPointer(event.originalEvent || event);
        if (!focus && event.to?.classList?.contains('route-list')) dragScrollContainer = event.to;
        return !event.related?.classList?.contains('resolved-backlog-block') && !event.related?.classList?.contains('resolved-pickup-block');
      },
      onEnd: event => {
        stopDragScroll();
        const movedIds = String(event.item?.dataset?.orderIds || '').split(',').filter(Boolean);
        /* V147 – ÁTHÚZÁS MÁSIK SOFŐRHÖZ A FŐOLDALON
           Csak a megfogott buborék (vagy a megfogott felrakó-csoport) megy át;
           a zászlós rendelés a sofőrnél marad; több rendeléses buboréknál
           rákérdezünk; ha a célsofőrnél van azonos felrakó, alá rendeződik. */
        if (!focus) {
          const fromVehicle = vehicleOfContainerV147(event.from) || vehicleId;
          let toVehicle = vehicleOfContainerV147(event.to);
          const fallback = toVehicle === fromVehicle ? dropTargetFromPointV147(fromVehicle) : null;
          if (fallback) {
            global.__dropPointV147 = null;
            crossDriverMoveV147(movedIds, fallback.vehicle, fallback.before, event.item.classList.contains('pickup-move-block'));
            return;
          }
          global.__dropPointV147 = null;
          if (toVehicle && fromVehicle && toVehicle !== fromVehicle) {
            const beforeIds = idsBeforeDropV147(event.to, event.item, movedIds);
            const groupFrame = event.item.classList.contains('pickup-move-block');
            /* Egyetlen újrarajzolás a végén (mint korábban) – a dupla
               újrarajzolás megakasztotta a következő húzást. */
            crossDriverMoveV147(movedIds, toVehicle, beforeIds, groupFrame);
            return;
          }
        }
        if (focus) {
          updateSequencesFromContainer(element, vehicleId);
          renumberFocusRowsV74(element);
        }
        else {
          visibleVehiclesV147().forEach(vehicle => {
            const container = document.getElementById(`route-${vehicle.id}`);
            if (container) updateSequencesFromContainer(container, vehicle.id);
          });
        }
        const targetVehicleId = focus ? vehicleId : (vehicleOfContainerV147(event.to) || vehicleId);
        const anchorSequence = movedIds.map(id => state.orders.find(order => order.id === id)).filter(Boolean).reduce((min, order) => Math.min(min, +order.sequence || 999), 999);
        moveSupplierOrdersTogether(movedIds, targetVehicleId, anchorSequence);
        state.routePlans = state.routePlans || {}; state.routePlans[selectedDate()] = {};
        save();
        if (!focus && typeof renderRoutes === 'function') setTimeout(renderRoutes, 0);
        // V93: a napi fuvarlista ugyanazt az adatot mutatja, ezért az is frissül
        if (typeof global.renderDailyListV93 === 'function'
          && document.getElementById('dailylist')?.classList.contains('active')) setTimeout(global.renderDailyListV93, 60);
        // A térkép kövesse a kézi átrendezést. FONTOS a sorrend: előbb az
        // útvonalterv épül újra a kézi sequence értékekből, és csak utána
        // rajzolunk. Fordítva a rajzoló üres tervet találna, és
        // újraoptimalizálná az útvonalat, felülírva a te sorrendedet.
        const buildManual = global.V121Planner?.buildManualRouteV55 || global.V55Planner?.buildManualRouteV55;
        setTimeout(async () => {
          if (typeof buildManual === 'function') {
            try {
              for (const vehicle of activeVehicles()) await buildManual(vehicle);
            } catch (error) { /* a rajzolás így is lefut */ }
          }
          // A Nézet ablaknak saját térképe van, amit az initMaps nem érint,
          // ezért azt külön rajzoljuk újra.
          if (focus) { try { await drawFocusMap(vehicleId); } catch (error) { /* nem blokkoló */ } }
          else if (typeof initMaps === 'function') initMaps();
        }, 40);
      }
    });
  }

  function v37InitSortables() {
    visibleVehiclesV147().forEach(vehicle => {
      const list = document.getElementById(`route-${vehicle.id}`);
      createSortable(list, vehicle.id, false);
      /* V147: a felrakó-csoporton belüli buborékok egyenként is foghatók */
      list?.querySelectorAll('.pickup-group-orders').forEach(inner => createSortable(inner, vehicle.id, false, true));
    });
  }
  function absentWarningV147(vehicle, count) {
    const absence = typeof global.vehicleAbsenceV147 === 'function' ? global.vehicleAbsenceV147(vehicle, selectedDate()) : null;
    const only = String(vehicle.dayOnly || '').trim();
    if (!absence && only && only !== selectedDate()) return `<div class="v147-absent-warn">⚠ Ez az autó csak a(z) ${escHtml(only)} napra van beállítva (Járművek) – ma mégis ${count} rendelése van</div>`;
    if (!absence) return '';
    return `<div class="v147-absent-warn">🏖 Távol: ${escHtml(global.absenceLabelV147 ? global.absenceLabelV147(absence) : '')} – ${count} rendelés áthelyezendő</div>`;
  }
  function visibleVehiclesV147() {
    return typeof global.visibleVehiclesV147 === 'function' ? global.visibleVehiclesV147() : activeVehicles();
  }

  function renderFocusView() {
    if (!focusVehicleId) return;
    const dialog = document.getElementById('v37DriverViewDialog');
    if (!dialog?.open) return;
    const vehicle = state.vehicles.find(item => item.id === focusVehicleId);
    const list = dayOrders(focusVehicleId).sort((a, b) => (+a.sequence || 999) - (+b.sequence || 999));
    document.getElementById('v37FocusTitle').textContent = vehicle?.driverName || 'Sofőr';
    document.getElementById('v37FocusSummary').textContent = `${vehicle?.name || ''} · ${bubbleGroups(list).length} fuvar · ${list.length} rendelés`;
    const container = document.getElementById('v37FocusRoute');
    container.innerHTML = focusGroupedBubbles(list, focusVehicleId);
    if (focusSortable) focusSortable.destroy();
    focusSortable = createSortable(container, focusVehicleId, true);
    drawFocusMap(focusVehicleId);
  }

  function openDriverView(vehicleId) {
    ensureFocusDialog();
    focusVehicleId = vehicleId;
    const dialog = document.getElementById('v37DriverViewDialog');
    if (!dialog.open) dialog.showModal();
    renderFocusView();
  }

  function closeDriverView() {
    const dialog = document.getElementById('v37DriverViewDialog');
    if (dialog?.open) dialog.close();
  }

  function v37RenderRoutes() {
    syncAllBacklogStatuses();
    ensureFocusDialog();
    /* V147: a távollévő sofőr oszlopa csak akkor látszik, ha mégis van fuvarja */
    const vehicles = visibleVehiclesV147();
    /* V100: a rács a járművek számához igazodik – a negyedik autó a többi
       MELLÉ kerül, nem alá. A beállítás korábban az app.js renderRoutes
       függvényébe került, de a főoldalt VALÓJÁBAN ez a függvény rajzolja,
       és felülírja azt. */
    document.querySelector('#routes').style.setProperty('--route-cols', Math.max(1, vehicles.length));
    document.querySelector('#routes').innerHTML = vehicles.map(vehicle => {
      const list = dayOrders(vehicle.id).sort((a, b) => (+a.sequence || 999) - (+b.sequence || 999));
      const groupCount = bubbleGroups(list).length;
      return `<section class="route" data-driver="${driverKey(vehicle)}"><header class="route-head"><div class="route-head-main"><div><h2><input value="${escHtml(vehicle.driverName)}" onchange="renameDriver('${escHtml(vehicle.id)}',this.value)"></h2><small>${escHtml(vehicle.name)} · ${escHtml(vehicle.type)} · ${groupCount} fuvar · ${list.length} rendelés</small></div><div class="route-view-actions"><button type="button" class="dropoff-button" onclick="v33OpenDropoffs('${escHtml(vehicle.id)}')">Lerakók</button><button type="button" class="driver-view-button" onclick="v37OpenDriverView('${escHtml(vehicle.id)}')">Nézet</button><button type="button" class="v147-abs-head" onclick="openAbsenceDialogV147('${escHtml(vehicle.id)}')" title="Szabadság / távollét rögzítése">Távollét</button></div></div>${absentWarningV147(vehicle, list.length)}<div class="route-summary" id="summary-${escHtml(vehicle.id)}"></div></header><div id="map-${escHtml(vehicle.id)}" class="map"></div><div id="route-${escHtml(vehicle.id)}" class="route-list">${groupedBubbles(list, vehicle.id)}</div></section>`;
    }).join('') || '<div class="notice">Nincs aktív jármű.</div>';
    setTimeout(initMaps, 30);
    setTimeout(v37InitSortables, 40);
    setTimeout(updateSummaries, 60);
    setTimeout(renderFocusView, 80);
    /* V133: ha a Napi fuvarlista van nyitva, az is kövesse a „Fuvar napja és
       műveletek” panel dátumváltását. A régi app.js-beli rajzolóban ez már
       benne volt, de ez a függvény felülírja azt, és innen kimaradt. */
    if (typeof global.renderDailyListV93 === 'function'
      && document.getElementById('dailylist')?.classList.contains('active')) setTimeout(global.renderDailyListV93, 50);
  }

  function v37SetPickupGrouping(idsCsv, ungrouped) {
    const seedOrders = idsCsv.split(',').map(id => state.orders.find(order => order.id === id)).filter(Boolean);
    if (!seedOrders.length) return;
    const vehicleId = seedOrders[0].vehicleId;
    const date = seedOrders[0].scheduleDate;
    const key = pickupMoveKey(seedOrders[0]);
    const pickupOrders = (state.orders || []).filter(order => order.vehicleId === vehicleId && order.scheduleDate === date && pickupMoveKey(order) === key);
    pickupOrders.forEach(order => { order.pickupMoveUngrouped = !!ungrouped; });

    if (!ungrouped && pickupOrders.length > 1) {
      const day = (state.orders || []).filter(order => order.vehicleId === vehicleId && order.scheduleDate === date)
        .slice().sort((a, b) => (+a.sequence || 999) - (+b.sequence || 999));
      const pickupIds = new Set(pickupOrders.map(order => order.id));
      const target = day.filter(order => pickupIds.has(order.id));
      const firstIndex = Math.max(0, day.findIndex(order => pickupIds.has(order.id)));
      const remaining = day.filter(order => !pickupIds.has(order.id));
      remaining.splice(firstIndex, 0, ...target);
      remaining.forEach((order, index) => { order.sequence = index + 1; });
    }

    state.routePlans = state.routePlans || {};
    state.routePlans[date] = {};
    save();
  }

  function v37TogglePin(idsCsv, vehicleId) {
    const ids = idsCsv.split(',').filter(Boolean);
    const orders = ids.map(id => state.orders.find(order => order.id === id)).filter(Boolean);
    const shouldPin = !orders.every(order => order.routePinned);
    const focusBlock = focusVehicleId === vehicleId
      ? document.querySelector(`#v37FocusRoute .route-block[data-order-ids="${CSS.escape(idsCsv)}"]`)
      : null;
    const block = focusBlock || document.querySelector(`#route-${CSS.escape(vehicleId)} .route-block[data-order-ids="${CSS.escape(idsCsv)}"]`);
    let position = Math.min(...orders.map(order => +order.sequence || 999));
    if (block) {
      const focusContainer = document.getElementById('v37FocusRoute');
      const ordered = focusContainer?.contains(block) ? orderedRouteBlocks(focusContainer) : [...block.parentElement.querySelectorAll('.route-block')];
      const found = ordered.indexOf(block);
      if (found >= 0) position = found + 1;
    }
    orders.forEach(order => {
      order.routePinned = shouldPin;
      order.pinnedPosition = shouldPin ? position : null;
      order.pinnedVehicleId = shouldPin ? vehicleId : '';
    });
    save();
  }

  function v37ToggleGroupComplete(idsCsv) {
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

  function bindV37() {
    ensureV37State();
    migrateRyngAddress();
    syncAllBacklogStatuses();
    ensureFocusDialog();
    patchCompletionFunctions();
    const optimizeButton = document.getElementById('optimizeBtn');
    if (optimizeButton) {
      optimizeButton.onclick = event => { event.preventDefault(); return v37OptimizeAction(); };
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
      stickyFocusMap: true,
      pickupBlockDragging: true,
      supplierMovesAsOneBlock: true,
      pickupUngrouping: false,
      resolvedBacklogExcluded: true,
      ryngAddress: RYNG_ADDRESS
    });
    render();
  }

  if (typeof renderRoutes !== 'undefined') renderRoutes = v37RenderRoutes;
  if (typeof initSortables !== 'undefined') initSortables = v37InitSortables;
  if (typeof optimizeAll !== 'undefined') optimizeAll = v37OptimizeAction;
  if (global.V35Planner) global.V35Planner.v35BuildRoutePlan = v37BuildRoutePlan;

  global.v37OpenDriverView = openDriverView;
  global.v37CloseDriverView = closeDriverView;
  global.v37SetPickupGrouping = v37SetPickupGrouping;
  // V56 – kompakt sor viselkedése
  global.v56ToggleItems = function (ids, button) {
    const panel = document.querySelector(`.v56-items[data-items-for="${(ids || '').replace(/"/g, '')}"]`);
    if (!panel) return;
    if (panel.hidden) (ids || '').split(',').filter(Boolean).forEach(id => global.markUserCommentRead?.(id));
    panel.hidden = !panel.hidden;
    const caret = button?.querySelector('.v56-caret');
    if (caret) caret.textContent = panel.hidden ? '▾' : '▴';
    button?.classList.toggle('open', !panel.hidden);
  };
  global.v37TogglePin = v37TogglePin;
  global.v37ToggleGroupComplete = v37ToggleGroupComplete;
  global.V37Planner = {
    version: VERSION,
    RYNG_ADDRESS,
    applyDirectionalRules,
    pickupMoveKey,
    moveSupplierOrdersTogether,
    focusPickupUnits,
    renumberFocusRowsV74,
    groupedBubbles,
    drawFocusMap,
    renderCompactRowV56,
    renderCompactUnitV56,
    projectSummaryV56,
    v37SetPickupGrouping,
    isBacklogOrder,
    isResolvedBacklogOrder,
    syncBacklogForOrder,
    migrateRyngAddress,
    v37BuildRoutePlan,
    v37OptimizeAction
  };

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bindV37, { once: true });
    else bindV37();
  }
})(typeof window !== 'undefined' ? window : globalThis);
