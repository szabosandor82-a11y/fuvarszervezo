const fs = require('fs');
const path = require('path');
const root = __dirname;
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
let passed = 0, failed = 0;
function test(name, condition) {
  if (condition) { passed++; console.log('PASS', name); }
  else { failed++; console.error('FAIL', name); }
}
const html = read('index.html');
const auth = read('auth-v44-2.js');
const online = read('online-v44-2.js');
const app = read('app.js');
const sw = read('sw.js');
const sql = read('supabase/schema.sql');
const config = read('online-config.js');

test('Online modul betöltődik az auth előtt', html.indexOf('online-v44-2.js') > 0 && html.indexOf('online-v44-2.js') < html.indexOf('auth-v44-2.js'));
test('Közös állapot elérhető az online modulnak', app.includes("Object.defineProperty(window,'state'"));
test('Admin helyes .com címe', auth.includes("'szabo.sandor82@gmail.com'"));
test('Admin a felületen 666-tal lép be', auth.includes("fixedPassword: '666'") && auth.includes('Fuvar-Admin-666!'));
test('Tesztfelhasználó 98-cal lép be', auth.includes("fixedPassword: '98'") && auth.includes('Fuvar-Test-98!'));
test('Sofőrök saját jelszót állíthatnak be', auth.includes("loginMode === 'signup'") && auth.includes('legalább 6 karakter'));
test('Online fuvarbetöltés és mentés', online.includes('loadOrdersIntoState') && online.includes('syncOrders'));
test('Hátralék online szinkron', online.includes('fetchBacklog') && online.includes('syncBacklog') && sql.includes('backlog_entries'));
test('Fuvarátadási kérés', auth.includes('Fuvar átadása') && online.includes('requestTransfer'));
test('Célsofőr elfogadás/elutasítás', auth.includes('respondTransfer') && online.includes('acceptTransfer') && online.includes('rejectTransfer'));
test('Átadás csak elfogadáskor módosítja a sofőrt', sql.includes("create or replace function public.accept_transfer") && sql.includes('driver_key=v_request.to_driver_key'));
test('Admin átadási előzmény', auth.includes('Fuvarátadások') && sql.includes('audit_log'));
test('Fotók privát Storage-ba kerülnek', online.includes('/storage/v1/object/delivery-docs/') && sql.includes("'delivery-docs','delivery-docs',false"));
test('Fotók buborékból megnyithatók', auth.includes('Mentett fotók') && auth.includes('listDeliveryFiles'));
test('Fotómentés visszajelzése rendeléshez kötött', auth.includes('A szállítólevél fotói a rendeléshez elmentve.'));
test('Nincs automatikus e-mail hívás', !online.includes('/functions/v1/send-delivery-report') && !online.includes('invokeEmail'));
test('Nincs e-mail küldési beállítás', !auth.includes('deliveryEmailSetting') && !online.includes('deliveryEmailDefault') && !config.includes('deliveryEmailDefault'));
test('Nincs e-mail küldési séma', !sql.includes('delivery_email') && !sql.includes('email_status') && !sql.includes('app_settings'));
test('Nincs e-mail Edge Function a csomagban', !fs.existsSync(path.join(root, 'supabase/functions/send-delivery-report/index.ts')));
test('Régi gyorsítótár törlődik', sw.includes('fuvarszervezo-v44-2-online-20260805-no-email-1') && sw.includes('online-v44-2.js'));

test('Mobil mentés kötegelt szerveroldali RPC-n fut', online.includes("rpc/sync_own_orders") && sql.includes('create or replace function public.sync_own_orders'));
test('Sofőr nem írhatja át a fuvar alapadatait', sql.includes('restricted_payload_update') && !sql.slice(sql.indexOf('create or replace function public.update_own_order_payload'), sql.indexOf('create table if not exists public.transfer_requests')).includes('order_no=coalesce'));
test('Hátralékos célfuvar szerveroldalon létrehozható', sql.includes("movedFromOrderId") && sql.includes("Új fuvar csak hátralékos tétel átütemezésével"));
test('Beállítási dokumentáció benne van', fs.existsSync(path.join(root, 'ONLINE_BEALLITAS.md')));
console.log(`\nEredmény: ${passed}/${passed + failed} sikeres`);
if (failed) process.exit(1);
