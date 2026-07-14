FUVAR-SZERVEZŐ V5

FŐ ÚJDONSÁGOK
1. Igazságos automatikus szétosztás
   - figyeli a felrakók és lerakók számát;
   - figyeli a sofőrök lakóhelyének közelségét:
       Márió – Vác
       Patrik – Kispest
       Martin – Felcsút;
   - a hosszú szálanyag mindig Martin ponyvás autóján marad;
   - ha Martin szabad, normál rendeléseket is kap;
   - becsült kilométert, munkaidőt és túlórát mutat;
   - alap munkaidő: 7:00–16:00, a túlóra csak figyelmeztetés.

2. Teljesen interaktív fuvarok
   - egy autón belül húzással módosítható sorrend;
   - rendelés egyik autóról a másikra húzható;
   - gyors szerkesztés közvetlenül a fuvar kártyáján;
   - a térkép és az export sorrendje automatikusan frissül.

3. Sofőr-visszajelző modul
   - rendeléshez szállítólevél-fotó készíthető;
   - több fotó csatolható;
   - kézi hiány/megjegyzés rögzíthető;
   - hangfelvétel készíthető és visszahallgatható;
   - az eredeti hangfájl is elküldhető;
   - támogatott böngészőben magyar diktálásból szöveg készül;
   - rendelés teljesítettnek jelölhető;
   - címzett: szabo.sandor@stand98.hu.

GITHUB PAGES MÓD
A GitHub Pages nem tud titkos SMTP- vagy AI-kulcsot biztonságosan tárolni.
Ezért ebben a módban:
- a program elkészíti az e-mail szövegét;
- mobilon megnyitja a megosztási felületet a fotókkal és a hanggal;
- ahol a Web Share nem használható, megnyitja az e-mail-vázlatot és külön letölti a csatolmányokat.

TELJESEN AUTOMATIKUS E-MAIL + AI HANGÁTÍRÁS
A csomagban található `server` mappa opcionális háttérszolgáltatás.
Aktiválás:
1. Telepíts Node.js-t.
2. Nyisd meg a `server` mappát.
3. Másold a `.env.example` fájlt `.env` névre.
4. Töltsd ki a céges SMTP-adatokat.
5. Opcionálisan add meg az OPENAI_API_KEY értékét.
6. Futtasd:
   npm install
   npm start
7. Az alkalmazást ugyanerről a szerverről nyisd meg.
Ekkor a „Jelentés elküldése” gomb automatikusan elküldi:
- a szállítólevél-fotókat;
- az eredeti hangfelvételt;
- a kézi megjegyzést;
- a böngészős vagy AI-alapú szöveges átiratot.

GITHUB FRISSÍTÉS
A repository MAIN ágában írd felül:
index.html
styles.css
app.js
data.js
manifest.webmanifest
sw.js
icon-192.png
icon-512.png

A `server` mappát GitHubra is feltöltheted, de GitHub Pages nem futtatja.
Automatikus e-mailhez Render, Railway, Fly.io, VPS vagy céges szerver szükséges.

FRISSÍTÉS UTÁN
- várj 1–3 percet;
- számítógépen Ctrl+F5;
- iPhone-on töröld a régi főképernyős appot, majd Safariból add hozzá újra.
