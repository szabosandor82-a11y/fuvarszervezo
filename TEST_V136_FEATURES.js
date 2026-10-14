/* Fuvarszervező V136 – egy elutasított melléklet nem viszi el a többit.
   A TEST_V136.js futtatja, külön is indítható: node TEST_V136_FEATURES.js */
const fs = require('fs');
const vm = require('vm');
const assert = require('assert');
const { createEnv } = require('./TEST_V132_SYNC.js');

function onlineWith(handler) {
  const requests = [];
  const ctx = {
    console: { log() {}, warn() {}, info() {}, error() {} }, Date, Map, Set, Number, String, Object, Array, JSON, Math, Promise, Error,
    URLSearchParams, URL, Blob, ArrayBuffer, FormData, File,
    FUVARSZERVEZO_ONLINE_CONFIG: { supabaseUrl: 'https://example.supabase.co', anonKey: 'k' },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    fetch: async (url, options = {}) => {
      url = String(url); const req = { url, method: options.method || 'GET', headers: options.headers || {}, body: options.body };
      requests.push(req);
      if (url.includes('/auth/v1/token')) return { ok: true, status: 200, statusText: 'OK', text: async () => JSON.stringify({ access_token: 'a', refresh_token: 'r', expires_in: 3600, user: { email: 'x@y' } }) };
      const out = handler(req) || { status: 200, body: [] };
      return { ok: out.status < 400, status: out.status, statusText: 'X', text: async () => JSON.stringify(out.body ?? []) };
    }
  };
  ctx.window = ctx; ctx.globalThis = ctx; vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(__dirname + '/online-v44-2.js', 'utf8'), ctx);
  return { online: ctx.V44Online, requests };
}

const files = () => [new File([new Uint8Array(10)], 'Megrendelés.pdf', { type: 'application/pdf' }),
  new File([new Uint8Array(20)], 'Stand 10727.pdf', { type: 'application/pdf' }),
  new File([new Uint8Array(30)], 'Stand MVd2610727 _WFC_V_ütem_betonkocka.msg', { type: 'application/octet-stream' })];

