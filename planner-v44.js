/* Fuvarszervező V44
   Determinisztikus felrakóhely-blokkos szétosztás.

   Kemény szabályok:
   - Márió / Patrik / Martin névre rögzített fuvar automatikusan nem mozgatható.
   - Egy fizikai felrakóhely minden mozgatható rendelése egy sofőrhöz kerül.
   - Márió: pesti oldal. Patrik: budai oldal. Martin: platós/szálanyag + nyugati folyosó.
   - Martin nem kap pesti címet pusztán terheléskiegyenlítés miatt.
   - Márió Vác, Martin Felcsút, Patrik a központi raktár felől indul.
   - A szétosztás után azonnal felrakási sorrend készül; az optimalizálás sofőrt nem változtat.
*/
(function (global) {
  'use strict';

  const VERSION = '44';
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
  const centralOrder = order => /(\bkrpr\b|k[oö]zponti\s*rakt[aá]r|szigetszentmikl[oó]s|keresked[oő]\s*utca)/i.test(`${order?.orderType || ''} ${order?.pickupName || ''} ${order?.pickupAddress || ''}`);

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
    if (['mario', 'patrik', 'martin'].includes(category)) return findDriver(category, drivers);
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
    const raw = [...groupBy(orders, locationKey).entries()].map(([key, grouped]) => ({
      key,
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

  function blockCanMoveTo(block, target) {
    if (!block.movable) return false;
    const key = driverKey(target);
    if (block.zone === 'pest') return key === 'mario';
    if (block.zone === 'buda') return key === 'patrik';
    if (block.zone === 'martin-corridor') return key === 'martin';
    return true;
  }

  function moveBlock(block, source, target, assignedBlocks, assignedOrders, reason) {
    assignedBlocks[source.id] = assignedBlocks[source.id].filter(item => item !== block);
    assignedOrders[source.id] = assignedOrders[source.id].filter(order => !block.orders.includes(order));
    assignedBlocks[target.id].push(block);
    assignedOrders[target.id].push(...block.orders);
    block.orders.forEach(order => { order.vehicleId = target.id; });
    assignmentReason(block, target, reason);
  }

  function balanceFlexibleBlocks(drivers, assignedBlocks, assignedOrders, homes) {
    for (let guard = 0; guard < 60; guard++) {
      const sorted = drivers.slice().sort((a, b) => stopCount(assignedBlocks[a.id]) - stopCount(assignedBlocks[b.id]));
      const low = sorted[0], high = sorted[sorted.length - 1];
      const spread = stopCount(assignedBlocks[high.id]) - stopCount(assignedBlocks[low.id]);
      if (spread <= 2) break;
      const currentLowRoute = greedyRouteLength(homes[low.id], assignedBlocks[low.id]);
      const candidates = assignedBlocks[high.id].filter(block => blockCanMoveTo(block, low)).map(block => {
        const highAfter = assignedBlocks[high.id].filter(item => item !== block);
        const lowAfter = [...assignedBlocks[low.id], block];
        const routeIncrease = greedyRouteLength(homes[low.id], lowAfter) - currentLowRoute;
        const newSpreadValues = drivers.map(vehicle => {
          if (vehicle.id === high.id) return stopCount(highAfter);
          if (vehicle.id === low.id) return stopCount(lowAfter);
          return stopCount(assignedBlocks[vehicle.id]);
        });
        const newSpread = Math.max(...newSpreadValues) - Math.min(...newSpreadValues);
        return { block, routeIncrease, newSpread };
      }).filter(item => item.newSpread < spread && item.routeIncrease <= 14)
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
    if (global.V43Planner?.mergeSeedMasterData) global.V43Planner.mergeSeedMasterData();
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

    balanceFlexibleBlocks(drivers, assignedBlocks, assignedOrders, homes);
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

  async function buildRoutePlansV44(profiles = null) {
    const vehicles = typeof activeVehicles === 'function' ? activeVehicles() : [];
    const before = new Map((state.orders || []).filter(order => order.scheduleDate === selectedDate()).map(order => [order.id, order.vehicleId]));
    for (const vehicle of vehicles) {
      if (global.V37Planner?.v37BuildRoutePlan) await global.V37Planner.v37BuildRoutePlan(vehicle.id, profiles);
      else if (global.V35Planner?.v35BuildRoutePlan) await global.V35Planner.v35BuildRoutePlan(vehicle.id, profiles);
      else {
        const orders = (typeof dayOrders === 'function' ? dayOrders(vehicle.id) : []).slice();
        const start = await vehicleHomeV44(vehicle);
        const blocks = [...groupBy(orders, locationKey).values()].map(group => ({ orders: group, point: profiles?.[group[0].id]?.pickup, key: locationKey(group[0]) }));
        let current = start, sequence = 1;
        const left = blocks.slice();
        while (left.length) {
          left.sort((a, b) => km(current, a.point) - km(current, b.point) || a.key.localeCompare(b.key, 'hu'));
          const next = left.shift();
          next.orders.forEach(order => { order.sequence = sequence++; });
          current = finitePoint(next.point) ? next.point : current;
        }
      }
    }
    const changed = (state.orders || []).filter(order => order.scheduleDate === selectedDate() && before.has(order.id) && before.get(order.id) !== order.vehicleId);
    if (changed.length) {
      changed.forEach(order => { order.vehicleId = before.get(order.id); });
      throw new Error('Az útvonal-optimalizálás sofőrt próbált változtatni, ezért visszaállítottam.');
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
      if (typeof save === 'function') save();
      const conflictText = result.conflicts.length ? `\nFigyelem: ${result.conflicts.length} felrakóhelyen egymással ütköző fix sofőrjelölés maradt.` : '';
      alert(`Fuvarok V44 szerint szétosztva és felrakási sorrendbe rendezve.\n${result.summary}${conflictText}\nMárió=Pest, Patrik=Buda, Martin=platós/nyugati folyosó. Martin pesti címet csak kézi vagy névre rögzített rendelésként kap.`);
      return result;
    } catch (error) {
      console.error('[V44] Szétosztási hiba', error);
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
      if (typeof save === 'function') save();
      alert('V44 felrakási sorrend elkészült a sofőrök valódi indulási pontjából. Azonos felrakók együtt maradtak; sofőr nem változott.');
      return true;
    } catch (error) {
      console.error('[V44] Optimalizálási hiba', error);
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

  function bindV44() {
    const balanceButton = document.getElementById('balanceBtn');
    const optimizeButton = document.getElementById('optimizeBtn');
    if (balanceButton) {
      balanceButton.onclick = event => { event.preventDefault(); return balanceActionV44(); };
      balanceButton.dataset.algorithmVersion = VERSION;
      balanceButton.title = 'V44: felrakóhely-blokkok; Márió=Pest, Patrik=Buda, Martin=platós/nyugati folyosó';
    }
    if (optimizeButton) {
      optimizeButton.onclick = event => { event.preventDefault(); return optimizeActionV44(); };
      optimizeButton.dataset.algorithmVersion = VERSION;
      optimizeButton.title = 'V44: felrakási sorrend a sofőr indulási pontjából, sofőrváltás nélkül';
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
      assignmentUnit: 'fizikai felrakóhely',
      territoryRule: 'Márió=Pest; Patrik=Buda; Martin=platós/nyugati folyosó',
      fixedDriverRule: 'névre rögzített fuvar csak kézzel mozgatható',
      homeRule: 'Márió=Vác; Martin=Felcsút; Patrik=központi raktár',
      duplicateSupplierRule: 'egy mozgatható felrakóhely egy sofőr'
    });
  }

  if (typeof balance !== 'undefined') balance = balanceActionV44;
  if (typeof optimizeAll !== 'undefined') optimizeAll = optimizeActionV44;
  global.balance = balanceActionV44;
  global.optimizeAll = optimizeActionV44;
  global.vehicleHomeV44 = vehicleHomeV44;
  global.clearAllMasterDataV44 = clearAllMasterDataV44;
  global.loadBuiltInMasterDataV44 = loadBuiltInMasterDataV44;

  global.V44Planner = {
    version: VERSION,
    canonicalAddress,
    locationKey,
    pickupZone,
    fixedVehicleForOrder,
    vehicleHomeV44,
    buildProfiles,
    makeBlocks,
    distributeOrderSetV44,
    buildRoutePlansV44,
    balanceActionV44,
    optimizeActionV44,
    cloneBuiltInMasterData,
    clearAllMasterDataV44,
    loadBuiltInMasterDataV44
  };

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bindV44, { once: true });
    else bindV44();
  }
})(typeof window !== 'undefined' ? window : globalThis);
