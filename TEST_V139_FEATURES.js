/* Fuvarszervező V139 – dátum nélküli hátralék, ottfelejtett tételek, és a
   sofőri hátralék-mentés védelme. A TEST_V139.js futtatja, külön is
   indítható: node TEST_V139_FEATURES.js */
const fs = require('fs');
const vm = require('vm');
const assert = require('assert');
const { createEnv } = require('./TEST_V132_SYNC.js');

/* Az app.js érintett részei önállóan, böngésző nélkül. */
function appCtx() {
  const src = fs.readFileSync(__dirname + '/app.js', 'utf8');
  const between = (from, to) => { const a = src.indexOf(from); const b = src.indexOf(to, a + from.length); if (a < 0 || b < 0) throw new Error('nincs meg: ' + from); return src.slice(a, b); };
  const line = start => { const a = src.indexOf(start); return src.slice(a, src.indexOf('\n', a)); };
  const parts = [
    'var COMPANIES_V126={stand98:{name:"Stand 98"},future:{name:"Future"}};',
    between('function orderCompanyV126(order, melyseg = 0){', 'function companyLabelV126'),
    line('const localISO=d=>'),
    between('function shiftWorkday(value,direction=1){', 'const today=()=>'),
    'var today=()=>localISO(new Date()),uid=()=>"id-"+(++globalThis.__n);',
    line('function esc(v='),
    between('function joinHouseNumber(value){', 'function last5'),
    between('function reconcileState(reason = \'\') {', '\nfunction ', ),
    line('function itemNoteValue(it={})'),
    line('function ensureItemId(it)'),
    line('function numericQty(v)'), line('function formatQty(v)'),
    between('function backlogRecordForItem(orderId, itemId) {', 'window.backlogRecordForItem'),
    between('function markMovedByDriverV121(order, mit, targetDate, fromDate){', 'window.markMovedByDriverV121'),
    between('function moveSingleItemToDate(o,it,target){', 'function applyMoveDateToAllItems'),
    between('/* ===== V139 – DÁTUM NÉLKÜLI HÁTRALÉK', 'function bindBacklogDateInputs')
  ];
  const ctx = {
    console, Date, Math, String, Number, Array, Object, JSON, Map, Set, isNaN, parseFloat, Promise,
    __n: 0, alerts: [], saves: 0,
    alert(m) { ctx.alerts.push(String(m)); }, confirm: () => true,
    CSS: { escape: s => s }, document: { querySelector: () => null },
    $: () => ({ close() {} })
  };
  ctx.globalThis = ctx; ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(parts.join('\n') + `
    var state={orders:[],backlog:[],vehicles:[{id:'v-patrik',driverName:'Polgár Patrik'}],resolvedBacklog:[],failedTrips:[],routePlans:{}};
    var currentItemsOrderId='';
    function save(){ globalThis.saves++; }
    function renderBacklog(){}
    globalThis.getState=()=>state; globalThis.setState=s=>{state=s};
    globalThis.reconcileState=reconcileState;`, ctx);
  return ctx;
}
const nap = d => { const x = new Date(); x.setHours(12, 0, 0, 0); x.setDate(x.getDate() + d); return x.toISOString().slice(0, 10); };
const order = (id, date, items, extra = {}) => ({ id, orderNo: '06935', vehicleId: 'v-patrik', projectName: 'Moxy', pickupName: 'Légtech', scheduleDate: date, items, completed: false, ...extra });

