Fuvarszervező V41 – GitHub Pages csomag
======================================

Telepítés
---------
1. A ZIP teljes tartalmát másold a GitHub Pages tároló gyökérkönyvtárába.
2. A korábbi fájlokat cseréld le, az index.html közvetlenül a gyökérben legyen.
3. A feltöltés után várd meg a Pages frissítését, majd használj Ctrl+F5-öt.
4. Telefonon zárd be teljesen az oldalt, majd nyisd meg újra.

V41 Outlook-import
------------------
- Két külön, több MSG-fájlt fogadó terület van:
  - Dobozos import
  - Martin / Platós import
- A behúzott rendelések a megfelelő terület alatt, egymás után jelennek meg.
- A helyi ole-msg-reader.js olvassa az Outlook MSG tárgyát, levélszövegét és mellékleteit.
- A feldolgozás böngészőben történik, OpenAI API és feldolgozási díj nélkül.
- A „Jóváhagyott rendelések importálása” alapértelmezetten a következő napra teszi a fuvarokat.
- A Dobozos rendelések szétoszthatók, a Martin / Platós rendelések fixen Martinhoz kerülnek.
- Egy korábban importált rendelés újra behúzható; az új Outlook-import frissíti a korábbi Outlook-példányt.

Mellékletek és több rendelés
----------------------------
- Csak a „Szállítói rendelés” fejlécű PDF számít normál elsődleges rendelésnek.
- A beszállítói rendelés-visszaigazolás nem hoz létre második fuvart.
- A „Raktárközi” fejlécű KRPR/PRPR bizonylat elsődleges dokumentumként feldolgozható.
- Ha egy levélben több külön SR0 szállítói rendelés van, mindegyik külön importkártyát és külön rendelést kap.
- Ugyanannak a rendelésnek a visszaigazolása vagy ismételt melléklete nem duplikálja a fuvart.

Cím- és irányszabályok
----------------------
- SR0: a PDF „Projekt név” mezőjének értékét keresi meg a projekttörzsben, és annak címét használja lerakóként.
- Az SR0 lerakó neve és címe az import-előnézetben utólag szerkeszthető.
- KRPR: a felrakó mindig a Szigetszentmiklósi Központi Raktár:
  2310 Szigetszentmiklós, Kereskedő utca 2.
- KRPR: ha a célraktár/projekt címe nincs a PDF-ben, a program a projekttörzsből tölti ki.
- PRPR: a forrásraktár a felrakó, a célraktár a lerakó; a címek a törzsadatokból is pótolhatók.
- Visszáru: a levél szövege alapján a projekt lesz a felrakó, a beszállító/üzlet a lerakó.
- A Cosmo–Szatmári Késmárk visszáru iránya: Cosmo → Szatmári Késmárk.
- A PDF vevői vagy aláírási címe, például a Láva utca 7., nem írja felül a projekt lerakási címét.
- Szerelvénybolt helyes címe: 1182 Budapest, Üllői út 807/B.
- A térképen kizárólag a felrakók jelennek meg.

Törlés
------
- A „Minden import törlése” törli mindkét előnézeti listát.
- Törli a korábban jóváhagyott Outlook-importokat is, amelyek már nem látszanak az előnézetben, de az autóknál még szerepelnek.
- A kézzel vagy Excelből felvitt rendelések nem törlődnek.
- A kapcsolódó Outlook-hátralék és elavult útvonalterv is kitakarításra kerül.

Hátralék
--------
- Csak az átütemezett tétel kerül az új napra és a Hátralékok fülre.
- A „Megkaptuk” jelölés után az adott tétel automatikusan kikerül a Hátralékok közül.

Ellenőrzött minták
------------------
- Larex / M76 / 003141
- Szatmári Késmárk / Kincsem K6 / 004911
- Gali SwimTex / City Pearl II / 004932
- Sebők / Le Jardin / 004943
- Merkapt / Cosmo / 004937
- KRPR Központi raktár → Le Jardin / 000745
- Kekelit visszáru: Cosmo → Szatmári Késmárk / 002226, 001998, 001832

Technikai megjegyzés
--------------------
- Az MSG-olvasó helyi fájl, nem külső CDN-ről töltődik.
- A PDF-, térkép- és Excel-könyvtárak az index.html-ben megadott CDN-ekről töltődnek, ezért ezekhez internetkapcsolat szükséges.
- Szokatlan levélformátumnál az import-előnézetben kézi javításra lehet szükség; a program nem talál ki hiányzó címet.
