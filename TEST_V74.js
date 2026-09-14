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
  // Az offline geokódoló az app.js-ben él; a motor globálisan hivatkozik rá,
  // ezért a tesztkörnyezetbe is be kell tölteni.
  {
    const app = fs.readFileSync(__dirname + '/app.js', 'utf8');
    vm.runInContext(app.slice(app.indexOf('const BP_DISTRICT_POINTS'), app.indexOf('function seedPoint')), ctx, { filename: 'offlineGeo' });
  }
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

  await test('A motor verziója V74', async () => {
    assert.match(fs.readFileSync(__dirname + '/planner-v44.js', 'utf8'), /const VERSION = '74'/);
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
    await c.V74Planner.distributeOrderSetV44(c.state.orders);
    const driver = c.state.vehicles.find(v => v.id === c.state.orders[0].vehicleId)?.driverName;
    assert.equal(driver, 'Patrik', 'a PRPR nem Patrikhoz került: ' + driver);
    assert.match(String(c.state.orders[0].distributionReason || ''), /PRPR/, 'indoklás: ' + c.state.orders[0].distributionReason);
  });

  await test('A 3 méteres menetesszár nem szálanyag, tehát nem kötelező Martin', async () => {
    const c = createContext();
    assert.equal(c.V74Planner.v53IsLongOrder({ items: [{ name: 'Niczuk Menetesszár M10x3000mm - (25/doboz)' }] }), false);
    assert.equal(c.V74Planner.v53IsLongOrder({ items: [{ name: 'Menetes szál M10x6000mm' }] }), true);
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
    assert.ok(auth.includes('V74Planner?.version'), 'nem a motorból olvassa a verziót');
    assert.ok(auth.includes('data-app-version'), 'a belépés után nem frissíti a fejléc horgonyát');
  });

  await test('A törzsadat exportálható data.js formátumban', async () => {
    const c = createContext();
    const result = c.V74Planner.exportMasterDataV55();
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
    // V69 óta a rajzoló összeveti a mentett tervet az aznapi fuvarokkal, és
    // eltérésnél újraépíti – ezért a fuvaroknak is meg kell lenniük.
    c.state.orders = [
      { id: 'oA', scheduleDate: '2026-09-01', vehicleId: 'm', sequence: 1, orderNo: '1',
        pickupName: 'Szatmári', pickupAddress: A, projectName: 'Cosmo', dropAddress: '', items: [] },
      { id: 'oB', scheduleDate: '2026-09-01', vehicleId: 'm', sequence: 2, orderNo: '2',
        pickupName: 'Merkapt', pickupAddress: B, projectName: 'Cosmo', dropAddress: '', items: [] }];
    c.state.routePlans['2026-09-01'] = { m: [
      { type: 'pickup', name: 'Szatmári', address: A, point: c.state.geo[A], orders: ['oA'] },
      { type: 'pickup', name: 'Merkapt', address: B, point: c.state.geo[B], orders: ['oB'] }
    ] };
    await c.V74Planner.drawMapV49('m');
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
    const events = await c.V74Planner.buildManualRouteV55(vehicle);
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
    const events = await c.V74Planner.buildManualRouteV55(vehicle);
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
    await c.V74Planner.drawMapV49('m');            // csak rajzolás
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
    assert.ok(body.includes('item-date-parts'), 'nincs tételenkénti dátummező');
    assert.ok(app.includes('function bindItemDatePartsV71'), 'a dátummező nem ment');
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
    assert.match(app, /function save\(renderNow=true\)\{stampLocalChanges\(\);reconcileState\(/, 'a save nem hívja a reconcileState-et');
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
    // A tétellista mostantól az itemRowsHtml változóba épül, és csak a végén
    // kerül a DOM-ba, ezért onnan kell vizsgálni.
    const start = app.lastIndexOf('const itemRowsHtml=');
    const body = app.slice(start, app.indexOf('bindV21MoveDateParts', start));
    assert.ok(body.includes('rescheduleMovedItem'), 'a tételablakban nincs átütemezés');
    assert.ok(body.includes('undoBacklogMove'), 'a tételablakban nincs visszavonás');
    assert.ok(body.includes('item-grid-head'), 'nincs oszlopfejléc');
    assert.ok(body.includes('itemRowsHtml'), 'a tétellista nem külön változóba épül');
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
    c.bindV21MoveDateParts = () => {}; c.bindItemDatePartsV71 = () => {};
    c.setDialogSubtitle = () => {};
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
    assert.ok(row.includes('item-date-parts'), 'nincs dátummező');
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

  // ---------- V60 ----------
  await test('A 09.10-i valós nap sorrendje a kézi optimum', async () => {
    const c = createContext();
    c.state.vehicles = [{ id: 'm', driverName: 'Márió', type: '3.5 T dobozos autó', active: true }];
    const stops = [
      ['ISG Uniball', '1173 Budapest, Pesti út 237.'],
      ['Ryng', '1173 Budapest, Flamingó köz 4.'],
      ['Lambda kp', '1117 Budapest, Hengermalom út 47/a'],
      ['Szatmári kp', '1158 Budapest, Késmárk utca 9.'],
      ['Néber', '1037 Budapest, Orbán Balázs út 10.']
    ];
    c.state.orders = stops.map(([name, addr], i) => ({
      id: 'o' + i, scheduleDate: '2026-09-01', vehicleId: 'm', sequence: i + 1, orderNo: '60' + i,
      pickupName: name, pickupAddress: addr, projectName: 'Cosmo',
      dropAddress: '1133 Budapest, Hegedűs Gyula utca 53.', items: [], importVehicleCategory: 'dobozos'
    }));
    await c.V74Planner.buildRoutePlansV44();
    const order = (c.state.routePlans['2026-09-01']?.m || []).filter(e => e.type === 'pickup').map(e => e.name);
    assert.deepEqual(order, ['Néber', 'Szatmári kp', 'Ryng', 'ISG Uniball', 'Lambda kp'],
      'sorrend: ' + order.join(' → '));
  });

  await test('A lánc-kereső hét megállóig pontos optimumot ad', async () => {
    const c = createContext();
    const chain = c.V74Planner.chainOrderV53;
    const KM = (a, b) => Math.hypot((a[0] - b[0]) * 111, (a[1] - b[1]) * 75);
    const len = (seq, st, en) => { let cur = st, t = 0; for (const s of seq) { t += KM(cur, s.point); cur = s.point; } return t + KM(cur, en); };
    const exact = (stops, st, en) => { let best = Infinity; const go = (rest, acc) => { if (!rest.length) { best = Math.min(best, len(acc, st, en)); return; } for (let i = 0; i < rest.length; i++) go([...rest.slice(0, i), ...rest.slice(i + 1)], [...acc, rest[i]]); }; go(stops, []); return best; };
    let seed = 7; const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
    const start = [47.7759, 19.136], end = [47.51, 19.07];
    for (let round = 0; round < 6; round++) {
      const stops = [...Array(6)].map((_, i) => ({ key: 's' + i, point: [47.3 + rnd() * 0.5, 18.8 + rnd() * 0.6] }));
      const got = len(chain(stops.slice(), start, end), start, end);
      const best = exact(stops, start, end);
      assert.ok(got <= best + 1e-6, `nem optimum: ${got.toFixed(1)} km az optimum ${best.toFixed(1)} helyett`);
    }
  });

  await test('Az offline geokódolás minden magyar címre ad koordinátát', async () => {
    const app = fs.readFileSync(__dirname + '/app.js', 'utf8');
    const ctx = { Math, JSON, RegExp, String, Number, Object, Array };
    ctx.norm = v => String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[_.,;:()[\]{}\/\\-]+/g, ' ').replace(/\s+/g, ' ').trim();
    ctx.window = ctx; vm.createContext(ctx);
    vm.runInContext(app.slice(app.indexOf('const BP_DISTRICT_POINTS'), app.indexOf('function seedPoint')), ctx, { filename: 'geo' });
    for (const addr of ['1037 Budapest, Orbán Balázs út 10.', '1158 Budapest, Késmárk utca 9.',
      'Budapest XXII. Kerület, Nagytétényi út 49.', '2045 Törökbálint, Kinizsi Pál u. 28.',
      'Tatabánya, Obi', 'Vác, Deákvári fasor 2.', 'Pilisvörösvár, Budai út 20/C']) {
      const p = ctx.offlineGeo(addr);
      assert.ok(Array.isArray(p) && p.length === 2, 'nincs koordináta: ' + addr);
    }
    assert.equal(ctx.offlineGeo('valami ismeretlen hely'), null, 'ismeretlen címre is adott pontot');
  });

  await test('A koordináta nélküli felrakóról a program szól', async () => {
    const planner = fs.readFileSync(__dirname + '/planner-v44.js', 'utf8');
    assert.ok(planner.includes('lastRouteWarningsV60'), 'nincs figyelmeztetés-gyűjtő');
    assert.match(planner, /nincs koordinátája, ezért kimaradtak/, 'nincs felhasználói üzenet');
    assert.ok(planner.includes('global.offlineGeo'), 'a motor nem használja az offline becslést');
  });

  await test('A húzás utáni sorszámozás a kompakt sorokat is látja', async () => {
    const v37 = fs.readFileSync(__dirname + '/planner-v37.js', 'utf8');
    const start = v37.indexOf('function orderedRouteBlocks(container)');
    const body = v37.slice(start, v37.indexOf('\n  }', start));
    assert.ok(body.includes('child.dataset.orderIds'), 'a kompakt sort nem ismeri fel');
    assert.ok(body.includes('inner.length'), 'nincs visszaesés a régi szerkezetre');
    const css = fs.readFileSync(__dirname + '/styles.css', 'utf8');
    // V73: a fogantyu a SORSZAM lett, kulon gomb nincs
    assert.match(css, /\.v56-index\{[^}]*cursor:grab/, 'a sorszam nem huzhato');
    assert.ok(!css.includes('.v56-drag-cell{'), 'maradt a regi fogantyu stilusa');
  });

  await test('A gipszes megrendelés tétele felismerhető', async () => {
    const c = createContext();
    const lines = ['Sorsz. Termékkód Megnevezés Mennyiség', '1 . EG006 Gipsz 15zsák', 'Összesen: HUF 16 391,25 15zsák'];
    const items = c.V41OutlookImport.parsePdfItemsFromLines(lines);
    assert.equal(items.length, 1, 'nem ismerte fel a tételt: ' + JSON.stringify(items));
    assert.equal(items[0].code, 'EG006');
    assert.equal(items[0].name, 'Gipsz');
    assert.equal(items[0].qty, '15');
    assert.equal(items[0].unit, 'zsák');
  });

  await test('A bővített mértékegység-lista működik, a szál is', async () => {
    const c = createContext();
    const probe = ['1 . K1 KPE cső D63 6 szál', '2 . A5 Hőszigetelő tábla 40 tábla',
      '3 . Z4 Festék 20 l', '4 . E9 Tégla 3 raklap', '5 . F1 Cement 25 kg',
      '6 . G2 Kábel 250 m', '7 . I4 Szög 5 doboz', '8 . J5 Kavics 2 tonna'];
    const items = c.V41OutlookImport.parsePdfItemsFromLines(probe);
    assert.equal(items.length, 8, 'nem mind ismerhető fel: ' + items.map(i => i.name).join(', '));
    const units = items.map(i => i.unit);
    assert.deepEqual(units, ['szál', 'tábla', 'l', 'raklap', 'kg', 'm', 'doboz', 'tonna'], 'egységek: ' + units.join(', '));
    assert.ok(items[0].longMaterial, 'a szálas tétel nincs megjelölve');
  });

  await test('A lerakó lehet beszállítói telephely is (visszáru)', async () => {
    const src = fs.readFileSync(__dirname + '/app.js', 'utf8');
    const c = { console, Math, JSON, String, Number, Object, Array, RegExp, Error };
    c.globalThis = c; c.window = c;
    c.norm = v => String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[_.,;:()[\]{}\/\\-]+/g, ' ').replace(/\s+/g, ' ').trim();
    c.state = {
      projects: [{ id: 'p1', name: 'Budapest_Cosmo_Residence', address: '1133 Budapest, Hegedűs Gyula utca 53.' }],
      suppliers: [
        { id: 's1', name: 'Székely Szerszám Kft', address: '2330 Dunaharaszti, Knézich utca 22', site: 'központ', isCentral: true },
        { id: 's2', name: 'Székely Szerszám Kft', address: '1103 Budapest, Gyömrői út 150.', site: 'Budapest 10. ker.' }]
    };
    vm.createContext(c);
    const i = src.indexOf('function supplierDisplay');
    vm.runInContext(src.slice(i, src.indexOf('\nfunction fillSearchableMasters')), c, { filename: 'masters' });
    const opts = c.dropTargetOptions();
    assert.equal(opts.length, 3, 'nem minden cél jelent meg: ' + opts.length);
    assert.equal(opts.filter(o => o.kind === 'supplier').length, 2, 'a beszállítói telephelyek hiányoznak');
    assert.ok(opts.some(o => /Visszáru/.test(o.hint)), 'nincs visszáru jelölés');
    const hit = c.findDropTargetByInput('Székely Szerszám Kft · 2330 Dunaharaszti, Knézich utca 22');
    assert.equal(hit?.kind, 'supplier');
    assert.equal(hit.address, '2330 Dunaharaszti, Knézich utca 22');
    const proj = c.findDropTargetByInput('Budapest_Cosmo_Residence');
    assert.equal(proj?.kind, 'project', 'a projekt már nem választható');
    const app = fs.readFileSync(__dirname + '/app.js', 'utf8');
    assert.ok(app.includes("target?.kind==='supplier'"), 'az űrlap nem kezeli a beszállítós lerakót');
  });

  const scopeItems = () => ([
    { code: 'EG006', name: 'Gipsz', qty: '15', unit: 'zsák' },
    { code: 'K1', name: 'KPE cső D63', qty: '6', unit: 'szál' },
    { code: 'C9', name: 'Csavar 4x40', qty: '200', unit: 'db' }]);
  const SIGN = '\nKöszönöm!\n\nÜdvözlettel:\nLévai Edina\n+36 70 662 2775';

  await test('A levélszöveg szűkíti a tételeket, ha megnevez egyet', async () => {
    const c = createContext();
    const r = c.V41OutlookImport.applyBodyScopeV60(scopeItems(),
      'Szia Brigi,\n\nÍrd ki kérlek részünkre a rendelésben szereplő gipszet.' + SIGN, '');
    assert.ok(r.narrowed, 'nem szűkített');
    assert.deepEqual(r.items.map(i => i.name), ['Gipsz'], 'tételek: ' + r.items.map(i => i.name).join(', '));
    assert.match(r.note, /csak 1 tétel/, 'nincs magyarázó megjegyzés');
  });

  await test('A hátralékra utaló levél is szűkít, ha megnevezi a tételt', async () => {
    const c = createContext();
    const r = c.V41OutlookImport.applyBodyScopeV60(scopeItems(),
      'Sziasztok,\n\nA korábbi rendelés hátralékát vidd el: KPE cső.' + SIGN, '');
    assert.deepEqual(r.items.map(i => i.name), ['KPE cső D63'], 'tételek: ' + r.items.map(i => i.name).join(', '));
  });

  await test('Bizonytalan levélnél minden tétel bejön, figyelmeztetéssel', async () => {
    const c = createContext();
    for (const [body, mustWarn] of [
      ['Sziasztok,\n\nA hátralékot hozzátok el.' + SIGN, true],
      ['Szia,\n\nCsak a festéket írd ki.' + SIGN, true],
      ['Sziasztok,\n\nRaktári anyagokat vigyétek ki légyszi.' + SIGN, false]]) {
      const r = c.V41OutlookImport.applyBodyScopeV60(scopeItems(), body, '');
      assert.equal(r.items.length, 3, 'nem hozta be mind: ' + body.slice(0, 30));
      assert.equal(!!r.note, mustWarn, 'figyelmeztetés hiányzik vagy felesleges: ' + body.slice(0, 30));
    }
  });

  await test('Az aláírás és az udvariassági rész nem zavarja az elemzést', async () => {
    const c = createContext();
    const text = c.V41OutlookImport.meaningfulBodyText(
      'Szia,\n\nCsak a gipszet kérjük.\n\nKöszönöm!\n\nÜdvözlettel:\nLévai Edina\nProjekt Asszisztens\n+36 70 662 2775');
    assert.ok(text.includes('gipszet'), 'elveszett a lényegi rész');
    assert.ok(!/L[eé]vai|Üdv|\+36/.test(text), 'az aláírás bekerült: ' + text);
  });

  await test('Egytételes bizonylatot a levél nem szűkíthet üresre', async () => {
    const c = createContext();
    const one = [{ code: 'EG006', name: 'Gipsz', qty: '15', unit: 'zsák' }];
    const r = c.V41OutlookImport.applyBodyScopeV60(one, 'Szia,\n\nCsak a festéket írd ki.' + SIGN, '');
    assert.equal(r.items.length, 1, 'kiürítette a tétellistát');
    assert.equal(r.narrowed, false);
  });

  await test('Az importált levél rákerül a fuvarra', async () => {
    const v41 = fs.readFileSync(__dirname + '/planner-v41.js', 'utf8');
    assert.ok(v41.includes('const sourceMail = {'), 'nem őrzi meg a levelet');
    assert.match(v41, /sourceMail: entry\.sourceMail \? \{/, 'a fuvarra nem kerül rá a levél');
    assert.ok(v41.includes("body: String(entry.sourceMail.body || '').slice(0, 6000)"), 'nincs méretkorlát a levélszövegen');
    assert.ok(v41.includes('async function uploadSourceMailFiles'), 'nincs melléklet-feltöltés');
    assert.ok(v41.includes('Outlook forrás'), 'a feltöltés nincs megjelölve');
  });

  await test('A sofőri soron Levél gomb nyitja a levelet', async () => {
    const auth = fs.readFileSync(__dirname + '/auth-v44-2.js', 'utf8');
    const start = auth.indexOf('function userBubble(order, index) {');
    const body = auth.slice(start, auth.indexOf('\n  }\n', start));
    assert.ok(body.includes("openSourceMail('"), 'nincs Csatolmány gomb');
    assert.ok(body.includes('order.sourceMail ?'), 'a gomb levél nélkül is megjelenik');
    assert.ok(auth.includes('async function openSourceMail'), 'nincs levélmegnyitó');
    assert.ok(auth.includes('global.openSourceMail'), 'a megnyitó nincs globálisan elérhető');
    assert.ok(auth.includes('canAccessOrder(orderId)'), 'nincs jogosultság-ellenőrzés');
    const html = fs.readFileSync(__dirname + '/index.html', 'utf8');
    assert.ok(html.includes('id="sourceMailDialog"'), 'nincs levélablak');
    assert.ok(html.includes('id="sourceMailBody"'), 'nincs tartalomtároló');
    assert.ok(html.includes('data-close="sourceMailDialog"'), 'nem zárható be');
    const css = fs.readFileSync(__dirname + '/styles.css', 'utf8');
    for (const cls of ['.mail-body', '.mail-files', '.mail-file', '.mail-action']) {
      assert.ok(css.includes(cls), 'hiányzó stílus: ' + cls);
    }
  });

  await test('A levél szövege hálózat nélkül is elérhető marad', async () => {
    const auth = fs.readFileSync(__dirname + '/auth-v44-2.js', 'utf8');
    const start = auth.indexOf('async function openSourceMail');
    const body = auth.slice(start, auth.indexOf('\n  }\n', start));
    const textIdx = body.indexOf('mail-body');
    const netIdx = body.indexOf('listDeliveryFiles');
    assert.ok(textIdx > 0 && netIdx > textIdx,
      'a levélszöveg csak a hálózati hívás után jelenik meg');
    assert.ok(/catch \(error\)/.test(body), 'a mellékletek hibája megakasztja a megnyitást');
  });

  await test('A sofőri soron a három gomb felirata Tételek, Szállítólevél, Csatolmány', async () => {
    const auth = fs.readFileSync(__dirname + '/auth-v44-2.js', 'utf8');
    const start = auth.indexOf('function userBubble(order, index) {');
    const body = auth.slice(start, auth.indexOf('\n  }\n', start));
    const labels = [...body.matchAll(/>([^<>{]*(?:\$\{[^}]*\})?[^<>]*)<\/button>/g)]
      .map(m => m[1].trim()).filter(x => x && x !== '▾');
    assert.ok(labels[0].startsWith('Tételek'), 'első gomb: ' + labels[0]);
    assert.equal(labels[1], 'Szállítólevél', 'második gomb: ' + labels[1]);
    assert.equal(labels[2], 'Csatolmány', 'harmadik gomb: ' + labels[2]);
    assert.equal(labels[3], 'Fuvar átadása', 'a fuvarátadás megváltozott: ' + labels[3]);
    assert.ok(!/Tétel \/ hátralék|>Levél</.test(body), 'régi felirat maradt');
  });

  function comboCtx() {
    const src = fs.readFileSync(__dirname + '/app.js', 'utf8');
    const c = { console, Math, JSON, String, Number, Object, Array, RegExp, Error, Event };
    c.globalThis = c; c.window = c; c.esc = v => String(v == null ? '' : v);
    c.norm = v => String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[_.,;:()[\]{}\/\\-]+/g, ' ').replace(/\s+/g, ' ').trim();
    c.made = [];
    const node = tag => {
      const e = { tagName: String(tag).toUpperCase(), className: '', dataset: {}, style: {}, hidden: false,
        value: '', innerHTML: '', _h: {}, children: [],
        classList: { add() {}, remove() {}, toggle() {} },
        setAttribute() {}, removeAttribute() {}, getAttribute: () => null,
        addEventListener(k, f) { e._h[k] = f; },
        appendChild(x) { e.children.push(x); return x; },
        insertBefore(x) { e.children.push(x); return x; },
        querySelectorAll: () => [...String(e.innerHTML).matchAll(/data-index="(\d+)"/g)]
          .map(m => ({ dataset: { index: m[1] }, classList: { toggle() {} }, scrollIntoView() {} })),
        querySelector: () => null, remove() {}, dispatchEvent() {}, focus() {}, parentNode: null };
      c.made.push(e); return e;
    };
    c.node = node;
    c.document = { createElement: node, getElementById: () => null, addEventListener() {}, querySelectorAll: () => [] };
    vm.createContext(c);
    const i = src.indexOf('const COMBO_MIN_OPTIONS');
    vm.runInContext(src.slice(i, src.indexOf('function attachDataCombo')), c, { filename: 'combo' });
    const j = src.indexOf('function supplierDisplay');
    vm.runInContext(src.slice(j, src.indexOf('\nfunction fillSearchableMasters')), c, { filename: 'masters' });
    return c;
  }
  const LABELS = ['', 'Budapest_Waterfront_City_V.ütem', 'Budapest_Waterfront_City_IV.ütem',
    'Budapest_Cosmo_Residence', 'Budapest_Moxy_VUC', 'Budapest_Kincsem_K6',
    'Budapest_Sofitel_Hotel', 'Budapest_LeJardin_II_felépítmény', 'Budapest_City_pearl_II.ütem'];
  function comboFor(c, labels = LABELS, value = 'Budapest_Cosmo_Residence') {
    const sel = c.node('select');
    sel.multiple = false; sel.value = value;
    sel.options = labels.map(v => ({ value: v, textContent: v || 'Válassz…', attributes: [] }));
    sel.parentNode = c.node('div');
    c.buildCombo(sel);
    return { sel,
      input: c.made.find(e => e.className === 'combo-input'),
      list: c.made.find(e => e.className === 'combo-list') };
  }
  const hitsOf = list => [...String(list.innerHTML).matchAll(/>([^<]+)<\/button>/g)].map(m => m[1]);

  await test('A beírásra a lenyíló lista élőben szűkül', async () => {
    const c = comboCtx();
    const { input, list } = comboFor(c);
    const type = t => { input.value = t; input._h.input(); return hitsOf(list); };
    assert.deepEqual(type('water'), ['Budapest_Waterfront_City_V.ütem', 'Budapest_Waterfront_City_IV.ütem'],
      'water: ' + type('water').join(', '));
    assert.deepEqual(type('water iv'), ['Budapest_Waterfront_City_IV.ütem'], 'több szavas szűrés nem megy');
    assert.deepEqual(type('cosmo'), ['Budapest_Cosmo_Residence']);
    assert.equal(type('WATER').length, 2, 'nem kis-nagybetű-érzéketlen');
    assert.equal(type('').length, LABELS.length - 1, 'üres keresésnél nem jön minden');
    assert.match(String(list.innerHTML), /combo-option/, 'nem gombokként jelenik meg');
  });

  await test('Nincs találatnál egyértelmű üzenet jelenik meg', async () => {
    const c = comboCtx();
    const { input, list } = comboFor(c);
    input.value = 'zzz'; input._h.input();
    assert.equal(hitsOf(list).length, 0);
    assert.match(String(list.innerHTML), /Nincs találat/, 'nincs visszajelzés');
  });

  await test('A választás az eredeti select értékét állítja', async () => {
    const c = comboCtx();
    const { sel, input, list } = comboFor(c);
    let changed = 0;
    sel.dispatchEvent = () => { changed++; };
    input.value = 'cosmo'; input._h.input();
    const option = list.querySelectorAll()[0];
    list._h.mousedown({ target: { closest: () => ({ dataset: { value: 'Budapest_Cosmo_Residence' } }) }, preventDefault() {} });
    assert.equal(sel.value, 'Budapest_Cosmo_Residence', 'nem állt be az érték');
    assert.ok(changed > 0, 'nem indult change esemény, a meglévő kezelők nem futnak le');
    assert.equal(list.hidden, true, 'a lista nem záródott be');
  });

  await test('A felrakó és lerakó mező is keresős lenyílót kap', async () => {
    const app = fs.readFileSync(__dirname + '/app.js', 'utf8');
    assert.ok(app.includes('function attachDataCombo'), 'nincs törzsadat-lenyíló');
    assert.ok(app.includes("attachDataCombo($('#supplierSearch')"), 'a felrakó mező kimaradt');
    assert.ok(app.includes("attachDataCombo($('#projectSearch')"), 'a lerakó mező kimaradt');
    assert.ok(app.includes("$('#pickupAddress')) $('#pickupAddress').value = item.ref.address"), 'a felrakó címe nem követi a választást');
    assert.ok(app.includes("$('#dropAddress')) $('#dropAddress').value = item.ref.address"), 'a lerakó címe nem követi a választást');
    assert.ok(app.includes('setupMasterCombos()'), 'a törzsadat-mezők nincsenek bekapcsolva');
    const css = fs.readFileSync(__dirname + '/styles.css', 'utf8');
    for (const cls of ['.combo-input', '.combo-list', '.combo-option', '.combo-empty']) {
      assert.ok(css.includes(cls), 'hiányzó stílus: ' + cls);
    }
    assert.ok(!css.includes('.select-filter'), 'a régi szűrőmező stílusa bent maradt');
  });

  await test('A rövid legördülőket nem bonyolítjuk keresővel', async () => {
    const c = comboCtx();
    const { sel } = comboFor(c, ['', 'Márió', 'Patrik'], '');
    assert.notEqual(sel.dataset.combo, '1', 'három elemre is lenyílót tett');
  });

  await test('Az újonnan megjelenő legördülők is bekapcsolódnak', async () => {
    const app = fs.readFileSync(__dirname + '/app.js', 'utf8');
    assert.ok(app.includes('new MutationObserver'), 'nincs figyelő az új elemekre');
    assert.ok(app.includes('window.makeSearchableSelects'), 'nincs globális belépési pont');
    const css = fs.readFileSync(__dirname + '/styles.css', 'utf8');
    assert.ok(css.includes('.combo-input'), 'nincs stílus a keresőmezőhöz');
  });

  await test('A sofőri gombok felirata látható, nem fehér a világos háttéren', async () => {
    const css = fs.readFileSync(__dirname + '/styles.css', 'utf8');
    // Az alap `button` szabály color:#fff-et ad; a sofőri sor gombjai világos
    // hátterűek, ezért ott kifejezetten felül kell írni a betűszínt.
    const main = css.match(/\.v57-row-actions button\{([\s\S]*?)\}/);
    assert.ok(main, 'nincs szabály a sofőri gombokra');
    assert.match(main[1], /color:var\(--ink\)/, 'a gomb betűszíne nincs beállítva: ' + main[1]);
    assert.match(main[1], /background:#fff/, 'megváltozott a gomb háttere');
    for (const cls of ['camera-action', 'transfer-action', 'mail-action']) {
      const rule = css.match(new RegExp('\\.v57-row-actions \\.' + cls + '\\{([^}]*)\\}'));
      assert.ok(rule, 'hiányzó szabály: ' + cls);
      assert.match(rule[1], /color:var\(--ink\)/, cls + ' betűszíne nincs rögzítve');
    }
    const toggle = [...css.matchAll(/\.v57-detail-toggle\{([^}]*)\}/g)].map(m => m[1]).join(' ');
    assert.match(toggle, /color:var\(--ink\)/, 'a lenyitó nyíl színe nincs rögzítve');
  });

  await test('A Tetelek es Szallitolevel ablak cime nagy kezdobetus', async () => {
    const app = fs.readFileSync(__dirname + '/app.js', 'utf8');
    const titles = [...app.matchAll(/(items|camera)Title'\)\.textContent=`\$\{o\.orderNo\} \u00b7 ([^`]+)`/g)]
      .map(m => m[2]);
    assert.ok(titles.includes('T\u00e9telek'), 'a Tetelek cim nem nagy kezdobetus: ' + titles.join(', '));
    assert.ok(titles.includes('Sz\u00e1ll\u00edt\u00f3lev\u00e9l'), 'a Szallitolevel cim nem nagy kezdobetus: ' + titles.join(', '));
    assert.ok(!/\u00b7 t\u00e9telek`/.test(app), 'maradt kisbetus "tetelek" cim');
    assert.ok(!/\u00b7 sz\u00e1ll\u00edt\u00f3lev\u00e9l`/.test(app), 'maradt kisbetus "szallitolevel" cim');
    assert.equal((app.match(/itemsTitle'\)\.textContent=`\$\{o\.orderNo\} \u00b7 T\u00e9telek`/g) || []).length, 3,
      'nem mind a harom helyen javult a cim');
  });

  await test('A kiserleti nagy fejlec maradvanyai eltuntek', async () => {
    for (const file of ['app.js', 'index.html', 'styles.css']) {
      const text = fs.readFileSync(__dirname + '/' + file, 'utf8');
      for (const leftover of ['dialog-title-lg', 'setDialogSubtitle', 'itemsSubtitle', 'cameraSubtitle']) {
        assert.ok(!text.includes(leftover), `${file}: holt kod maradt (${leftover})`);
      }
    }
  });

  await test('A felrako cimmezoje is keresos lenyilo, a ceg telephelyeivel', async () => {
    const app = fs.readFileSync(__dirname + '/app.js', 'utf8');
    assert.ok(app.includes("attachDataCombo($('#pickupAddress'), 'supplierAddressList'"),
      'a cimmezo nem kapott keresos lenyilot');
    const html = fs.readFileSync(__dirname + '/index.html', 'utf8');
    assert.ok(!/list="supplierList"|list="projectList"/.test(html) || app.includes("removeAttribute('list')"),
      'a datalist nincs lekapcsolva');
    // A datalistek futasidoben eltunnek, ezert a regi feltolto nem hasalhat el.
    assert.ok(app.includes("if(!$('#supplierList')||!$('#projectList'))"),
      'a fillSearchableMasters elhasalna a hianyzo datalisten');
    assert.ok(app.includes("const list=$('#supplierAddressList');if(!list)return;"),
      'a fillSupplierAddressList nincs vedve');
  });

  await test('Minden hosszu lista ugyanazt a keresos lenyilot kapja', async () => {
    const app = fs.readFileSync(__dirname + '/app.js', 'utf8');
    // egy kozos epito minden <select>-re, es ugyanaz a minta a torzsadat-mezokre
    assert.ok(app.includes('function buildCombo(select)'), 'nincs kozos lenyilo-epito');
    assert.ok(app.includes('function attachDataCombo'), 'nincs torzsadat-lenyilo');
    assert.ok(app.includes('new MutationObserver'), 'az ujonnan megjeleno listak kimaradnak');
    for (const field of ["$('#supplierSearch')", "$('#pickupAddress')", "$('#projectSearch')"]) {
      assert.ok(app.includes('attachDataCombo(' + field), 'kimaradt: ' + field);
    }
    // a szabad szoveges szurok valtozatlanok maradnak
    const html = fs.readFileSync(__dirname + '/index.html', 'utf8');
    for (const id of ['globalSearch', 'backlogSearch', 'masterSearch', 'orderSearch']) {
      assert.ok(html.includes('id="' + id + '"'), 'eltunt a szabad szoveges kereso: ' + id);
    }
  });

  await test('A Lambda alapbol a Hengermalom utat kapja, nem az Aknat', async () => {
    const c = createContext();
    for (const query of ['Lambda', 'Lambda kp', 'Lambda Systeme Kft.']) {
      const hit = c.V41OutlookImport.bestSupplier(query);
      assert.match(String(hit?.address || ''), /Hengermalom/,
        `${query} -> ${hit?.address || 'nincs'}`);
    }
  });

  await test('A bizonylaton szereplo cim dont a telephelyek kozott', async () => {
    const c = createContext();
    const hengermalom = c.V41OutlookImport.bestSupplier('Szallito: Lambda Systeme Kft 1117 Budapest Hengermalom ut 47/a');
    assert.match(String(hengermalom?.address || ''), /Hengermalom/, 'nem a papiron levo cimet valasztotta');
    const akna = c.V41OutlookImport.bestSupplier('Szallito: Lambda Systeme Kft 1106 Budapest Akna u. 2-4.');
    assert.match(String(akna?.address || ''), /Akna/, 'az Akna cimet sem ismeri fel, ha az all a papiron');
    const merkapt = c.V41OutlookImport.bestSupplier('Szallito: Merkapt Zrt 1106 Budapest Maglodi ut 14/B');
    assert.match(String(merkapt?.address || ''), /Magl/, 'a Merkapt telephelye elromlott');
  });

  await test('A helynevek nem ernek pontot a beszallito-valasztasnal', async () => {
    const v41 = fs.readFileSync(__dirname + '/planner-v41.js', 'utf8');
    const fn = v41.slice(v41.indexOf('function supplierScore'), v41.indexOf('function bestSupplier'));
    assert.ok(fn.includes('PLACE_NOISE'), 'nincs helynev-szuro');
    for (const word of ['budapest', 'ker', 'kerulet', 'telephely']) {
      assert.ok(fn.includes(`'${word}'`), 'kimaradt a zajszavakbol: ' + word);
    }
    assert.ok(fn.includes('significantTokens(supplier.site || supplier.pickupNote || \'\', PLACE_NOISE)'),
      'a telephelynevre nem vonatkozik a szuro');
    assert.ok(/score \+= 25/.test(fn), 'az utcanev-egyezes nem kap donto sulyt');
  });

  await test('A felrako es a lerako lista is mindket fajtat kinalja', async () => {
    const src = fs.readFileSync(__dirname + '/app.js', 'utf8');
    const c = { console, Math, JSON, String, Number, Object, Array, RegExp, Error };
    c.globalThis = c; c.window = c;
    c.norm = v => String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[_.,;:()[\]{}\/\\-]+/g, ' ').replace(/\s+/g, ' ').trim();
    c.state = {
      projects: [{ id: 'p1', name: 'Budapest_Waterfront_City_V.utem', address: '1033 Budapest, Folyamor u. 9-11.' }],
      suppliers: [{ id: 's1', name: 'Szekely Szerszam Kft', address: '2330 Dunaharaszti, Knezich utca 22', site: 'kozpont', isCentral: true }]
    };
    vm.createContext(c);
    // a comboMatch a lenyiló-blokkban él, de a részleges keresés is hívja
    const ci = src.indexOf('function comboMatch');
    vm.runInContext(src.slice(ci, src.indexOf('function closeAllCombos')), c, { filename: 'combo' });
    const i = src.indexOf('function supplierDisplay');
    vm.runInContext(src.slice(i, src.indexOf('\nfunction fillSearchableMasters')), c, { filename: 'masters' });

    const pickup = c.pickupTargetOptions();
    assert.equal(pickup.filter(x => x.kind === 'supplier').length, 1, 'a felrakoban nincs beszallito');
    assert.equal(pickup.filter(x => x.kind === 'project').length, 1, 'a felrakoban nincs projekt (visszaru forras)');
    assert.ok(pickup.find(x => x.kind === 'project').hint.includes('Visszáru'), 'nincs visszaru jeloles a felrakoban');

    const drop = c.dropTargetOptions();
    assert.equal(drop.filter(x => x.kind === 'project').length, 1, 'a lerakoban nincs projekt');
    assert.equal(drop.filter(x => x.kind === 'supplier').length, 1, 'a lerakoban nincs beszallito');

    assert.equal(c.findPickupTargetByInput('waterfront')?.kind, 'project', 'a felrako nem talalja a projektet');
    assert.equal(c.findPickupTargetByInput('szerszam')?.kind, 'supplier', 'a felrako nem talalja a beszallitot');
    assert.equal(c.findDropTargetByInput('szerszam')?.kind, 'supplier', 'a lerako nem talalja a beszallitot');
    assert.equal(c.findDropTargetByInput('waterfront')?.kind, 'project', 'a lerako nem talalja a projektet');
  });

  await test('A felrako mezo lenyiloja a teljes listat hasznalja', async () => {
    const app = fs.readFileSync(__dirname + '/app.js', 'utf8');
    assert.ok(app.includes('attachDataCombo($(\'#supplierSearch\'), \'supplierList\',\n    () => pickupTargetOptions()'),
      'a felrako lenyiloja meg mindig csak beszallitokat mutat');
    assert.ok(app.includes("target?.kind==='project'"), 'a projekt valasztasat nem kezeli a felrako mezo');
  });

  await test('Az Outlook import felrakojaban ott vannak a projektek is', async () => {
    const c = createContext();
    const html = c.V41OutlookImport.supplierNameSelect({});
    assert.match(html, /<optgroup label="Visszáru · projektről"/, 'nincs visszaru csoport a felrakoban');
    assert.match(html, /Waterfront/, 'a projektek nem valaszthatok felrakonak');
    assert.match(html, /data-kind="supplier-name"/, 'elveszett a mezo azonositoja');
  });

  await test('Az Outlook import lerakojaban ott vannak a beszallitok is', async () => {
    const c = createContext();
    const html = c.V41OutlookImport.projectNameSelect({});
    assert.match(html, /<optgroup label="Visszáru · beszállítóhoz"/, 'nincs visszaru csoport a lerakoban');
    assert.match(html, /Szerszám/, 'a beszallitok nem valaszthatok lerakonak');
    assert.match(html, /data-supplier-address="/, 'a beszallito cime nem kerul at');
    assert.match(html, /data-kind="project-name"/, 'elveszett a mezo azonositoja');
  });

  await test('Az import valasztoi a projekteket es beszallitokat elkulonitve mutatjak', async () => {
    const c = createContext();
    const pickup = c.V41OutlookImport.supplierNameSelect({});
    const drop = c.V41OutlookImport.projectNameSelect({});
    // a sajat fajta all elol, a masik az optgroup mogott
    assert.ok(pickup.indexOf('<optgroup') > pickup.indexOf('Válassz beszállítót'), 'a felrakoban a projektek elore kerultek');
    assert.ok(drop.indexOf('<optgroup') > drop.indexOf('Válassz projektet'), 'a lerakoban a beszallitok elore kerultek');
    assert.ok((pickup.match(/<option/g) || []).length > 300, 'kevés elem a felrakoban');
    assert.ok((drop.match(/<option/g) || []).length > 300, 'kevés elem a lerakoban');
  });

  function exportCtx() {
    const src = fs.readFileSync(__dirname + '/app.js', 'utf8');
    const c = { console, Math, Date, JSON, String, Number, Object, Array, RegExp, Error };
    c.globalThis = c; c.window = c;
    c.alert = m => { c.lastAlert = m; };
    c.written = null;
    c.XLSX = {
      utils: {
        aoa_to_sheet: aoa => ({ aoa }),
        book_new: () => ({ Sheets: {}, SheetNames: [] }),
        book_append_sheet: (book, sheet, name) => { book.Sheets[name] = sheet; book.SheetNames.push(name); }
      },
      writeFile: (book, name) => { c.written = { book, name }; }
    };
    c.selectedDate = () => '2026-09-10';
    c.state = { orders: [], vehicles: [] };
    c.activeVehicles = () => c.state.vehicles;
    // a V69 óta az export a Sorrend oszlopot a Nézet felrakósorszámaiból tölti
    c.V37Planner = { focusPickupUnits: list => [...new Set(list.map(o => o.pickupName))]
      .map(name => ({ pickupKey: name, allPickupOrders: list.filter(o => o.pickupName === name) })) };
    vm.createContext(c);
    const i = src.indexOf('/* V63 – EGYETLEN EXPORT');
    vm.runInContext(src.slice(i, src.indexOf('function exportPdf')), c, { filename: 'export' });
    return c;
  }
  const exportOrder = (veh, no, pickup, paddr, project, daddr, note, rname, rphone) => ({
    id: 'o' + no, scheduleDate: '2026-09-10', vehicleId: veh, orderNo: no,
    pickupName: pickup, pickupAddress: paddr, projectName: project, dropAddress: daddr,
    note, recipientName: rname, recipientPhone: rphone, items: [] });

  await test('Az export egyetlen fajlba teszi mindharom sofort', async () => {
    const c = exportCtx();
    c.state.vehicles = [{ id: 'm', driverName: 'Márió' }, { id: 'p', driverName: 'Patrik' }, { id: 't', driverName: 'Martin' }];
    c.state.orders = [
      exportOrder('t', '4100', 'Egrokorr', '2030 Érd, Fehérvári út 63/A', 'Moxy VUC', '1056 Budapest, Molnár u. 36.', '', 'Hergyó Balázs', '70/7951235'),
      exportOrder('p', '4127', 'Ezerker kp', '1106 Budapest, Kada utca 149.', 'Cosmo', '1133 Budapest, Hegedűs Gyula utca 53.', '', 'Fehér Szilárd', '70/4799491'),
      exportOrder('m', '4451', 'Szerelvénybolt kp', '1182 Budapest, Üllői út 807/B', 'City Pearl II.', '1095 Budapest, Soroksári út 58.', 'Patriknak átadni', 'Bandur Norbert', '706622918')
    ];
    c.exportExcel();
    assert.ok(c.written, 'nem keszult fajl');
    assert.equal(c.written.name, 'Szallitasok_2026-09-10.xlsx', 'fajlnev: ' + c.written.name);
    assert.deepEqual(c.written.book.SheetNames, ['Fuvarok'], 'nem egy munkalap keszult');
    const aoa = c.written.book.Sheets.Fuvarok.aoa;
    assert.equal(aoa.length, 4 + 3, 'nem harom adatsor: ' + (aoa.length - 4));
    const drivers = aoa.slice(4).map(r => r[2]);
    assert.deepEqual([...new Set(drivers)].sort((a, b) => a.localeCompare(b, 'hu')),
      ['Márió', 'Martin', 'Patrik'], 'hianyzik sofor: ' + drivers.join(','));
  });

  await test('Az export oszlopai a sablon Fuvarok munkalapjat kovetik', async () => {
    const c = exportCtx();
    c.state.vehicles = [{ id: 'm', driverName: 'Márió' }];
    c.state.orders = [exportOrder('m', '4451', 'Szerelvénybolt kp', '1182 Budapest, Üllői út 807/B',
      'City Pearl II.', '1095 Budapest, Soroksári út 58.', 'Patriknak átadni', 'Bandur Norbert', '706622918')];
    c.exportExcel();
    const aoa = c.written.book.Sheets.Fuvarok.aoa;
    assert.deepEqual(aoa[3], ['Dátum','Sorrend',' ','Felrakó','Felrakó címe','Rendelésszám',
      'mj1','Projekt neve','mj2','Projekt címe','mj3','Megjegyzés','Átvevő'], 'a fejlec elter a sablontol');
    const row = aoa[4];
    assert.equal(row.length, 13, 'nem 13 oszlop: ' + row.length);
    // V69 ota a Sorrend oszlop az alkalmazas felrakosorszamait tartalmazza
    assert.ok(row[1] !== undefined, 'hianyzik a Sorrend oszlop');
    assert.equal(row[2], 'Márió');
    assert.equal(row[3], 'Szerelvénybolt kp');
    assert.equal(row[5], '4451');
    assert.equal(row[6], 'Projekt:', 'hianyzik az allando mj1 felirat');
    assert.equal(row[8], 'Cím:', 'hianyzik az allando mj2 felirat');
    assert.equal(row[10], 'Megjegyzés:', 'hianyzik az allando mj3 felirat');
    assert.equal(row[11], 'Patriknak átadni');
    assert.equal(row[12], 'Bandur Norbert 706622918', 'az atvevo nev+telefon egyben kell');
    assert.ok(row[0] instanceof Date, 'a datum nem valodi datumertek');
  });

  await test('Az export a felrakosorszamot adja, azonos felrakonal ugyanazt', async () => {
    const c = exportCtx();
    c.state.vehicles = [{ id: 'm', driverName: 'Márió' }, { id: 't', driverName: 'Martin' }];
    c.state.orders = [
      exportOrder('t', '3', 'KRPR', 'cim', 'Le Jardin', 'x', '', '', ''),
      exportOrder('m', '1', 'Ezerker kp', 'cim', 'Cosmo', 'x', '', '', ''),
      exportOrder('t', '2', 'KRPR', 'cim', 'Cosmo', 'x', '', '', '')
    ];
    c.exportExcel();
    const body = c.written.book.Sheets.Fuvarok.aoa.slice(4);
    const byPickup = {};
    for (const r of body) (byPickup[r[3]] = byPickup[r[3]] || new Set()).add(r[1]);
    for (const [pickup, seqs] of Object.entries(byPickup)) {
      assert.equal(seqs.size, 1, `${pickup}: egy felrakohoz egy sorszam tartozik, most: ${[...seqs].join(',')}`);
    }
    assert.equal(body.length, 3, 'nem harom sor keszult');
  });

  await test('Ures napon nem keszul fajl', async () => {
    const c = exportCtx();
    c.state.vehicles = [{ id: 'm', driverName: 'Márió' }];
    c.exportExcel();
    assert.equal(c.written, null, 'ures napon is irt fajlt');
    assert.match(String(c.lastAlert || ''), /nincs export/i, 'nem szolt a felhasznalonak');
  });

  const BR0_TEXT = '                                            Belső rendelés\n                                                          2026-BR0/000898\n                                            1/1     példány\n Forrás raktár:                                          Cél raktár:\n            Stand 98 Kft.\n            Központi raktár                                      Budapest_Cosmo_Residence\n            1239 Budapest, Láva u 7.\n E-Mail:                      info@stand98.hu             E-mail:\n Dátum\n 26.09.04.\nSorsz. Termékkód            Megnevezés                                        Mennyiség\n   1 . OSB015               OSB lap 15mm (2500x1250 - 3,125m2/tábla)           12,5m2\n                                       Összesen:                               12,5m2';

  await test('A belso rendeles (BR0) rendelesszama felismerheto', async () => {
    const c = createContext();
    const refs = c.V41OutlookImport.extractOrderRefs(BR0_TEXT, 'x.pdf', 'Raktarkozi_Cosmo_260904_000898_osb', '', '');
    assert.equal(refs.length, 1, 'nem ismerte fel a rendelesszamot: ' + JSON.stringify(refs));
    assert.equal(refs[0].type, 'BR0');
    assert.equal(refs[0].no, '000898');
    assert.equal(refs[0].full, '2026-BR0/000898');
  });

  await test('A BR0 tetele a helyes mennyiseget kapja, nem a nevben levo szamot', async () => {
    const c = createContext();
    const lines = BR0_TEXT.split('\n').map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
    const items = c.V41OutlookImport.parsePdfItemsFromLines(lines);
    assert.equal(items.length, 1, 'nem ismerte fel a tetelt: ' + JSON.stringify(items));
    assert.equal(items[0].code, 'OSB015');
    assert.equal(items[0].qty, '12.5', 'a nevben levo 3,125-ot vette mennyisegnek: ' + items[0].qty);
    assert.equal(items[0].unit, 'm2');
    assert.match(items[0].name, /3,125m2\/tábla\)$/, 'a nev csonkult: ' + items[0].name);
  });

  await test('A mennyiseg a sor utolso szam+egyseg parja', async () => {
    const c = createContext();
    const items = c.V41OutlookImport.parsePdfItemsFromLines([
      '1 . EG006 Gipsz 15zsák',
      '2 . K1 KPE cső D63 6 szál',
      '3 . M10L3000 Niczuk Menetesszár M10x3000mm - (25/doboz) 25 db',
      '4 . OSB015 OSB lap 15mm (2500x1250 - 3,125m2/tábla) 12,5m2']);
    assert.deepEqual(items.map(i => `${i.qty} ${i.unit}`),
      ['15 zsák', '6 szál', '25 db', '12.5 m2'], 'mennyisegek: ' + items.map(i => i.qty + ' ' + i.unit).join(', '));
    assert.equal(items[2].name, 'Niczuk Menetesszár M10x3000mm - (25/doboz)', 'a nev csonkult');
  });

  await test('A BR0 a raktarkozi agon fut: felrako a kozponti raktar', async () => {
    const v41 = fs.readFileSync(__dirname + '/planner-v41.js', 'utf8');
    assert.match(v41, /orderType === 'KRPR' \|\| orderType === 'NRPR' \|\| orderType === 'BR0'/,
      'a BR0 vagy az NRPR nem a raktarkozi agra fut');
    const c = createContext();
    const t = c.V41OutlookImport.extractTransferWarehouses(BR0_TEXT, []);
    assert.match(String(t.target?.name || ''), /Cosmo/, 'a cel hasabot nem ismerte fel: ' + t.target?.name);
    assert.ok(!/Cosmo/.test(String(t.source?.name || '')), 'a forras es a cel felcserelodott');
  });

  await test('A BR0 mindenben egyenerteku a KRPR-rel', async () => {
    const v41 = fs.readFileSync(__dirname + '/planner-v41.js', 'utf8');
    // Minden olyan helyen, ahol a KRPR kulon agat kap, a BR0-nak is ott kell lennie.
    const lines = v41.split('\n');
    const missing = [];
    lines.forEach((line, index) => {
      if (/^\s*(\/\*|\*|\/\/)/.test(line)) return;            // kommentek nem szamitanak
      if (!/'KRPR'/.test(line)) return;
      if (/SR0\|BR0\|KRPR\|PRPR/.test(line)) return;            // a rendelesszam-minta
      if (!/'BR0'/.test(line)) missing.push(`${index + 1}: ${line.trim().slice(0, 70)}`);
    });
    assert.equal(missing.length, 0, 'a BR0 kimaradt innen:\n  ' + missing.join('\n  '));
  });

  await test('A BR0 bizonylat teljes importja helyes', async () => {
    const c = createContext();
    const lines = BR0_TEXT.split('\n').map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
    const entry = c.V41OutlookImport.buildExtractedEntry({
      category: 'megrendeles', sourceName: 'Raktarkozi_Cosmo_260904_000898_osb.msg',
      subject: 'Raktarkozi_Cosmo_260904_000898_osb',
      body: 'Sziasztok!\n\nLegy szives a 4 tabla OSB-t hetfon vigyetek ki a Cosmora.\n\nUdvozlettel:\nUrban Gergely',
      pdfName: 'Raktarkozi_Cosmo_260904_000898_osb.pdf', pdfText: BR0_TEXT,
      pdfLines: lines, pdfRows: [], attachmentNames: [] });
    assert.equal(entry.orderType, 'BR0', 'tipus: ' + entry.orderType);
    assert.equal(entry.orderNo, '000898');
    assert.match(entry.pickupAddress, /Szigetszentmiklós/, 'a felrako nem a kozponti raktar: ' + entry.pickupAddress);
    assert.match(entry.projectName, /Cosmo/, 'a lerako nem a cel oszlopbol jott: ' + entry.projectName);
    assert.match(entry.dropAddress, /Hegedűs Gyula/, 'a lerako cime hianyzik: ' + entry.dropAddress);
    assert.equal((entry.items || []).length, 1, 'nem egy tetel: ' + JSON.stringify(entry.items));
    assert.equal(entry.items[0].qty, '12.5');
    assert.equal(entry.items[0].unit, 'm2');
  });

  const GIENGER_SR0_TEXT = '                                            Szállító rendelés\n                                                          2026-SR0/005968\n                                            1/1     példány\n Vevő:                                                       Szállító:\n              Stand 98 Kft.                                            Gienger Hungária Kft\n              Magyarország\n              Budapest     1239             Láva u 7.                  Budapest\n Raktár:      Budapest_Moxy_VU                                         Dűlő utca 31-35.\n                                                                       1225          Magyarország\n Adószám                     12390360243                      Ügyintéző:      Bárány Tamás\nFizetési mód Fizetési határidő                                Projekt név     Fuvar\nSorsz. Termékkód            Megnevezés                                        Mennyiség\n   1 . KEL001               Ke Kelit KELOX PP-SU Windox T-idom              80 db';

  await test('A Gienger a Dulo utcat kapja, nem a Hatar utat', async () => {
    const c = createContext();
    const hit = c.V41OutlookImport.bestSupplier(GIENGER_SR0_TEXT);
    assert.match(String(hit?.address || ''), /Dűlő utca/,
      'rossz telephely: ' + (hit?.address || 'nincs'));
    assert.ok(!/Határ/.test(String(hit?.address || '')), 'meg mindig a Hatar utat valasztja');
  });

  await test('A "Fizetesi hataridő" felirat nem illik a Hatar uti telephelyre', async () => {
    const v41 = fs.readFileSync(__dirname + '/planner-v41.js', 'utf8');
    const fn = v41.slice(v41.indexOf('function supplierScore'), v41.indexOf('function bestSupplier'));
    // szohatarral kell illeszteni, kulonben a "hatar" beleillik a "hataridő"-be
    assert.match(fn, /new RegExp\(`\\\\b\$\{street\}\\\\b`\)/, 'az utcanev nincs szohatarral illesztve');
    assert.ok(!/sourceNorm\.includes\(street\)/.test(fn), 'maradt szoreszlet-illesztes az utcanevre');
    assert.match(fn, /zip\[1\]/, 'az iranyitoszam nem szamit');
  });

  await test('A cimfelismeres a korabbi eseteken sem romlott el', async () => {
    const c = createContext();
    const cases = [
      ['Lambda', /Hengermalom/], ['Lambda kp', /Hengermalom/],
      ['Gienger', /Dűlő/], ['Merkapt kp', /Magl/], ['Szatmári kp', /Késmárk/],
      ['Szállító: Lambda Systeme Kft 1106 Budapest Akna u. 2-4.', /Akna/],
      ['Szállító: Sebők és Társa Kft Törökbálint Kinizsi utca 28 2045', /Kinizsi/]
    ];
    for (const [query, expect] of cases) {
      const hit = c.V41OutlookImport.bestSupplier(query);
      assert.match(String(hit?.address || ''), expect, `${query} -> ${hit?.address || 'nincs'}`);
    }
  });

  await test('A Fanatik Fatelep kozpontja a budapesti telephely', async () => {
    const c = createContext();
    const rows = c.SEED_DATA.suppliers.filter(x => /fanatik/i.test(x.name));
    assert.equal(rows.length, 2, 'nem ket Fanatik telephely van: ' + rows.length);
    const central = rows.find(x => x.isCentral);
    assert.ok(central, 'nincs kozpontnak jelolt Fanatik telephely');
    assert.equal(central.address, '1239 Budapest, Orbánhegyi dűlő 2.');
    assert.deepEqual(central.point, [47.402, 19.114], 'hianyzik vagy rossz a koordinata');
    assert.ok(rows.every(x => x.active !== false), 'valamelyik Fanatik sor inaktiv');
    const soponya = rows.find(x => !x.isCentral);
    assert.match(soponya.address, /Soponya/, 'a soponyai telephely eltunt');
  });

  await test('A Fanatik alapbol a budapesti kozpontot kapja', async () => {
    const c = createContext();
    for (const query of ['Fanatik', 'Fanatik kp', 'Fanatik Fatelep Kft.']) {
      const hit = c.V41OutlookImport.bestSupplier(query);
      assert.match(String(hit?.address || ''), /Orbánhegyi/, `${query} -> ${hit?.address || 'nincs'}`);
    }
    // ha a papiron a soponyai cim all, azt kell valasztani
    const soponya = c.V41OutlookImport.bestSupplier('Szállító: Fanatik Fatelep Kft Soponya Rózsa utca 2 8123');
    assert.match(String(soponya?.address || ''), /Soponya/, 'a papiron levo cimet nem veszi figyelembe');
  });

  await test('A ket "dulo" cim nem keveredik ossze', async () => {
    const c = createContext();
    const fanatik = c.V41OutlookImport.bestSupplier('Szállító: Fanatik Fatelep Kft Budapest Orbánhegyi dűlő 2. 1239');
    assert.match(String(fanatik?.address || ''), /Orbánhegyi/, 'Fanatik -> ' + fanatik?.address);
    const gienger = c.V41OutlookImport.bestSupplier('Szállító: Gienger Hungária Kft Budapest Dűlő utca 31-35. 1225');
    assert.match(String(gienger?.address || ''), /Dűlő utca/, 'Gienger -> ' + gienger?.address);
  });

  await test('Az importban kezzel felvihetok a tetelek', async () => {
    const v41 = fs.readFileSync(__dirname + '/planner-v41.js', 'utf8');
    assert.ok(v41.includes('data-field="manualItems"'), 'nincs kezi tetelmezo az elonezetben');
    assert.match(v41, /nem sikerult tetelt felismerni|nem sikerült tételt felismerni/i,
      'nincs figyelmezteto felirat, ha nincs felismert tetel');
    assert.ok(v41.includes("manualItems: String(entry.manualItems || '').trim()"),
      'a kezi szoveg nem kerul ra a fuvarra');
    // a mezo a kozos data-field mentesen keresztul tarolodik
    assert.ok(v41.includes("entry[field] = input.value.trim();"), 'a mezo nem mentodik');
  });

  await test('A kezi tetelszoveg mindket feluleten megjelenik', async () => {
    const auth = fs.readFileSync(__dirname + '/auth-v44-2.js', 'utf8');
    // V73 ota a note mezobol jon, a regi manualItems tartalekkent
    assert.ok(auth.includes('[order.note, order.manualItems]'), 'a sofori soron nem latszik');
    assert.ok(auth.includes('v65-manual-note'), 'hianyzik a sofori jeloles');
    const v37 = fs.readFileSync(__dirname + '/planner-v37.js', 'utf8');
    assert.ok(v37.includes('function manualItemsOfGroup'), 'nincs admin oldali osszegzo');
    assert.ok(v37.includes('manualItemsOfGroup(group)'), 'a fooldali buborek nem mutatja');
    assert.ok(v37.includes('manualNotes.length'), 'a Nezet-sor nem mutatja');
    const css = fs.readFileSync(__dirname + '/styles.css', 'utf8');
    assert.ok(css.includes('.v65-manual-note'), 'nincs stilus a kezi tetelekhez');
  });

  await test('A Csatolmany az admin oldalon is megnyithato', async () => {
    const v37 = fs.readFileSync(__dirname + '/planner-v37.js', 'utf8');
    assert.ok(v37.includes("openSourceMail('"), 'az admin oldalon nincs csatolmany gomb');
    assert.ok(v37.includes('order.sourceMail'), 'a gomb level nelkul is megjelenne');
    assert.ok(v37.includes('v56-mail-btn'), 'a Nezet-soron nincs csatolmany gomb');
    const auth = fs.readFileSync(__dirname + '/auth-v44-2.js', 'utf8');
    assert.ok(auth.includes('global.openSourceMail'), 'a megnyito nem globalis');
    // az admin mindenhez hozzafer
    const start = auth.indexOf('function canAccessOrder');
    const body = auth.slice(start, auth.indexOf('\n  }', start));
    assert.ok(body.includes('if (isAdmin()) return true;'), 'az admin nem fer hozza minden fuvarhoz');
  });

  await test('A levelablak a mellekleteket es a kezi teteleket is mutatja', async () => {
    const auth = fs.readFileSync(__dirname + '/auth-v44-2.js', 'utf8');
    const start = auth.indexOf('async function openSourceMail');
    const body = auth.slice(start, auth.indexOf('\n  }\n', start));
    assert.ok(body.includes('order.manualItems'), 'a levelablakban nincs kezi tetel');
    assert.ok(body.includes('listDeliveryFiles'), 'nem tolti be a mellekleteket');
    assert.ok(body.includes('mail-files-title'), 'nincs melleklet-fejlec');
    assert.match(body, /nincsenek feltöltve|nem tartozott melléklet/i, 'nincs visszajelzes melleklet nelkul');
    // V71 óta gomb nyitja, hogy telepített alkalmazásban se blokkolódjon
    assert.ok(body.includes('attachmentLinkV71'), 'a melleklet nem nyithato meg');
  });

  await test('A Nezet-sor jelzi, ha van kezi tetel es csatolmany', async () => {
    const c = createContext();
    c.state.vehicles = [{ id: 'm', driverName: 'Márió', active: true }];
    c.state.orders = [{ id: 1, scheduleDate: '2026-09-01', vehicleId: 'm', sequence: 1,
      orderNo: '000898', pickupName: 'Központi raktár', pickupAddress: '2310 Szigetszentmiklós',
      projectName: 'Cosmo', dropAddress: '', items: [], manualItems: '4 tábla OSB lap',
      sourceMail: { subject: 'Raktárközi', body: '...' } }];
    const html = c.V37Planner.groupedBubbles(c.state.orders, 'm', true);
    assert.match(html, /\+ kézi/, 'a gomb nem jelzi a kezi tetelt');
    assert.ok(html.includes('v56-mail-btn'), 'nincs csatolmany gomb a soron');
    const clean = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    assert.match(clean, /Megjegyzés: 4 tábla OSB lap/, 'a megjegyzes szovege hianyzik');
  });

  await test('A PROCONSUL kozpontja a Porcelan utcai telephely', async () => {
    const c = createContext();
    const rows = c.SEED_DATA.suppliers.filter(x => /proconsul/i.test(x.name));
    assert.equal(rows.length, 2, 'nem ket Proconsul telephely van: ' + rows.length);
    const central = rows.find(x => x.isCentral);
    assert.ok(central, 'nincs kozpontnak jelolt Proconsul telephely');
    assert.equal(central.address, '1106 Budapest, Porcelán u. 3-9.');
    assert.deepEqual(central.point, [47.483, 19.145], 'hianyzik vagy rossz a koordinata');
    const budaors = rows.find(x => !x.isCentral);
    assert.match(budaors.address, /Budaörs/, 'a budaorsi telephely eltunt');
  });

  await test('A Proconsul alapbol a Porcelan utcat kapja', async () => {
    const c = createContext();
    for (const query of ['Proconsul', 'PROCONSUL Kft', 'Proconsul kp']) {
      const hit = c.V41OutlookImport.bestSupplier(query);
      assert.match(String(hit?.address || ''), /Porcelán/, `${query} -> ${hit?.address || 'nincs'}`);
    }
    const budaors = c.V41OutlookImport.bestSupplier('Szállító: PROCONSUL Kft Budaörs Alma utca 12. 2040');
    assert.match(String(budaors?.address || ''), /Budaörs/, 'a papiron levo cimet nem veszi figyelembe');
  });

  await test('Az azonos iranyitoszamu telephelyek nem keverednek', async () => {
    const c = createContext();
    // a Proconsul kozpontja es a Merkapt is 1106-os
    const proconsul = c.V41OutlookImport.bestSupplier('Szállító: PROCONSUL Kft Budapest Porcelán u. 3-9. 1106');
    assert.match(String(proconsul?.address || ''), /Porcelán/, 'Proconsul -> ' + proconsul?.address);
    const merkapt = c.V41OutlookImport.bestSupplier('Szállító: Merkapt Zrt 1106 Budapest Maglódi út 14/B');
    assert.match(String(merkapt?.address || ''), /Magl/, 'Merkapt -> ' + merkapt?.address);
  });

  await test('A kezi tetelszoveg megszunteti a hianyzo tetel jelzest', async () => {
    const c = createContext();
    const base = { orderNo: '000898', pickupName: 'Központi raktár', pickupAddress: '2310 Szigetszentmiklós',
      projectName: 'Cosmo', dropAddress: '1133 Budapest', pickupRole: 'warehouse', supplierId: 'x',
      items: [], warnings: [] };
    const without = { ...base, manualItems: '' };
    c.V41OutlookImport.refreshEntryWarnings(without);
    assert.ok(without.warnings.some(w => /Tételek nem olvashat/.test(w)), 'nincs jelzes tetel nelkul');
    const withNote = { ...base, manualItems: '4 tábla OSB lap' };
    c.V41OutlookImport.refreshEntryWarnings(withNote);
    assert.equal(withNote.warnings.length, 0, 'maradt jelzes: ' + withNote.warnings.join(', '));
  });

  await test('A kezi szoveg NEM alakul tetelle', async () => {
    const v41 = fs.readFileSync(__dirname + '/planner-v41.js', 'utf8');
    assert.ok(!v41.includes('manualItemsAsItems'), 'maradt tetelle alakitas');
    assert.ok(v41.includes("items: (entry.items || []).map("), 'a tetellista nem az eredeti');
    assert.ok(v41.includes("manualItems: String(entry.manualItems || '').trim()"),
      'a kezi szoveg nem kerul ra a fuvarra');
  });

  function itemsHtml(items, note) {
    const src = fs.readFileSync(__dirname + '/app.js', 'utf8');
    const c = { console, Math, Date, JSON, String, Number, Object, Array, RegExp, Error };
    c.globalThis = c; c.window = c; c.alert = () => {}; c.confirm = () => true;
    c.state = { orders: [{ id: 'o1', scheduleDate: 'd', orderNo: '000898', items, manualItems: note }], backlog: [] };
    c.esc = v => String(v == null ? '' : v);
    c.itemNoteValue = () => '';
    let html = '';
    c.$ = () => ({ get innerHTML() { return html; }, set innerHTML(v) { html = v; }, open: false, showModal() {}, value: '' });
    c.document = { getElementById: () => ({ open: false }) };
    c.bindV21MoveDateParts = () => {}; c.bindItemDatePartsV71 = () => {}; c.ensureItemId = () => {};
    vm.createContext(c);
    let i = src.lastIndexOf('function backlogRecordForItem');
    vm.runInContext(src.slice(i, src.indexOf('\nfunction ', i + 40)), c, { filename: 'rec' });
    i = src.lastIndexOf('function openItems(id)');
    vm.runInContext(src.slice(i, src.indexOf('\nwindow.openItems=openItems', i)), c, { filename: 'openItems' });
    c.openItems('o1');
    return html;
  }
  const flat = x => x.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

  await test('A megjegyzes a Tetelek ablakban is latszik', async () => {
    const html = itemsHtml([{ _id: 'i1', name: 'Gipsz', code: 'EG006', qty: 15, unit: 'zsák', received: false }],
      'Raktárosnál jelentkezni');
    assert.ok(html.includes('v65-manual-note'), 'nincs megjegyzes a Tetelek ablakban');
    assert.match(flat(html), /^Megjegyzés: Raktárosnál jelentkezni/, 'a megjegyzes nem elol all');
    assert.ok(flat(html).includes('Gipsz'), 'elveszett a tetel');
  });

  await test('Tetel nelkuli feladatnal a megjegyzes all a lista helyen', async () => {
    const html = itemsHtml([], 'Le kell szerelni a bérelt állványt és visszahozni');
    assert.match(flat(html), /Megjegyzés: Le kell szerelni/, 'nem latszik a feladat');
    assert.ok(!flat(html).includes('Nincs tétel'), 'a "Nincs tetel" felirat feleslegesen megjelent');
    assert.ok(!html.includes('item-grid-head'), 'ures oszlopfejlec maradt');
  });

  await test('Sem tetel, sem megjegyzes eseten a regi uzenet marad', async () => {
    const html = itemsHtml([], '');
    assert.match(flat(html), /Nincs tétel/, 'eltunt a "Nincs tetel" uzenet');
    assert.ok(!html.includes('v65-manual-note'), 'ures megjegyzes-doboz jelent meg');
  });

  await test('A megjegyzes felirata mindket feluleten azonos', async () => {
    const auth = fs.readFileSync(__dirname + '/auth-v44-2.js', 'utf8');
    const v37 = fs.readFileSync(__dirname + '/planner-v37.js', 'utf8');
    const app = fs.readFileSync(__dirname + '/app.js', 'utf8');
    for (const [name, text] of [['auth-v44-2.js', auth], ['planner-v37.js', v37], ['app.js', app]]) {
      assert.ok(text.includes('<b>Megjegyzés:</b>'), name + ': nem "Megjegyzés:" a felirat');
      assert.ok(!/Felveendő:|Kézzel felvitt tételek:/.test(text), name + ': regi felirat maradt');
    }
  });

  await test('A tetel hianya NEM blokkolja az importot', async () => {
    const c = createContext();
    const ok = c.V41OutlookImport.blockingFields({
      sourceOrderNos: ['000898'], pickupName: 'KRPR', projectName: 'Cosmo', items: [], manualItems: '' });
    assert.deepEqual(ok, [], 'a tetel hianya blokkol: ' + ok.join(', '));
    const withNote = c.V41OutlookImport.blockingFields({
      sourceOrderNos: ['000898'], pickupName: 'KRPR', projectName: 'Cosmo', items: [], manualItems: '4 tábla OSB' });
    assert.deepEqual(withNote, []);
  });

  await test('Csak harom adat kotelezo, es a program megnevezi oket', async () => {
    const c = createContext();
    assert.deepEqual(c.V41OutlookImport.blockingFields({ sourceOrderNos: [], pickupName: 'KRPR', projectName: 'Cosmo' }),
      ['rendelésszám']);
    assert.deepEqual(c.V41OutlookImport.blockingFields({ sourceOrderNos: ['1'], pickupName: '', projectName: 'Cosmo' }),
      ['felrakó']);
    assert.deepEqual(c.V41OutlookImport.blockingFields({ sourceOrderNos: ['1'], pickupName: 'KRPR', projectName: '' }),
      ['lerakó/projekt']);
    assert.deepEqual(c.V41OutlookImport.blockingFields({ sourceOrderNos: [], pickupName: '', projectName: '' }),
      ['rendelésszám', 'felrakó', 'lerakó/projekt']);
  });

  await test('A hiany az elonezeten es a zaro uzenetben is megjelenik', async () => {
    const v41 = fs.readFileSync(__dirname + '/planner-v41.js', 'utf8');
    assert.ok(v41.includes('v65-blocking'), 'az elonezeten nincs blokkolas-jelzes');
    assert.match(v41, /Nem importálható – hiányzik/, 'nincs egyertelmu felirat a kartyan');
    assert.match(v41, /skipped\.push\(`\$\{entry\.sourceName\}: hiányzik – /, 'a kihagyas oka nincs megnevezve');
    assert.match(v41, /KIHAGYVA \(\$\{skipped\.length\}\)/, 'a zaro uzenet nem sorolja fel a kihagyottakat');
    assert.ok(!/Kihagyva: \$\{skipped\.length\}`/.test(v41), 'maradt a regi, semmitmondo uzenet');
    const css = fs.readFileSync(__dirname + '/styles.css', 'utf8');
    assert.ok(css.includes('.v65-blocking'), 'nincs stilus a blokkolas-jelzeshez');
  });

  await test('Kotojel a rendelesszam helyen atengedi az importot', async () => {
    const c = createContext();
    const base = { pickupName: 'KRPR', projectName: 'Cosmo', sourceOrderNos: [] };
    assert.deepEqual(c.V41OutlookImport.blockingFields({ ...base, orderNo: '' }), ['rendelésszám'],
      'ures rendelesszamnal nem jelez');
    for (const dash of ['-', '–', '—', '  -  ', '--']) {
      assert.deepEqual(c.V41OutlookImport.blockingFields({ ...base, orderNo: dash }), [],
        `a kotojel nem engedi at: ${JSON.stringify(dash)}`);
    }
    assert.equal(c.V41OutlookImport.orderNoWaived({ orderNo: '-' }), true);
    assert.equal(c.V41OutlookImport.orderNoWaived({ orderNo: '0' }), false, 'a nulla nem kotojel');
    assert.equal(c.V41OutlookImport.orderNoWaived({ orderNo: '' }), false, 'az ures mezo nem kotojel');
  });

  await test('A kotojel csak a rendelesszamot engedi el, a tobbit nem', async () => {
    const c = createContext();
    assert.deepEqual(
      c.V41OutlookImport.blockingFields({ orderNo: '-', pickupName: '', projectName: 'Cosmo', sourceOrderNos: [] }),
      ['felrakó'], 'a felrako hianyat is elengedte');
    assert.deepEqual(
      c.V41OutlookImport.blockingFields({ orderNo: '-', pickupName: 'KRPR', projectName: '', sourceOrderNos: [] }),
      ['lerakó/projekt'], 'a lerako hianyat is elengedte');
  });

  await test('A kotojeles fuvarok nem olvadnak ossze', async () => {
    const c = createContext();
    const a = c.V41OutlookImport.importIdentity({ _id: 'e1', orderNo: '-', sourceOrderNos: [], orderType: 'SR0' });
    const b = c.V41OutlookImport.importIdentity({ _id: 'e2', orderNo: '-', sourceOrderNos: [], orderType: 'SR0' });
    assert.notEqual(a, b, 'ket rendelesszam nelkuli fuvar egy azonositot kapott: ' + a);
  });

  await test('A hianyzo rendelesszamnal a program elarulja a kiutat', async () => {
    const v41 = fs.readFileSync(__dirname + '/planner-v41.js', 'utf8');
    assert.match(v41, /írj be egy kötőjelet/, 'nincs utmutatas a kartyan');
    assert.ok(v41.includes('v66-waived'), 'nincs jelzes a kotojeles allapotrol');
    assert.ok(v41.includes('function orderNoWaived'), 'hianyzik a kotojel-felismero');
    const css = fs.readFileSync(__dirname + '/styles.css', 'utf8');
    assert.ok(css.includes('.v66-waived'), 'nincs stilus a jelzeshez');
  });

  await test('A kotojel a figyelmeztetest is megszunteti', async () => {
    const c = createContext();
    const entry = { orderNo: '-', pickupName: 'KRPR', pickupAddress: 'cim', supplierId: 'x',
      pickupRole: 'warehouse', projectName: 'Cosmo', dropAddress: 'cim', items: [],
      manualItems: 'feladat', warnings: [] };
    c.V41OutlookImport.refreshEntryWarnings(entry);
    assert.ok(!entry.warnings.some(w => /Rendelésszám/i.test(w)),
      'maradt rendelesszam-figyelmeztetes: ' + entry.warnings.join(', '));
  });

  // ---------- V70 ----------
  await test('A datumvaltas nem all vissza: idobelyeg szerint fesulunk', async () => {
    const src = fs.readFileSync(__dirname + '/auth-v44-2.js', 'utf8');
    const c = { console: { info() {}, warn() {} }, Date, Map, Set, Number, String, Object, Array, JSON, Math };
    c.globalThis = c; vm.createContext(c);
    const i = src.indexOf('function orderStampV70');
    vm.runInContext(src.slice(i, src.indexOf('  async function initialOnlineLoad')), c, { filename: 'merge' });

    const local = [
      { id: 'a', scheduleDate: '2026-09-11', localUpdatedAt: '2026-09-11T08:00:00Z' },
      { id: 'b', scheduleDate: '2026-09-10', localUpdatedAt: '2026-09-11T08:00:00Z' },
      { id: 'c', scheduleDate: '2026-09-12' }];
    const remote = [
      { id: 'a', scheduleDate: '2026-09-12', updated_at: '2026-09-11T07:00:00Z' },
      { id: 'b', scheduleDate: '2026-09-10', updated_at: '2026-09-11T09:00:00Z' },
      { id: 'd', scheduleDate: '2026-09-13', updated_at: '2026-09-11T09:00:00Z' }];
    const r = c.mergeOrdersByTimestampV70(local, remote);
    const byId = Object.fromEntries(r.orders.map(o => [o.id, o.scheduleDate]));
    assert.equal(byId.a, '2026-09-11', 'a helyben frissebb datum visszaallt a regire');
    assert.equal(byId.b, '2026-09-10', 'a szerveroldali frissebb rekord nem nyert');
    assert.equal(byId.c, '2026-09-12', 'a csak helyben letezo fuvar elveszett');
    assert.equal(byId.d, '2026-09-13', 'a csak szerveren letezo fuvar elveszett');
    assert.deepEqual([...r.keptLocalIds].sort(), ['a', 'c']);
  });

  await test('A betoltes nem irja felul vakon a helyi allapotot', async () => {
    const auth = fs.readFileSync(__dirname + '/auth-v44-2.js', 'utf8');
    const start = auth.indexOf('async function initialOnlineLoad');
    const body = auth.slice(start, auth.indexOf('\n  async function logout', start));
    assert.ok(body.includes('mergeOrdersByTimestampV70'), 'nincs osszefesules');
    assert.ok(!/\}\s*else\s*\{\s*state\.orders = remoteOrders; state\.backlog = remoteBacklog;\s*\}\s*\n\s*if \(typeof save/.test(body),
      'maradt a feltetel nelkuli felulirás');
    assert.ok(auth.includes('function flushPendingSyncV70'), 'nincs azonnali mentes oldalelhagyaskor');
    assert.ok(auth.includes("'pagehide'") && auth.includes("'visibilitychange'"), 'nincs bekotve a kilepesi esemeny');
    const app = fs.readFileSync(__dirname + '/app.js', 'utf8');
    assert.ok(app.includes('function stampLocalChanges'), 'nincs idobelyegzes mentesnel');
    assert.match(app, /function save\(renderNow=true\)\{stampLocalChanges\(\);/, 'a save nem belyegez');
  });

  await test('A mobil bezaro es kilepes gomb elerheto meretu', async () => {
    const css = fs.readFileSync(__dirname + '/styles.css', 'utf8');
    assert.match(css, /\.close\{width:48px!important;height:48px!important/, 'a bezaro gomb kicsi maradt');
    assert.match(css, /#accountLogout\{min-height:44px/, 'a kilepes gomb kicsi maradt');
    assert.ok(css.includes('env(safe-area-inset-right)'), 'nincs biztonsagos margo a kepernyo szelen');
    assert.match(css, /\.dialog-head\{margin:-14px -12px 12px/, 'a fejlec meg mindig a szelig log');
  });

  await test('A Nezet csuszkaja kulon rekeszben, a Csatolmany utan all', async () => {
    const c = createContext();
    c.state.vehicles = [{ id: 'm', driverName: 'Márió', active: true }];
    c.state.orders = [{ id: 1, scheduleDate: '2026-09-01', vehicleId: 'm', sequence: 1, orderNo: '5601',
      pickupName: 'Merkapt kp', pickupAddress: '1106 Budapest, Maglódi út 14B', projectName: 'Cosmo',
      dropAddress: '', items: [], sourceMail: { subject: 'x', body: 'y' } }];
    const html = c.V37Planner.groupedBubbles(c.state.orders, 'm', true);
    // V73: a kulon fogantyugomb megszunt, a SORSZAM a fogantyu
    const order = [...html.matchAll(/class="(v56-index[^"]*|v56-items-btn|v56-mail-btn)"/g)].map(m => m[1]);
    assert.equal(order[0], 'v56-index drag', 'a sorszam nem a fogantyu: ' + order.join(' → '));
    assert.ok(!html.includes('v56-drag-cell'), 'maradt kulon fogantyugomb');
    const css = fs.readFileSync(__dirname + '/styles.css', 'utf8');
    assert.match(css, /\.v56-index\{[^}]*cursor:grab/, 'a sorszam nem foghato');
  });

  await test('A mentett fotok es az Outlook-csatolmanyok szetvalnak', async () => {
    const online = fs.readFileSync(__dirname + '/online-v44-2.js', 'utf8');
    assert.ok(online.includes('is_source_mail'), 'a fajllista nem jeloli a forrasmellekletet');
    assert.ok(online.includes('delivery_reports?'), 'nem kerdezi le a jelentes megjegyzeset');
    const auth = fs.readFileSync(__dirname + '/auth-v44-2.js', 'utf8');
    const gallery = auth.slice(auth.indexOf('async function openMediaGallery'), auth.indexOf('global.openMediaGallery'));
    assert.ok(gallery.includes('!file.is_source_mail'), 'a Mentett fotok kozott ott vannak a levelmellekletek');
    const mail = auth.slice(auth.indexOf('async function openSourceMail'), auth.indexOf('global.openSourceMail'));
    assert.ok(mail.includes('is_source_mail'), 'a Csatolmany nem szuri a forrasmellekleteket');
  });

  await test('A hazszamok egybeirva keresnek es jelennek meg', async () => {
    const src = fs.readFileSync(__dirname + '/app.js', 'utf8');
    const c = { console, String, RegExp }; c.globalThis = c; vm.createContext(c);
    const i = src.indexOf('function joinHouseNumber');
    vm.runInContext(src.slice(i, src.indexOf('function last5')), c, { filename: 'norm' });
    const a = c.norm('1106 Budapest, Maglódi út 14/B');
    assert.equal(a, c.norm('1106 Budapest, Maglódi út 14 B'), 'a szokozos alak mast ad');
    assert.equal(a, c.norm('1106 Budapest, Maglódi út 14B'), 'az egybeirt alak mast ad');
    assert.match(a, /14b$/, 'nem vonta ossze a hazszamot: ' + a);
    // a tartomanyos hazszamot nem szabad elrontani
    assert.match(c.norm('Gyömrői út 156-158'), /156 158$/, 'a tartomany elromlott');
  });

  await test('A torzsadatban nincs tobbe per-jeles hazszam', async () => {
    const c = createContext();
    const rows = [...c.SEED_DATA.suppliers, ...c.SEED_DATA.projects];
    const bad = rows.filter(row => /\d+\s*\/\s*[A-Za-z]\b/.test(row.address || ''));
    assert.equal(bad.length, 0, 'maradt per-jeles cim: ' + bad.slice(0, 3).map(r => r.address).join(' | '));
    const merkapt = rows.find(row => /merkapt/i.test(row.name || '') && /maglódi/i.test(row.address || ''));
    assert.ok(merkapt, 'nincs meg a Merkapt Maglodi uti cime');
    assert.match(merkapt.address, /14B/, 'a Merkapt cime nem egybeirt: ' + merkapt.address);
  });

  // ---------- V71 ----------
  await test('A raktarkozi bizonylat egy rendelesszamot ad, nem harmat', async () => {
    const c = createContext();
    const text = [
      'Raktárközi', '2026-KRPR/000872', 'Forrás raktár:', 'Stand 98 Kft.',
      'Rendelés:  2026-BR0/000921   26.09.10.',
      ' 1 . STY-533 Styron Mosdószifon 3 db',
      'Rendelés:  2026-BR0/000922   26.09.10.',
      ' 2 . Pestan HT-PP Könyök 30 db'
    ].join('\n');
    const refs = c.V41OutlookImport.extractOrderRefs(text, 'x.pdf', '260910_KRPR_Cosmo_000872', '', '');
    assert.equal(refs.length, 1, 'nem egy rendelesszam: ' + refs.map(r => r.full).join(', '));
    assert.equal(refs[0].full, '2026-KRPR/000872');
    assert.ok(!refs.some(r => r.type === 'BR0'), 'a forras-hivatkozas bekerult');
  });

  await test('A bizonylat sajat tipusa a fejlecbol jon', async () => {
    const c = createContext();
    const H = c.V41OutlookImport.headerOrderTypeV71;
    assert.equal(H('Raktárközi\n2026-KRPR/000872\nRendelés: 2026-BR0/000921\n 1 . X 1 db',
      [{ type: 'KRPR' }, { type: 'BR0' }]), 'KRPR');
    // a valodi BR0 bizonylat fejlecében BR0 all – azt meg kell tartani
    assert.equal(H('Belső rendelés\n2026-BR0/000898\nForrás raktár:\n 1 . OSB015 OSB 12,5m2',
      [{ type: 'BR0' }]), 'BR0');
  });

  await test('A tobbi bizonylattipus valtozatlan marad', async () => {
    const c = createContext();
    const run = text => c.V41OutlookImport.extractOrderRefs(text, 'x.pdf', 'x', '', '').map(r => r.full);
    assert.deepEqual(run('Szállító rendelés\n2026-SR0/005959\nVevő:\n 1 . EG006 Gipsz 15zsák'),
      ['2026-SR0/005959'], 'az SR0 elromlott');
    assert.deepEqual(run('Belső rendelés\n2026-BR0/000898\nForrás raktár:\n 1 . OSB015 OSB 12,5m2'),
      ['2026-BR0/000898'], 'a BR0 elromlott');
    assert.deepEqual(run('Raktárközi\n2026-PRPR/000123\nForrás raktár:\n 1 . Z Valami 1 db'),
      ['2026-PRPR/000123'], 'a PRPR elromlott');
    // ket VALODI raktarkozi egy fajlban tovabbra is ket sor
    assert.deepEqual(run('Raktárközi\n2026-KRPR/000500\nRaktárközi\n2026-KRPR/000501\n 1 . X 1 db'),
      ['2026-KRPR/000500', '2026-KRPR/000501'], 'a valodi tobbrendeleses bizonylat elveszett');
  });

  await test('A cegnev megadasa a KOZPONTI telephelyet adja', async () => {
    const src = fs.readFileSync(__dirname + '/app.js', 'utf8');
    const c = { console, Math, JSON, String, Number, Object, Array, RegExp, Error };
    c.globalThis = c; c.window = c;
    vm.createContext(c);
    vm.runInContext(fs.readFileSync(__dirname + '/data.js', 'utf8'), c);
    let i = src.indexOf('function joinHouseNumber');
    vm.runInContext(src.slice(i, src.indexOf('function last5')), c, { filename: 'norm' });
    c.state = { projects: c.SEED_DATA.projects.map((p, k) => ({ ...p, id: 'p' + k })),
      suppliers: c.SEED_DATA.suppliers.map((s2, k) => ({ ...s2, id: 's' + k })) };
    i = src.indexOf('function comboMatch');
    vm.runInContext(src.slice(i, src.indexOf('function closeAllCombos')), c, { filename: 'combo' });
    i = src.indexOf('function supplierDisplay');
    vm.runInContext(src.slice(i, src.indexOf('\nfunction fillSearchableMasters')), c, { filename: 'masters' });

    for (const [name, expect] of [
      ['Lambda Systeme Kft.', /Hengermalom/], ['Szatmári Kft', /Késmárk/],
      ['Gienger Hungária Kft', /Dűlő/], ['PROCONSUL Kft', /Porcelán/],
      ['Merkapt Zrt.', /Maglódi/]]) {
      const hit = c.findSupplierByInput(name);
      assert.match(String(hit?.address || ''), expect, `${name} -> ${hit?.address || 'nincs'}`);
    }
    // a cim megadasa erosebb marad
    const akna = c.findSupplierByInput('Lambda Systeme Kft. · 1106 Budapest, Akna u. 2-4.');
    assert.match(String(akna?.address || ''), /Akna/, 'a konkret cim valasztasa nem mukodik');
  });

  await test('A lenyiloban a kozpont all elol', async () => {
    const src = fs.readFileSync(__dirname + '/app.js', 'utf8');
    const c = { console, Math, JSON, String, Number, Object, Array, RegExp, Error };
    c.globalThis = c; c.window = c;
    vm.createContext(c);
    vm.runInContext(fs.readFileSync(__dirname + '/data.js', 'utf8'), c);
    let i = src.indexOf('function joinHouseNumber');
    vm.runInContext(src.slice(i, src.indexOf('function last5')), c, { filename: 'norm' });
    c.state = { projects: [], suppliers: c.SEED_DATA.suppliers.map((s2, k) => ({ ...s2, id: 's' + k })) };
    i = src.indexOf('function comboMatch');
    vm.runInContext(src.slice(i, src.indexOf('function closeAllCombos')), c, { filename: 'combo' });
    i = src.indexOf('function supplierDisplay');
    vm.runInContext(src.slice(i, src.indexOf('\nfunction fillSearchableMasters')), c, { filename: 'masters' });
    const lambda = c.pickupTargetOptions().filter(x => /lambda/i.test(x.label));
    assert.ok(lambda.length >= 2, 'nincs meg mindket Lambda telephely');
    assert.match(lambda[0].label, /Hengermalom/, 'nem a kozpont all elol: ' + lambda[0].label);
    assert.equal(lambda[0].hint, 'központ');
  });

  await test('A szammal kezdodo cikkszamot is felismeri', async () => {
    const c = createContext();
    const items = c.V41OutlookImport.parsePdfItemsFromLines([
      'Kód Megnevezés Mennyisé',
      '77702D02 Ke Kelit KELOX PP-SU Windox Toldóidom külső menettel, 20x1/2" 13 db',
      'SZKL19 Kaucsuk 19 mm vastag lap tekercsben 100 m2']);
    assert.equal(items.length, 2, 'nem ket tetel: ' + JSON.stringify(items.map(i => i.code)));
    assert.equal(items[0].code, '77702D02', 'a szammal kezdodo kod kimaradt');
    assert.equal(items[0].qty, '13');
    assert.equal(items[1].code, 'SZKL19');
    assert.equal(items[1].unit, 'm2');
  });

  await test('Az idomok nem minosulnek szalanyagnak', async () => {
    const c = createContext();
    const L = c.V41OutlookImport.isLongMaterialV71;
    const n = v => v.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
      .replace(/[_.,;:()[\]{}\/\\-]+/g, ' ').replace(/\s+/g, ' ').trim();
    // ezek idomok, a nevukben szerepel a "csovekhez" szo
    for (const name of [
      'AquaPlus PP-R tokos csatlakozó D 50 mm / 1 1/2" csövekhez',
      'AquaPlus PP-R tokos T leágazó idom D 50/32/50 mm csövekhez',
      'Ke Kelit Windox Toldóidom külső menettel 20x1/2"',
      'Kaucsuk 19 mm vastag lap tekercsben']) {
      assert.equal(L(n(name)), false, 'tevesen szalasnak jelolte: ' + name);
    }
    // ezek valoban szalanyagok
    for (const name of ['KPE cső D63 6 szál', 'Acél profil 6 m', 'Zártszelvény 40x40 5 m', 'PVC cső 110 4 m']) {
      assert.equal(L(n(name)), true, 'nem ismerte fel szalasnak: ' + name);
    }
  });

  await test('A PRPR projektek kozotti szallitas helyesen olvasodik', async () => {
    const c = createContext();
    const text = ['Raktárközi', '2026-PRPR/000505', 'Forrás raktár:', 'Stand 98 Kft.',
      'Budapest_Sofitel_Hotel_PR2023/116', 'Cél raktár:', 'Budapest_Cosmo_Residence',
      'Kód Megnevezés Mennyisé',
      'SZKL19 Kaucsuk 19 mm vastag lap tekercsben 100 m2'].join('\n');
    const refs = c.V41OutlookImport.extractOrderRefs(text, 'x.pdf', 'Raktarkozi_Cosmo_260911_000505', '', '');
    assert.equal(refs.length, 1, 'nem egy rendelesszam');
    assert.equal(refs[0].type, 'PRPR');
    assert.equal(refs[0].no, '000505');
    const items = c.V41OutlookImport.parsePdfItemsFromLines(text.split('\n'));
    assert.equal(items.length, 1, 'nem ismerte fel a tetelt');
    assert.equal(items[0].code, 'SZKL19');
    assert.equal(items[0].qty, '100');
    assert.equal(items[0].unit, 'm2');
    assert.equal(items[0].longMaterial, false, 'a tekercses lapot szalasnak jelolte');
  });

  await test('Az elgepelt projektnevet is megtalalja', async () => {
    const c = createContext();
    const M = c.V41OutlookImport.transferNameMatch;
    const hits = c.state.projects
      .map(p => [M('Budapest_Waterfont City_V.ütem', p.name), p.name])
      .filter(x => x[0] > 0).sort((a, b) => b[0] - a[0]);
    assert.ok(hits.length, 'semmit nem talalt az elgepelt nevre');
    assert.match(hits[0][1], /Waterfront/, 'nem a Waterfrontot valasztja: ' + hits[0][1]);
    assert.ok(!hits.some(h => /City_pearl/.test(h[1])), 'a City pearl is illeszkedett');
  });

  await test('Az elgepeles-tures nem kever ossze hasonlo neveket', async () => {
    const c = createContext();
    const M = c.V41OutlookImport.transferNameMatch;
    const best = column => {
      const hits = c.state.projects.map(p => [M(column, p.name), p.name])
        .filter(x => x[0] > 0).sort((a, b) => b[0] - a[0]);
      return hits[0] ? hits[0][1] : '';
    };
    assert.match(best('Budapest_City_pearl_II.ütem'), /City_pearl/);
    assert.match(best('Budapest_Waterfront_City_V.ütem'), /Waterfront/);
    assert.match(best('Budapest_Cosmo_Residence'), /Cosmo/);
  });

  await test('A hasonlosag csak hosszu szavaknal enged eltérest', async () => {
    const c = createContext();
    const E = c.V41OutlookImport.closeEnoughV71;
    assert.equal(E('waterfront', 'waterfont'), true, 'egy hianyzo betut nem tur el');
    assert.equal(E('waterfront', 'waterfronts'), true, 'egy plusz betut nem tur el');
    assert.equal(E('waterfront', 'waterfrand'), false, 'ket elterest is elfogad');
    // rovid szavaknal nincs tures, mert ott mas szot jelenthet
    assert.equal(E('city', 'citi'), false, 'rovid szonal is tur');
    assert.equal(E('utem', 'atem'), false, 'rovid szonal is tur');
    assert.equal(E('cosmo', 'cosmos'), false, 'ot betus szonal is tur');
  });

  await test('Az NRPR (konszignacios raktar) is felismerheto', async () => {
    const c = createContext();
    const run = type => c.V41OutlookImport.extractOrderRefs(
      `Raktárközi\n2026-${type}/000036\nForrás raktár:\n 1 . X Valami 1 db`, 'x.pdf', 'x', '', '');
    for (const type of ['SR0', 'BR0', 'KRPR', 'NRPR', 'PRPR']) {
      const refs = run(type);
      assert.equal(refs.length, 1, type + ' nem ismerheto fel');
      assert.equal(refs[0].type, type);
    }
  });

  await test('Az NRPR mindenben a KRPR-rel azonos agat kapja', async () => {
    const v41 = fs.readFileSync(__dirname + '/planner-v41.js', 'utf8');
    const missing = [];
    v41.split('\n').forEach((line, index) => {
      if (/^\s*(\/\*|\*|\/\/)/.test(line)) return;
      if (!/'KRPR'/.test(line)) return;
      if (/SR0\|BR0\|KRPR\|NRPR\|PRPR/.test(line)) return;
      if (!/'NRPR'/.test(line)) missing.push(`${index + 1}: ${line.trim().slice(0, 66)}`);
    });
    assert.equal(missing.length, 0, 'az NRPR kimaradt innen:\n  ' + missing.join('\n  '));
  });

  await test('A szokozos ezres elvalaszto helyesen olvasodik', async () => {
    const c = createContext();
    const items = c.V41OutlookImport.parsePdfItemsFromLines([
      '144M10 Niczuk Hatlapú anya 144 M10 - (50/doboz) 1 000 db',
      '105M10L30 Niczuk Hatlapfejű csavar 105 M10x30mm - (50/doboz) 500 db',
      'BIG1 Nagy tétel 12 500 db']);
    assert.equal(items.length, 3, 'nem harom tetel');
    assert.equal(items[0].qty, '1000', 'az ezres elvalaszto kettevagta: ' + items[0].qty);
    assert.equal(items[1].qty, '500', 'a hasonlo sor elromlott: ' + items[1].qty);
    assert.equal(items[2].qty, '12500', 'a nagyobb szam elromlott: ' + items[2].qty);
    // a cikkszamban levo szamok nem olvadhatnak ossze
    assert.match(items[1].name, /105 M10x30mm/, 'a nevben osszevonta a szamokat: ' + items[1].name);
  });

  await test('A tizedesvesszo tovabbra is mukodik', async () => {
    const c = createContext();
    const items = c.V41OutlookImport.parsePdfItemsFromLines([
      'OSB015 OSB lap 15mm (2500x1250 - 3,125m2/tábla) 12,5m2']);
    assert.equal(items.length, 1);
    assert.equal(items[0].qty, '12.5', 'a tizedesvesszo elromlott: ' + items[0].qty);
    assert.equal(items[0].unit, 'm2');
  });

  function dateCtx() {
    const src = fs.readFileSync(__dirname + '/app.js', 'utf8');
    const c = { console, String, Number, Object, Array, RegExp, Error, Math, Date, JSON, isNaN,
      setTimeout: f => f() };
    c.globalThis = c; c.window = c;
    c.moves = [];
    c.backlogRecordForItem = () => null;
    c.setItemMoveDate = (o, i, v) => c.moves.push('move:' + v);
    c.rescheduleMovedItem = (o, i, v) => c.moves.push('resched:' + v);
    c.localISO = d => d.toISOString().slice(0, 10);
    const mk = () => ({ value: '', _h: {}, addEventListener(k, f) { (this._h[k] = this._h[k] || []).push(f); },
      focus() { c.focused = this; }, select() {}, setSelectionRange() {} });
    c.inputs = [mk(), mk(), mk()];
    const group = { dataset: { itemDate: 'o1::i1' }, querySelectorAll: () => c.inputs };
    c.document = { querySelectorAll: () => [group] };
    vm.createContext(c);
    const i = src.indexOf('function bindItemDatePartsV71');
    vm.runInContext(src.slice(i, src.indexOf('window.bindItemDatePartsV71')), c, { filename: 'itemdate' });
    c.bindItemDatePartsV71();
    c.type = (index, text) => { const el = c.inputs[index];
      for (const ch of text) { el.value += ch; (el._h.input || []).forEach(f => f()); } };
    return c;
  }

  await test('A tetel datuma csak teljes datumnal helyez at', async () => {
    const c = dateCtx();
    c.type(0, '2026');
    assert.deepEqual(c.moves, [], 'az ev beirasa utan mar athelyezett');
    c.type(1, '09');
    assert.deepEqual(c.moves, [], 'a honap beirasa utan mar athelyezett');
    c.type(2, '1');
    assert.deepEqual(c.moves, [], 'a nap ELSO szamjegye utan athelyezett (elsejere)');
    c.type(2, '6');
    assert.deepEqual(c.moves, ['move:2026-09-16'], 'a teljes datumnal nem helyezett at: ' + c.moves.join());
  });

  await test('Ervenytelen datumra nem helyez at', async () => {
    const c = dateCtx();
    c.type(0, '2026'); c.type(1, '02'); c.type(2, '31');
    assert.deepEqual(c.moves, [], '2026-02-31 datumra athelyezett');
  });

  await test('A kurzor magatol ugrik a kovetkezo mezore', async () => {
    const c = dateCtx();
    c.type(0, '2026');
    assert.equal(c.focused, c.inputs[1], 'negy szamjegy utan nem ugrott a honapra');
    c.type(1, '09');
    assert.equal(c.focused, c.inputs[2], 'ket szamjegy utan nem ugrott a napra');
  });

  await test('Ures mezoben a Backspace visszalep', async () => {
    const c = dateCtx();
    c.type(0, '2026'); c.type(1, '09');
    (c.inputs[2]._h.keydown || []).forEach(f => f({ key: 'Backspace', preventDefault() {} }));
    assert.equal(c.focused, c.inputs[1], 'a Backspace nem lepett vissza');
  });

  await test('A natív datummezo eltunt a tetelsorbol', async () => {
    const app = fs.readFileSync(__dirname + '/app.js', 'utf8');
    const start = app.lastIndexOf('const itemRowsHtml=');
    const body = app.slice(start, app.indexOf('bindV21MoveDateParts', start));
    // a kommentekben szerepelhet a kifejezes, csak a tenyleges mezo szamit
    const code = body.replace(/\/\*[\s\S]*?\*\//g, '');
    assert.ok(!/<input[^>]*type="date"/.test(code), 'maradt nativ datummezo a tetelsorban');
    assert.ok(body.includes('item-date-parts'), 'nincs harmas datummezo');
    assert.ok(app.includes('function bindItemDatePartsV71'), 'nincs kezelo a harmas mezohoz');
    assert.ok(app.includes('bindItemDatePartsV71();'), 'a kezelo nincs bekotve a tetelablakhoz');
  });

  await test('A fejlec datummezoi is visszalepnek Backspace-re', async () => {
    const app = fs.readFileSync(__dirname + '/app.js', 'utf8');
    const start = app.indexOf('function bindV21MoveDateParts');
    const body = app.slice(start, app.indexOf('\nfunction ', start + 40));
    assert.ok(body.includes("event.key==='Backspace'"), 'a fejlecben nincs Backspace-visszalepes');
    assert.ok(body.includes('next.focus();next.select()'), 'elveszett az elore ugras');
  });

  function bubbleFor(c, order, focus) {
    c.state.vehicles = [{ id: 'm', driverName: 'Márió', active: true }];
    c.state.orders = [order];
    return c.V37Planner.groupedBubbles(c.state.orders, 'm', focus);
  }
  const deliveryBase = {
    scheduleDate: '2026-09-01', vehicleId: 'm', pickupName: 'Szatmári', pickupAddress: 'cím',
    projectName: 'Cosmo', dropAddress: '', items: [] };

  await test('A feltoltott szallitolevel jelolest kap az admin feluleten', async () => {
    const c = createContext();
    for (const focus of [false, true]) {
      const nelkul = bubbleFor(c, { ...deliveryBase, id: 1, sequence: 1, orderNo: '5601' }, focus);
      const van = bubbleFor(c, { ...deliveryBase, id: 2, sequence: 1, orderNo: '5602',
        deliveryReports: [{ id: 'r1', at: 'x', photoCount: 2 }] }, focus);
      const text = x => x.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
      assert.ok(!/szállítólevél/i.test(text(nelkul)),
        (focus ? 'Nezet' : 'Fooldal') + ': fotó nélkül is jelöl');
      assert.match(text(van), /szállítólevél/i,
        (focus ? 'Nezet' : 'Fooldal') + ': feltöltött fotónál sem jelöl');
      assert.ok(van.includes('has-delivery'),
        (focus ? 'Nezet' : 'Fooldal') + ': nincs szinjeloles a blokkon');
      assert.ok(!nelkul.includes('has-delivery'),
        (focus ? 'Nezet' : 'Fooldal') + ': fotó nélkül is szinez');
    }
  });

  await test('A jelolesben a fotok szama latszik', async () => {
    const c = createContext();
    const van = bubbleFor(c, { ...deliveryBase, id: 3, sequence: 1, orderNo: '5603',
      deliveryReports: [{ id: 'r1', at: 'x', photoCount: 2 }, { id: 'r2', at: 'y', photoCount: 3 }] }, false);
    const text = van.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    assert.match(text, /Szállítólevél · 5/, 'nem a fotok osszeget mutatja: ' + text.slice(0, 200));
  });

  await test('Az Outlook-melleklet NEM szamit szallitolevelnek', async () => {
    // a deliveryReports mezot csak a sofor fotofeltoltese tolti;
    // az Outlook-forrasmellekletek kozvetlenul a tarolba mennek
    const v41 = fs.readFileSync(__dirname + '/planner-v41.js', 'utf8');
    assert.ok(!v41.includes('deliveryReports'), 'az import is ir a deliveryReports mezobe');
    const c = createContext();
    const html = bubbleFor(c, { ...deliveryBase, id: 4, sequence: 1, orderNo: '5604',
      sourceMail: { subject: 'x', body: 'y' } }, false);
    assert.ok(!html.includes('has-delivery'), 'az Outlook-level miatt is szallitolevelnek jeloli');
  });

  await test('A szinjeloles stilusa bekerult', async () => {
    const css = fs.readFileSync(__dirname + '/styles.css', 'utf8');
    for (const cls of ['.tag.delivery-tag', '.v56-chip-ok', '.has-delivery']) {
      assert.ok(css.includes(cls), 'hianyzo stilus: ' + cls);
    }
  });

  await test('A Mentett fotok gomb jelzi, ha van feltoltott szallitolevel', async () => {
    const c = createContext();
    const readBtn = order => {
      const html = bubbleFor(c, order, false);
      const m = html.match(/<button class="secondary[^>]*>([^<]*)<\/button>/);
      return { label: m ? m[1] : '', marked: /class="secondary has-photos/.test(html) };
    };
    const nelkul = readBtn({ ...deliveryBase, id: 11, sequence: 1, orderNo: '5611' });
    assert.equal(nelkul.marked, false, 'fotó nélkül is kiemeli a gombot');
    assert.ok(!/\(\d+\)/.test(nelkul.label), 'fotó nélkül is ír számot: ' + nelkul.label);

    const egy = readBtn({ ...deliveryBase, id: 12, sequence: 1, orderNo: '5612',
      deliveryReports: [{ id: 'r1', photoCount: 2 }] });
    assert.equal(egy.marked, true, 'feltöltött fotónál nem emeli ki a gombot');
    assert.match(egy.label, /\(2\)/, 'nem írja ki a fotók számát: ' + egy.label);

    const tobb = readBtn({ ...deliveryBase, id: 13, sequence: 1, orderNo: '5613',
      deliveryReports: [{ id: 'r1', photoCount: 2 }, { id: 'r2', photoCount: 3 }] });
    assert.match(tobb.label, /\(5\)/, 'nem a fotók összegét mutatja: ' + tobb.label);
  });

  await test('A sofori Mentett fotok gomb is jelol', async () => {
    const auth = fs.readFileSync(__dirname + '/auth-v44-2.js', 'utf8');
    const start = auth.indexOf('function userBubble(order, index) {');
    const body = auth.slice(start, auth.indexOf('\n  }\n', start));
    assert.ok(body.includes("reportPhotos ? 'has-photos' : ''"), 'a sofori gomb nem kap jelolest');
    assert.ok(body.includes('Mentett fotók${reportPhotos'), 'a sofori gombon nincs darabszam');
  });

  await test('A gomb kiemelesenek stilusa bekerult', async () => {
    const css = fs.readFileSync(__dirname + '/styles.css', 'utf8');
    assert.ok(css.includes('button.secondary.has-photos'), 'nincs stilus a kiemelt gombhoz');
  });

  function attachCtx() {
    const src = fs.readFileSync(__dirname + '/auth-v44-2.js', 'utf8');
    const c = { console, String, Object, Array, RegExp, Error };
    c.globalThis = c; c.global = c; c.window = c;
    c.esc = v => String(v == null ? '' : v).replace(/[&<>"']/g,
      m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
    c.safe = v => c.esc(v || '');
    c.alerts = []; c.alert = m => c.alerts.push(m);
    c.navigated = '';
    c.location = { set href(v) { c.navigated = v; } };
    vm.createContext(c);
    const i = src.indexOf('function attachmentLinkV71');
    vm.runInContext(src.slice(i, src.indexOf('  async function openSourceMail')), c, { filename: 'attach' });
    return c;
  }
  const SIGNED = 'https://x.supabase.co/storage/v1/object/sign/delivery-docs/o1/lev.pdf?token=abc&download=1';

  await test('A PDF-melleklet gombkent jelenik meg, ep hivatkozassal', async () => {
    const c = attachCtx();
    const html = c.attachmentLinkV71({ file_name: 'level.pdf', url: SIGNED });
    assert.match(html, /<button[^>]*class="mail-file"/, 'nem gomb lett');
    assert.match(html, /data-url="[^"]*token=abc&amp;download=1"/, 'serult a hivatkozas: ' + html.slice(0, 160));
    assert.ok(!/target="_blank"/.test(html), 'maradt a blokkolhato uj lap');
  });

  await test('Ha nincs hivatkozas, a program megmondja', async () => {
    const c = attachCtx();
    const html = c.attachmentLinkV71({ file_name: 'level.pdf', url: '' });
    assert.match(html, /nem elérhető/, 'nem jelzi a hianyzo hivatkozast');
    assert.ok(!/href=""/.test(html), 'ures href maradt, ami ujratolti a lapot');
  });

  await test('Blokkolt uj lapnal helyben nyitja meg', async () => {
    const c = attachCtx();
    c.open = () => null;                       // a rendszer blokkolja az uj lapot
    c.openAttachmentV71(SIGNED);
    assert.equal(c.navigated, SIGNED, 'nem nyitotta meg helyben');
    c.navigated = '';
    c.open = () => ({ closed: false });        // sikeres uj lap
    c.openAttachmentV71(SIGNED);
    assert.equal(c.navigated, '', 'sikeres uj lap utan is navigalt');
  });

  await test('Ures hivatkozasnal szol, nem tortenik csendben semmi', async () => {
    const c = attachCtx();
    c.open = () => null;
    c.openAttachmentV71('');
    assert.equal(c.navigated, '', 'ures URL-re navigalt');
    assert.match(c.alerts.join(' '), /nem jött létre megnyitható/, 'nem szolt a felhasznalonak');
  });

  await test('A sofori tetelablakban is a harmas datummezo all', async () => {
    const html = itemsHtml([{ _id: 'i1', name: 'Gipsz', code: 'EG006', qty: 15, unit: 'zsák',
      received: false, missingQty: 2, shortageOpen: true }], '');
    assert.ok(html.includes('item-date-parts'), 'nincs harmas datummezo');
    assert.ok(!/<input[^>]*type="date"/.test(html), 'maradt nativ datummezo');
    const day = html.match(/<input[^>]*aria-label="Hátralék napja"[^>]*>/);
    assert.ok(day, 'nincs nap mezo');
    assert.match(day[0], /maxlength="2"/, 'a nap mezo nem fogad ket szamjegyet: ' + day[0]);
    const year = html.match(/<input[^>]*aria-label="Hátralék éve"[^>]*>/);
    assert.match(year[0], /maxlength="4"/, 'az ev mezo nem negy szamjegyes');
  });

  function driverDatesCtx() {
    const src = fs.readFileSync(__dirname + '/auth-v44-2.js', 'utf8');
    const c = { console, Date, String, Number, Object, Array, Math, JSON, RegExp, Error };
    c.globalThis = c; c.global = c; c.window = c;
    c.localISO = d => d.toISOString().slice(0, 10);
    vm.createContext(c);
    const i = src.indexOf('const localDate = offset');
    const j = src.indexOf('const appUser');
    vm.runInContext(src.slice(i, j) +
      '\nglobal.allowedDates=allowedDates;global.isReadOnly=isReadOnlyDate;global.currentWorkday=currentWorkday;',
      c, { filename: 'dates' });
    return c;
  }

  await test('A sofor harom munkanapot lat', async () => {
    const c = driverDatesCtx();
    const days = c.allowedDates();
    assert.equal(days.length, 3, 'nem harom nap: ' + days.join(', '));
    assert.equal(days[1], c.currentWorkday(), 'a kozepso nem a mai munkanap');
    assert.ok(days[0] < days[1], 'az elso nem a korabbi nap');
    assert.ok(days[2] > days[1], 'a harmadik nem a kesobbi nap');
    for (const d of days) {
      const day = new Date(d + 'T12:00:00').getDay();
      assert.ok(day !== 0 && day !== 6, 'hetvegi nap kerult a listaba: ' + d);
    }
  });

  await test('Csak a MAI munkanap szerkesztheto', async () => {
    const c = driverDatesCtx();
    const [elozo, ma, kovetkezo] = c.allowedDates();
    assert.equal(c.isReadOnly(elozo), true, 'az elozo nap szerkesztheto maradt');
    assert.equal(c.isReadOnly(ma), false, 'a mai nap nem szerkesztheto');
    assert.equal(c.isReadOnly(kovetkezo), true, 'a kovetkezo nap szerkesztheto maradt');
    assert.equal(ma, c.currentWorkday(), 'nem a mai munkanap a szerkesztheto');
  });

  await test('A hetvege mindket iranyban kimarad', async () => {
    const shift = (date, n) => {
      const d = new Date(date + 'T12:00:00');
      let rest = Math.abs(n), dir = n < 0 ? -1 : 1;
      while (rest > 0) { d.setDate(d.getDate() + dir); if (d.getDay() !== 0 && d.getDay() !== 6) rest--; }
      return d.toISOString().slice(0, 10);
    };
    // 2026-09-11 péntek -> következő hétfő
    assert.equal(shift('2026-09-11', 1), '2026-09-14', 'penteken nem hetfo a kovetkezo');
    // 2026-09-14 hétfő -> előző péntek
    assert.equal(shift('2026-09-14', -1), '2026-09-11', 'hetfon nem pentek az elozo');
  });

  await test('A lezart napon a modosito muveletek tiltva vannak', async () => {
    const auth = fs.readFileSync(__dirname + '/auth-v44-2.js', 'utf8');
    assert.ok(auth.includes('function canEditOrder'), 'nincs szerkeszthetoseg-szabaly');
    assert.match(auth, /if \(mutates && !canEditOrder\(orderId\)\)/, 'az orok nem nezik a szerkeszthetoseget');
    for (const fn of ['openCamera', 'toggleItem', 'updateMissingQty', 'setItemMoveDate', 'openTransferDialog']) {
      assert.match(auth, new RegExp(`guardOrderFunction\\('${fn}', true, true\\)`),
        fn + ' nincs modositokent vedve');
    }
    // a megtekintes viszont engedett
    assert.match(auth, /guardOrderFunction\('openItems', true\)/, 'a tetelek megtekintese is tiltva lett');
  });

  await test('A lezart fuvar jelolest kap es nincs rajta modosito gomb', async () => {
    const auth = fs.readFileSync(__dirname + '/auth-v44-2.js', 'utf8');
    const start = auth.indexOf('function userBubble(order, index) {');
    const body = auth.slice(start, auth.indexOf('\n  }\n', start));
    assert.ok(body.includes('locked-day'), 'nincs jeloles a lezart soron');
    assert.ok(body.includes('Lezárt nap') && body.includes('Következő nap'),
      'nincs magyarazo felirat mindket iranyra');
    // V72 ota a gomb LATSZIK, de le van tiltva – igy nem tunik ugy, hogy eltunt
    assert.ok(body.includes('class="camera-action${locked'), 'a Szallitolevel gomb feltetelesen jelenik meg');
    assert.match(body, /disabled title="Csak az aktuális munkanapon tölthető fel"/,
      'a lezart napon nincs tiltva a gomb');
    const css = fs.readFileSync(__dirname + '/styles.css', 'utf8');
    assert.ok(css.includes('.mobile-user-row.locked-day'), 'nincs stilus a lezart sorhoz');
  });

  await test('A nyitooldal mindig a MAI napot mutatja', async () => {
    const c = driverDatesCtx();
    let selected = '', init = false;
    const open = () => {
      if (!init) { selected = c.currentWorkday(); init = true; }
      selected = c.allowedDates().includes(selected) ? selected : c.currentWorkday();
      return selected;
    };
    assert.equal(open(), c.currentWorkday(), 'elso megnyitaskor nem a mai nap jon');
    selected = c.allowedDates()[0];                  // a sofor a tegnapira valt
    assert.equal(open(), c.allowedDates()[0], 'a valtas nem marad meg');
    selected = '2000-01-01';                         // ervenytelen, pl. napvaltas utan
    assert.equal(open(), c.currentWorkday(), 'ervenytelen nap utan nem a mai jon');
    init = false;                                    // kilepes-belepes
    assert.equal(open(), c.currentWorkday(), 'ujra belepve nem a mai nap jon');
  });

  await test('A tartalek nap a mai, nem a lista elso eleme', async () => {
    const auth = fs.readFileSync(__dirname + '/auth-v44-2.js', 'utf8');
    assert.match(auth, /allowedDates\(\)\.includes\(selectedDriverDate\) \? selectedDriverDate : currentWorkday\(\)/,
      'a tartalek meg mindig allowedDates()[0], ami a tegnapi nap');
    assert.ok(auth.includes('driverDateInitialised'), 'nincs elso-megnyitas kezeles');
    assert.match(auth, /if \(!driverDateInitialised\) \{ selectedDriverDate = currentWorkday\(\)/,
      'a nyitaskor nem all a mai napra');
    const start = auth.indexOf('async function logout');
    const body = auth.slice(start, start + 400);
    assert.ok(body.includes('driverDateInitialised = false'), 'kilepeskor nem all vissza');
  });

  await test('A napfuleken csak a MAI napon all a "Ma" szo', async () => {
    const src = fs.readFileSync(__dirname + '/auth-v44-2.js', 'utf8');
    const c = { console, Date, String, Number, Object, Array, Math, JSON, RegExp, Error, Intl };
    c.globalThis = c; c.global = c; c.window = c;
    c.localISO = d => d.toISOString().slice(0, 10);
    vm.createContext(c);
    const i = src.indexOf('const localDate = offset'), j = src.indexOf('const appUser');
    vm.runInContext(src.slice(i, j) + '\nglobal.allowedDates=allowedDates;global.currentWorkday=currentWorkday;',
      c, { filename: 'dates' });
    const k = src.indexOf('function formatDay');
    vm.runInContext(src.slice(k, src.indexOf('function transferForOrder')), c, { filename: 'format' });

    const [balra, ma, jobbra] = c.allowedDates().map(d => c.formatDay(d));
    assert.ok(!/Ma|Holnap/.test(balra), 'a bal oldali fulon felirat van: ' + balra);
    assert.match(ma, /^Ma · /, 'a kozepso fulon nincs "Ma": ' + ma);
    assert.ok(!/Ma|Holnap/.test(jobbra), 'a jobb oldali fulon felirat van: ' + jobbra);
    assert.match(balra, /\d/, 'a bal oldali fulon nincs datum');
    assert.match(jobbra, /\d/, 'a jobb oldali fulon nincs datum');
  });

  await test('A Szallitolevel gomb sosem tunik el', async () => {
    const auth = fs.readFileSync(__dirname + '/auth-v44-2.js', 'utf8');
    const start = auth.indexOf('function userBubble(order, index) {');
    const body = auth.slice(start, auth.indexOf('\n  }\n', start));
    assert.ok(body.includes('class="camera-action${locked'), 'a gomb feltetelesen jelenik meg');
    assert.ok(!/locked \? '' : `<button[^`]*camera-action/.test(body), 'a gomb meg mindig eltunhet');
    assert.match(body, /disabled title="Csak az aktuális munkanapon tölthető fel"/,
      'lezart napon nincs magyarazo tiltas');
    assert.ok(body.includes('transfer-action${locked'), 'a Fuvar atadasa gomb eltunhet');
    const css = fs.readFileSync(__dirname + '/styles.css', 'utf8');
    assert.ok(css.includes('button.is-locked'), 'nincs stilus a tiltott gombhoz');
  });

  await test('A csatolmany uzenete megmondja, miert nincs fajl', async () => {
    const auth = fs.readFileSync(__dirname + '/auth-v44-2.js', 'utf8');
    const start = auth.indexOf('async function openSourceMail');
    const body = auth.slice(start, auth.indexOf('\n  }\n', start));
    assert.match(body, /volt melléklete, de a fájlok nincsenek feltöltve/,
      'nem magyarazza meg a regi importot');
    assert.match(body, /nem tartozott melléklet/, 'nincs uzenet a melleklet nelkuli levelre');
    assert.ok(body.includes('mail.attachmentNames'), 'nem nezi meg, volt-e egyaltalan melleklet');
  });

  await test('A melleklet-feltoltes hibaja nem marad csendben', async () => {
    const v41 = fs.readFileSync(__dirname + '/planner-v41.js', 'utf8');
    const start = v41.indexOf('async function uploadSourceMailFiles');
    const body = v41.slice(start, v41.indexOf('function statusText'));
    assert.ok(body.includes('const failed = []'), 'nincs hibagyujtes');
    assert.match(body, /nem töltődtek fel/, 'nem szol a felhasznalonak');
  });

  await test('A kibonthatatlan melleklet jelzest kap az importnal', async () => {
    const v41 = fs.readFileSync(__dirname + '/planner-v41.js', 'utf8');
    assert.ok(v41.includes('sourceMail.attachmentsUnreadable = true'), 'nincs jelzes a kibonthatatlan melleklerol');
    assert.ok(v41.includes('sourceMail.unreadable'), 'nem gyujti, melyik melleklet nem olvashato');
    assert.match(v41, /const wantedFiles = names\.filter/, 'nem nezi, volt-e egyaltalan melleklet');
    assert.ok(v41.includes('v72-attach-warn'), 'az elonezeten nincs figyelmeztetes');
    assert.match(v41, /Továbbított levélnél mentsd el az eredetit/, 'nem mondja meg, mit tegyen');
  });

  await test('A jelzes atkerul a fuvarra es a Csatolmany ablakba', async () => {
    const v41 = fs.readFileSync(__dirname + '/planner-v41.js', 'utf8');
    assert.ok(v41.includes('attachmentsUnreadable: !!entry.sourceMail.attachmentsUnreadable'),
      'a jelzes nem kerul ra a fuvarra');
    const auth = fs.readFileSync(__dirname + '/auth-v44-2.js', 'utf8');
    const start = auth.indexOf('async function openSourceMail');
    const body = auth.slice(start, auth.indexOf('\n  }\n', start));
    assert.ok(body.includes('mail.attachmentsUnreadable'), 'a Csatolmany ablak nem nezi a jelzest');
    assert.match(body, /EREDETI levelet \.msg fájlként/, 'nem mondja meg, mit tegyen a felhasznalo');
  });

  await test('A Csatolmany CSAK a levelmellekleteket mutatja', async () => {
    const auth = fs.readFileSync(__dirname + '/auth-v44-2.js', 'utf8');
    const start = auth.indexOf('async function openSourceMail');
    const body = auth.slice(start, auth.indexOf('\n  }\n', start));
    assert.match(body, /const sources = all\.filter\(file => file\.is_source_mail\);/,
      'nem csak a forrasmellekleteket szuri');
    assert.ok(!/is_source_mail\)\.length[\s\S]{0,60}: all;/.test(body),
      'visszakerult a tartalek ag, ami a sofor fotoit is megmutatja');
  });

  await test('A ket lista nem fedi egymast', async () => {
    // ugyanaz a fajllista, a ket szuro szerint
    const files = [
      { file_name: 'szallitolevel_01.jpg', is_source_mail: false },
      { file_name: 'szallitolevel_02.jpg', is_source_mail: false },
      { file_name: 'Megrendeles_005453.pdf', is_source_mail: true },
      { file_name: 'image001.png', is_source_mail: true }];
    const csatolmany = files.filter(f => /\.(pdf|jpe?g|png)$/i.test(f.file_name)).filter(f => f.is_source_mail);
    const fotok = files.filter(f => !f.is_source_mail);
    assert.deepEqual(csatolmany.map(f => f.file_name), ['Megrendeles_005453.pdf', 'image001.png']);
    assert.deepEqual(fotok.map(f => f.file_name), ['szallitolevel_01.jpg', 'szallitolevel_02.jpg']);
    assert.equal(csatolmany.filter(f => fotok.includes(f)).length, 0, 'atfedes van a ket lista kozott');

    // a galeria oldalan is ugyanez a szabaly
    const auth = fs.readFileSync(__dirname + '/auth-v44-2.js', 'utf8');
    const gallery = auth.slice(auth.indexOf('async function openMediaGallery'), auth.indexOf('global.openMediaGallery'));
    assert.ok(gallery.includes('!file.is_source_mail'), 'a Mentett fotok kozott ott vannak a levelmellekletek');
  });

  function selectFocusCtx() {
    const src = fs.readFileSync(__dirname + '/app.js', 'utf8');
    const c = { console, Set, String, Object, Array, RegExp, Error };
    c.globalThis = c; c.window = c;
    c.requestAnimationFrame = f => f();
    c.handlers = {};
    c.document = { readyState: 'complete', addEventListener(k, f) { c.handlers[k] = f; } };
    vm.createContext(c);
    const i = src.indexOf('const SELECT_ON_FOCUS_TYPES');
    vm.runInContext(src.slice(i, src.indexOf('/* V71 – EGYSÉGES DÁTUMBEVITEL')), c, { filename: 'selectfocus' });
    c.field = (tag, type, extra = {}) => Object.assign(
      { tagName: tag, type, readOnly: false, disabled: false, selected: false, select() { this.selected = true; } }, extra);
    return c;
  }

  await test('Egy kattintasra kijelolodik az irhato mezo tartalma', async () => {
    const c = selectFocusCtx();
    for (const type of ['text', 'search', 'number', 'tel', 'email']) {
      const el = c.field('INPUT', type);
      c.handlers.focusin({ target: el });
      assert.equal(el.selected, true, type + ' mezo nem jelolodik ki');
    }
  });

  await test('A nem irhato es a tobbsoros mezok kimaradnak', async () => {
    const c = selectFocusCtx();
    const cases = [
      ['checkbox', c.field('INPUT', 'checkbox')],
      ['csak olvashato', c.field('INPUT', 'text', { readOnly: true })],
      ['letiltott', c.field('INPUT', 'text', { disabled: true })],
      ['textarea', c.field('TEXTAREA', '')],
      ['gomb', c.field('BUTTON', '')]];
    for (const [label, el] of cases) {
      c.handlers.focusin({ target: el });
      assert.equal(el.selected, false, label + ' tevesen kijelolodik');
    }
  });

  await test('A masodik kattintas nem veszi vissza a kijelolest', async () => {
    const c = selectFocusCtx();
    const el = c.field('INPUT', 'text');
    c.handlers.focusin({ target: el });
    let prevented = false;
    c.handlers.mouseup({ target: el, preventDefault() { prevented = true; } });
    assert.equal(prevented, true, 'a mouseup visszavenne a kijelolest');
    // masodik kattintaskor mar NEM nyomjuk el, hogy a kurzort lehessen mozgatni
    prevented = false;
    c.handlers.mouseup({ target: el, preventDefault() { prevented = true; } });
    assert.equal(prevented, false, 'a masodik kattintassal nem lehet kurzort tenni');
  });

  await test('A szabaly az egesz oldalra ervenyes', async () => {
    const app = fs.readFileSync(__dirname + '/app.js', 'utf8');
    assert.ok(app.includes('function installSelectOnFocusV72'), 'nincs kozos bekotes');
    assert.match(app, /root\.addEventListener\('focusin'/, 'nem az egesz oldalon figyel');
    assert.ok(app.includes('window.installSelectOnFocusV72'), 'nincs globalis belepesi pont');
    // az app.js mindket feluleten fut, tehat admin es sofor oldalon is ervenyes
    const html = fs.readFileSync(__dirname + '/index.html', 'utf8');
    assert.ok(html.includes('app.js'), 'az app.js nincs betoltve');
  });

  // ---------- V73 ----------
  const KESMARK = '1158 Budapest, Késmárk utca 9.';
  const NAGYTETENY = 'Budapest XXII. kerület, Nagytétényi út 49.';
  const szatmariOrder = (id, address, project = 'Cosmo') => ({
    id, scheduleDate: '2026-09-01', vehicleId: 'm', sequence: id, orderNo: '56' + id,
    pickupName: 'Szatmári Kft', pickupAddress: address, projectName: project,
    dropAddress: '1133 Budapest', items: [] });

  await test('A kulonbozo telephelyek NEM olvadnak egy buborekba', async () => {
    const c = createContext();
    const orders = [szatmariOrder(1, KESMARK), szatmariOrder(2, KESMARK),
      szatmariOrder(3, KESMARK), szatmariOrder(4, NAGYTETENY)];
    const groups = c.V33Planner.orderedBubbleGroups(orders);
    assert.equal(groups.length, 2, 'nem ket buborek: ' + groups.length);
    const byAddress = Object.fromEntries(groups.map(g => [g.pickupAddress, g.orders.length]));
    assert.equal(byAddress[KESMARK], 3, 'a kesmarki nem harom rendeles');
    assert.equal(byAddress[NAGYTETENY], 1, 'a nagytetenyi nem egy rendeles');
  });

  await test('A Nezet is kulon egysegkent kezeli a telephelyeket', async () => {
    const c = createContext();
    const orders = [szatmariOrder(1, KESMARK), szatmariOrder(2, NAGYTETENY)];
    const units = c.V37Planner.focusPickupUnits(orders);
    assert.equal(units.length, 2, 'nem ket egyseg: ' + units.map(u => u.pickupKey).join(' | '));
    assert.notEqual(units[0].pickupKey, units[1].pickupKey, 'azonos kulcsot kapott a ket telephely');
    for (const unit of units) assert.match(unit.pickupKey, /@@/, 'a kulcsban nincs benne a cim: ' + unit.pickupKey);
  });

  await test('Azonos cimen tovabbra is osszevonja oket', async () => {
    const c = createContext();
    const orders = [szatmariOrder(1, KESMARK), szatmariOrder(2, KESMARK), szatmariOrder(3, KESMARK)];
    assert.equal(c.V33Planner.orderedBubbleGroups(orders).length, 1, 'azonos cimen is szetszedte');
    assert.equal(c.V37Planner.focusPickupUnits(orders).length, 1, 'a Nezetben szetszedte');
  });

  await test('A felrako kulcsa minden modulban azonos szabalyt kovet', async () => {
    for (const file of ['planner-v32.js', 'planner-v33.js', 'planner-v34.js', 'planner-v35.js', 'planner-v43.js']) {
      const text = fs.readFileSync(__dirname + '/' + file, 'utf8');
      const start = text.indexOf('const supplierKey = order');
      assert.ok(start > 0, file + ': nincs supplierKey');
      const body = text.slice(start, start + 420);
      assert.ok(body.includes('@@'), file + ': a cim nem resze a kulcsnak');
      assert.ok(!/nrm\(order\?\.pickupName \|\| order\?\.pickupAddress/.test(body),
        file + ': maradt a regi, csak nevre epulo kulcs');
    }
  });

  await test('A 000000 gyujtokod, nem azonosito', async () => {
    const c = createContext();
    const P = c.V41OutlookImport;
    for (const v of ['000000', '0', '00', ' 000000 ']) {
      assert.equal(P.isPlaceholderOrderNo(v), true, 'nem ismeri fel gyujtokodkent: ' + JSON.stringify(v));
    }
    for (const v of ['000001', '5601', '']) {
      assert.equal(P.isPlaceholderOrderNo(v), false, 'tevesen gyujtokod: ' + JSON.stringify(v));
    }
    assert.deepEqual(P.meaningfulOrderNos(['000000', '5601', '0']), ['5601'], 'nem szuri ki a gyujtokodokat');
  });

  await test('Tobb 000000-s fuvar kulon marad, nem irjak felul egymast', async () => {
    const c = createContext();
    const P = c.V41OutlookImport;
    const a = { _id: 'e1', orderNo: '000000', sourceOrderNos: ['000000'], orderType: 'SR0' };
    const b = { _id: 'e2', orderNo: '000000', sourceOrderNos: ['000000'], orderType: 'SR0' };
    assert.notEqual(P.importIdentity(a), P.importIdentity(b), 'ket gyujtokodos fuvar egy azonositot kapott');
    // valodi rendelesszamnal viszont a masodik FRISSITI az elsot
    const c1 = { _id: 'e3', orderNo: '005601', sourceOrderNos: ['005601'], orderType: 'SR0' };
    const c2 = { _id: 'e4', orderNo: '005601', sourceOrderNos: ['005601'], orderType: 'SR0' };
    assert.equal(P.importIdentity(c1), P.importIdentity(c2), 'a valodi rendelesszam mar nem azonosit');
  });

  await test('A gyujtokodos fuvar nem torol korabbit es nem blokkol', async () => {
    const v41 = fs.readFileSync(__dirname + '/planner-v41.js', 'utf8');
    const start = v41.indexOf('const replaceIds = new Set();');
    const body = v41.slice(start, start + 600);
    assert.ok(body.includes('meaningfulOrderNos(entry.sourceOrderNos)'), 'a csere nem szuri a gyujtokodot');
    assert.match(body, /if \(!numbers\.length\) continue;/, 'gyujtokodnal is keres felulirhato fuvart');
    const c = createContext();
    assert.deepEqual(c.V41OutlookImport.blockingFields({
      orderNo: '000000', sourceOrderNos: ['000000'], pickupName: 'Szatmári', projectName: 'Cosmo' }), [],
      'a gyujtokod blokkolja az importot');
  });

  await test('Az import a TE megjegyzesedet teszi a note mezobe', async () => {
    const v41 = fs.readFileSync(__dirname + '/planner-v41.js', 'utf8');
    assert.ok(!/note: `Outlook import/.test(v41), 'meg mindig technikai szoveget ir a megjegyzesbe');
    assert.match(v41, /note: String\(entry\.manualItems \|\| ''\)\.trim\(\)/, 'nem a kezi szoveg kerul a note mezobe');
    assert.ok(v41.includes('outlookImport: true'), 'elveszett az import jelzo');
    assert.ok(v41.includes('outlookSourceFile: entry.sourceName'), 'elveszett a forrasfajl neve');
  });

  await test('A szerkesztoben nem a technikai szoveg all', async () => {
    const src = fs.readFileSync(__dirname + '/app.js', 'utf8');
    const c = { console, String, Object, RegExp }; c.globalThis = c; c.window = c;
    vm.createContext(c);
    const i = src.indexOf('function cleanOrderNoteV73');
    vm.runInContext(src.slice(i, src.indexOf('window.cleanOrderNoteV73')), c, { filename: 'note' });
    assert.equal(c.cleanOrderNoteV73({ note: 'Outlook import · SR0 · level.msg' }), '',
      'a technikai szoveg megjelenik a szerkesztoben');
    assert.equal(c.cleanOrderNoteV73({ note: 'Outlook import · SR0 · level.msg', manualItems: 'Visszáru' }), 'Visszáru',
      'a regi kezi szoveg nem jon elo');
    assert.equal(c.cleanOrderNoteV73({ note: 'Patriknak átadni' }), 'Patriknak átadni', 'elveszett a valodi megjegyzes');
    assert.equal(c.cleanOrderNoteV73({}), '');
    assert.ok(src.includes("orderNote').value=cleanOrderNoteV73(o)"), 'az urlap nem a tisztitott szoveget tolti be');
  });

  await test('A buborek a szerkesztheto megjegyzest mutatja', async () => {
    const c = createContext();
    c.state.vehicles = [{ id: 'm', driverName: 'Márió', active: true }];
    const base = { scheduleDate: '2026-09-01', vehicleId: 'm', sequence: 1, orderNo: '5601',
      pickupName: 'Szatmári', pickupAddress: '1158 Budapest, Késmárk utca 9.',
      projectName: 'Cosmo', dropAddress: '1133 Budapest', items: [] };
    const noteOf = order => {
      c.state.orders = [order];
      const html = c.V37Planner.groupedBubbles(c.state.orders, 'm', false);
      const m = html.match(/<div class="v65-manual-note">([\s\S]*?)<\/div>/);
      return m ? m[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim() : '';
    };
    assert.equal(noteOf({ ...base, id: 1, note: 'Outlook import · SR0 · level.msg' }), '',
      'a technikai szoveg megjelenik a buborekban');
    assert.match(noteOf({ ...base, id: 2, note: 'Visszáru a Cosmóról' }), /Visszáru a Cosmóról/,
      'nem latszik a megjegyzes');
    assert.match(noteOf({ ...base, id: 3, manualItems: 'Régi kézi szöveg' }), /Régi kézi szöveg/,
      'a korabbi fuvarok kezi szovege eltunt');
  });

  await test('Az importalt megjegyzes utolag szerkesztheto', async () => {
    const c = createContext();
    c.state.vehicles = [{ id: 'm', driverName: 'Márió', active: true }];
    const base = { id: 1, scheduleDate: '2026-09-01', vehicleId: 'm', sequence: 1, orderNo: '5601',
      pickupName: 'Szatmári', pickupAddress: 'cím', projectName: 'Cosmo', dropAddress: '', items: [] };
    const shown = order => {
      c.state.orders = [order];
      const html = c.V37Planner.groupedBubbles(c.state.orders, 'm', false);
      const m = html.match(/Megjegyzés:<\/b>([^<]*)/);
      return m ? m[1].trim() : '';
    };
    assert.equal(shown({ ...base, note: '4 tábla OSB', manualItems: '4 tábla OSB' }), '4 tábla OSB');
    // szerkesztes utan CSAK az uj szoveg latszik, a regi nem marad mellette
    assert.equal(shown({ ...base, note: 'ÁTÍRT szöveg', manualItems: 'ÁTÍRT szöveg' }), 'ÁTÍRT szöveg');
    assert.equal(shown({ ...base, note: '', manualItems: '' }), '', 'torles utan is maradt szoveg');
  });

  await test('A mentes a regi importalt szoveget is felulirja', async () => {
    const app = fs.readFileSync(__dirname + '/app.js', 'utf8');
    const start = app.indexOf("$('#orderForm').onsubmit");
    const body = app.slice(start, start + 2000);
    assert.match(body, /manualItems:\$\('#orderNote'\)\.value\.trim\(\)/,
      'a mentes nem frissiti a regi manualItems mezot');
    assert.match(body, /note:\$\('#orderNote'\)\.value/, 'a megjegyzes mentese elveszett');
  });

  await test('Az urlap nem a level targyat mutatja', async () => {
    const app = fs.readFileSync(__dirname + '/app.js', 'utf8');
    assert.ok(app.includes('function cleanOrderNoteV73'), 'nincs szuro a technikai szovegre');
    const c = { console, String, Object, RegExp };
    c.globalThis = c; c.window = c;
    vm.createContext(c);
    const i = app.indexOf('function cleanOrderNoteV73');
    vm.runInContext(app.slice(i, app.indexOf('window.cleanOrderNoteV73')), c, { filename: 'note' });
    assert.equal(c.cleanOrderNoteV73({ note: 'Outlook import · SR0 · level.msg' }), '',
      'a technikai szoveg bekerul az urlapba');
    assert.equal(c.cleanOrderNoteV73({ note: 'Sajat megjegyzes' }), 'Sajat megjegyzes');
    assert.equal(c.cleanOrderNoteV73({ note: '', manualItems: 'Kezzel felvitt' }), 'Kezzel felvitt',
      'a regi mezobol nem hozza elo a szoveget');
  });

  await test('Az importalt fuvar megjegyzese a TE szoveged', async () => {
    const v41 = fs.readFileSync(__dirname + '/planner-v41.js', 'utf8');
    assert.match(v41, /note: String\(entry\.manualItems \|\| ''\)\.trim\(\)/,
      'az import nem a kezi szoveget teszi a megjegyzesbe');
    assert.ok(!/note: `Outlook import/.test(v41), 'maradt technikai szoveg a megjegyzesben');
    assert.ok(v41.includes('outlookImport: true'), 'elveszett a forras jelzese');
  });

  function attachStoreCtx() {
    const app = fs.readFileSync(__dirname + '/app.js', 'utf8');
    const c = { console, JSON, String, Object, Array, Date, RegExp, Error, Math,
      btoa: v => Buffer.from(v, 'binary').toString('base64') };
    c.globalThis = c; c.window = c;
    c.store = {};
    c.localStorage = {
      setItem(k, v) { c.store[k] = v; }, getItem: k => c.store[k] || null,
      removeItem(k) { delete c.store[k]; },
      get length() { return Object.keys(c.store).length; },
      key: i => Object.keys(c.store)[i] };
    c.state = { orders: [{ id: 'o1' }] };
    vm.createContext(c);
    const i = app.indexOf('const ATTACH_STORE_PREFIX_V73');
    vm.runInContext(app.slice(i, app.indexOf('/* V72 – EGY KATTINTÁS')), c, { filename: 'attach' });
    return c;
  }
  const PDF_URL = 'data:application/pdf;base64,' + Buffer.from('%PDF-1.4 teszt').toString('base64');

  await test('A melleklet helyben is elmentodik es visszaolvashato', async () => {
    const c = attachStoreCtx();
    assert.equal(c.saveOrderAttachmentsV73('o1', [{ name: 'megrendeles.pdf', dataUrl: PDF_URL }]), 1);
    const back = c.loadOrderAttachmentsV73('o1');
    assert.equal(back.length, 1, 'nem olvashato vissza');
    assert.equal(back[0].name, 'megrendeles.pdf');
    assert.ok(back[0].dataUrl.startsWith('data:application/pdf'), 'nem megnyithato hivatkozas');
  });

  await test('A helyi tarolo nem terheli a szinkront', async () => {
    const app = fs.readFileSync(__dirname + '/app.js', 'utf8');
    assert.ok(app.includes("ATTACH_STORE_PREFIX_V73 = 'fuvarAttach:'"), 'nincs kulon tarolo');
    // a fuvar adatai koze NEM kerul be a fajl, csak kulon localStorage kulcsba
    const v41 = fs.readFileSync(__dirname + '/planner-v41.js', 'utf8');
    assert.ok(!/inlineFiles: entry\.sourceMail/.test(v41), 'a fajl a fuvarra kerul, igy minden szinkron felkuldi');
    assert.ok(v41.includes('global.saveOrderAttachmentsV73(order.id, inline)'), 'nem menti helyben');
  });

  await test('A regi es az arva bejegyzesek takaritodnak', async () => {
    const c = attachStoreCtx();
    c.saveOrderAttachmentsV73('o1', [{ name: 'a.pdf', dataUrl: PDF_URL }]);
    c.saveOrderAttachmentsV73('torolt', [{ name: 'b.pdf', dataUrl: PDF_URL }]);
    assert.equal(Object.keys(c.store).length, 2);
    assert.equal(c.pruneOrderAttachmentsV73(), 1, 'nem takaritotta az arva bejegyzest');
    assert.equal(Object.keys(c.store).length, 1, 'a meglevo fuvare is eltunt');
    assert.equal(c.loadOrderAttachmentsV73('o1').length, 1, 'az elo fuvar melleklete elveszett');
  });

  await test('A Csatolmany a helyi fajlt is megnyithatova teszi', async () => {
    const auth = fs.readFileSync(__dirname + '/auth-v44-2.js', 'utf8');
    const start = auth.indexOf('async function openSourceMail');
    const body = auth.slice(start, auth.indexOf('\n  }\n', start));
    assert.ok(body.includes('loadOrderAttachmentsV73'), 'nem nezi a helyi tarolot');
    assert.match(body, /onclick="openAttachmentV71\(this\.dataset\.url\)"/, 'a helyi fajl nem nyithato meg');
    assert.ok(body.includes('Szerverről'), 'nem valik el a helyi es a szerveroldali lista');
    // ha van helyi fajl, ne irjuk ki a hianyra utalo szoveget
    assert.match(body, /localHtml \? '' :/, 'helyi fajl mellett is hianyt jelez');
  });

  await test('A takaritas a mentessel egyutt fut', async () => {
    const app = fs.readFileSync(__dirname + '/app.js', 'utf8');
    assert.match(app, /function save\(renderNow=true\)\{stampLocalChanges\(\);reconcileState\('mentés'\);pruneOrderAttachmentsV73\(\);/,
      'a takaritas nem fut a mentessel');
  });

  await test('A levelablak a szoveget mutatja, nem a levelforrast', async () => {
    const src = fs.readFileSync(__dirname + '/auth-v44-2.js', 'utf8');
    const c = { console, String, RegExp, Object, Array };
    c.globalThis = c; c.global = c; c.window = c;
    vm.createContext(c);
    vm.runInContext(src.slice(src.indexOf('const MIME_HEADER_RE'), src.indexOf('async function openSourceMail')),
      c, { filename: 'mailbody' });

    const raw = ['Received: from tgfourtyfour.cpserver.net', ' by tgfourtyfour.cpserver.net with LMTP',
      'From:', 'To: =?iso-8859-2?B?QmVya2k=?= ,', 'References:', 'Date: Mon, 14 Sep 2026 10:10:48 +0200',
      'MIME-Version: 1.0', 'Content-Type: multipart/mixed;', '  boundary="----=_NextPart_000_0079"',
      'X-Mailer: Microsoft Outlook 16.0', 'Content-Language: hu', '',
      'Sziasztok,', '', 'A tartókat vigyétek ki a Moxy VUC-ra.', '', 'Üdvözlettel:', 'Lévai Edina'].join('\n');
    const out = c.readableMailBodyV73(raw);
    assert.ok(!/Received:|Content-Type:|X-Mailer|boundary=/.test(out), 'maradt levelfejlec: ' + out.slice(0, 120));
    assert.match(out, /A tartókat vigyétek ki a Moxy VUC-ra\./, 'elveszett az erdemi szoveg');
    assert.match(out, /Lévai Edina/, 'elveszett az alairas');
  });

  await test('A rendes levelet nem bantja', async () => {
    const src = fs.readFileSync(__dirname + '/auth-v44-2.js', 'utf8');
    const c = { console, String, RegExp, Object, Array };
    c.globalThis = c; c.global = c; c.window = c;
    vm.createContext(c);
    vm.runInContext(src.slice(src.indexOf('const MIME_HEADER_RE'), src.indexOf('async function openSourceMail')),
      c, { filename: 'mailbody' });
    const ok = 'Sziasztok,\n\nGienger anyagokat vigyétek ki.\n\nÜdvözlettel:\nLévai Edina';
    assert.equal(c.readableMailBodyV73(ok), ok, 'a rendes levelet is megvagta');
    // ha csak fejlec van, inkabb az eredetit mutatjuk, mint ures ablakot
    assert.ok(c.readableMailBodyV73('Received: x\nContent-Type: y').length > 0, 'ures ablakot adna');
    assert.equal(c.readableMailBodyV73(''), '', 'ures bemenetre nem ures a kimenet');
  });

  await test('A Nezetben a SORSZAM a huzofogantyu', async () => {
    const c = createContext();
    c.state.vehicles = [{ id: 'm', driverName: 'Márió', active: true }];
    c.state.orders = [{ id: 1, scheduleDate: '2026-09-01', vehicleId: 'm', sequence: 1, orderNo: '5601',
      pickupName: 'Szatmári', pickupAddress: '1158 Budapest, Késmárk utca 9.', projectName: 'Cosmo',
      dropAddress: '', items: [], sourceMail: { subject: 'x', body: 'y' } }];
    const html = c.V37Planner.groupedBubbles(c.state.orders, 'm', true);
    assert.match(html, /class="v56-index drag"/, 'a sorszam nem foghato meg');
    assert.ok(!html.includes('v56-drag-cell'), 'maradt kulon fogantyugomb');
    assert.ok(!/class="drag v56-drag"/.test(html), 'maradt a regi fogantyu');
    // a huzas a .drag osztalyt keresi – a sorszamnak ezt viselnie kell
    const v37 = fs.readFileSync(__dirname + '/planner-v37.js', 'utf8');
    assert.match(v37, /handle: '\.drag'/, 'megvaltozott a huzas fogantyuja');
  });

  await test('A sorszam elmondja, mire valo', async () => {
    const c = createContext();
    c.state.vehicles = [{ id: 'm', driverName: 'Márió', active: true }];
    c.state.orders = [{ id: 1, scheduleDate: '2026-09-01', vehicleId: 'm', sequence: 1, orderNo: '5601',
      pickupName: 'Szatmári', pickupAddress: 'cím', projectName: 'Cosmo', dropAddress: '', items: [] }];
    const html = c.V37Planner.groupedBubbles(c.state.orders, 'm', true);
    assert.match(html, /title="Fogd meg és told fel-le/, 'nincs magyarazo sugo');
    assert.match(html, /aria-label="Sorrend átrendezése"/, 'nincs kepernyoolvaso-felirat');
    const css = fs.readFileSync(__dirname + '/styles.css', 'utf8');
    assert.match(css, /\.v56-index\{[^}]*cursor:grab/, 'a sorszam nem mutat foghato kurzort');
    assert.ok(!css.includes('.v56-drag-cell{'), 'maradt a regi fogantyu stilusa');
  });

  if (!process.exitCode) console.log(`\nV74 elfogadási teszt: ${passed}/${total} sikeres.`);
})();
