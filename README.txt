FUVAR­SZERVEZŐ V45 – ONLINE SUPABASE / GITHUB PAGES
=================================================

A V45 a korábbi stabil fuvarszervezőre épül, de a belépés és a közös adatok
Supabase-en keresztül működnek.

V45 fő változások
-----------------
- Supabase e-mail + jelszó hitelesítés.
- Admin e-mail: szabo.sandor82@gmail.com.
- A jelszavak NINCSENEK a nyilvános JavaScript fájlokba írva.
- A Project URL és a publishable key már ki van töltve az online-config.js fájlban.
- A fuvarok, hátralékok és fuvarátadások közös online adatbázisból működnek.
- A szállítólevél-fotók a rendeléshez kapcsolódnak és a Supabase Storage-ba kerülnek.
- A rendeléshez mentett fotók a „Mentett fotók” gombbal visszanézhetők.
- Nincs szállítólevél e-mail-küldő funkció.
- Új PWA gyorsítótárnév: fuvarszervezo-v45-online-20260805-1.

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
- A V45 nem hoz létre új fiókot és nem küld regisztrációs e-mailt.
- Az admin belépéshez a Supabase-ben a szabo.sandor82@gmail.com fiók jelszavának
  meg kell egyeznie azzal a jelszóval, amit a belépőképernyőn megadsz.

Fotók
-----
- A kamera/fájlválasztóval mentett szállítólevél a delivery-docs bucketbe kerül.
- A delivery_reports és delivery_report_files táblák őrzik a rendeléshez való kapcsolatot.
- A Storage bucket privát; a V45 rövid ideig érvényes aláírt URL-lel jeleníti meg a fotókat.

Biztonság
---------
- A publishable key kliensoldali használatra való, ezért benne lehet a GitHub Pages alkalmazásban.
- service_role / secret kulcsot soha ne tegyél a repositoryba.
- A jogosultságokat a Supabase RLS szabályai korlátozzák.

Részletes Supabase ellenőrzőlista: ONLINE_BEALLITAS.md
