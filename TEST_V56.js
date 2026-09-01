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

  await test('A motor verziója V56', async () => {
    assert.match(fs.readFileSync(__dirname + '/planner-v44.js', 'utf8'), /const VERSION = '56'/);
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
    await c.V56Planner.distributeOrderSetV44(c.state.orders);
    const driver = c.state.vehicles.find(v => v.id === c.state.orders[0].vehicleId)?.driverName;
    assert.equal(driver, 'Patrik', 'a PRPR nem Patrikhoz került: ' + driver);
    assert.match(String(c.state.orders[0].distributionReason || ''), /PRPR/, 'indoklás: ' + c.state.orders[0].distributionReason);
  });

  await test('A 3 méteres menetesszár nem szálanyag, tehát nem kötelező Martin', async () => {
    const c = createContext();
    assert.equal(c.V56Planner.v53IsLongOrder({ items: [{ name: 'Niczuk Menetesszár M10x3000mm - (25/doboz)' }] }), false);
    assert.equal(c.V56Planner.v53IsLongOrder({ items: [{ name: 'Menetes szál M10x6000mm' }] }), true);
  });

  await test('Semmilyen fájl nem ír beégetett verziószámot a fejlécbe', async () => {
    const files = ['app.js', 'auth-v44-2.js', 'online-v44-2.js', 'online-config.js',
      'planner-v41.js', 'planner-v43.js', 'planner-v44.js', 'index.html', 'manifest.webmanifest'];
    const bad = [];
    for (const file of files) {
      const text = fs.readFileSync(__dirname + '/' + file, 'utf8');
      // A tárolókulcsokban maradhat régi verzió (kiléptetés elkerülése végett),
      // de felhasználónak megjelenő feliratban nem.
      const lines = text.split('\n');
      lines.forEach((line, i) => {
        if (/SESSION_KEY|localStorage|sessionStorage/.test(line)) return;
        if (/Fuvarszervező\s*V5[0-5]\b/.test(line)) bad.push(`${file}:${i + 1}`);
        if (/APP_VERSION\s*=\s*['"]V5[0-5]['"]/.test(line)) bad.push(`${file}:${i + 1} APP_VERSION`);
        if (/setAppTitle\(\s*['"]/.test(line)) bad.push(`${file}:${i + 1} beégetett setAppTitle`);
      });
    }
    assert.equal(bad.length, 0, 'beégetett verziófelirat: ' + bad.join(' ; '));
  });

  await test('A belépés utáni címfrissítés is a motor verzióját használja', async () => {
    const auth = fs.readFileSync(__dirname + '/auth-v44-2.js', 'utf8');
    assert.ok(auth.includes('function appVersionLabel()'), 'hiányzik az appVersionLabel');
    assert.ok(auth.includes('V56Planner?.version'), 'nem a motorból olvassa a verziót');
    assert.ok(auth.includes('data-app-version'), 'a belépés után nem frissíti a fejléc horgonyát');
  });

  await test('A törzsadat exportálható data.js formátumban', async () => {
    const c = createContext();
    const result = c.V56Planner.exportMasterDataV55();
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
    await c.V56Planner.drawMapV49('m');
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
    const events = await c.V56Planner.buildManualRouteV55(vehicle);
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
    const events = await c.V56Planner.buildManualRouteV55(vehicle);
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
    await c.V56Planner.drawMapV49('m');            // csak rajzolás
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
    assert.ok(v37.includes('function renderCompactRowV56'), 'nincs kompakt sor');
    assert.ok(/if \(options\.focus\) return renderCompactRowV56/.test(v37),
      'a kompakt sor nem csak a Nézetben aktív');
    const start = v37.indexOf('function renderCompactRowV56');
    const body = v37.slice(start, v37.indexOf('\n  }\n', start));
    assert.ok(body.includes('v56-line-top') && body.includes('v56-line-drop'), 'hiányzik a két sor');
    assert.ok(body.includes('v56-items-btn'), 'hiányzik a tételek gomb');
    assert.ok(body.includes('route-block'), 'a húzás szelektora elveszett');
    assert.ok(!body.includes('bubble-main-line'), 'a régi három sor bent maradt');
  });

  await test('A kompakt sor a projekteket összevonva mutatja', async () => {
    const v37 = fs.readFileSync(__dirname + '/planner-v37.js', 'utf8');
    assert.ok(v37.includes('function projectSummaryV56'), 'nincs projekt-összegző');
    assert.match(v37, /\+\$\{names\.length - 1\} projekt/, 'nincs "+N projekt" rövidítés');
  });

  await test('A ritka műveletek a menübe kerültek', async () => {
    const v37 = fs.readFileSync(__dirname + '/planner-v37.js', 'utf8');
    for (const fn of ['v56ToggleMenu', 'v56ToggleItems', 'v56CloseMenus']) {
      assert.ok(v37.includes(`global.${fn} =`), 'hiányzik: ' + fn);
    }
    const start = v37.indexOf('<div class="v56-menu"');
    const menu = v37.slice(start, v37.indexOf('</div>', start));
    for (const action of ['v37TogglePin', 'v33ToggleFullLoad', 'editOrder', 'v37ToggleGroupComplete', 'v33DeleteGroup']) {
      assert.ok(menu.includes(action), 'a menüből hiányzik: ' + action);
    }
  });

  await test('A kompakt sor stílusa bekerült a styles.css-be', async () => {
    const css = fs.readFileSync(__dirname + '/styles.css', 'utf8');
    for (const cls of ['.v56-row', '.v56-line-top', '.v56-line-drop', '.v56-items-btn', '.v56-menu', '.v56-items']) {
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
    assert.equal(drops[0], 'Le Jardin', 'lerakó sor: ' + drops[0]);
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

  if (!process.exitCode) console.log(`\nV56 elfogadási teszt: ${passed}/${total} sikeres.`);
})();