async function run(test) {
  await test('V136: az elutasított .msg mellett a PDF-ek nyilvántartásba kerülnek', async () => {
    const { online, requests } = onlineWith(req => {
      if (req.method === 'POST' && req.url.includes('/rest/v1/delivery_reports')) return { status: 201, body: [{ id: 'rep1', created_at: 'x' }] };
      if (req.method === 'POST' && req.url.includes('/storage/v1/object/delivery-docs/') && /\.msg$/.test(decodeURIComponent(req.url))) return { status: 400, body: { message: 'mime type application/vnd.ms-outlook is not supported' } };
      return { status: 200, body: [] };
    });
    await online.signInWithPassword('x@y', 'p');
    const result = await online.createDeliveryReport({ id: 'o1', orderNo: '06935' }, files(), 'Outlook forrás · x.msg');
    const insert = requests.find(r => r.method === 'POST' && r.url.endsWith('/rest/v1/delivery_report_files'));
    assert.ok(insert, 'a nyilvántartó sorok nem íródtak be');
    assert.deepEqual(JSON.parse(insert.body).map(row => row.file_name), ['Megrendelés.pdf', 'Stand 10727.pdf']);
    assert.deepEqual(result.skipped.map(item => item.name), ['Stand MVd2610727 _WFC_V_ütem_betonkocka.msg']);
    const msgUpload = requests.find(r => r.method === 'POST' && /\.msg$/.test(decodeURIComponent(r.url)));
    assert.equal(msgUpload.headers['Content-Type'], 'application/vnd.ms-outlook', 'a .msg nem a pontos típussal ment');
  });

  await test('V136: ha egy fájl sem megy fel, nem marad üres bejegyzés', async () => {
    const { online, requests } = onlineWith(req => {
      if (req.method === 'POST' && req.url.includes('/rest/v1/delivery_reports')) return { status: 201, body: [{ id: 'rep2' }] };
      if (req.method === 'POST' && req.url.includes('/storage/v1/object/delivery-docs/')) return { status: 400, body: { message: 'mime type not supported' } };
      return { status: 200, body: [] };
    });
    await online.signInWithPassword('x@y', 'p');
    await assert.rejects(online.createDeliveryReport({ id: 'o1' }, files(), 'Outlook forrás'), /Egyik fájlt sem fogadta el/);
    assert.ok(requests.some(r => r.method === 'DELETE' && r.url.includes('delivery_reports?id=eq.rep2')), 'az üres bejegyzés megmaradt');
  });

  await test('V136: ha a nyilvántartás beírása bukik, a feltöltött fájlok sem maradnak a tárhelyen', async () => {
    const { online, requests } = onlineWith(req => {
      if (req.method === 'POST' && req.url.includes('/rest/v1/delivery_reports')) return { status: 201, body: [{ id: 'rep3' }] };
      if (req.method === 'POST' && req.url.endsWith('/rest/v1/delivery_report_files')) return { status: 403, body: { message: 'row-level security' } };
      return { status: 200, body: [] };
    });
    await online.signInWithPassword('x@y', 'p');
    await assert.rejects(online.createDeliveryReport({ id: 'o1' }, files().slice(0, 2), 'Outlook forrás'), /row-level security/);
    const del = requests.find(r => r.method === 'DELETE' && r.url.endsWith('/storage/v1/object/delivery-docs'));
    assert.ok(del, 'a fájlok a tárhelyen maradtak');
    assert.equal(JSON.parse(del.body).prefixes.length, 2);
  });

  await test('V136: a takarítás a régi, üres bejegyzéseket és fájljaikat törli', async () => {
    const regi = new Date(Date.now() - 3600e3).toISOString(), friss = new Date().toISOString();
    const { online, requests } = onlineWith(req => {
      if (req.method === 'GET' && req.url.includes('delivery_reports?')) return { status: 200, body: [
        { id: 'ures', order_id: 'o1', created_at: regi }, { id: 'friss', order_id: 'o1', created_at: friss }, { id: 'jo', order_id: 'o1', created_at: regi }] };
      if (req.method === 'GET' && req.url.includes('delivery_report_files?')) return { status: 200, body: [{ report_id: 'jo' }] };
      if (req.url.includes('/storage/v1/object/list/delivery-docs')) return { status: 200, body: [{ name: '01-a.pdf', id: 'x' }, { name: '02-b.pdf', id: 'y' }] };
      return { status: 200, body: [] };
    });
    await online.signInWithPassword('x@y', 'p');
    const result = await online.cleanupEmptySourceReportsV136();
    assert.equal(result.reportsRemoved, 1, 'nem csak a régi üres bejegyzést törölte');
    assert.equal(result.filesRemoved, 2);
    const list = requests.find(r => r.url.includes('/object/list/'));
    assert.equal(JSON.parse(list.body).prefix, 'o1/ures');
    const del = requests.find(r => r.method === 'DELETE' && r.url.endsWith('/storage/v1/object/delivery-docs'));
    assert.deepEqual(JSON.parse(del.body).prefixes, ['o1/ures/01-a.pdf', 'o1/ures/02-b.pdf']);
    assert.ok(requests.some(r => r.method === 'DELETE' && r.url.includes('delivery_reports?id=eq.ures')));
    assert.ok(!requests.some(r => r.method === 'DELETE' && /delivery_reports\?id=eq\.(friss|jo)/.test(r.url)), 'futó vagy rendben lévő bejegyzést is törölt');
  });

  await test('V136: részleges feltöltés után csak a kimaradt fájl megy fel újra', async () => {
    const env = createEnv('admin');
    env.ctx.setTimeout = fn => { Promise.resolve().then(fn); return 0; };
    env.ctx.File = class { constructor(parts, name, opts) { this.name = name; this.type = opts?.type; } };
    env.load([{ id: 'o1', scheduleDate: '2026-10-14', orderNo: '06935', sourceMail: { fileName: 'x.msg', attachmentNames: ['a.pdf', 'b.msg'] } }]);
    env.online.fetchOrderPayloadsV132 = async ids => new Map(ids.map(id => [String(id), {}]));
    const feltoltve = [];
    let elutasit = true;
    env.online.createDeliveryReport = async (order, list) => {
      feltoltve.push(list.map(f => f.name));
      const skipped = elutasit ? list.filter(f => /\.msg$/.test(f.name)).map(f => ({ name: f.name, error: 'mime' })) : [];
      return { report: { id: `rep${feltoltve.length}`, fileCount: list.length - skipped.length }, files: [], skipped };
    };
    env.ctx.mailAttachmentsV108 = async () => [{ name: 'a.pdf', type: 'application/pdf', bytes: new Uint8Array([1]) }, { name: 'b.msg', type: 'application/octet-stream', bytes: new Uint8Array([2]) }];
    const order = env.local('o1');
    const r1 = await env.ctx.uploadOrderSourceFilesV135(order, [{ name: 'a.pdf' }, { name: 'b.msg' }], 'Outlook forrás');
    assert.equal(r1.ok, true);
    assert.deepEqual(order.sourceUploadPartialV136.skipped, ['b.msg'], 'a kimaradt fájl nem jegyződött meg');
    // a tároló beállítása után: újrapróbálás csak a kimaradttal
    elutasit = false;
    env.ctx.alert = () => {};
    env.ctx.openSourceMail = async () => {};
    await env.ctx.uploadLocalSourceForOrderV135('o1');
    assert.deepEqual(feltoltve[1], ['b.msg'], 'a már fent lévő PDF-et is újra feltöltötte');
    assert.ok(!order.sourceUploadPartialV136, 'a részleges jelzés megmaradt');
    assert.deepEqual(order.sourceMailReportIdsV135, ['rep1', 'rep2']);
  });

  await test('V136: a sofőr a csatolt levelet (.msg) is látja; a buborék jelzi a részleges feltöltést', () => {
    const auth = fs.readFileSync(__dirname + '/auth-v44-2.js', 'utf8');
    assert.ok(auth.includes("const all = (list || []).filter(file => /\\.(pdf|docx?|xlsx?|xlsm|csv|msg|eml|txt)$/i"), 'a .msg melléklet kiszűrődik');
    assert.ok(auth.includes('cleanupEmptySourceReportsV136'), 'a pótló gomb nem takarít');
    const v37 = fs.readFileSync(__dirname + '/planner-v37.js', 'utf8');
    assert.ok(v37.includes('Melléklet részben jutott fel'), 'a buborék nem jelzi a részleges feltöltést');
    const sql = fs.readFileSync(__dirname + '/SUPABASE_TAROLO_V136.sql', 'utf8');
    for (const part of ["'application/vnd.ms-outlook'", "'application/octet-stream'", 'when allowed_mime_types is null then null', 'greatest(coalesce(file_size_limit, 0), 52428800)']) {
      assert.ok(sql.includes(part), 'hiányzik az SQL-ből: ' + part);
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
    console.log(`\nV136 funkcióteszt: ${passed}/${total} sikeres.`);
  })();
}
