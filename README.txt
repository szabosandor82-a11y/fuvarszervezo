Fuvarszervező V40 – GitHub Pages csomag
======================================

Feltöltés:
1. A ZIP teljes tartalmát másold a GitHub Pages tároló gyökérkönyvtárába.
2. A korábbi fájlokat cseréld le.
3. Feltöltés után használj Ctrl+F5 frissítést. Telefonon zárd be, majd nyisd meg újra az alkalmazást.

V40 fő újdonságok:
- Ingyenes, böngészőben futó Outlook-szabálymotor; nincs OpenAI API és nincs feldolgozási díj.
- Két külön, egyszerre több fájlt fogadó import:
  - Dobozos import
  - Martin / Platós import
- Az MSG levélszövege és az összes csatolt PDF együtt kerül feldolgozásra.
- Normál SR0 rendelésnél a felrakót a levélből, majd a PDF-ből és a törzsadatból keresi.
- Ismeretlen beszállító esetén a „Felvétel címe” blokkban lévő céget és felrakóhelyet importáláskor automatikusan felveszi a Beszállítók törzsbe.
- KRPR szabály: a felrakó mindig a Szigetszentmiklósi Központi Raktár, 2310 Szigetszentmiklós, Kereskedő utca 2.
- PRPR szabály: a Forrás raktár a felrakó, a Cél raktár a lerakó.
- Visszáru szabály: a projekt lesz a felrakó, a beszállító/üzlet a lerakó; több eredeti rendelési szám egy közös fuvarbuborékban marad.
- A rendelésazonosítóból csak a „/” utáni rész kerül be.
- A PDF vevői/aláírási címe, például a Láva utca 7., nem írja felül a projekt törzsadatban tárolt lerakási címet.
- Hátralék tételszinten működik: csak az átütemezett tétel kerül az új napra és a Hátralék fülre; a „Megkaptuk” pipa után csak az adott tétel kerül ki onnan.
- Szerelvénybolt helyes címe: 1182 Budapest, Üllői út 807/B.
- A térképen továbbra is kizárólag a felrakók jelennek meg.

Ellenőrzött minták:
- Larex / M76 / 003141
- Szatmári Késmárk / Kincsem K6 / 004911
- Gali SwimTex / City Pearl II / 004932
- Sebők / Le Jardin / 004943
- Merkapt / Cosmo / 004937
- KRPR Központi raktár → Le Jardin / 000745
- Kekelit visszáru: Cosmo → Szatmári Késmárk / 002226, 001998, 001832

Technikai megjegyzés:
- Az MSG-olvasó a csomag része, nem töltődik külső CDN-ről. A PDF-olvasó és a térképi/Excel-könyvtárak továbbra is az index.html-ben megadott CDN-ekről töltődnek.
- A feldolgozás nem küldi el a fájlokat külső AI-szolgáltatásnak; a böngészőben történik.
- A teljesen szokatlan megfogalmazású leveleknél az import-előnézetben kézi javításra lehet szükség.

V40 javítás:
- A külső dinamikus MSG-import megszűnt.
- Az ole-msg-reader.js helyi, csomagolt CFB/Outlook parser olvassa a levél tárgyát, törzsét és mellékleteit.
- A teljes MSG → PDF → szabálymotor folyamat valódi feltöltött mintákkal tesztelve.
