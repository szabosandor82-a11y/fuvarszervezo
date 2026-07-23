Fuvarszervező V32 – GitHub Pages

A V32 fő változása, hogy az új optimalizáló külön planner-v32.js modulban fut, és a két főoldali művelet szigorúan különválik.

1. Fuvarok szétosztása
- Csak azt dönti el, melyik sofőrhöz melyik fuvar kerüljön.
- Nem optimalizál útvonalsorrendet.
- Az átlagos fuvarszámhoz közelít; egyszerű, mozgatható egységeknél a különbség célértéke legfeljebb 1, kötött nagy blokkoknál legfeljebb 2.
- A hosszú/szálas anyag Martin platós autójára kerül.
- A beszállító+projekt egységeket nem töri szét.
- Figyelembe veszi a projekt- és beszállítói összetartozást.

2. Útvonal optimalizálása
- Nem osztja át a fuvarokat másik sofőrhöz.
- Egy sofőr ugyanahhoz a beszállítóhoz naponta egyszer megy, és ott minden hozzá rendelt anyagot felvesz.
- Nap elején a felrakók dominálnak, a lerakók alaphelyzetben csak az összes felrakás után következnek.
- A lerakók sorrendje a sofőr lakhelye felé zárja a napot.
- Teljes autónyi rakomány esetén a felrakó→lerakó megszakíthatatlan blokk minden normál felrakás elé kerül.
- Martin és Patrik általában a Központi raktárban kezdenek.
- Martin a Felcsút felől útba eső hosszú/szálas felrakót a Központi raktár előtt veszi fel; ilyenkor a raktár közvetlen környezetében lévő felrakó is bekerülhet elé.
- Máriónál a rendszer összehasonlítja a lakhelyhez közeli felrakóval induló és a Központi raktár felé haladó útvonalat. Kistarcsa Ferenczi és Szerelvénybolt Üllő 807 jellegű, később nagy visszautat okozó pontot befelé menet kezeli.
- Közúti távolságmátrixot kér az OSRM-től; ha ez nem elérhető, légvonalas tartalék számítást használ.

Teljes autónyi rakomány jelölése
A fuvar vagy tétel megjegyzésében szerepeljen például: „teljes autónyi rakomány”.

Ellenőrzés
A V32 modulon 12 kanonikus útvonal- és szabályteszt, egy teljes Martin-integrációs teszt és egy 22 fuvaros szétosztási teszt futott le sikeresen. A részletek a TESZTEREDMENY_V32.txt fájlban találhatók.

Feltöltés
A ZIP tartalmát kell a GitHub Pages tárhely gyökerébe feltölteni, a korábbi fájlok felülírásával. Feltöltés után Ctrl+F5 javasolt.
