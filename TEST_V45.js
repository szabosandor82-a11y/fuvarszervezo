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
const manifest = JSON.parse(read('manifest.webmanifest'));

let passed = 0;
function ok(value, name) {
  if (!value) throw new Error(`HIBA: ${name}`);
  console.log(`OK ${name}`);
  passed++;
}

ok(app.includes("APP_VERSION='V45'"), 'V45 alkalmazásverzió');
ok(html.includes('<title>Fuvarszervező V45</title>'), 'V45 böngészőcím');
ok(manifest.name === 'Fuvarszervező V45' && manifest.short_name === 'Fuvar V45', 'V45 PWA manifest');
ok(sw.includes('fuvarszervezo-v45-online-20260805-1'), 'V45 service worker gyorsítótár');
ok(sw.includes("'./online-config.js?v=45'") && sw.includes("'./online-v44-2.js?v=45'"), 'online fájlok PWA gyorsítótárban');

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

console.log(`Sikeres V45 tesztek: ${passed}/${passed}`);
