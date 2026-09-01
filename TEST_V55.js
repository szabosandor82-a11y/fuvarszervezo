const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

function norm(s = '') { return String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[_.,;:()[\]{}\/\\-]+/g, ' ').replace(/\s+/g, ' ').trim() }

function createContext() {
  const ctx = { console, Math, Date, Set, Map, Array, Object, String, Number, Boolean, RegExp, JSON, Promise, Error, Infinity, NaN, Intl };
  ctx.globalThis = ctx; ctx.norm = norm; ctx.document = undefined; ctx.window = ctx;
  ctx.setTimeout = fn => { try { fn() } catch (e) {} return 0 }; ctx.clearTimeout = () => {};
  ctx.localStorage = { getItem: () => null, setItem() {} }; ctx.KEY = 'test'; ctx.confirm = () => true;
  ctx.v29Km = (a, b) => { if (!a || !b) return 35; const dx = (a[0] - b[0]) * 111, dy = (a[1] - b[1]) * 75; return Math.sqrt(dx * dx + dy * dy) };
  ctx.dist = ctx.v29Km; ctx.canCarryLong = v => /plato|ponyv/.test(norm(v.type)); ctx.syncOrderFromMasters = () => {};
  ctx.state = { settings: {}, projects: [], suppliers: [], recipients: [], orders: [], vehicles: [], backlog: [], resolvedBacklog: [], routePlans: {}, routeStats: {}, geo: {}, aliases: { projects: {}, suppliers: {} } };
  ctx.selectedDate = () => '2026-09-01';
  ctx.activeVehicles = () => ctx.state.vehicles.filter(v => v.active !== false);
  ctx.dayOrders = id => ctx.state.orders.filter(o => o.scheduleDate === ctx.selectedDate() && o.vehicleId === id);
  ctx.geo = async a => ctx.state.geo[a] || null;
  ctx.vehicleHome = async () => null;
  ctx.orderGeoProfile = async o => ({ pickup: ctx.state.geo[o.pickupAddress] || null, drop: ctx.state.geo[o.dropAddress] || null });
  ctx.save = () => {}; ctx.alert = () => {}; ctx.render = () => {};
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(__dirname + '/data.js', 'utf8'), ctx, { filename: 'data.js' });
  ctx.window = undefined;
  ctx.state.projects = ctx.SEED_DATA.projects.map((p, i) => ({ ...p, id: 'p' + i }));
  ctx.state.suppliers = ctx.SEED_DATA.suppliers.map((s, i) => ({ ...s, id: 's' + i }));
  ctx.state.recipients = ctx.SEED_DATA.recipients.map((r, i) => ({ ...r, id: 'r' + i }));
  for (const row of [...ctx.SEED_DATA.suppliers, ...ctx.SEED_DATA.projects]) {
    if (row.point && row.address) ctx.state.geo[row.address] = row.point.slice();
  }
  for (const f of ['planner-v32.js', 'planner-v33.js', 'planner-v34.js', 'planner-v35.js', 'planner-v37.js', 'planner-v41.js', 'planner-v44.js']) {
    vm.runInContext(fs.readFileSync(__dirname + '/' + f, 'utf8'), ctx, { filename: f });
  }
  return ctx;
}

const KRPR = fs.readFileSync(__dirname + '/testdata/krpr_moxy_berlemeny.txt', 'utf8');
const PRPR = fs.readFileSync(__dirname + '/testdata/prpr_lejardin_cosmo.txt', 'utf8');

function krprWith(target) {
  return `                     Raktárközi
                                                        2026-KRPR/000836
  Forrás raktár:                                Cél raktár:
              Stand 98 Kft.                                 ${target}
              Új Központi Raktár
              1239 Budapest Láva u 7.
  Tel, fax:                                     Tel, fax:
  Email:          info@stand98.hu               Email:
 Dátum                  Alapbizonylat
 2026.09.01.`;
}

