/* Fuvarszervező V135 – a levélmelléklet megbízhatóan a sofőrhöz jut.
   A TEST_V135.js futtatja, külön is indítható: node TEST_V135_FEATURES.js */
const fs = require('fs');
const vm = require('vm');
const assert = require('assert');
const { createEnv } = require('./TEST_V132_SYNC.js');

/* A V135-ös függvények várakoznak (újrapróbálás); a tesztben azonnal. */
function adminEnv() {
  const env = createEnv('admin');
  env.ctx.setTimeout = fn => { Promise.resolve().then(fn); return 0; };
  env.ctx.File = class { constructor(parts, name, opts) { this.parts = parts; this.name = name; this.type = opts?.type; } };
  env.online.fetchOrderPayloadsV132 = async ids => new Map(ids.filter(id => env.server.has(String(id))).map(id => [String(id), env.server.get(String(id))]));
  env.uploads = [];
  env.uploadFails = 0;
  env.online.createDeliveryReport = async (order, files, note) => {
    if (!env.server.has(String(order.id))) throw new Error('violates foreign key constraint');
    if (env.uploadFails > 0) { env.uploadFails--; throw new Error('hálózati hiba'); }
    const id = `rep-${env.uploads.length + 1}`;
    env.uploads.push({ orderId: String(order.id), files: files.length, note, id });
    return { report: { id, fileCount: files.length }, files: [] };
  };
  return env;
}

