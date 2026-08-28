FUVAR­SZERVEZŐ V51 – ONLINE SUPABASE / GITHUB PAGES
=================================================

A V51 a V50 teljes fuvarszervezési, munkanap-, mobil- és online működését
megtartja. A belépéshez sem az admin-, sem a sofőr-/tesztfelületen nem kell
jelszót megadni.

V51 fő változások
-----------------
- A belépőképernyőn csak az engedélyezett e-mail-címet kell megadni.
- A rendszer egyszer használható belépési linket küld a megadott e-mail-címre.
- A link megnyitása után a Supabase ugyanúgy hitelesített munkamenetet hoz létre,
  ezért a meglévő adatbázis- és Storage-jogosultságok változatlanul működnek.
- A sofőrnézetből kikerült a jelszómódosító gomb.
- Az admin, sofőr és teszt szerepkörök, valamint a korábbi hozzáférési korlátok
  változatlanok.
- A péntek utáni mobil napfül hétfőre lép; hétvége nem lesz normál fuvarnap.
- Az alkalmazás, a PWA-manifest, a szétosztómotor és a gyorsítótár V51-re frissült.

Megmaradó jogosultságok
----------------------
- Admin: a teljes adminfelületet látja és használja.
- Sofőr: csak a saját mai és következő munkanapi fuvarbuborékait látja.
- Tesztfelhasználó: minden sofőr mai és következő munkanapi buborékait látja.
- Sofőr és teszt: fuvaradatot, sofőrt, sorrendet és törzsadatot nem szerkeszthet.
- Sofőr és teszt: tételpipálás, tételmegjegyzés, tételszintű hátralék,
  fuvarátadás és szállítólevél-fotó továbbra is használható.

Belépés
-------
1. Add meg az engedélyezett e-mail-címet.
2. Nyomd meg a „Belépési link kérése” gombot.
3. Nyisd meg az érkező e-mailt ugyanazon az eszközön.
4. Kattints a levélben található linkre; az alkalmazás automatikusan beléptet.

A V51 nem hoz létre új fiókot. Csak a Supabase Authentication alatt már
meglévő és az allowed_users táblában aktívként szereplő e-mail-címek használhatók.

Telepítés GitHub Pages-re
------------------------
1. Olvasd el az ONLINE_BEALLITAS.md fájlt.
2. A ZIP teljes tartalmát töltsd fel a fuvarszervezo repository gyökérkönyvtárába.
3. A korábbi fájlokat írd felül; az index.html közvetlenül a gyökérben legyen.
4. Várd meg a GitHub Pages frissítését.
5. Gépen nyomj Ctrl+F5-öt. Telefonon zárd be teljesen az alkalmazást, majd nyisd meg újra.

Biztonság
---------
- A belépési link rövid ideig használható, és a felhasználó e-mail-fiókjához kötött.
- A publishable key kliensoldali használatra készült, ezért szerepelhet a GitHub Pages csomagban.
- service_role vagy secret kulcsot soha ne tölts fel GitHubra.
- A hozzáféréseket továbbra is a Supabase Auth és az RLS szabályok korlátozzák.

Kiadási ellenőrzések
--------------------
- TEST_V51.js: V51 verzió, belépési felület, linkes hitelesítés és munkanap-kezelés.
- TEST_V49.js: szétosztás és optimalizálás regressziós ellenőrzése.
- TEST_V41_MSG.js: Outlook/MSG import regressziós ellenőrzése.
- TEST_V44.js: fuvarblokkos szétosztási regressziós ellenőrzés.

