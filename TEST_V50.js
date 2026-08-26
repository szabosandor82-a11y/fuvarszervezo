const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

function loadAppDateApi() {
  const source = fs.readFileSync(__dirname + '/app.js', 'utf8');
  const start = source.indexOf('const localISO=');
  const end = source.indexOf('function esc', start);
  assert.ok(start >= 0 && end > start, 'Az app dátumsegédei nem találhatók.');
  const ctx = { Date, String, Number, isNaN };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(source.slice(start, end) + ';globalThis.dateApi={shiftWorkday,normalizeWorkday};', ctx);
  return { source, api: ctx.dateApi };
}

function loadOutlookDateApi() {
  const source = fs.readFileSync(__dirname + '/planner-v41.js', 'utf8');
  const start = source.indexOf('  const localISO =');
  const end = source.indexOf('  const cleanText', start);
  assert.ok(start >= 0 && end > start, 'Az Outlook dátumsegédei nem találhatók.');
  const ctx = { Date, String, Number };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(source.slice(start, end) + ';globalThis.dateApi={shiftWorkdayISO,normalizeWorkdayISO};', ctx);
  return { source, api: ctx.dateApi };
}

function ok(name, fn) {
  try { fn(); console.log('OK', name); return 1; }
  catch (error) { console.error('HIBA', name, error.message); process.exitCode = 1; return 0; }
}

let passed = 0;
const app = loadAppDateApi();
const outlook = loadOutlookDateApi();
const index = fs.readFileSync(__dirname + '/index.html', 'utf8');
const sw = fs.readFileSync(__dirname + '/sw.js', 'utf8');
const planner = fs.readFileSync(__dirname + '/planner-v44.js', 'utf8');

passed += ok('Péntek után hétfő a következő munkanap', () => {
  assert.equal(app.api.shiftWorkday('2026-08-07', 1), '2026-08-10');
  assert.equal(outlook.api.shiftWorkdayISO('2026-08-07', 1), '2026-08-10');
});

passed += ok('Hétfőről visszalapozva péntek jön', () => {
  assert.equal(app.api.shiftWorkday('2026-08-10', -1), '2026-08-07');
});

passed += ok('Szombat és vasárnap automatikusan hétfőre normalizálódik', () => {
  for (const date of ['2026-08-08', '2026-08-09']) {
    assert.equal(app.api.normalizeWorkday(date), '2026-08-10');
    assert.equal(outlook.api.normalizeWorkdayISO(date), '2026-08-10');
  }
});

passed += ok('A manuális fuvar mentése munkanapra normalizál', () => {
  assert.match(app.source, /function syncScheduleDate\(\)[\s\S]*normalizeWorkday\(\$\('#scheduleDate'\)\.value\)/);
});

passed += ok('Az Outlook előnézet és végleges import sem enged hétvégi dátumot', () => {
  assert.match(outlook.source, /scheduleDate: normalizeWorkdayISO\(entry\.scheduleDate/);
  assert.match(outlook.source, /entry\.scheduleDate = normalizeWorkdayISO\(entry\.scheduleDate/);
});

passed += ok('A főoldal és mobil/app navigáció ugyanazt a munkanap-logikát használja', () => {
  assert.match(app.source, /#prevDay'[\s\S]*shiftWorkday\(selectedDate\(\),-1\)/);
  assert.match(app.source, /#nextDay'[\s\S]*shiftWorkday\(selectedDate\(\),1\)/);
  assert.match(app.source, /#driverDate'\)\.value=tomorrow\(\)/);
});

passed += ok('A péntek 16:00 utáni áthelyezés is következő munkanapra megy', () => {
  assert.match(app.source, /function applyAfterFourRule\(\)[\s\S]*nd=shiftWorkday\(d,1\)/);
});

passed += ok('A V50 verzió és cache egyértelműen frissült', () => {
  assert.match(index, /Fuvarszervező V50/);
  assert.ok(!index.includes('?v=49.0'));
  assert.match(index, /\?v=50\.0/);
  assert.match(sw, /fuvarszervezo-v50-/);
  assert.match(planner, /const VERSION = '50'/);
});

if (!process.exitCode) console.log(`\nV50 munkanap teszt: ${passed}/8 sikeres.`);
