/* Fuvarszervező V138 – csevegő, és a Mentett fotók külön megjegyzés-része.
   A TEST_V138.js futtatja, külön is indítható: node TEST_V138_FEATURES.js */
const fs = require('fs');
const vm = require('vm');
const assert = require('assert');
const { createEnv } = require('./TEST_V132_SYNC.js');

function chatLogic() {
  const ctx = { console, Date, Map, Set, String, Array, Object, JSON, Math, Number, Promise, setInterval() {}, setTimeout() {}, clearTimeout() {} };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(__dirname + '/chat-v138.js', 'utf8'), ctx);
  return ctx.ChatV138._logic;
}

function onlineWith(handler) {
  const requests = [];
  const ctx = {
    console: { log() {}, warn() {}, info() {}, error() {} }, Date, Map, Set, Number, String, Object, Array, JSON, Math, Promise, Error,
    URLSearchParams, URL, Blob, ArrayBuffer, FormData, File, crypto: { randomUUID: () => 'uuid-1' },
    FUVARSZERVEZO_ONLINE_CONFIG: { supabaseUrl: 'https://example.supabase.co', anonKey: 'k' },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    fetch: async (url, options = {}) => {
      url = String(url); const req = { url, method: options.method || 'GET', headers: options.headers || {}, body: options.body };
      requests.push(req);
      let payload = handler(req);
      if (url.includes('/auth/v1/token')) payload = { access_token: 'a', refresh_token: 'r', expires_in: 3600, user: { email: 'Polgar.Patrik@stand98.hu' } };
      return { ok: true, status: 200, statusText: 'OK', text: async () => JSON.stringify(payload ?? []) };
    }
  };
  ctx.window = ctx; ctx.globalThis = ctx; vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(__dirname + '/online-v44-2.js', 'utf8'), ctx);
  return { online: ctx.V44Online, requests };
}

const P = 'polgar.patrik@stand98.hu', M = 'berki.mario@stand98.hu', A = 'szabo.sandor82@gmail.com';
const msg = (id, conversation, sender, at, extra = {}) => ({ id, conversation, sender_email: sender, created_at: at, updated_at: at, body: id, attachments: [], deleted: false, ...extra });

