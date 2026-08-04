Fuvarszervező V43 – GitHub Pages csomag
======================================

Telepítés
---------
1. A ZIP teljes tartalmát másold a GitHub Pages tároló gyökérkönyvtárába.
2. A korábbi fájlokat cseréld le; az index.html közvetlenül a gyökérben legyen.
3. Várd meg a GitHub Pages frissítését, majd használj Ctrl+F5-öt.
4. Telefonon zárd be teljesen az oldalt, majd nyisd meg újra.
5. A V43 új gyorsítótár-nevet használ, ezért a korábbi V41 fájlok nem maradnak aktívak.

V43 fuvarszétosztás
-------------------
- Az Autó mezőben Márió, Patrik vagy Martin névre rögzített fuvar automatikusan nem mozgatható.
- Ezeket kizárólag a felhasználó helyezheti át kézzel.
- Az automatikus szétosztás csak a Dobozos és a még be nem sorolt fuvarokat mozgathatja.
- Márió elsődlegesen a pesti oldalt kapja.
- Patrik elsődlegesen a budai oldalt kapja.
- Budai Dobozos fuvar nem kerül Márióhoz, ha Patrik aktív.
- Pesti Dobozos fuvar nem kerül Patrikhoz, ha Márió aktív.
- Martin kapja a platós/szálas anyagokat, és alulterheléskor Dobozos felrakóblokkokkal besegít.
- Az igazságosságot elsősorban az egyedi felrakási címek száma alapján számolja.
- Ha például Martin 4, a másik két sofőr 8–8 címen áll, mozgatható Dobozos címekből Martin is kap, amíg a különbség jellemzően legfeljebb 1–2 cím.
- Az optimalizálás továbbra is csak a sorrendet módosítja, sofőrt nem.

Indulási irányok
----------------
- Márió: Vác felől indul.
- Martin: Felcsút felől indul.
- Patrik: a szigetszentmiklósi központi raktárból indul.
- A kézzel megadott pontos lakhelycím Máriónál és Martinnál elsőbbséget élvez.

Törzsadat- és címjavítás
-----------------------
- A V43 a friss beépített törzsadatokat összevonja a böngészőben már meglévő adatokkal.
- Kézzel szerkesztett, meglévő címeket nem töröl ki.
- A címellenőrzés figyelembe veszi a szerepköröket:
  - normál SR0: beszállító → projekt;
  - KRPR: központi raktár → projekt/célraktár;
  - PRPR: forrásraktár → célraktár;
  - visszáru: projekt → beszállító.
- Ha egy helyes cím már szerepel a fuvarban, sikertelen névegyezés miatt nem kap téves „hiányzó cím” figyelmeztetést.
- Beépített külön felrakóhelyek:
  - Szatmári Késmárk: 1158 Budapest, Késmárk utca 9.
  - Merkapt Maglódi: 1106 Budapest, Maglódi út 14/B
  - Sebők Törökbálint: 2045 Törökbálint, Kinizsi utca 28.
  - Szerelvénybolt: 1182 Budapest, Üllői út 807/B

Outlook-import
--------------
- Két külön tömeges import: Dobozos és Martin / Platós.
- A levél tárgya, teljes szövege és a csatolt PDF-ek együtt kerülnek feldolgozásra.
- Csak a „Szállítói rendelés” vagy raktárközi bizonylat számít elsődleges mellékletnek.
- A beszállítói visszaigazolás nem hoz létre második fuvart.
- Több valódi SR0 egy levélben külön rendelésként kerül be.
- Minden külön importkártyán látszik a levélben szereplő összes SR0 rendelésszám, miközben az aktuális rendelés külön marad.
- A rendelési azonosítóból csak a / utáni rész kerül be.
- Korábban importált rendelés újra behúzható; az új változat frissíti a korábbi Outlook-importot.
- A „Minden import törlése” az előnézetet és a korábban jóváhagyott, rejtett Outlook-importokat is törli.

Hátralék
--------
- Csak az átütemezett tétel kerül az új napra és a Hátralékok fülre.
- A „Megkaptuk” jelölés után csak az adott tétel kerül ki a Hátralékok közül.

Térkép
------
- A térképen csak a felrakók szerepelnek.
- Normál lerakó nem kerül a térképre vagy a felrakási útvonalvonalba.
- Teljes autós rakománynál a kötelező lerakás a listában közvetlenül a felrakás után marad.

Tesztelés
---------
A csomag JavaScript-fájljai szintaktikailag ellenőrizve lettek.
Automatikus tesztek: 71/71 sikeres.

A tesztek között szerepel:
- Márió/Pest és Patrik/Buda területi kiosztás;
- Martin 4–8–8 terhelési helyzetének kiegyenlítése;
- névre rögzített fuvarok változatlanul hagyása;
- Vác/Felcsút/központi indulási pontok;
- City Pearl, Kincsem K6, Le Jardin, Cosmo, KRPR és Kekelit-visszáru MSG-k;
- több SR0 és beszállítói visszaigazolás együttes kezelése;
- KRPR/PRPR és szerepkör-alapú címkitöltés;
- tételszintű hátralékkezelés.

Technikai megjegyzés
--------------------
- Az MSG-olvasó helyi fájl, nem külső CDN-ről töltődik.
- A PDF-, térkép- és Excel-könyvtárakhoz internetkapcsolat szükséges.
- Szokatlan levélformátumnál az import-előnézet továbbra is kézzel szerkeszthető.
