const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

function norm(s = '') { return String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[_.,;:()[\]{}\/\\-]+/g, ' ').replace(/\s+/g, ' ').trim() }

const GEO = {
  '2310 Szigetszentmiklós, Kereskedő utca 2.': [47.3434, 19.0437],
  'Vác, Magyarország': [47.7759, 19.136],
  'Felcsút, Magyarország': [47.455, 18.586],
  '1191 Budapest, Kispest': [47.4569, 19.14],
  '1158 Budapest, Késmárk utca 9.': [47.560, 19.130],   // Szatmári – Márió sávja (XV)
  '1106 Budapest, Maglódi út 14/B': [47.483, 19.145],   // Merkapt – Márió sávja (X)
  '1037 Budapest, Orbán Balázs út 10.': [47.567, 19.040], // Néber – Márió sávja (III)
  '1182 Budapest, Üllői út 807/B': [47.430, 19.190],    // Szerelvénybolt – Márió sávja (XVIII)
  '1202 Budapest, Jókai Mór utca 82.': [47.437, 19.113], // Szögker – Patrik sávja (XX)
  '1211 Budapest, II. Rákóczi Ferenc út 175/D': [47.427, 19.071], // Hungarokomplex – Patrik (XXI)
  '1117 Budapest, Hengermalom út 47/a': [47.462, 19.032], // Lambda – Patrik (XI)
  '1225 Budapest, Dűlő utca 31-35.': [47.412, 19.005],  // Gienger – Patrik (XXII)
  '2045 Törökbálint, Kinizsi Pál u. 28.': [47.431, 18.913], // Sebők – Patrik
  'Tatabánya, Obi': [47.569, 18.404],                    // nyugati folyosó – Martin
  '1133 Budapest, Hegedűs Gyula utca 53.': [47.521, 19.057] // lerakó
};

function createContext() {
  const ctx = { console, Math, Date, Set, Map, Array, Object, String, Number, Boolean, RegExp, JSON, Promise, Error, Infinity, NaN, Intl, fetch: undefined, document: undefined, window: undefined, globalThis: null };
  ctx.globalThis = ctx; ctx.norm = norm; ctx.confirm = () => true;
  ctx.localStorage = { setItem() {}, getItem() { return null } }; ctx.KEY = 'test';
  ctx.v29Km = (a, b) => { if (!a || !b) return 35; const dx = (a[0] - b[0]) * 111, dy = (a[1] - b[1]) * 75; return Math.sqrt(dx * dx + dy * dy) };
  ctx.dist = ctx.v29Km; ctx.canCarryLong = v => /plato|ponyv/.test(norm(v.type)); ctx.syncOrderFromMasters = () => {};
  ctx.state = { settings: { baseAddress: '2310 Szigetszentmiklós, Kereskedő utca 2.' }, vehicles: [], orders: [], backlog: [], resolvedBacklog: [], routePlans: {}, routeStats: {}, geo: {}, projects: [], suppliers: [], recipients: [], aliases: { projects: {}, suppliers: {} } };
  ctx.SEED_DATA = { projects: [], suppliers: [], recipients: [] };
  ctx.selectedDate = () => '2026-09-01';
  ctx.activeVehicles = () => ctx.state.vehicles.filter(v => v.active !== false);
  ctx.dayOrders = id => ctx.state.orders.filter(o => o.scheduleDate === ctx.selectedDate() && o.vehicleId === id);
  ctx.geo = async a => GEO[a] || null;
  ctx.vehicleHome = async v => v.homePoint || GEO['2310 Szigetszentmiklós, Kereskedő utca 2.'];
  ctx.orderGeoProfile = async o => ({ pickup: GEO[o.pickupAddress] || null, drop: GEO[o.dropAddress] || null });
  ctx.save = () => {}; ctx.alert = () => {}; ctx.render = () => {};
  vm.createContext(ctx);
  for (const f of ['planner-v32.js', 'planner-v33.js', 'planner-v34.js', 'planner-v35.js', 'planner-v37.js', 'planner-v44.js']) {
    vm.runInContext(fs.readFileSync(__dirname + '/' + f, 'utf8'), ctx, { filename: f });
  }
  return ctx;
}

const veh = (id, name) => ({ id, driverName: name, type: name === 'Martin' ? '3.5 T ponyvás autó' : '3.5 T dobozos autó', active: true });
const ord = (id, name, addr, project, drop, extra = {}) => ({
  id, scheduleDate: '2026-09-01', vehicleId: '', sequence: 999, orderNo: id,
  pickupName: name, pickupAddress: addr, projectName: project, dropAddress: drop,
  items: [{ _id: 'i' + id, name: 'anyag', qty: 1, unit: 'db', received: false }],
  importVehicleCategory: 'dobozos', ...extra
});
const DROP = '1133 Budapest, Hegedűs Gyula utca 53.';

