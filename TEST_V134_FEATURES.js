/* Fuvarszervező V134 – sofőri törlés és a Mentett fotók gomb pontos
   állapota. A TEST_V134.js futtatja, külön is indítható:
     node TEST_V134_FEATURES.js */
const fs = require('fs');
const vm = require('vm');
const assert = require('assert');
const { createEnv } = require('./TEST_V132_SYNC.js');

const isoDay = offset => { const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() + offset); return d.toISOString().slice(0, 10); };

function appHelpers() {
  const src = fs.readFileSync(__dirname + '/app.js', 'utf8');
  const c = { Map, Set, Math, String, Array, window: null };
  c.window = c; vm.createContext(c);
  vm.runInContext(src.slice(src.indexOf('function liveDeliveryReportsV133'), src.indexOf('window.deliveryArchiveSuffixV133')), c);
  return c;
}

function onlineWith(handler) {
  const requests = [];
  const ctx = {
    console: { log() {}, warn() {}, info() {}, error() {} }, Date, Map, Set, Number, String, Object, Array, JSON, Math, Promise, Error,
    URLSearchParams, URL, Blob, ArrayBuffer, FormData,
    FUVARSZERVEZO_ONLINE_CONFIG: { supabaseUrl: 'https://example.supabase.co', anonKey: 'k' },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    fetch: async (url, options = {}) => {
      url = String(url); requests.push({ url, options });
      const payload = url.includes('/auth/v1/token') ? { access_token: 'a', refresh_token: 'r', expires_in: 3600, user: { email: 'x@y' } } : handler(url, options);
      return { ok: true, status: 200, statusText: 'OK', text: async () => JSON.stringify(payload ?? []) };
    }
  };
  ctx.window = ctx; ctx.globalThis = ctx; vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(__dirname + '/online-v44-2.js', 'utf8'), ctx);
  return { online: ctx.V44Online, requests };
}

