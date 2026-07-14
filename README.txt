FUVAR-SZERVEZŐ V4 – TELEPÍTÉS ÉS FRISSÍTÉS

GITHUB FRISSÍTÉS
1. Csomagold ki a ZIP fájlt.
2. A GitHub repository MAIN ágában töltsd fel és írd felül ezekkel a régi fájlokat:
   index.html
   styles.css
   app.js
   data.js
   manifest.webmanifest
   sw.js
   icon-192.png
   icon-512.png
3. Commit changes.
4. Várj 1–3 percet.
5. Számítógépen Ctrl+F5-tel frissíts.
6. iPhone-on töröld a régi főképernyős alkalmazást, nyisd meg Safariban a Pages címet,
   majd Megosztás → Hozzáadás a Főképernyőhöz.

V4 ÚJDONSÁGOK
- Import oszlopnevek alapján, nem fix oszlopszám alapján.
- Kizárólag a jóváhagyott oszlopokat használja:
  Bizonylatszám, Témaszám név, Termék kód, Termék név,
  Ügyfél/raktár, Tétel mennyiség, M.e.,
  Kért szállítási határidő, Dátum, autó, Megjegyzés.
- Bizonylatszám utolsó 5 számjegye.
- Témaszám név alapján biztonságos projektpárosítás.
- Bizonytalan projektpárosítás esetén üresen marad.
- Projekt címének és alapértelmezett átvevőjének automatikus kitöltése.
- 4, 5 és 6 méteres szálanyag felismerése a Termék névből.
- Ha egy rendelésben egyetlen hosszú tétel is van, az egész rendelés Martin ponyvás autójára kerül.
- A hosszú tétel oka látható a rendelésen és a tételmellékletben.
- A térképen valós közúti útvonal jelenik meg az OpenStreetMap/OSRM alapján.
- A térkép alatti kártyákon gyorsan szerkeszthető:
  beszállító, projekt, címek, átvevő, telefon, felrakói és fuvarmegjegyzés.
- Minden felrakóhoz külön felrakói megjegyzés.
- Excel, Word és PDF fuvar-export tételmelléklettel.
- Külön Excel export az importadatokról, a kézzel beírt megjegyzésekkel.
- Dátumonként automatikusan külön fuvarnap.
- Húzással módosítható sorrend és sofőr.

FONTOS
- Az Excel-beolvasás, a térkép és a közúti útvonal internetkapcsolatot igényel.
- A geokódolás ingyenes OpenStreetMap Nominatim szolgáltatást használ.
- Az automatikus optimalizálás közelségi sorrendet számol, majd ezt valós közúti útvonalként rajzolja ki.
- A kézi húzással beállított sorrend bármikor felülírhatja az automatikus sorrendet.
