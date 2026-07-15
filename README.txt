FUVAR-SZERVEZŐ V13 – GITHUB PAGES

ÚJ FUNKCIÓK
- Letölthető és tömegesen visszatölthető Excel-sablon:
  Projektek, Beszállítók, Átvevők, Autók.
- Az Autók a Törzsadatok között is elérhetők.
- Sofőrnév, járműnév, rendszám, kategória, indulási település és aktív állapot szerkeszthető.
- A rendszám nem kötelező, hiánya nem okoz hibát.
- Jármű törölhető, ha nincs hozzá rendelt fuvar.
- A projekt- és beszállítónevek a rendelkezésre álló SERPA táblák alapján egységesítve lettek.
  Csak a neveket módosítja; címeket, telefonszámokat, átvevőket nem ír felül.
- Új SERPA importnál a program a Témaszám név és Ügyfél/raktár nevek alapján automatikusan
  frissíti a törzsadat-neveket, a többi adat megtartásával.
- A felrakó neve nagyobb, hangsúlyosabb betűmérettel látszik a fuvarbuborékban.
- Felrakó kiválasztásakor alapból a központi telephely címét írja be, kézzel felülírható.
- Kimutatások menüpont:
  napi autónként, havi autónként, projektenként.
- Kimutatások Excel, PDF és Word formátumban exportálhatók
  „Stand 98 - ... fuvar kimutatás” fejléccel.
- Hátralék menüpont:
  a nem kipipált tételek projekt és beszállító szerint jelennek meg;
  későbbi átvételkor automatikusan csökkennek vagy eltűnnek.
- Univerzális kereső:
  fuvarok, projektek, beszállítók és átvevők között.
  PC-n Ctrl+K vagy Cmd+K.
- A 16:00 után átvitt fuvarok közül csak az első kiadási napon nem teljesült fuvar
  kerül a vezetői nem teljesített statisztikába.
- Útvonal-optimalizálás után a becsült kilométerek bekerülnek a kimutatásokba.

GITHUB FELTÖLTÉS
A ZIP minden fájlját közvetlenül a repository gyökerébe töltsd:
index.html, styles.css, app.js, data.js, manifest.webmanifest, sw.js,
icon-192.png, icon-512.png, README.txt.

FONTOS
A GitHub Pages verzió egy eszköz böngészőjében tárolja az adatokat.
A valódi admin/sofőr jogosultság, automatikus telefonos szinkron és az előző napi
teljesített fuvarok szerveroldali zárolása a végleges többfelhasználós változatban készül el.
A mobilalkalmazás a webes rendszer véglegesítése után következik.