async function run(test) {
  await test('V134: üres galériánál a gomb alapállapotban van, szám nélkül', () => {
    const c = appHelpers();
    c.deliveryFileCountsV132 = new Map([['o1', 0], ['o2', 2]]);
    c.deliveryFileCountsLoadedV134 = true;
    const stale = c.deliveryStateV134([{ id: 'o1', deliveryReports: [{ id: 'r1', photoCount: 3 }] }]);
    assert.equal(stale.marked, false, 'fájl nélkül is zöld maradt a régi jelölés miatt');
    assert.equal(stale.label, 'Mentett fotók', 'fájl nélkül is számot ír: ' + stale.label);
    const full = c.deliveryStateV134([{ id: 'o2', deliveryReports: [{ id: 'r2', photoCount: 7 }] }]);
    assert.equal(full.label, 'Mentett fotók (2)', 'nem a valós fájlszámot írja: ' + full.label);
    assert.equal(full.marked, true);
    const archived = c.deliveryStateV134([{ id: 'o1', deliveryReports: [{ id: 'r1', photoCount: 3, archivedAtV133: '2026-10-14' }] }]);
    assert.equal(archived.marked, true, 'az archivált szállítólevél jelölése elveszett');
    assert.equal(archived.label, 'Mentett fotók · archiválva');
    const mixed = c.deliveryStateV134([{ id: 'o2', deliveryReports: [{ id: 'r1', photoCount: 3, archivedAtV133: '1' }, { id: 'r2', photoCount: 2 }] }]);
    assert.equal(mixed.label, 'Mentett fotók (2) · 3 archiválva');
  });

  await test('V134: a galéria megnyitása eltakarítja a fájl nélküli maradványjelölést', () => {
    const env = createEnv('admin');
    env.load([{ id: 'o1', scheduleDate: isoDay(0), deliveryReports: [
      { id: 'r1', at: '1', photoCount: 2 }, { id: 'r2', at: '2', photoCount: 1 }, { id: 'r3', at: '3', photoCount: 4, archivedAtV133: '2026-10-01' }] }]);
    env.ctx.deliveryFileCountsV132 = new Map();
    env.ctx.healDeliveryMarksV134([env.local('o1')], [{ id: 'f2', order_id: 'o1', report_id: 'r2' }]);
    const o = env.local('o1');
    assert.deepEqual(o.deliveryReports.map(r => r.id), ['r2', 'r3'], 'a maradványjelölés megmaradt, vagy az archivált elveszett');
    assert.deepEqual(o.deliveryReportsDeletedV133, ['r1']);
    assert.equal(env.ctx.deliveryFileCountsV132.get('o1'), 1, 'a fájlszám nem igazodott a galériához');
    assert.ok(env.t.collect().orders.some(order => order.id === 'o1'), 'a takarítás nem megy fel a szerverre');
  });

  await test('V134: a sofőr csak az aktív napon, a saját fuvarján törölhet', () => {
    const env = createEnv('driver');
    env.t.setProfile({ role: 'test' });
    env.load([
      { id: 'ma', scheduleDate: isoDay(0), deliveryReports: [{ id: 'r1' }, { id: 'r9', archivedAtV133: '1' }] },
      { id: 'tegnap', scheduleDate: isoDay(-1), deliveryReports: [{ id: 'r2' }] }]);
    const can = env.ctx.canDeleteGalleryFileV134;
    assert.equal(can({ id: 'f1', storage_path: 'ma/r1/a.jpg', order_id: 'ma', report_id: 'r1' }), true, 'a mai fuvar fájlja nem törölhető');
    assert.equal(can({ id: 'f2', storage_path: 'tegnap/r2/a.jpg', order_id: 'tegnap', report_id: 'r2' }), false, 'visszamenőleg is törölhetne');
    assert.equal(can({ id: 'f9', storage_path: 'ma/r9/a.jpg', order_id: 'ma', report_id: 'r9' }), false, 'archivált fájlt is törölhetne');
    // a régi napon a galéria nem módosítja a jelölést
    env.ctx.deliveryFileCountsV132 = new Map();
    env.ctx.healDeliveryMarksV134([env.local('tegnap')], []);
    assert.equal(env.local('tegnap').deliveryReports.length, 1, 'a sofőr a régi napot is módosította');
    env.t.setProfile({ role: 'admin' });
    assert.equal(can({ id: 'f2', storage_path: 'tegnap/r2/a.jpg', order_id: 'tegnap', report_id: 'r2' }), true, 'az admin nem törölhet');
    const auth = fs.readFileSync(__dirname + '/auth-v44-2.js', 'utf8');
    assert.ok(auth.includes('${canDeleteGalleryFileV134(file) ? `<button type="button" class="v119-del"'), 'a kuka csak adminnak jelenik meg');
  });

  await test('V134: feltöltés és törlés után azonnal változik a szám', () => {
    const auth = fs.readFileSync(__dirname + '/auth-v44-2.js', 'utf8');
    const camera = auth.slice(auth.indexOf("const cameraForm = byId('cameraForm')"));
    assert.ok(camera.indexOf('adjustDeliveryCountV134(order.id, +(result.report.fileCount || 0))') > 0, 'feltöltés után nem nő a szám');
    assert.ok(auth.includes('if (!file.is_source_mail) adjustDeliveryCountV134(file.order_id, -1);'), 'törlés után nem csökken a szám');
    const refresh = auth.slice(auth.indexOf('async function refreshDeliveryCountsV132'), auth.indexOf('function adjustDeliveryCountV134'));
    assert.ok(refresh.includes('fetchDeliveryFileCountsForOrdersV134'), 'a sofőri felület nem kéri le a fájlszámot');
    assert.ok(!refresh.includes('if (!isAdmin()'), 'a fájlszám továbbra is csak adminnak töltődik');
  });

  await test('V134: a sofőri fájlszám-lekérés kihagyja az Outlook-forrást', async () => {
    const { online } = onlineWith(url => {
      if (url.includes('/rest/v1/delivery_report_files?')) return [{ order_id: 'o1', report_id: 'a' }, { order_id: 'o1', report_id: 'a' }, { order_id: 'o1', report_id: 'src' }];
      if (url.includes('/rest/v1/delivery_reports?')) return [{ id: 'a', note: '' }, { id: 'src', note: 'Outlook forrás: x' }];
      return [];
    });
    await online.signInWithPassword('x@y', 'p');
    const counts = await online.fetchDeliveryFileCountsForOrdersV134(['o1', 'o2']);
    assert.equal(counts.get('o1'), 2);
    assert.equal(counts.get('o2'), 0);
  });

  await test('V134: a jogosultság miatt elmaradt törlés hibát ad, nem csendes', async () => {
    const { online } = onlineWith((url, options) => (options.method === 'DELETE' && url.includes('delivery_report_files')) ? [] : []);
    await online.signInWithPassword('x@y', 'p');
    await assert.rejects(online.deleteDeliveryFile({ id: 5, storage_path: 'o1/r/a.jpg' }), /nem engedte a törlést/);
  });

  await test('V134: a sofőri törlés szerveroldali szabálya a csomagban van', () => {
    const sql = fs.readFileSync(__dirname + '/SUPABASE_SOFOR_TORLES_V134.sql', 'utf8');
    for (const part of ['can_delete_order_file_v134', 'on public.delivery_report_files for delete', 'on storage.objects for delete', "bucket_id = 'delivery-docs'", "now() at time zone 'Europe/Budapest'"]) {
      assert.ok(sql.includes(part), 'hiányzik: ' + part);
    }
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
    console.log(`\nV134 funkcióteszt: ${passed}/${total} sikeres.`);
  })();
}
