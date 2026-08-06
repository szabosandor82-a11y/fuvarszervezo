FUVAR­SZERVEZŐ V47 – ONLINE SUPABASE / GITHUB PAGES
=================================================

A V47 a korábbi stabil fuvarszervezőre épül, a belépés és a közös adatok
Supabase-en keresztül működnek.

V47 fő változások
-----------------
- Supabase e-mail + jelszó hitelesítés.
- Admin e-mail: szabo.sandor82@gmail.com.
- Mobil teszt e-mail: szabo.sandor@stand98.hu.
- A jelszavak NINCSENEK a nyilvános JavaScript fájlokba írva.
- A Project URL és a publishable key már ki van töltve az online-config.js fájlban.
- A fuvarok, hátralékok és fuvarátadások közös online adatbázisból működnek.
- A törzsadatok admin módosításai a Supabase master_data táblájába is menthetők.
- Új cím/átvevő a módosítás napjától előre tanulódik; a korábbi napok nem változnak.
- Az átvevő telefonszáma/e-mailje a törzsadatból automatikusan kitöltődik.
- Több telephelyes beszállítónál (pl. Szatmári) csak az adott beszállító címei választhatók,
  de új cím kézzel is felvehető anélkül, hogy a többi telephely felülíródna.
- Az Outlook-előnézet ürítése nem törli a már jóváhagyott fuvarokat.
- A kézzel másik sofőrhöz húzott buborék nem válik automatikusan rögzített fuvarrá.
- A Dobozos felrakók számtól függetlenül a lehető legegyenletesebben oszlanak el.
- Pest/Buda területi besorolása preferencia, nem merev rögzítés.
- Martin elsősorban a felismert szálas/platós fuvarokat kapja. Ha az adott napon nincs ilyen,
  Martin is részt vesz a Dobozos fuvarok egyenletes kiosztásában.
- Azonos fizikai felrakóhely rendelései továbbra is együtt, egy sofőrnél maradnak.
- Ugyanazon beszállító összes aznapi rendelése egy sofőrhöz kerül; a szétosztás nem szakíthatja ketté.
- Kézi húzásnál az egész aznapi beszállítói blokk egyszerre vált sofőrt, és egy sofőrön belüli
  sorrendmódosításnál is együtt mozog.
- Lassított buborék-húzás közbeni automatikus görgetés.
- Asztali nézetben a térképek fixen látszanak, csak a buboréklisták görgethetők;
  a fuvarszervezési műveletek a bal oldali menübe kerültek.
- A buborékszerkesztő bezáró gombja görgetés közben is látható.
- Pasztell felületi színvilág.
- A szétosztás/optimalizálás aktív algoritmusjelölése: V47.
- A szállítólevél-fotók a rendeléshez kapcsolódnak és a Supabase Storage-ba kerülnek.
- A rendeléshez mentett fotók a „Mentett fotók” gombbal visszanézhetők.
- A „Mentett fotók” gomb a csoportosított Fuvarok-buborékokon és a Rendelések listában is elérhető.
- Több rendelést tartalmazó buboréknál a galéria a csoport összes rendelésének fotóit megmutatja.
- Nincs szállítólevél e-mail-küldő funkció.
- Új PWA gyorsítótárnév: fuvarszervezo-v47-online-20260806-4.

Telepítés GitHub Pages-re
------------------------
1. Olvasd el az ONLINE_BEALLITAS.md fájlt, és ellenőrizd a két még szükséges Supabase-lépést.
2. A ZIP teljes tartalmát töltsd fel a fuvarszervezo repository gyökérkönyvtárába.
3. A korábbi fájlokat írd felül; az index.html közvetlenül a gyökérben legyen.
4. Várd meg a GitHub Pages frissítését.
5. Gépen nyomj Ctrl+F5-öt. Telefonon zárd be teljesen az oldalt, majd nyisd meg újra.

Belépés
-------
- A belépőképernyő a Supabase Authentication → Users alatt létrehozott fiókokat használja.
- A V47 nem hoz létre új fiókot és nem küld regisztrációs e-mailt.
- Az admin belépéshez a Supabase-ben a szabo.sandor82@gmail.com fiók jelszavának
  meg kell egyeznie azzal a jelszóval, amit a belépőképernyőn megadsz.

Fotók
-----
- A kamera/fájlválasztóval mentett szállítólevél a delivery-docs bucketbe kerül.
- A delivery_reports és delivery_report_files táblák őrzik a rendeléshez való kapcsolatot.
- A Storage bucket privát; a V47 rövid ideig érvényes aláírt URL-lel jeleníti meg a fotókat.

Biztonság
---------
- A publishable key kliensoldali használatra való, ezért benne lehet a GitHub Pages alkalmazásban.
- service_role / secret kulcsot soha ne tegyél a repositoryba.
- A jogosultságokat a Supabase RLS szabályai korlátozzák.

Részletes Supabase ellenőrzőlista: ONLINE_BEALLITAS.md
