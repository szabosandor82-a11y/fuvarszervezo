/* Fuvarszervező V35
   A feltöltött, kézzel szervezett fuvarnapokból és a megbeszélt szabályokból épített motor.

   Alapelv:
   - A szétosztás terhelési egysége elsősorban a FELRAKÓHELY, nem a rendelésszám.
   - Az Autó oszlopban névre jelölt fuvar fix.
   - A Dobozos kategória egész felrakóblokkokban oszlik szét.
   - Az optimalizálás normál esetben csak a felrakók sorrendjét tervezi.
   - Normál lerakó nem befolyásolja a felrakási útvonalat.
   - Teljes autós rakomány: felrakó -> azonnali lerakó megszakíthatatlan blokk.
*/
(function (global) {
  'use strict';

  const VERSION = '35';
  const CENTRAL_RE = /(\bkrpr\b|k[oö]zponti\s*rakt[aá]r|keresked[oő]\s*utca|szigetszentmikl[oó]s)/i;
  const FULL_LOAD_RE = /(teljes\s*(auto|autó|kocsi|kamion|rakom[aá]ny)|eg[eé]sz\s*(auto|autó|kocsi|kamion)|tele\s*(auto|autó|kocsi)|full\s*load|100\s*%\s*(kapacit[aá]s|rakom[aá]ny))/i;
  const LONG_RE = /(?:^|[^0-9])([456](?:[.,]0+)?)\s*(?:m|meter)(?:es|eres)?\b|\b(4000|5000|6000)\s*mm\b|\b(sz[aá]las|hossz[uú]\s*anyag|6m\b|5m\b|4m\b)/i;
  const LONG_OBJECT_RE = /(cs[oő]|r[uú]d|profil|s[ií]n|l[eé]gcsatorna|spir[aá]l|ac[eé]l|kpe|pvc|r[eé]z|menetes\s*sz[aá]l|z[aá]rtszelv[eé]ny)/i;
  const BULKY_RE = /(tart[aá]ly|kaz[aá]n|h[oő]cser[eé]l[oő]|l[eé]gkezel[oő]|ventil[aá]tor|szivatty[uú]|raklap|lemezl[aá]da|l[eé]gcsatorna|oszt[oó]\s*gy[uű]jt[oő]|szekr[eé]ny|bojler|h[oő]szivatty[uú]|aggreg[aá]t)/i;

  const nrm = value => {
    if (typeof norm === 'function') return norm(value || '');
    return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[_.,;:()[\]{}\/\\-]+/g, ' ').replace(/\s+/g, ' ').trim();
  };
  const finitePoint = point => Array.isArray(point) && Number.isFinite(+point[0]) && Number.isFinite(+point[1]);
  const km = (a, b) => {
    if (!finitePoint(a) || !finitePoint(b)) return 35;
    if (typeof v29Km === 'function') return v29Km(a, b);
    const R = 6371, rad = value => value * Math.PI / 180;
    const dLat = rad(b[0] - a[0]), dLon = rad(b[1] - a[1]);
    const q = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLon / 2) ** 2;
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
  const driverKey = vehicle => {
    const value = nrm(vehicle?.driverName || '');
    if (value.includes('mario')) return 'mario';
    if (value.includes('patrik')) return 'patrik';
    if (value.includes('martin')) return 'martin';
    return 'other';
  };
  const findDriver = (key, drivers) => drivers.find(vehicle => driverKey(vehicle) === key) || null;
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

  function v35LongReason(name = '') {
    const text = String(name || '');
    const normalized = nrm(text);
    if (!LONG_RE.test(text) && !(/\b(3000|3500)\s*mm\b/i.test(text) && LONG_OBJECT_RE.test(text))) return '';
    if (!LONG_OBJECT_RE.test(text) && !/sz[aá]las|hossz[uú]\s*anyag/i.test(text)) return '';
    const metres = text.match(/(?:^|[^0-9])([3456](?:[.,]\d+)?)\s*(?:m|meter)/i);
    if (metres) return `${String(metres[1]).replace(',', '.')} méteres szálanyag`;
    const mm = text.match(/\b(3000|3500|4000|5000|6000)\s*mm\b/i);
    if (mm) return `${(+mm[1] / 1000).toString().replace('.', ',')} méteres szálanyag`;
    return normalized.includes('szalas') ? 'szálas anyag' : 'hosszú anyag';
  }

  function physicalLoad(order) {
    const text = orderText(order);
    const items = order?.items || [];
    let long = order?.longMaterialReason ? 1 : 0;
    let bulky = 0;
    for (const item of items) {
      const itemText = [item?.name, item?.itemNote, item?.itemRemark, item?.tetelMegjegyzes].filter(Boolean).join(' ');
      if (item?.longMaterial || v35LongReason(itemText)) long += 1;
      if (BULKY_RE.test(itemText)) bulky += 1;
    }
    if (BULKY_RE.test(text)) bulky += 0.5;
    return {
      long,
      bulky,
      full: isFullLoadOrder(order) ? 1 : 0,
      itemCount: items.length
    };
  }

  function categoryForOrder(order) {
    if (global.V34Planner?.categoryForOrder) return global.V34Planner.categoryForOrder(order);
    const explicit = nrm(order?.importVehicleCategory || '');
    if (['patrik', 'mario', 'martin', 'dobozos'].includes(explicit)) return explicit;
    if (order?.importVehicleLocked && order?.vehicleId) return `fixed:${order.vehicleId}`;
    if (order?.markedMartin || order?.longMaterialReason) return 'martin';
    return 'dobozos';
  }

  function pickupSide(order, point = null) {
    if (isCentralOrder(order)) return 'central';
    if (global.V33Planner?.pickupSide) return global.V33Planner.pickupSide(point, order?.pickupAddress || '');
    const text = nrm(order?.pickupAddress || '');
    if (/budaors|torokbalint|budafok|nagyteteny|hengermalom|hunyadi janos|erd|biatorbagy/.test(text)) return 'buda';
    if (/kistarcsa|ullo|vecses|gyal|kispest|kobanya|kesmark|maglodi|kada|gyomroi|pesti hatar/.test(text)) return 'pest';
    return 'unknown';
  }

  // A Dobozos fuvar teljes külső felrakóhelye egy egység.
  // A központi raktár szétosztható projektenként, mert ott mindhárom autó rakodhat.
  // A teljes autós fuvar külön felrakó->lerakó egység marad.
  function distributionUnitKey(order) {
    const category = categoryForOrder(order);
    const fixed = order?.routePinned ? `pin:${order.pinnedVehicleId || order.vehicleId || ''}` : (order?.importVehicleLocked ? `lock:${order.vehicleId || category}` : category);
    if (isFullLoadOrder(order)) return `full||${bubbleKey(order)}||${fixed}`;
    if (isCentralOrder(order)) return `central||${projectKey(order)}||${fixed}`;
    return `supplier||${supplierKey(order)}||${fixed}`;
  }

  function profilePoint(group, profiles, type = 'pickup') {
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
      profiles[order.id] = typeof orderGeoProfile === 'function'
        ? await orderGeoProfile(order)
        : {
            pickup: typeof geo === 'function' ? await geo(order.pickupAddress) : null,
            drop: typeof geo === 'function' ? await geo(order.dropAddress) : null
          };
    }
    profiles.__base = typeof geo === 'function' && typeof state !== 'undefined' ? await geo(state.settings?.baseAddress || '') : null;
    return profiles;
  }

  function unitLoad(group) {
    const physical = group.reduce((acc, order) => {
      const value = physicalLoad(order);
      acc.long += value.long;
      acc.bulky += value.bulky;
      acc.full += value.full;
      acc.items += value.itemCount;
      return acc;
    }, { long: 0, bulky: 0, full: 0, items: 0 });
    const central = isCentralOrder(group[0]);
    return {
      central,
      long: physical.long,
      bulky: physical.bulky,
      full: physical.full,
      items: physical.items,
      orders: group.length,
      // A megálló a legerősebb súly. Az azonos helyen lévő plusz rendelések csak kis pótlékok.
      weight: (central ? 0.45 : 1.0)
        + Math.max(0, group.length - 1) * 0.12
        + Math.min(0.55, physical.items * 0.025)
        + Math.min(1.4, physical.bulky * 0.35)
        + (physical.long ? 1.75 + Math.min(1.1, physical.long * 0.22) : 0)
        + (physical.full ? 4.5 : 0)
    };
  }

  function workloadForOrders(orders) {
    const units = [...groupBy(orders, distributionUnitKey).values()];
    const uniquePhysicalStops = new Set(orders.filter(order => !isCentralOrder(order)).map(supplierKey));
    const centralOrders = orders.filter(isCentralOrder);
    let value = uniquePhysicalStops.size;
    if (centralOrders.length) value += 0.65 + Math.max(0, centralOrders.length - 1) * 0.13;
    for (const unit of units) {
      const load = unitLoad(unit);
      value += Math.max(0, load.weight - (load.central ? 0.45 : 1.0));
    }
    return value;
  }

  function longBurden(orders) {
    return orders.reduce((sum, order) => {
      const load = physicalLoad(order);
      return sum + load.long * 1.4 + load.bulky * 0.35 + load.full * 3.5;
    }, 0);
  }

  function fixedVehicleForGroup(group, drivers) {
    const pinned = group.find(order => order.routePinned && (order.pinnedVehicleId || order.vehicleId));
    if (pinned) return drivers.find(vehicle => vehicle.id === (pinned.pinnedVehicleId || pinned.vehicleId)) || null;
    const category = categoryForOrder(group[0]);
    if (category.startsWith('fixed:')) return drivers.find(vehicle => vehicle.id === category.slice(6)) || null;
    if (category === 'patrik' || category === 'mario' || category === 'martin') return findDriver(category, drivers);
    if (group[0]?.importVehicleLocked && group[0]?.vehicleId) return drivers.find(vehicle => vehicle.id === group[0].vehicleId) || null;
    return null;
  }

  function territoryPenalty(vehicle, group, profiles) {
    const key = driverKey(vehicle);
    const point = profilePoint(group, profiles, 'pickup');
    const side = pickupSide(group[0], point);
    if (side === 'central' || side === 'unknown') return 0;
    if (key === 'patrik') return side === 'buda' ? 0 : 3.1;
    if (key === 'mario') return side === 'pest' ? 0 : 3.1;
    if (key === 'martin') return side === 'buda' ? 0.65 : 1.15;
    return 1.5;
  }

  function relatednessBonus(group, currentOrders) {
    const supplier = supplierKey(group[0]);
    const projects = new Set(group.map(projectKey));
    let bonus = 0;
    if (currentOrders.some(order => supplierKey(order) === supplier)) bonus -= 1.4;
    if (currentOrders.some(order => projects.has(projectKey(order)))) bonus -= 0.35;
    return bonus;
  }

  function assignmentObjective(drivers, assigned, profiles) {
    const workloads = drivers.map(vehicle => workloadForOrders(assigned[vehicle.id] || []));
    const mean = workloads.reduce((sum, value) => sum + value, 0) / Math.max(1, workloads.length);
    const variance = workloads.reduce((sum, value) => sum + (value - mean) ** 2, 0);
    let territory = 0;
    for (const vehicle of drivers) {
      for (const group of groupBy(assigned[vehicle.id] || [], distributionUnitKey).values()) {
        if (categoryForOrder(group[0]) === 'dobozos') territory += territoryPenalty(vehicle, group, profiles);
      }
    }
    return variance * 2.4 + territory;
  }

  async function distributeOrderSet(orders, options = {}) {
    const drivers = (options.drivers || (typeof activeVehicles === 'function' ? activeVehicles() : [])).slice();
    if (!drivers.length) throw new Error('Nincs aktív jármű.');
    const profiles = options.profiles || await profileOrders(orders);
    const assigned = Object.fromEntries(drivers.map(vehicle => [vehicle.id, []]));
    const mario = findDriver('mario', drivers);
    const patrik = findDriver('patrik', drivers);
    const martin = findDriver('martin', drivers);

    const groups = [...groupBy(orders, distributionUnitKey).values()];
    const fixedGroups = [], boxGroups = [];
    for (const group of groups) {
      const fixedVehicle = fixedVehicleForGroup(group, drivers);
      if (fixedVehicle || categoryForOrder(group[0]) !== 'dobozos') fixedGroups.push({ group, vehicle: fixedVehicle || drivers[0] });
      else boxGroups.push(group);
    }

    const setGroup = (group, vehicle) => {
      for (const order of group) {
        order.vehicleId = vehicle.id;
        assigned[vehicle.id].push(order);
      }
    };
    fixedGroups.forEach(item => setGroup(item.group, item.vehicle));

    const totalEstimated = drivers.reduce((sum, vehicle) => sum + workloadForOrders(assigned[vehicle.id]), 0)
      + boxGroups.reduce((sum, group) => sum + unitLoad(group).weight, 0);
    const target = totalEstimated / Math.max(1, drivers.length);
    const martinInitial = martin ? workloadForOrders(assigned[martin.id]) : Infinity;
    const martinSpecial = martin ? longBurden(assigned[martin.id]) : Infinity;
    const martinCanHelp = !!martin && martinInitial < target * 0.72 && martinSpecial < Math.max(2.8, target * 0.62);

    boxGroups.sort((a, b) => unitLoad(b).weight - unitLoad(a).weight || supplierKey(a[0]).localeCompare(supplierKey(b[0]), 'hu'));

    for (const group of boxGroups) {
      const side = pickupSide(group[0], profilePoint(group, profiles, 'pickup'));
      let candidates = [patrik, mario].filter(Boolean);
      if (martinCanHelp) candidates.push(martin);
      if (!candidates.length) candidates = drivers.slice();
      const ranked = candidates.map(vehicle => {
        const simulated = Object.fromEntries(drivers.map(item => [item.id, (assigned[item.id] || []).slice()]));
        simulated[vehicle.id].push(...group);
        const workloads = drivers.map(item => workloadForOrders(simulated[item.id]));
        const mean = workloads.reduce((sum, value) => sum + value, 0) / Math.max(1, workloads.length);
        const fairness = workloads.reduce((sum, value) => sum + (value - mean) ** 2, 0);
        let territory = territoryPenalty(vehicle, group, profiles);
        // A Buda/Patrik és Pest/Márió szabály erős, de túlterhelésnél felülírható.
        if (side === 'buda' && vehicle === patrik) territory -= 0.7;
        if (side === 'pest' && vehicle === mario) territory -= 0.7;
        const martinGuard = vehicle === martin && !martinCanHelp ? 100 : 0;
        const over = Math.max(0, workloadForOrders(simulated[vehicle.id]) - target * 1.16) * 3.2;
        return {
          vehicle,
          score: fairness * 2.25 + territory + relatednessBonus(group, assigned[vehicle.id]) + martinGuard + over
        };
      }).sort((a, b) => a.score - b.score || driverKey(a.vehicle).localeCompare(driverKey(b.vehicle)));
      setGroup(group, ranked[0]?.vehicle || candidates[0] || drivers[0]);
    }

    // Egész Dobozos felrakóblokkok mozgatásával helyi javítás. A névre jelölt fuvarok érintetlenek.
    for (let pass = 0; pass < 5; pass++) {
      let improved = false;
      const before = assignmentObjective(drivers, assigned, profiles);
      for (const source of drivers) {
        const movable = [...groupBy(
          assigned[source.id].filter(order => categoryForOrder(order) === 'dobozos' && !order.importVehicleLocked && !order.routePinned),
          distributionUnitKey
        ).values()];
        for (const group of movable) {
          for (const targetVehicle of drivers) {
            if (targetVehicle.id === source.id) continue;
            if (targetVehicle === martin && !martinCanHelp) continue;
            const ids = new Set(group.map(order => order.id));
            assigned[source.id] = assigned[source.id].filter(order => !ids.has(order.id));
            assigned[targetVehicle.id].push(...group);
            const after = assignmentObjective(drivers, assigned, profiles);
            if (after + 0.08 < before) {
              group.forEach(order => { order.vehicleId = targetVehicle.id; });
              improved = true;
              break;
            }
            assigned[targetVehicle.id] = assigned[targetVehicle.id].filter(order => !ids.has(order.id));
            assigned[source.id].push(...group);
          }
          if (improved) break;
        }
        if (improved) break;
      }
      if (!improved) break;
    }

    // Szétosztás után még nincs útvonal. Az ideiglenes sorrend felrakó szerint áttekinthető.
    for (const vehicle of drivers) {
      assigned[vehicle.id]
        .sort((a, b) => supplierKey(a).localeCompare(supplierKey(b), 'hu') || projectKey(a).localeCompare(projectKey(b), 'hu'))
        .forEach((order, index) => { order.sequence = index + 1; });
    }

    return {
      assigned,
      profiles,
      target,
      martinCanHelp,
      workloads: Object.fromEntries(drivers.map(vehicle => [vehicle.id, workloadForOrders(assigned[vehicle.id])]))
    };
  }

  // Beszállítónevek normalizálása a történeti mintákhoz.
  function canonicalStop(stop) {
    const text = nrm(`${stop?.name || ''} ${stop?.address || ''}`);
    const rules = [
      ['central', /(\bkrpr\b|kozponti raktar|kereskedo utca|szigetszentmiklos)/],
      ['sebok', /sebok/], ['niczuk', /niczuk/], ['cairox', /cairox/], ['gienger', /gienger/],
      ['lambda', /lambda/], ['larex', /larex/], ['ezerker', /ezerker/], ['fogarasi', /fogarasi/],
      ['szatmari', /szatmari/], ['merkapt', /merkapt/], ['attacso', /atta(cso)?/], ['dtkozmu', /dt\s*kozmu/],
      ['empack', /empack/], ['szogker', /szogker/], ['szerelvenybolt', /szerelvenybolt/], ['ryng', /ryng/],
      ['neber', /neber/], ['egrokorr', /egrokorr/], ['airvent', /airvent/], ['airtechnik', /air\s*technik/],
      ['lindab', /lindab/], ['heat', /heat\s*hungary/], ['azimut', /azimut/], ['sikla', /sikla/],
      ['remeha', /remeha/], ['mupro', /mupro/], ['ferenczi', /ferenczi/], ['zenner', /zenner/],
      ['moxyreturn', /moxy/], ['cosmoreturn', /cosmo/], ['kincsemreturn', /kincsem/]
    ];
    for (const [key, re] of rules) if (re.test(text)) return key;
    return text || 'unknown';
  }

  const HISTORY = {
    martin: [
      ['egrokorr','central','ryng'],
      ['heat','central','neber','ryng','sebok'],
      ['airvent','central','lambda','neber','ryng','sikla'],
      ['airtechnik','egrokorr','central','lambda','remeha','sebok','sikla'],
      ['cairox','gienger','central','szatmari'],
      ['lindab','central','niczuk','lambda','mupro','szatmari'],
      ['egrokorr','attacso','central','ryng'],
      ['central','attacso'],
      ['sebok','egrokorr','central','attacso','merkapt','dtkozmu','kincsemreturn']
    ],
    mario: [
      ['szatmari','merkapt','ezerker','fogarasi','central'],
      ['ferenczi','merkapt','ezerker','fogarasi','szogker','central'],
      ['central','niczuk','szogker','fogarasi','merkapt','szatmari','neber'],
      ['szerelvenybolt','central','fogarasi','ezerker','merkapt','szatmari'],
      ['neber','szatmari','ryng','merkapt','airvent','moxyreturn'],
      ['szatmari','ezerker','szerelvenybolt','fogarasi','central']
    ],
    patrik: [
      ['central','niczuk','gienger','sebok','cairox'],
      ['central','niczuk','gienger','sebok','azimut'],
      ['central','niczuk','gienger','lambda','sebok','moxyreturn'],
      ['central','niczuk','gienger','lambda','larex','szogker','ezerker','cosmoreturn'],
      ['sebok','cairox','szogker','fogarasi'],
      ['central','merkapt','szatmari','szerelvenybolt','szogker']
    ]
  };

  function historicalPreference(driver, before, after) {
    const sequences = HISTORY[driver] || [];
    let forward = 0, backward = 0;
    for (const sequence of sequences) {
      const a = sequence.indexOf(before), b = sequence.indexOf(after);
      if (a < 0 || b < 0 || a === b) continue;
      if (a < b) forward++; else backward++;
    }
    return forward - backward;
  }

  function stopZone(stop) {
    const text = nrm(`${stop?.name || ''} ${stop?.address || ''}`);
    if (CENTRAL_RE.test(`${stop?.name || ''} ${stop?.address || ''}`)) return 'central';
    if (/szigetszentmiklos|halasztelek|csepel|dunaharaszti/.test(text)) return 'south-island';
    if (/torokbalint|budaors|erd|biatorbagy/.test(text)) return 'southwest';
    if (/budafok|nagyteteny|hengermalom|hunyadi janos|1222|1225|1116|1117/.test(text)) return 'south-buda';
    if (/kesmark|kistarcsa|dunakeszi|vac|rakospalota/.test(text)) return 'north-east';
    if (/ullo|vecses|gyal|kispest|vas gereben|1195|1182|2220/.test(text)) return 'south-east';
    if (/akna utca|maglodi|kada|gyomroi|pesti hatar|1103|1106|1108/.test(text)) return 'east';
    if (/obuda|szentendrei|1133|1134|1138|1033/.test(text)) return 'north';
    return 'unknown';
  }

  function modeRank(driver, stop, mode = 'normal') {
    const key = canonicalStop(stop);
    const tables = {
      patrik: {
        central: 0, niczuk: 10, cairox: 11, gienger: 12, lambda: 13, sebok: 14, azimut: 16,
        empack: 17, larex: 19, szogker: 22, fogarasi: 23, szerelvenybolt: 24, ezerker: 26,
        merkapt: 27, szatmari: 29, moxyreturn: 31, cosmoreturn: 32
      },
      martin: {
        central: 0, attacso: 10, niczuk: 11, cairox: 12, gienger: 13, empack: 14, lambda: 15,
        remeha: 16, sebok: 17, sikla: 18, merkapt: 22, dtkozmu: 23, fogarasi: 25,
        neber: 27, ryng: 29, szatmari: 31, kincsemreturn: 35
      },
      martinInbound: {
        sebok: 2, heat: 3, airtechnik: 4, lindab: 5, egrokorr: 6, niczuk: 7, cairox: 8, gienger: 9, attacso: 10
      },
      marioHome: {
        neber: 4, szatmari: 8, ferenczi: 10, larex: 14, merkapt: 18, ezerker: 20,
        szerelvenybolt: 22, fogarasi: 24, attacso: 27, ryng: 30, central: 36
      },
      marioCentral: {
        central: 0, attacso: 8, fogarasi: 10, ezerker: 13, merkapt: 16, szogker: 18,
        szerelvenybolt: 20, szatmari: 25, neber: 28, ryng: 30
      }
    };
    let table;
    if (driver === 'mario') table = mode === 'central' ? tables.marioCentral : tables.marioHome;
    else if (driver === 'martin' && mode === 'inbound') table = tables.martinInbound;
    else table = tables[driver] || {};
    if (Number.isFinite(table[key])) return table[key];
    const zone = stopZone(stop);
    const fallbacks = driver === 'mario' && mode === 'central'
      ? { central: 0, 'south-island': 7, 'south-east': 11, east: 15, 'north-east': 24, north: 27, 'south-buda': 29, southwest: 31, unknown: 35 }
      : driver === 'mario'
        ? { 'north-east': 7, north: 10, east: 18, 'south-east': 24, 'south-island': 30, central: 36, 'south-buda': 34, southwest: 35, unknown: 38 }
        : driver === 'patrik'
          ? { central: 0, 'south-island': 8, 'south-buda': 13, southwest: 16, 'south-east': 24, east: 28, 'north-east': 31, north: 32, unknown: 36 }
          : { central: 0, 'south-island': 10, 'south-buda': 14, southwest: 17, east: 23, 'south-east': 26, 'north-east': 29, north: 32, unknown: 36 };
    return fallbacks[zone] ?? 36;
  }

  async function buildRoadMatrix(points) {
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
      console.warn('[V35] Közúti mátrix nem elérhető; légvonalas tartalék használata.', error);
    }
    return fallback;
  }

  function historicalPenalty(driver, chosenStops, nextStop) {
    const next = canonicalStop(nextStop);
    let penalty = 0;
    for (const previousStop of chosenStops) {
      const previous = canonicalStop(previousStop);
      const preference = historicalPreference(driver, previous, next);
      if (preference < 0) penalty += Math.abs(preference) * 4.5;
      else if (preference > 0) penalty -= Math.min(2.4, preference * 0.55);
    }
    return penalty;
  }

  function beamOrder(stops, startPoint, mode, driver, endPoint = null) {
    if (stops.length <= 1) return Promise.resolve(stops.slice());
    const points = [startPoint, ...stops.map(stop => stop.point), endPoint];
    return buildRoadMatrix(points).then(matrix => {
      const idx = new Map(stops.map((stop, index) => [stop, index + 1]));
      const endIndex = points.length - 1;
      const width = stops.length <= 9 ? 3500 : stops.length <= 13 ? 1500 : 600;
      let states = [{ order: [], remaining: stops.slice(), lastIndex: 0, cost: 0, lastRank: -Infinity }];
      for (let depth = 0; depth < stops.length; depth++) {
        const nextStates = [];
        for (const stateItem of states) {
          for (let i = 0; i < stateItem.remaining.length; i++) {
            const next = stateItem.remaining[i];
            const nextIndex = idx.get(next);
            const travel = matrix[stateItem.lastIndex]?.[nextIndex] ?? km(points[stateItem.lastIndex], next.point);
            const rank = modeRank(driver, next, mode);
            let penalty = historicalPenalty(driver, stateItem.order, next);
            if (stateItem.lastRank !== -Infinity && rank < stateItem.lastRank) penalty += (stateItem.lastRank - rank) * 4.1;
            if (travel <= 4.5) penalty -= 1.8;
            // A teljes autós blokk után a jármű a lerakónál folytatja. Ezt külön utazási költségként kezeljük.
            const exitPoint = finitePoint(next.exitPoint) ? next.exitPoint : next.point;
            let exitExtra = 0;
            if (finitePoint(next.exitPoint) && finitePoint(next.point)) exitExtra = km(next.point, next.exitPoint);
            const remaining = stateItem.remaining.slice(0, i).concat(stateItem.remaining.slice(i + 1));
            nextStates.push({
              order: stateItem.order.concat(next), remaining,
              lastIndex: nextIndex, cost: stateItem.cost + travel + exitExtra + penalty,
              lastRank: rank, virtualExit: exitPoint
            });
          }
        }
        nextStates.sort((a, b) => {
          const aEnd = a.remaining.length || !finitePoint(endPoint) ? 0 : km(a.virtualExit || points[a.lastIndex], endPoint);
          const bEnd = b.remaining.length || !finitePoint(endPoint) ? 0 : km(b.virtualExit || points[b.lastIndex], endPoint);
          return (a.cost + aEnd) - (b.cost + bEnd);
        });
        states = nextStates.slice(0, width);
      }
      return states.sort((a, b) => a.cost - b.cost)[0]?.order || stops.slice();
    });
  }

  function corridorDetour(start, point, end) {
    return km(start, point) + km(point, end) - km(start, end);
  }

  function isolatedInboundMario(stop, home, base, others) {
    if (!finitePoint(stop.point) || !finitePoint(home) || !finitePoint(base)) return false;
    const key = canonicalStop(stop);
    if (key === 'ferenczi' || key === 'szerelvenybolt') return true;
    const detour = corridorDetour(home, stop.point, base);
    const otherPoints = others.filter(item => item !== stop && finitePoint(item.point)).map(item => item.point);
    let isolation = 99;
    if (otherPoints.length) isolation = Math.min(...otherPoints.map(point => km(stop.point, point)));
    return detour <= Math.max(12, km(home, base) * 0.28) && isolation >= 9;
  }

  function martinPreCentral(stop, home, base) {
    if (!finitePoint(stop.point) || !finitePoint(home) || !finitePoint(base)) return false;
    const hasSpecial = stop.orders.some(order => {
      const load = physicalLoad(order);
      return load.long > 0 || load.bulky >= 1.5 || order.markedMartin;
    });
    if (!hasSpecial) return false;
    const key = canonicalStop(stop);
    const knownInbound = ['sebok','egrokorr','heat','airtechnik','lindab','cairox','gienger','niczuk','attacso'].includes(key);
    const detour = corridorDetour(home, stop.point, base);
    return knownInbound || detour <= Math.max(16, km(home, base) * 0.33);
  }

  function supplierStop(key, group, profiles) {
    const first = group[0];
    return {
      key,
      name: first?.pickupName || 'Felrakó',
      address: first?.pickupAddress || '',
      point: profilePoint(group, profiles, 'pickup'),
      orders: group,
      fullLoad: group.some(isFullLoadOrder),
      exitPoint: group.some(isFullLoadOrder) ? profilePoint(group.filter(isFullLoadOrder), profiles, 'drop') : null,
      dropName: group.find(isFullLoadOrder)?.projectName || '',
      dropAddress: group.find(isFullLoadOrder)?.dropAddress || ''
    };
  }

  async function planPickupStops(vehicle, orders, profiles) {
    const driver = driverKey(vehicle);
    const home = typeof vehicleHome === 'function' ? await vehicleHome(vehicle) : null;
    const base = profiles.__base || (typeof geo === 'function' ? await geo(state.settings?.baseAddress || '') : null);

    // Normál felrakóhely egyszer szerepel. Teljes autós rendelés külön blokk marad.
    const stopGroups = new Map();
    for (const order of orders) {
      const key = isFullLoadOrder(order) ? `full||${bubbleKey(order)}` : `supplier||${supplierKey(order)}`;
      if (!stopGroups.has(key)) stopGroups.set(key, []);
      stopGroups.get(key).push(order);
    }
    const allStops = [...stopGroups.entries()].map(([key, group]) => supplierStop(key, group, profiles));

    // A teljes autós rakományt előbb önálló felrakó->lerakó körként teljesíti.
    // A következő felrakási útvonal már a kötelező lerakó helyéről indul.
    const fullStops = allStops.filter(stop => stop.fullLoad);
    const normalStops = allStops.filter(stop => !stop.fullLoad);
    const orderedFull = await beamOrder(fullStops, home, 'normal', driver);
    let routeStart = home;
    if (orderedFull.length) {
      const last = orderedFull[orderedFull.length - 1];
      routeStart = last.exitPoint || last.point || home;
    }

    const central = normalStops.find(stop => stop.orders.some(isCentralOrder));

    if (driver === 'patrik') {
      const rest = normalStops.filter(stop => stop !== central);
      const ordered = await beamOrder(rest, central?.point || base || routeStart, 'normal', 'patrik');
      return [...orderedFull, ...(central ? [central] : []), ...ordered];
    }

    if (driver === 'martin') {
      const rest = normalStops.filter(stop => stop !== central);
      const inbound = central ? rest.filter(stop => martinPreCentral(stop, routeStart, base)) : [];
      const after = rest.filter(stop => !inbound.includes(stop));
      const orderedInbound = await beamOrder(inbound, routeStart, 'inbound', 'martin', base);
      const current = central?.point || base || orderedInbound.at(-1)?.point || routeStart;
      const orderedAfter = await beamOrder(after, current, 'normal', 'martin');
      return [...orderedFull, ...orderedInbound, ...(central ? [central] : []), ...orderedAfter];
    }

    if (driver === 'mario') {
      if (!central) return [...orderedFull, ...await beamOrder(normalStops, routeStart, 'home', 'mario')];
      const rest = normalStops.filter(stop => stop !== central);
      const inbound = rest.filter(stop => isolatedInboundMario(stop, routeStart, base, rest));
      const remaining = rest.filter(stop => !inbound.includes(stop));
      const inboundOrdered = await beamOrder(inbound, routeStart, 'home', 'mario', base);
      const centralOrdered = await beamOrder(remaining, central.point || base, 'central', 'mario', home);
      const candidateCentral = [...inboundOrdered, central, ...centralOrdered];
      const candidateHome = await beamOrder(normalStops, routeStart, 'home', 'mario', base);
      const routeCost = sequence => {
        let current = routeStart, cost = 0;
        for (const stop of sequence) {
          cost += km(current, stop.point);
          current = stop.point || current;
        }
        return cost;
      };
      const costCentral = routeCost(candidateCentral);
      const costHome = routeCost(candidateHome);
      // A két, felhasználó által meghatározott forgatókönyv közül választ.
      const normalOrder = costCentral <= costHome * 1.10 ? candidateCentral : candidateHome;
      return [...orderedFull, ...normalOrder];
    }

    return [...orderedFull, ...await beamOrder(normalStops, routeStart || base, 'normal', driver)];
  }

  function bubbleGroups(orders) {
    if (global.V33Planner?.orderedBubbleGroups) return global.V33Planner.orderedBubbleGroups(orders);
    return [...groupBy(orders, bubbleKey).entries()].map(([key, group]) => ({
      key, orders: group, pickupKey: supplierKey(group[0]), sequence: Math.min(...group.map(order => +order.sequence || 999)),
      pinned: group.some(order => order.routePinned), pinnedPosition: Math.min(...group.map(order => +order.pinnedPosition || 9999)),
      fullLoad: group.some(isFullLoadOrder)
    })).sort((a, b) => a.sequence - b.sequence);
  }

  function applyPinnedPositions(groups, vehicleId) {
    const slots = new Array(groups.length).fill(null);
    const pinned = groups.filter(group => group.pinned && group.orders.some(order => !order.pinnedVehicleId || order.pinnedVehicleId === vehicleId));
    const free = groups.filter(group => !pinned.includes(group));
    const nearestEmpty = wanted => {
      for (let delta = 0; delta < slots.length; delta++) {
        const right = wanted + delta, left = wanted - delta;
        if (right < slots.length && !slots[right]) return right;
        if (left >= 0 && !slots[left]) return left;
      }
      return -1;
    };
    pinned.sort((a, b) => a.pinnedPosition - b.pinnedPosition).forEach(group => {
      const wanted = Math.max(0, Math.min(slots.length - 1, (Number.isFinite(group.pinnedPosition) ? group.pinnedPosition : group.sequence) - 1));
      const index = nearestEmpty(wanted);
      if (index >= 0) slots[index] = group;
    });
    let cursor = 0;
    for (let index = 0; index < slots.length; index++) if (!slots[index]) slots[index] = free[cursor++];
    return slots.filter(Boolean);
  }

  function orderBubblesByStops(orders, stopOrder, vehicleId) {
    const groups = bubbleGroups(orders);
    const supplierRank = new Map();
    stopOrder.forEach((stop, index) => {
      for (const order of stop.orders) {
        const key = isFullLoadOrder(order) ? `full||${bubbleKey(order)}` : `supplier||${supplierKey(order)}`;
        if (!supplierRank.has(key)) supplierRank.set(key, index);
      }
    });
    let desired = groups.slice().sort((a, b) => {
      const aOrder = a.orders[0];
      const bOrder = b.orders[0];
      const ak = isFullLoadOrder(aOrder) ? `full||${bubbleKey(aOrder)}` : `supplier||${supplierKey(aOrder)}`;
      const bk = isFullLoadOrder(bOrder) ? `full||${bubbleKey(bOrder)}` : `supplier||${supplierKey(bOrder)}`;
      return (supplierRank.get(ak) ?? 999) - (supplierRank.get(bk) ?? 999)
        || a.sequence - b.sequence
        || a.key.localeCompare(b.key, 'hu');
    });
    desired = applyPinnedPositions(desired, vehicleId);
    let sequence = 1;
    desired.forEach((group, index) => group.orders.forEach(order => {
      order.vehicleId = vehicleId;
      order.sequence = sequence++;
      if (order.routePinned) {
        order.pinnedPosition = index + 1;
        order.pinnedVehicleId = vehicleId;
      }
    }));
    return desired;
  }

  async function v35BuildRoutePlan(vehicleId, suppliedProfiles = null) {
    const vehicle = state.vehicles.find(item => item.id === vehicleId);
    const orders = dayOrders(vehicleId).slice();
    state.routePlans = state.routePlans || {};
    state.routePlans[selectedDate()] = state.routePlans[selectedDate()] || {};
    if (!orders.length) {
      state.routePlans[selectedDate()][vehicleId] = [];
      return [];
    }
    const profiles = suppliedProfiles || await profileOrders(orders);
    if (!profiles.__base && typeof geo === 'function') profiles.__base = await geo(state.settings?.baseAddress || '');
    const stops = await planPickupStops(vehicle, orders, profiles);
    orderBubblesByStops(orders, stops, vehicleId);

    const events = [];
    for (const stop of stops) {
      events.push({
        type: 'pickup', key: stop.key, name: stop.name, address: stop.address,
        orders: stop.orders.map(order => order.id), point: stop.point
      });
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

  async function v35DistributeCurrentDay() {
    const orders = state.orders.filter(order => order.scheduleDate === selectedDate());
    if (!orders.length) throw new Error('Nincs szétosztható fuvar az adott napon.');
    const result = await distributeOrderSet(orders);
    state.routePlans[selectedDate()] = {};
    state.routeStats[selectedDate()] = {};
    for (const vehicle of activeVehicles()) state.routePlans[selectedDate()][vehicle.id] = [];
    return result;
  }

  async function v35PreassignImportedOrders(orders) {
    const results = [];
    for (const dateOrders of groupBy(orders, order => order.scheduleDate || 'datum-nelkul').values()) {
      results.push(await distributeOrderSet(dateOrders));
    }
    return results;
  }

  async function v35FinalizeImport() {
    try {
      if (!Array.isArray(importOrders) || !importOrders.length) return;
      await v35PreassignImportedOrders(importOrders);
      state.orders.push(...importOrders);
      const summary = activeVehicles().map(vehicle => {
        const list = importOrders.filter(order => order.vehicleId === vehicle.id);
        const stops = new Set(list.map(order => isCentralOrder(order) ? `central||${projectKey(order)}` : supplierKey(order)));
        return `${vehicle.driverName}: ${stops.size} felrakó / ${list.length} rendelés`;
      }).join(', ');
      const fixedCount = importOrders.filter(order => order.importVehicleLocked).length;
      const boxCount = importOrders.filter(order => categoryForOrder(order) === 'dobozos').length;
      importOrders = [];
      document.querySelector('#importDialog')?.close();
      save();
      alert(`Import beillesztve. Névre rögzített: ${fixedCount}, Dobozos: ${boxCount}. ${summary}`);
    } catch (error) {
      console.error('[V35] Import besorolási hiba', error);
      alert(`Az import besorolása közben hiba történt: ${error?.message || error}`);
    }
  }

  function v35SaveReview() {
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
      v35FinalizeImport();
    } else showReview();
  }

  async function v35BalanceAction() {
    try {
      const result = await v35DistributeCurrentDay();
      save();
      const summary = activeVehicles().map(vehicle => {
        const list = dayOrders(vehicle.id);
        const externalStops = new Set(list.filter(order => !isCentralOrder(order)).map(supplierKey));
        const centralBlocks = new Set(list.filter(isCentralOrder).map(projectKey));
        const fixed = list.filter(order => order.importVehicleLocked).length;
        return `${vehicle.driverName}: ${externalStops.size + (centralBlocks.size ? 1 : 0)} felrakó / ${list.length} rendelés (${fixed} névre)`;
      }).join(', ');
      alert(`Fuvarok szétosztva felrakóhely-terhelés alapján. ${summary}\nAz optimalizálás csak a felrakók sorrendjét rendezi; normál lerakókat nem használ.`);
      return result;
    } catch (error) {
      console.error('[V35] Szétosztási hiba', error);
      alert(`A fuvarok szétosztása közben hiba történt: ${error?.message || error}`);
      return null;
    }
  }

  async function v35OptimizeAction() {
    try {
      const before = new Map(state.orders.filter(order => order.scheduleDate === selectedDate()).map(order => [order.id, order.vehicleId]));
      for (const vehicle of activeVehicles()) await v35BuildRoutePlan(vehicle.id);
      const changed = state.orders.filter(order => order.scheduleDate === selectedDate() && before.get(order.id) !== order.vehicleId);
      if (changed.length) throw new Error('Az optimalizálás sofőrt változtatott, ezért a művelet vissza lett utasítva.');
      save();
      alert('Felrakási sorrend optimalizálva. A normál lerakók nem befolyásolták az útvonalat; teljes autós rakománynál az azonnali lerakás megmaradt.');
      return true;
    } catch (error) {
      console.error('[V35] Optimalizálási hiba', error);
      alert(`Az optimalizálás közben hiba történt: ${error?.message || error}`);
      return false;
    }
  }

  function bindV35() {
    if (typeof document === 'undefined') return;
    const balanceButton = document.getElementById('balanceBtn');
    const optimizeButton = document.getElementById('optimizeBtn');
    if (balanceButton) {
      balanceButton.onclick = event => { event.preventDefault(); return v35BalanceAction(); };
      balanceButton.dataset.algorithmVersion = VERSION;
      balanceButton.title = '1. lépés: fix névre jelölések + Dobozos felrakóblokkok igazságos szétosztása';
    }
    if (optimizeButton) {
      optimizeButton.onclick = event => { event.preventDefault(); return v35OptimizeAction(); };
      optimizeButton.dataset.algorithmVersion = VERSION;
      optimizeButton.title = '2. lépés: kizárólag a felrakók sorrendjének optimalizálása';
    }
    const help = document.querySelector('#importDialog .help');
    if (help) help.textContent = 'Az Autó oszlopban Patrik, Márió, Martin vagy Dobozos szerepelhet. A névre jelölt fuvar fix. A Dobozos fuvarokat egész felrakóblokkokban osztja szét; a rendelésdarabszám helyett elsősorban a felrakóhelyek terhelése számít.';
    global.FUVARSZERVEZO_VERSION = VERSION;
    global.getFuvarszervezoDiagnostics = () => ({
      version: VERSION,
      balanceHandler: balanceButton?.dataset.algorithmVersion || null,
      optimizeHandler: optimizeButton?.dataset.algorithmVersion || null,
      assignmentUnit: 'külső felrakóhely; központi raktár projektenként osztható',
      optimization: 'csak felrakók; normál lerakók nélkül',
      fullLoad: 'felrakó -> azonnali lerakó',
      learnedHistoryDays: 11
    });
  }

  // A SERPA-importban a tételeket szélesebb hosszúanyag-felismerés vizsgálja.
  if (typeof longReason !== 'undefined') longReason = v35LongReason;
  if (typeof finalizeImport !== 'undefined') finalizeImport = v35FinalizeImport;
  if (typeof saveReview !== 'undefined') saveReview = v35SaveReview;
  if (typeof balance !== 'undefined') balance = v35BalanceAction;
  if (typeof optimizeAll !== 'undefined') optimizeAll = v35OptimizeAction;

  global.V35Planner = {
    version: VERSION,
    v35LongReason,
    physicalLoad,
    categoryForOrder,
    distributionUnitKey,
    workloadForOrders,
    distributeOrderSet,
    canonicalStop,
    historicalPreference,
    modeRank,
    planPickupStops,
    v35BuildRoutePlan,
    v35DistributeCurrentDay,
    v35PreassignImportedOrders,
    v35BalanceAction,
    v35OptimizeAction
  };

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bindV35, { once: true });
    else bindV35();
  }
})(typeof window !== 'undefined' ? window : globalThis);
