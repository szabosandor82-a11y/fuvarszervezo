/* Fuvarszervező V133 – új funkciók tesztjei. A TEST_V133.js futtatja,
   külön is indítható: node TEST_V133_FEATURES.js */
const fs = require('fs');
const vm = require('vm');
const assert = require('assert');
const { createEnv } = require('./TEST_V132_SYNC.js');

async function run(test) {
  await test('V133: a napi fuvarlista követi a „Fuvar napja és műveletek” dátumváltását', () => {
    const v37 = fs.readFileSync(__dirname + '/planner-v37.js', 'utf8');
    const start = v37.indexOf('function v37RenderRoutes()');
    const body = v37.slice(start, v37.indexOf('function v37SetPickupGrouping', start));
    assert.ok(body.includes('renderDailyListV93'), 'a ténylegesen futó útvonal-rajzoló nem frissíti a napi listát');
    assert.ok(body.includes("getElementById('dailylist')?.classList.contains('active')"), 'zárt napi listát is újrarajzolna');

    /* A napi lista fejléce a kiválasztott napot mutatja. */
    const src = fs.readFileSync(__dirname + '/daily-list-v93.js', 'utf8');
    const elements = {
      '#v93Board': { innerHTML: '', style: {} }, '#v94Date': { textContent: '' }, '#v94Picker': { value: '2026-10-01' }
    };
    const c = {
      window: null, setTimeout: () => 0, String, Number, Math, Map, Array, Object,
      document: { querySelector: sel => elements[sel] || null, querySelectorAll: () => [], getElementById: () => null, activeElement: null },
      selectedDate: () => '2026-10-15', activeVehicles: () => [{ id: 'v1', driverName: 'Márió', name: 'Kisteher' }], dayOrders: () => [],
      state: { orders: [] }
    };
    c.window = c; vm.createContext(c);
    vm.runInContext(src, c);
    c.renderDailyListV93();
    assert.equal(elements['#v94Picker'].value, '2026-10-15', 'a fejléc dátummezője a régi napon maradt');
    assert.equal(elements['#v94Date'].textContent, '2026-10-15');
  });

  await test('V133: törlésnél a jelölés nem jön vissza, archiválásnál megmarad', () => {
    const env = createEnv('admin');
    const m = env.online.mergeReportsV133;
    const old = { deliveryReports: [{ id: 'r1', at: '1' }, { id: 'r2', at: '2' }] };
    const local = { deliveryReports: [{ id: 'r2', at: '2' }], deliveryReportsDeletedV133: ['r1'] };
    assert.deepEqual(m(old, local).reports.map(r => r.id), ['r2'], 'a törölt bejegyzés visszajött');
    assert.deepEqual(m(local, old).reports.map(r => r.id), ['r2'], 'fordított irányban visszajött');
    const archived = m({ deliveryReports: [{ id: 'r2', at: '2', archivedAtV133: '2026-10-14' }] }, { deliveryReports: [{ id: 'r2', at: '2', photoCount: 3 }] });
    assert.equal(archived.reports[0].archivedAtV133, '2026-10-14', 'egy régi példány levette az archivált jelölést');
    assert.equal(archived.reports[0].photoCount, 3);
    const merged = env.online.mergeAdminDriverFieldsV131({ id: 'o1', deliveryReports: [], deliveryReportsDeletedV133: ['r1'] }, { deliveryReports: [{ id: 'r1', at: '1' }] });
    assert.equal(merged.deliveryReports.length, 0, 'az admin mentése visszahozta a törölt szállítólevelet');
  });

  await test('V133: galériából törölt utolsó fájl leveszi a jelölést', () => {
    const env = createEnv('admin');
    env.load([{ id: 'o1', scheduleDate: '2026-10-14', deliveryReports: [{ id: 'r1', at: '1', photoCount: 2, fileCount: 2 }, { id: 'r2', at: '2', photoCount: 1, fileCount: 1 }] }]);
    env.ctx.archivedMapV119 = () => ({});
    const files = [{ id: 'f1', report_id: 'r1', order_id: 'o1' }, { id: 'f2', report_id: 'r1', order_id: 'o1' }, { id: 'f3', report_id: 'r2', order_id: 'o1' }];
    // r1 egyik fájlja: a bejegyzés marad, a szám csökken
    env.ctx.updateReportAfterDeleteV133(files[0], files.slice(1));
    let o = env.local('o1');
    assert.equal(o.deliveryReports.find(r => r.id === 'r1').fileCount, 1);
    // r2 utolsó fájlja: a bejegyzés eltűnik
    env.ctx.updateReportAfterDeleteV133(files[2], files.slice(1, 2));
    o = env.local('o1');
    assert.deepEqual(o.deliveryReports.map(r => r.id), ['r1']);
    assert.deepEqual(o.deliveryReportsDeletedV133, ['r2']);
    // r1 utolsó fájlja is: nincs több jelölés → a gomb visszaszürkül
    env.ctx.updateReportAfterDeleteV133(files[1], []);
    o = env.local('o1');
    assert.equal(o.deliveryReports.length, 0);
    assert.ok(env.t.collect().orders.some(order => order.id === 'o1'), 'a változás nem megy fel a szerverre');
  });

  await test('V133: archivált fájl törlésekor a jelölés „archiválva” felirattal marad', async () => {
    const env = createEnv('admin');
    env.load([{ id: 'o1', scheduleDate: '2026-10-14', deliveryReports: [{ id: 'r1', at: '1', photoCount: 1, fileCount: 1 }] },
      { id: 'o2', scheduleDate: '2026-10-14' }, { id: 'o3', scheduleDate: '2026-10-14' }]);
    env.ctx.archivedMapV119 = () => ({ f1: 1 });
    env.ctx.updateReportAfterDeleteV133({ id: 'f1', report_id: 'r1', order_id: 'o1' }, []);
    assert.ok(env.local('o1').deliveryReports[0].archivedAtV133, 'egyenkénti törlésnél elveszett az archivált jelölés');

    // tömeges törlés: a hiányzó jelölés pótlódik, az Outlook-forrás nem
    env.online.fetchReportNotesV133 = async () => new Map([
      ['r5', { id: 'r5', note: '', created_at: '2026-10-10T08:00:00Z' }],
      ['r6', { id: 'r6', note: 'Outlook forrás: levél', created_at: '2026-10-10T08:00:00Z' }]]);
    const changed = await env.ctx.markArchivedReportsV133([
      { id: 'f5', report_id: 'r5', order_id: 'o2', mime_type: 'image/jpeg' },
      { id: 'f6', report_id: 'r6', order_id: 'o3', mime_type: 'application/pdf' }]);
    assert.equal(changed, 1);
    assert.equal(env.local('o2').deliveryReports[0].archivedAtV133 > '', true, 'a lemaradt jelölés nem pótlódott');
    assert.ok(!(env.local('o3').deliveryReports || []).length, 'az Outlook-forrásmelléklet szállítólevélnek látszik');

    const src = fs.readFileSync(__dirname + '/app.js', 'utf8');
    const c = { Map, Set, Math, String, Array, window: null };
    c.window = c; vm.createContext(c);
    vm.runInContext(src.slice(src.indexOf('function liveDeliveryReportsV133'), src.indexOf('window.deliveryArchiveSuffixV133')), c);
    assert.equal(c.deliveryArchiveSuffixV133([env.local('o1')]), ' · archiválva');
    assert.equal(c.deliveryArchiveSuffixV133([{ id: 'x', deliveryReports: [{ id: 'a', photoCount: 2, archivedAtV133: '1' }, { id: 'b', photoCount: 1 }] }]), ' · 2 archiválva');
    assert.equal(c.deliveryArchiveSuffixV133([{ id: 'y', deliveryReports: [{ id: 'a', photoCount: 2 }] }]), '');
    assert.ok(src.includes('await window.markArchivedReportsV133?.(toroltek)'), 'a tömeges törlés nem jelöli archiváltnak a fuvarokat');
  });

  await test('V133: a galéria és a gombok jelzik az archiválást', () => {
    const auth = fs.readFileSync(__dirname + '/auth-v44-2.js', 'utf8');
    assert.ok(auth.includes('archivedReportsNoteV133(orders)'), 'a galéria nem jelzi az archivált fájlokat');
    assert.ok(auth.includes("(archivedNoteV133 ? '' : '<div class=\"mobile-empty\">Ehhez a fuvarhoz még nincs elmentett fotó.</div>')"), 'archivált fuvarnál is „nincs fotó” jelenne meg');
    const v37 = fs.readFileSync(__dirname + '/planner-v37.js', 'utf8');
    assert.ok(v37.includes('archiveSuffixV133(group.orders)'), 'az admin gombján nincs archiválva felirat');
    assert.ok(auth.includes('safe(archiveSuffix)'), 'a sofőri gombon nincs archiválva felirat');
    const css = fs.readFileSync(__dirname + '/styles.css', 'utf8');
    assert.ok(css.includes('.v57-row-actions button.has-photos'), 'a sofőri zöld gomb stílusa hiányzik');
    assert.ok(css.includes('.v133-archived-note'), 'az archivált felirat stílusa hiányzik');
  });

  await test('V133: a naptár élénkebb, kontrasztosabb színeket kap', () => {
    const css = fs.readFileSync(__dirname + '/styles.css', 'utf8');
    const v133 = css.slice(css.indexOf('V133 – ÉLÉNKEBB, ÉLESEBB NAPTÁR'));
    for (const rule of ['.v122-cal-cell{', '.v122-cal-today{', '.v122-cal-weekend{', '.v122-cal-trip{', '[data-driver="mario"]', '[data-driver="patrik"]', '[data-driver="martin"]']) {
      assert.ok(v133.includes(rule), 'hiányzó naptárszabály: ' + rule);
    }
    assert.ok(!/#e1e7e9/.test(v133), 'maradt a halvány cellaszegély');
  });

  await test('V133: a szerveroldali védelem kezeli a törlést és az archiválást', () => {
    const sql = fs.readFileSync(__dirname + '/SUPABASE_SOFOR_MEZOK_V133.sql', 'utf8');
    for (const part of ['union_reports_v133', 'deliveryReportsDeletedV133', 'archivedAtV133', 'union_text_v133', 'orders_keep_driver_fields_v132']) {
      assert.ok(sql.includes(part), 'hiányzik: ' + part);
    }
    assert.ok(!fs.existsSync(__dirname + '/SUPABASE_SOFOR_MEZOK_V132.sql'), 'a régi SQL-fájl összezavarná a telepítést');
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
    console.log(`\nV133 funkcióteszt: ${passed}/${total} sikeres.`);
  })();
}
