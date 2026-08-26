/* Fuvarszervező V50
   Determinisztikus felrakóhely-blokkos szétosztás.

   Kemény szabályok:
   - Márió / Patrik / Martin névre rögzített fuvar automatikusan nem mozgatható.
   - Egy fizikai felrakóhely minden mozgatható rendelése egy sofőrhöz kerül.
   - Márió: pesti oldal. Patrik: budai oldal. Martin: platós/szálanyag + nyugati folyosó.
   - Martin elsősorban a platós/szálanyagos fuvarokat kapja; ha nincs ilyen, a Dobozos terhelésből is részt kap.
   - Márió Vác, Martin Felcsút, Patrik a központi raktár felől indul.
   - A szétosztás után azonnal felrakási sorrend készül; az optimalizálás sofőrt nem változtat.
*/
(function (global) {
  'use strict';

  const VERSION = '50';
  const CENTRAL_ADDRESS = '2310 Szigetszentmiklós, Kereskedő utca 2.';
  const HOMES = {
    mario: { address: 'Vác, Magyarország', point: [47.7759, 19.1360] },
    martin: { address: 'Felcsút, Magyarország', point: [47.4550, 18.5860] },
    patrik: { address: CENTRAL_ADDRESS, point: [47.3434, 19.0437] }
  };

  const nrm = value => {
    if (typeof norm === 'function') return norm(value || '');
    return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[_.,;:()[\]{}\/\\-]+/g, ' ').replace(/\s+/g, ' ').trim();
  };
  const finitePoint = point => Array.isArray(point) && point.length === 2 && Number.isFinite(+point[0]) && Number.isFinite(+point[1]);
  const km = (a, b) => {
    if (!finitePoint(a) || !finitePoint(b)) return 35;
    if (typeof dist === 'function') return dist(a, b);
    const rad = value => value * Math.PI / 180, R = 6371;
    const dLat = rad(b[0] - a[0]), dLon = rad(b[1] - a[1]);
    const q = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(q));
  };
  const groupBy = (list, keyFn) => {
    const map = new Map();
    for (const item of list || []) {
      const key = keyFn(item);
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(item);
    }
    return map;
  };
  const driverKey = vehicle => {
    const value = nrm(vehicle?.driverName || '');
    if (value.includes('mario')) return 'mario';
    if (value.includes('patrik')) return 'patrik';
    if (value.includes('martin')) return 'martin';
    return 'other';
  };
  const findDriver = (key, drivers) => (drivers || []).find(vehicle => driverKey(vehicle) === key) || null;
  const categoryForOrder = order => global.V35Planner?.categoryForOrder
    ? global.V35Planner.categoryForOrder(order)
    : nrm(order?.importVehicleCategory || order?.vehicleCategory || 'dobozos');
  const physicalLoad = order => global.V35Planner?.physicalLoad
    ? global.V35Planner.physicalLoad(order)
    : ({ long: order?.longMaterialReason ? 1 : 0, bulky: 0, full: 0 });
  // A szigetszentmiklósi városnév önmagában NEM jelent központi raktárt
  // (pl. Niczuk is Szigetszentmiklóson van). Központ csak KRPR/PRPR vagy a
  // Kereskedő utcai, kifejezetten központiként jelölt felrakó lehet.
  const centralOrder = order => /(\b(?:krpr|prpr)\b|k[oö]zponti\s*rakt[aá]r|keresked[oő]\s*(?:utca|u\.?))/i.test(`${order?.orderType || ''} ${order?.pickupName || ''} ${order?.pickupAddress || ''}`);

  function canonicalAddress(value = '') {
    return nrm(value)
      .replace(/\bmagyarorszag\b/g, '')
      .replace(/\b(?:utca|u)\b/g, 'utca')
      .replace(/\b(?:ut|út)\b/g, 'ut')
      .replace(/\b(?:korut|krt)\b/g, 'korut')
      .replace(/\b(?:ter|tér)\b/g, 'ter')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function locationKey(order) {
    if (centralOrder(order)) return 'location:central';
    const address = canonicalAddress(order?.pickupAddress || '');
    if (address) return `location:address:${address}`;
    if (order?.supplierId) return `location:supplier:${order.supplierId}`;
    return `location:name:${nrm(order?.pickupName || 'ismeretlen felrako')}`;
  }

  function supplierAssignmentKey(order) {
    if (centralOrder(order)) return 'supplier:central';
    const master = order?.supplierId && typeof state !== 'undefined'
      ? (state.suppliers || []).find(item => item.id === order.supplierId)
      : null;
    const name = master?.name || order?.pickupName || '';
    if (!name) return '';
    const canonical = global.V35Planner?.canonicalStop
      ? global.V35Planner.canonicalStop({ name, address: '' })
      : nrm(name);
    return `supplier:${canonical || nrm(name)}`;
  }

  function isResolved(order) {
    return !!(order?.backlogResolved && order?.completed);
  }

  function fixedVehicleForOrder(order, drivers) {
    if (!order) return null;
    if (isResolved(order) && order.vehicleId) return drivers.find(vehicle => vehicle.id === order.vehicleId) || null;
    const pinnedId = order.pinnedVehicleId || order.vehicleId;
    if ((order.importVehicleLocked || order.manualVehicleLocked || order.routePinned) && pinnedId) {
      return drivers.find(vehicle => vehicle.id === pinnedId) || null;
    }
    const category = String(categoryForOrder(order) || '');
    if (category.startsWith('fixed:')) return drivers.find(vehicle => vehicle.id === category.slice(6)) || null;
    if (order.importVehicleLocked && ['mario', 'patrik', 'martin'].includes(category)) return findDriver(category, drivers);
    return null;
  }

  function fixedVehicleForBlock(block, drivers) {
    const fixed = block.orders.map(order => fixedVehicleForOrder(order, drivers)).filter(Boolean);
    const unique = [...new Map(fixed.map(vehicle => [vehicle.id, vehicle])).values()];
    return unique.length === 1 ? unique[0] : null;
  }

  function blockPoint(block, profiles) {
    for (const order of block.orders) {
      const point = profiles?.[order.id]?.pickup;
      if (finitePoint(point)) return point;
    }
    return null;
  }

  function supplierMasterForBlock(block) {
    const suppliers = typeof state !== 'undefined' ? state.suppliers || [] : [];
    for (const order of block.orders) {
      if (order.supplierId) {
        const byId = suppliers.find(item => item.id === order.supplierId);
        if (byId) return byId;
      }
    }
    const first = block.orders[0] || {};
    const byAddress = suppliers.find(item => canonicalAddress(item.address) && canonicalAddress(item.address) === canonicalAddress(first.pickupAddress));
    if (byAddress) return byAddress;
    return suppliers.find(item => nrm(item.name) === nrm(first.pickupName)) || null;
  }

  function explicitZone(block) {
    const master = supplierMasterForBlock(block);
    const raw = block.orders.map(order => order.routeZone || order.pickupZone || order.territory || order.side || '').find(Boolean)
      || master?.routeZone || master?.pickupZone || master?.territory || master?.side || '';
    const value = nrm(raw);
    if (/buda/.test(value)) return 'buda';
    if (/pest/.test(value)) return 'pest';
    if (/martin|nyugat|felcsut|folyoso/.test(value)) return 'martin-corridor';
    if (/kozpont|central/.test(value)) return 'central';
    if (/semleges|neutral/.test(value)) return 'neutral';
    return '';
  }

  function budapestDistrict(address = '') {
    const match = String(address).match(/\b(1\d{3})\b/);
    if (!match) return null;
    const code = match[1];
    if (code.startsWith('10')) return +code[2] || null;
    return +code.slice(1, 3) || null;
  }

  function pickupZone(block, profiles) {
    if (block.zone) return block.zone;
    const explicit = explicitZone(block);
    if (explicit) return (block.zone = explicit);
    const first = block.orders[0] || {};
    if (centralOrder(first)) return (block.zone = 'central');
    const text = nrm(`${first.pickupName || ''} ${first.pickupAddress || ''}`);
    const canonical = global.V35Planner?.canonicalStop
      ? global.V35Planner.canonicalStop({ name: first.pickupName, address: first.pickupAddress })
      : '';

    if (/felcsut|bicske|alcsut|csakvar|vertesacsa|etyek/.test(text)) return (block.zone = 'martin-corridor');

    const knownBuda = new Set(['niczuk', 'cairox', 'gienger', 'lambda', 'sebok', 'azimut', 'empack']);
    const knownPest = new Set(['szatmari', 'merkapt', 'ezerker', 'fogarasi', 'szerelvenybolt', 'ryng', 'neber', 'ferenczi', 'larex', 'attacso', 'dtkozmu']);
    if (knownBuda.has(canonical)) return (block.zone = 'buda');
    if (knownPest.has(canonical)) return (block.zone = 'pest');

    const district = budapestDistrict(first.pickupAddress || '');
    if (district) return (block.zone = new Set([1, 2, 3, 11, 12, 22]).has(district) ? 'buda' : 'pest');

    if (/budaors|torokbalint|biatorbagy|erd|budakeszi|solymar|pilisborosjeno|szentendre|budafok|nagyteteny|hengermalom|hunyadi janos/.test(text)) return (block.zone = 'buda');
    if (/vac|dunakeszi|kistarcsa|nagytarcsa|rakospalota|kesmark|maglodi|gyomroi|kada|ullo|vecses|gyal|kispest|kobanya|soroksar|csepel|dunaharaszti/.test(text)) return (block.zone = 'pest');

    const point = blockPoint(block, profiles);
    if (finitePoint(point) && point[0] >= 47.30 && point[0] <= 47.70 && point[1] >= 18.78 && point[1] <= 19.32) {
      return (block.zone = point[1] < 19.045 ? 'buda' : 'pest');
    }
    return (block.zone = 'neutral');
  }

  function hasLongMaterial(block) {
    return block.orders.some(order => {
      const load = physicalLoad(order);
      return !!order.longMaterialReason || +load.long > 0 || categoryForOrder(order) === 'martin';
    });
  }

  async function buildProfiles(orders) {
    const profiles = {};
    for (const order of orders) {
      if (typeof syncOrderFromMasters === 'function') syncOrderFromMasters(order);
      profiles[order.id] = typeof orderGeoProfile === 'function'
        ? await orderGeoProfile(order)
        : { pickup: typeof geo === 'function' ? await geo(order.pickupAddress || '') : null, drop: null };
    }
    profiles.__base = typeof geo === 'function' ? await geo(CENTRAL_ADDRESS) : HOMES.patrik.point;
    return profiles;
  }

  async function vehicleHomeV44(vehicle) {
    const key = driverKey(vehicle);
    if (HOMES[key]) return HOMES[key].point.slice();
    if (typeof global.vehicleHome === 'function' && global.vehicleHome !== vehicleHomeV44) {
      const result = await global.vehicleHome(vehicle);
      if (finitePoint(result)) return result;
    }
    return HOMES.patrik.point.slice();
  }

  function makeBlocks(orders, profiles, drivers) {
    // Egy napi kiosztási egységbe kerül minden azonos beszállító, és minden
    // azonos fizikai felrakóhely is. Így sem ugyanaz a beszállító, sem ugyanaz
    // a cím nem szakadhat két sofőrre.
    const list = (orders || []).slice();
    const parent = list.map((_, index) => index);
    const find = index => parent[index] === index ? index : (parent[index] = find(parent[index]));
    const join = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[rb] = ra; };
    const supplierOwner = new Map(), locationOwner = new Map();
    list.forEach((order, index) => {
      const supplier = supplierAssignmentKey(order);
      const location = locationKey(order);
      if (supplier) { if (supplierOwner.has(supplier)) join(index, supplierOwner.get(supplier)); else supplierOwner.set(supplier, index); }
      if (location) { if (locationOwner.has(location)) join(index, locationOwner.get(location)); else locationOwner.set(location, index); }
    });
    const components = new Map();
    list.forEach((order, index) => { const root = find(index); if (!components.has(root)) components.set(root, []); components.get(root).push(order); });
    const raw = [...components.values()].map(grouped => ({
      key: `${supplierAssignmentKey(grouped[0]) || 'supplier:unknown'}||${locationKey(grouped[0])}`,
      orders: grouped.slice().sort((a, b) => String(a.orderNo || '').localeCompare(String(b.orderNo || ''), 'hu')),
      point: null,
      zone: '',
      fixedDrivers: [],
      assignmentReason: '',
      movable: true
    }));
    for (const block of raw) {
      block.point = blockPoint(block, profiles);
      block.fixedDrivers = [...new Map(block.orders.map(order => fixedVehicleForOrder(order, drivers)).filter(Boolean).map(vehicle => [vehicle.id, vehicle])).values()];
      block.movable = block.fixedDrivers.length === 0 && block.orders.every(order => !order.routePinned && !order.importVehicleLocked && !order.manualVehicleLocked && categoryForOrder(order) === 'dobozos' && !isResolved(order));
      block.zone = pickupZone(block, profiles);
    }
    return raw;
  }

  function stopCount(blocks) { return (blocks || []).length; }
  function burden(blocks) {
    let value = stopCount(blocks);
    for (const block of blocks || []) {
      for (const order of block.orders) {
        const load = physicalLoad(order);
        value += (+load.long || 0) * 0.45 + (+load.bulky || 0) * 0.18 + (+load.full || 0) * 1.2;
      }
    }
    return value;
  }

  function greedyRouteLength(start, blocks) {
    const points = (blocks || []).filter(block => finitePoint(block.point));
    if (!points.length || !finitePoint(start)) return points.length * 25;
    let current = start, total = 0;
    const left = points.slice();
    while (left.length) {
      left.sort((a, b) => km(current, a.point) - km(current, b.point) || a.key.localeCompare(b.key, 'hu'));
      const next = left.shift();
      total += km(current, next.point);
      current = next.point;
    }
    return total;
  }

  function marginalRouteCost(vehicle, block, assignedBlocks, homes) {
    const before = greedyRouteLength(homes[vehicle.id], assignedBlocks[vehicle.id]);
    const after = greedyRouteLength(homes[vehicle.id], [...assignedBlocks[vehicle.id], block]);
    return Math.max(0, after - before);
  }

  function assignmentReason(block, vehicle, reason) {
    const key = driverKey(vehicle);
    const zoneLabels = { pest: 'Pest', buda: 'Buda', central: 'Központ', neutral: 'Semleges', 'martin-corridor': 'Martin-folyosó' };
    const text = `${reason} · terület: ${zoneLabels[block.zone] || block.zone} · sofőr: ${vehicle.driverName}`;
    block.assignmentReason = text;
    for (const order of block.orders) {
      order.distributionVersion = VERSION;
      order.distributionZone = block.zone;
      order.distributionReason = text;
      order.distributionLocationKey = block.key;
    }
  }

  function assignWholeBlock(block, vehicle, assignedBlocks, assignedOrders, reason) {
    if (!vehicle) return;
    if (!assignedBlocks[vehicle.id].includes(block)) assignedBlocks[vehicle.id].push(block);
    for (const order of block.orders) {
      order.vehicleId = vehicle.id;
      if (!assignedOrders[vehicle.id].includes(order)) assignedOrders[vehicle.id].push(order);
    }
    assignmentReason(block, vehicle, reason);
  }

  function allowedDriversForFlexible(block, drivers) {
    const mario = findDriver('mario', drivers), patrik = findDriver('patrik', drivers), martin = findDriver('martin', drivers);
    if (block.zone === 'pest') return [mario || martin || patrik].filter(Boolean);
    if (block.zone === 'buda') return [patrik || martin || mario].filter(Boolean);
    if (block.zone === 'martin-corridor') return [martin || patrik || mario].filter(Boolean);
    // A sima Dobozos fuvar Márió és Patrik közös terhelése. Martin csak a
    // platós/szálanyagos vagy kifejezetten hozzá rögzített fuvarokat kapja.
    if (block.movable) return [mario, patrik].filter(Boolean);
    return drivers.slice();
  }

  function chooseFlexibleDriver(block, candidates, assignedBlocks, homes) {
    const loads = candidates.map(vehicle => burden(assignedBlocks[vehicle.id]));
    const minLoad = Math.min(...loads);
    return candidates.map(vehicle => {
      const route = marginalRouteCost(vehicle, block, assignedBlocks, homes);
      const load = burden(assignedBlocks[vehicle.id]);
      let score = route * 1.8 + (load - minLoad) * 9;
      const key = driverKey(vehicle);
      if (key === 'martin' && block.zone === 'neutral') score -= 2;
      if (key === 'martin' && block.zone === 'central') score -= 1;
      return { vehicle, score, route, load };
    }).sort((a, b) => a.score - b.score || a.route - b.route || a.vehicle.id.localeCompare(b.vehicle.id))[0]?.vehicle || candidates[0];
  }

  function blockCanMoveTo(block, target, allowMartinBox = false) {
    if (!block.movable) return false;
    const key = driverKey(target);
    // A Pest/Buda besorolás elsődleges preferencia, nem örök rögzítés.
    // Túlsúlynál a Dobozos blokkok Márió és Patrik között átadhatók, és
    // szálas munka nélküli napon Martin is részt vesz az egyenletes kiosztásban.
    return key === 'mario' || key === 'patrik' || (allowMartinBox && key === 'martin');
  }

  function moveBlock(block, source, target, assignedBlocks, assignedOrders, reason) {
    assignedBlocks[source.id] = assignedBlocks[source.id].filter(item => item !== block);
    assignedOrders[source.id] = assignedOrders[source.id].filter(order => !block.orders.includes(order));
    assignedBlocks[target.id].push(block);
    assignedOrders[target.id].push(...block.orders);
    block.orders.forEach(order => { order.vehicleId = target.id; });
    assignmentReason(block, target, reason);
  }

  function balanceFlexibleBlocks(drivers, assignedBlocks, assignedOrders, homes, allowMartinBox = false) {
    const balanceDrivers = drivers.filter(vehicle => {
      const key = driverKey(vehicle);
      return key === 'mario' || key === 'patrik' || (allowMartinBox && key === 'martin');
    });
    if (balanceDrivers.length < 2) return;
    for (let guard = 0; guard < 60; guard++) {
      const sorted = balanceDrivers.slice().sort((a, b) => stopCount(assignedBlocks[a.id]) - stopCount(assignedBlocks[b.id]));
      const low = sorted[0], high = sorted[sorted.length - 1];
      const spread = stopCount(assignedBlocks[high.id]) - stopCount(assignedBlocks[low.id]);
      if (spread <= 1) break;
      const currentLowRoute = greedyRouteLength(homes[low.id], assignedBlocks[low.id]);
      const candidates = assignedBlocks[high.id].filter(block => blockCanMoveTo(block, low, allowMartinBox)).map(block => {
        const highAfter = assignedBlocks[high.id].filter(item => item !== block);
        const lowAfter = [...assignedBlocks[low.id], block];
        const routeIncrease = greedyRouteLength(homes[low.id], lowAfter) - currentLowRoute;
        const newSpreadValues = balanceDrivers.map(vehicle => {
          if (vehicle.id === high.id) return stopCount(highAfter);
          if (vehicle.id === low.id) return stopCount(lowAfter);
          return stopCount(assignedBlocks[vehicle.id]);
        });
        const newSpread = Math.max(...newSpreadValues) - Math.min(...newSpreadValues);
        return { block, routeIncrease, newSpread };
      }).filter(item => item.newSpread < spread)
        .sort((a, b) => a.newSpread - b.newSpread || a.routeIncrease - b.routeIncrease || a.block.key.localeCompare(b.block.key, 'hu'));
      if (!candidates.length) break;
      moveBlock(candidates[0].block, high, low, assignedBlocks, assignedOrders, 'semleges/központi blokk terheléskiegyenlítése');
    }
  }

  function verifyNoMovableLocationSplit(blocks, drivers) {
    const conflicts = [];
    for (const block of blocks) {
      const vehicles = [...new Set(block.orders.map(order => order.vehicleId).filter(Boolean))];
      if (vehicles.length <= 1) continue;
      const fixedOrders = block.orders.filter(order => fixedVehicleForOrder(order, drivers));
      const movableOrders = block.orders.filter(order => !fixedVehicleForOrder(order, drivers));
      if (movableOrders.length) {
        const preferred = fixedOrders[0]?.vehicleId || vehicles[0];
        movableOrders.forEach(order => { order.vehicleId = preferred; });
      }
      const after = [...new Set(block.orders.map(order => order.vehicleId).filter(Boolean))];
      if (after.length > 1) conflicts.push({ block, vehicleIds: after });
    }
    return conflicts;
  }

  function summary(drivers, assignedBlocks, assignedOrders) {
    return drivers.map(vehicle => `${vehicle.driverName}: ${stopCount(assignedBlocks[vehicle.id])} cím / ${assignedOrders[vehicle.id].length} rendelés`).join(', ');
  }

  async function distributeOrderSetV44(orders, options = {}) {
    const drivers = (options.drivers || (typeof activeVehicles === 'function' ? activeVehicles() : [])).slice();
    if (!drivers.length) throw new Error('Nincs aktív jármű.');
    const mario = findDriver('mario', drivers), patrik = findDriver('patrik', drivers), martin = findDriver('martin', drivers);
    const profiles = options.profiles || await buildProfiles(orders);
    const homes = {};
    for (const vehicle of drivers) homes[vehicle.id] = await vehicleHomeV44(vehicle);
    const assignedBlocks = Object.fromEntries(drivers.map(vehicle => [vehicle.id, []]));
    const assignedOrders = Object.fromEntries(drivers.map(vehicle => [vehicle.id, []]));
    const blocks = makeBlocks(orders, profiles, drivers);
    const conflicts = [];
    const flexible = [];

    for (const block of blocks) {
      if (block.fixedDrivers.length === 1) {
        assignWholeBlock(block, block.fixedDrivers[0], assignedBlocks, assignedOrders, 'névre vagy kézzel rögzített felrakóhely');
        continue;
      }
      if (block.fixedDrivers.length > 1) {
        const fixedByDriver = groupBy(block.orders.filter(order => fixedVehicleForOrder(order, drivers)), order => fixedVehicleForOrder(order, drivers).id);
        for (const [vehicleId, fixedOrders] of fixedByDriver.entries()) {
          const vehicle = drivers.find(item => item.id === vehicleId);
          const fixedBlock = { ...block, key: `${block.key}||fixed:${vehicleId}`, orders: fixedOrders, fixedDrivers: [vehicle], movable: false };
          assignWholeBlock(fixedBlock, vehicle, assignedBlocks, assignedOrders, 'ütköző, névre rögzített rendelés');
        }
        const movableOrders = block.orders.filter(order => !fixedVehicleForOrder(order, drivers));
        if (movableOrders.length) {
          const target = block.fixedDrivers.slice().sort((a, b) => (fixedByDriver.get(b.id)?.length || 0) - (fixedByDriver.get(a.id)?.length || 0))[0];
          const movableBlock = { ...block, key: `${block.key}||movable`, orders: movableOrders, fixedDrivers: [], movable: true };
          assignWholeBlock(movableBlock, target, assignedBlocks, assignedOrders, 'azonos felrakóhely meglévő fix sofőrjéhez igazítva');
        }
        conflicts.push({ block, drivers: block.fixedDrivers.map(vehicle => vehicle.driverName) });
        continue;
      }
      if (hasLongMaterial(block) && martin) {
        assignWholeBlock(block, martin, assignedBlocks, assignedOrders, 'platós vagy szálanyag');
        continue;
      }
      if (block.zone === 'pest' && mario) {
        assignWholeBlock(block, mario, assignedBlocks, assignedOrders, 'pesti Dobozos felrakó');
        continue;
      }
      if (block.zone === 'buda' && patrik) {
        assignWholeBlock(block, patrik, assignedBlocks, assignedOrders, 'budai Dobozos felrakó');
        continue;
      }
      if (block.zone === 'martin-corridor' && martin) {
        assignWholeBlock(block, martin, assignedBlocks, assignedOrders, 'Felcsút felőli nyugati folyosó');
        continue;
      }
      flexible.push(block);
    }

    flexible.sort((a, b) => {
      const aKnown = finitePoint(a.point) ? 0 : 1, bKnown = finitePoint(b.point) ? 0 : 1;
      return aKnown - bKnown || b.orders.length - a.orders.length || a.key.localeCompare(b.key, 'hu');
    });
    for (const block of flexible) {
      const candidates = allowedDriversForFlexible(block, drivers);
      const vehicle = chooseFlexibleDriver(block, candidates, assignedBlocks, homes);
      assignWholeBlock(block, vehicle, assignedBlocks, assignedOrders, 'útvonal- és terhelésalapú semleges/központi kiosztás');
    }

    const hasDetectedLongMaterial = blocks.some(block => hasLongMaterial(block));
    balanceFlexibleBlocks(drivers, assignedBlocks, assignedOrders, homes, !hasDetectedLongMaterial);
    const splitConflicts = verifyNoMovableLocationSplit(blocks, drivers);

    // A sorrend ideiglenesen blokkonként marad együtt. A valódi felrakási sorrendet a V37/V44 útvonalépítő állítja be.
    for (const vehicle of drivers) {
      let sequence = 1;
      assignedBlocks[vehicle.id].forEach(block => block.orders.forEach(order => { order.vehicleId = vehicle.id; order.sequence = sequence++; }));
    }

    return {
      assigned: assignedOrders,
      assignedBlocks,
      blocks,
      profiles,
      homes,
      conflicts: [...conflicts, ...splitConflicts],
      stopCounts: Object.fromEntries(drivers.map(vehicle => [vehicle.id, stopCount(assignedBlocks[vehicle.id])])),
      summary: summary(drivers, assignedBlocks, assignedOrders)
    };
  }

  function routeStopKeyV49(stop) {
    const text = nrm(`${stop?.name || ''} ${stop?.address || ''}`);
    // A beszállító neve elsőbbséget élvez a településnévnél. Ez különösen
    // Niczuknál fontos: Szigetszentmiklós, de nem a KRPR központi raktár.
    const named = [
      ['niczuk', /\bniczuk\b/], ['gienger', /\bgienger\b/], ['cairox', /\bcairox\b/],
      ['lambda', /\blambda\b/], ['sebok', /\bsebok\b/], ['szatmari', /\bszatmari\b/],
      ['merkapt', /\bmerkapt\b/], ['ezerker', /\bezer\s*ker\b|\bezerker\b/]
    ];
    for (const [key, pattern] of named) if (pattern.test(text)) return key;
    if (/hungarokomplex/.test(text)) return 'hungarokomplex';
    if (/szerelvenybolt/.test(text)) return 'szerelvenybolt';
    if (/szogker/.test(text)) return 'szogker';
    if (/\bkrpr\b|kozponti raktar|kereskedo utca/.test(text)) return 'central';
    return global.V35Planner?.canonicalStop ? global.V35Planner.canonicalStop(stop) : text;
  }

  const PICKUP_PRECEDENCE_V49 = {
    mario: [
      ['szatmari', 'merkapt'], ['merkapt', 'ezerker'], ['ezerker', 'szogker']
    ],
    patrik: [
      ['central', 'niczuk'], ['niczuk', 'gienger'], ['niczuk', 'cairox'],
      ['gienger', 'cairox'], ['cairox', 'sebok'], ['cairox', 'lambda'],
      ['sebok', 'lambda'], ['sebok', 'fogarasi'], ['lambda', 'fogarasi']
    ],
    martin: [
      ['sebok', 'hungarokomplex'], ['hungarokomplex', 'szerelvenybolt'],
      ['sebok', 'niczuk'], ['niczuk', 'central'], ['central', 'empack'], ['empack', 'lambda']
    ]
  };

  function stablePrecedenceOrderV49(stops, vehicle) {
    const list = (stops || []).slice();
    if (list.length < 2) return list;
    const key = driverKey(vehicle);
    const rules = PICKUP_PRECEDENCE_V49[key] || [];
    if (!rules.length) return list;
    const original = new Map(list.map((stop, index) => [stop, index]));
    const incoming = new Map(list.map(stop => [stop, 0]));
    const outgoing = new Map(list.map(stop => [stop, []]));
    for (const [before, after] of rules) {
      const from = list.filter(stop => routeStopKeyV49(stop) === before);
      const to = list.filter(stop => routeStopKeyV49(stop) === after);
      for (const a of from) for (const b of to) {
        if (a === b || outgoing.get(a).includes(b)) continue;
        outgoing.get(a).push(b);
        incoming.set(b, incoming.get(b) + 1);
      }
    }
    const ready = list.filter(stop => incoming.get(stop) === 0).sort((a, b) => original.get(a) - original.get(b));
    const result = [];
    while (ready.length) {
      const next = ready.shift();
      result.push(next);
      for (const target of outgoing.get(next)) {
        incoming.set(target, incoming.get(target) - 1);
        if (incoming.get(target) === 0) {
          ready.push(target);
          ready.sort((a, b) => original.get(a) - original.get(b));
        }
      }
    }
    return result.length === list.length ? result : list;
  }

  function preservePinnedPickupSlotsV49(original, ordered) {
    const slots = new Array(original.length).fill(null);
    const pinned = new Set(original.filter(event => (event.orders || []).some(id => state.orders.find(order => order.id === id)?.routePinned)));
    original.forEach((event, index) => { if (pinned.has(event)) slots[index] = event; });
    const movable = ordered.filter(event => !pinned.has(event));
    let cursor = 0;
    return slots.map(event => event || movable[cursor++]).filter(Boolean);
  }

  function dropKeyV49(order) {
    const address = canonicalAddress(order?.dropAddress || '');
    return address ? `drop:address:${address}` : `drop:name:${nrm(order?.projectName || 'ismeretlen lerako')}`;
  }

  function dropStopsV49(orders, profiles, excludedIds = new Set()) {
    const groups = groupBy((orders || []).filter(order => !excludedIds.has(order.id) && String(order.dropAddress || '').trim()), dropKeyV49);
    return [...groups.entries()].map(([key, grouped]) => {
      const first = grouped[0];
      const profile = grouped.map(order => profiles?.[order.id]?.drop).find(finitePoint) || null;
      return {
        type: 'drop', key, name: first.projectName || 'Lerakó', address: first.dropAddress || '',
        orders: grouped.map(order => order.id), point: profile
      };
    });
  }

  async function roadMatrixV49(points) {
    const fallback = points.map((a, i) => points.map((b, j) => i === j ? 0 : km(a, b)));
    const valid = points.map((point, index) => ({ point, index })).filter(item => finitePoint(item.point));
    if (valid.length < 2 || typeof fetch !== 'function') return fallback;
    try {
      const coords = valid.map(item => `${item.point[1]},${item.point[0]}`).join(';');
      const response = await fetch(`https://router.project-osrm.org/table/v1/driving/${coords}?annotations=distance`);
      if (!response.ok) return fallback;
      const json = await response.json();
      if (!Array.isArray(json.distances)) return fallback;
      valid.forEach((from, i) => valid.forEach((to, j) => {
        const metres = json.distances?.[i]?.[j];
        if (Number.isFinite(metres)) fallback[from.index][to.index] = metres / 1000;
      }));
    } catch (error) {
      console.warn('[V50] Közúti mátrix nem elérhető; légvonalas tartalék használata.', error);
    }
    return fallback;
  }

  async function orderDropStopsV49(stops, startPoint, homePoint) {
    const known = (stops || []).filter(stop => finitePoint(stop.point));
    const unknown = (stops || []).filter(stop => !finitePoint(stop.point));
    if (known.length < 2) return [...known, ...unknown];
    if (known.length > 12) {
      const left = known.slice(), result = [];
      let current = finitePoint(startPoint) ? startPoint : homePoint;
      while (left.length) {
        left.sort((a, b) => km(current, a.point) - km(current, b.point) || a.key.localeCompare(b.key, 'hu'));
        const next = left.shift(); result.push(next); current = next.point;
      }
      return [...result, ...unknown];
    }
    const start = finitePoint(startPoint) ? startPoint : homePoint;
    const home = finitePoint(homePoint) ? homePoint : start;
    const points = [start, ...known.map(stop => stop.point), home];
    const matrix = await roadMatrixV49(points);
    const n = known.length, endIndex = n + 1;
    let states = new Map();
    for (let i = 0; i < n; i++) states.set(`${1 << i}|${i}`, { cost: matrix[0][i + 1], path: [i] });
    for (let mask = 1; mask < (1 << n); mask++) {
      for (let last = 0; last < n; last++) {
        const stateItem = states.get(`${mask}|${last}`);
        if (!stateItem) continue;
        for (let next = 0; next < n; next++) {
          if (mask & (1 << next)) continue;
          const nextMask = mask | (1 << next), nextCost = stateItem.cost + matrix[last + 1][next + 1];
          const stateKey = `${nextMask}|${next}`, previous = states.get(stateKey);
          if (!previous || nextCost < previous.cost) states.set(stateKey, { cost: nextCost, path: [...stateItem.path, next] });
        }
      }
    }
    const fullMask = (1 << n) - 1;
    let best = null;
    for (let last = 0; last < n; last++) {
      const candidate = states.get(`${fullMask}|${last}`);
      if (!candidate) continue;
      const total = candidate.cost + matrix[last + 1][endIndex];
      if (!best || total < best.total) best = { total, path: candidate.path };
    }
    return [...(best?.path || known.map((_, index) => index)).map(index => known[index]), ...unknown];
  }

  async function buildVehicleRouteV49(vehicle, profiles) {
    const allOrders = (typeof dayOrders === 'function' ? dayOrders(vehicle.id) : []).slice().sort((a, b) => (+a.sequence || 999) - (+b.sequence || 999));
    const isResolved = order => global.V37Planner?.isResolvedBacklogOrder ? global.V37Planner.isResolvedBacklogOrder(order) : false;
    const activeOrders = allOrders.filter(order => !isResolved(order));
    if (!activeOrders.length) return [];

    let baseEvents = [];
    if (global.V37Planner?.v37BuildRoutePlan) baseEvents = await global.V37Planner.v37BuildRoutePlan(vehicle.id, profiles);
    else if (global.V35Planner?.v35BuildRoutePlan) baseEvents = await global.V35Planner.v35BuildRoutePlan(vehicle.id, profiles);
    // V50-ben az útvonalterv kizárólag a felrakási sorrend. Lerakó soha nem
    // kerül az optimalizálási események közé, teljes autós tételnél sem.
    const normalPickupsOriginal = baseEvents.filter(event => event.type === 'pickup')
      .sort((a, b) => {
        const aSeq = Math.min(...(a.orders || []).map(id => +state.orders.find(order => order.id === id)?.sequence || 999));
        const bSeq = Math.min(...(b.orders || []).map(id => +state.orders.find(order => order.id === id)?.sequence || 999));
        return aSeq - bSeq;
      });
    const orderedNormal = preservePinnedPickupSlotsV49(normalPickupsOriginal, stablePrecedenceOrderV49(normalPickupsOriginal, vehicle));

    let sequence = 1;
    for (const pickup of orderedNormal) {
      (pickup.orders || []).map(id => state.orders.find(order => order.id === id)).filter(Boolean)
        .sort((a, b) => String(a.orderNo || '').localeCompare(String(b.orderNo || ''), 'hu'))
        .forEach(order => { order.sequence = sequence++; });
    }

    const events = orderedNormal;
    state.routePlans = state.routePlans || {}; state.routePlans[selectedDate()] = state.routePlans[selectedDate()] || {};
    state.routePlans[selectedDate()][vehicle.id] = events;
    return events;
  }

  async function buildRoutePlansV44(profiles = null) {
    const vehicles = typeof activeVehicles === 'function' ? activeVehicles() : [];
    const before = new Map((state.orders || []).filter(order => order.scheduleDate === selectedDate()).map(order => [order.id, order.vehicleId]));
    const routeProfiles = profiles || await buildProfiles((state.orders || []).filter(order => order.scheduleDate === selectedDate()));
    for (const vehicle of vehicles) await buildVehicleRouteV49(vehicle, routeProfiles);
    const changed = (state.orders || []).filter(order => order.scheduleDate === selectedDate() && before.has(order.id) && before.get(order.id) !== order.vehicleId);
    if (changed.length) {
      changed.forEach(order => { order.vehicleId = before.get(order.id); });
      throw new Error('Az útvonal-optimalizálás sofőrt próbált változtatni, ezért visszaállítottam.');
    }
  }

  async function persistOnlineV49() {
    if (typeof save === 'function') save();
    const online = global.V44Online;
    const onlineProfile = online?.getProfile?.();
    const onlineSession = online?.getSession?.();
    if (online?.configured?.() && onlineProfile?.role === 'admin' && onlineSession?.access_token) {
      await online.syncOrders(state.orders || [], onlineProfile);
    }
  }

  async function balanceActionV44() {
    try {
      const orders = (state.orders || []).filter(order => order.scheduleDate === selectedDate());
      if (!orders.length) throw new Error('Nincs szétosztható fuvar az adott napon.');
      const drivers = typeof activeVehicles === 'function' ? activeVehicles() : [];
      const fixedBefore = new Map(orders.map(order => [order.id, fixedVehicleForOrder(order, drivers)?.id || '']).filter(([, value]) => value));
      const result = await distributeOrderSetV44(orders, { drivers });
      for (const [orderId, vehicleId] of fixedBefore.entries()) {
        const order = orders.find(item => item.id === orderId);
        if (order && order.vehicleId !== vehicleId) throw new Error(`A(z) ${order.orderNo || orderId} névre rögzített fuvar elmozdult.`);
      }
      state.routePlans = state.routePlans || {}; state.routePlans[selectedDate()] = {};
      state.routeStats = state.routeStats || {}; state.routeStats[selectedDate()] = {};
      await buildRoutePlansV44(result.profiles);
      await persistOnlineV49();
      if (typeof render === 'function') render();
      const conflictText = result.conflicts.length ? `\nFigyelem: ${result.conflicts.length} felrakóhelyen egymással ütköző fix sofőrjelölés maradt.` : '';
      alert(`Fuvarok V50 szerint szétosztva és felrakási sorrendbe rendezve.\n${result.summary}${conflictText}\nAzonos beszállító egy sofőrnél marad. A lerakók nem részei az optimalizálásnak.`);
      return result;
    } catch (error) {
      console.error('[V50] Szétosztási hiba', error);
      alert(`A fuvarok szétosztása közben hiba történt: ${error?.message || error}`);
      return null;
    }
  }

  async function optimizeActionV44() {
    try {
      const before = new Map((state.orders || []).filter(order => order.scheduleDate === selectedDate()).map(order => [order.id, order.vehicleId]));
      const orders = (state.orders || []).filter(order => order.scheduleDate === selectedDate());
      const profiles = await buildProfiles(orders);
      await buildRoutePlansV44(profiles);
      const changed = orders.filter(order => before.get(order.id) !== order.vehicleId);
      if (changed.length) throw new Error('Az optimalizálás sofőrt változtatott.');
      await persistOnlineV49();
      if (typeof render === 'function') render();
      alert('V50 optimalizálás elkészült: kizárólag a felrakók sorrendje változott. Lerakó és sofőr nem változott.');
      return true;
    } catch (error) {
      console.error('[V50] Optimalizálási hiba', error);
      alert(`Az optimalizálás közben hiba történt: ${error?.message || error}`);
      return false;
    }
  }

  function cloneBuiltInMasterData() {
    const makeId = (prefix, index) => `${prefix}${index}`;
    const recipients = (global.SEED_DATA?.recipients || []).map((item, index) => ({ ...item, id: makeId('r', index), active: item.active !== false }));
    const projects = (global.SEED_DATA?.projects || []).map((item, index) => ({ ...item, id: makeId('p', index), defaultRecipientId: '', active: item.active !== false }));
    const suppliers = (global.SEED_DATA?.suppliers || []).map((item, index) => ({ ...item, id: makeId('s', index), pickupNote: item.pickupNote || item.note || '', isCentral: !!item.isCentral || nrm(item.site) === 'kozpont', active: item.active !== false }));
    projects.forEach(project => {
      const receiver = recipients.find(item => nrm(item.project) === nrm(project.name)) || recipients.find(item => nrm(item.name) === nrm(project.receiver));
      project.defaultRecipientId = receiver?.id || '';
    });
    return { recipients, projects, suppliers };
  }

  function clearAllMasterDataV44() {
    if (!confirm('Biztosan törlöd az összes projekt-, beszállító- és átvevő-törzsadatot? A fuvarok és rendelések megmaradnak.')) return false;
    state.projects = [];
    state.suppliers = [];
    state.recipients = [];
    state.aliases = { projects: {}, suppliers: {} };
    state.masterDataVersion = 'v44-empty';
    state.routePlans = {}; state.routeStats = {}; state.geo = {};
    if (typeof save === 'function') save();
    alert('Minden törzsadat törölve. A fuvarok megmaradtak.');
    return true;
  }

  function loadBuiltInMasterDataV44() {
    if ((state.projects?.length || state.suppliers?.length || state.recipients?.length) && !confirm('A beépített törzsadatokat teljesen újratöltöd? A jelenlegi törzsadatok lecserélődnek, a fuvarok megmaradnak.')) return false;
    const data = cloneBuiltInMasterData();
    state.projects = data.projects;
    state.suppliers = data.suppliers;
    state.recipients = data.recipients;
    state.aliases = { projects: {}, suppliers: {} };
    state.masterDataVersion = 'v44-built-in';
    if (global.V43Planner?.mergeSeedMasterData) global.V43Planner.mergeSeedMasterData();
    for (const order of state.orders || []) if (typeof syncOrderFromMasters === 'function') syncOrderFromMasters(order);
    state.routePlans = {}; state.routeStats = {}; state.geo = {};
    if (typeof save === 'function') save();
    alert(`Beépített törzsadatok betöltve: ${state.projects.length} projekt, ${state.suppliers.length} beszállítói telephely, ${state.recipients.length} átvevő.`);
    return true;
  }

  function escapeHtmlV49(value) {
    return String(value || '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  }

  function scrollToEventBubbleV49(vehicleId, orderIds) {
    if (typeof document === 'undefined') return false;
    const ids = new Set((orderIds || []).map(String));
    const container = document.getElementById(`route-${vehicleId}`);
    if (!container || !ids.size) return false;
    const candidates = [...container.querySelectorAll('[data-order-ids]')];
    const match = candidates.find(element => String(element.dataset.orderIds || '').split(',').some(id => ids.has(id)));
    const target = match?.closest?.('.pickup-move-block') || match || [...container.querySelectorAll('.bubble[data-id]')].find(element => ids.has(String(element.dataset.id || '')));
    if (!target) return false;
    const wantedTop = Math.max(0, target.offsetTop - Math.max(0, (container.clientHeight - target.offsetHeight) / 2));
    if (typeof container.scrollTo === 'function') container.scrollTo({ top: wantedTop, behavior: 'smooth' });
    else target.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
    target.classList.add('map-route-highlight');
    setTimeout(() => target.classList.remove('map-route-highlight'), 2600);
    return true;
  }

  async function drawMapV49(vehicleId) {
    if (typeof document === 'undefined' || typeof maps === 'undefined' || !global.L) return;
    const map = maps[vehicleId];
    if (!map) return;
    const vehicle = (state.vehicles || []).find(item => item.id === vehicleId);
    const home = await vehicleHomeV44(vehicle || {});
    let events = (state.routePlans?.[selectedDate()]?.[vehicleId] || []).filter(event => event.type === 'pickup');
    if (!events.length && (state.orders || []).some(order => order.scheduleDate === selectedDate() && order.vehicleId === vehicleId)) {
      const profiles = await buildProfiles((state.orders || []).filter(order => order.scheduleDate === selectedDate()));
      events = (await buildVehicleRouteV49(vehicle, profiles)).filter(event => event.type === 'pickup');
    }
    const points = [];
    if (finitePoint(home)) points.push(home);
    let pickupIndex = 0;
    for (const event of events) {
      if (!finitePoint(event.point)) continue;
      points.push(event.point);
      const isPickup = event.type === 'pickup';
      if (!isPickup) continue;
      const number = ++pickupIndex;
      const prefix = 'F';
      const icon = global.L.divIcon({
        className: 'v49-map-marker v49-pickup-marker',
        html: `<span>${prefix}${number}</span>`, iconSize: [32, 32], iconAnchor: [16, 16]
      });
      const marker = global.L.marker(event.point, { icon, title: `Felrakó: ${event.name || ''}` }).addTo(map);
      marker.bindPopup(`<b>${prefix}${number}. Felrakó</b><br>${escapeHtmlV49(event.name)}<br>${escapeHtmlV49(event.address || '')}`);
      marker.on('click', () => scrollToEventBubbleV49(vehicleId, event.orders || []));
    }
    if (finitePoint(home)) points.push(home);
    if (points.length === 1) map.setView(points[0], 13);
    if (points.length > 1) {
      let coords = points, route = null;
      if (typeof roadRoute === 'function') {
        try { route = await roadRoute(points); } catch (_) { route = null; }
      }
      if (route?.geometry?.coordinates) coords = route.geometry.coordinates.map(coord => [coord[1], coord[0]]);
      const line = global.L.polyline(coords, { weight: 4, opacity: .82 }).addTo(map);
      map.fitBounds(line.getBounds(), { padding: [20, 20] });
      state.routeStats = state.routeStats || {}; state.routeStats[selectedDate()] = state.routeStats[selectedDate()] || {};
      state.routeStats[selectedDate()][vehicleId] = {
        km: route ? route.distance / 1000 : points.slice(1).reduce((sum, point, index) => sum + km(points[index], point), 0),
        minutes: route ? route.duration / 60 : 0
      };
    }
  }

  function bindV44() {
    const balanceButton = document.getElementById('balanceBtn');
    const optimizeButton = document.getElementById('optimizeBtn');
    if (balanceButton) {
      balanceButton.onclick = event => { event.preventDefault(); return balanceActionV44(); };
      balanceButton.dataset.algorithmVersion = VERSION;
      balanceButton.title = 'V50: teljes beszállítói blokkok; Márió=Pest, Patrik=Buda, Martin=platós/szálas';
    }
    if (optimizeButton) {
      optimizeButton.onclick = event => { event.preventDefault(); return optimizeActionV44(); };
      optimizeButton.dataset.algorithmVersion = VERSION;
      optimizeButton.title = 'V50: kizárólag a felrakók optimalizálása, sofőrváltás nélkül';
    }
    document.getElementById('clearAllMastersBtn')?.addEventListener('click', clearAllMasterDataV44);
    document.getElementById('loadBuiltInMastersBtn')?.addEventListener('click', loadBuiltInMasterDataV44);
    global.FUVARSZERVEZO_VERSION = VERSION;
    const previousDiagnostics = global.getFuvarszervezoDiagnostics;
    global.getFuvarszervezoDiagnostics = () => ({
      ...(typeof previousDiagnostics === 'function' ? previousDiagnostics() : {}),
      version: VERSION,
      balanceHandler: balanceButton?.dataset.algorithmVersion || VERSION,
      optimizeHandler: optimizeButton?.dataset.algorithmVersion || VERSION,
      assignmentUnit: 'azonos napi beszállítói blokk',
      territoryRule: 'Márió=Pest; Patrik=Buda; Martin=platós/nyugati folyosó',
      fixedDriverRule: 'névre rögzített fuvar csak kézzel mozgatható',
      homeRule: 'Márió=Vác; Martin=Felcsút; Patrik=központi raktár',
      duplicateSupplierRule: 'egy beszállító egy sofőr',
      routeRule: 'kizárólag felrakási sorrend; lerakó nem része az optimalizálásnak',
      mapClick: 'címjelölő -> kapcsolódó buborék'
    });
  }

  if (typeof balance !== 'undefined') balance = balanceActionV44;
  if (typeof optimizeAll !== 'undefined') optimizeAll = optimizeActionV44;
  global.balance = balanceActionV44;
  global.optimizeAll = optimizeActionV44;
  if (typeof drawMap !== 'undefined') drawMap = drawMapV49;
  global.drawMap = drawMapV49;
  global.vehicleHomeV44 = vehicleHomeV44;
  global.clearAllMasterDataV44 = clearAllMasterDataV44;
  global.loadBuiltInMasterDataV44 = loadBuiltInMasterDataV44;

  global.V50Planner = {
    version: VERSION,
    canonicalAddress,
    locationKey,
    supplierAssignmentKey,
    pickupZone,
    fixedVehicleForOrder,
    vehicleHomeV44,
    buildProfiles,
    makeBlocks,
    distributeOrderSetV44,
    buildRoutePlansV44,
    buildVehicleRouteV49,
    stablePrecedenceOrderV49,
    orderDropStopsV49,
    scrollToEventBubbleV49,
    drawMapV49,
    balanceActionV44,
    optimizeActionV44,
    cloneBuiltInMasterData,
    clearAllMasterDataV44,
    loadBuiltInMasterDataV44
  };
  global.V49Planner = global.V50Planner;
  global.V44Planner = global.V50Planner;

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(bindV44, 0), { once: true });
    else setTimeout(bindV44, 0);
  }
})(typeof window !== 'undefined' ? window : globalThis);
