const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

function norm(s = '') { return String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[_.,;:()[\]{}\/\\-]+/g, ' ').replace(/\s+/g, ' ').trim() }

const GEO = {
  '2310 Szigetszentmiklós, Kereskedő utca 2.': [47.3434, 19.0437],
  'Vác': [47.7759, 19.136], 'Felcsút': [47.455, 18.586], 'Kispest': [47.4569, 19.14],
  '1158.Budapest, Késmárk utca 9': [47.560, 19.130],
  'Budapest III. kerület, Szentendrei út 243.': [47.567, 19.040],
  'Budapest XXII. Kerület, Nagytétényi út 49.': [47.412, 19.005],
  '1106 Budapest, Maglódi út 14/B': [47.483, 19.145],
  '1205 Budapest, Jókai Mór u. 82': [47.437, 19.113],
  '1225 Budapest, Dűlő utca 31-35.': [47.412, 19.005],
  '1133 Budapest, Hegedűs Gyula utca 53.': [47.521, 19.057],
  '1095 Budapest, Soroksári út 58.': [47.477, 19.083]
};

function createContext(withSeed = true) {
  const ctx = { console, Math, Date, Set, Map, Array, Object, String, Number, Boolean, RegExp, JSON, Promise, Error, Infinity, NaN, Intl, fetch: undefined, window: undefined, globalThis: null };
  ctx.globalThis = ctx; ctx.norm = norm; ctx.confirm = () => true;
  ctx.document = undefined;   // a plannerek DOM-kötése nem fut a teszt alatt
  ctx.setTimeout = (fn) => { try { fn(); } catch (e) {} return 0; };
  ctx.clearTimeout = () => {};
  ctx.setInterval = () => 0; ctx.clearInterval = () => {};
  ctx.requestAnimationFrame = fn => { try { fn(0); } catch (e) {} return 0; };
  ctx.localStorage = { setItem() {}, getItem() { return null } }; ctx.KEY = 'test';
  ctx.v29Km = (a, b) => { if (!a || !b) return 35; const dx = (a[0] - b[0]) * 111, dy = (a[1] - b[1]) * 75; return Math.sqrt(dx * dx + dy * dy) };
  ctx.dist = ctx.v29Km; ctx.canCarryLong = v => /plato|ponyv/.test(norm(v.type)); ctx.syncOrderFromMasters = () => {};
  ctx.state = { settings: {}, vehicles: [], orders: [], backlog: [], resolvedBacklog: [], routePlans: {}, routeStats: {}, geo: {}, projects: [], suppliers: [], recipients: [], aliases: { projects: {}, suppliers: {} } };
  ctx.selectedDate = () => '2026-09-01';
  ctx.activeVehicles = () => ctx.state.vehicles.filter(v => v.active !== false);
  ctx.dayOrders = id => ctx.state.orders.filter(o => o.scheduleDate === ctx.selectedDate() && o.vehicleId === id);
  ctx.geo = async a => GEO[a] || null;
  ctx.vehicleHome = async v => v.homePoint || GEO['2310 Szigetszentmiklós, Kereskedő utca 2.'];
  ctx.orderGeoProfile = async o => ({ pickup: GEO[o.pickupAddress] || null, drop: GEO[o.dropAddress] || null });
  ctx.save = () => {}; ctx.alert = () => {}; ctx.render = () => {};
  vm.createContext(ctx);
  if (withSeed) {
    ctx.window = ctx;
    vm.runInContext(fs.readFileSync(__dirname + '/data.js', 'utf8'), ctx, { filename: 'data.js' });
    ctx.window = undefined;
  } else {
    ctx.SEED_DATA = { projects: [], suppliers: [], recipients: [], vehicles: [] };
  }
  for (const f of ['planner-v32.js', 'planner-v33.js', 'planner-v34.js', 'planner-v35.js', 'planner-v37.js', 'planner-v44.js']) {
    vm.runInContext(fs.readFileSync(__dirname + '/' + f, 'utf8'), ctx, { filename: f });
  }
  // A törzsadat betöltése az állapotba (élesben ezt a planner v43 végzi)
  if (withSeed) {
    const seed = ctx.SEED_DATA;
    ctx.state.projects = seed.projects.map((p, i) => ({ ...p, id: 'p' + i }));
    ctx.state.suppliers = seed.suppliers.map((s, i) => ({ ...s, id: 's' + i }));
    ctx.state.recipients = seed.recipients.map((r, i) => ({ ...r, id: 'r' + i }));
  }
  return ctx;
}

const veh = (id, name) => ({ id, driverName: name, type: name === 'Martin' ? '3.5 T plató autó' : '3.5 T dobozos autó', active: true });
const ord = (id, name, addr, project, drop, extra = {}) => ({
  id, scheduleDate: '2026-09-01', vehicleId: '', sequence: 999, orderNo: id,
  pickupName: name, pickupAddress: addr, projectName: project, dropAddress: drop,
  items: [{ _id: 'i' + id, name: 'anyag', qty: 1, unit: 'db' }],
  importVehicleCategory: 'dobozos', ...extra
});
function three(c) { c.state.vehicles = [veh('m', 'Márió'), veh('p', 'Patrik'), veh('t', 'Martin')] }
function whose(c, no) {
  const o = c.state.orders.find(x => x.orderNo === no);
  return c.state.vehicles.find(v => v.id === o.vehicleId)?.driverName || '-';
}