async function run(test) {
  await test('V139: „Hátralékba dátum nélkül” – a tétel egyik napra sem kerül, a Hátralékba igen', () => {
    const c = appCtx();
    const st = c.getState();
    st.orders.push(order('o1', nap(0), [{ _id: 'i1', name: 'Csőbilincs', code: 'CB1', qty: '10', unit: 'db', received: false, missingQty: '4' },
      { _id: 'i2', name: 'Szigetelés', qty: '2', unit: 'tek', received: false }, { _id: 'i3', name: 'Csavar', qty: '5', unit: 'db', received: true }], { companyV126: 'future' }));
    c.moveUncheckedToUndatedV139('o1');
    const o = st.orders.find(x => x.id === 'o1');
    assert.equal(st.orders.length, 1, 'új napi fuvar jött létre, pedig nincs dátum');
    assert.deepEqual(o.items.map(i => `${i.name}:${i.qty}:${i.received}`), ['Csőbilincs:6:true', 'Csavar:5:true'], 'az eredeti fuvar tételei hibásak');
    const undated = st.backlog.filter(b => b.undatedV139);
    assert.deepEqual(undated.map(b => `${b.name}:${b.quantity}`), ['Csőbilincs:4', 'Szigetelés:2']);
    assert.ok(undated.every(b => !b.targetOrderId && !b.movedToDate), 'dátumot vagy célfuvart kapott');
    // az állapot-rendező nem törli
    c.reconcileState('teszt');
    assert.equal(c.getState().backlog.filter(b => b.undatedV139).length, 2, 'a mentés kitörölte a dátum nélküli hátralékot');
  });

  await test('V139: ütemezés napra és „Mára” – a cég és a forrásnap öröklődik', () => {
    const c = appCtx();
    const st = c.getState();
    st.orders.push(order('o1', nap(-3), [{ _id: 'i1', name: 'Csőbilincs', qty: '4', unit: 'db', received: false }, { _id: 'i2', name: 'Szigetelés', qty: '2', unit: 'tek', received: false }], { companyV126: 'future' }));
    c.moveUncheckedToUndatedV139('o1');
    const [b1, b2] = st.backlog;
    c.scheduleUndatedV139(b1.id, true);
    const ma = c.currentWorkdayV139();
    const dest = st.orders.find(o => o.scheduleDate === ma);
    assert.ok(dest, 'a Mára gomb nem hozott létre mai fuvart');
    assert.equal(dest.items.length, 1);
    assert.equal(dest.items[0].name, 'Csőbilincs');
    assert.equal(dest.companyV126, 'future', 'a cég nem öröklődött');
    assert.equal(dest.movedFromOrderId, 'o1');
    assert.equal(b1.movedToDate, ma); assert.equal(b1.targetOrderId, dest.id); assert.ok(!b1.undatedV139);
    // a második ugyanabba a mai fuvarba kerül
    c.scheduleUndatedV139(b2.id, true);
    assert.equal(st.orders.filter(o => o.scheduleDate === ma).length, 1, 'ugyanarra a napra második fuvar jött létre');
    assert.equal(dest.items.length, 2);
    assert.equal(c.undatedEntriesV139().length, 0, 'ütemezés után is a dátum nélküliek között maradt');
  });

  await test('V139: elmúlt 30 nap ottfelejtett tételei – megjelennek, ütemezhetők, kipipálhatók', () => {
    const c = appCtx();
    const st = c.getState();
    st.orders.push(order('regi', nap(-40), [{ _id: 'r1', name: 'Túl régi', qty: '1', received: false }]));
    st.orders.push(order('tegnap', nap(-1), [{ _id: 't1', name: 'Ottfelejtett', qty: '3', unit: 'db', received: false, missingQty: '1' }, { _id: 't2', name: 'Megvan', qty: '1', received: true }]));
    st.orders.push(order('kesz', nap(-2), [{ _id: 'k1', name: 'Teljesített fuvar', qty: '1', received: false }], { completed: true }));
    st.orders.push(order('ma', nap(0), [{ _id: 'm1', name: 'Mai', qty: '1', received: false }]));
    let list = c.forgottenItemsV139();
    assert.deepEqual(list.map(x => x.name), ['Ottfelejtett'], 'nem csak az utolsó 30 nap nem teljesített fuvarjainak tételei látszanak');
    assert.equal(list[0].quantity, '1', 'nem a hiányzó mennyiséget mutatja');
    // ütemezés: a meglévő, dátumos áthelyezéssel megy
    c.scheduleUndatedV139(list[0].id, true);
    const ma = c.currentWorkdayV139();
    assert.ok(st.backlog.some(b => b.movedToDate === ma && b.name === 'Ottfelejtett'), 'nem került dátumos hátralékba');
    assert.equal(c.forgottenItemsV139().length, 0, 'ütemezés után is ottfelejtettnek látszik');
    // kipipálás
    st.orders.push(order('tegnap2', nap(-2), [{ _id: 'x1', name: 'Mégis megjött', qty: '1', received: false }]));
    c.markForgottenReceivedV139('tegnap2', 'x1');
    assert.equal(c.forgottenItemsV139().length, 0, 'a Megvan gomb után is a listán maradt');
    assert.equal(st.orders.find(o => o.id === 'tegnap2').completed, true);
  });

  await test('V139: „Vissza” és a csoportos „Mindet erre a napra”', () => {
    const c = appCtx();
    const st = c.getState();
    st.orders.push(order('o1', nap(-1), [{ _id: 'i1', name: 'A', code: 'A1', qty: '2', received: false }, { _id: 'i2', name: 'B', qty: '1', received: false }]));
    c.moveUncheckedToUndatedV139('o1');
    c.undoUndatedV139(st.backlog[0].id);
    assert.ok(st.orders[0].items.some(i => i.name === 'A' && !i.received), 'a Vissza nem tette vissza a tételt');
    assert.equal(st.backlog.length, 1);
    // csoport: a maradék + egy ottfelejtett ugyanabból a fuvarból
    c.scheduleUndatedGroupV139(`g:06935|o1`, true);
    assert.equal(c.undatedEntriesV139().length, 0, 'a csoportos ütemezés nem vitt át mindent');
    assert.ok(st.orders.some(o => o.scheduleDate === c.currentWorkdayV139() && o.items.length === 2), 'a két tétel nem egy mai fuvarba került');
  });

  await test('V139: a Hátralék menü szakasza, a gomb és a sofőri védelem be van kötve', () => {
    const c = appCtx();
    const st = c.getState();
    st.orders.push(order('o1', nap(-1), [{ _id: 'i1', name: 'Csőbilincs', qty: '2', received: false }]));
    const html = c.renderUndatedSectionV139('');
    assert.ok(html.includes('Dátum nélkül – infóra vár · 1 tétel') && html.includes('Mára') && html.includes('Elmúlt napon kipipálatlan'), 'a szakasz hiányos');
    assert.equal(c.renderUndatedSectionV139('nincs ilyen'), '', 'a keresés nem szűr');
    const app = fs.readFileSync(__dirname + '/app.js', 'utf8');
    assert.ok(app.includes(`onclick="moveUncheckedToUndatedV139('\${o.id}')"`), 'nincs „Hátralékba dátum nélkül” gomb a Tételek ablakban');
    assert.ok(app.includes('const undatedHtml = renderUndatedSectionV139(q);') && app.includes('host.innerHTML = undatedHtml + sections.join'), 'a szakasz nincs a Hátralék menü tetején');
    const auth = fs.readFileSync(__dirname + '/auth-v44-2.js', 'utf8');
    assert.ok(auth.includes("guardOrderFunction('moveUncheckedToUndatedV139', true, true);"), 'a sofőr a lezárt napon is áthelyezhetne');
  });

  await test('V139: a sofőri hátralék-mentés nem törli az admin közben létrehozott bejegyzését', async () => {
    const env = createEnv('driver');
    env.load([{ id: 'o1', scheduleDate: '2026-10-14', vehicleId: 'v-patrik', orderNo: '1', items: [] }]);
    env.ctx.state.backlog = [{ id: 'b-sajat', sourceOrderId: 'o1', movedToDate: '2026-10-15' }, { id: 'b-lezart', sourceOrderId: 'o1', movedToDate: '2026-10-16' }];
    env.t.resetSnapshot();
    // a szerveren: az admin létrehozott egy újat, és lezárta a b-lezart-at
    env.online.fetchBacklog = async () => [{ id: 'b-sajat', sourceOrderId: 'o1', movedToDate: '2026-10-15' }, { id: 'b-admin', sourceOrderId: 'o1', undatedV139: true, movedToDate: '' }];
    let elkuldott = null;
    env.online.syncChangedOrdersV132 = async changes => { if (changes.backlogAll) elkuldott = changes.backlogAll.map(b => b.id).sort(); return {}; };
    // a sofőr módosítja a sajátját
    env.ctx.state.backlog[0].itemNote = 'holnap jön';
    env.ctx.save();
    await env.runTimers(20);
    assert.ok(elkuldott, 'a hátralék nem ment fel');
    assert.ok(elkuldott.includes('b-admin'), 'a sofőr mentése törölte volna az admin friss bejegyzését');
    assert.ok(!elkuldott.includes('b-lezart'), 'a szerveren lezárt bejegyzést visszaküldte');
    assert.ok(elkuldott.includes('b-sajat'));
  });
}

module.exports = { run };

if (require.main === module) {
  (async () => {
    let passed = 0, total = 0;
    await run(async (name, fn) => {
      total++;
      try { await fn(); console.log('OK', name); passed++; }
      catch (e) { console.error('HIBA', name, e.stack || e.message); process.exitCode = 1; }
    });
    console.log(`\nV139 funkcióteszt: ${passed}/${total} sikeres.`);
  })();
}
