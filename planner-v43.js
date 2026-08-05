/* Fuvarszervező V43
   - névre rögzített fuvarokat automatikusan soha nem mozgat
   - Márió: Pest, Patrik: Buda, Martin: platós + igazságos besegítés
   - Márió Vác felől, Martin Felcsút felől, Patrik a központi raktárból indul
   - szerepkör-alapú törzsadat-szinkron és címfigyelmeztetés
   - a friss törzsadatokat a meglévő böngészős adatokkal összevonja
*/
(function (global) {
  'use strict';

  const VERSION = '43';
  const CENTRAL_ADDRESS = '2310 Szigetszentmiklós, Kereskedő utca 2.';
  const HOME_FALLBACKS = {
    mario: { address: 'Vác, Magyarország', point: [47.7759, 19.1360] },
    martin: { address: 'Felcsút, Magyarország', point: [47.4550, 18.5860] },
    patrik: { address: CENTRAL_ADDRESS, point: [47.3434, 19.0437] }
  };
  const SPECIAL_SUPPLIER_LOCATIONS = [
    { name: 'Szatmári Kft', site: 'Késmárk', address: '1158 Budapest, Késmárk utca 9.', pickupNote: 'Késmárk utcai felrakóhely' },
    { name: 'Szatmári Kft. – Késmárk', site: 'Késmárk', address: '1158 Budapest, Késmárk utca 9.', pickupNote: 'Késmárk utcai felrakóhely' },
    { name: 'Merkapt Zrt.', site: 'Maglódi', address: '1106 Budapest, Maglódi út 14/B', pickupNote: 'Maglódi úti felrakóhely' },
    { name: 'Sebők és Társa Kft', site: 'Törökbálint', address: '2045 Törökbálint, Kinizsi utca 28.', pickupNote: 'Törökbálinti felrakóhely' },
    { name: 'Szerelvénybolt Kft.', site: 'Üllői út', address: '1182 Budapest, Üllői út 807/B', pickupNote: '' }
  ];

  const nrm = value => {
    if (typeof norm === 'function') return norm(value || '');
    return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[_.,;:()[\]{}\/\\-]+/g, ' ').replace(/\s+/g, ' ').trim();
  };
  const escHtml = value => typeof esc === 'function' ? esc(value || '') : String(value || '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const finitePoint = point => Array.isArray(point) && point.length === 2 && Number.isFinite(+point[0]) && Number.isFinite(+point[1]);
  const distanceKm = (a, b) => {
    if (!finitePoint(a) || !finitePoint(b)) return 40;
    if (typeof dist === 'function') return dist(a, b);
    const rad = value => value * Math.PI / 180, R = 6371;
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
    const text = nrm(vehicle?.driverName || '');
    if (text.includes('mario')) return 'mario';
    if (text.includes('patrik')) return 'patrik';
    if (text.includes('martin')) return 'martin';
    return 'other';
  };
  const findDriver = (key, drivers) => drivers.find(vehicle => driverKey(vehicle) === key) || null;
  const supplierKey = order => nrm(order?.pickupAddress || order?.pickupName || 'ismeretlen felrako');
  const projectKey = order => nrm(order?.dropAddress || order?.projectName || 'ismeretlen lerako');
  const centralOrder = order => /(\bkrpr\b|k[oö]zponti\s*rakt[aá]r|szigetszentmikl[oó]s|keresked[oő]\s*utca)/i.test(`${order?.pickupName || ''} ${order?.pickupAddress || ''}`);
  const categoryForOrder = order => global.V35Planner?.categoryForOrder ? global.V35Planner.categoryForOrder(order) : (nrm(order?.importVehicleCategory || '') || 'dobozos');
  const distributionKey = order => global.V35Planner?.distributionUnitKey ? global.V35Planner.distributionUnitKey(order) : `${supplierKey(order)}||${categoryForOrder(order)}`;
  const physicalBurden = order => global.V35Planner?.physicalLoad ? global.V35Planner.physicalLoad(order) : ({ long: order?.longMaterialReason ? 1 : 0, bulky: 0, full: 0 });

  function meaningfulTokens(value = '') {
    const noise = new Set(['kft', 'zrt', 'bt', 'nyrt', 'magyarorszag', 'budapest', 'projekt', 'raktar', 'telephely', 'utca', 'ut', 'ter', 'koz', 'ii', 'utem']);
    return nrm(value).split(' ').filter(token => token.length >= 3 && !noise.has(token));
  }

  function looseNameScore(masterName, wantedName) {
    const a = meaningfulTokens(masterName), b = meaningfulTokens(wantedName);
    if (!a.length || !b.length) return 0;
    const overlap = a.filter(token => b.includes(token)).length;
    let score = overlap * 12;
    if (nrm(masterName) === nrm(wantedName)) score += 100;
    if (a.every(token => b.includes(token)) || b.every(token => a.includes(token))) score += 28;
    return score;
  }

  function mergeSeedMasterData() {
    if (typeof state === 'undefined') return false;
    state.projects = state.projects || [];
    state.suppliers = state.suppliers || [];
    state.recipients = state.recipients || [];
    state.aliases = state.aliases || { projects: {}, suppliers: {} };
    let changed = false;

    const seedProjects = global.SEED_DATA?.projects || (typeof SEED_DATA !== 'undefined' ? SEED_DATA.projects || [] : []);
    seedProjects.forEach((seed, index) => {
      const seedId = seed.id || `v43-p-${index}`;
      const exact = state.projects.find(item => item.id === seedId) || state.projects.find(item => nrm(item.name) === nrm(seed.name));
      if (!exact) {
        state.projects.push({ ...seed, id: seedId, defaultRecipientId: seed.defaultRecipientId || '', active: seed.active !== false });
        changed = true;
      } else if (!String(exact.address || '').trim() && String(seed.address || '').trim() && !exact.manualOverride && !exact.manualEditedAt) {
        exact.address = seed.address;
        changed = true;
      }
    });

    const seedSuppliers = global.SEED_DATA?.suppliers || (typeof SEED_DATA !== 'undefined' ? SEED_DATA.suppliers || [] : []);
    seedSuppliers.forEach((seed, index) => {
      const seedId = seed.id || `v43-s-${index}`;
      const same = state.suppliers.find(item => item.id === seedId) || state.suppliers.find(item => nrm(item.name) === nrm(seed.name) && nrm(item.address) === nrm(seed.address));
      if (!same) {
        state.suppliers.push({ ...seed, id: seedId, pickupNote: seed.pickupNote || seed.note || '', isCentral: !!seed.isCentral, active: seed.active !== false });
        changed = true;
      }
    });

    SPECIAL_SUPPLIER_LOCATIONS.forEach((special, index) => {
      const specialId = `v43-special-${index}`;
      let record = state.suppliers.find(item => item.id === specialId) || state.suppliers.find(item => nrm(item.name) === nrm(special.name) && nrm(item.address) === nrm(special.address));
      if (!record) {
        record = { id: specialId, ...special, active: true, manualOverride: false, v43Seeded: true };
        state.suppliers.push(record);
        changed = true;
      } else {
        if (!record.site && special.site) { record.site = special.site; changed = true; }
        if (!record.pickupNote && special.pickupNote) { record.pickupNote = special.pickupNote; changed = true; }
      }
    });

    const centralProject = state.projects.find(item => nrm(item.name) === nrm('Központi raktár'));
    if (centralProject && !centralProject.manualOverride && nrm(centralProject.address) !== nrm(CENTRAL_ADDRESS)) {
      centralProject.address = CENTRAL_ADDRESS;
      changed = true;
    }
    state.settings = state.settings || {};
    if (!state.settings.baseAddress || /keresked[oő]\s*utca(?:\s*$|\s*2\.?\s*$)/i.test(state.settings.baseAddress)) state.settings.baseAddress = CENTRAL_ADDRESS;

    for (const vehicle of state.vehicles || []) {
      const key = driverKey(vehicle);
      if (key === 'mario' && !String(vehicle.homeAddress || vehicle.homeCity || '').trim()) { vehicle.homeAddress = HOME_FALLBACKS.mario.address; vehicle.homeCity = HOME_FALLBACKS.mario.address; changed = true; }
      if (key === 'martin' && !String(vehicle.homeAddress || vehicle.homeCity || '').trim()) { vehicle.homeAddress = HOME_FALLBACKS.martin.address; vehicle.homeCity = HOME_FALLBACKS.martin.address; changed = true; }
    }

    state.masterDataVersion = 'v43-20260804';
    if (changed) {
      state.routePlans = {};
      state.routeStats = {};
      if (typeof KEY !== 'undefined' && typeof localStorage !== 'undefined') localStorage.setItem(KEY, JSON.stringify(state));
    }
    return changed;
  }

  function findProjectMaster({ id = '', name = '', address = '' } = {}) {
    const projects = state.projects || [];
    let project = id ? projects.find(item => item.id === id) : null;
    if (!project && address) project = projects.find(item => nrm(item.address) === nrm(address));
    if (!project && name) {
      project = projects.filter(item => nrm(item.name) === nrm(name)).sort((a, b) => Number(Boolean(b.address)) - Number(Boolean(a.address)))[0];
    }
    if (!project && name) {
      project = projects.map(item => ({ item, score: looseNameScore(item.name, name) + (item.address ? 3 : 0) }))
        .sort((a, b) => b.score - a.score)[0];
      if (!project || project.score < 20) return null;
      project = project.item;
    }
    return project || null;
  }

  function findSupplierMaster({ id = '', name = '', address = '' } = {}) {
    const suppliers = state.suppliers || [];
    let supplier = id ? suppliers.find(item => item.id === id) : null;
    if (!supplier && address) supplier = suppliers.find(item => nrm(item.address) === nrm(address));
    if (!supplier && name) {
      const sameName = suppliers.filter(item => nrm(item.name) === nrm(name));
      if (sameName.length) {
        const hint = nrm(`${name} ${address}`);
        supplier = sameName.find(item => hint.includes(nrm(item.site || '')) && item.site) || sameName.find(item => item.address) || sameName[0];
      }
    }
    if (!supplier && name) {
      const ranked = suppliers.map(item => ({ item, score: looseNameScore(item.name, name) + (address && nrm(item.address) === nrm(address) ? 100 : 0) }))
        .sort((a, b) => b.score - a.score);
      if (ranked[0]?.score >= 20) supplier = ranked[0].item;
    }
    return supplier || null;
  }

  function findWarehouseMaster({ id = '', name = '', address = '' } = {}) {
    if (/k[oö]zponti\s*rakt[aá]r|szigetszentmikl[oó]s|\bkrpr\b/i.test(`${name} ${address}`)) return { id: '', name: 'Szigetszentmiklósi Központi Raktár', address: CENTRAL_ADDRESS };
    return findProjectMaster({ id, name, address }) || findSupplierMaster({ id, name, address });
  }

  function syncOrderFromMastersV43(order, { forceSupplier = false, forceProject = false } = {}) {
    if (!order) return { supplier: false, project: false, pickup: false, drop: false };
    const pickupRole = order.pickupRole || (order.isReturn ? 'project' : 'supplier');
    const dropRole = order.dropRole || (order.isReturn ? 'supplier' : 'project');
    let pickupMaster = null, dropMaster = null;

    if (pickupRole === 'project') pickupMaster = findProjectMaster({ id: order.returnSourceProjectId || order.projectId, name: order.pickupName, address: order.pickupAddress });
    else if (pickupRole === 'warehouse') pickupMaster = findWarehouseMaster({ id: order.supplierId || order.projectId, name: order.pickupName, address: order.pickupAddress });
    else pickupMaster = findSupplierMaster({ id: order.supplierId, name: order.pickupName, address: order.pickupAddress });

    if (dropRole === 'supplier') dropMaster = findSupplierMaster({ id: order.returnDestinationSupplierId || order.supplierId, name: order.projectName, address: order.dropAddress });
    else if (dropRole === 'warehouse') dropMaster = findWarehouseMaster({ id: order.projectId || order.supplierId, name: order.projectName, address: order.dropAddress });
    else dropMaster = findProjectMaster({ id: order.projectId, name: order.projectName || order.topicName, address: order.dropAddress });

    if (pickupMaster) {
      if (pickupRole === 'supplier') order.supplierId = pickupMaster.id || order.supplierId || '';
      if (pickupRole === 'project') order.returnSourceProjectId = pickupMaster.id || order.returnSourceProjectId || '';
      if ((forceSupplier || !order.pickupAddress) && pickupMaster.address && !order.manualPickupAddress) order.pickupAddress = pickupMaster.address;
      if (!order.pickupName && pickupMaster.name) order.pickupName = pickupMaster.name;
      if (pickupRole === 'supplier' && !order.pickupNote) order.pickupNote = pickupMaster.pickupNote || pickupMaster.note || '';
    } else if (pickupRole === 'warehouse' && /\bkrpr\b/i.test(String(order.orderType || ''))) {
      order.pickupName = order.pickupName || 'Szigetszentmiklósi Központi Raktár';
      order.pickupAddress = CENTRAL_ADDRESS;
    }

    if (dropMaster) {
      if (dropRole === 'project') order.projectId = dropMaster.id || order.projectId || '';
      if (dropRole === 'supplier') order.returnDestinationSupplierId = dropMaster.id || order.returnDestinationSupplierId || '';
      if ((forceProject || !order.dropAddress) && dropMaster.address && !order.manualDropAddress) order.dropAddress = dropMaster.address;
      if (!order.projectName && dropMaster.name) order.projectName = dropMaster.name;
    }

    order.missingSupplierMaster = (pickupRole === 'supplier' && !order.pickupAddress) || (dropRole === 'supplier' && !order.dropAddress);
    order.missingProjectMaster = (pickupRole === 'project' && !order.pickupAddress) || (dropRole === 'project' && !order.dropAddress);
    order.missingPickupMaster = !String(order.pickupAddress || '').trim();
    order.missingDropMaster = !String(order.dropAddress || '').trim();
    return { supplier: !order.missingSupplierMaster, project: !order.missingProjectMaster, pickup: !order.missingPickupMaster, drop: !order.missingDropMaster };
  }

  async function resyncAllMasterDataV43(showMessage = true) {
    mergeSeedMasterData();
    let pickupMissing = 0, dropMissing = 0, changed = 0;
    for (const order of state.orders || []) {
      const before = [order.supplierId, order.pickupAddress, order.projectId, order.dropAddress].join('|');
      const result = syncOrderFromMastersV43(order, { forceSupplier: true, forceProject: true });
      if (!result.pickup) pickupMissing++;
      if (!result.drop) dropMissing++;
      const after = [order.supplierId, order.pickupAddress, order.projectId, order.dropAddress].join('|');
      if (before !== after) changed++;
    }
    state.geo = {};
    state.routePlans = {};
    state.routeStats = {};
    if (typeof save === 'function') save(false);
    if (typeof render === 'function') render();
    if (showMessage) alert(`Újraszinkronizálás kész. Frissített fuvarok: ${changed}. Hiányzó felrakócím: ${pickupMissing}. Hiányzó lerakócím: ${dropMissing}.`);
    return { changed, pickupMissing, dropMissing };
  }

  function masterWarningsV43(order) {
    const warnings = [];
    const pickupRole = order?.pickupRole || (order?.isReturn ? 'project' : 'supplier');
    const dropRole = order?.dropRole || (order?.isReturn ? 'supplier' : 'project');
    if (!String(order?.pickupAddress || '').trim()) {
      const label = pickupRole === 'project' ? 'projekt felrakási címe' : pickupRole === 'warehouse' ? 'forrásraktár címe' : 'beszállítói cím';
      warnings.push(`<div class="master-warning">⚠ Hiányzó ${label} – állítsd be manuálisan.</div>`);
    }
    if (!String(order?.dropAddress || '').trim()) {
      const label = dropRole === 'supplier' ? 'visszáru-lerakó címe' : dropRole === 'warehouse' ? 'célraktár címe' : 'projektcím';
      warnings.push(`<div class="master-warning">⚠ Hiányzó ${label} – állítsd be manuálisan.</div>`);
    }
    return warnings.join('');
  }

  const previousVehicleHome = typeof vehicleHome === 'function' ? vehicleHome : global.vehicleHome;
  async function vehicleHomeV43(vehicle) {
    const key = driverKey(vehicle);
    if (key === 'patrik') {
      if (typeof geo === 'function') return await geo(state.settings?.baseAddress || CENTRAL_ADDRESS) || HOME_FALLBACKS.patrik.point;
      return HOME_FALLBACKS.patrik.point;
    }
    let address = vehicle?.homeAddress || vehicle?.homeCity || '';
    if (key === 'mario' && (!address || /kispest|kozponti\s*raktar|szigetszentmiklos/i.test(nrm(address)))) address = HOME_FALLBACKS.mario.address;
    if (key === 'martin' && (!address || /kozponti\s*raktar|szigetszentmiklos/i.test(nrm(address)))) address = HOME_FALLBACKS.martin.address;
    if (typeof geo === 'function') {
      const point = await geo(address);
      if (point) return point;
    }
    if (key === 'mario') return HOME_FALLBACKS.mario.point;
    if (key === 'martin') return HOME_FALLBACKS.martin.point;
    if (typeof previousVehicleHome === 'function') return await previousVehicleHome(vehicle);
    return HOME_FALLBACKS.patrik.point;
  }

  function isNamedCategory(category) { return ['mario', 'patrik', 'martin'].includes(category); }
  function fixedVehicleForGroup(group, drivers) {
    const currentLocked = group.find(order => (order.importVehicleLocked || order.manualVehicleLocked || order.routePinned) && (order.pinnedVehicleId || order.vehicleId));
    if (currentLocked) return drivers.find(vehicle => vehicle.id === (currentLocked.pinnedVehicleId || currentLocked.vehicleId)) || null;
    const fixedCategory = group.map(categoryForOrder).find(category => String(category).startsWith('fixed:'));
    if (fixedCategory) return drivers.find(vehicle => vehicle.id === fixedCategory.slice(6)) || null;
    const named = group.map(categoryForOrder).find(isNamedCategory);
    return named ? findDriver(named, drivers) : null;
  }

  function groupPoint(group, profiles) {
    for (const order of group) {
      const point = profiles?.[order.id]?.pickup;
      if (finitePoint(point)) return point;
    }
    return null;
  }

  function pickupSide(group, profiles) {
    const order = group[0] || {};
    if (centralOrder(order)) return 'central';
    const text = nrm(`${order.pickupName || ''} ${order.pickupAddress || ''}`);
    if (/felcsut|bicske|alcsut|csakvar|vertesacsa/.test(text)) return 'martin-corridor';
    if (/budaors|torokbalint|biatorbagy|erd|budakeszi|solymar|pilisborosjeno|hengermalom|hunyadi janos|budafok|nagyteteny|obuda|szentendrei|\b1(?:0[123]|1[12]|2[12]|22)\d\d\b/.test(text)) return 'buda';
    if (/vac|dunakeszi|kistarcsa|rakospalota|kesmark|maglodi|gyomroi|kada|ullo|vecses|gyal|kispest|csepel|soroksar|kobanya|pesti|\b1(?:0[456789]|1[3456789]|2[013])\d\d\b/.test(text)) return 'pest';
    const point = groupPoint(group, profiles);
    if (finitePoint(point) && point[0] >= 47.30 && point[0] <= 47.70 && point[1] >= 18.75 && point[1] <= 19.35) return point[1] < 19.045 ? 'buda' : 'pest';
    return 'neutral';
  }

  function uniqueStopCount(orders) {
    const keys = new Set();
    for (const order of orders || []) keys.add(centralOrder(order) ? 'central' : supplierKey(order));
    return keys.size;
  }

  function workload(orders) {
    const stopCount = uniqueStopCount(orders);
    let special = 0;
    for (const order of orders || []) {
      const load = physicalBurden(order);
      special += (load.long || 0) * 0.38 + (load.bulky || 0) * 0.12 + (load.full || 0) * 1.3;
    }
    return stopCount + special;
  }

  function groupMovable(group) {
    return group.every(order => {
      const category = categoryForOrder(order);
      return category === 'dobozos' && !order.importVehicleLocked && !order.manualVehicleLocked && !order.routePinned && !order.longMaterialReason;
    });
  }

  function setGroup(group, vehicle, assigned) {
    if (!vehicle) return;
    for (const order of group) {
      order.vehicleId = vehicle.id;
      assigned[vehicle.id].push(order);
    }
  }

  function moveGroup(group, source, target, assigned) {
    const ids = new Set(group.map(order => order.id));
    assigned[source.id] = assigned[source.id].filter(order => !ids.has(order.id));
    assigned[target.id].push(...group);
    group.forEach(order => { order.vehicleId = target.id; });
  }

  function spreadByStops(drivers, assigned) {
    const values = drivers.map(vehicle => uniqueStopCount(assigned[vehicle.id]));
    return Math.max(...values) - Math.min(...values);
  }

  function assignmentSummary(drivers, assigned) {
    return drivers.map(vehicle => `${vehicle.driverName}: ${uniqueStopCount(assigned[vehicle.id])} cím / ${assigned[vehicle.id].length} rendelés`).join(', ');
  }

  async function buildProfiles(orders) {
    const profiles = {};
    for (const order of orders) {
      syncOrderFromMastersV43(order);
      profiles[order.id] = typeof orderGeoProfile === 'function' ? await orderGeoProfile(order) : { pickup: typeof geo === 'function' ? await geo(order.pickupAddress) : null, drop: null };
    }
    profiles.__base = typeof geo === 'function' ? await geo(state.settings?.baseAddress || CENTRAL_ADDRESS) : HOME_FALLBACKS.patrik.point;
    return profiles;
  }

  function routeFit(vehicle, group, profiles, homes) {
    const point = groupPoint(group, profiles);
    if (!finitePoint(point)) return 25;
    const key = driverKey(vehicle);
    const start = key === 'patrik' ? profiles.__base : homes[vehicle.id];
    let score = distanceKm(start, point);
    const side = pickupSide(group, profiles);
    if (key === 'mario' && side === 'buda') score += 500;
    if (key === 'patrik' && side === 'pest') score += 500;
    if (key === 'martin' && side === 'martin-corridor') score -= 15;
    if (key === 'martin' && side === 'buda') score -= 4;
    if (key === 'martin' && side === 'pest') score += 3;
    return score;
  }

  async function distributeOrderSetV43(orders, options = {}) {
    mergeSeedMasterData();
    const drivers = (options.drivers || (typeof activeVehicles === 'function' ? activeVehicles() : [])).slice();
    if (!drivers.length) throw new Error('Nincs aktív jármű.');
    const mario = findDriver('mario', drivers), patrik = findDriver('patrik', drivers), martin = findDriver('martin', drivers);
    const profiles = options.profiles || await buildProfiles(orders);
    const homes = {};
    for (const vehicle of drivers) homes[vehicle.id] = await vehicleHomeV43(vehicle);
    const assigned = Object.fromEntries(drivers.map(vehicle => [vehicle.id, []]));
    const groups = [...groupBy(orders, distributionKey).values()];
    const movable = [];

    for (const group of groups) {
      const fixed = fixedVehicleForGroup(group, drivers);
      if (fixed) { setGroup(group, fixed, assigned); continue; }
      const hasLong = group.some(order => order.longMaterialReason || physicalBurden(order).long > 0 || categoryForOrder(order) === 'martin');
      if (hasLong && martin) { setGroup(group, martin, assigned); continue; }
      movable.push(group);
    }

    const bySide = { buda: [], pest: [], central: [], neutral: [], 'martin-corridor': [] };
    movable.forEach(group => bySide[pickupSide(group, profiles)]?.push(group) || bySide.neutral.push(group));
    bySide.buda.forEach(group => setGroup(group, patrik || martin || mario || drivers[0], assigned));
    bySide.pest.forEach(group => setGroup(group, mario || martin || patrik || drivers[0], assigned));
    bySide['martin-corridor'].forEach(group => setGroup(group, martin || patrik || mario || drivers[0], assigned));

    const flexible = [...bySide.central, ...bySide.neutral].sort((a, b) => b.length - a.length);
    for (const group of flexible) {
      const ranked = drivers.map(vehicle => {
        const simulated = { ...assigned, [vehicle.id]: [...assigned[vehicle.id], ...group] };
        const loads = drivers.map(item => workload(simulated[item.id]));
        const mean = loads.reduce((sum, value) => sum + value, 0) / loads.length;
        const fairness = loads.reduce((sum, value) => sum + (value - mean) ** 2, 0);
        return { vehicle, score: fairness * 14 + routeFit(vehicle, group, profiles, homes) * 0.18 };
      }).sort((a, b) => a.score - b.score);
      setGroup(group, ranked[0].vehicle, assigned);
    }

    // Martin igazságos besegítése. Csak Dobozos, nem rögzített blokkok mozdulhatnak.
    if (martin) {
      for (let guard = 0; guard < 100; guard++) {
        const sorted = drivers.slice().sort((a, b) => uniqueStopCount(assigned[a.id]) - uniqueStopCount(assigned[b.id]));
        const low = sorted[0], high = sorted[sorted.length - 1];
        if (low.id !== martin.id || uniqueStopCount(assigned[high.id]) - uniqueStopCount(assigned[martin.id]) <= 2) break;
        const currentSpread = spreadByStops(drivers, assigned);
        const sourceGroups = [...groupBy(assigned[high.id], distributionKey).values()].filter(groupMovable);
        const candidates = sourceGroups.map(group => {
          const ids = new Set(group.map(order => order.id));
          const simulated = Object.fromEntries(drivers.map(vehicle => [vehicle.id, assigned[vehicle.id].slice()]));
          simulated[high.id] = simulated[high.id].filter(order => !ids.has(order.id));
          simulated[martin.id].push(...group);
          const spread = spreadByStops(drivers, simulated);
          const side = pickupSide(group, profiles);
          const route = routeFit(martin, group, profiles, homes);
          const territory = side === 'martin-corridor' ? -8 : side === 'buda' ? -3 : side === 'pest' ? 2 : 0;
          return { group, spread, score: spread * 100 + route * 0.35 + territory, improvement: currentSpread - spread };
        }).filter(item => item.improvement > 0).sort((a, b) => a.score - b.score);
        if (!candidates.length) break;
        moveGroup(candidates[0].group, high, martin, assigned);
      }
    }

    // Semleges blokkokkal Márió és Patrik között is javítunk, de Buda soha nem kerül Márióhoz,
    // Pest pedig soha nem kerül Patrikhoz.
    for (let guard = 0; guard < 50; guard++) {
      const sorted = drivers.slice().sort((a, b) => uniqueStopCount(assigned[a.id]) - uniqueStopCount(assigned[b.id]));
      const low = sorted[0], high = sorted[sorted.length - 1];
      if (uniqueStopCount(assigned[high.id]) - uniqueStopCount(assigned[low.id]) <= 2) break;
      const currentSpread = spreadByStops(drivers, assigned);
      const candidateGroups = [...groupBy(assigned[high.id], distributionKey).values()].filter(group => {
        if (!groupMovable(group)) return false;
        const side = pickupSide(group, profiles), lowKey = driverKey(low);
        if (lowKey === 'mario' && side === 'buda') return false;
        if (lowKey === 'patrik' && side === 'pest') return false;
        return true;
      }).map(group => {
        const ids = new Set(group.map(order => order.id));
        const simulated = Object.fromEntries(drivers.map(vehicle => [vehicle.id, assigned[vehicle.id].slice()]));
        simulated[high.id] = simulated[high.id].filter(order => !ids.has(order.id));
        simulated[low.id].push(...group);
        const spread = spreadByStops(drivers, simulated);
        return { group, spread, score: spread * 100 + routeFit(low, group, profiles, homes) * 0.4, improvement: currentSpread - spread };
      }).filter(item => item.improvement > 0).sort((a, b) => a.score - b.score);
      if (!candidateGroups.length) break;
      moveGroup(candidateGroups[0].group, high, low, assigned);
    }

    for (const vehicle of drivers) {
      assigned[vehicle.id].sort((a, b) => supplierKey(a).localeCompare(supplierKey(b), 'hu') || projectKey(a).localeCompare(projectKey(b), 'hu'))
        .forEach((order, index) => { order.sequence = index + 1; });
    }
    return { assigned, profiles, homes, summary: assignmentSummary(drivers, assigned), stopCounts: Object.fromEntries(drivers.map(vehicle => [vehicle.id, uniqueStopCount(assigned[vehicle.id])])) };
  }

  async function balanceActionV43() {
    try {
      const orders = state.orders.filter(order => order.scheduleDate === selectedDate());
      if (!orders.length) throw new Error('Nincs szétosztható fuvar az adott napon.');
      const beforeFixed = new Map(orders.filter(order => fixedVehicleForGroup([order], activeVehicles())).map(order => [order.id, order.vehicleId]));
      const result = await distributeOrderSetV43(orders);
      const illegallyMoved = orders.filter(order => beforeFixed.has(order.id) && beforeFixed.get(order.id) && beforeFixed.get(order.id) !== order.vehicleId);
      if (illegallyMoved.length) {
        illegallyMoved.forEach(order => { order.vehicleId = beforeFixed.get(order.id); });
        throw new Error('Névre rögzített fuvar automatikus áthelyezését a rendszer megakadályozta.');
      }
      state.routePlans = state.routePlans || {};
      state.routePlans[selectedDate()] = {};
      state.routeStats = state.routeStats || {};
      state.routeStats[selectedDate()] = {};
      if (typeof save === 'function') save();
      alert(`Fuvarok szétosztva. ${result.summary}\nMárió: pesti oldal · Patrik: budai oldal · Martin: platós és igazságos besegítés. A névre rögzített fuvarok nem mozdultak.`);
      return result;
    } catch (error) {
      console.error('[V43] Szétosztási hiba', error);
      alert(`A fuvarok szétosztása közben hiba történt: ${error?.message || error}`);
      return null;
    }
  }

  function bindV43() {
    mergeSeedMasterData();
    for (const order of state.orders || []) syncOrderFromMastersV43(order);
    if (typeof save === 'function') save(false);
    const balanceButton = document.getElementById('balanceBtn');
    if (balanceButton) {
      balanceButton.onclick = event => { event.preventDefault(); return balanceActionV43(); };
      balanceButton.dataset.algorithmVersion = VERSION;
      balanceButton.title = 'V43: névre rögzített fuvarok változatlanok; Márió Pest, Patrik Buda, Martin igazságosan besegít';
    }
    const help = document.querySelector('#importDialog .help');
    if (help) help.textContent = 'Az Autó oszlopban Márió, Patrik vagy Martin névre rendelt fuvarokat a program soha nem mozgathatja át. Csak a Dobozos tételeket osztja: Márió a pesti, Patrik a budai oldalt kapja, Martin alulterhelésnél igazságosan besegít.';
    global.FUVARSZERVEZO_VERSION = VERSION;
    const previousDiagnostics = global.getFuvarszervezoDiagnostics;
    global.getFuvarszervezoDiagnostics = () => ({
      ...(typeof previousDiagnostics === 'function' ? previousDiagnostics() : {}),
      version: VERSION,
      balanceHandler: balanceButton?.dataset.algorithmVersion || VERSION,
      fixedDriverRule: 'Márió/Patrik/Martin névre rögzített fuvar csak kézzel mozgatható',
      territoryRule: 'Márió=Pest, Patrik=Buda, Martin=platós+kiegyenlítés',
      homeRule: 'Márió=Vác, Martin=Felcsút, Patrik=központi raktár',
      masterSync: 'szerepkör-alapú, meglévő cím megőrzésével'
    });
    if (typeof render === 'function') render();
  }

  if (typeof syncOrderFromMasters !== 'undefined') syncOrderFromMasters = syncOrderFromMastersV43;
  global.syncOrderFromMasters = syncOrderFromMastersV43;
  if (typeof resyncAllMasterData !== 'undefined') resyncAllMasterData = resyncAllMasterDataV43;
  global.resyncAllMasterData = resyncAllMasterDataV43;
  if (typeof masterWarnings !== 'undefined') masterWarnings = masterWarningsV43;
  global.masterWarnings = masterWarningsV43;
  if (typeof vehicleHome !== 'undefined') vehicleHome = vehicleHomeV43;
  global.vehicleHome = vehicleHomeV43;
  if (typeof balance !== 'undefined') balance = balanceActionV43;
  global.balance = balanceActionV43;

  global.V43Planner = {
    version: VERSION,
    mergeSeedMasterData,
    syncOrderFromMastersV43,
    resyncAllMasterDataV43,
    masterWarningsV43,
    vehicleHomeV43,
    fixedVehicleForGroup,
    pickupSide,
    uniqueStopCount,
    workload,
    distributeOrderSetV43,
    balanceActionV43,
    findProjectMaster,
    findSupplierMaster
  };

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bindV43, { once: true });
    else bindV43();
  }
})(typeof window !== 'undefined' ? window : globalThis);
