/* Fuvarszervező V137 – a szerveren törölt fuvar nem ragad a telefonon,
   és egy elutasított fuvar nem akasztja meg a többi mentését.
   A TEST_V137.js futtatja, külön is indítható: node TEST_V137_FEATURES.js */
const fs = require('fs');
const vm = require('vm');
const assert = require('assert');
const { createEnv } = require('./TEST_V132_SYNC.js');

/* A szerver úgy viselkedik, mint a valódi sync_own_orders: nem létező
   fuvart csak hátralék-átütemezésből fogad el, különben az egész kérést
   elutasítja. */
function driverEnv() {
  const env = createEnv('driver');
  env.online.syncChangedOrdersV132 = async changes => {
    env.calls.changed.push(JSON.parse(JSON.stringify(changes)));
    for (const order of changes.orders || []) {
      if (!env.server.has(String(order.id)) && !order.movedFromOrderId) throw new Error('Új fuvar csak hátralékos tétel átütemezésével hozható létre.');
    }
    for (const order of changes.orders || []) env.server.set(String(order.id), JSON.parse(JSON.stringify(order)));
    return {};
  };
  env.online.fetchOrderPayloadsV132 = async ids => new Map(ids.filter(id => env.server.has(String(id))).map(id => [String(id), env.server.get(String(id))]));
  return env;
}
const o = (id, extra = {}) => ({ id, scheduleDate: '2026-10-14', vehicleId: 'v-patrik', orderNo: id, sequence: 1, items: [], ...extra });

async function run(test) {
  await test('V137: indításkor a szerveren törölt fuvar eltűnik, az új hátralék-fuvar megmarad', async () => {
    const env = driverEnv();
    env.server.set('o1', o('o1'));
    env.ctx.state.orders = [o('o1'), o('06935'), o('uj', { movedFromOrderId: 'o1', localUpdatedAt: new Date().toISOString() })];
    await env.t.initialLoad();
    const ids = env.ctx.state.orders.map(order => order.id).sort();
    assert.deepEqual(ids, ['o1', 'uj'], 'a törölt fuvar megmaradt, vagy az új elveszett: ' + ids.join(','));
    assert.ok(env.server.has('uj'), 'az új hátralék-fuvar nem jutott fel');
    assert.ok(env.t.knownIds().has('o1') && env.t.knownIds().has('uj'));
  });

  await test('V137: a már ismert, de a szerverről törölt fuvar hátralék-fuvarként sem tér vissza', async () => {
    const env = driverEnv();
    env.t.rememberIds(['regi']);
    env.load([o('o1')]);
    env.ctx.state.orders.push(o('regi', { movedFromOrderId: 'o1' }));
    await env.t.reload();
    assert.deepEqual(env.ctx.state.orders.map(order => order.id), ['o1'], 'a törölt fuvar a frissítés után is ott maradt');
  });

  await test('V137: egy elutasított fuvar nem akasztja meg a többi mentését', async () => {
    const env = driverEnv();
    env.load([o('o1'), o('o2')]);
    env.ctx.state.orders.push(o('szellem'));               // a szerveren törölt, helyben ragadt fuvar
    env.local('o1').completed = true;
    env.local('o1').completedAt = '2026-10-14T10:00:00Z';
    env.ctx.save();
    await env.runTimers(30);
    assert.equal(env.server.get('o1').completed, true, 'a pipa nem jutott fel a ragadt fuvar miatt');
    assert.ok(!env.ctx.state.orders.some(order => order.id === 'szellem'), 'a szerveren nem létező fuvar a telefonon maradt');
    assert.equal(env.t.collect().orders.length, 0, 'maradt fel nem küldött változás');
  });

  await test('V137: újraimportnál a régi fuvar törlése a mellékletek átkötéséig várakozik', () => {
    const env = createEnv('admin');
    env.load([o('regi'), o('masik')]);
    env.ctx.holdOrderDeletionV137(['regi']);
    env.ctx.state.orders = env.ctx.state.orders.filter(order => order.id !== 'regi');
    assert.deepEqual(env.t.collect().deletedIds, [], 'a régi fuvar a mellékletek átkötése előtt törlődne');
    env.ctx.releaseOrderDeletionV137(['regi']);
    assert.deepEqual(env.t.collect().deletedIds, ['regi']);
    const v41 = fs.readFileSync(__dirname + '/planner-v41.js', 'utf8');
    const holdAt = v41.indexOf('global.holdOrderDeletionV137([...replaceIds])');
    const removeAt = v41.indexOf('state.orders = (state.orders || []).filter(order => !replaceIds.has(order.id));');
    assert.ok(holdAt > 0 && holdAt < removeAt, 'a visszatartás a helyi törlés után jön');
    const relinkAt = v41.indexOf('await global.V44Online.relinkDeliveryFiles(regiId, ujId)');
    const releaseAt = v41.indexOf('global.releaseOrderDeletionV137?.(visszatartott)');
    assert.ok(relinkAt > 0 && releaseAt > relinkAt, 'a törlés az átkötés előtt engedődik el');
  });

  await test('V137: az átkötés a bejegyzéseket is viszi, nem csak a fájlsorokat', async () => {
    const requests = [];
    const ctx = {
      console: { log() {}, warn() {}, info() {}, error() {} }, Date, Map, Set, Number, String, Object, Array, JSON, Math, Promise, Error,
      URLSearchParams, URL, Blob, ArrayBuffer, FormData,
      FUVARSZERVEZO_ONLINE_CONFIG: { supabaseUrl: 'https://example.supabase.co', anonKey: 'k' },
      localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
      fetch: async (url, options = {}) => {
        requests.push({ url: String(url), method: options.method || 'GET', body: options.body });
        const payload = String(url).includes('/auth/v1/token') ? { access_token: 'a', refresh_token: 'r', expires_in: 3600, user: { email: 'x@y' } } : [{ id: 1 }];
        return { ok: true, status: 200, statusText: 'OK', text: async () => JSON.stringify(payload) };
      }
    };
    ctx.window = ctx; ctx.globalThis = ctx; vm.createContext(ctx);
    vm.runInContext(fs.readFileSync(__dirname + '/online-v44-2.js', 'utf8'), ctx);
    await ctx.V44Online.signInWithPassword('x@y', 'p');
    const result = await ctx.V44Online.relinkDeliveryFiles('regi', 'uj');
    const patches = requests.filter(r => r.method === 'PATCH');
    assert.ok(patches.some(r => r.url.includes('/delivery_report_files?') && r.url.includes('order_id=eq.regi')), 'a fájlsorok nem kötődtek át');
    assert.ok(patches.some(r => r.url.includes('/delivery_reports?') && r.url.includes('order_id=eq.regi')), 'a bejegyzések nem kötődtek át');
    assert.ok(patches.every(r => JSON.parse(r.body).order_id === 'uj'));
    assert.deepEqual(result, { moved: 1, reports: 1 });
  });
}

module.exports = { run };

if (require.main === module) {
  (async () => {
    let passed = 0, total = 0;
    await run(async (name, fn) => {
      total++;
      try { await fn(); console.log('OK', name); passed++; }
      catch (e) { console.error('HIBA', name, e.message); process.exitCode = 1; }
    });
    console.log(`\nV137 funkcióteszt: ${passed}/${total} sikeres.`);
  })();
}
