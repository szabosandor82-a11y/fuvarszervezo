Fuvarszervező V33 – GitHub Pages

FŐ MUNKAFOLYAMAT
1. SERPA import
2. Fuvar szétosztása
3. Útvonal optimalizálása

A „Fuvar szétosztása” csak sofőrt választ.
Az „Útvonal optimalizálása” csak a már kiosztott fuvarok sorrendjét rendezi, sofőrt nem változtat.

V33 ÚJDONSÁGOK

1. Rögzítő zászló
- Minden csoportosított fuvarbuborékon van zászló ikon.
- A buborék kézzel a kívánt helyre húzható, majd rögzíthető.
- Optimalizáláskor a rögzített buborék ugyanannál a sofőrnél és ugyanazon a helyen marad.
- A többi buborék a rögzített pontok körül optimalizálódik.
- A zászló újbóli megnyomásával a rögzítés feloldható.

2. Teljes autós rakomány
- Minden buborékon külön teherautó gomb található.
- Bekapcsoláskor a felrakóbuborék alatt azonnal megjelenik a kötelező lerakóbuborék.
- A felrakó és a lerakó megszakíthatatlan pár.
- A sofőr a lerakás előtt nem vehet fel újabb anyagot.

3. Buborékok csoportosítása
- Azonos felrakó és azonos lerakó esetén csak egy buborék jelenik meg.
- A buborék alatt az összes rendelési szám látható.
- A háttérben a rendelések és a tételek külön maradnak.
- A Tételek ablak a csoport rendelésszámait külön szakaszokban mutatja, a korábbi pipálási, hiány- és megjegyzésfunkciókkal.

4. Buborék tartalma
A főoldali sorrend:
- Felrakó
- Lerakó
- Rendelésszám(ok)

A tételmegjegyzések nem látszanak a főoldalon, csak a Tételek nézetben.

5. SERPA import utáni előbesorolás
Az elsődleges szabály a felrakó földrajzi oldala:
- Buda: elsősorban Patrik
- Pest: elsősorban Márió
- Hosszú/szálas anyag: Martin
- Központi raktár és semleges felrakók: súlyozott terheléskiegyenlítés

Ha Patrik budai terhelése nagyon nagy, Martin budai fuvarokkal besegíthet, de csak akkor, ha nincs sok hosszú/szálas anyaga.
A terhelés súlyozott: egy teljes autós vagy szálas fuvar többet számít, mint egy egyszerű rendelés.

6. Lerakók összesítése
- A főoldal aljáról az állandó lerakó-összesítés kikerült.
- Minden sofőr fejlécében külön „Lerakók” gomb van.
- A gomb megnyomására felugró ablakban jelenik meg a lerakási sorrend.

7. Térkép
- A térkép kizárólag felrakókat mutat.
- A lerakók nem kapnak markert.
- A lerakók nem kerülnek bele a térképi útvonalvonalba.
- Azonos felrakó csak egyszer jelenik meg.

TESZTELÉS
A TEST_V33.js nyolc automatikus szabálytesztet tartalmaz. A futtatott eredmények a TESZTEREDMENY_V33.txt fájlban találhatók.

FELTÖLTÉS
A ZIP teljes tartalmát töltsd fel a GitHub Pages tárhely gyökerébe, a korábbi fájlok felülírásával.
Feltöltés után egyszer Ctrl+F5 szükséges. Telefonon az oldal teljes bezárása és újbóli megnyitása javasolt.
