FUVARSZERVEZŐ V122

FRISSÍTÉS
1. Készíts biztonsági másolatot a jelenlegi GitHub Pages fájlokról.
2. Bontsd ki a Fuvarszervezo_V122_Mobile_PWA_GitHub_Pages.zip fájlt.
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
- Törölni csak már archivált, legalább két napos fájlokat lehet, külön
  megerősítéssel.
- A sofőr korábbi fuvarjainak SQL-szabálya valódi DATE típusú összehasonlítást
  használ.

A változtatások részletei: VALTOZASOK_V122.txt.
A helyi ellenőrzések eredménye: ELLENORZES_V122.txt.

SUPABASE
Ha a sofőr korábbi fuvarjainak visszanézése már működik, ezt a SQL-fájlt nem
kell újra futtatni. Új telepítésnél vagy jogosultsági hiba esetén a teljes
SUPABASE_VISSZANEZES.sql fájlt másold a Supabase SQL Editorba és futtasd.
A schedule_date DATE mező; a dátumot dátummal hasonlítjuk össze, például:

  schedule_date < current_date

Ne alakítsd szöveggé a current_date értékét.

ARCHIVÁLÁS
A Beállítások lapon az „Összesítés frissítése” gomb lekéri az aktuális
szállítólevél-listát. Az „Archiválás” ZIP-et készít, de nem töröl. A ZIP
ellenőrzése után az „Archiváltak törlése” gombbal, a kért fájlszám beírásával
törölhetők a legalább két napos fájlok.
