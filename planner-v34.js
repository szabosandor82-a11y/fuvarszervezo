/* Fuvarszervező V34
   Elsődleges SERPA-kiosztás a meglévő „Autó” oszlop alapján:
   - Patrik / Márió / Martin: fix, névre szóló kiosztás
   - Dobozos: szabályalapú szétosztás Patrik és Márió között
   - Martin csak akkor kap Dobozos fuvarokat, ha a fix terhelése kevés és nincs sok szálas anyaga
   Az útvonal-optimalizálás továbbra sem oszt át sofőrt.
*/
(function (global) {
  'use strict';

  const VERSION = '34';
  const VALID_CATEGORIES = new Set(['patrik', 'mario', 'martin', 'dobozos']);
  const CENTRAL_RE = /(\bkrpr\b|k[oö]zponti\s*rakt[aá]r|keresked[oő]\s*utca|szigetszentmikl[oó]s)/i;

  const nrm = value => {
    if (typeof norm === 'function') return norm(value || '');
    return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[_.,;:()[\]{}\/\\-]+/g, ' ').replace(/\s+/g, ' ').trim();
  };
  const driverKey = vehicle => {
    const value = nrm(vehicle?.driverName || '');
    if (value.includes('patrik')) return 'patrik';
    if (value.includes('mario')) return 'mario';
    if (value.includes('martin')) return 'martin';
    return 'other';
  };
  const findDriver = (key, drivers = (typeof activeVehicles === 'function' ? activeVehicles() : [])) => drivers.find(vehicle => driverKey(vehicle) === key) || null;
  const classifyAutoValue = raw => {
    const value = nrm(raw);
    if (!value) return 'invalid';
    if (value.includes('patrik')) return 'patrik';
    if (value.includes('mario')) return 'mario';
    if (value.includes('martin')) return 'martin';
    if (value.includes('dobozos')) return 'dobozos';
    return 'invalid';
  };
  const supplierKey = order => nrm(order?.pickupName || order?.pickupAddress || 'ismeretlen felrako');
  const projectKey = order => nrm(order?.dropAddress || order?.projectName || 'ismeretlen lerako');
  const bubbleKey = order => `${supplierKey(order)}||${projectKey(order)}`;
  const isCentralOrder = order => CENTRAL_RE.test(`${order?.pickupName || ''} ${order?.pickupAddress || ''}`);
  const groupBy = (list, keyFn) => {
    const map = new Map();
    for (const item of list) {
      const key = keyFn(item);
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(item);
    }
    return map;
  };
  const finitePoint = point => Array.isArray(point) && Number.isFinite(+point[0]) && Number.isFinite(+point[1]);
  const km = (a, b) => {
    if (!finitePoint(a) || !finitePoint(b)) return 40;
    if (typeof v29Km === 'function') return v29Km(a, b);
    const R = 6371, rad = x => x * Math.PI / 180;
    const dLat = rad(b[0] - a[0]), dLon = rad(b[1] - a[1]);
    const q = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(q));
  };
  const groupWeight = group => global.V33Planner?.groupWeight ? global.V33Planner.groupWeight(group) : 1 + Math.max(0, group.length - 1) * 0.35;

  function ensureV34State() {
    if (typeof state === 'undefined') return;
    state.orders = state.orders || [];
    state.routePlans = state.routePlans || {};
    state.routeStats = state.routeStats || {};
    state.orders.forEach(order => {
      if (!order.importVehicleCategory && order.importVehicleLocked && order.vehicleId) {
        const vehicle = state.vehicles?.find(item => item.id === order.vehicleId);
        const key = driverKey(vehicle);
        if (VALID_CATEGORIES.has(key)) order.importVehicleCategory = key;
      }
    });
  }

  function categoryForOrder(order) {
    const explicit = nrm(order?.importVehicleCategory || '');
    if (VALID_CATEGORIES.has(explicit)) return explicit;
    if (order?.routePinned && (order?.pinnedVehicleId || order?.vehicleId)) return `fixed:${order.pinnedVehicleId || order.vehicleId}`;
    if (order?.importVehicleLocked && order?.vehicleId) return `fixed:${order.vehicleId}`;
    // Régi, kategória nélküli adatok kompatibilitása.
    if (order?.markedMartin || order?.longMaterialReason) return 'martin';
    return 'dobozos';
  }

  function distributionGroupKey(order) {
    const category = categoryForOrder(order);
    return `${bubbleKey(order)}||${category}`;
  }

  function fixedVehicleForGroup(group, drivers) {
    const pinned = group.find(order => order.routePinned && (order.pinnedVehicleId || order.vehicleId));
    if (pinned) return drivers.find(vehicle => vehicle.id === (pinned.pinnedVehicleId || pinned.vehicleId)) || null;
    const category = categoryForOrder(group[0]);
    if (category.startsWith('fixed:')) return drivers.find(vehicle => vehicle.id === category.slice(6)) || null;
    if (category === 'patrik' || category === 'mario' || category === 'martin') return findDriver(category, drivers);
    return null;
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
      if (typeof orderGeoProfile === 'function') profiles[order.id] = await orderGeoProfile(order);
      else profiles[order.id] = {
        pickup: typeof geo === 'function' ? await geo(order.pickupAddress) : null,
        drop: typeof geo === 'function' ? await geo(order.dropAddress) : null
      };
    }
    profiles.__base = typeof geo === 'function' && typeof state !== 'undefined' ? await geo(state.settings?.baseAddress || '') : null;
    return profiles;
  }

  function pickupSide(group, profiles) {
    if (isCentralOrder(group[0])) return 'central';
    const point = unitPoint(group, profiles, 'pickup');
    if (global.V33Planner?.pickupSide) return global.V33Planner.pickupSide(point, group[0]?.pickupAddress || '');
    return 'unknown';
  }

  function routeFitCost(vehicle, group, profiles, assignedGroups) {
    const pickup = unitPoint(group, profiles, 'pickup');
    const home = vehicle?.homePoint || null;
    const base = profiles.__base;
    const existingOrders = assignedGroups.flatMap(item => item);
    const samePickup = existingOrders.some(order => supplierKey(order) === supplierKey(group[0])) ? -9 : 0;
    const sameProject = existingOrders.some(order => projectKey(order) === projectKey(group[0])) ? -4 : 0;
    let anchor = null;
    if (driverKey(vehicle) === 'patrik' || driverKey(vehicle) === 'martin') anchor = base;
    else anchor = home || base;
    return km(anchor || pickup, pickup) + samePickup + sameProject;
  }

  function setGroupVehicle(group, vehicle, assigned, loads) {
    if (!vehicle) return;
    group.forEach(order => {
      order.vehicleId = vehicle.id;
      assigned[vehicle.id].push(order);
    });
    loads[vehicle.id] += groupWeight(group);
  }

  function moveGroup(group, source, target, assigned, loads) {
    const ids = new Set(group.map(order => order.id));
    assigned[source.id] = assigned[source.id].filter(order => !ids.has(order.id));
    group.forEach(order => {
      order.vehicleId = target.id;
      assigned[target.id].push(order);
    });
    const weight = groupWeight(group);
    loads[source.id] -= weight;
    loads[target.id] += weight;
  }

  function fairnessSpread(loads, drivers) {
    const values = drivers.map(vehicle => loads[vehicle.id] || 0);
    return Math.max(...values) - Math.min(...values);
  }

  async function distributeOrderSet(orders, options = {}) {
    ensureV34State();
    const drivers = (options.drivers || (typeof activeVehicles === 'function' ? activeVehicles() : [])).slice();
    if (!drivers.length) throw new Error('Nincs aktív jármű.');

    const profiles = await profileOrders(orders);
    const assigned = Object.fromEntries(drivers.map(vehicle => [vehicle.id, []]));
    const loads = Object.fromEntries(drivers.map(vehicle => [vehicle.id, 0]));
    const mario = findDriver('mario', drivers);
    const patrik = findDriver('patrik', drivers);
    const martin = findDriver('martin', drivers);

    const groups = [...groupBy(orders, distributionGroupKey).values()].sort((a, b) => groupWeight(b) - groupWeight(a));
    const fixedGroups = [];
    const boxGroups = [];

    for (const group of groups) {
      const category = categoryForOrder(group[0]);
      const fixedVehicle = fixedVehicleForGroup(group, drivers);
      if (category !== 'dobozos' || fixedVehicle) fixedGroups.push({ group, vehicle: fixedVehicle || drivers[0] });
      else boxGroups.push(group);
    }

    fixedGroups.forEach(({ group, vehicle }) => setGroupVehicle(group, vehicle, assigned, loads));

    const totalWeight = groups.reduce((sum, group) => sum + groupWeight(group), 0);
    const target = totalWeight / Math.max(1, drivers.length);
    const martinLongWeight = martin
      ? [...groupBy(assigned[martin.id].filter(order => order.longMaterialReason), bubbleKey).values()].reduce((sum, group) => sum + groupWeight(group), 0)
      : Infinity;
    const martinCanHelp = !!martin && loads[martin.id] < target * 0.72 && martinLongWeight < target * 0.58;

    const buda = [], pest = [], neutral = [];
    boxGroups.forEach(group => {
      const side = pickupSide(group, profiles);
      if (side === 'buda') buda.push(group);
      else if (side === 'pest') pest.push(group);
      else neutral.push(group);
    });

    // A területi alapelv elsődleges: Buda Patrik, Pest Márió.
    buda.forEach(group => setGroupVehicle(group, patrik || martin || mario || drivers[0], assigned, loads));
    pest.forEach(group => setGroupVehicle(group, mario || patrik || martin || drivers[0], assigned, loads));

    // Központi/semleges felvételek az igazságosságot szolgálják.
    neutral.sort((a, b) => groupWeight(b) - groupWeight(a)).forEach(group => {
      let candidates = [patrik, mario].filter(Boolean);
      if (martinCanHelp) candidates.push(martin);
      if (!candidates.length) candidates = drivers.slice();
      const central = isCentralOrder(group[0]);
      const ranked = candidates.map(vehicle => ({
        vehicle,
        // A központi raktári fuvar tiszta kiegyenlítő egység: itt a terhelés az elsődleges.
        score: loads[vehicle.id] + (central ? 0 : routeFitCost(vehicle, group, profiles, [...groupBy(assigned[vehicle.id], distributionGroupKey).values()]) * 0.08)
      })).sort((a, b) => a.score - b.score || driverKey(a.vehicle).localeCompare(driverKey(b.vehicle)));
      setGroupVehicle(group, ranked[0]?.vehicle || drivers[0], assigned, loads);
    });

    // Ha Martin valóban alulterhelt, Dobozos blokkokkal közelítjük az igazságos terhelést.
    if (martinCanHelp && (patrik || mario)) {
      const movableByVehicle = vehicle => [...groupBy(
        assigned[vehicle.id].filter(order => categoryForOrder(order) === 'dobozos' && !order.routePinned && !order.importVehicleLocked),
        distributionGroupKey
      ).values()];

      let guard = 0;
      while (guard++ < boxGroups.length + 5 && loads[martin.id] < target * 0.92) {
        const sources = [patrik, mario].filter(Boolean).sort((a, b) => loads[b.id] - loads[a.id]);
        const source = sources[0];
        if (!source || loads[source.id] - loads[martin.id] < 2.0) break;
        const currentSpread = fairnessSpread(loads, drivers);
        const candidates = movableByVehicle(source).map(group => {
          const weight = groupWeight(group);
          const simulated = { ...loads, [source.id]: loads[source.id] - weight, [martin.id]: loads[martin.id] + weight };
          const spread = fairnessSpread(simulated, drivers);
          const routeCost = routeFitCost(martin, group, profiles, [...groupBy(assigned[martin.id], distributionGroupKey).values()]);
          const overshoot = Math.max(0, simulated[martin.id] - target * 1.08) * 5;
          return { group, score: spread + routeCost * 0.025 + overshoot, improvement: currentSpread - spread };
        }).filter(item => item.improvement > 0.05).sort((a, b) => a.score - b.score);
        if (!candidates.length) break;
        moveGroup(candidates[0].group, source, martin, assigned, loads);
      }
    }

    Object.values(assigned).forEach(list => list
      .sort((a, b) => supplierKey(a).localeCompare(supplierKey(b), 'hu') || projectKey(a).localeCompare(projectKey(b), 'hu'))
      .forEach((order, index) => { order.sequence = index + 1; }));

    return { assigned, load: loads, loads, profiles, target, martinCanHelp };
  }

  async function v34DistributeCurrentDay() {
    ensureV34State();
    const orders = state.orders.filter(order => order.scheduleDate === selectedDate());
    if (!orders.length) throw new Error('Nincs szétosztható fuvar az adott napon.');
    const result = await distributeOrderSet(orders);
    state.routePlans[selectedDate()] = {};
    state.routeStats[selectedDate()] = {};
    for (const vehicle of activeVehicles()) state.routePlans[selectedDate()][vehicle.id] = [];
    return result;
  }

  async function v34PreassignImportedOrders(orders) {
    ensureV34State();
    const byDate = groupBy(orders, order => order.scheduleDate || 'datum-nelkul');
    const results = [];
    for (const dateOrders of byDate.values()) results.push(await distributeOrderSet(dateOrders));
    return results;
  }

  function v34HeaderMap(headers) {
    const base = typeof headerMap === 'function' ? headerMap(headers) : {};
    const normalized = headers.map(nrm);
    const auto = normalized.findIndex(value => value === 'auto');
    return { ...base, auto };
  }

  function applyAutoCategory(order, rawValue, drivers = (typeof activeVehicles === 'function' ? activeVehicles() : [])) {
    const category = classifyAutoValue(rawValue);
    order.importAutoRaw = String(rawValue || '').trim();
    order.importVehicleCategory = category;
    order.importAutoInvalid = category === 'invalid';
    order.importAutoConflict = false;
    order.importVehicleLocked = category !== 'dobozos' && category !== 'invalid';
    if (category === 'patrik' || category === 'mario' || category === 'martin') {
      const vehicle = findDriver(category, drivers);
      order.vehicleId = vehicle?.id || '';
      if (!vehicle) order.importAutoInvalid = true;
    } else {
      order.vehicleId = '';
    }
    return category;
  }

  async function v34ReadExcel(file) {
    const wb = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
    if (!rows.length) return alert('Az Excel fájl üres.');
    const headers = rows[0].map(String);
    const h = v34HeaderMap(headers);
    if (h.topic < 0 || h.supplier < 0) return alert('Hiányzó kötelező SERPA oszlop: Témaszám név vagy Ügyfél/raktár név.');
    if (h.date < 0 || nrm(headers[h.date]) !== 'datum') return alert('Nem található a SERPA Dátum oszlopa.');
    if (h.auto < 0) return alert('Nem található az „Autó” oszlop. A V34 ebben várja a Patrik, Márió, Martin vagy Dobozos értéket.');

    const grouped = {};
    for (const row of rows.slice(1)) {
      const date = dateVal(row[h.date]);
      if (!date) continue;
      const no = last5(row[h.doc]);
      const topic = String(row[h.topic] || '');
      const supplier = String(row[h.supplier] || '');
      const key = [date, no, topic, supplier].join('|');
      const longMaterial = longReason(row[h.product]);
      if (!grouped[key]) grouped[key] = {
        id: uid(), scheduleDate: date, vehicleId: '', sequence: 999, orderNo: no,
        topicName: topic, pickupName: supplier, pickupAddress: '', pickupNote: '',
        projectName: '', dropAddress: '', recipientName: '', recipientPhone: '', recipientEmail: '',
        requestedDeadline: dateVal(row[h.deadline]), note: h.note >= 0 ? String(row[h.note] || '') : '',
        items: [], longMaterialReason: '', _autoValues: []
      };
      if (longMaterial) grouped[key].longMaterialReason = longMaterial;
      grouped[key].items.push({
        code: String(row[h.code] || ''), name: String(row[h.product] || ''), qty: row[h.qty],
        unit: String(row[h.unit] || ''), itemNote: h.itemNote >= 0 ? String(row[h.itemNote] || '') : '',
        longMaterial: !!longMaterial, received: false
      });
      grouped[key]._autoValues.push(String(row[h.auto] || '').trim());
    }

    importOrders = Object.values(grouped);
    importOrders.forEach(order => {
      const categories = [...new Set(order._autoValues.map(classifyAutoValue))];
      const rawValues = [...new Set(order._autoValues.map(value => String(value || '').trim()).filter(Boolean))];
      if (categories.length !== 1 || categories[0] === 'invalid') {
        order.importAutoRaw = rawValues.join(' / ');
        order.importVehicleCategory = 'invalid';
        order.importAutoInvalid = true;
        order.importAutoConflict = categories.length > 1 || rawValues.length > 1;
        order.importVehicleLocked = false;
        order.vehicleId = '';
      } else applyAutoCategory(order, rawValues[0] || order._autoValues[0]);
      delete order._autoValues;

      const project = projectMatch(order.topicName);
      const supplier = supplierMatch(order.pickupName);
      if (project) {
        order.projectId = project.id;
        order.projectName = project.name;
        order.dropAddress = project.address;
        const recipient = state.recipients.find(item => item.id === project.defaultRecipientId);
        if (recipient) {
          order.recipientId = recipient.id;
          order.recipientName = recipient.name;
          order.recipientPhone = recipient.phone;
          order.recipientEmail = recipient.email;
        }
      }
      if (supplier) {
        order.supplierId = supplier.id;
        order.pickupAddress = supplier.address || '';
        order.pickupNote = supplier.pickupNote || '';
      }
      const dropSupplier = typeof exactSupplierMaster === 'function' ? exactSupplierMaster(order.topicName) : null;
      if (!project && dropSupplier) {
        order.projectName = order.topicName;
        order.dropAddress = dropSupplier.address || '';
      }
    });

    const counts = ['Martin', 'Patrik', 'Márió', 'Dobozos'].map(label => {
      const category = classifyAutoValue(label);
      return `${label}: ${importOrders.filter(order => order.importVehicleCategory === category).length}`;
    }).join(' · ');
    const invalid = importOrders.filter(order => order.importVehicleCategory === 'invalid').length;
    document.querySelector('#importPreview').textContent = `${importOrders.length} összesített rendelés. ${counts}. Hibás/üres Autó érték: ${invalid}. Egyéb bizonytalan/hiányos: ${importOrders.filter(order => v34NeedsReview(order)).length}.`;
    document.querySelector('#startReviewBtn').disabled = false;
  }

  function v34NeedsReview(order) {
    const category = categoryForOrder(order);
    const namedWithoutVehicle = (category === 'patrik' || category === 'mario' || category === 'martin') && !order.vehicleId;
    return !order.projectId || !order.supplierId || !order.pickupAddress || !order.dropAddress || category === 'invalid' || order.importAutoInvalid || order.importAutoConflict || namedWithoutVehicle;
  }

  function v34SaveReview() {
    const order = reviewQueue[reviewIndex];
    const project = state.projects.find(item => item.id === document.querySelector('#rvProject').value);
    const supplier = state.suppliers.find(item => item.id === document.querySelector('#rvSupplier').value);
    order.projectId = project?.id || '';
    order.projectName = project?.name || order.topicName || '';
    order.dropAddress = document.querySelector('#rvDrop').value;
    order.supplierId = supplier?.id || '';
    order.pickupName = supplier?.name || order.pickupName;
    order.pickupAddress = document.querySelector('#rvPickup').value;
    const selectedVehicleId = document.querySelector('#rvVehicle').value || '';
    if (selectedVehicleId) {
      const vehicle = state.vehicles.find(item => item.id === selectedVehicleId);
      order.vehicleId = selectedVehicleId;
      order.importVehicleCategory = driverKey(vehicle);
      order.importAutoRaw = vehicle?.driverName || '';
      order.importVehicleLocked = true;
    } else {
      order.vehicleId = '';
      order.importVehicleCategory = 'dobozos';
      order.importAutoRaw = 'Dobozos';
      order.importVehicleLocked = false;
    }
    order.importAutoInvalid = false;
    order.importAutoConflict = false;
    order.note = document.querySelector('#rvNote').value;
    if (project) state.aliases.projects[nrm(order.topicName)] = project.id;
    if (supplier) state.aliases.suppliers[nrm(order.pickupName)] = supplier.id;
    reviewIndex++;
    if (reviewIndex >= reviewQueue.length) {
      document.querySelector('#reviewDialog').close();
      v34FinalizeImport();
    } else showReview();
  }

  async function v34FinalizeImport() {
    try {
      if (!Array.isArray(importOrders) || !importOrders.length) return;
      await v34PreassignImportedOrders(importOrders);
      state.orders.push(...importOrders);
      const driverCounts = activeVehicles().map(vehicle => `${vehicle.driverName}: ${importOrders.filter(order => order.vehicleId === vehicle.id).length}`).join(', ');
      const fixedCount = importOrders.filter(order => order.importVehicleLocked).length;
      const boxCount = importOrders.filter(order => order.importVehicleCategory === 'dobozos').length;
      importOrders = [];
      document.querySelector('#importDialog').close();
      save();
      alert(`Import beillesztve. Névre rögzített: ${fixedCount}, Dobozosként szétosztott: ${boxCount}. ${driverCounts}`);
    } catch (error) {
      console.error('[V34] Import besorolási hiba', error);
      alert(`Az import besorolása közben hiba történt: ${error?.message || error}`);
    }
  }

  async function v34BalanceAction() {
    try {
      const result = await v34DistributeCurrentDay();
      save();
      const summary = activeVehicles().map(vehicle => {
        const orders = dayOrders(vehicle.id);
        const groups = global.V33Planner?.orderedBubbleGroups ? global.V33Planner.orderedBubbleGroups(orders) : orders;
        const fixed = orders.filter(order => order.importVehicleLocked).length;
        const box = orders.filter(order => categoryForOrder(order) === 'dobozos').length;
        return `${vehicle.driverName}: ${groups.length} fuvar / ${orders.length} rendelés (${fixed} névre, ${box} dobozos)`;
      }).join(', ');
      alert(`Fuvarok szétosztva az Autó oszlop alapján. A névre jelölt fuvarok nem változtak. ${summary}\nAz útvonalsorrendhez nyomd meg az „Útvonal optimalizálása” gombot.`);
      return result;
    } catch (error) {
      console.error('[V34] Szétosztási hiba', error);
      alert(`A fuvarok szétosztása közben hiba történt: ${error?.message || error}`);
      return null;
    }
  }

  async function v34OptimizeAction() {
    if (!global.V33Planner?.v33OptimizeAction) throw new Error('A V33 útvonalmotor nem érhető el.');
    return global.V33Planner.v33OptimizeAction();
  }

  function bindV34() {
    ensureV34State();
    if (typeof document === 'undefined') return;
    const balanceButton = document.getElementById('balanceBtn');
    const optimizeButton = document.getElementById('optimizeBtn');
    if (balanceButton) {
      balanceButton.onclick = event => { event.preventDefault(); return v34BalanceAction(); };
      balanceButton.dataset.algorithmVersion = VERSION;
      balanceButton.title = '1. lépés: névre szóló fuvarok rögzítése, Dobozos fuvarok igazságos szétosztása';
    }
    if (optimizeButton) {
      optimizeButton.onclick = event => { event.preventDefault(); return v34OptimizeAction(); };
      optimizeButton.dataset.algorithmVersion = VERSION;
      optimizeButton.title = '2. lépés: a már kiosztott fuvarok sorrendjének optimalizálása';
    }
    const help = document.querySelector('#importDialog .help');
    if (help) help.textContent = 'A SERPA „Autó” oszlopában Patrik, Márió, Martin vagy Dobozos szerepelhet. A névre jelölt fuvar fixen oda kerül; a Dobozos fuvarokat a program osztja szét. Martin csak jelentős alulterhelésnél és kevés szálas anyag mellett kap Dobozos fuvart.';
    global.FUVARSZERVEZO_VERSION = VERSION;
    global.getFuvarszervezoDiagnostics = () => ({
      version: VERSION,
      balanceHandler: balanceButton?.dataset.algorithmVersion || null,
      optimizeHandler: optimizeButton?.dataset.algorithmVersion || null,
      importColumn: 'Autó',
      categories: ['Patrik', 'Márió', 'Martin', 'Dobozos'],
      namedAssignmentsLocked: true,
      boxDistribution: 'Buda→Patrik, Pest→Márió, Martin csak alulterhelésnél'
    });
  }

  if (typeof readExcel !== 'undefined') readExcel = v34ReadExcel;
  if (typeof needsReview !== 'undefined') needsReview = v34NeedsReview;
  if (typeof saveReview !== 'undefined') saveReview = v34SaveReview;
  if (typeof finalizeImport !== 'undefined') finalizeImport = v34FinalizeImport;
  if (typeof balance !== 'undefined') balance = v34BalanceAction;
  if (typeof optimizeAll !== 'undefined') optimizeAll = v34OptimizeAction;

  global.V34Planner = {
    version: VERSION,
    classifyAutoValue,
    applyAutoCategory,
    categoryForOrder,
    distributionGroupKey,
    distributeOrderSet,
    v34DistributeCurrentDay,
    v34PreassignImportedOrders,
    v34NeedsReview,
    v34BalanceAction,
    v34OptimizeAction
  };

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bindV34, { once: true });
    else bindV34();
  }
})(typeof window !== 'undefined' ? window : globalThis);
