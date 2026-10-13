FUVARSZERVEZŐ V131

FRISSÍTÉS
1. Készíts biztonsági másolatot a jelenlegi GitHub Pages fájlokról.
2. Bontsd ki a Fuvarszervezo_V131_Mobile_PWA_GitHub_Pages.zip fájlt.
3. A csomag gyökérkönyvtárának tartalmát másold a meglévő alkalmazás
   gyökérkönyvtárába a korábbi azonos nevű fájlok felülírásával.
   Az index.html közvetlenül az alkalmazás gyökerében legyen.
4. Várd meg a GitHub Pages közzétételét, majd nyisd újra az alkalmazást.
   Ha régi verzió jelenik meg, laptopon Ctrl+F5, telefonon az alkalmazás
   teljes bezárása és újranyitása frissíti a gyorsítótárat.

VÁLTOZÁSOK
- A havi naptár teljes hónapja egy képernyőn látszik, görgetés nélkül.
- A nap megnyitásakor a fuvarok és a hozzájuk tartozó megjegyzések láthatók.
- Új szállítólevelek is azonnal archiválásra jelölhetők.
- Az archív ZIP fájljai közvetlenül a ZIP gyökerébe kerülnek, almappák nélkül.
- A fájlnév a rendelésszámot és a feltöltés dátumát tartalmazza, például
  6786_20261012.jpeg. Névütközésnél sorszámot kap, hogy ne vesszen el fájl.
- Törölni csak már archivált, legalább két napos fájlokat lehet, külön
  megerősítéssel.
- A sofőr korábbi fuvarjainak SQL-szabálya valódi DATE típusú összehasonlítást
  használ.

A változtatások részletei: VALTOZASOK_V131.txt.
A helyi ellenőrzések eredménye: ELLENORZES_V131.txt.

SUPABASE
Ha a sofőr korábbi fuvarjainak visszanézése már működik, a SQL-fájlt nem kell
újra futtatni. Új telepítésnél vagy jogosultsági hiba esetén a teljes
SUPABASE_VISSZANEZES.sql fájlt másold a Supabase SQL Editorba és futtasd.
A schedule_date DATE mező; a dátumot dátummal hasonlítjuk, például:

  schedule_date < current_date

Ne alakítsd szöveggé a current_date értékét.

ARCHIVÁLÁS
A Beállítások lapon az „Összesítés frissítése” gomb lekéri az aktuális
szállítólevél-listát. Az „Archiválás” ZIP-et készít, de nem töröl. A ZIP-ben
a fájlnevek formája: rendelésszám_feltöltésidátum.kiterjesztés. Az azonos
rendeléshez és naphoz tartozó azonos kiterjesztésű fájlok végére _2, _3 stb.
kerül. A tartalomjegyzék a generált és az eredeti fájlnevet is tartalmazza.
A ZIP ellenőrzése után az „Archiváltak törlése” gombbal, a kért fájlszám
beírásával törölhetők a legalább két napos fájlok.


A V131-ben a fuvarszétosztás és az optimalizálás kizárólag a képernyőn megnyitott napot módosítja. A mentés is csak ennek a napnak a fuvarjait küldi fel, a korábbi és későbbi napokhoz nem nyúl.

A V128-ban a sofőr által átmozgatott fuvarok és hátralékok céldátuma az admin és a sofőr buborékjában is megjelenik. A funkció a V131-ben is megmaradt; részletek: VALTOZASOK_V128.txt.

SZÁLLÍTÓLEVÉL ÉS TELJESÍTÉS
A feltöltés csak azután jelez sikert, hogy a fájlok és a fuvar buborékadatai is
elmentődtek. Ha a fájlok feltöltődtek, de a fuvaradat mentése hálózati hiba miatt
nem sikerült, a felület újrapróbálást kínál. Ilyenkor ne töltsd fel újra a
fájlokat; az újrapróbálás csak a fuvar adatát menti.
A sofőr zöld pipája közvetlen online mentést kap. Admin mentés előtt a program
frissen beolvassa és megőrzi a sofőr közben elmentett szállítóleveleit,
átvételeit, hiányjelzéseit, megjegyzéseit és teljesítési állapotát.


EXCEL EXPORT
Az Excel-export a képernyőn megnyitott naptól kezdve minden későbbi ütemezett
fuvar sort tartalmaz. A korábbi napok kimaradnak. A dátumoszlop minden sornál
a fuvar saját ütemezett napját mutatja. A táblázat utolsó, „Cég” oszlopa a
Stand 98 vagy a Stand Future értéket írja ki.