async function run(test) {
  await test('V135: a melléklet csak azután töltődik fel, hogy a fuvar a szerveren van', async () => {
    const env = adminEnv();
    env.load([{ id: 'o1', scheduleDate: '2026-10-14', orderNo: '1' }]);
    env.ctx.state.orders.push({ id: 'uj', scheduleDate: '2026-10-14', orderNo: '06935', sourceMail: { fileName: 'a.msg' } });
    const missing = await env.ctx.ensureOrdersOnServerV135(['uj']);
    assert.deepEqual(missing, [], 'a fuvar nem került fel a melléklet előtt');
    assert.ok(env.server.has('uj'));
    const order = env.local('uj');
    const result = await env.ctx.uploadOrderSourceFilesV135(order, [{ name: 'a.pdf' }], 'Outlook forrás · a.msg');
    assert.equal(result.ok, true);
    assert.deepEqual(order.sourceMailReportIdsV135, ['rep-1'], 'a fuvar nem jegyezte meg a melléklet azonosítóját');
    assert.ok(!order.sourceUploadFailedV135);
  });

  await test('V135: átmeneti hibánál újrapróbál, végleges hibánál maradandó jelzés', async () => {
    const env = adminEnv();
    env.load([{ id: 'o1', scheduleDate: '2026-10-14', orderNo: '1' }]);
    env.uploadFails = 2;
    const ok = await env.ctx.uploadOrderSourceFilesV135(env.local('o1'), [{ name: 'a.pdf' }], 'Outlook forrás');
    assert.equal(ok.ok, true, 'két hiba után nem próbálta újra');
    env.uploadFails = 5;
    const order = env.local('o1');
    const bad = await env.ctx.uploadOrderSourceFilesV135(order, [{ name: 'b.pdf' }], 'Outlook forrás');
    assert.equal(bad.ok, false);
    assert.equal(order.sourceUploadFailedV135.error, 'hálózati hiba', 'a végleges hiba nem jelölődött meg');
    assert.ok(env.t.collect().orders.some(item => item.id === 'o1'), 'a jelzés nem megy fel a szerverre');
  });

  await test('V135: a pótló gomb a gépen tárolt eredetiből tölt fel, és listázza a pótolhatatlanokat', async () => {
    const env = adminEnv();
    env.load([
      { id: 'fent', scheduleDate: '2026-10-09', orderNo: 'A', sourceMail: { attachmentNames: ['a.pdf'] } },
      { id: 'helyi', scheduleDate: '2026-10-14', orderNo: '06935', sourceMail: { fileName: 'x.msg', attachmentNames: ['x.pdf'] } },
      { id: 'nincs', scheduleDate: '2026-10-13', orderNo: '006957', sourceMail: { attachmentNames: ['y.pdf', 'logo.png'] } },
      { id: 'kep', scheduleDate: '2026-10-13', orderNo: 'K', sourceMail: { attachmentNames: ['logo.png'] } }]);
    env.online.fetchSourceMailCoverageV135 = async () => new Set(['fent']);
    env.ctx.mailAttachmentsV108 = async id => id === 'helyi' ? [{ name: 'x.pdf', type: 'application/pdf', bytes: new Uint8Array([1, 2]) }] : [];
    env.ctx.loadOrderAttachmentsV73 = () => [];
    const progress = { textContent: '', classList: { remove() {}, add() {} } };
    env.ctx.document.getElementById = id => id === 'v135BackfillProgress' ? progress : null;
    await env.ctx.backfillSourceMailV135();
    assert.deepEqual(env.uploads.map(u => u.orderId), ['helyi'], 'nem a hiányzó, helyben meglévő mellékletet töltötte fel');
    assert.match(env.uploads[0].note, /^Outlook forrás/);
    assert.ok(progress.textContent.includes('Kész: 1 fuvar'), progress.textContent);
    assert.ok(progress.textContent.includes('006957'), 'nem jelzi, melyiket kell újraimportálni');
    assert.ok(!progress.textContent.includes('K ('), 'a képmelléklet nélküli levelet is pótolandónak jelzi');
  });

  await test('V135: a sofőr a jogosultság miatt rejtett bejegyzést sem zárja ki', async () => {
    const requests = [];
    const ctx = {
      console: { log() {}, warn() {}, info() {}, error() {} }, Date, Map, Set, Number, String, Object, Array, JSON, Math, Promise, Error,
      URLSearchParams, URL, Blob, ArrayBuffer, FormData,
      FUVARSZERVEZO_ONLINE_CONFIG: { supabaseUrl: 'https://example.supabase.co', anonKey: 'k' },
      localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
      fetch: async (url, options = {}) => {
        url = String(url); requests.push(url);
        let payload = [];
        if (url.includes('/auth/v1/token')) payload = { access_token: 'a', refresh_token: 'r', expires_in: 3600, user: { email: 'p@x' } };
        else if (url.includes('delivery_report_files?')) payload = [{ id: 1, report_id: 'rep', order_id: 'o1', storage_path: 'o1/rep/01-a.pdf', file_name: 'a.pdf' }];
        else if (url.includes('/object/sign/')) payload = { signedURL: '/object/sign/delivery-docs/o1/rep/01-a.pdf?token=t' };
        else if (url.includes('delivery_reports?')) payload = [];   // a szabály elrejti
        return { ok: true, status: 200, statusText: 'OK', text: async () => JSON.stringify(payload) };
      }
    };
    ctx.window = ctx; ctx.globalThis = ctx; vm.createContext(ctx);
    vm.runInContext(fs.readFileSync(__dirname + '/online-v44-2.js', 'utf8'), ctx);
    await ctx.V44Online.signInWithPassword('p@x', 'j');
    const list = await ctx.V44Online.listDeliveryFiles('o1');
    assert.strictEqual(list[0].is_source_mail, null, 'a rejtett bejegyzést „nem forrásnak” vette');
    const auth = fs.readFileSync(__dirname + '/auth-v44-2.js', 'utf8');
    assert.ok(auth.includes("if (ismertForras.has(String(file.report_id || ''))) return true;"), 'a fuvar saját melléklet-azonosítója nem számít');
  });

  await test('V135: az import előbb a fuvart menti, utána a mellékletet', () => {
    const v41 = fs.readFileSync(__dirname + '/planner-v41.js', 'utf8');
    const fn = v41.slice(v41.indexOf('async function uploadSourceMailFiles'), v41.indexOf('function statusText'));
    const ensureAt = fn.indexOf('await global.ensureOrdersOnServerV135(');
    const uploadAt = fn.indexOf('await global.uploadOrderSourceFilesV135(');
    assert.ok(ensureAt > 0 && uploadAt > ensureAt, 'a melléklet a fuvar előtt indulhat');
    assert.ok(fn.includes('Hiányzó mellékletek feltöltése a sofőröknek'), 'a figyelmeztetés nem mondja meg a pótlás módját');
  });

  await test('V135: az admin látja, hogy a melléklet elérhető-e a sofőrnek', () => {
    const auth = fs.readFileSync(__dirname + '/auth-v44-2.js', 'utf8');
    assert.ok(auth.includes('A sofőr NEM látja ezt a mellékletet'), 'nincs figyelmeztetés a hiányzó szerveri példányra');
    assert.ok(auth.includes("onclick=\"uploadLocalSourceForOrderV135('"), 'nincs egyenkénti pótlás');
    assert.ok(auth.includes("id=\"v135Backfill\""), 'nincs pótló gomb a Beállításokban');
    const v37 = fs.readFileSync(__dirname + '/planner-v37.js', 'utf8');
    assert.ok(v37.includes('${sourceMissingChipV135(group.orders)}'), 'a buborék nem jelzi a fel nem jutott mellékletet');
    const css = fs.readFileSync(__dirname + '/styles.css', 'utf8');
    assert.ok(css.includes('.v135-source-status.missing') && css.includes('.tag.v135-source-missing'));
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
    console.log(`\nV135 funkcióteszt: ${passed}/${total} sikeres.`);
  })();
}
