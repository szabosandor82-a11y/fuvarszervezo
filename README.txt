Fuvarszervező V31 – GitHub Pages

Kritikus javítások:
- A „Fuvar szétosztása” gomb most biztosan a legújabb, kétlépcsős V30/V31 szétosztási algoritmust hívja.
- Az „Útvonal optimalizálása” gomb most biztosan a legújabb útvonalépítőt hívja.
- A korábbi közvetlen függvényreferenciás eseménykezelés megszűnt; a gombok mindig az aktuális balance() és optimizeAll() függvényt futtatják.
- A helyi fájlok verzióparamétert kaptak, így a böngésző nem keveri össze a V30 és V31 app.js/data.js/styles.css fájlokat.
- A service worker V31 gyorsítótára törli a régi cache-eket.
- Az alkalmazás fő fájljai hálózat-első frissítést használnak, ezért új GitHub-verzió feltöltésekor nem ragad bent tartósan a régi kód.
- Beépített diagnosztika: a böngésző konzoljában a getFuvarszervezoDiagnostics() megmutatja, hogy a V31 gombkezelők aktívak-e.

Megmaradt működés:
- Igazságosabb, kétlépcsős fuvarszétosztás.
- Hosszú anyag megfelelő autóra kerül.
- Sofőrönkénti útvonal a saját indulási címtől.
- Egyszeri beszállító-látogatás és összefüggő felrakási blokkok.
- Lerakás csak a szükséges felrakások után.