(async () => {
  let passed = 0, total = 0;
  async function test(name, fn) {
    total++;
    try { await fn(); console.log('OK', name); passed++; }
    catch (e) { console.error('HIBA', name, e.message); process.exitCode = 1; }
  }

  await test('A motor verziója V55', async () => {
    assert.match(fs.readFileSync(__dirname + '/planner-v44.js', 'utf8'), /const VERSION = '55'/);
  });

  await test('PRPR: a felrakó a Forrás, a lerakó a Cél hasáb (valós bizonylat)', async () => {
    const c = createContext();
    const t = c.V41OutlookImport.extractTransferWarehouses(PRPR, []);
    assert.equal(t.source?.name, 'Budapest_LeJardin_II_felépítmény', 'felrakó: ' + t.source?.name);
    assert.equal(t.source?.address, '1134 Budapest, Rozsnyai 14-18.');
    assert.equal(t.target?.name, 'Budapest_Cosmo_Residence', 'lerakó: ' + t.target?.name);
    assert.equal(t.target?.address, '1133 Budapest, Hegedűs Gyula utca 53.');
  });

  await test('KRPR: a lerakó a cél raktár, nem a forrás (valós bizonylat)', async () => {
    const c = createContext();
    const t = c.V41OutlookImport.extractTransferWarehouses(KRPR, []);
    assert.equal(t.target?.name, 'Budapest_Moxy_bérlemények', 'lerakó: ' + t.target?.name);
    assert.equal(t.target?.address, '1075 Budapest, Kazinczy u. 48.');
    assert.ok(!/kozponti/.test(norm(t.target?.name || '')), 'a lerakó a központi raktár lett');
  });

  await test('KRPR: egyik cél raktárnál sem írhat központi raktárat', async () => {
    const c = createContext();
    const targets = ['Moxy_Bérlemény_2026098', 'Moxy_VUC_2026011', 'Kincsem_K6_2026044',
      'Cosmo_Residence_2026021', 'LeJardin_II_felépítmény_2026077', 'Waterfront_City_V_2026102',
      'Sofitel_Hotel_2026005', 'Metrodom_Beat_2026066'];
    const bad = [];
    for (const target of targets) {
      const t = c.V41OutlookImport.extractTransferWarehouses(krprWith(target), []);
      if (!t.target || /kozponti raktar|stand 98/.test(norm(t.target.name))) bad.push(target + ' -> ' + (t.target?.name || 'nincs'));
    }
    assert.equal(bad.length, 0, bad.join(' ; '));
  });

  await test('A "Le Jardin" a felépítményre mutat, nem a TERV változatra', async () => {
    const c = createContext();
    const t = c.V41OutlookImport.extractTransferWarehouses(krprWith('LeJardin_II_felépítmény_2026077'), []);
    assert.equal(t.target?.name, 'Budapest_LeJardin_II_felépítmény', 'lerakó: ' + t.target?.name);
    assert.ok(t.target?.address, 'a felépítménynek van címe');
  });

  await test('Rövidített cégnév is megtalálja a törzsadatot', async () => {
    const c = createContext();
    const cases = [['Gienger kp', /gienger/], ['Lambda kp', /lambda/], ['Fogarasi kp', /fogarasi/],
      ['Merkapt kp', /merkapt/], ['Szatmári kp', /szatmari/], ['Hungarokomplex', /hungarokomplex/]];
    const bad = [];
    for (const [text, expect] of cases) {
      const r = c.V41OutlookImport.bestSupplier(text);
      if (!r?.name || !expect.test(norm(r.name)) || !r.address) bad.push(`${text} -> ${r?.name || 'nincs'}`);
    }
    assert.equal(bad.length, 0, bad.join(' ; '));
  });

  await test('A "kp" utótag a központi telephelyet választja', async () => {
    const c = createContext();
    const r = c.V41OutlookImport.bestSupplier('Szatmári kp');
    const master = c.state.suppliers.find(s => s.address === r.address);
    assert.ok(master?.isCentral, 'nem a központi telephelyet adta: ' + r.address);
  });

  await test('A felrakó neve soha nem lehet cím (elcsúszott sorok inaktívak)', async () => {
    const c = createContext();
    const active = c.state.suppliers.filter(s => s.active !== false);
    const bad = active.filter(s => /^\s*(\d{4}\b|budapest\b)/i.test(s.name || ''));
    assert.equal(bad.length, 0, 'aktív, cím-nevű beszállító: ' + bad.slice(0, 3).map(s => s.name).join(' ; '));
  });

  await test('A törzsadat címei előre geokódoltak', async () => {
    const c = createContext();
    const withAddress = c.SEED_DATA.suppliers.filter(s => s.address);
    const withPoint = withAddress.filter(s => Array.isArray(s.point));
    assert.ok(withPoint.length / withAddress.length > 0.8,
      `csak ${withPoint.length}/${withAddress.length} telephelynek van koordinátája`);
    const projects = c.SEED_DATA.projects.filter(p => p.address);
    assert.equal(projects.filter(p => Array.isArray(p.point)).length, projects.length,
      'nem minden címmel bíró projektnek van koordinátája');
  });

  await test('PRPR kiosztás: a fel- és lerakó együtt dönt', async () => {
    const c = createContext();
    c.state.vehicles = [
      { id: 'm', driverName: 'Márió', type: '3.5 T dobozos autó', active: true },
      { id: 'p', driverName: 'Patrik', type: '3.5 T dobozos autó', active: true },
      { id: 't', driverName: 'Martin', type: '3.5 T plató autó', active: true }
    ];
    c.state.orders = [{
      id: 'o1', scheduleDate: '2026-09-01', vehicleId: '', sequence: 999, orderNo: '000503',
      orderType: 'PRPR', pickupName: 'Budapest_LeJardin_II_felépítmény',
      pickupAddress: '1134 Budapest, Rozsnyai 14-18.',
      projectName: 'Budapest_Cosmo_Residence', dropAddress: '1133 Budapest, Hegedűs Gyula utca 53.',
      items: [{ _id: 'i1', name: 'Niczuk Menetesszár M10x3000mm' }], importVehicleCategory: 'dobozos'
    }];
    await c.V55Planner.distributeOrderSetV44(c.state.orders);
    const driver = c.state.vehicles.find(v => v.id === c.state.orders[0].vehicleId)?.driverName;
    assert.equal(driver, 'Patrik', 'a PRPR nem Patrikhoz került: ' + driver);
    assert.match(String(c.state.orders[0].distributionReason || ''), /PRPR/, 'indoklás: ' + c.state.orders[0].distributionReason);
  });

  await test('A 3 méteres menetesszár nem szálanyag, tehát nem kötelező Martin', async () => {
    const c = createContext();
    assert.equal(c.V55Planner.v53IsLongOrder({ items: [{ name: 'Niczuk Menetesszár M10x3000mm - (25/doboz)' }] }), false);
    assert.equal(c.V55Planner.v53IsLongOrder({ items: [{ name: 'Menetes szál M10x6000mm' }] }), true);
  });

  await test('A törzsadat exportálható data.js formátumban', async () => {
    const c = createContext();
    const result = c.V55Planner.exportMasterDataV55();
    assert.ok(result?.text?.startsWith('/* Fuvarszervező törzsadat export'), 'hiányzik a fejléc');
    assert.match(result.text, /window\.SEED_DATA = \{/);
    const json = JSON.parse(result.text.slice(result.text.indexOf('{'), result.text.lastIndexOf('}') + 1));
    assert.equal(json.projects.length, 60);
    assert.ok(json.suppliers.length > 400);
    assert.equal(json.vehicles.length, 3);
  });

  await test('A térkép a felrakókat rajzolja, nem a lerakókat', async () => {
    const app = fs.readFileSync(__dirname + '/app.js', 'utf8');
    const start = app.indexOf('async function drawMap(id){');
    const body = app.slice(start, app.indexOf('async function vehicleHome', start));
    assert.ok(body.includes('o.pickupAddress'), 'a drawMap nem a felrakó címét használja');
    assert.ok(!body.includes('o.dropAddress'), 'a drawMap még mindig a lerakót rajzolja');
    assert.ok(!body.includes('state.settings.baseAddress'), 'a vonal még a raktárból indul');
    assert.ok(body.includes('pickup-pin'), 'hiányzik a sorszámozott jelölő');
  });

  if (!process.exitCode) console.log(`\nV55 elfogadási teszt: ${passed}/${total} sikeres.`);
})();
