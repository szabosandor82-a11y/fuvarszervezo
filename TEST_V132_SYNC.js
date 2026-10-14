/* Fuvarszervező V132 – a sofőri pipa és a szállítólevél-jelölés
   viselkedési tesztjei. A TEST_V132.js futtatja, külön is indítható:
     node TEST_V132_SYNC.js                                              */
const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

const clone = value => JSON.parse(JSON.stringify(value));
const tick = () => new Promise(resolve => setImmediate(resolve));
function gate() {
  let open;
  const promise = new Promise(resolve => { open = resolve; });
  return { promise, open };
}

/* Egy böngésző nélküli környezet: vezérelt időzítők, hamis szerver, a
   valódi online-v44-2.js összefésülő függvényei és a valódi auth-v44-2.js. */
function createEnv(role = 'driver') {
  const timers = [];
  let timerSeq = 0;
  const server = new Map();
  const calls = { changed: [], own: [], forDate: [], driverFields: [] };
  const hooks = { fetchGate: null, ownGate: null, fetchRows: null };
  const noop = () => {};
  const documentStub = {
    readyState: 'loading', hidden: false, visibilityState: 'visible',
    addEventListener: noop, querySelectorAll: () => [], querySelector: () => null,
    getElementById: () => null, body: { classList: { add: noop, remove: noop } }
  };
  const ctx = {
    console: { log: noop, info: noop, warn: noop, error: noop },
    Date, Map, Set, Number, String, Object, Array, JSON, Math, Promise, Error, RegExp, Boolean, Intl,
    URLSearchParams, URL, Blob, ArrayBuffer, FormData, File: class {},
    document: documentStub,
    localStorage: { getItem: () => null, setItem: noop, removeItem: noop },
    alert: noop, confirm: () => true, CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init?.detail; } },
    dispatchEvent: noop, addEventListener: noop, requestAnimationFrame: noop,
    setInterval: () => 0, clearInterval: noop,
    setTimeout: (fn, ms = 0) => { const id = ++timerSeq; timers.push({ id, fn, ms }); return id; },
    clearTimeout: id => { const i = timers.findIndex(t => t.id === id); if (i >= 0) timers.splice(i, 1); },
    FUVARSZERVEZO_ONLINE_CONFIG: { supabaseUrl: 'https://example.supabase.co', anonKey: 'test-key' },
    fetch: async () => ({ ok: true, status: 200, statusText: 'OK', text: async () => '[]' })
  };
  ctx.window = ctx; ctx.globalThis = ctx;
  ctx.state = { orders: [], backlog: [], vehicles: [], settings: {} };
  ctx.saveCount = 0;
  ctx.save = function () { ctx.saveCount++; };
  ctx.render = noop;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(__dirname + '/online-v44-2.js', 'utf8'), ctx, { filename: 'online-v44-2.js' });

  const online = ctx.V44Online;
  const rows = () => [...server.values()].map(clone);
  Object.assign(online, {
    configured: () => true,
    fetchOrders: async () => {
      const snapshot = hooks.fetchRows ? hooks.fetchRows() : rows();
      if (hooks.fetchGate) await hooks.fetchGate.promise;
      return clone(snapshot);
    },
    fetchOrdersSinceV132: async () => rows(),
    fetchBacklog: async () => [],
    listTransfers: async () => [],
    fetchDeliveryFileCountsV132: async () => new Map(),
    syncChangedOrdersV132: async (changes) => {
      calls.changed.push(clone(changes));
      for (const order of changes.orders || []) server.set(String(order.id), clone(order));
      for (const id of changes.deletedIds || []) server.delete(String(id));
      return {};
    },
    updateOwnOrder: async order => {
      const sent = clone(order);
      calls.own.push(sent);
      if (hooks.ownGate) await hooks.ownGate.promise;
      server.set(String(order.id), sent);
    },
    setDriverFieldsV132: async order => { calls.driverFields.push(clone(order)); return true; },
    syncOrdersForDate: async (date, orders) => { calls.forDate.push(clone(orders)); for (const o of orders) server.set(String(o.id), clone(o)); },
    syncOrderThread: async () => {},
    syncMasterData: async () => {}
  });

  vm.runInContext(fs.readFileSync(__dirname + '/auth-v44-2.js', 'utf8'), ctx, { filename: 'auth-v44-2.js' });
  const t = ctx.__V132SyncTest;
  t.installSaveHook();
  t.setProfile(role === 'admin' ? { role: 'admin' } : { role: 'driver', driver_key: 'mario' });

  async function runTimers(rounds = 20) {
    for (let i = 0; i < rounds; i++) {
      await tick();
      if (!timers.length) { await tick(); if (!timers.length) return; }
      const due = timers.splice(0, timers.length);
      for (const timer of due) { try { await timer.fn(); } catch (_) {} }
    }
  }
  function load(orders) {
    server.clear();
    for (const order of orders) server.set(String(order.id), clone(order));
    ctx.state.orders = orders.map(clone);
    t.resetSnapshot();
  }
  const local = id => ctx.state.orders.find(order => String(order.id) === String(id));
  return { ctx, server, calls, hooks, t, runTimers, load, local, online };
}

