const fs = require('fs');
const path = require('path');
const root = __dirname;
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const auth = read('auth-v44-2.js');
const online = read('online-v44-2.js');
const config = read('online-config.js');
const app = read('app.js');
const html = read('index.html');
const css = read('styles.css');
const sw = read('sw.js');
const schema = read('supabase/schema.sql');
const planner33 = read('planner-v33.js');
const planner37 = read('planner-v37.js');
const planner41 = read('planner-v41.js');
const planner43 = read('planner-v43.js');
const planner44 = read('planner-v44.js');
const manifest = JSON.parse(read('manifest.webmanifest'));

let passed = 0;
function ok(value, name) {
  if (!value) throw new Error(`HIBA: ${name}`);
  console.log(`OK ${name}`);
  passed++;
}

ok(app.includes("APP_VERSION='V47'"), 'V47 alkalmazásverzió');
ok(html.includes('<title>Fuvarszervező V47</title>'), 'V47 böngészőcím');
ok(manifest.name === 'Fuvarszervező V47' && manifest.short_name === 'Fuvar V47', 'V47 PWA manifest');
ok(sw.includes('fuvarszervezo-v47-online-20260806-4'), 'V47 service worker gyorsítótár');
ok(sw.includes("'./online-config.js?v=47'") && sw.includes("'./online-v44-2.js?v=47'"), 'V47 online fájlok PWA gyorsítótárban');
ok(planner44.includes("const VERSION = '47'"), 'aktív szétosztó/optimalizáló motor V47');
ok(planner44.includes("allowMartinBox && key === 'martin'") && planner44.includes('balanceFlexibleBlocks(drivers, assignedBlocks, assignedOrders, homes, !hasDetectedLongMaterial)'), 'Dobozos terhelés minden felrakószámnál kiegyenlíthető, szálas nélkül Martinnal együtt');
ok(planner44.includes('supplierAssignmentKey') && planner44.includes('supplierOwner') && planner44.includes('locationOwner'), 'szétosztásnál azonos beszállító és azonos fizikai cím is oszthatatlan egység');
ok(planner37.includes('moveSupplierOrdersTogether') && planner37.includes("draggable: '.pickup-move-block"), 'kézi húzásnál az egész aznapi beszállítói blokk együtt mozog');

ok(config.includes('https://eswwxncdystrqzqzbkto.supabase.co'), 'helyes Supabase Project URL');
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
ok(!auth.includes('66666666') && !auth.includes('12345678') && !auth.includes("fixedPassword: '666'"), 'jelszavak nincsenek nyilvános JavaScriptbe írva');
ok(online.includes('token?grant_type=password'), 'Supabase e-mail/jelszó belépés');
ok(!online.includes('signup?redirect_to=') && !auth.includes('Fiók létrehozása'), 'nincs kliensoldali regisztráció/e-mail küldés');

ok(online.includes('delivery_reports?select=*'), 'szállítólevél rendeléshez kapcsolt adatbázis-bejegyzés');
ok(online.includes('/storage/v1/object/delivery-docs/'), 'fotófeltöltés a delivery-docs bucketbe');
ok(online.includes('/storage/v1/object/sign/delivery-docs/'), 'privát fotók visszanézése aláírt URL-lel');
ok(auth.includes('global.V44Online.createDeliveryReport(order, files'), 'kamera mentése online rendeléshez');
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

ok(html.includes('id="plannerControls"') && html.includes('id="plannerMobileControlHost"'), 'planner műveletek oldalsáv/mobil gazdában');
ok(!html.includes('class="toolbar panel"'), 'régi felső planner eszköztár kivezetve');
ok(css.includes('#planner.active .route-list{flex:1 1 auto;min-height:0;overflow-y:auto'), 'csak a buboréklista görgethető asztali nézetben');
ok(css.includes('#orderDialog #orderForm>.dialog-head{position:sticky'), 'buborékszerkesztő bezárógombja rögzített');
ok(css.includes('--blue:#7da8cf') && css.includes('--green:#78b69d'), 'pasztell fő színpaletta');
ok(planner37.includes('* 7)') && planner37.includes('scroll: false'), 'lassított, egyetlen drag-autoscroll');
ok(planner41.includes('Válassz vagy írj be új felrakó címet') && planner41.includes('<datalist'), 'Outlook felrakócím írható és beszállítóhoz szűrt');
const clearBlock = planner41.slice(planner41.indexOf('function clearAllImports()'), planner41.indexOf('function bindDropZone'));
ok(clearBlock.includes('már jóváhagyott fuvarok megmaradnak') && !clearBlock.includes('state.orders ='), 'Outlook ürítés nem töröl mentett fuvarokat');
ok(planner44.includes("order.importVehicleLocked && ['mario', 'patrik', 'martin'].includes(category)"), 'kézi áthúzás nem lesz automatikusan sofőrhöz rögzített');
ok((planner43.match(/mergeSeedMasterData\(\);/g) || []).length === 0 && !html.includes('loadBuiltInMastersBtn'), 'régi seed nem keveredik vissza automatikusan');
ok(app.includes('window.V47MasterLearning') && app.includes('order.scheduleDate>=startDate'), 'törzsadat-tanulás csak a módosítás napjától előre');
ok(online.includes('fetchMasterData') && online.includes('syncMasterData') && online.includes('loadMasterIntoState'), 'online törzsadat-szinkron');
ok(schema.includes('create table if not exists public.master_data') && schema.includes("public.current_role()='admin'"), 'Supabase törzsadat-tábla admin RLS-sel');

console.log(`Sikeres V47 tesztek: ${passed}/${passed}`);
