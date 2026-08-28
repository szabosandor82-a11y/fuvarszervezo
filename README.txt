FUVAR­SZERVEZŐ V52 – ONLINE SUPABASE / GITHUB PAGES
=================================================

A V52 a V51 teljes fuvarszervezési, munkanap-, mobil- és online működését
megtartja, a belépést pedig e-mail–jelszó hitelesítésre állítja át.

V52 fő változások
-----------------
- Az admin, a három sofőr és a tesztfelhasználó e-mail-címmel és jelszóval lép be.
- Nincs napi belépési e-mail és nincs Magic Link-függőség.
- A jelszavakat kizárólag a Supabase Authentication tárolja.
- A GitHub Pages-csomag és a nyilvános JavaScript egyetlen felhasználói jelszót sem tartalmaz.
- A V51 régi munkamenete nem kerül át: a V52 első megnyitásakor újra be kell jelentkezni.
- Az admin, sofőr és teszt szerepkörök, valamint a korábbi hozzáférési korlátok változatlanok.
- A péntek utáni mobil napfül hétfőre lép; hétvége nem lesz normál fuvarnap.
- Az alkalmazás, a PWA-manifest, a szétosztómotor és a gyorsítótár V52-re frissült.

Megmaradó jogosultságok
----------------------
- Admin: a teljes adminfelületet látja és használja.
- Sofőr: csak a saját mai és következő munkanapi fuvarbuborékait látja.
- Tesztfelhasználó: minden sofőr mai és következő munkanapi buborékait látja.
- Sofőr és teszt: fuvaradatot, sofőrt, sorrendet és törzsadatot nem szerkeszthet.
- Sofőr és teszt: tételpipálás, tételmegjegyzés, tételszintű hátralék,
  fuvarátadás és szállítólevél-fotó továbbra is használható.

Jelszavak beállítása a Supabase-ben
----------------------------------
Meglévő felhasználó:
1. Supabase Dashboard → Fuvarszervező projekt → Authentication → Users.
2. A felhasználó sorának jobb oldali hárompontos menüje.
3. Send password recovery.
4. A felhasználó az egyszeri e-mailben kapott linken állítja be a jelszavát.

Új felhasználó:
1. Authentication → Users → Add user → Create new user.
2. Add meg az e-mail-címet és a jelszót.
3. Az e-mail-cím az allowed_users táblában is szerepeljen a megfelelő szerepkörrel.

Jelszót ne írj az online-config.js, az auth-v44-2.js, a README vagy más GitHubra
feltöltött fájlba. A jelszó nem azonos a Supabase-fiókod, illetve az adatbázis
postgres felhasználójának jelszavával.

Belépés
-------
1. Add meg az engedélyezett e-mail-címet.
2. Add meg az e-mailhez a Supabase Authentication alatt beállított jelszót.
3. Nyomd meg a „Belépés” gombot.

Csak a Supabase Authentication alatt létező és az allowed_users táblában aktívként
szereplő e-mail-címek használhatók.

Telepítés GitHub Pages-re
------------------------
1. Olvasd el az ONLINE_BEALLITAS.md fájlt.
2. A ZIP teljes tartalmát töltsd fel a fuvarszervezo repository gyökérkönyvtárába.
3. A korábbi fájlokat írd felül; az index.html közvetlenül a gyökérben legyen.
4. Várd meg a GitHub Pages frissítését.
5. Gépen nyomj Ctrl+F5-öt. Telefonon zárd be teljesen az alkalmazást, majd nyisd meg újra.

Biztonság
---------
- A publishable key kliensoldali használatra készült, ezért szerepelhet a GitHub Pages csomagban.
- service_role vagy secret kulcsot és felhasználói jelszót soha ne tölts fel GitHubra.
- A hozzáféréseket továbbra is a Supabase Auth és az RLS szabályok korlátozzák.
- A Supabase-ben legalább 8 karakteres, egyedi jelszó használata ajánlott.

Kiadási ellenőrzések
--------------------
- TEST_V52.js: V52 verzió, jelszavas belépési felület és munkanap-kezelés.
- TEST_V52_LOGIN.js: Supabase e-mail–jelszó belépés és munkamenet egységtesztje.
- TEST_V49.js: szétosztás és optimalizálás regressziós ellenőrzése.
- TEST_V41_MSG.js: Outlook/MSG import regressziós ellenőrzése.
- TEST_V44.js: fuvarblokkos szétosztási regressziós ellenőrzés.
