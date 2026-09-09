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

  await test('A motor verziója V63', async () => {
    assert.match(fs.readFileSync(__dirname + '/planner-v44.js', 'utf8'), /const VERSION = '63'/);
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
    await c.V63Planner.distributeOrderSetV44(c.state.orders);
    const driver = c.state.vehicles.find(v => v.id === c.state.orders[0].vehicleId)?.driverName;
    assert.equal(driver, 'Patrik', 'a PRPR nem Patrikhoz került: ' + driver);
    assert.match(String(c.state.orders[0].distributionReason || ''), /PRPR/, 'indoklás: ' + c.state.orders[0].distributionReason);
  });

  await test('A 3 méteres menetesszár nem szálanyag, tehát nem kötelező Martin', async () => {
    const c = createContext();
    assert.equal(c.V63Planner.v53IsLongOrder({ items: [{ name: 'Niczuk Menetesszár M10x3000mm - (25/doboz)' }] }), false);
    assert.equal(c.V63Planner.v53IsLongOrder({ items: [{ name: 'Menetes szál M10x6000mm' }] }), true);
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
    assert.ok(auth.includes('V63Planner?.version'), 'nem a motorból olvassa a verziót');
    assert.ok(auth.includes('data-app-version'), 'a belépés után nem frissíti a fejléc horgonyát');
  });

  await test('A törzsadat exportálható data.js formátumban', async () => {
    const c = createContext();
    const result = c.V63Planner.exportMasterDataV55();
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
    await c.V63Planner.drawMapV49('m');
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
    const events = await c.V63Planner.buildManualRouteV55(vehicle);
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
    const events = await c.V63Planner.buildManualRouteV55(vehicle);
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
    await c.V63Planner.drawMapV49('m');            // csak rajzolás
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
    await c.V63Planner.buildRoutePlansV44();
    const order = (c.state.routePlans['2026-09-01']?.m || []).filter(e => e.type === 'pickup').map(e => e.name);
    assert.deepEqual(order, ['Néber', 'Szatmári kp', 'Ryng', 'ISG Uniball', 'Lambda kp'],
      'sorrend: ' + order.join(' → '));
  });

  await test('A lánc-kereső hét megállóig pontos optimumot ad', async () => {
    const c = createContext();
    const chain = c.V63Planner.chainOrderV53;
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
    const drag = css.match(/\.v56-drag\{[^}]*width:(\d+)px;height:(\d+)px/);
    assert.ok(drag, 'nincs méretezett húzófogantyú');
    assert.ok(+drag[1] >= 28 && +drag[2] >= 32, 'a fogantyú kicsi: ' + drag[1] + 'x' + drag[2]);
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
    assert.equal(row[1], '', 'a Sorrend oszlopnak uresnek kell maradnia');
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

  await test('Az export felrako, majd projekt szerint rendez', async () => {
    const c = exportCtx();
    c.state.vehicles = [{ id: 'm', driverName: 'Márió' }, { id: 't', driverName: 'Martin' }];
    c.state.orders = [
      exportOrder('t', '3', 'KRPR', 'cim', 'Le Jardin', 'x', '', '', ''),
      exportOrder('m', '1', 'Ezerker kp', 'cim', 'Cosmo', 'x', '', '', ''),
      exportOrder('t', '2', 'KRPR', 'cim', 'Cosmo', 'x', '', '', '')
    ];
    c.exportExcel();
    const rows = c.written.book.Sheets.Fuvarok.aoa.slice(4).map(r => `${r[3]}/${r[7]}`);
    assert.deepEqual(rows, ['Ezerker kp/Cosmo', 'KRPR/Cosmo', 'KRPR/Le Jardin'], 'rendezes: ' + rows.join(', '));
  });

  await test('Ures napon nem keszul fajl', async () => {
    const c = exportCtx();
    c.state.vehicles = [{ id: 'm', driverName: 'Márió' }];
    c.exportExcel();
    assert.equal(c.written, null, 'ures napon is irt fajlt');
    assert.match(String(c.lastAlert || ''), /nincs export/i, 'nem szolt a felhasznalonak');
  });

  if (!process.exitCode) console.log(`\nV63 elfogadási teszt: ${passed}/${total} sikeres.`);
})();