const base = (id, extra = {}) => ({ id, scheduleDate: '2026-10-14', vehicleId: 'v-mario', orderNo: `00${id}`, sequence: 1,
  completed: false, items: [{ _id: `${id}-1`, code: 'A', received: false }], ...extra });

async function run(test) {
  await test('V132: régi frissítési válasz nem tünteti el a sofőr pipáját', async () => {
    const env = createEnv('driver');
    env.load([base('o1'), base('o2')]);
    const stale = [...env.server.values()].map(clone);   // a lekérés a pipa ELŐTT indult

    const order = env.local('o1');
    order.completed = true; order.completedAtV111 = '2026-10-14T10:00:00.000Z'; order.completedAt = order.completedAtV111;
    order.items.forEach(item => { item.received = true; });
    env.ctx.save();
    env.hooks.ownGate = gate();
    const write = env.ctx.directOrderWriteV132(order);

    env.hooks.fetchRows = () => stale;
    await env.t.reload();
    env.hooks.fetchRows = null;
    assert.equal(env.local('o1').completed, true, 'a frissítés eltüntette a helyi pipát');
    assert.equal(env.local('o1').items[0].received, true, 'a frissítés visszavette a tétel átvételét');

    env.hooks.ownGate.open();
    await write;
    await env.runTimers();
    assert.equal(env.server.get('o1').completed, true, 'a szerveren nem maradt meg a teljesítés');
    const staleWrites = env.calls.changed.flatMap(call => call.orders || []).filter(o => o.id === 'o1' && !o.completed);
    assert.equal(staleWrites.length, 0, 'a késleltetett mentés régi, pipa nélküli példányt küldött fel');

    await env.t.reload();
    assert.equal(env.local('o1').completed, true, 'a következő frissítés után eltűnt a pipa');
  });

  await test('V132: a mentés befejezése előtt indult frissítés sem írja vissza a régi állapotot', async () => {
    const env = createEnv('driver');
    env.load([base('o1')]);
    const stale = [...env.server.values()].map(clone);
    env.hooks.fetchRows = () => stale;
    env.hooks.fetchGate = gate();
    const reload = env.t.reload();                        // a lekérés úton van
    const order = env.local('o1');
    order.completed = true; order.completedAtV111 = '2026-10-14T10:05:00.000Z'; order.completedAt = order.completedAtV111;
    env.ctx.save();
    await env.ctx.directOrderWriteV132(order);            // a mentés közben lefut
    env.hooks.fetchGate.open();                           // most érkezik meg a régi válasz
    await reload;
    env.hooks.fetchRows = null; env.hooks.fetchGate = null;
    assert.equal(env.local('o1').completed, true, 'a régi válasz eltüntette a pipát');
    await env.runTimers();
    assert.equal(env.server.get('o1').completed, true);
  });

  await test('V132: a sofőr csak a módosított fuvart küldi fel', async () => {
    const env = createEnv('driver');
    env.load([base('o1'), base('o2'), base('o3')]);
    env.local('o2').items[0].received = true;
    env.ctx.save();
    await env.runTimers();
    const sent = env.calls.changed.flatMap(call => call.orders || []).map(order => order.id);
    assert.deepEqual(sent, ['o2'], 'nem csak a módosított fuvar ment fel: ' + sent.join(','));
  });

  await test('V132: a szállítólevél jelölése a frissítés után is megmarad', async () => {
    const env = createEnv('driver');
    env.load([base('o1')]);
    const stale = [...env.server.values()].map(clone);
    const order = env.local('o1');
    order.deliveryReports = [{ id: 'r1', at: '2026-10-14T09:00:00.000Z', photoCount: 2, fileCount: 2 }];
    env.ctx.save();
    env.hooks.ownGate = gate();
    const write = env.ctx.directOrderWriteV132(order);
    env.hooks.fetchRows = () => stale;
    await env.t.reload();
    env.hooks.fetchRows = null;
    assert.equal((env.local('o1').deliveryReports || []).length, 1, 'a frissítés eltüntette a szállítólevél jelölését');
    env.hooks.ownGate.open();
    await write; await env.runTimers();
    assert.equal(env.server.get('o1').deliveryReports.length, 1);
  });

  await test('V132: a tudatos visszavonás időbélyeget kap és érvényesül', async () => {
    const env = createEnv('driver');
    env.load([base('o1', { completed: true, completedAt: '2000-01-01T08:00:00.000Z', completedAtV111: '2000-01-01T08:00:00.000Z' })]);
    const order = env.local('o1');
    order.completed = false; order.completedAt = ''; delete order.completedAtV111;
    env.ctx.save();
    assert.ok(order.completedUndoneAtV132 > '2000-01-01T08:00:00.000Z', 'a visszavonás nem kapott időbélyeget');
    const result = env.online.completionStateV132({ completed: true, completedAt: '2000-01-01T08:00:00.000Z' }, order);
    assert.equal(result.completed, false, 'a visszavonás nem ment át');
  });

  await test('V132: a teljesítés időrend szerint dől el', async () => {
    const env = createEnv('admin');
    const s = env.online.completionStateV132;
    assert.equal(s({ completed: false }, { completed: true, completedAt: '2026-10-14T10:00:00Z' }).completed, true, 'a régi, pipa nélküli példány törölte a pipát');
    assert.equal(s({ completed: true, completedAt: '2026-10-14T10:00:00Z' }, { completed: false, completedUndoneAtV132: '2026-10-14T11:00:00Z' }).completed, false, 'a későbbi visszavonás nem érvényesült');
    assert.equal(s({ completed: true, completedAt: '2026-10-14T12:00:00Z' }, { completed: false, completedUndoneAtV132: '2026-10-14T11:00:00Z' }).completed, true, 'a régebbi visszavonás felülírta az újabb pipát');
    assert.equal(s({ completed: true }, {}).completed, true, 'a régi, idő nélküli pipa elveszett');
    const merged = env.online.mergeAdminDriverFieldsV131({ id: 'o1', sequence: 4, completed: false, deliveryReports: [] },
      { completed: true, completedAt: '2026-10-14T10:00:00Z', deliveryReports: [{ id: 'r1', at: '2026-10-14T09:00:00Z' }] });
    assert.equal(merged.completed, true); assert.equal(merged.sequence, 4); assert.equal(merged.deliveryReports.length, 1);
  });

  await test('V132: az admin mentése csak a módosítottat írja, és csak a ténylegesen törölt fuvart törli', async () => {
    const env = createEnv('admin');
    env.load([base('o1'), base('o2'), base('o3')]);
    env.server.set('o9', base('o9', { createdByDriver: true }));   // a sofőr közben létrehozta
    env.local('o2').sequence = 7;
    env.ctx.state.orders = env.ctx.state.orders.filter(order => order.id !== 'o3');
    env.ctx.save();
    await env.runTimers();
    const call = env.calls.changed.at(-1);
    assert.deepEqual(call.orders.map(order => order.id), ['o2']);
    assert.deepEqual(call.deletedIds, ['o3']);
    assert.ok(env.server.has('o9'), 'az admin törölte a sofőr által létrehozott fuvart');
  });

  await test('V132: a célzott online mentés nem töröl és a sofőri mezőket megőrzi', async () => {
    const requests = [];
    const remote = { id: 'o1', updated_at: '2026-10-14T11:00:00Z', payload: { completed: true, completedAt: '2026-10-14T10:55:00Z', deliveryReports: [{ id: 'r1', at: '2026-10-14T10:50:00Z' }] } };
    const ctx = {
      console, Date, Map, Set, Number, String, Object, Array, JSON, Math, Promise, Error, URLSearchParams, URL, Blob, ArrayBuffer, FormData,
      FUVARSZERVEZO_ONLINE_CONFIG: { supabaseUrl: 'https://example.supabase.co', anonKey: 'test-key' },
      localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
      fetch: async (url, options = {}) => {
        requests.push({ url: String(url), options });
        const isLogin = String(url).includes('/auth/v1/token');
        const isRead = String(url).includes('/rest/v1/orders?') && (options.method || 'GET') === 'GET';
        const payload = isLogin ? { access_token: 'a', refresh_token: 'r', expires_in: 3600, user: { email: 'admin@example.com' } } : isRead ? [remote] : [];
        return { ok: true, status: 200, statusText: 'OK', text: async () => JSON.stringify(payload) };
      }
    };
    ctx.window = ctx; ctx.globalThis = ctx; vm.createContext(ctx);
    vm.runInContext(fs.readFileSync(__dirname + '/online-v44-2.js', 'utf8'), ctx);
    await ctx.V44Online.signInWithPassword('admin@example.com', 'x');
    const before = requests.length;
    await ctx.V44Online.syncChangedOrdersV132({ orders: [{ id: 'o1', scheduleDate: '2026-10-14', sequence: 3, completed: false, deliveryReports: [] }], deletedIds: ['o3'] }, { role: 'admin' });
    const later = requests.slice(before);
    assert.ok(!later.some(r => /orders\?select=id$/.test(r.url)), 'teljes listás törlési söprés maradt');
    const deletes = later.filter(r => r.options.method === 'DELETE');
    assert.equal(deletes.length, 1); assert.ok(decodeURIComponent(deletes[0].url).includes('"o3"'));
    const write = JSON.parse(later.find(r => r.options.method === 'POST' && r.url.includes('orders?on_conflict=id')).options.body)[0];
    assert.equal(write.payload.completed, true, 'a régi admin-példány törölte a pipát');
    assert.equal(write.payload.deliveryReports.length, 1, 'a régi admin-példány törölte a szállítólevelet');
    assert.equal(write.payload.sequence, 3, 'az admin módosítása elveszett');
  });

  await test('V132: az admin háttérfrissítése átveszi a pipát, de a tervezést nem írja felül', async () => {
    const env = createEnv('admin');
    env.load([base('o1', { sequence: 3 })]);
    env.server.set('o1', base('o1', { sequence: 1, completed: true, completedAt: '2026-10-14T10:00:00Z',
      items: [{ _id: 'o1-1', code: 'A', received: true }], deliveryReports: [{ id: 'r1', at: '2026-10-14T09:00:00Z', fileCount: 1 }] }));
    env.server.set('o9', base('o9'));
    await env.t.adminPoll();
    const o1 = env.local('o1');
    assert.equal(o1.completed, true, 'a pipa nem jelent meg az adminnál');
    assert.equal(o1.deliveryReports.length, 1, 'a szállítólevél nem jelent meg az adminnál');
    assert.equal(o1.sequence, 3, 'a háttérfrissítés felülírta az admin sorrendjét');
    assert.ok(env.local('o9'), 'a sofőr által létrehozott fuvar nem jelent meg');
    assert.equal(env.t.collect().orders.length, 0, 'a beolvasott sofőri adat feleslegesen visszamenne');
  });

  await test('V132: a Mentett fotók gomb a fájltáblából is bezöldül', () => {
    const src = fs.readFileSync(__dirname + '/app.js', 'utf8');
    const start = src.indexOf('function deliveryPhotoCountV132');
    assert.ok(src.indexOf('function liveDeliveryReportsV133') < start);
    const c = { Map, Math, String, window: null };
    c.window = c; vm.createContext(c);
    vm.runInContext(src.slice(src.indexOf('function liveDeliveryReportsV133'), src.indexOf('window.deliveryPhotoCountV132', start)), c);
    assert.equal(c.deliveryPhotoCountV132({ id: 'o1', deliveryReports: [] }), 0);
    c.deliveryFileCountsV132 = new Map([['o1', 2]]);
    assert.equal(c.deliveryPhotoCountV132({ id: 'o1', deliveryReports: [] }), 2, 'elveszett jelölésnél a fájl sem zöldíti');
    assert.equal(c.deliveryPhotoCountV132({ id: 'o1', deliveryReports: [{ photoCount: 3 }] }), 3);
    const v37 = fs.readFileSync(__dirname + '/planner-v37.js', 'utf8');
    assert.ok(v37.includes('global.deliveryPhotoCountV132(order)'), 'a buborék nem a közös számlálót használja');
  });

  await test('V132: az újraimport átviszi a szállítólevél jelölését', () => {
    const src = fs.readFileSync(__dirname + '/app.js', 'utf8');
    const start = src.indexOf('function carryDeliveryMarksV132');
    const c = { Map, String, norm: s => String(s).toLowerCase().trim() };
    vm.createContext(c);
    vm.runInContext(src.slice(start, src.indexOf('window.carryDeliveryMarksV132', start)), c);
    const regi = [{ id: 'old', orderNo: '6808', pickupName: 'Merkapt', deliveryReports: [{ id: 'r1' }] }];
    const uj = [{ id: 'new', orderNo: '6808', pickupName: 'Merkapt' }, { id: 'x', orderNo: '1', pickupName: 'B' }];
    assert.equal(c.carryDeliveryMarksV132(regi, uj), 1);
    assert.equal(uj[0].deliveryReports[0].id, 'r1');
    assert.ok(!uj[1].deliveryReports);
    assert.ok(fs.readFileSync(__dirname + '/planner-v41.js', 'utf8').includes('carryDeliveryMarksV132(lecsereltek, accepted)'));
  });

  await test('V132: a szerveroldali védelem SQL-je a csomagban van', () => {
    const sql = fs.readFileSync(__dirname + '/SUPABASE_SOFOR_MEZOK_V133.sql', 'utf8');
    for (const part of ['set_driver_fields_v132', 'orders_keep_driver_fields_v132', 'before update on public.orders', 'union_reports_v133', 'completedUndoneAtV132']) {
      assert.ok(sql.includes(part), 'hiányzik: ' + part);
    }
  });
}

module.exports = { run, createEnv };

if (require.main === module) {
  (async () => {
    let passed = 0, total = 0;
    await run(async (name, fn) => {
      total++;
      try { await fn(); console.log('OK', name); passed++; }
      catch (e) { console.error('HIBA', name, e.message); process.exitCode = 1; }
    });
    console.log(`\nV132 szinkronteszt: ${passed}/${total} sikeres.`);
  })();
}