function threeDrivers(c) { c.state.vehicles = [veh('m', 'Márió'), veh('p', 'Patrik'), veh('t', 'Martin')]; }
function whose(c, orderNo) {
  const o = c.state.orders.find(x => x.orderNo === orderNo);
  return c.state.vehicles.find(v => v.id === o.vehicleId)?.driverName || '-';
}

(async () => {
  let passed = 0, total = 0;
  async function test(name, fn) {
    total++;
    try { await fn(); console.log('OK', name); passed++; }
    catch (e) { console.error('HIBA', name, e.message); process.exitCode = 1; }
  }

  await test('A szétosztómotor verziója V55', async () => {
    const src = fs.readFileSync(__dirname + '/planner-v44.js', 'utf8');
    assert.match(src, /const VERSION = '55'/);
  });

  await test('Patrik indulási pontja Kispest, nem a központi raktár', async () => {
    const c = createContext(); threeDrivers(c);
    assert.deepEqual(await c.V53Planner.vehicleHomeV44(c.state.vehicles[0]), [47.7759, 19.136]);
    assert.deepEqual(await c.V53Planner.vehicleHomeV44(c.state.vehicles[1]), [47.4569, 19.14]);
    assert.deepEqual(await c.V53Planner.vehicleHomeV44(c.state.vehicles[2]), [47.455, 18.586]);
  });

  await test('A sávbesorolás kerület szerint helyes', async () => {
    const c = createContext(); threeDrivers(c);
    c.state.orders = [
      ord('A', 'Néber', '1037 Budapest, Orbán Balázs út 10.', 'P1', DROP),
      ord('B', 'Merkapt', '1106 Budapest, Maglódi út 14/B', 'P2', DROP),
      ord('C', 'Szatmári', '1158 Budapest, Késmárk utca 9.', 'P3', DROP),
      ord('D', 'Szerelvénybolt', '1182 Budapest, Üllői út 807/B', 'P4', DROP),
      ord('E', 'Szögker', '1202 Budapest, Jókai Mór utca 82.', 'P5', DROP),
      ord('F', 'Hungarokomplex', '1211 Budapest, II. Rákóczi Ferenc út 175/D', 'P6', DROP),
      ord('G', 'Lambda', '1117 Budapest, Hengermalom út 47/a', 'P7', DROP),
      ord('H', 'Gienger', '1225 Budapest, Dűlő utca 31-35.', 'P8', DROP),
      ord('I', 'Obi', 'Tatabánya, Obi', 'P9', DROP)
    ];
    await c.V53Planner.distributeOrderSetV44(c.state.orders);
    const zone = no => c.state.orders.find(o => o.orderNo === no).distributionZone;
    for (const n of ['A', 'B', 'C', 'D']) assert.equal(zone(n), 'mario-band', n + ' sávja: ' + zone(n));
    for (const n of ['E', 'F', 'G', 'H']) assert.equal(zone(n), 'patrik-band', n + ' sávja: ' + zone(n));
    assert.equal(zone('I'), 'martin-corridor', 'I sávja: ' + zone('I'));
  });

  await test('Kiegyenlített terhelésnél a sáv dönt', async () => {
    const c = createContext(); threeDrivers(c);
    c.state.orders = [
      ord('M1', 'Néber', '1037 Budapest, Orbán Balázs út 10.', 'P1', DROP),
      ord('M2', 'Merkapt', '1106 Budapest, Maglódi út 14/B', 'P2', DROP),
      ord('P1', 'Szögker', '1202 Budapest, Jókai Mór utca 82.', 'P3', DROP),
      ord('P2', 'Gienger', '1225 Budapest, Dűlő utca 31-35.', 'P4', DROP),
      ord('T1', 'Obi', 'Tatabánya, Obi', 'P5', DROP),
      ord('T2', 'Sebők', '2045 Törökbálint, Kinizsi Pál u. 28.', 'P6', DROP,
        { items: [{ _id: 'z', name: '6 méteres KPE cső' }] })
    ];
    await c.V53Planner.distributeOrderSetV44(c.state.orders);
    assert.equal(whose(c, 'M1'), 'Márió'); assert.equal(whose(c, 'M2'), 'Márió');
    assert.equal(whose(c, 'P1'), 'Patrik'); assert.equal(whose(c, 'P2'), 'Patrik');
    assert.equal(whose(c, 'T1'), 'Martin'); assert.equal(whose(c, 'T2'), 'Martin');
  });

  await test('Egyoldalú napon a terheléskiegyenlítés átléphet a sávon', async () => {
    const c = createContext(); threeDrivers(c);
    c.state.orders = [
      ord('A', 'Néber', '1037 Budapest, Orbán Balázs út 10.', 'P1', DROP),
      ord('B', 'Merkapt', '1106 Budapest, Maglódi út 14/B', 'P2', DROP),
      ord('C', 'Szatmári', '1158 Budapest, Késmárk utca 9.', 'P3', DROP),
      ord('D', 'Szerelvénybolt', '1182 Budapest, Üllői út 807/B', 'P4', DROP),
      ord('E', 'Szatmári2', '1158 Budapest, Késmárk utca 9.', 'P5', DROP)
    ];
    const result = await c.V53Planner.distributeOrderSetV44(c.state.orders);
    const counts = Object.values(result.stopCounts);
    assert.ok(Math.max(...counts) - Math.min(...counts) <= 2,
      'a terhelés nem egyenlítődött ki: ' + JSON.stringify(result.stopCounts));
    const zones = new Set(c.state.orders.map(o => o.distributionZone));
    assert.ok(zones.has('mario-band'), 'a sávjelölés elveszett');
  });

  await test('A nyugati folyosó Martiné', async () => {
    const c = createContext(); threeDrivers(c);
    c.state.orders = [ord('A', 'Obi', 'Tatabánya, Obi', 'P1', DROP)];
    await c.V53Planner.distributeOrderSetV44(c.state.orders);
    assert.equal(whose(c, 'A'), 'Martin');
  });

  await test('5-6 méteres szálanyag kizárólag Martinhoz kerül, sávtól függetlenül', async () => {
    const c = createContext(); threeDrivers(c);
    c.state.orders = [
      ord('A', 'Néber', '1037 Budapest, Orbán Balázs út 10.', 'P1', DROP,
        { items: [{ _id: 'x', name: '6 méteres KPE cső', qty: 2, unit: 'szál' }] }),
      ord('B', 'Szögker', '1202 Budapest, Jókai Mór utca 82.', 'P2', DROP,
        { items: [{ _id: 'y', name: 'zártszelvény 5000 mm', qty: 4, unit: 'szál' }] })
    ];
    await c.V53Planner.distributeOrderSetV44(c.state.orders);
    assert.equal(whose(c, 'A'), 'Martin', 'a Márió-sávból nem került Martinhoz');
    assert.equal(whose(c, 'B'), 'Martin', 'a Patrik-sávból nem került Martinhoz');
  });

  await test('A 4 méteres tétel V53-ban már nem szálanyag', async () => {
    const c = createContext();
    assert.equal(c.V53Planner.v53IsLongOrder({ items: [{ name: '4 méteres PVC cső' }] }), false);
    assert.equal(c.V53Planner.v53IsLongOrder({ items: [{ name: '3 méteres cső' }] }), false);
    assert.equal(c.V53Planner.v53IsLongOrder({ items: [{ name: '6 méteres KPE cső' }] }), true);
  });

  await test('A folyóméteres és mértékegység nélküli hossz is szálanyag', async () => {
    const c = createContext();
    assert.equal(c.V53Planner.v53IsLongOrder({ items: [{ name: 'csatorna cső 6 fm' }] }), true);
    assert.equal(c.V53Planner.v53IsLongOrder({ items: [{ name: 'KPE cső 6000' }] }), true);
    assert.equal(c.V53Planner.v53IsLongOrder({ items: [{ name: 'szálas anyag' }] }), true);
  });

  await test('A központi raktár projektenként bontható két sofőr között', async () => {
    const c = createContext(); threeDrivers(c);
    c.state.orders = [];
    for (let i = 0; i < 6; i++) {
      c.state.orders.push(ord('K' + i, 'KRPR', '2310 Szigetszentmiklós, Kereskedő utca 2.',
        'Projekt' + i, DROP));
    }
    const result = await c.V53Planner.distributeOrderSetV44(c.state.orders);
    const used = new Set(c.state.orders.map(o => o.vehicleId));
    assert.ok(result.blocks.length >= 6, 'a raktár nem bomlott projektenként: ' + result.blocks.length);
    assert.ok(used.size >= 2, 'a teljes raktár egyetlen sofőrhöz került');
  });

  await test('Egy külső felrakóhely minden rendelése együtt marad', async () => {
    const c = createContext(); threeDrivers(c);
    c.state.orders = [
      ord('A', 'Merkapt', '1106 Budapest, Maglódi út 14/B', 'P1', DROP),
      ord('B', 'Merkapt', '1106 Budapest, Maglódi út 14/B', 'P2', DROP),
      ord('C', 'Merkapt', '1106 Budapest, Maglódi út 14/B', 'P3', DROP)
    ];
    await c.V53Planner.distributeOrderSetV44(c.state.orders);
    const ids = new Set(c.state.orders.map(o => o.vehicleId));
    assert.equal(ids.size, 1, 'a felrakóhely két sofőrre szakadt');
  });

  await test('A terheléskiegyenlítés nem mozdítja el a szálanyagot Martintól', async () => {
    const c = createContext(); threeDrivers(c);
    c.state.orders = [
      ord('L1', 'Néber', '1037 Budapest, Orbán Balázs út 10.', 'P1', DROP,
        { items: [{ _id: 'a', name: '6 méteres acél profil' }] }),
      ord('L2', 'Szögker', '1202 Budapest, Jókai Mór utca 82.', 'P2', DROP,
        { items: [{ _id: 'b', name: '6 méteres acél profil' }] }),
      ord('L3', 'Lambda', '1117 Budapest, Hengermalom út 47/a', 'P3', DROP,
        { items: [{ _id: 'c', name: '6 méteres acél profil' }] })
    ];
    await c.V53Planner.distributeOrderSetV44(c.state.orders);
    for (const n of ['L1', 'L2', 'L3']) assert.equal(whose(c, n), 'Martin', n + ' elmozdult Martintól');
  });

  await test('Az optimalizálás egyetlen rendelés sofőrjét sem változtatja meg', async () => {
    const c = createContext(); threeDrivers(c);
    c.state.orders = [
      ord('A', 'Néber', '1037 Budapest, Orbán Balázs út 10.', 'P1', DROP),
      ord('B', 'Szögker', '1202 Budapest, Jókai Mór utca 82.', 'P2', DROP),
      ord('C', 'Obi', 'Tatabánya, Obi', 'P3', DROP)
    ];
    const result = await c.V53Planner.distributeOrderSetV44(c.state.orders);
    const before = c.state.orders.map(o => o.vehicleId);
    await c.V53Planner.buildRoutePlansV44(result.profiles);
    assert.deepEqual(c.state.orders.map(o => o.vehicleId), before);
  });

  await test('Martin Felcsútról a nyugati ponttal kezd és a lerakóhoz közelivel zár', async () => {
    const c = createContext(); threeDrivers(c);
    c.state.orders = [
      ord('A', 'Obi', 'Tatabánya, Obi', 'P1', DROP, { vehicleId: 't', importVehicleLocked: true, importVehicleCategory: 'martin' }),
      ord('B', 'Hungarokomplex', '1211 Budapest, II. Rákóczi Ferenc út 175/D', 'P2', DROP, { vehicleId: 't', importVehicleLocked: true, importVehicleCategory: 'martin' }),
      ord('C', 'Merkapt', '1106 Budapest, Maglódi út 14/B', 'P3', DROP, { vehicleId: 't', importVehicleLocked: true, importVehicleCategory: 'martin' })
    ];
    const result = await c.V53Planner.distributeOrderSetV44(c.state.orders);
    await c.V53Planner.buildRoutePlansV44(result.profiles);
    const names = (c.state.routePlans['2026-09-01']?.t || []).filter(e => e.type === 'pickup').map(e => e.name);
    assert.equal(names[0], 'Obi', 'nem Tatabányával kezdett: ' + names.join(' → '));
    assert.equal(names[names.length - 1], 'Merkapt', 'nem a lerakóhoz közelivel zárt: ' + names.join(' → '));
  });

  await test('Az útvonaltervben nincs lerakó esemény', async () => {
    const c = createContext(); threeDrivers(c);
    c.state.orders = [
      ord('A', 'Néber', '1037 Budapest, Orbán Balázs út 10.', 'P1', DROP),
      ord('B', 'Merkapt', '1106 Budapest, Maglódi út 14/B', 'P2', DROP)
    ];
    const result = await c.V53Planner.distributeOrderSetV44(c.state.orders);
    await c.V53Planner.buildRoutePlansV44(result.profiles);
    for (const v of c.state.vehicles) {
      const events = c.state.routePlans['2026-09-01'][v.id] || [];
      assert.ok(events.every(e => e.type === 'pickup'), v.driverName + ' útvonalába lerakó került');
    }
  });

  if (!process.exitCode) console.log(`\nV53 elfogadási teszt: ${passed}/${total} sikeres.`);
})();
