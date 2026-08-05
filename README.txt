Fuvarszervező V44 – GitHub Pages csomag
======================================

Telepítés
---------
1. A ZIP teljes tartalmát másold a GitHub Pages tároló gyökérkönyvtárába.
2. A korábbi fájlokat írd felül; az index.html közvetlenül a gyökérben legyen.
3. Várd meg a GitHub Pages frissítését, majd használj Ctrl+F5-öt.
4. Telefonon zárd be teljesen az oldalt, majd nyisd meg újra.
5. A V44 új gyorsítótár-nevet használ, ezért a korábbi verzió fájljai nem maradnak aktívak.

V44 fuvarszétosztás – új, determinisztikus motor
------------------------------------------------
- Az Autó mezőben Márió, Patrik vagy Martin névre rögzített fuvar automatikusan nem mozgatható.
- A fix sofőrös rendelések beleszámítanak a terhelésbe, de csak a felhasználó helyezheti át őket másik sofőrhöz.
- Az automatikus szétosztás csak a Dobozos és a még be nem sorolt fuvarokat osztja.
- Azonos fizikai felrakóhely rendelései egy felrakóblokkot alkotnak, ezért normál esetben csak egy sofőr megy ugyanahhoz a telephelyhez.
- Ütköző, névre rögzített sofőrök esetén a rendszer figyelmeztetést ad, és nem írja felül a fix kiosztást.
- Márió kapja a pesti oldalt.
- Patrik kapja a budai oldalt.
- Martin kapja a platós, hosszú/szálas és a Felcsút–nyugati folyosóba illő felrakókat.
- Martin nem kap pesti címet pusztán azért, mert kevesebb megállója van.
- A kiegyenlítés csak semleges, központi vagy valóban útba eső mozgatható blokkokkal történik.
- Az útvonal minősége fontosabb a mesterségesen azonos címszámnál.
- Az Optimalizálás csak az adott sofőrön belüli sorrendet módosítja, sofőrt nem.

Indulási pontok és sorrend
--------------------------
- Márió: Vác felől indul.
- Martin: Felcsút felől indul.
- Patrik: a szigetszentmiklósi központi raktárból indul.
- A sorrend nem név szerinti rendezésből készül, hanem a sofőr indulási iránya és a felrakóhelyek helyzete alapján.
- Beépített ellenőrzött példa Máriónál: Szatmári Késmárk → Merkapt Maglódi → Ezerker.
- A térképen és az útvonalban továbbra is csak a felrakók szerepelnek.

Outlook-import
--------------
- Két külön tömeges import: Dobozos és Martin / Platós.
- A két kategória fájljai külön oszlopban, egymás alatt jelennek meg.
- A levél tárgya, teljes szövege és a csatolt PDF-ek együtt kerülnek feldolgozásra.
- Csak a „Szállítói rendelés” vagy raktárközi bizonylat számít elsődleges mellékletnek; a beszállítói visszaigazolás nem hoz létre második fuvart.
- Több valódi SR0 egy levélben külön rendelésként kerül be, és az importnál az összes kapcsolódó rendelésszám látható.
- A rendelési azonosítóból csak a / utáni rész kerül be.
- A Szállítói rendelés PDF fejlécének Szállító mezője elsőbbséget kap a levél címzettjével és más mellékletekkel szemben.
- A 004963/4963 mintánál a helyes beszállító NICZUK, nem Két Kör Kft.
- Felrakó neve: kereshető legördülő lista a beszállítói törzsből.
- Felrakó címe: az adott beszállító telephelyeinek legördülő listája, a központi telephellyel alapértelmezetten.
- Lerakó projekt: kereshető legördülő lista a projekttörzsből.
- Projekt kiválasztásakor a lerakó címe automatikusan betöltődik, de utólag szerkeszthető.
- Korábban importált rendelés ismét behúzható teszteléshez.
- A „Minden import törlése” az előnézetet és a korábban jóváhagyott, rejtett Outlook-importokat is törli.
- A jóváhagyott importok alapértelmezetten a holnapi napra kerülnek.

Rendeléstípusok
---------------
- Normál SR0: a PDF „Projekt név” mezője alapján a projekttörzs címe lesz a lerakó.
- KRPR: felrakó mindig a szigetszentmiklósi központi raktár; hiányzó célraktárcím a projekttörzsből töltődik.
- PRPR: a forrásraktár a felrakó, a célraktár a lerakó.
- Visszáru: a levélszöveg alapján a projekt a felrakó, a beszállító/üzlet a lerakó.
- A Cosmo–Szatmári Késmárk visszáru iránya külön ellenőrzött minta.

Törzsadatok
-----------
- „Minden törzsadat törlése” gomb: törli a beszállítói, telephely-, projekt- és raktártörzset, de a fuvarokat nem.
- „Beépített törzsadatok betöltése” gomb: egy kattintással visszatölti a V44-be csomagolt alapadatokat.
- Törlés előtt megerősítést kér.
- A kézzel szerkesztett, meglévő címeket normál verziófrissítés nem írja felül automatikusan.
- A központi telephely jelölés továbbra is használható a beszállítói címeknél.
- Beépített külön felrakóhelyek többek között:
  - Szatmári Késmárk: 1158 Budapest, Késmárk utca 9.
  - Merkapt Maglódi: 1106 Budapest, Maglódi út 14/B
  - Sebők Törökbálint: 2045 Törökbálint, Kinizsi utca 28.
  - Szerelvénybolt: 1182 Budapest, Üllői út 807/B

Hátralék
--------
- Csak az átütemezett tétel kerül az új napra és a Hátralékok fülre.
- A „Megkaptuk” jelölés után csak az adott tétel kerül ki a Hátralékok közül.

Tesztelés
---------
- JavaScript szintaktikai ellenőrzés: sikeres.
- Automatikus tesztek: 80/80 sikeres.
- Külön V44-tesztek ellenőrzik a fix sofőröket, a Pest/Buda/nyugati kiosztást, Martin pesti túlterhelésének tiltását, azonos felrakóhely egy sofőrnél tartását, a három indulási pontot, a Szatmári → Merkapt → Ezerker sorrendet és az optimalizálás sofőrmegőrzését.
- Outlook-teszt ellenőrzi, hogy a PDF Szállító mezője alapján NICZUK kerüljön be Két Kör Kft. helyett.
- A GitHub Pages-en történő valós böngészős feltöltést telepítés után külön érdemes ellenőrizni.

Technikai megjegyzés
--------------------
- Az MSG-olvasó helyi fájl, nem külső CDN-ről töltődik.
- A PDF-, térkép- és Excel-könyvtárakhoz internetkapcsolat szükséges.
- Szokatlan levélformátumnál az import-előnézet továbbra is kézzel szerkeszthető.
