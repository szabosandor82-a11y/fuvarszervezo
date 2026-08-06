/* Fuvarszervező V32 – különálló, tesztelhető útvonaltervező modul.
   A két fő művelet szigorúan elkülönül:
   1. Fuvarok szétosztása = csak sofőrhöz rendelés.
   2. Útvonal optimalizálása = csak sorrendezés, átosztás nélkül.
*/
(function (global) {
  'use strict';

  const VERSION = '32';
  const FULL_LOAD_RE = /(teljes\s*(auto|autó|kocsi|kamion|rakom[aá]ny)|eg[eé]sz\s*(auto|autó|kocsi|kamion)|tele\s*(auto|autó|kocsi)|full\s*load|100\s*%\s*(kapacit[aá]s|rakom[aá]ny))/i;
  const CENTRAL_RE = /(\bkrpr\b|k[oö]zponti\s*rakt[aá]r|keresked[oő]\s*utca)/i;

  const nrm = value => {
    if (typeof norm === 'function') return norm(value || '');
    return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[_.,;:()[\]{}\/\\-]+/g, ' ').replace(/\s+/g, ' ').trim();
  };
  const finitePoint = p => Array.isArray(p) && Number.isFinite(+p[0]) && Number.isFinite(+p[1]);
  const km = (a, b) => {
    if (!finitePoint(a) || !finitePoint(b)) return 60;
    if (typeof v29Km === 'function') return v29Km(a, b);
    const R = 6371, r = x => x * Math.PI / 180;
    const dLat = r(b[0] - a[0]), dLon = r(b[1] - a[1]);
    const q = Math.sin(dLat / 2) ** 2 + Math.cos(r(a[0])) * Math.cos(r(b[0])) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(q));
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
  const orderText = order => [
    order?.note, order?.pickupNote, order?.pickupName, order?.pickupAddress,
    ...(order?.items || []).flatMap(item => [item?.name, item?.itemNote, item?.itemRemark, item?.tetelMegjegyzes])
  ].filter(Boolean).join(' ');
  const isFullLoadOrder = order => FULL_LOAD_RE.test(orderText(order));
  const isCentralOrder = order => CENTRAL_RE.test(`${order?.pickupName || ''} ${order?.pickupAddress || ''}`);
  const supplierKey = order => nrm(order?.pickupName || order?.pickupAddress || 'ismeretlen felrako');
  const projectKey = order => nrm(order?.dropAddress || order?.projectName || 'ismeretlen lerako');
  const unitKey = order => `${supplierKey(order)}||${projectKey(order)}`;
  const driverKey = vehicle => {
    const value = nrm(vehicle?.driverName || '');
    if (value.includes('martin')) return 'martin';
    if (value.includes('mario')) return 'mario';
    if (value.includes('patrik')) return 'patrik';
    return 'other';
  };
  const stopText = stop => nrm(`${stop?.name || ''} ${stop?.address || ''}`);
  const contains = (text, ...parts) => parts.some(part => text.includes(nrm(part)));

  function stopZone(stop) {
    const t = stopText(stop);
    if (CENTRAL_RE.test(`${stop?.name || ''} ${stop?.address || ''}`)) return 'central';
    if (contains(t, 'szigetszentmiklos', 'halasztelek', 'csepel', '1211 ', '1212 ', '1213 ', '1214 ', '1215 ', '1216 ', '1217 ', '1218 ', '1219 ', '1221 ')) return 'south-island';
    if (contains(t, 'torokbalint', 'budaors', 'erd', 'biatorbagy', '2045 ', '2040 ', '2030 ', '2051 ')) return 'southwest';
    if (contains(t, 'budafok', 'nagyteteny', 'hengermalom', 'hunyadi janos', '1222 ', '1225 ', '1116 ', '1117 ')) return 'south-buda';
    if (contains(t, 'kesmark', 'kistarcsa', 'csomad', 'dunakeszi', 'vac', '1158 ', '1147 ', '2143 ', '2120 ')) return 'north-east';
    if (contains(t, 'ullo', 'vecses', 'gyal', 'kispest', 'vas gereben', 'jokai mor', '1182 ', '1195 ', '1205 ', '2220 ', '2234 ', '2360 ')) return 'south-east';
    if (contains(t, 'akna utca', 'maglodi', 'kada', 'gyomroi', 'pesti hatar', 'gyogyszergyari', 'flamingo', '1103 ', '1106 ', '1108 ', '1173 ')) return 'east';
    if (contains(t, 'szentendrei', 'obuda', 'rozsnyai', 'turóc', 'turoc', 'hegedus gyula', 'folyamor', '1033 ', '1037 ', '1133 ', '1134 ', '1138 ')) return 'north';
    if (contains(t, 'mester utca', 'soroksari', 'szecsenyi istvan', 'molnar utca', '1095 ', '1051 ', '1056 ')) return 'center';
    return 'unknown';
  }

  function knownPickupRank(driver, stop, mode = 'normal') {
    const t = stopText(stop);
    const central = CENTRAL_RE.test(`${stop?.name || ''} ${stop?.address || ''}`);
    if (driver === 'mario') {
      if (mode === 'central' && central) return 0;
      if (contains(t, 'neber')) return 4;
      if (contains(t, 'szatmari') && contains(t, 'kesmark')) return 5;
      if (contains(t, 'ferenczi') && contains(t, 'kistarcsa')) return 6;
      if (contains(t, 'larex')) return 10;
      if (contains(t, 'merkapt')) return 11;
      if (contains(t, 'ezerker')) return 12;
      if (contains(t, 'dt kozmu')) return 13;
      if (contains(t, 'fogarasi')) return 20;
      if (contains(t, 'szerelvenybolt') && contains(t, 'ullo')) return 21;
      if (contains(t, 'atta')) return 25;
      if (contains(t, 'ryng')) return 30;
      if (central) return mode === 'central' ? 0 : 31;
      const zoneRanks = { 'north-east': 7, north: 8, east: 14, 'south-east': 22, 'south-island': 28, 'south-buda': 29, southwest: 30, center: 32, unknown: 35 };
      return zoneRanks[stopZone(stop)] ?? 35;
    }
    if (driver === 'patrik') {
      if (central) return 0;
      if (contains(t, 'niczuk')) return 10;
      if (contains(t, 'cairox')) return 11;
      if (contains(t, 'gienger')) return 12;
      if (contains(t, 'lambda') && contains(t, 'hengermalom')) return 13;
      if (contains(t, 'sebok')) return 14;
      if (contains(t, 'szogker')) return 20;
      if (contains(t, 'fogarasi')) return 21;
      if (contains(t, 'szerelvenybolt') && contains(t, 'ullo')) return 22;
      if (contains(t, 'larex')) return 24;
      if (contains(t, 'ezerker')) return 25;
      if (contains(t, 'merkapt')) return 26;
      const zoneRanks = { 'south-island': 9, 'south-buda': 13, southwest: 15, 'south-east': 23, east: 27, 'north-east': 30, center: 31, north: 32, unknown: 35 };
      return zoneRanks[stopZone(stop)] ?? 35;
    }
    if (driver === 'martin') {
      if (central) return 0;
      if (contains(t, 'niczuk')) return 10;
      if (contains(t, 'cairox')) return 11;
      if (contains(t, 'atta')) return 12;
      if (contains(t, 'empack')) return 14;
      if (contains(t, 'lambda') && contains(t, 'hengermalom')) return 15;
      if (contains(t, 'sebok')) return 16;
      if (contains(t, 'merkapt')) return 20;
      if (contains(t, 'dt kozmu')) return 21;
      if (contains(t, 'fogarasi')) return 23;
      const zoneRanks = { 'south-island': 10, 'south-buda': 15, southwest: 17, east: 22, 'south-east': 24, 'north-east': 25, center: 30, north: 32, unknown: 35 };
      return zoneRanks[stopZone(stop)] ?? 35;
    }
    return ({ central: 0, 'south-island': 10, 'south-buda': 15, southwest: 18, east: 20, 'south-east': 22, 'north-east': 24, center: 28, north: 30, unknown: 35 })[stopZone(stop)] ?? 35;
  }

  function dropHintRank(driver, stop) {
    const t = stopText(stop);
    if (driver === 'martin') {
      if (contains(t, 'kincsem')) return 10;
      if (contains(t, 'm76', 'city pearl')) return 20;
      if (contains(t, 'moxy')) return 30;
      if (contains(t, 'sofitel')) return 35;
      if (contains(t, 'le jardin', 'lejardin')) return 45;
      if (contains(t, 'cosmo')) return 48;
      if (contains(t, 'metrodome', 'metrodom')) return 52;
      if (contains(t, 'waterfront')) return 60;
    }
    if (driver === 'patrik') {
      if (contains(t, 'kincsem')) return 10;
      if (contains(t, 'moxy')) return 20;
      if (contains(t, 'sofitel')) return 25;
      if (contains(t, 'metrodome', 'metrodom')) return 35;
      if (contains(t, 'city pearl')) return 45;
    }
    return 30;
  }

  async function buildRoadMatrix(points) {
    const valid = points.map((point, index) => ({ point, index })).filter(x => finitePoint(x.point));
    const fallback = points.map((a, i) => points.map((b, j) => i === j ? 0 : km(a, b)));
    if (valid.length < 2 || typeof fetch !== 'function') return fallback;
    try {
      const coords = valid.map(x => `${x.point[1]},${x.point[0]}`).join(';');
      const response = await fetch(`https://router.project-osrm.org/table/v1/driving/${coords}?annotations=distance`);
      if (!response.ok) return fallback;
      const json = await response.json();
      if (!Array.isArray(json.distances)) return fallback;
      valid.forEach((from, i) => valid.forEach((to, j) => {
        const metres = json.distances?.[i]?.[j];
        if (Number.isFinite(metres)) fallback[from.index][to.index] = metres / 1000;
      }));
    } catch (error) {
      console.warn('[V32] Közúti távolságmátrix nem elérhető, légvonalas tartalék használata.', error);
    }
    return fallback;
  }

  function matrixDistance(matrix, fromIndex, toIndex, points) {
    const value = matrix?.[fromIndex]?.[toIndex];
    return Number.isFinite(value) ? value : km(points[fromIndex], points[toIndex]);
  }

  function beamOrder(stops, startPoint, endPoint, options = {}) {
    if (!stops.length) return [];
    if (stops.length === 1) return stops.slice();
    const driver = options.driver || 'other';
    const mode = options.mode || 'normal';
    const phase = options.phase || 'pickup';
    const matrix = options.matrix;
    const points = options.points || [startPoint, ...stops.map(s => s.point), endPoint];
    const startIndex = options.startIndex ?? 0;
    const endIndex = options.endIndex ?? (points.length - 1);
    const stopIndex = stop => options.indexByStop?.get(stop) ?? (stops.indexOf(stop) + 1);
    const width = stops.length <= 9 ? 3000 : stops.length <= 14 ? 1400 : 500;
    let states = [{ order: [], remaining: stops.slice(), lastPoint: startPoint, lastIndex: startIndex, cost: 0, maxRank: -Infinity, lastHint: null }];
    for (let depth = 0; depth < stops.length; depth++) {
      const nextStates = [];
      for (const stateItem of states) {
        for (let i = 0; i < stateItem.remaining.length; i++) {
          const next = stateItem.remaining[i];
          const nextIdx = stopIndex(next);
          const travel = matrixDistance(matrix, stateItem.lastIndex, nextIdx, points);
          let penalty = 0;
          let rank = 0;
          if (phase === 'pickup') {
            rank = knownPickupRank(driver, next, mode);
            if (Number.isFinite(stateItem.maxRank) && rank < stateItem.maxRank - 0.5) penalty += (stateItem.maxRank - rank) * 18;
            if (stateItem.lastHint !== null && rank < stateItem.lastHint) penalty += (stateItem.lastHint - rank) * 5;
            if (travel <= 5) penalty -= 2.2;
          } else {
            rank = dropHintRank(driver, next);
            if (stateItem.lastHint !== null && rank < stateItem.lastHint) penalty += (stateItem.lastHint - rank) * 0.18;
            const homeProgressBefore = matrixDistance(matrix, stateItem.lastIndex, endIndex, points);
            const homeProgressAfter = matrixDistance(matrix, nextIdx, endIndex, points);
            if (depth >= Math.floor(stops.length / 2) && homeProgressAfter > homeProgressBefore + 8) penalty += (homeProgressAfter - homeProgressBefore) * 0.7;
          }
          const remaining = stateItem.remaining.slice(0, i).concat(stateItem.remaining.slice(i + 1));
          nextStates.push({
            order: stateItem.order.concat(next),
            remaining,
            lastPoint: next.point,
            lastIndex: nextIdx,
            cost: stateItem.cost + travel + penalty,
            maxRank: phase === 'pickup' ? Math.max(stateItem.maxRank, rank) : stateItem.maxRank,
            lastHint: rank
          });
        }
      }
      nextStates.sort((a, b) => {
        const aEnd = a.remaining.length ? 0 : matrixDistance(matrix, a.lastIndex, endIndex, points);
        const bEnd = b.remaining.length ? 0 : matrixDistance(matrix, b.lastIndex, endIndex, points);
        return (a.cost + aEnd) - (b.cost + bEnd);
      });
      states = nextStates.slice(0, width);
    }
    states.sort((a, b) => (a.cost + matrixDistance(matrix, a.lastIndex, endIndex, points)) - (b.cost + matrixDistance(matrix, b.lastIndex, endIndex, points)));
    return states[0]?.order || stops.slice();
  }

  function pathKm(start, order, end) {
    let total = 0, current = start;
    for (const stop of order) { total += km(current, stop.point); current = stop.point || current; }
    return total + km(current, end);
  }

  function supplierStopFromGroup(key, group, profiles) {
    let point = null;
    for (const order of group) {
      const p = profiles?.[order.id]?.pickup;
      if (finitePoint(p)) { point = p; break; }
    }
    return { key, name: group[0]?.pickupName || 'Felrakó', address: group[0]?.pickupAddress || '', orders: group, point, type: 'pickup' };
  }

  function projectStopFromGroup(key, group, profiles) {
    let point = null;
    for (const order of group) {
      const p = profiles?.[order.id]?.drop;
      if (finitePoint(p)) { point = p; break; }
    }
    return { key, name: group[0]?.projectName || 'Lerakó', address: group[0]?.dropAddress || '', orders: group, point, type: 'drop' };
  }

  function corridorDetour(start, point, end) {
    return km(start, point) + km(point, end) - km(start, end);
  }

  function centroid(points) {
    const list = points.filter(finitePoint);
    if (!list.length) return null;
    return [list.reduce((s, p) => s + p[0], 0) / list.length, list.reduce((s, p) => s + p[1], 0) / list.length];
  }

  function inboundCandidate(stop, home, base, others, driver, longOnly = false) {
    if (!finitePoint(stop.point) || !finitePoint(home) || !finitePoint(base)) return false;
    if (longOnly && !stop.orders.some(order => order.longMaterialReason)) return false;
    const detour = corridorDetour(home, stop.point, base);
    const direct = km(home, base);
    const otherCentre = centroid(others.filter(x => x !== stop).map(x => x.point));
    const isolation = otherCentre ? km(stop.point, otherCentre) : 99;
    const text = stopText(stop);
    const namedMarioException = driver === 'mario' && ((contains(text, 'ferenczi') && contains(text, 'kistarcsa')) || (contains(text, 'szerelvenybolt') && contains(text, 'ullo')));
    return (detour <= Math.max(13, direct * 0.28) && isolation >= 9) || namedMarioException;
  }

  function unitWorkload(unit, totalOrders, driverCount) {
    const full = unit.some(isFullLoadOrder);
    const normal = unit.length;
    return full ? Math.max(normal, Math.ceil(totalOrders / Math.max(1, driverCount)) * 0.9) : normal;
  }

  function unitPoint(unit, profiles, type) {
    for (const order of unit) {
      const point = profiles?.[order.id]?.[type];
      if (finitePoint(point)) return point;
    }
    return null;
  }

  function assignmentCost(vehicle, unit, assigned, profiles, homes, targetCount, totalOrders, drivers) {
    const id = vehicle.id;
    const count = assigned[id].length;
    const newCount = count + unit.length;
    const workload = unitWorkload(unit, totalOrders, drivers.length);
    const loadCost = Math.pow(newCount - targetCount, 2) * 11 + workload * 2;
    const pickup = unitPoint(unit, profiles, 'pickup');
    const drop = unitPoint(unit, profiles, 'drop');
    const basePoint = profiles.__base;
    const key = driverKey(vehicle);
    let anchor = homes[id];
    if ((key === 'martin' || key === 'patrik') && finitePoint(basePoint)) anchor = basePoint;
    const routeCost = km(anchor, pickup) * 0.25 + km(pickup, drop) * 0.2;
    const existingProjects = new Set(assigned[id].map(projectKey));
    const existingSuppliers = new Set(assigned[id].map(supplierKey));
    const projectBonus = unit.some(order => existingProjects.has(projectKey(order))) ? -16 : 0;
    const supplierBonus = unit.some(order => existingSuppliers.has(supplierKey(order))) ? -8 : 0;
    let territory = 0;
    const stop = { name: unit[0]?.pickupName, address: unit[0]?.pickupAddress, point: pickup };
    const rank = knownPickupRank(key, stop, key === 'mario' ? 'home' : 'central');
    if (key === 'mario' && rank >= 25) territory += 5;
    if (key === 'patrik' && stopZone(stop) === 'north-east') territory += 7;
    if (key === 'martin' && stopZone(stop) === 'north-east') territory += 5;
    return loadCost + routeCost + territory + projectBonus + supplierBonus;
  }

  async function v32Distribute() {
    const drivers = activeVehicles();
    if (!drivers.length) throw new Error('Nincs aktív jármű.');
    const orders = state.orders.filter(order => order.scheduleDate === selectedDate());
    if (!orders.length) throw new Error('Nincs szétosztható fuvar az adott napon.');
    const profiles = { __base: await geo(state.settings.baseAddress) }, homes = {}, assigned = {};
    for (const vehicle of drivers) { homes[vehicle.id] = await vehicleHome(vehicle); assigned[vehicle.id] = []; }
    for (const order of orders) {
      if (typeof syncOrderFromMasters === 'function') syncOrderFromMasters(order);
      profiles[order.id] = await orderGeoProfile(order);
      order.vehicleId = '';
      order.sequence = 999;
    }

    const martin = drivers.find(vehicle => driverKey(vehicle) === 'martin');
    const longVehicle = martin && canCarryLong(martin) ? martin : drivers.find(canCarryLong);
    const longUnits = [...groupBy(orders.filter(order => order.longMaterialReason), unitKey).values()];
    for (const unit of longUnits) {
      if (!longVehicle) continue;
      for (const order of unit) { order.vehicleId = longVehicle.id; assigned[longVehicle.id].push(order); }
    }

    const remaining = orders.filter(order => !order.vehicleId);
    const units = [...groupBy(remaining, unitKey).values()].sort((a, b) => {
      const af = a.some(isFullLoadOrder) ? 1 : 0, bf = b.some(isFullLoadOrder) ? 1 : 0;
      return bf - af || b.length - a.length;
    });
    const target = orders.length / drivers.length;
    for (const unit of units) {
      const eligible = drivers.filter(vehicle => !unit.some(order => order.longMaterialReason) || canCarryLong(vehicle));
      const ranked = eligible.map(vehicle => ({
        vehicle,
        cost: assignmentCost(vehicle, unit, assigned, profiles, homes, target, orders.length, drivers)
      })).sort((a, b) => a.cost - b.cost || assigned[a.vehicle.id].length - assigned[b.vehicle.id].length);
      const chosen = ranked[0]?.vehicle;
      if (!chosen) continue;
      for (const order of unit) { order.vehicleId = chosen.id; assigned[chosen.id].push(order); }
    }

    // Darabszám-kiegyenlítés: teljes beszállító+projekt egységet mozgatunk, soha nem fél rendelést.
    for (let guard = 0; guard < 120; guard++) {
      const sorted = drivers.slice().sort((a, b) => assigned[a.id].length - assigned[b.id].length);
      const low = sorted[0], high = sorted[sorted.length - 1];
      if (assigned[high.id].length - assigned[low.id].length <= 1) break;
      const movable = [...groupBy(assigned[high.id].filter(order => !order.longMaterialReason), unitKey).values()]
        .filter(unit => assigned[high.id].length - unit.length >= assigned[low.id].length)
        .map(unit => {
          const before = Math.abs(assigned[high.id].length - target) + Math.abs(assigned[low.id].length - target);
          const after = Math.abs(assigned[high.id].length - unit.length - target) + Math.abs(assigned[low.id].length + unit.length - target);
          const route = assignmentCost(low, unit, assigned, profiles, homes, target, orders.length, drivers);
          return { unit, gain: before - after, route };
        })
        .filter(x => x.gain > 0)
        .sort((a, b) => b.gain - a.gain || a.route - b.route || a.unit.length - b.unit.length);
      if (!movable.length) break;
      for (const order of movable[0].unit) {
        assigned[high.id] = assigned[high.id].filter(item => item.id !== order.id);
        assigned[low.id].push(order);
        order.vehicleId = low.id;
      }
    }
    return { orders, profiles, homes, assigned };
  }

  async function orderStopsWithRoadMatrix(stops, start, end, driver, mode, phase) {
    if (!stops.length) return [];
    const points = [start, ...stops.map(stop => stop.point), end];
    const matrix = await buildRoadMatrix(points);
    const indexByStop = new Map(stops.map((stop, index) => [stop, index + 1]));
    return beamOrder(stops, start, end, { driver, mode, phase, matrix, points, startIndex: 0, endIndex: points.length - 1, indexByStop });
  }

  async function v32BuildRoutePlan(vehicleId, suppliedProfiles = null) {
    const vehicle = state.vehicles.find(item => item.id === vehicleId);
    const dKey = driverKey(vehicle);
    const home = await vehicleHome(vehicle || {});
    const base = await geo(state.settings.baseAddress);
    const orders = dayOrders(vehicleId).slice();
    const profiles = suppliedProfiles || {};
    if (!suppliedProfiles) for (const order of orders) profiles[order.id] = await orderGeoProfile(order);
    const supplierGroups = groupBy(orders, supplierKey);
    const projectGroups = groupBy(orders, projectKey);
    const supplierStops = new Map([...supplierGroups.entries()].map(([key, group]) => [key, supplierStopFromGroup(key, group, profiles)]));
    const projectStops = new Map([...projectGroups.entries()].map(([key, group]) => [key, projectStopFromGroup(key, group, profiles)]));
    const remainingSuppliers = new Set(supplierStops.keys());
    const picked = new Set(), delivered = new Set(), events = [];
    let current = home;

    const addPickup = key => {
      if (!remainingSuppliers.has(key)) return;
      const stop = supplierStops.get(key), group = supplierGroups.get(key) || [];
      events.push({ type: 'pickup', key, name: stop.name, address: stop.address, orders: group.map(order => order.id), point: stop.point });
      group.forEach(order => picked.add(order.id));
      remainingSuppliers.delete(key);
      if (finitePoint(stop.point)) current = stop.point;
    };
    const addDrop = key => {
      if (delivered.has(key)) return;
      const stop = projectStops.get(key), group = projectGroups.get(key) || [];
      events.push({ type: 'drop', key, name: stop.name, address: stop.address, orders: group.map(order => order.id), point: stop.point });
      delivered.add(key);
      if (finitePoint(stop.point)) current = stop.point;
    };
    const projectReady = key => (projectGroups.get(key) || []).every(order => picked.has(order.id));
    const remainingPickupStops = () => [...remainingSuppliers].map(key => supplierStops.get(key));

    // Teljes autónyi rakomány: a felrakó és a hozzá tartozó lerakó megszakíthatatlan blokk,
    // ezért minden normál felrakás előtt teljesül.
    const fullLoadBlocks = [];
    for (const [key, group] of supplierGroups.entries()) {
      const fullOrders = group.filter(isFullLoadOrder);
      if (!fullOrders.length) continue;
      const projects = [...new Set(fullOrders.map(projectKey))];
      fullLoadBlocks.push({ supplierKey: key, supplier: supplierStops.get(key), projectKeys: projects });
    }
    if (fullLoadBlocks.length) {
      const orderedBlocks = await orderStopsWithRoadMatrix(fullLoadBlocks.map(block => ({ ...block.supplier, block })), current, base || home, dKey, 'full-load', 'pickup');
      for (const blockStop of orderedBlocks) {
        const block = blockStop.block;
        addPickup(block.supplierKey);
        const drops = block.projectKeys.map(key => projectStops.get(key)).filter(Boolean);
        const orderedDrops = await orderStopsWithRoadMatrix(drops, current, home, dKey, 'normal', 'drop');
        for (const drop of orderedDrops) if (projectReady(drop.key)) addDrop(drop.key);
      }
    }

    const centralKey = [...remainingSuppliers].find(key => (supplierGroups.get(key) || []).some(isCentralOrder));

    if (dKey === 'martin' || dKey === 'patrik') {
      // Martin csak a befelé eső hosszú/szálas felrakót veheti fel a központ előtt.
      // Ha ez megtörténik, a raktár közvetlen környezetében lévő pontot is felveszi még a kapu előtt.
      if (dKey === 'martin' && finitePoint(base)) {
        const all = remainingPickupStops().filter(stop => stop.key !== centralKey);
        const inboundLong = all.filter(stop => inboundCandidate(stop, current, base, all, dKey, true));
        const orderedInbound = await orderStopsWithRoadMatrix(inboundLong, current, base, dKey, 'inbound', 'pickup');
        for (const stop of orderedInbound) addPickup(stop.key);
        if (orderedInbound.length) {
          const nearBase = remainingPickupStops().filter(stop => stop.key !== centralKey && finitePoint(stop.point) && km(stop.point, base) <= 10 && corridorDetour(current, stop.point, base) <= 5.5);
          const orderedNear = await orderStopsWithRoadMatrix(nearBase, current, base, dKey, 'inbound', 'pickup');
          for (const stop of orderedNear) addPickup(stop.key);
        }
      }
      if (centralKey) addPickup(centralKey);
      else if (finitePoint(base)) {
        events.push({ type: 'anchor', key: 'v32-central-anchor', name: 'Központi raktár', address: state.settings.baseAddress, orders: [], point: base });
        current = base;
      }
      const rest = remainingPickupStops();
      const dropCentre = centroid([...projectStops.values()].filter(stop => !delivered.has(stop.key)).map(stop => stop.point)) || home;
      const ordered = await orderStopsWithRoadMatrix(rest, current, dropCentre, dKey, 'central', 'pickup');
      for (const stop of ordered) addPickup(stop.key);
    } else if (dKey === 'mario') {
      const all = remainingPickupStops();
      if (centralKey && finitePoint(base) && !fullLoadBlocks.length) {
        const nonCentral = all.filter(stop => stop.key !== centralKey);
        const inbound = nonCentral.filter(stop => inboundCandidate(stop, current, base, nonCentral, dKey, false));
        const candidateBInbound = await orderStopsWithRoadMatrix(inbound, current, base, dKey, 'inbound', 'pickup');
        const restB = nonCentral.filter(stop => !inbound.some(item => item.key === stop.key));
        const candidateBRest = await orderStopsWithRoadMatrix(restB, base, home, dKey, 'central', 'pickup');
        const candidateB = [...candidateBInbound, supplierStops.get(centralKey), ...candidateBRest];
        const candidateA = await orderStopsWithRoadMatrix(all, current, home, dKey, 'home', 'pickup');
        const costA = pathKm(current, candidateA, home);
        const costB = pathKm(current, candidateB, home);
        const chosen = costB <= costA * 1.06 ? candidateB : candidateA;
        for (const stop of chosen) addPickup(stop.key);
      } else {
        const ordered = await orderStopsWithRoadMatrix(all, current, home, dKey, 'home', 'pickup');
        for (const stop of ordered) addPickup(stop.key);
      }
    } else {
      const ordered = await orderStopsWithRoadMatrix(remainingPickupStops(), current, home, dKey, 'normal', 'pickup');
      for (const stop of ordered) addPickup(stop.key);
    }

    // Normál esetben csak az összes felrakás után következnek a lerakók.
    const readyDrops = [...projectStops.values()].filter(stop => !delivered.has(stop.key) && projectReady(stop.key));
    const orderedDrops = await orderStopsWithRoadMatrix(readyDrops, current, home, dKey, 'normal', 'drop');
    for (const stop of orderedDrops) addDrop(stop.key);

    state.routePlans = state.routePlans || {};
    state.routePlans[selectedDate()] = state.routePlans[selectedDate()] || {};
    state.routePlans[selectedDate()][vehicleId] = events;

    const pickupIndex = new Map(events.filter(event => event.type === 'pickup').map((event, index) => [event.key, index]));
    const dropIndex = new Map(events.filter(event => event.type === 'drop').map((event, index) => [event.key, index]));
    orders.sort((a, b) =>
      (pickupIndex.get(supplierKey(a)) ?? 999) - (pickupIndex.get(supplierKey(b)) ?? 999) ||
      (dropIndex.get(projectKey(a)) ?? 999) - (dropIndex.get(projectKey(b)) ?? 999) ||
      String(a.orderNo || '').localeCompare(String(b.orderNo || ''), 'hu')
    );
    orders.forEach((order, index) => { order.sequence = index + 1; });
    return events;
  }

  async function v32BalanceAction() {
    try {
      const result = await v32Distribute();
      const date = selectedDate();
      state.routePlans = state.routePlans || {};
      state.routePlans[date] = {};
      state.routeStats = state.routeStats || {};
      state.routeStats[date] = {};
      for (const vehicle of activeVehicles()) {
        // Üres, de létező terv: a főoldal térképe ne indítsa el automatikusan az optimalizálást.
        state.routePlans[date][vehicle.id] = [];
        dayOrders(vehicle.id).sort((a, b) => supplierKey(a).localeCompare(supplierKey(b), 'hu') || projectKey(a).localeCompare(projectKey(b), 'hu')).forEach((order, index) => { order.sequence = index + 1; });
      }
      save();
      const counts = activeVehicles().map(vehicle => `${vehicle.driverName}: ${dayOrders(vehicle.id).length}`).join(', ');
      alert(`Fuvarok szétosztva. ${counts}\nAz útvonalak sorrendjéhez nyomd meg az „Útvonal optimalizálása” gombot.`);
      return result;
    } catch (error) {
      console.error('[V32] Szétosztási hiba', error);
      alert(`A fuvarok szétosztása közben hiba történt: ${error?.message || error}`);
      return null;
    }
  }

  async function v32OptimizeAction(doSave = true) {
    try {
      const before = new Map(state.orders.filter(order => order.scheduleDate === selectedDate()).map(order => [order.id, order.vehicleId]));
      for (const vehicle of activeVehicles()) await v32BuildRoutePlan(vehicle.id);
      const changed = state.orders.filter(order => order.scheduleDate === selectedDate() && before.get(order.id) !== order.vehicleId);
      if (changed.length) throw new Error('Az optimalizálás sofőrt változtatott, ezért a művelet vissza lett utasítva.');
      if (doSave) {
        save();
        alert('Útvonal-optimalizálás befejezve. A sofőrök kiosztása nem változott.');
      }
      return true;
    } catch (error) {
      console.error('[V32] Optimalizálási hiba', error);
      alert(`Az optimalizálás közben hiba történt: ${error?.message || error}`);
      return false;
    }
  }

  function bindActions() {
    if (typeof document === 'undefined') return;
    const balanceButton = document.getElementById('balanceBtn');
    const optimizeButton = document.getElementById('optimizeBtn');
    if (balanceButton) {
      balanceButton.onclick = async event => { event.preventDefault(); return v32BalanceAction(); };
      balanceButton.dataset.algorithmVersion = VERSION;
      balanceButton.title = '1. lépés: a fuvarok igazságos szétosztása, útvonalsorrend készítése nélkül';
    }
    if (optimizeButton) {
      optimizeButton.onclick = async event => { event.preventDefault(); return v32OptimizeAction(); };
      optimizeButton.dataset.algorithmVersion = VERSION;
      optimizeButton.title = '2. lépés: a már kiosztott fuvarok sorrendjének optimalizálása';
    }
    global.FUVARSZERVEZO_VERSION = VERSION;
    global.getFuvarszervezoDiagnostics = () => ({
      version: VERSION,
      balanceHandler: balanceButton?.dataset.algorithmVersion || null,
      optimizeHandler: optimizeButton?.dataset.algorithmVersion || null,
      activeDrivers: typeof activeVehicles === 'function' ? activeVehicles().map(vehicle => vehicle.driverName) : [],
      flow: ['Fuvarok szétosztása', 'Útvonal optimalizálása']
    });
  }

  // A régi globális belépési pontokat az új modulra irányítjuk.
  if (typeof balance !== 'undefined') balance = v32BalanceAction;
  if (typeof optimizeAll !== 'undefined') optimizeAll = v32OptimizeAction;
  if (typeof v27BuildRoutePlan !== 'undefined') v27BuildRoutePlan = v32BuildRoutePlan;

  global.V32Planner = {
    version: VERSION,
    stopZone,
    knownPickupRank,
    dropHintRank,
    beamOrder,
    isFullLoadOrder,
    isCentralOrder,
    pathKm,
    inboundCandidate,
    corridorDetour,
    buildRoadMatrix,
    v32Distribute,
    v32BuildRoutePlan,
    v32BalanceAction,
    v32OptimizeAction
  };

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bindActions, { once: true });
    else bindActions();
  }
})(typeof window !== 'undefined' ? window : globalThis);
