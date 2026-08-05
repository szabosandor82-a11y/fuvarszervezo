const fs=require('fs');
const path=require('path');
const root=__dirname;
const auth=fs.readFileSync(path.join(root,'auth-v44-2.js'),'utf8');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const css=fs.readFileSync(path.join(root,'styles.css'),'utf8');
const manifest=JSON.parse(fs.readFileSync(path.join(root,'manifest.webmanifest'),'utf8'));
const sw=fs.readFileSync(path.join(root,'sw.js'),'utf8');
let passed=0;
function ok(value,name){if(!value)throw new Error('HIBA: '+name);console.log('OK '+name);passed++;}
[
 'schmidt.martin@stand98.hu','polgar.patrik@stand98.hu','berki.mario@stand98.hu',
 'szabo.sandor82@gmail.com','szabo.sandor@stand98.hu'
].forEach(email=>ok(auth.includes(email),`engedélyezett fiók: ${email}`));
ok(auth.includes("role: 'admin'"),'admin szerepkör');
ok(auth.includes("role: 'driver'"),'sofőr szerepkör');
ok(auth.includes("role: 'test'"),'teszt szerepkör');
ok(auth.includes("allowedDates().includes(order.scheduleDate)"),'csak mai és holnapi fuvar elérhető');
ok(auth.includes("guardOrderFunction('editOrder', false)"),'sofőr nem szerkeszthet fuvart');
ok(auth.includes("guardOrderFunction('deleteOne', false)"),'sofőr nem törölhet fuvart');
ok(auth.includes("guardOrderFunction('openItems', true)"),'tételkezelés engedélyezett');
ok(auth.includes("guardOrderFunction('openCamera', true)"),'kamera engedélyezett');
ok(auth.includes('indexedDB.open(MEDIA_DB'),'fotók helyi IndexedDB mentése');
ok(html.includes('id="authScreen"')&&html.includes('id="driverPortal"'),'belépő- és mobil felület');
ok(!/mobile-user-actions[\s\S]{0,500}Szerkesztés/.test(auth),'mobil buborékon nincs szerkesztés');
ok(css.includes('.driver-portal')&&css.includes('env(safe-area-inset-bottom)'),'iOS/Android safe-area mobil CSS');
ok(manifest.display==='standalone'&&manifest.orientation==='portrait-primary','telepíthető mobil PWA manifest');
ok(sw.includes('fuvarszervezo-v44-2-20260805-admin-email-fix')&&sw.includes('auth-v44-2.js?v=44.2.1'),'V44.2 service worker gyorsítótár');
console.log(`Sikeres V44.2 tesztek: ${passed}/${passed}`);
