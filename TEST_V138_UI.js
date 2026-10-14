/* Fuvarszervező V138 – a csevegő felületének végigpróbálása böngésző-
   környezetben (jsdom). Futtatás: npm i jsdom && node TEST_V138_UI.js
   Ha a jsdom nincs telepítve, a teszt kihagyja magát. */
const fs = require('fs');
const assert = require('assert');
let JSDOM;
try { ({ JSDOM } = require('jsdom')); } catch (_) { try { ({ JSDOM } = require(process.env.JSDOM_PATH || 'jsdom')); } catch (__) {} }

const P = 'polgar.patrik@stand98.hu', M = 'berki.mario@stand98.hu', A = 'szabo.sandor82@gmail.com';
const wait = ms => new Promise(r => setTimeout(r, ms));

function makeWorld(role) {
  const dom = new JSDOM('<!doctype html><body class="mode-' + (role === 'admin' ? 'admin' : 'driver') + '"></body>', { pretendToBeVisual: true, runScripts: 'outside-only', url: 'https://x.test/' });
  const w = dom.window;
  const server = { messages: [], reads: [] };
  let seq = 0;
  const me = role === 'admin' ? A : P;
  const now = () => new Date(Date.now() + seq).toISOString();
  w.alert = () => {}; w.confirm = () => true;
  w.CSS = w.CSS || { escape: s => String(s).replace(/"/g, '\\"') };
  w.V44Online = {
    getProfile: () => ({ email: me, role, display_name: role === 'admin' ? 'Iroda' : 'Polgár Patrik' }),
    chatMyEmailV138: () => me,
    listUsers: async () => [{ email: P, role: 'driver', driver_key: 'patrik', display_name: 'Polgár Patrik' }, { email: M, role: 'driver', driver_key: 'mario', display_name: 'Berki Márió' }, { email: A, role: 'admin', display_name: 'Iroda' }],
    chatFetchV138: async ({ since }) => server.messages.filter(m => (role === 'admin' || m.conversation === me || m.conversation === '__all__') && (!since || m.updated_at > since)).map(m => ({ ...m })),
    chatReadsV138: async () => server.reads.map(r => ({ ...r })),
    chatMarkReadV138: async conversation => { const row = { conversation, reader_email: me, last_read_at: now() }; server.reads = server.reads.filter(r => !(r.conversation === conversation && r.reader_email === me)); server.reads.push(row); return row; },
    chatSendV138: async ({ conversation, body, attachments, senderName }) => { seq++; const t = now(); const row = { id: 'm' + seq, conversation, sender_email: me, sender_name: senderName, body, attachments, created_at: t, updated_at: t, deleted: false }; server.messages.push(row); return { ...row }; },
    chatUpdateV138: async (id, patch) => { seq++; const m = server.messages.find(x => x.id === id); Object.assign(m, patch, { updated_at: now(), edited_at: now() }); if (patch.deleted) { m.body = ''; m.attachments = []; } return { ...m }; },
    chatUploadV138: async (conversation, file) => ({ path: `${conversation}/u/${file.name}`, name: file.name, type: file.type, size: file.size }),
    chatSignV138: async path => 'https://signed/' + path
  };
  const src = fs.readFileSync(__dirname + '/chat-v138.js', 'utf8');
  w.eval(src);
  const incoming = (conversation, sender, body) => { seq++; const t = now(); server.messages.push({ id: 'i' + seq, conversation, sender_email: sender, sender_name: sender === A ? 'Iroda' : 'Polgár Patrik', body, attachments: [], created_at: t, updated_at: t, deleted: false }); };
  return { w, server, incoming, $: s => w.document.querySelector(s), $$: s => [...w.document.querySelectorAll(s)] };
}

async function run(test) {
  if (!JSDOM) { await test('V138 UI: kihagyva (a jsdom nincs telepítve)', () => {}); return; }

  await test('V138 UI: sofőr – gomb, olvasatlan szám, üzenetküldés, szerkesztés, törlés', async () => {
    const { w, server, incoming, $, $$ } = makeWorld('driver');
    incoming(P, A, 'Hol tartasz?');
    incoming('__all__', A, 'Holnap 7-kor kezdünk');
    incoming(M, A, 'Ez Márióé – Patrik nem láthatja');
    await w.ChatV138.start(w.V44Online.getProfile(), P);
    await wait(30);
    assert.ok($('.cv-fab'), 'nincs üzenet-gomb');
    assert.equal($('.cv-fab .cv-badge').textContent, '2', 'az olvasatlan szám hibás');
    $('.cv-fab').click(); await wait(30);
    assert.ok(!$('.cv-panel').classList.contains('hidden'), 'a beszélgetés nem nyílt meg');
    const texts = $$('.cv-msg .cv-text').map(e => e.textContent);
    assert.deepEqual(texts, ['Hol tartasz?', 'Holnap 7-kor kezdünk'], 'nem a saját és a csoportos üzenetek látszanak: ' + texts.join(' | '));
    assert.ok($('.cv-group-tag'), 'a csoportos üzenet nincs megjelölve');
    assert.ok(server.reads.some(r => r.conversation === P && r.reader_email === P), 'a megnyitás nem jelölte olvasottnak');
    await w.ChatV138.tick(); await wait(10);
    assert.ok($('.cv-fab .cv-badge').classList.contains('hidden'), 'olvasás után is van olvasatlan-szám');
    // küldés
    const ta = $('.cv-panel textarea');
    ta.value = 'Úton vagyok, 10 perc';
    $('.cv-panel .cv-compose').dispatchEvent(new w.Event('submit', { cancelable: true })); await wait(30);
    const sent = server.messages.find(m => m.body === 'Úton vagyok, 10 perc');
    assert.ok(sent && sent.conversation === P, 'az üzenet nem a saját beszélgetésbe ment');
    assert.ok($$('.cv-msg.mine').length === 1 && $('.cv-msg.mine .cv-foot').textContent === 'Elküldve');
    // admin olvasta → Látta
    server.reads.push({ conversation: P, reader_email: A, last_read_at: new Date(Date.now() + 10000).toISOString() });
    await w.ChatV138.tick(); await wait(10);
    assert.equal($('.cv-msg.mine .cv-foot').textContent, 'Látta', 'nem jelenik meg, hogy az admin látta');
    // fájlküldés
    const file = new w.File([new Uint8Array(4)], 'szallito.jpg', { type: 'image/jpeg' });
    const input = $('.cv-panel input[type=file]');
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    input.dispatchEvent(new w.Event('change'));
    assert.ok($('.cv-chip'), 'a kiválasztott fájl nem látszik');
    $('.cv-panel .cv-compose').dispatchEvent(new w.Event('submit', { cancelable: true })); await wait(40);
    const withFile = server.messages.find(m => (m.attachments || []).length);
    assert.ok(withFile && withFile.attachments[0].path.startsWith(P + '/'), 'a kép nem ment el');
    assert.ok($('img.cv-img'), 'a kép nem jelenik meg');
    // szerkesztés
    const mine = $$('.cv-msg.mine')[0];
    mine.querySelector('[data-act=menu]').click();
    mine.querySelector('[data-act=edit]').click();
    assert.equal(ta.value, 'Úton vagyok, 10 perc');
    ta.value = 'Úton vagyok, 15 perc';
    $('.cv-panel .cv-compose').dispatchEvent(new w.Event('submit', { cancelable: true })); await wait(30);
    assert.equal(sent.body, 'Úton vagyok, 15 perc', 'a szerkesztés nem ment át');
    assert.ok($$('.cv-msg.mine .cv-meta')[0].textContent.includes('szerkesztve'), 'nem látszik, hogy szerkesztett');
    // törlés
    $$('.cv-msg.mine')[0].querySelector('[data-act=delete]').click(); await wait(30);
    assert.ok(sent.deleted, 'a törlés nem ment át');
    assert.ok($$('.cv-msg.mine')[0].textContent.includes('Az üzenet törölve.'));
    w.ChatV138.stop();
    w.close();
  });

  await test('V138 UI: admin – buborékonként egy aktív beszélgetés, ablak, csoportos üzenet', async () => {
    const { w, server, incoming, $, $$ } = makeWorld('admin');
    incoming(P, P, 'Megérkeztem');
    incoming(M, M, 'Defekt, késni fogok');
    await w.ChatV138.start(w.V44Online.getProfile(), A);
    await wait(30);
    const heads = $$('.cv-head:not(.cv-plus)');
    assert.equal(heads.length, 2, 'nem annyi buborék van, ahány aktív beszélgetés');
    assert.ok(heads.every(h => h.querySelector('.cv-badge')?.textContent === '1'), 'a buborékokon nincs olvasatlan-szám');
    assert.ok(w.document.title.startsWith('(2)'), 'a fül címe nem jelzi az olvasatlanokat');
    heads.find(h => h.dataset.conv === M).click(); await wait(30);
    assert.equal($$('.cv-win').length, 1, 'nem nyílt meg az ablak');
    assert.equal($('.cv-win .cv-text').textContent, 'Defekt, késni fogok');
    assert.ok(server.reads.some(r => r.conversation === M && r.reader_email === A), 'az ablak megnyitása nem jelölte olvasottnak');
    // válasz
    $('.cv-win textarea').value = 'Rendben, szólok a vevőnek';
    $('.cv-win .cv-compose').dispatchEvent(new w.Event('submit', { cancelable: true })); await wait(30);
    assert.ok(server.messages.some(m => m.conversation === M && m.sender_email === A && m.body === 'Rendben, szólok a vevőnek'));
    // csoportos üzenet a + gombbal
    $('.cv-plus').click();
    const pick = $$('.cv-picker button').find(b => b.dataset.conv === '__all__');
    assert.ok(pick, 'nincs csoportos üzenet lehetőség');
    assert.equal($$('.cv-picker button').length, 3, 'a választóban nem a sofőrök szerepelnek');
    pick.click(); await wait(30);
    $('.cv-win[data-conv="__all__"] textarea').value = 'Holnap 7-kor kezdünk';
    $('.cv-win[data-conv="__all__"] .cv-compose').dispatchEvent(new w.Event('submit', { cancelable: true })); await wait(30);
    assert.ok(server.messages.some(m => m.conversation === '__all__' && m.body === 'Holnap 7-kor kezdünk'));
    assert.equal($('.cv-win[data-conv="__all__"] .cv-foot').textContent, 'Látta: 0/2');
    // buborék elrejtése és visszatérése új üzenetre
    const pHead = $$('.cv-head').find(h => h.dataset.conv === P);
    pHead.querySelector('[data-cv=dismiss]').click(); await wait(10);
    assert.ok(!$$('.cv-head').some(h => h.dataset.conv === P), 'a buborék nem tűnt el');
    incoming(P, P, 'Kész vagyok');
    await w.ChatV138.tick(); await wait(10);
    assert.ok($$('.cv-head').some(h => h.dataset.conv === P), 'új üzenetre nem jött vissza a buborék');
    w.ChatV138.stop();
    w.close();
  });
}

module.exports = { run };
if (require.main === module) {
  (async () => {
    let passed = 0, total = 0;
    await run(async (name, fn) => { total++; try { await fn(); console.log('OK', name); passed++; } catch (e) { console.error('HIBA', name, e.stack || e.message); process.exitCode = 1; } });
    console.log(`\nV138 felületteszt: ${passed}/${total} sikeres.`);
  })();
}
