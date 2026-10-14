FUVARSZERVEZŐ V139

FRISSÍTÉS
0. Ha még nem tetted meg: a Supabase SQL Editorban futtasd le a
   SUPABASE_CSEVEGO_V138.sql fájlt (a csevegőhöz).
   Ha még nem tetted meg, futtasd le a
   SUPABASE_TAROLO_V136.sql fájlt (a végén a tároló új beállítása látszik).
   Ha még nem tetted meg, futtasd le a
   SUPABASE_SOFOR_TORLES_V134.sql fájlt, és ha még nem futott, a
   SUPABASE_SOFOR_MEZOK_V133.sql fájlt is ("Success. No rows returned" a
   helyes válasz). Több futtatás sem árt, adatot nem töröl.
1. Készíts biztonsági másolatot a jelenlegi GitHub Pages fájlokról.
2. Bontsd ki a Fuvarszervezo_V139_Mobile_PWA_GitHub_Pages.zip fájlt.
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

A változtatások részletei: VALTOZASOK_V139.txt.
A helyi ellenőrzések eredménye: ELLENORZES_V139.txt.

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


A V139-ben a fuvarszétosztás és az optimalizálás kizárólag a képernyőn megnyitott napot módosítja. A mentés is csak ennek a napnak a fuvarjait küldi fel, a korábbi és későbbi napokhoz nem nyúl.

A V128-ban a sofőr által átmozgatott fuvarok és hátralékok céldátuma az admin és a sofőr buborékjában is megjelenik. A funkció a V139-ben is megmaradt; részletek: VALTOZASOK_V128.txt.

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

V132 – A SOFŐRI PIPA ÉS A SZÁLLÍTÓLEVÉL-JELÖLÉS VÉDELME
A zöld pipa és a Mentett fotók jelölése eddig elveszhetett, ha a frissítés
vagy egy régi adatpéldány mentése felülírta. A V132-ben a frissítés
összefésül, a mentés csak a módosított fuvart küldi, az admin csak a
ténylegesen törölt fuvart törli, a Mentett fotók gomb a feltöltött fájlok
táblájából is bezöldül, és az admin felület percenként átveszi a sofőri
jelzéseket. Fontos: MINDEN eszközön (admin gép, sofőrtelefonok) a V139
fusson – telefonon zárd be teljesen és nyisd újra az alkalmazást.
Részletek: VALTOZASOK_V132.txt, ellenőrzés: ELLENORZES_V132.txt.

V133 – NAPI LISTA, SZÁLLÍTÓLEVÉL-TÖRLÉS, SOFŐRI GOMB, NAPTÁR
- A napi fuvarlista követi a „Fuvar napja és műveletek” dátumváltását.
- Galériából törölt szállítólevél után a jelölés eltűnik; archiválás utáni
  törlésnél „archiválva” felirattal megmarad.
- A sofőri felületen a Mentett fotók gomb látható, feltöltés után zöld,
  zárójelben a mellékletek számával.
- A naptár élénkebb, kontrasztosabb színeket kapott.
Részletek: VALTOZASOK_V133.txt, ellenőrzés: ELLENORZES_V133.txt.

V134 – SOFŐRI TÖRLÉS ÉS PONTOS MENTETT FOTÓK GOMB
- A sofőri galériában is van kuka, de csak a saját, aktív napi fuvaron.
- A Mentett fotók gomb csak akkor zöld és csak akkor ír számot, ha valóban
  van feltöltött fájl; törlés után visszaáll alapállapotba. Archiválás után
  „· archiválva” felirattal zöld marad.
Részletek: VALTOZASOK_V134.txt, ellenőrzés: ELLENORZES_V134.txt.

V135 – LEVÉLMELLÉKLET A SOFŐRNEK
- Az import előbb a fuvart menti, utána a mellékletet, újrapróbálással.
- Az admin Csatolmány ablakban látszik, hogy a sofőr látja-e a mellékletet.
- TEENDŐ EGYSZER: az importáló gépen Beállítások → „Hiányzó mellékletek
  feltöltése a sofőröknek”. Ez pótolja a korábban fel nem jutott
  mellékleteket.
Részletek: VALTOZASOK_V135.txt, ellenőrzés: ELLENORZES_V135.txt.

V136 – A LEVÉL MINDEN MELLÉKLETE A SOFŐRHÖZ JUT
- A tároló elutasította a csatolt Outlook-levelet (.msg), Word és Excel
  mellékletet, és emiatt a többi melléklet sem jelent meg a sofőrnél.
- TEENDŐ: 1) futtasd le a SUPABASE_TAROLO_V136.sql fájlt; 2) az importáló
  gépen Beállítások → „Hiányzó mellékletek feltöltése a sofőröknek”.
Részletek: VALTOZASOK_V136.txt, ellenőrzés: ELLENORZES_V136.txt.

V137 – TÖRÖLT FUVAR A SOFŐRNÉL, ELAKADT SOFŐRI MENTÉSEK
- Az admin által törölt fuvar a sofőr telefonjáról is eltűnik.
- Egy elutasított fuvar nem akasztja meg a sofőr többi mentését.
- Újraimportnál a régi fuvar mellékletei nem vesznek el.
Részletek: VALTOZASOK_V137.txt, ellenőrzés: ELLENORZES_V137.txt.

V138 – CSEVEGŐ ÉS KÜLÖN MEGJEGYZÉS-RÉSZ
- Gyors üzenetek az iroda és a sofőrök között: kép, fájl, csoportos üzenet,
  szerkesztés, törlés. Sofőrnél jobb alul 💬 gomb, adminnál alul buborékok.
- A Mentett fotók ablakban a szállítólevél megjegyzése és hangjegyzete külön
  részben látszik.
- TEENDŐ: futtasd le a SUPABASE_CSEVEGO_V138.sql fájlt.
Részletek: VALTOZASOK_V138.txt, ellenőrzés: ELLENORZES_V138.txt.

V139 – DÁTUM NÉLKÜLI HÁTRALÉK
- Tételek ablak: „Hátralékba dátum nélkül” gomb.
- Hátralék menü teteje: „Dátum nélkül – infóra vár” – dátum, Ütemezés, Mára.
- Az utolsó 30 nap ottfelejtett, kipipálatlan tételei is itt látszanak.
Részletek: VALTOZASOK_V139.txt, ellenőrzés: ELLENORZES_V139.txt.
