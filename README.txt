FUVAR-SZERVEZŐ V10 – GITHUB PAGES

V10 ÚJDONSÁGOK

1. EGY FUVAR GYORS TÖRLÉSE
- Minden fuvarbuborék jobb alsó sarkában külön piros kuka ikon van.
- A kuka csak az adott fuvar/rendeléskártyát törli.
- Törlés előtt megerősítést kér.
- A megmaradó fuvarok sorrendje automatikusan újraszámozódik.
- A térkép és az export azonnal az új listát használja.

2. ÖSSZES FUVAR TÖRLÉSE
- A Fuvarok oldal legalján nagy piros „Összes fuvar törlése” gomb található.
- Minden dátum, minden sofőr, minden importált és kézzel felvitt fuvar törlődik.
- A projektek, beszállítók, átvevők, törzsadatok és beállítások megmaradnak.
- Kétlépcsős megerősítést kér:
  1. megerősítő kérdés;
  2. a TÖRLÉS szó begépelése.
- Így teszteléskor biztonságosan kiüríthető a rendszer, majd újra importálható a SERPA Excel.

3. FUVAR FELVITELE NULLÁRÓL
- A fő Fuvarok oldalon külön „＋ Új fuvar” gomb található.
- A Rendelések oldalon a korábbi plusz gomb is megmaradt.
- Megadható:
  dátum, sofőr, rendelésszám, felrakó, projekt, címek,
  átvevő, telefonszám, megjegyzések és opcionális időablak.
- A kézzel felvitt fuvar ugyanúgy húzható, optimalizálható és exportálható.

GITHUB FELTÖLTÉS
A repository MAIN ágának gyökerében írd felül:
- index.html
- styles.css
- app.js
- data.js
- manifest.webmanifest
- sw.js
- icon-192.png
- icon-512.png

Ne tölts fel server, public, login vagy driver almappákat ehhez a GitHub Pages-verzióhoz.

FRISSÍTÉS UTÁN
1. Várj 1–3 percet.
2. Számítógépen Ctrl+F5.
3. Telefonon töröld a korábbi főképernyős alkalmazást.
4. Safariban nyisd meg újra a GitHub Pages oldalt.
5. Megosztás → Hozzáadás a Főképernyőhöz.

KÉSŐBBI, KÖTELEZŐ VÉGLEGESÍTÉS
A többfelhasználós bejelentkezés és jogosultságkezelés most még szándékosan nincs bekapcsolva.
Amikor késznek érzed a rendszert, ne maradjon el:
- külön admin;
- Márió, Patrik és Martin külön belépése;
- csak saját, aznapi feladatok;
- feladatátadás és naplózás.
