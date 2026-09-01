const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

function norm(s = '') { return String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[_.,;:()[\]{}\/\\-]+/g, ' ').replace(/\s+/g, ' ').trim() }

function makeL(added) {
  return {
    divIcon: opts => opts,
    marker: (point, opts) => {
      added.push({ point, title: opts?.title || '' });
      const self = { addTo: () => self, bindPopup: () => self, on: () => self };
      return self;
    },
    polyline: coords => {
      added.polyline = coords;
      const self = { addTo: () => self, getBounds: () => ({}) };
      return self;
    }
  };
}

function createContext(hook) {
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
  if (typeof hook === 'function') hook(ctx);
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

  await test('A motor verziója V59', async () => {
    assert.match(fs.readFileSync(__dirname + '/planner-v44.js', 'utf8'), /const VERSION = '59'/);
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
    await c.V59Planner.distributeOrderSetV44(c.state.orders);
    const driver = c.state.vehicles.find(v => v.id === c.state.orders[0].vehicleId)?.driverName;
    assert.equal(driver, 'Patrik', 'a PRPR nem Patrikhoz került: ' + driver);
    assert.match(String(c.state.orders[0].distributionReason || ''), /PRPR/, 'indoklás: ' + c.state.orders[0].distributionReason);
  });

  await test('A 3 méteres menetesszár nem szálanyag, tehát nem kötelező Martin', async () => {
    const c = createContext();
    assert.equal(c.V59Planner.v53IsLongOrder({ items: [{ name: 'Niczuk Menetesszár M10x3000mm - (25/doboz)' }] }), false);
    assert.equal(c.V59Planner.v53IsLongOrder({ items: [{ name: 'Menetes szál M10x6000mm' }] }), true);
  });

  await test('Semmilyen fájl nem ír beégetett RÉGI verziószámot a fejlécbe', async () => {
    // A mintát a motor VERSION konstansából képezzük, hogy a teszt ne
    // szoruljon kézi igazításra minden kiadásnál.
    const planner = fs.readFileSync(__dirname + '/planner-v44.js', 'utf8');
    const current = (planner.match(/const VERSION = '(\d+)'/) || [])[1];
    assert.ok(current, 'nem olvasható ki a VERSION');
    const files = ['app.js', 'auth-v44-2.js', 'online-v44-2.js', 'online-config.js',
      'planner-v41.js', 'planner-v43.js', 'planner-v44.js', 'index.html', 'manifest.webmanifest'];
    const bad = [];
    for (const file of files) {
      const text = fs.readFileSync(__dirname + '/' + file, 'utf8');
      text.split('\n').forEach((line, i) => {
        // A modulok fejléckommentje a saját nevüket viseli (pl. "Fuvarszervező V44
        // – Outlook import"); az nem felhasználói felirat, ezért kihagyjuk.
        if (/SESSION_KEY|localStorage|sessionStorage/.test(line)) return;
        if (/^\s*(\/\*|\*|\/\/)/.test(line)) return;
        for (const m of line.matchAll(/Fuvarszervező\s*V(\d+)\b/g)) {
          if (m[1] !== current) bad.push(`${file}:${i + 1} (V${m[1]})`);
        }
        for (const m of line.matchAll(/\?v=(\d+)\.0/g)) {
          if (m[1] !== current) bad.push(`${file}:${i + 1} cache v${m[1]}`);
        }
        const app = line.match(/APP_VERSION\s*=\s*['"]V(\d+)['"]/);
        if (app) bad.push(`${file}:${i + 1} APP_VERSION beégetve`);
        if (/setAppTitle\(\s*['"]/.test(line)) bad.push(`${file}:${i + 1} beégetett setAppTitle`);
      });
    }
    assert.equal(bad.length, 0, 'régi verziófelirat: ' + bad.join(' ; '));
  });

  await test('A belépés utáni címfrissítés is a motor verzióját használja', async () => {
    const auth = fs.readFileSync(__dirname + '/auth-v44-2.js', 'utf8');
    assert.ok(auth.includes('function appVersionLabel()'), 'hiányzik az appVersionLabel');
    assert.ok(auth.includes('V59Planner?.version'), 'nem a motorból olvassa a verziót');
    assert.ok(auth.includes('data-app-version'), 'a belépés után nem frissíti a fejléc horgonyát');
  });

  await test('A törzsadat exportálható data.js formátumban', async () => {
    const c = createContext();
    const result = c.V59Planner.exportMasterDataV55();
    assert.ok(result?.text?.startsWith('/* Fuvarszervező törzsadat export'), 'hiányzik a fejléc');
    assert.match(result.text, /window\.SEED_DATA = \{/);
    const json = JSON.parse(result.text.slice(result.text.indexOf('{'), result.text.lastIndexOf('}') + 1));
    assert.equal(json.projects.length, 60);
    assert.ok(json.suppliers.length > 400);
    assert.equal(json.vehicles.length, 3);
  });

  await test('A ténylegesen futó térképrajzoló a drawMapV49', async () => {
    // Az app.js ötször újradefiniálja a drawMap-et, a planner-v33 és a
    // planner-v44 pedig globálisan felül is írja. Élesben a drawMapV49 fut,
    // ezért a tesztnek AZT kell vizsgálnia, nem az app.js-beli változatot.
    const planner = fs.readFileSync(__dirname + '/planner-v44.js', 'utf8');
    assert.ok(planner.includes('global.drawMap = drawMapV49'),
      'a planner-v44 nem veszi át a drawMap-et');
    const start = planner.indexOf('async function drawMapV49(');
    assert.ok(start > 0, 'nincs drawMapV49');
    const body = planner.slice(start, planner.indexOf('\n  }', planner.indexOf('routeStats', start)));

    assert.ok(!/points\.push\(home\)/.test(body),
      'a vonal még mindig a lakhelyből indul vagy oda tér vissza');
    assert.ok(!/const home = await vehicleHomeV44/.test(body),
      'a lakhely még mindig bekerül a térképi pontok közé');
    assert.ok(/event\.type === 'pickup'/.test(body), 'nem a felrakókat szűri');
    assert.ok(!/dropAddress/.test(body), 'a lerakó címét is rajzolja');
  });

  await test('A térkép a felrakókat rajzolja, sorszámmal, a lakhely nélkül', async () => {
    const added = [];
    const fakeMap = { setView: () => {}, fitBounds: () => {} };
    const node = () => ({ style: {}, dataset: {}, classList: { add(){}, remove(){}, toggle(){}, contains: () => false },
      textContent: '', innerHTML: '', title: '', value: '', appendChild(){}, removeChild(){}, remove(){},
      setAttribute(){}, removeAttribute(){}, getAttribute: () => null, addEventListener(){}, removeEventListener(){},
      click(){}, querySelector: () => null, querySelectorAll: () => [], closest: () => null, insertBefore(){} });
    const c = createContext(ctx => {
      ctx.maps = { m: fakeMap };
      ctx.L = makeL(added);
      ctx.roadRoute = undefined;
      ctx.document = { title: '', body: node(), head: node(), documentElement: node(),
        getElementById: node, querySelector: node, querySelectorAll: () => [],
        createElement: node, createTextNode: node, addEventListener(){}, removeEventListener(){},
        readyState: 'complete' };
      ctx.setInterval = () => 0; ctx.clearInterval = () => {};
    });
    c.state.vehicles = [{ id: 'm', driverName: 'Márió', type: '3.5 T dobozos autó', active: true }];
    const A = '1158.Budapest, Késmárk utca 9', B = '1106 Budapest, Maglódi út 14/B';
    c.state.geo[A] = [47.560, 19.130]; c.state.geo[B] = [47.483, 19.145];
    c.state.routePlans['2026-09-01'] = { m: [
      { type: 'pickup', name: 'Szatmári', address: A, point: c.state.geo[A], orders: [] },
      { type: 'pickup', name: 'Merkapt', address: B, point: c.state.geo[B], orders: [] }
    ] };
    await c.V59Planner.drawMapV49('m');
    assert.equal(added.length, 2, 'nem két jelölő került ki: ' + added.length);
    assert.deepEqual(added[0].point, c.state.geo[A], 'az első jelölő nem a Szatmári');
    const line = added.polyline || [];
    assert.equal(line.length, 2, 'a vonalnak csak a két felrakót kell összekötnie: ' + line.length);
    assert.deepEqual(line[0], c.state.geo[A], 'a vonal nem az első felrakótól indul');
    const vac = [47.7759, 19.136];
    assert.ok(!line.some(p => Math.abs(p[0] - vac[0]) < 0.01 && Math.abs(p[1] - vac[1]) < 0.01),
      'Vác rajta van a térképi vonalon');
  });

  await test('A kézi átrendezés a sequence sorrendjét adja, nem optimalizál újra', async () => {
    const c = createContext();
    const vehicle = { id: 'm', driverName: 'Márió', type: '3.5 T dobozos autó', active: true };
    c.state.vehicles = [vehicle];
    const A = '1158.Budapest, Késmárk utca 9', B = '1106 Budapest, Maglódi út 14/B', C = '1225 Budapest, Dűlő utca 31-35.';
    c.state.geo[A] = [47.560, 19.130]; c.state.geo[B] = [47.483, 19.145]; c.state.geo[C] = [47.412, 19.005];
    const mk = (no, name, addr, seq) => ({ id: 'o' + no, scheduleDate: '2026-09-01', vehicleId: 'm',
      sequence: seq, orderNo: no, pickupName: name, pickupAddress: addr, projectName: 'Cosmo',
      dropAddress: '1133 Budapest, Hegedűs Gyula utca 53.', items: [] });
    // A felhasználó a Giengert húzta előre: nem a földrajzi optimum.
    c.state.orders = [mk('1', 'Gienger', C, 1), mk('2', 'Szatmári', A, 2), mk('3', 'Merkapt', B, 3)];
    const events = await c.V59Planner.buildManualRouteV55(vehicle);
    assert.deepEqual(events.map(e => e.name), ['Gienger', 'Szatmári', 'Merkapt'],
      'nem a kézi sorrendet követte: ' + events.map(e => e.name).join(' → '));
    assert.deepEqual(c.state.routePlans['2026-09-01'].m.map(e => e.name), ['Gienger', 'Szatmári', 'Merkapt'],
      'az útvonalterv nem a kézi sorrendet tárolja');
    assert.ok(events.every(e => Array.isArray(e.point)), 'hiányzik koordináta');
  });

  await test('Azonos felrakóhely rendelései egy térképi pontba kerülnek', async () => {
    const c = createContext();
    const vehicle = { id: 'm', driverName: 'Márió', type: '3.5 T dobozos autó', active: true };
    c.state.vehicles = [vehicle];
    const A = '1106 Budapest, Maglódi út 14/B';
    c.state.geo[A] = [47.483, 19.145];
    const mk = (no, seq) => ({ id: 'o' + no, scheduleDate: '2026-09-01', vehicleId: 'm', sequence: seq,
      orderNo: no, pickupName: 'Merkapt', pickupAddress: A, projectName: 'Cosmo', dropAddress: '', items: [] });
    c.state.orders = [mk('1', 1), mk('2', 2), mk('3', 3)];
    const events = await c.V59Planner.buildManualRouteV55(vehicle);
    assert.equal(events.length, 1, 'nem egy megállóba vonta össze: ' + events.length);
    assert.equal(events[0].orders.length, 3);
  });

  await test('A csúszka végén a program a kézi tervet építi, csak utána rajzol', async () => {
    const v37 = fs.readFileSync(__dirname + '/planner-v37.js', 'utf8');
    const start = v37.indexOf('onEnd: event => {');
    const body = v37.slice(start, v37.indexOf('\n      }\n    });', start));
    assert.ok(body.includes('buildManualRouteV55'), 'a csúszka nem építi újra a kézi útvonaltervet');
    assert.ok(body.includes('initMaps'), 'a csúszka nem rajzolja újra a térképet');
    assert.ok(body.indexOf('buildManualRouteV55') < body.lastIndexOf('initMaps'),
      'a rajzolás megelőzi a tervépítést, ezért újraoptimalizálna');
  });

  await test('A frissítés nem írja felül a kézi sorrendet', async () => {
    const c = createContext();
    c.state.vehicles = [{ id: 'm', driverName: 'Márió', type: '3.5 T dobozos autó', active: true }];
    const A = '1158.Budapest, Késmárk utca 9', B = '1106 Budapest, Maglódi út 14/B', C = '1225 Budapest, Dűlő utca 31-35.';
    c.state.geo[A] = [47.560, 19.130]; c.state.geo[B] = [47.483, 19.145]; c.state.geo[C] = [47.412, 19.005];
    const mk = (no, name, addr, seq) => ({ id: 'o' + no, scheduleDate: '2026-09-01', vehicleId: 'm', sequence: seq,
      orderNo: no, pickupName: name, pickupAddress: addr, projectName: 'Cosmo', dropAddress: '', items: [] });
    c.state.orders = [mk('1', 'Gienger', C, 1), mk('2', 'Szatmári', A, 2), mk('3', 'Merkapt', B, 3)];
    const before = c.state.orders.map(o => `${o.pickupName}:${o.sequence}`).join(' ');
    c.state.routePlans = {};                       // frissítés: nincs mentett terv
    await c.V59Planner.drawMapV49('m');            // csak rajzolás
    const after = c.state.orders.map(o => `${o.pickupName}:${o.sequence}`).join(' ');
    assert.equal(after, before, 'a rajzolás átírta a sorszámokat: ' + after);
  });

  await test('A rajzolás soha nem hívja a lánc-optimalizálót', async () => {
    const planner = fs.readFileSync(__dirname + '/planner-v44.js', 'utf8');
    const start = planner.indexOf('async function drawMapV49(');
    const body = planner.slice(start, planner.indexOf('\n  }', planner.indexOf('routeStats', start)));
    assert.ok(!body.includes('buildVehicleRouteV49'), 'a drawMapV49 még mindig újraoptimalizál');
    assert.ok(body.includes('buildManualRouteV55'), 'nem a kézi sorrendből épít tartaléktervet');
  });

  await test('A Nézet kompakt sort ad, a főoldali lista változatlan', async () => {
    const v37 = fs.readFileSync(__dirname + '/planner-v37.js', 'utf8');
    assert.ok(v37.includes('function renderCompactUnitV56'), 'nincs kompakt egységsor');
    assert.ok(/if \(focus\) return units\.map/.test(v37), 'a kompakt sor nem csak a Nézetben aktív');
    const start = v37.indexOf('function renderCompactUnitV56');
    const body = v37.slice(start, v37.indexOf('\n  }\n', start));
    assert.ok(body.includes('v56-line-top'), 'hiányzik a felrakó sora');
    assert.ok(!body.includes('v56-line-drop'), 'a lerakó sor összecsukva is látszik');
    assert.ok(body.includes('v56-items-btn'), 'hiányzik a lenyitó gomb');
    assert.ok(body.includes('pickup-move-block'), 'a húzás szelektora elveszett');
    assert.ok(!body.includes('bubble-main-line'), 'a régi három sor bent maradt');
  });

  function focusHtml(c, orders) {
    c.state.vehicles = [{ id: 'm', driverName: 'Márió', active: true }];
    c.state.orders = orders;
    return c.V37Planner.groupedBubbles(orders, 'm', true);
  }
  const mkOrder = (id, no, name, addr, project, items, extra = {}) => Object.assign({
    id, scheduleDate: '2026-09-01', vehicleId: 'm', sequence: id, orderNo: no,
    pickupName: name, pickupAddress: addr, projectName: project, dropAddress: '', items }, extra);

  await test('Minden felrakó pontosan egyszer szerepel, lerakó nélkül', async () => {
    const c = createContext();
    const E = ['Ezerker kp', '1106 Budapest, Kada utca 149.'];
    const html = focusHtml(c, [
      mkOrder(1, '5601', ...E, 'Moxy VUC', [{ name: 'Karima', qty: 4, unit: 'db' }]),
      mkOrder(2, '5602', ...E, 'Kincsem K6', [{ name: 'Idom', qty: 20, unit: 'db' }]),
      mkOrder(3, '5603', ...E, 'Cosmo', [{ name: 'KPE cső', qty: 6, unit: 'szál' }]),
      mkOrder(4, '5604', 'Merkapt kp', '1105 Budapest, Maglódi út 14/B', 'Le Jardin', [{ name: 'Menetesszár', qty: 25, unit: 'db' }])
    ]);
    const rows = (html.match(/v56-line-top/g) || []).length;
    assert.equal(rows, 2, 'négy rendelésből két felrakósornak kell lennie, most: ' + rows);
    assert.ok(!html.includes('v56-line-drop'), 'a lerakó összecsukva is látszik');
    const clean = x => x.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    const tops = [...html.matchAll(/<div class="v56-line-top">([\s\S]*?)<\/div>/g)].map(m => clean(m[1]));
    assert.equal(tops[0], 'Ezerker kp — 1106 Budapest, Kada utca 149.', 'első sor: ' + tops[0]);
    const btns = [...html.matchAll(/<button[^>]*v56-items-btn[^>]*>([\s\S]*?)<\/button>/g)].map(m => clean(m[1]));
    assert.ok(btns[0].startsWith('3 lerakó · 3 tétel'), 'a gomb nem mutatja a rejtett lerakókat: ' + btns[0]);
  });

  await test('A nyíl lenyitja a lerakókat a hozzájuk tartozó tételekkel', async () => {
    const c = createContext();
    const S = ['Szatmári kp', '1158 Budapest, Késmárk utca 9.'];
    const html = focusHtml(c, [
      mkOrder(1, '5601', ...S, 'Moxy VUC', [{ name: 'Karima PN16', qty: 4, unit: 'db' }]),
      mkOrder(2, '5602', ...S, 'Kincsem K6', [{ name: 'Idom 20x3/4', qty: 20, unit: 'db' }])
    ]);
    assert.ok(html.includes('v56-drop-block'), 'nincs lerakó-bontás');
    const clean = x => x.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    const heads = [...html.matchAll(/<div class="v56-drop-head">([\s\S]*?)<\/div>/g)].map(m => clean(m[1]));
    assert.equal(heads.length, 2, 'két lerakónak kell megjelennie, most: ' + heads.length);
    assert.ok(heads[0].startsWith('Moxy VUC'), 'első lerakó: ' + heads[0]);
    assert.ok(html.includes('Karima PN16') && html.includes('Idom 20x3/4'), 'hiányoznak a tételek');
    assert.match(html, /v56-items[^>]*hidden/, 'a lerakólista alapból nyitva van');
  });

  await test('A kompakt sor stílusa bekerült a styles.css-be', async () => {
    const css = fs.readFileSync(__dirname + '/styles.css', 'utf8');
    for (const cls of ['.v56-row', '.v56-line-top', '.v56-items-btn', '.v56-items', '.v56-drop-block']) {
      assert.ok(css.includes(cls), 'hiányzó stílus: ' + cls);
    }
  });

  await test('A kompakt sor a megbeszélt formátumban rendereli a fuvart', async () => {
    const c = createContext();
    c.state.vehicles = [{ id: 'm', driverName: 'Márió', active: true }];
    const mk = (id, no, name, addr, proj, items, extra = {}) => Object.assign({
      id, scheduleDate: '2026-09-01', vehicleId: 'm', sequence: id, orderNo: no,
      pickupName: name, pickupAddress: addr, projectName: proj, dropAddress: '', items }, extra);
    c.state.orders = [
      mk(1, '5601', 'Merkapt kp', '1105 Budapest, Maglódi út 14/B', 'Le Jardin', [{ name: 'Menetesszár', qty: 25, unit: 'db' }]),
      mk(2, '5602', 'Néber', '1037 Budapest, Orbán Balázs út 10.', 'Cosmo', [{ name: 'Karima', qty: 4, unit: 'db' }], { longMaterialReason: '6 méteres szálanyag' })
    ];
    const html = c.V37Planner.groupedBubbles(c.state.orders, 'm', true);
    const clean = x => x.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    const tops = [...html.matchAll(/<div class="v56-line-top">([\s\S]*?)<\/div>/g)].map(m => clean(m[1]));
    const drops = [...html.matchAll(/<div class="v56-line-drop">([\s\S]*?)<\/div>/g)].map(m => clean(m[1]));
    assert.equal(tops[0], 'Merkapt kp — 1105 Budapest, Maglódi út 14/B', 'első sor: ' + tops[0]);
    assert.equal(drops.length, 0, 'a lerakó sor összecsukva is látszik');
    assert.ok(!/kp\s+kp/.test(tops[0]), 'a kp jelölés duplázódik');
    assert.ok(tops[1].includes('szálas'), 'hiányzik a szálas jelölés');
    assert.ok(html.includes('Menetesszár') && html.includes('25 db'), 'a tételek nem kerültek be');
  });

  await test('A Nézet térképe is frissül a kézi átrendezés után', async () => {
    const v37 = fs.readFileSync(__dirname + '/planner-v37.js', 'utf8');
    const start = v37.indexOf('onEnd: event => {');
    const body = v37.slice(start, v37.indexOf('\n      }\n    });', start));
    assert.ok(body.includes('drawFocusMap'), 'a Nézet térképét nem rajzolja újra');
    assert.ok(/if \(focus\)[\s\S]{0,80}drawFocusMap/.test(body), 'a Nézet ága nem hívja a drawFocusMap-et');
    assert.ok(body.indexOf('buildManual') < body.indexOf('drawFocusMap'),
      'a rajzolás megelőzi a tervépítést');
    assert.ok(/else if \(typeof initMaps/.test(body), 'a főoldali térkép frissítése elveszett');
  });

  await test('A Nézet térképe a kézi sorrendet követi tartalékban is', async () => {
    const v37 = fs.readFileSync(__dirname + '/planner-v37.js', 'utf8');
    const start = v37.indexOf('async function drawFocusMap(');
    const body = v37.slice(start, v37.indexOf('\n  }\n', start));
    assert.ok(/sort\(\(a, b\) => \(\+a\.sequence/.test(body),
      'a tartalék útvonal nem sorszám szerint rendez');
    assert.ok(!body.includes('buildVehicleRouteV49'), 'a Nézet térképe újraoptimalizál');
  });

  function itemsCtx() {
    const src = fs.readFileSync(__dirname + '/app.js', 'utf8');
    const ctx = { console, Math, Date, JSON, Set, Map, Array, Object, String, Number, Boolean, RegExp, Error, isNaN, parseFloat, parseInt };
    ctx.globalThis = ctx; ctx.window = ctx;
    ctx.confirms = []; ctx.alerts = [];
    ctx.confirm = m => { ctx.confirms.push(m); return true; };
    ctx.alert = m => { ctx.alerts.push(m); };
    const dlg = { open: true, close() {}, showModal() {} };
    ctx.localStorage = { setItem() {}, getItem: () => null };
    ctx.state = { orders: [], backlog: [] };
    let n = 0; ctx.uid = () => 'gen' + (++n);
    ctx.numericQty = v => { const x = parseFloat(String(v).replace(',', '.')); return isNaN(x) ? 0 : x; };
    ctx.formatQty = v => String(v);
    ctx.itemNoteValue = () => '';
    ctx.ensureItemId = it => { if (!it._id) it._id = ctx.uid(); };
    ctx.validMoveTargetFromInputs = () => ctx.headerDate || '';
    ctx.save = () => {}; ctx.$ = () => dlg;
    vm.createContext(ctx);
    const i = src.lastIndexOf('function moveUncheckedItemsFromDialog');
    const j = src.indexOf('\nfunction ', i + 40);
    vm.runInContext(src.slice(i, j), ctx, { filename: 'move' });
    return ctx;
  }
  const order56 = items => ({ id: 'o1', scheduleDate: '2026-09-01', vehicleId: 'm', orderNo: '5601',
    pickupName: 'Ezerker kp', projectName: 'Cosmo', items });

  function moveCtx() {
    const src = fs.readFileSync(__dirname + '/app.js', 'utf8');
    const ctx = { console: { info() {}, warn() {}, log() {} }, Math, Date, JSON, Set, Map, Array, Object, String, Number, Boolean, RegExp, Error, isNaN, parseFloat, parseInt };
    ctx.globalThis = ctx; ctx.window = ctx;
    ctx.alerts = []; ctx.alert = m => ctx.alerts.push(m); ctx.confirm = () => true;
    ctx.document = { getElementById: () => ({ open: false }) };
    ctx.localStorage = { setItem() {}, getItem: () => null };
    ctx.state = { orders: [], backlog: [], resolvedBacklog: [], routePlans: {}, geo: {} };
    let n = 0; ctx.uid = () => 'g' + (++n);
    ctx.numericQty = v => { const x = parseFloat(String(v).replace(',', '.')); return isNaN(x) ? 0 : x; };
    ctx.formatQty = v => String(v); ctx.itemNoteValue = () => '';
    ctx.ensureItemId = it => { if (!it._id) it._id = ctx.uid(); };
    ctx.save = () => { ctx.reconcileState && ctx.reconcileState('t'); };
    ctx.openItems = () => {}; ctx.$ = () => ({ close() {} });
    ctx.validMoveTargetFromInputs = () => ctx.headerDate || '';
    vm.createContext(ctx);
    for (const name of ['function reconcileState', 'function backlogRecordForItem', 'function rescheduleMovedItem', 'function undoBacklogMove', 'function setItemMoveDate', 'function moveSingleItemToDate', 'function applyMoveDateToAllItems']) {
      const i = src.lastIndexOf(name);
      let j = src.indexOf('\nfunction ', i + 40); if (j < 0) j = src.length;
      vm.runInContext(src.slice(i, j), ctx, { filename: name });
    }
    return ctx;
  }
  const twoItemOrder = () => ({ id: 'o1', scheduleDate: '2026-09-01', vehicleId: 'm', orderNo: '5714',
    pickupName: 'Hungarokomplex', projectName: 'Sofitel', items: [
      { _id: 'i1', name: 'Karima', code: 'K1', qty: 2, unit: 'db', received: false, missingQty: 1 },
      { _id: 'i2', name: 'Idom', code: 'K2', qty: 5, unit: 'db', received: false, missingQty: '' }] });

  await test('A dátum beírása azonnal áthelyezi a tételt', async () => {
    const c = moveCtx();
    c.state.orders = [twoItemOrder()];
    c.setItemMoveDate('o1', 'i1', '2026-09-04');
    const target = c.state.orders.find(o => o.scheduleDate === '2026-09-04');
    assert.ok(target, 'nem jött létre a célnap fuvarja');
    assert.equal(target.items[0].name, 'Karima');
    assert.equal(target.items[0].qty, '1', 'a hiányzó mennyiség ment át');
    assert.equal(c.state.backlog.length, 1, 'nem került a Hátralék fülre');
    assert.equal(c.state.backlog[0].movedToDate, '2026-09-04');
    const src = c.state.orders.find(o => o.scheduleDate === '2026-09-01');
    assert.equal(src.items.find(i => i._id === 'i1').qty, '1', 'a megkapott rész nem maradt');
    assert.equal(src.items.find(i => i._id === 'i1').received, true, 'a megkapott rész nincs kipipálva');
  });

  await test('Két tétel két külön napra ütemezhető egymás után', async () => {
    const c = moveCtx();
    c.state.orders = [twoItemOrder()];
    c.setItemMoveDate('o1', 'i1', '2026-09-04');
    c.setItemMoveDate('o1', 'i2', '2026-09-09');
    const dates = c.state.orders.map(o => o.scheduleDate).sort();
    assert.deepEqual(dates, ['2026-09-01', '2026-09-04', '2026-09-09'], 'napok: ' + dates.join(', '));
    assert.deepEqual(c.state.backlog.map(b => b.movedToDate).sort(), ['2026-09-04', '2026-09-09']);
    const src = c.state.orders.find(o => o.scheduleDate === '2026-09-01');
    assert.equal(src.items.length, 1, 'a teljes egészében átvitt tétel nem került ki az eredeti napról');
  });

  await test('Az eredeti nappal azonos dátumot nem fogadja el', async () => {
    const c = moveCtx();
    c.state.orders = [twoItemOrder()];
    c.setItemMoveDate('o1', 'i1', '2026-09-01');
    assert.equal(c.state.backlog.length, 0, 'áthelyezett az eredeti napra');
    assert.match(c.alerts.join(' '), /nem lehet az eredeti nappal azonos/i);
  });

  await test('Már átvett tételnél a dátum nem indít áthelyezést', async () => {
    const c = moveCtx();
    const o = twoItemOrder(); o.items[0].received = true;
    c.state.orders = [o];
    c.setItemMoveDate('o1', 'i1', '2026-09-04');
    assert.equal(c.state.backlog.length, 0, 'átvett tételt is áthelyezett');
  });

  await test('A "Mindet erre a napra" gomb az összes nyitott tételt viszi', async () => {
    const c = moveCtx();
    c.currentItemsOrderId = 'o1';
    c.headerDate = '2026-09-07';
    c.state.orders = [twoItemOrder()];
    c.applyMoveDateToAllItems();
    assert.equal(c.state.backlog.length, 2, 'nem mind a két tétel ment át');
    assert.deepEqual([...new Set(c.state.backlog.map(b => b.movedToDate))], ['2026-09-07']);
  });

  await test('A tételablak minden sorában van hátralék-dátum mező', async () => {
    const app = fs.readFileSync(__dirname + '/app.js', 'utf8');
    const start = app.lastIndexOf('function openItems(id)');
    const body = app.slice(start, app.indexOf('\nfunction ', start + 40));
    assert.ok(body.includes('item-move-date-input'), 'nincs tételenkénti dátummező');
    assert.ok(body.includes("setItemMoveDate('"), 'a dátummező nem ment');
    assert.ok(body.includes('applyMoveDateAll'), 'nincs "Mindet erre a napra" gomb a fejlécben');
    assert.ok(!body.includes('id="moveItemsBtn"'), 'a felesleges Áthelyezés gomb bent maradt');
    assert.ok(app.includes('function moveSingleItemToDate'), 'hiányzik az egytételes áthelyezés');
    assert.ok(app.includes('function setItemMoveDate'), 'hiányzik a setItemMoveDate');
    assert.ok(app.includes('function applyMoveDateToAllItems'), 'hiányzik az applyMoveDateToAllItems');
  });

  // ---------- V57: integritás ----------
  function integrityCtx() {
    const src = fs.readFileSync(__dirname + '/app.js', 'utf8');
    const ctx = { console: { info() {}, warn() {}, log() {} }, Math, Date, JSON, Set, Map, Array, Object, String, Number, Boolean, RegExp, Error, isNaN, parseFloat, parseInt };
    ctx.globalThis = ctx; ctx.window = ctx;
    ctx.confirm = () => true; ctx.alerts = []; ctx.alert = m => ctx.alerts.push(m);
    ctx.localStorage = { setItem() {}, getItem: () => null };
    ctx.$ = () => ({ open: true, close() {}, showModal() {}, value: '' });
    ctx.state = { orders: [], backlog: [], resolvedBacklog: [], routePlans: {}, routeStats: {}, geo: {} };
    let n = 0; ctx.uid = () => 'g' + (++n);
    ctx.numericQty = v => { const x = parseFloat(String(v).replace(',', '.')); return isNaN(x) ? 0 : x; };
    ctx.formatQty = v => String(v);
    ctx.itemNoteValue = () => '';
    ctx.ensureItemId = it => { if (!it._id) it._id = ctx.uid(); };
    ctx.validMoveTargetFromInputs = () => ctx.headerDate || '';
    ctx.save = () => { ctx.reconcileState('teszt'); };
    ctx.selectedDate = () => '2026-09-01'; ctx.render = () => {};
    vm.createContext(ctx);
    for (const name of ['function reconcileState', 'function moveUncheckedItemsFromDialog', 'function deleteOne']) {
      const i = src.lastIndexOf(name);
      let j = src.indexOf('\nfunction ', i + 40); if (j < 0) j = src.length;
      vm.runInContext(src.slice(i, j), ctx, { filename: name });
    }
    return ctx;
  }
  function orphans(state) {
    const ids = new Set(state.orders.map(o => o.id));
    const items = new Set(state.orders.flatMap(o => (o.items || []).map(i => String(i._id))));
    const bad = [];
    for (const b of state.backlog || []) {
      if (!ids.has(b.targetOrderId)) bad.push('hátralék → nemlétező célfuvar');
      if (b.itemId && !items.has(String(b.itemId))) bad.push('hátralék → nemlétező tétel');
      if (!ids.has(b.sourceOrderId) && !b.orphanSource) bad.push('hátralék → jelöletlen árva forrás');
    }
    for (const r of state.resolvedBacklog || []) if (!ids.has(r.targetOrderId)) bad.push('elintézett → nemlétező fuvar');
    for (const plans of Object.values(state.routePlans || {}))
      for (const events of Object.values(plans || {}))
        for (const ev of events || []) for (const id of ev.orders || []) if (!ids.has(id)) bad.push('útvonalterv → nemlétező fuvar');
    for (const o of state.orders) if (o.movedFromOrderId && !ids.has(o.movedFromOrderId)) bad.push('fuvar → nemlétező forrásfuvar');
    return [...new Set(bad)];
  }
  const srcOrder = () => ({ id: 'o1', scheduleDate: '2026-09-01', vehicleId: 'm', orderNo: '5714',
    pickupName: 'Hungarokomplex', projectName: 'Sofitel', items: [
      { _id: 'i1', name: 'Karima', code: 'K1', qty: 2, unit: 'db', received: false, missingQty: 1, moveTargetDate: '2026-09-03' },
      { _id: 'i2', name: 'Idom', code: 'K2', qty: 5, unit: 'db', received: true, missingQty: '' }] });

  await test('Az eredeti fuvar törlése nem hagy hátralékot a fülön', async () => {
    const c = integrityCtx();
    c.currentItemsOrderId = 'o1'; c.state.orders = [srcOrder()];
    c.moveUncheckedItemsFromDialog();
    assert.equal(c.state.backlog.length, 1, 'nem keletkezett hátralék');
    c.deleteOne('o1');
    assert.deepEqual(orphans(c.state), [], 'árva hivatkozás maradt');
    assert.equal(c.state.backlog.length, 0, 'a hátralék ott maradt a törölt fuvar után');
  });

  await test('Ha a sofőr már átvette, a hátralék megmarad és árvaként jelölődik', async () => {
    const c = integrityCtx();
    c.currentItemsOrderId = 'o1'; c.state.orders = [srcOrder()];
    c.moveUncheckedItemsFromDialog();
    const target = c.state.orders.find(o => o.scheduleDate === '2026-09-03');
    target.items[0].received = true;
    c.deleteOne('o1');
    assert.deepEqual(orphans(c.state), [], 'jelöletlen árva maradt');
    assert.equal(c.state.backlog.length, 1, 'az érintett hátralék eltűnt');
    assert.equal(c.state.backlog[0].orphanSource, true, 'nincs árva jelölés');
  });

  await test('A hátralék célfuvarának törlése takarít', async () => {
    const c = integrityCtx();
    c.currentItemsOrderId = 'o1'; c.state.orders = [srcOrder()];
    c.moveUncheckedItemsFromDialog();
    const target = c.state.orders.find(o => o.scheduleDate === '2026-09-03');
    c.deleteOne(target.id);
    assert.deepEqual(orphans(c.state), []);
    assert.equal(c.state.backlog.length, 0);
  });

  await test('Az útvonalterv nem őriz törölt fuvart', async () => {
    const c = integrityCtx();
    c.state.orders = [srcOrder()];
    c.state.routePlans['2026-09-01'] = { m: [{ type: 'pickup', name: 'Hungarokomplex', orders: ['o1'] }] };
    c.deleteOne('o1');
    assert.deepEqual(orphans(c.state), []);
    assert.equal((c.state.routePlans['2026-09-01'].m || []).length, 0, 'üres megálló maradt');
  });

  await test('A mentés minden alkalommal lefuttatja az integritás-ellenőrzést', async () => {
    const app = fs.readFileSync(__dirname + '/app.js', 'utf8');
    assert.match(app, /function save\(renderNow=true\)\{reconcileState\(/, 'a save nem hívja a reconcileState-et');
    assert.ok(app.includes('function reconcileState'), 'nincs reconcileState');
  });

  // ---------- V57: sofőri oldal ----------
  await test('A sofőri oldal egy sorban mutatja a fuvart', async () => {
    const auth = fs.readFileSync(__dirname + '/auth-v44-2.js', 'utf8');
    const start = auth.indexOf('function userBubble(order, index) {');
    const body = auth.slice(start, auth.indexOf('\n  }\n', start));
    assert.ok(body.includes('v57-row-title'), 'nincs egysoros cím');
    assert.match(body, /orderNo\)\} — \$\{safe\(pickup\)\} — \$\{safe\(drop\)\}/, 'nem a kért formátum');
    assert.ok(body.includes("openItems('"), 'hiányzik a Tétel/hátralék gomb');
    assert.ok(body.includes("openCamera('"), 'hiányzik a Szállítólevél gomb');
    assert.ok(body.includes("openTransferDialog('"), 'hiányzik a Fuvar átadása gomb');
    assert.ok(auth.includes('v57ToggleDriverDetail'), 'nincs lenyitható részlet');
  });

  // ---------- V57: hátralék nézet ----------
  await test('A hátralék nézet napokra bont és kiemeli a megcsúszottakat', async () => {
    const app = fs.readFileSync(__dirname + '/app.js', 'utf8');
    const start = app.lastIndexOf('function renderBacklog()');
    const body = app.slice(start, app.indexOf('\nfunction ', start + 40));
    assert.ok(body.includes('bl-overdue'), 'nincs megcsúszott szekció');
    assert.ok(body.includes('bl-day'), 'nincs napokra bontás');
    assert.ok(body.includes('backlogGroupHtml'), 'nincs beszállítónkénti csoport');
    assert.ok(app.includes('window.markBacklogArrived'), 'nincs Megérkezett gomb kezelője');
    const html = fs.readFileSync(__dirname + '/index.html', 'utf8');
    const backlogSection = html.slice(html.indexOf('<section id="backlog"'), html.indexOf('</section>', html.indexOf('<section id="backlog"')));
    assert.ok(!backlogSection.includes('<table'), 'a régi hátralék-tábla bent maradt');
    assert.ok(!backlogSection.includes('<th>'), 'a régi fejléc bent maradt');
    assert.ok(html.includes('id="backlogBody" class="backlog-list"'), 'nincs listatároló');
  });

  await test('A Megérkezett gomb lezárja a hátralékot és kipipálja a tételt', async () => {
    const c = integrityCtx();
    const src = fs.readFileSync(__dirname + '/app.js', 'utf8');
    for (const name of ['window.markBacklogArrived']) {
      const i = src.indexOf(name);
      const j = src.indexOf('\n};', i) + 3;
      vm.runInContext(src.slice(i, j), c, { filename: name });
    }
    c.state.orders = [{ id: 't1', scheduleDate: '2026-09-03', orderNo: '5714',
      items: [{ _id: 'm1', name: 'Karima', received: false }] }];
    c.state.backlog = [{ id: 'b1', sourceOrderId: 't1', targetOrderId: 't1', itemId: 'm1', name: 'Karima' }];
    c.markBacklogArrived('b1');
    assert.equal(c.state.backlog.length, 0, 'a hátralék nem záródott le');
    assert.equal(c.state.resolvedBacklog.length, 1, 'nem került az elintézettek közé');
    assert.equal(c.state.orders[0].items[0].received, true, 'a tétel nincs kipipálva');
    assert.equal(c.state.orders[0].completed, true, 'a fuvar nem lett kész');
  });

  await test('Az áthelyezett tétel átütemezhető másik napra', async () => {
    const c = moveCtx();
    c.state.orders = [twoItemOrder()];
    c.setItemMoveDate('o1', 'i1', '2026-09-04');
    let t = c.state.orders.find(o => o.scheduleDate === '2026-09-04');
    c.rescheduleMovedItem(t.id, t.items[0]._id, '2026-09-11');
    assert.ok(c.state.orders.some(o => o.scheduleDate === '2026-09-11'), 'nem került át 09-11-re');
    assert.ok(!c.state.orders.some(o => o.scheduleDate === '2026-09-04'), 'az üres 09-04 fuvar bent maradt');
    assert.equal(c.state.backlog.length, 1, 'a hátralék megkettőződött');
    assert.equal(c.state.backlog[0].movedToDate, '2026-09-11', 'a hátralék dátuma nem frissült');
  });

  await test('A téves áthelyezés visszavonható, minden a helyére kerül', async () => {
    const c = moveCtx();
    c.state.orders = [twoItemOrder()];
    c.setItemMoveDate('o1', 'i2', '2026-09-09');
    const t = c.state.orders.find(o => o.scheduleDate === '2026-09-09');
    c.undoBacklogMove(t.id, t.items[0]._id);
    assert.equal(c.state.orders.length, 1, 'maradt üres fuvar: ' + c.state.orders.map(o => o.scheduleDate).join(', '));
    assert.equal(c.state.backlog.length, 0, 'a hátralék nem tűnt el');
    const back = c.state.orders[0].items.find(x => x.name === 'Idom');
    assert.ok(back, 'a tétel nem került vissza');
    assert.equal(back.received, false, 'visszavonás után nem lehet kipipálva');
  });

  await test('A javítás mindkét felületen elérhető', async () => {
    const app = fs.readFileSync(__dirname + '/app.js', 'utf8');
    const start = app.lastIndexOf("$('#itemsBody').innerHTML=");
    const body = app.slice(start, app.indexOf('bindMoveDateParts', start));
    assert.ok(body.includes('rescheduleMovedItem'), 'a tételablakban nincs átütemezés');
    assert.ok(body.includes('undoBacklogMove'), 'a tételablakban nincs visszavonás');
    assert.ok(body.includes('item-grid-head'), 'nincs oszlopfejléc');
    assert.ok(app.includes("class=\"bl-undo\""), 'a Hátralék fülön nincs Vissza gomb');
    assert.ok(app.includes('window.undoBacklogMove'), 'a visszavonás nincs globálisan elérhető');
  });

  await test('A fő dátum nem írja felül a már beállított egyedi napokat', async () => {
    const c = moveCtx();
    c.currentItemsOrderId = 'o1'; c.headerDate = '2026-09-07';
    c.state.orders = [twoItemOrder()];
    c.setItemMoveDate('o1', 'i1', '2026-09-04');
    c.applyMoveDateToAllItems();
    const dates = c.state.backlog.map(b => b.movedToDate).sort();
    assert.deepEqual(dates, ['2026-09-04', '2026-09-07'], 'a fő dátum felülírta az egyedit: ' + dates.join(', '));
  });

  // ---------- V58 ----------
  function renderItems(orders, orderId) {
    const src = fs.readFileSync(__dirname + '/app.js', 'utf8');
    const c = { console, Math, Date, JSON, Set, Map, Array, Object, String, Number, Boolean, RegExp, Error, isNaN, parseFloat, parseInt };
    c.globalThis = c; c.window = c; c.alert = () => {}; c.confirm = () => true;
    c.state = { orders, backlog: [] };
    c.esc = v => String(v == null ? '' : v);
    c.itemNoteValue = () => '';
    let html = '';
    c.$ = () => ({ set innerHTML(v) { html = v; }, open: false, showModal() {}, value: '' });
    c.document = { getElementById: () => ({ open: false }) };
    c.bindV21MoveDateParts = () => {};
    c.ensureItemId = it => { if (!it._id) it._id = 'x'; };
    vm.createContext(c);
    const r = src.lastIndexOf('function backlogRecordForItem');
    vm.runInContext(src.slice(r, src.indexOf('\nfunction ', r + 40)), c, { filename: 'rec' });
    const i = src.lastIndexOf('function openItems(id)');
    vm.runInContext(src.slice(i, src.indexOf('\nwindow.openItems=openItems', i)), c, { filename: 'openItems' });
    c.openItems(orderId);
    return html;
  }
  const rowsOf = html => html.split('class="item-row').slice(1);

  await test('A tételsor alapból letisztult, nem kell végigpipálni', async () => {
    const html = renderItems([{ id: 'o1', scheduleDate: '2026-09-01', orderNo: '5714', items: [
      { _id: 'i1', name: 'Karima PN16', code: 'K1', qty: 2, unit: 'db', received: false, missingQty: '' }] }], 'o1');
    const row = rowsOf(html)[0];
    assert.ok(row.includes('item-shortage-btn'), 'nincs Hiányzik gomb az alapállapotban');
    assert.ok(!row.includes('missing-qty-input'), 'a mennyiségmező alapból látszik');
    assert.ok(!row.includes('item-move-date-input'), 'a dátummező alapból látszik');
    assert.ok(!/class="item-row item-grid done/.test(row), 'alapból átvettnek jelöli');
  });

  await test('A pipa a hiánytalan átvételt jelenti', async () => {
    const html = renderItems([{ id: 'o1', scheduleDate: '2026-09-01', orderNo: '5714', items: [
      { _id: 'i1', name: 'Idom', code: 'K2', qty: 5, unit: 'db', received: true, missingQty: '' }] }], 'o1');
    const row = rowsOf(html)[0];
    assert.match(row, /title="Hiánytalanul megkapta"/, 'a pipa címkéje nem a hiánytalan átvétel');
    assert.ok(row.includes('done'), 'az átvett sor nem szürkül ki');
    assert.ok(!row.includes('item-shortage-btn'), 'átvett tételnél is felkínálja a hiányt');
    assert.ok((row.match(/item-dash/g) || []).length >= 2, 'átvett tételnél maradt szerkeszthető mező');
  });

  await test('A Hiányzik gomb nyitja a mennyiség- és dátummezőt', async () => {
    const html = renderItems([{ id: 'o1', scheduleDate: '2026-09-01', orderNo: '5714', items: [
      { _id: 'i3', name: 'KPE cső', code: 'K3', qty: 6, unit: 'szál', received: false, missingQty: 2, shortageOpen: true }] }], 'o1');
    const row = rowsOf(html)[0];
    assert.ok(row.includes('missing-qty-input'), 'nincs mennyiségmező');
    assert.ok(row.includes('item-move-date-input'), 'nincs dátummező');
    assert.ok(row.includes('Mégsem'), 'nem vonható vissza a hiányjelzés');
    const app = fs.readFileSync(__dirname + '/app.js', 'utf8');
    assert.ok(app.includes('window.openShortage'), 'hiányzik az openShortage');
    assert.ok(app.includes('window.closeShortage'), 'hiányzik a closeShortage');
  });

  await test('Az oldalsávi napválasztó szélesebb lett', async () => {
    const css = fs.readFileSync(__dirname + '/styles.css', 'utf8');
    const m = css.match(/\.planner-nav-date\{display:grid;grid-template-columns:(\d+)px minmax\(0,1fr\) (\d+)px/);
    assert.ok(m, 'nem található a napválasztó rácsa');
    assert.ok(+m[1] <= 28 && +m[2] <= 28, 'a nyilak még mindig szélesek: ' + m[1] + '/' + m[2]);
    const input = css.match(/\.planner-nav-date input\{[^}]*font-size:(\d+)px/);
    assert.ok(input && +input[1] >= 13, 'a dátum betűmérete kicsi maradt: ' + (input && input[1]));
  });

  await test('A hiányzó mennyiség mezője jól látható', async () => {
    const css = fs.readFileSync(__dirname + '/styles.css', 'utf8');
    const grid = [...css.matchAll(/\.item-grid-head,\.item-grid\{[^}]*grid-template-columns:26px minmax\(0,1fr\) (\d+)px (\d+)px/g)].pop()
      || [...css.matchAll(/\.item-grid-head,\.item-grid\{[^}]*grid-template-columns:26px [^;]*?(\d+)px (\d+)px/g)].pop();
    assert.ok(grid, 'nem található a tételrács oszlopdefiníciója');
    assert.ok(+grid[1] >= 120, 'a mennyiség oszlopa túl keskeny: ' + grid[1] + 'px');
    const inp = css.match(/\.item-grid>\.missing-qty-input,\.item-qty-cell \.missing-qty-input\{([^}]*)\}/);
    assert.ok(inp, 'nincs V60 mennyiségmező-szabály');
    const h = inp[1].match(/height:(\d+)px/), f = inp[1].match(/font-size:(\d+)px/);
    assert.ok(h && +h[1] >= 40, 'a mező alacsony: ' + (h && h[1]));
    assert.ok(f && +f[1] >= 18, 'a betű kicsi: ' + (f && f[1]));
    assert.ok(inp[1].includes('width:100%!important'), 'a mező nem tölti ki a cellát');
  });

  await test('A mennyiség mellett látszik a mértékegység és a rendelt darab', async () => {
    const html = renderItems([{ id: 'o1', scheduleDate: '2026-09-01', orderNo: '5714', items: [
      { _id: 'i1', name: 'KPE cső', code: 'K3', qty: 6, unit: 'szál', received: false, missingQty: 2, shortageOpen: true }] }], 'o1');
    const row = rowsOf(html)[0];
    assert.ok(row.includes('item-qty-cell'), 'nincs saját cella a mennyiségnek');
    assert.ok(row.includes('item-qty-unit'), 'nincs mértékegység-felirat');
    assert.match(row, /szál · rendelt: 6/, 'nem látszik a mértékegység és a rendelt mennyiség');
  });

  if (!process.exitCode) console.log(`\nV59 elfogadási teszt: ${passed}/${total} sikeres.`);
})();