(async () => {
  let passed = 0, total = 0;
  async function test(name, fn) {
    total++;
    try { await fn(); console.log('OK', name); passed++; }
    catch (e) { console.error('HIBA', name, e.message); process.exitCode = 1; }
  }

  await test('A motor verziója V59', async () => {
    assert.match(fs.readFileSync(__dirname + '/planner-v44.js', 'utf8'), /const VERSION = '59'/);
  });

  await test('A törzsadat betöltődik: projektek, telephelyek, átvevők, autók', async () => {
    const c = createContext();
    const seed = c.SEED_DATA;
    assert.equal(seed.projects.length, 60, 'projektszám');
    assert.ok(seed.suppliers.length > 400, 'telephelyszám: ' + seed.suppliers.length);
    assert.equal(seed.recipients.length, 116, 'átvevőszám');
    assert.equal(seed.vehicles.length, 3, 'autószám');
    const verified = seed.suppliers.filter(s => s.verified);
    assert.equal(verified.length, 191, 'hitelesített telephely: ' + verified.length);
    assert.equal(verified.filter(s => s.isCentral).length, 36, 'központi telephely');
  });

  await test('Patrik indulási pontja a törzsadatból Kispest', async () => {
    const c = createContext(); three(c);
    assert.deepEqual(await c.V54Planner.vehicleHomeV44(c.state.vehicles[1]), [47.4569, 19.14]);
    assert.deepEqual(await c.V54Planner.vehicleHomeV44(c.state.vehicles[0]), [47.7759, 19.136]);
    assert.deepEqual(await c.V54Planner.vehicleHomeV44(c.state.vehicles[2]), [47.455, 18.586]);
  });

  await test('A sáv a telephely címéből jön, nem a cégnévből', async () => {
    for (const [addr, expected] of [
      ['1158.Budapest, Késmárk utca 9', 'mario-band'],
      ['Budapest XXII. Kerület, Nagytétényi út 49.', 'patrik-band'],
      ['Budapest III. kerület, Szentendrei út 243.', 'mario-band'],
      ['Budapest XIX kerület, Vas Gereben utca 4/B', 'patrik-band']
    ]) {
      const c = createContext(); three(c);
      c.state.orders = [ord('A', 'Szatmári', addr, 'Cosmo', '1133 Budapest, Hegedűs Gyula utca 53.')];
      await c.V54Planner.distributeOrderSetV44(c.state.orders);
      assert.equal(c.state.orders[0].distributionZone, expected, addr + ' sávja');
    }
  });

  await test('A római számmal írt kerületet is felismeri', async () => {
    const c = createContext(); three(c);
    c.state.orders = [
      ord('A', 'X1', 'Budapest X. kerület, Gyömrői út 1-5.', 'Cosmo', ''),
      ord('B', 'X2', 'Budapest, XVII. Kerület, Pesti út 237/i', 'Cosmo', ''),
      ord('C', 'X3', 'Budapest, IV. kerület, Külső-Váci út 61-63.', 'Cosmo', '')
    ];
    await c.V54Planner.distributeOrderSetV44(c.state.orders);
    for (const o of c.state.orders) {
      assert.equal(o.distributionZone, 'mario-band', o.pickupAddress + ' sávja: ' + o.distributionZone);
    }
  });

  await test('ISMERT KORLÁT: az azonos cégnév továbbra is egy blokkba von', async () => {
    // A V52-ből örökölt "azonos beszállító egy sofőrhöz" szabály. Mivel egy
    // cégnek több telephelye is lehet eltérő sávban, ez felülírja a címet.
    const c = createContext(); three(c);
    c.state.orders = [
      ord('A', 'Szatmári', '1158.Budapest, Késmárk utca 9', 'Cosmo', ''),
      ord('B', 'Szatmári', 'Budapest XXII. Kerület, Nagytétényi út 49.', 'Cosmo', '')
    ];
    const result = await c.V54Planner.distributeOrderSetV44(c.state.orders);
    assert.equal(result.blocks.length, 1, 'a két telephely külön blokkba került');
    assert.equal(whose(c, 'A'), whose(c, 'B'), 'a két telephely két sofőrhöz került');
  });

  await test('A "kp" utótag a hitelesített központi telephelyre mutat', async () => {
    const c = createContext();
    const addr = c.V54Planner.masterAddressV54({ pickupName: 'Szögker kp' });
    assert.match(norm(addr), /jokai mor/, 'nem a központi telephelyet találta: ' + addr);
    const merkapt = c.V54Planner.masterAddressV54({ pickupName: 'Merkapt kp' });
    assert.match(norm(merkapt), /maglodi/, 'Merkapt központ: ' + merkapt);
  });

  await test('A projekt címe a törzsadatból jön, ha a rendelésen nincs', async () => {
    const c = createContext();
    const addr = c.V54Planner.projectAddressV54({ projectName: 'Budapest_Cosmo_Residence' });
    assert.match(norm(addr), /hegedus gyula/, 'projektcím: ' + addr);
    assert.equal(c.V54Planner.projectAddressV54({ projectName: 'Budapest_Kincsem_K6_TERV' }), '',
      'a cím nélküli projekt ne adjon vissza címet');
  });

  await test('Hiányos lerakó-lefedettségnél a súlypont nem használható', async () => {
    const c = createContext(); three(c);
    c.state.geo['1133 budapest hegedus gyula utca 53'] = [47.521, 19.057];
    c.state.orders = [
      ord('A', 'Merkapt', '1106 Budapest, Maglódi út 14/B', 'Budapest_Kincsem_K6_TERV', '', { vehicleId: 'm' }),
      ord('B', 'Szögker', '1205 Budapest, Jókai Mór u. 82', 'Budapest_Kincsem_K6_TERV', '', { vehicleId: 'm' }),
      ord('C', 'Gienger', '1225 Budapest, Dűlő utca 31-35.', 'Budapest_Kincsem_K6_TERV', '', { vehicleId: 'm' })
    ];
    assert.equal(c.V54Planner.dropCentroidV53('m'), null,
      'cím nélküli projekteknél nem szabad súlypontot számolni');
  });

  await test('Elegendő lefedettségnél a súlypont számítható', async () => {
    const c = createContext(); three(c);
    const key = '1133 budapest hegedus gyula utca 53';
    c.state.geo[key] = [47.521, 19.057];
    c.state.geo['1133 Budapest, Hegedűs Gyula utca 53.'] = [47.521, 19.057];
    c.state.orders = [
      ord('A', 'Merkapt', '1106 Budapest, Maglódi út 14/B', 'Cosmo', '1133 Budapest, Hegedűs Gyula utca 53.', { vehicleId: 'm' }),
      ord('B', 'Szögker', '1205 Budapest, Jókai Mór u. 82', 'Cosmo', '1133 Budapest, Hegedűs Gyula utca 53.', { vehicleId: 'm' })
    ];
    const centroid = c.V54Planner.dropCentroidV53('m');
    assert.ok(Array.isArray(centroid), 'nem számolt súlypontot');
    assert.ok(Math.abs(centroid[0] - 47.521) < 0.01, 'súlypont: ' + JSON.stringify(centroid));
  });

  await test('A verziófelirat a VERSION konstansból frissül', async () => {
    const c = createContext();
    const nodes = [{ textContent: 'régi' }, { textContent: 'régi' }];
    c.document = { title: 'Fuvarszervező V0', querySelectorAll: () => nodes, querySelector: () => null };
    c.V54Planner.applyVersionLabelV54();
    assert.equal(c.document.title, 'Fuvarszervező V59');
    for (const n of nodes) assert.equal(n.textContent, 'Fuvarszervező V59');
  });

  await test('A felületen sehol nem maradt régi verziószám', async () => {
    for (const f of ['index.html', 'manifest.webmanifest']) {
      const text = fs.readFileSync(__dirname + '/' + f, 'utf8');
      assert.ok(!/V5[0-4]\b/.test(text), f + ' régi verziószámot tartalmaz');
      assert.ok(!/v=5[0-4]\.0/.test(text), f + ' régi gyorsítótár-verziót tartalmaz');
    }
  });

  await test('A szálanyag- és sávszabályok a törzsadattal is érvényben maradnak', async () => {
    const c = createContext(); three(c);
    c.state.orders = [
      ord('L', 'Merkapt', '1106 Budapest, Maglódi út 14/B', 'Cosmo', '1133 Budapest, Hegedűs Gyula utca 53.',
        { items: [{ _id: 'x', name: '6 méteres KPE cső' }] }),
      ord('M', 'Szatmári', '1158.Budapest, Késmárk utca 9', 'Cosmo', '1133 Budapest, Hegedűs Gyula utca 53.'),
      ord('P', 'Gienger', '1225 Budapest, Dűlő utca 31-35.', 'Cosmo', '1133 Budapest, Hegedűs Gyula utca 53.')
    ];
    await c.V54Planner.distributeOrderSetV44(c.state.orders);
    assert.equal(whose(c, 'L'), 'Martin', 'a szálanyag nem Martinhoz került');
    assert.equal(whose(c, 'M'), 'Márió');
    assert.equal(whose(c, 'P'), 'Patrik');
  });

  await test('Törzsadat nélkül is működik a motor (visszaesés alapértékekre)', async () => {
    const c = createContext(false); three(c);
    assert.deepEqual(await c.V54Planner.vehicleHomeV44(c.state.vehicles[1]), [47.4569, 19.14]);
    c.state.orders = [ord('A', 'Merkapt', '1106 Budapest, Maglódi út 14/B', 'X', '')];
    await c.V54Planner.distributeOrderSetV44(c.state.orders);
    assert.equal(c.state.orders[0].distributionZone, 'mario-band');
  });

  if (!process.exitCode) console.log(`\nV54 elfogadási teszt: ${passed}/${total} sikeres.`);
})();
