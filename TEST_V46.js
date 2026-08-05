const fs = require('fs');
const path = require('path');
const root = __dirname;
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const auth = read('auth-v44-2.js');
const online = read('online-v44-2.js');
const config = read('online-config.js');
const app = read('app.js');
const html = read('index.html');
const sw = read('sw.js');
const schema = read('supabase/schema.sql');
const planner33 = read('planner-v33.js');
const planner37 = read('planner-v37.js');
const manifest = JSON.parse(read('manifest.webmanifest'));

let passed = 0;
function ok(value, name) {
  if (!value) throw new Error(`HIBA: ${name}`);
  console.log(`OK ${name}`);
  passed++;
}

ok(app.includes("APP_VERSION='V46'"), 'V46 alkalmazásverzió');
ok(html.includes('<title>Fuvarszervező V46</title>'), 'V46 böngészőcím');
ok(manifest.name === 'Fuvarszervező V46' && manifest.short_name === 'Fuvar V46', 'V46 PWA manifest');
ok(sw.includes('fuvarszervezo-v46-online-20260805-1'), 'V46 service worker gyorsítótár');
ok(sw.includes("'./online-config.js?v=46'") && sw.includes("'./online-v44-2.js?v=46'"), 'online fájlok PWA gyorsítótárban');

ok(config.includes("https://eswwxncdystrqzqzbkto.supabase.co"), 'helyes Supabase Project URL');
ok(config.includes('sb_publishable_v_1PQY4MNAd5HjkFOv37lg_7sDUjPLs'), 'publishable key beállítva');
ok(!/\b(?:service_role|secret|secretKey|serviceRoleKey)\s*:/.test(config), 'nincs service_role/secret kulcs a klienskonfigban');

[
  'schmidt.martin@stand98.hu',
  'polgar.patrik@stand98.hu',
  'berki.mario@stand98.hu',
  'szabo.sandor82@gmail.com',
  'szabo.sandor@stand98.hu'
].forEach(email => ok(auth.includes(email), `engedélyezett fiók: ${email}`));
ok(!auth.includes('gmail.hu'), 'hibás admin gmail.hu cím nincs benne');
ok(!auth.includes('66666666') && !auth.includes("fixedPassword: '666'"), 'admin jelszó nincs nyilvános JavaScriptbe írva');
ok(online.includes("token?grant_type=password"), 'Supabase e-mail/jelszó belépés');
ok(!online.includes('signup?redirect_to=') && !auth.includes('Fiók létrehozása'), 'nincs kliensoldali regisztráció/e-mail küldés');

ok(online.includes("delivery_reports?select=*"), 'szállítólevél rendeléshez kapcsolt adatbázis-bejegyzés');
ok(online.includes('/storage/v1/object/delivery-docs/'), 'fotófeltöltés a delivery-docs bucketbe');
ok(online.includes('/storage/v1/object/sign/delivery-docs/'), 'privát fotók visszanézése aláírt URL-lel');
ok(auth.includes("global.V44Online.createDeliveryReport(order, files"), 'kamera mentése online rendeléshez');
ok(!online.includes('send-delivery-report') && !auth.includes('send-delivery-report'), 'nincs szállítólevél e-mail-küldő végpont');

[
  'update_own_order_payload', 'sync_own_orders', 'sync_own_backlog',
  'request_transfer', 'accept_transfer', 'reject_transfer', 'cancel_transfer'
].forEach(fn => ok(schema.includes(`function public.${fn}`) && online.includes(`rpc/${fn}`), `RPC bekötve: ${fn}`));

ok(schema.includes("values('delivery-docs','delivery-docs',false"), 'privát delivery-docs bucket');
ok(schema.includes('create policy delivery_docs_insert') && schema.includes('create policy delivery_docs_read'), 'Storage RLS szabályok');
ok(schema.includes('create policy reports_insert') && schema.includes('create policy report_files_insert'), 'fotó-metaadat RLS szabályok');

ok(planner33.includes("openMediaGallery('${escHtml(ids)}')") && planner37.includes("openMediaGallery('${escHtml(ids)}')"), 'Mentett fotók gomb a csoportosított buborékokon');
ok(app.includes("openMediaGallery('${o.id}')") && app.includes('📎 Mentett fotók'), 'Mentett fotók gomb a Rendelések listában');
ok(auth.includes("String(orderIds || '').split(',')") && auth.includes('Promise.all(ids.map'), 'több rendelés fotóinak közös galériája');

console.log(`Sikeres V46 tesztek: ${passed}/${passed}`);
