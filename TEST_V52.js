const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

const read = name => fs.readFileSync(__dirname + '/' + name, 'utf8');
const index = read('index.html');
const app = read('app.js');
const auth = read('auth-v44-2.js');
const online = read('online-v44-2.js');
const config = read('online-config.js');
const sw = read('sw.js');
const planner = read('planner-v44.js');
const outlook = read('planner-v41.js');
const manifest = JSON.parse(read('manifest.webmanifest'));

function appDateApi() {
  const start = app.indexOf('const localISO=');
  const end = app.indexOf('function esc', start);
  assert.ok(start >= 0 && end > start, 'Az app dátumsegédei nem találhatók.');
  const ctx = { Date, String, Number, isNaN };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(app.slice(start, end) + ';globalThis.dateApi={shiftWorkday,normalizeWorkday};', ctx);
  return ctx.dateApi;
}

function outlookDateApi() {
  const start = outlook.indexOf('  const localISO =');
  const end = outlook.indexOf('  const cleanText', start);
  assert.ok(start >= 0 && end > start, 'Az Outlook dátumsegédei nem találhatók.');
  const ctx = { Date, String, Number };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(outlook.slice(start, end) + ';globalThis.dateApi={shiftWorkdayISO,normalizeWorkdayISO};', ctx);
  return ctx.dateApi;
}

function ok(name, fn) {
  try { fn(); console.log('OK', name); return 1; }
  catch (error) { console.error('HIBA', name, error.message); process.exitCode = 1; return 0; }
}

let passed = 0;

passed += ok('A szétosztómotor kiadási verziója V55', () => {
  assert.match(index, /Fuvarszervező V55/);
  assert.match(app, /APP_VERSION='V52'/);
  assert.match(planner, /const VERSION = '55'/);
  assert.equal(manifest.name, 'Fuvarszervező V55');
  assert.equal(manifest.short_name, 'Fuvar V55');
  assert.match(sw, /fuvarszervezo-v55-online-20260828-1/);
  assert.ok(!index.includes('?v=51.0'));
  assert.match(index, /\?v=55\.0/);
});

passed += ok('Minden belépési felületen e-mail- és jelszómező van', () => {
  assert.match(index, /id="authEmail"[^>]*type="email"/i);
  assert.match(index, /id="authPassword"[^>]*type="password"/i);
  assert.match(index, /autocomplete="current-password"/i);
  assert.match(index, /<button id="authSubmit" type="submit">Belépés<\/button>/);
  assert.equal((index.match(/type="password"/gi) || []).length, 1);
});

passed += ok('A felület Supabase-jelszavas belépést indít', () => {
  assert.match(auth, /V44Online\.signInWithPassword\(email, password\)/);
  assert.match(auth, /currentProfile = await global\.V44Online\.fetchProfile\(\)/);
  assert.doesNotMatch(auth, /requestLoginLink|acceptLoginLink|Belépési linket/);
});

passed += ok('A Supabase-kérés a password grant végpontot használja', () => {
  assert.match(online, /token\?grant_type=password/);
  assert.match(online, /body: \{ email: normalize\(email\), password: String\(password \|\| ''\) \}/);
  assert.match(online, /SESSION_KEY = 'fuvarszervezo_online_session_v52'/);
  assert.match(online, /LEGACY_SESSION_KEYS = \['fuvarszervezo_online_session_v44_2'\]/);
  assert.doesNotMatch(online, /otp\?redirect_to=|create_user|requestLoginLink|acceptLoginLink/);
});

passed += ok('Nincs nyilvános vagy beégetett felhasználói jelszó', () => {
  assert.doesNotMatch(auth, /fixedPassword|Fuvar-Admin|Fuvar-Test|66666666|12345678/);
  assert.doesNotMatch(config, /\b(?:serviceRole|service_role|secretKey|userPassword)\s*:/i);
  assert.doesNotMatch(online, /localStorage\.setItem\([^\n]*password/i);
});

passed += ok('Az öt engedélyezett fiók és a szerepkörök megmaradtak', () => {
  for (const email of [
    'schmidt.martin@stand98.hu',
    'polgar.patrik@stand98.hu',
    'berki.mario@stand98.hu',
    'szabo.sandor82@gmail.com',
    'szabo.sandor@stand98.hu'
  ]) assert.ok(auth.includes(email), `Hiányzó fiók: ${email}`);
  assert.match(auth, /role: 'admin'/);
  assert.match(auth, /role: 'driver'/);
  assert.match(auth, /role: 'test'/);
});

passed += ok('A sofőr jogosultsága továbbra is saját fuvarra és engedélyezett napra korlátozott', () => {
  assert.match(auth, /allowedDates\(\)\.includes\(order\.scheduleDate\)/);
  assert.match(auth, /order\.vehicleId === vehicle\.id/);
  assert.match(auth, /if \(currentProfile\.role === 'test'\) return true/);
});

passed += ok('A teljes V50 munkanap-logika megmaradt, a mobil napfüllel együtt', () => {
  const api = appDateApi();
  const outlookApi = outlookDateApi();
  assert.equal(api.shiftWorkday('2026-08-07', 1), '2026-08-10');
  assert.equal(api.shiftWorkday('2026-08-10', -1), '2026-08-07');
  for (const date of ['2026-08-08', '2026-08-09']) {
    assert.equal(api.normalizeWorkday(date), '2026-08-10');
    assert.equal(outlookApi.normalizeWorkdayISO(date), '2026-08-10');
  }
  assert.equal(outlookApi.shiftWorkdayISO('2026-08-07', 1), '2026-08-10');
  assert.match(app, /function syncScheduleDate\(\)[\s\S]*normalizeWorkday\(\$\('#scheduleDate'\)\.value\)/);
  assert.match(outlook, /scheduleDate: normalizeWorkdayISO\(entry\.scheduleDate/);
  assert.match(app, /#prevDay'[\s\S]*shiftWorkday\(selectedDate\(\),-1\)/);
  assert.match(app, /#nextDay'[\s\S]*shiftWorkday\(selectedDate\(\),1\)/);
  assert.match(auth, /shiftWorkday\(current, 1\)/);
});

if (!process.exitCode) console.log(`\nV52 kiadási teszt: ${passed}/8 sikeres.`);
