FUVAR-SZERVEZŐ V27 – GITHUB PAGES VERZIÓ

V21 javítások:
- A fejléc, manifest és gyorsítótár verziója V21.
- A manuális fuvar dátuma külön ÉÉÉÉ–HH–NN mezőkkel adható meg. Az év pontosan 4 karakter, majd a kurzor a hónapra, onnan a napra ugrik.
- A manuális fuvar a megadott szállítási napra kerül.
- Egyedi úticélnál az átvevő neve kézzel megadható és később módosítható.
- A fejléc keresője minden dátumban, minden fuvarmezőben és a tételadatokban is részszóra keres.
- A kézzel felvitt, járműhöz rendelt fuvarok egyedi címei is megjelennek a térképen.
- A fuvar megjegyzése megjelenik a buborékban, a térképes jelölőnél, a sofőr nézetben és az exportban.
- A SERPA Tétel megjegyzés megjelenik a Tételek nézetben és az Excel exportban.


V21: kereshető projekt/felrakó, egységes dátumbevitel, egyedi úticél, tételmegjegyzések, aktív napi törlés, keresési találat megnyitása és kiemelése.


V21 újdonságok: sofőrönkénti export, holnapi kezdőoldal, X kereséstörlés, rögzített párbeszédablak-fejléc, javított tételpipák, tételek dátum szerinti áthelyezése és Hátralék menü.


V21 újdonságok: térkép újraszámítás címváltozáskor; részleges hiánymennyiség; Hátralék mennyiség oszlop; holnapi kezdőoldal a fejlécből; meghiúsult fuvar áthelyezése; havi Kimutatás.


V21 újdonságok: minden nap teljes fuvaradatának külön, kétszintű törlése; nagyobb hiánymennyiség mező; dátumhoz kötött tételáthelyezés; a Hátralék menüben szerkeszthető dátum és a hozzá tartozó fuvarbuborék áthelyezése.

V27 újdonságok
- Törzsadatok Excel exportja és visszaimportja (Projektek, Beszállítók, Átvevők, Autók munkalapok).
- Beszállítói importnál azonos cégnév alapján a cím frissül, nem jön létre felesleges duplikáció.
- SERPA importnál a SERPA cégnév változatlan marad; a program csak a pontosan egyező beszállítói törzsadat címét rendeli hozzá.
- A beszállítói törzs címe használható felrakóként, és pontos cégnévegyezés esetén lerakóként is.


V27: projekt- és beszállítói törzs alapján visszamenőleges címszinkron, több telephelyes beszállítók, felrakó+lerakó térkép és optimalizálás, lerakó kimutatás, lakóhely-alapú napi km.


V27 fő változások:
- Martin elsőként kapja a szálanyagos rendeléseket.
- A maradék rendeléseket Márió és Patrik kapja, páratlan darabszámnál Márió kap eggyel többet.
- Márió pesti, Patrik budai területi preferenciával kapja a fuvarokat.
- Javított felrakó–lerakó útvonal-optimalizálás.
- A térképen csak a felrakói markerek látszanak; a lerakók az útvonal számításában továbbra is szerepelnek.
- Sofőrönként külön, színes Lerakók összesítő buborék jelenik meg a fuvarbuborékok alatt.

V27 KIEMELT VÁLTOZÁSOK
- SERPA import után a jármű nélküli fuvarok kiosztatlanok maradnak; nem kerülnek automatikusan Márióhoz.
- A Fuvar szétosztása gomb a teljes kiválasztott napot újraszámolja mindhárom sofőr között.
- Martin elsőként kapja a 4–6 méteres szálanyagot, de kevés vagy nulla szálanyag esetén normál fuvarokat is kap igazságosan.
- Martin enyhe területi preferenciája kizárólag Buda és Dél-Pest, csak közel azonos kilométerű megoldásoknál.
- Az elosztás figyeli a felrakó- és lerakócímeket, távolságokat, útvonalba illeszthetőséget, felrakó/lerakó/rendelésszámot és az azonos projektek összevonását.
- Sikeres szétosztás és optimalizálás után OK-val bezárható visszajelzés jelenik meg.


V27 KIEMELT VÁLTOZÁSOK
- Szabályalapú, nem pontozásos fuvarszervezés.
- Beszállítói felrakási blokkok: egy sofőr ugyanahhoz a beszállítóhoz lehetőleg egyszer megy.
- Egy beszállítónál az összes hozzá rendelt aznapi rendelést felveszi.
- Útba eső projekt csak akkor kerül lerakásra, amikor az összes oda tartozó, adott sofőrhöz rendelt aznapi rendelés már az autón van.
- A térkép a tényleges felrakási és lerakási eseménysorrendet követi, lerakó marker nélkül.
- A Lerakók buborék az útvonal szerinti sorrendet és a rendelési számokat mutatja.