async function run(test) {
  await test('V138: csevegő – olvasatlan üzenetek és „Látta” jelzés', () => {
    const L = chatLogic();
    const messages = [
      msg('1', P, P, '2026-10-14T08:00:00Z'), msg('2', P, A, '2026-10-14T08:05:00Z'), msg('3', P, A, '2026-10-14T08:06:00Z'),
      msg('4', '__all__', A, '2026-10-14T08:07:00Z'), msg('5', P, A, '2026-10-14T08:08:00Z', { deleted: true })];
    const reads = new Map([[L.readKey(P, P), '2026-10-14T08:05:30Z'], [L.readKey(P, A), '2026-10-14T08:01:00Z']]);
    assert.equal(L.unreadCount(messages, reads, P, P), 1, 'Patrik olvasatlan üzeneteinek száma hibás (a törölt nem számít)');
    assert.equal(L.unreadCount(messages, reads, '__all__', P), 1, 'a csoportos üzenet nem számít olvasatlannak');
    assert.equal(L.unreadCount(messages, reads, P, A), 0, 'az admin olvasás után is olvasatlant lát (a saját üzenete nem számít)');
    const korabban = new Map([[L.readKey(P, A), '2026-10-14T07:00:00Z']]);
    assert.equal(L.unreadCount(messages, korabban, P, A), 1, 'az admin nem látja Patrik új üzenetét');
    assert.equal(L.seenLabel(messages[0], reads, P, [], 'driver'), 'Látta', 'a sofőr nem látja, hogy az admin olvasta');
    assert.equal(L.seenLabel(messages[1], reads, A, [], 'admin'), 'Látta');
    assert.equal(L.seenLabel(messages[2], reads, A, [], 'admin'), 'Elküldve');
    const users = [{ email: P, role: 'driver' }, { email: M, role: 'driver' }, { email: A, role: 'admin' }];
    reads.set(L.readKey('__all__', P), '2026-10-14T09:00:00Z');
    assert.equal(L.seenLabel(messages[3], reads, A, users, 'admin'), 'Látta: 1/2', 'a csoportos üzenet olvasottsága hibás');
    assert.equal(L.seenLabel(messages[1], reads, P, users, 'driver'), '', 'a másik fél üzenetén is van jelzés');
  });

  await test('V138: csevegő – annyi buborék, ahány aktív beszélgetés', () => {
    const L = chatLogic();
    const now = Date.parse('2026-10-14T12:00:00Z');
    const messages = [
      msg('1', P, P, '2026-10-14T11:00:00Z'),                 // friss
      msg('2', M, M, '2026-10-12T08:00:00Z'),                 // régi, olvasott
      msg('3', 'kovacs@x.hu', 'kovacs@x.hu', '2026-10-10T08:00:00Z'), // régi, olvasatlan
      msg('4', '__all__', A, '2026-10-14T10:00:00Z')];
    const reads = new Map([[L.readKey(M, A), '2026-10-13T00:00:00Z'], [L.readKey(P, A), '2026-10-14T11:30:00Z']]);
    let active = L.activeConversations({ messages, reads, me: A, opened: new Set(), dismissed: {}, now });
    assert.deepEqual(active.map(a => a.conversation), ['kovacs@x.hu', P, '__all__'], 'az aktív beszélgetések listája hibás');
    active = L.activeConversations({ messages, reads, me: A, opened: new Set([M]), dismissed: { [P]: '2026-10-14T11:40:00Z' }, now });
    assert.ok(active.some(a => a.conversation === M), 'a megnyitott beszélgetés nem jelent meg');
    assert.ok(!active.some(a => a.conversation === P), 'a bezárt buborék visszajött új üzenet nélkül');
    messages.push(msg('5', P, P, '2026-10-14T11:50:00Z'));
    active = L.activeConversations({ messages, reads, me: A, opened: new Set(), dismissed: { [P]: '2026-10-14T11:40:00Z' }, now });
    assert.ok(active.some(a => a.conversation === P && a.unread === 1), 'új üzenetre nem jött vissza a buborék');
  });

  await test('V138: csevegő – biztonságos megjelenítés és hivatkozások', () => {
    const L = chatLogic();
    assert.equal(L.linkify('<b>x</b> https://a.hu/x?y=1&z=2'), '&lt;b&gt;x&lt;/b&gt; <a href="https://a.hu/x?y=1&amp;z=2" target="_blank" rel="noopener">https://a.hu/x?y=1&amp;z=2</a>');
    assert.equal(L.initials('Polgár Patrik'), 'PP');
  });

  await test('V138: csevegő – a szerver felé küldött kérések', async () => {
    const { online, requests } = onlineWith(req => {
      if (req.url.includes('/rest/v1/allowed_users')) return [{ email: P, role: 'driver', active: true, display_name: 'Polgár Patrik' }];
      if (req.method === 'POST' && req.url.includes('/rest/v1/chat_messages')) return [{ id: 'm1', ...JSON.parse(req.body) }];
      if (req.url.includes('/object/sign/')) return { signedURL: '/object/sign/chat-files/x?token=t' };
      return [];
    });
    await online.signInWithPassword(P, 'jelszo');
    await online.fetchProfile?.();
    assert.equal(online.chatMyEmailV138(), P, 'az e-mail-cím nem kisbetűs');
    await online.chatFetchV138({ days: 30 });
    assert.ok(requests.at(-1).url.includes('created_at=gte.'), 'az első lekérés nem időablakkal megy');
    await online.chatFetchV138({ since: '2026-10-14T10:00:00Z' });
    assert.ok(decodeURIComponent(requests.at(-1).url).includes('updated_at=gt.2026-10-14T10:00:00Z'), 'a frissítés nem csak a változásokat kéri');
    const sent = await online.chatSendV138({ conversation: 'Polgar.Patrik@stand98.hu', body: 'Szia', senderName: 'Polgár Patrik' });
    assert.equal(sent.conversation, P);
    await online.chatMarkReadV138(P);
    const read = requests.at(-1);
    assert.ok(read.url.includes('chat_reads?on_conflict=conversation,reader_email'));
    assert.equal(JSON.parse(read.body)[0].reader_email, P);
    const file = new File([new Uint8Array(5)], 'Fotó 1.jpg', { type: 'image/jpeg' });
    const att = await online.chatUploadV138(P, file);
    assert.ok(att.path.startsWith(`${P}/uuid-1/`), 'a fájl nem a saját beszélgetés mappájába kerül: ' + att.path);
    assert.ok(requests.at(-1).url.includes('/storage/v1/object/chat-files/'), 'nem a csevegő tárolójába tölt');
    const url = await online.chatSignV138(att.path);
    assert.ok(url.startsWith('https://example.supabase.co/storage/v1/object/sign/'), url);
    await online.chatUpdateV138('m1', { body: 'Javítva' }).catch(() => {});
    assert.ok(requests.some(r => r.method === 'PATCH' && r.url.includes('chat_messages?id=eq.m1')), 'a szerkesztés nem a megfelelő üzenetet módosítja');
  });

  await test('V138: a csevegő be van kötve, és a szerveroldali szabályok a csomagban vannak', () => {
    const html = fs.readFileSync(__dirname + '/index.html', 'utf8');
    assert.ok(html.indexOf('chat-v138.js') > html.indexOf('auth-v44-2.js'), 'a csevegő nincs betöltve, vagy túl korán töltődik');
    assert.ok(fs.readFileSync(__dirname + '/sw.js', 'utf8').includes('chat-v138.js'), 'a csevegő nincs a gyorsítótárban');
    const sql = fs.readFileSync(__dirname + '/SUPABASE_CSEVEGO_V138.sql', 'utf8');
    for (const part of ['create table if not exists public.chat_messages', 'create table if not exists public.chat_reads', "conversation = '__all__'", 'chat_messages_before_update_v138', "'chat-files'", 'enable row level security']) {
      assert.ok(sql.includes(part), 'hiányzik az SQL-ből: ' + part);
    }
    const css = fs.readFileSync(__dirname + '/styles.css', 'utf8');
    for (const rule of ['.cv-fab', '.cv-head', '.cv-win', '.cv-panel']) assert.ok(css.includes(rule), 'hiányzó stílus: ' + rule);
  });

  await test('V138: a Mentett fotók a megjegyzést és a hangjegyzetet külön részben mutatja', () => {
    const env = createEnv('admin');
    const order = { id: 'o1', orderNo: '06935', scheduleDate: '2026-10-14', deliveryReports: [
      { id: 'r1', at: '2026-10-14T08:00:00Z', note: 'A kapunál hagytam,\naláírta a portás.' },
      { id: 'r2', at: '2026-10-14T09:00:00Z', note: '' },
      { id: 'src', at: '2026-10-14T07:00:00Z', note: 'Outlook forrás · x.msg' }] };
    env.load([order]);
    const napja = () => '2026. 10. 14.';
    const images = [{ id: 'f1', report_id: 'r1', url: 'https://x/1.jpg', file_name: '1.jpg', mime_type: 'image/jpeg', orderNo: '06935' },
      { id: 'f3', report_id: 'r2', url: 'https://x/a.pdf', file_name: 'a.pdf', mime_type: 'application/pdf', orderNo: '06935' }];
    const audio = [{ id: 'f2', report_id: 'r2', url: 'https://x/h.webm', file_name: 'hangjegyzet.webm', mime_type: 'audio/webm', orderNo: '06935' }];
    const html = env.ctx.renderGalleryV138([env.local('o1')], images, audio, napja);
    const notesAt = html.indexOf('Megjegyzések és hangjegyzetek');
    const photosAt = html.indexOf('Fotók és csatolmányok');
    assert.ok(photosAt >= 0 && notesAt > photosAt, 'nincs két külön rész');
    const notes = html.slice(notesAt);
    assert.ok(notes.includes('A kapunál hagytam,\naláírta a portás.'), 'a szöveges megjegyzés nem jelenik meg');
    assert.ok(notes.includes('<audio') && !html.slice(0, notesAt).includes('<audio'), 'a hangjegyzet a fotók közé keveredett');
    assert.ok(!html.includes('Outlook forrás'), 'az Outlook-forrás bejegyzés is megjegyzésnek látszik');
    assert.ok(html.slice(photosAt, notesAt).includes('📎 a.pdf'), 'a csatolt PDF nem a csatolmányok között van');
    assert.equal(env.ctx.renderGalleryV138([{ id: 'x', deliveryReports: [] }], [], [], napja), '', 'üres galériánál is van tartalom');
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
    console.log(`\nV138 funkcióteszt: ${passed}/${total} sikeres.`);
  })();
}
